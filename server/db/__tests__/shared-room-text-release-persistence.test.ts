import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { migration092 } from "../migrations/092_room_external_mission";
import { migration093 } from "../migrations/093_room_external_task_result";
import { migration102 } from "../migrations/102_shared_room_text_messages";
import { migration103 } from "../migrations/103_shared_room_interpreter_sessions";
import { migration104 } from "../migrations/104_shared_room_text_releases";
import { migration105 } from "../migrations/105_shared_room_interpreter_mcp_leases";
import { migration106 } from "../migrations/106_room_mission_dispatch_index";
import { ensureDatabase, getPool, requireDurableDatabaseSnapshot, resetDbClient } from "../client";

vi.mock("../migrator", () => ({ runMigrations: async (pool: { connect(): Promise<any> }) => {
  const db = await pool.connect();
  try {
    await db.query("CREATE TABLE helix_accounts(profile_id text PRIMARY KEY)");
    await db.query("CREATE TABLE helix_account_sessions(session_id text PRIMARY KEY)");
    await db.query("CREATE TABLE helix_shared_realtime_rooms(room_id text PRIMARY KEY)");
    await db.query("CREATE TABLE helix_shared_realtime_room_members(participant_id text PRIMARY KEY)");
    for (const migration of [migration092, migration093, migration102, migration103, migration104, migration105, migration106])
      await migration.run(db, { enablePgvector: false });
  } finally { db.release(); }
} }));

it("reopens room mission, dispatch intent, result and interpreter consent from the local snapshot", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "casimir-room-text-release-"));
  const snapshot = path.join(directory, "snapshot.json");
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("HELIX_LOCAL_DB_PATH", snapshot); vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "1");
  try {
    await resetDbClient(); await ensureDatabase();
    const db = getPool();
    await db.query("INSERT INTO helix_accounts VALUES ('owner')");
    await db.query("INSERT INTO helix_account_sessions VALUES ('session')");
    await db.query("INSERT INTO helix_shared_realtime_rooms VALUES ('room')");
    await db.query("INSERT INTO helix_shared_realtime_room_members VALUES ('author')");
    await db.query(`INSERT INTO helix_room_external_missions
      (room_id, owner_profile_id, owner_participant_id, mission_id, mission_revision,
       status, reasoning_binding_id, binding_epoch, helix_conversation_id,
       request_id, request_digest, created_at, updated_at)
      VALUES ('room', 'owner', 'author', 'mission', 1, 'active', 'binding', 1,
        'chat', 'request', 'digest', now(), now())`);
    await db.query(`INSERT INTO helix_room_external_task_results
      (result_id, owner_profile_id, room_id, room_mission_id,
       room_mission_revision, steering_event_ref, request_digest,
       encrypted_payload, encryption_key_id)
      VALUES ('result', 'owner', 'room', 'mission', 1, 'steering',
        'digest', 'encrypted', 'key')`);
    await db.query(`INSERT INTO helix_shared_realtime_room_text_messages
      (message_id, room_id, participant_id, client_message_id, body)
      VALUES ('message', 'room', 'author', 'client', 'not released to a model')`);
    await db.query(`INSERT INTO helix_shared_room_interpreter_sessions
      (interpreter_session_id, room_id, owner_profile_id, generation, state, provider)
      VALUES ('interpreter', 'room', 'owner', 1, 'configuration_pending', 'openai_agents_api')`);
    await db.query(`INSERT INTO helix_shared_room_text_releases
      (release_id, room_id, message_id, author_participant_id, interpreter_session_id,
       interpreter_generation, consent_revision, state, revoked_at)
      VALUES ('release', 'room', 'message', 'author', 'interpreter', 1, 2, 'revoked', now())`);
    await db.query(`INSERT INTO helix_shared_room_interpreter_mcp_leases
      (lease_id, room_id, interpreter_session_id, interpreter_generation,
       owner_profile_id, owner_account_session_id, native_mcp_client_ref, token_hash, expires_at, revoked_at)
      VALUES ('lease', 'room', 'interpreter', 1, 'owner', 'session', 'native:client',
        $1, '2099-01-01T00:00:00Z', now())`, ["a".repeat(64)]);
    await db.query(`INSERT INTO helix_room_mission_dispatch_index
      (dispatch_id, room_id, owner_profile_id, room_mission_id, room_mission_revision,
       reasoning_binding_id, binding_epoch, speaker_participant_id, client_event_ref,
       status, instruction_sha256, instruction_length)
      VALUES ('dispatch', 'room', 'owner', 'mission', 1, 'binding', 1,
        'author', 'client-event', 'pending', $1, 12)`, ["b".repeat(64)]);
    await requireDurableDatabaseSnapshot(["helix_shared_room_text_releases"]);
    const saved = JSON.parse(fs.readFileSync(snapshot, "utf8"));
    expect(saved.tables.helix_shared_room_interpreter_sessions).toHaveLength(1);
    expect(saved.tables.helix_shared_room_text_releases).toHaveLength(1);
    expect(saved.tables.helix_shared_room_interpreter_mcp_leases).toHaveLength(1);
    expect(saved.tables.helix_room_mission_dispatch_index).toHaveLength(1);
    expect(saved.tables.helix_room_external_missions).toHaveLength(1);
    expect(saved.tables.helix_room_external_task_results).toHaveLength(1);
    await resetDbClient(); await ensureDatabase();
    const { rows } = await getPool().query(`SELECT r.state, r.consent_revision, s.generation
      FROM helix_shared_room_text_releases r
      JOIN helix_shared_room_interpreter_sessions s
      ON s.interpreter_session_id = r.interpreter_session_id`);
    expect(rows).toMatchObject([{ state: "revoked", consent_revision: 2, generation: 1 }]);
    expect((await getPool().query("SELECT revoked_at FROM helix_shared_room_interpreter_mcp_leases WHERE lease_id = 'lease'"))
      .rows[0]?.revoked_at).toBeTruthy();
    expect((await getPool().query("SELECT status, steering_event_ref FROM helix_room_mission_dispatch_index WHERE dispatch_id = 'dispatch'"))
      .rows).toMatchObject([{ status: "pending", steering_event_ref: null }]);
    expect((await getPool().query("SELECT mission_revision, status FROM helix_room_external_missions WHERE room_id = 'room'"))
      .rows).toMatchObject([{ mission_revision: 1, status: "active" }]);
    expect((await getPool().query("SELECT steering_event_ref FROM helix_room_external_task_results WHERE result_id = 'result'"))
      .rows).toMatchObject([{ steering_event_ref: "steering" }]);
    await getPool().query(`INSERT INTO helix_shared_realtime_room_text_messages
      (message_id, room_id, participant_id, client_message_id, body)
      VALUES ('message-after-restart', 'room', 'author', 'client-after-restart', 'new human text')`);
    expect((await getPool().query(`SELECT message_id, sequence FROM helix_shared_realtime_room_text_messages
      ORDER BY sequence`)).rows).toMatchObject([
      { message_id: "message", sequence: 1 },
      { message_id: "message-after-restart", sequence: 2 },
    ]);
  } finally {
    await resetDbClient(); vi.unstubAllEnvs();
    for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
    fs.rmdirSync(directory);
  }
}, 30000);
