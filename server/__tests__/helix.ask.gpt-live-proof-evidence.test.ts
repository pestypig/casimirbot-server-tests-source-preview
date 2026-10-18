import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  answerDebugMatchesAskTurn,
  hasRealtimeAuthenticationFailure,
  visibleTerminalMatchesGroundedArtifact,
} from "../../scripts/lib/helix-ask-gpt-live-proof-evidence";

const completedDebug = (turnId: string) => ({
  active_turn_id: turnId,
  backend_turn_id: turnId,
  ask_turn_solver_trace: {
    turn_id: turnId,
    completed_solver_path: true,
  },
});

describe("GPT Live + Codex proof evidence", () => {
  it("requires every debug identity to match the grounded Ask turn", () => {
    expect(answerDebugMatchesAskTurn(completedDebug("ask:current"), "ask:current")).toBe(true);
    expect(answerDebugMatchesAskTurn({
      ...completedDebug("ask:current"),
      backend_turn_id: "ask:stale",
    }, "ask:current")).toBe(false);
    expect(answerDebugMatchesAskTurn({
      ...completedDebug("ask:current"),
      ask_turn_solver_trace: {
        turn_id: "ask:other",
        completed_solver_path: true,
      },
    }, "ask:current")).toBe(false);
    expect(answerDebugMatchesAskTurn({
      ...completedDebug("ask:current"),
      ask_turn_solver_trace: {
        turn_id: "ask:current",
        completed_solver_path: false,
      },
    }, "ask:current")).toBe(false);
  });

  it("requires the visible final answer to match the selected answer hash and length", () => {
    const answer = "Verified result: 323.";
    const answerHash = `sha256:${crypto.createHash("sha256").update(answer).digest("hex")}`;
    const answerDebug = {
      ...completedDebug("ask:calculator"),
      selected_final_answer: answer,
    };
    const groundedAnswer = {
      answer_text_hash: answerHash,
      answer_text_char_count: answer.length,
    };

    expect(visibleTerminalMatchesGroundedArtifact({
      answer,
      answerDebug,
      groundedAnswer,
    })).toBe(true);
    expect(visibleTerminalMatchesGroundedArtifact({
      answer: "Stale result: 322.",
      answerDebug,
      groundedAnswer,
    })).toBe(false);
    expect(visibleTerminalMatchesGroundedArtifact({
      answer,
      answerDebug,
      groundedAnswer: { ...groundedAnswer, answer_text_char_count: answer.length - 1 },
    })).toBe(false);
  });

  it("detects direct and locally mapped Realtime authentication failures", () => {
    expect(hasRealtimeAuthenticationFailure([{ status: 401 }])).toBe(true);
    expect(hasRealtimeAuthenticationFailure([{
      status: 200,
      detail_code: "openai_realtime_authentication_failed",
    }])).toBe(true);
    expect(hasRealtimeAuthenticationFailure([{
      status: 502,
      detail_code: null,
    }])).toBe(false);
  });
});
