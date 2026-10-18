import express from "express";
import request from "supertest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { buildHelixAccountCapabilityPolicy } from "@shared/helix-account-session";
import { HELIX_AGENT_RUN_WRITE_SCOPE } from "@shared/contracts/helix-agent-api.v1";
import {
  HELIX_SHARED_LIVE_ROOM_MANAGE_SCOPE,
  HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
  HELIX_SHARED_LIVE_ROOM_SOURCE_MANAGE_SCOPE,
} from "@shared/contracts/helix-shared-live-room-agent.v1";
import { createHelixMcpServer } from "../../mcp/helix-mcp-server";
import { createHelixMcpRouter } from "../helix-mcp";
import { createHelixSharedLiveRoomRouter } from "../helix-shared-live-rooms";
import type { HelixAgentApiPrincipal } from "../../services/helix-agent-api/types";
import {
  SharedLiveRoomBindingStoreError,
  type SharedLiveRoomBindingStore,
  type SharedLiveRoomRunChatBinding,
  type SharedLiveRoomRunRoomBinding,
} from "../../services/shared-live-room-control/binding-store";
import { SharedLiveRoomControlService } from "../../services/shared-live-room-control/service";
import { validateSharedLiveRoomToolCatalog } from "../../../scripts/lib/helix-shared-live-room-live-acceptance";

const ROOM_ID = "shared_realtime_room:room-transport-12345678";
const RUN_ID = "run_room_transport_12345678";
const NOW = "2026-07-26T20:00:00.000Z";

const principal = (
  scopes: readonly string[] = [
    HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
    HELIX_SHARED_LIVE_ROOM_MANAGE_SCOPE,
    HELIX_SHARED_LIVE_ROOM_SOURCE_MANAGE_SCOPE,
    HELIX_AGENT_RUN_WRITE_SCOPE,
  ],
  accountType: "developer" | "user" = "developer",
): HelixAgentApiPrincipal => {
  const accountPolicy = buildHelixAccountCapabilityPolicy(accountType);
  return {
    tenantId: "tenant-room-transport",
    issuer: "https://issuer.example",
    subjectId: "subject-room-transport",
    accountProfileId: "profile-room-transport",
    accountType,
    scopes: new Set(scopes),
    tokenExpiresAt: "2099-01-01T00:00:00.000Z",
    accountContext: {
      session_id: "external-oauth:room-transport",
      profile_id: "profile-room-transport",
      trusted_account_session: true,
      account_session: null,
      account_policy: accountPolicy,
    },
  };
};

const receiptFlags = {
  api_version: "v1",
  ok: true,
  reentry_required: true,
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
};

const roomProjection = {
  schema: "helix.shared_realtime_room.v1",
  room_id: ROOM_ID,
  title: "Transport room",
  status: "waiting_for_participant",
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
};

type ControlDouble = {
  joinRoom: ReturnType<typeof vi.fn>;
  listRooms: ReturnType<typeof vi.fn>;
  inspectRoom: ReturnType<typeof vi.fn>;
  createRoom: ReturnType<typeof vi.fn>;
  listSourceBindings: ReturnType<typeof vi.fn>;
  createSourceBinding: ReturnType<typeof vi.fn>;
};

const controlDouble = (): ControlDouble => {
  const listReceipt = {
    ...receiptFlags,
    schema: "helix.shared_live_room.list_receipt.v1",
    operation: "room.list",
    content_role: "room_control_observation_not_assistant_answer",
    rooms: [roomProjection],
  };
  const createReceipt = {
    ...receiptFlags,
    schema: "helix.shared_live_room.create_receipt.v1",
    operation: "room.create",
    content_role: "room_control_receipt_not_assistant_answer",
    room: roomProjection,
  };
  const sourceReceipt = {
    ...receiptFlags,
    schema: "helix.shared_live_room.source_create_receipt.v1",
    operation: "room.source.create",
    content_role: "source_binding_receipt_not_assistant_answer",
    room_id: ROOM_ID,
    binding: {
      binding_id: "room_source_binding:transport",
      room_id: ROOM_ID,
      source_id: "room-source:transport",
      status: "pending_credential_claim",
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    },
    credential_delivery: {
      schema: "helix.shared_live_room.credential_delivery.v1",
      claim_handle: "room_source_claim_transport_123456789",
      claim_url: "https://rooms.example/claim/transport",
      expires_at: "2026-07-26T20:05:00.000Z",
      delivery_status: "pending_claim",
      bearer_included: false,
      plugin_config_included: false,
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    },
    execution_enabled: false,
    command_execution_enabled: false,
  };
  return {
    joinRoom: vi.fn().mockResolvedValue({ status: 201, idempotencyReplayed: false,
      body: { ...createReceipt, schema: "helix.shared_live_room.join_receipt.v1", operation: "room.join" } }),
    listRooms: vi.fn().mockResolvedValue(listReceipt),
    inspectRoom: vi.fn().mockResolvedValue({
      ...listReceipt,
      schema: "helix.shared_live_room.inspect_receipt.v1",
      operation: "room.inspect",
      room: roomProjection,
      rooms: undefined,
    }),
    createRoom: vi.fn().mockResolvedValue({
      status: 201,
      body: createReceipt,
      idempotencyReplayed: true,
    }),
    listSourceBindings: vi.fn().mockResolvedValue({
      ...receiptFlags,
      schema: "helix.shared_live_room.source_list_receipt.v1",
      operation: "room.source.list",
      content_role: "source_binding_observation_not_assistant_answer",
      room_id: ROOM_ID,
      bindings: [],
    }),
    createSourceBinding: vi.fn().mockResolvedValue({
      status: 201,
      body: sourceReceipt,
      idempotencyReplayed: false,
    }),
  };
};

