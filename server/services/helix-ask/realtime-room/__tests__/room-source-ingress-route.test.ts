import crypto from "node:crypto";
import express, { type Request } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import manifestFixture from "../../../../../fixtures/environment-source/minecraft/plugin-manifest.mvp.json";
import { HELIX_DEVELOPER_ACCOUNT_POLICY, HELIX_USER_ACCOUNT_POLICY } from "@shared/helix-account-session";
import {
  HELIX_ROOM_SOURCE_ADMISSION_SCHEMA,
  type HelixRoomSourceAdmission,
} from "@shared/helix-room-source-ingress";
import {
  HELIX_ENVIRONMENT_PROBE_SUBMISSION_SCHEMA,
  HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY,
} from "@shared/helix-environment-connector";
import type { HelixEnvironmentAdapterAdmissionProjection } from "@shared/helix-environment-adapter-profile";
import { accountSessionRouter } from "../../../../routes/account-session";
import { sharedRealtimeRoomRouter } from "../../../../routes/agi.realtime-room/index";
import {
  sharedRealtimeRoomSourceCredentialClaimRouter,
  sharedRealtimeRoomSourceLinkRouter,
} from "../../../../routes/agi.realtime-room/source-link-routes";
import { environmentSourceRouter } from "../../../../routes/environment-source-routes";
import { roomSourceIngressRouter } from "../../../../routes/room-source-ingress";
import { ensureDatabase, getPool } from "../../../../db/client";
import { isPublicRoomSourceIngressPath } from "../../../../auth/public-source-ingress";
import { resetAccountSessionStore } from "../../../helix-account/account-session-store";
import * as accountSessionStore from "../../../helix-account/account-session-store";
import {
  createEnvironmentProbeRequest,
  resetEnvironmentProbeBrokerForTest,
} from "../../../situation-room/environment-probe-broker";
import { resetEnvironmentSourceHeartbeatStoreForTest } from "../../../situation-room/environment-source-heartbeat-store";
import { resetEnvironmentSourceRegistryForTest } from "../../../situation-room/environment-source-registry";
import { getEnvironmentSourceManifest } from "../../../situation-room/environment-source-registry";
import { queryEventJournal } from "../../../situation-room/event-journal-store";
import {
  buildRoomSourceRequestEvidenceRef,
  projectRoomSourceRequestId,
} from "../../../situation-room/room-source-ingress-security";
import { resetWorldEventIngestState } from "../../../situation-room/world-event-ingest";
import { readLatestBoundRoomSourceCandidate } from "../../workstation-tool-gateway/bound-room-evidence";
import { resetSharedRealtimeRoomStore } from "../room-store";
import { resetRoomSourceIngressStoreForTest } from "../source-link-store";
import {
  getSharedLiveRoomBindingStore,
  getSharedLiveRoomControlService,
} from "../../../shared-live-room-control/default-service";
import {
  listActiveEnvironmentConnectorBindings,
} from "../../../environment-connectors/bindings";
import {
  listEnvironmentConnectorCapabilityDescriptors,
  readEnvironmentConnectorCapabilityDescriptor,
} from "../../../environment-connectors/catalog";
import {
  dispatchDurableEnvironmentProbe,
  readDurableEnvironmentProbeObservation,
} from "../../../environment-connectors/probe";

type SignedHeaders = Record<string, string>;
const SAME_ORIGIN_HEADERS = {
  Host: "casimirbot.test",
  Origin: "http://casimirbot.test",
  "Sec-Fetch-Site": "same-origin",
};

const createApp = (input?: {
  rejectRemainingAgiAsGlobalJwt?: boolean;
}): express.Express => {
  const app = express();
  app.use(
    "/api/account",
    express.json({
      limit: "1mb",
    }),
    accountSessionRouter,
  );
  app.use("/api/agi", sharedRealtimeRoomSourceLinkRouter);
  app.use("/api/agi", sharedRealtimeRoomSourceCredentialClaimRouter);
  if (input?.rejectRemainingAgiAsGlobalJwt) {
    app.use("/api/agi", (_req, res) => {
      res.status(401).json({ error: "global_jwt_blocked" });
    });
  }
  app.use(
    express.json({
      limit: "1mb",
      verify: (incoming, _response, body) => {
        (incoming as typeof incoming & { rawBody?: Buffer }).rawBody =
          Buffer.from(body);
      },
    }),
  );
  app.use("/api/agi", sharedRealtimeRoomRouter);
  app.use("/api/agi/environment", environmentSourceRouter);
  app.use("/api/room-ingress", roomSourceIngressRouter);
  return app;
};

const digest = (body: string): string =>
  `sha-256=${crypto.createHash("sha256").update(body, "utf8").digest("base64")}`;

const ingressHeaderFactory = (token: string) => {
  const producerEpoch = crypto.randomUUID();
  let sequence = 0;
  return (
    body: string,
    overrides: Partial<SignedHeaders> = {},
  ): SignedHeaders => ({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-Helix-Ingress-Version": "1",
    "X-Helix-Request-Id": crypto.randomUUID(),
    "X-Helix-Producer-Epoch": producerEpoch,
    "X-Helix-Sequence": String(++sequence),
    "X-Helix-Sent-At": new Date().toISOString(),
    Digest: digest(body),
    ...overrides,
  });
};

const signIn = async (
  app: express.Express,
  profileId: string,
  displayName: string,
  accountType: "developer" | "user" = "developer",
) => {
  const agent = request.agent(app);
  await agent
    .post("/api/account/session/sign-in")
    .send({
      profile_id: profileId,
      display_name: displayName,
      account_type: accountType,
    })
    .expect(200);
  return agent;
};

const createRoom = async (
  agent: ReturnType<typeof request.agent>,
  title = "Minecraft source room",
): Promise<string> => {
  const created = await agent
    .post("/api/agi/realtime/rooms")
    .send({ title })
    .expect(201);
  return created.body.room.room_id as string;
};

const createBinding = async (
  agent: ReturnType<typeof request.agent>,
  roomId: string,
  source: {
    world_id?: string;
    domain_adapter?: string;
    source_label?: string;
  } = {},
) => {
  const created = await agent
    .post(
      `/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/source-bindings`,
    )
    .set(SAME_ORIGIN_HEADERS)
    .set("Idempotency-Key", `source-create:${crypto.randomUUID()}`)
    .send({
      world_id: source.world_id ?? "minecraft:minehut:room-a",
      domain_adapter: source.domain_adapter ?? "minecraft.paper_plugin.v1",
      source_label: source.source_label ?? "Minehut Room A",
    })
    .expect(201);
  const delivery = created.body.credential_delivery as {
    claim_handle: string;
    bearer_included: false;
    plugin_config_included: false;
  };
  const claimed = await agent
    .post("/api/agi/realtime/room-source-credential-deliveries/claim")
    .set(SAME_ORIGIN_HEADERS)
    .send({ claim_handle: delivery.claim_handle })
    .expect(200);
  return {
    binding: claimed.body.binding as {
      binding_id: string;
      room_id: string;
      source_id: string;
      world_id: string;
      domain_adapter: string;
      public_ingress_base_url: string;
    },
    token: claimed.body.token_value as string,
    claimHandle: delivery.claim_handle,
    body: claimed.body as Record<string, unknown>,
    deliveryBody: created.body as Record<string, unknown>,
  };
};

const sourcePath = (bindingId: string, suffix: string): string =>
  `/api/room-ingress/v1/bindings/${encodeURIComponent(bindingId)}/${suffix}`;

const sourceAdmissionFor = (
  binding: {
    binding_id: string;
    room_id: string;
    source_id: string;
    world_id: string;
    domain_adapter: string;
  },
  requestId = `request:${crypto.randomUUID()}`,
): HelixRoomSourceAdmission => ({
  schema: HELIX_ROOM_SOURCE_ADMISSION_SCHEMA,
  transport: "room_source_ingress",
  binding_id: binding.binding_id,
  request_id: requestId,
  room_id: binding.room_id,
  source_id: binding.source_id,
  world_id: binding.world_id,
  domain_adapter: binding.domain_adapter,
  evidence_refs: [
    binding.binding_id,
    `room_source_request:${binding.binding_id}:${requestId}`,
  ],
  content_role: "source_admission_not_assistant_answer",
  reentry_required: true,
  model_invoked: false,
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
});

