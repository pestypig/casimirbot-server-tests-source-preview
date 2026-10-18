import {createHash} from 'node:crypto';
import {readFile,readdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {acquireSolarMagneticArchiveProduct,listSolarMagneticAcquisitions,readSolarMagneticAcquisition} from '../magnetic-archive-acquisition';
import type {searchSolarMagneticArchiveDate} from '../magnetic-archive-directory';

const owner={tenantId:'test-tenant',accountProfileId:'test-profile'};
const name='mrzqs260928t1704c2316_265.fits.gz';
const sourceUrl=`https://magmap.nso.edu/oQR/zqs/202609/mrzqs260928/${name}`;
const query={dateUtc:'2026-09-28',provider:'nso_gong' as const,providerRecordKey:name};
const bytes=Buffer.concat([Buffer.from([0x1f,0x8b,0x08,0x00]),Buffer.alloc(128,0x2a)]);
const search=vi.fn(async()=>({providers:[{provider:'nso_gong',status:'available'}],products:[{
  provider:'nso_gong',providerRecordKey:name,kind:'derived_global_radial_map',sourceUrl,
}]})) as unknown as typeof searchSolarMagneticArchiveDate;
let root:string|undefined;
afterEach(async()=>{if(root&&path.isAbsolute(root)&&path.dirname(root)===os.tmpdir())await rm(root,{recursive:true,force:false});root=undefined;});
async function options(fetcher:typeof fetch){
  root=await mkdtemp(path.join(os.tmpdir(),'solar-magnetic-acquisition-test-'));
  return {fetcher,search,env:{...process.env,SUNPY_CACHE_ROOT:root},now:()=>new Date('2026-09-28T19:00:00Z')};
}
it('retains exact allowlisted source bytes and a bounded no-science receipt',async()=>{
  const fetcher=vi.fn(async(url:string,init?:RequestInit)=>{
    expect(url).toBe(sourceUrl);expect(init?.redirect).toBe('manual');
    return new Response(bytes,{status:200,headers:{'content-length':String(bytes.length)}});
  }) as typeof fetch;
  const receipt=await acquireSolarMagneticArchiveProduct(owner,query,await options(fetcher));
  expect(receipt).toMatchObject({providerRecordKey:name,bytes:bytes.length,
    sha256:createHash('sha256').update(bytes).digest('hex'),observedAtUtc:null,
    qualityStatus:'not_inspected',scientificAdmission:false});
  const key=createHash('sha256').update(`${owner.tenantId}\0${owner.accountProfileId}`).digest('hex');
  const ownerDir=path.join(root!,'magnetic-acquisitions',key);
  const requests=await readdir(ownerDir);
  expect(requests).toHaveLength(1);
  expect(await readFile(path.join(ownerDir,requests[0],'source.fits'))).toEqual(bytes);
  expect(JSON.parse(await readFile(path.join(ownerDir,requests[0],'receipt.json'),'utf8'))).toEqual(receipt);
  expect((await readSolarMagneticAcquisition(owner,receipt.acquisitionId,{...process.env,SUNPY_CACHE_ROOT:root}))?.receipt).toEqual(receipt);
  const listed=await listSolarMagneticAcquisitions(owner,{...process.env,SUNPY_CACHE_ROOT:root});
  expect(listed).toMatchObject({acquisitions:[receipt],integrityStatus:'listed_receipts_not_reverified',scientificAdmission:false});
  expect((await listSolarMagneticAcquisitions({...owner,accountProfileId:'another-profile'},
    {...process.env,SUNPY_CACHE_ROOT:root})).acquisitions).toEqual([]);
  await expect(readSolarMagneticAcquisition({...owner,accountProfileId:'another-profile'},receipt.acquisitionId,
    {...process.env,SUNPY_CACHE_ROOT:root})).rejects.toThrow();
});
it('rejects a forged catalog key before contacting a provider',async()=>{
  const fetcher=vi.fn() as unknown as typeof fetch;
  await expect(acquireSolarMagneticArchiveProduct(owner,{...query,providerRecordKey:'other.fits.gz'},await options(fetcher)))
    .rejects.toThrow('SOLAR_MAGNETIC_RECORD_NOT_IN_FRESH_CATALOG');
  expect(fetcher).not.toHaveBeenCalled();
});
it('rejects a same-host catalog URL with the wrong fixed product path',async()=>{
  const fetcher=vi.fn() as unknown as typeof fetch;
  const forgedSearch=vi.fn(async()=>({providers:[{provider:'nso_gong',status:'available'}],products:[{
    provider:'nso_gong',providerRecordKey:name,kind:'derived_global_radial_map',
    sourceUrl:`https://magmap.nso.edu/other/${name}`,
  }]})) as unknown as typeof searchSolarMagneticArchiveDate;
  await expect(acquireSolarMagneticArchiveProduct(owner,query,{...await options(fetcher),search:forgedSearch}))
    .rejects.toThrow('SOLAR_MAGNETIC_SOURCE_IDENTITY_INVALID');
  expect(fetcher).not.toHaveBeenCalled();
});
it('rejects a modified retained product identity before owner list or exact MCP read',async()=>{
  const fetcher=vi.fn(async()=>new Response(bytes,{status:200})) as typeof fetch;
  const opts=await options(fetcher);
  const receipt=await acquireSolarMagneticArchiveProduct(owner,query,opts);
  const ownerDir=path.join(root!,'magnetic-acquisitions',createHash('sha256')
    .update(`${owner.tenantId}\0${owner.accountProfileId}`).digest('hex'));
  const [requestDir]=await readdir(ownerDir);
  const receiptPath=path.join(ownerDir,requestDir,'receipt.json');
  await writeFile(receiptPath,JSON.stringify({...receipt,kind:'measured_visible_disk_los'}));
  await expect(readSolarMagneticAcquisition(owner,receipt.acquisitionId,opts.env))
    .rejects.toThrow('SOLAR_MAGNETIC_SOURCE_IDENTITY_INVALID');
  await expect(listSolarMagneticAcquisitions(owner,opts.env))
    .rejects.toThrow('SOLAR_MAGNETIC_SOURCE_IDENTITY_INVALID');
});
it('rejects non-FITS response bytes and leaves no retained request directory',async()=>{
  const fetcher=vi.fn(async()=>new Response(Buffer.from('<html>not fits</html>'),{status:200})) as typeof fetch;
  await expect(acquireSolarMagneticArchiveProduct(owner,query,await options(fetcher)))
    .rejects.toThrow('SOLAR_MAGNETIC_SOURCE_MAGIC_INVALID');
  const key=createHash('sha256').update(`${owner.tenantId}\0${owner.accountProfileId}`).digest('hex');
  expect(await readdir(path.join(root!,'magnetic-acquisitions',key))).toEqual([]);
});
it('re-inspects an HMI extension header before trusting retained time or quality metadata',async()=>{
  root=await mkdtemp(path.join(os.tmpdir(),'solar-magnetic-acquisition-test-'));
  const hmi=Buffer.alloc(5760,0x20);
  function write(block:number,cards:string[]){cards.forEach((card,index)=>hmi.write(card.padEnd(80,' '),block*2880+index*80,'ascii'));}
  write(0,['SIMPLE  = T','NAXIS   = 0','END']);
  write(1,["XTENSION= 'BINTABLE'","ZIMAGE  = T","CONTENT = 'MAGNETOGRAM'", "TELESCOP= 'SDO/HMI'",
    "INSTRUME= 'HMI_FRONT2'","BUNIT   = 'Gauss'","CTYPE1  = 'HPLN-TAN'","CTYPE2  = 'HPLT-TAN'",
    "DATE-OBS= '2026-09-28T20:23:01.400'",'QUALITY = 1024',
    "DRMS_ID = 'lm_jps.m45s_nrt:11120854:magnetogram'",'END']);
  const hmiUrl='https://suntoday.lmsal.com/sdomedia/SunInTime/2026/09/28/fblos.fits';
  const hmiSearch=vi.fn(async()=>({providers:[{provider:'lmsal_sdo',status:'available'}],products:[{
    provider:'lmsal_sdo',providerRecordKey:'SunInTime/2026-09-28/fblos.fits',
    kind:'measured_visible_disk_los',sourceUrl:hmiUrl}]})) as unknown as typeof searchSolarMagneticArchiveDate;
  const env={...process.env,SUNPY_CACHE_ROOT:root};
  const receipt=await acquireSolarMagneticArchiveProduct(owner,{dateUtc:'2026-09-28',provider:'lmsal_sdo',
    providerRecordKey:'SunInTime/2026-09-28/fblos.fits'},
    {env,search:hmiSearch,fetcher:vi.fn(async()=>new Response(hmi,{status:200})) as typeof fetch});
  expect(receipt).toMatchObject({observedAtUtc:'2026-09-28T20:23:01.400Z',qualityStatus:'header_quality_nonzero',
    hmiHeader:{qualityFlag:1024,drmsId:'lm_jps.m45s_nrt:11120854:magnetogram'},scientificAdmission:false});
  expect((await readSolarMagneticAcquisition(owner,receipt.acquisitionId,env))?.receipt).toEqual(receipt);
  const key=createHash('sha256').update(`${owner.tenantId}\0${owner.accountProfileId}`).digest('hex');
  const [requestDir]=await readdir(path.join(root,'magnetic-acquisitions',key));
  const receiptPath=path.join(root,'magnetic-acquisitions',key,requestDir,'receipt.json');
  const legacy={...receipt,hmiHeader:{...receipt.hmiHeader}};
  delete legacy.hmiHeader.drmsId;
  await writeFile(receiptPath,JSON.stringify(legacy));
  expect((await readSolarMagneticAcquisition(owner,receipt.acquisitionId,env))?.receipt).toEqual(legacy);
  const altered={...receipt,hmiHeader:{...receipt.hmiHeader,qualityFlag:0}};
  await writeFile(receiptPath,JSON.stringify(altered));
  await expect(readSolarMagneticAcquisition(owner,receipt.acquisitionId,env))
    .rejects.toThrow('SOLAR_MAGNETIC_ACQUISITION_HEADER_MISMATCH');
  await writeFile(receiptPath,JSON.stringify({...receipt,hmiHeader:{...receipt.hmiHeader,drmsId:'other-product'}}));
  await expect(readSolarMagneticAcquisition(owner,receipt.acquisitionId,env))
    .rejects.toThrow('SOLAR_MAGNETIC_ACQUISITION_HEADER_MISMATCH');
});
