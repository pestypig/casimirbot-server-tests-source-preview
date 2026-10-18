import { beforeEach, describe, expect, it } from "vitest";
import type { HelixWorkstationGatewayCallResult } from "../../workstation-tool-gateway/types";
import {
  recordInterimVoiceCalloutRequest,
  recordInterimVoicePlaybackOutcome,
  resetInterimVoiceCalloutsForTest,
} from "../../interim-voice-callout-store";
import { waitForVoicePlaybackGatewayReceipts } from "../receipt-barrier";

const buildGatewayResult = (input: {
  requestId: string;
  receiptId: string;
  capabilityId?: string;
}): HelixWorkstationGatewayCallResult => ({
  schema: "helix.workstation_tool_gateway.call_result.v1",
  manifest_version: "test",
  ok: true,
  agent_runtime: "codex",
  capability_id: input.capabilityId ?? "text_to_speech.speak_text",
  mode: "act",
  gateway_admission: {
    schema: "helix.workstation_tool_gateway.admission.v1",
    requested_capability: input.capabilityId ?? "text_to_speech.speak_text",
    selected_agent_provider: "codex",
    permission_profile: "act",
    admission_status: "admitted",
    admission_reason: "test",
    assistant_answer: false,
    raw_content_included: false,
  },
  observation_packet: {
    schema: "helix.agent_step_observation_packet.v1",
    turn_id: "turn:voice-barrier",
    iteration: 0,
    call_id: "call:voice-barrier",
    decision_id: "decision:voice-barrier",
    capability_key: input.capabilityId ?? "text_to_speech.speak_text",
    panel_id: "voice-delivery",
    action: "speak_text",
    status: "succeeded",
    produced_artifact_refs: [],
    observation_summary: "Voice handoff awaiting client receipt.",
    receipts: [],
    missing_requirements: [],
    backend_selection_decision: {
      requested_backend_provider: null,
      selected_backend_provider: "existing_voice_service",
      selection_reason: "test",
      available_backend_providers: ["existing_voice_service"],
      blocked_backend_providers: [],
    },
    state_delta: {},
    suggested_next_steps: ["answer"],
    produced_affordances: [],
    consumed_affordances: [],
    terminal_eligible: false,
    post_tool_model_step_required: true,
    assistant_answer: false,
    raw_content_included: false,
  },
  tool_lifecycle_trace: {
    schema: "helix.tool_lifecycle_trace.v1",
    requested_capability: input.capabilityId ?? "text_to_speech.speak_text",
    admitted_capability: input.capabilityId ?? "text_to_speech.speak_text",
    executed_capability: input.capabilityId ?? "text_to_speech.speak_text",
    lifecycle_stage: "executed",
    status: "succeeded",
    observation_refs: [],
    receipt_refs: [input.receiptId],
    evidence_refs: [input.requestId],
    failure_reason: null,
    retry_recommendation: "none",
    fallback_used: false,
    fallback_equivalent: false,
    terminal_eligible: false,
    assistant_answer: false,
    raw_content_included: false,
  },
  tool_followup_decision: {
    schema: "helix.tool_followup_decision.v1",
    decision: "continue_reasoning",
    observation_summary: "Voice handoff awaiting client receipt.",
    external_change_required: false,
    terminal_blockers: [],
    required_surface_satisfied: false,
    evidence_reentered: false,
    assistant_answer: false,
    raw_content_included: false,
  },
  observation: {
    receipt: {
      requestId: input.requestId,
      receiptId: input.receiptId,
      playback_status: "awaiting_client_receipt",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    },
    host_projection: {
      request_id: input.requestId,
      receipt_id: input.receiptId,
      normalized_playback_status: "awaiting_client_receipt",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    },
  },
  artifact_refs: [],
  terminal_eligible: false,
  post_tool_model_step_required: true,
  assistant_answer: false,
  raw_content_included: false,
});

