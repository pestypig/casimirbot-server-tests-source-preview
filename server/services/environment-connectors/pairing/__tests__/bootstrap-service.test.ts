import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureDatabase, getPool, resetDbClient } from "../../../../db/client";
import {
  ConnectorBootstrapPairingError,
  createConnectorBootstrapPairing,
  createOrRecoverReadOnlyFabricSourcePairing,
  redeemConnectorBootstrapPairing,
  unpairConnectorBootstrapBinding,
} from "../bootstrap-service";

const PROFILE_ID = "profile:bootstrap-pairing-owner";
const ROOM_ID = "shared_realtime_room:bootstrap-pairing";

const sourcePluginConfig = (
  config: Awaited<ReturnType<typeof redeemConnectorBootstrapPairing>>["pluginConfig"],
) => {
  if (!("bearer_token" in config)) {
    throw new Error("Expected a source pairing configuration.");
  }
  return config;
};

const seed = async (): Promise<void> => {
  await ensureDatabase();
  const db = getPool();
  await db.query(
    `
      INSERT INTO helix_accounts (
        profile_id, display_name, account_type, provider
      ) VALUES ($1, 'Pairing owner', 'developer', 'local');
    `,
    [PROFILE_ID],
  );
  await db.query(
    `
      INSERT INTO helix_shared_realtime_rooms (
        room_id, owner_profile_id, title, status
      ) VALUES ($1, $2, 'Pairing room', 'active');
    `,
    [ROOM_ID, PROFILE_ID],
  );
};

