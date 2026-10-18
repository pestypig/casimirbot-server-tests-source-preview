import { expect, it } from "vitest";
import { newDb } from "pg-mem";
import { temporalSuccessorStateSql } from "../temporal-successor-query";

it("reconciles exact packaged rows without mutating or projecting an executable payload", async () => {
  const memory = newDb();
  memory.public.none(`CREATE TABLE helix_environment_temporal_plan_admissions (
    action_request_id text, resident_action_request_id text, previous_plan_id text, previous_plan_hash text,
    checkpoint_association jsonb, reasoning_binding_id text, reasoning_binding_epoch integer,
    client_continuation_ref text, source_plan jsonb);
    CREATE TABLE helix_environment_action_requests (
    action_request_id text, request_payload jsonb, action_authority_id text,
    connector_manifest_id text, run_id text, status text, attempt_count integer);
    INSERT INTO helix_environment_temporal_plan_admissions VALUES
    ('child','root','previous','hash','{}','binding',1,'continuation','{}');
    INSERT INTO helix_environment_action_requests VALUES
    ('child','{"arguments":{"move":true}}','authority','manifest','run','leased',1);`);
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  const identity = ["root", "previous", "hash", "authority", "manifest", "run"];
  try {
    const before = (await pool.query("SELECT * FROM helix_environment_action_requests")).rows;
    const result = (await pool.query(temporalSuccessorStateSql, identity)).rows;
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ action_request_id: "child", status: "leased" });
    expect(result[0]).not.toHaveProperty("request_payload");
    for (let i = 0; i < identity.length; i++) {
      const wrong = [...identity]; wrong[i] = "wrong";
      expect((await pool.query(temporalSuccessorStateSql, wrong)).rows).toEqual([]);
    }
    expect((await pool.query("SELECT * FROM helix_environment_action_requests")).rows).toEqual(before);
    // Deliberately unlike the delivery query, inspection can see terminal rows.
    await pool.query("UPDATE helix_environment_action_requests SET status='timed_out'");
    expect((await pool.query(temporalSuccessorStateSql, identity)).rows[0].status).toBe("timed_out");
    expect((await pool.query("SELECT attempt_count FROM helix_environment_action_requests")).rows[0].attempt_count).toBe(1);
    // Return two rows so the broker can reject ambiguity; never LIMIT 1.
    await pool.query(`INSERT INTO helix_environment_temporal_plan_admissions VALUES
      ('other','root','previous','hash','{}','binding',1,'continuation','{}');
      INSERT INTO helix_environment_action_requests VALUES ('other','{}','authority','manifest','run','admitted',0);`);
    expect((await pool.query(temporalSuccessorStateSql, identity)).rows).toHaveLength(2);
  } finally { await pool.end(); }
});
