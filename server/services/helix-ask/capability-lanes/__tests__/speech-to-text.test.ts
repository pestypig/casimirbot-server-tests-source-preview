import { beforeEach, describe, expect, it } from "vitest";
import type { HelixAgentProvider } from "../../agent-providers/types";
import { runSpeechToTextTranscribeAudio } from "../speech-to-text";
import { resetStagePlayLiveSourceMailboxForTest } from "../../../stage-play/stage-play-live-source-mailbox-store";
import { resetStagePlayLiveSourceMailWakeStoreForTest } from "../../../stage-play/stage-play-live-source-mail-wake-store";

const provider: HelixAgentProvider = {
  id: "codex",
  label: "Codex Workstation Mode",
  permissionProfile: {
    id: "read-observe-act",
    label: "Read/observe plus non-mutating action",
    allows: {
      observe: true,
      read: true,
      act: true,
      write: false,
      shell: false,
      codeMutation: false,
    },
  },
  enabled: () => true,
  supports: {
    streaming: false,
    workstationTools: true,
    capabilityLanes: true,
    capabilityLaneOneShot: true,
    capabilityLaneSessions: false,
    codeMutation: false,
  },
  runTurn: async () => ({
    ok: false,
    runtime: "codex",
    response_type: "test",
    final_status: "test",
  }),
};

describe("speech_to_text.transcribe_audio lane", () => {
  beforeEach(() => {
    resetStagePlayLiveSourceMailboxForTest();
    resetStagePlayLiveSourceMailWakeStoreForTest();
  });

  it("packetizes transcript text as non-terminal live-answer mail evidence", () => {
    const result = runSpeechToTextTranscribeAudio({
      provider,
      env: { OPENAI_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      turnId: "turn-stt",
      request: {
        schema: "helix.speech_to_text.one_shot_request.v1",
        capability: "speech_to_text.transcribe_audio",
        transcript_text: "Translate this after it becomes an observation.",
        audio_ref: "voice:audio:test",
        audio_hash: "audio-hash-test",
        language: "en",
        confidence: 0.91,
        thread_id: "helix-ask:desktop",
        room_id: "room:test",
        source_id: "audio_transcript:helix-ask:desktop",
        capture_session_id: "capture:test",
        chunk_index: 3,
        duration_ms: 1200,
        capture_source: "mic",
        assistant_answer: false,
        terminal_eligible: false,
      },
    });

    expect(result).toMatchObject({
      ok: true,
      lane_id: "speech_to_text",
      capability: "speech_to_text.transcribe_audio",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation).toMatchObject({
      schema: "helix.speech_to_text.observation.v1",
      source_kind: "audio_transcript",
      transcript_char_count: 47,
      audio_ref: "voice:audio:test",
      stage_play_mail_id: expect.stringMatching(/^stage_play_live_source_mail:/),
      terminal_eligible: false,
      assistant_answer: false,
      raw_audio_included: false,
    });
    expect(result.observation_packet).toMatchObject({
      schema: "helix.agent_step_observation_packet.v1",
      capability_key: "speech_to_text.transcribe_audio",
      status: "succeeded",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      state_delta: {
        speech_to_text_observation: expect.objectContaining({
          observation_ref: result.observation?.observation_ref,
        }),
        speech_to_text_live_source_mail_item: expect.objectContaining({
          sourceKind: "audio_transcript",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        }),
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/audio_data|audio_bytes|data:audio|base64/i);
  });

  it("does not turn an audio ref into an answer while transcription is pending", () => {
    const result = runSpeechToTextTranscribeAudio({
      provider,
      env: { OPENAI_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      turnId: "turn-stt-pending",
      request: {
        schema: "helix.speech_to_text.one_shot_request.v1",
        capability: "speech_to_text.transcribe_audio",
        audio_ref: "voice:audio:pending",
        thread_id: "helix-ask:desktop",
        assistant_answer: false,
        terminal_eligible: false,
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: "awaiting_client_transcription_result",
      observation: null,
      terminal_eligible: false,
      assistant_answer: false,
    });
    expect(result.observation_packet).toMatchObject({
      status: "client_pending",
      receipts: [],
      terminal_eligible: false,
      assistant_answer: false,
    });
  });
});
