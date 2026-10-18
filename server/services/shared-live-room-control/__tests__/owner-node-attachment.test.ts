import crypto from "node:crypto";
import { newDb } from "pg-mem";
import { afterEach, expect, it, vi } from "vitest";
import { buildHelixAccountCapabilityPolicy } from "@shared/helix-account-session";
import { migration094 } from "../../../db/migrations/094_room_owner_node_attachments";
import type { HelixAgentApiPrincipal } from "../../helix-agent-api/types";
import type { readSharedRealtimeRoomMembership } from "../../helix-ask/realtime-room/room-store";
import type { withSharedRealtimeRoomTransaction } from "../../helix-ask/realtime-room/room-store/database";
import { RoomOwnerNodeAttachmentStore } from "../owner-node-attachment-store";
import { signOwnerNodeRequest, type OwnerNodeRequest } from "../owner-node-proof";

const authority = "https://room-owner.test";
const roomId = "shared_realtime_room:owner-attachment-test";
const pools: Array<{ end(): Promise<void> }> = [];
afterEach(async () => { await Promise.all(pools.splice(0).map(pool => pool.end())); });
const fixture = async () => {
  let now = Date.parse("2026-09-25T16:00:00Z");
  const pool = new (newDb().adapters.createPg().Pool)();
  pools.push(pool);
  await pool.query("CREATE TABLE helix_accounts(profile_id text PRIMARY KEY)");
  await pool.query("CREATE TABLE helix_shared_realtime_rooms(room_id text PRIMARY KEY, owner_profile_id text, status text)");
  await pool.query("CREATE TABLE helix_shared_realtime_room_members(room_id text, profile_id text, participant_id text, member_role text, presence text)");
  await pool.query("INSERT INTO helix_accounts VALUES ('remote-owner'), ('guest')");
  await pool.query("INSERT INTO helix_shared_realtime_rooms VALUES ($1,'remote-owner','ready')", [roomId]);
  await pool.query("INSERT INTO helix_shared_realtime_room_members VALUES ($1,'remote-owner','participant-owner','owner','present')", [roomId]);
  const client = await pool.connect();
  try { await migration094.run(client, { enablePgvector: false }); }
  finally { client.release(); }
  const transaction = vi.fn(async (run: (db: typeof client) => Promise<unknown>) => {
    const db = await pool.connect();
    try { return await run(db); } finally { db.release(); }
  });
  const readMembership = vi.fn(async () => ({ roomId, profileId: "remote-owner", participantId: "participant-owner",
    role: "owner", presence: "present", roomStatus: "ready" }));
  const store = new RoomOwnerNodeAttachmentStore({ transaction: transaction as typeof withSharedRealtimeRoomTransaction,
    readMembership: readMembership as unknown as typeof readSharedRealtimeRoomMembership,
    authority: () => authority, now: () => now });
  const policy = buildHelixAccountCapabilityPolicy("developer");
  const principal: HelixAgentApiPrincipal = {
    tenantId: "tenant-one", issuer: "https://issuer.test", subjectId: "subject-owner", accountProfileId: "remote-owner",
    accountType: "developer", scopes: new Set(["helix.rooms.read", "helix.rooms.manage"]), tokenExpiresAt: "2099-01-01T00:00:00Z",
    accountContext: { session_id: "external-oauth:owner", profile_id: "remote-owner", trusted_account_session: true,
      account_session: null, account_policy: policy },
  };
  const key = crypto.generateKeyPairSync("ed25519");
  const sign = (overrides: Partial<Omit<OwnerNodeRequest, "signature">> = {}, signer = key, origin = authority) =>
    signOwnerNodeRequest(origin, { operation: "reserve", room_id: roomId, expected_revision: null,
      request_id: "owner-reserve-001", issued_at_ms: now,
      node_public_key: signer.publicKey.export({ type: "spki", format: "der" }).toString("base64url"), ...overrides }, signer.privateKey);
  return { pool, store, principal, sign, key, readMembership, transaction, advance: (ms: number) => { now += ms; } };
};

it("discovers the current revision with a new owner key after expiry without mutating or granting access", async () => {
  const h = await fixture(); const secondKey = crypto.generateKeyPairSync("ed25519");
  const discover = () => h.sign({ operation: "discover", request_id: "discovery-001" }, secondKey);
  expect((await h.store.operate(h.principal, discover())).attachment).toBeNull();
  const reserved = await h.store.operate(h.principal, h.sign());
  h.advance(16 * 60_000);
  const before = (await h.pool.query("SELECT * FROM helix_room_owner_node_attachments")).rows;
  const result = await h.store.operate(h.principal, discover());
  expect(result).toMatchObject({ operation: "room.owner_node.discover", attachment: reserved.attachment });
  expect((await h.pool.query("SELECT * FROM helix_room_owner_node_attachments")).rows).toEqual(before);
  expect(h.transaction).toHaveBeenLastCalledWith(expect.any(Function), undefined);
  const replacement = await h.store.operate(h.principal, h.sign({ expected_revision: 1, request_id: "replacement-001" }, secondKey));
  expect(replacement.attachment).toMatchObject({ revision: 2 });
  expect(JSON.stringify(result)).not.toMatch(/node_public_key|remote-owner|subject-owner|signature/);
});

