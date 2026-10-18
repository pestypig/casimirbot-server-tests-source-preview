import { expect, it } from "vitest";
import { newDb } from "pg-mem";
import { retainAcceptedTemporalLease } from "../temporal-event-plan";

it.each(["accepted", "child_deadline", "equal_deadline", "expired", "canceled", "running", "root_expired", "child_expired"])(
  "accepted successor lease respects %s without starting or replaying work", async scenario => {
    const memory = newDb();
    memory.public.none(`CREATE TABLE helix_environment_action_requests (
      action_request_id text PRIMARY KEY, status text, lease_expires_at timestamptz,
      deadline_at timestamptz, updated_at timestamptz
    );`);
    const { Pool } = memory.adapters.createPg();
    const pool = new Pool();
    const now = Date.now();
    const at = (delta: number) => new Date(now + delta).toISOString();
    const rootDeadline = at(scenario === "root_expired" ? -10000 : 60000);
    const childDeadline = at(scenario === "child_expired" ? -10000 : scenario === "child_deadline" ? 30000 : scenario === "equal_deadline" ? 60000 : 90000);
    const status = ["canceled", "running"].includes(scenario) ? scenario : "leased";
    const lease = at(scenario === "expired" ? -10000 : 10000);
    await pool.query("INSERT INTO helix_environment_action_requests VALUES ($1,$2,$3,$4,null)",
      ["child", status, lease, childDeadline]);
    try {
      const call = retainAcceptedTemporalLease(pool as never, "child", rootDeadline);
      if (["accepted", "child_deadline", "equal_deadline"].includes(scenario)) {
        await expect(call).resolves.toBeUndefined();
        const row = (await pool.query("SELECT * FROM helix_environment_action_requests")).rows[0];
        expect(row.status).toBe("leased");
        expect(new Date(row.lease_expires_at).toISOString()).toBe(scenario === "child_deadline" ? childDeadline : rootDeadline);
        // Re-observation cannot advance the fixed deadline or create execution.
        await retainAcceptedTemporalLease(pool as never, "child", rootDeadline);
        expect((await pool.query("SELECT status FROM helix_environment_action_requests")).rows[0].status).toBe("leased");
      } else {
        await expect(call).rejects.toThrow("temporal_successor_acceptance_lease_expired");
        const row = (await pool.query("SELECT * FROM helix_environment_action_requests")).rows[0];
        expect(row.status).toBe(status);
        expect(new Date(row.lease_expires_at).toISOString()).toBe(lease);
      }
    } finally { await pool.end(); }
  });
