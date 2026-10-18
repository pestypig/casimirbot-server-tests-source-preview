import { expect, it } from "vitest";
import { DataType, newDb } from "pg-mem";
import { temporalSuccessorCandidatesSql, temporalSuccessorLeaseSql } from "../temporal-successor-query";
import { rootActionLeaseSql } from "../root-action-lease-query";

it("polls an empty successor queue and filters exact identity on packaged SQL", async () => {
  const memory = newDb();
  memory.public.none(`CREATE TABLE helix_environment_temporal_plan_admissions (
    action_request_id text, resident_action_request_id text, previous_plan_id text, previous_plan_hash text,
    checkpoint_association jsonb, reasoning_binding_id text, reasoning_binding_epoch integer, client_continuation_ref text);
    CREATE TABLE helix_environment_action_requests (
    action_request_id text, request_payload jsonb, deadline_at timestamptz, action_authority_id text,
    connector_manifest_id text, status text);`);
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  const identity = ["root", "predecessor", "hash", "authority", "manifest"];
  try {
    // This exact original production syntax throws even on the empty queue.
    await expect(pool.query(temporalSuccessorCandidatesSql + " OF a", identity)).rejects.toThrow();
    expect((await pool.query(temporalSuccessorCandidatesSql, identity)).rows).toEqual([]);
    await pool.query(`INSERT INTO helix_environment_temporal_plan_admissions VALUES
      ('child','root','predecessor','hash','{}','binding',1,'continuation');
      INSERT INTO helix_environment_action_requests VALUES
      ('child','{}',now()+interval '1 day','authority','manifest','admitted');`);
    expect((await pool.query(temporalSuccessorCandidatesSql, identity)).rows).toHaveLength(1);
    for (let i = 0; i < identity.length; i++) {
      const wrong = [...identity]; wrong[i] = "wrong";
      expect((await pool.query(temporalSuccessorCandidatesSql, wrong)).rows).toEqual([]);
    }
    for (const status of ["queued", "failed", "canceled"]) {
      await pool.query("UPDATE helix_environment_action_requests SET status=$1", [status]);
      expect((await pool.query(temporalSuccessorCandidatesSql, identity)).rows).toEqual([]);
    }
    await pool.query("UPDATE helix_environment_action_requests SET status='admitted', deadline_at=now()-interval '1 day'");
    expect((await pool.query(temporalSuccessorCandidatesSql, identity)).rows).toEqual([]);
  } finally { await pool.end(); }
});

it("leases one admitted successor once and rechecks its deadline at the final transition", async () => {
  const memory = newDb();
  memory.public.registerFunction({ name: "clock_timestamp", returns: DataType.timestamptz,
    implementation: () => new Date(), impure: true });
  memory.public.none(`CREATE TABLE helix_environment_action_requests (
    action_request_id text PRIMARY KEY, status text, deadline_at timestamptz,
    attempt_count integer, leased_at timestamptz, lease_expires_at timestamptz,
    updated_at timestamptz);
    INSERT INTO helix_environment_action_requests
      (action_request_id,status,deadline_at,attempt_count)
      VALUES ('child','admitted',now()+interval '1 day',0);`);
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  const leaseUntil = new Date(Date.now() + 60_000).toISOString();
  try {
    expect((await pool.query(temporalSuccessorLeaseSql,
      ["child", leaseUntil])).rows).toMatchObject([
      { action_request_id: "child", status: "leased", attempt_count: 1 },
    ]);
    expect((await pool.query(temporalSuccessorLeaseSql,
      ["child", leaseUntil])).rows).toEqual([]);
    expect((await pool.query("SELECT attempt_count FROM helix_environment_action_requests WHERE action_request_id='child'"))
      .rows[0].attempt_count).toBe(1);
    await pool.query("UPDATE helix_environment_action_requests SET status='admitted', deadline_at=now()-interval '1 second'");
    expect((await pool.query(temporalSuccessorLeaseSql,
      ["child", leaseUntil])).rows).toEqual([]);
    await pool.query("UPDATE helix_environment_action_requests SET status='admitted', deadline_at=now()+interval '1 day'");
    expect((await pool.query(temporalSuccessorLeaseSql,
      ["child", "2020-01-01T00:00:00.000Z"])).rows).toEqual([]);
    await pool.query("UPDATE helix_environment_action_requests SET deadline_at=now()+interval '30 seconds'");
    expect((await pool.query(temporalSuccessorLeaseSql,
      ["child", leaseUntil])).rows).toEqual([]);
    await pool.query("UPDATE helix_environment_action_requests SET status='canceled'");
    expect((await pool.query(temporalSuccessorLeaseSql,
      ["child", leaseUntil])).rows).toEqual([]);
    expect((await pool.query("SELECT attempt_count FROM helix_environment_action_requests WHERE action_request_id='child'"))
      .rows[0].attempt_count).toBe(1);
  } finally { await pool.end(); }
});