it("binds handoff validation proof to capture identity and rejects replay on a different handoff or digest", async () => {
  const h = await fixture(); await h.store.operate(h.principal, h.sign());
  const request = h.sign({ operation: "handoff_validate", expected_revision: 1,
    handoff_id: "handoff:one", transcript_text_hash: `sha256:${"a".repeat(64)}` });
  expect((await h.store.operate(h.principal, request)).attachment).toMatchObject({ revision: 1 });
  for (const changed of [{ ...request, handoff_id: "handoff:two" },
    { ...request, transcript_text_hash: `sha256:${"b".repeat(64)}` },
    { ...request, expected_revision: 2 }]) {
    await expect(h.store.operate(h.principal, changed)).rejects.toMatchObject({ code: "room_forbidden" });
  }
  expect(h.transaction).toHaveBeenLastCalledWith(expect.any(Function), undefined);
});

it.each(["handoff_list", "handoff_validate"] as const)("requires the exact active node for %s without changing stored state", async operation => {
  const h = await fixture(); await h.store.operate(h.principal, h.sign());
  const fields = { operation, expected_revision: 1,
    ...(operation === "handoff_validate" ? { handoff_id: "handoff:one", transcript_text_hash: `sha256:${"a".repeat(64)}` } : {}) };
  const before = (await h.pool.query("SELECT * FROM helix_room_owner_node_attachments")).rows;
  await h.store.operate(h.principal, h.sign(fields));
  expect((await h.pool.query("SELECT * FROM helix_room_owner_node_attachments")).rows).toEqual(before);
  await expect(h.store.operate(h.principal, h.sign(fields, crypto.generateKeyPairSync("ed25519"))))
    .rejects.toMatchObject({ code: "room_forbidden" });
  h.advance(15 * 60_000);
  await expect(h.store.operate(h.principal, h.sign(fields))).rejects.toMatchObject({ code: "room_runtime_conflict" });
});

it.each(["guest", "different_identity", "scope", "absent", "stale_proof"])("discovery rejects %s", async kind => {
  const h = await fixture(); await h.store.operate(h.principal, h.sign());
  const principal = { ...h.principal };
  if (kind === "guest") principal.accountProfileId = "guest";
  if (kind === "different_identity") principal.subjectId = "other-subject";
  if (kind === "scope") principal.scopes = new Set(["helix.rooms.read"]);
  if (kind === "absent") await h.pool.query("UPDATE helix_shared_realtime_room_members SET presence='left'");
  const request = h.sign({ operation: "discover" });
  if (kind === "stale_proof") h.advance(61_000);
  await expect(h.store.operate(principal, request)).rejects.toThrow();
});

it("persists an opaque reservation, inspects its exact node and retries without extending expiry", async () => {
  const h = await fixture();
  const first = await h.store.operate(h.principal, h.sign());
  expect(first).toMatchObject({ operation: "room.owner_node.reserve", idempotency_replayed: false,
    attachment: { revision: 1, status: "reserved", local_task_verified: false, dispatch_authority: false },
    answer_authority: false, terminal_eligible: false });
  h.advance(30_000);
  const replay = await h.store.operate(h.principal, h.sign());
  expect(replay).toEqual({ ...first, idempotency_replayed: true });
  expect((await h.store.operate(h.principal, h.sign({ operation: "inspect", expected_revision: 1 }))).attachment).toEqual(first.attachment);
  expect(h.transaction).toHaveBeenCalledWith(expect.any(Function), {
    requireLocalSnapshot: true, snapshotTables: ["helix_room_owner_node_attachments"],
  });
  const rows = (await h.pool.query("SELECT * FROM helix_room_owner_node_attachments")).rows;
  expect(rows).toHaveLength(1);
  expect(JSON.stringify(first)).not.toMatch(/node_public_key|subject-owner|remote-owner|private|reasoning_binding|chat_session/);
  expect(Object.keys(rows[0])).not.toContain("signature");
});

it.each(["tenantId", "issuer", "subjectId"] as const)("rejects a different OAuth %s mapped to the same profile", async field => {
  const h = await fixture(); await h.store.operate(h.principal, h.sign());
  await expect(h.store.operate({ ...h.principal, [field]: "different-identity" }, h.sign({ operation: "inspect", expected_revision: 1 })))
    .rejects.toMatchObject({ code: "room_forbidden" });
});

it.each(["helix.rooms.read", "helix.rooms.manage"])("requires scope %s", async scope => {
  const h = await fixture(); h.principal.scopes = new Set([...h.principal.scopes].filter(value => value !== scope));
  await expect(h.store.operate(h.principal, h.sign())).rejects.toMatchObject({ code: "insufficient_scope" });
  expect(h.transaction).not.toHaveBeenCalled();
});

