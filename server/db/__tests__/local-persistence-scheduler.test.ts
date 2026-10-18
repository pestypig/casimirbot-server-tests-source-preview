import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalPersistenceScheduler } from "../local-persistence-scheduler";

describe("LocalPersistenceScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces a mutation burst until the idle deadline", async () => {
    vi.useFakeTimers();
    const persist = vi.fn(async () => undefined);
    const scheduler = new LocalPersistenceScheduler({
      idleDelayMs: 100,
      maxDelayMs: 500,
      persist,
    });

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(80);
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(80);
    expect(persist).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("cannot postpone a continuous write stream beyond the maximum delay", async () => {
    vi.useFakeTimers();
    const persist = vi.fn(async () => undefined);
    const scheduler = new LocalPersistenceScheduler({
      idleDelayMs: 100,
      maxDelayMs: 250,
      persist,
    });

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(90);
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(90);
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(70);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("drains pending state explicitly", async () => {
    vi.useFakeTimers();
    const persist = vi.fn(async () => undefined);
    const scheduler = new LocalPersistenceScheduler({
      idleDelayMs: 10_000,
      maxDelayMs: 30_000,
      persist,
    });

    scheduler.schedule();
    await scheduler.drain();
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
