import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  buildHelixAccountCapabilityPolicy,
  type HelixAccountSession,
  type HelixAccountType,
} from "@shared/helix-account-session";
import type { HelixWorkstationGatewayAccountContext } from "../../services/helix-ask/workstation-tool-gateway/account-policy";
import {
  SharedLiveRoomBindingStoreError,
  type SharedLiveRoomAuthorizedTerminalMessage,
  type SharedLiveRoomObserverEventPage,
  type SharedLiveRoomRunChatBinding,
} from "../../services/shared-live-room-control/binding-store";
import { createAgentRunObserverRouter } from "../agent-run-observer";

const NOW = "2026-07-26T20:00:00.000Z";
const PROFILE_ID = "profile:browser-owner";
const BINDING_REF = "agent_chat_binding:browser";
const SAME_ORIGIN_HEADERS = {
  Host: "casimirbot.test",
  Origin: "http://casimirbot.test",
  "Sec-Fetch-Site": "same-origin",
};

const accountContext = (
  authMode: HelixAccountSession["profile"]["auth_mode"] = "web_auth",
  accountType: HelixAccountType = "developer",
  profileId = PROFILE_ID,
): HelixWorkstationGatewayAccountContext => {
  const accountPolicy = buildHelixAccountCapabilityPolicy(accountType);
  const accountSession: HelixAccountSession = {
    schema: "helix.account_session.v1",
    session_id: "browser-session",
    profile: {
      profile_id: profileId,
      display_name: "Browser owner",
      auth_mode: authMode,
      account_type: accountType,
      provider: authMode === "guest" ? "guest" : "local",
      created_at: NOW,
      updated_at: NOW,
    },
    account_policy: accountPolicy,
    status: "active",
    memory_scope: "profile",
    created_at: NOW,
    updated_at: NOW,
  };
  return {
    session_id: accountSession.session_id,
    profile_id: profileId,
    trusted_account_session: true,
    account_session: accountSession,
    account_policy: accountPolicy,
  };
};

const binding = (
  overrides: Partial<SharedLiveRoomRunChatBinding> = {},
): SharedLiveRoomRunChatBinding => ({
  bindingId: BINDING_REF,
  browserProfileId: PROFILE_ID,
  chatSessionId: "chat:selected-private",
  claimExpiresAt: "2026-07-26T20:10:00.000Z",
  runId: null,
  owner: null,
  status: "pending_claim",
  contextSnapshot: null,
  contextSnapshotRef: null,
  contextMessageCount: 0,
  contextCharCount: 0,
  createdAt: NOW,
  updatedAt: NOW,
  claimedAt: null,
  revokedAt: null,
  revokeReason: null,
  ...overrides,
});

const terminal = (): SharedLiveRoomAuthorizedTerminalMessage => ({
  projectionId: "agent_terminal_projection:browser",
  bindingRef: BINDING_REF,
  runId: "agent_run:browser",
  authorityRef: "terminal-authority:browser",
  artifactKind: "helix.ask.answer.v1",
  terminalTextHash: "terminal-text:sha256:abc",
  supportingEvidenceRefs: ["evidence:browser"],
  messageId: "agent_terminal_message:browser",
  role: "assistant",
  content: "Canonical verified answer.",
  at: "2026-07-26T20:01:00.000Z",
});

