import { beforeEach, describe, expect, it } from "vitest";
import {
  listSharedRealtimeRoomPublicTerminalResults,
  publishSharedRealtimeRoomPublicTerminalResult,
  rememberSharedRealtimeRoomVerifiedTurnAccess,
  resetSharedRealtimeRoomPublicTerminalResultsForTests,
} from "../public-terminal-results";

const askBody = {
  session_id: "helix-ask:room:shared_realtime_room:test",
  turn_id: "ask:turn-1",
  shared_room_ask_session_access: {
    admitted: true,
    membership_verified: true,
    participant_id: "participant:guest",
  },
};

const payload = {
  turn_id: "ask:turn-1",
  final_status: "final_answer",
  terminal_error_code: null,
  terminal_artifact_kind: "model_synthesized_answer",
  final_answer_source: "final_answer_draft",
  selected_final_answer: "The fresh observation reports four players.",
  terminal_answer_authority: {
    server_authoritative: true,
    terminal_kind: "answer",
    terminal_artifact_kind: "model_synthesized_answer",
    final_answer_source: "final_answer_draft",
  },
  ask_turn_solver_trace: {
    capability_result: {
      executed_capability: "com.casimirbot.minecraft.player.count.read",
      observation_ref: "observation:room-turn-1",
    },
  },
};

describe("shared room public terminal results", () => {
  beforeEach(() => resetSharedRealtimeRoomPublicTerminalResultsForTests());

  it("publishes one idempotent non-authoritative projection from an authorized terminal", () => {
    const first = publishSharedRealtimeRoomPublicTerminalResult({
      askBody,
      payload,
      now: "2026-08-27T14:00:00.000Z",
    });
    const replay = publishSharedRealtimeRoomPublicTerminalResult({ askBody, payload });
    expect(first).toMatchObject({
      room_id: "shared_realtime_room:test",
      turn_id: "ask:turn-1",
      author_participant_id: "participant:guest",
      text: "The fresh observation reports four players.",
      evidence_refs: ["observation:room-turn-1"],
      capability_ids: ["com.casimirbot.minecraft.player.count.read"],
      source_terminal_authorized: true,
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(replay).toEqual(first);
    expect(listSharedRealtimeRoomPublicTerminalResults("shared_realtime_room:test")).toHaveLength(1);
  });

  it("accepts the sparse SSE terminal shape from server authority", () => {
    const result = publishSharedRealtimeRoomPublicTerminalResult({
      askBody,
      payload: {
        turn_id: payload.turn_id,
        selected_final_answer: payload.selected_final_answer,
        terminal_error_code: null,
        terminal_answer_authority: payload.terminal_answer_authority,
        ask_turn_solver_trace: payload.ask_turn_solver_trace,
      },
    });
    expect(result).toMatchObject({
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      text: payload.selected_final_answer,
      source_terminal_authorized: true,
      answer_authority: false,
    });
  });

  it("accepts a completed SSE status only when answer authority is definitive", () => {
    const result = publishSharedRealtimeRoomPublicTerminalResult({
      askBody,
      payload: {
        ...payload,
        final_status: "completed",
      },
    });
    expect(result).toMatchObject({
      text: payload.selected_final_answer,
      source_terminal_authorized: true,
      answer_authority: false,
    });
  });

  it("uses only a server-retained exact room membership receipt when SSE drops its body projection", () => {
    rememberSharedRealtimeRoomVerifiedTurnAccess({
      roomId: "shared_realtime_room:test",
      turnId: "ask:turn-1",
      participantId: "participant:guest",
      nowMs: Date.now(),
    });
    const result = publishSharedRealtimeRoomPublicTerminalResult({
      askBody: {
        session_id: askBody.session_id,
        turn_id: askBody.turn_id,
      },
      payload,
    });
    expect(result).toMatchObject({
      room_id: "shared_realtime_room:test",
      author_participant_id: "participant:guest",
      text: payload.selected_final_answer,
    });

    resetSharedRealtimeRoomPublicTerminalResultsForTests();
    rememberSharedRealtimeRoomVerifiedTurnAccess({
      roomId: "shared_realtime_room:other",
      turnId: "ask:turn-1",
      participantId: "participant:forged",
    });
    expect(
      publishSharedRealtimeRoomPublicTerminalResult({
        askBody: {
          session_id: askBody.session_id,
          turn_id: askBody.turn_id,
        },
        payload,
      }),
    ).toBeNull();
  });

  it.each([
    ["forged membership", { ...askBody, shared_room_ask_session_access: { ...askBody.shared_room_ask_session_access, membership_verified: false } }, payload],
    ["unverified authority", askBody, { ...payload, terminal_answer_authority: { ...payload.terminal_answer_authority, server_authoritative: false } }],
    ["non-answer authority", askBody, { ...payload, terminal_answer_authority: { ...payload.terminal_answer_authority, terminal_kind: "request_user_input" } }],
    ["pending input", askBody, { ...payload, final_status: "pending_input" }],
    ["typed failure", askBody, { ...payload, terminal_artifact_kind: "typed_failure", final_answer_source: "typed_failure" }],
  ])("rejects %s", (_label, body, candidate) => {
    expect(publishSharedRealtimeRoomPublicTerminalResult({ askBody: body, payload: candidate })).toBeNull();
    expect(listSharedRealtimeRoomPublicTerminalResults("shared_realtime_room:test")).toEqual([]);
  });

  it("drops credential-like and endpoint-like support values", () => {
    const result = publishSharedRealtimeRoomPublicTerminalResult({
      askBody,
      payload: {
        ...payload,
        evidence_refs: [
          "observation:safe",
          "https://10.0.0.4/admin",
          "Bearer secret-value",
          "token=secret-value",
        ],
      },
    });
    expect(result?.evidence_refs).toEqual([
      "observation:room-turn-1",
      "observation:safe",
    ]);
    expect(JSON.stringify(result)).not.toMatch(/secret-value|https?:\/\/|10\.0\.0\.4/iu);
  });
});
