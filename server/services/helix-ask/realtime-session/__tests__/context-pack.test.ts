import { beforeEach, describe, expect, it } from "vitest";
import { WORKSTATION_GOAL_CONTEXT_UPDATE_SCHEMA } from "@shared/contracts/workstation-goal-context.v1";
import {
  recordStagePlayLiveSourceConversationEvent,
  resetStagePlayLiveSourceConversationStoreForTest,
  subscribeStagePlayLiveSourceConversationEvents,
} from "../../../stage-play/stage-play-live-source-conversation-store";
import {
  recordStagePlayGoalContextUpdate,
  resetStagePlayGoalContextStoreForTest,
  subscribeStagePlayGoalContextChanges,
} from "../../../stage-play/stage-play-goal-context-store";
import { buildHelixRealtimeStagePlayContextPack } from "../context-pack";

describe("Realtime Stage Play context pack", () => {
  beforeEach(() => {
    resetStagePlayLiveSourceConversationStoreForTest();
    resetStagePlayGoalContextStoreForTest();
  });

  it("selects bounded fresh context, rejects stale refs, and excludes unsafe identity", () => {
    const nowMs = Date.parse("2026-07-16T12:00:05.000Z");
    const staleConversationEvent = recordStagePlayLiveSourceConversationEvent({
      threadId: "helix-ask:desktop",
      source: "user_voice",
      text: "What appeared on screen earlier?",
      now: "2026-07-16T11:00:00.000Z",
    });
    recordStagePlayLiveSourceConversationEvent({
      threadId: "helix-ask:desktop",
      source: "user_voice",
      text: "What is the current workstation objective?",
      evidenceRefs: ["obs:voice:1"],
      now: "2026-07-16T12:00:00.000Z",
    });
    recordStagePlayLiveSourceConversationEvent({
      threadId: "helix-ask:desktop",
      source: "assistant_answer",
      text: "The grounded runtime answer is available.",
      evidenceRefs: ["answer:evidence:1"],
      now: "2026-07-16T12:00:01.000Z",
    });
    recordStagePlayGoalContextUpdate({
      schemaVersion: WORKSTATION_GOAL_CONTEXT_UPDATE_SCHEMA,
      updateId: "goal-update:fresh",
      createdAtMs: nowMs - 1_000,
      sourceRefs: ["source:docs"],
      loopRefs: ["thread:helix-ask:desktop"],
      producerKind: "source_health",
      updateKind: "source_status",
      contentRef: "content:source-health",
      preview: "Docs source is healthy.",
      evidenceRefs: ["evidence:health"],
      receiptRefs: [],
      freshness: { observedAtMs: nowMs - 1_000, staleAfterMs: 5_000, status: "fresh" },
      suggestedDispatch: [],
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    recordStagePlayGoalContextUpdate({
      schemaVersion: WORKSTATION_GOAL_CONTEXT_UPDATE_SCHEMA,
      updateId: "goal-update:stale",
      createdAtMs: nowMs - 10_000,
      sourceRefs: ["source:old"],
      loopRefs: ["thread:helix-ask:desktop"],
      producerKind: "source_health",
      updateKind: "source_status",
      contentRef: "content:old-health",
      preview: "This status is stale.",
      evidenceRefs: ["evidence:old"],
      receiptRefs: [],
      freshness: { observedAtMs: nowMs - 10_000, staleAfterMs: 100, status: "fresh" },
      suggestedDispatch: [],
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });

    const first = buildHelixRealtimeStagePlayContextPack({
      realtimeSessionId: "realtime:test",
      threadId: "helix-ask:desktop",
      nowMs,
      sourceBinding: {
        panel_id: "docs-viewer",
        document_ref: "docs/research/paper.md",
        api_key: "must-not-leak",
      },
    });
    const second = buildHelixRealtimeStagePlayContextPack({
      realtimeSessionId: "realtime:test",
      threadId: "helix-ask:desktop",
      nowMs: nowMs + 500,
      sourceBinding: {
        panel_id: "docs-viewer",
        document_ref: "docs/research/paper.md",
        api_key: "must-not-leak",
      },
    });

    expect(first.context_hash).toBe(second.context_hash);
    expect(first.context_pack_id).toBe(second.context_pack_id);
    expect(first.recent_questions).toHaveLength(1);
    expect(first.grounded_answers).toHaveLength(1);
    expect(first.source_health).toEqual([
      expect.objectContaining({ ref: "goal-update:fresh", summary: "Docs source is healthy." }),
    ]);
    expect(first.rejected_refs).toContainEqual({ ref: "goal-update:stale", reason: "stale" });
    expect(first.rejected_refs).toContainEqual({
      ref: staleConversationEvent.eventId,
      reason: "stale",
    });
    expect(first.recent_questions.map((entry) => entry.ref)).not.toContain(staleConversationEvent.eventId);
    expect(first.workstation_sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_ref: "docs-viewer", source_kind: "workstation_panel" }),
      expect.objectContaining({ source_ref: "docs/research/paper.md", source_kind: "workstation_document" }),
    ]));
    expect(first).toMatchObject({
      workstation_text_trusted: false,
      raw_audio_included: false,
      raw_logs_included: false,
      raw_transcript_included: false,
      secrets_included: false,
      answer_authority: false,
      terminal_eligible: false,
    });
    expect(JSON.stringify(first)).not.toContain("must-not-leak");
    expect(first.evidence_refs.length).toBeLessThanOrEqual(first.limits.max_evidence_refs);
  });

  it("keeps canonical Stage Play writes independent from observer failures", () => {
    const unsubscribeConversation = subscribeStagePlayLiveSourceConversationEvents(() => {
      throw new Error("observer failed");
    });
    try {
      expect(() => recordStagePlayLiveSourceConversationEvent({
        threadId: "helix-ask:desktop",
        source: "user_voice",
        text: "The canonical conversation write survives.",
      })).not.toThrow();
    } finally {
      unsubscribeConversation();
    }

    const unsubscribeGoalContext = subscribeStagePlayGoalContextChanges(() => {
      throw new Error("observer failed");
    });
    try {
      expect(() => recordStagePlayGoalContextUpdate({
        schemaVersion: WORKSTATION_GOAL_CONTEXT_UPDATE_SCHEMA,
        updateId: "goal-update:observer-isolation",
        createdAtMs: 100,
        sourceRefs: ["source:docs"],
        loopRefs: ["thread:helix-ask:desktop"],
        producerKind: "source_health",
        updateKind: "source_status",
        contentRef: "content:observer-isolation",
        preview: "The canonical goal-context write survives.",
        evidenceRefs: ["evidence:observer-isolation"],
        receiptRefs: [],
        freshness: { observedAtMs: 100, staleAfterMs: 5_000, status: "fresh" },
        suggestedDispatch: [],
        authority: {
          assistantAnswer: false,
          terminalEligible: false,
          rawContentIncluded: false,
          postToolModelStepRequired: true,
        },
      })).not.toThrow();
    } finally {
      unsubscribeGoalContext();
    }
  });

  it("prioritizes active-session conversation evidence over older shared-thread history", () => {
    const threadId = "helix-ask:desktop";
    const currentSessionId = "realtime:current-session";
    for (let index = 0; index < 40; index += 1) {
      recordStagePlayLiveSourceConversationEvent({
        threadId,
        source: index % 2 === 0 ? "user_voice" : "assistant_answer",
        text: `Older shared-thread event ${index}`,
        evidenceRefs: [`realtime:older-session:${index}`, `evidence:older:${index}`],
        now: `2026-07-16T12:${String(index).padStart(2, "0")}:00.000Z`,
      });
    }
    const currentQuestion = recordStagePlayLiveSourceConversationEvent({
      threadId,
      source: "user_voice",
      text: "What does the document mean by noncomputable?",
      evidenceRefs: [currentSessionId, "handoff:current-question"],
      now: "2026-07-16T12:40:00.000Z",
    });
    const currentAnswer = recordStagePlayLiveSourceConversationEvent({
      threadId,
      source: "assistant_answer",
      text: "It means the response operator is not registered yet.",
      evidenceRefs: ["handoff:current-answer", "ask:current-answer"],
      now: "2026-07-16T12:40:01.000Z",
    });

    const context = buildHelixRealtimeStagePlayContextPack({
      realtimeSessionId: currentSessionId,
      threadId,
      nowMs: Date.parse("2026-07-16T12:40:02.000Z"),
    });

    expect(context.recent_questions.map((entry) => entry.ref)).toContain(currentQuestion.eventId);
    expect(context.grounded_answers.map((entry) => entry.ref)).toContain(currentAnswer.eventId);
    expect(context.evidence_refs).toEqual(expect.arrayContaining([
      currentQuestion.eventId,
      currentAnswer.eventId,
      currentSessionId,
      "handoff:current-question",
      "handoff:current-answer",
      "ask:current-answer",
    ]));
    expect(context.evidence_refs.length).toBeLessThanOrEqual(context.limits.max_evidence_refs);
  });
});
