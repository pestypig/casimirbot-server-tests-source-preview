import { describe, expect, it, vi } from "vitest";
import { createCredentialUseTouchThrottle } from "../credential-use-throttle";

describe("environment connector credential-use throttle", () => {
  it("coalesces concurrent and repeated audit timestamp writes", async () => {
    let now = 1_000;
    const touch = vi.fn(async () => undefined);
    const throttledTouch = createCredentialUseTouchThrottle({
      intervalMs: 10_000,
      now: () => now,
    });

    await Promise.all([
      throttledTouch("credential:one", touch),
      throttledTouch("credential:one", touch),
      throttledTouch("credential:one", touch),
    ]);
    expect(touch).toHaveBeenCalledTimes(1);

    now += 9_999;
    expect(await throttledTouch("credential:one", touch)).toBe(false);
    now += 1;
    expect(await throttledTouch("credential:one", touch)).toBe(true);
    expect(touch).toHaveBeenCalledTimes(2);
  });

  it("allows a failed audit write to be retried immediately", async () => {
    const touch = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce(undefined);
    const throttledTouch = createCredentialUseTouchThrottle();

    await expect(
      throttledTouch("credential:retry", touch),
    ).rejects.toThrow("database unavailable");
    await expect(
      throttledTouch("credential:retry", touch),
    ).resolves.toBe(true);
    expect(touch).toHaveBeenCalledTimes(2);
  });
});
