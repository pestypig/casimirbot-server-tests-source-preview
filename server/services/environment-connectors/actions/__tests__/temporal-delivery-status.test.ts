import { expect, it } from "vitest";
import { newDb } from "pg-mem";
import { temporalDeliveryStatusSql, temporalStoppedResidentDeliveriesSql } from "../temporal-delivery-status";

it.each(["canceled", "emergency_stopped", "succeeded", "running"])(
  "resident stop retirement scopes rows and rejects non-stop state %s", async state => {
    const memory = newDb();
    memory.public.none(`CREATE TABLE helix_environment_action_requests (
      action_request_id text PRIMARY KEY,status text,updated_at timestamptz,completed_at timestamptz,cancellation_reason text
    ); CREATE TABLE helix_environment_temporal_plan_admissions (action_request_id text,resident_action_request_id text);`);
    const { Pool } = memory.adapters.createPg();
    const pool = new Pool();
    const active = ["admitted", "leased", "running", "paused_manual_override", "cancel_requested"];
    const fixtures = [...active.map(status => [status, status, "root"]),
      ["root", "running", "root"], ["other", "running", "other-root"], ["unretained", "running", null],
      ...["succeeded", "failed", "canceled", "emergency_stopped", "authority_stale", "timed_out", "queued"].map(status => ["prior-" + status, status, "root"])];
    const old = "2026-01-01T00:00:00.000Z";
    try {
      for (const [id, status, resident] of fixtures) {
        await pool.query("INSERT INTO helix_environment_action_requests VALUES ($1,$2,$3,$3,NULL)", [id,status,old]);
        if (resident) await pool.query("INSERT INTO helix_environment_temporal_plan_admissions VALUES ($1,$2)", [id,resident]);
      }
      await pool.query(temporalStoppedResidentDeliveriesSql, ["root", state]);
      const rows = (await pool.query("SELECT * FROM helix_environment_action_requests ORDER BY action_request_id")).rows;
      for (const [id, original] of fixtures) {
        const changed = active.includes(id!) && ["canceled", "emergency_stopped"].includes(state);
        const row = rows.find((row: any) => row.action_request_id === id);
        expect(row.status).toBe(changed ? state : original);
        expect(row.cancellation_reason).toBe(changed ? "resident_terminal_delivery_retired" : null);
        expect(new Date(row.updated_at).toISOString() === old).toBe(!changed);
      }
      await pool.query(temporalStoppedResidentDeliveriesSql, ["root", state]);
      expect((await pool.query("SELECT * FROM helix_environment_action_requests ORDER BY action_request_id")).rows).toEqual(rows);
    } finally { await pool.end(); }
  });

it.each(["running", "paused_manual_override", "succeeded", "failed", "canceled", "timed_out", "emergency_stopped", "connector_offline", "authority_stale"])(
  "persists %s only for the exact active temporal delivery rows", async state => {
    const memory = newDb();
    memory.public.none(`CREATE TABLE helix_environment_action_requests (
      action_request_id text PRIMARY KEY, status text, updated_at timestamptz, completed_at timestamptz
    ); CREATE TABLE helix_environment_temporal_plan_admissions (
      action_request_id text, resident_action_request_id text, plan_id text
    );`);
    const { Pool } = memory.adapters.createPg();
    const pool = new Pool();
    const old = "2026-01-01T00:00:00.000Z";
    const active = ["leased", "running", "paused_manual_override", "cancel_requested"];
    const fixtures = [
      ...active.map(status => [status, status, "root", "plan"]),
      ["root", "running", "root", "plan"],
      ["wrong-plan", "running", "root", "other"],
      ["wrong-resident", "running", "other", "plan"],
      ["unadmitted", "running", "none", "none"],
      ...["succeeded", "failed", "canceled", "timed_out", "emergency_stopped", "connector_offline", "authority_stale", "queued"].map(status => [`excluded-${status}`, status, "root", "plan"]),
    ];
    try {
      for (const [id, status, resident, plan] of fixtures) {
        await pool.query("INSERT INTO helix_environment_action_requests VALUES ($1,$2,$3,$3)", [id, status, old]);
        if (id !== "unadmitted") await pool.query("INSERT INTO helix_environment_temporal_plan_admissions VALUES ($1,$2,$3)", [id, resident, plan]);
      }
      await pool.query(temporalDeliveryStatusSql, ["root", "plan", state]);
      const rows = (await pool.query("SELECT * FROM helix_environment_action_requests")).rows;
      for (const [id, original] of fixtures) {
        const row = rows.find((row: { action_request_id: string }) => row.action_request_id === id);
        const selected = active.includes(id);
        expect(row.status).toBe(selected ? state : original);
        expect(new Date(row.updated_at).toISOString() === old).toBe(!selected);
        const terminal = !["running", "paused_manual_override"].includes(state);
        expect(new Date(row.completed_at).toISOString() === old).toBe(!(selected && terminal));
      }
    } finally { await pool.end(); }
  });
