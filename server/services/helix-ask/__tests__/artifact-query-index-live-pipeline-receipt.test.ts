import { describe, expect, it } from "vitest";

import { buildArtifactQueryIndex } from "../artifact-query-index";
import { resolveToolFamilyContract } from "../tool-family-contract";

const TURN_ID = "ask:test:live-pipeline-control-receipt";
const SET_RATE_CAPABILITY = "situation-room.live-source.set_rate";

describe("live-pipeline receipt rail normalization", () => {
  it("maps the scoped planner placeholder to the live-pipeline control contract", () => {
    const contract = resolveToolFamilyContract({
      toolName: "live_source:control_live_source",
    });

    expect(contract).toMatchObject({
      toolName: "live_pipeline",
      authority: "control_receipt",
      mutating: true,
    });
    expect(contract?.requiredObservationKinds).toContain("live_pipeline_receipt");
  });

  it("uses the executed receipt action instead of planner and fallback placeholders", () => {
    const index = buildArtifactQueryIndex({
      turnId: TURN_ID,
      payload: {
        active_prompt: "Set the visual capture interval to 10 seconds.",
        selected_final_answer: "Requested visual capture every 10 seconds.",
        terminal_artifact_kind: "live_pipeline_receipt",
        final_status: "final_answer",
        canonical_goal_frame: {
          schema: "helix.canonical_goal_frame.v1",
          turn_id: TURN_ID,
          goal_kind: "live_pipeline_control",
          required_terminal_kind: "live_pipeline_receipt",
          assistant_answer: false,
          raw_content_included: false,
        },
        route_product_contract: {
          schema: "helix.route_product_contract.v1",
          turn_id: TURN_ID,
          source_target: "live_pipeline",
          required_terminal_artifact_kind: "live_pipeline_receipt",
          required_terminal_kind: "live_pipeline_receipt",
          allowed_terminal_artifact_kinds: ["live_pipeline_receipt", "typed_failure"],
          assistant_answer: false,
          raw_content_included: false,
        },
        tool_call_admission_decision: {
          schema: "helix.tool_call_admission_decision.v1",
          turn_id: TURN_ID,
          source_target: "live_pipeline",
          required: true,
          admitted_tool_families: ["live_pipeline"],
          assistant_answer: false,
          raw_content_included: false,
        },
        capability_plan: {
          schema: "helix.capability_plan.v1",
          turn_id: TURN_ID,
          capability_family: "live_source",
          requested_action: "control_live_source",
          selected_capability: "control_live_source",
          admission_status: "admitted",
          required_terminal_kind: "live_pipeline_receipt",
          assistant_answer: false,
          raw_content_included: false,
        },
        operational_capability_trace: {
          schema: "helix.operational_capability_trace.v1",
          turn_id: TURN_ID,
          model_proposed_capability: "situation-room.pipeline.inspect",
          policy_admitted_capability: "live_source:control_live_source",
          executed_capability: null,
          assistant_answer: false,
          raw_content_included: false,
        },
        tool_lifecycle_trace: {
          schema: "helix.tool_lifecycle_trace.v1",
          turn_id: TURN_ID,
          tool_family: "live_source",
          requested_capability: "situation-room.pipeline.inspect",
          admitted_capability: "live_source:control_live_source",
          executed_capability: null,
          lifecycle_stage: "completed",
          status: "completed",
          observation_refs: [`live_pipeline_turn_receipt:${TURN_ID}`],
          assistant_answer: false,
          raw_content_included: false,
        },
        goal_satisfaction_evaluation: {
          schema: "helix.goal_satisfaction_evaluation.v1",
          turn_id: TURN_ID,
          satisfaction: "satisfied",
          assistant_answer: false,
          raw_content_included: false,
        },
        terminal_authority_single_writer: {
          schema: "helix.terminal_authority_single_writer_result.v1",
          turn_id: TURN_ID,
          selected_terminal_artifact_kind: "live_pipeline_receipt",
          selected_terminal_artifact_ref: `terminal:${TURN_ID}`,
          server_authoritative: true,
          assistant_answer: false,
          raw_content_included: false,
        },
        terminal_presentation: {
          schema: "helix.terminal_presentation.v1",
          turn_id: TURN_ID,
          terminal_artifact_kind: "live_pipeline_receipt",
          concise_text: "Requested visual capture every 10 seconds.",
          assistant_answer: false,
          raw_content_included: false,
        },
        current_turn_artifact_ledger: [
          {
            artifact_id: `live_pipeline_turn_receipt:${TURN_ID}`,
            kind: "tool_observation",
            turn_id: TURN_ID,
            payload: {
              schema: "helix.live_pipeline_turn_receipt.v1",
              turn_id: TURN_ID,
              actions: ["situation-room.pipeline.inspect", SET_RATE_CAPABILITY],
              action_id: SET_RATE_CAPABILITY,
              cadence_ms: 10_000,
              assistant_answer: false,
              raw_content_included: false,
            },
          },
        ],
      },
    });

    expect(index.capability).toBe(SET_RATE_CAPABILITY);
    expect(index.tool_turn_chain_audit).toMatchObject({
      requested_capability: SET_RATE_CAPABILITY,
      selected_capability: SET_RATE_CAPABILITY,
      executed_capability: SET_RATE_CAPABILITY,
      required_observation_kinds_for_requested_capability: expect.arrayContaining([
        "live_pipeline_receipt",
        "tool_observation",
      ]),
      observed_artifact_supports_requested_capability: true,
      receipt_terminal_allowed: true,
      reentry_executed: true,
      reentry_proven: true,
      reentry_proof_source: "control_receipt_route_product_terminal_allowed",
      rail_status: "complete",
      rail_failure_code: null,
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      requested_capability: SET_RATE_CAPABILITY,
      selected_capability: SET_RATE_CAPABILITY,
      admitted_capability: SET_RATE_CAPABILITY,
      executed_capability: SET_RATE_CAPABILITY,
      reentry_status: "reentered",
      reentry_proven: true,
      codex_parity_class: "complete",
      rail_status: "complete",
      first_broken_rail: null,
    });
  });
});
