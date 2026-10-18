import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isTheoryRuntimeReceiptV1,
  type TheoryRuntimeExecutionV1,
  type TheoryRuntimeOutputManifestV1,
} from "../../../../shared/contracts/theory-runtime-receipt.v1";
import { buildNhm2TheoryBadgeGraphV1 } from "../../../../shared/theory/nhm2-theory-badges";
import { buildTheoryCompoundRun } from "../../../../shared/theory/theory-compound-run-builder";
import {
  attachWarpNhm2ArtifactReceiptsToCompoundRun,
  readWarpNhm2RuntimeArtifacts,
} from "../warp-nhm2-artifact-adapters";
import {
  classifyTheoryRuntimeArtifacts,
  snapshotTheoryRuntimeOutput,
  writeTheoryRuntimeOutputManifest,
} from "../runtime-artifact-manifest";

let tempRoot: string;
const GIT_SHA = "1234567890abcdef1234567890abcdef12345678";
const FORBIDDEN_CLAIM_PATTERNS = [
  /validated propulsion/i,
  /working warp drive/i,
  /certified transport solution/i,
  /closed-loop solved transport result/i,
  /physical mechanism confirmed/i,
  /\bQEI passed\b/i,
];

function expectNoForbiddenClaimText(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const pattern of FORBIDDEN_CLAIM_PATTERNS) {
    expect(serialized).not.toMatch(pattern);
  }
}

async function writeFixture(relativePath: string, contents: string): Promise<void> {
  const absolutePath = path.join(tempRoot, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, contents, "utf8");
}

