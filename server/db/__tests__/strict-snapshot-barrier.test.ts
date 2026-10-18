import { expect, it, vi } from "vitest";
import { StrictSnapshotBarrier } from "../strict-snapshot-barrier";

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

it("shares one save covering every concurrent caller's required tables", async () => {
  const gate = deferred();
  const save = vi.fn(() => gate.promise);
  const barrier = new StrictSnapshotBarrier(save);
  let acknowledged = 0;
  const calls = [barrier.request(["events"]), barrier.request(["requests", "events"])]
    .map(call => call.then(() => acknowledged++));
  await Promise.resolve();
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith(["events", "requests"]);
  expect(acknowledged).toBe(0);
  gate.resolve();
  await Promise.all(calls);
  expect(acknowledged).toBe(2);
});

it("does not acknowledge a late mutation from an earlier snapshot", async () => {
  const first = deferred(), second = deferred();
  const save = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const barrier = new StrictSnapshotBarrier(save);
  const a = barrier.request(["events"]);
  await Promise.resolve();
  let lateAcknowledged = false;
  const b = barrier.request(["events"]).then(() => { lateAcknowledged = true; });
  first.resolve();
  await a;
  expect(lateAcknowledged).toBe(false);
  expect(save).toHaveBeenCalledTimes(2);
  second.resolve();
  await b;
  await barrier.drain();
});

it("rejects the whole failed batch without replay and permits a later explicit request", async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error("disk unavailable")).mockResolvedValue(undefined);
  const barrier = new StrictSnapshotBarrier(save);
  const outcomes = await Promise.allSettled([barrier.request(["events"]), barrier.request(["results"])]);
  expect(outcomes.map(result => result.status)).toEqual(["rejected", "rejected"]);
  await barrier.drain();
  expect(save).toHaveBeenCalledTimes(1);
  await barrier.request(["results"]);
  expect(save).toHaveBeenCalledTimes(2);
});

it("preserves unknown-table full-save requests and copies caller table lists", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const barrier = new StrictSnapshotBarrier(save);
  const tables = ["events"];
  const a = barrier.request(tables);
  tables.push("not-part-of-request");
  await a;
  expect(save).toHaveBeenLastCalledWith(["events"]);
  await Promise.all([barrier.request(["results"]), barrier.request()]);
  expect(save).toHaveBeenLastCalledWith(undefined);
  await barrier.request([]);
  expect(save).toHaveBeenCalledTimes(2);
});

it("drains both captured and queued callers before shutdown", async () => {
  const first = deferred(), second = deferred();
  const save = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const barrier = new StrictSnapshotBarrier(save);
  const a = barrier.request(["events"]);
  await Promise.resolve();
  const b = barrier.request(["results"]);
  let drained = false;
  const draining = barrier.drain().then(() => { drained = true; });
  first.resolve();
  await a;
  expect(drained).toBe(false);
  second.resolve();
  await Promise.all([b, draining]);
  expect(drained).toBe(true);
});