it("leases a root once and rejects an expired deadline or proposed lease at the write", async () => {
  const memory = newDb();
  memory.public.registerFunction({ name: "clock_timestamp", returns: DataType.timestamptz,
    implementation: () => new Date(), impure: true });
  memory.public.none(`CREATE TABLE helix_environment_action_requests (
    action_request_id text PRIMARY KEY, status text, deadline_at timestamptz,
    attempt_count integer, leased_at timestamptz, lease_expires_at timestamptz,
    updated_at timestamptz);
    INSERT INTO helix_environment_action_requests
      (action_request_id,status,deadline_at,attempt_count)
      VALUES ('root','admitted',now()+interval '1 day',0);`);
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  const leaseUntil = new Date(Date.now() + 60_000).toISOString();
  try {
    expect((await pool.query(rootActionLeaseSql,
      ["root", leaseUntil])).rows).toMatchObject([
      { action_request_id: "root", status: "leased", attempt_count: 1 },
    ]);
    expect((await pool.query(rootActionLeaseSql,
      ["root", leaseUntil])).rows).toEqual([]);
    await pool.query("UPDATE helix_environment_action_requests SET status='admitted', deadline_at=now()-interval '1 second'");
    expect((await pool.query(rootActionLeaseSql,
      ["root", leaseUntil])).rows).toEqual([]);
    await pool.query("UPDATE helix_environment_action_requests SET status='admitted', deadline_at=now()+interval '1 day'");
    expect((await pool.query(rootActionLeaseSql,
      ["root", "2020-01-01T00:00:00.000Z"])).rows).toEqual([]);
    await pool.query("UPDATE helix_environment_action_requests SET deadline_at=now()+interval '30 seconds'");
    expect((await pool.query(rootActionLeaseSql,
      ["root", leaseUntil])).rows).toEqual([]);
    await pool.query("UPDATE helix_environment_action_requests SET status='canceled'");
    expect((await pool.query(rootActionLeaseSql,
      ["root", leaseUntil])).rows).toEqual([]);
    expect((await pool.query("SELECT attempt_count FROM helix_environment_action_requests WHERE action_request_id='root'"))
      .rows[0].attempt_count).toBe(1);
  } finally { await pool.end(); }
});

it("does not lease a previously eligible request after the database wall clock advances", async () => {
  const memory = newDb();
  let wall = new Date("2026-10-09T12:00:00.000Z");
  memory.public.registerFunction({ name: "clock_timestamp", returns: DataType.timestamptz,
    implementation: () => wall, impure: true });
  memory.public.none(`CREATE TABLE helix_environment_action_requests (
    action_request_id text PRIMARY KEY, status text, deadline_at timestamptz,
    attempt_count integer, leased_at timestamptz, lease_expires_at timestamptz,
    updated_at timestamptz);
    INSERT INTO helix_environment_action_requests
      (action_request_id,status,deadline_at,attempt_count) VALUES
      ('root','admitted','2026-10-09T12:00:01Z',0),
      ('child','admitted','2026-10-09T12:00:01Z',0);`);
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  try {
    expect((await pool.query(`SELECT action_request_id FROM helix_environment_action_requests
      WHERE status='admitted' AND deadline_at>clock_timestamp()`)).rows)
      .toHaveLength(2);
    wall = new Date("2026-10-09T12:00:02.000Z");
    const proposedLease = "2026-10-09T12:00:05.000Z";
    expect((await pool.query(rootActionLeaseSql,
      ["root", proposedLease])).rows).toEqual([]);
    expect((await pool.query(temporalSuccessorLeaseSql,
      ["child", proposedLease])).rows).toEqual([]);
    expect((await pool.query(`SELECT action_request_id,status,attempt_count
      FROM helix_environment_action_requests ORDER BY action_request_id`)).rows)
      .toMatchObject([
        { action_request_id: "child", status: "admitted", attempt_count: 0 },
        { action_request_id: "root", status: "admitted", attempt_count: 0 },
      ]);
    await pool.query(`UPDATE helix_environment_action_requests
      SET deadline_at='2026-10-09T12:00:10Z'`);
    for (const [actionRequestId, sql] of [["root", rootActionLeaseSql],
      ["child", temporalSuccessorLeaseSql]] as const) {
      const leased = (await pool.query(sql, [actionRequestId, proposedLease])).rows[0];
      expect(leased).toMatchObject({ action_request_id: actionRequestId,
        status: "leased", attempt_count: 1 });
      expect(new Date(leased.leased_at).toISOString()).toBe(wall.toISOString());
      expect(new Date(leased.updated_at).toISOString()).toBe(wall.toISOString());
    }
  } finally { await pool.end(); }
});
