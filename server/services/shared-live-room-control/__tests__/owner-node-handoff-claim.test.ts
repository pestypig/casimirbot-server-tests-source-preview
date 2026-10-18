import crypto from "node:crypto";
import { newDb } from "pg-mem";
import { afterEach, expect, it, vi } from "vitest";
import { buildHelixAccountCapabilityPolicy } from "@shared/helix-account-session";
import { migration094 } from "../../../db/migrations/094_room_owner_node_attachments";
import { migration097 } from "../../../db/migrations/097_room_owner_handoff_claims";
import { RoomOwnerNodeAttachmentStore } from "../owner-node-attachment-store";
import { RoomOwnerNodeHandoffService } from "../owner-node-handoff-service";
import { signOwnerNodeRequest, verifyOwnerNodeRequest, type OwnerNodeRequest } from "../owner-node-proof";
import type { HelixAgentApiPrincipal } from "../../helix-agent-api/types";
import type { withSharedRealtimeRoomTransaction } from "../../helix-ask/realtime-room/room-store/database";
import { NativeSharedLiveRoomConnection } from "../native-room-connection";
import { nativeHostedRoomAttachmentSchema } from "@shared/helix-native-hosted-room-mission";

const pools: Array<{ end(): Promise<void> }> = [];
afterEach(async () => { await Promise.all(pools.splice(0).map(pool => pool.end())); });
const fixture = async () => {
  const now = Date.now(), authority = "https://rooms.test", roomId = "shared_realtime_room:claim";
  const pool = new (newDb().adapters.createPg().Pool)(); pools.push(pool);
  await pool.query("CREATE TABLE helix_accounts(profile_id text PRIMARY KEY)");
  await pool.query("CREATE TABLE helix_shared_realtime_rooms(room_id text PRIMARY KEY, owner_profile_id text, status text)");
  await pool.query("CREATE TABLE helix_shared_realtime_room_members(room_id text, profile_id text, participant_id text, member_role text, presence text)");
  await pool.query("INSERT INTO helix_accounts VALUES ('owner'), ('guest')");
  await pool.query("INSERT INTO helix_shared_realtime_rooms VALUES ($1,'owner','ready')", [roomId]);
  await pool.query("INSERT INTO helix_shared_realtime_room_members VALUES ($1,'owner','participant:owner','owner','present')", [roomId]);
  const db = await pool.connect();
  try { for (const migration of [migration094, migration097]) await migration.run(db, { enablePgvector: false }); }
  finally { db.release(); }
  const flush = vi.fn(async () => {});
  const transaction = vi.fn(async (run: (client: typeof db) => Promise<unknown>) => {
    const client = await pool.connect(); try { const result = await run(client); await flush(); return result; } finally { client.release(); }
  });
  const membership = vi.fn(async () => ({ roomId, profileId: "owner", participantId: "participant:owner", role: "owner", presence: "present", roomStatus: "ready" }));
  const makeAttachments = () => new RoomOwnerNodeAttachmentStore({ transaction: transaction as typeof withSharedRealtimeRoomTransaction,
    readMembership: membership as never, authority: () => authority, now: () => now });
  const attachments = makeAttachments();
  const principal: HelixAgentApiPrincipal = { tenantId: "tenant:one", issuer: "https://auth.test", subjectId: "subject:owner", accountProfileId: "owner",
    accountType: "developer", scopes: new Set(["helix.rooms.read", "helix.rooms.manage"]), tokenExpiresAt: "2099-01-01T00:00:00Z",
    accountContext: { session_id: "oauth:owner", profile_id: "owner", trusted_account_session: true, account_session: null,
      account_policy: buildHelixAccountCapabilityPolicy("developer") } };
  const key = crypto.generateKeyPairSync("ed25519");
  const sign = (fields: Partial<Omit<OwnerNodeRequest, "signature">> = {}, signer = key) => signOwnerNodeRequest(authority, {
    operation: "handoff_claim", room_id: roomId, expected_revision: 1, request_id: "claim-request-001", issued_at_ms: now,
    node_public_key: signer.publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
    handoff_id: "handoff:one", transcript_text_hash: `sha256:${"a".repeat(64)}`, dispatch_digest: "b".repeat(64), ...fields }, signer.privateKey);
  const reserve = (signer = key, revision: number | null = null) => sign({ operation: "reserve", expected_revision: revision,
    request_id: `reserve-${revision ?? 0}-fixture`, handoff_id: undefined, transcript_text_hash: undefined, dispatch_digest: undefined }, signer);
  const reservation = await attachments.operate(principal, reserve());
  const threadId = `helix-ask:room:${roomId}`;
  const handoff = { handoff_id: "handoff:one", thread_id: threadId, realtime_session_id: "realtime:one",
    transcript_text_hash: `sha256:${"a".repeat(64)}`, transcript_text_char_count: 20 };
  const actor = { origin: "realtime_voice", room_id: roomId, requester_profile_id: "owner", realtime_session_id: "realtime:one",
    participant_id: "participant:guest", resolution: "resolved", resolution_source: "active_speaker_floor", captured_at_ms: now,
    voice_authority: { runtime_id: "runtime:one", consent_version: 1, consent_receipt_ref: "consent:guest" } };
  const revalidate = vi.fn(async () => true), read = vi.fn(() => handoff as typeof handoff | null);
  const makeService = (store = attachments) => new RoomOwnerNodeHandoffService({ attachments: store,
    read: read as never, actor: (() => structuredClone(actor)) as never, revalidate,
    sessions: (() => [{ realtimeSessionId: "realtime:one", threadId, createdAtMs: now - 1 }]) as never });
  const rows = async () => (await pool.query("SELECT * FROM helix_room_owner_handoff_claims")).rows;
  return { now, authority, pool, principal, key, sign, reserve, reservation, attachments, makeAttachments, makeService,
    service: makeService(), handoff, actor, revalidate, read, rows, transaction, flush, membership };
};

