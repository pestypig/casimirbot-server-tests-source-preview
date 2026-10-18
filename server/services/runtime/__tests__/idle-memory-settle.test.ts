import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetIdleMemorySettleForTests,
  scheduleIdleMemorySettle,
} from "../idle-memory-settle";

describe("idle memory settle", () => {
  afterEach(() => {
    resetIdleMemorySettleForTests();
    vi.useRealTimers();
  });

  it("collects only after the runtime becomes idle and exceeds a threshold", async () => {
    vi.useFakeTimers();
    const collect = vi.fn();
    const log = vi.fn();
    scheduleIdleMemorySettle({
      enabled: true,
      hasActiveTasks: () => false,
      collect,
      log,
      delayMs: 100,
      minimumIntervalMs: 0,
      readMemory: () => ({
        heapUsed: 600 * 1024 * 1024,
        rss: 1_100 * 1024 * 1024,
      }),
      readHostMemory: () => ({
        free: 8 * 1024 * 1024 * 1024,
        total: 16 * 1024 * 1024 * 1024,
      }),
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(collect).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("low-memory idle settle complete"),
    );
  });

  it("does not collect while another governed task is active", async () => {
    vi.useFakeTimers();
    const collect = vi.fn();
    scheduleIdleMemorySettle({
      enabled: true,
      hasActiveTasks: () => true,
      collect,
      delayMs: 100,
      minimumIntervalMs: 0,
      readMemory: () => ({
        heapUsed: 700 * 1024 * 1024,
        rss: 1_200 * 1024 * 1024,
      }),
      readHostMemory: () => ({
        free: 8 * 1024 * 1024 * 1024,
        total: 16 * 1024 * 1024 * 1024,
      }),
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(collect).not.toHaveBeenCalled();
  });

  it("skips collection below both memory thresholds", async () => {
    vi.useFakeTimers();
    const collect = vi.fn();
    scheduleIdleMemorySettle({
      enabled: true,
      hasActiveTasks: () => false,
      collect,
      delayMs: 100,
      minimumIntervalMs: 0,
      readMemory: () => ({
        heapUsed: 300 * 1024 * 1024,
        rss: 700 * 1024 * 1024,
      }),
      readHostMemory: () => ({
        free: 8 * 1024 * 1024 * 1024,
        total: 16 * 1024 * 1024 * 1024,
      }),
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(collect).not.toHaveBeenCalled();
  });

  it("collects under host pressure before the process crosses its own thresholds", async () => {
    vi.useFakeTimers();
    const collect = vi.fn();
    const log = vi.fn();
    scheduleIdleMemorySettle({
      enabled: true,
      hasActiveTasks: () => false,
      collect,
      log,
      delayMs: 100,
      minimumIntervalMs: 0,
      readMemory: () => ({
        heapUsed: 400 * 1024 * 1024,
        rss: 900 * 1024 * 1024,
      }),
      readHostMemory: () => ({
        free: 3.2 * 1024 * 1024 * 1024,
        total: 16 * 1024 * 1024 * 1024,
      }),
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(collect).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("hostFree=20%"));
  });
});
