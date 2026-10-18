import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureDatabase, getPool, resetDbClient } from "../../../../db/client";
import { PRIVATE_CLOCK_PACKAGE_ID, PRIVATE_DIRECTORY_POLICY_REVISION } from "../../directory/release-policy";
import {
  approveEnvironmentConnectorPairing, authenticateEnvironmentConnectorDevice, claimEnvironmentConnectorPairing,
  environmentConnectorPairingClaimMessage, revokeEnvironmentConnectorDevice,
  rotateEnvironmentConnectorDeviceCredential, startEnvironmentConnectorPairing,
} from "../service";
import { privateClock as c, privateClockAccess, seedPrivateClockSource, signedPrivateClockStart } from "./private-policy-fixture";

const begin = async (privateMode = true) => {
  const { keys, input } = signedPrivateClockStart();
  const started = await startEnvironmentConnectorPairing({ ...input, ...(privateMode ? { privateAccess: privateClockAccess } : {}) });
  const approval = { userCode: started.session.user_code, ownerProfileId: c.owner, roomId: c.room,
    roomSourceBindingId: c.binding, approvedCapabilityIds: [c.capability], now: c.now };
  const claim = { pairingSessionId: started.session.pairing_session_id, claimChallenge: started.claimChallenge,
    proofSignature: crypto.sign(null, Buffer.from(environmentConnectorPairingClaimMessage({
      pairingSessionId: started.session.pairing_session_id, claimChallenge: started.claimChallenge,
    })), keys.privateKey).toString("base64url"), now: c.now };
  return { started, approval, claim };
};
const paired = async (privateMode = true) => {
  const pending = await begin(privateMode);
  await approveEnvironmentConnectorPairing(pending.approval);
  return claimEnvironmentConnectorPairing(pending.claim);
};
const withdraw = () => getPool().query("UPDATE helix_environment_connector_packages SET lifecycle_status = 'withdrawn', withdrawn_at = NOW() WHERE package_version_id = $1", [PRIVATE_CLOCK_PACKAGE_ID]);

