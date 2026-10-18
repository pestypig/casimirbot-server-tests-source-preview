import { beforeEach, describe, expect, it } from "vitest";
import {
  HELIX_TEXT_TO_SPEECH_ONE_SHOT_REQUEST_SCHEMA,
  type HelixTextToSpeechOneShotRequest,
} from "@shared/helix-text-to-speech-lane";
import type { HelixAgentProvider } from "../../agent-providers/types";
import {
  listInterimVoiceCalloutRequests,
  recordInterimVoiceCalloutRequest,
  recordInterimVoicePlaybackOutcome,
  resetInterimVoiceCalloutsForTest,
} from "../../interim-voice-callout-store";
import { runtimeMemoryGovernor } from "../../../runtime/runtime-memory-governor";
import { runTextToSpeechSpeakText } from "../text-to-speech";

const buildProvider = (id: "helix" | "codex"): HelixAgentProvider => ({
  id,
  label: id === "helix" ? "Helix Ask Native" : "Codex Workstation Mode",
  permissionProfile: {
    id: id === "helix" ? "helix-native" : "read-observe-act",
    label: "Read/observe plus non-mutating workstation action",
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
    streaming: id === "helix",
    workstationTools: true,
    capabilityLanes: true,
    capabilityLaneOneShot: true,
    capabilityLaneSessions: false,
    codeMutation: false,
  },
  runTurn: async () => ({
    ok: false,
    runtime: id,
    response_type: "test",
    final_status: "test",
  }),
});

const request = (
  input: Partial<HelixTextToSpeechOneShotRequest>,
): HelixTextToSpeechOneShotRequest => ({
  schema: HELIX_TEXT_TO_SPEECH_ONE_SHOT_REQUEST_SCHEMA,
  capability: "text_to_speech.speak_text",
  text: "Read this governed lane receipt aloud.",
  voice: "calm",
  profile: null,
  locale: "en-US",
  requested_backend_provider: null,
  turn_id: "turn-text-to-speech",
  thread_id: "helix-ask:desktop",
  source_observation_ref: "ask:observation:source-text",
  assistant_answer: false,
  terminal_eligible: false,
  ...input,
});

beforeEach(() => {
  resetInterimVoiceCalloutsForTest();
  runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests();
});

