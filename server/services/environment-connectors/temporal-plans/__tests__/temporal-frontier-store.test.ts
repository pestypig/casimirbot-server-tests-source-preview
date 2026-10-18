import { newDb } from "pg-mem";
import { expect, it } from "vitest";
import { migration082 } from "../../../../db/migrations/082_environment_temporal_frontiers";
import { migration083 } from "../../../../db/migrations/083_environment_temporal_plan_admissions";
import { EnvironmentTemporalFrontierStore } from "../temporal-frontier-store";
import { TemporalPlanError, temporalPlanErrorProjection } from "../temporal-plan-error";
import type { PoolClient } from "pg";
import { helixEnvironmentTimeSha256 } from "@shared/helix-environment-time";

it("assigns revisions and preserves exact replay under a current goal grant", async () => {
  const { Pool } = newDb().adapters.createPg();
  const pool = new Pool();
  try {
    await pool.query(`CREATE TABLE helix_environment_durable_goals (goal_id text PRIMARY KEY, current_sequence bigint, status text);
      CREATE TABLE helix_environment_durable_goal_participants (goal_id text, profile_id text, participant_id text, status text, scopes jsonb);
      INSERT INTO helix_environment_durable_goals VALUES ('goal:test',1,'active');
      INSERT INTO helix_environment_durable_goal_participants VALUES ('goal:test','profile:test','participant:test','active','["steer"]');`);
    await migration082.run(pool, { enablePgvector: false });
    const store = new EnvironmentTemporalFrontierStore(async <T>(fn: (db: PoolClient) => Promise<T>) => fn(pool as unknown as PoolClient));
    const input = { profileId: "profile:test", participantId: "participant:test",
      observationEvidenceRef: "evidence:1", observationProducerEpochRef: "epoch:observation",
      retainedUntil: "2026-09-06T00:00:00Z", draft: {
        identity: { environment_id: "environment:test", source_id: "source:test", subject_id: "subject:test",
          producer_epoch: "epoch:action", authority_id: "authority:test", authority_revision: 1,
          goal_id: "goal:test", goal_revision: 1, observation_revision: 1 },
        clocks: { environment: { kind: "tick" as const, sequence: 1, resolution_unit: "world_tick", nominal_units_per_second: 20 },
          monotonic: { origin_id: "clock:test", elapsed_ms: 1 }, audit_at: "2026-09-05T00:00:00Z" },
        expires_at_environment_sequence: 3, entries: [{ capability_id: "move:test", capability_version: "1",
          subject_id: "subject:test", state: "available_now" as const, reason_codes: [], required_authority_ids: [],
          held_resource_keys: [], parameter_bounds: {}, missing_observation_kinds: [], evidence_probe_capability_ids: [] }],
      } };
    const first = await store.publish(input);
    await pool.query("CREATE TABLE helix_environment_action_requests(action_request_id text PRIMARY KEY); INSERT INTO helix_environment_action_requests VALUES ('action:pinned')");
    await migration083.run(pool as never, { enablePgvector: false });
    await pool.query(`INSERT INTO helix_environment_temporal_plan_admissions
      (plan_id,plan_hash,source_plan,compilation_hash,compilation_artifact,action_request_id,
       frontier_id,goal_id,goal_revision,reasoning_binding_id,reasoning_binding_epoch,client_continuation_ref)
      VALUES ('plan:pinned','hash:plan','{}','hash:compiled','{}','action:pinned',$1,'goal:test',1,'binding:test',1,'continuation:test')`,
      [first.frontier.frontier_id]);
    expect(first.frontier.identity.affordance_revision).toBe(1);
    const read = { frontierId: first.frontier.frontier_id, profileId: "profile:test", participantId: "participant:test", now: new Date("2026-09-05T01:00:00Z") };
    await expect(store.read(read)).resolves.toBeNull(); // steer does not silently imply read
    await pool.query(`UPDATE helix_environment_durable_goal_participants SET scopes='["read","steer"]'`);
    await expect(store.read(read)).resolves.toEqual(first.frontier);
    await expect(store.read({ ...read, expectedEvidenceRef: "evidence:wrong" })).resolves.toBeNull();
    await expect(store.read({ ...read, expectedObservationProducerEpoch: "epoch:wrong" })).resolves.toBeNull();
    await expect(store.read({ ...read, profileId: "profile:other" })).resolves.toBeNull();
    await expect(store.read({ ...read, now: new Date(input.retainedUntil) })).resolves.toBeNull();
    await expect(store.read({ ...read, now: new Date("2026-09-04T00:00:00Z") })).resolves.toBeNull();
    expect(await store.publish(input)).toEqual({ ...first, created: false });
    await expect(store.publish({ ...input, draft: { ...input.draft, expires_at_environment_sequence: 4 } })).rejects.toThrow("temporal_frontier_replay_conflict");
    const next = await store.publish({ ...input, observationEvidenceRef: "evidence:2", draft: {
      ...input.draft, identity: { ...input.draft.identity, observation_revision: 2 } } });
    expect(next.frontier.identity.affordance_revision).toBe(2);
    await expect(store.read({ ...read, requireLatestForGoal: true })).resolves.toBeNull();
    await expect(store.read({ ...read, frontierId: next.frontier.frontier_id,
      requireLatestForGoal: true })).resolves.toEqual(next.frontier);
    expect(first.frontier.newly_available_capability_ids).toEqual(["move:test"]);
    expect(next.frontier.newly_available_capability_ids).toEqual([]);
    expect(next.frontier.materially_changed_capability_ids).toEqual([]);
    await expect(store.publish({ ...input, observationEvidenceRef: "evidence:regressed" })).rejects.toThrow("temporal_frontier_observation_regressed");
    const blocked = await store.publish({ ...input, observationEvidenceRef: "evidence:blocked", draft: {
      ...input.draft, identity: { ...input.draft.identity, observation_revision: 3 },
      entries: [{ ...input.draft.entries[0], state: "blocked", reason_codes: ["path_obstructed"] }] } });
    expect(blocked.frontier.newly_blocked_capability_ids).toEqual(["move:test"]);
    expect(blocked.frontier.materially_changed_capability_ids).toEqual(["move:test"]);
    const expiredInput = { ...input, observationEvidenceRef: "evidence:expired-baseline", draft: {
      ...input.draft, identity: { ...input.draft.identity, observation_revision: 4 },
      clocks: { ...input.draft.clocks, environment: { ...input.draft.clocks.environment, sequence: 3 } },
      expires_at_environment_sequence: 5 } };
    const expired = await store.publish(expiredInput);
    expect(expired.frontier.newly_available_capability_ids).toEqual(["move:test"]);
    expect(expired.frontier.materially_changed_capability_ids).toEqual([]);
    const clockResetInput = { ...expiredInput, observationEvidenceRef: "evidence:clock-reset", draft: {
      ...expiredInput.draft, identity: { ...input.draft.identity, observation_revision: 5 },
      clocks: { ...expiredInput.draft.clocks, monotonic: { origin_id: "clock:new", elapsed_ms: 0 } } } };
    const clockReset = await store.publish(clockResetInput);
    expect(clockReset.frontier.newly_available_capability_ids).toEqual(["move:test"]);
    await pool.query("UPDATE helix_environment_temporal_frontiers SET payload_hash='corrupt' WHERE frontier_id=$1", [clockReset.frontier.frontier_id]);
    await expect(store.publish({ ...clockResetInput, observationEvidenceRef: "evidence:corrupt-parent" })).rejects.toThrow("temporal_frontier_integrity_invalid");
    await expect(store.publish(clockResetInput)).rejects.toThrow("temporal_frontier_integrity_invalid");
    await pool.query("UPDATE helix_environment_temporal_frontiers SET payload_hash=$2 WHERE frontier_id=$1", [clockReset.frontier.frontier_id, helixEnvironmentTimeSha256(clockReset.frontier)]);
    const reset = await store.publish({ ...input, observationEvidenceRef: "evidence:reset", observationProducerEpochRef: "epoch:new" });
    expect(reset.frontier.newly_available_capability_ids).toEqual(["move:test"]);
    const cleanup = { goalId: "goal:test", profileId: "profile:test", participantId: "participant:test", now: new Date("2026-09-06T00:00:00Z") };
    await expect(store.pruneExpired({ ...cleanup, profileId: "profile:other" })).rejects.toThrow("temporal_frontier_forbidden");
    await expect(store.pruneExpired({ ...cleanup, now: new Date("2026-09-05T01:00:00Z") })).resolves.toEqual({ removed: 0 });
    await expect(store.pruneExpired(cleanup)).resolves.toEqual({ removed: 4 });
    expect((await pool.query("SELECT frontier_id FROM helix_environment_temporal_frontiers WHERE frontier_id=$1", [first.frontier.frontier_id])).rows).toHaveLength(1);
    await expect(store.pruneExpired(cleanup)).resolves.toEqual({ removed: 0 });
    const afterCleanup = await store.publish({ ...input, observationEvidenceRef: "evidence:after-cleanup", observationProducerEpochRef: "epoch:later" });
    expect(afterCleanup.frontier.identity.affordance_revision).toBe(7);
    await pool.query("UPDATE helix_environment_durable_goals SET current_sequence=2");
    const stale = await store.publish(input).catch(error => error);
    expect(stale).toBeInstanceOf(TemporalPlanError);
    expect(temporalPlanErrorProjection(stale)).toMatchObject({
      error: "temporal_frontier_goal_stale", retryable: false, execution_authority: false,
    });
    const rows = await pool.query("SELECT * FROM helix_environment_temporal_frontiers");
    expect(rows.rows).toHaveLength(3);
  } finally { await pool.end(); }
});

it("rejects an invalid read clock with a typed gate before opening a transaction", async () => {
  let called = false;
  const store = new EnvironmentTemporalFrontierStore(async () => { called = true; throw new Error("unexpected transaction"); });
  const error = await store.read({ frontierId: "frontier:test", profileId: "profile:test",
    participantId: "participant:test", now: new Date("invalid") }).catch(error => error);
  expect(error).toBeInstanceOf(TemporalPlanError);
  expect(temporalPlanErrorProjection(error)).toMatchObject({ error: "temporal_frontier_time_invalid", retryable: false });
  expect(called).toBe(false);
});
