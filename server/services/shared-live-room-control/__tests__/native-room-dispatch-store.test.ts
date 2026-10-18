import { newDb } from "pg-mem";
import { afterEach, expect, it, vi } from "vitest";
import { migration096 } from "../../../db/migrations/096_native_hosted_room_dispatches";
import { NativeRoomDispatchStore, type NativeRoomDispatchIntent } from "../native-room-dispatch-store";
import { durableSteeringEventId } from "../../local-supervisor/durable-steering-contract";
import type { withSharedRealtimeRoomTransaction } from "../../helix-ask/realtime-room/room-store/database";

const pools: Array<{ end(): Promise<void> }> = [];
afterEach(async () => { await Promise.all(pools.splice(0).map(pool => pool.end())); });
const fixture = async () => {
  const pool = new (newDb().adapters.createPg().Pool)(); pools.push(pool);
  await pool.query("CREATE TABLE helix_accounts(profile_id text PRIMARY KEY)");
  await pool.query("INSERT INTO helix_accounts VALUES ('profile:owner'), ('profile:other')");
  const client = await pool.connect();
  try { await migration096.run(client, { enablePgvector: false }); } finally { client.release(); }
  const flush = vi.fn(async () => {});
  const transaction = vi.fn(async (run: (db: typeof client) => Promise<unknown>) => {
    const db = await pool.connect();
    try { const result = await run(db); await flush(); return result; } finally { db.release(); }
  });
  const make = () => new NativeRoomDispatchStore(transaction as typeof withSharedRealtimeRoomTransaction);
  const input: NativeRoomDispatchIntent = { pairingId: "pairing:original", envelope: {
    schema: "helix.room_mission_steering.v1", roomId: "shared_realtime_room:remote", ownerProfileId: "profile:owner",
    roomMissionId: "native_room_selection:original", roomMissionRevision: 1, handoffId: "handoff:captured",
    realtimeSessionId: "realtime:original", runtimeId: "runtime:original", speakerParticipantId: "participant:guest",
    capturedAtMs: 1790340000000, consentVersion: 2, consentReceiptRef: "consent:guest", transcriptTextHash: `sha256:${"a".repeat(64)}`,
    bindingId: "binding:original", bindingEpoch: 1, authenticatedMcpClientRef: "client:original",
    clientSessionRef: "client-session:original", clientContinuationRef: "task:private-original",
    helixConversationId: "chat:private-original", bindingMissionId: null, runId: null,
    hosted: { authority: "https://rooms.test", local_account_session_id: "session:private-owner",
      connection_ref: "process:original", device_ref: `installation:${"b".repeat(64)}`, device_trust_revision: 2,
      attachment: { attachment_ref: "room_owner_attachment:11111111-1111-4111-8111-111111111111", revision: 3,
        node_ref: `room_node:sha256:${"c".repeat(64)}`, status: "reserved", expires_at: "2099-01-01T00:00:00Z",
        local_task_verified: false, dispatch_authority: false }, transcript_text_char_count: 20 } } };
  const eventFor = (clientEventRef: string) => durableSteeringEventId(input.envelope.ownerProfileId, input.pairingId, clientEventRef);
  const rows = async () => (await pool.query("SELECT * FROM helix_native_hosted_room_dispatches")).rows;
  return { pool, input, make, store: make(), flush, transaction, eventFor, rows };
};

it("retains one capture identity under concurrent preparation and repository recovery", async () => {
  const f = await fixture();
  const [a, b] = await Promise.all([f.store.prepare(f.input), f.make().prepare(f.input)]);
  expect(a).toEqual(b); expect(a.status).toBe("pending");
  expect(await f.make().prepare({ ...f.input, expiresInSeconds: 600 })).toEqual(a);
  expect(await f.rows()).toHaveLength(1);
  expect(JSON.stringify(await f.rows())).not.toMatch(/task:private|chat:private|session:private|pairing:original|handoff:captured/);
  expect(f.transaction).toHaveBeenCalledWith(expect.any(Function), {
    requireLocalSnapshot: true, snapshotTables: ["helix_native_hosted_room_dispatches"],
  });
});