it("denies guests, absent owners and a stale owner membership snapshot", async () => {
  const h = await fixture();
  await expect(h.store.operate({ ...h.principal, accountProfileId: "guest" }, h.sign())).rejects.toMatchObject({ code: "room_forbidden" });
  h.readMembership.mockResolvedValueOnce({ roomId, profileId: "remote-owner", participantId: "participant-owner", role: "owner", presence: "away", roomStatus: "ready" });
  await expect(h.store.operate(h.principal, h.sign())).rejects.toMatchObject({ code: "room_forbidden" });
  await h.pool.query("UPDATE helix_shared_realtime_room_members SET presence='left'");
  await expect(h.store.operate(h.principal, h.sign())).rejects.toMatchObject({ code: "room_forbidden" });
});

it("binds proof to authority, room, operation, revision and freshness", async () => {
  const h = await fixture();
  const signed = h.sign();
  for (const request of [h.sign({}, h.key, "https://other.test"), { ...signed, operation: "revoke" },
    { ...signed, room_id: "shared_realtime_room:other-room" }, { ...signed, expected_revision: 2 },
    h.sign({ issued_at_ms: signed.issued_at_ms - 60_001 }), h.sign({ issued_at_ms: signed.issued_at_ms + 5_001 }),
    { ...signed, signature: "A".repeat(86) }]) {
    await expect(h.store.operate(h.principal, request)).rejects.toMatchObject({ code: "room_forbidden" });
  }
  expect(h.transaction).not.toHaveBeenCalled();
});

it("rejects task, account, URL and key overrides outside the strict proof contract", async () => {
  const h = await fixture();
  for (const field of ["reasoning_binding_id", "profile_id", "private_key", "callback_url"]) {
    await expect(h.store.operate(h.principal, { ...h.sign(), [field]: "not-admitted" })).rejects.toThrow();
  }
  expect(h.transaction).not.toHaveBeenCalled();
});

it("fences different nodes and stale revisions, while explicit owner replacement gets a new reference", async () => {
  const h = await fixture();
  const first = await h.store.operate(h.principal, h.sign());
  const secondKey = crypto.generateKeyPairSync("ed25519");
  for (const operation of ["inspect", "revoke"] as const) {
    await expect(h.store.operate(h.principal, h.sign({ operation, expected_revision: 1, request_id: "other-node-001" }, secondKey)))
      .rejects.toMatchObject({ code: "room_forbidden" });
  }
  await expect(h.store.operate(h.principal, h.sign({ request_id: "stale-reserve-001" }))).rejects.toMatchObject({ code: "room_runtime_conflict" });
  await expect(h.store.operate(h.principal, h.sign({ expected_revision: 1 }))).rejects.toMatchObject({ code: "idempotency_conflict" });
  const replaced = await h.store.operate(h.principal, h.sign({ expected_revision: 1, request_id: "replacement-001" }, secondKey));
  expect(replaced.attachment).toMatchObject({ revision: 2, dispatch_authority: false });
  expect(replaced.attachment).not.toEqual(first.attachment);
  await expect(h.store.operate(h.principal, h.sign({ operation: "inspect", expected_revision: 1 }))).rejects.toMatchObject({ code: "room_forbidden" });
});

it("allows exact-node withdrawal after room closure/policy loss and never restores a revoked reservation on retry", async () => {
  const h = await fixture(); await h.store.operate(h.principal, h.sign());
  await h.pool.query("UPDATE helix_shared_realtime_rooms SET status='closed'");
  h.principal.accountContext.account_policy = buildHelixAccountCapabilityPolicy("user");
  const request = h.sign({ operation: "revoke", expected_revision: 1, request_id: "revoke-node-001" });
  const revoked = await h.store.operate(h.principal, request);
  expect(revoked.attachment).toMatchObject({ revision: 2, status: "revoked" });
  expect(await h.store.operate(h.principal, request)).toEqual({ ...revoked, idempotency_replayed: true });
  await expect(h.store.operate(h.principal, h.sign())).rejects.toMatchObject({ code: "account_policy_blocked" });
});

it("expires reservations and denies token expiry without silently renewing on retry", async () => {
  const h = await fixture(); await h.store.operate(h.principal, h.sign());
  h.advance(15 * 60_000);
  await expect(h.store.operate(h.principal, h.sign())).rejects.toMatchObject({ code: "room_runtime_conflict" });
  await expect(h.store.operate(h.principal, h.sign({ operation: "inspect", expected_revision: 1 }))).rejects.toMatchObject({ code: "room_runtime_conflict" });
  h.principal.tokenExpiresAt = "2026-09-25T15:59:59Z";
  await expect(h.store.operate(h.principal, h.sign())).rejects.toMatchObject({ code: "room_forbidden" });
});

it("does not acknowledge a reservation when required durable snapshot confirmation fails", async () => {
  const h = await fixture(); const original = h.transaction.getMockImplementation()!;
  h.transaction.mockImplementationOnce(async run => { await original(run); throw new Error("snapshot_unconfirmed"); });
  await expect(h.store.operate(h.principal, h.sign())).rejects.toThrow("snapshot_unconfirmed");
  expect((await h.store.operate(h.principal, h.sign())).idempotency_replayed).toBe(true);
});
