import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopMcpTunnelTransitionStore } from
  "../../services/local-supervisor/desktop-mcp-tunnel-transition-store";

const { getAccountSessionById } = vi.hoisted(() => ({
  getAccountSessionById: vi.fn(),
}));
vi.mock("../../services/helix-account/account-session-store", () => ({
  getAccountSessionById,
}));

import { createDesktopMcpTunnelTransitionRouter } from
  "../desktop-mcp-tunnel-transition";

const serviceInstanceRef =
  "service_instance:77777777777777777777777777777777";
const sessionId = "account_session:developer-owner";
const profileId = "profile:developer-owner";

const session = (accountType: "developer" | "user" = "developer") => ({
  session_id: sessionId,
  status: "active",
  profile: { profile_id: profileId },
  account_policy: { account_type: accountType },
});

const setup = () => {
  const store = new DesktopMcpTunnelTransitionStore(serviceInstanceRef);
  const created = store.request({
    identity: {
      serviceInstanceRef,
      clientSessionRef: "supervisor_client:route-fixture",
      conversationThreadRef: "codex_thread:route-fixture",
      authenticatedProfileRef: profileId,
      authenticatedMcpClientRef: "mcp_client:native_desktop:route-fixture",
      accountSessionId: sessionId,
      clientIdentityAssurance:
        "native_tunnel_client_plus_server_derived_continuation",
      independentExternalOAuthClientBound: false,
    },
    declaredTaskSummary: "Refresh the admitted MCP catalog.",
    requestedLeaseSeconds: 120,
  });
  const onRevoked = vi.fn(async () => undefined);
  const installedSecurityStore = {
    inspectFullHarnessTrust: vi.fn(async () => ({
      schema: "helix.installed_device_full_harness_trust.v1" as const,
      trusted: false,
      device_ref: "device:sha256:fixture",
      policy_revision: 0,
      trusted_at: null,
      revoked_at: null,
      delegated_account_session_id: null,
      authority_limited_to_tunnel_transport: true as const,
      environment_authority_granted: false as const,
      trading_authority_granted: false as const,
      answer_authority: false as const,
      terminal_eligible: false as const,
    })),
    setFullHarnessTrust: vi.fn(async () => ({
      schema: "helix.installed_device_full_harness_trust.v1" as const,
      trusted: true,
      device_ref: "device:sha256:fixture",
      policy_revision: 1,
      trusted_at: "2026-09-03T12:00:00.000Z",
      revoked_at: null,
      delegated_account_session_id: sessionId,
      authority_limited_to_tunnel_transport: true as const,
      environment_authority_granted: false as const,
      trading_authority_granted: false as const,
      answer_authority: false as const,
      terminal_eligible: false as const,
    })),
  };
  const app = express();
  app.use(
    "/api/desktop/mcp-tunnel-transition",
    createDesktopMcpTunnelTransitionRouter({
      store,
      onRevoked,
      installedSecurityStore,
      desktopDeviceId: "desktop-device-fixture",
      desktopHostEnabled: true,
    }),
  );
  return { app, store, created, onRevoked, installedSecurityStore };
};

