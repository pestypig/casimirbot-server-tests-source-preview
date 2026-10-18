import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isTheoryRuntimeReceiptV1 } from "../../../../shared/contracts/theory-runtime-receipt.v1";
import {
  createTheoryRuntimeRunRequestManifest,
  readTheoryRuntimeRunRequestStatus,
} from "../theory-runtime-run-request-manifest";
import {
  executeLongTheoryRuntimeRequest,
  theoryRuntimeReceiptIdForRequest,
  type ExecuteLongTheoryRuntimeRequestInput,
} from "../long-runtime-executor";
import type { TheoryRuntimeExecutionResult } from "../runtime-adapters";
import { sha256TheoryRuntimeFile } from "../runtime-artifact-manifest";

let tempRoot: string;
const GIT_SHA = "1234567890abcdef1234567890abcdef12345678";
const CANDIDATE_BINDINGS = {
  candidateId: "nhm2-candidate-test-v1",
  selectedProfileId: "stage1_centerline_alpha_0p7000_candidate_v1",
  chartId: "nhm2-asymptotic-cartesian-v1",
  runId: "nhm2-run-test-v1",
  candidateManifestSha256: "a".repeat(64),
  atlasSha256: "b".repeat(64),
  unitsSha256: "c".repeat(64),
  normalizationSha256: "d".repeat(64),
};

const successfulExecution: TheoryRuntimeExecutionResult = {
  startedAt: "2026-05-29T00:00:00.000Z",
  completedAt: "2026-05-29T00:00:01.000Z",
  durationMs: 1000,
  exitCode: 0,
  stdout: "ok",
  stderr: "",
  timedOut: false,
  error: null,
};

async function writeFixture(
  relativePath: string,
  contents: string,
): Promise<void> {
  const absolutePath = path.join(tempRoot, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, contents, "utf8");
}

async function createAlphaRequest(requestId = "request:alpha") {
  return createTheoryRuntimeRunRequestManifest({
    runtimeId: "nhm2.shift_lapse.alpha_sweep",
    graphId: "nhm2-theory-badge-graph",
    badgeIds: ["nhm2.qei.sampling_window"],
    requestedScope: "sweep",
    args: CANDIDATE_BINDINGS,
    requestId,
    projectRoot: tempRoot,
    generatedAt: "2026-05-29T00:00:00.000Z",
  });
}

function execInput(
  overrides: Partial<ExecuteLongTheoryRuntimeRequestInput> = {},
): ExecuteLongTheoryRuntimeRequestInput {
  return {
    requestId: "request:alpha",
    projectRoot: tempRoot,
    outputDirectory:
      "artifacts/research/full-solve/selected-family/nhm2-shift-lapse/alpha-sweep",
    execute: true,
    generatedAt: "2026-05-29T00:00:02.000Z",
    ...overrides,
  };
}