describe("Shared Realtime room source ingress", () => {
  it("bypasses generic user JWT only for the mandatory source-auth route family", () => {
    expect(
      isPublicRoomSourceIngressPath(
        "/api/room-ingress/v1/bindings/room_source_binding:abc/heartbeat",
      ),
    ).toBe(true);
    expect(
      isPublicRoomSourceIngressPath(
        "/api/agi/realtime/rooms/a/source-bindings",
      ),
    ).toBe(false);
    expect(
      isPublicRoomSourceIngressPath("/api/room-ingress/v1/not-bindings/a"),
    ).toBe(false);
    expect(
      isPublicRoomSourceIngressPath(
        "/api/room-ingress/v1/bindings/a/not-a-source-route",
      ),
    ).toBe(false);
  });

  beforeEach(async () => {
    vi.stubEnv("CASIMIR_PUBLIC_BASE_URL", "https://casimirbot.test");
    vi.stubEnv("HELIX_PUBLIC_ROOMS_EXPERIMENT", "1");
    resetEnvironmentProbeBrokerForTest();
    resetEnvironmentSourceHeartbeatStoreForTest();
    resetEnvironmentSourceRegistryForTest();
    resetWorldEventIngestState();
    await resetRoomSourceIngressStoreForTest();
    await resetSharedRealtimeRoomStore();
    await resetAccountSessionStore();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lets only an admitted room owner mint, list, rotate, and revoke a show-once source credential", async () => {
    const app = createApp();
    const anonymousRoomId = "shared_realtime_room:not-visible";
    await request(app)
      .post(`/api/agi/realtime/rooms/${anonymousRoomId}/source-bindings`)
      .set(SAME_ORIGIN_HEADERS)
      .set("Idempotency-Key", "anonymous-source-create")
      .send({})
      .expect(401);

    const publicUser = await signIn(
      app,
      "profile:source-user",
      "Source User",
      "user",
    );
    await publicUser
      .post("/api/account/session/experimental-rooms")
      .send({ enabled: true })
      .expect(200);
    const userRoomId = await createRoom(publicUser, "User room");
    const publicUserBinding = await createBinding(publicUser, userRoomId, {
      world_id: "minecraft:local:public-user-fabric",
      domain_adapter: "minecraft.fabric_mod.v1",
      source_label: "Public user Fabric source",
    });
    expect(publicUserBinding.binding).toMatchObject({
      room_id: userRoomId,
      world_id: "minecraft:local:public-user-fabric",
      domain_adapter: "minecraft.fabric_mod.v1",
    });

    const owner = await signIn(app, "profile:source-owner", "Source Owner");
    const participant = await signIn(
      app,
      "profile:source-participant",
      "Source Participant",
    );
    const outsider = await signIn(
      app,
      "profile:source-outsider",
      "Source Outsider",
    );
    const roomId = await createRoom(owner);
    const invite = await owner
      .post(`/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/invites`)
      .expect(201);
    await participant
      .post("/api/agi/realtime/rooms/join")
      .send({ invite_code: invite.body.invite_code })
      .expect(200);
    await participant
      .post(
        `/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/source-bindings`,
      )
      .set(SAME_ORIGIN_HEADERS)
      .set("Idempotency-Key", "participant-source-create")
      .send({})
      .expect(403);
    await outsider
      .get(
        `/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/source-bindings`,
      )
      .expect(404);

    await owner
      .post(
        `/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/source-bindings`,
      )
      .set(SAME_ORIGIN_HEADERS)
      .set("Idempotency-Key", "legacy-source-create")
      .send({ source_id: "source:legacy-process-global" })
      .expect(400);
    await owner
      .post(
        `/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/source-bindings`,
      )
      .set(SAME_ORIGIN_HEADERS)
      .set("Idempotency-Key", "invalid-ttl-source-create")
      .send({ ttl_ms: 31 * 24 * 60 * 60 * 1_000 })
      .expect(400);

    const created = await createBinding(owner, roomId);
    expect(created.binding).toMatchObject({
      room_id: roomId,
      source_id: expect.stringMatching(/^source:room-ingress:/),
      world_id: "minecraft:minehut:room-a",
      public_ingress_base_url: expect.stringMatching(
        /^https:\/\/casimirbot\.test\/api\/room-ingress\/v1\/bindings\//,
      ),
    });
    expect(created.token).toMatch(/^helix_room_src_/);
    expect(created.deliveryBody).toMatchObject({
      credential_delivery: {
        bearer_included: false,
        plugin_config_included: false,
        delivery_status: "pending_claim",
      },
      command_execution_enabled: false,
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(created.deliveryBody).not.toHaveProperty("token_value");
    expect(created.deliveryBody).not.toHaveProperty("plugin_config");
    expect(JSON.stringify(created.deliveryBody)).not.toContain(created.token);
    expect(created.body).toMatchObject({
      token_value_shown_once: true,
      secret_stored_raw: false,
      assistant_answer: false,
      terminal_eligible: false,
      plugin_config: {
        endpoint: created.binding.public_ingress_base_url,
        bearer_token: created.token,
        execution_enabled: false,
      },
    });

    const listed = await owner
      .get(
        `/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/source-bindings`,
      )
      .expect(200);
    expect(JSON.stringify(listed.body)).not.toContain(created.token);
    expect(listed.body.bindings).toEqual([
      expect.objectContaining({
        binding_id: created.binding.binding_id,
      }),
    ]);
    expect(listed.body.bindings[0]).not.toHaveProperty("token_prefix");

    await ensureDatabase();
    const persisted = await getPool().query<{ token_hash: string }>(
      "SELECT token_hash FROM helix_room_source_credentials WHERE binding_id = $1;",
      [created.binding.binding_id],
    );
    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0].token_hash).toBe(
      crypto.createHash("sha256").update(created.token, "utf8").digest("hex"),
    );
    expect(persisted.rows[0].token_hash).not.toContain(created.token);

    const rotationDelivery = await owner
      .post(
        `/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/source-bindings/${encodeURIComponent(created.binding.binding_id)}/rotate`,
      )
      .set(SAME_ORIGIN_HEADERS)
      .send({})
      .expect(200);
    await owner
      .post(
        `/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/source-bindings/${encodeURIComponent(created.binding.binding_id)}/rotate`,
      )
      .set(SAME_ORIGIN_HEADERS)
      .send({ ttl_ms: 31 * 24 * 60 * 60 * 1_000 })
      .expect(400);
    expect(rotationDelivery.body).not.toHaveProperty("token_value");
    expect(rotationDelivery.body.credential_delivery).toMatchObject({
      bearer_included: false,
      plugin_config_included: false,
    });
    const rotated = await owner
      .post("/api/agi/realtime/room-source-credential-deliveries/claim")
      .set(SAME_ORIGIN_HEADERS)
      .send({
        claim_handle: rotationDelivery.body.credential_delivery.claim_handle,
      })
      .expect(200);
    expect(rotated.body.token_value).toMatch(/^helix_room_src_/);
    expect(rotated.body.token_value).not.toBe(created.token);

    const revoked = await owner
      .delete(
        `/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/source-bindings/${encodeURIComponent(created.binding.binding_id)}`,
      )
      .set(SAME_ORIGIN_HEADERS)
      .expect(200);
    expect(revoked.body.binding.status).toBe("revoked");
    expect(JSON.stringify(revoked.body)).not.toContain(
      rotated.body.token_value,
    );
  });

  it("lets a local experimental guest owner claim a session-bound read-only source link", async () => {
    vi.stubEnv("HELIX_GUEST_ROOM_CREATION", "1");
    const app = createApp();
    const guest = request.agent(app);
    const enabled = await guest
      .post("/api/account/session/experimental-rooms")
      .send({ enabled: true })
      .expect(200);
    expect(enabled.body.status.session.profile.auth_mode).toBe("guest");
    expect(enabled.body.status.account_policy).toMatchObject({
      feature_flags: expect.arrayContaining(["room_source_ingress"]),
      locked_features: expect.not.arrayContaining(["room_source_ingress"]),
    });

    const roomId = await createRoom(guest, "Guest local Minecraft room");
    const created = await createBinding(guest, roomId, {
      world_id: "minecraft:paper-local-test",
      domain_adapter: "minecraft.paper_plugin.v1",
      source_label: "Local Paper test",
    });
    expect(created.binding).toMatchObject({
      room_id: roomId,
      world_id: "minecraft:paper-local-test",
      domain_adapter: "minecraft.paper_plugin.v1",
    });
    expect(created.token).toMatch(/^helix_room_src_/);
    expect(created.body).toMatchObject({
      plugin_config: {
        execution_enabled: false,
      },
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
  });

  it("keeps the first-party source manager and credential claim ahead of global bearer auth", async () => {
    const app = createApp({ rejectRemainingAgiAsGlobalJwt: true });
    const owner = await signIn(
      app,
      "profile:cookie-source-boundary",
      "Cookie Source Boundary",
    );

    const list = await owner
      .get(
        "/api/agi/realtime/rooms/shared_realtime_room:not-found/source-bindings",
      )
      .expect(404);
    expect(list.body.error).not.toBe("global_jwt_blocked");

    const create = await owner
      .post(
        "/api/agi/realtime/rooms/shared_realtime_room:not-found/source-bindings",
      )
      .set(SAME_ORIGIN_HEADERS)
      .set("Idempotency-Key", "global-jwt-boundary-create")
      .send({})
      .expect(404);
    expect(create.body.error).not.toBe("global_jwt_blocked");

    const claim = await owner
      .post("/api/agi/realtime/room-source-credential-deliveries/claim")
      .set(SAME_ORIGIN_HEADERS)
      .send({ claim_handle: "room_source_claim_not_found_123456789" })
      .expect(404);
    expect(claim.body.error).not.toBe("global_jwt_blocked");

    const unrelated = await owner
      .post("/api/agi/not-a-source-manager-route")
      .send({})
      .expect(401);
    expect(unrelated.body.error).toBe("global_jwt_blocked");
  });

  it("requires exact same-origin browser evidence and a caller-stable source-create idempotency key", async () => {
    const app = createApp();
    const owner = await signIn(
      app,
      "profile:cookie-boundary-owner",
      "Cookie Boundary Owner",
    );
    const roomId = await createRoom(owner, "Cookie boundary room");
    const sourceUrl = `/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/source-bindings`;

    const missingIdempotency = await owner
      .post(sourceUrl)
      .set(SAME_ORIGIN_HEADERS)
      .send({})
      .expect(400);
    expect(missingIdempotency.headers["cache-control"]).toBe("no-store");
    expect(missingIdempotency.body).toMatchObject({
      error: "room_source_idempotency_key_required",
      assistant_answer: false,
      terminal_eligible: false,
    });

    const hostileOrigin = await owner
      .post(sourceUrl)
      .set({
        Host: "casimirbot.test",
        Origin: "https://attacker.example",
        "Sec-Fetch-Site": "same-origin",
        "Idempotency-Key": "hostile-origin-source-create",
      })
      .send({})
      .expect(403);
    expect(hostileOrigin.headers["cache-control"]).toBe("no-store");
    expect(hostileOrigin.body).toMatchObject({
      error: "room_source_cookie_cross_origin_forbidden",
      assistant_answer: false,
      terminal_eligible: false,
    });

    const hostileFetchMetadata = await owner
      .post("/api/agi/realtime/room-source-credential-deliveries/claim")
      .set({
        Host: "casimirbot.test",
        Origin: "http://casimirbot.test",
        "Sec-Fetch-Site": "cross-site",
      })
      .send({ claim_handle: "room_source_claim_not_found_123456789" })
      .expect(403);
    expect(hostileFetchMetadata.headers["cache-control"]).toBe("no-store");
    expect(hostileFetchMetadata.body.error).toBe(
      "room_source_cookie_cross_origin_forbidden",
    );

    const malformedClaim = await owner
      .post("/api/agi/realtime/room-source-credential-deliveries/claim")
      .set(SAME_ORIGIN_HEADERS)
      .set("Content-Type", "application/json")
      .send('{"claim_handle":')
      .expect(400);
    expect(malformedClaim.headers["cache-control"]).toBe("no-store");
    expect(malformedClaim.body).toMatchObject({
      error: "room_source_binding_invalid",
      assistant_answer: false,
      terminal_eligible: false,
    });

    const listed = await owner.get(sourceUrl).expect(200);
    expect(listed.body.bindings).toEqual([]);
  });

  it("redacts recognized bearer and claim material from unexpected source-manager logs", async () => {
    const app = createApp();
    const owner = await signIn(
      app,
      "profile:source-log-redaction",
      "Source Log Redaction",
    );
    const service = getSharedLiveRoomControlService();
    const list = vi
      .spyOn(service, "listSourceBindings")
      .mockRejectedValueOnce(
        new Error(
          "adapter failed Authorization: Bearer helix_room_src_log_secret claim_handle=room_source_claim_log_secret",
        ),
      );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const response = await owner
        .get(
          "/api/agi/realtime/rooms/shared_realtime_room:log-redaction/source-bindings",
        )
        .expect(503);
      expect(response.headers["cache-control"]).toBe("no-store");
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).not.toContain("helix_room_src_log_secret");
      expect(logged).not.toContain("room_source_claim_log_secret");
      expect(logged).toContain("[REDACTED_SECRET]");
    } finally {
      list.mockRestore();
      warn.mockRestore();
    }
  });

  it("admits a signed manifest, heartbeat, and world batch while keeping every receipt nonterminal", async () => {
    const app = createApp();
    const owner = await signIn(app, "profile:ingress-owner", "Ingress Owner");
    const roomId = await createRoom(owner);
    const created = await createBinding(owner, roomId);
    const nextHeaders = ingressHeaderFactory(created.token);

    const manifest = JSON.stringify({
      ...manifestFixture,
      manifest_id: `manifest:${created.binding.source_id}:0.1.0`,
      source_id: created.binding.source_id,
      room_id: created.binding.room_id,
      domain_adapter: created.binding.domain_adapter,
      created_at: new Date().toISOString(),
    });
    const manifestResponse = await request(app)
      .post(sourcePath(created.binding.binding_id, "manifest"))
      .set(nextHeaders(manifest))
      .send(manifest)
      .expect(200);
    expect(manifestResponse.body).toMatchObject({
      ok: true,
      kind: "manifest",
      accepted: true,
      reentry_required: true,
      assistant_answer: false,
      terminal_eligible: false,
    });

    const heartbeat = JSON.stringify({
      schema: "helix.environment_source_heartbeat.v1",
      heartbeat_id: `heartbeat:${crypto.randomUUID()}`,
      source_id: created.binding.source_id,
      room_id: created.binding.room_id,
      domain: "minecraft",
      domain_adapter: created.binding.domain_adapter,
      status: "active",
      server_tick: 42,
      evidence_refs: [],
      assistant_answer: false,
      raw_content_included: false,
      created_at: new Date().toISOString(),
    });
    const heartbeatResponse = await request(app)
      .post(sourcePath(created.binding.binding_id, "heartbeat"))
      .set(nextHeaders(heartbeat))
      .send(heartbeat)
      .expect(200);
    expect(heartbeatResponse.body.observation_ref).toMatchObject({
      status: "active",
      model_invoked: false,
      assistant_answer: false,
      terminal_eligible: false,
    });

    const worldBatch = JSON.stringify({
      events: [
        {
          schema: "helix.world_event.v1",
          world_id: created.binding.world_id,
          room_id: created.binding.room_id,
          source_id: created.binding.source_id,
          ts: new Date().toISOString(),
          actor_id: "minecraft:player:test",
          actor_label: "TestPlayer",
          event_type: "location_sample",
          location: { x: 12, y: 64, z: -4, dimension: "minecraft:overworld" },
          evidence_refs: [],
          meta: {
            domain_adapter: created.binding.domain_adapter,
            snapshot: {
              model_invoked: false,
              assistant_answer: false,
              terminal_eligible: false,
            },
          },
        },
      ],
    });
    const worldHeaders = nextHeaders(worldBatch);
    const requestProjectionId = projectRoomSourceRequestId({
      bindingId: created.binding.binding_id,
      requestId: worldHeaders["X-Helix-Request-Id"],
    });
    const requestEvidenceRef = buildRoomSourceRequestEvidenceRef({
      bindingId: created.binding.binding_id,
      requestId: worldHeaders["X-Helix-Request-Id"],
    });
    const worldResponse = await request(app)
      .post(sourcePath(created.binding.binding_id, "world-events/batch"))
      .set(worldHeaders)
      .send(worldBatch)
      .expect(200);
    expect(worldResponse.body).toMatchObject({
      ok: true,
      kind: "world_event_batch",
      accepted: true,
      request_id: requestProjectionId,
      observation_ref: {
        event_count: 1,
        environment_event_batch_ref: expect.stringMatching(
          /^environment_event_batch:world:/u,
        ),
        situation_digest_refs: [
          expect.stringMatching(/^environment_situation_digest:/u),
        ],
        semantic_wake_bridges: [
          expect.objectContaining({
            schema: "helix.minecraft_situation_digest_mail_bridge.v1",
            status: "blocked",
            reason: "environment_wake_subject_unbound",
            wake_expected: false,
            assistant_answer: false,
            terminal_eligible: false,
          }),
        ],
        model_invoked: false,
        assistant_answer: false,
        terminal_eligible: false,
        source_admission: {
          schema: "helix.room_source_admission.v1",
          transport: "room_source_ingress",
          binding_id: created.binding.binding_id,
          request_id: requestProjectionId,
          room_id: created.binding.room_id,
          source_id: created.binding.source_id,
          world_id: created.binding.world_id,
          answer_authority: false,
          assistant_answer: false,
          terminal_eligible: false,
        },
      },
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(JSON.stringify(worldResponse.body)).not.toContain(
      worldHeaders["X-Helix-Request-Id"],
    );
    const candidate = await readLatestBoundRoomSourceCandidate(roomId);
    expect(candidate).toMatchObject({
      bindingId: created.binding.binding_id,
      requestProjectionId,
      admission: {
        request_id: requestProjectionId,
        evidence_refs: expect.arrayContaining([requestEvidenceRef]),
      },
    });
    const journal = queryEventJournal({
      room_id: created.binding.room_id,
      source_id: created.binding.source_id,
      world_id: created.binding.world_id,
      include_raw_events: true,
      sourceAdmission: worldResponse.body.observation_ref.source_admission,
    });
    expect(journal.events).toHaveLength(1);
    expect(journal.events[0]?.evidence_refs).toContain(requestEvidenceRef);
    expect(JSON.stringify(journal)).not.toContain(
      worldHeaders["X-Helix-Request-Id"],
    );

    await ensureDatabase();
    const persistedReceipt = await getPool().query<{
      response_receipt: Record<string, unknown> | string;
    }>(
      `
        SELECT response_receipt
        FROM helix_room_source_ingress_requests
        WHERE binding_id = $1 AND request_id = $2
        LIMIT 1;
      `,
      [created.binding.binding_id, worldHeaders["X-Helix-Request-Id"]],
    );
    const storedReceipt = persistedReceipt.rows[0]?.response_receipt;
    const tamperedReceipt = JSON.parse(
      typeof storedReceipt === "string"
        ? storedReceipt
        : JSON.stringify(storedReceipt),
    ) as Record<string, unknown>;
    const tamperedObservation = tamperedReceipt.observation_ref as Record<
      string,
      unknown
    >;
    const tamperedAdmission = tamperedObservation.source_admission as Record<
      string,
      unknown
    >;
    tamperedAdmission.domain_adapter = "minecraft.tampered.v1";
    await getPool().query(
      `
        UPDATE helix_room_source_ingress_requests
        SET response_receipt = $3::jsonb
        WHERE binding_id = $1 AND request_id = $2;
      `,
      [
        created.binding.binding_id,
        worldHeaders["X-Helix-Request-Id"],
        JSON.stringify(tamperedReceipt),
      ],
    );
    expect(await readLatestBoundRoomSourceCandidate(roomId)).toBeNull();
  });

  it("requires durable manifest admission and proves a fixture-only second adapter without cross-adapter leakage", async () => {
    const app = createApp();
    const owner = await signIn(
      app,
      "profile:adapter-registry-owner",
      "Adapter Registry Owner",
    );
    const roomId = await createRoom(owner, "Adapter registry room");

    const disabledFixture = await owner
      .post(
        `/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/source-bindings`,
      )
      .set(SAME_ORIGIN_HEADERS)
      .set("Idempotency-Key", `fixture-disabled:${crypto.randomUUID()}`)
      .send({
        world_id: "synthetic-game:arena",
        domain_adapter: "synthetic_game.fixture.v1",
        source_label: "Synthetic fixture",
      })
      .expect(409);
    expect(disabledFixture.body.error).toBe("environment_adapter_disabled");

    const unknownAdapter = await owner
      .post(
        `/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/source-bindings`,
      )
      .set(SAME_ORIGIN_HEADERS)
      .set("Idempotency-Key", `adapter-unknown:${crypto.randomUUID()}`)
      .send({
        world_id: "unknown-game:arena",
        domain_adapter: "unknown_game.plugin.v1",
      })
      .expect(400);
    expect(unknownAdapter.body.error).toBe("environment_adapter_unknown");

    const crossedIdentity = await owner
      .post(
        `/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/source-bindings`,
      )
      .set(SAME_ORIGIN_HEADERS)
      .set("Idempotency-Key", `adapter-crossed:${crypto.randomUUID()}`)
      .send({
        world_id: "synthetic-game:arena",
        domain_adapter: "minecraft.paper_plugin.v1",
      })
      .expect(400);
    expect(crossedIdentity.body.error).toBe(
      "environment_adapter_identity_mismatch",
    );

    vi.stubEnv("HELIX_ENVIRONMENT_ADAPTER_FIXTURES", "1");
    const created = await createBinding(owner, roomId, {
      world_id: "synthetic-game:arena",
      domain_adapter: "synthetic_game.fixture.v1",
      source_label: "Synthetic fixture",
    });
    const nextHeaders = ingressHeaderFactory(created.token);
    const eventBatch = JSON.stringify({
      events: [
        {
          schema: "helix.world_event.v1",
          world_id: created.binding.world_id,
          room_id: created.binding.room_id,
          source_id: created.binding.source_id,
          ts: new Date().toISOString(),
          actor_id: "synthetic:actor:one",
          actor_label: "Fixture Actor",
          event_type: "position_sample",
          location: { x: 3, y: 7 },
          evidence_refs: [],
          meta: {
            domain_adapter: created.binding.domain_adapter,
          },
        },
      ],
    });
    const beforeManifest = await request(app)
      .post(sourcePath(created.binding.binding_id, "world-events/batch"))
      .set(nextHeaders(eventBatch))
      .send(eventBatch)
      .expect(409);
    expect(beforeManifest.body).toMatchObject({
      error: "environment_adapter_admission_required",
      accepted: false,
      assistant_answer: false,
      terminal_eligible: false,
    });

    const incompatibleManifest = JSON.stringify({
      ...manifestFixture,
      manifest_id: `manifest:${created.binding.source_id}:wrong-domain`,
      source_id: created.binding.source_id,
      room_id: created.binding.room_id,
      domain: "minecraft",
      domain_adapter: created.binding.domain_adapter,
      protocol_version: "helix.environment.v1",
      supported_snapshot_sections: ["actor_state"],
      supported_probe_types: ["reachability"],
      snapshot_policy: {
        ...manifestFixture.snapshot_policy,
        max_payload_bytes: 32_000,
      },
      created_at: new Date().toISOString(),
    });
    const incompatible = await request(app)
      .post(sourcePath(created.binding.binding_id, "manifest"))
      .set(nextHeaders(incompatibleManifest))
      .send(incompatibleManifest)
      .expect(400);
    expect(incompatible.body.error).toBe(
      "environment_adapter_identity_mismatch",
    );

    const manifest = JSON.stringify({
      ...manifestFixture,
      manifest_id: `manifest:${created.binding.source_id}:fixture-v1`,
      source_id: created.binding.source_id,
      room_id: created.binding.room_id,
      domain: "game",
      domain_adapter: created.binding.domain_adapter,
      source_label: "Synthetic fixture",
      adapter_version: "1.0.0",
      protocol_version: "helix.environment.v1",
      modalities: ["environment_state"],
      supported_snapshot_sections: ["actor_state"],
      supported_probe_types: ["reachability"],
      snapshot_policy: {
        ...manifestFixture.snapshot_policy,
        max_payload_bytes: 32_000,
      },
      created_at: new Date().toISOString(),
    });
    const manifestResponse = await request(app)
      .post(sourcePath(created.binding.binding_id, "manifest"))
      .set(nextHeaders(manifest))
      .send(manifest)
      .expect(200);
    expect(manifestResponse.body.observation_ref).toMatchObject({
      adapter_admission: {
        schema: "helix.environment_adapter_admission.v1",
        adapter_profile_id: "game.synthetic_fixture.readonly.v1",
        source_family: "synthetic_game",
        mechanics_collection_ids: ["mechanics.synthetic_game.fixture.v1"],
        assistant_answer: false,
        terminal_eligible: false,
      },
    });

    const invalidEventBatch = JSON.stringify({
      events: [
        {
          schema: "helix.world_event.v1",
          world_id: created.binding.world_id,
          room_id: created.binding.room_id,
          source_id: created.binding.source_id,
          ts: new Date().toISOString(),
        },
      ],
    });
    const invalidObservation = await request(app)
      .post(sourcePath(created.binding.binding_id, "world-events/batch"))
      .set(nextHeaders(invalidEventBatch))
      .send(invalidEventBatch)
      .expect(400);
    expect(invalidObservation.body).toMatchObject({
      error: "environment_adapter_observation_schema_invalid",
      accepted: false,
      assistant_answer: false,
      terminal_eligible: false,
    });

    const accepted = await request(app)
      .post(sourcePath(created.binding.binding_id, "world-events/batch"))
      .set(nextHeaders(eventBatch))
      .send(eventBatch)
      .expect(200);
    expect(accepted.body.observation_ref.source_admission).toMatchObject({
      room_id: created.binding.room_id,
      source_id: created.binding.source_id,
      world_id: created.binding.world_id,
      domain_adapter: "synthetic_game.fixture.v1",
      adapter_admission: {
        adapter_profile_id: "game.synthetic_fixture.readonly.v1",
        source_family: "synthetic_game",
      },
    });
    const admittedContractHash = manifestResponse.body.observation_ref
      .adapter_admission.adapter_contract_hash as string;
    await getPool().query(
      `
        UPDATE helix_environment_adapter_admissions
        SET adapter_contract_hash = $2
        WHERE binding_id = $1
          AND status = 'active';
      `,
      [created.binding.binding_id, `sha256:${"0".repeat(64)}`],
    );
    const changedContract = await request(app)
      .post(sourcePath(created.binding.binding_id, "world-events/batch"))
      .set(nextHeaders(eventBatch))
      .send(eventBatch)
      .expect(409);
    expect(changedContract.body).toMatchObject({
      error: "environment_adapter_contract_changed",
      accepted: false,
      assistant_answer: false,
      terminal_eligible: false,
    });
    const refreshedManifest = await request(app)
      .post(sourcePath(created.binding.binding_id, "manifest"))
      .set(nextHeaders(manifest))
      .send(manifest)
      .expect(200);
    expect(refreshedManifest.body.observation_ref.adapter_admission).toMatchObject({
      admission_id:
        manifestResponse.body.observation_ref.adapter_admission.admission_id,
      adapter_contract_hash: admittedContractHash,
      manifest_hash:
        manifestResponse.body.observation_ref.adapter_admission.manifest_hash,
    });
    const candidate = await readLatestBoundRoomSourceCandidate(roomId);
    expect(candidate).toMatchObject({
      bindingId: created.binding.binding_id,
      sourceFamily: "synthetic_game",
      domain: "game",
      mechanicsCollectionIds: ["mechanics.synthetic_game.fixture.v1"],
      adapterAdmission: {
        adapter_profile_id: "game.synthetic_fixture.readonly.v1",
      },
    });

    const profileStale = await request(app)
      .get(sourcePath(created.binding.binding_id, "status"))
      .set(
        nextHeaders("", {
          "X-Helix-Sent-At": new Date(Date.now() - 90_000).toISOString(),
        }),
      )
      .expect(408);
    expect(profileStale.body.error).toBe("room_source_request_stale");

    const replacementEpoch = crypto.randomUUID();
    const beforeEpochManifest = await request(app)
      .post(sourcePath(created.binding.binding_id, "world-events/batch"))
      .set(
        nextHeaders(eventBatch, {
          "X-Helix-Producer-Epoch": replacementEpoch,
          "X-Helix-Sequence": "1",
        }),
      )
      .send(eventBatch)
      .expect(409);
    expect(beforeEpochManifest.body.error).toBe(
      "environment_adapter_admission_required",
    );
    const replacementManifest = JSON.stringify({
      ...JSON.parse(manifest),
      manifest_id: `manifest:${created.binding.source_id}:fixture-v1-restarted`,
      created_at: new Date().toISOString(),
    });
    await request(app)
      .post(sourcePath(created.binding.binding_id, "manifest"))
      .set(
        nextHeaders(replacementManifest, {
          "X-Helix-Producer-Epoch": replacementEpoch,
          "X-Helix-Sequence": "2",
        }),
      )
      .send(replacementManifest)
      .expect(200);
    await request(app)
      .post(sourcePath(created.binding.binding_id, "world-events/batch"))
      .set(
        nextHeaders(eventBatch, {
          "X-Helix-Producer-Epoch": replacementEpoch,
          "X-Helix-Sequence": "3",
        }),
      )
      .send(eventBatch)
      .expect(200);

    const rotationDelivery = await owner
      .post(
        `/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/source-bindings/${encodeURIComponent(created.binding.binding_id)}/rotate`,
      )
      .set(SAME_ORIGIN_HEADERS)
      .send({})
      .expect(200);
    await owner
      .post("/api/agi/realtime/room-source-credential-deliveries/claim")
      .set(SAME_ORIGIN_HEADERS)
      .send({
        claim_handle: rotationDelivery.body.credential_delivery.claim_handle,
      })
      .expect(200);
    const admissionState = await getPool().query<{ status: string }>(
      `
        SELECT status
        FROM helix_environment_adapter_admissions
        WHERE binding_id = $1
        ORDER BY admitted_at DESC
        LIMIT 1;
      `,
      [created.binding.binding_id],
    );
    expect(admissionState.rows[0]?.status).toBe("revoked");
    expect(await readLatestBoundRoomSourceCandidate(roomId)).toBeNull();
  });

  it("rejects actual bearer and claim values before request or journal persistence", async () => {
    const app = createApp();
    const owner = await signIn(
      app,
      "profile:secret-boundary-owner",
      "Secret Boundary Owner",
    );
    const roomId = await createRoom(owner);
    const created = await createBinding(owner, roomId);
    const nextHeaders = ingressHeaderFactory(created.token);
    const safeBatch = JSON.stringify({
      events: [
        {
          schema: "helix.world_event.v1",
          world_id: created.binding.world_id,
          room_id: created.binding.room_id,
          source_id: created.binding.source_id,
          ts: new Date().toISOString(),
          actor_id: "minecraft:player:test",
          actor_label: "TestPlayer",
          event_type: "location_sample",
          location: { x: 12, y: 64, z: -4 },
          evidence_refs: [],
          meta: { domain_adapter: created.binding.domain_adapter },
        },
      ],
    });
    const tokenRequestHeaders = nextHeaders(safeBatch, {
      "X-Helix-Request-Id": created.token,
    });
    const tokenRequest = await request(app)
      .post(sourcePath(created.binding.binding_id, "world-events/batch"))
      .set(tokenRequestHeaders)
      .send(safeBatch)
      .expect(400);
    expect(tokenRequest.body).toMatchObject({
      error: "room_source_secret_exposure_rejected",
      accepted: false,
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(JSON.stringify(tokenRequest.body)).not.toContain(created.token);

    const toxicBatch = JSON.stringify({
      events: [
        {
          schema: "helix.world_event.v1",
          world_id: created.binding.world_id,
          room_id: created.binding.room_id,
          source_id: created.binding.source_id,
          ts: new Date().toISOString(),
          actor_id: "minecraft:player:test",
          actor_label: created.token,
          event_type: "inventory_sample",
          text: created.claimHandle,
          inventory_delta: {
            item_type: created.token,
            display_name: created.claimHandle,
          },
          evidence_refs: [`secret:${created.token}`],
          meta: {
            domain_adapter: created.binding.domain_adapter,
            compact_summary: `credential ${created.token}`,
            item: {
              display_name: created.claimHandle,
            },
          },
        },
      ],
    });
    const toxicHeaders = nextHeaders(toxicBatch);
    const toxicResponse = await request(app)
      .post(sourcePath(created.binding.binding_id, "world-events/batch"))
      .set(toxicHeaders)
      .send(toxicBatch)
      .expect(400);
    expect(toxicResponse.body).toMatchObject({
      error: "room_source_secret_exposure_rejected",
      accepted: false,
      assistant_answer: false,
      terminal_eligible: false,
    });
    const serializedResponse = JSON.stringify(toxicResponse.body);
    expect(serializedResponse).not.toContain(created.token);
    expect(serializedResponse).not.toContain(created.claimHandle);

    await ensureDatabase();
    const persisted = await getPool().query<{ request_count: number | string }>(
      `
        SELECT COUNT(*) AS request_count
        FROM helix_room_source_ingress_requests
        WHERE binding_id = $1
          AND request_id IN ($2, $3);
      `,
      [
        created.binding.binding_id,
        created.token,
        toxicHeaders["X-Helix-Request-Id"],
      ],
    );
    expect(Number(persisted.rows[0]?.request_count ?? -1)).toBe(0);
    const safeAdmission = sourceAdmissionFor(
      created.binding,
      projectRoomSourceRequestId({
        bindingId: created.binding.binding_id,
        requestId: toxicHeaders["X-Helix-Request-Id"],
      }),
    );
    const journal = queryEventJournal({
      room_id: created.binding.room_id,
      source_id: created.binding.source_id,
      world_id: created.binding.world_id,
      include_raw_events: true,
      sourceAdmission: safeAdmission,
    });
    expect(journal.events).toHaveLength(0);
    const serializedJournal = JSON.stringify(journal);
    expect(serializedJournal).not.toContain(created.token);
    expect(serializedJournal).not.toContain(created.claimHandle);
  });

  it("reserves bound source identities from every legacy environment-source route", async () => {
    const app = createApp();
    const owner = await signIn(
      app,
      "profile:reserved-source-owner",
      "Reserved Source Owner",
    );
    const roomId = await createRoom(owner);
    const created = await createBinding(owner, roomId);
    const nextHeaders = ingressHeaderFactory(created.token);
    const manifestObject = {
      ...manifestFixture,
      manifest_id: `manifest:${created.binding.source_id}:reserved`,
      source_id: created.binding.source_id,
      room_id: created.binding.room_id,
      domain_adapter: created.binding.domain_adapter,
      source_label: "Authorized room source",
      created_at: new Date().toISOString(),
    };
    const manifest = JSON.stringify(manifestObject);
    await request(app)
      .post(sourcePath(created.binding.binding_id, "manifest"))
      .set(nextHeaders(manifest))
      .send(manifest)
      .expect(200);

    const legacyManifest = await request(app)
      .post("/api/agi/environment/sources/manifest")
      .send({
        ...manifestObject,
        source_label: "Legacy overwrite attempt",
      })
      .expect(403);
    expect(legacyManifest.body).toMatchObject({
      ok: false,
      error: "environment_room_source_namespace_reserved",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(getEnvironmentSourceManifest(created.binding.source_id)).toBeNull();
    expect(
      getEnvironmentSourceManifest(created.binding.source_id, {
        sourceAdmission: sourceAdmissionFor(created.binding),
      })?.source_label,
    ).toBe("Authorized room source");

    for (const attempt of [
      request(app)
        .post("/api/agi/environment/sources/heartbeat")
        .send({ source_id: created.binding.source_id }),
      request(app).get(
        `/api/agi/environment/sources/${encodeURIComponent(created.binding.source_id)}/probes/pending`,
      ),
      request(app)
        .post(
          `/api/agi/environment/sources/${encodeURIComponent(created.binding.source_id)}/probes/result`,
        )
        .send({ source_id: created.binding.source_id }),
      request(app).get(
        `/api/agi/environment/sources/${encodeURIComponent(created.binding.source_id)}/status`,
      ),
    ]) {
      const response = await attempt.expect(403);
      expect(response.body.error).toBe(
        "environment_room_source_namespace_reserved",
      );
    }
  });

  it("validates complete source contracts and accepts cross-route sequence reordering", async () => {
    const app = createApp();
    const owner = await signIn(app, "profile:schema-owner", "Schema Owner");
    const roomId = await createRoom(owner);
    const created = await createBinding(owner, roomId);
    const nextHeaders = ingressHeaderFactory(created.token);

    const incompleteManifest = JSON.stringify({
      ...manifestFixture,
      manifest_id: `manifest:${created.binding.source_id}:incomplete`,
      source_id: created.binding.source_id,
      room_id: created.binding.room_id,
      domain_adapter: created.binding.domain_adapter,
      created_at: new Date().toISOString(),
      sensor_scope_policy: undefined,
    });
    const invalid = await request(app)
      .post(sourcePath(created.binding.binding_id, "manifest"))
      .set(nextHeaders(incompleteManifest))
      .send(incompleteManifest)
      .expect(400);
    expect(invalid.body).toMatchObject({
      error: "room_source_payload_invalid",
      accepted: false,
      assistant_answer: false,
      terminal_eligible: false,
    });

    const manifest = JSON.stringify({
      ...manifestFixture,
      manifest_id: `manifest:${created.binding.source_id}:ordered-lane`,
      source_id: created.binding.source_id,
      room_id: created.binding.room_id,
      domain_adapter: created.binding.domain_adapter,
      created_at: new Date().toISOString(),
    });
    const reorderedHeaders = ingressHeaderFactory(created.token);
    await request(app)
      .post(sourcePath(created.binding.binding_id, "manifest"))
      .set(reorderedHeaders(manifest, { "X-Helix-Sequence": "2" }))
      .send(manifest)
      .expect(200);

    const heartbeat = JSON.stringify({
      schema: "helix.environment_source_heartbeat.v1",
      heartbeat_id: `heartbeat:${crypto.randomUUID()}`,
      source_id: created.binding.source_id,
      room_id: created.binding.room_id,
      domain: "minecraft",
      domain_adapter: created.binding.domain_adapter,
      status: "active",
      evidence_refs: [],
      assistant_answer: false,
      raw_content_included: false,
      created_at: new Date().toISOString(),
    });
    const reorderedHeartbeat = await request(app)
      .post(sourcePath(created.binding.binding_id, "heartbeat"))
      .set(reorderedHeaders(heartbeat, { "X-Helix-Sequence": "1" }))
      .send(heartbeat)
      .expect(200);
    expect(reorderedHeartbeat.body).toMatchObject({
      ok: true,
      kind: "heartbeat",
      accepted: true,
    });
  });

  it("serializes concurrent claims before enforcing the per-binding rate limit", async () => {
    vi.stubEnv("HELIX_ROOM_INGRESS_REQUESTS_PER_MINUTE", "1");
    const app = createApp();
    const owner = await signIn(app, "profile:rate-owner", "Rate Owner");
    const roomId = await createRoom(owner);
    const created = await createBinding(owner, roomId);
    const nextHeaders = ingressHeaderFactory(created.token);

    const [first, second] = await Promise.all([
      request(app)
        .get(sourcePath(created.binding.binding_id, "status"))
        .set(nextHeaders("")),
      request(app)
        .get(sourcePath(created.binding.binding_id, "status"))
        .set(nextHeaders("")),
    ]);
    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([
      200, 429,
    ]);
    expect(
      [first.body, second.body].find(
        (receipt) => receipt.error === "room_source_rate_limited",
      ),
    ).toMatchObject({
      accepted: false,
      assistant_answer: false,
      terminal_eligible: false,
    });
  });

  it("fails closed on identity spoofing, stale delivery, replay conflicts, old credentials, and closed rooms", async () => {
    const app = createApp();
    const owner = await signIn(app, "profile:guard-owner", "Guard Owner");
    const roomId = await createRoom(owner);
    const created = await createBinding(owner, roomId);
    const nextHeaders = ingressHeaderFactory(created.token);

    const wrongManifest = JSON.stringify({
      ...manifestFixture,
      source_id: created.binding.source_id,
      room_id: "shared_realtime_room:other-room",
      domain_adapter: created.binding.domain_adapter,
      created_at: new Date().toISOString(),
    });
    const wrongIdentity = await request(app)
      .post(sourcePath(created.binding.binding_id, "manifest"))
      .set(nextHeaders(wrongManifest))
      .send(wrongManifest)
      .expect(403);
    expect(wrongIdentity.body).toMatchObject({
      error: "room_source_identity_mismatch",
      accepted: false,
      assistant_answer: false,
      terminal_eligible: false,
    });

    const validManifest = JSON.stringify({
      ...manifestFixture,
      manifest_id: `manifest:${created.binding.source_id}:0.1.0`,
      source_id: created.binding.source_id,
      room_id: created.binding.room_id,
      domain_adapter: created.binding.domain_adapter,
      created_at: new Date().toISOString(),
    });
    const replayHeaders = nextHeaders(validManifest);
    const first = await request(app)
      .post(sourcePath(created.binding.binding_id, "manifest"))
      .set(replayHeaders)
      .send(validManifest)
      .expect(200);
    const exactReplay = await request(app)
      .post(sourcePath(created.binding.binding_id, "manifest"))
      .set(replayHeaders)
      .send(validManifest)
      .expect(200);
    expect(first.body.replayed).toBe(false);
    expect(exactReplay.body.replayed).toBe(true);
    expect(exactReplay.body.request_id).toBe(first.body.request_id);

    const conflictingBody = JSON.stringify({
      ...JSON.parse(validManifest),
      source_label: "Different content under the same request ID",
    });
    const conflict = await request(app)
      .post(sourcePath(created.binding.binding_id, "manifest"))
      .set({
        ...replayHeaders,
        Digest: digest(conflictingBody),
      })
      .send(conflictingBody)
      .expect(409);
    expect(conflict.body.error).toBe("room_source_idempotency_conflict");

    const staleHeaders = nextHeaders(validManifest, {
      "X-Helix-Sent-At": new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    });
    const stale = await request(app)
      .post(sourcePath(created.binding.binding_id, "manifest"))
      .set(staleHeaders)
      .send(validManifest)
      .expect(408);
    expect(stale.body.error).toBe("room_source_request_stale");

    for (const authorityAlias of [
      "agent_run_id",
      "answer_authority",
      "assistant_answer",
      "browser_profile_id",
      "chat_id",
      "chat_session_id",
      "profile_id",
      "linked_profile_id",
      "commander_profile_id",
      "conversation_id",
      "goal_id",
      "invoke_model",
      "model",
      "model_id",
      "model_invoked",
      "persona",
      "persona_id",
      "provider_goal_id",
      "provider_model",
      "provider_session_id",
      "provider_thread_id",
      "reasoning",
      "reasoning_id",
      "reasoning_mode",
      "reasoning_requested",
      "reasoning_trigger",
      "run_id",
      "terminal_eligible",
    ]) {
      const authorityBatch = JSON.stringify({
        events: [
          {
            schema: "helix.world_event.v1",
            world_id: created.binding.world_id,
            room_id: created.binding.room_id,
            source_id: created.binding.source_id,
            ts: new Date().toISOString(),
            actor_id: "minecraft:player:test",
            actor_label: "TestPlayer",
            event_type: "location_sample",
            location: { x: 0, y: 64, z: 0 },
            evidence_refs: [],
            meta: {
              domain_adapter: created.binding.domain_adapter,
              nested: { deeper: { [authorityAlias]: "source-selected" } },
            },
          },
        ],
      });
      const authorityRejected = await request(app)
        .post(sourcePath(created.binding.binding_id, "world-events/batch"))
        .set(nextHeaders(authorityBatch))
        .send(authorityBatch)
        .expect(403);
      expect(authorityRejected.body).toMatchObject({
        error: "room_source_execution_denied",
        accepted: false,
        assistant_answer: false,
        terminal_eligible: false,
      });
    }

    const humanInvite = await owner
      .post(`/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/invites`)
      .expect(201);
    const inviteAsCredential = await request(app)
      .get(sourcePath(created.binding.binding_id, "status"))
      .set(ingressHeaderFactory(humanInvite.body.invite_code as string)(""))
      .expect(401);
    expect(inviteAsCredential.body.error).toBe(
      "room_source_credential_invalid",
    );

    await ensureDatabase();
    await getPool().query(
      `
        UPDATE helix_room_source_credentials
        SET expires_at = $2
        WHERE binding_id = $1 AND status = 'active';
      `,
      [created.binding.binding_id, new Date(Date.now() - 1_000).toISOString()],
    );
    const expired = await request(app)
      .get(sourcePath(created.binding.binding_id, "status"))
      .set(nextHeaders(""))
      .expect(401);
    expect(expired.body.error).toBe("room_source_credential_expired");
    const expiredCredential = await getPool().query<{ status: string }>(
      `
        SELECT status
        FROM helix_room_source_credentials
        WHERE binding_id = $1
        ORDER BY created_at DESC
        LIMIT 1;
      `,
      [created.binding.binding_id],
    );
    expect(expiredCredential.rows[0]?.status).toBe("expired");

    const rotationDelivery = await owner
      .post(
        `/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/source-bindings/${encodeURIComponent(created.binding.binding_id)}/rotate`,
      )
      .set(SAME_ORIGIN_HEADERS)
      .send({})
      .expect(200);
    const rotated = await owner
      .post("/api/agi/realtime/room-source-credential-deliveries/claim")
      .set(SAME_ORIGIN_HEADERS)
      .send({
        claim_handle: rotationDelivery.body.credential_delivery.claim_handle,
      })
      .expect(200);
    const oldCredentialHeaders = nextHeaders("", {
      "Content-Type": "application/json",
      Digest: digest(""),
    });
    const oldCredential = await request(app)
      .get(sourcePath(created.binding.binding_id, "status"))
      .set(oldCredentialHeaders)
      .expect(401);
    expect(oldCredential.body.error).toBe("room_source_credential_invalid");

    const currentHeaders = ingressHeaderFactory(
      rotated.body.token_value as string,
    );
    await owner
      .post(`/api/agi/realtime/rooms/${encodeURIComponent(roomId)}/leave`)
      .send({})
      .expect(200);
    const closed = await request(app)
      .get(sourcePath(created.binding.binding_id, "status"))
      .set(currentHeaders(""))
      .expect(410);
    expect(closed.body.error).toBe("room_source_binding_closed");
  });

  it("keeps ingress active when a newer owner session is ineligible but another active session remains eligible", async () => {
    const app = createApp();
    const profileId = "profile:multi-session-policy-owner";
    const owner = await signIn(app, profileId, "Multi-session Policy Owner");
    const roomId = await createRoom(owner);
    const created = await createBinding(owner, roomId);
    await signIn(app, profileId, "Multi-session Policy Owner");
    await ensureDatabase();
    const preFeatureDeveloperPolicy = {
      ...HELIX_DEVELOPER_ACCOUNT_POLICY,
      feature_flags: HELIX_DEVELOPER_ACCOUNT_POLICY.feature_flags.filter(
        (feature) => feature !== "room_source_ingress",
      ),
    };
    await getPool().query(
      `
        UPDATE helix_account_sessions
        SET account_policy = $2::jsonb, updated_at = now()
        WHERE session_id = (
          SELECT session_id
          FROM helix_account_sessions
          WHERE profile_id = $1 AND status = 'active'
          ORDER BY created_at DESC
          LIMIT 1
        );
      `,
      [profileId, JSON.stringify(preFeatureDeveloperPolicy)],
    );

    const nextHeaders = ingressHeaderFactory(created.token);
    await request(app)
      .get(sourcePath(created.binding.binding_id, "status"))
      .set(nextHeaders(""))
      .expect(200);

    const state = await getPool().query<{ status: string }>(
      `SELECT status FROM helix_room_source_bindings WHERE binding_id = $1;`,
      [created.binding.binding_id],
    );
    expect(state.rows[0]?.status).toBe("active");
  });

  it("revokes ingress when the binding owner loses every eligible policy path", async () => {
    const app = createApp();
    const owner = await signIn(app, "profile:policy-owner", "Policy Owner");
    const roomId = await createRoom(owner);
    const created = await createBinding(owner, roomId);
    await ensureDatabase();
    const preFeatureDeveloperPolicy = {
      ...HELIX_DEVELOPER_ACCOUNT_POLICY,
      feature_flags: HELIX_DEVELOPER_ACCOUNT_POLICY.feature_flags.filter(
        (feature) => feature !== "room_source_ingress",
      ),
    };
    await getPool().query(
      `
        UPDATE helix_account_sessions
        SET account_policy = $2::jsonb, updated_at = now()
        WHERE profile_id = $1 AND status = 'active';
      `,
      ["profile:policy-owner", JSON.stringify(preFeatureDeveloperPolicy)],
    );
    const nextHeaders = ingressHeaderFactory(created.token);
    await request(app)
      .get(sourcePath(created.binding.binding_id, "status"))
      .set(nextHeaders(""))
      .expect(200);

    await getPool().query(
      `
        UPDATE helix_accounts
        SET account_type = 'user', provider = 'password', updated_at = now()
        WHERE profile_id = $1;
      `,
      ["profile:policy-owner"],
    );
    vi.stubEnv("HELIX_PUBLIC_ROOMS_EXPERIMENT", "0");

    const denied = await request(app)
      .get(sourcePath(created.binding.binding_id, "status"))
      .set(nextHeaders(""))
      .expect(403);
    expect(denied.body).toMatchObject({
      error: "room_source_owner_policy_revoked",
      accepted: false,
      assistant_answer: false,
      terminal_eligible: false,
    });
    const state = await getPool().query<{
      binding_status: string;
      credential_status: string;
    }>(
      `
        SELECT
          b.status AS binding_status,
          c.status AS credential_status
        FROM helix_room_source_bindings b
        JOIN helix_room_source_credentials c
          ON c.binding_id = b.binding_id
        WHERE b.binding_id = $1
        ORDER BY c.created_at DESC
        LIMIT 1;
      `,
      [created.binding.binding_id],
    );
    expect(state.rows[0]).toEqual({
      binding_status: "revoked",
      credential_status: "revoked",
    });
  });

  it("blocks a local source without revoking it during the native-grant restart gap", async () => {
    const app = createApp();
    const profileId = "profile:local-restart-owner";
    const owner = await signIn(app, profileId, "Local Restart Owner");
    const roomId = await createRoom(owner);
    const created = await createBinding(owner, roomId);
    await ensureDatabase();
    await getPool().query(
      `UPDATE helix_accounts SET account_type = 'user', updated_at = now()
        WHERE profile_id = $1;`, [profileId]);
    vi.stubEnv("HELIX_PUBLIC_ROOMS_EXPERIMENT", "0");
    const headers = ingressHeaderFactory(created.token);
    const blocked = await request(app).get(sourcePath(created.binding.binding_id, "status"))
      .set(headers("")).expect(503);
    expect(blocked.body.error).toBe("room_source_owner_policy_unavailable");
    const pending = await getPool().query<{ status: string }>(
      `SELECT status FROM helix_room_source_bindings WHERE binding_id = $1;`,
      [created.binding.binding_id]);
    expect(pending.rows[0]?.status).toBe("active");
    await getPool().query(
      `UPDATE helix_accounts SET account_type = 'developer', updated_at = now()
        WHERE profile_id = $1;`, [profileId]);
    await request(app).get(sourcePath(created.binding.binding_id, "status"))
      .set(headers("")).expect(200);
  });

  it("preserves a password-backed desktop source while its native developer lease restarts", async () => {
    const app = createApp();
    const profileId = "profile:password-desktop-restart-owner";
    const owner = await signIn(app, profileId, "Password Desktop Restart Owner");
    const roomId = await createRoom(owner);
    const created = await createBinding(owner, roomId);
    await ensureDatabase();
    await getPool().query(
      `UPDATE helix_accounts SET account_type = 'user', provider = 'password',
         updated_at = now() WHERE profile_id = $1;`, [profileId]);
    await getPool().query(
      `UPDATE helix_account_sessions SET account_policy = $2::jsonb,
         updated_at = now() WHERE profile_id = $1 AND status = 'active';`,
      [profileId, JSON.stringify(HELIX_USER_ACCOUNT_POLICY)]);
    vi.stubEnv("HELIX_PUBLIC_ROOMS_EXPERIMENT", "0");
    vi.stubEnv("CASIMIR_DESKTOP_HOST", "1");
    vi.stubEnv("CASIMIR_LOCAL_DEVELOPER_ACCESS_ENABLED", "1");
    const headers = ingressHeaderFactory(created.token);
    const blocked = await request(app).get(sourcePath(created.binding.binding_id, "status"))
      .set(headers("")).expect(503);
    expect(blocked.body.error).toBe("room_source_owner_policy_unavailable");
    const saved = await getPool().query<{ binding_status: string; credential_status: string }>(
      `SELECT b.status AS binding_status, c.status AS credential_status
         FROM helix_room_source_bindings b
         JOIN helix_room_source_credentials c ON c.binding_id = b.binding_id
        WHERE b.binding_id = $1 ORDER BY c.created_at DESC LIMIT 1;`,
      [created.binding.binding_id]);
    expect(saved.rows[0]).toEqual({ binding_status: "active", credential_status: "active" });

    const currentSession = await getPool().query<{ session_id: string }>(
      `SELECT session_id FROM helix_account_sessions
        WHERE profile_id = $1 AND status = 'active' LIMIT 1;`, [profileId]);
    const leaseRestored = vi.spyOn(accountSessionStore, "getAccountSessionById")
      .mockResolvedValueOnce({
        session_id: currentSession.rows[0].session_id,
        status: "active",
        profile: { profile_id: profileId },
        account_policy: HELIX_DEVELOPER_ACCOUNT_POLICY,
      } as Awaited<ReturnType<typeof accountSessionStore.getAccountSessionById>>);
    await request(app).get(sourcePath(created.binding.binding_id, "status"))
      .set(headers("")).expect(200);
    leaseRestored.mockRestore();

    // Without the native lease-capable desktop, the same loss of owner policy
    // remains a permanent denial rather than an indefinite temporary hold.
    vi.stubEnv("CASIMIR_DESKTOP_HOST", "0");
    const denied = await request(app).get(sourcePath(created.binding.binding_id, "status"))
      .set(headers("")).expect(403);
    expect(denied.body.error).toBe("room_source_owner_policy_revoked");
  });

  it("does not permanently revoke a source on an unreadable owner session", async () => {
    const app = createApp();
    const owner = await signIn(app, "profile:policy-read-owner", "Policy Read Owner");
    const roomId = await createRoom(owner);
    const created = await createBinding(owner, roomId);
    await ensureDatabase();
    await getPool().query(
      `UPDATE helix_accounts SET account_type = 'user', provider = 'password',
         updated_at = now() WHERE profile_id = $1;`,
      ["profile:policy-read-owner"],
    );
    await getPool().query(
      `UPDATE helix_account_sessions SET account_policy = $2::jsonb, updated_at = now()
       WHERE profile_id = $1 AND status = 'active';`,
      ["profile:policy-read-owner", JSON.stringify(HELIX_USER_ACCOUNT_POLICY)],
    );
    vi.stubEnv("HELIX_PUBLIC_ROOMS_EXPERIMENT", "0");
    const nextHeaders = ingressHeaderFactory(created.token);
    const lookup = vi.spyOn(accountSessionStore, "getAccountSessionById")
      .mockRejectedValueOnce(new Error("temporary session read failure"));
    const uncertain = await request(app)
      .get(sourcePath(created.binding.binding_id, "status"))
      .set(nextHeaders(""))
      .expect(503);
    expect(uncertain.body.error).toBe("room_source_owner_policy_unavailable");
    const stillActive = await getPool().query<{ status: string }>(
      `SELECT status FROM helix_room_source_bindings WHERE binding_id = $1;`,
      [created.binding.binding_id],
    );
    expect(stillActive.rows[0]?.status).toBe("active");
    lookup.mockRestore();
    const denied = await request(app)
      .get(sourcePath(created.binding.binding_id, "status"))
      .set(nextHeaders(""))
      .expect(403);
    expect(denied.body.error).toBe("room_source_owner_policy_revoked");
  });

  it("turns an abandoned processing claim into an actionable unknown outcome", async () => {
    const app = createApp();
    const owner = await signIn(app, "profile:lease-owner", "Lease Owner");
    const roomId = await createRoom(owner);
    const created = await createBinding(owner, roomId);
    const manifest = JSON.stringify({
      ...manifestFixture,
      manifest_id: `manifest:${created.binding.source_id}:lease`,
      source_id: created.binding.source_id,
      room_id: created.binding.room_id,
      domain_adapter: created.binding.domain_adapter,
      created_at: new Date().toISOString(),
    });
    const headers = ingressHeaderFactory(created.token)(manifest);
    await ensureDatabase();
    const credential = await getPool().query<{ credential_id: string }>(
      `
        SELECT credential_id
        FROM helix_room_source_credentials
        WHERE binding_id = $1 AND status = 'active'
        LIMIT 1;
      `,
      [created.binding.binding_id],
    );
    await getPool().query(
      `
        INSERT INTO helix_room_source_ingress_requests (
          binding_id,
          credential_id,
          request_id,
          producer_epoch,
          sequence_number,
          route_key,
          body_digest,
          sent_at,
          received_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
      `,
      [
        created.binding.binding_id,
        credential.rows[0].credential_id,
        headers["X-Helix-Request-Id"],
        headers["X-Helix-Producer-Epoch"],
        Number(headers["X-Helix-Sequence"]),
        "manifest",
        headers.Digest,
        headers["X-Helix-Sent-At"],
        new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      ],
    );

    const response = await request(app)
      .post(sourcePath(created.binding.binding_id, "manifest"))
      .set(headers)
      .send(manifest)
      .expect(409);
    expect(response.body).toMatchObject({
      error: "room_source_request_outcome_unknown",
      accepted: false,
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(response.body.message).toContain("fresh current-state observation");
  });

  it("returns only bound, pending read-only probes and rejects unsolicited results", async () => {
    const app = createApp();
    const owner = await signIn(app, "profile:probe-owner", "Probe Owner");
    const roomId = await createRoom(owner);
    const created = await createBinding(owner, roomId);
    const nextHeaders = ingressHeaderFactory(created.token);

    const manifest = JSON.stringify({
      ...manifestFixture,
      manifest_id: `manifest:${created.binding.source_id}:0.1.0`,
      source_id: created.binding.source_id,
      room_id: created.binding.room_id,
      domain_adapter: created.binding.domain_adapter,
      created_at: new Date().toISOString(),
    });
    await request(app)
      .post(sourcePath(created.binding.binding_id, "manifest"))
      .set(nextHeaders(manifest))
      .send(manifest)
      .expect(200);

    for (let poll = 0; poll < 3; poll += 1) {
      const emptyPoll = await request(app)
        .get(
          `${sourcePath(created.binding.binding_id, "probes/pending")}?limit=8`,
        )
        .set(nextHeaders(""))
        .expect(200);
      expect(emptyPoll.body).toMatchObject({
        ok: true,
        kind: "probe_requests",
        probe_requests: [],
      });
    }
    await ensureDatabase();
    const emptyPollReceipts = await getPool().query<{
      request_count: number | string;
    }>(
      `SELECT COUNT(*) AS request_count
       FROM helix_room_source_ingress_requests
       WHERE binding_id = $1 AND route_key LIKE 'probes/pending%';`,
      [created.binding.binding_id],
    );
    expect(Number(emptyPollReceipts.rows[0]?.request_count ?? 0)).toBe(0);

    const pending = createEnvironmentProbeRequest({
      sourceId: created.binding.source_id,
      roomId: created.binding.room_id,
      domain: "minecraft",
      probeType: "inventory_check",
      reason: "contract_test",
      evidenceRefs: [],
      sourceAdmission: sourceAdmissionFor(created.binding),
    });
    const pendingResponse = await request(app)
      .get(
        `${sourcePath(created.binding.binding_id, "probes/pending")}?limit=8`,
      )
      .set(nextHeaders(""))
      .expect(200);
    expect(pendingResponse.body.probe_requests).toEqual([
      expect.objectContaining({
        probe_request_id: pending.probe_request_id,
        room_id: created.binding.room_id,
        source_id: created.binding.source_id,
        constraints: expect.objectContaining({
          read_only: true,
          side_effects_allowed: false,
        }),
        assistant_answer: false,
      }),
    ]);

    const resultBody = (overrides: Record<string, unknown> = {}) =>
      JSON.stringify({
        schema: "helix.environment_probe_result.v1",
        probe_result_id: `probe_result:${crypto.randomUUID()}`,
        probe_request_id: pending.probe_request_id,
        source_id: created.binding.source_id,
        room_id: created.binding.room_id,
        domain: "minecraft",
        probe_type: "inventory_check",
        status: "succeeded",
        result_summary: "Inventory checked.",
        result: { confidence: 1 },
        sensor_scope: "player_observable",
        requires_caveat: false,
        side_effects_performed: false,
        commands_executed: [],
        world_mutation_performed: false,
        evidence_refs: [],
        deterministic: true,
        model_invoked: false,
        assistant_answer: false,
        raw_content_included: false,
        context_policy: "compact_context_pack_only",
        created_at: new Date().toISOString(),
        ...overrides,
      });
    const unsolicited = resultBody({
      probe_request_id: "environment_probe_request:not-pending",
    });
    const rejected = await request(app)
      .post(sourcePath(created.binding.binding_id, "probes/result"))
      .set(nextHeaders(unsolicited))
      .send(unsolicited)
      .expect(409);
    expect(rejected.body.error).toBe("room_source_probe_not_pending");

    for (const mismatched of [
      { domain: "other-domain" },
      { probe_type: "reachability" },
    ]) {
      const mismatchedBody = resultBody(mismatched);
      const mismatch = await request(app)
        .post(sourcePath(created.binding.binding_id, "probes/result"))
        .set(nextHeaders(mismatchedBody))
        .send(mismatchedBody)
        .expect(409);
      expect(mismatch.body.error).toBe("room_source_probe_not_pending");
    }

    const matching = resultBody();
    const recorded = await request(app)
      .post(sourcePath(created.binding.binding_id, "probes/result"))
      .set(nextHeaders(matching))
      .send(matching)
      .expect(200);
    expect(recorded.body).toMatchObject({
      ok: true,
      kind: "probe_result",
      accepted: true,
      assistant_answer: false,
      terminal_eligible: false,
    });
  });

  it("delivers a durable one-time lease to the authenticated connector while persisting only its hash", async () => {
    const app = createApp();
    const owner = await signIn(
      app,
      "profile:durable-probe-route",
      "Durable Probe Route",
    );
    const roomId = await createRoom(owner);
    const created = await createBinding(owner, roomId);
    const nextHeaders = ingressHeaderFactory(created.token);
    const manifest = JSON.stringify({
      ...manifestFixture,
      manifest_id: `manifest:${created.binding.source_id}:durable`,
      source_id: created.binding.source_id,
      room_id: created.binding.room_id,
      domain_adapter: created.binding.domain_adapter,
      created_at: new Date().toISOString(),
    });
    const manifestResponse = await request(app)
      .post(sourcePath(created.binding.binding_id, "manifest"))
      .set(nextHeaders(manifest))
      .send(manifest)
      .expect(200);
    const adapterAdmission = manifestResponse.body.observation_ref
      .adapter_admission as HelixEnvironmentAdapterAdmissionProjection;
    const connectors = await listActiveEnvironmentConnectorBindings({
      ownerProfileId: "profile:durable-probe-route",
      roomSourceBindingId: created.binding.binding_id,
      roomId: created.binding.room_id,
      sourceId: created.binding.source_id,
      adapterAdmissionId: adapterAdmission.admission_id,
      adapterContractHash: adapterAdmission.adapter_contract_hash,
      manifestHash: adapterAdmission.manifest_hash,
      producerEpochRef: adapterAdmission.producer_epoch_ref,
      capabilityId: HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY,
    });
    expect(connectors).toHaveLength(1);
    const connector = connectors[0];
    expect(connector.catalogSnapshot).toMatchObject({
      adapter_profile_id: adapterAdmission.adapter_profile_id,
      adapter_contract_hash: adapterAdmission.adapter_contract_hash,
      manifest_hash: adapterAdmission.manifest_hash,
      content_role: "server_owned_capability_catalog",
      answer_authority: false,
      terminal_eligible: false,
    });
    await ensureDatabase();
    const now = new Date();
    await getPool().query(
      `
        INSERT INTO helix_agent_runs (
          run_id, schema_version, tenant_id, issuer, subject_id,
          account_profile_id, objective, objective_hash, runtime_provider,
          provider_goal_id, provider_thread_id, provider_session_id,
          lifecycle_status, completion_status, terminal_authority_status,
          configuration, evidence_bundle, max_steps, active_operation_id,
          operation_started_at, expires_at, created_at, updated_at
        ) VALUES (
          $1, 'helix.agent_run.v1', 'tenant:durable-probe-route',
          'https://issuer.example.test', 'subject:durable-probe-route', $2,
          'Inspect the bound actor inventory.', $3, 'codex', $4, $5, $6,
          'running', 'in_progress', 'pending', '{}'::jsonb, '{}'::jsonb, 8,
          'agent_operation:durable-probe-route', $8, $7, $8, $8
        );
      `,
      [
        "agent_run:durable-probe-route",
        "profile:durable-probe-route",
        `sha256:${"c".repeat(64)}`,
        "provider_goal:durable-probe-route",
        "provider_thread:durable-probe-route",
        "provider_session:durable-probe-route",
        new Date(now.getTime() + 60_000).toISOString(),
        now.toISOString(),
      ],
    );
    await getSharedLiveRoomBindingStore().bindRunToRoom({
      owner: {
        tenantId: "tenant:durable-probe-route",
        issuer: "https://issuer.example.test",
        subjectId: "subject:durable-probe-route",
        accountProfileId: "profile:durable-probe-route",
      },
      runId: "agent_run:durable-probe-route",
      roomId: created.binding.room_id,
      now: now.toISOString(),
    });
    const dispatched = await dispatchDurableEnvironmentProbe({
      tenantId: "tenant:durable-probe-route",
      ownerSubjectId: "subject:durable-probe-route",
      ownerProfileId: "profile:durable-probe-route",
      executionAuthorityKind: "external_agent_run",
      runId: "agent_run:durable-probe-route",
      turnId: "ask:durable-probe-route",
      providerExecutionId: "provider_execution:durable-probe-route",
      toolCallId: "tool_call:durable-probe-route",
      roomId: created.binding.room_id,
      sourceId: created.binding.source_id,
      producerEpochRef: adapterAdmission.producer_epoch_ref,
      adapterAdmission,
      connector,
      descriptor: readEnvironmentConnectorCapabilityDescriptor(
        HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY,
      )!,
      arguments: {
        target: "current_actor",
        freshness_requirement_ms: 5_000,
      },
      freshnessRequirementMs: 5_000,
      timeoutMs: 10_000,
      idempotencyKey: "idempotency:durable-probe-route",
      now,
    });

    const refreshedManifest = await request(app)
      .post(sourcePath(created.binding.binding_id, "manifest"))
      .set(nextHeaders(manifest))
      .send(manifest)
      .expect(200);
    expect(
      refreshedManifest.body.observation_ref.adapter_admission.admission_id,
    ).toBe(adapterAdmission.admission_id);

    const pendingHeaders = nextHeaders("");
    const pending = await request(app)
      .get(
        `${sourcePath(created.binding.binding_id, "probes/pending")}?limit=8`,
      )
      .set(pendingHeaders)
      .expect(200);
    const leasedRequest = pending.body.probe_requests.find(
      (entry: { probe_request_id?: string }) =>
        entry.probe_request_id === dispatched.requestId,
    ) as {
      probe_request_id: string;
      connector_transport: {
        schema: string;
        probe_attempt_id: string;
        lease_token: string;
      };
    };
    expect(leasedRequest).toMatchObject({
      probe_request_id: dispatched.requestId,
      connector_transport: {
        schema: "helix.environment_connector.probe_lease.v1",
      },
    });
    expect(leasedRequest.connector_transport.lease_token).toMatch(
      /^helix_probe_lease_/,
    );

    const persistedReceipt = await getPool().query<{
      response_receipt: unknown;
    }>(
      `
        SELECT response_receipt
        FROM helix_room_source_ingress_requests
        WHERE binding_id = $1 AND request_id = $2
        LIMIT 1;
      `,
      [created.binding.binding_id, pendingHeaders["X-Helix-Request-Id"]],
    );
    expect(
      JSON.stringify(persistedReceipt.rows[0].response_receipt),
    ).not.toContain(leasedRequest.connector_transport.lease_token);
    expect(persistedReceipt.rows[0].response_receipt).toMatchObject({
      probe_requests: [
        expect.objectContaining({
          connector_transport: expect.objectContaining({
            lease_token_included: false,
          }),
        }),
      ],
    });

    const result = {
      schema: "helix.environment_probe_result.v1",
      probe_result_id: `probe_result:${crypto.randomUUID()}`,
      probe_request_id: dispatched.requestId,
      source_id: created.binding.source_id,
      room_id: created.binding.room_id,
      domain: "minecraft",
      probe_type: "inventory_check",
      status: "succeeded",
      result_summary: "The bound actor has four inventory stacks.",
      result: { details: { stack_count: 4 } },
      sensor_scope: "privileged_server_state",
      requires_caveat: true,
      side_effects_performed: false,
      commands_executed: [],
      world_mutation_performed: false,
      evidence_refs: [created.binding.binding_id],
      deterministic: true,
      model_invoked: false,
      assistant_answer: false,
      raw_content_included: false,
      context_policy: "compact_context_pack_only",
      created_at: new Date().toISOString(),
    };
    const toxicSubmission = JSON.stringify({
      schema: HELIX_ENVIRONMENT_PROBE_SUBMISSION_SCHEMA,
      probe_attempt_id: leasedRequest.connector_transport.probe_attempt_id,
      lease_token: leasedRequest.connector_transport.lease_token,
      result: {
        ...result,
        result_summary: "helix_env_device_secret_value_1234567890_abcdef",
      },
      submitted_at: new Date().toISOString(),
    });
    const rejectedSecret = await request(app)
      .post(sourcePath(created.binding.binding_id, "probes/result"))
      .set(nextHeaders(toxicSubmission))
      .send(toxicSubmission)
      .expect(400);
    expect(rejectedSecret.body).toMatchObject({
      error: "room_source_secret_exposure_rejected",
      accepted: false,
    });
    expect(JSON.stringify(rejectedSecret.body)).not.toContain(
      "helix_env_device_secret_value_1234567890_abcdef",
    );

    const submission = JSON.stringify({
      schema: HELIX_ENVIRONMENT_PROBE_SUBMISSION_SCHEMA,
      probe_attempt_id: leasedRequest.connector_transport.probe_attempt_id,
      lease_token: leasedRequest.connector_transport.lease_token,
      result,
      submitted_at: new Date().toISOString(),
    });
    const recorded = await request(app)
      .post(sourcePath(created.binding.binding_id, "probes/result"))
      .set(nextHeaders(submission))
      .send(submission)
      .expect(200);
    expect(recorded.body).toMatchObject({
      ok: true,
      accepted: true,
      observation_ref: {
        probe_request_ref: dispatched.requestId,
        outcome: "succeeded",
        provenance_valid: true,
        eligible_for_current_turn_reentry: true,
        terminal_eligible: false,
      },
    });
    expect(
      await readDurableEnvironmentProbeObservation(dispatched.requestId),
    ).toMatchObject({
      outcome: "succeeded",
      result: {
        item_count: 4,
      },
    });
  });
});
