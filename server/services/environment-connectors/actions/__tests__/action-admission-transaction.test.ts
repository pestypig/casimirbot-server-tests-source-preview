import { afterEach, expect, it, vi } from "vitest";
import { newDb } from "pg-mem";
import * as database from "../../../helix-ask/realtime-room/room-store/database";
import * as membership from "../../../helix-ask/realtime-room/room-store";
import * as registry from "../../../situation-room/environment-action-adapter-registry";
import { enqueueEnvironmentAction, hashEnvironmentActionIdempotencyContent, storedEnvironmentActionMatchesIdempotencyContent } from "../action-broker";
import { helixEnvironmentActionRequestSchema } from "@shared/helix-environment-action";
import * as retention from "../../temporal-plans/temporal-admission-retention";
import { buildHelixEnvironmentTemporalPlan, serializeHelixEnvironmentPlanHashContent, helixEnvironmentTimeSha256 } from "@shared/helix-environment-time";
afterEach(() => { vi.restoreAllMocks(); });

function admissionFixture(scenario: string) {
  const isTemporal = scenario.startsWith("temporal_");
  const status = scenario === "revoked" ? "revoked" : "active";
  const plan = buildHelixEnvironmentTemporalPlan({ plan_id: "plan:test", previous_plan_id: null, previous_plan_hash: null,
    identity: { environment_id: "env:test", source_id: "source:test", subject_id: "subject:test", producer_epoch: "epoch:test",
      authority_id: "authority:test", authority_revision: 1, goal_id: "goal:test", goal_revision: 1, observation_revision: 1, affordance_revision: 1 },
    clocks: { environment: { kind: "tick", sequence: 0, resolution_unit: "minecraft_tick", nominal_units_per_second: 20 },
      monotonic: { origin_id: "origin:test", elapsed_ms: 0 }, audit_at: "2026-09-05T00:00:00Z" },
    adapter_id: "minecraft.fabric_client", adapter_version: "1", compiler_version: "1", resident_executor_version: "1",
    start_node_id: "check", maximum_total_units: 10, monotonic_deadline_elapsed_ms: 1000,
    watermarks: { decision_unit: 1, stop_unit: 2, committed_through_unit: 3, stabilization_node_id: "done" },
    lanes: [{ lane_id: "move", priority: 1, resource_keys: ["locomotion"] }], effect_ceiling: {},
    nodes: [{ node_id: "check", kind: "branch", condition: { kind: "adapter_condition", condition_id: "minecraft.player_grounded", arguments: { expected: true } },
      true_node_id: "done", false_node_id: "failed" },
      { node_id: "done", kind: "terminal", outcome: "succeeded", reason_code: "done" },
      { node_id: "failed", kind: "terminal", outcome: "failed", reason_code: "failed" }] });
  const sequence = { action_kind: "execute_sequence", sequence_schema: "helix.minecraft.player_sequence.v1", sequence_id: "sequence:test",
    ruleset: "survival_tas", execution_plane: "player_embodiment", scheduler_engine: "native_fabric",
    optimization: { primary: "minimize_world_ticks", record_wall_clock: true, stop_on_first_verified_success: true },
    start_node_id: "check", max_total_ticks: 10, required_checkpoint_ids: [],
    mutation_scope: { world_mutation_allowed: false, max_block_mutations: 0, max_inventory_transfers: 0,
      allowed_block_ids: [], allowed_regions: [], combat_allowed: false },
    nodes: [{ node_id: "check", node_kind: "checkpoint", earliest_tick: 0, checkpoint_id: "checkpoint:test",
      condition: { condition_kind: "player_grounded", expected: true }, wait_up_to_ticks: 1, on_satisfied: "done", on_timeout: "done" },
      { node_id: "done", node_kind: "terminal", terminal_outcome: "succeeded", reason_code: "done" }] };
  const request = { schema: "helix.environment_action.request.v1", action_request_id: "action:test", workflow_id: "workflow:test",
    action_authority_id: "authority:test", environment_binding_id: "env:test", room_id: "room:test", source_id: "source:test",
    world_id: "world:test", participant_id: "participant:test", subject_binding_id: "subject:test", subject_native_id: "player:test",
    run_id: "run:test", turn_id: "turn:test", provider_execution_id: "provider:test", tool_call_id: "tool:test", catalog_snapshot_id: "catalog:test",
    capability_id: "capability:test", capability_version: 1, action_kind: isTemporal ? "execute_sequence" : "walk", effect_class: "continuous_control", workflow_mode: "long_running",
    requested_control_engine: "native_fabric", arguments: isTemporal ? sequence : { action_kind: "walk", duration_ms: 100, direction: "forward" }, preconditions: [],
    postconditions: [{ condition_id: "condition:test", condition_kind: "minecraft.player.moved", required: true, parameters: {} }],
    idempotency_key: "idempotency:test", confirmation_state: "approved", approval_ref: "approval:test", created_at: "2026-09-05T00:00:00Z",
    deadline_at: "2030-01-01T00:00:00Z", constraints: { max_duration_ms: 1000, max_distance_blocks: 1, max_block_mutations: 0,
      max_inventory_transfers: 0, manual_override_policy: "cancel", require_postcondition_verification: true, world_mutation_allowed: false,
      combat_allowed: false, host_access_allowed: false, automatic_replay_allowed: false },
    temporal_plan: isTemporal ? plan : undefined,
    answer_authority: false, assistant_answer: false, terminal_eligible: false, raw_content_included: false };
  return { isTemporal, status, plan, sequence, request };
}