it.each(["selection", "revision", "pairing", "task", "binding", "device", "connection", "trust", "attachment", "speaker", "hash", "ttl"])(
  "rejects a changed %s using the same capture without replacing its original intent", async kind => {
    const f = await fixture(); const original = await f.store.prepare(f.input);
    const changed = structuredClone(f.input), row = changed.envelope;
    if (kind === "selection") row.roomMissionId = "native_room_selection:replacement";
    if (kind === "revision") row.roomMissionRevision += 1;
    if (kind === "pairing") changed.pairingId = "pairing:replacement";
    if (kind === "task") row.clientContinuationRef = "task:replacement";
    if (kind === "binding") row.bindingEpoch += 1;
    if (kind === "device") row.hosted!.device_ref = `installation:${"d".repeat(64)}`;
    if (kind === "connection") row.hosted!.connection_ref = "process:replacement";
    if (kind === "trust") row.hosted!.device_trust_revision += 1;
    if (kind === "attachment") row.hosted!.attachment.revision += 1;
    if (kind === "speaker") row.speakerParticipantId = "participant:replacement";
    if (kind === "hash") row.transcriptTextHash = `sha256:${"e".repeat(64)}`;
    if (kind === "ttl") changed.expiresInSeconds = 3600;
    await expect(f.make().prepare(changed)).rejects.toMatchObject({ code: "hosted_room_capture_dispatch_conflict" });
    expect(await f.store.prepare(f.input)).toEqual(original); expect(await f.rows()).toHaveLength(1);
  },
);

it("recovers uncertain persistence replies without creating another event or resetting queued status", async () => {
  const f = await fixture(); f.flush.mockRejectedValueOnce(new Error("fixture snapshot reply lost"));
  await expect(f.store.prepare(f.input)).rejects.toThrow("fixture snapshot reply lost");
  const pending = await f.make().prepare(f.input), event = f.eventFor(pending.client_event_ref);
  f.flush.mockRejectedValueOnce(new Error("fixture finish reply lost"));
  await expect(f.store.finish(f.input, event)).rejects.toThrow("fixture finish reply lost");
  const queued = await f.make().finish(f.input, event);
  expect(queued).toMatchObject({ ...pending, status: "queued", event_ref: event });
  expect(await f.make().prepare(f.input)).toEqual(queued);
  expect(await f.make().finish(f.input, event)).toEqual(queued);
  expect(await f.rows()).toHaveLength(1);
});

it("converges concurrent finish replies on the same queued event", async () => {
  const f = await fixture(), pending = await f.store.prepare(f.input);
  const event = f.eventFor(pending.client_event_ref);
  const [a, b] = await Promise.all([f.store.finish(f.input, event), f.make().finish(f.input, event)]);
  expect(a).toEqual(b); expect(a.event_ref).toBe(event);
  expect(await f.rows()).toHaveLength(1);
});

it("rejects finishing an unprepared intent, a different task event or a changed capture request", async () => {
  const f = await fixture(); const pending = await f.store.prepare(f.input);
  await expect(f.store.finish(f.input, "reasoning_steering:wrong")).rejects.toMatchObject({ code: "hosted_room_dispatch_event_mismatch" });
  const changed = structuredClone(f.input); changed.pairingId = "pairing:replacement";
  await expect(f.store.finish(changed, durableSteeringEventId(changed.envelope.ownerProfileId, changed.pairingId, pending.client_event_ref)))
    .rejects.toMatchObject({ code: "hosted_room_capture_dispatch_conflict" });
  await f.pool.query("DELETE FROM helix_native_hosted_room_dispatches");
  await expect(f.store.finish(f.input, f.eventFor(pending.client_event_ref))).rejects.toMatchObject({ code: "hosted_room_capture_dispatch_conflict" });
});

it.each(["capture", "room", "authority", "owner"])("keeps a different %s independently scoped", async kind => {
  const f = await fixture(); const first = await f.store.prepare(f.input), changed = structuredClone(f.input);
  if (kind === "capture") changed.envelope.handoffId = "handoff:another";
  if (kind === "room") changed.envelope.roomId = "shared_realtime_room:another";
  if (kind === "authority") changed.envelope.hosted!.authority = "https://other.test";
  if (kind === "owner") changed.envelope.ownerProfileId = "profile:other";
  expect((await f.store.prepare(changed)).client_event_ref).not.toBe(first.client_event_ref);
  expect(await f.rows()).toHaveLength(2);
});

it("rejects local-only envelopes and extra plaintext fields before persistence", async () => {
  const f = await fixture(), local = structuredClone(f.input); delete local.envelope.hosted;
  await expect(f.store.prepare(local)).rejects.toThrow();
  await expect(f.store.prepare({ ...f.input, instructionText: "Private transcript must not be stored here." } as NativeRoomDispatchIntent)).rejects.toThrow();
  expect(await f.rows()).toEqual([]);
});
