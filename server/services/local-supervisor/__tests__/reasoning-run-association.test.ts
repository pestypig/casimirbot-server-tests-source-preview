import { beforeEach, describe, expect, it, vi } from "vitest";
import { newDb } from "pg-mem";
import type { HelixLocalSupervisorPresence } from "@shared/helix-local-supervisor-coordination";
const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../../db/client", () => ({ ensureDatabase: vi.fn(), getPool: () => db }));
import { resolveReasoningRunAssociation } from "../reasoning-run-association";

const presence = () => ({
  active: true, authenticated_profile_ref: "profile-owned", run_ref: "run-owned", room_ref: "room-owned",
  observed_at: new Date(Date.now() - 1000).toISOString(),
  heartbeat_expires_at: new Date(Date.now() + 60000).toISOString(),
  verified_room_identity: { basis: "server_verified", room_ref: "room-owned", participant_ref: "participant-owned" },
  verified_retained_runtime_identity: { basis: "server_verified", run_ref: "run-owned", run_version: 2,
    run_room_binding_ref: "binding-owned", run_room_binding_version: 3, verification_ref: "verification-current" },
} as HelixLocalSupervisorPresence);

describe("reasoning run association revalidation", () => {
  beforeEach(() => { db.query.mockReset(); });
  it("requires verified, fresh room and runtime evidence before querying", async () => {
    for (const patch of [
      { active: false }, { verified_retained_runtime_identity: null }, { verified_room_identity: null },
      { run_ref: "other-run" }, { room_ref: "other-room" },
      { heartbeat_expires_at: new Date(0).toISOString() }, { observed_at: "invalid" },
      { heartbeat_expires_at: "invalid" },
    ]) expect(await resolveReasoningRunAssociation({ ...presence(), ...patch })).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });
  it("revalidates the exact owner, run/version and room/participant association", async () => {
    db.query.mockResolvedValue({ rows: [{ run_id: "run-owned", expires_at: "2099-01-01T00:00:00.000Z" }] });
    expect(await resolveReasoningRunAssociation(presence())).toEqual({
      run_id: "run-owned", run_version: 2, room_id: "room-owned", room_binding_id: "binding-owned",
      room_binding_version: 3, verification_ref: "verification-current",
      run_expires_at: "2099-01-01T00:00:00.000Z",
    });
    const [sql, params] = db.query.mock.calls[0];
    expect(params).toEqual(["run-owned", "profile-owned", 2, "binding-owned", 3, "room-owned", "participant-owned"]);
    for (const guard of ["b.tenant_id = r.tenant_id", "b.issuer = r.issuer", "b.subject_id = r.subject_id",
      "b.account_profile_id = r.account_profile_id", "r.expires_at > NOW()", "r.cancelled_at IS NULL",
      "b.status = 'active'", "r.lifecycle_status IN ('queued', 'running', 'waiting')"])
      expect(sql).toContain(guard);
  });
  it("returns no preview when the current stored association no longer matches", async () => {
    db.query.mockResolvedValue({ rows: [] });
    expect(await resolveReasoningRunAssociation(presence())).toBeNull();
  });
  it("executes the query against pg-mem and rejects changed ownership, lifecycle and binding state", async () => {
    const memory = newDb();
    // Projection columns match migrations 032/034; this is query execution,
    // not a full production migration or live PostgreSQL concurrency test.
    memory.public.none(`
      CREATE TABLE helix_agent_runs (run_id text, account_profile_id text, tenant_id text,
        issuer text, subject_id text, version bigint, lifecycle_status text,
        expires_at timestamptz, cancelled_at timestamptz, completed_at timestamptz,
        steps_used integer, max_steps integer);
      CREATE TABLE helix_agent_run_room_bindings (run_id text, account_profile_id text,
        tenant_id text, issuer text, subject_id text, binding_id text, version bigint,
        status text, room_id text, participant_id_at_bind text);
      INSERT INTO helix_agent_runs VALUES ('run-owned','profile-owned','tenant','issuer','subject',
        2,'waiting','2099-01-01',NULL,NULL,0,20);
      INSERT INTO helix_agent_run_room_bindings VALUES ('run-owned','profile-owned','tenant','issuer',
        'subject','binding-owned',3,'active','room-owned','participant-owned');
    `);
    const snapshot = memory.backup();
    const pool = new (memory.adapters.createPg().Pool)();
    db.query.mockImplementation((...args) => pool.query(...args));
    try {
      expect(await resolveReasoningRunAssociation(presence())).toMatchObject({ run_id: "run-owned" });
      for (const mutation of [
        "UPDATE helix_agent_runs SET account_profile_id = 'other-profile'",
        "UPDATE helix_agent_runs SET version = 4",
        "UPDATE helix_agent_runs SET lifecycle_status = 'completed'",
        "UPDATE helix_agent_runs SET cancelled_at = '2020-01-01'",
        "UPDATE helix_agent_runs SET expires_at = '2020-01-01'",
        "UPDATE helix_agent_runs SET steps_used = max_steps",
        "UPDATE helix_agent_runs SET steps_used = max_steps + 1",
        "UPDATE helix_agent_runs SET completed_at = '2020-01-01'",
        "UPDATE helix_agent_run_room_bindings SET tenant_id = 'other-tenant'",
        "UPDATE helix_agent_run_room_bindings SET issuer = 'other-issuer'",
        "UPDATE helix_agent_run_room_bindings SET subject_id = 'other-subject'",
        "UPDATE helix_agent_run_room_bindings SET version = 4",
        "UPDATE helix_agent_run_room_bindings SET status = 'revoked'",
        "UPDATE helix_agent_run_room_bindings SET room_id = 'other-room'",
        "UPDATE helix_agent_run_room_bindings SET participant_id_at_bind = 'other-player'",
      ]) {
        snapshot.restore();
        memory.public.none(mutation);
        expect(await resolveReasoningRunAssociation(presence()), mutation).toBeNull();
      }
    } finally {
      await pool.end();
    }
  });
});
