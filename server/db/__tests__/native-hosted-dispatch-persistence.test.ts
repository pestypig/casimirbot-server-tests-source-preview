import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { migration096 } from "../migrations/096_native_hosted_room_dispatches";
import { NativeRoomDispatchStore, type NativeRoomDispatchIntent } from "../../services/shared-live-room-control/native-room-dispatch-store";
import { durableSteeringEventId } from "../../services/local-supervisor/durable-steering-contract";
import { ensureDatabase, getPool, resetDbClient } from "../client";

vi.mock("../migrator", () => ({ runMigrations: async (pool: { connect(): Promise<any> }) => {
  const db = await pool.connect();
  try {
    await db.query("CREATE TABLE helix_accounts(profile_id text PRIMARY KEY)");
    await migration096.run(db, { enablePgvector: false });
  } finally { db.release(); }
} }));

it("requires actual snapshot persistence before acknowledging intent and retains its tombstone after reopen", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "casimir-hosted-dispatch-"));
  const snapshot = path.join(directory, "snapshot.json");
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("HELIX_LOCAL_DB_PATH", snapshot); vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "1");
  vi.stubEnv("HELIX_LOCAL_PG_MEM_WRITE_MODE", "deferred");
  const input: NativeRoomDispatchIntent = { pairingId: "pairing:private", envelope: {
    schema: "helix.room_mission_steering.v1", roomId: "shared_realtime_room:remote", ownerProfileId: "profile:owner",
    roomMissionId: "selection:original", roomMissionRevision: 1, handoffId: "handoff:private",
    realtimeSessionId: "realtime:private", runtimeId: "runtime:private", speakerParticipantId: "participant:guest",
    capturedAtMs: 1790340000000, consentVersion: 1, consentReceiptRef: "consent:private", transcriptTextHash: `sha256:${"a".repeat(64)}`,
    bindingId: "binding:private", bindingEpoch: 1, authenticatedMcpClientRef: "client:private",
    clientSessionRef: "session:private", clientContinuationRef: "task:private", helixConversationId: "chat:private",
    bindingMissionId: null, runId: null, hosted: { authority: "https://rooms.test", local_account_session_id: "session:private",
      connection_ref: "connection:private", device_ref: `installation:${"b".repeat(64)}`, device_trust_revision: 1,
      transcript_text_char_count: 20, attachment: { attachment_ref: "room_owner_attachment:11111111-1111-4111-8111-111111111111",
        revision: 1, node_ref: `room_node:sha256:${"c".repeat(64)}`, status: "reserved", expires_at: "2099-01-01T00:00:00Z",
        local_task_verified: false, dispatch_authority: false } } } };
  try {
    await resetDbClient(); await ensureDatabase();
    await getPool().query("INSERT INTO helix_accounts VALUES ('profile:owner')");
    const store = new NativeRoomDispatchStore();
    const rename = vi.spyOn(fs.promises, "rename").mockRejectedValue(new Error("fixture disk unavailable"));
    try { await expect(store.prepare(input)).rejects.toThrow(); }
    finally { rename.mockRestore(); }
    expect((await getPool().query("SELECT * FROM helix_native_hosted_room_dispatches")).rows).toHaveLength(1);
    const pending = await store.prepare(input);
    const event = durableSteeringEventId(input.envelope.ownerProfileId, input.pairingId, pending.client_event_ref);
    const queued = await store.finish(input, event);
    const saved = fs.readFileSync(snapshot, "utf8");
    expect(JSON.parse(saved).tables.helix_native_hosted_room_dispatches).toHaveLength(1);
    expect(saved).not.toMatch(/task:private|session:private|handoff:private|binding:private|chat:private/);
    await resetDbClient(); await ensureDatabase();
    expect(await new NativeRoomDispatchStore().prepare(input)).toEqual(queued);
    await expect(new NativeRoomDispatchStore().prepare({ ...input, pairingId: "pairing:replacement" }))
      .rejects.toMatchObject({ code: "hosted_room_capture_dispatch_conflict" });
    expect((await getPool().query("SELECT * FROM helix_native_hosted_room_dispatches")).rows).toHaveLength(1);
  } finally {
    await resetDbClient(); vi.unstubAllEnvs();
    // Only this test's known files; never recursively clean a computed directory.
    for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
    fs.rmdirSync(directory);
  }
}, 30000);
