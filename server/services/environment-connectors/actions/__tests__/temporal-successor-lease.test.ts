import { expect, it } from "vitest";
import { DataType, newDb } from "pg-mem";
import { temporalSuccessorLeaseSql } from "../temporal-successor-query";

it("leases at most once and rejects a deadline reached after candidate selection", async () => {
  const memory = newDb();
  const now = "2026-09-06T12:00:00.000Z";
  memory.public.registerFunction({ name: "clock_timestamp", returns: DataType.timestamptz,
    implementation: () => new Date(now), impure: true });
  memory.public.none(`CREATE TABLE helix_environment_action_requests (
    action_request_id text primary key, status text, attempt_count integer,
    deadline_at timestamptz, leased_at timestamptz, lease_expires_at timestamptz, updated_at timestamptz);`);
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  const future = "2026-09-06T12:00:01.000Z";
  try {
    for (const [id, deadline] of [["valid", future], ["boundary", now], ["expired", "2026-09-06T11:59:59.000Z"]]) {
      await pool.query(`INSERT INTO helix_environment_action_requests
        (action_request_id,status,attempt_count,deadline_at) VALUES ($1,'admitted',0,$2)`, [id, deadline]);
    }
    const raced = await Promise.all(Array.from({ length: 8 }, () =>
      pool.query(temporalSuccessorLeaseSql, ["valid", future])));
    expect(raced.reduce((sum, result) => sum + result.rows.length, 0)).toBe(1);
    for (const id of ["boundary", "expired"]) {
      expect((await pool.query(temporalSuccessorLeaseSql, [id, future])).rows).toEqual([]);
    }
    const rows = (await pool.query("SELECT action_request_id,status,attempt_count FROM helix_environment_action_requests ORDER BY action_request_id")).rows;
    expect(rows).toEqual([
      { action_request_id: "boundary", status: "admitted", attempt_count: 0 },
      { action_request_id: "expired", status: "admitted", attempt_count: 0 },
      { action_request_id: "valid", status: "leased", attempt_count: 1 },
    ]);
  } finally { await pool.end(); }
});
