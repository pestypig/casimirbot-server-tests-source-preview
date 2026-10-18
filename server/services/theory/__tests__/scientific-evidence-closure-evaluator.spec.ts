import { describe, expect, it } from "vitest";

import { computeCasimirSpecValueSha256V1 } from "../../../../shared/contracts/casimir-spec-scientific-claim-ir.v1";
import { validateScientificEvidenceClosurePacketIntegrityV1 } from "../../../../shared/contracts/scientific-evidence-closure-packet.v1";
import {
  ADVECTION_DIFFUSION_BASELINE_CASE_ID,
  ADVECTION_DIFFUSION_INDEPENDENT_LINEAGE_ID,
  ADVECTION_DIFFUSION_INTERVENTION_CASE_ID,
  ADVECTION_DIFFUSION_PRIMARY_LINEAGE_ID,
  buildAdvectionDiffusionScientificEvidenceExecutionPlanV1,
  buildAdvectionDiffusionScientificEvidenceEnrollmentV1,
} from "../../../../shared/scientific-evidence/advection-diffusion-scientific-evidence-enrollment";
import {
  ADVECTION_DIFFUSION_OBSERVED_THEOREM_TYPE_SHA256,
  buildAdvectionDiffusionZeroGradientLeanBindingV1,
} from "../../../../shared/scientific-evidence/advection-diffusion-zero-gradient-lean-binding";
import {
  evaluateScientificEvidenceClosureV1,
  type EvaluateScientificEvidenceClosureV1Input,
} from "../scientific-evidence-closure-evaluator";

const hash = (character: string) => character.repeat(64);
const TURN_ID = "turn:scientific-evidence-closure";

const buildInput = async (
  sandboxed: boolean,
): Promise<EvaluateScientificEvidenceClosureV1Input> => {
  const enrollment =
    await buildAdvectionDiffusionScientificEvidenceEnrollmentV1();
  const binding =
    await buildAdvectionDiffusionZeroGradientLeanBindingV1();
  const executionPlan =
    await buildAdvectionDiffusionScientificEvidenceExecutionPlanV1({
      turnId: TURN_ID,
      planId: "plan:advection-diffusion-dxx:v1",
      interventionValue: "0.02",
      generatedAt: "2026-07-30T12:00:00.000Z",
    });
  const policySha256 = await computeCasimirSpecValueSha256V1({
    domain: "test-scientific-evidence-comparison-policy/v1",
    value: {
      maximumCrossLaneL2: 0.01,
      minimumObservedOrder: 0.8,
      maximumInterventionDeltaDiscrepancy: 0.00001,
    },
  });
  const numerical = (
    caseId: string,
    artifactSha256: string,
    primaryFundamentalAmplitude: number,
    independentFundamentalAmplitude: number,
    finestCrossLaneL2: number,
    minimumObservedOrder: number,
  ) => ({
    artifactId: "casimir_independent_numerical_verification_certificate",
    schemaVersion:
      "casimir_independent_numerical_verification_certificate/v1",
    artifactSha256,
    currentTurnId: TURN_ID,
    status: "passed" as const,
    manifestArtifactSha256: enrollment.manifest.artifactSha256,
    caseId,
    primaryLineageId: ADVECTION_DIFFUSION_PRIMARY_LINEAGE_ID,
    independentLineageId:
      ADVECTION_DIFFUSION_INDEPENDENT_LINEAGE_ID,
    independenceEstablished: true,
    replayCount: 2,
    refinementLevels: 3,
    productionSandboxEnforced: sandboxed,
    primaryFundamentalAmplitude,
    independentFundamentalAmplitude,
    finestCrossLaneL2,
    minimumObservedOrder,
  });
  return {
    generatedAt: "2026-07-30T12:00:00.000Z",
    packetId: "closure:advection-diffusion-dxx:v1",
    turnId: TURN_ID,
    planId: "plan:advection-diffusion-dxx:v1",
    executionPlan,
    confirmation: {
      artifactSha256: hash("1"),
      turnId: TURN_ID,
      planId: "plan:advection-diffusion-dxx:v1",
      manifestArtifactSha256: enrollment.manifest.artifactSha256,
      executionPlanArtifactSha256:
        executionPlan.artifactSha256,
      consumedExactlyOnce: true,
    },
    enrollment: {
      manifest: enrollment.manifest,
      sourceClaimArtifactSha256:
        enrollment.sourceClaim.artifactSha256,
      graphSnapshotArtifactSha256:
        enrollment.graphSnapshot.artifactSha256,
      semanticToLeanBindingArtifactSha256:
        binding.binding.artifactSha256,
      observedTheoremTypeSha256:
        ADVECTION_DIFFUSION_OBSERVED_THEOREM_TYPE_SHA256,
    },
    sourceClaim: {
      ...enrollment.sourceClaim,
      currentTurnId: TURN_ID,
    },
    semanticBinding: {
      artifactId: "scientific_semantic_binding_bundle",
      schemaVersion: "scientific_semantic_binding_bundle/v1",
      artifactSha256: hash("2"),
      currentTurnId: TURN_ID,
      formalSpecArtifactSha256:
        enrollment.manifest.semanticBindings.formalCasimirSpec.artifactSha256,
      numericalSpecArtifactSha256:
        enrollment.manifest.semanticBindings.numericalCasimirSpec.artifactSha256,
      semanticToLeanBindingArtifactSha256:
        binding.binding.artifactSha256,
      reviewed: true,
    },
    graphSnapshot: {
      ...enrollment.graphSnapshot,
      currentTurnId: TURN_ID,
    },
    formal: {
      artifactId: "casimir_formal_verification_certificate_v2",
      schemaVersion: "casimir_formal_verification_certificate/v2",
      artifactSha256: hash("3"),
      currentTurnId: TURN_ID,
      status: "passed",
      manifestArtifactSha256: enrollment.manifest.artifactSha256,
      theoremName: enrollment.manifest.formalContract.theoremName,
      theoremTypeSha256:
        ADVECTION_DIFFUSION_OBSERVED_THEOREM_TYPE_SHA256,
      replayCount: 2,
      productionSandboxEnforced: sandboxed,
    },
    baselineNumerical: numerical(
      ADVECTION_DIFFUSION_BASELINE_CASE_ID,
      hash("4"),
      0.2446598675387153,
      0.2451138257827937,
      0.00032101696822587554,
      0.8805421143420913,
    ),
    interventionNumerical: numerical(
      ADVECTION_DIFFUSION_INTERVENTION_CASE_ID,
      hash("5"),
      0.23986875842621713,
      0.24032315117489741,
      0.00032132181655600826,
      0.9457714843076647,
    ),
    comparisonPolicy: {
      policyId: "policy:advection-diffusion-congruence:v1",
      policySha256,
      maximumCrossLaneL2: 0.01,
      minimumObservedOrder: 0.8,
      maximumInterventionDeltaDiscrepancy: 0.00001,
    },
  };
};