it("claims only verified capture evidence and returns the same claim on exact retry and service recovery", async () => {
  const f = await fixture();
  expect((await f.attachments.operate(f.principal, f.sign())).claim).toBeUndefined();
  expect(await f.rows()).toEqual([]);
  const first = await f.service.operate(f.principal, f.sign());
  expect(first.claim).toMatchObject({ status: "claimed", dispatch_authority: false, handoff_id: "handoff:one" });
  const recovered = f.makeService(f.makeAttachments());
  expect((await recovered.operate(f.principal, f.sign({ request_id: "claim-retry-002" }))).claim).toEqual(first.claim);
  expect((await recovered.operate(f.principal, f.sign({ operation: "handoff_claim_validate" }))).claim).toEqual(first.claim);
  expect(await f.rows()).toHaveLength(1);
  expect(JSON.stringify(first)).not.toMatch(/subject:owner|owner_identity_digest|node_public_key|private_key|transcript_text"/);
  expect(f.transaction).toHaveBeenCalledWith(expect.any(Function), { requireLocalSnapshot: true,
    snapshotTables: ["helix_room_owner_node_attachments", "helix_room_owner_handoff_claims"] });
});

it("binds claim proof to the operation, capture and dispatch digest", async () => {
  const f = await fixture(), signed = f.sign();
  expect(verifyOwnerNodeRequest(f.authority, signed, f.now)).toBe(true);
  for (const altered of [{ ...signed, operation: "handoff_claim_validate" as const }, { ...signed, dispatch_digest: "c".repeat(64) },
    { ...signed, handoff_id: "handoff:changed" }, { ...signed, transcript_text_hash: `sha256:${"d".repeat(64)}` }]) {
    expect(verifyOwnerNodeRequest(f.authority, altered, f.now)).toBe(false);
    await expect(f.service.operate(f.principal, altered)).rejects.toMatchObject({ code: "room_forbidden" });
  }
  expect(await f.rows()).toEqual([]);
});

it.each(["missing", "consent", "owner", "hash"])("does not consume a capture with invalid %s", async kind => {
  const f = await fixture();
  if (kind === "missing") f.read.mockReturnValue(null);
  if (kind === "consent") f.revalidate.mockResolvedValue(false);
  if (kind === "owner") f.actor.requester_profile_id = "other";
  if (kind === "hash") f.handoff.transcript_text_hash = `sha256:${"c".repeat(64)}`;
  await expect(f.service.operate(f.principal, f.sign())).rejects.toMatchObject({ code: "room_runtime_conflict" });
  expect(await f.rows()).toEqual([]);
});

it("rejects a missing claim and a different dispatch digest without releasing the existing capture", async () => {
  const f = await fixture();
  await expect(f.service.operate(f.principal, f.sign({ operation: "handoff_claim_validate" }))).rejects.toMatchObject({ code: "idempotency_conflict" });
  const first = await f.service.operate(f.principal, f.sign());
  for (const operation of ["handoff_claim", "handoff_claim_validate"] as const) {
    await expect(f.service.operate(f.principal, f.sign({ operation, dispatch_digest: "c".repeat(64) })))
      .rejects.toMatchObject({ code: "idempotency_conflict" });
  }
  expect((await f.service.operate(f.principal, f.sign())).claim).toEqual(first.claim);
});

it.each(["same-key", "new-key"])("keeps a capture consumed after %s attachment replacement while allowing a fresh capture", async kind => {
  const f = await fixture(); await f.service.operate(f.principal, f.sign());
  const secondKey = kind === "same-key" ? f.key : crypto.generateKeyPairSync("ed25519");
  await f.attachments.operate(f.principal, f.reserve(secondKey, 1));
  await expect(f.service.operate(f.principal, f.sign())).rejects.toMatchObject({ code: kind === "same-key" ? "room_runtime_conflict" : "room_forbidden" });
  await expect(f.makeService(f.makeAttachments()).operate(f.principal, f.sign({ expected_revision: 2 }, secondKey)))
    .rejects.toMatchObject({ code: "idempotency_conflict" });
  f.handoff.handoff_id = "handoff:new";
  expect((await f.service.operate(f.principal, f.sign({ expected_revision: 2, handoff_id: "handoff:new" }, secondKey))).claim)
    .toMatchObject({ handoff_id: "handoff:new", attachment_revision: 2 });
  expect(await f.rows()).toHaveLength(2);
});

it("admits only one of two competing dispatch digests", async () => {
  const f = await fixture();
  const results = await Promise.allSettled([f.service.operate(f.principal, f.sign()),
    f.service.operate(f.principal, f.sign({ dispatch_digest: "c".repeat(64), request_id: "competing-request-002" }))]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  expect(await f.rows()).toHaveLength(1);
});

it("rejects attachment replacement between capture validation and claim commit", async () => {
  const f = await fixture(), original = f.attachments.claimHandoff.bind(f.attachments);
  vi.spyOn(f.attachments, "claimHandoff").mockImplementationOnce(async (...args) => {
    await f.attachments.operate(f.principal, f.reserve(crypto.generateKeyPairSync("ed25519"), 1));
    return original(...args);
  });
  await expect(f.service.operate(f.principal, f.sign())).rejects.toMatchObject({ code: "room_forbidden" });
  expect(await f.rows()).toEqual([]);
});

it("serializes concurrent claims and recovers a lost claim commit reply", async () => {
  const f = await fixture();
  const original = f.attachments.claimHandoff.bind(f.attachments);
  const lost = vi.spyOn(f.attachments, "claimHandoff").mockImplementationOnce(async (...args) => {
    await original(...args); throw new Error("fixture commit response lost");
  });
  await expect(f.service.operate(f.principal, f.sign())).rejects.toThrow("fixture commit response lost"); lost.mockRestore();
  const [a, b] = await Promise.all([f.service.operate(f.principal, f.sign()), f.makeService().operate(f.principal, f.sign())]);
  expect(a.claim).toEqual(b.claim); expect(await f.rows()).toHaveLength(1);
});

it("retains the claim but withholds success when consent is revoked after commit", async () => {
  const f = await fixture(), original = f.attachments.claimHandoff.bind(f.attachments);
  vi.spyOn(f.attachments, "claimHandoff").mockImplementationOnce(async (...args) => {
    const result = await original(...args); f.revalidate.mockResolvedValue(false); return result;
  });
  await expect(f.service.operate(f.principal, f.sign())).rejects.toMatchObject({ code: "room_runtime_conflict" });
  expect(await f.rows()).toHaveLength(1);
  await expect(f.service.operate(f.principal, f.sign({ operation: "handoff_claim_validate" }))).rejects.toMatchObject({ code: "room_runtime_conflict" });
});

it.each(["token", "scope", "identity", "owner_presence"])("denies a claim with changed %s authority", async kind => {
  const f = await fixture();
  if (kind === "token") f.principal.tokenExpiresAt = new Date(f.now - 1).toISOString();
  if (kind === "scope") f.principal.scopes = new Set(["helix.rooms.read"]);
  if (kind === "identity") f.principal.subjectId = "subject:changed";
  if (kind === "owner_presence") await f.pool.query("UPDATE helix_shared_realtime_room_members SET presence='left'");
  await expect(f.service.operate(f.principal, f.sign())).rejects.toThrow(); expect(await f.rows()).toEqual([]);
});

it("enforces the same capture claim through two independent native connection keys", async () => {
  const f = await fixture(), roomId = f.sign().room_id;
  const account = { profileId: "local-owner", sessionId: "local-session" };
  const capture = { handoff_id: f.handoff.handoff_id, realtime_session_id: f.actor.realtime_session_id,
    runtime_id: f.actor.voice_authority.runtime_id, speaker_participant_id: f.actor.participant_id,
    captured_at_ms: f.actor.captured_at_ms, consent_version: f.actor.voice_authority.consent_version,
    consent_receipt_ref: f.actor.voice_authority.consent_receipt_ref, transcript_text_hash: f.handoff.transcript_text_hash,
    transcript_text_char_count: f.handoff.transcript_text_char_count };
  const transport = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "GET") return new Response(JSON.stringify({ schema: "helix.shared_live_room.list_receipt.v1", operation: "room.list",
      ok: true, rooms: [], reentry_required: true, answer_authority: false, assistant_answer: false, terminal_eligible: false, raw_content_included: false }));
    const body = JSON.parse(String(init?.body));
    try {
      const result = body.operation.startsWith("handoff_") ? await f.service.operate(f.principal, body) : await f.attachments.operate(f.principal, body);
      return new Response(JSON.stringify(result));
    } catch (error) {
      const failure = error as { status?: number; code?: string };
      return new Response(JSON.stringify({ error: failure.code ?? "internal_error" }), { status: failure.status ?? 503 });
    }
  });
  const make = () => new NativeSharedLiveRoomConnection({ origin: f.authority, now: () => f.now, fetch: transport,
    verifier: { audience: () => `${f.authority}/mcp`, authorizationServer: () => f.principal.issuer, providerAlias: () => "auth0",
      verify: async () => ({ issuer: f.principal.issuer, subject: f.principal.subjectId, tenantId: f.principal.tenantId,
        scopes: f.principal.scopes, expiresAt: f.principal.tokenExpiresAt!, claims: {} }) } });
  const first = make(), second = make(), digest = "e".repeat(64);
  await first.connect(account, "synthetic-native-claim-token-one");
  const a = nativeHostedRoomAttachmentSchema.parse((await first.reserveOwnerNode(account, roomId, 1, "first-native-reservation")).attachment);
  const claim = await first.claimOwnerNodeHandoff(account, roomId, a, capture, digest);
  expect(await first.claimOwnerNodeHandoff(account, roomId, a, capture, digest)).toEqual(claim);
  await first.validateOwnerNodeHandoffClaim(account, roomId, a, capture, digest);
  await second.connect(account, "synthetic-native-claim-token-two");
  const b = nativeHostedRoomAttachmentSchema.parse((await second.reserveOwnerNode(account, roomId, 2, "second-native-reservation")).attachment);
  expect(b.node_ref).not.toBe(a.node_ref);
  await expect(second.claimOwnerNodeHandoff(account, roomId, b, capture, digest)).rejects.toMatchObject({ code: "idempotency_conflict" });
  await expect(second.validateOwnerNodeHandoffClaim(account, roomId, b, capture, digest)).rejects.toMatchObject({ code: "idempotency_conflict" });
  await expect(first.validateOwnerNodeHandoffClaim(account, roomId, a, capture, digest)).rejects.toMatchObject({ code: "room_forbidden" });
  f.handoff.handoff_id = "handoff:new-native";
  expect(await second.claimOwnerNodeHandoff(account, roomId, b, { ...capture, handoff_id: f.handoff.handoff_id }, "f".repeat(64)))
    .toMatchObject({ handoff_id: f.handoff.handoff_id, node_ref: b.node_ref });
  expect(await f.rows()).toHaveLength(2);
  first.disconnect(); second.disconnect();
});
