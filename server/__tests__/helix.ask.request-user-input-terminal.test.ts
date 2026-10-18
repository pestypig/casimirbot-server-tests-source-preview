import { describe, expect, it } from "vitest";

import {
  applyTerminalAnswerEnvelope,
  resolveTerminalAnswerEnvelope,
} from "../services/helix-ask/terminal-answer-envelope";

describe("Helix Ask request_user_input terminal boundary", () => {
  it("keeps pending input out of assistant final-answer mirrors", () => {
    const turnId = "ask:test-request-user-input";
    const prompt = "I need active_doc_path before I can run that multi-step request.";
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test-request-user-input",
      selected_final_answer: "stale deterministic preview",
      answer: "stale deterministic preview",
      text: "stale deterministic preview",
      assistant_answer: "stale deterministic preview",
      pending_server_request: {
        schema: "helix.pending_server_request.v1",
        request_kind: "request_user_input",
        turn_id: turnId,
        prompt,
        status: "pending",
        assistant_answer: false,
        raw_content_included: false,
      },
      goal_satisfaction_evaluation: {
        next_decision: "request_user_input",
      },
      solver_controller_decision: {
        decision: "request_user_input",
      },
      canonical_goal_frame: {
        goal_kind: "docs_viewer_multi_step",
        required_terminal_kind: "model_synthesized_answer",
      },
      debug: {
        selected_final_answer: "stale deterministic preview",
        answer: "stale deterministic preview",
        text: "stale deterministic preview",
      },
    };

    const envelope = resolveTerminalAnswerEnvelope(payload, {
      turnId,
      threadId: "thread:test-request-user-input",
    });
    applyTerminalAnswerEnvelope(payload, envelope);

    expect(envelope).toMatchObject({
      terminal_kind: "request_user_input",
      terminal_artifact_kind: "request_user_input",
      final_answer_source: "request_user_input",
      terminal_text: prompt,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(payload).toMatchObject({
      ok: true,
      status: "pending_input",
      final_status: "pending_input",
      response_type: "pending_input",
      terminal_artifact_kind: "request_user_input",
      final_answer_source: "request_user_input",
      assistant_answer: false,
      pending_server_request: expect.objectContaining({ prompt }),
      request_user_input_preview: expect.objectContaining({
        prompt,
        assistant_answer: false,
        raw_content_included: false,
      }),
      resolved_turn_summary: expect.objectContaining({
        final_status: "pending_input",
        terminal_kind: "request_user_input",
        pending_server_request_present: true,
      }),
      terminal_answer_authority: expect.objectContaining({
        terminal_kind: "request_user_input",
        terminal_artifact_kind: "request_user_input",
        terminal_text_preview: prompt,
        terminal_eligible: false,
      }),
    });
    expect(payload.selected_final_answer).toBeUndefined();
    expect(payload.answer).toBeUndefined();
    expect(payload.text).toBeUndefined();
    expect(payload.finalAnswer).toBeUndefined();
    expect(payload.content).toBeUndefined();
    expect(payload.debug).toMatchObject({
      status: "pending_input",
      final_status: "pending_input",
      response_type: "pending_input",
      assistant_answer: false,
      request_user_input_preview: expect.objectContaining({ prompt }),
    });
    expect((payload.debug as Record<string, unknown>).selected_final_answer).toBeUndefined();
    expect((payload.debug as Record<string, unknown>).answer).toBeUndefined();
    expect((payload.debug as Record<string, unknown>).text).toBeUndefined();
  });
});
