import { describe, expect, it } from "vitest";

import { buildCodexNormalizedObservationArtifacts } from "../codex-provider";
import {
  executeTheoryExperimentProcedureGatewayCapability,
  THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY,
} from "../../workstation-tool-gateway/theory-experiment-procedure";

const CAPABILITY = THEORY_EXPERIMENT_PROCEDURE_PREPARE_CAPABILITY;
const OBSERVATION_SCHEMA =
  "casimir.theory_experiment_procedure.observation.v1";

const canonicalObservation = async (): Promise<Record<string, unknown>> => {
  const result = await executeTheoryExperimentProcedureGatewayCapability({
    capabilityId: CAPABILITY,
    accountType: "developer",
    turnId: "ask:test:procedure-normalization",
    args: {
      prompt: "Explain the Stage 3 evidence map from first principles.",
      operation: "explain",
      target: "Stage 3 evidence map",
      selected_badge_ids: ["study.casimir_dp.evidence_map_stage3"],
    },
  });
  if (!result.ok) {
    throw new Error(`canonical_procedure_fixture_failed:${result.error}`);
  }
  return result.observation as Record<string, unknown>;
};

const gatewayResult = (input: {
  ok?: boolean;
  admissionStatus?: "admitted" | "blocked";
  packetStatus?: "succeeded" | "blocked";
  observation: Record<string, unknown>;
}) => {
  const ok = input?.ok ?? true;
  const admissionStatus = input?.admissionStatus ?? "admitted";
  const packetStatus = input?.packetStatus ?? "succeeded";
  return {
    schema: "helix.workstation_tool_gateway.call_result.v1",
    manifest_version: "test",
    ok,
    agent_runtime: "codex",
    capability_id: CAPABILITY,
    mode: "read",
    gateway_admission: {
      schema: "helix.workstation_tool_gateway.admission.v1",
      requested_capability: CAPABILITY,
      selected_agent_provider: "codex",
      permission_profile: "read",
      admission_status: admissionStatus,
      admission_reason:
        admissionStatus === "admitted"
          ? "theory_experiment_procedure_prepared"
          : "developer_account_required",
      ...(admissionStatus === "blocked"
        ? { blocked_reason: "developer_account_required" }
        : {}),
      assistant_answer: false,
      raw_content_included: false,
    },
    observation_packet: {
      schema: "helix.agent_step_observation_packet.v1",
      turn_id: "ask:test:procedure-normalization",
      iteration: 1,
      call_id: "ask:test:procedure-normalization:call",
      decision_id: "ask:test:procedure-normalization:decision",
      capability_key: CAPABILITY,
      panel_id: "workflow-demo-lab",
      action: "prepare_theory_experiment_procedure",
      status: packetStatus,
      produced_artifact_refs: [
        "ask:test:procedure-normalization:gateway-observation",
      ],
      observation_summary: "Procedure gateway result.",
      receipts: [],
      missing_requirements: [],
      state_delta: {},
      suggested_next_steps:
        packetStatus === "succeeded" ? ["answer"] : ["repair"],
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    },
    tool_lifecycle_trace: {},
    tool_followup_decision: {},
    observation: input.observation,
    artifact_refs: [
      "ask:test:procedure-normalization:gateway-observation",
    ],
    terminal_eligible: false,
    post_tool_model_step_required: true,
    assistant_answer: false,
    raw_content_included: false,
    ...(!ok ? { error: "developer_account_required" } : {}),
  };
};

describe("theory experiment procedure provider normalization", () => {
  it("normalizes an authentic canonical procedure observation", async () => {
    const observation = await canonicalObservation();
    const result = buildCodexNormalizedObservationArtifacts({
      turnId: "ask:test:procedure-normalization",
      gatewayCallResults: [
        gatewayResult({ observation }) as never,
      ],
    });

    expect(result.missingNormalizationFailures).toEqual([]);
    expect(result.artifacts).toEqual([
      expect.objectContaining({
        kind: "theory_experiment_procedure_observation",
        observation_kind: "theory_experiment_procedure_observation",
        payload_schema: OBSERVATION_SCHEMA,
        source_observation_schema: OBSERVATION_SCHEMA,
        source_observation_status: "succeeded",
        capability_key: CAPABILITY,
        status: "succeeded",
        terminal_eligible: false,
        assistant_answer: false,
        payload: expect.objectContaining({
          ...observation,
          schema: OBSERVATION_SCHEMA,
          kind: "theory_experiment_procedure_observation",
          terminal_eligible: false,
          assistant_answer: false,
        }),
      }),
    ]);
  });

  it("fails closed instead of assigning the canonical kind to a wrong schema", async () => {
    const result = buildCodexNormalizedObservationArtifacts({
      turnId: "ask:test:procedure-wrong-schema",
      gatewayCallResults: [
        gatewayResult({
          observation: {
            ...(await canonicalObservation()),
            schema: "casimir.unrelated_observation.v1",
          },
        }) as never,
      ],
    });

    expect(result.artifacts).toEqual([]);
    expect(result.missingNormalizationFailures).toEqual([
      `provider_observation_normalization_missing:${CAPABILITY}`,
    ]);
  });

  it("does not relabel an account-policy block as a procedure observation", async () => {
    const result = buildCodexNormalizedObservationArtifacts({
      turnId: "ask:test:procedure-policy-block",
      gatewayCallResults: [
        gatewayResult({
          ok: false,
          admissionStatus: "blocked",
          packetStatus: "blocked",
          observation: {
            ...(await canonicalObservation()),
            status: "blocked",
            blocked_reason: "developer_account_required",
            output_role: "evidence_for_synthesis",
            terminal_eligible: false,
            post_tool_model_step_required: true,
            assistant_answer: false,
            raw_content_included: false,
          },
        }) as never,
      ],
    });

    expect(result.artifacts).toEqual([]);
    expect(result.missingNormalizationFailures).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(
      "theory_experiment_procedure_observation",
    );
  });
});