const roomBinding: SharedLiveRoomRunRoomBinding = {
  bindingId: "agent_room_binding:transport",
  runId: RUN_ID,
  owner: {
    tenantId: "tenant-room-transport",
    issuer: "https://issuer.example",
    subjectId: "subject-room-transport",
    accountProfileId: "profile-room-transport",
  },
  roomId: ROOM_ID,
  authorizedByProfileId: "profile-room-transport",
  participantIdAtBind: "room_participant:sensitive",
  memberRoleAtBind: "owner",
  consentVersionAtBind: 1,
  consentReceiptRefAtBind: "room-consent:transport:1",
  status: "active",
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
  revokedAt: null,
  revokeReason: null,
};

const chatBinding: SharedLiveRoomRunChatBinding = {
  bindingId: "agent_chat_binding:transport",
  browserProfileId: "profile-room-transport",
  chatSessionId: "private-chat-session-id",
  claimExpiresAt: "2026-07-26T20:10:00.000Z",
  runId: RUN_ID,
  owner: roomBinding.owner,
  status: "active",
  contextSnapshot: null,
  contextSnapshotRef: "agent-chat-context:sha256:transport",
  contextMessageCount: 4,
  contextCharCount: 320,
  createdAt: NOW,
  updatedAt: NOW,
  claimedAt: NOW,
  revokedAt: null,
  revokeReason: null,
};

type BindingDouble = {
  bindRunToRoom: ReturnType<typeof vi.fn>;
  claimPendingChatBinding: ReturnType<typeof vi.fn>;
  revokeRunRoomBindingForOwner: ReturnType<typeof vi.fn>;
  revokeClaimedRunChatBindingForOwner: ReturnType<typeof vi.fn>;
};

const bindingDouble = (): BindingDouble => ({
  bindRunToRoom: vi.fn().mockResolvedValue(roomBinding),
  claimPendingChatBinding: vi.fn().mockResolvedValue(chatBinding),
  revokeRunRoomBindingForOwner: vi.fn().mockResolvedValue({
    binding: {
      ...roomBinding,
      status: "revoked",
      version: 2,
      revokedAt: NOW,
      revokeReason: "external_agent_owner_revoked_run_room_binding",
    },
    revocationStatus: "revoked",
  }),
  revokeClaimedRunChatBindingForOwner: vi.fn().mockResolvedValue({
    binding: {
      ...chatBinding,
      status: "revoked",
      revokedAt: NOW,
      revokeReason: "external_agent_owner_revoked_run_chat_binding",
    },
    revocationStatus: "revoked",
  }),
});

type ControlFacade = SharedLiveRoomControlService | ControlDouble;

const asControl = (value: ControlFacade): SharedLiveRoomControlService =>
  value as unknown as SharedLiveRoomControlService;

type BindingFacade = Pick<
  SharedLiveRoomBindingStore,
  | "bindRunToRoom"
  | "claimPendingChatBinding"
  | "revokeRunRoomBindingForOwner"
  | "revokeClaimedRunChatBindingForOwner"
>;

const asBindings = (value: BindingDouble): BindingFacade =>
  value as unknown as BindingFacade;

const restApp = (input?: {
  control?: ControlFacade;
  bindings?: BindingDouble;
  authPrincipal?: HelixAgentApiPrincipal;
}): express.Express => {
  const app = express();
  app.use(
    "/api/v1/rooms",
    createHelixSharedLiveRoomRouter({
      controlService: asControl(input?.control ?? controlDouble()),
      bindingStore: asBindings(input?.bindings ?? bindingDouble()),
      authenticate: async () => input?.authPrincipal ?? principal(),
      rateLimit: false,
      enforceTransportSecurity: false,
    }),
  );
  return app;
};

