import crypto from "node:crypto";
import express from "express";
import request, { type Test } from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY } from
  "@shared/helix-environment-connector";
import { ensureDatabase, getPool, resetDbClient } from "../../../../db/client";
import { accountSessionRouter } from "../../../../routes/account-session";
import {
  environmentConnectorBrowserRouter,
} from "../../../../routes/environment-connector-platform";
import { listEnvironmentConnectorDeviceChecks } from
  "../../devices/device-check";
import { readLocalSupervisorEnvironmentIdentity } from
  "../../bindings/local-supervisor-identity-reader";
import { installedDeviceRef } from "../../../helix-account/installed-security-store";
import {
  authorizeRoomReadGrant,
  createRoomReadGrant,
  listRoomSharedCapabilities,
  revokeRoomReadGrant,
  RoomReadGrantStoreError,
} from "../room-read-grant-store";

const OWNER = "profile:room-grant-owner";
const MEMBER = "profile:room-grant-member";
const ROOM = "shared_realtime_room:room-grant";
const OWNER_PARTICIPANT = "participant:room-grant-owner";
const MEMBER_PARTICIPANT = "participant:room-grant-member";
const SOURCE_BINDING = "room_source_binding:room-grant";
const SOURCE_CREDENTIAL = "room_source_credential:room-grant";
const SOURCE = "source:room-ingress:room-grant";
const WORLD = "minecraft:test:room-grant";
const ADMISSION = "environment_adapter_admission:room-grant";
const PACKAGE_VERSION = "connector_package_version:room-grant";
const INSTALLATION = "connector_installation:room-grant";
const INSTALLED_DEVICE = "desktop_device_room_grant_owner";
const INSTALLED_NODE = installedDeviceRef(INSTALLED_DEVICE);
const DEVICE = "connector_device:room-grant";
const DEVICE_CREDENTIAL = "connector_device_credential:room-grant";
const CONNECTION = "environment_binding:room-grant";
const EPOCH = "producer_epoch:room-grant";
const NOW = new Date("2026-08-26T18:00:00.000Z");

