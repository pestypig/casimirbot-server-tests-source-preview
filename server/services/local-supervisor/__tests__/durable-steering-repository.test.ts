import { newDb } from "pg-mem";
import { afterEach, expect, it, vi } from "vitest";
import { migration090 } from "../../../db/migrations/090_durable_steering";
import { DurableSteeringRepository } from "../durable-steering-repository";
import { createDurableSteering, acknowledgeDurableSteering } from "../durable-steering-contract";
import { createPairingLedgerRow, acceptPairingLedgerRow, pairingApprovalSchema, revokePairingLedgerRow } from "../pairing-ledger-contract";
import { DurableSteeringService } from "../durable-steering-service";
import { DurableReasoningBindingAccess } from "../durable-reasoning-binding-access";
import { HelixReasoningTaskBindingStore } from "../reasoning-task-binding-store";
import { ephemeralPairingVault } from "./pairing-vault-fixture";
const pools: Array<{ end(): Promise<void> }> = [];
afterEach(async () => { await Promise.all(pools.splice(0).map(p => p.end())); });
const now = new Date("2026-09-12T12:00:00Z");
const destination = { issuer: "fixture-issuer", profileId: "fixture-owner", installationId: "fixture-device", clientId: "fixture-client", taskId: "fixture-task" };
const grant = acceptPairingLedgerRow(createPairingLedgerRow({ id: "fixture-pairing", requestDigest: "a".repeat(64), acceptanceSecretDigest: "b".repeat(64), consentReceiptId: "fixture-consent",
  approval: pairingApprovalSchema.parse({ destination, chatId: "fixture-chat", environment: null, scope: "exact_chat_steering", policyRevision: 1 }) }, now), destination, now);
async function fixture() {
  const pool = new (newDb().adapters.createPg().Pool)(); pools.push(pool);
  await pool.query("CREATE TABLE helix_accounts(profile_id text PRIMARY KEY)");
  await pool.query("CREATE TABLE helix_pairing_ledger(pairing_id text PRIMARY KEY)");
  await pool.query("INSERT INTO helix_accounts VALUES ('fixture-owner')");
  await pool.query("INSERT INTO helix_pairing_ledger VALUES ('fixture-pairing')");
  const client = await pool.connect();
  try { await migration090.run(client, { enablePgvector: false }); }
  finally { client.release(); }
  const vault = ephemeralPairingVault(), flush = vi.fn(async () => {});
  return { pool, vault, flush, repo: new DurableSteeringRepository(pool, vault, flush) };
}
const event = (clientEventRef = "fixture-event", cursor = 1) => createDurableSteering(grant,
  { clientEventRef, origin: "typed", instructionText: "Private fixture instruction" }, cursor, now);