describe("Shared Live Room REST facade", () => {
  const invite = `helix_live_${"x".repeat(32)}`;
  it("accepts a purpose-bound invitation and derives joining identity from OAuth", async () => {
    const control = controlDouble();
    const response = await request(restApp({ control })).post("/api/v1/rooms/join")
      .set("Idempotency-Key", "join-rest-001").send({ room_id: ROOM_ID, invite_code: invite }).expect(201);
    expect(control.joinRoom).toHaveBeenCalledWith({ actor: expect.objectContaining({ profileId: "profile-room-transport", authKind: "external_oauth" }),
      idempotencyKey: "join-rest-001", request: { room_id: ROOM_ID, invite_code: invite } });
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain(invite);
  });

  it.each(["profile_id", "consent", "provider_api_key"])("rejects extra %s at the invitation boundary", async (field) => {
    const control = controlDouble();
    const response = await request(restApp({ control })).post("/api/v1/rooms/join")
      .set("Idempotency-Key", "join-rest-001").send({ room_id: ROOM_ID, invite_code: invite, [field]: "forged" }).expect(400);
    expect(control.joinRoom).not.toHaveBeenCalled();
    expect(JSON.stringify(response.body)).not.toContain(invite);
  });

  it("requires both read and manage scopes before invitation redemption", async () => {
    for (const scopes of [[HELIX_SHARED_LIVE_ROOM_READ_SCOPE], [HELIX_SHARED_LIVE_ROOM_MANAGE_SCOPE]]) {
      const control = controlDouble();
      await request(restApp({ control, authPrincipal: principal(scopes) })).post("/api/v1/rooms/join")
        .set("Idempotency-Key", "join-rest-001").send({ room_id: ROOM_ID, invite_code: invite }).expect(403);
      expect(control.joinRoom).not.toHaveBeenCalled();
    }
  });

  it("does not permit invitations in query parameters or other operations", async () => {
    const control = controlDouble();
    await request(restApp({ control })).post("/api/v1/rooms/join").query({ invite_code: invite })
      .set("Idempotency-Key", "join-rest-001").send({ room_id: ROOM_ID, invite_code: invite }).expect(400);
    await request(restApp({ control })).post("/api/v1/rooms")
      .set("Idempotency-Key", "join-rest-001").send({ title: "Room", invite_code: invite }).expect(400);
    expect(control.joinRoom).not.toHaveBeenCalled();
    expect(control.createRoom).not.toHaveBeenCalled();
  });

  it("derives identity from OAuth principal and preserves durable create idempotency", async () => {
    const control = controlDouble();
    const response = await request(restApp({ control }))
      .post("/api/v1/rooms")
      .set("Idempotency-Key", "stable-room-create")
      .send({ title: "Transport room" })
      .expect(201);

    expect(response.headers.location).toBe(
      `/api/v1/rooms/${encodeURIComponent(ROOM_ID)}`,
    );
    expect(response.headers["idempotency-replayed"]).toBe("true");
    expect(control.createRoom).toHaveBeenCalledWith({
      actor: expect.objectContaining({
        authKind: "external_oauth",
        profileId: "profile-room-transport",
        idempotencyOwner: {
          tenantId: "tenant-room-transport",
          issuer: "https://issuer.example",
          subjectId: "subject-room-transport",
          accountProfileId: "profile-room-transport",
        },
      }),
      idempotencyKey: "stable-room-create",
      request: { title: "Transport room" },
    });
  });

  it("rejects caller-supplied identity before invoking the control service", async () => {
    const control = controlDouble();
    const response = await request(restApp({ control }))
      .post("/api/v1/rooms")
      .set("Idempotency-Key", "stable-room-create")
      .send({
        title: "Transport room",
        owner_profile_id: "forged-profile",
      })
      .expect(400);

    expect(response.body).toMatchObject({
      schema: "helix.shared_live_room.error.v1",
      api_version: "v1",
      error: "invalid_request",
    });
    expect(control.createRoom).not.toHaveBeenCalled();
  });

  it("never echoes credential-shaped request IDs, values, or schema keys", async () => {
    const control = controlDouble();
    const app = restApp({ control });
    const requestIdSecret = "agent_chat_claim_room_request_secret_123456";
    const listed = await request(app)
      .get("/api/v1/rooms")
      .set("X-Request-Id", requestIdSecret)
      .expect(200);
    expect(listed.headers["x-request-id"]).toMatch(/^room_req_/);
    expect(
      JSON.stringify({
        headers: listed.headers,
        body: listed.body,
      }),
    ).not.toContain(requestIdSecret);

    const sourceBearer = "helix_room_src_room_title_secret_123456";
    const rejectedTitle = await request(app)
      .post("/api/v1/rooms")
      .set("Idempotency-Key", "protected-room-title")
      .send({ title: sourceBearer })
      .expect(400);
    expect(rejectedTitle.body.error).toBe(
      "protected_sensitive_content_rejected",
    );
    expect(JSON.stringify(rejectedTitle.body)).not.toContain(sourceBearer);

    const unknownKeySecret = "room_source_claim_room_schema_key_secret_123456";
    const rejectedKey = await request(app)
      .post("/api/v1/rooms")
      .set("Idempotency-Key", "protected-room-key")
      .send({
        title: "Safe room",
        [unknownKeySecret]: true,
      })
      .expect(400);
    expect(rejectedKey.body.error).toBe("protected_sensitive_content_rejected");
    expect(JSON.stringify(rejectedKey.body)).not.toContain(unknownKeySecret);
    expect(control.createRoom).not.toHaveBeenCalled();
  });

  it("returns only a deferred credential handle for source creation", async () => {
    const control = controlDouble();
    const response = await request(restApp({ control }))
      .post(`/api/v1/rooms/${encodeURIComponent(ROOM_ID)}/sources`)
      .set("Idempotency-Key", "stable-source-create")
      .send({ world_id: "minecraft:overworld" })
      .expect(201);

    expect(response.body).toMatchObject({
      credential_delivery: {
        claim_handle: "room_source_claim_transport_123456789",
        bearer_included: false,
        plugin_config_included: false,
      },
      execution_enabled: false,
      command_execution_enabled: false,
    });
    expect(JSON.stringify(response.body).toLowerCase()).not.toContain(
      "authorization: bearer",
    );
    expect(control.createSourceBinding).toHaveBeenCalledWith({
      actor: expect.objectContaining({
        profileId: "profile-room-transport",
      }),
      roomId: ROOM_ID,
      idempotencyKey: "stable-source-create",
      request: { world_id: "minecraft:overworld" },
    });
  });

  it("binds the exact owner run and claims chat without exposing chat identity", async () => {
    const bindings = bindingDouble();
    const app = restApp({ bindings });

    const run = await request(app)
      .post("/api/v1/rooms/run-bindings")
      .send({ run_id: RUN_ID, room_id: ROOM_ID })
      .expect(201);
    expect(run.body).toMatchObject({
      operation: "room.run.bind",
      binding_ref: "agent_room_binding:transport",
      run_id: RUN_ID,
      room_id: ROOM_ID,
      answer_authority: false,
    });
    expect(run.body).not.toHaveProperty("participant_id_at_bind");
    expect(bindings.bindRunToRoom).toHaveBeenCalledWith({
      owner: roomBinding.owner,
      runId: RUN_ID,
      roomId: ROOM_ID,
    });

    const chat = await request(app)
      .post("/api/v1/rooms/chat-bindings/claim")
      .send({
        run_id: RUN_ID,
        claim_handle: "agent_chat_claim_transport_123456789",
      })
      .expect(201);
    expect(chat.body).toMatchObject({
      operation: "room.chat_binding.claim",
      binding_ref: "agent_chat_binding:transport",
      run_id: RUN_ID,
      context_message_count: 4,
      answer_authority: false,
    });
    expect(chat.body).not.toHaveProperty("chat_session_id");
    expect(chat.body).not.toHaveProperty("browser_profile_id");
  });

  it("withdraws exact opaque run/chat bindings even after room policy is locked", async () => {
    const bindings = bindingDouble();
    const app = restApp({
      bindings,
      authPrincipal: principal(undefined, "user"),
    });

    const run = await request(app)
      .delete(
        `/api/v1/rooms/run-bindings/${encodeURIComponent(
          roomBinding.bindingId,
        )}`,
      )
      .expect(200);
    expect(run.body).toMatchObject({
      schema: "helix.shared_live_room.run_unbind_receipt.v1",
      operation: "room.run.unbind",
      binding_ref: roomBinding.bindingId,
      binding_status: "revoked",
      revocation_status: "revoked",
      answer_authority: false,
    });
    expect(run.body).not.toHaveProperty("run_id");
    expect(run.body).not.toHaveProperty("room_id");
    expect(bindings.revokeRunRoomBindingForOwner).toHaveBeenCalledWith({
      owner: roomBinding.owner,
      bindingRef: roomBinding.bindingId,
    });

    const chat = await request(app)
      .delete(
        `/api/v1/rooms/chat-bindings/${encodeURIComponent(
          chatBinding.bindingId,
        )}`,
      )
      .expect(200);
    expect(chat.body).toMatchObject({
      schema: "helix.shared_live_room.chat_binding_unbind_receipt.v1",
      operation: "room.chat_binding.unbind",
      binding_ref: chatBinding.bindingId,
      binding_status: "revoked",
      revocation_status: "revoked",
      answer_authority: false,
    });
    expect(chat.body).not.toHaveProperty("run_id");
    expect(chat.body).not.toHaveProperty("chat_session_id");
    expect(bindings.revokeClaimedRunChatBindingForOwner).toHaveBeenCalledWith({
      owner: roomBinding.owner,
      bindingRef: chatBinding.bindingId,
    });
  });

  it("blocks room reads and every new attachment mutation after policy is locked", async () => {
    const bindings = bindingDouble();
    const app = restApp({
      control: new SharedLiveRoomControlService(),
      bindings,
      authPrincipal: principal(undefined, "user"),
    });

    const responses = [
      await request(app).get("/api/v1/rooms").expect(403),
      await request(app)
        .get(`/api/v1/rooms/${encodeURIComponent(ROOM_ID)}`)
        .expect(403),
      await request(app)
        .post("/api/v1/rooms")
        .set("Idempotency-Key", "locked-room-create")
        .send({ title: "Blocked" })
        .expect(403),
      await request(app)
        .get(`/api/v1/rooms/${encodeURIComponent(ROOM_ID)}/sources`)
        .expect(403),
      await request(app)
        .post(`/api/v1/rooms/${encodeURIComponent(ROOM_ID)}/sources`)
        .set("Idempotency-Key", "locked-source-create")
        .send({ world_id: "minecraft:overworld" })
        .expect(403),
      await request(app)
        .post("/api/v1/rooms/run-bindings")
        .send({ run_id: RUN_ID, room_id: ROOM_ID })
        .expect(403),
      await request(app)
        .post("/api/v1/rooms/chat-bindings/claim")
        .send({
          run_id: RUN_ID,
          claim_handle: "agent_chat_claim_transport_123456789",
        })
        .expect(403),
    ];

    for (const response of responses) {
      expect(response.body).toMatchObject({
        schema: "helix.shared_live_room.error.v1",
        error: "account_policy_blocked",
        retryable: false,
      });
    }
    expect(bindings.bindRunToRoom).not.toHaveBeenCalled();
    expect(bindings.claimPendingChatBinding).not.toHaveBeenCalled();
  });

  it("rejects body or query identity on binding withdrawal", async () => {
    const bindings = bindingDouble();
    const app = restApp({ bindings });
    await request(app)
      .delete(
        `/api/v1/rooms/run-bindings/${encodeURIComponent(
          roomBinding.bindingId,
        )}?run_id=${encodeURIComponent(RUN_ID)}`,
      )
      .expect(400);
    await request(app)
      .delete(
        `/api/v1/rooms/chat-bindings/${encodeURIComponent(
          chatBinding.bindingId,
        )}`,
      )
      .send({ chat_session_id: "private-chat-session-id" })
      .expect(400);
    expect(bindings.revokeRunRoomBindingForOwner).not.toHaveBeenCalled();
    expect(bindings.revokeClaimedRunChatBindingForOwner).not.toHaveBeenCalled();
  });

  it("keeps command execution disabled with a stable typed failure", async () => {
    const response = await request(restApp())
      .post(`/api/v1/rooms/${encodeURIComponent(ROOM_ID)}/commands`)
      .send({ command: "time set day" })
      .expect(501);

    expect(response.body).toEqual(
      expect.objectContaining({
        schema: "helix.shared_live_room.error.v1",
        api_version: "v1",
        error: "command_execution_not_enabled",
        retryable: false,
        details: {
          execution_enabled: false,
          sensor_credentials_accepted: false,
        },
      }),
    );
  });

  it("does not admit room tools without their dedicated OAuth scope", async () => {
    const response = await request(
      restApp({
        authPrincipal: principal([HELIX_SHARED_LIVE_ROOM_READ_SCOPE]),
      }),
    )
      .post("/api/v1/rooms")
      .set("Idempotency-Key", "stable-room-create")
      .send({ title: "Blocked" })
      .expect(403);
    expect(response.body.error).toBe("insufficient_scope");
    expect(response.headers["www-authenticate"]).toContain(
      `scope="${HELIX_SHARED_LIVE_ROOM_MANAGE_SCOPE}"`,
    );
  });

  it("requires both room-manage and run-write scopes for run and chat attachment", async () => {
    const app = restApp({
      authPrincipal: principal([HELIX_SHARED_LIVE_ROOM_MANAGE_SCOPE]),
    });
    for (const requestPath of [
      "/api/v1/rooms/run-bindings",
      "/api/v1/rooms/chat-bindings/claim",
    ]) {
      const response = await request(app)
        .post(requestPath)
        .send(
          requestPath.endsWith("run-bindings")
            ? { run_id: RUN_ID, room_id: ROOM_ID }
            : {
                run_id: RUN_ID,
                claim_handle: "agent_chat_claim_transport_123456789",
              },
        )
        .expect(403);
      expect(response.body).toMatchObject({
        error: "insufficient_scope",
        details: {
          required_scope: HELIX_AGENT_RUN_WRITE_SCOPE,
          required_oauth_scopes: [HELIX_AGENT_RUN_WRITE_SCOPE],
        },
      });
      expect(response.headers["www-authenticate"]).toContain(
        `scope="${HELIX_AGENT_RUN_WRITE_SCOPE}"`,
      );
    }
  });

  it("requires both room-manage and run-write scopes for run and chat withdrawal", async () => {
    const scopeCases = [
      {
        granted: [HELIX_SHARED_LIVE_ROOM_MANAGE_SCOPE],
        missing: HELIX_AGENT_RUN_WRITE_SCOPE,
      },
      {
        granted: [HELIX_AGENT_RUN_WRITE_SCOPE],
        missing: HELIX_SHARED_LIVE_ROOM_MANAGE_SCOPE,
      },
    ] as const;

    for (const scopeCase of scopeCases) {
      const bindings = bindingDouble();
      const app = restApp({
        bindings,
        authPrincipal: principal(scopeCase.granted),
      });
      const responses = [
        await request(app)
          .delete(
            `/api/v1/rooms/run-bindings/${encodeURIComponent(
              roomBinding.bindingId,
            )}`,
          )
          .expect(403),
        await request(app)
          .delete(
            `/api/v1/rooms/chat-bindings/${encodeURIComponent(
              chatBinding.bindingId,
            )}`,
          )
          .expect(403),
      ];

      for (const response of responses) {
        expect(response.body).toMatchObject({
          error: "insufficient_scope",
          details: {
            required_scope: scopeCase.missing,
            required_oauth_scopes: [scopeCase.missing],
          },
        });
        expect(response.headers["www-authenticate"]).toContain(
          `scope="${scopeCase.missing}"`,
        );
      }
      expect(bindings.revokeRunRoomBindingForOwner).not.toHaveBeenCalled();
      expect(
        bindings.revokeClaimedRunChatBindingForOwner,
      ).not.toHaveBeenCalled();
    }
  });
});