const seed = async (): Promise<void> => {
  await ensureDatabase();
  const db = getPool();
  await db.query(
    `INSERT INTO helix_accounts (profile_id, display_name, account_type, provider)
     VALUES ($1, 'Harness owner', 'developer', 'local'),
            ($2, 'Room member', 'developer', 'local');`,
    [OWNER, MEMBER],
  );
  await db.query(
    `INSERT INTO helix_shared_realtime_rooms (room_id, owner_profile_id, title, status)
     VALUES ($1, $2, 'Grant room', 'active');`,
    [ROOM, OWNER],
  );
  await db.query(
    `INSERT INTO helix_shared_realtime_room_members
       (room_id, slot_number, profile_id, participant_id, member_role, presence, consent)
     VALUES ($1, 1, $2, $3, 'owner', 'present', '{}'::jsonb),
            ($1, 2, $4, $5, 'participant', 'present', '{}'::jsonb);`,
    [ROOM, OWNER, OWNER_PARTICIPANT, MEMBER, MEMBER_PARTICIPANT],
  );
  await db.query(
    `INSERT INTO helix_room_source_bindings
       (binding_id, room_id, owner_profile_id, source_id, world_id,
        domain_adapter, source_label, scopes)
     VALUES ($1,$2,$3,$4,$5,'minecraft.minehut.v1','Room source','[]'::jsonb);`,
    [SOURCE_BINDING, ROOM, OWNER, SOURCE, WORLD],
  );
  await db.query(
    `INSERT INTO helix_room_source_credentials
       (credential_id, binding_id, token_hash, token_prefix, expires_at)
     VALUES ($1,$2,$3,'room-grant','2099-01-01T00:00:00.000Z');`,
    [SOURCE_CREDENTIAL, SOURCE_BINDING, `sha256:${"1".repeat(64)}`],
  );
  await db.query(
    `INSERT INTO helix_environment_adapter_admissions
       (admission_id, binding_id, credential_id, producer_epoch, room_id,
        source_id, world_id, domain_adapter, adapter_profile_id,
        adapter_profile_version, adapter_contract_hash, manifest_id,
        manifest_hash, source_family, mechanics_collection_ids)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'minecraft.minehut.v1',
       'infrastructure.minecraft.readonly.v1',1,$8,'manifest:room-grant',$9,
       'minecraft','[]'::jsonb);`,
    [
      ADMISSION, SOURCE_BINDING, SOURCE_CREDENTIAL, EPOCH, ROOM, SOURCE, WORLD,
      `sha256:${"2".repeat(64)}`, `sha256:${"3".repeat(64)}`,
    ],
  );
  await db.query(
    `INSERT INTO helix_environment_connector_packages
       (package_version_id, publisher_id, package_id, package_version,
        content_hash, capability_descriptors, trust_classification,
        security_review_state)
     VALUES ($1,'casimirbot','com.casimirbot.minecraft.paper','1.1.0',$2,$3::jsonb,
       'first_party','approved');`,
    [
      PACKAGE_VERSION, `sha256:${"4".repeat(64)}`,
      JSON.stringify([{ capability_id: HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY }]),
    ],
  );
  await db.query(
    `INSERT INTO helix_installed_devices
       (profile_id, device_id, label, platform, status, registered_at, last_seen_at)
     VALUES ($1,$2,'Owner workstation','windows','active',$3,$3);`,
    [OWNER, INSTALLED_DEVICE, NOW.toISOString()],
  );
  await db.query(
    `INSERT INTO helix_environment_connector_installations
       (installation_id, owner_profile_id, package_version_id,
        granted_capability_ids, status, installed_device_id)
     VALUES ($1,$2,$3,$4::jsonb,'active',$5);`,
    [INSTALLATION, OWNER, PACKAGE_VERSION,
      JSON.stringify([HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY]), INSTALLED_DEVICE],
  );
  await db.query(
    `INSERT INTO helix_environment_connector_devices
       (device_id, installation_id, device_public_key_hash, credential_ref,
        producer_epoch_ref, status, health_status, last_contact_at)
     VALUES ($1,$2,$3,$4,$5,'active','online',$6);`,
    [
      DEVICE, INSTALLATION, `sha256:${"5".repeat(64)}`, DEVICE_CREDENTIAL,
      EPOCH, new Date().toISOString(),
    ],
  );
  await db.query(
    `INSERT INTO helix_environment_connector_device_credentials
       (device_credential_id, device_id, token_hash, token_prefix, scopes, expires_at)
     VALUES ($1,$2,$3,'device-grant','[]'::jsonb,'2099-01-01T00:00:00.000Z');`,
    [DEVICE_CREDENTIAL, DEVICE, `sha256:${"6".repeat(64)}`],
  );
  await db.query(
    `INSERT INTO helix_environment_connector_bindings
       (environment_binding_id, installation_id, device_id,
        room_source_binding_id, adapter_admission_id, owner_profile_id,
        room_id, source_id, world_id, status, consent_capability_ids)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10::jsonb);`,
    [
      CONNECTION, INSTALLATION, DEVICE, SOURCE_BINDING, ADMISSION, OWNER,
      ROOM, SOURCE, WORLD,
      JSON.stringify([HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY]),
    ],
  );
};

const authorizeAsMember = (overrides: Partial<Parameters<typeof authorizeRoomReadGrant>[0]> = {}) =>
  authorizeRoomReadGrant({
    roomId: ROOM,
    requestingProfileId: MEMBER,
    requestingParticipantId: MEMBER_PARTICIPANT,
    connectionOwnerProfileId: OWNER,
    connectionRef: CONNECTION,
    installedNodeRef: INSTALLED_NODE,
    sourceRef: SOURCE,
    producerEpochRef: EPOCH,
    capabilityId: HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY,
    turnId: "turn:room-grant",
    toolCallId: "tool_call:room-grant",
    now: NOW,
    ...overrides,
  });

const routeApp = () => {
  const app = express();
  app.use("/api/account", express.json(), accountSessionRouter);
  app.use("/api/agi", environmentConnectorBrowserRouter);
  return app;
};

const sameOrigin = <T extends Test>(test: T): T => test
  .set("Host", "localhost")
  .set("Origin", "http://localhost")
  .set("Sec-Fetch-Site", "same-origin") as T;

