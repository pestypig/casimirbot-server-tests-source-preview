import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readTheoryRuntimeJob,
  readTheoryRuntimeResult,
  runQueuedTheoryRuntimeJobNow,
  startTheoryRuntimeJob,
} from "../runtime-jobs/runtime-job-service";
import { updateTheoryRuntimeRunRequestStatus } from "../theory-runtime-run-request-manifest";
import { getTheoryRuntimeEntrypoint } from "../../../../shared/theory/runtime-entrypoints";
import { THEORY_RUNTIME_WORKSTATION_GRAPH_ID } from "../../../../shared/theory/runtime-execution-policy";
import { buildTheoryRuntimeReceiptV1, type TheoryRuntimeReceiptStatus } from "../../../../shared/contracts/theory-runtime-receipt.v1";
import { requestStatusForRuntimeReceipt } from "../runtime-jobs/runtime-job-finalizer";

let tempRoot: string;
const solarBadgeIds = [...(getTheoryRuntimeEntrypoint("solar.manifest")?.ownedBadgeIds ?? [])];
const alphaSweepBadgeIds = [...(getTheoryRuntimeEntrypoint("nhm2.shift_lapse.alpha_sweep")?.ownedBadgeIds ?? [])];
beforeEach(async () => { tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "theory-runtime-job-")); });
afterEach(async () => { await fs.rm(tempRoot, { recursive: true, force: true }); });

