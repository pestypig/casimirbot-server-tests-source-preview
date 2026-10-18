import { afterEach, describe, expect, it, vi } from "vitest";
import { DataType, newDb } from "pg-mem";
import * as rooms from "../../../helix-ask/realtime-room/room-store";
import * as database from "../../../helix-ask/realtime-room/room-store/database";
import { extendEnvironmentActionAuthorityLease } from "../authority-store";

const input = {
  roomId: "shared_realtime_room:lease",
  ownerProfileId: "owner",
  environmentBindingId: "environment_binding:lease",
  actionAuthorityId: "environment_action_authority:lease",
  expiresAt: "2099-01-02T00:00:00.000Z",
};

function setup(prior: Record<string, unknown> | null) {
  vi.spyOn(rooms, "readSharedRealtimeRoomMembership").mockResolvedValue({ role: "owner" } as never);
  const query = vi.fn(async (sql: string) => ({ rows: sql.trim().startsWith("SELECT") ? (prior ? [prior] : []) : [] }));
  vi.spyOn(database, "withSharedRealtimeRoomTransaction").mockImplementation(async work => work({ query } as never));
  return query;
}

afterEach(() => vi.restoreAllMocks());

describe("exact authority lease extension guards", () => {
  it.each(["invalid", "2000-01-01T00:00:00.000Z"])("rejects invalid requested expiry %s before writes", async expiresAt => {
    const query = setup({ status: "active", expires_at: "2099-01-01T00:00:00.000Z" });
    await expect(extendEnvironmentActionAuthorityLease({ ...input, expiresAt })).rejects.toMatchObject({ code: "action_authority_expiry_invalid" });
    expect(query).not.toHaveBeenCalled();
  });

  it.each(["2000-01-01T00:00:00.000Z", "invalid"])("does not revive stored-active authority with prior expiry %s", async expires_at => {
    const query = setup({ status: "active", expires_at });
    await expect(extendEnvironmentActionAuthorityLease(input)).rejects.toMatchObject({ code: "action_authority_expiry_invalid" });
    expect(query.mock.calls.every(([sql]) => sql.trim().startsWith("SELECT"))).toBe(true);
  });

  it("rejects missing or revoked selection without writes", async () => {
    const query = setup(null);
    await expect(extendEnvironmentActionAuthorityLease(input)).rejects.toMatchObject({ code: "action_authority_not_found" });
    expect(query.mock.calls.every(([sql]) => sql.trim().startsWith("SELECT"))).toBe(true);
  });

  it("does not touch credentials when the guarded authority update loses readiness", async () => {
    const query = setup({ status: "active", expires_at: "2099-01-01T00:00:00.000Z" });
    await expect(extendEnvironmentActionAuthorityLease(input)).rejects.toMatchObject({ code: "action_authority_expiry_invalid" });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toContain("expires_at > clock_timestamp()");
  });

  it("executes the SQL without reviving expired or revoked credentials", async () => {
    vi.spyOn(rooms, "readSharedRealtimeRoomMembership").mockResolvedValue({ role: "owner" } as never);
    const memory = newDb();
    memory.public.registerFunction({ name: "clock_timestamp", returns: DataType.timestamptz, implementation: () => new Date(), impure: true });
    memory.public.none(`
      CREATE TABLE helix_environment_action_authorities (
        action_authority_id text PRIMARY KEY, environment_binding_id text,
        room_id text, owner_profile_id text, status text, expires_at timestamptz,
        updated_at timestamptz, created_at timestamptz, revoked_at timestamptz,
        room_source_binding_id text, source_id text, world_id text,
        adapter_profile_id text, domain_adapter text, participant_id text,
        subject_binding_id text, allowed_capability_ids jsonb, autonomy_mode text,
        manual_override_policy text, policy_version integer
      );
      CREATE TABLE helix_environment_action_connector_credentials (
        id text PRIMARY KEY, action_authority_id text, status text, expires_at timestamptz
      );
    `);
    const { Pool } = memory.adapters.createPg();
    const pool = new Pool();
    vi.spyOn(database, "withSharedRealtimeRoomTransaction").mockImplementation(async work => work(pool as never));
    try {
      await pool.query(`INSERT INTO helix_environment_action_authorities VALUES
        ($1, $2, $3, $4, 'active', '2099-01-01', now(), now(), null,
        'room-source', 'source', 'world', 'adapter', 'adapter', 'participant',
        'subject', '["walk"]', 'approved_capabilities', 'cancel', 3)`,
      [input.actionAuthorityId, input.environmentBindingId, input.roomId, input.ownerProfileId]);
      for (const [id, status, expiry] of [
        ["current", "active", "2099-01-01"],
        ["expired", "active", "2000-01-01"],
        ["revoked", "revoked", "2099-01-01"],
      ]) await pool.query("INSERT INTO helix_environment_action_connector_credentials VALUES ($1, $2, $3, $4)", [id, input.actionAuthorityId, status, expiry]);
      const result = await extendEnvironmentActionAuthorityLease(input);
      expect(result).toMatchObject({ action_authority_id: input.actionAuthorityId, subject_binding_id: "subject", policy_version: 3, expires_at: input.expiresAt, answer_authority: false });
      const rows = (await pool.query("SELECT * FROM helix_environment_action_connector_credentials ORDER BY id")).rows;
      expect(rows.map(row => [row.id, row.status, new Date(row.expires_at).toISOString()])).toEqual([
        ["current", "active", input.expiresAt],
        ["expired", "active", "2000-01-01T00:00:00.000Z"],
        ["revoked", "revoked", "2099-01-01T00:00:00.000Z"],
      ]);
      await pool.query("UPDATE helix_environment_action_authorities SET status = 'revoked'");
      await expect(extendEnvironmentActionAuthorityLease(input)).rejects.toMatchObject({ code: "action_authority_not_found" });
    } finally { await pool.end(); }
  });
});