describe("private package pairing and device policy", () => {
  beforeEach(async () => {
    vi.stubEnv("DATABASE_URL", `pg-mem://private-package-${crypto.randomUUID()}`);
    vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "0"); vi.stubEnv("HELIX_PRIVATE_ENVIRONMENT_HOME", "1");
    await resetDbClient(); await ensureDatabase(); await seedPrivateClockSource();
  });
  afterEach(async () => { await resetDbClient(); vi.unstubAllEnvs(); });

  it("retains the exact owner/revision through pending, approval and possession-proven transport", async () => {
    const { started, approval, claim } = await begin();
    const pending = await getPool().query("SELECT private_policy_revision, private_owner_profile_id FROM helix_environment_pairing_sessions WHERE pairing_session_id = $1", [started.session.pairing_session_id]);
    expect(pending.rows[0]).toEqual({ private_policy_revision: PRIVATE_DIRECTORY_POLICY_REVISION, private_owner_profile_id: c.owner });
    const approved = await approveEnvironmentConnectorPairing(approval);
    const installed = await getPool().query("SELECT private_policy_revision FROM helix_environment_connector_installations WHERE installation_id = $1", [approved.installationId]);
    expect(installed.rows[0].private_policy_revision).toBe(PRIVATE_DIRECTORY_POLICY_REVISION);
    const device = await claimEnvironmentConnectorPairing(claim);
    for (const requiredScope of ["probe.poll", "probe.result", "health.write"] as const) {
      await expect(authenticateEnvironmentConnectorDevice({ bearerToken: device.deviceCredential, requiredScope, now: c.now }))
        .resolves.toMatchObject({ deviceId: device.deviceId, capabilityIds: [c.capability] });
    }
  });

  it("blocks a valid unowned start in private mode before persisting a session", async () => {
    await expect(startEnvironmentConnectorPairing(signedPrivateClockStart().input))
      .rejects.toMatchObject({ code: "private_directory_access_denied" });
    expect((await getPool().query("SELECT * FROM helix_environment_pairing_sessions")).rows).toHaveLength(0);
  });
  it("rejects approval by a different owner without creating an installation", async () => {
    const pending = await begin();
    await expect(approveEnvironmentConnectorPairing({ ...pending.approval, ownerProfileId: "profile:other" }))
      .rejects.toMatchObject({ code: "package_policy_owner_mismatch" });
    expect((await getPool().query("SELECT * FROM helix_environment_connector_installations")).rows).toHaveLength(0);
  });
  it("rechecks withdrawal between start and approval", async () => {
    const pending = await begin(); await withdraw();
    await expect(approveEnvironmentConnectorPairing(pending.approval)).rejects.toMatchObject({ code: "package_policy_withdrawn" });
  });
  it("rechecks withdrawal after approval before issuing a credential", async () => {
    const pending = await begin(); await approveEnvironmentConnectorPairing(pending.approval); await withdraw();
    await expect(claimEnvironmentConnectorPairing(pending.claim)).rejects.toMatchObject({ code: "package_policy_withdrawn" });
    expect((await getPool().query("SELECT * FROM helix_environment_connector_device_credentials")).rows).toHaveLength(0);
  });
  it("keeps an approved private session fenced when the feature is disabled", async () => {
    const pending = await begin(); await approveEnvironmentConnectorPairing(pending.approval);
    vi.stubEnv("HELIX_PRIVATE_ENVIRONMENT_HOME", "0");
    await expect(claimEnvironmentConnectorPairing(pending.claim)).rejects.toMatchObject({ code: "private_directory_access_denied" });
  });
  it("rejects an installation policy revision changed after approval", async () => {
    const pending = await begin(); const approved = await approveEnvironmentConnectorPairing(pending.approval);
    await getPool().query("UPDATE helix_environment_connector_installations SET private_policy_revision = 'changed' WHERE installation_id = $1", [approved.installationId]);
    await expect(claimEnvironmentConnectorPairing(pending.claim)).rejects.toMatchObject({ code: "package_policy_revision_mismatch" });
  });
  it("rejects metadata drift while pending even with the previous content hash retained", async () => {
    const pending = await begin();
    await getPool().query("UPDATE helix_environment_connector_packages SET host_compatibility = '[]'::jsonb WHERE package_version_id = $1", [PRIVATE_CLOCK_PACKAGE_ID]);
    await expect(approveEnvironmentConnectorPairing(pending.approval)).rejects.toMatchObject({ code: "package_policy_metadata_drift" });
  });
  it("rejects every withdrawn device scope before updating health, while revoke remains available", async () => {
    const device = await paired(); await withdraw();
    const before = await getPool().query("SELECT health_status, last_contact_at FROM helix_environment_connector_devices WHERE device_id = $1", [device.deviceId]);
    for (const requiredScope of ["probe.poll", "probe.result", "health.write"] as const) {
      await expect(authenticateEnvironmentConnectorDevice({ bearerToken: device.deviceCredential, requiredScope, now: c.now }))
        .rejects.toMatchObject({ code: "package_policy_withdrawn" });
    }
    expect((await getPool().query("SELECT health_status, last_contact_at FROM helix_environment_connector_devices WHERE device_id = $1", [device.deviceId])).rows).toEqual(before.rows);
    await expect(rotateEnvironmentConnectorDeviceCredential({ ownerProfileId: c.owner, deviceId: device.deviceId, now: c.now }))
      .rejects.toMatchObject({ code: "package_policy_withdrawn" });
    await expect(revokeEnvironmentConnectorDevice({ ownerProfileId: c.owner, deviceId: device.deviceId, now: c.now })).resolves.toBeUndefined();
  });
  it("does not downgrade a private device to legacy access when the flag is disabled", async () => {
    const device = await paired(); vi.stubEnv("HELIX_PRIVATE_ENVIRONMENT_HOME", "0");
    await expect(authenticateEnvironmentConnectorDevice({ bearerToken: device.deviceCredential, requiredScope: "probe.result", now: c.now }))
      .rejects.toMatchObject({ code: "private_directory_access_denied" });
  });
  it("rechecks developer account policy and installation suspension", async () => {
    const device = await paired();
    await getPool().query("UPDATE helix_accounts SET account_type = 'user' WHERE profile_id = $1", [c.owner]);
    await expect(authenticateEnvironmentConnectorDevice({ bearerToken: device.deviceCredential, requiredScope: "probe.poll", now: c.now }))
      .rejects.toMatchObject({ code: "private_directory_access_denied" });
    await getPool().query("UPDATE helix_accounts SET account_type = 'developer' WHERE profile_id = $1", [c.owner]);
    await getPool().query("UPDATE helix_environment_connector_installations SET status = 'suspended' WHERE installation_id = $1", [device.installationId]);
    await expect(authenticateEnvironmentConnectorDevice({ bearerToken: device.deviceCredential, requiredScope: "probe.poll", now: c.now }))
      .rejects.toMatchObject({ code: "package_policy_withdrawn" });
  });
  it("rejects expired policy independently of the longer device credential TTL", async () => {
    const device = await paired();
    await expect(authenticateEnvironmentConnectorDevice({ bearerToken: device.deviceCredential, requiredScope: "health.write", now: new Date("2026-10-01T00:00:00Z") }))
      .rejects.toMatchObject({ code: "package_policy_unavailable" });
  });
  it("fences an unmarked existing generic device when private mode is enabled", async () => {
    vi.stubEnv("HELIX_PRIVATE_ENVIRONMENT_HOME", "0"); const device = await paired(false);
    vi.stubEnv("HELIX_PRIVATE_ENVIRONMENT_HOME", "1");
    await expect(authenticateEnvironmentConnectorDevice({ bearerToken: device.deviceCredential, requiredScope: "probe.result", now: c.now }))
      .rejects.toMatchObject({ code: "package_policy_enrollment_required" });
  });
  it("fences an unmarked pending session at private cutover", async () => {
    vi.stubEnv("HELIX_PRIVATE_ENVIRONMENT_HOME", "0"); const pending = await begin(false);
    vi.stubEnv("HELIX_PRIVATE_ENVIRONMENT_HOME", "1");
    await expect(approveEnvironmentConnectorPairing(pending.approval)).rejects.toMatchObject({ code: "package_policy_enrollment_required" });
  });
});
