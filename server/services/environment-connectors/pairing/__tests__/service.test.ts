import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY } from "@shared/helix-environment-connector";
import { ensureDatabase, getPool, resetDbClient } from "../../../../db/client";
import { readBuiltinEnvironmentConnectorPackage } from "../../catalog";
import { projectEnvironmentAdapterProducerEpoch } from "../../../situation-room/environment-adapter-admission-store";
import { resolveEnvironmentAdapterProfile } from "../../../situation-room/environment-adapter-registry";
import {
  approveEnvironmentConnectorPairing,
  authenticateEnvironmentConnectorDevice,
  claimEnvironmentConnectorPairing,
  EnvironmentConnectorPairingError,
  environmentConnectorPairingClaimMessage,
  environmentConnectorPairingStartMessage,
  revokeEnvironmentConnectorDevice,
  rotateEnvironmentConnectorDeviceCredential,
  startEnvironmentConnectorPairing,
} from "../service";
import { environmentConnectorSha256 } from "../../catalog";
import { listPublicEnvironmentConnectorDirectory } from "../../directory";
import { listActiveEnvironmentConnectorBindings } from "../../bindings";

const PROFILE_ID = "profile:pairing-owner";
const ROOM_ID = "shared_realtime_room:pairing";
const BINDING_ID = "room_source_binding:pairing";
const CREDENTIAL_ID = "room_source_credential:pairing";
const SOURCE_ID = "source:room-ingress:pairing";
const WORLD_ID = "minecraft:minehut:pairing";
const ADMISSION_ID = "environment_adapter_admission:pairing";
const PRODUCER_EPOCH = "pairing-producer-epoch";
const PACKAGE_ID =
  "connector_package_version:com.casimirbot.minecraft.paper:1.1.0";

const seed = async (): Promise<void> => {
  await ensureDatabase();
  const db = getPool();
  const record = resolveEnvironmentAdapterProfile({
    domainAdapter: "minecraft.minehut.v1",
    worldId: WORLD_ID,
  });
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
  await db.query(
    `
      INSERT INTO helix_shared_realtime_room_members (
        room_id, slot_number, profile_id, participant_id, member_role,
        presence, consent
      ) VALUES ($1, 1, $2, 'participant:pairing-owner', 'owner', 'present', '{}'::jsonb);
    `,
    [ROOM_ID, PROFILE_ID],
  );
  await db.query(
    `
      INSERT INTO helix_room_source_bindings (
        binding_id, room_id, owner_profile_id, source_id, world_id,
        domain_adapter, source_label, scopes
      ) VALUES ($1, $2, $3, $4, $5, $6, 'Pairing source', $7::jsonb);
    `,
    [
      BINDING_ID,
      ROOM_ID,
      PROFILE_ID,
      SOURCE_ID,
      WORLD_ID,
      "minecraft.minehut.v1",
      JSON.stringify([
        "manifest:write",
        "heartbeat:write",
        "probe_requests:read",
        "probe_results:write",
      ]),
    ],
  );
  await db.query(
    `
      INSERT INTO helix_room_source_credentials (
        credential_id, binding_id, token_hash, token_prefix, expires_at
      ) VALUES ($1, $2, $3, 'legacy-prefix', '2099-01-01T00:00:00.000Z');
    `,
    [CREDENTIAL_ID, BINDING_ID, crypto.randomBytes(32).toString("hex")],
  );
  await db.query(
    `
      INSERT INTO helix_environment_adapter_admissions (
        admission_id, binding_id, credential_id, producer_epoch, room_id,
        source_id, world_id, domain_adapter, adapter_profile_id,
        adapter_profile_version, adapter_contract_hash, manifest_id,
        manifest_hash, source_family, mechanics_collection_ids
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15::jsonb
      );
    `,
    [
      ADMISSION_ID,
      BINDING_ID,
      CREDENTIAL_ID,
      PRODUCER_EPOCH,
      ROOM_ID,
      SOURCE_ID,
      WORLD_ID,
      "minecraft.minehut.v1",
      record.profile.profile_id,
      record.profile.profile_version,
      record.contract_hash,
      "manifest:pairing",
      `sha256:${"a".repeat(64)}`,
      record.profile.source_family,
      JSON.stringify(
        record.profile.mechanics_collections.map(
          (entry) => entry.collection_id,
        ),
      ),
    ],
  );
};

