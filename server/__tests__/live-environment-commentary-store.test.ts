import { beforeEach, describe, expect, it } from "vitest";

import { executeLiveEnvironmentTool } from "../services/helix-ask/live-environment-tool-adapter";
import { createLiveAnswerEnvironment, resetLiveAnswerEnvironments } from "../services/situation-room/live-answer-environment-store";
import { clearInterpretedEventLogForTest, listInterpretedEvents } from "../services/situation-room/interpreted-event-log-store";
import {
  listLiveEnvironmentCommentary,
  recordLiveEnvironmentCommentary,
  resetLiveEnvironmentCommentaryForTest,
} from "../services/situation-room/live-environment-commentary-store";

const resetAll = () => {
  resetLiveAnswerEnvironments();
  clearInterpretedEventLogForTest();
  resetLiveEnvironmentCommentaryForTest();
};

describe("live environment commentary store", () => {
  beforeEach(resetAll);

  it("records typed commentary as evidence-only and mirrors it to the interpreted log", () => {
    const commentary = recordLiveEnvironmentCommentary({
      thread_id: "thread:commentary",
      room_id: "room:commentary",
      environment_id: "env:commentary",
      subject: "terminal_authority",
      kind: "terminal_blocked",
      status: "blocked",
      compact_summary: "Terminal authority is blocked until route evidence is refreshed.",
      evidence_refs: ["route:evidence:1"],
      missing_evidence: ["fresh navigation state"],
      confidence: 0.72,
      model_invoked: false,
      derived_by_deterministic_reducer: true,
      created_at: "2026-05-26T12:00:00.000Z",
    });
    const interpreted = listInterpretedEvents({
      threadId: "thread:commentary",
      roomId: "room:commentary",
      limit: 10,
    });

    expect(commentary).toMatchObject({
      schema: "helix.live_environment_commentary.v1",
      assistant_answer: false,
      raw_content_included: false,
      raw_user_text_included: false,
      instruction_authority: "none",
      ask_instruction_authority: "none",
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(interpreted.at(-1)).toMatchObject({
      source_family: "live_environment",
      kind: "final_answer_snapshot",
      assistant_answer: false,
      raw_logs_included: false,
    });
    expect(interpreted.at(-1)?.evidence_refs).toEqual(expect.arrayContaining([
      commentary.commentary_id,
      "route:evidence:1",
    ]));
  });

  it("returns typed commentary from live_env.query_event_log only when requested", () => {
    const environment = createLiveAnswerEnvironment({
      thread_id: "thread:query-commentary",
      created_turn_id: "turn:query-commentary",
      objective: "Watch Dottie commentary.",
      room_id: "room:query-commentary",
      source_ids: ["source:display"],
      preset: "environment_run_monitor",
      now: "2026-05-26T12:00:00.000Z",
    }).environment;

    const recorded = executeLiveEnvironmentTool({
      tool_name: "live_env.record_commentary",
      thread_id: environment.thread_id,
      environment_id: environment.environment_id,
      args: {
        subject: "dottie_observer",
        kind: "observation",
        status: "observed",
        summary: "Dottie attached as a witness-only observer.",
        evidence_refs: ["dottie:receipt:1"],
      },
    });

    const queried = executeLiveEnvironmentTool({
      tool_name: "live_env.query_event_log",
      thread_id: environment.thread_id,
      environment_id: environment.environment_id,
      args: {
        include_typed_commentary: true,
        commentary_subject: "dottie_observer",
        limit: 10,
      },
    });

    expect(recorded.observation).toMatchObject({
      schema: "helix.live_environment_commentary.v1",
      assistant_answer: false,
      ask_context_policy: "evidence_only",
    });
    expect(queried.observation).toMatchObject({
      schema: "helix.interpreted_log_read.v1",
      assistant_answer: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect((queried.observation as { typed_commentary?: unknown[] }).typed_commentary?.[0]).toMatchObject({
      schema: "helix.live_environment_commentary.v1",
      subject: "dottie_observer",
      assistant_answer: false,
    });
    expect(queried.evidence_refs.some((ref) => ref.startsWith("live_commentary:"))).toBe(true);
    expect(listLiveEnvironmentCommentary({
      threadId: environment.thread_id,
      roomId: environment.room_id,
      subject: "dottie_observer",
      limit: 10,
    })).toHaveLength(1);
  });
});