describe("desktop MCP tunnel transition consent route", () => {
  beforeEach(() => {
    getAccountSessionById.mockReset();
    getAccountSessionById.mockResolvedValue(session());
  });

  it("rejects missing/cross origin and non-developer consent before granting", async () => {
    const { app, created } = setup();
    const path = `/api/desktop/mcp-tunnel-transition/requests/${encodeURIComponent(
      created.request.transition_request_ref,
    )}/delegate`;
    const cookie = `helix_session=${encodeURIComponent(sessionId)}`;
    const missingOrigin = await request(app)
      .post(path)
      .set("Cookie", cookie)
      .send({ lease_seconds: 120 });
    expect(missingOrigin.status).toBe(403);
    expect(missingOrigin.body.error).toBe("transition_same_origin_required");
    const crossOrigin = await request(app)
      .post(path)
      .set("Cookie", cookie)
      .set("Origin", "https://attacker.invalid")
      .set("Sec-Fetch-Site", "cross-site")
      .send({ lease_seconds: 120 });
    expect(crossOrigin.status).toBe(403);
    getAccountSessionById.mockResolvedValueOnce(session("user"));
    const user = await request(app)
      .post(path)
      .set("Cookie", cookie)
      .set("Origin", "http://127.0.0.1")
      .set("Host", "127.0.0.1")
      .set("Sec-Fetch-Site", "same-origin")
      .send({ lease_seconds: 120 });
    expect(user.status).toBe(403);
    expect(user.body.error).toBe("transition_developer_account_required");
  });

  it("grants and revokes only the exact active developer account session", async () => {
    const { app, created, onRevoked } = setup();
    const base = `/api/desktop/mcp-tunnel-transition/requests/${encodeURIComponent(
      created.request.transition_request_ref,
    )}`;
    const headers = {
      Cookie: `helix_session=${encodeURIComponent(sessionId)}`,
      Origin: "http://127.0.0.1",
      Host: "127.0.0.1",
      "Sec-Fetch-Site": "same-origin",
    };
    const granted = await request(app)
      .post(`${base}/delegate`)
      .set(headers)
      .send({ lease_seconds: 120 });
    expect(granted.status).toBe(200);
    expect(granted.body).toMatchObject({
      ok: true,
      request: {
        status: "delegated",
        environment_authority_granted: false,
        trading_authority_granted: false,
      },
      receipt: {
        event_type: "delegated",
        assistant_answer: false,
        terminal_eligible: false,
      },
    });
    const revoked = await request(app)
      .post(`${base}/revoke`)
      .set(headers)
      .send({});
    expect(revoked.status).toBe(200);
    expect(revoked.body).toMatchObject({
      ok: true,
      read_only_return_requested: true,
      receipt: { event_type: "revoked" },
    });
    expect(onRevoked).toHaveBeenCalledWith(expect.objectContaining({
      transitionRequestRef: created.request.transition_request_ref,
      accountSessionId: sessionId,
    }));
  });

  it("lets a same-profile native developer session approve an OAuth-bound request", async () => {
    const nativeSessionId = "account_session:native-developer-owner";
    const store = new DesktopMcpTunnelTransitionStore(serviceInstanceRef);
    const created = store.request({
      identity: {
        serviceInstanceRef,
        clientSessionRef: "supervisor_client:oauth-route-fixture",
        conversationThreadRef: "codex_thread:oauth-route-fixture",
        authenticatedProfileRef: profileId,
        authenticatedMcpClientRef: "oauth_client:chatgpt-fixture",
        accountSessionId: "external-oauth:chatgpt-fixture",
        clientIdentityAssurance:
          "external_oauth_client_plus_server_derived_continuation",
        independentExternalOAuthClientBound: true,
      },
      declaredTaskSummary: "Approve the installed MCP transition.",
      requestedLeaseSeconds: 120,
    });
    getAccountSessionById.mockResolvedValue({
      ...session(),
      session_id: nativeSessionId,
    });
    const app = express();
    app.use(
      "/api/desktop/mcp-tunnel-transition",
      createDesktopMcpTunnelTransitionRouter({ store }),
    );
    const headers = {
      Cookie: `helix_session=${encodeURIComponent(nativeSessionId)}`,
      Origin: "http://127.0.0.1",
      Host: "127.0.0.1",
      "Sec-Fetch-Site": "same-origin",
    };
    const listed = await request(app)
      .get("/api/desktop/mcp-tunnel-transition/requests")
      .set("Cookie", headers.Cookie);
    expect(listed.body.requests).toEqual([
      expect.objectContaining({
        transition_request_ref: created.request.transition_request_ref,
        independent_external_oauth_client_bound: true,
      }),
    ]);
    const granted = await request(app)
      .post(`/api/desktop/mcp-tunnel-transition/requests/${encodeURIComponent(
        created.request.transition_request_ref,
      )}/delegate`)
      .set(headers)
      .send({ lease_seconds: 120 });
    expect(granted.status).toBe(200);
    expect(granted.body.request.status).toBe("delegated");
    const authorization = store.authorize({
      identity: {
        serviceInstanceRef,
        clientSessionRef: "supervisor_client:oauth-route-fixture",
        conversationThreadRef: "codex_thread:oauth-route-fixture",
        authenticatedProfileRef: profileId,
        authenticatedMcpClientRef: "oauth_client:chatgpt-fixture",
        accountSessionId: "external-oauth:chatgpt-fixture",
        clientIdentityAssurance:
          "external_oauth_client_plus_server_derived_continuation",
        independentExternalOAuthClientBound: true,
      },
      requestRef: created.request.transition_request_ref,
      targetScope: "full_helix_agent",
      idempotencyKey: "oauth-native-delegation-fixture",
    });
    expect(authorization.delegatedAccountSessionId).toBe(nativeSessionId);
  });

  it("stores native trusted-device opt-in and delegates existing pending leases without broad authority", async () => {
    const { app, created, installedSecurityStore } = setup();
    const headers = {
      Cookie: `helix_session=${encodeURIComponent(sessionId)}`,
      Origin: "http://127.0.0.1",
      Host: "127.0.0.1",
      "Sec-Fetch-Site": "same-origin",
    };
    const response = await request(app)
      .put("/api/desktop/mcp-tunnel-transition/full-harness-trust")
      .set(headers)
      .send({ trusted: true, expected_policy_revision: 0 });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      trust: {
        trusted: true,
        environment_authority_granted: false,
        trading_authority_granted: false,
        answer_authority: false,
        terminal_eligible: false,
      },
      delegated_request_refs: [created.request.transition_request_ref],
    });
    expect(JSON.stringify(response.body)).not.toContain(sessionId);
    expect(installedSecurityStore.setFullHarnessTrust).toHaveBeenCalledWith({
      session: { sessionId, profileId },
      deviceId: "desktop-device-fixture",
      trusted: true,
      expectedPolicyRevision: 0,
    });
  });

  it("receipt-chains a trusted rolling renewal for the exact expired continuation", async () => {
    let nowMs = Date.parse("2026-09-03T12:00:00.000Z");
    let ref = 0;
    const store = new DesktopMcpTunnelTransitionStore(
      serviceInstanceRef,
      () => new Date(nowMs),
      (kind) => `desktop_tunnel_${kind}:renew-${++ref}`,
    );
    const identity = {
      serviceInstanceRef,
      clientSessionRef: "supervisor_client:renew-fixture",
      conversationThreadRef: "codex_thread:renew-fixture",
      authenticatedProfileRef: profileId,
      authenticatedMcpClientRef: "mcp_client:native_desktop:renew-fixture",
      accountSessionId: sessionId,
      clientIdentityAssurance:
        "native_tunnel_client_plus_server_derived_continuation" as const,
      independentExternalOAuthClientBound: false,
    };
    const first = store.request({
      identity,
      declaredTaskSummary: "Keep this exact trusted task connected.",
      requestedLeaseSeconds: 30,
    });
    store.grant({
      requestRef: first.request.transition_request_ref,
      authenticatedProfileRef: profileId,
      accountSessionId: sessionId,
      accountType: "developer",
    });
    store.authorize({
      identity,
      requestRef: first.request.transition_request_ref,
      targetScope: "full_helix_agent",
      idempotencyKey: "first-transition",
    });
    nowMs += 30_001;
    const installedSecurityStore = {
      inspectFullHarnessTrust: vi.fn(async () => ({
        schema: "helix.installed_device_full_harness_trust.v1" as const,
        trusted: true,
        device_ref: "device:sha256:fixture",
        policy_revision: 4,
        trusted_at: "2026-09-03T11:00:00.000Z",
        revoked_at: null,
        delegated_account_session_id: sessionId,
        authority_limited_to_tunnel_transport: true as const,
        environment_authority_granted: false as const,
        trading_authority_granted: false as const,
        answer_authority: false as const,
        terminal_eligible: false as const,
      })),
      setFullHarnessTrust: vi.fn(),
    };
    const onTrustedRenewal = vi.fn(async () => ({
      accepted: true,
      nativeReceiptRef: "native_transition_receipt:renew-fixture",
    }));
    const app = express();
    app.use(
      "/api/desktop/mcp-tunnel-transition",
      createDesktopMcpTunnelTransitionRouter({
        store,
        installedSecurityStore,
        desktopDeviceId: "desktop-device-fixture",
        desktopHostEnabled: true,
        onTrustedRenewal,
      }),
    );
    const response = await request(app)
      .post("/api/desktop/mcp-tunnel-transition/full-harness-trust/renew")
      .set({
        Cookie: `helix_session=${encodeURIComponent(sessionId)}`,
        Origin: "http://127.0.0.1",
        Host: "127.0.0.1",
        "Sec-Fetch-Site": "same-origin",
      })
      .send({
        previous_transition_request_ref:
          first.request.transition_request_ref,
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      renewed: true,
      request: {
        status: "delegated",
        client_session_ref: identity.clientSessionRef,
        conversation_thread_ref: identity.conversationThreadRef,
      },
      receipt: { event_type: "transition_accepted" },
      native_receipt_ref: "native_transition_receipt:renew-fixture",
      environment_authority_granted: false,
      terminal_eligible: false,
    });
    expect(onTrustedRenewal).toHaveBeenCalledWith(expect.objectContaining({
      accountSessionId: sessionId,
      transitionRequestRef:
        response.body.request.transition_request_ref,
    }));
    expect(JSON.stringify(response.body)).not.toContain(sessionId);
  });

  it("does not expose trusted-device policy outside the packaged desktop host", async () => {
    const store = new DesktopMcpTunnelTransitionStore(serviceInstanceRef);
    const app = express();
    app.use(
      "/api/desktop/mcp-tunnel-transition",
      createDesktopMcpTunnelTransitionRouter({ store }),
    );
    const response = await request(app)
      .get("/api/desktop/mcp-tunnel-transition/full-harness-trust")
      .set("Cookie", `helix_session=${encodeURIComponent(sessionId)}`);
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("transition_native_trust_unavailable");
  });
});
