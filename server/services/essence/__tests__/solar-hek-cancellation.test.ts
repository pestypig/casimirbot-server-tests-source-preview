import { afterEach, expect, it, vi } from 'vitest';
import { fetchHekEventsForWindow } from '../solar-events-hek';
afterEach(() => vi.unstubAllGlobals());
it('propagates cancellation into the auxiliary archive fetch', async () => {
  let nativeSignal: AbortSignal | undefined;
  vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve,reject) => {
    nativeSignal = options.signal;
    nativeSignal!.addEventListener('abort',()=>reject(new Error('aborted')), {once:true});
  })));
  const controller = new AbortController();
  const pending = fetchHekEventsForWindow({start:'2026-09-23T12:00:00Z',end:'2026-09-23T12:02:00Z',signal:controller.signal});
  const rejected = expect(pending).rejects.toThrow('aborted');
  await vi.waitFor(()=>expect(nativeSignal).toBeDefined()); controller.abort(); await rejected;
  expect(nativeSignal!.aborted).toBe(true);
});
