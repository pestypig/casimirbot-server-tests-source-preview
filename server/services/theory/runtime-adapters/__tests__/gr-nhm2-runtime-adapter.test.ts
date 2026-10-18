import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isTheoryRuntimeMathTraceV1 } from "../../../../../shared/contracts/theory-runtime-math-trace.v1";
import { isTheoryRuntimeReceiptV1 } from "../../../../../shared/contracts/theory-runtime-receipt.v1";
import {
  NHM2_ALPHA07_EXPECTED_PACKAGE_ARTIFACTS,
  NHM2_ALPHA07_IMPORT_MANIFEST_PATH,
  NHM2_ALPHA07_SOURCE_COMMIT,
} from "../../../../../shared/theory/nhm2-alpha07-historical-import-governance";
import {
  GR_NHM2_ARTIFACT_ROOTS,
  grNhm2RuntimeAdapter,
  readGrNhm2RuntimeArtifacts,
} from "../gr-nhm2-runtime-adapter";

async function withTempRoot<T>(
  fn: (tempRoot: string) => Promise<T>,
): Promise<T> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gr-nhm2-adapter-"));
  try {
    return await fn(tempRoot);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function writeArtifact(
  tempRoot: string,
  name: string,
  content: unknown,
  rootIndex = 0,
): Promise<void> {
  const root = path.join(tempRoot, GR_NHM2_ARTIFACT_ROOTS[rootIndex]);
  await fs.mkdir(root, { recursive: true });
  const raw =
    typeof content === "string" ? content : JSON.stringify(content, null, 2);
  await fs.writeFile(path.join(root, name), raw, "utf8");
}

function completeGateArtifact(overrides: Record<string, unknown> = {}) {
  return {
    gateStatus: {
      sourceClosure: "pass",
      qeiApplicability: "pass",
      observerAudit: "pass",
      hardConstraints: "pass",
      certificateIssued: "pass",
      certificateIntegrity: "pass",
    },
    g4Diagnostics: {
      curvatureRatio: 0.2,
      marginRatio: 1.4,
      qeiMargin: 0.05,
      tauSelected: 0.1,
      betaOverAlphaMax: 0.8,
      wallHorizonMargin: 0.3,
      wallT00RelLInf: 14.95,
      weylScalar: 0.03,
      ricciInvariant: 0.02,
    },
    sourceClosure: {
      sourceClosureResidualRms: 0.001,
      sourceClosureResidualMax: 0.004,
    },
    alphaSweepRows: [
      {
        properTimeS: 12,
        savedDays: 2,
      },
    ],
    ...overrides,
  };
}

describe("GR/NHM2 runtime adapter", () => {
  it("returns a not_run receipt when no artifact exists", async () => {
    await withTempRoot(async (tempRoot) => {
      const receipt = await readGrNhm2RuntimeArtifacts({
        projectRoot: tempRoot,
        graphId: "nhm2-theory-badge-graph",
      });

      expect(isTheoryRuntimeReceiptV1(receipt)).toBe(true);
      expect(receipt.status).toBe("not_run");
      expect(receipt.outputs.artifacts).toEqual([]);
      expect(receipt.outputs.gates.runtime_artifact_freshness).toBe(
        "not_ready",
      );
      expect(receipt.claimBoundary.promotionAllowed).toBe(false);
    });
  });

  it("returns a failed receipt for invalid JSON", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeArtifact(tempRoot, "bad.json", "{ not json");

      const receipt = await readGrNhm2RuntimeArtifacts({
        projectRoot: tempRoot,
      });

      expect(isTheoryRuntimeReceiptV1(receipt)).toBe(true);
      expect(receipt.status).toBe("failed");
      expect(receipt.outputs.missingSignals).toContain("artifact_parse_failed");
      expect(receipt.claimBoundary.promotionAllowed).toBe(false);
    });
  });

  it("blocks when certificate evidence is missing", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeArtifact(tempRoot, "missing-certificate.json", {
        gateStatus: {
          sourceClosure: "pass",
          qeiApplicability: "pass",
          observerAudit: "pass",
          hardConstraints: "pass",
        },
      });

      const receipt = await readGrNhm2RuntimeArtifacts({
        projectRoot: tempRoot,
      });

      expect(receipt.status).toBe("blocked");
      expect(receipt.outputs.missingSignals).toEqual(
        expect.arrayContaining([
          "certificate_issued_missing",
          "certificate_integrity_missing",
        ]),
      );
      expect(receipt.claimBoundary.promotionAllowed).toBe(false);
    });
  });

  it("keeps explicit failing gates in a completed receipt without promotion", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeArtifact(
        tempRoot,
        "gate-fail.json",
        completeGateArtifact({
          gateStatus: {
            sourceClosure: "pass",
            qeiApplicability: "pass",
            observerAudit: "pass",
            hardConstraints: "fail",
            certificateIssued: "pass",
            certificateIntegrity: "pass",
          },
        }),
      );

      const receipt = await readGrNhm2RuntimeArtifacts({
        projectRoot: tempRoot,
      });

      expect(receipt.status).toBe("blocked");
      expect(receipt.outputs.gates.hard_constraints).toBe("fail");
      expect(receipt.outputs.missingSignals).toContain(
        "runtime_artifact_freshness_unbound",
      );
      expect(receipt.claimBoundary.promotionAllowed).toBe(false);
      expect(receipt.claimBoundary.promotionBlockedBy).toContain(
        "hard_constraints_failed",
      );
    });
  });

  it("blocks promotion when source closure is missing", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeArtifact(tempRoot, "missing-source-closure.json", {
        gateStatus: {
          qeiApplicability: "pass",
          observerAudit: "pass",
          hardConstraints: "pass",
          certificateIssued: "pass",
          certificateIntegrity: "pass",
        },
      });

      const receipt = await readGrNhm2RuntimeArtifacts({
        projectRoot: tempRoot,
      });

      expect(receipt.status).toBe("blocked");
      expect(receipt.claimBoundary.promotionBlockedBy).toContain(
        "source_closure",
      );
      expect(receipt.claimBoundary.promotionAllowed).toBe(false);
    });
  });

  it("extracts scalar fields from readable artifacts", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeArtifact(tempRoot, "complete.json", completeGateArtifact());

      const receipt = await grNhm2RuntimeAdapter.readArtifacts?.({
        projectRoot: tempRoot,
        graphId: "nhm2-theory-badge-graph",
      });

      expect(receipt?.status).toBe("blocked");
      expect(receipt?.outputs.scalars.curvatureRatio).toBe(0.2);
      expect(receipt?.outputs.scalars.wallT00RelLInf).toBe(14.95);
      expect(receipt?.outputs.scalars.weylScalar).toBe(0.03);
      expect(receipt?.outputs.scalars.sourceClosureResidualRms).toBe(0.001);
      expect(receipt?.outputs.scalars.properTimeS).toBe(12);
    });
  });

  it("advertises wall, tensor authority, and Natario badges", () => {
    expect(grNhm2RuntimeAdapter.supportedBadgeIds).toEqual(
      expect.arrayContaining([
        "nhm2.source.wall_t00_trace",
        "nhm2.tensor.full_authority_gate",
        "nhm2.tensor.same_chart_full_tensor",
        "nhm2.natario.curvature_invariants",
        "nhm2.natario.invariant_audit",
        "nhm2.energy_condition.observer_robust_gate",
        "nhm2.formal.lean_certificate",
        "nhm2.formal.certificate_hashes_pinned",
        "nhm2.formal.diagnostic_campaign_admissible",
        "nhm2.formal.claim_locks_closed",
        "nhm2.formal.negative_fixtures_fail_closed",
        "nhm2.mechanical.support_retention_overlap",
        "nhm2.meta.experiment_ready_theory_closure",
      ]),
    );
  });

  it("fails the theory-closure lamp closed when no validated closure artifact exists", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeArtifact(
        tempRoot,
        "presence-spoof.json",
        completeGateArtifact({
          nhm2ExperimentReadyTheoryClosure: {
            status: "experiment_ready_theory_closed",
            pass: true,
          },
        }),
      );

      const receipt = await readGrNhm2RuntimeArtifacts({
        projectRoot: tempRoot,
        badgeIds: ["nhm2.meta.experiment_ready_theory_closure"],
      });

      expect(receipt.outputs.gates.experiment_ready_theory_closure).toBe(
        "not_ready",
      );
      expect(receipt.outputs.missingSignals).toContain(
        "experiment_ready_theory_closure_missing",
      );
      expect(receipt.claimBoundary.promotionAllowed).toBe(false);
    });
  });

  it("does not light the closure lamp from a schema-looking artifact without filesystem verification", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeArtifact(
        tempRoot,
        "synthetic-closure.json",
        {
          contractVersion: "nhm2_experiment_ready_theory_closure/v1",
          status: "experiment_ready_theory_closed",
          verdictLabel: "THEORY_CLOSED_EXPERIMENT_READY_CANDIDATE",
        },
        2,
      );

      const receipt = await readGrNhm2RuntimeArtifacts({
        projectRoot: tempRoot,
        badgeIds: ["nhm2.meta.experiment_ready_theory_closure"],
      });

      expect(receipt.outputs.gates.experiment_ready_theory_closure).toBe(
        "not_ready",
      );
      expect(receipt.outputs.missingSignals).toEqual(
        expect.arrayContaining([
          "experiment_ready_theory_closure_filesystem_unverified",
          "experiment_ready_theory_closure:theory_closure_artifact_schema_invalid",
        ]),
      );
    });
  });

  it("reads the governed 0p7000 certificate root for formal badge requests", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeArtifact(
        tempRoot,
        "nhm2-lean-campaign-certificate.json",
        {
          contractVersion: "nhm2_lean_campaign_certificate/v1",
          certificate: { diagnosticCampaignAdmissible: true },
          certificateIntegrity: "pass",
          claimLocks: {
            physicalViabilityClaimAllowed: false,
            transportClaimAllowed: false,
            routeEtaClaimAllowed: false,
            propulsionClaimAllowed: false,
            certifiedWarpSpeedClaimAllowed: false,
          },
        },
        1,
      );

      const receipt = await readGrNhm2RuntimeArtifacts({
        projectRoot: tempRoot,
      });

      expect(GR_NHM2_ARTIFACT_ROOTS[1]).toContain("profile-campaign-runs");
      expect(receipt.badgeIds).toEqual(
        expect.arrayContaining([
          "nhm2.formal.lean_certificate",
          "nhm2.formal.certificate_hashes_pinned",
          "nhm2.formal.diagnostic_campaign_admissible",
          "nhm2.formal.claim_locks_closed",
          "nhm2.formal.negative_fixtures_fail_closed",
        ]),
      );
      expect(receipt.outputs.artifacts).toContain(
        `${GR_NHM2_ARTIFACT_ROOTS[1]}/nhm2-lean-campaign-certificate.json`,
      );
      expect(receipt.outputs.gates.certificate_issued).toBe("pass");
      expect(receipt.outputs.gates.certificate_integrity).toBe("pass");
      expect(receipt.outputs.gates.runtime_artifact_freshness).toBe(
        "not_ready",
      );
      expect(receipt.claimBoundary).toMatchObject({
        maximumTier: "reduced_order",
        promotionAllowed: false,
      });
      expect(
        grNhm2RuntimeAdapter.canHandle({
          badgeIds: ["nhm2.formal.lean_certificate"],
        }),
      ).toBe(true);
    });
  });

  it("validates the real governed alpha=0.7 manifest in the production formal-badge read path", async () => {
    const receipt = await readGrNhm2RuntimeArtifacts({
      projectRoot: process.cwd(),
      badgeIds: [
        "nhm2.formal.lean_certificate",
        "nhm2.formal.certificate_hashes_pinned",
        "nhm2.formal.diagnostic_campaign_admissible",
        "nhm2.formal.claim_locks_closed",
      ],
      generatedAt: "2026-07-19T12:00:00.000Z",
    });

    expect(isTheoryRuntimeReceiptV1(receipt)).toBe(true);
    expect(receipt.status).toBe("blocked");
    expect(receipt.outputs.artifactManifest).toMatchObject({
      manifestPath: NHM2_ALPHA07_IMPORT_MANIFEST_PATH,
      gitSha: NHM2_ALPHA07_SOURCE_COMMIT,
      boundToExecution: false,
      requestId: null,
      startedAt: null,
      completedAt: null,
    });
    expect(receipt.outputs.artifactManifest?.entries).toHaveLength(
      NHM2_ALPHA07_EXPECTED_PACKAGE_ARTIFACTS.length,
    );
    expect(
      receipt.outputs.artifactManifest?.entries.every(
        (entry) =>
          entry.freshness === "preexisting" &&
          /^[a-f0-9]{64}$/.test(entry.sha256),
      ),
    ).toBe(true);
    expect(receipt.outputs.artifactEvidence).toHaveLength(
      NHM2_ALPHA07_EXPECTED_PACKAGE_ARTIFACTS.length,
    );
    expect(
      receipt.outputs.artifactEvidence?.every(
        (entry) =>
          entry.freshness === "preexisting" &&
          /^[a-f0-9]{64}$/.test(entry.sha256),
      ),
    ).toBe(true);
    expect(receipt.outputs.gates).toMatchObject({
      source_closure_aggregate: "pass",
      source_closure_artifact: "pass",
      certificate_issued: "pass",
      certificate_integrity: "pass",
      formal_certificate_hashes_pinned: "pass",
      formal_claim_locks_closed: "pass",
      runtime_execution_provenance: "not_ready",
      runtime_artifact_freshness: "not_ready",
    });
    expect(receipt.outputs.missingSignals).toEqual(
      expect.arrayContaining([
        "runtime_execution_provenance_unbound",
        "runtime_artifact_freshness_unbound",
      ]),
    );
    expect(receipt.provenance).toEqual({
      gitSha: NHM2_ALPHA07_SOURCE_COMMIT,
      startedAt: null,
      completedAt: null,
      durationMs: null,
    });
    expect(receipt.claimBoundary).toMatchObject({
      maximumTier: "reduced_order",
      promotionAllowed: false,
    });
  });

  it("does not infer required gate passes from artifact names or descriptive text", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeArtifact(
        tempRoot,
        "source-closure-certificate-observer-audit.json",
        {
          description:
            "source closure certificate observer audit evidence package",
        },
        1,
      );

      const receipt = await readGrNhm2RuntimeArtifacts({
        projectRoot: tempRoot,
      });

      expect(receipt.outputs.gates.source_closure).not.toBe("pass");
      expect(receipt.outputs.gates.certificate_issued).not.toBe("pass");
      expect(receipt.outputs.gates.certificate_integrity).not.toBe("pass");
      expect(receipt.outputs.gates.observer_audit).not.toBe("pass");
      expect(receipt.outputs.missingSignals).toEqual(
        expect.arrayContaining([
          "source_closure_missing",
          "certificate_issued_missing",
          "certificate_integrity_missing",
          "observer_audit_missing",
        ]),
      );
    });
  });

  it("preserves an explicit failure when another artifact reports a pass", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeArtifact(tempRoot, "hard-fail.json", {
        gateStatus: { hardConstraints: "fail" },
      });
      await writeArtifact(
        tempRoot,
        "hard-pass.json",
        {
          gateStatus: { hardConstraints: "pass" },
        },
        1,
      );

      const receipt = await readGrNhm2RuntimeArtifacts({
        projectRoot: tempRoot,
      });

      expect(receipt.outputs.gates.hard_constraints).toBe("fail");
      expect(receipt.claimBoundary.promotionAllowed).toBe(false);
    });
  });

  it("preserves artifact review when an aggregate artifact reports pass", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeArtifact(tempRoot, "aggregate-pass.json", {
        gateStatus: {
          sourceClosure: "pass",
          observerAudit: "pass",
        },
      });
      await writeArtifact(
        tempRoot,
        "artifact-review.json",
        {
          sections: {
            source_closure: {
              artifactRefs: [{ status: "audit_review" }],
            },
            observer_audit: {
              artifactRefs: [{ status: "review" }],
            },
          },
        },
        1,
      );

      const receipt = await readGrNhm2RuntimeArtifacts({
        projectRoot: tempRoot,
      });

      expect(receipt.outputs.gates.source_closure).toBe("review");
      expect(receipt.outputs.gates.observer_audit).toBe("review");
      expect(receipt.outputs.gates.source_closure_aggregate).toBe("pass");
      expect(receipt.outputs.gates.source_closure_artifact).toBe("review");
      expect(receipt.outputs.gates.observer_audit_aggregate).toBe("pass");
      expect(receipt.outputs.gates.observer_audit_artifact).toBe("review");
      expect(receipt.outputs.missingSignals).toEqual(
        expect.arrayContaining([
          "source_closure_review",
          "observer_audit_review",
        ]),
      );
      expect(receipt.claimBoundary.promotionBlockedBy).toEqual(
        expect.arrayContaining(["source_closure", "observer_audit"]),
      );
      expect(receipt.claimBoundary.promotionAllowed).toBe(false);
    });
  });

  it("preserves explicit unknown when another artifact reports pass", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeArtifact(tempRoot, "qei-pass.json", {
        gateStatus: { qeiApplicability: "pass" },
      });
      await writeArtifact(
        tempRoot,
        "qei-unknown.json",
        {
          gateStatus: { qeiApplicability: "unknown" },
        },
        1,
      );

      const receipt = await readGrNhm2RuntimeArtifacts({
        projectRoot: tempRoot,
      });

      expect(receipt.outputs.gates.qei_applicability).toBe("unknown");
      expect(receipt.outputs.missingSignals).toContain(
        "qei_applicability_missing",
      );
      expect(receipt.claimBoundary.promotionAllowed).toBe(false);
    });
  });

  it("keeps the static GR reference trace available", () => {
    const trace = grNhm2RuntimeAdapter.buildReferenceTrace?.({
      graphId: "nhm2-theory-badge-graph",
      badgeIds: ["physics.gr.einstein_field_equation"],
    });

    expect(trace).toBeDefined();
    expect(isTheoryRuntimeMathTraceV1(trace)).toBe(true);
    expect(JSON.stringify(trace)).toContain(
      "Static reference trace only; no backend runtime executed.",
    );
  });
});
