import { newDb } from "pg-mem";
import { expect, it } from "vitest";
import { migration083 } from "../083_environment_temporal_plan_admissions";

it("pins exact action/frontier records and requires paired predecessor identity", async () => {
  const { Pool } = newDb().adapters.createPg();
  const pool = new Pool();
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE helix_environment_action_requests(action_request_id text PRIMARY KEY);
      CREATE TABLE helix_environment_temporal_frontiers(frontier_id text PRIMARY KEY);
      CREATE TABLE helix_environment_durable_goals(goal_id text PRIMARY KEY);
      INSERT INTO helix_environment_action_requests VALUES ('action:1'), ('action:2');
      INSERT INTO helix_environment_temporal_frontiers VALUES ('frontier:1');
      INSERT INTO helix_environment_durable_goals VALUES ('goal:1');`);
    await migration083.run(client, { enablePgvector: false });
    const insert = (id: string, action = "action:1", previous: string | null = null, hash: string | null = null) =>
      client.query(`INSERT INTO helix_environment_temporal_plan_admissions
        (plan_id,plan_hash,source_plan,compilation_hash,compilation_artifact,action_request_id,
         frontier_id,goal_id,goal_revision,reasoning_binding_id,reasoning_binding_epoch,client_continuation_ref,
         previous_plan_id,previous_plan_hash)
        VALUES ($1,'hash:1','{}','compiled:1','{}',$2,'frontier:1','goal:1',1,'binding:1',1,'continuation:1',$3,$4)`,
      [id, action, previous, hash]);
    await insert("plan:1");
    await expect(insert("plan:duplicate-action")).rejects.toThrow();
    await expect(insert("plan:missing-action", "action:missing")).rejects.toThrow();
    await expect(insert("plan:unpaired", "action:2", "plan:1")).rejects.toThrow();
    await expect(insert("plan:unknown-parent", "action:2", "plan:unknown", "hash:1")).rejects.toThrow();
    await expect(insert("plan:wrong-parent-hash", "action:2", "plan:1", "hash:wrong")).rejects.toThrow();
    await insert("plan:2", "action:2", "plan:1", "hash:1");
    await expect(client.query("DELETE FROM helix_environment_temporal_frontiers WHERE frontier_id='frontier:1'")).rejects.toThrow();
    await expect(client.query("DELETE FROM helix_environment_action_requests WHERE action_request_id='action:1'")).rejects.toThrow();
    expect((await client.query("SELECT * FROM helix_environment_temporal_plan_admissions")).rows).toHaveLength(2);
  } finally { client.release(); await pool.end(); }
});
