import { afterEach, expect, it, vi } from "vitest";
import { newDb } from "pg-mem";
import { createHash } from "node:crypto";
import * as rooms from "../../../helix-ask/realtime-room/room-store";
import * as database from "../../../helix-ask/realtime-room/room-store/database";
import { emergencyStopEnvironmentActionAuthority } from "../authority-store";

vi.mock("../../../local-supervisor/desktop-mcp-tunnel-safety", () => ({
  requestDesktopMcpTunnelReadOnlyForSafety: vi.fn(async () => true),
}));
afterEach(() => vi.restoreAllMocks());

const input = { roomId: "room", profileId: "profile", environmentBindingId: "environment",
  actionAuthorityId: "authority", reason: "fixture stop" };
const authority = { action_authority_id: "authority", environment_binding_id: "environment",
  room_source_binding_id: "room-source", room_id: "room", source_id: "source", world_id: "world",
  adapter_profile_id: "adapter", domain_adapter: "adapter", participant_id: "player",
  subject_binding_id: "subject", allowed_capability_ids: ["walk"], autonomy_mode: "approved_capabilities",
  manual_override_policy: "cancel", status: "active", policy_version: 1,
  created_at: "2026-01-01T00:00:00.000Z", expires_at: null, revoked_at: null };

function setup(role: string, participantId: string, failSnapshot = false) {
  vi.spyOn(rooms, "readSharedRealtimeRoomMembership").mockResolvedValue({ role, participantId } as never);
  const query = vi.fn(async (sql: string) => ({ rows: sql.trim().startsWith("SELECT") ? [authority] : [] }));
  const transaction = vi.spyOn(database, "withSharedRealtimeRoomTransaction").mockImplementation(async (work, options) => {
    const result = await work({ query } as never);
    if (failSnapshot && options?.requireLocalSnapshot) throw new Error("fixture_snapshot_failed");
    return result;
  });
  return { query, transaction };
}

it.each([["owner", "owner"], ["member", "player"]])("requires durable stop state for authorized %s", async (role, participant) => {
  const { transaction } = setup(role, participant);
  const stopped = await emergencyStopEnvironmentActionAuthority(input);
  expect(stopped.authority.status).toBe("suspended");
  expect(stopped.controlRequest.release_all_controls).toBe(true);
  expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
    requireLocalSnapshot: true,
    snapshotTables: ["helix_environment_action_authorities", "helix_environment_action_requests", "helix_environment_action_control_requests"],
  });
});

it("does not acknowledge an emergency stop when the required snapshot fails", async () => {
  setup("owner", "owner", true);
  await expect(emergencyStopEnvironmentActionAuthority(input)).rejects.toThrow("fixture_snapshot_failed");
});

it("rejects another participant before any stop writes", async () => {
  const { query } = setup("member", "other-player");
  await expect(emergencyStopEnvironmentActionAuthority(input)).rejects.toMatchObject({ code: "action_authority_forbidden" });
  expect(query.mock.calls.every(([sql]) => sql.trim().startsWith("SELECT"))).toBe(true);
});

it.each(["pending", "leased"])("reuses the %s release control after a committed stop's snapshot failure", async controlStatus => {
  vi.spyOn(rooms, "readSharedRealtimeRoomMembership").mockResolvedValue({ role: "owner", participantId: "owner" } as never);
  const memory = newDb();
  memory.public.none(`CREATE TABLE helix_environment_action_authorities (
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
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  let failSnapshot = true;
  let snapshotAttempts = 0;
  vi.spyOn(database, "withSharedRealtimeRoomTransaction").mockImplementation(async (work, options) => {
    const result = await work({ query: (sql: string, values?: unknown[]) =>
      sql.includes("FROM helix_environment_connector_bindings b") ? Promise.resolve({ rows: [authority] }) : pool.query(sql, values) } as never);
    expect(options?.requireLocalSnapshot).toBe(true);
    snapshotAttempts++;
    if (failSnapshot) throw new Error("fixture_snapshot_failed_after_commit");
    return result;
  });
  try {
    const keys = Object.keys(authority);
    await pool.query(`INSERT INTO helix_environment_action_authorities (${keys.join(",")}) VALUES (${keys.map((_, index) => "$" + (index + 1)).join(",")})`,
      Object.values(authority).map(value => Array.isArray(value) ? JSON.stringify(value) : value));
    await pool.query("INSERT INTO helix_environment_action_requests (action_request_id,action_authority_id,status) VALUES ('root','authority','running')");
    await expect(emergencyStopEnvironmentActionAuthority(input)).rejects.toThrow("fixture_snapshot_failed_after_commit");
    await pool.query("UPDATE helix_environment_action_control_requests SET status=$1", [controlStatus]);
    const firstRows = (await pool.query("SELECT * FROM helix_environment_action_control_requests")).rows;
    expect(firstRows).toHaveLength(1);
    failSnapshot = false;
    const retry = await emergencyStopEnvironmentActionAuthority(input);
    expect(retry.controlRequest.control_request_id).toBe(firstRows[0].control_request_id);
    expect(retry.controlRequest.deadline_at).toBe(new Date(firstRows[0].deadline_at).toISOString());
    expect((await pool.query("SELECT * FROM helix_environment_action_control_requests")).rows).toEqual(firstRows);
    expect(snapshotAttempts).toBe(2);
    expect((await pool.query("SELECT status FROM helix_environment_action_authorities")).rows).toEqual([{ status: "suspended" }]);
    expect((await pool.query("SELECT status FROM helix_environment_action_requests")).rows).toEqual([{ status: "emergency_stopped" }]);
    for (const patch of [{ world_id: "other-world" }, { subject_binding_id: "other-player" }, { release_all_controls: false },
      { control_request_id: "environment_action_control:other" }, { deadline_at: new Date(Date.now() + 60000).toISOString() }]) {
      const tampered = { ...firstRows[0].request_payload, ...patch };
      const hash = "sha256:" + createHash("sha256").update(JSON.stringify(Object.fromEntries(
        Object.entries(tampered).sort(([a], [b]) => a.localeCompare(b))))).digest("hex");
      await pool.query("UPDATE helix_environment_action_control_requests SET request_payload=$1,request_hash=$2", [JSON.stringify(tampered), hash]);
      const beforeInvalid = (await pool.query("SELECT * FROM helix_environment_action_control_requests")).rows;
      await expect(emergencyStopEnvironmentActionAuthority(input)).rejects.toMatchObject({ code: "action_control_invalid" });
      expect((await pool.query("SELECT * FROM helix_environment_action_control_requests")).rows).toEqual(beforeInvalid);
      expect(snapshotAttempts).toBe(2);
    }
  } finally { await pool.end(); }
});
