import { afterEach, expect, it, vi } from "vitest";
import { newDb } from "pg-mem";
import * as database from "../../../helix-ask/realtime-room/room-store/database";
import * as registry from "../../../situation-room/environment-action-adapter-registry";
import { leasePendingEnvironmentActions, leasePendingEnvironmentTemporalSuccessor } from "../action-broker";

afterEach(() => { vi.restoreAllMocks(); });

it.each(["revoked", "credential_changed", "resident_stopped"])("resident delivery rejects %s before successor selection", async scenario => {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM helix_environment_action_authorities a")) return { rows: [{
      authority_status: scenario === "revoked" ? "revoked" : "active", authority_expires_at: null,
      environment_status: "active", source_status: "active", room_status: "open", owner_profile_id: "owner",
      credential_id: scenario === "credential_changed" ? "replacement" : "credential", policy_version: 1,
      credential_status: "active", credential_expires_at: new Date(Date.now() + 60000),
    }] };
    if (sql.includes("connector_manifests")) return { rows: [{ manifest_id: "manifest" }] };
    if (sql.includes("connector_heartbeats")) return { rows: [{ status: "active", received_at: new Date(),
      emergency_stop_latched: false, control_engines: [] }] };
    if (sql.includes("FROM helix_environment_action_requests")) return { rows: [{ status: "canceled" }] };
    return { rows: [] };
  });
  vi.spyOn(database, "withSharedRealtimeRoomTransaction").mockImplementation(async work => work({ query } as never));
  vi.spyOn(registry, "resolveEnvironmentActionAdapterProfile").mockReturnValue({
    profile: { freshness: { heartbeat_max_age_ms: 30000 } },
  } as never);
  const inspect = vi.fn();
  const lease = leasePendingEnvironmentTemporalSuccessor({ claim: { authorityId: "authority", ownerProfileId: "owner",
    credentialId: "credential", policyVersion: 1 } as never, residentActionRequestId: "resident",
    predecessorPlanId: "plan", predecessorPlanHash: "hash", checkpointId: "checkpoint", bindingStore: { inspect } });
  if (scenario === "revoked") await expect(lease).rejects.toMatchObject({ code: "action_authority_inactive" });
  else expect(await lease).toBeNull();
  expect(query.mock.calls[0][0]).toContain("FOR UPDATE");
  expect(query.mock.calls.some(([sql]) => sql.includes("temporal_plan_admissions") || sql.includes("SET status='leased'"))).toBe(false);
  expect(inspect).not.toHaveBeenCalled();
});

it.each(["finite", "initial_temporal", "successor", "unpublished_root", "rejected_root"])("ordinary work detection separates %s from resident extensions", async kind => {
  const memory = newDb();
  memory.public.none(`CREATE TABLE helix_environment_action_requests (
    action_authority_id text, status text, lease_expires_at timestamptz, request_payload jsonb
  );`);
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  const payload = kind === "finite" ? {} : { temporal_plan: { previous_plan_id: kind === "successor" ? "plan:root" : null } };
  const status = kind === "unpublished_root" ? "queued" : kind === "rejected_root" ? "failed" : "admitted";
  await pool.query("INSERT INTO helix_environment_action_requests VALUES ($1,$2,null,$3)", ["authority", status, payload]);
  const db = { query: async (sql: string, args: unknown[]) => {
    if (sql.includes("connector_manifests")) return { rows: [{ manifest_id: "manifest" }] };
    if (sql.includes("connector_heartbeats")) return { rows: [{ status: "active", received_at: new Date(),
      emergency_stop_latched: false, control_engines: [] }] };
    return pool.query(sql, args);
  } };
  vi.spyOn(database, "readSharedRealtimeRoomDatabase").mockResolvedValue(db as never);
  vi.spyOn(registry, "resolveEnvironmentActionAdapterProfile").mockReturnValue({
    profile: { freshness: { heartbeat_max_age_ms: 30000 } },
  } as never);
  const transaction = vi.spyOn(database, "withSharedRealtimeRoomTransaction").mockRejectedValue(new Error("ordinary_transaction_entered"));
  try {
    const lease = leasePendingEnvironmentActions({ claim: { authorityId: "authority" } as never });
    if (["successor", "unpublished_root", "rejected_root"].includes(kind)) {
      expect(await lease).toEqual({ requests: [], queueDepthAtLease: 0, oldestPendingAgeMs: 0 });
      expect(transaction).not.toHaveBeenCalled();
      expect((await pool.query("SELECT status FROM helix_environment_action_requests")).rows[0].status).toBe(status);
    } else {
      await expect(lease).rejects.toThrow("ordinary_transaction_entered");
      expect(transaction).toHaveBeenCalledOnce();
    }
  } finally {
    await pool.end();
  }
});
