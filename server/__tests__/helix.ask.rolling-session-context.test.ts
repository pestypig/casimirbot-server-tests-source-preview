import { beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import {
  __resetHelixRollingSessionContextStoreForTest,
  buildHelixRollingSessionContextPacket,
  forgetHelixRollingSessionContextPacket,
  getLatestHelixRollingSessionContextPacket,
} from "../services/helix-ask/rolling-session-context";
import { appendHelixThreadCompletedItemLifecycle } from "../services/helix-ask/runtime/request-context";
import {
  __resetHelixThreadLedgerStore,
  appendHelixTurnEvent,
} from "../services/helix-thread/ledger";

let threadId = "thread-rolling-context-test";
let sessionId = "session-rolling-context-test";

const completeTurn = (args: {
  turnId: string;
  user: string;
  answer: string;
}) => {
  appendHelixTurnEvent({
    thread_id: threadId,
    route: "/ask",
    event_type: "turn_started",
    turn_id: args.turnId,
    session_id: sessionId,
    turn_kind: "ask",
    thread_status: "active",
    user_text: args.user,
  });
  appendHelixThreadCompletedItemLifecycle({
    threadId,
    turnId: args.turnId,
    route: "/ask",
    sessionId,
    turnKind: "ask",
    itemType: "userMessage",
    text: args.user,
    userText: args.user,
  });
  appendHelixThreadCompletedItemLifecycle({
    threadId,
    turnId: args.turnId,
    route: "/ask",
    sessionId,
    turnKind: "ask",
    itemType: "answer",
    itemStream: "answer",
    text: args.answer,
    assistantText: args.answer,
  });
  appendHelixTurnEvent({
    thread_id: threadId,
    route: "/ask",
    event_type: "turn_completed",
    turn_id: args.turnId,
    session_id: sessionId,
    turn_kind: "ask",
    thread_status: "idle",
    user_text: args.user,
    assistant_text: args.answer,
  });
};

describe("Helix Ask rolling session context packet", () => {
  beforeEach(() => {
    __resetHelixThreadLedgerStore();
    __resetHelixRollingSessionContextStoreForTest();
    threadId = `thread-rolling-context-test-${crypto.randomUUID()}`;
    sessionId = `session-rolling-context-test-${crypto.randomUUID()}`;
  });

  it("accounts for current prompt, prior turns, and non-terminal invariants", () => {
    completeTurn({
      turnId: "turn-1",
      user: "Open the docs viewer.",
      answer: "The docs viewer has been successfully opened.",
    });

    const packet = buildHelixRollingSessionContextPacket({
      threadId,
      currentTurnId: "turn-2",
      sessionId,
      promptText: "What was the last answer?",
      modelContextWindowTokens: 4096,
    });

    expect(packet).toMatchObject({
      schema: "helix.rolling_session_context_packet.v1",
      context_scope: "current_thread",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(packet.estimated_tokens.current_user_prompt).toBeGreaterThan(0);
    expect(packet.estimated_tokens.prior_thread_turns).toBeGreaterThan(0);
    expect(packet.retained_turn_ids).toEqual(["turn-1"]);
    expect(packet.model_visible_summary).toContain("docs viewer");
    expect(packet.context_fidelity_meter).toMatchObject({
      schema: "helix.context_fidelity_meter.v1",
      compaction_mode: "none",
      raw_history_excluded: true,
      assistant_answer: false,
      raw_content_included: false,
      terminal_eligible: false,
    });
    expect(packet.context_compaction_item).toMatchObject({
      schema: "helix.context_compaction_lifecycle_item.v1",
      item_type: "context_compaction",
      trigger: "auto",
      phase: "pre_turn",
      status: "not_required",
      replacement_history_available: false,
      resume_frame_required: false,
      assistant_answer: false,
      raw_content_included: false,
      terminal_eligible: false,
    });
    expect(packet.context_fidelity_meter.active_context_total_tokens).toBe(
      packet.estimated_tokens.active_context_total,
    );
    expect(getLatestHelixRollingSessionContextPacket({ threadId })).toMatchObject({
      current_turn_id: "turn-2",
      context_fidelity_meter: {
        schema: "helix.context_fidelity_meter.v1",
      },
    });
  });

  it("compacts older turns into a summary while retaining recent turns", () => {
    for (let index = 1; index <= 10; index += 1) {
      completeTurn({
        turnId: `turn-${index}`,
        user: `User asks about topic ${index} with several extra words for token accounting.`,
        answer: `Assistant answer for topic ${index} with enough detail to count in rolling context.`,
      });
    }

    const packet = buildHelixRollingSessionContextPacket({
      threadId,
      currentTurnId: "turn-11",
      sessionId,
      promptText: "Continue from the latest result.",
      modelContextWindowTokens: 300,
      maxRetainedTurns: 3,
    });

    expect(packet.compaction_mode).not.toBe("none");
    expect(packet.retained_turn_ids).toEqual(["turn-8", "turn-9", "turn-10"]);
    expect(packet.compacted_turn_ids).toContain("turn-1");
    expect(packet.compacted_context_summary).toContain("turn turn-1");
    expect(packet.context_fidelity_meter.compaction_mode).not.toBe("none");
    expect(packet.context_fidelity_meter.handoff_state.state).not.toBe("idle");
    expect(packet.context_compaction_item.item_type).toBe("context_compaction");
    expect(packet.context_compaction_item.status).not.toBe("not_required");
    expect(packet.context_compaction_item.replacement_history_available).toBe(true);
    expect(packet.context_compaction_item.replacement_context_summary).toContain("turn turn-1");
    expect(JSON.stringify(packet)).not.toContain("raw_content_included\":true");
  });

  it("counts current-turn pasted text attachments toward compaction admission", () => {
    const largePaste = "checkpoint sentinel ".repeat(1200);
    const packet = buildHelixRollingSessionContextPacket({
      threadId,
      currentTurnId: "turn-large-paste",
      sessionId,
      promptText: "Use the attached pasted text.",
      modelContextWindowTokens: 2048,
      attachmentArtifacts: [
        {
          schema: "helix.pasted_text_attachment_artifact.v1",
          artifact_id: "artifact:pasted-text:1",
          attachment_id: "paste:1",
          attachment_kind: "text",
          mime_type: "text/plain",
          file_name: "pasted-text.txt",
          size_bytes: Buffer.byteLength(largePaste, "utf8"),
          char_count: largePaste.length,
          estimated_tokens: Math.ceil(largePaste.length / 4),
          content_sha256: "hash",
          preview: largePaste.slice(0, 120),
          tail_preview: largePaste.slice(-120),
          body_ref: "helix-turn-attachment://artifact:pasted-text:1",
          body_available: true,
          model_visible_summary: `Pasted text attachment\nhead_preview=${largePaste.slice(0, 120)}\ntail_preview=${largePaste.slice(-120)}`,
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      ],
    });

    expect(packet.estimated_tokens.current_turn_attachments).toBeGreaterThan(0);
    expect(packet.estimated_tokens.active_context_total).toBeGreaterThan(packet.model_context_window_tokens);
    expect(packet.compaction_mode).toBe("required");
    expect(packet.context_fidelity_meter.handoff_state.state).toBe("pause_required");
    expect(packet.context_compaction_item).toMatchObject({
      schema: "helix.context_compaction_lifecycle_item.v1",
      item_type: "context_compaction",
      status: "paused_for_resume",
      replacement_history_available: true,
      resume_frame_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(packet.model_visible_summary).toContain("Current turn pasted-text attachments");
    expect(packet.model_visible_summary).toContain("tail_preview=");
  });

  it("returns a blocked empty packet without an active thread", () => {
    const packet = buildHelixRollingSessionContextPacket({
      threadId: "",
      currentTurnId: "turn-1",
      sessionId,
      promptText: "Continue.",
      modelContextWindowTokens: 4096,
    });

    expect(packet.compaction_mode).toBe("none");
    expect(packet.retained_turn_ids).toEqual([]);
    expect(packet.context_fidelity_meter.handoff_state.chat_turns_paused).toBe(false);
    expect(packet.missing_or_uncertain[0]).toMatch(/no active thread/i);
  });

  it("does not fall back to an unrelated latest context when a scoped lookup misses", () => {
    buildHelixRollingSessionContextPacket({
      threadId,
      currentTurnId: "turn-1",
      sessionId,
      promptText: "Track this context.",
      modelContextWindowTokens: 4096,
    });

    expect(getLatestHelixRollingSessionContextPacket()).toMatchObject({
      thread_id: threadId,
      session_id: sessionId,
    });
    expect(getLatestHelixRollingSessionContextPacket({ threadId: "missing-thread" })).toBeNull();
    expect(getLatestHelixRollingSessionContextPacket({ sessionId: "missing-session" })).toBeNull();
  });

  it("forgets rolling context packets by deleted chat session id", () => {
    buildHelixRollingSessionContextPacket({
      threadId,
      currentTurnId: "turn-1",
      sessionId,
      promptText: "Track this context before deletion.",
      modelContextWindowTokens: 4096,
    });

    expect(getLatestHelixRollingSessionContextPacket({ sessionId })).not.toBeNull();
    forgetHelixRollingSessionContextPacket({ sessionId });

    expect(getLatestHelixRollingSessionContextPacket({ threadId })).toBeNull();
    expect(getLatestHelixRollingSessionContextPacket({ sessionId })).toBeNull();
    expect(getLatestHelixRollingSessionContextPacket()).toBeNull();
  });
});