describe("scientific evidence closure evaluator", () => {
  it("emits a canonical-within-enrollment packet only for current-turn sandboxed evidence", async () => {
    const packet = await evaluateScientificEvidenceClosureV1(
      await buildInput(true),
    );
    expect(await validateScientificEvidenceClosurePacketIntegrityV1(packet)).toEqual(
      [],
    );
    expect(packet.status).toBe("satisfied");
    expect(packet.authority.canonicalWithinEnrollment).toBe(true);
    expect(packet.authority.assistantAnswer).toBe(false);
    expect(packet.authority.empiricalAuthority).toBe(false);
  });

  it("keeps successful host smoke runs blocked from canonical closure", async () => {
    const packet = await evaluateScientificEvidenceClosureV1(
      await buildInput(false),
    );
    expect(packet.status).toBe("blocked");
    expect(packet.authority.canonicalWithinEnrollment).toBe(false);
    expect(packet.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining([
        "formal_production_sandbox_not_enforced",
        "baseline_numerical_production_sandbox_not_enforced",
        "intervention_numerical_production_sandbox_not_enforced",
      ]),
    );
  });

  it("fails closed on stale evidence and artifact aliases", async () => {
    const input = await buildInput(true);
    input.formal.currentTurnId = "turn:stale";
    input.graphSnapshot.artifactSha256 = hash("f");
    const packet = await evaluateScientificEvidenceClosureV1(input);
    expect(packet.status).toBe("failed");
    expect(packet.authority.canonicalWithinEnrollment).toBe(false);
    expect(packet.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining([
        "stale_or_foreign_turn_evidence",
        "graph_snapshot_hash_mismatch",
      ]),
    );
  });
});
