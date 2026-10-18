import { describe, expect, it, vi } from "vitest";
import { DesktopQuitCoordinator } from "../../apps/desktop/src/desktop-quit-coordinator";

const deferred = () => {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>(done => { resolve = done; });
  return { promise, resolve };
};

describe("desktop quit coordination", () => {
  it("waits for independent cleanup and handles repeated before-quit events once", async () => {
    const first = deferred();
    const second = deferred();
    const beginQuit = vi.fn();
    const resumeQuit = vi.fn();
    const recordFailure = vi.fn();
    const runFirst = vi.fn(() => first.promise);
    const runSecond = vi.fn(() => second.promise);
    const coordinator = new DesktopQuitCoordinator({ beginQuit, resumeQuit, recordFailure,
      cleanups: [{ run: runFirst, failureCode: "first_failed" },
        { run: runSecond, failureCode: "second_failed" }] });
    const event = { preventDefault: vi.fn() };

    expect(coordinator.beforeQuit(event)).toBe(false);
    expect(coordinator.beforeQuit(event)).toBe(false);
    await Promise.resolve();
    expect(beginQuit).toHaveBeenCalledTimes(1);
    expect(runFirst).toHaveBeenCalledTimes(1);
    expect(runSecond).toHaveBeenCalledTimes(1);
    first.resolve(true);
    await Promise.resolve();
    expect(resumeQuit).not.toHaveBeenCalled();
    second.resolve(true);
    await vi.waitFor(() => expect(resumeQuit).toHaveBeenCalledTimes(1));
    expect(recordFailure).not.toHaveBeenCalled();
    expect(coordinator.beforeQuit(event)).toBe(true);
    expect(runFirst).toHaveBeenCalledTimes(1);
  });

  it("records each unconfirmed cleanup and still resumes quit", async () => {
    const resumeQuit = vi.fn();
    const recordFailure = vi.fn(() => { throw Error("journal failed"); });
    const coordinator = new DesktopQuitCoordinator({ beginQuit: vi.fn(), resumeQuit, recordFailure,
      cleanups: [
        { run: () => { throw Error("private cleanup failed"); }, failureCode: "private_failed" },
        { run: async () => false, failureCode: "conversation_failed" },
      ] });
    expect(coordinator.beforeQuit({ preventDefault: vi.fn() })).toBe(false);
    await vi.waitFor(() => expect(resumeQuit).toHaveBeenCalledTimes(1));
    expect(recordFailure.mock.calls.map(([code]) => code)).toEqual(["private_failed", "conversation_failed"]);
  });
});
