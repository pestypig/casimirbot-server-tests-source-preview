import { describe, expect, it, vi } from "vitest";
import {
  parseLinuxCommitMemory,
  parseWindowsVirtualMemoryOutput,
  resolveHostCommitCacheUpdate,
  sampleWindowsCommitMemory,
} from "../host-commit-memory";

describe("host commit memory sampling", () => {
  it("normalizes Windows virtual-memory counters as commit headroom", () => {
    const snapshot = parseWindowsVirtualMemoryOutput(
      "FreeVirtualMemory=1839856\r\nTotalVirtualMemorySize=19535160\r\n",
      1234,
    );

    expect(snapshot).toMatchObject({
      status: "available",
      source: "windows_wmic",
      platform: "win32",
      sampledAtMs: 1234,
      freeMiB: 1796.7,
      limitMiB: 19077.3,
      ratio: 0.9058,
    });
  });

  it("uses built-in CIM when WMIC is absent without weakening commit admission", async () => {
    const run = vi.fn(async (file: string) => file === "wmic.exe"
      ? { stdout: "", errorCode: "ENOENT" }
      : { stdout: "FreeVirtualMemory=1839856\r\nTotalVirtualMemorySize=19535160\r\n" });

    const snapshot = await sampleWindowsCommitMemory(1234, run);

    expect(run.mock.calls.map(([file]) => file)).toEqual(["wmic.exe", "powershell.exe"]);
    expect(snapshot).toMatchObject({
      status: "available",
      source: "windows_cim",
      freeMiB: 1796.7,
      limitMiB: 19077.3,
      sampledAtMs: 1234,
    });
  });

  it("does not spawn the fallback when WMIC returns valid counters", async () => {
    const run = vi.fn(async () => ({
      stdout: "FreeVirtualMemory=1839856\r\nTotalVirtualMemorySize=19535160\r\n",
    }));

    expect(await sampleWindowsCommitMemory(1234, run)).toMatchObject({
      status: "available",
      source: "windows_wmic",
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("fails closed when neither Windows commit sampler returns valid counters", async () => {
    const run = vi.fn(async (file: string) => file === "wmic.exe"
      ? { stdout: "", errorCode: "ENOENT" }
      : { stdout: "FreeVirtualMemory=1000\n" });

    expect(await sampleWindowsCommitMemory(1234, run)).toMatchObject({
      status: "unavailable",
      source: "sample_error",
      errorCode: "windows_cim_sample_invalid",
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("normalizes Linux CommitLimit and Committed_AS counters", () => {
    const snapshot = parseLinuxCommitMemory(
      "MemTotal:       16384000 kB\nCommitLimit:    20000000 kB\nCommitted_AS:   17000000 kB\n",
      5678,
    );

    expect(snapshot).toMatchObject({
      status: "available",
      source: "linux_proc_meminfo",
      platform: "linux",
      sampledAtMs: 5678,
      freeMiB: 2929.7,
      limitMiB: 19531.3,
      ratio: 0.85,
    });
  });

  it("rejects incomplete samples instead of inventing commit headroom", () => {
    expect(parseWindowsVirtualMemoryOutput("FreeVirtualMemory=1000\n")).toBeNull();
    expect(parseLinuxCommitMemory("CommitLimit: 1000 kB\n")).toBeNull();
  });

  it("retains the last valid reading across a transient sampler failure", () => {
    const available = parseWindowsVirtualMemoryOutput(
      "FreeVirtualMemory=1839856\r\nTotalVirtualMemorySize=19535160\r\n",
      1234,
    );
    const unavailable = {
      status: "unavailable" as const,
      source: "sample_error" as const,
      platform: "win32" as const,
      errorCode: "windows_sample_invalid",
    };

    expect(resolveHostCommitCacheUpdate(available, unavailable)).toBe(available);
  });

  it("fails closed when the first sampler attempt is unavailable", () => {
    const unavailable = {
      status: "unavailable" as const,
      source: "sample_error" as const,
      platform: "win32" as const,
      errorCode: "windows_sample_invalid",
    };

    expect(resolveHostCommitCacheUpdate(null, unavailable)).toEqual(unavailable);
  });
});
