import { describe, expect, it } from "vitest";

import {
  callWorkstationGatewayCapability,
  listWorkstationGatewayCapabilities,
} from "../registry";
import { buildCodexNormalizedObservationArtifacts } from "../../agent-providers/codex-provider";
import {
  SCIENTIFIC_EVIDENCE_CLOSURE_EVALUATE_CAPABILITY,
  SCIENTIFIC_EVIDENCE_CLOSURE_INSPECT_ENROLLMENT_CAPABILITY,
  SCIENTIFIC_EVIDENCE_CLOSURE_PREPARE_CAPABILITY,
} from "../scientific-evidence-closure";
import {
  ADVECTION_DIFFUSION_SCIENTIFIC_EVIDENCE_MANIFEST_ID,
  ADVECTION_DIFFUSION_SCIENTIFIC_EVIDENCE_ORIENTATION_ID,
  ADVECTION_DIFFUSION_SOURCE_CLAIM_ID,
} from "../../../../../shared/scientific-evidence/advection-diffusion-scientific-evidence-enrollment";
import { buildAdvectionDiffusionHostDiagnosticClosureInputV1 } from "../../../theory/advection-diffusion-scientific-evidence-diagnostic";
import type { ScientificEvidenceExecutionPlanV1 } from "../../../../../shared/contracts/scientific-evidence-execution-plan.v1";

const preparePlanArtifact = async (turnId: string) => {
  const result = await callWorkstationGatewayCapability({
    agentRuntime: "codex",
    accountType: "developer",
    profileId: "developer:test",
    mode: "read",
    capabilityId: SCIENTIFIC_EVIDENCE_CLOSURE_PREPARE_CAPABILITY,
    turnId,
    iteration: 1,
    arguments: {
      manifest_id:
        ADVECTION_DIFFUSION_SCIENTIFIC_EVIDENCE_MANIFEST_ID,
      orientation_id:
        ADVECTION_DIFFUSION_SCIENTIFIC_EVIDENCE_ORIENTATION_ID,
      source_claim_id: ADVECTION_DIFFUSION_SOURCE_CLAIM_ID,
      intervention_parameter_id: "parameter:diffusivity",
      intervention_value: "0.02",
    },
  });
  expect(result.ok).toBe(true);
  const normalized = buildCodexNormalizedObservationArtifacts({
    turnId,
    gatewayCallResults: [result],
  });
  expect(normalized.missingNormalizationFailures).toEqual([]);
  expect(normalized.artifacts).toHaveLength(1);
  const artifact = normalized.artifacts[0] as Record<string, unknown>;
  const payload = artifact.payload as {
    execution_plan: ScientificEvidenceExecutionPlanV1;
  };
  return {
    result,
    artifact,
    plan: payload.execution_plan,
  };
};