describe("room read grant store", () => {
  beforeEach(async () => {
    vi.stubEnv("DATABASE_URL", `pg-mem://room-read-grant-${crypto.randomUUID()}`);
    vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "0");
    await resetDbClient();
    await seed();
  });

  afterEach(async () => {
    await resetDbClient();
    vi.unstubAllEnvs();
  });

  it("resolves one canonical owner/grantee source epoch and rejects stale or departed identity", async () => {
    await expect(readLocalSupervisorEnvironmentIdentity({
      roomId: ROOM,
      profileId: OWNER,
      participantId: OWNER_PARTICIPANT,
      environmentBindingId: CONNECTION,
      now: NOW,
    })).resolves.toEqual({
      roomId: ROOM,
      participantId: OWNER_PARTICIPANT,
      environmentBindingId: CONNECTION,
      connectorInstallationId: INSTALLATION,
      sourceId: SOURCE,
      producerEpochRef: EPOCH,
    });
    await expect(readLocalSupervisorEnvironmentIdentity({
      roomId: ROOM,
      profileId: MEMBER,
      participantId: MEMBER_PARTICIPANT,
      environmentBindingId: CONNECTION,
      now: NOW,
    })).resolves.toBeNull();
    await createRoomReadGrant({
      roomId: ROOM,
      ownerProfileId: OWNER,
      ownerParticipantId: OWNER_PARTICIPANT,
      connectionRef: CONNECTION,
      capabilityIds: [HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY],
      expiresInMinutes: 60,
      now: NOW,
    });
    await expect(readLocalSupervisorEnvironmentIdentity({
      roomId: ROOM,
      profileId: MEMBER,
      participantId: MEMBER_PARTICIPANT,
      environmentBindingId: CONNECTION,
      now: NOW,
    })).resolves.toMatchObject({
      sourceId: SOURCE,
      producerEpochRef: EPOCH,
    });
    await getPool().query(
      `UPDATE helix_environment_connector_devices
       SET producer_epoch_ref = 'producer_epoch:rotated'
       WHERE device_id = $1;`,
      [DEVICE],
    );
    await expect(readLocalSupervisorEnvironmentIdentity({
      roomId: ROOM,
      profileId: MEMBER,
      participantId: MEMBER_PARTICIPANT,
      environmentBindingId: CONNECTION,
      now: NOW,
    })).resolves.toBeNull();
    await getPool().query(
      `UPDATE helix_shared_realtime_room_members SET presence = 'left'
       WHERE room_id = $1 AND profile_id = $2;`,
      [ROOM, OWNER],
    );
    await expect(readLocalSupervisorEnvironmentIdentity({
      roomId: ROOM,
      profileId: OWNER,
      participantId: OWNER_PARTICIPANT,
      environmentBindingId: CONNECTION,
      now: NOW,
    })).resolves.toBeNull();
  });

  it("shares a sanitized read capability, persists admission, and revokes without disconnecting the host", async () => {
    const ownerBefore = await listRoomSharedCapabilities({
      roomId: ROOM, requestingProfileId: OWNER, requestingIsOwner: true, now: NOW,
    });
    expect(ownerBefore.available_connections).toHaveLength(1);
    expect(ownerBefore.available_connections[0]).toMatchObject({
      owner_profile_ref: OWNER,
      installed_node_ref: INSTALLED_NODE,
      connection_ref: CONNECTION,
      ready: true,
      action_class: "none",
      mutation_authority: false,
      answer_authority: false,
    });

    const grant = await createRoomReadGrant({
      roomId: ROOM,
      ownerProfileId: OWNER,
      ownerParticipantId: OWNER_PARTICIPANT,
      connectionRef: CONNECTION,
      capabilityIds: [HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY],
      expiresInMinutes: 60,
      now: NOW,
    });
    expect(grant).toMatchObject({ status: "active", ready: true, member_count: 2 });

    const memberView = await listRoomSharedCapabilities({
      roomId: ROOM, requestingProfileId: MEMBER, requestingIsOwner: false, now: NOW,
    });
    expect(memberView.available_connections).toEqual([]);
    expect(memberView.grants[0]).toMatchObject({
      grant_ref: grant.grant_ref,
      owner_controls_visible: false,
      credential_included: false,
      private_endpoint_included: false,
      native_subject_included: false,
      hidden_reasoning_included: false,
      raw_content_included: false,
    });
    expect(JSON.stringify(memberView)).not.toContain("token_hash");
    expect(JSON.stringify(memberView)).not.toContain("management_url");

    const admitted = await authorizeAsMember();
    expect(admitted).toEqual({
      basis: "room_grant", grantRef: grant.grant_ref, policyRevision: 1,
    });
    const audit = await getPool().query(
      `SELECT outcome, turn_id, tool_call_id
       FROM helix_room_environment_capability_grant_audit;`,
    );
    expect(audit.rows).toEqual([{
      outcome: "admitted",
      turn_id: "turn:room-grant",
      tool_call_id: "tool_call:room-grant",
    }]);

    const revoked = await revokeRoomReadGrant({
      roomId: ROOM, ownerProfileId: OWNER, grantRef: grant.grant_ref, now: NOW,
    });
    expect(revoked).toMatchObject({ status: "revoked", ready: false });
    await expect(authorizeAsMember()).rejects.toMatchObject({
      code: "room_read_grant_not_found",
    } satisfies Partial<RoomReadGrantStoreError>);
    const underlying = await getPool().query(
      `SELECT status FROM helix_environment_connector_bindings
       WHERE environment_binding_id = $1;`,
      [CONNECTION],
    );
    expect(underlying.rows[0]).toEqual({ status: "active" });
  });

  it("accepts the active room-source credential used by the legacy connector bridge", async () => {
    await getPool().query(
      `UPDATE helix_environment_connector_devices
       SET credential_ref = $1
       WHERE device_id = $2;`,
      [SOURCE_CREDENTIAL, DEVICE],
    );

    const ownerView = await listRoomSharedCapabilities({
      roomId: ROOM, requestingProfileId: OWNER, requestingIsOwner: true, now: NOW,
    });
    expect(ownerView.available_connections[0]).toMatchObject({
      connection_ref: CONNECTION,
      blocking_reasons: [],
      ready: true,
      credential_included: false,
    });

    const deviceChecks = await listEnvironmentConnectorDeviceChecks({
      ownerProfileId: OWNER,
      roomId: ROOM,
      now: NOW,
    });
    expect(deviceChecks[0]).toMatchObject({
      device_id: DEVICE,
      credential_status: "active",
      probe_ready: true,
      blocking_reasons: [],
      credential_included: false,
      terminal_eligible: false,
    });

    const grant = await createRoomReadGrant({
      roomId: ROOM,
      ownerProfileId: OWNER,
      ownerParticipantId: OWNER_PARTICIPANT,
      connectionRef: CONNECTION,
      capabilityIds: [HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY],
      expiresInMinutes: 60,
      now: NOW,
    });
    expect(grant).toMatchObject({ status: "active", ready: true });
  });

  it("fails closed for mismatched identity, capability, epoch, and departed membership", async () => {
    await createRoomReadGrant({
      roomId: ROOM,
      ownerProfileId: OWNER,
      ownerParticipantId: OWNER_PARTICIPANT,
      connectionRef: CONNECTION,
      capabilityIds: [HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY],
      expiresInMinutes: 60,
      now: NOW,
    });
    for (const overrides of [
      { installedNodeRef: "connector_installation:wrong" },
      { capabilityId: "com.casimirbot.minecraft.unsupported.read" },
      { producerEpochRef: "producer_epoch:wrong" },
    ]) {
      await expect(authorizeAsMember(overrides)).rejects.toMatchObject({
        code: "room_read_grant_identity_mismatch",
      });
    }
    await getPool().query(
      `UPDATE helix_shared_realtime_room_members SET presence = 'left'
       WHERE room_id = $1 AND profile_id = $2;`,
      [ROOM, MEMBER],
    );
    await expect(authorizeAsMember()).rejects.toMatchObject({
      code: "room_read_grant_identity_mismatch",
    });
  });

  it("validates the owner's exact node, source, epoch, capability, and room membership", async () => {
    const exact = {
      roomId: ROOM,
      requestingProfileId: OWNER,
      requestingParticipantId: OWNER_PARTICIPANT,
      connectionOwnerProfileId: OWNER,
      connectionRef: CONNECTION,
      installedNodeRef: INSTALLED_NODE,
      sourceRef: SOURCE,
      producerEpochRef: EPOCH,
      capabilityId: HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY,
      turnId: "turn:owner-exact",
      toolCallId: "tool_call:owner-exact",
      now: NOW,
    } as const;
    await expect(authorizeRoomReadGrant(exact)).resolves.toEqual({
      basis: "connection_owner", grantRef: null, policyRevision: 1,
    });
    for (const override of [
      { installedNodeRef: "device:sha256:00000000000000000000000000000000" },
      { sourceRef: "source:wrong" },
      { producerEpochRef: "producer_epoch:wrong" },
      { capabilityId: "com.casimirbot.minecraft.unsupported.read" },
    ]) {
      await expect(authorizeRoomReadGrant({ ...exact, ...override })).rejects.toMatchObject({
        code: "room_read_grant_identity_mismatch",
      });
    }
  });

  it("admits two concurrent read-only chat turns without merging their audit identity", async () => {
    await createRoomReadGrant({
      roomId: ROOM,
      ownerProfileId: OWNER,
      ownerParticipantId: OWNER_PARTICIPANT,
      connectionRef: CONNECTION,
      capabilityIds: [HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY],
      expiresInMinutes: 60,
      now: NOW,
    });

    const [first, second] = await Promise.all([
      authorizeAsMember({
        turnId: "turn:chat-a",
        toolCallId: "tool_call:chat-a",
      }),
      authorizeAsMember({
        turnId: "turn:chat-b",
        toolCallId: "tool_call:chat-b",
      }),
    ]);

    expect(first.basis).toBe("room_grant");
    expect(second.basis).toBe("room_grant");
    expect(first.grantRef).toBe(second.grantRef);
    const audit = await getPool().query(
      `SELECT outcome, turn_id, tool_call_id
       FROM helix_room_environment_capability_grant_audit
       ORDER BY turn_id ASC;`,
    );
    expect(audit.rows).toEqual([
      {
        outcome: "admitted",
        turn_id: "turn:chat-a",
        tool_call_id: "tool_call:chat-a",
      },
      {
        outcome: "admitted",
        turn_id: "turn:chat-b",
        tool_call_id: "tool_call:chat-b",
      },
    ]);
  });

  it("serves one understandable owner/member share and revoke journey through the browser boundary", async () => {
    const app = routeApp();
    const owner = request.agent(app);
    const member = request.agent(app);
    await owner.post("/api/account/session/sign-in").send({
      profile_id: OWNER,
      display_name: "Harness owner",
      account_type: "developer",
    }).expect(200);
    await member.post("/api/account/session/sign-in").send({
      profile_id: MEMBER,
      display_name: "Room member",
      account_type: "developer",
    }).expect(200);

    const ownerBefore = await owner
      .get(`/api/agi/environment-connectors/rooms/${ROOM}/capability-grants`)
      .expect(200);
    expect(ownerBefore.body.available_connections).toHaveLength(1);
    expect(ownerBefore.body.grants).toEqual([]);

    const memberMutation = await sameOrigin(member
      .post(`/api/agi/environment-connectors/rooms/${ROOM}/capability-grants`))
      .send({
        connection_ref: CONNECTION,
        capability_ids: [HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY],
        expires_in_minutes: 60,
      })
      .expect(403);
    expect(memberMutation.body).toMatchObject({
      error: "shared_realtime_room_forbidden",
      credential_included: false,
      terminal_eligible: false,
    });

    const created = await sameOrigin(owner
      .post(`/api/agi/environment-connectors/rooms/${ROOM}/capability-grants`))
      .send({
        connection_ref: CONNECTION,
        capability_ids: [HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY],
        expires_in_minutes: 60,
      })
      .expect(201);
    expect(created.body).toMatchObject({
      ok: true,
      credential_included: false,
      private_endpoint_included: false,
      answer_authority: false,
      terminal_eligible: false,
      grant: {
        status: "active",
        action_class: "none",
        owner_controls_visible: true,
      },
    });

    const memberView = await member
      .get(`/api/agi/environment-connectors/rooms/${ROOM}/capability-grants`)
      .expect(200);
    expect(memberView.body.available_connections).toEqual([]);
    expect(memberView.body.grants).toHaveLength(1);
    expect(memberView.body.grants[0]).toMatchObject({
      grant_ref: created.body.grant.grant_ref,
      owner_controls_visible: false,
      credential_included: false,
      private_endpoint_included: false,
      mutation_authority: false,
      answer_authority: false,
      terminal_eligible: false,
    });

    await sameOrigin(member.delete(
      `/api/agi/environment-connectors/rooms/${ROOM}/capability-grants/${encodeURIComponent(created.body.grant.grant_ref)}`,
    )).expect(403);
    const revoked = await sameOrigin(owner.delete(
      `/api/agi/environment-connectors/rooms/${ROOM}/capability-grants/${encodeURIComponent(created.body.grant.grant_ref)}`,
    )).expect(200);
    expect(revoked.body.grant).toMatchObject({
      status: "revoked",
      ready: false,
    });

    const memberAfter = await member
      .get(`/api/agi/environment-connectors/rooms/${ROOM}/capability-grants`)
      .expect(200);
    expect(memberAfter.body).toMatchObject({
      grants: [{ status: "revoked", owner_controls_visible: false }],
      available_connections: [],
    });
    expect(JSON.stringify(memberAfter.body)).not.toMatch(
      /token_hash|management_url|bearer|private_key/i,
    );
  });
});