const resolveGitSha = async () => GIT_SHA;
const resolveSourceTreeState = async () => ({
  sourceTreeSha256: "e".repeat(64),
  worktreeClean: true,
});

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "long-runtime-executor-"));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("executeLongTheoryRuntimeRequest", () => {
  it("runs the allowlisted alpha sweep through a fixed npm command and parses receipts", async () => {
    await createAlphaRequest();
    const result = await executeLongTheoryRuntimeRequest(execInput(), {
      resolveGitSha,
      resolveSourceTreeState,
      spawnExecutor: async (command) => {
        if (process.platform === "win32") {
          expect(command.command.toLowerCase()).not.toMatch(/npm\.cmd$/);
        } else {
          expect(command.command).toBe("npm");
        }
        expect(command.args.slice(-3)).toEqual([
          "run",
          "-s",
          "warp:full-solve:nhm2-shift-lapse:alpha-sweep",
        ]);
        expect(command.env).toEqual({
          THEORY_RUNTIME_REQUEST_ID: "request:alpha",
          THEORY_RUNTIME_RECEIPT_ID: theoryRuntimeReceiptIdForRequest(
            "nhm2.shift_lapse.alpha_sweep",
            "request:alpha",
          ),
          THEORY_RUNTIME_ID: "nhm2.shift_lapse.alpha_sweep",
          NHM2_OUTPUT_DIR:
            "artifacts/research/full-solve/selected-family/nhm2-shift-lapse/alpha-sweep",
          NHM2_CANDIDATE_ID: CANDIDATE_BINDINGS.candidateId,
          NHM2_SELECTED_PROFILE_ID: CANDIDATE_BINDINGS.selectedProfileId,
          NHM2_CHART_ID: CANDIDATE_BINDINGS.chartId,
          NHM2_RUN_ID: CANDIDATE_BINDINGS.runId,
          NHM2_CANDIDATE_MANIFEST_SHA256:
            CANDIDATE_BINDINGS.candidateManifestSha256,
          NHM2_ATLAS_SHA256: CANDIDATE_BINDINGS.atlasSha256,
          NHM2_UNITS_SHA256: CANDIDATE_BINDINGS.unitsSha256,
          NHM2_NORMALIZATION_SHA256: CANDIDATE_BINDINGS.normalizationSha256,
        });
        await writeFixture(
          "artifacts/research/full-solve/selected-family/nhm2-shift-lapse/alpha-sweep/run.json",
          JSON.stringify({
            gates: {
              source_closure: "pass",
              certificate_integrity: "pass",
              observer_audit: "pass",
            },
            alpha: 0.2,
            sourceClosureResidual: 0,
            certificate: { integrity: "pass" },
            observerAudit: { status: "pass" },
          }),
        );
        return successfulExecution;
      },
    });
    const status = await readTheoryRuntimeRunRequestStatus({
      requestId: "request:alpha",
      projectRoot: tempRoot,
    });

    expect(result.receiptV1.status).toBe("completed");
    expect(result.receiptV1.receiptId).toBe(
      theoryRuntimeReceiptIdForRequest(
        "nhm2.shift_lapse.alpha_sweep",
        "request:alpha",
      ),
    );
    expect(result.receiptV1.args).toMatchObject({
      requestId: "request:alpha",
      ...CANDIDATE_BINDINGS,
    });
    expect(
      result.receiptV1.outputs.artifacts.some((artifact) =>
        artifact.includes("alpha-sweep/run.json"),
      ),
    ).toBe(true);
    expect(result.receiptV1.provenance).toEqual({
      gitSha: GIT_SHA,
      startedAt: successfulExecution.startedAt,
      completedAt: successfulExecution.completedAt,
      durationMs: successfulExecution.durationMs,
    });
    expect(result.receiptV1.execution).toMatchObject({
      cwd: ".",
      environment: {
        THEORY_RUNTIME_REQUEST_ID: "request:alpha",
        THEORY_RUNTIME_RECEIPT_ID: theoryRuntimeReceiptIdForRequest(
          "nhm2.shift_lapse.alpha_sweep",
          "request:alpha",
        ),
        THEORY_RUNTIME_ID: "nhm2.shift_lapse.alpha_sweep",
        NHM2_OUTPUT_DIR:
          "artifacts/research/full-solve/selected-family/nhm2-shift-lapse/alpha-sweep",
        NHM2_CANDIDATE_ID: CANDIDATE_BINDINGS.candidateId,
        NHM2_SELECTED_PROFILE_ID: CANDIDATE_BINDINGS.selectedProfileId,
        NHM2_CHART_ID: CANDIDATE_BINDINGS.chartId,
        NHM2_RUN_ID: CANDIDATE_BINDINGS.runId,
        NHM2_CANDIDATE_MANIFEST_SHA256:
          CANDIDATE_BINDINGS.candidateManifestSha256,
        NHM2_ATLAS_SHA256: CANDIDATE_BINDINGS.atlasSha256,
        NHM2_UNITS_SHA256: CANDIDATE_BINDINGS.unitsSha256,
        NHM2_NORMALIZATION_SHA256: CANDIDATE_BINDINGS.normalizationSha256,
      },
      outputDirectoryBound: true,
      exitCode: 0,
      stdout: "ok",
      stderr: "",
    });
    expect(result.receiptV1.execution?.args.slice(-3)).toEqual([
      "run",
      "-s",
      "warp:full-solve:nhm2-shift-lapse:alpha-sweep",
    ]);
    const manifest = result.receiptV1.outputs.artifactManifest;
    expect(manifest?.entries).toEqual([
      expect.objectContaining({
        path: "artifacts/research/full-solve/selected-family/nhm2-shift-lapse/alpha-sweep/run.json",
        freshness: "new",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
    expect(manifest?.manifestPath).toMatch(/theory-runtime-output-manifest-/);
    expect(manifest?.manifestSha256).toBe(
      await sha256TheoryRuntimeFile(
        path.join(tempRoot, manifest!.manifestPath!),
      ),
    );
    expect(manifest?.freshnessProof).toMatchObject({
      schemaVersion: "theory_runtime_freshness_snapshot/v1",
      algorithm: "sha256_size_pre_post/v1",
      beforeEntries: [],
      beforeCommitmentPath: expect.stringMatching(
        /^artifacts\/research\/theory-runtime-pre-spawn-snapshots\//,
      ),
      beforeCommitmentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      beforeSnapshotSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      afterSnapshotSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(result.receiptV1.claimBoundary.promotionAllowed).toBe(false);
    expect(isTheoryRuntimeReceiptV1(result.receiptV1)).toBe(true);
    expect(result.receiptArtifact).toMatchObject({
      artifactId: "theory_runtime_persisted_receipt",
      schemaVersion: "theory_runtime_persisted_receipt/v1",
      requestId: "request:alpha",
      receiptId: result.receiptV1.receiptId,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const persistedReceiptPath = path.join(
      tempRoot,
      result.receiptArtifact!.path,
    );
    expect(result.receiptArtifact?.sha256).toBe(
      await sha256TheoryRuntimeFile(persistedReceiptPath),
    );
    expect(JSON.parse(await fs.readFile(persistedReceiptPath, "utf8"))).toEqual(
      result.receiptV1,
    );
    expect(status?.status).toBe("completed");
    expect(status?.heartbeat.stage).toBe("completed");
  });

  it("rejects long runtime execution without an allowlisted runtime", async () => {
    await createTheoryRuntimeRunRequestManifest({
      runtimeId: "warp.full_solve.campaign",
      graphId: "nhm2-theory-badge-graph",
      badgeIds: ["nhm2.closure.source_residual"],
      requestedScope: "full",
      requestId: "request:warp",
      projectRoot: tempRoot,
      generatedAt: "2026-05-29T00:00:00.000Z",
    });

    await expect(
      executeLongTheoryRuntimeRequest(
        execInput({ requestId: "request:warp" }),
        {
          resolveGitSha,
          resolveSourceTreeState,
          spawnExecutor: async () => successfulExecution,
        },
      ),
    ).rejects.toThrow(/not allowlisted/i);
  });

  it("returns timeout receipts and updates heartbeat on timeout", async () => {
    await createAlphaRequest();
    const result = await executeLongTheoryRuntimeRequest(execInput(), {
      resolveGitSha,
      resolveSourceTreeState,
      spawnExecutor: async () => ({
        ...successfulExecution,
        completedAt: "2026-05-29T00:00:10.000Z",
        durationMs: 10_000,
        exitCode: null,
        timedOut: true,
        error: "timeout",
      }),
    });
    const status = await readTheoryRuntimeRunRequestStatus({
      requestId: "request:alpha",
      projectRoot: tempRoot,
    });

    expect(result.receiptV1.status).toBe("timeout");
    expect(result.receiptV1.claimBoundary.promotionAllowed).toBe(false);
    expect(result.receiptV1.outputs.missingSignals).toContain(
      "runtime_timeout",
    );
    expect(result.receiptV1.execution).toMatchObject({
      timedOut: true,
      exitCode: null,
      stdout: "ok",
    });
    expect(result.receiptV1.outputs.artifactManifest).toBeDefined();
    expect(result.receiptArtifact?.receiptId).toBe(result.receiptV1.receiptId);
    expect(status?.status).toBe("timeout");
    expect(status?.heartbeat.stage).toBe("timeout");
  });

  it("fails closed when process succeeds but expected outputs are missing", async () => {
    await createAlphaRequest();
    const result = await executeLongTheoryRuntimeRequest(execInput(), {
      resolveGitSha,
      resolveSourceTreeState,
      spawnExecutor: async () => successfulExecution,
    });

    expect(result.receiptV1.status).toBe("not_run");
    expect(result.receiptV1.outputs.artifacts).toHaveLength(0);
    expect(result.receiptV1.outputs.missingSignals).toContain(
      "source_closure_missing",
    );
    expect(result.receiptV1.claimBoundary.promotionAllowed).toBe(false);
    const status = await readTheoryRuntimeRunRequestStatus({
      requestId: "request:alpha",
      projectRoot: tempRoot,
    });
    expect(status?.status).toBe("completed");
    expect(status?.heartbeat.message).toBe(
      "Process completed; evidence receipt not_run.",
    );
  });

  it("does not complete from a preexisting pass-like output package", async () => {
    await createAlphaRequest();
    await writeFixture(
      "artifacts/research/full-solve/selected-family/nhm2-shift-lapse/alpha-sweep/run.json",
      JSON.stringify({
        gates: {
          source_closure: "pass",
          certificate_integrity: "pass",
          observer_audit: "pass",
        },
      }),
    );

    const result = await executeLongTheoryRuntimeRequest(execInput(), {
      resolveGitSha,
      resolveSourceTreeState,
      spawnExecutor: async () => successfulExecution,
    });
    const status = await readTheoryRuntimeRunRequestStatus({
      requestId: "request:alpha",
      projectRoot: tempRoot,
    });

    expect(result.receiptV1.status).toBe("blocked");
    expect(result.receiptV1.outputs.gates.source_closure).toBe("pass");
    expect(result.receiptV1.outputs.gates.runtime_artifact_freshness).toBe(
      "not_ready",
    );
    expect(result.receiptV1.outputs.missingSignals).toContain(
      "runtime_artifact_freshness_preexisting_only",
    );
    expect(
      result.receiptV1.outputs.artifactManifest?.entries[0]?.freshness,
    ).toBe("preexisting");
    expect(status?.status).toBe("completed");
    expect(status?.heartbeat.message).toBe(
      "Process completed; evidence receipt blocked.",
    );
  });

  it("classifies content rewritten by the execution as changed", async () => {
    await createAlphaRequest();
    const runPath =
      "artifacts/research/full-solve/selected-family/nhm2-shift-lapse/alpha-sweep/run.json";
    await writeFixture(runPath, JSON.stringify({ status: "old" }));

    const result = await executeLongTheoryRuntimeRequest(execInput(), {
      resolveGitSha,
      resolveSourceTreeState,
      spawnExecutor: async () => {
        await writeFixture(
          runPath,
          JSON.stringify({
            gates: {
              source_closure: "pass",
              certificate_integrity: "pass",
              observer_audit: "pass",
            },
          }),
        );
        return successfulExecution;
      },
    });

    expect(result.receiptV1.status).toBe("completed");
    expect(
      result.receiptV1.outputs.artifactManifest?.entries[0]?.freshness,
    ).toBe("changed");
    expect(
      result.receiptV1.outputs.artifactManifest?.freshnessProof?.beforeEntries,
    ).toEqual([expect.objectContaining({ path: runPath })]);
  });

  it("preserves failed-process output hashes and execution diagnostics without parsing them", async () => {
    await createAlphaRequest();
    const failedExecution: TheoryRuntimeExecutionResult = {
      ...successfulExecution,
      exitCode: 2,
      stdout: "partial stdout",
      stderr: "solver failed",
      error: "Runtime command exited with code 2.",
    };
    const result = await executeLongTheoryRuntimeRequest(execInput(), {
      resolveGitSha,
      resolveSourceTreeState,
      spawnExecutor: async () => {
        await writeFixture(
          "artifacts/research/full-solve/selected-family/nhm2-shift-lapse/alpha-sweep/partial.json",
          "{not valid json",
        );
        return failedExecution;
      },
    });
    const status = await readTheoryRuntimeRunRequestStatus({
      requestId: "request:alpha",
      projectRoot: tempRoot,
    });

    expect(result.receiptV1.status).toBe("failed");
    expect(result.receiptV1.outputs.missingSignals).toContain(
      "runtime_execution_failed",
    );
    expect(result.receiptV1.outputs.artifactManifest?.entries[0]).toMatchObject(
      {
        freshness: "new",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    );
    expect(result.receiptV1.execution).toMatchObject({
      exitCode: 2,
      stdout: "partial stdout",
      stderr: "solver failed",
    });
    expect(status?.status).toBe("failed");
  });

  it("rejects output directories outside the project root", async () => {
    await createAlphaRequest();

    await expect(
      executeLongTheoryRuntimeRequest(
        execInput({ outputDirectory: "../outside" }),
        {
          resolveGitSha,
          resolveSourceTreeState,
          spawnExecutor: async () => successfulExecution,
        },
      ),
    ).rejects.toThrow(/inside the project root/i);
  });

  it("rejects an output-directory symlink that escapes the project root", async () => {
    await createAlphaRequest();
    const outside = await fs.mkdtemp(
      path.join(os.tmpdir(), "long-runtime-outside-"),
    );
    const outputDirectory = path.join(tempRoot, "artifacts", "linked-output");
    await fs.mkdir(path.dirname(outputDirectory), { recursive: true });
    try {
      await fs.symlink(
        outside,
        outputDirectory,
        process.platform === "win32" ? "junction" : "dir",
      );
      await expect(
        executeLongTheoryRuntimeRequest(
          execInput({ outputDirectory: "artifacts/linked-output" }),
          {
            resolveGitSha,
            resolveSourceTreeState,
            spawnExecutor: async () => successfulExecution,
          },
        ),
      ).rejects.toThrow(/symbolic link|real project root/i);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});