describe("connector bootstrap pairing", () => {
  beforeEach(async () => {
    vi.stubEnv(
      "DATABASE_URL",
      `pg-mem://connector-bootstrap-pairing-${crypto.randomUUID()}`,
    );
    vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "0");
    vi.stubEnv("CASIMIR_PUBLIC_BASE_URL", "http://localhost:5050");
    await resetDbClient();
    await seed();
  });

  afterEach(async () => {
    await resetDbClient();
    vi.unstubAllEnvs();
  });

  it("replaces a revoked Fabric sensing binding in the same room and world without action credentials", async () => {
    const original = await createConnectorBootstrapPairing({
      roomId: ROOM_ID,
      ownerProfileId: PROFILE_ID,
      purpose: "create",
      worldId: "minecraft:peaceful-recovery-test",
      domainAdapter: "minecraft.fabric_mod.v1",
      sourceLabel: "Saved Fabric server",
      idempotencyKey: "pairing-recovery-original",
    });
    const redeemed = await redeemConnectorBootstrapPairing({
      pairingCode: original.pairingCode,
      redemptionNonce: crypto.randomBytes(32).toString("base64url"),
      domainAdapter: "minecraft.fabric_mod.v1",
      connectorKind: "minecraft.fabric_mod.v1",
      connectorVersion: "0.1.0",
      pairingEndpoint: "http://localhost:1522/api/environment-connectors/v1/pairing/redeem",
    });
    await unpairConnectorBootstrapBinding({
      bindingId: redeemed.binding.binding_id,
      bearerToken: sourcePluginConfig(redeemed.pluginConfig).bearer_token,
    });
    const recovered = await createOrRecoverReadOnlyFabricSourcePairing({
      roomId: ROOM_ID,
      ownerProfileId: PROFILE_ID,
      bindingId: redeemed.binding.binding_id,
      credentialTtlMs: 3_600_000,
      idempotencyKey: "pairing-recovery-replacement",
    });
    expect(recovered.pairing.binding_id).not.toBe(redeemed.binding.binding_id);
    expect(recovered.pairing).toMatchObject({
      purpose: "create",
      domain_adapter: "minecraft.fabric_mod.v1",
      command_credential_requested: false,
      action_credential_requested: false,
    });
    const replay = await createOrRecoverReadOnlyFabricSourcePairing({
      roomId: ROOM_ID,
      ownerProfileId: PROFILE_ID,
      bindingId: redeemed.binding.binding_id,
      credentialTtlMs: 3_600_000,
      idempotencyKey: "pairing-recovery-replacement",
    });
    expect(replay.pairing.binding_id).toBe(recovered.pairing.binding_id);
    const replacement = await redeemConnectorBootstrapPairing({
      pairingCode: recovered.pairingCode,
      redemptionNonce: crypto.randomBytes(32).toString("base64url"),
      domainAdapter: "minecraft.fabric_mod.v1",
      connectorKind: "minecraft.fabric_mod.v1",
      connectorVersion: "0.1.0",
      pairingEndpoint: "http://localhost:1522/api/environment-connectors/v1/pairing/redeem",
    });
    expect(replacement.binding).toMatchObject({
      room_id: ROOM_ID,
      world_id: "minecraft:peaceful-recovery-test",
      domain_adapter: "minecraft.fabric_mod.v1",
      status: "active",
    });
  });

  it("creates, idempotently redeems, rotates, and self-revokes a canonical source binding", async () => {
    const created = await createConnectorBootstrapPairing({
      roomId: ROOM_ID,
      ownerProfileId: PROFILE_ID,
      purpose: "create",
      domainAdapter: "minecraft.fabric_mod.v1",
      sourceLabel: "Fabric test source",
      idempotencyKey: "pairing-create-idempotency-one",
    });
    expect(created.pairing).toMatchObject({
      schema: "helix.connector_pairing.v1",
      status: "pending",
      domain_adapter: "minecraft.fabric_mod.v1",
      code_included: false,
      credential_included: false,
      assistant_answer: false,
    });
    expect(created.pairingCode).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);

    const replayedCreate = await createConnectorBootstrapPairing({
      roomId: ROOM_ID,
      ownerProfileId: PROFILE_ID,
      purpose: "create",
      domainAdapter: "minecraft.fabric_mod.v1",
      sourceLabel: "Fabric test source",
      idempotencyKey: "pairing-create-idempotency-one",
    });
    expect(replayedCreate.pairing.pairing_id).toBe(created.pairing.pairing_id);
    expect(replayedCreate.pairingCode).toBe(created.pairingCode);

    const nonce = crypto.randomBytes(32).toString("base64url");
    const redeemed = await redeemConnectorBootstrapPairing({
      pairingCode: created.pairingCode,
      redemptionNonce: nonce,
      domainAdapter: "minecraft.fabric_mod.v1",
      connectorKind: "minecraft.fabric_mod.v1",
      connectorVersion: "0.1.0",
      pairingEndpoint:
        "http://localhost:1522/api/environment-connectors/v1/pairing/redeem",
    });
    expect(redeemed).toMatchObject({
      pairingId: created.pairing.pairing_id,
      replayed: false,
      pluginConfig: {
        domain_adapter: "minecraft.fabric_mod.v1",
        execution_enabled: false,
      },
    });
    expect(redeemed.binding.public_ingress_base_url).toContain(
      "http://localhost:5050",
    );
    const redeemedConfig = sourcePluginConfig(redeemed.pluginConfig);
    expect(redeemedConfig.endpoint).toBe(
      `http://localhost:1522/api/room-ingress/v1/bindings/${encodeURIComponent(
        redeemed.binding.binding_id,
      )}`,
    );
    expect(redeemedConfig.bearer_token).toMatch(/^helix_room_src_/);

    const idempotentReplay = await redeemConnectorBootstrapPairing({
      pairingCode: created.pairingCode,
      redemptionNonce: nonce,
      domainAdapter: "minecraft.fabric_mod.v1",
      connectorKind: "minecraft.fabric_mod.v1",
      connectorVersion: "0.1.0",
      pairingEndpoint:
        "http://localhost:1522/api/environment-connectors/v1/pairing/redeem",
    });
    expect(idempotentReplay.replayed).toBe(true);
    const replayedConfig = sourcePluginConfig(idempotentReplay.pluginConfig);
    expect(replayedConfig.bearer_token).toBe(
      redeemedConfig.bearer_token,
    );

    await expect(
      redeemConnectorBootstrapPairing({
        pairingCode: created.pairingCode,
        redemptionNonce: crypto.randomBytes(32).toString("base64url"),
        domainAdapter: "minecraft.fabric_mod.v1",
        connectorKind: "minecraft.fabric_mod.v1",
        connectorVersion: "0.1.0",
        pairingEndpoint:
          "https://helix.example.test/api/environment-connectors/v1/pairing/redeem",
      }),
    ).rejects.toBeInstanceOf(ConnectorBootstrapPairingError);

    const rotated = await createConnectorBootstrapPairing({
      roomId: ROOM_ID,
      ownerProfileId: PROFILE_ID,
      purpose: "rotate",
      bindingId: redeemed.binding.binding_id,
      domainAdapter: "minecraft.fabric_mod.v1",
      idempotencyKey: "pairing-rotate-idempotency-one",
    });
    const rotatedRedemption = await redeemConnectorBootstrapPairing({
      pairingCode: rotated.pairingCode,
      redemptionNonce: crypto.randomBytes(32).toString("base64url"),
      domainAdapter: "minecraft.fabric_mod.v1",
      connectorKind: "minecraft.fabric_mod.v1",
      connectorVersion: "0.1.0",
      pairingEndpoint:
        "https://helix.example.test/api/environment-connectors/v1/pairing/redeem",
    });
    expect(rotatedRedemption.binding.binding_id).toBe(
      redeemed.binding.binding_id,
    );
    const rotatedConfig = sourcePluginConfig(rotatedRedemption.pluginConfig);
    expect(rotatedConfig.bearer_token).not.toBe(
      redeemedConfig.bearer_token,
    );

    await expect(
      unpairConnectorBootstrapBinding({
        bindingId: redeemed.binding.binding_id,
        bearerToken: redeemedConfig.bearer_token,
      }),
    ).rejects.toMatchObject({ code: "room_source_credential_expired" });
    const revoked = await unpairConnectorBootstrapBinding({
      bindingId: redeemed.binding.binding_id,
      bearerToken: rotatedConfig.bearer_token,
    });
    expect(revoked.status).toBe("revoked");

    const dbText = JSON.stringify(
      (
        await getPool().query(
          "SELECT * FROM helix_connector_pairing_codes ORDER BY created_at;",
        )
      ).rows,
    );
    expect(dbText).not.toContain(created.pairingCode);
    expect(dbText).not.toContain(redeemedConfig.bearer_token);
    expect(dbText).not.toContain(rotatedConfig.bearer_token);
  });

  it("revokes an expired unredeemed create binding before issuing its replacement", async () => {
    const stale = await createConnectorBootstrapPairing({
      roomId: ROOM_ID,
      ownerProfileId: PROFILE_ID,
      purpose: "create",
      domainAdapter: "minecraft.fabric_mod.v1",
      sourceLabel: "Expired Fabric source",
      idempotencyKey: "pairing-expired-create-one",
    });
    const db = getPool();
    await db.query(
      `
        UPDATE helix_connector_pairing_codes
        SET expires_at = '2000-01-01T00:00:00.000Z'
        WHERE pairing_id = $1;
      `,
      [stale.pairing.pairing_id],
    );

    const replacement = await createConnectorBootstrapPairing({
      roomId: ROOM_ID,
      ownerProfileId: PROFILE_ID,
      purpose: "create",
      domainAdapter: "minecraft.fabric_mod.v1",
      sourceLabel: "Replacement Fabric source",
      idempotencyKey: "pairing-expired-create-two",
    });

    expect(replacement.pairing.status).toBe("pending");
    expect(
      (
        await db.query<{ status: string }>(
          `SELECT status FROM helix_room_source_bindings WHERE binding_id = $1;`,
          [stale.pairing.binding_id],
        )
      ).rows[0]?.status,
    ).toBe("revoked");
  });
});
