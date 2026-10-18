import { expect, it } from "vitest";
import { newDb } from "pg-mem";
import { publishTemporalAdmission } from "../temporal-admission-publication";
import type { PoolClient } from "pg";

async function fixture() {
  const memory = newDb();
  memory.public.none(`CREATE TABLE helix_environment_action_requests
    (action_request_id text primary key, status text, cancellation_reason text);
    CREATE TABLE helix_environment_temporal_plan_admissions (action_request_id text primary key);
    CREATE TABLE observations (id text primary key);
    INSERT INTO helix_environment_action_requests VALUES ('new','queued',null),('other','admitted',null);`);
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  const client = await pool.connect();
  return { pool, client, close: async () => { client.release(); await pool.end(); } };
}

it("publishes only after retention; concurrent readers cannot lease the staged request", async () => {
  const f = await fixture();
  try {
    await publishTemporalAdmission(f.client as never, "new", async () => {
      expect((await f.pool.query("SELECT action_request_id FROM helix_environment_action_requests WHERE status='admitted'")).rows)
        .toEqual([{ action_request_id: "other" }]);
      await f.client.query("INSERT INTO helix_environment_temporal_plan_admissions VALUES ('new')");
    });
    expect((await f.pool.query("SELECT status FROM helix_environment_action_requests WHERE action_request_id='new'")).rows[0].status).toBe("admitted");
  } finally { await f.close(); }
});

it.each([false, true])("rejection compensates local writes (retained=%s) without reverting concurrent observations", async retained => {
  const f = await fixture();
  try {
    await f.client.query("BEGIN");
    const rejection = new Error("exact binding changed");
    await expect(publishTemporalAdmission(f.client as never, "new", async () => {
      if (retained) await f.client.query("INSERT INTO helix_environment_temporal_plan_admissions VALUES ('new')");
      await f.pool.query("INSERT INTO observations VALUES ('fresh-connector-event')");
      throw rejection;
    })).rejects.toBe(rejection);
    await f.client.query("ROLLBACK");
    expect((await f.pool.query("SELECT status,cancellation_reason FROM helix_environment_action_requests WHERE action_request_id='new'")).rows[0])
      .toEqual({ status: "failed", cancellation_reason: "temporal_admission_rejected" });
    expect((await f.pool.query("SELECT * FROM helix_environment_temporal_plan_admissions")).rows).toEqual([]);
    expect((await f.pool.query("SELECT * FROM observations")).rows).toHaveLength(1);
    expect((await f.pool.query("SELECT status FROM helix_environment_action_requests WHERE action_request_id='other'")).rows[0].status).toBe("admitted");
  } finally { await f.close(); }
});

it("cleanup failure leaves the request non-executable and preserves the original rejection", async () => {
  const f = await fixture();
  try {
    const rejection = new Error("retention failed");
    const brokenCleanup = { query: async () => { throw new Error("storage unavailable"); } };
    await expect(publishTemporalAdmission(brokenCleanup as never, "new", async () => { throw rejection; })).rejects.toBe(rejection);
    expect((await f.pool.query("SELECT status FROM helix_environment_action_requests WHERE action_request_id='new'")).rows[0].status).toBe("queued");
  } finally { await f.close(); }
});

// Inject failure at the actual publication SQL boundary, not inside retain().
// These are adapter-call failures; they do not simulate process-crash durability.
it.each(["before_write", "after_write"] as const)("publication acknowledgement loss %s preserves a reconcilable state", async phase => {
  const f = await fixture();
  const failure = new Error(`publication_${phase}`);
  let injected = false;
  const faulted = {
    query: async (sql: string, values: unknown[]) => {
      if (!injected && sql.includes("SET status='admitted'")) {
        injected = true;
        if (phase === "after_write") await f.client.query(sql, values);
        throw failure;
      }
      return f.client.query(sql, values);
    },
  };
  try {
    await expect(publishTemporalAdmission(faulted as unknown as PoolClient, "new", async () => {
      await f.client.query("INSERT INTO helix_environment_temporal_plan_admissions VALUES ('new')");
      await f.pool.query("INSERT INTO observations VALUES ('concurrent-observation')");
    })).rejects.toBe(failure);
    expect(injected).toBe(true);
    const action = (await f.pool.query("SELECT status FROM helix_environment_action_requests WHERE action_request_id='new'")).rows[0];
    const admissions = (await f.pool.query("SELECT * FROM helix_environment_temporal_plan_admissions WHERE action_request_id='new'")).rows;
    // After the write, an error does NOT prove non-admission. Cleanup must not
    // remove metadata from an executable row. A caller must reconcile this ID.
    expect(action.status).toBe(phase === "after_write" ? "admitted" : "failed");
    expect(admissions).toHaveLength(phase === "after_write" ? 1 : 0);
    expect((await f.pool.query("SELECT * FROM observations")).rows).toHaveLength(1);
    expect((await f.pool.query("SELECT status FROM helix_environment_action_requests WHERE action_request_id='other'")).rows[0].status).toBe("admitted");
  } finally { await f.close(); }
});

it("publication compare-and-set cannot overwrite a concurrent cancellation", async () => {
  const f = await fixture();
  try {
    await expect(publishTemporalAdmission(f.client as unknown as PoolClient, "new", async () => {
      await f.client.query("INSERT INTO helix_environment_temporal_plan_admissions VALUES ('new')");
      await f.pool.query("UPDATE helix_environment_action_requests SET status='canceled', cancellation_reason='operator_cancel' WHERE action_request_id='new'");
    })).rejects.toThrow("temporal_admission_publication_conflict");
    expect((await f.pool.query("SELECT status,cancellation_reason FROM helix_environment_action_requests WHERE action_request_id='new'")).rows[0])
      .toEqual({ status: "canceled", cancellation_reason: "operator_cancel" });
    expect((await f.pool.query("SELECT action_request_id FROM helix_environment_action_requests WHERE status='admitted'")).rows)
      .toEqual([{ action_request_id: "other" }]);
  } finally { await f.close(); }
});

it("a suspended failing publication cannot compensate a second successful submission", async () => {
  const f = await fixture();
  const second = await f.pool.connect();
  let releaseRetention!: () => void;
  let reportRetained!: () => void;
  const retained = new Promise<void>(resolve => { reportRetained = resolve; });
  const resume = new Promise<void>(resolve => { releaseRetention = resolve; });
  const rejection = new Error("first binding revoked before publication");
  try {
    await second.query("INSERT INTO helix_environment_action_requests VALUES ('second','queued',null)");
    const firstOutcome = publishTemporalAdmission(f.client as unknown as PoolClient, "new", async () => {
      await f.client.query("INSERT INTO helix_environment_temporal_plan_admissions VALUES ('new')");
      reportRetained();
      await resume;
      throw rejection;
    }).catch(error => error);
    await retained;
    await publishTemporalAdmission(second as unknown as PoolClient, "second", async () => {
      await second.query("INSERT INTO helix_environment_temporal_plan_admissions VALUES ('second')");
    });
    releaseRetention();
    expect(await firstOutcome).toBe(rejection);
    expect((await second.query("SELECT status FROM helix_environment_action_requests WHERE action_request_id='second'")).rows[0].status)
      .toBe("admitted");
    expect((await second.query("SELECT * FROM helix_environment_temporal_plan_admissions")).rows)
      .toEqual([{ action_request_id: "second" }]);
    expect((await second.query("SELECT status FROM helix_environment_action_requests WHERE action_request_id='new'")).rows[0].status)
      .toBe("failed");
  } finally {
    releaseRetention?.();
    second.release();
    await f.close();
  }
});
