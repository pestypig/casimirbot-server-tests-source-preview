import { describe, expect, it } from "vitest";
import { dispatchAgentChatSteering, dispatchExactChatSteering } from "../exact-chat-steering-dispatch";
import type { HelixLocalSupervisorPresence } from
  "@shared/helix-local-supervisor-coordination";
import {
  HelixReasoningTaskBindingError,
  HelixReasoningTaskBindingStore,
} from "../reasoning-task-binding-store";

const presence = (overrides: Partial<HelixLocalSupervisorPresence> = {}): HelixLocalSupervisorPresence => ({
  schema: "helix.local_supervisor_coordination.v1",
  service_instance_ref: "service-current",
  client_session_ref: "client-session-current",
  conversation_thread_ref: "provider-thread-private",
  authenticated_profile_ref: "profile-current",
  authenticated_mcp_client_ref: "mcp-client-current",
  declared_objective_summary: "Await operator steering",
  declared_objective_is_verified: false,
  lifecycle_basis: "authenticated_client_heartbeat",
  lifecycle_state: "active",
  thread_observability_bridge: {
    supported_levels: ["tool_activity_only", "checkpoint_publish", "continuation_ready"],
    requested_level: "continuation_ready",
    checkpoint_publication: {
      freshness_window_seconds: 120,
      retention: "current_session",
      revocation: "independent",
    },
    declaration_basis: "authenticated_client_declaration",
    provider_thread_content_included: false,
    hidden_reasoning_included: false,
    answer_authority: false,
    terminal_eligible: false,
  },
  resource_claims: [],
  room_ref: null,
  environment_ref: null,
  run_ref: null,
  verified_room_identity: null,
  verified_connector_identity: null,
  verified_retained_runtime_identity: null,
  verified_execution_lease_identity: null,
  blocker_summary: null,
  observed_at: "2026-09-01T12:00:00.000Z",
  heartbeat_expires_at: "2026-09-01T12:05:00.000Z",
  active: true,
  credential_included: false,
  private_endpoint_included: false,
  hidden_reasoning_included: false,
  native_account_identity_included: false,
  content_role: "supervisor_presence_advisory",
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
  ...overrides,
});

const setup = () => {
  let now = new Date("2026-09-01T12:00:00.000Z");
  const entries = [presence()];
  const store = new HelixReasoningTaskBindingStore({
    serviceInstanceRef: "service-current",
    listPresence: () => entries,
  }, () => now);
  return {
    store,
    entries,
    advance(seconds: number) {
      now = new Date(now.getTime() + seconds * 1_000);
    },
  };
};

const issueAndClaim = (store: HelixReasoningTaskBindingStore) => {
  const issued = store.issueClaim({
    profileRef: "profile-current",
    clientSessionRef: "client-session-current",
    helixConversationId: "helix-conversation-current",
    missionId: "mission-current",
    runId: "run-current",
  });
  const binding = store.claim({
    profileRef: "profile-current",
    authenticatedMcpClientRef: "mcp-client-current",
    clientSessionRef: "client-session-current",
    claimHandle: issued.claim_handle,
  });
  return { issued, binding };
};

