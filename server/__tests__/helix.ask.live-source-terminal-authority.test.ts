import { describe, expect, it } from "vitest";
import { buildLiveSourceObservationCandidate } from "../services/helix-ask/live-source-terminal-answer-composer";
import { assertNoLiveSourceSecondLoop } from "../services/helix-ask/live-source-second-loop-guard";

describe("live-source terminal authority", () => {
  it("rejects hard visual answers routed through side-channel terminal products", () => {
    expect(() => assertNoLiveSourceSecondLoop({
      sourceTargetIntent: {
        schema: "helix.ask_source_target_intent.v1",
        turn_id: "turn:visual",
        thread_id: "thread:visual",
        target_source: "visual_capture",
        target_kind: "visual_capture",
        strength: "hard",
        explicit_cues: ["screen"],
        reasons: ["explicit_visual_source_target"],
        requested_outputs: ["current_visual_state", "terminal_contract"],
        suppressed_routes: [],
        precedence_reason: "explicit_visual_source_target",
        must_enter_backend_ask: true,
        allow_client_shortcut: false,
        allow_no_tool_direct: false,
        confidence: 0.95,
        assistant_answer: false,
        raw_content_included: false,
      },
      terminalArtifactKind: "live_pipeline_receipt",
      finalAnswerSource: "live_pipeline_receipt",
    })).toThrow(/live_source_second_loop_forbidden:live_pipeline_receipt/);
  });

  it("builds a live visual observation candidate without terminal authority", () => {
    const composed = buildLiveSourceObservationCandidate({
      threadId: "thread:visual",
      turnId: "turn:visual",
      sourceIdentity: {
        schema: "helix.live_source_identity.v1",
        source_id: "source:screen",
        thread_id: "thread:visual",
        environment_id: "env:visual",
        source_binding_id: "source_binding:screen",
        modality: "visual_frame",
        source_surface: "screen",
        source_origin: "browser_getDisplayMedia",
        consent_state: "granted",
        binding_status: "bound",
        capture_session_id: null,
        latest_epoch: 2,
        latest_observation_id: "observation:latest",
        latest_evidence_refs: ["visual_evidence:latest"],
        assistant_answer: false,
        raw_content_included: false,
      },
      situationRun: {
        schema: "helix.live_situation_run.v1",
        situation_run_id: "live_situation_run:screen",
        thread_id: "thread:visual",
        environment_id: "env:visual",
        pipeline_id: null,
        source_ids: ["source:screen"],
        source_binding_id: "source_binding:screen",
        primary_source_identity_ref: "live_source_identity:thread:visual:source:screen:epoch:2",
        latest_observation_ref: "observation:latest",
        latest_epoch_observation_refs: ["observation:latest"],
        terminal_authority_required: true,
        selected_evidence_refs: ["observation:latest"],
        objective_text: "Describe the current screen.",
        modality_scope: "generic_visual",
        active_fields: ["scene", "activity"],
        current_epoch: 2,
        corroboration_policy: {
          audio_required: false,
          user_steering_required: false,
          world_event_required: false,
          missing_corroboration_effect: "lower_confidence_not_block",
        },
        reasoning_budget: "cheap",
        terminal_policy: {
          worker_outputs_are_terminal: false,
          tangent_outputs_are_terminal: false,
          terminal_authority_required: true,
        },
        status: "active",
        created_at: "2026-05-19T00:00:00.000Z",
        updated_at: "2026-05-19T00:00:01.000Z",
        assistant_answer: false,
        raw_content_included: false,
      },
      observations: [{
        schema: "helix.observation_journal_entry.v1",
        observation_id: "observation:latest",
        thread_id: "thread:visual",
        room_id: "env:visual",
        source_id: "source:screen",
        source_identity_ref: "live_source_identity:thread:visual:source:screen:epoch:2",
        role: "model_perception_observation",
        modality: "visual_frame",
        text: "Task Manager is visible on the Performance tab.",
        evidence_refs: ["visual_evidence:latest"],
        model_invoked: true,
        confidence: 0.7,
        observed_at: "2026-05-19T00:00:01.000Z",
        ingested_at: "2026-05-19T00:00:01.000Z",
        available_at: "2026-05-19T00:00:01.000Z",
        source_seq: 2,
        replay_status: "live",
        source_binding_id: "source_binding:screen",
        source_epoch: 2,
        raw_image_ref: "visual_frame:latest",
        raw_content_included: false,
        assistant_answer: false,
        context_policy: "compact_context_pack_only",
        created_at: "2026-05-19T00:00:01.000Z",
      }],
      fieldEvaluations: [{
        schema: "helix.live_field_evaluation.v1",
        evaluation_id: "live_field_eval:scene",
        worker_run_id: "live_field_worker_run:scene",
        worker_id: "live_field_worker:scene",
        situation_run_id: "live_situation_run:screen",
        thread_id: "thread:visual",
        environment_id: "env:visual",
        field_key: "scene",
        value: "Windows Task Manager performance metrics are visible.",
        status: "supported",
        confidence: 0.72,
        evidence_refs: ["observation:latest", "visual_evidence:latest"],
        missing_evidence: [],
        corroboration_state: {
          visual_frame: "present",
          audio_transcript: "missing_not_required",
          user_steering: "missing_not_required",
          world_event: "not_applicable",
        },
        next_check: "Compare the next captured frame for content changes.",
        expires_at: "2026-05-19T00:01:00.000Z",
        created_at: "2026-05-19T00:00:01.000Z",
        role: "ui_projection",
        assistant_answer: false,
        raw_content_included: false,
      }],
      createdAt: "2026-05-19T00:00:02.000Z",
    });

    expect(composed).toMatchObject({
      schema: "helix.live_source_observation_candidate.v1",
      suggested_terminal_artifact_kind: "live_visual_answer",
      source_binding_id: "source_binding:screen",
      source_epoch: 2,
      selected_evidence_refs: expect.arrayContaining(["observation:latest", "live_field_eval:scene"]),
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(composed.candidate_summary).toContain("Live visual evidence candidate.");
    expect(composed.observed).toEqual(expect.arrayContaining([
      "Task Manager is visible on the Performance tab.",
      "scene: Windows Task Manager performance metrics are visible.",
    ]));
    expect(composed).not.toHaveProperty("selected_final_answer");
    expect(composed).not.toHaveProperty("live_source_terminal_authority");
    expect(composed).not.toHaveProperty("terminal_answer_authority");
    expect(composed).not.toHaveProperty("terminal_artifact_kind");
  });
});
