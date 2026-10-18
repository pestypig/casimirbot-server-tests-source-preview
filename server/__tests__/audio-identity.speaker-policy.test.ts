import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildHelixAudioIdentityResult } from "../services/audio-identity/transcript-attribution";
import {
  applySpeakerSession,
  resetSpeakerSessionRegistry,
  trustSessionSpeaker,
} from "../services/audio-identity/speaker-session";
import { runVoiceCommandArbiter } from "../services/voice-command/command-arbiter";

const ENV_KEYS = [
  "HELIX_VOICE_COMMAND_LANE_ENABLED",
  "HELIX_VOICE_COMMAND_LANE_ACTIVE_PERCENT",
  "HELIX_VOICE_COMMAND_LANE_LOG_ONLY",
  "HELIX_VOICE_COMMAND_LANE_KILL_SWITCH",
  "HELIX_VOICE_COMMAND_LANE_STRICT_PREFIX_MODE",
  "HELIX_VOICE_COMMAND_LANE_EVALUATOR_API_KEY",
] as const;

const originalEnv = new Map<string, string | undefined>();

const enableCommandLane = (): void => {
  for (const key of ENV_KEYS) originalEnv.set(key, process.env[key]);
  process.env.HELIX_VOICE_COMMAND_LANE_ENABLED = "1";
  process.env.HELIX_VOICE_COMMAND_LANE_ACTIVE_PERCENT = "100";
  process.env.HELIX_VOICE_COMMAND_LANE_LOG_ONLY = "0";
  process.env.HELIX_VOICE_COMMAND_LANE_KILL_SWITCH = "0";
  process.env.HELIX_VOICE_COMMAND_LANE_STRICT_PREFIX_MODE = "off";
  delete process.env.HELIX_VOICE_COMMAND_LANE_EVALUATOR_API_KEY;
};

const restoreEnv = (): void => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (typeof value === "string") process.env[key] = value;
    else delete process.env[key];
  }
  originalEnv.clear();
};

describe("audio identity authority provenance", () => {
  beforeEach(() => {
    enableCommandLane();
  });

  afterEach(() => {
    resetSpeakerSessionRegistry();
    restoreEnv();
  });

  it("downgrades client-provided command_allowed authority without session trust", async () => {
    const rawIdentity = buildHelixAudioIdentityResult({
      speakerIdentityEnabled: true,
      captureSessionId: "capture-policy-1",
      roomId: "room-policy-1",
      captureSource: "mic",
      speakerId: "spk_client_claim",
      speakerRole: "owner",
      speakerAuthority: "command_allowed",
      speakerConfidence: 0.93,
      text: "send it",
    });
    const identity = applySpeakerSession(rawIdentity!, {
      sessionId: "session-policy-1",
      roomId: "room-policy-1",
    }).audioIdentity;
    const speaker = identity.speakers[0]!;

    expect(speaker).toMatchObject({
      claimed_role: "owner",
      role: "guest",
      authority: "transcribe_only",
      authority_source: "client_hint",
      authority_reason: "client_hints_do_not_grant_command_authority",
    });

    const command = await runVoiceCommandArbiter({
      transcript: "send it",
      traceId: "client-hint-downgrade",
      speakerId: speaker.speaker_id,
      speakerConfidence: speaker.confidence,
      speakerRole: speaker.role,
      speakerAuthority: speaker.authority,
    });
    expect(command).toMatchObject({
      decision: "suppressed",
      action: "send",
      suppression_reason: "speaker_not_authorized",
    });
  });

  it("allows a session-trusted owner to carry command_allowed authority", () => {
    trustSessionSpeaker({
      sessionId: "session-policy-2",
      roomId: "room-policy-2",
      speakerId: "spk_owner",
      role: "owner",
      displayName: "You",
    });
    const rawIdentity = buildHelixAudioIdentityResult({
      speakerIdentityEnabled: true,
      captureSessionId: "capture-policy-2",
      roomId: "room-policy-2",
      captureSource: "mic",
      speakerId: "spk_owner",
      speakerRole: "owner",
      speakerAuthority: "command_allowed",
      speakerConfidence: 0.9,
      text: "send it",
    });
    const identity = applySpeakerSession(rawIdentity!, {
      sessionId: "session-policy-2",
      roomId: "room-policy-2",
    }).audioIdentity;

    expect(identity.speakers[0]).toMatchObject({
      role: "owner",
      authority: "command_allowed",
      authority_source: "session_registry",
    });
  });

  it("keeps session-trusted guests in command_confirm by default", () => {
    trustSessionSpeaker({
      sessionId: "session-policy-3",
      roomId: "room-policy-3",
      speakerId: "spk_guest",
      role: "trusted_guest",
      displayName: "Rowan",
    });
    const rawIdentity = buildHelixAudioIdentityResult({
      speakerIdentityEnabled: true,
      captureSessionId: "capture-policy-3",
      roomId: "room-policy-3",
      captureSource: "mic",
      speakerId: "spk_guest",
      speakerConfidence: 0.82,
      text: "retry",
    });
    const identity = applySpeakerSession(rawIdentity!, {
      sessionId: "session-policy-3",
      roomId: "room-policy-3",
    }).audioIdentity;

    expect(identity.speakers[0]).toMatchObject({
      display_name: "Rowan",
      role: "trusted_guest",
      authority: "command_confirm",
      authority_source: "session_registry",
    });
  });

  it("forces device audio to transcribe_only even when the client claims owner authority", () => {
    const rawIdentity = buildHelixAudioIdentityResult({
      speakerIdentityEnabled: true,
      captureSessionId: "capture-policy-4",
      roomId: "room-policy-4",
      captureSource: "display_tab_audio",
      speakerId: "spk_device_claim",
      speakerRole: "owner",
      speakerAuthority: "command_allowed",
      speakerConfidence: 0.99,
      text: "cancel",
    });
    const identity = applySpeakerSession(rawIdentity!, {
      sessionId: "session-policy-4",
      roomId: "room-policy-4",
    }).audioIdentity;

    expect(identity.speakers[0]).toMatchObject({
      claimed_role: "owner",
      role: "device_audio",
      authority: "transcribe_only",
      authority_source: "device_audio_policy",
    });
  });

  it("keeps unknown ask_to_add speakers transcribe_only", () => {
    const rawIdentity = buildHelixAudioIdentityResult({
      speakerIdentityEnabled: true,
      captureSessionId: "capture-policy-5",
      roomId: "room-policy-5",
      captureSource: "mic",
      unknownSpeakerBehavior: "ask_to_add",
      text: "send",
    });
    const identity = applySpeakerSession(rawIdentity!, {
      sessionId: "session-policy-5",
      roomId: "room-policy-5",
    }).audioIdentity;

    expect(identity.speakers[0]).toMatchObject({
      role: "unknown",
      authority: "transcribe_only",
    });
  });

  it("does not let client-provided any_speaker policy grant command authority", () => {
    const rawIdentity = buildHelixAudioIdentityResult({
      speakerIdentityEnabled: true,
      captureSessionId: "capture-policy-6",
      roomId: "room-policy-6",
      captureSource: "mic",
      speakerId: "spk_anyone",
      speakerConfidence: 0.88,
      policyMode: "any_speaker",
      policyModeSource: "client_hint",
      text: "send",
    });
    const identity = applySpeakerSession(rawIdentity!, {
      sessionId: "session-policy-6",
      roomId: "room-policy-6",
    }).audioIdentity;

    expect(identity.speakers[0]).toMatchObject({
      role: "guest",
      authority: "transcribe_only",
      authority_source: "absent",
    });
  });
});
