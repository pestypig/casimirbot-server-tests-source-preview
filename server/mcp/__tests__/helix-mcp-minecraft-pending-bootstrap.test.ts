import crypto from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildHelixSharedRealtimeRoomsExperimentPolicy } from "@shared/helix-account-session";
import { HELIX_SHARED_LIVE_ROOM_READ_SCOPE } from "@shared/contracts/helix-shared-live-room-agent.v1";
import { HELIX_ENVIRONMENT_ACTION_WRITE_SCOPE } from "@shared/helix-environment-action";
import { getPool } from "../../db/client";
import type { HelixAgentApiPrincipal } from "../../services/helix-agent-api/types";
import { MinecraftLocalLifecycleError } from "../../services/environment-connectors/installations/minecraft-fabric-loopback-lifecycle";
import { listRoomEnvironmentProjections } from "../../services/environment-connectors/subjects";
import { createSharedRealtimeRoomSourceBindingWithoutCredential } from "../../services/helix-ask/realtime-room/source-link-store";
import {
  createSharedRealtimeRoomTestApp,
  resetSharedRealtimeRoomRouteTestState,
  signInSharedRealtimeRoomTestAgent,
} from "../../services/helix-ask/realtime-room/__tests__/route-harness";
import { createHelixMcpServer } from "../helix-mcp-server";

