import { beforeEach, describe, expect, it } from "vitest";
import { VOICE_INTERPRETATION_CONTEXT_SCHEMA } from "@shared/voice-interpretation-context";
import {
  cancelVoiceInterpretationContext,
  clearVoiceInterpretationContextsForTest,
  getActiveVoiceInterpretationContext,
  getActiveVoiceInterpretationContextDebugSummary,
  upsertVoiceInterpretationContext,
} from "../services/voice/voice-interpretation-context-store";

describe("voice interpretation context store", () => {
  beforeEach(() => {
    clearVoiceInterpretationContextsForTest();
  });

  it("stores normalized steering context by thread without answer authority", () => {
    const context = upsertVoiceInterpretationContext({
      thread_id: "thread-a",
      turn_id: "turn-1",
      persona_profile: " Auntie Dottie ",
      interpretation_job: "caveat_reader",
      output_mode: "voice_lane_only",
      salience_policy: "caveats_only",
      speak_policy: "manual_only",
      max_chars: 220,
      evidence_refs: ["answer_snapshot:latest", "answer_snapshot:latest"],
      reason_codes: ["operator_style_context"],
    });

    expect(context).toMatchObject({
      schema: VOICE_INTERPRETATION_CONTEXT_SCHEMA,
      thread_id: "thread-a",
      turn_id: "turn-1",
      persona_profile: "auntie_dottie",
      interpretation_job: "caveat_reader",
      output_mode: "voice_lane_only",
      salience_policy: "caveats_only",
      speak_policy: "manual_only",
      max_chars: 220,
      certainty_ceiling: "source_answer_snapshot",
      applies_until: "explicit_cancel",
      assistant_answer: false,
      raw_content_included: false,
      output_authority: "steering_context",
      instruction_authority: "none",
      context_role: "tool_evidence",
    });
    expect(context.evidence_refs).toEqual(["answer_snapshot:latest"]);
    expect(getActiveVoiceInterpretationContext("thread-a")?.context_id).toBe(context.context_id);
  });

  it("replaces the active context for a thread and can cancel it", () => {
    const first = upsertVoiceInterpretationContext({
      thread_id: "thread-a",
      persona_profile: "auntie_dottie",
      speak_policy: "manual_only",
      reason_codes: ["operator_requested"],
    });
    const second = upsertVoiceInterpretationContext({
      thread_id: "thread-a",
      persona_profile: "operator_neutral",
      interpretation_job: "status_callout",
      speak_policy: "muted",
      salience_policy: "state_changes_only",
      reason_codes: ["voice_disabled_or_forbidden"],
    });

    expect(second.context_id).toBe(first.context_id);
    expect(getActiveVoiceInterpretationContextDebugSummary("thread-a")).toMatchObject({
      context_id: first.context_id,
      persona_profile: "operator_neutral",
      interpretation_job: "status_callout",
      speak_policy: "muted",
      salience_policy: "state_changes_only",
      reason_codes: ["voice_disabled_or_forbidden"],
      assistant_answer: false,
    });

    expect(cancelVoiceInterpretationContext("thread-a")?.context_id).toBe(first.context_id);
    expect(getActiveVoiceInterpretationContext("thread-a")).toBeNull();
  });

  it("does not store raw persona prose in debug summaries", () => {
    upsertVoiceInterpretationContext({
      thread_id: "thread-a",
      persona_profile: "talk like Auntie Dottie with long raw instructions and vibes",
      reason_codes: ["style_context_only"],
    });

    const summary = getActiveVoiceInterpretationContextDebugSummary("thread-a");

    expect(summary?.persona_profile).toBe("talk_like_auntie_dottie_with_long_raw_instructions_and_vibes");
    expect(JSON.stringify(summary)).not.toContain("talk like Auntie Dottie");
    expect(summary?.raw_content_included).toBe(false);
    expect(summary?.instruction_authority).toBe("none");
  });
});
