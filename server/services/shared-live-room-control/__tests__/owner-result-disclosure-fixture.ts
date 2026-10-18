import crypto from "node:crypto";
import { newDb } from "pg-mem";
import { vi } from "vitest";
import type { Pool } from "pg";
import { buildHelixAccountCapabilityPolicy } from "@shared/helix-account-session";
import { migration094 } from "../../../db/migrations/094_room_owner_node_attachments";
import { migration097 } from "../../../db/migrations/097_room_owner_handoff_claims";
import { migration099 } from "../../../db/migrations/099_room_task_disclosures";
import { RoomOwnerNodeAttachmentStore } from "../owner-node-attachment-store";
import { RoomOwnerNodeHandoffService } from "../owner-node-handoff-service";
import { RoomOwnerResultDisclosureService } from "../owner-result-disclosure-service";
import { signOwnerNodeRequest, type OwnerNodeRequest } from "../owner-node-proof";
import { signOwnerResultDisclosure } from "../result-disclosure-proof";
import type { HelixAgentApiPrincipal } from "../../helix-agent-api/types";
import type { withSharedRealtimeRoomTransaction } from "../../helix-ask/realtime-room/room-store/database";

export async function disclosureFixture(existingPool?: Pool) {
  const pool = existingPool ?? new (newDb().adapters.createPg().Pool)();
  const clock = { value: Date.now() }, authority = "https://rooms.test", roomId = "shared_realtime_room:disclose";
  if (!existingPool) {
    await pool.query("CREATE TABLE helix_accounts(profile_id text PRIMARY KEY)");
    await pool.query("CREATE TABLE helix_shared_realtime_rooms(room_id text PRIMARY KEY,owner_profile_id text,status text)");
    await pool.query("CREATE TABLE helix_shared_realtime_room_members(room_id text,profile_id text,participant_id text,member_role text,presence text)");
    const db = await pool.connect();
    try { for (const migration of [migration094, migration097, migration099]) await migration.run(db, { enablePgvector: false }); }
    finally { db.release(); }
  }
  await pool.query("INSERT INTO helix_accounts VALUES ('owner'),('guest')");
  await pool.query("INSERT INTO helix_shared_realtime_rooms VALUES ($1,'owner','ready')", [roomId]);
  await pool.query("INSERT INTO helix_shared_realtime_room_members VALUES ($1,'owner','participant:owner','owner','present'),($1,'guest','participant:guest','guest','present')", [roomId]);
  const flush = vi.fn(async () => {});
  const lock = { depth: 0, rejectNested: false };
  const transaction = vi.fn(async (run: (db: typeof pool) => Promise<unknown>, _options?: unknown) => {
    if (lock.rejectNested && lock.depth) throw new Error("nested attachment transaction");
    lock.depth++;
    try { const result = await run(pool); await flush(); return result; } finally { lock.depth--; }
  });
  const membership = vi.fn(async () => ({ roomId, profileId: "owner", participantId: "participant:owner", role: "owner", presence: "present", roomStatus: "ready" }));
  const attachments = new RoomOwnerNodeAttachmentStore({ transaction: transaction as typeof withSharedRealtimeRoomTransaction,
    readMembership: membership as never, authority: () => authority, now: () => clock.value });
  const principal: HelixAgentApiPrincipal = { tenantId: "tenant:one", issuer: "https://auth.test", subjectId: "subject:owner",
    accountProfileId: "owner", accountType: "developer", scopes: new Set(["helix.rooms.read", "helix.rooms.manage"]),
    tokenExpiresAt: "2099-01-01T00:00:00Z", accountContext: { session_id: "oauth:owner", profile_id: "owner",
      trusted_account_session: true, account_session: null, account_policy: buildHelixAccountCapabilityPolicy("developer") } };
  const key = crypto.generateKeyPairSync("ed25519");
  const sign = (fields: Partial<Omit<OwnerNodeRequest, "signature">> = {}, signer = key) => signOwnerNodeRequest(authority, {
    operation: "handoff_claim_validate", room_id: roomId, expected_revision: 1,
    request_id: `fixture:${crypto.randomUUID()}`, issued_at_ms: clock.value,
    node_public_key: signer.publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
    handoff_id: "handoff:guest", transcript_text_hash: `sha256:${"a".repeat(64)}`, dispatch_digest: "b".repeat(64), ...fields,
  }, signer.privateKey);
  const reserve = (signer = key, expected: number | null = null) => sign({ operation: "reserve", expected_revision: expected,
    handoff_id: undefined, transcript_text_hash: undefined, dispatch_digest: undefined }, signer);
  const reserved = await attachments.operate(principal, reserve());
  const threadId = `helix-ask:room:${roomId}`;
  const capture = { handoff_id: "handoff:guest", realtime_session_id: "realtime:one", runtime_id: "runtime:one",
    speaker_participant_id: "participant:guest", captured_at_ms: clock.value, consent_version: 1,
    consent_receipt_ref: "consent:guest", transcript_text_hash: `sha256:${"a".repeat(64)}`, transcript_text_char_count: 20 };
  const valid = { capture: true };
  const handoffs = new RoomOwnerNodeHandoffService({ attachments,
    read: (() => valid.capture ? { ...capture, thread_id: threadId } : null) as never,
    actor: (() => ({ origin: "realtime_voice", room_id: roomId, requester_profile_id: "owner",
      realtime_session_id: capture.realtime_session_id, participant_id: capture.speaker_participant_id,
      resolution: "resolved", resolution_source: "active_speaker_floor", captured_at_ms: capture.captured_at_ms,
      voice_authority: { runtime_id: capture.runtime_id, consent_version: capture.consent_version, consent_receipt_ref: capture.consent_receipt_ref } })) as never,
    revalidate: async () => valid.capture,
    sessions: (() => [{ realtimeSessionId: capture.realtime_session_id, threadId, createdAtMs: capture.captured_at_ms - 1 }]) as never,
  });
  const claim = (await handoffs.operate(principal, sign({ operation: "handoff_claim" }))).claim!;
  const report = { task_status: "unable" as "unable" | "completed", result_text: "The route remains blocked; review another approach.",
    result_sha256: "", share_with_room: true as const };
  report.result_sha256 = crypto.createHash("sha256").update(report.result_text).digest("hex");
  const request = () => signOwnerResultDisclosure(authority, { authorization: sign(), report }, key.privateKey);
  const service = new RoomOwnerResultDisclosureService({ handoffs, transaction: transaction as typeof withSharedRealtimeRoomTransaction,
    authority: () => authority, now: () => clock.value });
  return { pool, clock, authority, roomId, principal, key, sign, reserve, reserved, capture, claim, report, request,
    service, handoffs, attachments, transaction, flush, valid, membership, lock };
}