const keyIdentity = (publicKey: crypto.KeyObject): `sha256:${string}` => {
  const der = publicKey.export({ format: "der", type: "spki" });
  return environmentConnectorSha256({
    namespace: "helix_environment_connector_device_key.v1",
    spki_der_base64: der.toString("base64"),
  });
};

describe("environment connector public-key pairing", () => {
  beforeEach(async () => {
    vi.stubEnv(
      "DATABASE_URL",
      `pg-mem://connector-pairing-${crypto.randomUUID()}`,
    );
    vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "0");
    await resetDbClient();
    await seed();
  });

  afterEach(async () => {
    await resetDbClient();
    vi.unstubAllEnvs();
  });

  it("proves device possession, grants only approved probes, delivers one credential, rotates, and revokes", async () => {
    const packageRecord = readBuiltinEnvironmentConnectorPackage(PACKAGE_ID);
    expect(packageRecord).not.toBeNull();
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey
      .export({ format: "pem", type: "spki" })
      .toString();
    const deviceNonce = crypto.randomBytes(24).toString("base64url");
    const startMessage = environmentConnectorPairingStartMessage({
      packageVersionId: PACKAGE_ID,
      deviceNonce,
      requestedCapabilityIds: [HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY],
      devicePublicKeyHash: keyIdentity(publicKey),
    });
    const started = await startEnvironmentConnectorPairing({
      packageVersionId: PACKAGE_ID,
      devicePublicKeyPem: publicKeyPem,
      deviceNonce,
      requestedCapabilityIds: [HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY],
      proofSignature: crypto
        .sign(null, Buffer.from(startMessage, "utf8"), privateKey)
        .toString("base64url"),
      verificationUri: "https://helix.example.test/pair",
    });
    expect(started.session).toMatchObject({
      status: "pending",
      credential_included: false,
      requested_capability_ids: [HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY],
    });

    await expect(
      approveEnvironmentConnectorPairing({
        userCode: started.session.user_code,
        ownerProfileId: "profile:other-owner",
        roomId: ROOM_ID,
        roomSourceBindingId: BINDING_ID,
        approvedCapabilityIds: [HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY],
      }),
    ).rejects.toMatchObject({
      code: "pairing_binding_unavailable",
    });
    await expect(
      approveEnvironmentConnectorPairing({
        userCode: started.session.user_code,
        ownerProfileId: PROFILE_ID,
        roomId: "shared_realtime_room:other-room",
        roomSourceBindingId: BINDING_ID,
        approvedCapabilityIds: [HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY],
      }),
    ).rejects.toMatchObject({
      code: "pairing_binding_unavailable",
    });

    const approved = await approveEnvironmentConnectorPairing({
      userCode: started.session.user_code,
      ownerProfileId: PROFILE_ID,
      roomId: ROOM_ID,
      roomSourceBindingId: BINDING_ID,
      approvedCapabilityIds: [HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY],
    });
    const claimMessage = environmentConnectorPairingClaimMessage({
      pairingSessionId: started.session.pairing_session_id,
      claimChallenge: started.claimChallenge,
    });
    const claimed = await claimEnvironmentConnectorPairing({
      pairingSessionId: started.session.pairing_session_id,
      claimChallenge: started.claimChallenge,
      proofSignature: crypto
        .sign(null, Buffer.from(claimMessage, "utf8"), privateKey)
        .toString("base64url"),
    });
    expect(claimed.installationId).toBe(approved.installationId);
    expect(claimed.catalogSnapshot.capability_descriptors).toHaveLength(1);
    expect(claimed.deviceCredential).toMatch(/^helix_env_device_/);

    const db = getPool();
    const persisted = await db.query<{
      token_hash: string;
      token_prefix: string;
      producer_epoch_ref: string;
    }>(
      `
        SELECT c.token_hash, c.token_prefix, d.producer_epoch_ref
        FROM helix_environment_connector_device_credentials c
        JOIN helix_environment_connector_devices d
          ON d.device_id = c.device_id
        WHERE c.device_id = $1;
      `,
      [claimed.deviceId],
    );
    expect(persisted.rows[0].token_hash).not.toContain(
      claimed.deviceCredential,
    );
    expect(persisted.rows[0].token_prefix).not.toBe(claimed.deviceCredential);
    expect(persisted.rows[0].producer_epoch_ref).toBe(
      projectEnvironmentAdapterProducerEpoch({
        bindingId: BINDING_ID,
        producerEpoch: PRODUCER_EPOCH,
      }),
    );

    const authenticated = await authenticateEnvironmentConnectorDevice({
      bearerToken: claimed.deviceCredential,
      requiredScope: "probe.poll",
    });
    expect(authenticated).toMatchObject({
      deviceId: claimed.deviceId,
      environmentBindingId: claimed.environmentBindingId,
      capabilityIds: [HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY],
    });
    const activeBindings = await listActiveEnvironmentConnectorBindings({
      ownerProfileId: PROFILE_ID,
      roomId: ROOM_ID,
      roomSourceBindingId: BINDING_ID,
      sourceId: SOURCE_ID,
      adapterAdmissionId: ADMISSION_ID,
      adapterContractHash: authenticated.admission.adapter_contract_hash,
      manifestHash: authenticated.admission.manifest_hash,
      producerEpochRef: authenticated.admission.producer_epoch_ref,
      capabilityId: HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY,
    });
    expect(activeBindings).toMatchObject([
      {
        deviceId: claimed.deviceId,
        environmentBindingId: claimed.environmentBindingId,
      },
    ]);

    await expect(
      claimEnvironmentConnectorPairing({
        pairingSessionId: started.session.pairing_session_id,
        claimChallenge: started.claimChallenge,
        proofSignature: crypto
          .sign(null, Buffer.from(claimMessage, "utf8"), privateKey)
          .toString("base64url"),
      }),
    ).rejects.toMatchObject({
      code: "pairing_session_already_claimed",
    } satisfies Partial<EnvironmentConnectorPairingError>);

    const rotated = await rotateEnvironmentConnectorDeviceCredential({
      ownerProfileId: PROFILE_ID,
      deviceId: claimed.deviceId,
    });
    expect(rotated.credential).not.toBe(claimed.deviceCredential);
    await expect(
      authenticateEnvironmentConnectorDevice({
        bearerToken: claimed.deviceCredential,
        requiredScope: "probe.poll",
      }),
    ).rejects.toMatchObject({ code: "device_revoked" });
    await expect(
      authenticateEnvironmentConnectorDevice({
        bearerToken: rotated.credential,
        requiredScope: "probe.result",
      }),
    ).resolves.toMatchObject({ deviceId: claimed.deviceId });

    await revokeEnvironmentConnectorDevice({
      ownerProfileId: PROFILE_ID,
      deviceId: claimed.deviceId,
    });
    await expect(
      authenticateEnvironmentConnectorDevice({
        bearerToken: rotated.credential,
        requiredScope: "probe.poll",
      }),
    ).rejects.toMatchObject({ code: "device_revoked" });
  });

  it("rejects a signature from a different key and does not create a session", async () => {
    const trusted = crypto.generateKeyPairSync("ed25519");
    const attacker = crypto.generateKeyPairSync("ed25519");
    const nonce = crypto.randomBytes(24).toString("base64url");
    const message = environmentConnectorPairingStartMessage({
      packageVersionId: PACKAGE_ID,
      deviceNonce: nonce,
      requestedCapabilityIds: [HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY],
      devicePublicKeyHash: keyIdentity(trusted.publicKey),
    });
    await expect(
      startEnvironmentConnectorPairing({
        packageVersionId: PACKAGE_ID,
        devicePublicKeyPem: trusted.publicKey
          .export({ format: "pem", type: "spki" })
          .toString(),
        deviceNonce: nonce,
        requestedCapabilityIds: [HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY],
        proofSignature: crypto
          .sign(null, Buffer.from(message, "utf8"), attacker.privateKey)
          .toString("base64url"),
        verificationUri: "https://helix.example.test/pair",
      }),
    ).rejects.toMatchObject({ code: "pairing_proof_invalid" });
    const rows = await getPool().query<{ count: number | string }>(
      `SELECT count(*) AS count FROM helix_environment_pairing_sessions;`,
    );
    expect(Number(rows.rows[0]?.count ?? 0)).toBe(0);
  });

  it("rate-limits active sessions per device key and expires short-lived pairing codes", async () => {
    const key = crypto.generateKeyPairSync("ed25519");
    const publicKeyPem = key.publicKey
      .export({ format: "pem", type: "spki" })
      .toString();
    const startForNonce = (deviceNonce: string, now?: Date) => {
      const message = environmentConnectorPairingStartMessage({
        packageVersionId: PACKAGE_ID,
        deviceNonce,
        requestedCapabilityIds: [HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY],
        devicePublicKeyHash: keyIdentity(key.publicKey),
      });
      return startEnvironmentConnectorPairing({
        packageVersionId: PACKAGE_ID,
        devicePublicKeyPem: publicKeyPem,
        deviceNonce,
        requestedCapabilityIds: [HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY],
        proofSignature: crypto
          .sign(null, Buffer.from(message, "utf8"), key.privateKey)
          .toString("base64url"),
        verificationUri: "https://helix.example.test/pair",
        now,
      });
    };

    for (let index = 0; index < 5; index += 1) {
      await expect(
        startForNonce(`pairing-rate-limit-nonce-${index}`),
      ).resolves.toMatchObject({
        session: {
          status: "pending",
          credential_included: false,
        },
      });
    }
    await expect(
      startForNonce("pairing-rate-limit-nonce-overflow"),
    ).rejects.toMatchObject({
      code: "pairing_rate_limited",
      statusCode: 429,
    });

    const expiringKey = crypto.generateKeyPairSync("ed25519");
    const createdAt = new Date("2026-07-27T14:00:00.000Z");
    const expiringNonce = "pairing-expiry-nonce-0001";
    const expiringMessage = environmentConnectorPairingStartMessage({
      packageVersionId: PACKAGE_ID,
      deviceNonce: expiringNonce,
      requestedCapabilityIds: [HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY],
      devicePublicKeyHash: keyIdentity(expiringKey.publicKey),
    });
    const expiring = await startEnvironmentConnectorPairing({
      packageVersionId: PACKAGE_ID,
      devicePublicKeyPem: expiringKey.publicKey
        .export({ format: "pem", type: "spki" })
        .toString(),
      deviceNonce: expiringNonce,
      requestedCapabilityIds: [HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY],
      proofSignature: crypto
        .sign(null, Buffer.from(expiringMessage, "utf8"), expiringKey.privateKey)
        .toString("base64url"),
      verificationUri: "https://helix.example.test/pair",
      now: createdAt,
    });
    await expect(
      approveEnvironmentConnectorPairing({
        userCode: expiring.session.user_code,
        ownerProfileId: PROFILE_ID,
        roomId: ROOM_ID,
        roomSourceBindingId: BINDING_ID,
        approvedCapabilityIds: [HELIX_MINECRAFT_INVENTORY_CHECK_CAPABILITY],
        now: new Date(createdAt.getTime() + 10 * 60 * 1_000 + 1),
      }),
    ).rejects.toMatchObject({
      code: "pairing_session_expired",
      statusCode: 410,
    });
  });

  it("publishes immutable package trust without installations, devices, rooms, or evidence", async () => {
    const directory = await listPublicEnvironmentConnectorDirectory();
    expect(directory).toHaveLength(5);
    expect(directory.map((entry) => entry.package_id)).toEqual([
      "com.casimirbot.minecraft.fabric",
      "com.casimirbot.minecraft.fabric-player",
      "com.casimirbot.minecraft.paper",
      "com.casimirbot.synthetic.fixture",
      "com.casimirbot.system.clock",
    ]);
    const projection = JSON.stringify(directory);
    expect(projection).not.toContain(PROFILE_ID);
    expect(projection).not.toContain(ROOM_ID);
    expect(projection).not.toContain(BINDING_ID);
    expect(projection).not.toContain(CREDENTIAL_ID);
    for (const entry of directory) {
      expect(entry).toMatchObject({
        private_installation_data_included: false,
        user_evidence_included: false,
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
        trust: {
          runtime_connection_health: "not_a_directory_claim",
          observation_quality: "not_a_directory_claim",
        },
      });
    }
  });
});
