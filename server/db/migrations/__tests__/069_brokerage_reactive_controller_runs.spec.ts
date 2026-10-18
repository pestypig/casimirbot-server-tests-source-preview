import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { migration069 } from
  "../069_brokerage_reactive_controller_runs";

describe("migration 069 brokerage reactive controller runs", () => {
  it("creates the finite lease, event, and idempotent cycle surfaces", async () => {
    const memory = newDb({ autoCreateForeignKeyIndices: true });
    memory.public.none(`
      CREATE TABLE helix_accounts(profile_id text PRIMARY KEY);
      CREATE TABLE helix_brokerage_connections(connection_id text PRIMARY KEY);
      CREATE TABLE helix_shared_realtime_rooms(room_id text PRIMARY KEY);
      CREATE TABLE helix_paper_trading_accounts(account_id text PRIMARY KEY);
      CREATE TABLE helix_paper_orders(order_id text PRIMARY KEY);
    `);
    const pg = memory.adapters.createPg();
    const client = new pg.Client();
    await client.connect();
    await migration069.run(client as never, { enablePgvector: false });
    const tables = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_name LIKE 'helix_brokerage_reactive_controller_%'
        ORDER BY table_name;`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "helix_brokerage_reactive_controller_cycles",
      "helix_brokerage_reactive_controller_effects",
      "helix_brokerage_reactive_controller_events",
      "helix_brokerage_reactive_controller_runs",
    ]);
    await expect(client.query(
      `INSERT INTO helix_brokerage_reactive_controller_runs(
         controller_run_id, client_controller_id, owner_profile_id,
         connection_id, room_id, paper_account_id, environment_binding_id,
         producer_epoch_ref, strategy_manifest_id, strategy_artifact_hash,
         controller_profile_hash, status, maximum_cycles,
         next_observation_deadline_at, controller_deadline_at,
         lease_expires_at, manifest_expires_at, request_hash,
         manifest_json, projection_json, created_at, updated_at
       ) VALUES ('run','client','missing','connection','room','account','binding',
         'epoch','strategy',$1,$2,'active',1,now(),now(),now(),now(),$3,'{}','{}',now(),now());`,
      [`sha256:${"1".repeat(64)}`, `sha256:${"2".repeat(64)}`,
        `sha256:${"3".repeat(64)}`],
    )).rejects.toThrow();
    await client.end();
  });
});
