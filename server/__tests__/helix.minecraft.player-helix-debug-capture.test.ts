import { describe, expect, it } from "vitest";
import { buildHelixDebugCapture } from "../../scripts/helix-minecraft-player-helix-debug-capture";

const turnId = "ask:test-walk";
const observationRef = `${turnId}:workstation_gateway:com.casimirbot.minecraft.player.walk:proof`;
const answer = "Measured 0.42 blocks over 5 ticks.";

const debugExport = {
  ok: true,
  payload: {
    active_turn_id: turnId,
    final_status: "final_answer",
    selected_final_answer: answer,
    terminal_authority_status: "authorized_by_terminal_authority_single_writer",
    capability_lane_call_results: [
      {
        arguments: { direction: "forward", duration_ms: 250, sprint: false },
        gateway_admission: { admission_status: "admitted" },
        tool_lifecycle_trace: { observation_refs: [observationRef] },
        observation: {
          schema: "helix.environment_action.observation.v1",
          capability_id: "com.casimirbot.minecraft.player.walk",
          capability_version: 1,
          action_kind: "walk",
          outcome: "succeeded",
          evidence_ref: "environment_action_evidence:test-walk",
          observed_at: "2026-08-12T07:44:24.194Z",
          result: {
            control_engine: "native_fabric",
            duration_ticks: 5,
            verified_terminal_measurements: {
              distance_blocks: 0.42,
              duration_ticks: 5,
            },
            postconditions: [
              { required: true, status: "satisfied" },
            ],
            manual_override_detected: false,
            controls_released: true,
          },
        },
      },
    ],
    provider_reasoning_reentry: {
      observation_reentered: true,
      reentered_observation_refs: [observationRef],
    },
    provider_terminal_candidate: {
      grounded_in_observation_refs: [observationRef],
    },
    terminal_presentation: {
      concise_text: answer,
      support_refs: [observationRef],
    },
    terminal_authority_single_writer: {
      visible_text: answer,
      selected_terminal_support_refs: [observationRef],
    },
    terminal_answer_authority: {
      terminal_eligible: true,
      terminal_artifact_ref: `${turnId}:terminal`,
      created_at: "2026-08-12T07:44:29.036Z",
    },
    turn_lifecycle_projection_audit: { ok: true, mismatches: [] },
  },
};

describe("Minecraft Helix exact-turn debug capture", () => {
  it("selects the executed action through exact lifecycle paths", () => {
    const capture = buildHelixDebugCapture({
      debugExport,
      prompt: "Take one careful step forward.",
      scenarioId: "walk-comparison",
    });

    expect(capture).toMatchObject({
      lane: "helix",
      selected_capability_id: "com.casimirbot.minecraft.player.walk",
      action_kind: "walk",
      admission_status: "admitted",
      execution_outcome: "succeeded",
      postcondition_status: "satisfied",
      observation_refs: [observationRef],
      observation_reentered: true,
      final_candidate_text: answer,
      route_product_text: answer,
      terminal_outcome: "success",
      terminal_authority_status: "passed",
      terminal_writer_text: answer,
      visible_text: answer,
      hidden_reasoning_included: false,
    });
    expect(capture.normalized_progress[1]).toMatchObject({
      event_type: "workflow.succeeded",
      measurements: { distance_blocks: 0.42, duration_ticks: 5 },
      controls_released: true,
    });
  });

  it("does not confuse catalog capability fields with execution evidence", () => {
    const capture = buildHelixDebugCapture({
      debugExport: {
        ...debugExport,
        payload: {
          ...debugExport.payload,
          capability_lane_manifest: {
            selected_capability_id: "utility_text.normalize_text",
            execution_outcome: "default_selected",
            observation_reentered: false,
          },
        },
      },
      prompt: "Take one careful step forward.",
    });

    expect(capture.selected_capability_id).toBe(
      "com.casimirbot.minecraft.player.walk",
    );
    expect(capture.execution_outcome).toBe("succeeded");
    expect(capture.observation_reentered).toBe(true);
  });

  it("accepts the public G2 Ask capture wrapper", () => {
    const capture = buildHelixDebugCapture({
      debugExport: {
        schema: "helix.minecraft.g2_ask_capture.v1",
        ask_response: debugExport.payload,
        debug_export: { ok: true, payload: { truncated: true } },
      },
      prompt: "Take one careful step forward.",
    });

    expect(capture.execution_outcome).toBe("succeeded");
    expect(capture.selected_capability_id).toBe(
      "com.casimirbot.minecraft.player.walk",
    );
  });

  it("selects the final successful repair attempt without erasing earlier failures", () => {
    const failedRef = `${turnId}:workstation_gateway:com.casimirbot.minecraft.player.walk:failed`;
    const repairedRef = `${turnId}:workstation_gateway:com.casimirbot.minecraft.player.walk:repaired`;
    const failedCall = {
      ...debugExport.payload.capability_lane_call_results[0],
      tool_lifecycle_trace: { observation_refs: [failedRef] },
      observation: {
        ...debugExport.payload.capability_lane_call_results[0].observation,
        outcome: "failed",
        evidence_ref: "environment_action_evidence:test-walk-failed",
        result: {
          ...debugExport.payload.capability_lane_call_results[0].observation.result,
          postconditions: [{ required: true, status: "not_satisfied" }],
          controls_released: true,
        },
      },
    };
    const repairedCall = {
      ...debugExport.payload.capability_lane_call_results[0],
      arguments: { direction: "forward", duration_ms: 300, sprint: false },
      tool_lifecycle_trace: { observation_refs: [repairedRef] },
      observation: {
        ...debugExport.payload.capability_lane_call_results[0].observation,
        evidence_ref: "environment_action_evidence:test-walk-repaired",
      },
    };
    const capture = buildHelixDebugCapture({
      debugExport: {
        ...debugExport,
        payload: {
          ...debugExport.payload,
          capability_lane_call_results: [failedCall, repairedCall],
          provider_reasoning_reentry: {
            observation_reentered: true,
            reentered_observation_refs: [failedRef, repairedRef],
          },
          provider_terminal_candidate: {
            grounded_in_observation_refs: [failedRef, repairedRef],
          },
        },
      },
      prompt: "Take one careful step forward and repair a failed attempt.",
      requestedCapabilityId: "com.casimirbot.minecraft.player.walk",
    });

    expect(capture.execution_outcome).toBe("succeeded");
    expect(capture.normalized_arguments).toEqual(repairedCall.arguments);
    expect(capture.observation_refs).toEqual([repairedRef]);
    expect(capture.source_artifact_refs).toContain(
      "ask_turn_debug_export:ask:test-walk",
    );
  });

  it("fails closed when no exact executed action observation exists", () => {
    expect(() =>
      buildHelixDebugCapture({
        debugExport: { payload: { capability_lane_call_results: [] } },
        prompt: "Walk.",
      }),
    ).toThrow(/exactly one environment action observation/i);
  });
});
