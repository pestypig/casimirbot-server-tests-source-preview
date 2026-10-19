import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HelixRealtimeStagePlayAskHandoffV1 } from
  "@shared/contracts/helix-realtime-stage-play.v1";
import {
  publishRealtimeSidebandProviderEvent,
  setRealtimeSidebandControlSenderForTests,
} from "../sideband-control-channel";
import {
  readRealtimeProvisionalResponse,
  requestRealtimeProvisionalResponse,
  resetRealtimeProvisionalResponsesForTests,
} from "../provisional-response";
import {
  admitRealtimeSession,
  resetRealtimeSessionRegistryForTests,
  updateAdmittedRealtimeSession,
} from "../session-registry";

const buildHandoff = (input: {
  suffix: string;
  outcome?: "conversation_local" | "worker_grounded" | "action_candidate";
  interactionMode?: "conversation_local" | "parallel_conversation" | "worker_required";
  selectedRoute?: string | null;
  requiredCapabilityIds?: string[];
}): HelixRealtimeStagePlayAskHandoffV1 => {
  const handoffId = `realtime-stage-play-handoff:${input.suffix}`;
  const outcome = input.outcome ?? "worker_grounded";
  const dispatchKind = outcome === "conversation_local"
    ? "none"
    : outcome === "action_candidate"
      ? "ask_runtime_read_only"
      : "ask_runtime";
  const dispatchRequested = dispatchKind !== "none";
  const interactionMode = input.interactionMode ??
    (outcome === "conversation_local" ? "conversation_local" : "worker_required");
  return {
    schema: "helix.realtime_stage_play.ask_handoff.v1",
    handoff_id: handoffId,
    realtime_session_id: "realtime:provisional-test",
    thread_id: "helix-ask:desktop",
    provider_event_ref: `provider-event:${input.suffix}`,
    transcript_observation_ref: `observation:${input.suffix}`,
    stage_play_event_ref: `stage-play:${input.suffix}`,
    context_pack_id: `context-pack:${input.suffix}`,
    context_hash: `sha256:context-${input.suffix}`,
    transcript_text_hash: `sha256:transcript-${input.suffix}`,
    transcript_text_char_count: 32,
    goal_id: null,
    runtime_goal_session_ref: null,
    runtime_agent_provider: dispatchRequested ? "codex" : null,
    required_grounding_capability_ids: input.requiredCapabilityIds ?? [],
    worker_admission: {
      schema: "helix.realtime_worker_admission.v2",
      admission_id: `worker-admission:${input.suffix}`,
      handoff_id: handoffId,
      realtime_session_id: "realtime:provisional-test",
      thread_id: "helix-ask:desktop",
      decision_phase: "transcript_handoff",
      outcome,
      interaction_mode: interactionMode,
      reason_codes: ["test_admission"],
      selected_primary_intent: "general_reasoning",
      selected_route: input.selectedRoute ?? null,
      selected_runtime_agent_provider: dispatchRequested ? "codex" : null,
      selected_model: null,
      candidate_readonly_capability_ids: input.requiredCapabilityIds ?? [],
      observed_readonly_capability_ids: [],
      action_candidate_capability_ids: outcome === "action_candidate"
        ? ["workstation.open_panel"]
        : [],
      dispatch: {
        schema: "helix.realtime_worker_dispatch.v2",
        kind: dispatchKind,
        state: dispatchRequested ? "requested" : "not_required",
        requested: dispatchRequested,
        completed: false,
        target_runtime_agent_provider: dispatchRequested ? "codex" : null,
        runtime_selection_source: dispatchRequested ? "ask_ui_selected_runtime" : "none",
        goal_id: null,
        runtime_goal_session_ref: null,
        suppress_parallel_ask_turn: outcome === "conversation_local",
        read_only: true,
        workstation_action_execution_allowed: false,
        realtime_provider_tool_execution_allowed: false,
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      worker_turn_dispatched: false,
      spoken_relay_eligible: outcome === "worker_grounded",
      workstation_action_execution_allowed: false,
      realtime_provider_tool_execution_allowed: false,
      evidence_refs: [`observation:${input.suffix}`],
      decided_at_ms: 100,
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    },
    created_at_ms: 100,
    route_metadata: {},
    read_only: true,
    transcript_is_user_intent_after_admission: true,
    reentry_required: true,
    answer_authority: false,
    assistant_answer: false,
    terminal_eligible: false,
    raw_content_included: false,
  };
};

describe("Realtime post-admission provisional responses", () => {
  beforeEach(() => {
    resetRealtimeProvisionalResponsesForTests();
    resetRealtimeSessionRegistryForTests();
    admitRealtimeSession({
      realtimeSessionId: "realtime:provisional-test",
      requesterRef: "requester:test",
      visibleUserConsentReceipt: "receipt:consent",
      model: "gpt-realtime-2.1",
      selectedRuntimeAgentProvider: "codex",
    });
    updateAdmittedRealtimeSession({
      realtimeSessionId: "realtime:provisional-test",
      patch: { sidebandState: "open" },
    });
  });

  afterEach(() => {
    setRealtimeSidebandControlSenderForTests(null);
    resetRealtimeProvisionalResponsesForTests();
    resetRealtimeSessionRegistryForTests();
  });

  it("speaks an operational status only after a worker dispatch receipt", () => {
    const sent = vi.fn(() => true);
    setRealtimeSidebandControlSenderForTests(sent);
    const handoff = buildHandoff({
      suffix: "workspace",
      requiredCapabilityIds: ["workstation.active_context"],
    });

    expect(readRealtimeProvisionalResponse(handoff.handoff_id)).toBeNull();
    const artifact = requestRealtimeProvisionalResponse({
      handoff,
      kind: "worker_dispatch_status",
      workerDispatchReceiptRef: "receipt:worker-dispatch:workspace",
    });

    expect(artifact).toMatchObject({
      kind: "worker_dispatch_status",
      status: "response_requested",
      utterance_code: "workstation_context_check_in_progress",
      requested_after_admission: true,
      requested_after_worker_dispatch_receipt: true,
      worker_dispatch_receipt_ref: "receipt:worker-dispatch:workspace",
      response_created: true,
      answer_authority: false,
      terminal_eligible: false,
    });
    const event = sent.mock.calls[0][0].event as Record<string, unknown>;
    const response = event.response as Record<string, unknown>;
    expect(response).toMatchObject({
      conversation: "none",
      metadata: {
        helix_purpose: "worker_dispatch_status",
        helix_handoff_id: handoff.handoff_id,
        helix_worker_admission_id: handoff.worker_admission.admission_id,
        helix_utterance_code: "workstation_context_check_in_progress",
        answer_authority: "none",
      },
      instructions: "Say exactly: I'm checking the current workstation view.",
    });
    expect(String(response.instructions)).not.toMatch(/sorry|apolog/i);
  });

  it("lets conversation-local turns respond without claiming a workstation check", () => {
    const sent = vi.fn(() => true);
    setRealtimeSidebandControlSenderForTests(sent);
    const handoff = buildHandoff({ suffix: "local", outcome: "conversation_local" });

    const artifact = requestRealtimeProvisionalResponse({
      handoff,
      kind: "conversation_local",
    });

    expect(artifact).toMatchObject({
      kind: "conversation_local",
      status: "response_requested",
      requested_after_admission: true,
      requested_after_worker_dispatch_receipt: false,
      worker_dispatch_receipt_ref: null,
    });
    const event = sent.mock.calls[0][0].event as Record<string, unknown>;
    const response = event.response as Record<string, unknown>;
    expect(response).not.toHaveProperty("conversation", "none");
    expect(response.metadata).toMatchObject({
      helix_purpose: "conversation_local",
      helix_handoff_id: handoff.handoff_id,
    });
    expect(String(response.instructions)).toContain(
      "Do not say you are checking the workstation because no worker was admitted",
    );
  });

  it("lets Live answer naturally while the selected runtime works in parallel", () => {
    const sent = vi.fn(() => true);
    setRealtimeSidebandControlSenderForTests(sent);
    const handoff = buildHandoff({
      suffix: "parallel",
      outcome: "worker_grounded",
      interactionMode: "parallel_conversation",
    });

    const artifact = requestRealtimeProvisionalResponse({
      handoff,
      kind: "parallel_conversation",
    });

    expect(artifact).toMatchObject({
      kind: "parallel_conversation",
      status: "response_requested",
      utterance_code: "parallel_conversation_response",
      requested_after_worker_dispatch_receipt: false,
      worker_dispatch_receipt_ref: null,
    });
    const event = sent.mock.calls[0][0].event as Record<string, unknown>;
    const response = event.response as Record<string, unknown>;
    expect(response).not.toHaveProperty("conversation", "none");
    expect(response).toMatchObject({
      metadata: {
        helix_purpose: "parallel_conversation",
        answer_authority: "none",
      },
    });
    expect(String(response.instructions)).toContain(
      "Respond naturally and directly to the latest user turn now",
    );
    expect(String(response.instructions)).toContain(
      "A workstation runtime is processing the same turn in parallel",
    );
    expect(String(response.instructions)).not.toMatch(/Say exactly|I'm checking that/i);
  });

  it("cannot turn a parallel conversation into worker-status speech", () => {
    const sent = vi.fn(() => true);
    setRealtimeSidebandControlSenderForTests(sent);
    const handoff = buildHandoff({
      suffix: "parallel-status-guard",
      outcome: "worker_grounded",
      interactionMode: "parallel_conversation",
    });

    const artifact = requestRealtimeProvisionalResponse({
      handoff,
      kind: "worker_dispatch_status",
      workerDispatchReceiptRef: "receipt:worker-dispatch:parallel-status-guard",
    });

    expect(artifact).toMatchObject({
      kind: "parallel_conversation",
      utterance_code: "parallel_conversation_response",
      requested_after_worker_dispatch_receipt: true,
    });
    const event = sent.mock.calls[0][0].event as Record<string, unknown>;
    const response = event.response as Record<string, unknown>;
    expect(response).toMatchObject({
      metadata: {
        helix_purpose: "parallel_conversation",
        helix_utterance_code: "parallel_conversation_response",
      },
    });
    expect(String(response.instructions)).not.toMatch(
      /Say exactly: I'm checking|I'm checking that with the workstation agent/i,
    );
    expect(String(response.instructions)).toContain("do not wait for it");
  });

  it("binds provider response identity without retaining provider payloads", () => {
    setRealtimeSidebandControlSenderForTests(() => true);
    const handoff = buildHandoff({ suffix: "binding", selectedRoute: "repo_code" });
    const artifact = requestRealtimeProvisionalResponse({
      handoff,
      kind: "worker_dispatch_status",
      workerDispatchReceiptRef: "receipt:worker-dispatch:binding",
    });
    publishRealtimeSidebandProviderEvent({
      realtimeSessionId: handoff.realtime_session_id,
      event: {
        type: "response.created",
        response: {
          id: "response:provisional:binding",
          metadata: {
            helix_provisional_response_id: artifact.provisional_response_id,
            helix_handoff_id: handoff.handoff_id,
          },
        },
      },
    });

    expect(readRealtimeProvisionalResponse(handoff.handoff_id)).toMatchObject({
      provider_response_ref: "response:provisional:binding",
      provider_payload_included: false,
      raw_content_included: false,
    });
  });
});
