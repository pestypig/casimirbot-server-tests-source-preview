import { expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import type { HelixLocalSupervisorPresence } from "@shared/helix-local-supervisor-coordination";
import { resolveReasoningRunAssociation } from "../../services/local-supervisor/reasoning-run-association";

vi.mock("../../services/runtime/runtime-memory-governor", () => ({ scheduleRuntimeIdleMemorySettle: () => undefined }));

it("revalidates an exact run through the fully migrated local database before and after snapshot reconstruction", async () => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "casimir-run-reconstruction-"));
  const snapshotPath = path.join(directory, "snapshot.json");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("HELIX_LOCAL_DB_PATH", snapshotPath);
  vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "1");
  vi.stubEnv("HELIX_LOCAL_PG_MEM_WRITE_MODE", "deferred");
  const db = await import("../client");
  const presence = () => ({ active: true, authenticated_profile_ref: "fixture-owner",
    run_ref: "fixture-run", room_ref: "fixture-room", observed_at: new Date().toISOString(),
    heartbeat_expires_at: new Date(Date.now() + 60000).toISOString(),
    verified_room_identity: { basis: "server_verified", room_ref: "fixture-room", participant_ref: "fixture-participant" },
    verified_retained_runtime_identity: { basis: "server_verified", run_ref: "fixture-run", run_version: 1,
      run_room_binding_ref: "fixture-binding", run_room_binding_version: 1, verification_ref: "fixture-verification" },
  } as HelixLocalSupervisorPresence);
  try {
    await db.ensureDatabase();
    await db.getPool().query("INSERT INTO helix_accounts(profile_id,display_name) VALUES ('fixture-owner','Fixture')");
    await db.getPool().query("INSERT INTO helix_shared_realtime_rooms(room_id,owner_profile_id,title) VALUES ('fixture-room','fixture-owner','Fixture')");
    await db.getPool().query(`INSERT INTO helix_agent_runs
      (run_id,schema_version,tenant_id,issuer,subject_id,account_profile_id,objective,objective_hash,
       runtime_provider,provider_goal_id,provider_thread_id,provider_session_id,lifecycle_status,
       completion_status,terminal_authority_status,configuration,evidence_bundle,max_steps,expires_at,created_at,updated_at)
      VALUES ('fixture-run','v1','fixture-tenant','fixture-issuer','fixture-subject','fixture-owner',
       'Observe only','fixture-hash','fixture','fixture-goal','fixture-task','fixture-session',
       'waiting','incomplete','unverified','{}','{}',12,'2099-01-01',NOW(),NOW())`);
    await db.getPool().query(`INSERT INTO helix_agent_run_room_bindings
      (binding_id,run_id,tenant_id,issuer,subject_id,account_profile_id,room_id,authorized_by_profile_id,
       participant_id_at_bind,member_role_at_bind,consent_version_at_bind,created_at,updated_at)
      VALUES ('fixture-binding','fixture-run','fixture-tenant','fixture-issuer','fixture-subject','fixture-owner',
       'fixture-room','fixture-owner','fixture-participant','owner',0,NOW(),NOW())`);
    await db.requireDurableDatabaseSnapshot(["helix_accounts", "helix_shared_realtime_rooms", "helix_agent_runs", "helix_agent_run_room_bindings"]);
    expect(await resolveReasoningRunAssociation(presence())).toMatchObject({ run_id: "fixture-run", room_id: "fixture-room" });
    await db.resetDbClient(); await db.ensureDatabase();
    expect(await resolveReasoningRunAssociation(presence())).toMatchObject({ run_id: "fixture-run", room_id: "fixture-room" });
    await db.getPool().query("UPDATE helix_agent_run_room_bindings SET status='revoked' WHERE binding_id='fixture-binding'");
    expect(await resolveReasoningRunAssociation(presence())).toBeNull();
  } finally {
    await db.resetDbClient(); vi.unstubAllEnvs();
    for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
    fs.rmdirSync(directory);
  }
}, 60000);
