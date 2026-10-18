import { beforeEach, describe, expect, it } from "vitest";
import {
  buildStagePlayLiveSourceConversationContextPack,
  classifyStagePlayLiveSourceConversationEvent,
  listStagePlayLiveSourceConversationEvents,
  recordStagePlayLiveSourceConversationEvent,
  resetStagePlayLiveSourceConversationStoreForTest,
} from "../services/stage-play/stage-play-live-source-conversation-store";

const threadId = "thread:live-source-conversation-context";
const jobId = "stage_play_live_source_job:conversation-context";
const policyId = "stage_play_live_source_watch_job_policy:conversation-context";

beforeEach(() => {
  resetStagePlayLiveSourceConversationStoreForTest();
});

describe("stage play live-source conversation context", () => {
  it("classifies compact conversation steering without granting answer authority", () => {
    expect(classifyStagePlayLiveSourceConversationEvent({
      text: "Only call out diamonds or danger.",
      source: "user_text",
    })).toEqual({
      intent: "voice_preference_update",
      priority: "policy_update",
    });
    expect(classifyStagePlayLiveSourceConversationEvent({
      text: "What do you think I should do next?",
      source: "user_text",
    })).toEqual({
      intent: "ask_strategy",
      priority: "active_user_prompt",
    });
    expect(classifyStagePlayLiveSourceConversationEvent({
      text: "Stop talking unless it's urgent.",
      source: "user_voice",
    })).toEqual({
      intent: "pause_or_stop",
      priority: "urgent_user_interrupt",
    });
  });

  it("records conversation events as evidence-only compact previews", () => {
    const longText = `Only call out diamonds or danger. ${"Do not narrate ordinary movement. ".repeat(30)}`;
    const event = recordStagePlayLiveSourceConversationEvent({
      threadId,
      jobId,
      turnId: "ask_turn:conversation-context",
      source: "user_voice",
      text: longText,
      mailIds: ["stage_play_live_source_mail:latest"],
      narrativeStateId: "stage_play_live_source_narrative_state:latest",
      watchJobPolicyRef: policyId,
      evidenceRefs: ["evidence:voice"],
      now: "2026-06-04T12:00:00.000Z",
    });

    expect(event).toMatchObject({
      artifactId: "stage_play_live_source_conversation_event",
      schemaVersion: "stage_play_live_source_conversation_event/v1",
      threadId,
      jobId,
      source: "user_voice",
      intent: "voice_preference_update",
      priority: "policy_update",
      appliesTo: {
        mailIds: ["stage_play_live_source_mail:latest"],
        narrativeStateId: "stage_play_live_source_narrative_state:latest",
        watchJobPolicyRef: policyId,
      },
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });
    expect(event.textPreview.length).toBeLessThanOrEqual(360);
    expect(event.evidenceRefs).toEqual(expect.arrayContaining([
      "evidence:voice",
      "stage_play_live_source_mail:latest",
      "stage_play_live_source_narrative_state:latest",
      policyId,
    ]));
  });

  it("builds a conversation context pack with questions, constraints, held callouts, objective, and voice preferences", () => {
    recordStagePlayLiveSourceConversationEvent({
      threadId,
      jobId,
      source: "user_text",
      text: "What do you think I should do next?",
      now: "2026-06-04T12:00:00.000Z",
    });
    recordStagePlayLiveSourceConversationEvent({
      threadId,
      jobId,
      source: "assistant_answer",
      text: "I would watch for danger near the tunnel before moving.",
      now: "2026-06-04T12:00:01.000Z",
    });
    recordStagePlayLiveSourceConversationEvent({
      threadId,
      jobId,
      source: "user_text",
      text: "Only call out diamonds or danger.",
      watchJobPolicyRef: policyId,
      now: "2026-06-04T12:00:02.000Z",
    });
    recordStagePlayLiveSourceConversationEvent({
      threadId,
      jobId,
      source: "assistant_question",
      text: "Should I keep watching the tunnel or the inventory?",
      now: "2026-06-04T12:00:03.000Z",
    });
    recordStagePlayLiveSourceConversationEvent({
      threadId,
      jobId,
      source: "user_voice",
      text: "Stop talking unless it's urgent.",
      now: "2026-06-04T12:00:04.000Z",
    });

    const pack = buildStagePlayLiveSourceConversationContextPack({
      threadId,
      jobId,
      turnId: "ask_turn:latest",
      now: "2026-06-04T12:00:05.000Z",
    });

    expect(pack).toMatchObject({
      artifactId: "stage_play_live_source_conversation_context_pack",
      schemaVersion: "stage_play_live_source_conversation_context_pack/v1",
      threadId,
      jobId,
      turnId: "ask_turn:latest",
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });
    expect(pack.recentUserQuestions.map((entry) => entry.textPreview)).toEqual(expect.arrayContaining([
      "What do you think I should do next?",
    ]));
    expect(pack.recentAssistantAnswers.map((entry) => entry.textPreview)).toEqual(expect.arrayContaining([
      "I would watch for danger near the tunnel before moving.",
    ]));
    expect(pack.activeConstraints.map((entry) => entry.textPreview)).toEqual(expect.arrayContaining([
      "Only call out diamonds or danger.",
    ]));
    expect(pack.openQuestions.map((entry) => entry.textPreview)).toEqual(expect.arrayContaining([
      "What do you think I should do next?",
      "Should I keep watching the tunnel or the inventory?",
    ]));
    expect(pack.heldCallouts.map((entry) => entry.textPreview)).toEqual(expect.arrayContaining([
      "Only call out diamonds or danger.",
      "Stop talking unless it's urgent.",
    ]));
    expect(pack.lastAgreedObjective?.textPreview).toBe("Only call out diamonds or danger.");
    expect(pack.voicePreferences.map((entry) => entry.textPreview)).toEqual(expect.arrayContaining([
      "Only call out diamonds or danger.",
      "Stop talking unless it's urgent.",
    ]));
    expect(pack.events.every((event) => event.assistant_answer === false && event.terminal_eligible === false)).toBe(true);
  });

  it("lists conversation events by thread, job, source, and intent", () => {
    const target = recordStagePlayLiveSourceConversationEvent({
      threadId,
      jobId,
      source: "user_text",
      text: "Only tell me if danger appears.",
    });
    recordStagePlayLiveSourceConversationEvent({
      threadId,
      jobId: "stage_play_live_source_job:other",
      source: "user_text",
      text: "What should I watch next?",
    });

    expect(listStagePlayLiveSourceConversationEvents({ threadId, jobId })).toHaveLength(1);
    expect(listStagePlayLiveSourceConversationEvents({ threadId, source: "user_text" })).toHaveLength(2);
    expect(listStagePlayLiveSourceConversationEvents({ threadId, intent: target.intent })).toEqual([
      expect.objectContaining({ eventId: target.eventId }),
    ]);
  });
});
