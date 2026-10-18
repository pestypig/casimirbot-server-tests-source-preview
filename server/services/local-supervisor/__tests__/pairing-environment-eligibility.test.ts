import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isPairingEnvironmentEligible } from "../pairing-environment-eligibility";
let pool: Pool;
vi.mock("../../../db/client", () => ({ ensureDatabase: async () => {}, getPool: () => pool }));
const input = { profileId: "fixture-owner", issuer: "fixture-issuer", roomId: "fixture-room", runId: "fixture-run", participantId: "fixture-participant" };
beforeEach(async () => {
  pool = new (newDb().adapters.createPg().Pool)();
  await pool.query(`CREATE TABLE helix_agent_runs (run_id text, tenant_id text, issuer text, subject_id text,
    account_profile_id text, lifecycle_status text, expires_at timestamptz, cancelled_at timestamptz,
    completed_at timestamptz, steps_used integer, max_steps integer)`);
  await pool.query(`CREATE TABLE helix_agent_run_room_bindings (run_id text, tenant_id text, issuer text,
    subject_id text, account_profile_id text, status text, room_id text, participant_id_at_bind text)`);
  await pool.query(`INSERT INTO helix_agent_runs VALUES ('fixture-run','fixture-tenant','fixture-issuer','fixture-subject',
    'fixture-owner','waiting','2099-01-01',NULL,NULL,1,10)`);
  await pool.query(`INSERT INTO helix_agent_run_room_bindings VALUES ('fixture-run','fixture-tenant','fixture-issuer',
    'fixture-subject','fixture-owner','active','fixture-room','fixture-participant')`);
});
afterEach(async () => { await pool.end(); });
it("validates the live owner/run binding without relying on a heartbeat", async () => {
  expect(await isPairingEnvironmentEligible(input)).toBe(true);
  for (const key of Object.keys(input)) {
    expect(await isPairingEnvironmentEligible({ ...input, [key]: "fixture-foreign" })).toBe(false);
  }
});
it.each([
  "UPDATE helix_agent_runs SET cancelled_at = NOW()",
  "UPDATE helix_agent_runs SET completed_at = NOW()",
  "UPDATE helix_agent_runs SET expires_at = '2000-01-01'",
  "UPDATE helix_agent_runs SET steps_used = max_steps",
  "UPDATE helix_agent_runs SET lifecycle_status = 'completed'",
  "UPDATE helix_agent_run_room_bindings SET status = 'revoked'",
  "UPDATE helix_agent_run_room_bindings SET subject_id = 'fixture-foreign'",
])("rejects stale or mismatched binding state: %s", async mutation => {
  await pool.query(mutation);
  expect(await isPairingEnvironmentEligible(input)).toBe(false);
});
