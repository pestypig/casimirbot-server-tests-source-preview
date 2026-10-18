import { describe, expect, it } from "vitest";
import { DesktopMcpTunnelTransitionStore } from
  "../desktop-mcp-tunnel-transition-store";

const epoch = "service_instance:11111111111111111111111111111111";
const identity = {
  serviceInstanceRef: epoch,
  clientSessionRef: "supervisor_client:bound",
  conversationThreadRef: "codex_thread:bound",
  authenticatedProfileRef: "profile:owner",
  authenticatedMcpClientRef: "mcp_client:native_desktop:owner",
  accountSessionId: "account_session:owner-secret",
  clientIdentityAssurance:
    "native_tunnel_client_plus_server_derived_continuation" as const,
  independentExternalOAuthClientBound: false,
};

const harness = () => {
  let nowMs = Date.parse("2026-08-29T12:00:00.000Z");
  let ref = 0;
  const store = new DesktopMcpTunnelTransitionStore(
    epoch,
    () => new Date(nowMs),
    (kind) => `desktop_tunnel_${kind}:fixture-${++ref}`,
  );
  return { store, advance: (milliseconds: number) => { nowMs += milliseconds; } };
};

describe("governed desktop MCP tunnel transition store", () => {
  it("requires a same-profile developer grant and emits authority-limited receipts", () => {
    const { store } = harness();
    const created = store.request({
      identity,
      declaredTaskSummary: "Refresh the admitted MCP catalog.",
      requestedLeaseSeconds: 90,
    });
    expect(created.request).toMatchObject({
      status: "pending_user_delegation",
      independent_external_oauth_client_bound: false,
      environment_authority_granted: false,
      trading_authority_granted: false,
      terminal_eligible: false,
    });
    expect(() => store.request({
      identity,
      declaredTaskSummary: "Duplicate open request",
      requestedLeaseSeconds: 90,
    })).toThrow("transition_request_already_open");
    expect(store.findOpenForIdentity(identity)).toMatchObject({
      transition_request_ref: created.request.transition_request_ref,
      status: "pending_user_delegation",
    });
    for (const changed of [
      { clientSessionRef: "supervisor_client:not-the-owner" },
      { conversationThreadRef: "codex_thread:not-the-owner" },
      { authenticatedProfileRef: "profile:not-the-owner" },
      { authenticatedMcpClientRef: "mcp_client:not-the-owner" },
      { accountSessionId: "account_session:not-the-owner" },
    ]) {
      expect(store.findOpenForIdentity({ ...identity, ...changed })).toBeNull();
    }
    expect(() => store.findOpenForIdentity({
      ...identity,
      serviceInstanceRef: "service_instance:not-the-owner",
    })).toThrow("transition_service_epoch_mismatch");
    expect(() => store.grant({
      requestRef: created.request.transition_request_ref,
      authenticatedProfileRef: "profile:owner",
      accountSessionId: identity.accountSessionId,
      accountType: "user",
    })).toThrow("transition_delegation_forbidden");
    expect(() => store.grant({
      requestRef: created.request.transition_request_ref,
      authenticatedProfileRef: "profile:attacker",
      accountSessionId: identity.accountSessionId,
      accountType: "developer",
    })).toThrow("transition_delegation_forbidden");
    const granted = store.grant({
      requestRef: created.request.transition_request_ref,
      authenticatedProfileRef: "profile:owner",
      accountSessionId: identity.accountSessionId,
      accountType: "developer",
    });
    expect(granted.request).toMatchObject({
      status: "delegated",
      delegation_ref: "desktop_tunnel_delegation:fixture-3",
    });
    expect(granted.receipt).toMatchObject({
      event_type: "delegated",
      immutable_event: true,
      authority_limited_to_tunnel_transport: true,
      assistant_answer: false,
      terminal_eligible: false,
    });
  });

  it("rejects cross-client, continuation, profile, account-session, and service-epoch reuse", () => {
    const { store } = harness();
    const { request } = store.request({
      identity,
      declaredTaskSummary: "Bound task",
      requestedLeaseSeconds: 60,
    });
    store.grant({
      requestRef: request.transition_request_ref,
      authenticatedProfileRef: identity.authenticatedProfileRef,
      accountSessionId: identity.accountSessionId,
      accountType: "developer",
    });
    for (const changed of [
      { clientSessionRef: "supervisor_client:other" },
      { conversationThreadRef: "codex_thread:other" },
      { authenticatedProfileRef: "profile:other" },
      { authenticatedMcpClientRef: "mcp_client:native_desktop:other" },
      { accountSessionId: "account_session:other" },
      { serviceInstanceRef: "service_instance:other" },
    ]) {
      expect(() => store.authorize({
        identity: { ...identity, ...changed },
        requestRef: request.transition_request_ref,
        targetScope: "full_helix_agent",
        idempotencyKey: `idempotency-${Object.keys(changed)[0]}`,
      })).toThrow("transition_client_identity_mismatch");
    }
  });

  it("expires short leases fail closed and preserves an append-only expiry receipt", () => {
    const { store, advance } = harness();
    const { request } = store.request({
      identity,
      declaredTaskSummary: "Time-bound task",
      requestedLeaseSeconds: 30,
    });
    store.grant({
      requestRef: request.transition_request_ref,
      authenticatedProfileRef: identity.authenticatedProfileRef,
      accountSessionId: identity.accountSessionId,
      accountType: "developer",
      leaseSeconds: 30,
    });
    advance(30_001);
    expect(() => store.authorize({
      identity,
      requestRef: request.transition_request_ref,
      targetScope: "full_helix_agent",
      idempotencyKey: "idempotency-expired",
    })).toThrow("transition_delegation_not_active");
    expect(store.inspect({ identity, requestRef: request.transition_request_ref }).status)
      .toBe("expired");
    expect(store.listReceipts(request.transition_request_ref).map((item) => item.event_type))
      .toEqual(["requested", "delegated", "expired"]);
    const receipts = store.listReceipts(request.transition_request_ref);
    expect(receipts[0].previous_receipt_hash).toBeNull();
    expect(receipts[1].previous_receipt_hash).toBe(receipts[0].receipt_hash);
    expect(receipts[2].previous_receipt_hash).toBe(receipts[1].receipt_hash);
    expect(receipts.every((item) => /^[a-f0-9]{64}$/u.test(item.receipt_hash)))
      .toBe(true);
  });

  it("renews an expired trusted-device lease for the exact client and continuation", () => {
    const { store, advance } = harness();
    const first = store.request({
      identity,
      declaredTaskSummary: "Keep the exact trusted harness session active.",
      requestedLeaseSeconds: 30,
    });
    store.grant({
      requestRef: first.request.transition_request_ref,
      authenticatedProfileRef: identity.authenticatedProfileRef,
      accountSessionId: identity.accountSessionId,
      accountType: "developer",
    });
    advance(30_001);

    const renewed = store.renewTrustedDeviceLease({
      previousRequestRef: first.request.transition_request_ref,
      authenticatedProfileRef: identity.authenticatedProfileRef,
      accountSessionId: identity.accountSessionId,
      accountType: "developer",
    });

    expect(renewed.request).toMatchObject({
      status: "delegated",
      client_session_ref: identity.clientSessionRef,
      conversation_thread_ref: identity.conversationThreadRef,
      authenticated_mcp_client_ref: identity.authenticatedMcpClientRef,
      requested_lease_seconds: 30,
    });
    expect(renewed.request.transition_request_ref).not.toBe(
      first.request.transition_request_ref,
    );
    expect(renewed.authorization).toMatchObject({
      idempotencyReplayed: false,
      delegatedAccountSessionId: identity.accountSessionId,
      receipt: { event_type: "transition_accepted" },
    });
    expect(store.listReceipts(first.request.transition_request_ref)
      .map((item) => item.event_type)).toEqual([
        "requested",
        "delegated",
        "expired",
      ]);
    expect(() => store.renewTrustedDeviceLease({
      previousRequestRef: first.request.transition_request_ref,
      authenticatedProfileRef: identity.authenticatedProfileRef,
      accountSessionId: "account_session:other",
      accountType: "developer",
    })).toThrow("transition_trusted_renewal_forbidden");
  });

  it("makes accepted execution replay-safe and revocation return-to-read-only explicit", () => {
    const { store } = harness();
    const { request } = store.request({
      identity,
      declaredTaskSummary: "Replay-safe task",
      requestedLeaseSeconds: 120,
    });
    store.grant({
      requestRef: request.transition_request_ref,
      authenticatedProfileRef: identity.authenticatedProfileRef,
      accountSessionId: identity.accountSessionId,
      accountType: "developer",
    });
    const first = store.authorize({
      identity,
      requestRef: request.transition_request_ref,
      targetScope: "full_helix_agent",
      idempotencyKey: "idempotency-stable",
    });
    const replay = store.authorize({
      identity,
      requestRef: request.transition_request_ref,
      targetScope: "full_helix_agent",
      idempotencyKey: "idempotency-stable",
    });
    expect(first.idempotencyReplayed).toBe(false);
    expect(replay).toEqual({
      receipt: first.receipt,
      idempotencyReplayed: true,
      delegatedAccountSessionId: identity.accountSessionId,
    });
    expect(() => store.authorize({
      identity,
      requestRef: request.transition_request_ref,
      targetScope: "local_supervisor_coordination_and_device_check",
      idempotencyKey: "idempotency-stable",
    })).toThrow("transition_idempotency_conflict");
    expect(store.listReceipts(request.transition_request_ref)
      .filter((item) => item.event_type === "transition_accepted")).toHaveLength(1);
    const revoked = store.revoke({
      requestRef: request.transition_request_ref,
      authenticatedProfileRef: identity.authenticatedProfileRef,
      accountSessionId: identity.accountSessionId,
    });
    expect(revoked).toMatchObject({
      event_type: "revoked",
      target_scope: "local_supervisor_coordination_and_device_check",
    });
    expect(() => store.authorize({
      identity,
      requestRef: request.transition_request_ref,
      targetScope: "full_helix_agent",
      idempotencyKey: "idempotency-stable",
    })).toThrow("transition_delegation_not_active");
  });

  it("does not project the native account session into requests or receipts", () => {
    const { store } = harness();
    const { request } = store.request({
      identity,
      declaredTaskSummary: "No secret projection",
      requestedLeaseSeconds: 60,
    });
    const projection = JSON.stringify({
      request,
      receipts: store.listReceipts(request.transition_request_ref),
    });
    expect(projection).not.toContain(identity.accountSessionId);
    expect(projection).not.toMatch(/https?:\/\//);
    expect(request.private_endpoint_included).toBe(false);
    expect(request.credential_included).toBe(false);
    expect(projection).not.toContain("credential_included\":true");
  });

  it("revokes every open lease on Emergency Stop and returns only private broker actions", () => {
    const { store } = harness();
    const { request } = store.request({
      identity,
      declaredTaskSummary: "Safety-bound task",
      requestedLeaseSeconds: 60,
    });
    store.grant({
      requestRef: request.transition_request_ref,
      authenticatedProfileRef: identity.authenticatedProfileRef,
      accountSessionId: identity.accountSessionId,
      accountType: "developer",
    });
    const actions = store.revokeAllForSafety("environment_emergency_stop");
    expect(actions).toEqual([expect.objectContaining({
      transitionRequestRef: request.transition_request_ref,
      accountSessionId: identity.accountSessionId,
    })]);
    expect(store.inspect({ identity, requestRef: request.transition_request_ref }).status)
      .toBe("revoked");
    const publicProjection = JSON.stringify({
      request: store.inspect({ identity, requestRef: request.transition_request_ref }),
      receipts: store.listReceipts(request.transition_request_ref),
    });
    expect(publicProjection).not.toContain(identity.accountSessionId);
    expect(publicProjection).toContain("environment_emergency_stop");
  });
});