describe("Shared Live Room MCP facade", () => {
  const connect = async (input?: {
    scopes?: readonly string[];
    control?: ControlFacade;
    bindings?: BindingDouble;
    authPrincipal?: HelixAgentApiPrincipal;
  }) => {
    const server = createHelixMcpServer({
      principal: input?.authPrincipal ?? principal(input?.scopes),
      roomControlService: asControl(input?.control ?? controlDouble()),
      roomBindingStore: asBindings(input?.bindings ?? bindingDouble()),
    });
    const client = new Client(
      { name: "room-facade-test", version: "1.0.0" },
      { capabilities: {} },
    );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return {
      client,
      close: async () => {
        await client.close();
        await server.close();
      },
    };
  };

  it("joins an invitation through the shared service as the authenticated account", async () => {
    const control = controlDouble(); const connection = await connect({ control });
    const invite = `helix_live_${"a".repeat(32)}`;
    try {
      const tools = await connection.client.listTools();
      expect(tools.tools.find(tool => tool.name === "helix_room_join")).toMatchObject({
        annotations: { readOnlyHint: false, idempotentHint: true },
        _meta: { securitySchemes: [{ type: "oauth2", scopes: [HELIX_SHARED_LIVE_ROOM_READ_SCOPE, HELIX_SHARED_LIVE_ROOM_MANAGE_SCOPE] }] },
      });
      const result = await connection.client.callTool({ name: "helix_room_join", arguments: {
        idempotency_key: "mcp-join-001", request: { room_id: ROOM_ID, invite_code: invite },
      } });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ operation: "room.join", idempotency_replayed: false,
        receipt: { room: { room_id: ROOM_ID }, answer_authority: false, assistant_answer: false } });
      expect(control.joinRoom).toHaveBeenCalledWith(expect.objectContaining({ actor: expect.objectContaining({ profileId: "profile-room-transport" }),
        idempotencyKey: "mcp-join-001", request: { room_id: ROOM_ID, invite_code: invite } }));
      expect(JSON.stringify(result)).not.toContain(invite);
    } finally { await connection.close(); }
  });

  it.each([[HELIX_SHARED_LIVE_ROOM_READ_SCOPE], [HELIX_SHARED_LIVE_ROOM_MANAGE_SCOPE]])("requires both join scopes %#", async scope => {
    const control = controlDouble(); const connection = await connect({ control, scopes: scope });
    try {
      const result = await connection.client.callTool({ name: "helix_room_join", arguments: {
        idempotency_key: "mcp-join-001", request: { room_id: ROOM_ID, invite_code: `helix_live_${"a".repeat(32)}` },
      } });
      expect(result.isError).toBe(true); expect(control.joinRoom).not.toHaveBeenCalled();
    } finally { await connection.close(); }
  });

  it("rejects forged participant identity and consent before joining", async () => {
    const control = controlDouble(); const connection = await connect({ control });
    try {
      for (const extra of [{ profile_id: "owner" }, { consent: { microphone_to_model: true } }]) {
        const result = await connection.client.callTool({ name: "helix_room_join", arguments: { idempotency_key: "mcp-join-001",
          request: { room_id: ROOM_ID, invite_code: `helix_live_${"a".repeat(32)}`, ...extra } } });
        expect(result.isError).toBe(true);
      }
      expect(control.joinRoom).not.toHaveBeenCalled();
    } finally { await connection.close(); }
  });

  it("lists a stable OAuth-upgrade catalog and exposes no chat enumeration", async () => {
    // This suite owns the room/run families. Other independently tested MCP
    // families may coexist, but must not change when the caller upgrades scope.
    const roomRunNames = (tools: { name: string }[]) => tools.map(tool => tool.name)
      .filter(name => /^(helix_room_|helix_run_)/u.test(name)).sort();
    const expectedRoomRunNames = [
      "helix_room_bind_run",
      "helix_room_claim_chat_binding",
      "helix_room_command_request",
      "helix_room_consent_grant",
      "helix_room_consent_revoke",
      "helix_room_create",
      "helix_room_floor_acquire",
      "helix_room_floor_inspect",
      "helix_room_floor_release",
      "helix_room_inspect",
      "helix_room_join",
      "helix_room_list",
      "helix_room_presence_set",
      "helix_room_source_create",
      "helix_room_source_list",
      "helix_room_unbind_chat",
      "helix_room_unbind_run",
      "helix_run_cancel",
      "helix_run_continue",
      "helix_run_evidence_reenter",
      "helix_run_fetch_evidence",
      "helix_run_inspect",
      "helix_run_list_events",
      "helix_run_start",
    ];
    let fullCatalogNames: string[] = [];
    const connection = await connect();
    try {
      expect(connection.client.getInstructions()).toContain(
        "source creation returns only an opaque secure-delivery handle",
      );
      expect(connection.client.getInstructions()).toContain(
        "command execution is disabled",
      );
      const listed = await connection.client.listTools();
      expect(validateSharedLiveRoomToolCatalog(listed.tools)).toEqual([]);
      const names = listed.tools.map((tool) => tool.name).sort();
      fullCatalogNames = names;
      expect(new Set(names).size).toBe(names.length);
      expect(roomRunNames(listed.tools)).toEqual(expectedRoomRunNames);
      expect(names.some((name) => name.includes("chat_list"))).toBe(false);
      expect(
        listed.tools.find(
          (tool) => tool.name === "helix_room_claim_chat_binding",
        ),
      ).toMatchObject({
        annotations: {
          idempotentHint: false,
        },
        _meta: {
          securitySchemes: [
            {
              type: "oauth2",
              scopes: [
                HELIX_SHARED_LIVE_ROOM_MANAGE_SCOPE,
                HELIX_AGENT_RUN_WRITE_SCOPE,
              ],
            },
          ],
        },
      });
    } finally {
      await connection.close();
    }

    const readOnly = await connect({
      scopes: [HELIX_SHARED_LIVE_ROOM_READ_SCOPE],
    });
    try {
      const listed = await readOnly.client.listTools();
      expect(roomRunNames(listed.tools)).toEqual(expectedRoomRunNames);
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual(fullCatalogNames);
    } finally {
      await readOnly.close();
    }
  });

  it("returns safe source delivery and typed disabled-command MCP results", async () => {
    const connection = await connect();
    try {
      const created = await connection.client.callTool({
        name: "helix_room_source_create",
        arguments: {
          room_id: ROOM_ID,
          idempotency_key: "mcp-source-create",
          request: { world_id: "minecraft:overworld" },
        },
      });
      expect(created.isError).not.toBe(true);
      expect(created.structuredContent).toMatchObject({
        operation: "room.source.create",
        receipt: {
          credential_delivery: {
            claim_handle: "room_source_claim_transport_123456789",
            bearer_included: false,
            plugin_config_included: false,
          },
          execution_enabled: false,
          command_execution_enabled: false,
        },
      });
      expect(
        JSON.stringify(created.structuredContent).toLowerCase(),
      ).not.toContain("authorization: bearer");

      const command = await connection.client.callTool({
        name: "helix_room_command_request",
        arguments: {
          room_id: ROOM_ID,
          command: "time set day",
        },
      });
      expect(command.isError).toBe(true);
      expect(command.structuredContent).toMatchObject({
        schema: "helix.shared_live_room.error.v1",
        error: "command_execution_not_enabled",
        details: {
          execution_enabled: false,
          sensor_credentials_accepted: false,
        },
      });
    } finally {
      await connection.close();
    }
  });

  it("claims only an opaque browser handle and does not return chat IDs", async () => {
    const connection = await connect();
    try {
      const result = await connection.client.callTool({
        name: "helix_room_claim_chat_binding",
        arguments: {
          request: {
            run_id: RUN_ID,
            claim_handle: "agent_chat_claim_transport_123456789",
          },
        },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        operation: "room.chat_binding.claim",
        binding_ref: "agent_chat_binding:transport",
        run_id: RUN_ID,
      });
      expect(JSON.stringify(result.structuredContent)).not.toContain(
        "private-chat-session-id",
      );
    } finally {
      await connection.close();
    }
  });

  it("withdraws opaque bindings through MCP after room policy loss", async () => {
    const bindings = bindingDouble();
    const connection = await connect({
      bindings,
      authPrincipal: principal(undefined, "user"),
    });
    try {
      const run = await connection.client.callTool({
        name: "helix_room_unbind_run",
        arguments: { binding_ref: roomBinding.bindingId },
      });
      expect(run.isError).not.toBe(true);
      expect(run.structuredContent).toMatchObject({
        operation: "room.run.unbind",
        binding_ref: roomBinding.bindingId,
        binding_status: "revoked",
      });

      const chat = await connection.client.callTool({
        name: "helix_room_unbind_chat",
        arguments: { binding_ref: chatBinding.bindingId },
      });
      expect(chat.isError).not.toBe(true);
      expect(chat.structuredContent).toMatchObject({
        operation: "room.chat_binding.unbind",
        binding_ref: chatBinding.bindingId,
        binding_status: "revoked",
      });
      expect(JSON.stringify(chat.structuredContent)).not.toContain(
        "private-chat-session-id",
      );
    } finally {
      await connection.close();
    }
  });

  it("blocks MCP room reads and every new attachment mutation after policy is locked", async () => {
    const bindings = bindingDouble();
    const connection = await connect({
      control: new SharedLiveRoomControlService(),
      bindings,
      authPrincipal: principal(undefined, "user"),
    });
    try {
      const results = [
        await connection.client.callTool({
          name: "helix_room_list",
          arguments: {},
        }),
        await connection.client.callTool({
          name: "helix_room_inspect",
          arguments: { room_id: ROOM_ID },
        }),
        await connection.client.callTool({
          name: "helix_room_create",
          arguments: {
            idempotency_key: "locked-room-create",
            request: { title: "Blocked" },
          },
        }),
        await connection.client.callTool({
          name: "helix_room_source_list",
          arguments: { room_id: ROOM_ID },
        }),
        await connection.client.callTool({
          name: "helix_room_source_create",
          arguments: {
            room_id: ROOM_ID,
            idempotency_key: "locked-source-create",
            request: { world_id: "minecraft:overworld" },
          },
        }),
        await connection.client.callTool({
          name: "helix_room_bind_run",
          arguments: {
            request: { run_id: RUN_ID, room_id: ROOM_ID },
          },
        }),
        await connection.client.callTool({
          name: "helix_room_claim_chat_binding",
          arguments: {
            request: {
              run_id: RUN_ID,
              claim_handle: "agent_chat_claim_transport_123456789",
            },
          },
        }),
      ];

      for (const result of results) {
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toMatchObject({
          schema: "helix.shared_live_room.error.v1",
          error: "account_policy_blocked",
          retryable: false,
        });
      }
      expect(bindings.bindRunToRoom).not.toHaveBeenCalled();
      expect(bindings.claimPendingChatBinding).not.toHaveBeenCalled();
    } finally {
      await connection.close();
    }
  });

  it("requires both room-manage and run-write scopes for MCP withdrawal", async () => {
    const scopeCases = [
      {
        granted: [HELIX_SHARED_LIVE_ROOM_MANAGE_SCOPE],
        missing: HELIX_AGENT_RUN_WRITE_SCOPE,
      },
      {
        granted: [HELIX_AGENT_RUN_WRITE_SCOPE],
        missing: HELIX_SHARED_LIVE_ROOM_MANAGE_SCOPE,
      },
    ] as const;

    for (const scopeCase of scopeCases) {
      const bindings = bindingDouble();
      const connection = await connect({
        scopes: scopeCase.granted,
        bindings,
      });
      try {
        const results = [
          await connection.client.callTool({
            name: "helix_room_unbind_run",
            arguments: { binding_ref: roomBinding.bindingId },
          }),
          await connection.client.callTool({
            name: "helix_room_unbind_chat",
            arguments: { binding_ref: chatBinding.bindingId },
          }),
        ];

        for (const result of results) {
          expect(result.isError).toBe(true);
          expect(result.structuredContent).toMatchObject({
            error: "insufficient_scope",
            details: {
              required_scope: scopeCase.missing,
              required_oauth_scopes: [scopeCase.missing],
            },
          });
          const meta = (
            result as unknown as {
              _meta?: Record<string, unknown>;
            }
          )._meta;
          const challenges = meta?.["mcp/www_authenticate"];
          expect(challenges).toEqual([expect.any(String)]);
          const challenge = (challenges as string[])[0];
          expect(challenge).toContain(HELIX_SHARED_LIVE_ROOM_MANAGE_SCOPE);
          expect(challenge).toContain(HELIX_AGENT_RUN_WRITE_SCOPE);
        }
        expect(bindings.revokeRunRoomBindingForOwner).not.toHaveBeenCalled();
        expect(
          bindings.revokeClaimedRunChatBindingForOwner,
        ).not.toHaveBeenCalled();
      } finally {
        await connection.close();
      }
    }
  });

  it("rejects extra MCP withdrawal identity before calling the binding store", async () => {
    const bindings = bindingDouble();
    const connection = await connect({ bindings });
    try {
      const run = await connection.client.callTool({
        name: "helix_room_unbind_run",
        arguments: {
          binding_ref: roomBinding.bindingId,
          run_id: RUN_ID,
        },
      });
      const chat = await connection.client.callTool({
        name: "helix_room_unbind_chat",
        arguments: {
          binding_ref: chatBinding.bindingId,
          chat_session_id: "private-chat-session-id",
        },
      });

      for (const result of [run, chat]) {
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result.content)).toContain(
          "Input validation error",
        );
      }
      expect(bindings.revokeRunRoomBindingForOwner).not.toHaveBeenCalled();
      expect(
        bindings.revokeClaimedRunChatBindingForOwner,
      ).not.toHaveBeenCalled();
    } finally {
      await connection.close();
    }
  });

  it("passes only the principal owner tuple and fails foreign opaque refs closed", async () => {
    const bindings = bindingDouble();
    bindings.revokeRunRoomBindingForOwner.mockRejectedValue(
      new SharedLiveRoomBindingStoreError(
        "run_room_binding_not_found",
        404,
        "Run-room binding not found.",
      ),
    );
    bindings.revokeClaimedRunChatBindingForOwner.mockRejectedValue(
      new SharedLiveRoomBindingStoreError(
        "chat_binding_not_found",
        404,
        "Chat binding not found.",
      ),
    );
    const foreignPrincipal = {
      ...principal(),
      subjectId: "subject-room-foreign",
    };
    const connection = await connect({
      bindings,
      authPrincipal: foreignPrincipal,
    });
    try {
      const run = await connection.client.callTool({
        name: "helix_room_unbind_run",
        arguments: { binding_ref: roomBinding.bindingId },
      });
      expect(run.isError).toBe(true);
      expect(run.structuredContent).toMatchObject({
        error: "run_room_binding_not_found",
        retryable: false,
      });
      expect(JSON.stringify(run.structuredContent)).not.toContain(RUN_ID);
      expect(JSON.stringify(run.structuredContent)).not.toContain(ROOM_ID);
      expect(bindings.revokeRunRoomBindingForOwner).toHaveBeenCalledWith({
        owner: {
          ...roomBinding.owner,
          subjectId: "subject-room-foreign",
        },
        bindingRef: roomBinding.bindingId,
      });

      const chat = await connection.client.callTool({
        name: "helix_room_unbind_chat",
        arguments: { binding_ref: chatBinding.bindingId },
      });
      expect(chat.isError).toBe(true);
      expect(chat.structuredContent).toMatchObject({
        error: "chat_binding_not_found",
        retryable: false,
      });
      expect(JSON.stringify(chat.structuredContent)).not.toContain(
        "private-chat-session-id",
      );
      expect(bindings.revokeClaimedRunChatBindingForOwner).toHaveBeenCalledWith(
        {
          owner: {
            ...roomBinding.owner,
            subjectId: "subject-room-foreign",
          },
          bindingRef: chatBinding.bindingId,
        },
      );
    } finally {
      await connection.close();
    }
  });

  it("forwards the same room service through stateless MCP HTTP transport", async () => {
    const control = controlDouble();
    const app = express();
    app.use(
      "/mcp",
      createHelixMcpRouter({
        createServer: ({ principal, service }) =>
          createHelixMcpServer({
            principal,
            service,
            roomControlService: asControl(control),
            roomBindingStore: asBindings(bindingDouble()),
          }),
        authenticate: async () => principal(),
        rateLimit: false,
        enforceTransportSecurity: false,
      }),
    );

    const response = await request(app)
      .post("/mcp")
      .set("Content-Type", "application/json")
      .set("Accept", "application/json, text/event-stream")
      .set("MCP-Protocol-Version", "2025-06-18")
      .send({
        jsonrpc: "2.0",
        id: "room-list-http",
        method: "tools/call",
        params: {
          name: "helix_room_list",
          arguments: {},
        },
      })
      .expect(200);

    expect(response.body).toMatchObject({
      jsonrpc: "2.0",
      id: "room-list-http",
      result: {
        structuredContent: {
          operation: "room.list",
          answer_authority: false,
        },
      },
    });
    expect(control.listRooms).toHaveBeenCalledTimes(1);

    const claimed = await request(app)
      .post("/mcp")
      .set("Content-Type", "application/json")
      .set("Accept", "application/json, text/event-stream")
      .set("MCP-Protocol-Version", "2025-06-18")
      .send({
        jsonrpc: "2.0",
        id: "chat-claim-http",
        method: "tools/call",
        params: {
          name: "helix_room_claim_chat_binding",
          arguments: {
            request: {
              run_id: RUN_ID,
              claim_handle: "agent_chat_claim_transport_123456789",
            },
          },
        },
      })
      .expect(200);
    expect(claimed.body).toMatchObject({
      jsonrpc: "2.0",
      id: "chat-claim-http",
      result: {
        structuredContent: {
          operation: "room.chat_binding.claim",
          binding_ref: "agent_chat_binding:transport",
        },
      },
    });
  });
});
