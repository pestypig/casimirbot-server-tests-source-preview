import { afterEach, describe, expect, it, vi } from "vitest";
import { startSharedRoomPresenceHeartbeat } from
  "../../scripts/helix-shared-room-presence-heartbeat.mjs";

afterEach(() => {
  vi.useRealTimers();
});

describe("shared room acceptance presence heartbeat", () => {
  it("renews presence serially until stopped", async () => {
    vi.useFakeTimers();
    const sendPresent = vi.fn(async () => undefined);
    const stop = startSharedRoomPresenceHeartbeat({
      sendPresent,
      intervalMs: 15_000,
    });

    await vi.advanceTimersByTimeAsync(15_000);
    expect(sendPresent).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(sendPresent).toHaveBeenCalledTimes(2);

    await stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sendPresent).toHaveBeenCalledTimes(2);
  });

  it("continues after a transient presence failure", async () => {
    vi.useFakeTimers();
    const sendPresent = vi.fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValue(undefined);
    const stop = startSharedRoomPresenceHeartbeat({
      sendPresent,
      intervalMs: 10,
    });

    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(10);
    expect(sendPresent).toHaveBeenCalledTimes(2);
    await stop();
  });
});