async function buildBoundRun(input: {
  runtimeId?: "warp.full_solve.campaign" | "nhm2.shift_lapse.alpha_sweep";
  outputDirectory?: string;
} = {}): Promise<{
  artifactManifest: TheoryRuntimeOutputManifestV1;
  requestId: string;
  command: string;
  outputDirectory: string;
  provenance: {
    gitSha: string;
    startedAt: string;
    completedAt: string;
    durationMs: number;
  };
  execution: TheoryRuntimeExecutionV1;
}> {
  const runtimeId = input.runtimeId ?? "nhm2.shift_lapse.alpha_sweep";
  const outputDirectory = input.outputDirectory ?? "artifacts/run-bound";
  const absoluteOutputDirectory = path.join(tempRoot, outputDirectory);
  const after = await snapshotTheoryRuntimeOutput({
    projectRoot: tempRoot,
    outputDirectory: absoluteOutputDirectory,
  });
  const startedAt = "2026-07-19T00:00:00.000Z";
  const completedAt = "2026-07-19T00:00:01.000Z";
  const artifactManifest = await writeTheoryRuntimeOutputManifest({
    projectRoot: tempRoot,
    outputDirectory: absoluteOutputDirectory,
    requestId: "request:bound",
    runtimeId,
    gitSha: GIT_SHA,
    startedAt,
    completedAt,
    generatedAt: completedAt,
    entries: classifyTheoryRuntimeArtifacts({ before: new Map(), after }),
  });
  return {
    artifactManifest,
    requestId: "request:bound",
    command: "npm run warp:full-solve:nhm2-shift-lapse:alpha-sweep",
    outputDirectory,
    provenance: { gitSha: GIT_SHA, startedAt, completedAt, durationMs: 1000 },
    execution: {
      command: process.platform === "win32" ? "npm.cmd" : "npm",
      args: ["run", "-s", "warp:full-solve:nhm2-shift-lapse:alpha-sweep"],
      cwd: tempRoot,
      environment: { NHM2_OUTPUT_DIR: outputDirectory },
      outputDirectory,
      outputDirectoryBound: true,
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      timedOut: false,
      error: null,
    },
  };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "warp-nhm2-artifacts-"));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("read-only Warp/NHM2 artifact adapters", () => {
  it("keeps pass-like read-only artifacts blocked when execution provenance is unbound", async () => {
    await writeFixture("artifacts/research/full-solve/run.json", JSON.stringify({
      gates: {
        source_closure: "pass",
        certificate_integrity: "pass",
        observer_audit: "pass",
      },
      sourceClosureResidual: 0.0001,
      certificate: {
        integrity: "pass",
      },
      observerAudit: {
        status: "pass",
      },
    }));

    const receipt = await readWarpNhm2RuntimeArtifacts({
      runtimeId: "warp.full_solve.campaign",
      graphId: "nhm2-theory-badge-graph",
      badgeIds: ["nhm2.closure.source_residual"],
      projectRoot: tempRoot,
      generatedAt: "2026-05-29T00:00:00.000Z",
    });

    expect(receipt.status).toBe("blocked");
    expect(receipt.outputs.artifacts).toContain("artifacts/research/full-solve/run.json");
    expect(receipt.outputs.gates.source_closure).toBe("pass");
    expect(receipt.outputs.gates.certificate_integrity).toBe("pass");
    expect(receipt.outputs.gates.observer_audit).toBe("pass");
    expect(receipt.outputs.gates.runtime_execution_provenance).toBe("not_ready");
    expect(receipt.outputs.missingSignals).toContain("runtime_artifact_freshness_unbound");
    expect(receipt.outputs.artifactManifest?.entries[0]?.freshness).toBe("preexisting");
    expect(receipt.outputs.scalars.sourceClosureResidual).toBe(0.0001);
    expect(receipt.claimBoundary.promotionAllowed).toBe(false);
    expect(isTheoryRuntimeReceiptV1(receipt)).toBe(true);
    expectNoForbiddenClaimText(receipt);
  });

  it("does not allow receipt promotion even when required evidence-like fields are present", async () => {
    await writeFixture("artifacts/research/full-solve/run.json", JSON.stringify({
      gates: {
        source_closure: "pass",
        certificate_integrity: "pass",
        observer_audit: "pass",
        qei_worldline: "pass",
      },
      sourceClosureResidual: 0,
      qeiMargin: 0.5,
      certificate: { integrity: "pass" },
      observerAudit: { status: "pass" },
    }));

    const receipt = await readWarpNhm2RuntimeArtifacts({
      runtimeId: "warp.full_solve.campaign",
      graphId: "nhm2-theory-badge-graph",
      badgeIds: ["nhm2.qei.sampling_window"],
      projectRoot: tempRoot,
      generatedAt: "2026-05-29T00:00:00.000Z",
    });

    expect(receipt.status).toBe("blocked");
    expect(receipt.outputs.scalars.qeiMargin).toBe(0.5);
    expect(receipt.claimBoundary.promotionAllowed).toBe(false);
    expect(receipt.claimBoundary.promotionBlockedBy.length).toBeGreaterThan(0);
    expectNoForbiddenClaimText(receipt);
  });

  it("completes only a run-bound package with fresh explicit required-gate verdicts", async () => {
    await writeFixture("artifacts/run-bound/aggregate.json", JSON.stringify({
      gates: {
        source_closure: "pass",
        certificate_integrity: "pass",
        observer_audit: "pass",
      },
    }));
    const bound = await buildBoundRun();

    const receipt = await readWarpNhm2RuntimeArtifacts({
      runtimeId: "nhm2.shift_lapse.alpha_sweep",
      graphId: "nhm2-theory-badge-graph",
      badgeIds: ["nhm2.qei.sampling_window"],
      projectRoot: tempRoot,
      generatedAt: "2026-07-19T00:00:01.000Z",
      command: "npm run warp:full-solve:nhm2-shift-lapse:alpha-sweep",
      ...bound,
    });

    expect(receipt.status, JSON.stringify({
      gates: receipt.outputs.gates,
      missingSignals: receipt.outputs.missingSignals,
      warnings: receipt.outputs.warnings,
    }, null, 2)).toBe("completed");
    expect(receipt.outputs.gates).toMatchObject({
      source_closure: "pass",
      certificate_integrity: "pass",
      observer_audit: "pass",
      runtime_execution_provenance: "pass",
      runtime_artifact_freshness: "pass",
    });
    expect(receipt.outputs.artifactEvidence?.[0]).toMatchObject({
      path: "artifacts/run-bound/aggregate.json",
      freshness: "new",
      status: "pass",
    });
    expect(isTheoryRuntimeReceiptV1(receipt)).toBe(true);
    expect(receipt.claimBoundary.promotionAllowed).toBe(false);
  });

  it("rejects a bound output directory replaced by an escaping symlink", async () => {
    await writeFixture("artifacts/run-bound/aggregate.json", JSON.stringify({
      gates: {
        source_closure: "pass",
        certificate_integrity: "pass",
        observer_audit: "pass",
      },
    }));
    const bound = await buildBoundRun();
    const originalOutputDirectory = path.join(tempRoot, bound.outputDirectory);
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "warp-nhm2-bound-outside-"));
    try {
      await fs.cp(originalOutputDirectory, outside, { recursive: true });
      await fs.rm(originalOutputDirectory, { recursive: true, force: true });
      await fs.symlink(outside, originalOutputDirectory, process.platform === "win32" ? "junction" : "dir");

      const receipt = await readWarpNhm2RuntimeArtifacts({
        runtimeId: "nhm2.shift_lapse.alpha_sweep",
        graphId: "nhm2-theory-badge-graph",
        badgeIds: ["nhm2.qei.sampling_window"],
        projectRoot: tempRoot,
        ...bound,
      });

      expect(receipt.status).toBe("failed");
      expect(receipt.outputs.missingSignals).toContain("artifact_parse_failed");
      expect(receipt.outputs.warnings.join(" ")).toMatch(/output directory must not be a symbolic link/i);
      expect(receipt.claimBoundary.promotionAllowed).toBe(false);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("preserves an aggregate source-closure pass separately from a referenced artifact review", async () => {
    await writeFixture("artifacts/run-bound/aggregate.json", JSON.stringify({
      gates: {
        source_closure: "pass",
        certificate_integrity: "pass",
        observer_audit: "pass",
      },
    }));
    await writeFixture("artifacts/run-bound/source-closure-evidence.json", JSON.stringify({
      artifactId: "nhm2_regional_source_closure_evidence",
      schemaVersion: "nhm2_regional_source_closure_evidence/v1",
      status: "review",
    }));
    const bound = await buildBoundRun();

    const receipt = await readWarpNhm2RuntimeArtifacts({
      runtimeId: "nhm2.shift_lapse.alpha_sweep",
      graphId: "nhm2-theory-badge-graph",
      badgeIds: ["nhm2.closure.source_residual"],
      projectRoot: tempRoot,
      ...bound,
    });

    expect(receipt.outputs.gates.source_closure).toBe("pass");
    expect(receipt.outputs.artifactEvidence?.find((entry) => entry.path.endsWith("source-closure-evidence.json")))
      .toMatchObject({ status: "review", freshness: "new" });
    expect(receipt.outputs.missingSignals).toContain("source_closure_artifact_review");
    expect(receipt.status).toBe("blocked");
    expect(receipt.claimBoundary.promotionAllowed).toBe(false);
  });

  it("keeps an aggregate pass blocked when a source-closure artifact explicitly fails", async () => {
    await writeFixture("artifacts/run-bound/aggregate.json", JSON.stringify({
      gates: {
        source_closure: "pass",
        certificate_integrity: "pass",
        observer_audit: "pass",
      },
    }));
    await writeFixture("artifacts/run-bound/source-closure-evidence.json", JSON.stringify({
      artifactId: "nhm2_regional_source_closure_evidence",
      status: "fail",
    }));
    const bound = await buildBoundRun();

    const receipt = await readWarpNhm2RuntimeArtifacts({
      runtimeId: "nhm2.shift_lapse.alpha_sweep",
      graphId: "nhm2-theory-badge-graph",
      badgeIds: ["nhm2.closure.source_residual"],
      projectRoot: tempRoot,
      ...bound,
    });

    expect(receipt.outputs.gates.source_closure).toBe("pass");
    expect(receipt.outputs.missingSignals).toContain("source_closure_artifact_fail");
    expect(receipt.status).toBe("blocked");
  });

  it("never turns names, paths, or descriptive text into gate passes", async () => {
    await writeFixture("artifacts/research/full-solve/presence-only.json", JSON.stringify({
      sourceClosureArtifact: "source-closure.json",
      certificateRef: "certificate-integrity.json",
      note: "observer audit will be produced later",
    }));

    const receipt = await readWarpNhm2RuntimeArtifacts({
      runtimeId: "warp.full_solve.campaign",
      graphId: "nhm2-theory-badge-graph",
      badgeIds: ["nhm2.closure.source_residual"],
      projectRoot: tempRoot,
    });

    expect(receipt.outputs.gates).toMatchObject({
      source_closure: "not_ready",
      certificate_integrity: "not_ready",
      observer_audit: "not_ready",
      runtime_gate_semantics: "not_ready",
    });
    expect(receipt.outputs.missingSignals).toContain("runtime_gate_semantics_presence_only");
    expect(receipt.status).toBe("blocked");
  });

  it("does not let signal artifact identities relabel unrelated explicit gate passes", async () => {
    await writeFixture("artifacts/run-bound/source-closure-evidence.json", JSON.stringify({
      artifactId: "nhm2_regional_source_closure_evidence",
      schemaVersion: "nhm2_regional_source_closure_evidence/v1",
      gates: { unrelated_check: "pass" },
    }));
    await writeFixture("artifacts/run-bound/certificate-integrity-evidence.json", JSON.stringify({
      artifactId: "nhm2_certificate_integrity_evidence",
      schemaVersion: "nhm2_certificate_integrity_evidence/v1",
      gates: { unrelated_check: "pass", data_integrity_status: "pass" },
    }));
    await writeFixture("artifacts/run-bound/observer-audit-evidence.json", JSON.stringify({
      artifactId: "nhm2_observer_audit_evidence",
      schemaVersion: "nhm2_observer_audit_evidence/v1",
      gates: { unrelated_check: "pass" },
    }));
    const bound = await buildBoundRun();

    const receipt = await readWarpNhm2RuntimeArtifacts({
      runtimeId: "nhm2.shift_lapse.alpha_sweep",
      graphId: "nhm2-theory-badge-graph",
      badgeIds: ["nhm2.closure.source_residual"],
      projectRoot: tempRoot,
      ...bound,
    });

    expect(receipt.outputs.gates).toMatchObject({
      source_closure: "not_ready",
      certificate_integrity: "not_ready",
      observer_audit: "not_ready",
    });
    expect(receipt.outputs.missingSignals).toEqual(expect.arrayContaining([
      "source_closure_missing",
      "certificate_integrity_missing",
      "observer_audit_missing",
    ]));
    expect(receipt.status).toBe("blocked");
    expect(receipt.claimBoundary.promotionAllowed).toBe(false);
  });

  it("does not let a pass overwrite an explicit unknown for the same required signal", async () => {
    await writeFixture("artifacts/run-bound/certificate-pass.json", JSON.stringify({
      gates: { certificate_integrity: "pass" },
    }));
    await writeFixture("artifacts/run-bound/certificate-unknown.json", JSON.stringify({
      gates: { certificate_integrity: "unknown" },
    }));
    await writeFixture("artifacts/run-bound/other-required-gates.json", JSON.stringify({
      gates: { source_closure: "pass", observer_audit: "pass" },
    }));
    const bound = await buildBoundRun();

    const receipt = await readWarpNhm2RuntimeArtifacts({
      runtimeId: "nhm2.shift_lapse.alpha_sweep",
      graphId: "nhm2-theory-badge-graph",
      badgeIds: ["nhm2.formal.lean_certificate"],
      projectRoot: tempRoot,
      ...bound,
    });

    expect(receipt.outputs.gates.certificate_integrity).toBe("unknown");
    expect(receipt.outputs.missingSignals).toContain("certificate_integrity_not_authoritative");
    expect(receipt.status).toBe("blocked");
    expect(receipt.claimBoundary.promotionAllowed).toBe(false);
  });

  it("fails closed when certificate evidence is missing", async () => {
    await writeFixture("artifacts/research/full-solve/run.json", JSON.stringify({
      gates: {
        source_closure: "pass",
        observer_audit: "pass",
      },
      sourceClosureResidual: 0,
      observerAudit: { status: "pass" },
    }));

    const receipt = await readWarpNhm2RuntimeArtifacts({
      runtimeId: "warp.full_solve.campaign",
      graphId: "nhm2-theory-badge-graph",
      badgeIds: ["nhm2.closure.source_residual"],
      projectRoot: tempRoot,
      generatedAt: "2026-05-29T00:00:00.000Z",
    });

    expect(receipt.status).toBe("blocked");
    expect(receipt.outputs.gates.certificate_integrity).toBe("not_ready");
    expect(receipt.outputs.missingSignals).toContain("certificate_integrity_missing");
    expect(receipt.claimBoundary.promotionBlockedBy).toContain("certificate_integrity");
    expect(receipt.claimBoundary.promotionAllowed).toBe(false);
    expectNoForbiddenClaimText(receipt);
  });

  it("fails closed when source closure evidence is missing", async () => {
    await writeFixture("artifacts/research/full-solve/run.json", JSON.stringify({
      gates: {
        certificate_integrity: "pass",
        observer_audit: "pass",
      },
      certificate: { integrity: "pass" },
      observerAudit: { status: "pass" },
    }));

    const receipt = await readWarpNhm2RuntimeArtifacts({
      runtimeId: "warp.full_solve.campaign",
      graphId: "nhm2-theory-badge-graph",
      badgeIds: ["nhm2.closure.source_residual"],
      projectRoot: tempRoot,
      generatedAt: "2026-05-29T00:00:00.000Z",
    });

    expect(receipt.status).toBe("blocked");
    expect(receipt.outputs.gates.source_closure).toBe("not_ready");
    expect(receipt.outputs.missingSignals).toContain("source_closure_missing");
    expect(receipt.claimBoundary.promotionAllowed).toBe(false);
    expectNoForbiddenClaimText(receipt);
  });

  it("returns not_run when expected artifacts are missing", async () => {
    const receipt = await readWarpNhm2RuntimeArtifacts({
      runtimeId: "nhm2.shift_lapse.alpha_sweep",
      graphId: "nhm2-theory-badge-graph",
      badgeIds: ["nhm2.qei.sampling_window"],
      projectRoot: tempRoot,
      generatedAt: "2026-05-29T00:00:00.000Z",
    });

    expect(receipt.status).toBe("not_run");
    expect(receipt.outputs.artifacts).toHaveLength(0);
    expect(receipt.outputs.missingSignals).toContain("source_closure_missing");
    expect(receipt.outputs.warnings.join(" ")).toMatch(/No existing NHM2\/warp artifacts/);
  });

  it("marks stale artifacts as stale and promotion-blocked", async () => {
    await writeFixture("artifacts/research/full-solve/run.json", JSON.stringify({
      freshness: { status: "stale" },
      gates: {
        source_closure: "pass",
        certificate_integrity: "pass",
        observer_audit: "pass",
      },
      certificate: { integrity: "pass" },
      observerAudit: { status: "pass" },
      sourceClosureResidual: 0,
    }));

    const receipt = await readWarpNhm2RuntimeArtifacts({
      runtimeId: "warp.full_solve.campaign",
      graphId: "nhm2-theory-badge-graph",
      badgeIds: ["nhm2.closure.source_residual"],
      projectRoot: tempRoot,
      generatedAt: "2026-05-29T00:00:00.000Z",
    });

    expect(receipt.status).toBe("stale");
    expect(receipt.claimBoundary.promotionBlockedBy).toContain("stale_artifact");
  });

  it("returns a failed receipt for invalid JSON", async () => {
    await writeFixture("artifacts/research/full-solve/run.json", "{bad json");

    const receipt = await readWarpNhm2RuntimeArtifacts({
      runtimeId: "warp.full_solve.campaign",
      graphId: "nhm2-theory-badge-graph",
      badgeIds: ["nhm2.closure.source_residual"],
      projectRoot: tempRoot,
      generatedAt: "2026-05-29T00:00:00.000Z",
    });

    expect(receipt.status).toBe("failed");
    expect(receipt.outputs.missingSignals).toContain("artifact_parse_failed");
    expect(receipt.claimBoundary.promotionBlockedBy).toContain("artifact_parse_failed");
  });

  it("surfaces receipts in Theory Run evidence rows", async () => {
    await writeFixture("artifacts/research/full-solve/run.json", JSON.stringify({
      gates: {
        source_closure: "pass",
        certificate_integrity: "pass",
        observer_audit: "pass",
      },
      sourceClosureResidual: 0,
      certificate: { integrity: "pass" },
      observerAudit: { status: "pass" },
    }));
    const graph = buildNhm2TheoryBadgeGraphV1();
    const run = buildTheoryCompoundRun({
      graph,
      badgeIds: ["nhm2.closure.source_residual"],
      mode: "selected_badges",
      includeEvidence: true,
      generatedAt: "2026-05-29T00:00:00.000Z",
    });

    const withReceipts = await attachWarpNhm2ArtifactReceiptsToCompoundRun({
      run,
      projectRoot: tempRoot,
      generatedAt: "2026-05-29T00:00:00.000Z",
    });

    expect(withReceipts.rows.some((row) => row.kind === "evidence" && row.runtimeReceiptV1)).toBe(true);
    expect(withReceipts.rows.some((row) => row.runtimeReceiptV1?.status === "blocked")).toBe(true);
    expect(withReceipts.rows.every((row) => row.runtimeReceiptV1?.claimBoundary.promotionAllowed !== true)).toBe(true);
    expectNoForbiddenClaimText(withReceipts);
  });
});
