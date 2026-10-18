import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { migration071 } from "../071_brokerage_reactive_live_shadow";

describe("migration 071 brokerage reactive live shadow", () => {
  it("creates finite shadow sessions and restart-safe poll receipts", async () => {
    const memory = newDb({ autoCreateForeignKeyIndices: true });
    memory.public.none(`
      CREATE TABLE helix_accounts(profile_id text PRIMARY KEY);
      CREATE TABLE helix_brokerage_connections(connection_id text PRIMARY KEY);
      CREATE TABLE helix_shared_realtime_rooms(room_id text PRIMARY KEY);
      CREATE TABLE helix_brokerage_reactive_controller_runs(
        controller_run_id text PRIMARY KEY
      );
    `);
    const pg = memory.adapters.createPg();
    const client = new pg.Client();
    await client.connect();
    await migration071.run(client as never, { enablePgvector: false });
    const tables = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_name LIKE 'helix_brokerage_reactive_shadow_%'
        ORDER BY table_name;`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "helix_brokerage_reactive_shadow_polls",
      "helix_brokerage_reactive_shadow_sessions",
    ]);
    await expect(client.query(
      `INSERT INTO helix_brokerage_reactive_shadow_sessions(
         shadow_session_id, client_shadow_session_id, controller_run_id,
         owner_profile_id, connection_id, room_id, symbol, status,
         maximum_polls, maximum_consecutive_failures, poll_interval_ms,
         next_poll_at, session_expires_at, request_hash, projection_json,
         created_at, updated_at
       ) VALUES ('shadow','client','missing','owner','connection','room','SPY',
         'active',1,1,1000,now(),now(),$1,'{}',now(),now());`,
      [`sha256:${"1".repeat(64)}`],
    )).rejects.toThrow();
    await client.end();
  });
});