// Real room/source/authority stores and MCP handlers; only OS execution and
// installed-device trust are fixture ports. No real profile, consent or game.
describe("pending Fabric source workstation bootstrap through real stores", () => {
  beforeEach(async () => {
    vi.stubEnv("DATABASE_URL", "pg-mem://minecraft-pending-bootstrap-fixture");
    vi.stubEnv("HELIX_PUBLIC_ROOMS_EXPERIMENT", "1");
    await resetSharedRealtimeRoomRouteTestState();
  });
  afterEach(() => vi.unstubAllEnvs());

  const setup = async () => {
    const app = createSharedRealtimeRoomTestApp();
    const owner = await signInSharedRealtimeRoomTestAgent({ app,
      profileId: "profile:pending-bootstrap-owner", displayName: "Fixture owner",
      accountType: "developer" });
    const guest = await signInSharedRealtimeRoomTestAgent({ app,
      profileId: "profile:pending-bootstrap-guest", displayName: "Fixture guest",
      accountType: "developer" });
    const created = await owner.agent.post("/api/agi/realtime/rooms")
      .send({ title: "Pending bootstrap fixture" }).expect(201);
    const roomId = created.body.room.room_id as string;
    const source = await createSharedRealtimeRoomSourceBindingWithoutCredential({
      roomId, ownerProfileId: owner.profileId,
      domainAdapter: "minecraft.fabric_mod.v1", sourceLabel: "Fixture Fabric",
      worldId: "minecraft:local:pending-bootstrap-fixture",
    });
    const [projection] = await listRoomEnvironmentProjections({ roomId, profileId: owner.profileId });
    expect(projection.connection_status).toBe("missing");
    const launch = vi.fn(async () => {
      throw new MinecraftLocalLifecycleError("minecraft_loopback_server_not_listening", 503);
    });
    const trust = vi.fn(async () => ({ trusted: true, delegatedAccountSessionId: owner.sessionId }));
    const connect = async (profileId = owner.profileId) => {
      const policy = buildHelixSharedRealtimeRoomsExperimentPolicy("developer");
      const principal = { tenantId: "tenant:pending-bootstrap-fixture",
        issuer: "https://fixture.invalid", subjectId: profileId,
        accountProfileId: profileId, accountType: "developer",
        scopes: new Set([HELIX_SHARED_LIVE_ROOM_READ_SCOPE, HELIX_ENVIRONMENT_ACTION_WRITE_SCOPE]),
        tokenExpiresAt: "2099-01-01T00:00:00.000Z",
        accountContext: { session_id: owner.sessionId, profile_id: profileId,
          trusted_account_session: true, account_session: null, account_policy: policy },
      } as HelixAgentApiPrincipal;
      const server = createHelixMcpServer({ principal,
        desktopFullHarnessTrustReader: trust, minecraftLocalLifecycleRunner: launch });
      const client = new Client({ name: "pending-bootstrap-fixture", version: "1" }, { capabilities: {} });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await server.connect(st);
      await client.connect(ct);
      return { client, server };
    };
    const call = async (overrides: Record<string, unknown> = {}, profileId = owner.profileId) => {
      const { client, server } = await connect(profileId);
      try {
        return await client.callTool({ name: "helix_minecraft_local_lifecycle_launch",
          arguments: { room_id: roomId, environment_binding_id: projection.environment_binding_id,
            action_authority_id: null, operator_confirmation: true,
            request: { restart_client: false }, ...overrides } });
      } finally { await client.close(); await server.close(); }
    };
    return { owner, guest, roomId, source, projection, launch, trust, call };
  };

  const materializeExpiredFabricSource = async (f: Awaited<ReturnType<typeof setup>>) => {
    const db = getPool();
    const stamp = crypto.randomUUID();
    const source = (await db.query<{ source_id: string; world_id: string }>(
      "SELECT source_id, world_id FROM helix_room_source_bindings WHERE binding_id = $1",
      [f.source.binding_id],
    )).rows[0];
    const credentialId = `room_source_credential:stale-bootstrap:${stamp}`;
    const admissionId = `environment_adapter_admission:stale-bootstrap:${stamp}`;
    const packageId = `connector_package_version:stale-bootstrap:${stamp}`;
    const installationId = `connector_installation:stale-bootstrap:${stamp}`;
    const deviceId = `connector_device:stale-bootstrap:${stamp}`;
    const environmentBindingId = `environment_binding:stale-bootstrap:${stamp}`;
    await db.query(
      `INSERT INTO helix_room_source_credentials
         (credential_id, binding_id, token_hash, token_prefix, expires_at)
       VALUES ($1,$2,$3,'stale','2020-01-01T00:00:00.000Z')`,
      [credentialId, f.source.binding_id, `sha256:${"1".repeat(64)}`],
    );
    await db.query(
      `INSERT INTO helix_environment_adapter_admissions
         (admission_id, binding_id, credential_id, producer_epoch, room_id,
          source_id, world_id, domain_adapter, adapter_profile_id,
          adapter_profile_version, adapter_contract_hash, manifest_id,
          manifest_hash, source_family, status)
       VALUES ($1,$2,$3,'epoch:stale',$4,$5,$6,'minecraft.fabric_mod.v1',
         'minecraft.fabric_mod.v1',1,$7,'manifest:stale',$8,'minecraft','expired')`,
      [admissionId, f.source.binding_id, credentialId, f.roomId,
        source.source_id, source.world_id, `sha256:${"2".repeat(64)}`,
        `sha256:${"3".repeat(64)}`],
    );
    await db.query(
      `INSERT INTO helix_environment_connector_packages
         (package_version_id, publisher_id, package_id, package_version,
          content_hash, trust_classification, security_review_state)
       VALUES ($1,'publisher:casimirbot',$3,'1.0.0',$2,
         'first_party','approved')`,
      [packageId, `sha256:${crypto.createHash("sha256").update(stamp).digest("hex")}`,
        `com.casimirbot.fabric.${stamp}`],
    );
    await db.query(
      `INSERT INTO helix_environment_connector_installations
         (installation_id, owner_profile_id, package_version_id)
       VALUES ($1,$2,$3)`,
      [installationId, f.owner.profileId, packageId],
    );
    await db.query(
      `INSERT INTO helix_environment_connector_devices
         (device_id, installation_id, device_public_key_hash,
          health_status, last_contact_at)
       VALUES ($1,$2,$3,'offline','2020-01-01T00:00:00.000Z')`,
      [deviceId, installationId, `sha256:${"5".repeat(64)}`],
    );
    await db.query(
      `INSERT INTO helix_environment_connector_bindings
         (environment_binding_id, installation_id, device_id,
          room_source_binding_id, adapter_admission_id, owner_profile_id,
          room_id, source_id, world_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [environmentBindingId, installationId, deviceId, f.source.binding_id,
        admissionId, f.owner.profileId, f.roomId, source.source_id, source.world_id],
    );
    return { environmentBindingId, deviceId };
  };

  it("reaches the fixed executor with a pending source, without requiring an active environment", async () => {
    const fixture = await setup();
    const result = await fixture.call();
    // The next physical precondition is reported, rather than the old circular
    // action_environment_not_found failure. This is not a live launch claim.
    expect(result.structuredContent).toMatchObject({ error: "minecraft_loopback_server_not_listening",
      retryable: false, answer_authority: false, terminal_eligible: false });
    expect(fixture.launch).toHaveBeenCalledOnce();
    expect(fixture.launch).toHaveBeenCalledWith({ request: { address: "localhost:25565", restart_client: false },
      ownerProfileId: fixture.owner.profileId, allowServerStartup: true });
  });

  it.each(["forged", "wrong_room", "revoked_source", "non_fabric", "wrong_owner", "closed_room"])(
    "rejects %s without an OS effect", async (scenario) => {
      const f = await setup();
      const overrides: Record<string, unknown> = {};
      if (scenario === "forged") overrides.environment_binding_id = "environment_binding:pending:" + "a".repeat(40);
      if (scenario === "wrong_room") overrides.room_id = "shared_realtime_room:wrong-bootstrap-fixture";
      if (scenario === "revoked_source") await getPool().query(
        "UPDATE helix_room_source_bindings SET status = 'revoked' WHERE binding_id = $1", [f.source.binding_id]);
      if (scenario === "non_fabric") await getPool().query(
        "UPDATE helix_room_source_bindings SET domain_adapter = 'minecraft.paper_server.v1' WHERE binding_id = $1", [f.source.binding_id]);
      if (scenario === "closed_room") await getPool().query(
        "UPDATE helix_shared_realtime_rooms SET status = 'closed' WHERE room_id = $1", [f.roomId]);
      if (scenario === "wrong_owner") {
        const invite = await f.owner.agent.post(`/api/agi/realtime/rooms/${f.roomId}/invites`).expect(201);
        await f.guest.agent.post("/api/agi/realtime/rooms/join").send({ invite_code: invite.body.invite_code }).expect(200);
      }
      const result = await f.call(overrides, scenario === "wrong_owner" ? f.guest.profileId : f.owner.profileId);
      expect(result.isError).toBe(true);
      expect(f.launch).not.toHaveBeenCalled();
    });

  it("does not turn a pending source into player authority or restart permission", async () => {
    const f = await setup();
    for (const overrides of [
      { action_authority_id: "environment_action_authority:missing" },
      { request: { restart_client: true } },
    ]) {
      expect((await f.call(overrides)).isError).toBe(true);
    }
    expect(f.launch).not.toHaveBeenCalled();
  });

  it("rechecks saved device trust on every attempt", async () => {
    const f = await setup();
    await f.call();
    f.launch.mockClear();
    f.trust.mockResolvedValue({ trusted: false, delegatedAccountSessionId: f.owner.sessionId });
    const result = await f.call();
    expect(result.structuredContent).toMatchObject({ error: "account_policy_blocked" });
    expect(f.launch).not.toHaveBeenCalled();
  });

  it("allows trusted workstation startup for an existing Fabric source with expired admission", async () => {
    const f = await setup();
    const { environmentBindingId } = await materializeExpiredFabricSource(f);
    const result = await f.call({ environment_binding_id: environmentBindingId });
    expect(result.structuredContent).toMatchObject({
      error: "minecraft_loopback_server_not_listening", answer_authority: false,
    });
    expect(f.launch).toHaveBeenCalledOnce();
    expect((await f.call({ environment_binding_id: environmentBindingId,
      request: { restart_client: true } })).isError).toBe(true);
    expect(f.launch).toHaveBeenCalledOnce();
  });

  it.each(["wrong_owner", "revoked_source", "suspended_device", "forged_binding"])(
    "rejects an existing %s source before an OS effect", async (scenario) => {
      const f = await setup();
      const { environmentBindingId, deviceId } = await materializeExpiredFabricSource(f);
      if (scenario === "wrong_owner") {
        const invite = await f.owner.agent.post(`/api/agi/realtime/rooms/${f.roomId}/invites`).expect(201);
        await f.guest.agent.post("/api/agi/realtime/rooms/join")
          .send({ invite_code: invite.body.invite_code }).expect(200);
      }
      if (scenario === "revoked_source") await getPool().query(
        "UPDATE helix_room_source_bindings SET status='revoked' WHERE binding_id=$1",
        [f.source.binding_id]);
      if (scenario === "suspended_device") await getPool().query(
        "UPDATE helix_environment_connector_devices SET status='suspended' WHERE device_id=$1",
        [deviceId]);
      const result = await f.call({ environment_binding_id: scenario === "forged_binding"
        ? "environment_binding:forged" : environmentBindingId },
      scenario === "wrong_owner" ? f.guest.profileId : f.owner.profileId);
      expect(result.isError).toBe(true);
      expect(f.launch).not.toHaveBeenCalled();
    });
});
