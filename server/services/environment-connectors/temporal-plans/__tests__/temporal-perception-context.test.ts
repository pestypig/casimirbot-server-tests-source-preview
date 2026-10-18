import { afterEach, expect, it, vi } from "vitest";
import { newDb } from "pg-mem";
import { environmentDurableGoalStore } from "../../goals/durable-goal-store";
import * as probe from "../../probe/durable-broker";
import * as database from "../../../helix-ask/realtime-room/room-store/database";
import { resolveTemporalPerceptionContext } from "../temporal-perception-context";
import * as actions from "../../actions/action-broker";
import { performance } from "node:perf_hooks";

const catalogFor = (identity: {
  action_authority_id: string; authority_policy_version: number; room_id: string;
  environment_binding_id: string; source_id: string; world_id: string;
  subject_binding_id: string; subject_native_id: string; producer_epoch_ref: string;
}) => ({
  context: { actionAuthorityId: identity.action_authority_id, policyVersion: identity.authority_policy_version,
    roomId: identity.room_id, environmentBindingId: identity.environment_binding_id, sourceId: identity.source_id,
    worldId: identity.world_id, subjectBindingId: identity.subject_binding_id, subjectNativeId: identity.subject_native_id },
  action_producer_epoch_ref: identity.producer_epoch_ref, capabilities: [], truncated: false,
  resident_clock_observation: null,
  execution_authority: false, answer_authority: false, terminal_eligible: false,
// This join fixture intentionally supplies only the authority fields it consumes.
} as unknown as Awaited<ReturnType<typeof actions.resolveEnvironmentTemporalActionCatalog>>);

afterEach(() => { vi.restoreAllMocks(); });

it("executes the source join and rejects revoked, expired and cross-bound records", async () => {
  const { Pool } = newDb().adapters.createPg();
  const pool = new Pool();
  try {
    // Minimal columns from migrations 038/039: real SQL execution, not a query mock.
    await pool.query(`
      CREATE TABLE helix_environment_connector_bindings (environment_binding_id text, device_id text, installation_id text, room_source_binding_id text, adapter_admission_id text, room_id text, source_id text, world_id text, status text);
      CREATE TABLE helix_environment_connector_devices (device_id text, installation_id text, producer_epoch_ref text, status text);
      CREATE TABLE helix_environment_connector_installations (installation_id text, status text);
      CREATE TABLE helix_room_source_bindings (binding_id text, status text);
      CREATE TABLE helix_environment_adapter_admissions (admission_id text, credential_id text, binding_id text, room_id text, source_id text, world_id text, status text);
      CREATE TABLE helix_room_source_credentials (credential_id text, status text, expires_at timestamptz);
      INSERT INTO helix_environment_connector_bindings VALUES ('env','device','install','source-binding','admission','room','source','world','active');
      INSERT INTO helix_environment_connector_devices VALUES ('device','install','observation-epoch','active');
      INSERT INTO helix_environment_connector_installations VALUES ('install','active');
      INSERT INTO helix_room_source_bindings VALUES ('source-binding','active');
      INSERT INTO helix_environment_adapter_admissions VALUES ('admission','credential','source-binding','room','source','world','active');
      INSERT INTO helix_room_source_credentials VALUES ('credential','active',null);
    `);
    vi.spyOn(database, "readSharedRealtimeRoomDatabase").mockResolvedValue(pool as unknown as Awaited<ReturnType<typeof database.readSharedRealtimeRoomDatabase>>);
    const identity = {
      environment_binding_id: "env", room_id: "room", source_id: "source", world_id: "world",
      room_source_binding_id: "source-binding", subject_binding_id: "subject", subject_native_id: "player", producer_epoch_ref: "action-epoch",
      action_authority_id: "authority:test", authority_policy_version: 1, authority_participant_id: "participant:test",
    };
    vi.spyOn(environmentDurableGoalStore, "resolveTemporalAdmissionContext").mockResolvedValue({ identity } as Awaited<ReturnType<typeof environmentDurableGoalStore.resolveTemporalAdmissionContext>>);
    vi.spyOn(actions, "resolveEnvironmentTemporalActionCatalog").mockResolvedValue(catalogFor(identity));
    const read = vi.spyOn(probe, "readDurableEnvironmentProbeContinuationEvidence").mockResolvedValue({ observation: {
      result: { snapshot_schema: "helix.minecraft_perception_snapshot.v1" },
    } } as unknown as Awaited<ReturnType<typeof probe.readDurableEnvironmentProbeContinuationEvidence>>);
    const call = () => resolveTemporalPerceptionContext({ goalId: "goal", profileId: "profile", participantId: "participant",
      expectedRevision: 1, roomId: "room", runId: null, turnId: "turn", priorTurnId: "prior", probeRequestId: "probe" });
    await expect(call()).resolves.toMatchObject({ observation_producer_epoch_ref: "observation-epoch" });
    for (const table of ["helix_environment_connector_bindings", "helix_environment_connector_devices", "helix_environment_connector_installations", "helix_room_source_bindings", "helix_environment_adapter_admissions", "helix_room_source_credentials"]) {
      await pool.query(`UPDATE ${table} SET status='revoked'`);
      read.mockClear();
      await expect(call()).rejects.toMatchObject({ code: "durable_goal_identity_unavailable" });
      expect(read).not.toHaveBeenCalled();
      await pool.query(`UPDATE ${table} SET status='active'`);
    }
    await pool.query("UPDATE helix_room_source_credentials SET expires_at='2000-01-01T00:00:00Z'");
    await expect(call()).rejects.toMatchObject({ code: "durable_goal_identity_unavailable" });
    await pool.query("UPDATE helix_room_source_credentials SET expires_at=null");
    await pool.query("UPDATE helix_environment_connector_devices SET installation_id='other'");
    await expect(call()).rejects.toMatchObject({ code: "durable_goal_identity_unavailable" });
    await pool.query("UPDATE helix_environment_connector_devices SET installation_id='install'");
    await pool.query("UPDATE helix_environment_adapter_admissions SET world_id='other'");
    await expect(call()).rejects.toMatchObject({ code: "durable_goal_identity_unavailable" });
  } finally { await pool.end(); }
});

