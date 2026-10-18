import crypto from "node:crypto";
import { HELIX_ENVIRONMENT_PROBE_SUBMISSION_SCHEMA } from "@shared/helix-environment-connector";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureDatabase, getPool, resetDbClient } from "../../../../db/client";
import { pairPrivateClock, privateClock as c, seedPrivateClockSource } from "./private-policy-fixture";
import { authenticateEnvironmentConnectorDevice } from "../service";
import { listActiveEnvironmentConnectorBindings } from "../../bindings";
import { readEnvironmentConnectorCapabilityDescriptor } from "../../catalog";
import { dispatchDurableEnvironmentProbe, leaseDurableEnvironmentProbesForClaim, submitDurableEnvironmentProbeResult } from "../../probe";
import { handleSystemClockLease } from "../../../../../connectors/environment/examples/system-clock/connector";
import { PRIVATE_CLOCK_PACKAGE_ID } from "../../directory/release-policy";

const prepare = async () => {
  const receipt = await pairPrivateClock();
  const device = await authenticateEnvironmentConnectorDevice({ bearerToken: receipt.deviceCredential, requiredScope: "probe.result", now: c.now });
  const [connector] = await listActiveEnvironmentConnectorBindings({
    ownerProfileId: c.owner, roomId: c.room, roomSourceBindingId: c.binding, sourceId: c.source,
    adapterAdmissionId: device.admission.admission_id, adapterContractHash: device.admission.adapter_contract_hash,
    manifestHash: device.admission.manifest_hash, producerEpochRef: device.admission.producer_epoch_ref, capabilityId: c.capability,
  });
  await dispatchDurableEnvironmentProbe({
    tenantId: "first_party_browser_session", ownerSubjectId: "first_party_subject:private-clock", ownerProfileId: c.owner,
    executionAuthorityKind: "first_party_shared_room", runId: "first_party_shared_room:private-clock",
    turnId: "ask:private-clock", providerExecutionId: "fixture:no-provider", toolCallId: "tool:private-clock",
    roomId: c.room, sourceId: c.source, producerEpochRef: device.admission.producer_epoch_ref, adapterAdmission: device.admission,
    connector, descriptor: readEnvironmentConnectorCapabilityDescriptor(c.capability)!, arguments: { clock: "monotonic" },
    freshnessRequirementMs: 5000, timeoutMs: 5000, idempotencyKey: "private-clock-request", now: c.now,
  });
  const authority = {
    claim: { binding: device.binding, credentialId: c.credential, requestProjectionId: "private-clock-projection",
      producerEpoch: device.admission.producer_epoch_ref, sequence: 0, routeKey: "private-clock",
      bodyDigest: "sha256:device_transport_server_authenticated", replay: null },
    adapterAdmission: device.admission, expectedDeviceId: device.deviceId,
    expectedEnvironmentBindingId: device.environmentBindingId, now: c.now,
  };
  return authority;
};
const withdraw = () => getPool().query("UPDATE helix_environment_connector_packages SET lifecycle_status = 'withdrawn', withdrawn_at = NOW() WHERE package_version_id = $1", [PRIVATE_CLOCK_PACKAGE_ID]);

describe("private policy at probe lease and result acceptance", () => {
  beforeEach(async () => {
    vi.stubEnv("DATABASE_URL", `pg-mem://private-broker-${crypto.randomUUID()}`);
    vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "0"); vi.stubEnv("HELIX_PRIVATE_ENVIRONMENT_HOME", "1");
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(c.now);
    await resetDbClient(); await ensureDatabase(); await seedPrivateClockSource();
  });
  afterEach(async () => { await resetDbClient(); vi.unstubAllEnvs(); vi.useRealTimers(); });

  it("accepts one correlated read-only clock effect under the admitted private enrollment", async () => {
    const authority = await prepare();
    const [lease] = await leaseDurableEnvironmentProbesForClaim({ ...authority, limit: 1 });
    const result = handleSystemClockLease(lease, () => 12345, c.now);
    const accepted = await submitDurableEnvironmentProbeResult({ ...authority,
      submission: { schema: HELIX_ENVIRONMENT_PROBE_SUBMISSION_SCHEMA, probe_attempt_id: lease.probe_attempt_id,
        lease_token: lease.lease_token, submitted_at: c.now.toISOString(), result } });
    expect(accepted.observation).toMatchObject({ eligible_for_current_turn_reentry: true, answer_authority: false });
  });
  it("rechecks withdrawal after authentication before leasing", async () => {
    const authority = await prepare(); await withdraw();
    await expect(leaseDurableEnvironmentProbesForClaim({ ...authority, limit: 1 }))
      .rejects.toMatchObject({ code: "package_policy_withdrawn" });
    expect((await getPool().query("SELECT * FROM helix_environment_probe_attempts")).rows).toHaveLength(0);
    await expect(leaseDurableEnvironmentProbesForClaim({ ...authority, expectedDeviceId: undefined, limit: 1 }))
      .rejects.toMatchObject({ code: "package_policy_withdrawn" });
  });
  it("rejects a valid already-leased result after withdrawal without storing evidence", async () => {
    const authority = await prepare();
    const [lease] = await leaseDurableEnvironmentProbesForClaim({ ...authority, limit: 1 });
    const result = handleSystemClockLease(lease, () => 12345, c.now); await withdraw();
    await expect(submitDurableEnvironmentProbeResult({ ...authority,
      submission: { schema: HELIX_ENVIRONMENT_PROBE_SUBMISSION_SCHEMA, probe_attempt_id: lease.probe_attempt_id,
        lease_token: lease.lease_token, submitted_at: c.now.toISOString(), result } }))
      .rejects.toMatchObject({ code: "package_policy_withdrawn" });
    expect((await getPool().query("SELECT * FROM helix_environment_probe_results")).rows).toHaveLength(0);
    expect((await getPool().query("SELECT * FROM helix_environment_probe_observations")).rows).toHaveLength(0);
  });
});