const harness = (
  authMode: HelixAccountSession["profile"]["auth_mode"] = "web_auth",
  accountType: HelixAccountType = "developer",
  options: {
    rejectRemainingAgiAsGlobalJwt?: boolean;
    ipRateLimit?: number;
    accountRateLimit?: number;
    profileId?: string;
  } = {},
) => {
  const createPendingChatBinding = vi.fn(async () => ({
    binding: binding(),
    claimHandle: "agent_chat_claim_browser_secret",
  }));
  const getObserverBinding = vi.fn(async () => binding());
  const revokeObserverBinding = vi.fn(async () =>
    binding({
      status: "revoked",
      updatedAt: NOW,
      revokedAt: NOW,
      revokeReason: "browser_owner_disconnected_observer_binding",
    }),
  );
  const listObserverEvents = vi.fn(
    async (): Promise<SharedLiveRoomObserverEventPage> => ({
      binding: binding({
        runId: "agent_run:browser",
        owner: {
          tenantId: "tenant:browser",
          issuer: "issuer:browser",
          subjectId: "subject:browser",
          accountProfileId: PROFILE_ID,
        },
        status: "active",
      }),
      events: [
        {
          schema: "helix.agent_run.event.v1",
          event_id: "event:browser",
          run_id: "agent_run:browser",
          seq: 8,
          event_type: "run_completed",
          payload: {
            version: 3,
            lifecycle_status: "completed",
            completion_status: "completed",
          },
          created_at: "2026-07-26T20:01:00.000Z",
          answer_authority: false,
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      ],
      nextAfterSeq: 8,
      hasMore: false,
    }),
  );
  const projectAuthorizedTerminalMessage = vi.fn(async () => terminal());
  const app = express();
  app.use(
    "/api/agi",
    createAgentRunObserverRouter({
      store: {
        createPendingChatBinding,
        getObserverBinding,
        listObserverEvents,
        projectAuthorizedTerminalMessage,
        revokeObserverBinding,
      },
      resolveAccount: async () =>
        accountContext(authMode, accountType, options.profileId),
      now: () => new Date(NOW),
      security: {
        ipMax: options.ipRateLimit ?? 300,
        accountMax: options.accountRateLimit ?? 240,
      },
    }),
  );
  if (options.rejectRemainingAgiAsGlobalJwt) {
    app.use("/api/agi", (_req, res) => {
      res.status(401).json({ error: "global_jwt_blocked" });
    });
  }
  return {
    app,
    createPendingChatBinding,
    getObserverBinding,
    listObserverEvents,
    projectAuthorizedTerminalMessage,
    revokeObserverBinding,
  };
};

describe("agent run cookie observer", () => {
  it("creates a browser-first binding with server-derived identity and reveals the opaque handle once", async () => {
    const test = harness();
    const response = await request(test.app)
      .post("/api/agi/agent-run-observer/bindings")
      .set(SAME_ORIGIN_HEADERS)
      .set("Cookie", "helix_session=browser-session")
      .send({
        chat_session_id: "chat:selected-private",
        context: {
          messages: [
            {
              role: "user",
              content:
                "Observe this selected chat. bearer_token=helix_room_src_capture_secret room_source_claim_capture_secret",
              at: NOW,
            },
          ],
        },
      })
      .expect(201);

    expect(test.createPendingChatBinding).toHaveBeenCalledWith({
      browserProfileId: PROFILE_ID,
      chatSessionId: "chat:selected-private",
      contextSnapshot: expect.objectContaining({
        context_role: "non_authoritative_conversation_context",
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      }),
      now: NOW,
    });
    const captured =
      test.createPendingChatBinding.mock.calls[0]?.[0].contextSnapshot;
    expect(JSON.stringify(captured)).not.toContain(
      "helix_room_src_capture_secret",
    );
    expect(JSON.stringify(captured)).not.toContain(
      "room_source_claim_capture_secret",
    );
    expect(JSON.stringify(captured)).toContain("[REDACTED_SECRET]");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toMatchObject({
      schema: "helix.agent_run_observer.binding_receipt.v1",
      ok: true,
      claim_handle: "agent_chat_claim_browser_secret",
      claim_handle_shown_once: true,
      binding: {
        binding_ref: BINDING_REF,
        status: "pending_claim",
      },
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(response.body.binding).not.toHaveProperty("chat_session_id");
    expect(response.body.binding).not.toHaveProperty("run_id");
    expect(response.body.binding).not.toHaveProperty("owner");
  });

  it("disconnects an exact cookie-owned binding with an idempotent false-authority receipt", async () => {
    const test = harness();
    const disconnect = () =>
      request(test.app)
        .delete(`/api/agi/agent-run-observer/bindings/${BINDING_REF}`)
        .set(SAME_ORIGIN_HEADERS)
        .set("Cookie", "helix_session=browser-session");

    const first = await disconnect().expect(200);
    const replay = await disconnect().expect(200);

    expect(test.revokeObserverBinding).toHaveBeenNthCalledWith(1, {
      browserProfileId: PROFILE_ID,
      bindingRef: BINDING_REF,
      now: NOW,
    });
    expect(test.revokeObserverBinding).toHaveBeenNthCalledWith(2, {
      browserProfileId: PROFILE_ID,
      bindingRef: BINDING_REF,
      now: NOW,
    });
    expect(first.body).toEqual(replay.body);
    expect(first.body).toMatchObject({
      schema: "helix.agent_run_observer.binding_receipt.v1",
      ok: true,
      error: null,
      message: "Observer binding disconnected.",
      binding: {
        binding_ref: BINDING_REF,
        status: "revoked",
      },
      claim_handle: null,
      claim_handle_shown_once: false,
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(first.body.binding).not.toHaveProperty("chat_session_id");
    expect(first.body.binding).not.toHaveProperty("run_id");
    expect(first.body.binding).not.toHaveProperty("owner");
    expect(first.body.binding).not.toHaveProperty("browser_profile_id");
    expect(first.body.binding).not.toHaveProperty("revoke_reason");
  });

  it("rejects identity fields and guest cookies instead of accepting browser identity claims", async () => {
    const test = harness();
    await request(test.app)
      .post("/api/agi/agent-run-observer/bindings")
      .set(SAME_ORIGIN_HEADERS)
      .set("Cookie", "helix_session=browser-session")
      .send({
        chat_session_id: "chat:selected-private",
        profile_id: "profile:spoofed",
      })
      .expect(400)
      .expect((response) => {
        expect(response.body.error).toBe("binding_invalid");
      });
    expect(test.createPendingChatBinding).not.toHaveBeenCalled();

    const guest = harness("guest");
    await request(guest.app)
      .post("/api/agi/agent-run-observer/bindings")
      .set(SAME_ORIGIN_HEADERS)
      .set("Cookie", "helix_session=guest-session")
      .send({ chat_session_id: "chat:selected-private" })
      .expect(401)
      .expect((response) => {
        expect(response.body.error).toBe("observer_auth_required");
      });
    expect(guest.createPendingChatBinding).not.toHaveBeenCalled();

    const policyLocked = harness("web_auth", "user");
    await request(policyLocked.app)
      .post("/api/agi/agent-run-observer/bindings")
      .set(SAME_ORIGIN_HEADERS)
      .set("Cookie", "helix_session=user-session")
      .send({ chat_session_id: "chat:selected-private" })
      .expect(403)
      .expect((response) => {
        expect(response.body.error).toBe("observer_account_policy_blocked");
      });
    expect(policyLocked.createPendingChatBinding).not.toHaveBeenCalled();
  });

  it("keeps exact-owner withdrawal available after observer policy loss", async () => {
    const policyLocked = harness("web_auth", "user");

    await request(policyLocked.app)
      .get(`/api/agi/agent-run-observer/bindings/${BINDING_REF}`)
      .set("Cookie", "helix_session=user-session")
      .expect(403)
      .expect((response) => {
        expect(response.body.error).toBe("observer_account_policy_blocked");
      });

    const withdrawn = await request(policyLocked.app)
      .delete(`/api/agi/agent-run-observer/bindings/${BINDING_REF}`)
      .set(SAME_ORIGIN_HEADERS)
      .set("Cookie", "helix_session=user-session")
      .expect(200);
    expect(withdrawn.body).toMatchObject({
      binding: {
        binding_ref: BINDING_REF,
        status: "revoked",
      },
      answer_authority: false,
      terminal_eligible: false,
    });
    expect(policyLocked.revokeObserverBinding).toHaveBeenCalledWith({
      browserProfileId: PROFILE_ID,
      bindingRef: BINDING_REF,
      now: NOW,
    });
    expect(policyLocked.getObserverBinding).not.toHaveBeenCalled();
  });

  it("polls only an exact opaque binding after after_seq and emits a stable canonical terminal message", async () => {
    const test = harness();
    const response = await request(test.app)
      .get(
        `/api/agi/agent-run-observer/bindings/${encodeURIComponent(
          BINDING_REF,
        )}/events?after_seq=7&limit=25`,
      )
      .set("Cookie", "helix_session=browser-session")
      .expect(200);

    expect(test.projectAuthorizedTerminalMessage).toHaveBeenCalledWith({
      browserProfileId: PROFILE_ID,
      bindingRef: BINDING_REF,
      now: NOW,
    });
    expect(test.listObserverEvents).toHaveBeenCalledWith({
      browserProfileId: PROFILE_ID,
      bindingRef: BINDING_REF,
      afterSeq: 7,
      limit: 25,
    });
    expect(response.body).toMatchObject({
      schema: "helix.agent_run_observer.events_page.v1",
      binding_ref: BINDING_REF,
      next_after_seq: 8,
      has_more: false,
      terminal_message: {
        message_id: "agent_terminal_message:browser",
        role: "assistant",
        content: "Canonical verified answer.",
        traceId: "terminal-authority:browser",
        helixAsk: {
          schema: "helix.agent_run_observer.terminal_projection.v1",
          binding_ref: BINDING_REF,
          authority_ref: "terminal-authority:browser",
          terminal_text_hash: "terminal-text:sha256:abc",
        },
      },
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(response.body).not.toHaveProperty("chat_session_id");
  });

  it("does not reveal another browser profile's binding, events, or terminal projection", async () => {
    const otherProfileId = "profile:other-browser";
    const test = harness("web_auth", "developer", {
      profileId: otherProfileId,
    });
    test.getObserverBinding.mockResolvedValueOnce(null);

    await request(test.app)
      .get(`/api/agi/agent-run-observer/bindings/${BINDING_REF}`)
      .set("Cookie", "helix_session=other-browser-session")
      .expect(404)
      .expect((response) => {
        expect(response.body).toMatchObject({
          error: "chat_binding_not_found",
          assistant_answer: false,
          terminal_eligible: false,
        });
      });
    expect(test.getObserverBinding).toHaveBeenCalledWith({
      browserProfileId: otherProfileId,
      bindingRef: BINDING_REF,
    });

    test.revokeObserverBinding.mockRejectedValueOnce(
      new SharedLiveRoomBindingStoreError(
        "chat_binding_not_found",
        404,
        "Observer binding not found.",
      ),
    );
    await request(test.app)
      .delete(`/api/agi/agent-run-observer/bindings/${BINDING_REF}`)
      .set(SAME_ORIGIN_HEADERS)
      .set("Cookie", "helix_session=other-browser-session")
      .expect(404)
      .expect((response) => {
        expect(response.body).toMatchObject({
          error: "chat_binding_not_found",
          assistant_answer: false,
          terminal_eligible: false,
        });
      });
    expect(test.revokeObserverBinding).toHaveBeenCalledWith({
      browserProfileId: otherProfileId,
      bindingRef: BINDING_REF,
      now: NOW,
    });

    test.projectAuthorizedTerminalMessage.mockRejectedValueOnce(
      new SharedLiveRoomBindingStoreError(
        "chat_binding_not_found",
        404,
        "Observer binding not found.",
      ),
    );
    await request(test.app)
      .get(`/api/agi/agent-run-observer/bindings/${BINDING_REF}/events`)
      .set("Cookie", "helix_session=other-browser-session")
      .expect(404)
      .expect((response) => {
        expect(response.body).toMatchObject({
          error: "chat_binding_not_found",
          assistant_answer: false,
          terminal_eligible: false,
        });
      });
    expect(test.projectAuthorizedTerminalMessage).toHaveBeenCalledWith({
      browserProfileId: otherProfileId,
      bindingRef: BINDING_REF,
      now: NOW,
    });
    expect(test.listObserverEvents).not.toHaveBeenCalled();
  });

  it("admits the exact same-origin cookie lane ahead of a later global JWT blocker", async () => {
    const test = harness("web_auth", "developer", {
      rejectRemainingAgiAsGlobalJwt: true,
    });
    const response = await request(test.app)
      .post("/api/agi/agent-run-observer/bindings")
      .set(SAME_ORIGIN_HEADERS)
      .set("Cookie", "helix_session=browser-session")
      .send({ chat_session_id: "chat:selected-private" })
      .expect(201);

    expect(response.body.error).not.toBe("global_jwt_blocked");
    expect(test.createPendingChatBinding).toHaveBeenCalledTimes(1);

    const unrelated = await request(test.app)
      .post("/api/agi/not-an-observer-route")
      .send({})
      .expect(401);
    expect(unrelated.body.error).toBe("global_jwt_blocked");
  });

  it.each([
    {
      name: "hostile Origin",
      headers: {
        Host: "casimirbot.test",
        Origin: "https://attacker.example",
        "Sec-Fetch-Site": "same-origin",
      },
    },
    {
      name: "cross-site Fetch Metadata",
      headers: {
        Host: "casimirbot.test",
        Origin: "http://casimirbot.test",
        "Sec-Fetch-Site": "cross-site",
      },
    },
    {
      name: "missing browser origin evidence",
      headers: {
        Host: "casimirbot.test",
        "Sec-Fetch-Site": "same-origin",
      },
    },
  ])(
    "rejects $name before cookie authority is consulted",
    async ({ headers }) => {
      const test = harness();
      const response = await request(test.app)
        .post("/api/agi/agent-run-observer/bindings")
        .set(headers)
        .set("Cookie", "helix_session=browser-session")
        .send({ chat_session_id: "chat:selected-private" })
        .expect(403);

      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).toMatchObject({
        schema: "helix.agent_run_observer.error.v1",
        error: "observer_cross_origin_forbidden",
        assistant_answer: false,
        terminal_eligible: false,
      });
      expect(test.createPendingChatBinding).not.toHaveBeenCalled();
    },
  );

  it("bounds both the pre-auth IP lane and the authenticated account lane with typed no-store failures", async () => {
    const ipLimited = harness("web_auth", "developer", {
      ipRateLimit: 1,
      accountRateLimit: 10,
    });
    await request(ipLimited.app)
      .post("/api/agi/agent-run-observer/bindings")
      .set(SAME_ORIGIN_HEADERS)
      .set("Cookie", "helix_session=browser-session")
      .send({ chat_session_id: "chat:selected-private" })
      .expect(201);
    const ipFailure = await request(ipLimited.app)
      .post("/api/agi/agent-run-observer/bindings")
      .set(SAME_ORIGIN_HEADERS)
      .set("Cookie", "helix_session=browser-session")
      .send({ chat_session_id: "chat:selected-private" })
      .expect(429);
    expect(ipFailure.headers["cache-control"]).toBe("no-store");
    expect(ipFailure.body.error).toBe("observer_rate_limited");

    const accountLimited = harness("web_auth", "developer", {
      ipRateLimit: 10,
      accountRateLimit: 1,
    });
    await request(accountLimited.app)
      .get(`/api/agi/agent-run-observer/bindings/${BINDING_REF}`)
      .set("Cookie", "helix_session=browser-session")
      .expect(200);
    const accountFailure = await request(accountLimited.app)
      .get(`/api/agi/agent-run-observer/bindings/${BINDING_REF}`)
      .set("Cookie", "helix_session=browser-session")
      .expect(429);
    expect(accountFailure.headers["cache-control"]).toBe("no-store");
    expect(accountFailure.body).toMatchObject({
      error: "observer_rate_limited",
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(accountLimited.getObserverBinding).toHaveBeenCalledTimes(1);
  });

  it("redacts recognized bearer and claim material from unexpected-error logs", async () => {
    const test = harness();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    test.getObserverBinding.mockRejectedValueOnce(
      new Error(
        "provider failed bearer_token=helix_room_src_log_secret room_source_claim_log_secret",
      ),
    );
    try {
      const response = await request(test.app)
        .get(`/api/agi/agent-run-observer/bindings/${BINDING_REF}`)
        .set("Cookie", "helix_session=browser-session")
        .expect(503);
      expect(response.headers["cache-control"]).toBe("no-store");
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).not.toContain("helix_room_src_log_secret");
      expect(logged).not.toContain("room_source_claim_log_secret");
      expect(logged).toContain("[REDACTED_SECRET]");
    } finally {
      warn.mockRestore();
    }
  });
});