describe("voice playback receipt barrier", () => {
  beforeEach(() => {
    resetInterimVoiceCalloutsForTest();
  });

  it("updates a voice gateway result when a delivered client receipt exists", async () => {
    const backend = recordInterimVoiceCalloutRequest({
      turnId: "turn:voice-barrier-delivered",
      threadId: "thread:voice-barrier",
      kind: "tool_result",
      text: "barrier delivered",
      voicePlaybackKind: "tool_receipt",
    });
    recordInterimVoicePlaybackOutcome({
      requestId: backend.request.requestId,
      sourceReceiptId: backend.receipt.receiptId,
      utteranceId: "interim_voice:barrier-delivered",
      status: "delivered",
      provider: "test_browser_voice_playback",
    });
    const result = buildGatewayResult({
      requestId: backend.request.requestId,
      receiptId: backend.receipt.receiptId,
    });

    await waitForVoicePlaybackGatewayReceipts([result], { timeoutMs: 1 });

    expect(result.observation).toMatchObject({
      receipt: {
        playback_status: "delivered",
        audio_bytes_observed: true,
        utterance_id: "interim_voice:barrier-delivered",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      host_projection: {
        normalized_playback_status: "delivered",
        audio_bytes_observed: true,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(result).toMatchObject({
      tool_followup_decision: {
        observation_summary: expect.stringContaining("Voice playback client receipt delivered"),
        required_surface_satisfied: true,
        evidence_reentered: true,
        terminal_blockers: [],
      },
      voice_playback_receipt_barrier: {
        status: "client_receipt_observed",
        playback_status: "delivered",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("treats a client queued receipt as an observed handoff without claiming audio bytes", async () => {
    const backend = recordInterimVoiceCalloutRequest({
      turnId: "turn:voice-barrier-queued",
      threadId: "thread:voice-barrier",
      kind: "tool_result",
      text: "barrier queued",
      voicePlaybackKind: "tool_receipt",
    });
    recordInterimVoicePlaybackOutcome({
      requestId: backend.request.requestId,
      sourceReceiptId: backend.receipt.receiptId,
      utteranceId: "interim_voice:barrier-queued",
      status: "queued",
      provider: "test_browser_voice_playback",
    });
    const result = buildGatewayResult({
      requestId: backend.request.requestId,
      receiptId: backend.receipt.receiptId,
    });

    await waitForVoicePlaybackGatewayReceipts([result], { timeoutMs: 1 });

    expect(result.observation).toMatchObject({
      receipt: {
        playback_status: "queued",
        audio_bytes_observed: false,
      },
      host_projection: {
        normalized_playback_status: "queued",
        audio_bytes_observed: false,
      },
    });
    expect(result.tool_followup_decision).toMatchObject({
      observation_summary: expect.stringContaining("Voice playback client receipt queued"),
      required_surface_satisfied: true,
      evidence_reentered: true,
      terminal_blockers: [],
    });
  });

  it("records a timeout barrier when the client receipt does not arrive", async () => {
    const backend = recordInterimVoiceCalloutRequest({
      turnId: "turn:voice-barrier-timeout",
      threadId: "thread:voice-barrier",
      kind: "tool_result",
      text: "barrier timeout",
      voicePlaybackKind: "tool_receipt",
    });
    const result = buildGatewayResult({
      requestId: backend.request.requestId,
      receiptId: backend.receipt.receiptId,
    });

    await waitForVoicePlaybackGatewayReceipts([result], { timeoutMs: 1 });

    expect(result).toMatchObject({
      tool_followup_decision: {
        observation_summary: expect.stringContaining("Voice playback client receipt timed out"),
        required_surface_satisfied: false,
        evidence_reentered: false,
        terminal_blockers: ["voice_playback_client_receipt_timeout"],
      },
      voice_playback_receipt_barrier: {
        status: "client_receipt_timeout",
        playback_status: "awaiting_client_receipt",
        request_id: backend.request.requestId,
        source_receipt_id: backend.receipt.receiptId,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });
});