describe("HelixReasoningTaskBindingStore", () => {
  it("O2 preserves a healthy binding and its epoch when a replacement fails validation", () => {
    const { store } = setup();
    const { binding } = issueAndClaim(store);
    const replacement = { profileRef: "profile-current", clientSessionRef: "client-session-current",
      helixConversationId: "helix-conversation-current", missionId: "mission-current", runId: "run-current" };
    for (const change of [{ missionId: "x" }, { runId: "invalid\nrun" }, { expiresInSeconds: Number.NaN }]) {
      expect(() => store.issueClaim({ ...replacement, ...change })).toThrow();
      expect(store.inspect({ profileRef: "profile-current", bindingId: binding.reasoning_binding_id }))
        .toEqual(binding);
    }
    const event = store.dispatch({ profileRef: "profile-current", bindingId: binding.reasoning_binding_id,
      bindingEpoch: binding.binding_epoch, clientEventRef: "after-invalid-replacement", origin: "typed",
      instructionText: "Report the current connection status." });
    expect(event.reasoning_binding_id).toBe(binding.reasoning_binding_id);
    const valid = store.issueClaim(replacement);
    expect(valid.binding.binding_epoch).toBe(binding.binding_epoch + 1);
  });

  it("labels agent ingress truthfully and rejects origin or target substitution", () => {
    const { store } = setup();
    const { binding } = issueAndClaim(store);
    const actor = { profileRef: "profile-current", authenticatedMcpClientRef: "mcp-client-current",
      clientSessionRef: "client-session-current", clientContinuationRef: "provider-thread-private",
      bindingId: binding.reasoning_binding_id, bindingEpoch: binding.binding_epoch,
      helixConversationId: "helix-conversation-current", missionId: "mission-current", runId: "run-current" };
    const request = { reasoning_binding_id: actor.bindingId, binding_epoch: actor.bindingEpoch,
      helix_conversation_id: actor.helixConversationId, run_id: actor.runId,
      client_event_ref: "agent-request", instruction_text: "Inspect the platform" };
    expect(() => dispatchAgentChatSteering(actor, { ...request, origin: "typed" }, store)).toThrow();
    expect(() => dispatchExactChatSteering(actor.profileRef, { ...request, origin: "agent_submitted" }, store)).toThrow();
    for (const change of [{ run_id: "foreign-run" }, { binding_epoch: 999 },
      { helix_conversation_id: "foreign-chat" }]) {
      expect(() => dispatchAgentChatSteering(actor, { ...request, ...change }, store)).toThrow();
    }
    expect(() => dispatchAgentChatSteering({ ...actor, clientContinuationRef: "foreign-task" }, request, store)).toThrow();
    expect(store.read(actor)).toHaveLength(0);
    const first = dispatchAgentChatSteering(actor, request, store);
    expect(dispatchAgentChatSteering(actor, request, store)).toEqual(first);
    const deliveries = store.read(actor);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ content_role: "agent_steering_advisory_not_execution",
      event: { origin: "agent_submitted", answer_authority: false, execution_requested: false } });
    expect(store.readForChatDisplay(actor)).toEqual(deliveries);
    expect(store.readForChatDisplay(actor)[0].event.delivery_state).toBe("pending");
    expect(store.readForChatDisplay({ ...actor, afterCursor: first.event.cursor })).toEqual([]);
    for (const change of [{ profileRef: "foreign-profile" }, { runId: null },
      { helixConversationId: "foreign-chat" }, { bindingEpoch: 999 }]) {
      expect(() => store.readForChatDisplay({ ...actor, ...change })).toThrow();
    }
    store.revoke({ profileRef: actor.profileRef, bindingId: actor.bindingId });
    expect(() => store.readForChatDisplay(actor)).toThrow("reasoning_binding_revoked");
    expect(() => dispatchAgentChatSteering(actor, request, store)).toThrow("reasoning_binding_revoked");
  });

  it.each([false, true])("replay preserves deadline and terminal delivery state (acknowledged=%s)", (acknowledged) => {
    const { store, advance } = setup();
    const { binding } = issueAndClaim(store);
    const input = { profileRef: "profile-current", bindingId: binding.reasoning_binding_id,
      bindingEpoch: binding.binding_epoch, clientEventRef: "expiry-replay",
      origin: "typed" as const, instructionText: "Inspect the platform", expiresInSeconds: 30 };
    const first = store.dispatch(input);
    const target = { profileRef: input.profileRef, bindingId: input.bindingId,
      bindingEpoch: input.bindingEpoch, clientSessionRef: "client-session-current" };
    if (acknowledged) store.acknowledge({ ...target, eventRef: first.steering_event_ref });
    advance(30);
    const replay = store.dispatch(input);
    expect(replay).toMatchObject({ steering_event_ref: first.steering_event_ref,
      cursor: first.cursor, created_at: first.created_at, expires_at: first.expires_at,
      delivery_state: acknowledged ? "acknowledged" : "expired",
      execution_requested: false, answer_authority: false, terminal_eligible: false });
    expect(replay).toEqual(store.inspectEvent({ ...target, eventRef: first.steering_event_ref }));
    expect(store.read(target)).toHaveLength(1);
    expect(store.read(target)[0].event).toEqual(replay);
    expect(() => store.acknowledge({ ...target, eventRef: first.steering_event_ref }))
      .toThrow("reasoning_steering_expired");
  });

  it("resolves only the exact owned preparation target without mutating the binding", () => {
    const { store, entries } = setup();
    const { binding } = issueAndClaim(store);
    entries.unshift(presence({ client_session_ref: "other-session",
      conversation_thread_ref: "other-task" }));
    const input = { profileRef: "profile-current", bindingId: binding.reasoning_binding_id,
      bindingEpoch: binding.binding_epoch, helixConversationId: "helix-conversation-current",
      missionId: "mission-current", runId: "run-current" };
    for (let index = 0; index < 3; index++) {
      expect(store.resolveOwnedPreparationTarget(input)).toEqual({ ...input,
        authenticatedMcpClientRef: "mcp-client-current", clientSessionRef: "client-session-current",
        clientContinuationRef: "provider-thread-private" });
    }
    expect(store.inspect({ profileRef: input.profileRef, bindingId: input.bindingId })).toEqual(binding);
    for (const change of [{ profileRef: "other-profile" }, { bindingEpoch: 999 },
      { helixConversationId: "other-chat" }, { runId: "other-run" }, { missionId: null }]) {
      expect(() => store.resolveOwnedPreparationTarget({ ...input, ...change })).toThrow(HelixReasoningTaskBindingError);
    }
    store.revoke({ profileRef: input.profileRef, bindingId: input.bindingId });
    expect(() => store.resolveOwnedPreparationTarget(input)).toThrow("reasoning_binding_revoked");
  });

  it("cannot substitute another task or expired presence for an owner preparation target", () => {
    const { store, entries, advance } = setup();
    const { binding } = issueAndClaim(store);
    const input = { profileRef: "profile-current", bindingId: binding.reasoning_binding_id,
      bindingEpoch: binding.binding_epoch, helixConversationId: "helix-conversation-current",
      missionId: "mission-current", runId: "run-current" };
    entries[0] = presence({ conversation_thread_ref: "other-task" });
    expect(() => store.resolveOwnedPreparationTarget(input)).toThrow("reasoning_binding_target_inactive");
    entries[0] = presence();
    advance(300);
    expect(() => store.resolveOwnedPreparationTarget(input)).toThrow("reasoning_binding_target_inactive");
  });

  it("keeps a chat-only claim active without treating a later declared run as bound", () => {
    const { store, entries } = setup();
    // Reproduce the browser claim, which currently omits mission/run identity.
    const issued = store.issueClaim({
      profileRef: "profile-current",
      clientSessionRef: "client-session-current",
      helixConversationId: "helix-conversation-current",
    });
    const binding = store.claim({
      profileRef: "profile-current",
      authenticatedMcpClientRef: "mcp-client-current",
      clientSessionRef: "client-session-current",
      claimHandle: issued.claim_handle,
    });
    const input = {
      profileRef: "profile-current", authenticatedMcpClientRef: "mcp-client-current",
      clientSessionRef: "client-session-current", clientContinuationRef: "provider-thread-private",
      bindingId: binding.reasoning_binding_id, bindingEpoch: binding.binding_epoch,
      helixConversationId: "helix-conversation-current", missionId: null, runId: null,
    };
    expect(store.verifyTaskAssociation(input)).toMatchObject({
      status: "active", mission_id: null, run_id: null, execution_authority: false,
    });
    entries[0] = presence({ run_ref: "run-current" });
    expect(() => store.verifyTaskAssociation({ ...input, runId: "run-current" }))
      .toThrow("reasoning_binding_task_association_mismatch");
    // A rejected environment association must not consume or revoke chat binding.
    expect(store.verifyTaskAssociation(input)).toMatchObject({
      status: "active", run_id: null, binding_epoch: binding.binding_epoch,
    });
  });

  it("verifies the exact live task association without granting execution", () => {
    const { store, advance } = setup();
    const { binding } = issueAndClaim(store);
    const input = { profileRef: "profile-current", authenticatedMcpClientRef: "mcp-client-current",
      clientSessionRef: "client-session-current", clientContinuationRef: "provider-thread-private",
      bindingId: binding.reasoning_binding_id, bindingEpoch: binding.binding_epoch,
      helixConversationId: "helix-conversation-current", missionId: "mission-current", runId: "run-current" };
    expect(store.verifyTaskAssociation(input)).toMatchObject({ execution_authority: false, answer_authority: false, terminal_eligible: false });
    for (const patch of [
      { profileRef: "profile-other" }, { authenticatedMcpClientRef: "mcp-other" },
      { clientSessionRef: "session-other" }, { clientContinuationRef: "thread-other" },
      { bindingEpoch: binding.binding_epoch + 1 }, { helixConversationId: "helix-other" },
      { missionId: null }, { runId: null }, { runId: "run-other" },
    ]) expect(() => store.verifyTaskAssociation({ ...input, ...patch })).toThrow(HelixReasoningTaskBindingError);
    advance(300);
    expect(() => store.verifyTaskAssociation(input)).toThrow("reasoning_binding_target_inactive");
  });

  it("rejects another continuation in the same client session before pickup or acknowledgement", () => {
    const { store, entries } = setup();
    const { binding } = issueAndClaim(store);
    entries.push(presence({ conversation_thread_ref: "provider-thread-other" }));
    const task = { profileRef: "profile-current", authenticatedMcpClientRef: "mcp-client-current",
      clientSessionRef: "client-session-current", clientContinuationRef: "provider-thread-private",
      bindingId: binding.reasoning_binding_id, bindingEpoch: binding.binding_epoch,
      helixConversationId: "helix-conversation-current", missionId: "mission-current", runId: "run-current" };
    const event = store.dispatch({ profileRef: task.profileRef, bindingId: task.bindingId,
      bindingEpoch: task.bindingEpoch, clientEventRef: "voice-final:exact-pickup",
      origin: "gpt_live_finalized", instructionText: "Inspect this mission." });
    for (const wrong of [{ clientContinuationRef: "provider-thread-other" },
      { helixConversationId: "helix-conversation-other" }, { missionId: "mission-other" },
      { runId: "run-other" }, { bindingEpoch: binding.binding_epoch + 1 }]) {
      expect(() => store.readForTask({ ...task, ...wrong })).toThrow(HelixReasoningTaskBindingError);
      expect(() => store.acknowledgeForTask({ ...task, ...wrong,
        eventRef: event.steering_event_ref })).toThrow(HelixReasoningTaskBindingError);
      expect(store.inspectEvent({ ...task, eventRef: event.steering_event_ref }).delivery_state).toBe("pending");
    }
    expect(store.readForTask(task)).toMatchObject([{ event: { steering_event_ref: event.steering_event_ref } }]);
    expect(store.acknowledgeForTask({ ...task, eventRef: event.steering_event_ref }).delivery_state)
      .toBe("acknowledged");
    store.revoke({ profileRef: task.profileRef, bindingId: task.bindingId });
    expect(() => store.readForTask(task)).toThrow("reasoning_binding_revoked");
  });

  it("does not validate an association after revoke or a presence capability loss", () => {
    const { store, entries } = setup();
    const { binding } = issueAndClaim(store);
    const input = { profileRef: "profile-current", authenticatedMcpClientRef: "mcp-client-current",
      clientSessionRef: "client-session-current", clientContinuationRef: "provider-thread-private",
      bindingId: binding.reasoning_binding_id, bindingEpoch: binding.binding_epoch,
      helixConversationId: "helix-conversation-current", missionId: "mission-current", runId: "run-current" };
    entries[0] = presence({ thread_observability_bridge: null });
    expect(() => store.verifyTaskAssociation(input)).toThrow("reasoning_binding_target_inactive");
    entries[0] = presence();
    store.revoke({ profileRef: input.profileRef, bindingId: input.bindingId });
    expect(() => store.verifyTaskAssociation(input)).toThrow("reasoning_binding_revoked");
  });

  it("claims a show-once handle only from the exact authenticated task", () => {
    const { store } = setup();
    const issued = store.issueClaim({
      profileRef: "profile-current",
      clientSessionRef: "client-session-current",
      helixConversationId: "helix-conversation-current",
    });
    expect(issued.binding).toMatchObject({
      status: "pending_claim",
      continuation_transport: "polling",
      negotiated_observability_level: "continuation_ready",
      provider_thread_content_included: false,
      hidden_reasoning_included: false,
    });
    expect(JSON.stringify(issued.binding)).not.toContain("provider-thread-private");
    expect(issued.claim_handle).toMatch(
      /^reasoning_claim:[a-f0-9]{16}:[A-Za-z0-9_-]{32}$/u,
    );
    expect(() => store.claim({
      profileRef: "profile-current",
      authenticatedMcpClientRef: "mcp-client-wrong",
      clientSessionRef: "client-session-current",
      claimHandle: issued.claim_handle,
    })).toThrowError(expect.objectContaining({ code: "reasoning_binding_identity_mismatch" }));
    expect(store.claim({
      profileRef: "profile-current",
      authenticatedMcpClientRef: "mcp-client-current",
      clientSessionRef: "client-session-current",
      claimHandle: issued.claim_handle,
    }).status).toBe("active");
    expect(() => store.claim({
      profileRef: "profile-current",
      authenticatedMcpClientRef: "mcp-client-current",
      clientSessionRef: "client-session-current",
      claimHandle: issued.claim_handle,
    })).toThrowError(expect.objectContaining({ code: "reasoning_binding_claim_invalid" }));
  });

  it("distinguishes a prior service-epoch claim without retaining its handle", () => {
    const first = setup();
    const issued = first.store.issueClaim({
      profileRef: "profile-current",
      clientSessionRef: "client-session-current",
      helixConversationId: "helix-conversation-current",
    });
    const nextPresence = presence({ service_instance_ref: "service-next" });
    const replacement = new HelixReasoningTaskBindingStore({
      serviceInstanceRef: "service-next",
      listPresence: () => [nextPresence],
    });

    expect(() => replacement.claim({
      profileRef: "profile-current",
      authenticatedMcpClientRef: "mcp-client-current",
      clientSessionRef: "client-session-current",
      claimHandle: issued.claim_handle,
    })).toThrowError(expect.objectContaining({
      code: "reasoning_binding_claim_service_epoch_mismatch",
      status: 409,
    }));
  });

  it("deduplicates dispatch and exposes text only to the exact bound task", () => {
    const { store } = setup();
    const { binding } = issueAndClaim(store);
    const first = store.dispatch({
      profileRef: "profile-current",
      bindingId: binding.reasoning_binding_id,
      bindingEpoch: binding.binding_epoch,
      clientEventRef: "voice-final-001",
      origin: "gpt_live_finalized",
      instructionText: "Walk to the marked Minecraft waypoint.",
    });
    const replay = store.dispatch({
      profileRef: "profile-current",
      bindingId: binding.reasoning_binding_id,
      bindingEpoch: binding.binding_epoch,
      clientEventRef: "voice-final-001",
      origin: "gpt_live_finalized",
      instructionText: "Walk to the marked Minecraft waypoint.",
    });
    expect(replay).toEqual(first);
    for (const change of [{ instructionText: "Different instruction" },
      { origin: "typed" as const }, { expiresInSeconds: 300 }]) {
      expect(() => store.dispatch({ profileRef: "profile-current",
        bindingId: binding.reasoning_binding_id, bindingEpoch: binding.binding_epoch,
        clientEventRef: "voice-final-001", origin: "gpt_live_finalized",
        instructionText: "Walk to the marked Minecraft waypoint.", ...change,
      })).toThrowError(expect.objectContaining({ code: "reasoning_steering_request_conflict" }));
    }
    expect(JSON.stringify(first)).not.toContain("Minecraft waypoint");
    expect(() => store.dispatch({
      profileRef: "profile-current",
      bindingId: binding.reasoning_binding_id,
      bindingEpoch: binding.binding_epoch + 1,
      clientEventRef: "stale-epoch-event",
      origin: "typed",
      instructionText: "This stale event must fail closed.",
    })).toThrowError(expect.objectContaining({ code: "reasoning_binding_epoch_mismatch" }));
    expect(() => store.read({
      profileRef: "profile-current",
      clientSessionRef: "client-session-wrong",
      bindingId: binding.reasoning_binding_id,
      bindingEpoch: binding.binding_epoch,
    })).toThrowError(expect.objectContaining({ code: "reasoning_binding_identity_mismatch" }));
    const [delivery] = store.read({
      profileRef: "profile-current",
      clientSessionRef: "client-session-current",
      bindingId: binding.reasoning_binding_id,
      bindingEpoch: binding.binding_epoch,
    });
    expect(delivery.instruction_text).toBe("Walk to the marked Minecraft waypoint.");
    expect(delivery.event.delivery_state).toBe("pending");
    expect(store.acknowledge({
      profileRef: "profile-current",
      clientSessionRef: "client-session-current",
      bindingId: binding.reasoning_binding_id,
      bindingEpoch: binding.binding_epoch,
      eventRef: delivery.event.steering_event_ref,
    }).delivery_state).toBe("acknowledged");
    expect(store.inspectEvent({
      profileRef: "profile-current",
      bindingId: binding.reasoning_binding_id,
      bindingEpoch: binding.binding_epoch,
      eventRef: delivery.event.steering_event_ref,
    })).toMatchObject({
      delivery_state: "acknowledged",
      instruction_sha256: delivery.event.instruction_sha256,
      provider_thread_content_included: false,
      hidden_reasoning_included: false,
      answer_authority: false,
    });
    expect(JSON.stringify(store.inspectEvent({
      profileRef: "profile-current",
      bindingId: binding.reasoning_binding_id,
      bindingEpoch: binding.binding_epoch,
      eventRef: delivery.event.steering_event_ref,
    }))).not.toContain("Minecraft waypoint");
  });

  it("rejects expired claims and revoked pickup", () => {
    const harness = setup();
    const issued = harness.store.issueClaim({
      profileRef: "profile-current",
      clientSessionRef: "client-session-current",
      helixConversationId: "helix-conversation-expiring",
      expiresInSeconds: 30,
    });
    harness.advance(31);
    expect(() => harness.store.claim({
      profileRef: "profile-current",
      authenticatedMcpClientRef: "mcp-client-current",
      clientSessionRef: "client-session-current",
      claimHandle: issued.claim_handle,
    })).toThrowError(HelixReasoningTaskBindingError);

    const { binding } = issueAndClaim(harness.store);
    harness.store.revoke({
      profileRef: "profile-current",
      bindingId: binding.reasoning_binding_id,
    });
    expect(() => harness.store.read({
      profileRef: "profile-current",
      clientSessionRef: "client-session-current",
      bindingId: binding.reasoning_binding_id,
      bindingEpoch: binding.binding_epoch,
    })).toThrowError(expect.objectContaining({ code: "reasoning_binding_revoked" }));
  });
});
