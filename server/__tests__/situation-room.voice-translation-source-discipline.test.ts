import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { discordRouter } from "../routes/discord";
import { signInLocalAccountSession } from "../services/helix-account/account-session-store";
import { planRouter } from "../routes/agi.plan";
import { resetDiscordSessionStore } from "../services/situation-room/discord-session-store";
import {
  resetCompanionPolicies,
  upsertCompanionPolicy,
} from "../services/situation-room/companion-policy-engine";
import {
  __resetHelixThreadLedgerStore,
  getHelixThreadLedgerEvents,
} from "../services/helix-thread/ledger";
import {
  createLiveTranslationProcedure,
  evaluateLiveTranslationProcedureActivationGate,
  evaluateTranslationVoiceRelayGate,
  listLiveProcedureActivationGates,
  listLiveProcedureLedgerItems,
  listLiveTranslationProcedures,
  recordTranslationObservation,
  resetLiveTranslationProcedures,
} from "../services/situation-room/live-translation-procedure-store";
import { decideVoiceOutputAction } from "../services/situation-room/voice-lane-decision-center";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/discord", discordRouter);
  app.use("/api/agi", planRouter);
  return app;
};

async function completeLink(app: express.Express, code: string, profileId: string, discordUserId: string) {
  const signedIn = await signInLocalAccountSession({ profile_id: profileId });
  expect(signedIn.session?.session_id).toBeTruthy();
  return request(app)
    .post("/api/discord/session/complete-link")
    .set("Cookie", `helix_session=${signedIn.session!.session_id}`)
    .send({ code, discord_user_id: discordUserId, profile_id: "ignored-client-profile" })
    .expect(200);
}