describe("theory runtime job service", () => {
  it.each([
    { receiptStatus: "completed", exitCode: 0, timedOut: false, expected: "completed" },
    { receiptStatus: "blocked", exitCode: 0, timedOut: false, expected: "completed" },
    { receiptStatus: "not_run", exitCode: 0, timedOut: false, expected: "completed" },
    { receiptStatus: "stale", exitCode: 0, timedOut: false, expected: "completed" },
    { receiptStatus: "failed", exitCode: 0, timedOut: false, expected: "failed" },
    { receiptStatus: "completed", exitCode: 2, timedOut: false, expected: "failed" },
    { receiptStatus: "completed", exitCode: null, timedOut: false, expected: "failed" },
    { receiptStatus: "completed", exitCode: null, timedOut: true, expected: "timeout" },
  ] as const)(
    "maps process/evidence state $receiptStatus/$exitCode/$timedOut to $expected",
    ({ receiptStatus, exitCode, timedOut, expected }) => {
      const receipt = buildTheoryRuntimeReceiptV1({
        generatedAt: "2026-07-19T12:00:01.000Z",
        receiptId: "receipt:status-table",
        runtimeId: "nhm2.shift_lapse.alpha_sweep",
        graphId: THEORY_RUNTIME_WORKSTATION_GRAPH_ID,
        badgeIds: [],
        command: "npm run warp:full-solve:nhm2-shift-lapse:alpha-sweep",
        args: {},
        status: receiptStatus as TheoryRuntimeReceiptStatus,
        outputs: { artifacts: [], scalars: {}, units: {}, gates: {}, missingSignals: [], warnings: [] },
        provenance: {
          gitSha: null,
          startedAt: "2026-07-19T12:00:00.000Z",
          completedAt: "2026-07-19T12:00:01.000Z",
          durationMs: 1000,
        },
        execution: {
          command: "npm",
          args: ["run", "-s", "warp:full-solve:nhm2-shift-lapse:alpha-sweep"],
          cwd: ".",
          environment: { NHM2_OUTPUT_DIR: "artifacts/run" },
          outputDirectory: "artifacts/run",
          outputDirectoryBound: true,
          exitCode,
          stdout: "",
          stderr: exitCode != null && exitCode !== 0 ? "failed" : "",
          timedOut,
          error: exitCode === 0 && !timedOut ? null : "execution did not complete successfully",
        },
        claimBoundary: {
          currentTier: "diagnostic",
          maximumTier: "reduced_order",
          promotionAllowed: false,
          promotionBlockedBy: ["physical_viability"],
        },
      });

      expect(requestStatusForRuntimeReceipt(receipt)).toBe(expected);
    },
  );

  it("persists an asynchronous request and terminal receipt with honest running progress", async () => {
    const queued = await startTheoryRuntimeJob({ runtimeId: "solar.manifest", graphId: THEORY_RUNTIME_WORKSTATION_GRAPH_ID, badgeIds: solarBadgeIds, requestedScope: "quick", projectRoot: tempRoot }, { deferExecution: true });
    expect(queued.request.status).toBe("queued");
    const terminal = await runQueuedTheoryRuntimeJobNow({
      requestId: queued.jobId,
      projectRoot: tempRoot,
      spawnExecutor: async () => ({ startedAt: "2026-07-14T12:00:00.000Z", completedAt: "2026-07-14T12:00:01.000Z", durationMs: 1000, exitCode: 1, stdout: "bounded output", stderr: "failed fixture", timedOut: false, error: "fixture failure" }),
    });
    expect(terminal.request.status).toBe("failed");
    expect(terminal.request.heartbeat.progress).toBe(1);
    expect(terminal.result.available).toBe(true);
    expect((await readTheoryRuntimeResult({ requestId: queued.jobId, projectRoot: tempRoot }))?.status).toBe("failed");
  });

  it("keeps a successful long process completed when its evidence receipt is not_run", async () => {
    const queued = await startTheoryRuntimeJob(
      {
        runtimeId: "nhm2.shift_lapse.alpha_sweep",
        graphId: THEORY_RUNTIME_WORKSTATION_GRAPH_ID,
        badgeIds: alphaSweepBadgeIds,
        requestedScope: "full",
        projectRoot: tempRoot,
      },
      { deferExecution: true },
    );
    const terminal = await runQueuedTheoryRuntimeJobNow({
      requestId: queued.jobId,
      projectRoot: tempRoot,
      spawnExecutor: async () => ({
        startedAt: "2026-07-19T12:00:00.000Z",
        completedAt: "2026-07-19T12:00:01.000Z",
        durationMs: 1000,
        exitCode: 0,
        stdout: "process completed",
        stderr: "",
        timedOut: false,
        error: null,
      }),
    });
    const receipt = await readTheoryRuntimeResult({ requestId: queued.jobId, projectRoot: tempRoot });

    expect(receipt?.status).toBe("not_run");
    expect(receipt?.execution?.exitCode).toBe(0);
    expect(terminal.request.status).toBe("completed");
    expect(terminal.request.heartbeat.message).toBe("Process completed; evidence receipt not_run.");
    expect(receipt?.claimBoundary.promotionAllowed).toBe(false);
  });

  it("rejects unknown and registered-but-non-executable runtimes", async () => {
    await expect(startTheoryRuntimeJob({ runtimeId: "unknown", graphId: "graph", badgeIds: [], requestedScope: "quick", projectRoot: tempRoot })).rejects.toThrow(/not allowlisted/i);
    await expect(startTheoryRuntimeJob({ runtimeId: "warp.full_solve.campaign", graphId: "graph", badgeIds: [], requestedScope: "full", projectRoot: tempRoot })).rejects.toThrow(/not allowlisted/i);
  });

  it("rejects workstation arguments for fixed no-argument entrypoints", async () => {
    await expect(startTheoryRuntimeJob({ runtimeId: "solar.manifest", graphId: THEORY_RUNTIME_WORKSTATION_GRAPH_ID, badgeIds: solarBadgeIds, args: { shell: "whoami" }, requestedScope: "quick", projectRoot: tempRoot })).rejects.toThrow(/does not accept workstation arguments/i);
  });

  it("rejects client attempts to spoof graph, badge ownership, or execution scope", async () => {
    await expect(startTheoryRuntimeJob({ runtimeId: "solar.manifest", graphId: "spoofed", badgeIds: solarBadgeIds, requestedScope: "quick", projectRoot: tempRoot })).rejects.toThrow(/server-owned graph/i);
    await expect(startTheoryRuntimeJob({ runtimeId: "solar.manifest", graphId: THEORY_RUNTIME_WORKSTATION_GRAPH_ID, badgeIds: [], requestedScope: "quick", projectRoot: tempRoot })).rejects.toThrow(/badge ownership/i);
    await expect(startTheoryRuntimeJob({ runtimeId: "solar.manifest", graphId: THEORY_RUNTIME_WORKSTATION_GRAPH_ID, badgeIds: solarBadgeIds, requestedScope: "full", projectRoot: tempRoot })).rejects.toThrow(/server-owned scope/i);
  });

  it("resumes a durable queued request when it is read after worker state was lost", async () => {
    const queued = await startTheoryRuntimeJob(
      { runtimeId: "solar.manifest", graphId: THEORY_RUNTIME_WORKSTATION_GRAPH_ID, badgeIds: solarBadgeIds, requestedScope: "quick", projectRoot: tempRoot },
      { deferExecution: true },
    );
    let executionStarted = false;
    const spawnExecutor = async () => {
      executionStarted = true;
      return {
        startedAt: "2026-07-14T12:00:00.000Z",
        completedAt: "2026-07-14T12:00:01.000Z",
        durationMs: 1000,
        exitCode: 1,
        stdout: "",
        stderr: "resumed fixture",
        timedOut: false,
        error: "resumed fixture failure",
      };
    };

    const recovered = await readTheoryRuntimeJob({
      requestId: queued.jobId,
      projectRoot: tempRoot,
      spawnExecutor,
    });
    expect(recovered?.request.status).toBe("queued");

    let terminal = recovered;
    for (
      let attempt = 0;
      attempt < 30 && (!terminal?.result.available || !["completed", "failed", "timeout"].includes(terminal.request.status));
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      terminal = await readTheoryRuntimeJob({ requestId: queued.jobId, projectRoot: tempRoot });
    }
    expect(executionStarted, JSON.stringify(terminal)).toBe(true);
    expect(terminal?.request.status).toBe("failed");
    expect(terminal?.result.available).toBe(true);
  });

  it("closes an orphaned running request with a structured interruption receipt", async () => {
    const queued = await startTheoryRuntimeJob(
      { runtimeId: "solar.manifest", graphId: THEORY_RUNTIME_WORKSTATION_GRAPH_ID, badgeIds: solarBadgeIds, requestedScope: "quick", projectRoot: tempRoot },
      { deferExecution: true },
    );
    await updateTheoryRuntimeRunRequestStatus({
      requestId: queued.jobId,
      projectRoot: tempRoot,
      status: "running",
      heartbeat: { stage: "running", message: "Process belonged to a prior server.", progress: null },
    });

    const recovered = await readTheoryRuntimeJob({ requestId: queued.jobId, projectRoot: tempRoot });
    const receipt = await readTheoryRuntimeResult({ requestId: queued.jobId, projectRoot: tempRoot });

    expect(recovered?.request.status).toBe("failed");
    expect(recovered?.result.available).toBe(true);
    expect(receipt?.outputs.missingSignals).toContain("runtime_process_interrupted");
    expect(receipt?.claimBoundary.promotionAllowed).toBe(false);
  });
});