describe("text_to_speech.speak_text lane", () => {
  it("returns a non-terminal playback receipt and client handoff observation", async () => {
    const result = await runTextToSpeechSpeakText({
      provider: buildProvider("codex"),
      request: request({ requested_backend_provider: "text_to_speech.elevenlabs" }),
      env: { HELIX_TTS_CLIENT_RECEIPT_WAIT_MS: "0" } as NodeJS.ProcessEnv,
    });

    expect(result).toMatchObject({
      schema: "helix.text_to_speech.one_shot_result.v1",
      ok: true,
      lane_id: "text_to_speech",
      capability: "text_to_speech.speak_text",
      selected_runtime_agent_provider: "codex",
      reentry_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.lane_resolve_trace).toMatchObject({
      requested_lane: "text_to_speech",
      requested_backend_provider: "text_to_speech.elevenlabs",
      selected_backend_provider: "text_to_speech.existing_voice_service",
      selection_reason: "requested_backend_unconfigured_default_backend_selected_by_helix_policy",
      availability_status: "dry_run",
      permission_status: "admitted",
      execution_status: "executed_observation_only",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.receipt).toMatchObject({
      schema: "helix.text_to_speech.receipt.v1",
      lane_id: "text_to_speech",
      tool: "text_to_speech.speak_text",
      capability: "text_to_speech.speak_text",
      selected_runtime_agent_provider: "codex",
      requested_backend_provider: "text_to_speech.elevenlabs",
      selected_backend_provider: "text_to_speech.existing_voice_service",
      playback_status: "pending",
      provider_playback_status: "awaiting_client_playback",
      playback_request_ref: expect.any(String),
      client_playback_receipt_ref: null,
      audio_bytes_observed: false,
      playback_started: false,
      playback_completed: false,
      playback_failed: false,
      delivered_utterance_id: null,
      client_playback_receipt_status: null,
      delivered_at_ms: null,
      source_observation_ref: "ask:observation:source-text",
      voice_profile: "calm",
      locale: "en-US",
      reentry_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation).toBe(result.receipt);
    expect(result.observation_packet).toMatchObject({
      schema: "helix.agent_step_observation_packet.v1",
      capability_key: "text_to_speech.speak_text",
      action: "speak_text",
      status: "client_pending",
      receipts: [
        expect.objectContaining({
          receipt_ref: result.receipt?.receipt_ref,
          kind: "text_to_speech_playback",
          status: "pending",
        }),
      ],
      backend_selection_decision: expect.objectContaining({
        owner: "helix",
        outcome: "fallback_selected",
        selected_backend_provider: "text_to_speech.existing_voice_service",
        selected_runtime_provider_remains_root: true,
        backend_provider_becomes_root_agent: false,
        terminal_authority_owner: "helix",
      }),
      state_delta: {
        text_to_speech_receipt: expect.objectContaining({
          receipt_ref: result.receipt?.receipt_ref,
        }),
        text_to_speech_client_playback_handoff: expect.objectContaining({
          schema: "helix.interim_voice_callout_tool_result.v1",
          ok: true,
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
          ask_context_policy: "evidence_only",
          request: expect.objectContaining({
            voicePlaybackKind: "tool_receipt",
          }),
        }),
        voice_playback_receipt_barrier: expect.objectContaining({
          schema: "helix.voice_playback_receipt_barrier.v1",
          source: "text_to_speech_capability_lane",
          status: "awaiting_client_receipt",
          playback_status: "awaiting_client_receipt",
          request_id: expect.any(String),
          source_receipt_id: expect.any(String),
          waited_ms: 0,
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        }),
      },
      typed_handoff_contract: expect.objectContaining({
        produced_affordance_kinds: ["voice_playback_receipt"],
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.voice_playback_receipt_barrier).toMatchObject({
      status: "awaiting_client_receipt",
      playback_status: "awaiting_client_receipt",
    });
  });

  it("marks translation-sourced speak-text handoffs as translation relay playback", async () => {
    const result = await runTextToSpeechSpeakText({
      provider: buildProvider("codex"),
      request: request({
        source_observation_ref: "turn-codex-translate-read-aloud:translation",
      }),
      env: { HELIX_TTS_CLIENT_RECEIPT_WAIT_MS: "0" } as NodeJS.ProcessEnv,
    });

    expect(result.observation_packet.state_delta).toMatchObject({
      text_to_speech_client_playback_handoff: {
        request: expect.objectContaining({
          voicePlaybackKind: "translation_relay",
        }),
      },
    });
  });

  it("honors an explicit non-translation playback kind for generic speak-text requests", async () => {
    const result = await runTextToSpeechSpeakText({
      provider: buildProvider("codex"),
      request: request({
        source_observation_ref: "ask:observation:source-text",
        voice_playback_kind: "narrator_read",
      }),
      env: { HELIX_TTS_CLIENT_RECEIPT_WAIT_MS: "0" } as NodeJS.ProcessEnv,
    });

    expect(result.observation_packet.state_delta).toMatchObject({
      text_to_speech_client_playback_handoff: {
        request: expect.objectContaining({
          voicePlaybackKind: "narrator_read",
        }),
      },
    });
  });

  it("updates the lane receipt when a client playback outcome is observed", async () => {
    const resultPromise = runTextToSpeechSpeakText({
      provider: buildProvider("codex"),
      request: request({ text: "Browser delivery should re-enter as a receipt." }),
      env: { HELIX_TTS_CLIENT_RECEIPT_WAIT_MS: "1000" } as NodeJS.ProcessEnv,
    });
    await Promise.resolve();
    const [voiceRequest] = listInterimVoiceCalloutRequests({ turnId: "turn-text-to-speech", limit: 1 });
    expect(voiceRequest?.requestId).toBeTruthy();
    const outcome = recordInterimVoicePlaybackOutcome({
      requestId: voiceRequest?.requestId,
      utteranceId: "interim_voice:test-delivered",
      status: "delivered",
      provider: "helix_client_voice_playback",
      message: "Client confirmed playback.",
    });
    expect(outcome.ok).toBe(true);

    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(result.receipt).toMatchObject({
      playback_status: "played",
      provider_playback_status: "delivered",
      utterance_id: "interim_voice:test-delivered",
      client_playback_receipt_ref: expect.any(String),
      audio_ref: "interim_voice:test-delivered",
      audio_bytes_observed: true,
      playback_started: true,
      playback_completed: true,
      playback_failed: false,
      delivered_utterance_id: "interim_voice:test-delivered",
      client_playback_receipt_status: "delivered",
      playback_error: null,
    });
    expect(result.receipt?.delivered_at_ms).toEqual(expect.any(Number));
    expect(result.observation_packet).toMatchObject({
      status: "succeeded",
      observation_summary: expect.stringContaining("Text-to-speech played"),
      state_delta: {
        voice_playback_client_receipt: expect.objectContaining({
          requestId: voiceRequest?.requestId,
          status: "delivered",
        }),
        voice_playback_receipt_barrier: expect.objectContaining({
          status: "client_receipt_observed",
          playback_status: "played",
          utterance_id: "interim_voice:test-delivered",
          audio_bytes_observed: true,
          delivered_at_ms: expect.any(Number),
        }),
      },
    });
  });

  it("marks playback started without completion when the client queues playback", async () => {
    const resultPromise = runTextToSpeechSpeakText({
      provider: buildProvider("codex"),
      request: request({ text: "Browser queued playback should stay pending." }),
      env: { HELIX_TTS_CLIENT_RECEIPT_WAIT_MS: "1000" } as NodeJS.ProcessEnv,
    });
    await Promise.resolve();
    const [voiceRequest] = listInterimVoiceCalloutRequests({ turnId: "turn-text-to-speech", limit: 1 });
    expect(voiceRequest?.requestId).toBeTruthy();
    const outcome = recordInterimVoicePlaybackOutcome({
      requestId: voiceRequest?.requestId,
      utteranceId: "interim_voice:test-queued",
      status: "queued",
      provider: "helix_client_voice_playback",
      message: "Client queued playback.",
    });
    expect(outcome.ok).toBe(true);

    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(result.receipt).toMatchObject({
      playback_status: "pending",
      provider_playback_status: "queued",
      utterance_id: "interim_voice:test-queued",
      client_playback_receipt_ref: expect.any(String),
      audio_ref: null,
      audio_bytes_observed: false,
      playback_started: true,
      playback_completed: false,
      playback_failed: false,
      delivered_utterance_id: null,
      client_playback_receipt_status: "queued",
      playback_error: null,
    });
    expect(result.observation_packet).toMatchObject({
      status: "client_pending",
      observation_summary: expect.stringContaining("Text-to-speech pending client playback receipt"),
      state_delta: {
        voice_playback_receipt_barrier: expect.objectContaining({
          status: "client_receipt_observed",
          playback_status: "pending",
          utterance_id: "interim_voice:test-queued",
          audio_bytes_observed: false,
          delivered_at_ms: null,
        }),
      },
    });
  });

  it("defers capability-lane TTS to client playback when server TTS memory admission is blocked", async () => {
    const mib = 1024 * 1024;
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
      memoryReader: () => ({
        heapTotal: 700 * mib,
        heapUsed: 900 * mib,
        rss: 900 * mib,
        external: 0,
        arrayBuffers: 0,
      }),
      hostMemoryReader: () => ({
        freeMiB: 16_000,
        totalMiB: 32_000,
        freeRatio: 0.5,
      }),
    });

    const result = await runTextToSpeechSpeakText({
      provider: buildProvider("codex"),
      request: request({ text: "Memory pressure should still create a browser handoff." }),
      env: { HELIX_TTS_CLIENT_RECEIPT_WAIT_MS: "0" } as NodeJS.ProcessEnv,
    });

    expect(result.ok).toBe(true);
    expect(result.receipt).toMatchObject({
      playback_status: "pending",
      provider_playback_status: "awaiting_client_playback",
      playback_started: false,
      playback_completed: false,
      playback_failed: false,
      delivered_utterance_id: null,
      client_playback_receipt_status: null,
      playback_error: null,
    });
    expect(result.observation_packet).toMatchObject({
      status: "client_pending",
      state_delta: {
        text_to_speech_client_playback_handoff: expect.objectContaining({
          receipt: expect.objectContaining({
            status: "awaiting_client_playback",
            delivery: expect.objectContaining({
              blockedReason: "heap_used_limit",
              playbackAuthority: "client_runtime_required",
              playbackStatus: "awaiting_client_receipt",
            }),
          }),
        }),
        voice_playback_receipt_barrier: expect.objectContaining({
          status: "awaiting_client_receipt",
          playback_status: "awaiting_client_receipt",
        }),
      },
    });
    expect(result.error).toBeUndefined();
  });

  it("keeps translation relay TTS on the client handoff path under memory pressure", async () => {
    const mib = 1024 * 1024;
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
      memoryReader: () => ({
        heapTotal: 700 * mib,
        heapUsed: 900 * mib,
        rss: 900 * mib,
        external: 0,
        arrayBuffers: 0,
      }),
      hostMemoryReader: () => ({
        freeMiB: 16_000,
        totalMiB: 32_000,
        freeRatio: 0.5,
      }),
    });

    const result = await runTextToSpeechSpeakText({
      provider: buildProvider("codex"),
      request: request({
        text: "La navegacion esta lista para la siguiente ventana de ignicion.",
        source_observation_ref: "turn-codex-translate-read-aloud:translation",
      }),
      env: { HELIX_TTS_CLIENT_RECEIPT_WAIT_MS: "0" } as NodeJS.ProcessEnv,
    });

    expect(result.ok).toBe(true);
    expect(result.receipt).toMatchObject({
      playback_status: "pending",
      provider_playback_status: "awaiting_client_playback",
      playback_error: null,
    });
    expect(result.observation_packet).toMatchObject({
      status: "client_pending",
      state_delta: {
        text_to_speech_client_playback_handoff: expect.objectContaining({
          ok: true,
          request: expect.objectContaining({
            voicePlaybackKind: "translation_relay",
            reasonCodes: ["capability_lane_text_to_speech_speak_text"],
          }),
          receipt: expect.objectContaining({
            status: "awaiting_client_playback",
            delivery: expect.objectContaining({
              blockedReason: "heap_used_limit",
              playbackAuthority: "client_runtime_required",
              playbackStatus: "awaiting_client_receipt",
            }),
          }),
        }),
        voice_playback_receipt_barrier: expect.objectContaining({
          status: "awaiting_client_receipt",
          playback_status: "awaiting_client_receipt",
        }),
      },
    });
    expect(result.error).toBeUndefined();
  });

  it("keeps ordinary interim voice callouts queued under memory pressure", () => {
    const mib = 1024 * 1024;
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
      memoryReader: () => ({
        heapTotal: 700 * mib,
        heapUsed: 900 * mib,
        rss: 900 * mib,
        external: 0,
        arrayBuffers: 0,
      }),
      hostMemoryReader: () => ({
        freeMiB: 16_000,
        totalMiB: 32_000,
        freeRatio: 0.5,
      }),
    });

    const result = recordInterimVoiceCalloutRequest({
      turnId: "turn-ordinary-callout-pressure",
      threadId: "thread-ordinary-callout-pressure",
      source: "ask_tool_loop",
      kind: "tool_result",
      text: "Ordinary callout should still queue.",
      voicePlaybackKind: "tool_receipt",
      reasonCodes: ["ordinary_interim_callout"],
    });

    expect(result.receipt).toMatchObject({
      status: "queued_for_retry",
      delivery: expect.objectContaining({
        blockedReason: "heap_used_limit",
        playbackAuthority: "backend_retry_pending",
        playbackStatus: "backend_retry_pending",
      }),
    });
  });

  it("fails closed without making a voice receipt when text is missing", async () => {
    const result = await runTextToSpeechSpeakText({
      provider: buildProvider("helix"),
      request: request({ text: "   " }),
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result).toMatchObject({
      ok: false,
      error: "missing_text",
      receipt: null,
      observation: null,
      reentry_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.lane_resolve_trace).toMatchObject({
      execution_status: "not_executed_shadow_only",
      blocked_reason: "missing_text",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation_packet).toMatchObject({
      status: "missing_input",
      receipts: [],
      missing_requirements: [
        expect.objectContaining({
          code: "missing_text",
          repair_action: "provide_text",
        }),
      ],
      typed_handoff_contract: expect.objectContaining({
        produced_affordance_kinds: [],
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      }),
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    });
  });
});
