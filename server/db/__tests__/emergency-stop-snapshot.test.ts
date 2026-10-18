import { expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs";
import * as rooms from "../../services/helix-ask/realtime-room/room-store";
import { emergencyStopEnvironmentActionAuthority } from "../../services/environment-connectors/actions/authority-store";

vi.mock("../../services/runtime/runtime-memory-governor", () => ({ scheduleRuntimeIdleMemorySettle: () => undefined }));
vi.mock("../../services/local-supervisor/desktop-mcp-tunnel-safety", () => ({ requestDesktopMcpTunnelReadOnlyForSafety: async () => true }));
// Bounded schema: this test targets actual transaction/snapshot/reload behavior,
// not the complete migrated authority hierarchy or production authentication.
vi.mock("../migrator", () => ({ runMigrations: async (pool: any) => {
  await pool.query(`CREATE TABLE helix_environment_action_authorities (
    action_authority_id text PRIMARY KEY,environment_binding_id text,room_source_binding_id text,
    room_id text,source_id text,world_id text,adapter_profile_id text,domain_adapter text,
    participant_id text,subject_binding_id text,allowed_capability_ids jsonb,autonomy_mode text,
    manual_override_policy text,status text,policy_version integer,created_at timestamptz,
    expires_at timestamptz,revoked_at timestamptz,updated_at timestamptz DEFAULT now()
  ); CREATE TABLE helix_environment_action_requests (
    action_request_id text PRIMARY KEY,action_authority_id text,status text,cancellation_reason text,
    completed_at timestamptz,updated_at timestamptz
  ); CREATE TABLE helix_environment_action_control_requests (
    control_request_id text PRIMARY KEY,action_authority_id text,workflow_id text,control_kind text,
    request_payload jsonb,request_hash text,deadline_at timestamptz,status text DEFAULT 'pending',
    created_at timestamptz DEFAULT now()
  );`);
} }));

it.each([false, true])("persists a stop and recovers the same finite control after database reload (rename failure=%s)", async failRename => {
  const directory = mkdtempSync(path.join(tmpdir(), "casimir-emergency-snapshot-"));
  const snapshotPath = path.join(directory, "snapshot.json");
  vi.stubEnv("DATABASE_URL", ""); vi.stubEnv("HELIX_LOCAL_DB_PATH", snapshotPath);
  vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "1"); vi.stubEnv("HELIX_LOCAL_PG_MEM_WRITE_MODE", "deferred");
  const db = await import("../client");
  const tables = ["helix_environment_action_authorities", "helix_environment_action_requests", "helix_environment_action_control_requests"];
  vi.spyOn(rooms, "readSharedRealtimeRoomMembership").mockResolvedValue({ role: "owner", participantId: "owner" } as never);
  let restoreConnect: (() => void) | undefined;
  const attachEnvironmentRead = () => {
    const pool = db.getPool();
    const connect = pool.connect.bind(pool);
    const spy = vi.spyOn(pool, "connect").mockImplementation((async () => {
      const client = await connect();
      return new Proxy(client, { get(target, property) {
        if (property === "query") return (sql: string, values?: unknown[]) => sql.includes("FROM helix_environment_connector_bindings b")
          ? Promise.resolve({ rows: [{ environment_binding_id: "environment", room_id: "room" }] }) : target.query(sql, values);
        const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
      } });
    }) as never);
    restoreConnect = () => spy.mockRestore();
  };
  try {
    await db.ensureDatabase();
    await db.getPool().query(`INSERT INTO helix_environment_action_authorities VALUES
      ('authority','environment','room-source','room','source','world','adapter','adapter','player','subject',
      '["walk"]','approved_capabilities','cancel','active',1,now(),NULL,NULL,now());
      INSERT INTO helix_environment_action_requests (action_request_id,action_authority_id,status) VALUES ('root','authority','running');`);
    await db.requireDurableDatabaseSnapshot(tables);
    attachEnvironmentRead();
    const input = { roomId: "room", profileId: "owner", environmentBindingId: "environment", actionAuthorityId: "authority", reason: "fixture stop" };
    let failedControlId: string | undefined;
    if (failRename) {
      const rename = vi.spyOn(fs.promises, "rename").mockRejectedValue(new Error("fixture_snapshot_rename_failed"));
      try { await expect(emergencyStopEnvironmentActionAuthority(input)).rejects.toThrow("fixture_snapshot_rename_failed"); }
      finally { rename.mockRestore(); }
      const oldDisk = JSON.parse(readFileSync(snapshotPath, "utf8"));
      expect(oldDisk.tables.helix_environment_action_authorities[0].status).toBe("active");
      expect(oldDisk.tables.helix_environment_action_control_requests).toHaveLength(0);
      const pending = (await db.getPool().query("SELECT control_request_id FROM helix_environment_action_control_requests")).rows;
      expect(pending).toHaveLength(1); failedControlId = pending[0].control_request_id;
    }
    const stopped = await emergencyStopEnvironmentActionAuthority(input);
    if (failedControlId) expect(stopped.controlRequest.control_request_id).toBe(failedControlId);
    const saved = JSON.parse(readFileSync(snapshotPath, "utf8"));
    expect(saved.tables.helix_environment_action_authorities[0].status).toBe("suspended");
    expect(saved.tables.helix_environment_action_requests[0].status).toBe("emergency_stopped");
    expect(saved.tables.helix_environment_action_control_requests).toHaveLength(1);
    restoreConnect(); restoreConnect = undefined;
    await db.resetDbClient(); await db.ensureDatabase(); attachEnvironmentRead();
    const recovered = await emergencyStopEnvironmentActionAuthority(input);
    expect(recovered.controlRequest).toEqual(stopped.controlRequest);
    expect(recovered.authority.status).toBe("suspended");
    const reloaded = JSON.parse(readFileSync(snapshotPath, "utf8"));
    expect(reloaded.tables.helix_environment_action_control_requests).toEqual(saved.tables.helix_environment_action_control_requests);
  } finally {
    restoreConnect?.(); await db.resetDbClient(); vi.restoreAllMocks(); vi.unstubAllEnvs();
    for (const file of readdirSync(directory)) unlinkSync(path.join(directory, file));
    rmdirSync(directory);
  }
}, 60000);