describe("voice and translation live-source discipline", () => {
  beforeEach(() => {
    process.env.HELIX_DISCORD_BOT_REQUIRE_TOKEN = "0";
    resetDiscordSessionStore();
    resetCompanionPolicies();
    resetLiveTranslationProcedures();
    __resetHelixThreadLedgerStore();
  });

  it("preserves Discord identity over diarization, blocks guest authority, records translation as evidence, and keeps silence silent", async () => {
    const app = createApp();
    const started = await request(app)
      .post("/api/discord/session/start")
      .send({
        guild_id: "guild-braid",
        voice_channel_id: "voice-braid",
        thread_id: "helix-ask:braid",
      })
      .expect(200);
    const sessionId = started.body.session.session_id;
    const linkCode = await request(app)
      .post("/api/discord/session/link-code")
      .send({
        session_id: sessionId,
        discord_user_id: "owner-user",
      })
      .expect(200);
    await completeLink(app, linkCode.body.code.code, "profile:owner", "owner-user");

    const procedure = createLiveTranslationProcedure({
      thread_id: "helix-ask:braid",
      room_id: "room:discord:braid",
      source_bindings: [
        {
          source_id: `discord:${sessionId}:voice`,
          source_surface: "discord_user_stream",
          speaker_id: "discord:guest-user",
          display_name: "Guest",
          role: "guest",
          authority: "transcribe_only",
          input_language: "es",
          output_language: "en",
          consent_state: "granted",
        },
      ],
      speak_translation: false,
    });

    const ambient = await request(app)
      .post("/api/discord/source-event")
      .send({
        session_id: sessionId,
        event_type: "ambient_context",
        discord_user_id: "guest-user",
        display_name: "Guest",
        text: "Necesito ayuda con esto.",
        diarization_speaker_id: "speaker_2",
        evidence_refs: ["discord:braid:guest-ambient"],
      })
      .expect(200);

    expect(ambient.body).toMatchObject({
      ok: true,
      voice_lane_receipt: {
        decision: "silent_keep_in_context",
        source_observation: {
          source_surface: "discord_user_stream",
          speaker_id: "discord:guest-user",
          diarization_speaker_id: "speaker_2",
          speaker_authority: "untrusted_speaker",
          evidence_observation: {
            source_kind: "live_voice_speaker",
            provenance: expect.any(String),
            confidence: expect.any(Number),
            content_role: "observation_not_assistant_answer",
          },
          raw_audio_included: false,
          raw_transcript_included: false,
        },
      },
      ask_turn_bridge: {
        answer_created: false,
      },
    });

    const translation = recordTranslationObservation({
      procedure_id: procedure.procedure_id,
      source_id: `discord:${sessionId}:voice`,
      speaker_id: "discord:guest-user",
      source_language: "es",
      target_language: "en",
      source_text: "Necesito ayuda con esto.",
      translated_text: "I need help with this.",
      transcript_confidence: 0.91,
      language_confidence: 0.94,
      speaker_confidence: 1,
      translation_confidence: 0.88,
      dispatch_state: "confirm",
      engine: "openai_realtime_translate",
      realtime_session_id: "rt-translate:braid",
      chunk_index: 3,
      latency_ms: 240,
      evidence_refs: ["translation:braid:guest-ambient"],
    });
    expect(translation).toMatchObject({
      schema: "helix.translation_observation.v1",
      speaker_role: "guest",
      speaker_authority: "transcribe_only",
      engine: "openai_realtime_translate",
      realtime_session_id: "rt-translate:braid",
      chunk_index: 3,
      latency_ms: 240,
      content_role: "observation_not_assistant_answer",
      assistant_answer: false,
      raw_audio_included: false,
      raw_transcript_included: false,
      evidence_observation: {
        source_id: `${`discord:${sessionId}:voice`}:discord:guest-user`,
        source_kind: "live_translation",
        provenance: "inferred",
        confidence: expect.any(Number),
        content_role: "observation_not_assistant_answer",
      },
    });
    const relayGate = evaluateTranslationVoiceRelayGate({
      procedure,
      observation: translation,
      outputDecision: decideVoiceOutputAction({
        policy: {
          schema: "helix.companion_policy.v1",
          thread_id: "helix-ask:braid",
          voice_input_active: true,
          voice_output_enabled: true,
          companion_mode: "active_companion",
          commentary_mode: "off",
          direct_address_names: ["dottie", "helix"],
          allowed_outputs: ["silent_keep_in_context", "show_text", "voice_on_confirm", "request_agentic_review", "start_user_turn"],
          context_policy: "compact_context_pack_only",
          raw_audio_included: false,
          raw_transcript_included: false,
          updated_at: new Date().toISOString(),
        },
        classification: {
          schema: "helix.conversation_mode_classification.v1",
          classification_id: "classification:translation-relay",
          thread_id: "helix-ask:braid",
          source_id: `discord:${sessionId}:voice`,
          transcript_kind: "translation_context",
          conversation_mode: "translation_mediator",
          direct_addressed: false,
          command_candidate: false,
          active_companion_requested: false,
          speaker_authority: "ambient",
          confidence: 0.8,
          reason: "Translation relay context.",
          evidence_refs: translation.evidence_refs,
          model_invoked: false,
          deterministic: true,
          context_policy: "compact_context_pack_only",
          raw_audio_included: false,
          raw_transcript_included: false,
          ts: new Date().toISOString(),
        },
        cooldownOk: true,
      }),
    });
    expect(relayGate).toMatchObject({
      allowed: false,
      speak_authority: null,
      reason: "procedure_voice_disabled",
      assistant_answer: false,
      raw_audio_included: false,
      raw_transcript_included: false,
    });

    const guestDirect = await request(app)
      .post("/api/discord/source-event")
      .send({
        session_id: sessionId,
        event_type: "direct_address",
        discord_user_id: "guest-user",
        display_name: "Guest",
        text: "Dottie, answer me.",
        diarization_speaker_id: "speaker_2",
        evidence_refs: ["discord:braid:guest-direct"],
      })
      .expect(200);
    expect(guestDirect.body).toMatchObject({
      voice_lane_receipt: {
        decision: "silent_keep_in_context",
        classification: {
          direct_addressed: true,
          speaker_authority: "untrusted_speaker",
        },
        output_decision: {
          speakable: false,
        },
      },
      ask_turn_bridge: {
        decision: "not_requested",
        answer_created: false,
      },
    });

    await request(app)
      .post(`/api/discord/session/${encodeURIComponent(sessionId)}/companion-mode`)
      .send({ companion_mode: "direct_address_only", voice_output_enabled: false })
      .expect(200);

    const commanderDirect = await request(app)
      .post("/api/discord/source-event")
      .send({
        session_id: sessionId,
        event_type: "direct_address",
        discord_user_id: "owner-user",
        text: "Dottie, what did they say?",
        diarization_speaker_id: "speaker_7",
        evidence_refs: ["discord:braid:owner-direct"],
      })
      .expect(200);
    expect(commanderDirect.body).toMatchObject({
      voice_lane_receipt: {
        decision: "start_user_turn",
        source_observation: {
          speaker_id: "discord:owner-user",
          diarization_speaker_id: "speaker_7",
          speaker_authority: "authorized_user",
        },
      },
      ask_turn_bridge: {
        decision: "queued",
        answer_created: false,
      },
    });

    upsertCompanionPolicy({
      thread_id: "helix-ask:braid",
      voice_input_active: true,
      voice_output_enabled: true,
      companion_mode: "active_companion",
    });
    const silence = await request(app)
      .post("/api/agi/situation/voice-lane/event")
      .send({
        thread_id: "helix-ask:braid",
        source_id: "voice:room",
        source_surface: "room_mic",
        transcript: "   ",
      })
      .expect(400);
    expect(silence.body).toMatchObject({
      decision: "silent_keep_in_context",
      output_decision: {
        action: "remain_silent",
        speakable: false,
      },
    });

    const events = getHelixThreadLedgerEvents({ threadId: "helix-ask:braid" });
    expect(events.some((event) => event.item_type === "answer")).toBe(false);
    expect(events.every((event) => !event.assistant_text)).toBe(true);
  }, 60_000);

  it("allows translation relay voice only as an operator callout with speak authority", () => {
    const procedure = createLiveTranslationProcedure({
      thread_id: "helix-ask:relay",
      room_id: "room:relay",
      source_bindings: [
        {
          source_id: "discord:relay:voice",
          source_surface: "discord_user_stream",
          speaker_id: "discord:owner-user",
          display_name: "Owner",
          role: "owner",
          authority: "command_allowed",
          input_language: "es",
          output_language: "en",
          consent_state: "granted",
        },
      ],
      speak_translation: true,
      voice_profile: "dottie_translation_en",
      evidence_refs: ["translation:relay:setup"],
    });
    const observation = recordTranslationObservation({
      procedure_id: procedure.procedure_id,
      source_id: "discord:relay:voice",
      speaker_id: "discord:owner-user",
      source_language: "es",
      target_language: "en",
      source_text: "La compuerta esta lista.",
      translated_text: "The gate is ready.",
      transcript_confidence: 0.93,
      language_confidence: 0.94,
      speaker_confidence: 0.97,
      translation_confidence: 0.91,
      dispatch_state: "auto",
      engine: "openai_realtime_translate",
      realtime_session_id: "rt-translate:relay",
      chunk_index: 4,
      latency_ms: 180,
      evidence_refs: ["translation:relay:chunk:4"],
    });
    const relayGate = evaluateTranslationVoiceRelayGate({
      procedure,
      observation,
      outputDecision: {
        schema: "helix.voice_output_decision.v1",
        action: "voice_now",
        reason: "direct_address",
        speakable: true,
        requires_confirmation: false,
        assistant_answer: false,
        raw_audio_included: false,
        raw_transcript_included: false,
        context_policy: "compact_context_pack_only",
      },
    });

    expect(relayGate).toMatchObject({
      allowed: true,
      reason: "allowed",
      speak_authority: {
        kind: "operator_callout_v1",
        artifact_ref: observation.observation_id,
        evidence_refs: [observation.observation_id, "translation:relay:chunk:4"],
      },
      assistant_answer: false,
      raw_audio_included: false,
      raw_transcript_included: false,
    });
    expect(observation).toMatchObject({
      assistant_answer: false,
      raw_audio_included: false,
      raw_transcript_included: false,
      content_role: "observation_not_assistant_answer",
    });
    expect(getHelixThreadLedgerEvents({ threadId: "helix-ask:relay" })).toHaveLength(0);
  });

  it("blocks ambient translation activation but allows commander-requested activation with text relay defaults", async () => {
    const app = createApp();
    const started = await request(app)
      .post("/api/discord/session/start")
      .send({
        guild_id: "guild-activation",
        voice_channel_id: "voice-activation",
        thread_id: "helix-ask:activation",
      })
      .expect(200);
    const sessionId = started.body.session.session_id;
    const linkCode = await request(app)
      .post("/api/discord/session/link-code")
      .send({
        session_id: sessionId,
        discord_user_id: "owner-user",
      })
      .expect(200);
    await completeLink(app, linkCode.body.code.code, "profile:owner", "owner-user");

    const guestAmbient = await request(app)
      .post("/api/discord/source-event")
      .send({
        session_id: sessionId,
        event_type: "ambient_context",
        discord_user_id: "guest-user",
        display_name: "Alex",
        text: "I don't understand Spanish.",
        evidence_refs: ["discord:activation:guest-confused"],
      })
      .expect(200);
    expect(guestAmbient.body).toMatchObject({
      voice_lane_receipt: {
        decision: "silent_keep_in_context",
        source_observation: {
          speaker_id: "discord:guest-user",
          speaker_authority: "untrusted_speaker",
        },
        output_decision: {
          speakable: false,
        },
      },
      ask_turn_bridge: {
        answer_created: false,
      },
    });
    const blockedGate = evaluateLiveTranslationProcedureActivationGate({
      source_id: `discord:${sessionId}:voice`,
      speaker_id: "discord:guest-user",
      authority: "transcribe_only",
      consent_granted: true,
      evidence_refs: ["discord:activation:guest-confused"],
    });
    expect(blockedGate).toMatchObject({
      schema: "helix.live_procedure_activation_gate.v1",
      procedure_kind: "translation",
      decision: "journal_only",
      reason: "untrusted_speaker",
      assistant_answer: false,
      raw_audio_included: false,
      raw_transcript_included: false,
    });
    expect(listLiveTranslationProcedures()).toHaveLength(0);

    await request(app)
      .post(`/api/discord/session/${encodeURIComponent(sessionId)}/companion-mode`)
      .send({ companion_mode: "direct_address_only", voice_output_enabled: false })
      .expect(200);

    const commanderRequest = await request(app)
      .post("/api/discord/source-event")
      .send({
        session_id: sessionId,
        event_type: "direct_address",
        discord_user_id: "owner-user",
        text: "Helix, start Spanish-English translation for Alex.",
        evidence_refs: ["discord:activation:owner-translation-request"],
      })
      .expect(200);
    expect(commanderRequest.body).toMatchObject({
      voice_lane_receipt: {
        decision: "start_user_turn",
        source_observation: {
          speaker_id: "discord:owner-user",
          speaker_authority: "authorized_user",
        },
      },
      ask_turn_bridge: {
        decision: "queued",
        answer_created: false,
      },
    });
    const activationGate = evaluateLiveTranslationProcedureActivationGate({
      source_id: `discord:${sessionId}:voice`,
      speaker_id: "discord:owner-user",
      authority: "command_allowed",
      consent_granted: true,
      evidence_refs: ["discord:activation:owner-translation-request"],
    });
    expect(activationGate).toMatchObject({
      decision: "activate",
      reason: "authorized_direct_request",
    });
    const procedure = createLiveTranslationProcedure({
      thread_id: "helix-ask:activation",
      room_id: "room:discord:activation",
      activation_gate: activationGate,
      source_bindings: [
        {
          source_id: `discord:${sessionId}:voice`,
          source_surface: "discord_user_stream",
          speaker_id: "discord:guest-user",
          display_name: "Alex",
          role: "guest",
          authority: "transcribe_only",
          input_language: "es",
          output_language: "en",
          consent_state: "granted",
        },
      ],
    });
    expect(procedure).toMatchObject({
      schema: "helix.live_translation_procedure.v1",
      status: "active",
      output_policy: {
        render_text: true,
        speak_translation: false,
        require_confirm_for_unknown_speaker: true,
      },
      assistant_answer: false,
      raw_audio_included: false,
      raw_transcript_included: false,
    });
    expect(procedure.evidence_refs).toContain(activationGate.gate_id);
    expect(listLiveProcedureActivationGates().map((gate) => gate.decision)).toEqual([
      "journal_only",
      "activate",
    ]);
    expect(listLiveTranslationProcedures()).toHaveLength(1);
    expect(listLiveProcedureLedgerItems(procedure.procedure_id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "activation_requested",
          decision: "activate",
          reason: "authorized_direct_request",
          assistant_answer: false,
        }),
        expect.objectContaining({
          event: "activation_decided",
          decision: "activate",
          reason: "authorized_direct_request",
          assistant_answer: false,
        }),
      ]),
    );

    const events = getHelixThreadLedgerEvents({ threadId: "helix-ask:activation" });
    expect(events.some((event) => event.item_type === "answer")).toBe(false);
    expect(events.every((event) => !event.assistant_text)).toBe(true);
  }, 60_000);
});