describe("scientific evidence closure gateway policy", () => {
  it("lists and inspects the retained non-terminal enrollment sidecar", async () => {
    const listed = listWorkstationGatewayCapabilities({
      accountType: "developer",
      agentRuntime: "codex",
      mode: "read",
    });
    expect(
      listed.capabilities.map((entry) => entry.capability_id),
    ).toEqual(
      expect.arrayContaining([
        SCIENTIFIC_EVIDENCE_CLOSURE_INSPECT_ENROLLMENT_CAPABILITY,
        SCIENTIFIC_EVIDENCE_CLOSURE_PREPARE_CAPABILITY,
        SCIENTIFIC_EVIDENCE_CLOSURE_EVALUATE_CAPABILITY,
      ]),
    );

    const turnId = "turn:inspect-scientific-evidence";
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      accountType: "developer",
      profileId: "developer:test",
      mode: "read",
      capabilityId:
        SCIENTIFIC_EVIDENCE_CLOSURE_INSPECT_ENROLLMENT_CAPABILITY,
      turnId,
      iteration: 1,
      arguments: {
        manifest_id:
          ADVECTION_DIFFUSION_SCIENTIFIC_EVIDENCE_MANIFEST_ID,
      },
    });
    expect(result.ok).toBe(true);
    expect(result.terminal_eligible).toBe(false);
    expect(result.post_tool_model_step_required).toBe(true);
    expect(result.observation).toMatchObject({
      schema: "casimir.scientific_evidence_enrollment.observation.v1",
      status: "succeeded",
      current_turn_id: turnId,
      current_turn_evidence: true,
      output_role: "evidence_for_bounded_synthesis",
      terminal_eligible: false,
      assistant_answer: false,
    });
    const enrollment = (
      result.observation as { enrollment: Record<string, unknown> }
    ).enrollment;
    expect(enrollment).toHaveProperty("manifest");
    expect(enrollment).toHaveProperty("source_claim");
    expect(enrollment).toHaveProperty("graph_snapshot");
    expect(enrollment).toHaveProperty("semantic_binding");
    const normalized = buildCodexNormalizedObservationArtifacts({
      turnId,
      gatewayCallResults: [result],
    });
    expect(normalized.missingNormalizationFailures).toEqual([]);
    expect(normalized.artifacts).toHaveLength(1);
    expect(normalized.artifacts[0]).toMatchObject({
      kind: "scientific_evidence_enrollment_observation",
      turn_id: turnId,
      capability_key:
        SCIENTIFIC_EVIDENCE_CLOSURE_INSPECT_ENROLLMENT_CAPABILITY,
      terminal_eligible: false,
      assistant_answer: false,
    });
  });

  it("binds the exact user orientation, source claim, and permitted intervention into an immutable plan", async () => {
    const turnId = "turn:prepare-scientific-evidence";
    const prepared = await preparePlanArtifact(turnId);
    expect(prepared.artifact).toMatchObject({
      kind: "scientific_evidence_execution_plan_observation",
      turn_id: turnId,
      content_sha256: prepared.plan.artifactSha256,
      terminal_eligible: false,
      assistant_answer: false,
    });
    expect(prepared.plan).toMatchObject({
      turnBinding: { turnId },
      selection: {
        orientationId:
          ADVECTION_DIFFUSION_SCIENTIFIC_EVIDENCE_ORIENTATION_ID,
        sourceClaimId: ADVECTION_DIFFUSION_SOURCE_CLAIM_ID,
      },
      intervention: {
        parameterId: "parameter:diffusivity",
        baselineValue: "0.01",
        selectedValue: "0.02",
      },
      authority: {
        userSelectionBound: true,
        executesTools: false,
        grantsConfirmation: false,
        terminalEligible: false,
      },
    });
    expect(prepared.result.observation_packet.missing_requirements).toEqual(
      [],
    );
    expect(prepared.result.observation).toMatchObject({
      downstream_closure_requirements: expect.arrayContaining([
        "current_turn_procedure_and_semantic_admission_required",
        "external_formal_sandbox_certificate_required",
        "external_numerical_sandbox_certificates_required",
      ]),
      operator_next_affordances: expect.arrayContaining([
        expect.objectContaining({
          capability: "theory-experiment-procedure.prepare",
          executes_automatically: false,
        }),
      ]),
    });
    expect(prepared.result.observation).not.toHaveProperty(
      "missing_requirements",
    );
    expect(prepared.result.observation).not.toHaveProperty(
      "next_affordances",
    );
  });

  it("rejects frozen parameters and non-permitted intervention values", async () => {
    const base = {
      manifest_id:
        ADVECTION_DIFFUSION_SCIENTIFIC_EVIDENCE_MANIFEST_ID,
      orientation_id:
        ADVECTION_DIFFUSION_SCIENTIFIC_EVIDENCE_ORIENTATION_ID,
      source_claim_id: ADVECTION_DIFFUSION_SOURCE_CLAIM_ID,
    };
    const frozen = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      accountType: "developer",
      profileId: "developer:test",
      mode: "read",
      capabilityId: SCIENTIFIC_EVIDENCE_CLOSURE_PREPARE_CAPABILITY,
      turnId: "turn:frozen-scientific-evidence",
      iteration: 1,
      arguments: {
        ...base,
        intervention_parameter_id: "parameter:advection-velocity",
        intervention_value: "0.02",
      },
    });
    expect(frozen.error).toBe(
      "scientific_evidence_frozen_parameter_mutation_forbidden",
    );
    const outside = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      accountType: "developer",
      profileId: "developer:test",
      mode: "read",
      capabilityId: SCIENTIFIC_EVIDENCE_CLOSURE_PREPARE_CAPABILITY,
      turnId: "turn:outside-scientific-evidence",
      iteration: 1,
      arguments: {
        ...base,
        intervention_parameter_id: "parameter:diffusivity",
        intervention_value: "0.03",
      },
    });
    expect(outside.error).toBe(
      "scientific_evidence_intervention_value_not_permitted",
    );
  });

  it("fails closed when the runtime bundle is absent or aliased", async () => {
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      accountType: "developer",
      profileId: "developer:test",
      mode: "read",
      capabilityId: SCIENTIFIC_EVIDENCE_CLOSURE_EVALUATE_CAPABILITY,
      turnId: "turn:closure",
      iteration: 1,
      arguments: {
        manifest_id:
          ADVECTION_DIFFUSION_SCIENTIFIC_EVIDENCE_MANIFEST_ID,
        closure_input_artifact_ref: "turn:closure:missing",
        execution_plan_artifact_ref: "turn:closure:missing-plan",
        plan_id: "plan:closure",
      },
      authoritativeEvidenceArtifacts: [],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("scientific_evidence_execution_plan_not_found");
    expect(result.terminal_eligible).toBe(false);
    expect(result.assistant_answer).toBe(false);
  });

  it("re-enters a host diagnostic as an immutable typed blocker, never canonical evidence", async () => {
    const turnId = "turn:host-diagnostic-closure";
    const prepared = await preparePlanArtifact(turnId);
    const planId = prepared.plan.planId;
    const artifact =
      await buildAdvectionDiffusionHostDiagnosticClosureInputV1({
        turnId,
        executionPlan: prepared.plan,
      });
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      accountType: "developer",
      profileId: "developer:test",
      mode: "read",
      capabilityId: SCIENTIFIC_EVIDENCE_CLOSURE_EVALUATE_CAPABILITY,
      turnId,
      iteration: 2,
      arguments: {
        manifest_id:
          ADVECTION_DIFFUSION_SCIENTIFIC_EVIDENCE_MANIFEST_ID,
        closure_input_artifact_ref: artifact.artifact_id,
        execution_plan_artifact_ref:
          prepared.artifact.artifact_id,
        plan_id: planId,
      },
      authoritativeEvidenceArtifacts: [
        prepared.artifact,
        artifact,
      ],
    });
    expect(result.ok).toBe(true);
    const packet = (
      result.observation as {
        closure_packet: {
          status: string;
          artifactSha256: string;
          blockers: Array<{ code: string }>;
          authority: {
            canonicalWithinEnrollment: boolean;
            assistantAnswer: boolean;
          };
        };
      }
    ).closure_packet;
    expect(packet.status).toBe("blocked");
    expect(packet.authority.canonicalWithinEnrollment).toBe(false);
    expect(packet.authority.assistantAnswer).toBe(false);
    expect(packet.blockers.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "confirmation_not_single_use",
        "formal_production_sandbox_not_enforced",
        "baseline_numerical_production_sandbox_not_enforced",
        "intervention_numerical_production_sandbox_not_enforced",
      ]),
    );
    expect(packet.blockers.map((entry) => entry.code)).not.toContain(
      "confirmation_execution_plan_mismatch",
    );

    const normalized = buildCodexNormalizedObservationArtifacts({
      turnId,
      gatewayCallResults: [result],
    });
    expect(normalized.missingNormalizationFailures).toEqual([]);
    expect(normalized.artifacts).toHaveLength(1);
    expect(normalized.artifacts[0]).toMatchObject({
      kind: "scientific_evidence_closure_observation",
      turn_id: turnId,
      content_sha256: packet.artifactSha256,
      terminal_eligible: false,
      assistant_answer: false,
    });
  });

  it("rejects a tampered current-turn runtime bundle before evaluation", async () => {
    const turnId = "turn:tampered-diagnostic-closure";
    const prepared = await preparePlanArtifact(turnId);
    const planId = prepared.plan.planId;
    const artifact =
      await buildAdvectionDiffusionHostDiagnosticClosureInputV1({
        turnId,
        executionPlan: prepared.plan,
      });
    (
      (
        artifact.payload as {
          closure_input: { planId: string };
        }
      ).closure_input
    ).planId = "plan:aliased";
    const result = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      accountType: "developer",
      profileId: "developer:test",
      mode: "read",
      capabilityId: SCIENTIFIC_EVIDENCE_CLOSURE_EVALUATE_CAPABILITY,
      turnId,
      iteration: 2,
      arguments: {
        manifest_id:
          ADVECTION_DIFFUSION_SCIENTIFIC_EVIDENCE_MANIFEST_ID,
        closure_input_artifact_ref: artifact.artifact_id,
        execution_plan_artifact_ref:
          prepared.artifact.artifact_id,
        plan_id: planId,
      },
      authoritativeEvidenceArtifacts: [
        prepared.artifact,
        artifact,
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe(
      "scientific_evidence_closure_input_hash_mismatch",
    );
  });
});