it("overlapping broker enqueues retain and publish independently when one binding changes after retention", async () => {
  const { request: base, plan: basePlan, sequence } = admissionFixture("temporal_retained");
  const memory = newDb();
  const textColumns = "action_request_id workflow_id action_authority_id connector_manifest_id catalog_snapshot_id environment_binding_id room_id source_id world_id participant_id subject_binding_id subject_native_id run_id turn_id provider_execution_id tool_call_id capability_id action_kind effect_class workflow_mode requested_control_engine request_hash idempotency_key confirmation_state approval_ref status cancellation_reason".split(" ");
  memory.public.none(`CREATE TABLE helix_environment_action_requests (${textColumns.map(column => column + " text" + (column === "action_request_id" ? " primary key" : "")).join(",")},
    capability_version integer, policy_version integer, request_payload jsonb, deadline_at timestamptz, created_at timestamptz, updated_at timestamptz);
    CREATE TABLE helix_environment_temporal_plan_admissions (plan_id text primary key, plan_hash text, source_plan jsonb,
      compilation_hash text, compilation_artifact jsonb, action_request_id text unique, frontier_id text, goal_id text,
      goal_revision integer, reasoning_binding_id text, reasoning_binding_epoch integer, client_continuation_ref text,
      previous_plan_id text, previous_plan_hash text, checkpoint_association jsonb, resident_action_request_id text);
    CREATE TABLE helix_environment_durable_goals (goal_id text primary key, current_sequence integer, status text);
    CREATE TABLE helix_environment_action_authorities (action_authority_id text primary key);
    INSERT INTO helix_environment_action_authorities VALUES ('authority:test');
    CREATE TABLE helix_environment_temporal_frontiers (frontier_id text primary key, goal_id text, goal_revision integer,
      frontier_payload jsonb, payload_hash text, observed_at timestamptz, retained_until timestamptz);
    CREATE TABLE helix_environment_durable_goal_participants (goal_id text, profile_id text, participant_id text, status text, scopes jsonb);
    INSERT INTO helix_environment_durable_goals VALUES ('goal:test',1,'active');
    INSERT INTO helix_environment_durable_goal_participants VALUES ('goal:test','profile:test','participant:test','active','["steer"]');`);
  const pool = new (memory.adapters.createPg().Pool)();
  vi.spyOn(membership, "readSharedRealtimeRoomMembership").mockResolvedValue({ participantId: "participant:test", role: "owner" } as never);
  vi.spyOn(registry, "resolveEnvironmentActionAdapterProfile").mockReturnValue({ profile: { freshness: { heartbeat_max_age_ms: 5000 } } } as never);
  let retainedCount = 0;
  let releaseBoth!: () => void;
  const bothRetained = new Promise<void>(resolve => { releaseBoth = resolve; });
  vi.spyOn(database, "withSharedRealtimeRoomTransaction").mockImplementation(async work => {
    const client = await pool.connect();
    const query = async (sql: string, values: unknown[] = []) => {
      // Identity/catalog observations are fixed fixtures; all request,
      // retention and publication statements execute against the same pg-mem.
      if (sql.includes("FROM helix_environment_action_authorities a")) return { rows: [{ ...base,
        authority_status: "active", authority_expires_at: null, environment_status: "active", source_status: "active", room_status: "open",
        allowed_capability_ids: [base.capability_id], policy_version: 1, autonomy_mode: "approve_each",
        credential_id: "credential:test", credential_status: "active", credential_expires_at: "2031-01-01T00:00:00Z" }] };
      if (sql.includes("FROM helix_environment_action_connector_manifests")) return { rows: [{ manifest_id: "manifest:test", manifest_hash: "hash:test",
        capabilities: [{ capability_id: base.capability_id, capability_version: 1, action_kind: "execute_sequence", effect_class: base.effect_class,
          execution_features: ["latest_start_tick_v1", "temporal_plan_v1"], workflow_modes: ["long_running"], control_engines: ["native_fabric"] }] }] };
      if (sql.includes("FROM helix_environment_action_connector_heartbeats")) return { rows: [{ status: "active", received_at: new Date(), emergency_stop_latched: false, control_engines: [] }] };
      if (sql.includes("FROM helix_environment_capability_catalog_snapshots")) return { rows: [{ catalog_snapshot_id: "catalog:test", manifest_hash: "hash:test" }] };
      const result = await client.query(sql, values);
      if (sql.includes("INSERT INTO helix_environment_temporal_plan_admissions")) {
        if (++retainedCount === 2) releaseBoth();
        await bothRetained;
      }
      return result;
    };
    await client.query("BEGIN");
    try { const result = await work({ query } as never); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });
  try {
    const submissions = await Promise.all(["good", "revoked"].map(async label => {
      const { plan_hash: ignored, ...source } = basePlan;
      const plan = buildHelixEnvironmentTemporalPlan({ ...source, plan_id: `plan:${label}` });
      const frontier = { frontier_id: `frontier:${label}`, identity: plan.identity };
      await pool.query("INSERT INTO helix_environment_temporal_frontiers VALUES ($1,'goal:test',1,$2,$3,$4,$5)",
        [frontier.frontier_id, JSON.stringify(frontier), helixEnvironmentTimeSha256(frontier), new Date(Date.now() - 1000).toISOString(), new Date(Date.now() + 60000).toISOString()]);
      const body = { arguments: sequence, source_plan_id: plan.plan_id, source_plan_hash: plan.plan_hash, source_goal_id: "goal:test", source_goal_revision: 1 };
      const compilation = { ...body, compilation_hash: helixEnvironmentTimeSha256(body) };
      let checks = 0;
      const result = enqueueEnvironmentAction({ profileId: "profile:test", request: { ...base, temporal_plan: plan,
        action_request_id: `action:${label}`, workflow_id: `workflow:${label}`, tool_call_id: `tool:${label}`, idempotency_key: `idempotency:${label}` } }, {
        retention: { preflight: { plan, compilation, frontier, association: { kind: "reasoning_binding",
          associationId: `binding:${label}`, associationEpoch: 1, profileRef: "profile:test",
          runId: "run:test", roomId: "room:test", participantId: "participant:test",
          continuationRef: "continuation:test" } },
          bindingId: `binding:${label}`, bindingEpoch: 1, continuationRef: "continuation:test", runId: "run:test" } as never,
        revalidateTask: async () => {
          await Promise.resolve();
          if (++checks === 2 && label === "revoked") throw new Error("fixture_binding_revoked_after_retention");
        },
      });
      return result.then(() => "published", error => String(error.message));
    }));
    expect(submissions).toEqual(["published", "fixture_binding_revoked_after_retention"]);
    expect(retainedCount).toBe(2);
    expect((await pool.query("SELECT action_request_id,status FROM helix_environment_action_requests ORDER BY action_request_id")).rows)
      .toEqual([{ action_request_id: "action:good", status: "admitted" }, { action_request_id: "action:revoked", status: "failed" }]);
    expect((await pool.query("SELECT action_request_id FROM helix_environment_temporal_plan_admissions")).rows)
      .toEqual([{ action_request_id: "action:good" }]);
  } finally { releaseBoth(); await pool.end(); }
}, 10000);

it.each(["active", "revoked", "expired_credential", "short_credential", "same_deadline_credential", "temporal_unsupported", "temporal_retained", "temporal_retained_diagnostic_failure", "temporal_rejected", "temporal_binding_revoked"])("checks authority and inserts under the same transaction (%s)", async scenarioName => {
  const scenario = scenarioName === "temporal_retained_diagnostic_failure" ? "temporal_retained" : scenarioName;
  const diagnosticFailure = scenarioName === "temporal_retained_diagnostic_failure"
    ? vi.spyOn(console, "info").mockImplementation(() => { throw new Error("diagnostic sink unavailable"); }) : null;
  const { isTemporal, status, plan, sequence, request } = admissionFixture(scenario);
  vi.spyOn(membership, "readSharedRealtimeRoomMembership").mockResolvedValue({ participantId: "participant:test", role: "owner" } as never);
  vi.spyOn(registry, "resolveEnvironmentActionAdapterProfile").mockReturnValue({ profile: { freshness: { heartbeat_max_age_ms: 5000 } } } as never);
  const outsideRead = vi.spyOn(database, "readSharedRealtimeRoomDatabase").mockRejectedValue(new Error("outside transaction"));
  let active = false;
  let insertedStatus: string | null = null;
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    expect(active).toBe(true);
    if (sql.includes("INSERT INTO helix_environment_action_requests")) {
      insertedStatus = values[30] as string;
    }
    if (sql.includes("SET status='admitted'")) {
      expect(insertedStatus).toBe("queued");
      expect(retain).toHaveBeenCalledOnce();
      expect(revalidateTask).toHaveBeenCalledTimes(2);
      insertedStatus = "admitted";
      return { rows: [{ action_request_id: request.action_request_id }] };
    }
    if (sql.includes("SET status='failed'")) insertedStatus = "failed";
    if (sql.includes("FROM helix_environment_action_authorities a")) return { rows: [{ ...request,
      authority_status: status, authority_expires_at: null, environment_status: "active", source_status: "active", room_status: "open",
      allowed_capability_ids: [request.capability_id], policy_version: 1, autonomy_mode: "approve_each",
      credential_id: "credential:test", credential_status: "active",
      credential_expires_at: scenario === "expired_credential" ? new Date(Date.now() - 1).toISOString() :
        scenario === "short_credential" ? new Date(Date.now() + 60_000).toISOString() :
        scenario === "same_deadline_credential" ? request.deadline_at : "2031-01-01T00:00:00Z" }] };
    if (sql.includes("FROM helix_environment_action_connector_manifests")) return { rows: [{ manifest_id: "manifest:test", manifest_hash: "hash:test",
      capabilities: [{ capability_id: request.capability_id, capability_version: 1, action_kind: request.action_kind, effect_class: request.effect_class,
        // Valid serial temporal manifest fixture; not evidence of a deployed native manifest.
        execution_features: scenario === "temporal_unsupported" ? [] : ["latest_start_tick_v1", "temporal_plan_v1"],
        workflow_modes: ["long_running"], control_engines: ["native_fabric"] }] }] };
    if (sql.includes("FROM helix_environment_action_connector_heartbeats")) return { rows: [{ status: "active", received_at: new Date(), emergency_stop_latched: false, control_engines: [] }] };
    if (sql.includes("FROM helix_environment_capability_catalog_snapshots")) return { rows: [{ catalog_snapshot_id: "catalog:test", manifest_hash: "hash:test" }] };
    if (sql.includes("WHERE action_request_id = $1 LIMIT 1")) return { rows: [{ request_payload: request }] };
    return { rows: [] };
  });
  vi.spyOn(database, "withSharedRealtimeRoomTransaction").mockImplementation(async work => {
    active = true;
    try { return await work({ query } as never); } finally { active = false; }
  });
  const retain = vi.spyOn(retention, "retainTemporalAdmission").mockImplementation(async () => {
    expect(active).toBe(true);
    expect(insertedStatus).toBe("queued");
    if (scenario === "temporal_rejected") throw new Error("retention rejected");
    return { retained: true, replay: false, resident_action_request_id: "resident:test", execution_authority: false };
  });
  const revalidateTask = vi.fn(() => {
    expect(active).toBe(true);
    if (scenario === "temporal_binding_revoked" && revalidateTask.mock.calls.length === 2) throw new Error("binding revoked after retention");
  });
  // Transaction fixture only; real compiler equivalence is covered separately.
  const compilationContent = { arguments: sequence, source_plan_id: plan.plan_id, source_plan_hash: plan.plan_hash };
  const compilation = { ...compilationContent, compilation_hash: helixEnvironmentTimeSha256(compilationContent) };
  const result = enqueueEnvironmentAction({ profileId: "profile:test", request }, isTemporal ? {
    retention: { preflight: { plan, compilation } } as never, revalidateTask,
  } : undefined);
  if (scenario === "temporal_unsupported") await expect(result).rejects.toMatchObject({ code: "action_policy_denied" });
  else if (["expired_credential", "short_credential", "same_deadline_credential"].includes(scenario))
    await expect(result).rejects.toMatchObject({ code: "action_credential_expired" });
  else if (scenario === "temporal_rejected") await expect(result).rejects.toThrow("retention rejected");
  else if (scenario === "temporal_binding_revoked") await expect(result).rejects.toThrow("binding revoked after retention");
  else if (status === "active") await expect(result).resolves.toMatchObject({ action_request_id: "action:test" });
  else await expect(result).rejects.toMatchObject({ code: "action_authority_inactive" });
  if (diagnosticFailure) expect(diagnosticFailure).toHaveBeenCalledOnce();
  expect(retain).toHaveBeenCalledTimes(["temporal_retained", "temporal_rejected", "temporal_binding_revoked"].includes(scenario) ? 1 : 0);
  if (scenario === "temporal_retained") expect(revalidateTask).toHaveBeenCalledTimes(2);
  if (["temporal_rejected", "temporal_binding_revoked"].includes(scenario)) {
    expect(insertedStatus).toBe("failed");
    expect(query.mock.calls.some(([sql]) => sql.includes("SET status='admitted'"))).toBe(false);
  }
  if (scenario === "temporal_retained" || scenario === "active") expect(insertedStatus).toBe("admitted");
  if (scenario === "temporal_retained") {
    const parsed = helixEnvironmentActionRequestSchema.parse(request);
    const canonical = serializeHelixEnvironmentPlanHashContent(plan);
    expect(helixEnvironmentActionRequestSchema.safeParse({ ...request, temporal_plan_canonical_json: canonical }).success).toBe(true);
    expect(helixEnvironmentActionRequestSchema.safeParse({ ...request, temporal_plan_canonical_json: canonical + " " }).success).toBe(false);
    const hash = hashEnvironmentActionIdempotencyContent(parsed);
    expect(storedEnvironmentActionMatchesIdempotencyContent({ storedPayload: parsed, storedRequestHash: hash, request: parsed })).toBe(true);
    const ordinary = { ...parsed, temporal_plan: undefined };
    expect(hashEnvironmentActionIdempotencyContent(ordinary)).not.toBe(hash);
    expect(storedEnvironmentActionMatchesIdempotencyContent({ storedPayload: parsed, storedRequestHash: hash, request: ordinary })).toBe(false);
    const { plan_hash: ignoredHash, ...basePlan } = plan;
    const changed = { ...parsed, temporal_plan: buildHelixEnvironmentTemporalPlan({ ...basePlan, monotonic_deadline_elapsed_ms: 900 }) };
    expect(hashEnvironmentActionIdempotencyContent(changed)).not.toBe(hash);
    expect(storedEnvironmentActionMatchesIdempotencyContent({ storedPayload: parsed, storedRequestHash: hash, request: changed })).toBe(false);
    const before = query.mock.calls.length;
    await expect(enqueueEnvironmentAction({ profileId: "profile:test", request })).rejects.toMatchObject({ code: "action_policy_denied" });
    expect(query.mock.calls.length).toBe(before);
  }
  expect(outsideRead).not.toHaveBeenCalled();
  expect(query.mock.calls[0][0]).toContain("FOR UPDATE");
  expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO helix_environment_action_requests"))).toBe(status === "active" && !["temporal_unsupported", "expired_credential", "short_credential", "same_deadline_credential"].includes(scenario));
});
