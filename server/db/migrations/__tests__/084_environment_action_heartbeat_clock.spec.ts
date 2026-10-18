import { newDb } from "pg-mem";
import { expect, it } from "vitest";
import { migration084 } from "../084_environment_action_heartbeat_clock";

it("preserves legacy heartbeats with unknown clock and supports idempotent migration", async () => {
  const { Pool } = newDb().adapters.createPg();
  const pool = new Pool();
  const client = await pool.connect();
  try {
    await client.query("CREATE TABLE helix_environment_action_connector_heartbeats(heartbeat_id text PRIMARY KEY); INSERT INTO helix_environment_action_connector_heartbeats VALUES ('heartbeat:old')");
    await migration084.run(client, { enablePgvector: false });
    await migration084.run(client, { enablePgvector: false });
    expect((await client.query("SELECT clock_snapshot FROM helix_environment_action_connector_heartbeats")).rows).toEqual([{ clock_snapshot: null }]);
  } finally { client.release(); await pool.end(); }
});
