import crypto from "node:crypto";
import { getPool } from "../../../../db/client";
import { environmentConnectorSha256 } from "../../catalog";
import { PRIVATE_CLOCK_PACKAGE_ID, type PrivateDirectoryAccess } from "../../directory/release-policy";
import { resolveEnvironmentAdapterProfile } from "../../../situation-room/environment-adapter-registry";
import { environmentConnectorPairingStartMessage, environmentConnectorPairingClaimMessage,
  startEnvironmentConnectorPairing, approveEnvironmentConnectorPairing, claimEnvironmentConnectorPairing } from "../service";

export const privateClock = {
  owner: "profile:private-clock", room: "shared_realtime_room:private-clock",
  binding: "room_source_binding:private-clock", source: "source:room-ingress:private-clock",
  credential: "room_source_credential:private-clock", world: "system:clock:private-clock",
  capability: "com.casimirbot.system.clock.read", now: new Date("2026-09-26T12:00:00Z"),
};
export const privateClockAccess: PrivateDirectoryAccess = {
  trustedAccountSession: true, accountType: "developer", profileId: privateClock.owner,
  loopback: true, featureEnabled: true,
};
export const signedPrivateClockStart = () => {
  const keys = crypto.generateKeyPairSync("ed25519");
  const nonce = crypto.randomBytes(24).toString("base64url");
  const message = environmentConnectorPairingStartMessage({
    packageVersionId: PRIVATE_CLOCK_PACKAGE_ID, deviceNonce: nonce,
    requestedCapabilityIds: [privateClock.capability],
    devicePublicKeyHash: environmentConnectorSha256({
      namespace: "helix_environment_connector_device_key.v1",
      spki_der_base64: keys.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    }),
  });
  return { keys, input: {
    packageVersionId: PRIVATE_CLOCK_PACKAGE_ID,
    devicePublicKeyPem: keys.publicKey.export({ format: "pem", type: "spki" }).toString(),
    deviceNonce: nonce, requestedCapabilityIds: [privateClock.capability],
    proofSignature: crypto.sign(null, Buffer.from(message), keys.privateKey).toString("base64url"),
    verificationUri: "http://localhost/private-pair", now: privateClock.now,
  } };
};

// This seeds an already-admitted source prerequisite; it does not prove UI
// consent, an installed clock runtime, or any ordinary-user onboarding.
export const seedPrivateClockSource = async () => {
  const db = getPool(); const c = privateClock;
  const adapter = resolveEnvironmentAdapterProfile({ domainAdapter: "system.clock.connector.v1", worldId: c.world });
  await db.query("INSERT INTO helix_accounts (profile_id, display_name, account_type, provider) VALUES ($1, 'Private clock owner', 'developer', 'local')", [c.owner]);
  await db.query("INSERT INTO helix_shared_realtime_rooms (room_id, owner_profile_id, title, status) VALUES ($1, $2, 'Clock', 'active')", [c.room, c.owner]);
  await db.query(`INSERT INTO helix_shared_realtime_room_members
    (room_id, slot_number, profile_id, participant_id, member_role, presence, consent)
    VALUES ($1, 1, $2, 'participant:private-clock', 'owner', 'present', '{}'::jsonb)`, [c.room, c.owner]);
  await db.query(`UPDATE helix_shared_realtime_room_members SET consent = '{"consent_version":1,"consent_receipt_ref":"consent:private-clock"}'::jsonb WHERE room_id = $1`, [c.room]);
  await db.query(`INSERT INTO helix_room_source_bindings
    (binding_id, room_id, owner_profile_id, source_id, world_id, domain_adapter, source_label, scopes)
    VALUES ($1, $2, $3, $4, $5, 'system.clock.connector.v1', 'Clock', $6::jsonb)`,
    [c.binding, c.room, c.owner, c.source, c.world, JSON.stringify(["manifest:write", "heartbeat:write", "probe_requests:read", "probe_results:write"])]);
  await db.query(`INSERT INTO helix_room_source_credentials (credential_id, binding_id, token_hash, token_prefix, expires_at)
    VALUES ($1, $2, $3, 'fixture', '2099-01-01T00:00:00Z')`, [c.credential, c.binding, crypto.randomBytes(32).toString("hex")]);
  await db.query(`INSERT INTO helix_environment_adapter_admissions
    (admission_id, binding_id, credential_id, producer_epoch, room_id, source_id, world_id, domain_adapter,
     adapter_profile_id, adapter_profile_version, adapter_contract_hash, manifest_id, manifest_hash, source_family, mechanics_collection_ids)
    VALUES ('environment_adapter_admission:private-clock', $1, $2, 'private-clock-epoch', $3, $4, $5, 'system.clock.connector.v1',
      $6, $7, $8, 'manifest:private-clock', $9, $10, '[]'::jsonb)`,
    [c.binding, c.credential, c.room, c.source, c.world, adapter.profile.profile_id, adapter.profile.profile_version,
      adapter.contract_hash, `sha256:${"a".repeat(64)}`, adapter.profile.source_family]);
};

export const pairPrivateClock = async () => {
  const { keys, input } = signedPrivateClockStart();
  const started = await startEnvironmentConnectorPairing({ ...input, privateAccess: privateClockAccess });
  await approveEnvironmentConnectorPairing({ userCode: started.session.user_code, ownerProfileId: privateClock.owner,
    roomId: privateClock.room, roomSourceBindingId: privateClock.binding,
    approvedCapabilityIds: [privateClock.capability], now: privateClock.now });
  return claimEnvironmentConnectorPairing({ pairingSessionId: started.session.pairing_session_id,
    claimChallenge: started.claimChallenge, now: privateClock.now,
    proofSignature: crypto.sign(null, Buffer.from(environmentConnectorPairingClaimMessage({
      pairingSessionId: started.session.pairing_session_id, claimChallenge: started.claimChallenge,
    })), keys.privateKey).toString("base64url"),
  });
};
