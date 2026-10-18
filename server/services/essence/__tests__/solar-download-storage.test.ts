import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, symlink, rm, open, mkdir, access, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
vi.mock('../../../utils/run-python', () => ({runPythonScript:vi.fn()}));
import { runPythonScript } from '../../../utils/run-python';
import { solarCacheRoot, solarTreeBytes, runSolarExport, inspectSolarCache, reclaimSolarRequest, SOLAR_REQUEST_MAX_BYTES, SOLAR_CACHE_MAX_BYTES } from '../solar-download-storage';
let directory: string;
beforeEach(async () => {directory=await mkdtemp(path.join(os.tmpdir(),'solar-storage-test-'));vi.clearAllMocks();});
afterEach(async () => {
  if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep) ||
      !path.basename(directory).startsWith('solar-storage-test-')) throw new Error('Unsafe test cleanup');
  await rm(directory,{recursive:true,force:true});
});
describe('portable solar download storage', () => {
  it('lists and explicitly reclaims only the named generated request', async () => {
    await mkdir(path.join(directory, 'request-abc123'));
    await writeFile(path.join(directory, 'request-abc123', 'image.fits'), Buffer.alloc(100));
    await writeFile(path.join(directory, 'keep.json'), 'saved');
    const env = { SUNPY_CACHE_ROOT: directory };
    const cache = await inspectSolarCache(env);
    expect(cache.requests).toEqual([expect.objectContaining({id:'request-abc123',bytes:100})]);
    await expect(reclaimSolarRequest('request-abc123','',env)).rejects.toThrow('CONFIRMATION');
    await expect(reclaimSolarRequest('../outside','delete-managed-download',env)).rejects.toThrow('CONFIRMATION');
    expect(await reclaimSolarRequest('request-abc123','delete-managed-download',env))
      .toEqual(expect.objectContaining({removedBytes:100,recoverable:false}));
    await access(path.join(directory, 'keep.json'));
    await expect(access(path.join(directory, 'request-abc123'))).rejects.toThrow();
  });
  it('rejects deletion with nested symlinks without removing retained files', async () => {
    const target = path.join(directory,'request-abc123'); await mkdir(target);
    await writeFile(path.join(target, 'keep'), 'retain');
    await symlink(os.tmpdir(), path.join(target, 'link'), 'junction');
    await expect(reclaimSolarRequest('request-abc123','delete-managed-download',{SUNPY_CACHE_ROOT:directory}))
      .rejects.toThrow('SYMLINK');
    await access(path.join(target,'keep'));
  });
  it('uses profile-owned data rather than runtime cwd', () => {
    expect(solarCacheRoot({HELIX_LOCAL_DB_PATH:path.join(directory,'state','db.json')}))
      .toBe(path.join(directory,'state','solar-observations'));
    expect(() => solarCacheRoot({SUNPY_CACHE_ROOT:'relative'})).toThrow('ABSOLUTE');
    expect(() => solarCacheRoot({SUNPY_CACHE_ROOT:process.cwd(),CASIMIR_DESKTOP_HOST:'1'})).toThrow('INSTALLED_RUNTIME');
  });
  it('counts retained bytes and rejects symlink traversal', async () => {
    await writeFile(path.join(directory,'data'),Buffer.alloc(100));
    expect(await solarTreeBytes(directory)).toBe(100);
    await symlink(os.tmpdir(),path.join(directory,'link'),'junction');
    await expect(solarTreeBytes(directory)).rejects.toThrow('SYMLINK');
  });
  it('passes an isolated writable output directory to the runner', async () => {
    vi.mocked(runPythonScript).mockResolvedValue({frames:[]});
    await runSolarExport('script',{args:['--images-only'],timeoutMs:1000,env:{SUNPY_CACHE_ROOT:directory}});
    const options=vi.mocked(runPythonScript).mock.calls[0][1]!;
    expect(options.args?.[1]).toBe('--out-dir');
    expect(options.args?.[2]).toContain(path.join(directory,'request-'));
    expect(options.signal).toBeTruthy();
  });
  it('rejects concurrent downloads and releases its slot after failure', async () => {
    let release: (value:unknown)=>void = () => {};
    vi.mocked(runPythonScript).mockImplementationOnce(() => new Promise(resolve=>{release=resolve;}));
    const options={args:[],timeoutMs:1000,env:{SUNPY_CACHE_ROOT:directory}};
    const first=runSolarExport('script',options);
    // Wait for actual runner dispatch, not a lock-file assumption.
    await vi.waitFor(()=>expect(runPythonScript).toHaveBeenCalledTimes(1));
    await expect(runSolarExport('script',options)).rejects.toThrow('BUSY');
    await expect(reclaimSolarRequest('request-abc123','delete-managed-download',options.env)).rejects.toThrow('BUSY');
    release({frames:[]}); await first;
    vi.mocked(runPythonScript).mockRejectedValueOnce(new Error('failed'));
    await expect(runSolarExport('script',options)).rejects.toThrow('failed');
    vi.mocked(runPythonScript).mockResolvedValue({frames:[]});
    await expect(runSolarExport('script',options)).resolves.toEqual({frames:[]});
  });
  it('does not launch an already cancelled request', async () => {
    const controller=new AbortController();controller.abort();
    await expect(runSolarExport('script',{args:[],timeoutMs:1000,env:{SUNPY_CACHE_ROOT:directory},
      signal:controller.signal})).rejects.toThrow('CANCELLED');
    expect(runPythonScript).not.toHaveBeenCalled();
  });
  it('refuses a full reservation without launching, evicting or losing the export slot', async () => {
    const retained=path.join(directory,'retained-budget-fixture');
    const handle=await open(retained,'wx');
    try { await handle.truncate(SOLAR_CACHE_MAX_BYTES-SOLAR_REQUEST_MAX_BYTES+1); }
    finally { await handle.close(); }
    const snapshot=path.join(directory,'keep.json');
    await writeFile(snapshot,'saved observation');
    const options={args:[],timeoutMs:1000,env:{SUNPY_CACHE_ROOT:directory}};
    await expect(runSolarExport('script',options)).rejects.toThrow('QUOTA_REACHED');
    expect(runPythonScript).not.toHaveBeenCalled();
    expect((await readdir(directory)).sort()).toEqual(['keep.json','retained-budget-fixture']);
    expect(await readFile(snapshot,'utf8')).toBe('saved observation');
    expect(await solarTreeBytes(directory)).toBe(SOLAR_CACHE_MAX_BYTES-SOLAR_REQUEST_MAX_BYTES+1+17);
    // Shrink only this owned disposable fixture, not a user's retained cache.
    const shrink=await open(retained,'r+');
    try { await shrink.truncate(0); } finally { await shrink.close(); }
    vi.mocked(runPythonScript).mockResolvedValue({frames:[]});
    await expect(runSolarExport('script',options)).resolves.toEqual({frames:[]});
  });
  it('rejects an over-budget retained result before admission', async () => {
    vi.mocked(runPythonScript).mockImplementationOnce(async (_script,options) => {
      const output=options!.args!.at(-1)!;
      const file=await open(path.join(output,'sparse-budget-test'),'w');
      try { await file.truncate(SOLAR_REQUEST_MAX_BYTES); } finally { await file.close(); }
      return {frames:[]};
    });
    await expect(runSolarExport('script',{args:[],timeoutMs:1000,env:{SUNPY_CACHE_ROOT:directory}}))
      .rejects.toThrow('BYTE_LIMIT');
  });
});
