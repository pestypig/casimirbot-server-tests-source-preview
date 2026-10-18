import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runVoiceCommandArbiter } from "../services/voice-command/command-arbiter";

const SPEAKER_ENV_KEYS = [
  "HELIX_VOICE_COMMAND_LANE_ENABLED",
  "HELIX_VOICE_COMMAND_LANE_ACTIVE_PERCENT",
  "HELIX_VOICE_COMMAND_LANE_LOG_ONLY",
  "HELIX_VOICE_COMMAND_LANE_KILL_SWITCH",
  "HELIX_VOICE_COMMAND_LANE_STRICT_PREFIX_MODE",
  "HELIX_VOICE_COMMAND_LANE_SPEAKER_MIN_CONFIDENCE",
  "HELIX_VOICE_COMMAND_LANE_EVALUATOR_API_KEY",
] as const;

const originalEnv = new Map<string, string | undefined>();

describe("voice command arbiter speaker policy", () => {
  beforeEach(() => {
    for (const key of SPEAKER_ENV_KEYS) {
      originalEnv.set(key, process.env[key]);
    }
    process.env.HELIX_VOICE_COMMAND_LANE_ENABLED = "1";
    process.env.HELIX_VOICE_COMMAND_LANE_ACTIVE_PERCENT = "100";
    process.env.HELIX_VOICE_COMMAND_LANE_LOG_ONLY = "0";
    process.env.HELIX_VOICE_COMMAND_LANE_KILL_SWITCH = "0";
    process.env.HELIX_VOICE_COMMAND_LANE_STRICT_PREFIX_MODE = "off";
    process.env.HELIX_VOICE_COMMAND_LANE_SPEAKER_MIN_CONFIDENCE = "0.55";
    delete process.env.HELIX_VOICE_COMMAND_LANE_EVALUATOR_API_KEY;
  });

  afterEach(() => {
    for (const key of SPEAKER_ENV_KEYS) {
      const value = originalEnv.get(key);
      if (typeof value === "string") {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
    originalEnv.clear();
  });

  it("keeps direct command behavior unchanged when speaker metadata is absent", async () => {
    const result = await runVoiceCommandArbiter({
      transcript: "send it",
      traceId: "speaker-policy-no-metadata",
    });

    expect(result).toMatchObject({
      decision: "accepted",
      action: "send",
      suppression_reason: null,
      source: "parser",
    });
  });

  it("suppresses commands from ignored speakers", async () => {
    const result = await runVoiceCommandArbiter({
      transcript: "send it",
      traceId: "speaker-policy-ignored",
      speakerId: "spk_unknown",
      speakerConfidence: 0.96,
      speakerAuthority: "ignored",
    });

    expect(result).toMatchObject({
      decision: "suppressed",
      action: "send",
      suppression_reason: "speaker_not_authorized",
      source: "parser",
    });
  });

  it("suppresses commands when speaker confidence is below threshold", async () => {
    const result = await runVoiceCommandArbiter({
      transcript: "retry",
      traceId: "speaker-policy-low-confidence",
      speakerId: "spk_owner",
      speakerConfidence: 0.3,
      speakerAuthority: "command_allowed",
      speakerRole: "owner",
    });

    expect(result).toMatchObject({
      decision: "suppressed",
      action: "retry",
      suppression_reason: "speaker_confidence_low",
      source: "parser",
    });
  });

  it("suppresses commands from unknown speakers by default", async () => {
    const result = await runVoiceCommandArbiter({
      transcript: "send",
      traceId: "speaker-policy-unknown",
      speakerId: "spk_session_unknown",
      speakerConfidence: 0.9,
      speakerRole: "unknown",
    });

    expect(result).toMatchObject({
      decision: "suppressed",
      action: "send",
      suppression_reason: "unknown_speaker",
      source: "parser",
    });
  });

  it("suppresses overlapping speech even for trusted speakers", async () => {
    const result = await runVoiceCommandArbiter({
      transcript: "send",
      traceId: "speaker-policy-overlap",
      speakerId: "spk_owner",
      speakerConfidence: 0.95,
      speakerAuthority: "command_allowed",
      speakerRole: "owner",
      overlappingSpeech: true,
    });

    expect(result).toMatchObject({
      decision: "suppressed",
      action: "send",
      suppression_reason: "overlapping_speech",
      source: "parser",
    });
  });
});
