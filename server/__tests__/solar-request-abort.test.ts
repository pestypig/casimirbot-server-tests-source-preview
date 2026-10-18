import { EventEmitter } from 'node:events';
import { expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { requestAbortController } from '../utils/request-abort';
function fixture() {
  const req = Object.assign(new EventEmitter(), { aborted: false });
  const res = Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false });
  return { req, res, controller: requestAbortController(req as unknown as Request, res as unknown as Response) };
}
it('aborts disconnected callers and removes listeners', () => {
  const f = fixture(); f.res.emit('close'); expect(f.controller.signal.aborted).toBe(true);
  expect(f.req.listenerCount('aborted')).toBe(0); expect(f.res.listenerCount('finish')).toBe(0);
});
it('does not cancel a normally completed response', () => {
  const f = fixture(); f.res.writableEnded = true; f.res.emit('finish'); f.res.emit('close');
  expect(f.controller.signal.aborted).toBe(false); expect(f.res.listenerCount('close')).toBe(0);
});
it('honors an already aborted request and active request abort', () => {
  const f = fixture(); f.req.emit('aborted'); expect(f.controller.signal.aborted).toBe(true);
  const req = Object.assign(new EventEmitter(), { aborted: true }); const res = new EventEmitter();
  expect(requestAbortController(req as unknown as Request, res as Response).signal.aborted).toBe(true);
});