it("O5 encrypts one concurrent insertion and restores acknowledgement through a new repository", async () => {
  const h = await fixture(), row = event();
  expect(await h.repo.nextCursor(destination.profileId, grant.id)).toBe(1);
  expect((await Promise.all([h.repo.insert(row), h.repo.insert(row)])).sort()).toEqual([false, true]);
  expect(h.flush).toHaveBeenCalledTimes(2);
  expect(JSON.stringify((await h.pool.query("SELECT * FROM helix_durable_steering")).rows)).not.toContain(row.request.instructionText);
  const ack = acknowledgeDurableSteering(grant, row, new Date(now.getTime() + 1000));
  expect(await h.repo.compareAndSwap(ack, 1)).toBe(true);
  expect(await h.repo.compareAndSwap(ack, 1)).toBe(false);
  const restored = new DurableSteeringRepository(h.pool, h.vault, h.flush);
  expect(await restored.read(destination.profileId, grant.id, row.id)).toEqual(ack);
  expect(await restored.list(destination.profileId, grant.id)).toEqual([ack]);
  expect(await restored.list(destination.profileId, grant.id, 1)).toEqual([]);
  expect(await restored.read("fixture-other-owner", grant.id, row.id)).toBeNull();
  expect(await restored.nextCursor(destination.profileId, grant.id)).toBe(2);
});
it("O5 unique cursor arbitration and lost flush reply preserve committed identity", async () => {
  const h = await fixture(), row = event();
  h.flush.mockRejectedValueOnce(new Error("fixture-lost-flush"));
  await expect(h.repo.insert(row)).rejects.toThrow("fixture-lost-flush");
  expect(await h.repo.insert(row)).toBe(false);
  expect(await h.repo.insert(event("fixture-other-event"))).toBe(false);
  expect(await h.repo.read(destination.profileId, grant.id, row.id)).toEqual(row);
  expect(await h.repo.insert(event("fixture-other-event", 2))).toBe(true);
});
it("O5 acknowledgement cannot rewrite the persisted event deadline", async () => {
  const h = await fixture(), row = event(); await h.repo.insert(row);
  const ack = acknowledgeDurableSteering(grant, row, new Date(now.getTime() + 1000));
  await expect(h.repo.compareAndSwap({ ...ack, expiresAt: new Date(Date.parse(row.expiresAt) - 1000).toISOString() }, 1))
    .rejects.toThrow("steering_immutable_fields_changed");
  expect(await h.repo.read(destination.profileId, grant.id, row.id)).toEqual(row);
  expect(await h.repo.compareAndSwap(ack, 1)).toBe(true);
});
it("O5 corrupt payload and key loss fail closed without leaking codec diagnostics", async () => {
  const h = await fixture(), row = event(); await h.repo.insert(row);
  const wrongKey = new DurableSteeringRepository(h.pool, ephemeralPairingVault(), h.flush);
  await expect(wrongKey.read(destination.profileId, grant.id, row.id)).rejects.toThrow("pairing_storage_unreadable");
  await h.pool.query("UPDATE helix_durable_steering SET encrypted_payload='corrupt'");
  await expect(h.repo.list(destination.profileId, grant.id)).rejects.toThrow("pairing_storage_unreadable");
});
it("O5 bounded task polling and recent chat display retain different cursor windows", async () => {
  const h = await fixture();
  for (let cursor = 1; cursor <= 52; cursor += 1) await h.repo.insert(event(`fixture-event-${cursor}`, cursor));
  const service = new DurableSteeringService(h.repo, async () => grant, () => now);
  const first = await service.list();
  const recent = await service.list(0, true);
  expect(first.map(row => row.cursor)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  expect(recent.map(row => row.cursor)).toEqual(Array.from({ length: 50 }, (_, i) => i + 3));
  expect((await service.list(50)).map(row => row.cursor)).toEqual([51, 52]);
  expect((await service.list(51, true)).map(row => row.cursor)).toEqual([52]);
  expect(recent.every(row => row.acknowledgedAt === null)).toBe(true);
  expect((await service.list()).map(row => row.id)).toEqual(first.map(row => row.id));
});
it("O5 service recovery retains exact event and acknowledgement across concurrent retry", async () => {
  const h = await fixture();
  const service = new DurableSteeringService(h.repo, async () => grant, () => now);
  const request = event().request;
  const [a, b] = await Promise.all([service.submit(request), service.submit(request)]);
  expect(a).toEqual(b);
  const [ackA, ackB] = await Promise.all([service.acknowledge(a.id), service.acknowledge(a.id)]);
  expect(ackA).toEqual(ackB);
  const restored = new DurableSteeringService(new DurableSteeringRepository(h.pool, h.vault, h.flush), async () => grant,
    () => new Date(now.getTime() + 700000));
  expect(await restored.submit(request)).toEqual(ackA);
  expect(await restored.acknowledge(a.id)).toEqual(ackA);
  expect(await restored.list()).toEqual([ackA]);
  expect((await h.pool.query("SELECT count(*) AS count FROM helix_durable_steering")).rows[0].count).toBe(1);
});
it("persists one idempotent exact-task poll before a separate acknowledgement", async () => {
  const h = await fixture();
  let clock = now;
  const service = new DurableSteeringService(h.repo, async () => grant, () => clock);
  const queued = await service.submit(event().request);
  clock = new Date(now.getTime() + 1_000);
  const [pickupA, pickupB] = await Promise.all([
    service.pickUp(queued.id), service.pickUp(queued.id),
  ]);
  expect(pickupA).toEqual(pickupB);
  expect(pickupA).toMatchObject({ revision: 2,
    pickedUpAt: clock.toISOString(), acknowledgedAt: null });
  clock = new Date(now.getTime() + 2_000);
  const acknowledged = await service.acknowledge(queued.id);
  expect(acknowledged).toMatchObject({ revision: 3,
    pickedUpAt: pickupA.pickedUpAt, acknowledgedAt: clock.toISOString() });
  const recovered = new DurableSteeringService(
    new DurableSteeringRepository(h.pool, h.vault, h.flush),
    async () => grant, () => clock);
  expect(await recovered.inspect(queued.id)).toEqual(acknowledged);
  expect(await recovered.pickUp(queued.id)).toEqual(acknowledged);
});
it("O5 service loses a commit reply without losing idempotency and blocks post-commit revocation", async () => {
  const h = await fixture();
  let current = grant;
  const service = new DurableSteeringService(h.repo, async () => current, () => now);
  const request = event().request;
  h.flush.mockRejectedValueOnce(new Error("fixture-lost-flush"));
  await expect(service.submit(request)).rejects.toThrow("fixture-lost-flush");
  const recovered = await service.submit(request);
  h.flush.mockImplementationOnce(async () => { current = revokePairingLedgerRow(grant, destination.profileId, now); });
  await expect(service.acknowledge(recovered.id)).rejects.toThrow("pairing_revoked");
  await expect(service.list()).rejects.toThrow("pairing_revoked");
  await expect(service.submit(request)).rejects.toThrow("pairing_revoked");
});
it.each(["revoked", "expired", "changed-scope"] as const)(
  "O5 rejects %s admission after encrypted polling without returning a stale event", async transition => {
    const h = await fixture();
    const row = event(); await h.repo.insert(row);
    let current = grant, clock = now;
    const service = new DurableSteeringService(h.repo, async () => current, () => clock);
    const list = h.repo.list.bind(h.repo);
    vi.spyOn(h.repo, "list").mockImplementationOnce(async (...args) => {
      const result = await list(...args);
      if (transition === "revoked") current = revokePairingLedgerRow(grant, destination.profileId, now);
      if (transition === "expired") clock = new Date(grant.pairingExpiresAt);
      if (transition === "changed-scope") current = { ...grant, approval: { ...grant.approval, chatId: "fixture-other-chat" } };
      return result;
    });
    await expect(service.list()).rejects.toThrow(transition === "changed-scope"
      ? "steering_scope_mismatch" : `pairing_${transition}`);
    expect(await h.repo.read(destination.profileId, grant.id, row.id)).toEqual(row);
    expect(h.flush).toHaveBeenCalledTimes(2);
  },
);
it("O5 access integration projects the same acknowledged event through a recovered binding and rejects old handles", async () => {
  const h = await fixture();
  const make = (serviceInstanceRef: string) => new DurableReasoningBindingAccess(
    new HelixReasoningTaskBindingStore({ serviceInstanceRef, listPresence: () => [] }, () => now),
    async actor => { expect(actor).toEqual(destination); },
    async () => ({ confirmDurability: async () => {}, read: async () => grant }) as never,
    () => now, async () => h.repo);
  const before = make("fixture-service-before");
  const firstBinding = await before.restore({ destination, pairingId: grant.id, clientSessionRef: "fixture-session-before" });
  const args = { profileRef: destination.profileId, bindingId: firstBinding.reasoning_binding_id,
    bindingEpoch: firstBinding.binding_epoch, clientEventRef: "fixture-access-event", origin: "typed" as const, instructionText: "Inspect surroundings" };
  const event = await before.dispatch(args);
  const acknowledged = await before.acknowledge({ ...args, clientSessionRef: "fixture-session-before", eventRef: event.steering_event_ref });
  const after = make("fixture-service-after");
  const secondBinding = await after.restore({ destination, pairingId: grant.id, clientSessionRef: "fixture-session-after" });
  const current = { ...args, bindingId: secondBinding.reasoning_binding_id, bindingEpoch: secondBinding.binding_epoch };
  const deliveries = await after.read({ ...current, clientSessionRef: "fixture-session-after" });
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0].event).toMatchObject({ steering_event_ref: event.steering_event_ref,
    reasoning_binding_id: secondBinding.reasoning_binding_id, delivery_state: "acknowledged",
    created_at: event.created_at, expires_at: event.expires_at, acknowledged_at: acknowledged.acknowledged_at });
  expect((await after.dispatch(current)).steering_event_ref).toBe(event.steering_event_ref);
  expect((await h.pool.query("SELECT count(*) AS count FROM helix_durable_steering")).rows[0].count).toBe(1);
  await expect(after.read({ ...current, clientSessionRef: "fixture-session-before" })).rejects.toThrow("reasoning_binding_identity_mismatch");
  await expect(after.read({ ...args, clientSessionRef: "fixture-session-before" })).rejects.toThrow("reasoning_binding_not_found");
});
