import { describe, expect, it } from "vitest";

import type { HelixRawToolResult, HelixRuntimeToolCallV1 } from "@shared/helix-agent-step-observation-packet";
import {
  buildHelixAgentStepObservationPacket,
  buildSituationRoomLiveJobObservationPacket,
} from "../services/helix-ask/tool-router/helix-tool-observation-packet";

const makeCall = (action = "construct.create_from_recipe"): HelixRuntimeToolCallV1 => ({
  schema: "helix.runtime_tool_call.v1",
  call_id: "call:dottie",
  turn_id: "turn:dottie",
  decision_id: "decision:dottie",
  capability_key: `situation-room-pipelines.${action}`,
  panel_id: "situation-room-pipelines",
  action,
  runtime_shape: "run_panel_action",
  args: {},
  validation: { ok: true, violations: [] },
  policy: {
    mutating: true,
    manual_only: false,
    explicit_attachment_only: false,
    confirmation_required: false,
    terminal_eligible: false,
  },
  post_tool_model_step_required: true,
  assistant_answer: false,
  raw_content_included: false,
});

describe("Situation Room live-job observation re-entry packets", () => {
  it("observationizes a blocked Dottie live-job receipt without preserving panel prose", () => {
    const result: HelixRawToolResult = {
      ok: true,
      summary: "Created Situation Room construct recipe auntie_dottie_witness.",
      raw: {
        artifact: {
          live_job_contract: {
            schema: "helix.situation_room_live_job_contract.v1",
            contract_id: "contract:dottie",
            turn_id: "turn:dottie",
            name: "Auntie Dottie Minecraft Watch",
            purpose: "voice_witness",
            selected_recipe: "auntie_dottie_minecraft_watch",
            operating_prompt: "Watch my Minecraft route while I play.",
            operating_prompt_history: [],
            compiled_policy: { trigger_rules: [], stop_conditions: [] },
            source_requirements: [{
              source_kind: "minecraft_world_events",
              required: true,
              status: "missing",
              missing_reason: "Minecraft source is not connected.",
            }],
            output_bindings: [],
            voice_policy: "propose_only",
            authority_policy: {
              assistant_answer: false,
              construct_answer_authority: "witness_only",
              helix_ask_terminal_authority_required: true,
            },
            runtime_status: "blocked",
            diagnostics: [],
            assistant_answer: false,
            raw_content_included: false,
          },
          construct_observation: {
            schema: "helix.situation_room_construct_observation.v1",
            observation_id: "observation:dottie",
            turn_id: "turn:dottie",
            action: "construct.create_from_recipe",
            live_job_contract_ref: "contract:dottie",
            construct_ids: ["construct:dottie"],
            created_constructs: [{
              construct_id: "construct:dottie",
              name: "Auntie Dottie",
              role: "observer",
              authority: "witness_only",
              status: "blocked",
            }],
            missing_inputs: ["minecraft_world_events"],
            policy_state: {
              voice_policy: "propose_only",
              spoken: false,
              confirm_speak_receipt_present: false,
              output_authority: "proposal",
            },
            output_bindings: ["typed_commentary", "voice_proposal"],
            source_status: [{
              source_kind: "minecraft_world_events",
              status: "missing",
              message: "Minecraft source is not connected.",
            }],
            diagnostics: [],
            terminal_eligible: false,
            panel_generated_answer: false,
            next_step_authority: "agent_step_decision",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      },
    };

    const packet = buildSituationRoomLiveJobObservationPacket({
      turnId: "turn:dottie",
      iteration: 1,
      call: makeCall(),
      result,
    });

    expect(packet.schema).toBe("helix.agent_step_observation_packet.v1");
    expect(packet.status).toBe("missing_input");
    expect(packet.terminal_eligible).toBe(false);
    expect(packet.post_tool_model_step_required).toBe(true);
    expect(packet.assistant_answer).toBe(false);
    expect(packet.observation_summary).toContain("Live job status: blocked");
    expect(packet.observation_summary).toContain("Voice policy: propose_only");
    expect(packet.observation_summary).toContain("spoken: false");
    expect(packet.observation_summary).toContain("source:minecraft_world_events");
    expect(packet.observation_summary).not.toContain("Created Situation Room construct recipe");
    expect(packet.produced_artifact_refs).toEqual(expect.arrayContaining([
      "contract:dottie",
      "observation:dottie",
      "construct:dottie",
    ]));
    expect(packet.missing_requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "source:minecraft_world_events" }),
    ]));
  });

  it("marks confirm-speak receipts as spoken only on the confirm action", () => {
    const packet = buildSituationRoomLiveJobObservationPacket({
      turnId: "turn:dottie",
      iteration: 2,
      call: makeCall("voice_delivery.confirm_speak"),
      result: {
        ok: true,
        raw: {
          artifact: {
            construct_observation: {
              schema: "helix.situation_room_construct_observation.v1",
              observation_id: "observation:spoken",
              turn_id: "turn:dottie",
              action: "voice_delivery.confirm_speak",
              construct_ids: [],
              created_constructs: [],
              missing_inputs: [],
              policy_state: {
                voice_policy: "confirm_speak_required",
                spoken: true,
                confirm_speak_receipt_present: true,
                output_authority: "confirmed_spoken",
              },
              output_bindings: ["voice_proposal"],
              source_status: [],
              diagnostics: [],
              terminal_eligible: false,
              panel_generated_answer: false,
              next_step_authority: "agent_step_decision",
              assistant_answer: false,
              raw_content_included: false,
            },
          },
        },
      },
    });

    expect(packet.status).toBe("succeeded");
    expect(packet.observation_summary).toContain("spoken: true");
    expect(packet.observation_summary).toContain("confirm-speak receipt: true");
    expect(packet.terminal_eligible).toBe(false);
  });

  it("re-enters live continuation schemas as non-terminal Situation Room observations", () => {
    const packet = buildHelixAgentStepObservationPacket({
      turnId: "turn:continuation",
      iteration: 3,
      call: makeCall("live_continuation.tick"),
      result: {
        ok: true,
        summary: "Panel prose: tell the user the cave is safe.",
        raw: {
          artifact: {
            schema: "helix.live_continuation_tick.v1",
            tick_id: "tick:continuation",
            job_id: "job:continuation",
            thread_id: "thread:continuation",
            room_id: "room:minecraft",
            trigger: "world_event",
            status: "completed",
            selected_lanes: ["source_health", "risk_watch"],
            worker_receipt_refs: ["worker:risk"],
            goal_evaluation_ref: "goal:risk",
            callout_candidate_ref: "callout:risk",
            next_step: "continue",
            terminal_eligible: false,
            post_tool_model_step_required: true,
            assistant_answer: false,
            raw_content_included: false,
            context_role: "receipt_not_assistant_answer",
            evidence_refs: ["world-event:risk"],
          },
        },
      },
    });

    expect(packet.status).toBe("succeeded");
    expect(packet.terminal_eligible).toBe(false);
    expect(packet.post_tool_model_step_required).toBe(true);
    expect(packet.assistant_answer).toBe(false);
    expect(packet.raw_content_included).toBe(false);
    expect(packet.observation_summary).toContain("helix.live_continuation_tick.v1");
    expect(packet.observation_summary).toContain("Continuation trigger: world_event");
    expect(packet.observation_summary).not.toContain("tell the user the cave is safe");
    expect(packet.produced_artifact_refs).toEqual(expect.arrayContaining([
      "tick:continuation",
      "job:continuation",
      "worker:risk",
      "goal:risk",
      "callout:risk",
    ]));
  });

  it("re-enters Live Answer card deltas as projection context without promoting card text", () => {
    const packet = buildHelixAgentStepObservationPacket({
      turnId: "turn:live-answer",
      iteration: 4,
      call: makeCall("create_live_answer_environment"),
      result: {
        ok: true,
        summary: "Panel prose: tell the player to enter the cave now.",
        raw: {
          artifact: {
            schema: "helix.live_answer_environment_delta.v1",
            delta_id: "live_answer_delta:minecraft",
            environment_id: "live_answer:minecraft",
            thread_id: "thread:minecraft",
            reason: "source_event",
            changed_line_keys: ["situation", "risk", "recommendation", "next_check"],
            previous_hash: "prev",
            next_hash: "next",
            environment_snapshot: {
              schema: "helix.live_answer_environment.v1",
              environment_id: "live_answer:minecraft",
              thread_id: "thread:minecraft",
              created_turn_id: "turn:create",
              objective: "Keep watching the Minecraft server as a live answer.",
              preset: "minecraft_run_monitor",
              room_id: "room:minecraft",
              source_ids: ["source:minecraft"],
              status: "active",
              mode: "text_only",
              line_schema: [],
              lines: [{
                key: "recommendation",
                label: "Recommendation",
                update_policy: "model_reviewed",
                visibility: "answer_card",
                value: "Enter the cave now.",
                confidence: 0.8,
                evidence_refs: ["world-event:cave"],
                updated_at: "2026-06-02T00:00:00.000Z",
                source: "deterministic_reducer",
                model_invoked: false,
                deterministic: true,
              }],
              subgoals: [],
              latest_summary: "Enter the cave now.",
              evidence_refs: ["world-event:cave"],
              created_at: "2026-06-02T00:00:00.000Z",
              updated_at: "2026-06-02T00:00:00.000Z",
              context_policy: "compact_context_pack_only",
              raw_logs_included: false,
              raw_transcript_included: false,
              raw_audio_included: false,
              deterministic_content_role: "observation_not_assistant_answer",
              context_role: "observation_not_assistant_answer",
              terminal_eligible: false,
              post_tool_model_step_required: true,
              assistant_answer: false,
              raw_content_included: false,
            },
            evidence_refs: ["world-event:cave"],
            model_invoked: false,
            context_policy: "compact_context_pack_only",
            raw_logs_included: false,
            raw_transcript_included: false,
            raw_audio_included: false,
            deterministic_content_role: "observation_not_assistant_answer",
            context_role: "observation_not_assistant_answer",
            terminal_eligible: false,
            post_tool_model_step_required: true,
            assistant_answer: false,
            raw_content_included: false,
            ts: "2026-06-02T00:00:00.000Z",
          },
        },
      },
    });

    expect(packet.status).toBe("succeeded");
    expect(packet.terminal_eligible).toBe(false);
    expect(packet.post_tool_model_step_required).toBe(true);
    expect(packet.assistant_answer).toBe(false);
    expect(packet.raw_content_included).toBe(false);
    expect(packet.observation_summary).toContain("helix.live_answer_environment_delta.v1");
    expect(packet.observation_summary).toContain("Live Answer projection update reason: source_event");
    expect(packet.observation_summary).toContain("Changed projection lines: situation, risk, recommendation, next_check");
    expect(packet.observation_summary).toContain("does not grant terminal answer authority");
    expect(packet.observation_summary).not.toContain("Enter the cave now");
    expect(packet.observation_summary).not.toContain("tell the player");
    expect(packet.produced_artifact_refs).toEqual(expect.arrayContaining([
      "live_answer_delta:minecraft",
      "live_answer:minecraft",
      "world-event:cave",
    ]));
  });

  it("recognizes goal ledger actions with continuation receipt schemas", () => {
    const packet = buildHelixAgentStepObservationPacket({
      turnId: "turn:goal",
      iteration: 4,
      call: makeCall("goal_ledger.set_objective"),
      result: {
        ok: true,
        raw: {
          artifact: {
            schema: "helix.goal_evaluation_receipt.v1",
            receipt_id: "goal:eval",
            job_id: "job:continuation",
            thread_id: "thread:continuation",
            room_id: "room:minecraft",
            status: "needs_more_observation",
            rationale_codes: ["missing_visual_confirmation"],
            satisfied_evidence_refs: [],
            missing_evidence: ["latest visual frame"],
            next_step: "continue",
            terminal_eligible: false,
            post_tool_model_step_required: true,
            assistant_answer: false,
            raw_content_included: false,
            context_role: "receipt_not_assistant_answer",
            evidence_refs: ["world-event:risk"],
          },
        },
      },
    });

    expect(packet.status).toBe("missing_input");
    expect(packet.missing_requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing:latest visual frame" }),
    ]));
    expect(packet.observation_summary).toContain("helix.goal_evaluation_receipt.v1");
    expect(packet.terminal_eligible).toBe(false);
  });
});
