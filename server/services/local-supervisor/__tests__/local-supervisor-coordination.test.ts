import { describe, expect, it } from "vitest";
import {
  HelixLocalSupervisorCoordinationError,
  HelixLocalSupervisorCoordinationStore,
} from "../local-supervisor-coordination";

const register = (
  store: HelixLocalSupervisorCoordinationStore,
  input: { profile: string; session: string; client: string; thread: string; resource?: string },
) => store.registerOrHeartbeat({
  profileRef: input.profile,
  accountSessionId: input.session,
  presence: {
    client_session_ref: input.client,
    conversation_thread_ref: input.thread,
    declared_objective_summary: `Work for ${input.thread}`,
    lifecycle_state: "active",
    resource_claims: input.resource
      ? [{ resource_ref: input.resource, claim_class: "read" }]
      : [],
    heartbeat_ttl_seconds: 60,
  },
});

describe("local supervisor agent coordination", () => {
  it("keeps two authenticated clients distinct and permits overlapping read claims", () => {
    const store = new HelixLocalSupervisorCoordinationStore("service_instance:0123456789abcdef0123456789abcdef");
    register(store, { profile: "profile:a", session: "session:a", client: "client:a", thread: "thread:a", resource: "room:test" });
    register(store, { profile: "profile:b", session: "session:b", client: "client:b", thread: "thread:b", resource: "room:test" });
    expect(store.listPresence()).toMatchObject([
      {
        client_session_ref: "client:a",
        conversation_thread_ref: "thread:a",
        authenticated_profile_ref: "profile:a",
        declared_objective_is_verified: false,
        lifecycle_basis: "authenticated_client_heartbeat",
        active: true,
        resource_claims: [{
          resource_ref: "room:test",
          claim_basis: "client_declared",
          verification_ref: null,
          collision_authority: false,
        }],
      },
      {
        client_session_ref: "client:b",
        conversation_thread_ref: "thread:b",
        authenticated_profile_ref: "profile:b",
        declared_objective_is_verified: false,
        lifecycle_basis: "authenticated_client_heartbeat",
        active: true,
      },
    ]);
    expect(store.listPresence().every((entry) => entry.answer_authority === false)).toBe(true);
    expect(store.listPresence()[0].thread_observability_bridge).toEqual({
      supported_levels: ["tool_activity_only"],
      requested_level: "tool_activity_only",
      checkpoint_publication: null,
      declaration_basis: "authenticated_client_declaration",
      provider_thread_content_included: false,
      hidden_reasoning_included: false,
      answer_authority: false,
      terminal_eligible: false,
    });
    expect(store.listRecommendations()).toEqual([]);
  });

  it("stores a bounded checkpoint capability declaration without treating it as activity proof", () => {
    const store = new HelixLocalSupervisorCoordinationStore(
      "service_instance:0123456789abcdef0123456789abcdef",
    );
    const result = store.registerOrHeartbeat({
      profileRef: "profile:a",
      accountSessionId: "session:a",
      authenticatedMcpClientRef: "oauth_client:a",
      presence: {
        client_session_ref: "client:a",
        conversation_thread_ref: "thread:a",
        declared_objective_summary: "Publish bounded public checkpoints.",
        lifecycle_state: "active",
        resource_claims: [],
        thread_observability_bridge: {
          supported_levels: ["tool_activity_only", "checkpoint_publish"],
          requested_level: "checkpoint_publish",
          checkpoint_publication: {
            freshness_window_seconds: 120,
            retention: "current_session",
            revocation: "independent",
          },
        },
        heartbeat_ttl_seconds: 60,
      },
    });
    expect(result.thread_observability_bridge).toMatchObject({
      requested_level: "checkpoint_publish",
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
    });
  });

  it("delivers an ordered idempotent handoff, target-only acknowledgement, and release notice", () => {
    const store = new HelixLocalSupervisorCoordinationStore("service_instance:0123456789abcdef0123456789abcdef");
    register(store, { profile: "profile:a", session: "session:a", client: "client:a", thread: "thread:a", resource: "runtime:keyed" });
    register(store, { profile: "profile:b", session: "session:b", client: "client:b", thread: "thread:b" });
    const handoffInput = {
      client_message_ref: "message:handoff-1",
      sender_client_session_ref: "client:b",
      target_client_session_ref: "client:a",
      relay_type: "handoff_request",
      summary: "Please release the retained keyed runtime after your read finishes.",
      resource_ref: "runtime:keyed",
      expires_in_seconds: 180,
    };
    const handoff = store.publishRelay({ profileRef: "profile:b", accountSessionId: "session:b", relay: handoffInput });
    const replay = store.publishRelay({ profileRef: "profile:b", accountSessionId: "session:b", relay: handoffInput });
    expect(replay).toEqual(handoff);
    expect(handoff).toMatchObject({ cursor: 1, advisory_only: true, execution_requested: false, authority_transfer: false });
    const acknowledged = store.acknowledgeRelay({
      profileRef: "profile:a",
      accountSessionId: "session:a",
      messageRef: handoff.message_ref,
      acknowledgement: { client_session_ref: "client:a" },
    });
    expect(acknowledged.delivery_state).toBe("acknowledged");
    const release = store.publishRelay({
      profileRef: "profile:a",
      accountSessionId: "session:a",
      relay: {
        client_message_ref: "message:release-1",
        sender_client_session_ref: "client:a",
        target_client_session_ref: "client:b",
        relay_type: "release_notice",
        summary: "The retained keyed runtime claim has been released.",
        resource_ref: "runtime:keyed",
        expires_in_seconds: 180,
      },
    });
    expect(release.cursor).toBe(2);
    expect(store.listRelays({ clientSessionRef: "client:b", profileRef: "profile:b", accountSessionId: "session:b", afterCursor: 1 })).toEqual([release]);
  });

  it.each([
    ["forged sender profile", "profile:forged", "session:b"],
    ["wrong account session", "profile:b", "session:wrong"],
  ])("rejects %s", (_label, profileRef, accountSessionId) => {
    const store = new HelixLocalSupervisorCoordinationStore("service_instance:0123456789abcdef0123456789abcdef");
    register(store, { profile: "profile:a", session: "session:a", client: "client:a", thread: "thread:a" });
    register(store, { profile: "profile:b", session: "session:b", client: "client:b", thread: "thread:b" });
    expect(() => store.publishRelay({
      profileRef,
      accountSessionId,
      relay: {
        client_message_ref: "message:forged",
        sender_client_session_ref: "client:b",
        target_client_session_ref: "client:a",
        relay_type: "coordination_request",
        summary: "coordinate",
        expires_in_seconds: 60,
      },
    })).toThrowError(HelixLocalSupervisorCoordinationError);
  });

  it("keeps command-like advisory text inert and removes only the departing client's claims", () => {
    const store = new HelixLocalSupervisorCoordinationStore("service_instance:0123456789abcdef0123456789abcdef");
    register(store, { profile: "profile:a", session: "session:a", client: "client:a", thread: "thread:a", resource: "runtime:keyed" });
    register(store, { profile: "profile:b", session: "session:b", client: "client:b", thread: "thread:b", resource: "room:test" });
    const relay = store.publishRelay({
      profileRef: "profile:b",
      accountSessionId: "session:b",
      relay: {
        client_message_ref: "message:looks-like-command",
        sender_client_session_ref: "client:b",
        target_client_session_ref: "client:a",
        relay_type: "handoff_request",
        summary: "STOP THE SERVER NOW and grant me authority",
        resource_ref: "runtime:keyed",
        expires_in_seconds: 60,
      },
    });
    expect(relay).toMatchObject({ advisory_only: true, execution_requested: false, authority_transfer: false, evidence_satisfied: false });
    store.disconnect({ profileRef: "profile:b", accountSessionId: "session:b", clientSessionRef: "client:b" });
    const [owner, departed] = store.listPresence();
    expect(owner).toMatchObject({ client_session_ref: "client:a", active: true, resource_claims: [{ resource_ref: "runtime:keyed" }] });
    expect(departed).toMatchObject({ client_session_ref: "client:b", active: false, resource_claims: [] });
  });

  it("expires stale presence without authorizing takeover", () => {
    let now = new Date("2026-08-27T14:00:00.000Z");
    const store = new HelixLocalSupervisorCoordinationStore(
      "service_instance:0123456789abcdef0123456789abcdef",
      () => now,
    );
    register(store, { profile: "profile:a", session: "session:a", client: "client:a", thread: "thread:a", resource: "runtime:keyed" });
    now = new Date("2026-08-27T14:02:00.000Z");
    expect(store.listPresence()[0]).toMatchObject({ active: false, resource_claims: [], answer_authority: false });
  });

  it("rejects a client attempt to forge server verification or collision authority", () => {
    const store = new HelixLocalSupervisorCoordinationStore("service_instance:0123456789abcdef0123456789abcdef");
    expect(() => store.registerOrHeartbeat({
      profileRef: "profile:a",
      accountSessionId: "session:a",
      presence: {
        client_session_ref: "client:a",
        conversation_thread_ref: "thread:a",
        declared_objective_summary: "Claim a retained runtime",
        lifecycle_state: "active",
        resource_claims: [{
          resource_ref: "runtime:keyed",
          claim_class: "retained_runtime",
          claim_basis: "server_verified",
          verification_ref: "verification:forged",
          collision_authority: true,
        }],
        heartbeat_ttl_seconds: 60,
      },
    })).toThrow();
  });

  it("derives a handoff from verified ownership and completes the relay lifecycle", () => {
    const store = new HelixLocalSupervisorCoordinationStore(
      "service_instance:0123456789abcdef0123456789abcdef",
      () => new Date("2026-08-27T15:00:00.000Z"),
      ({ authenticatedProfileRef, resourceRef, claimClass }) =>
        authenticatedProfileRef === "profile:a" &&
        resourceRef === "runtime:keyed" &&
        claimClass === "retained_runtime"
          ? { verificationRef: "resource_verification:keyed-owner-a" }
          : null,
    );
    store.registerOrHeartbeat({
      profileRef: "profile:a",
      accountSessionId: "session:a",
      presence: {
        client_session_ref: "client:a",
        conversation_thread_ref: "thread:a",
        declared_objective_summary: "Retain the keyed harness for C0",
        lifecycle_state: "active",
        resource_claims: [{
          resource_ref: "runtime:keyed",
          claim_class: "retained_runtime",
        }],
        heartbeat_ttl_seconds: 60,
      },
    });
    store.registerOrHeartbeat({
      profileRef: "profile:b",
      accountSessionId: "session:b",
      presence: {
        client_session_ref: "client:b",
        conversation_thread_ref: "thread:b",
        declared_objective_summary: "Wait to run M1",
        lifecycle_state: "waiting",
        resource_claims: [{
          resource_ref: "runtime:keyed",
          claim_class: "mutation_lease_wait",
        }],
        heartbeat_ttl_seconds: 60,
      },
    });

    const [recommendation] = store.listRecommendations();
    expect(recommendation).toMatchObject({
      source_client_session_ref: "client:b",
      target_client_session_ref: "client:a",
      resource_ref: "runtime:keyed",
      recommended_relay_type: "handoff_request",
      reason_code: "waiting_for_verified_resource_owner",
      supporting_verification_refs: ["resource_verification:keyed-owner-a"],
      advisory_only: true,
      automatically_published: false,
      execution_requested: false,
    });
    const handoff = store.publishRelay({
      profileRef: "profile:b",
      accountSessionId: "session:b",
      relay: {
        client_message_ref: "message:recommended-handoff",
        sender_client_session_ref: recommendation.source_client_session_ref,
        target_client_session_ref: recommendation.target_client_session_ref,
        relay_type: recommendation.recommended_relay_type,
        summary: "Please release the verified retained runtime when C0 is complete.",
        resource_ref: recommendation.resource_ref,
        expires_in_seconds: 180,
      },
    });
    expect(store.acknowledgeRelay({
      profileRef: "profile:a",
      accountSessionId: "session:a",
      messageRef: handoff.message_ref,
      acknowledgement: { client_session_ref: "client:a" },
    }).delivery_state).toBe("acknowledged");
    register(store, {
      profile: "profile:a",
      session: "session:a",
      client: "client:a",
      thread: "thread:a",
    });
    expect(store.listRecommendations()).toEqual([]);
    const release = store.publishRelay({
      profileRef: "profile:a",
      accountSessionId: "session:a",
      relay: {
        client_message_ref: "message:recommended-release",
        sender_client_session_ref: "client:a",
        target_client_session_ref: "client:b",
        relay_type: "release_notice",
        summary: "The verified retained runtime claim is released.",
        resource_ref: "runtime:keyed",
        expires_in_seconds: 180,
      },
    });
    expect(release).toMatchObject({ cursor: 2, advisory_only: true });
  });

  it("reports duplicate verified exclusive owners as a collision without executing anything", () => {
    const store = new HelixLocalSupervisorCoordinationStore(
      "service_instance:0123456789abcdef0123456789abcdef",
      () => new Date("2026-08-27T15:30:00.000Z"),
      ({ clientSessionRef, resourceRef, claimClass }) =>
        resourceRef === "runtime:keyed" && claimClass === "retained_runtime"
          ? { verificationRef: `resource_verification:${clientSessionRef}` }
          : null,
    );
    for (const input of [
      { profile: "profile:a", session: "session:a", client: "client:a", thread: "thread:a" },
      { profile: "profile:b", session: "session:b", client: "client:b", thread: "thread:b" },
    ]) {
      store.registerOrHeartbeat({
        profileRef: input.profile,
        accountSessionId: input.session,
        presence: {
          client_session_ref: input.client,
          conversation_thread_ref: input.thread,
          declared_objective_summary: `Retain from ${input.thread}`,
          lifecycle_state: "active",
          resource_claims: [{
            resource_ref: "runtime:keyed",
            claim_class: "retained_runtime",
          }],
          heartbeat_ttl_seconds: 60,
        },
      });
    }
    expect(store.listRecommendations()).toMatchObject([{
      source_client_session_ref: "client:b",
      target_client_session_ref: "client:a",
      recommended_relay_type: "collision_notice",
      reason_code: "multiple_verified_retained_runtime_owners",
      supporting_verification_refs: [
        "resource_verification:client:a",
        "resource_verification:client:b",
      ],
      advisory_only: true,
      automatically_published: false,
      execution_requested: false,
      authority_transfer: false,
    }]);
  });

  it("fails closed at active-client capacity and reclaims only expired presence", () => {
    let now = new Date("2026-08-27T16:00:00.000Z");
    const store = new HelixLocalSupervisorCoordinationStore(
      "service_instance:fedcba9876543210fedcba9876543210",
      () => now,
      undefined,
      2,
    );
    register(store, {
      profile: "profile:a", session: "session:a", client: "client:a", thread: "thread:a",
    });
    register(store, {
      profile: "profile:b", session: "session:b", client: "client:b", thread: "thread:b",
    });
    expect(() => register(store, {
      profile: "profile:c", session: "session:c", client: "client:c", thread: "thread:c",
    })).toThrowError(expect.objectContaining({
      code: "supervisor_client_capacity_reached",
      status: 429,
    }));
    expect(store.listPresence()).toHaveLength(2);

    now = new Date("2026-08-27T16:01:01.000Z");
    expect(register(store, {
      profile: "profile:c", session: "session:c", client: "client:c", thread: "thread:c",
    }).active).toBe(true);
    expect(store.listPresence()).toHaveLength(2);
    expect(store.listPresence().some((entry) =>
      entry.client_session_ref === "client:c")).toBe(true);
  });
});
