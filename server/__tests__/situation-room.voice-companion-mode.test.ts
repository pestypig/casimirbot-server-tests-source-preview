import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createLiveAnswerEnvironment,
  resetLiveAnswerEnvironments,
} from "../services/situation-room/live-answer-environment-store";
import {
  resetCompanionPolicies,
  upsertCompanionPolicy,
} from "../services/situation-room/companion-policy-engine";
import {
  listLiveAgenticReviewRequests,
  resetLiveAgenticReviews,
} from "../services/situation-room/live-agentic-review-runner";
import {
  __resetHelixThreadLedgerStore,
  getHelixThreadLedgerEvents,
} from "../services/helix-thread/ledger";
import { planRouter } from "../routes/agi.plan";
import {
  createLiveTranslationProcedure,
  recordTranslationObservation,
  resetLiveTranslationProcedures,
} from "../services/situation-room/live-translation-procedure-store";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

describe("voice-aware companion mode", () => {
  beforeEach(() => {
    resetLiveAnswerEnvironments();
    resetCompanionPolicies();
    resetLiveAgenticReviews();
    __resetHelixThreadLedgerStore();
    resetLiveTranslationProcedures();
  });

  it("records ambient mic context without creating answer items", async () => {
    const app = createApp();
    upsertCompanionPolicy({
      thread_id: "helix-ask:voice",
      voice_input_active: true,
      companion_mode: "direct_address_only",
    });

    const response = await request(app)
      .post("/api/agi/situation/voice-lane/event")
      .send({
        thread_id: "helix-ask:voice",
        source_id: "voice:mic",
        source_surface: "room_mic",
        speaker_role: "unknown",
        consent_state: "not_required",
        transcript: "I probably need more wood before night.",
        evidence_refs: ["voice:test:ambient"],
      })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      classification: {
        transcript_kind: "ambient",
        conversation_mode: "ambient_listening",
        model_invoked: false,
        deterministic: true,
      },
      decision: "record_context",
      output_decision: {
        action: "journal_only",
        reason: "voice_output_disabled",
        speakable: false,
        requires_confirmation: false,
        raw_audio_included: false,
        raw_transcript_included: false,
      },
      source_observation: {
        schema: "helix.voice_source_observation.v1",
        source_id: "voice:mic",
        source_surface: "room_mic",
        speaker_authority: "ambient",
        content_role: "observation_not_assistant_answer",
        assistant_answer: false,
        raw_audio_included: false,
        raw_transcript_included: false,
        evidence_observation: {
          lane: "voice_lane",
          source_kind: "live_voice_speaker",
          content_role: "observation_not_assistant_answer",
        },
      },
      raw_audio_included: false,
      raw_transcript_included: false,
    });
    const events = getHelixThreadLedgerEvents({ threadId: "helix-ask:voice" });
    expect(events.some((event) => event.item_type === "toolObservation")).toBe(true);
    expect(events.some((event) => event.item_type === "answer")).toBe(false);
    expect(events.every((event) => !event.assistant_text)).toBe(true);
  });

  it("classifies direct address as start_user_turn without running the turn itself", async () => {
    const app = createApp();
    upsertCompanionPolicy({
      thread_id: "helix-ask:voice-direct",
      voice_input_active: true,
      companion_mode: "active_companion",
      direct_address_names: ["dottie", "helix"],
    });

    const response = await request(app)
      .post("/api/agi/situation/voice-lane/event")
      .send({
        thread_id: "helix-ask:voice-direct",
        transcript: "Dottie, what just happened?",
        evidence_refs: ["voice:test:direct"],
      })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      classification: {
        transcript_kind: "direct_address",
        conversation_mode: "direct_address",
        direct_addressed: true,
      },
      decision: "start_user_turn",
      output_decision: {
        action: "journal_only",
        reason: "voice_output_disabled",
        speakable: false,
      },
    });
    const events = getHelixThreadLedgerEvents({ threadId: "helix-ask:voice-direct" });
    expect(events.some((event) => event.item_type === "answer")).toBe(false);
  });

  it("can request an agentic review from active companion speech over compact context", async () => {
    const app = createApp();
    createLiveAnswerEnvironment({
      thread_id: "helix-ask:voice-review",
      created_turn_id: "turn:voice-review",
      objective: "Watch my Minecraft run and tell me about danger or progress.",
      source_ids: ["source:minecraft-server"],
      preset: "minecraft_run_monitor",
      mode: "text_only",
      now: "2026-05-13T12:00:00.000Z",
    });
    upsertCompanionPolicy({
      thread_id: "helix-ask:voice-review",
      voice_input_active: true,
      companion_mode: "active_companion",
    });

    const response = await request(app)
      .post("/api/agi/situation/voice-lane/event")
      .send({
        thread_id: "helix-ask:voice-review",
        transcript: "Keep me company while I play and watch for danger.",
        evidence_refs: ["voice:test:companion"],
      })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      decision: "request_agentic_review",
      classification: {
        conversation_mode: "active_companion",
        active_companion_requested: true,
      },
    });
    expect(response.body.review_id).toBeTruthy();
    expect(listLiveAgenticReviewRequests()).toHaveLength(1);
    const events = getHelixThreadLedgerEvents({ threadId: "helix-ask:voice-review" });
    expect(events.some((event) => event.item_type === "answer")).toBe(false);
  });

  it("allows direct-address speech only when voice output is enabled", async () => {
    const app = createApp();
    upsertCompanionPolicy({
      thread_id: "helix-ask:voice-output",
      voice_input_active: true,
      voice_output_enabled: true,
      companion_mode: "active_companion",
      direct_address_names: ["dottie", "helix"],
    });

    const response = await request(app)
      .post("/api/agi/situation/voice-lane/event")
      .send({
        thread_id: "helix-ask:voice-output",
        transcript: "Dottie, what is happening?",
        evidence_refs: ["voice:test:direct-speak"],
      })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      decision: "start_user_turn",
      output_decision: {
        action: "voice_now",
        reason: "direct_address",
        speakable: true,
        requires_confirmation: false,
      },
    });
  });

  it("keeps untrusted direct address non-speakable even when voice output is enabled", async () => {
    const app = createApp();
    upsertCompanionPolicy({
      thread_id: "helix-ask:voice-untrusted",
      voice_input_active: true,
      voice_output_enabled: true,
      companion_mode: "active_companion",
      direct_address_names: ["dottie", "helix"],
    });

    const response = await request(app)
      .post("/api/agi/situation/voice-lane/event")
      .send({
        thread_id: "helix-ask:voice-untrusted",
        source_id: "voice:room",
        source_surface: "room_mic",
        speaker_id: "speaker:guest",
        speaker_role: "guest",
        speaker_authority: "untrusted_speaker",
        speaker_confidence: 0.82,
        transcript: "Dottie, open the calculator",
        evidence_refs: ["voice:test:untrusted"],
      })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      classification: {
        direct_addressed: true,
        command_candidate: true,
        speaker_authority: "untrusted_speaker",
      },
      decision: "record_context",
      output_decision: {
        action: "journal_only",
        reason: "speaker_not_authorized",
        speakable: false,
      },
      source_observation: {
        speaker_id: "speaker:guest",
        speaker_role: "guest",
        speaker_authority: "untrusted_speaker",
        speaker_confidence: 0.82,
      },
    });
    const events = getHelixThreadLedgerEvents({ threadId: "helix-ask:voice-untrusted" });
    expect(events.some((event) => event.item_type === "answer")).toBe(false);
  });

  it("keeps empty transcript and silence events silent", async () => {
    const app = createApp();
    upsertCompanionPolicy({
      thread_id: "helix-ask:voice-silence",
      voice_input_active: true,
      voice_output_enabled: true,
      companion_mode: "active_companion",
    });

    const response = await request(app)
      .post("/api/agi/situation/voice-lane/event")
      .send({
        thread_id: "helix-ask:voice-silence",
        transcript: "   ",
        evidence_refs: ["voice:test:silence"],
      })
      .expect(400);

    expect(response.body).toMatchObject({
      ok: false,
      event: null,
      classification: null,
      decision: "silent_keep_in_context",
      output_decision: {
        action: "remain_silent",
        reason: "silent_policy",
        speakable: false,
      },
      raw_audio_included: false,
      raw_transcript_included: false,
    });
  });

  it("records translation procedures and observations as evidence, not assistant answers", () => {
    const procedure = createLiveTranslationProcedure({
      thread_id: "helix-ask:translation",
      room_id: "room:translation",
      source_bindings: [
        {
          source_id: "discord:session-1:voice",
          source_surface: "discord_user_stream",
          speaker_id: "discord:user-1",
          display_name: "Alex",
          role: "trusted_guest",
          authority: "transcribe_only",
          input_language: "es",
          output_language: "en",
          consent_state: "granted",
        },
      ],
      speak_translation: false,
    });

    expect(procedure).toMatchObject({
      schema: "helix.live_translation_procedure.v1",
      status: "active",
      output_policy: {
        render_text: true,
        speak_translation: false,
      },
      assistant_answer: false,
      raw_audio_included: false,
      raw_transcript_included: false,
    });

    const observation = recordTranslationObservation({
      procedure_id: procedure.procedure_id,
      source_id: "discord:session-1:voice",
      speaker_id: "discord:user-1",
      source_language: "es",
      target_language: "en",
      source_text: "Necesito ayuda.",
      translated_text: "I need help.",
      transcript_confidence: 0.91,
      language_confidence: 0.94,
      speaker_confidence: 1,
      translation_confidence: 0.88,
      dispatch_state: "confirm",
      evidence_refs: ["translation:test:1"],
    });

    expect(observation).toMatchObject({
      schema: "helix.translation_observation.v1",
      procedure_id: procedure.procedure_id,
      source_id: "discord:session-1:voice",
      speaker_id: "discord:user-1",
      dispatch_state: "confirm",
      content_role: "observation_not_assistant_answer",
      assistant_answer: false,
      raw_audio_included: false,
      raw_transcript_included: false,
      evidence_observation: {
        lane: "translation_procedure",
        source_kind: "live_translation",
        content_role: "observation_not_assistant_answer",
      },
    });
  });
});