it.each(["current", "goal_denied", "source_absent", "evidence_absent", "evidence_expired", "wrong_snapshot", "action_epoch_changed", "catalog_truncated", "wrong_player"])(
  "joins exact goal and perception without substituting producer planes (%s)", async (scenario) => {
    let clock = 100;
    if (scenario === "evidence_expired") vi.spyOn(performance, "now").mockImplementation(() => (clock += 10));
    const identity = { environment_binding_id: "environment:test", room_id: "room:test",
      source_id: "source:test", world_id: "world:test", room_source_binding_id: "binding:source",
      subject_binding_id: "binding:player", subject_native_id: "player:test", producer_epoch_ref: "epoch:action",
      action_authority_id: "authority:test", authority_policy_version: 1, authority_participant_id: "participant:test" };
    const catalog = catalogFor(identity);
    if (scenario === "action_epoch_changed") catalog.action_producer_epoch_ref = "epoch:changed";
    if (scenario === "catalog_truncated") catalog.truncated = true;
    if (scenario === "wrong_player") catalog.context.subjectNativeId = "player:other";
    vi.spyOn(actions, "resolveEnvironmentTemporalActionCatalog").mockResolvedValue(catalog);
    const goal = vi.spyOn(environmentDurableGoalStore, "resolveTemporalAdmissionContext");
    if (scenario === "goal_denied") goal.mockRejectedValue(new Error("goal denied"));
    else goal.mockResolvedValue({ identity } as Awaited<ReturnType<typeof environmentDurableGoalStore.resolveTemporalAdmissionContext>>);
    const query = vi.fn().mockResolvedValue({ rows: scenario === "source_absent" ? [] : [{ producer_epoch_ref: "epoch:observation" }] });
    vi.spyOn(database, "readSharedRealtimeRoomDatabase").mockResolvedValue({ query } as unknown as Awaited<ReturnType<typeof database.readSharedRealtimeRoomDatabase>>);
    const read = vi.spyOn(probe, "readDurableEnvironmentProbeContinuationEvidence").mockResolvedValue(
      scenario === "evidence_absent" ? null : { observation: { result: {
        snapshot_schema: scenario === "wrong_snapshot" ? "wrong" : "helix.minecraft_perception_snapshot.v1",
      } } } as unknown as Awaited<ReturnType<typeof probe.readDurableEnvironmentProbeContinuationEvidence>>);
    if (scenario === "evidence_expired") read.mockImplementation(async input => {
      input.onExpired?.({ evidence_age_ms: 5001, max_age_ms: 5000 });
      return null;
    });
    const result = resolveTemporalPerceptionContext({ goalId: "goal:test", profileId: "profile:test",
      participantId: "participant:test", expectedRevision: 1, roomId: "room:test", runId: "run:test",
      turnId: "turn:new", priorTurnId: "turn:prior", probeRequestId: "probe:test" });
    if (scenario === "current") {
      await expect(result).resolves.toMatchObject({ observation_producer_epoch_ref: "epoch:observation",
        action_producer_epoch_ref: "epoch:action", execution_authority: false });
      expect(read).toHaveBeenCalledWith(expect.objectContaining({ maxAgeMs: 5000,
        expectedEnvironmentIdentity: { environmentBindingId: "environment:test", sourceId: "source:test",
          worldId: "world:test", subjectBindingId: "binding:player", subjectNativeId: "player:test",
          observationProducerEpochRef: "epoch:observation" } }));
    } else if (scenario === "evidence_expired") {
      await expect(result).rejects.toMatchObject({ code: "durable_goal_evidence_stale",
        evidenceExpiry: { evidence_age_ms: 5001, max_age_ms: 5000,
          context_stage_ms: { goal: 10, catalog: 10, perception: 10 } } });
    } else if (["evidence_absent", "wrong_snapshot"].includes(scenario)) {
      await expect(result).rejects.toMatchObject({ code: "durable_goal_evidence_identity_mismatch" });
    } else await expect(result).rejects.toThrow();
    if (scenario === "goal_denied") expect(query).not.toHaveBeenCalled();
    if (scenario === "goal_denied" || scenario === "source_absent") expect(read).not.toHaveBeenCalled();
  },
);
