import { newDb } from "pg-mem";
import { afterEach, expect, it, vi } from "vitest";
import { migration088 } from "../../../db/migrations/088_pairing_destinations";
import { migration089 } from "../../../db/migrations/089_pairing_destination_identity";
import { ephemeralPairingVault } from "./pairing-vault-fixture";
import { PairingDestinationRegistrationStore, PAIRING_SETUP_RETRY_BUCKET_MS,
  reusableSetupRegistration } from "../pairing-destination-registration";
const actor = { issuer: "fixture-issuer", profileId: "fixture-owner", installationId: "fixture-install",
  clientId: "fixture-client", taskId: "fixture-private-task" };
const pools: Array<{ end(): Promise<void> }> = [];
afterEach(async () => { await Promise.all(pools.splice(0).map(pool => pool.end())); });
async function fixture() {
  const pool = new (newDb().adapters.createPg().Pool)(); pools.push(pool);
  await pool.query("CREATE TABLE helix_accounts(profile_id text PRIMARY KEY)");
  await pool.query("INSERT INTO helix_accounts VALUES ('fixture-owner')");
  const client = await pool.connect();
  try { await migration088.run(client, { enablePgvector: false }); await migration089.run(client, { enablePgvector: false }); } finally { client.release(); }
  let seconds = 0;
  const now = () => new Date(Date.parse("2026-09-08T12:00:00Z") + seconds * 1000);
  const flush = vi.fn(async () => {});
  const vault = ephemeralPairingVault();
  return { pool, now, flush, vault, time: (value: number) => { seconds = value; },
    store: new PairingDestinationRegistrationStore(pool, flush, now, vault) };
}
const request = { requestId: "fixture-request", durationSeconds: 900 };

it("does not offer an about-to-expire setup registration for owner review", () => {
  const start = Date.parse("2026-09-08T12:01:00Z");
  const digest = "a".repeat(64);
  const old = { destinationDigest: digest, expiresAt: new Date(start + 3_600_000).toISOString() };
  expect(reusableSetupRegistration([old], digest, start + 39 * 60_000)).toBe(old);
  expect(reusableSetupRegistration([old], digest, start + 41 * 60_000)).toBeUndefined();
  expect(reusableSetupRegistration([old], "b".repeat(64), start)).toBeUndefined();
  expect(Math.floor(start / PAIRING_SETUP_RETRY_BUCKET_MS))
    .not.toBe(Math.floor((start + 41 * 60_000) / PAIRING_SETUP_RETRY_BUCKET_MS));
});

it("retains exact registration across idle and store reconstruction without renewing or granting authority", async () => {
  const h = await fixture(); const registered = await h.store.registerAuthenticated(actor, request);
  h.time(301);
  const restored = new PairingDestinationRegistrationStore(h.pool, h.flush, h.now, h.vault);
  expect(await restored.resolveOwned(actor.profileId, registered.registrationId)).toEqual({ ...registered, destination: actor });
  expect(await restored.verifyAuthenticated(actor, registered.registrationId)).toEqual(registered);
  expect(await restored.registerAuthenticated(actor, request)).toEqual(registered);
  expect(registered).toMatchObject({ proofBasis: "authenticated_client_declaration", currentPresence: false,
    pairingAuthority: false, executionAuthority: false });
  const stored = (await h.pool.query("SELECT * FROM helix_pairing_destinations")).rows;
  expect(stored).toHaveLength(1);
  expect(JSON.stringify(stored)).not.toContain(actor.taskId);
  h.time(900);
  await expect(restored.verifyAuthenticated(actor, registered.registrationId)).rejects.toThrow("pairing_registration_expired");
  await expect(restored.registerAuthenticated(actor, request)).rejects.toThrow("pairing_registration_expired");
});
it("rejects every changed destination dimension and conflicting request reuse", async () => {
  const h = await fixture(); const registered = await h.store.registerAuthenticated(actor, request);
  for (const key of Object.keys(actor)) {
    await expect(h.store.verifyAuthenticated({ ...actor, [key]: "fixture-foreign" }, registered.registrationId))
      .rejects.toThrow("pairing_registration_identity_mismatch");
  }
  await expect(h.store.registerAuthenticated({ ...actor, taskId: "fixture-other-task" }, request))
    .rejects.toThrow("pairing_registration_request_conflict");
  await expect(h.store.registerAuthenticated(actor, { ...request, durationSeconds: 1800 }))
    .rejects.toThrow("pairing_registration_request_conflict");
});
it("preserves revocation and reconciles an unknown insert outcome", async () => {
  const h = await fixture(); h.flush.mockRejectedValueOnce(new Error("fixture-disk-error"));
  await expect(h.store.registerAuthenticated(actor, request)).rejects.toThrow("fixture-disk-error");
  const registered = await h.store.registerAuthenticated(actor, request);
  await h.store.revokeOwned("fixture-foreign-owner", registered.registrationId);
  expect(await h.store.verifyAuthenticated(actor, registered.registrationId)).toEqual(registered);
  await h.store.revokeOwned(actor.profileId, registered.registrationId);
  await expect(h.store.verifyAuthenticated(actor, registered.registrationId)).rejects.toThrow("pairing_registration_revoked");
  await expect(h.store.registerAuthenticated(actor, request)).rejects.toThrow("pairing_registration_revoked");
});

it("lists only active owner identities and rejects copied encrypted metadata", async () => {
  const h = await fixture(); const first = await h.store.registerAuthenticated(actor, request);
  const second = await h.store.registerAuthenticated({ ...actor, taskId: "fixture-second-task" }, { ...request, requestId: "fixture-second" });
  expect(await h.store.listOwned("fixture-foreign-owner")).toEqual([]);
  await expect(h.store.resolveOwned("fixture-foreign-owner", first.registrationId)).rejects.toThrow("pairing_registration_identity_mismatch");
  expect(await h.store.listOwned(actor.profileId)).toHaveLength(2);
  const payload = (await h.pool.query("SELECT encrypted_identity FROM helix_pairing_destinations WHERE registration_id = $1", [first.registrationId])).rows[0].encrypted_identity;
  await h.pool.query("UPDATE helix_pairing_destinations SET encrypted_identity = $1 WHERE registration_id = $2", [payload, second.registrationId]);
  await expect(h.store.resolveOwned(actor.profileId, second.registrationId)).rejects.toThrow();
  await h.store.revokeOwned(actor.profileId, second.registrationId);
  expect(await h.store.listOwned(actor.profileId)).toHaveLength(1);
  h.time(900);
  expect(await h.store.listOwned(actor.profileId)).toEqual([]);
});

it("does not invent legacy identity; authenticated replay enriches it without renewing", async () => {
  const h = await fixture(); const first = await h.store.registerAuthenticated(actor, request);
  await h.pool.query("UPDATE helix_pairing_destinations SET encrypted_identity = NULL, encryption_key_id = NULL");
  expect(await h.store.listOwned(actor.profileId)).toEqual([]);
  await expect(h.store.resolveOwned(actor.profileId, first.registrationId)).rejects.toThrow("pairing_registration_identity_unavailable");
  h.time(301);
  expect(await h.store.registerAuthenticated(actor, request)).toEqual(first);
  expect(await h.store.resolveOwned(actor.profileId, first.registrationId)).toMatchObject({ destination: actor, expiresAt: first.expiresAt });
});
