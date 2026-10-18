import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { helixLiveEnvironmentRouter } from "../routes/helix/live-environment";
import {
  listPendingVoiceSteeringEvents,
  resetVoiceSteeringEventsForTest,
} from "../services/helix-ask/voice-steering-event-store";
import {
  listInterimVoiceCalloutReceipts,
  recordInterimVoiceCalloutRequest,
  resetInterimVoiceCalloutsForTest,
  waitForInterimVoicePlaybackOutcome,
} from "../services/helix-ask/interim-voice-callout-store";

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/helix/live-environment", helixLiveEnvironmentRouter);
  return app;
};

describe("Helix live environment client tool route", () => {
  beforeEach(() => {
    resetVoiceSteeringEventsForTest();
    resetInterimVoiceCalloutsForTest();
  });

  it("records voice steering through the narrow evidence-only client bridge", async () => {
    const app = buildApp();

    const response = await request(app)
      .post("/api/helix/live-environment/tool")
      .send({
        tool_name: "live_env.record_voice_steering",
        thread_id: "thread:route-voice-steering",
        environment_id: "env:desktop",
        args: {
          turn_id: "turn:active",
          expected_turn_id: "turn:active",
          transcript_text: "Actually use meters per second.",
          source: "voice_capture",
          timing: "during_reasoning",
          evidence_refs: ["voice_capture:segment:1"],
        },
      })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
      observation: {
        schema: "helix.live_environment_tool_observation.v1",
        tool_name: "live_env.record_voice_steering",
        ok: true,
        assistant_answer: false,
        raw_content_included: false,
        instruction_authority: "none",
        ask_instruction_authority: "none",
        context_role: "tool_evidence",
        ask_context_policy: "evidence_only",
        observation: {
          schema: "helix.voice_steering_tool_result.v1",
          queuedForSafeBoundary: true,
          post_tool_model_step_required: true,
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
          steeringEvent: {
            artifactId: "helix_voice_steering_event",
            threadId: "thread:route-voice-steering",
            turnId: "turn:active",
            expectedTurnId: "turn:active",
            classification: "correction",
            queueDecision: "queued_for_safe_boundary",
            assistant_answer: false,
            terminal_eligible: false,
            raw_content_included: false,
            instruction_authority: "none",
            ask_instruction_authority: "none",
          },
        },
      },
    });

    const steeringEventId = response.body.observation.observation.steeringEvent.steeringEventId;
    expect(listPendingVoiceSteeringEvents({
      threadId: "thread:route-voice-steering",
      turnId: "turn:active",
    }).map((event) => event.steeringEventId)).toEqual([steeringEventId]);
  });

  it("records client voice playback outcomes as non-terminal server receipts", async () => {
    const app = buildApp();
    const queued = recordInterimVoiceCalloutRequest({
      turnId: "turn:voice-playback-outcome",
      threadId: "thread:voice-playback-outcome",
      kind: "tool_result",
      text: "checking now",
      voicePlaybackKind: "tool_receipt",
      reasonCodes: ["test_voice_playback_outcome"],
    });

    const response = await request(app)
      .post("/api/helix/live-environment/voice-playback/outcome")
      .send({
        request_id: queued.request.requestId,
        source_receipt_id: queued.receipt.receiptId,
        utterance_id: "interim_voice:test-delivered",
        status: "delivered",
        provider: "test_browser_voice_playback",
      })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
      request: {
        requestId: queued.request.requestId,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      receipt: {
        status: "delivered",
        delivery: {
          utteranceId: "interim_voice:test-delivered",
          provider: "test_browser_voice_playback",
          playbackStatus: "client_confirmed",
          playbackAuthority: "backend_terminal_status",
        },
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
        context_role: "tool_evidence",
      },
    });
    expect(listInterimVoiceCalloutReceipts({ requestId: queued.request.requestId }).at(-1)).toMatchObject({
      status: "delivered",
      delivery: {
        playbackStatus: "client_confirmed",
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
  });

  it("resolves active voice playback waiters when the client posts an outcome", async () => {
    const app = buildApp();
    const queued = recordInterimVoiceCalloutRequest({
      turnId: "turn:voice-playback-waiter",
      threadId: "thread:voice-playback-waiter",
      kind: "tool_result",
      text: "wait for client receipt",
      voicePlaybackKind: "tool_receipt",
      reasonCodes: ["test_voice_playback_waiter"],
    });

    const waiter = waitForInterimVoicePlaybackOutcome({
      requestId: queued.request.requestId,
      sourceReceiptId: queued.receipt.receiptId,
      timeoutMs: 1_000,
    });

    await request(app)
      .post("/api/helix/live-environment/voice-playback/outcome")
      .send({
        request_id: queued.request.requestId,
        source_receipt_id: queued.receipt.receiptId,
        utterance_id: "interim_voice:test-waiter-delivered",
        status: "delivered",
        provider: "test_browser_voice_playback",
      })
      .expect(200);

    await expect(waiter).resolves.toMatchObject({
      requestId: queued.request.requestId,
      status: "delivered",
      delivery: {
        utteranceId: "interim_voice:test-waiter-delivered",
        playbackStatus: "client_confirmed",
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
  });

  it("resolves playback waiters when the client accepts a handoff into its queue", async () => {
    const app = buildApp();
    const queued = recordInterimVoiceCalloutRequest({
      turnId: "turn:voice-playback-queued-waiter",
      threadId: "thread:voice-playback-queued-waiter",
      kind: "tool_result",
      text: "queue for playback",
      voicePlaybackKind: "tool_receipt",
      reasonCodes: ["test_voice_playback_queued_waiter"],
    });

    const waiter = waitForInterimVoicePlaybackOutcome({
      requestId: queued.request.requestId,
      sourceReceiptId: queued.receipt.receiptId,
      timeoutMs: 1_000,
    });

    await request(app)
      .post("/api/helix/live-environment/voice-playback/outcome")
      .send({
        request_id: queued.request.requestId,
        source_receipt_id: queued.receipt.receiptId,
        utterance_id: "interim_voice:test-waiter-queued",
        status: "queued",
        provider: "test_browser_voice_playback",
      })
      .expect(200);

    await expect(waiter).resolves.toMatchObject({
      requestId: queued.request.requestId,
      status: "queued",
      delivery: {
        utteranceId: "interim_voice:test-waiter-queued",
        provider: "test_browser_voice_playback",
        playbackStatus: "awaiting_client_receipt",
        playbackAuthority: "client_runtime_required",
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
  });

  it("times out playback waiters without fabricating a delivered receipt", async () => {
    const queued = recordInterimVoiceCalloutRequest({
      turnId: "turn:voice-playback-timeout",
      threadId: "thread:voice-playback-timeout",
      kind: "tool_result",
      text: "wait timeout",
      voicePlaybackKind: "tool_receipt",
      reasonCodes: ["test_voice_playback_timeout"],
    });

    await expect(waitForInterimVoicePlaybackOutcome({
      requestId: queued.request.requestId,
      sourceReceiptId: queued.receipt.receiptId,
      timeoutMs: 1,
    })).resolves.toBeNull();
  });

  it("rejects playback outcomes that cannot be tied to an admitted voice request", async () => {
    const app = buildApp();

    const response = await request(app)
      .post("/api/helix/live-environment/voice-playback/outcome")
      .send({
        request_id: "helix_interim_voice_callout_request:missing",
        source_receipt_id: "helix_interim_voice_callout_receipt:missing",
        utterance_id: "interim_voice:missing",
        status: "delivered",
      })
      .expect(422);

    expect(response.body).toEqual({
      ok: false,
      request: null,
      receipt: null,
      error: "interim_voice_callout_request_not_found",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
  });

  it("does not expose a generic client-side live environment tool executor", async () => {
    const app = buildApp();

    const response = await request(app)
      .post("/api/helix/live-environment/tool")
      .send({
        tool_name: "live_env.query_event_log",
        thread_id: "thread:route-voice-steering",
        args: {},
      })
      .expect(400);

    expect(response.body).toEqual({
      ok: false,
      error: "live_environment_tool_not_allowed",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(listPendingVoiceSteeringEvents({
      threadId: "thread:route-voice-steering",
      turnId: "turn:active",
    })).toEqual([]);
  });
});
