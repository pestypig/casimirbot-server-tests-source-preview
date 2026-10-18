import { describe, expect, it, vi } from "vitest";
import { scheduleStartupMemorySettle } from "../startup-memory-settle";

describe("low-memory startup settle", () => {
  it("does nothing outside the explicit low-memory profile", () => {
    const collect = vi.fn();
    scheduleStartupMemorySettle({ enabled: false, collect });
    expect(collect).not.toHaveBeenCalled();
  });

  it("collects once and reports bounded before/after evidence", () => {
    const collect = vi.fn();
    const log = vi.fn();
    const readings = [
      { heapUsed: 900 * 1024 * 1024, rss: 1200 * 1024 * 1024 },
      { heapUsed: 320 * 1024 * 1024, rss: 680 * 1024 * 1024 },
    ];
    const readMemory = vi.fn(() => readings.shift() ?? readings[0]);
    const schedule = vi.fn((callback: () => void) => {
      callback();
      return { unref: vi.fn() } as unknown as ReturnType<typeof setTimeout>;
    });
    const now = vi.fn()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(142);

    scheduleStartupMemorySettle({
      enabled: true,
      collect,
      log,
      readMemory,
      now,
      schedule,
      delayMs: 0,
    });

    expect(collect).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      "[memory] low-memory startup settle complete heap=900->320MiB rss=1200->680MiB pause=42ms",
    );
  });
});
