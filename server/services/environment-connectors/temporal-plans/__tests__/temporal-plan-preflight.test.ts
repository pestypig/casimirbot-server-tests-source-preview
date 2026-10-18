import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { newDb } from "pg-mem";
import { migration082 } from "../../../../db/migrations/082_environment_temporal_frontiers";
import { migration083 } from "../../../../db/migrations/083_environment_temporal_plan_admissions";
import { migration085 } from "../../../../db/migrations/085_environment_temporal_checkpoint_association";
import { migration086 } from "../../../../db/migrations/086_environment_temporal_resident_action";
import { migration133 } from "../../../../db/migrations/133_responses_decision_source_snapshot";
import { buildHelixEnvironmentTemporalPlan, helixEnvironmentTimeSha256 } from "@shared/helix-environment-time";
import { materializeHelixEnvironmentActionChoice,
  type VerifiedHelixEnvironmentActionChoiceSource } from "@shared/helix-environment-action-choice";
import * as contextModule from "../temporal-perception-context";
import { EnvironmentTemporalFrontierStore } from "../temporal-frontier-store";
import { preflightTemporalPlan } from "../temporal-plan-preflight";
import { retainTemporalAdmission, assertTemporalPredecessorAssociation } from "../temporal-admission-retention";
import { responsesActionDecisionIdempotencyKey } from "../responses-action-decision-snapshot";
import { readProtectedResponsesDecisionSource } from "../responses-action-decision-source";
import * as checkpointEvidence from "../temporal-checkpoint-evidence";
import { TemporalPlanError } from "../temporal-plan-error";
afterEach(() => { vi.restoreAllMocks(); });

it.each(["valid", "wrong_task_run", "missing_frontier", "wrong_identity", "no_executor",
  "executor_unlisted", "executor_without_native_fabric", "executor_without_start_deadline",
  "blocked", "wrong_clock", "expired", "revoked_during_read"])("joins temporal preflight without dispatch (%s)", async scenario => {
  const identity = { environment_id: "env:test", source_id: "source:test", subject_id: "subject:test",
    producer_epoch: "epoch:action", authority_id: "authority:test", authority_revision: 1,
    goal_id: "goal:test", goal_revision: 1, observation_revision: 1, affordance_revision: 1 };
  const plan = buildHelixEnvironmentTemporalPlan({ plan_id: "plan:test", previous_plan_id: null, previous_plan_hash: null,
    identity, clocks: { environment: { kind: "tick", sequence: 10, resolution_unit: "minecraft_tick", nominal_units_per_second: 20 },
      monotonic: { origin_id: "origin:test", elapsed_ms: 100 }, audit_at: "2026-09-05T00:00:00Z" },
    adapter_id: "minecraft.fabric_client", adapter_version: "1", compiler_version: "compiler:1", resident_executor_version: "native:1",
    start_node_id: "walk", maximum_total_units: 80, monotonic_deadline_elapsed_ms: 1000,
    watermarks: { decision_unit: 40, stop_unit: 60, committed_through_unit: 80, stabilization_node_id: "success" },
    lanes: [{ lane_id: "move", priority: 1, resource_keys: ["locomotion"] }], effect_ceiling: {},
    nodes: [{ kind: "action", node_id: "walk", lane_id: "move", capability_id: "com.casimirbot.minecraft.player.walk", capability_version: "1",
      arguments: { action_kind: "walk", direction: "forward", duration_ms: 100, sprint: false }, required_resources: ["locomotion"],
      timing: { earliest_start_unit: 0, latest_start_unit: 10, maximum_duration_units: 20 }, preconditions: [],
      completion_conditions: [{ kind: "adapter_condition", condition_id: "minecraft.player_grounded", arguments: { expected: true } }],
      abort_guards: [], effect_budget: {}, on_success_node_id: "success", on_failure_node_id: "failure", on_timeout_node_id: "failure" },
      { kind: "terminal", node_id: "success", outcome: "succeeded", reason_code: "done" },
      { kind: "terminal", node_id: "failure", outcome: "failed", reason_code: "failed" }],
  });
  const frontier = { frontier_id: "frontier:test", identity: { ...identity, goal_revision: scenario === "wrong_identity" ? 2 : 1 },
    clocks: { environment: { sequence: 100, resolution_unit: "minecraft_world_tick" } }, expires_at_environment_sequence: 120,
    entries: [{ capability_id: "com.casimirbot.minecraft.player.walk", capability_version: "1", subject_id: identity.subject_id,
      state: scenario === "blocked" ? "blocked" : "conditional" }] };
  const read = vi.spyOn(EnvironmentTemporalFrontierStore.prototype, "read").mockResolvedValue(
    scenario === "missing_frontier" ? null : frontier as never);
  vi.spyOn(contextModule, "resolveTemporalPerceptionContext").mockResolvedValue({
    goal: { goal_id: identity.goal_id, goal_revision: 1, identity: { environment_binding_id: identity.environment_id,
      source_id: identity.source_id, subject_binding_id: identity.subject_id, action_authority_id: identity.authority_id, authority_policy_version: 1 } },
    action_producer_epoch_ref: identity.producer_epoch, observation_producer_epoch_ref: "epoch:observation",
    evidence: { observation: { evidence_ref: "evidence:test", result: { observation_revision: 1 } } },
    catalog: { capabilities: scenario === "no_executor" ? [] : [{ action_kind: "execute_sequence",
      policy_listed: scenario !== "executor_unlisted",
      native_fabric_available: scenario !== "executor_without_native_fabric",
      start_deadline_supported: scenario !== "executor_without_start_deadline" }],
      resident_clock_observation: { producer_epoch_ref: identity.producer_epoch, clock: { clock_kind: "minecraft_game_tick", tick_index: 10,
        world_tick_index: scenario === "expired" ? 120 : 100,
        monotonic: { origin_id: scenario === "wrong_clock" ? "origin:other" : "origin:test", elapsed_ms: 100 } } } },
  } as never);
  const verifyTaskAssociation = vi.fn().mockReturnValue({ execution_authority: false,
    authenticated_profile_ref: "profile:test",
    reasoning_binding_id: "binding:test", binding_epoch: 1, run_id: "run:test",
    provider_thread_ref_hash: createHash("sha256").update("continuation:test").digest("hex") });
  if (scenario === "revoked_during_read") verifyTaskAssociation.mockImplementationOnce(() => ({})).mockImplementationOnce(() => { throw new Error("revoked"); });
  const result = preflightTemporalPlan({ plan, frontierId: "frontier:test",
    context: { profileId: "profile:test", participantId: "participant:test", runId: "run:test", goalId: "goal:test", expectedRevision: 1,
      roomId: "room:test", turnId: "turn:test", priorTurnId: "turn:prior", probeRequestId: "probe:test" },
    binding: { profileRef: "profile:test", authenticatedMcpClientRef: "mcp:test", clientSessionRef: "session:test", clientContinuationRef: "continuation:test",
      bindingId: "binding:test", bindingEpoch: 1, helixConversationId: "helix:test", missionId: null, runId: scenario === "wrong_task_run" ? null : "run:test" },
    compilation: { target: "serial", options: { mutation_scope: { world_mutation_allowed: false, max_block_mutations: 0,
      max_inventory_transfers: 0, allowed_block_ids: [], allowed_regions: [], combat_allowed: false } } },
  }, { verifyTaskAssociation });
  if (scenario === "valid") {
    const { plan_hash: priorHash, ...priorContent } = plan;
    const successor = buildHelixEnvironmentTemporalPlan({ ...priorContent, plan_id: "plan:next",
      previous_plan_id: plan.plan_id, previous_plan_hash: plan.plan_hash, maximum_total_units: 160,
      watermarks: { ...plan.watermarks, decision_unit: 100, stop_unit: 140, committed_through_unit: 160 },
      nodes: plan.nodes.map(node => node.kind === "action" ? { ...node,
        timing: { ...node.timing, earliest_start_unit: 80, latest_start_unit: 90 } } : node) });
    const owner = { bindingId: "binding:test", bindingEpoch: 1, continuationRef: "continuation:test" };
    const previousRow = { source_plan: plan, reasoning_binding_id: owner.bindingId,
      reasoning_binding_epoch: owner.bindingEpoch, client_continuation_ref: owner.continuationRef };
    expect(() => assertTemporalPredecessorAssociation(successor, previousRow, owner)).not.toThrow();
    const overlap = buildHelixEnvironmentTemporalPlan({ ...priorContent, plan_id: "plan:overlap",
      previous_plan_id: plan.plan_id, previous_plan_hash: plan.plan_hash });
    expect(() => assertTemporalPredecessorAssociation(overlap, previousRow, owner)).toThrow("committed_window_overlap");
    for (const field of ["reasoning_binding_id", "reasoning_binding_epoch", "client_continuation_ref"]) {
      expect(() => assertTemporalPredecessorAssociation(successor, { ...previousRow, [field]: "other" }, owner)).toThrow("binding_mismatch");
    }
    for (const field of ["environment_id", "source_id", "subject_id", "producer_epoch", "authority_id", "goal_id"] as const) {
      const { plan_hash: successorHash, ...successorContent } = successor;
      const changed = buildHelixEnvironmentTemporalPlan({ ...successorContent, identity: { ...successor.identity, [field]: "other" } });
      expect(() => assertTemporalPredecessorAssociation(changed, previousRow, owner)).toThrow("identity_mismatch");
    }
    await expect(result).resolves.toMatchObject({ preflight_only: true, execution_authority: false, compilation: { source_plan_hash: plan.plan_hash } });
    expect(verifyTaskAssociation).toHaveBeenCalledTimes(3);
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ expectedEvidenceRef: "evidence:test", expectedObservationProducerEpoch: "epoch:observation" }));
    const preflight = await result;
    const payload = { action_request_id: "action:test", run_id: "run:test", participant_id: "participant:test", action_authority_id: identity.authority_id,
      environment_binding_id: identity.environment_id, source_id: identity.source_id, subject_binding_id: identity.subject_id,
      arguments: preflight.compilation.arguments, temporal_plan: plan };
    let status = "admitted";
    let retained: Record<string, unknown> | null = null;
    let goalRevision = 1;
    let frontierPresent = true;
    let grantActive = true;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM helix_environment_durable_goals")) return { rows: [{ status: "active", current_sequence: goalRevision }] };
      if (sql.includes("FROM helix_environment_temporal_frontiers")) return { rows: frontierPresent ? [{
        frontier_payload: frontier, payload_hash: helixEnvironmentTimeSha256(frontier) }] : [] };
      if (sql.includes("FROM helix_environment_durable_goal_participants")) return { rows: grantActive ? [{ scopes: ["steer"] }] : [] };
      if (sql.includes("FROM helix_environment_action_requests")) return { rows: [{ request_payload: payload, policy_version: 1, status }] };
      if (sql.startsWith("SELECT *")) return { rows: retained ? [retained] : [] };
      return { rows: [] };
    });
    const retention = { preflight, actionRequestId: "action:test", bindingId: "binding:test", bindingEpoch: 1,
      continuationRef: "continuation:test", runId: "run:test" };
    // Exercise the successor retention branch independently of checkpoint-reader
    // validation (covered by its own fixtures). SQL/transaction isolation is not
    // claimed by this controlled query fixture.
    const { compilation_hash: ignoredHash, ...compiledContent } = preflight.compilation;
    const successorBody = { ...compiledContent, source_plan_id: successor.plan_id, source_plan_hash: successor.plan_hash };
    const successorCompilation = { ...successorBody, compilation_hash: helixEnvironmentTimeSha256(successorBody) };
    const nextFrontier = { ...preflight.frontier, clocks: { ...preflight.frontier.clocks, audit_at: "2026-09-05T00:00:01Z" } };
    const nextInput = { ...retention, preflight: { ...preflight, plan: successor, compilation: successorCompilation, frontier: nextFrontier },
      checkpoint: { eventId: "event:checkpoint", checkpointId: "checkpoint:test" } };
    const checkpoint = { event_id: "event:checkpoint", checkpoint_id: "checkpoint:test", observed_at: "2026-09-05T00:00:02Z", world_tick_index: 120,
      checkpoint_anchor: { event_id: "event:anchor", observed_at: "2026-09-05T00:00:00Z", world_tick_index: 100 } };
    const evidenceRead = vi.spyOn(checkpointEvidence, "readTemporalCheckpointEvidence").mockResolvedValue(checkpoint as never);
    let nextRetained: Record<string, unknown> | null = null;
    let admittedSuccessor: string | null = null;
    let residentId: string | null = "action:previous";
    const nextQuery = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.startsWith("SELECT plan_id")) return { rows: admittedSuccessor ? [{ plan_id: admittedSuccessor }] : [] };
      if (sql.startsWith("SELECT source_plan")) return { rows: [{ ...previousRow, action_request_id: "action:previous", compilation_artifact: preflight.compilation, resident_action_request_id: residentId }] };
      if (sql.startsWith("SELECT *")) return { rows: nextRetained ? [nextRetained] : [] };
      if (sql.includes("FROM helix_environment_temporal_frontiers")) return { rows: [{ frontier_payload: nextFrontier, payload_hash: helixEnvironmentTimeSha256(nextFrontier) }] };
      if (sql.includes("FROM helix_environment_action_requests")) return { rows: [{ request_payload: { ...payload, temporal_plan: successor, arguments: successorCompilation.arguments }, policy_version: 1, status: "admitted" }] };
      return query(sql);
    });
    await expect(retainTemporalAdmission({ query: nextQuery } as never, { ...nextInput, checkpoint: undefined })).rejects.toThrow("checkpoint_required");
    residentId = null;
    await expect(retainTemporalAdmission({ query: nextQuery } as never, nextInput)).rejects.toThrow("resident_unresolved");
    residentId = "action:previous";
    await expect(retainTemporalAdmission({ query: nextQuery } as never, nextInput)).resolves.toMatchObject({ replay: false, resident_action_request_id: "action:previous" });
    expect(nextQuery.mock.calls.find(([sql]) => sql.includes("INSERT INTO"))?.[1]?.[14]).toBe(JSON.stringify(checkpoint));
    expect(nextQuery.mock.calls.find(([sql]) => sql.includes("INSERT INTO"))?.[1]?.[15]).toBe("action:previous");
    // Missing, invalid, and genuinely newer checkpoints remain inadmissible;
    // only an unchanged verified checkpoint may precede the latest progress.
    for (const anchor of [undefined, { ...checkpoint.checkpoint_anchor, observed_at: "invalid" },
      { ...checkpoint.checkpoint_anchor, observed_at: "2026-09-05T00:00:03Z" },
      { ...checkpoint.checkpoint_anchor, world_tick_index: 9999 }]) {
      evidenceRead.mockResolvedValue({ ...checkpoint, checkpoint_anchor: anchor } as never);
      nextQuery.mockClear();
      await expect(retainTemporalAdmission({ query: nextQuery } as never, nextInput)).rejects.toThrow("frontier_predates_checkpoint");
      expect(nextQuery.mock.calls.some(([sql]) => sql.includes("INSERT INTO"))).toBe(false);
    }
    evidenceRead.mockResolvedValue(checkpoint as never);
    admittedSuccessor = "plan:other-successor";
    nextQuery.mockClear();
    evidenceRead.mockClear();
    await expect(retainTemporalAdmission({ query: nextQuery } as never, nextInput)).rejects.toThrow("successor_already_admitted");
    expect(evidenceRead).not.toHaveBeenCalled();
    expect(nextQuery.mock.calls.some(([sql]) => sql.includes("INSERT INTO"))).toBe(false);
    nextRetained = { plan_id: successor.plan_id, plan_hash: successor.plan_hash, compilation_hash: successorCompilation.compilation_hash,
      resident_action_request_id: "action:previous",
      action_request_id: "action:test", frontier_id: nextFrontier.frontier_id, reasoning_binding_id: "binding:test",
      reasoning_binding_epoch: 1, client_continuation_ref: "continuation:test", checkpoint_association: checkpoint };
    evidenceRead.mockClear();
    await expect(retainTemporalAdmission({ query: nextQuery } as never, nextInput)).resolves.toMatchObject({ replay: true });
    expect(evidenceRead).not.toHaveBeenCalled();
    await expect(retainTemporalAdmission({ query: nextQuery } as never, { ...nextInput,
      checkpoint: { ...nextInput.checkpoint, eventId: "event:other" } })).rejects.toThrow("checkpoint_replay_conflict");
    // A Responses decision is retained with the successor admission, not inferred
    // later from an untrusted model transcript or an unrelated action request.
    nextRetained = null;
    admittedSuccessor = null;
    const checkpointHash = `sha256:${"a".repeat(64)}`;
    const decisionSource = { context: { run_id: "run:test", reasoning_binding_id: "binding:test", binding_epoch: 1,
      environment_id: identity.environment_id, source_id: identity.source_id, subject_id: identity.subject_id,
      goal_id: identity.goal_id, goal_revision: identity.goal_revision,
      predecessor_plan_id: plan.plan_id, predecessor_plan_hash: plan.plan_hash,
      checkpoint_id: "checkpoint:test", checkpoint_event_id: "event:checkpoint", checkpoint_event_hash: checkpointHash,
      observation_ref: "observation:test", observation_revision: identity.observation_revision,
      affordance_revision: identity.affordance_revision, producer_epoch: identity.producer_epoch,
      authority_id: identity.authority_id, authority_revision: identity.authority_revision,
      monotonic_origin_id: "origin:test", current_unit: 100, current_monotonic_ms: 100,
      maximum_proposal_horizon_units: 200, maximum_proposal_lifetime_ms: 500,
      interruption_pending: false }, observation_summary: "clear route to waypoint",
      candidates: [{ candidate_id: "advance:test", plan_id: successor.plan_id, plan_hash: successor.plan_hash,
        action_code: "walk_to_waypoint", target_ref: "waypoint:test", estimated_units: 8 }] } satisfies
      VerifiedHelixEnvironmentActionChoiceSource;
    const choice = materializeHelixEnvironmentActionChoice({
      untrustedChoice: { choice_id: "advance:test", rationale_code: "route_clear" },
      invocationSource: decisionSource, currentSource: decisionSource,
      hostDecisionId: "decision:test", requestedHorizonUnits: 10, requestedLifetimeMs: 300 });
    expect(choice.accepted).toBe(true);
    if (!choice.accepted) throw new Error("decision fixture invalid");
    const decisionSnapshot = { proposal: choice.proposal, source: decisionSource };
    evidenceRead.mockResolvedValue({ ...checkpoint, event_hash: checkpointHash } as never);
    let providerDecisionId = "decision:other";
    const correctDecisionKey = responsesActionDecisionIdempotencyKey({
      decisionId: "decision:test", bindingId: "binding:test", bindingEpoch: 1 });
    let providerIdempotencyKey = correctDecisionKey;
    const decisionQuery = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("FROM helix_environment_action_requests")) return { rows: [{
        request_payload: { ...payload, temporal_plan: successor, arguments: successorCompilation.arguments,
          provider_execution_id: providerDecisionId,
          idempotency_key: providerIdempotencyKey }, policy_version: 1, status: "admitted" }] };
      return nextQuery(sql, values);
    });
    const decisionInput = { ...nextInput, responsesDecisionSnapshot: decisionSnapshot };
    await expect(retainTemporalAdmission({ query: decisionQuery } as never, decisionInput))
      .rejects.toThrow("responses_snapshot_mismatch");
    expect(decisionQuery.mock.calls.some(([sql]) => sql.includes("INSERT INTO"))).toBe(false);
    providerDecisionId = "decision:test";
    decisionQuery.mockClear();
    providerIdempotencyKey = responsesActionDecisionIdempotencyKey({
      decisionId: "decision:other", bindingId: "binding:test", bindingEpoch: 1 });
    await expect(retainTemporalAdmission({ query: decisionQuery } as never, decisionInput))
      .rejects.toThrow("responses_snapshot_mismatch");
    expect(decisionQuery.mock.calls.some(([sql]) => sql.includes("INSERT INTO"))).toBe(false);
    providerIdempotencyKey = correctDecisionKey;
    decisionQuery.mockClear();
    evidenceRead.mockResolvedValue({ ...checkpoint,
      event_hash: `sha256:${"b".repeat(64)}` } as never);
    await expect(retainTemporalAdmission({ query: decisionQuery } as never, decisionInput))
      .rejects.toThrow("responses_checkpoint_hash_mismatch");
    expect(decisionQuery.mock.calls.some(([sql]) => sql.includes("INSERT INTO"))).toBe(false);
    evidenceRead.mockResolvedValue({ ...checkpoint, event_hash: checkpointHash } as never);
    decisionQuery.mockClear();
    await expect(retainTemporalAdmission({ query: decisionQuery } as never, decisionInput))
      .resolves.toMatchObject({ replay: false, resident_action_request_id: "action:previous" });
    const decisionInsert = decisionQuery.mock.calls.find(([sql]) => sql.includes("INSERT INTO"));
    expect(decisionInsert?.[0]).toContain("responses_decision_snapshot_hash");
    expect(decisionInsert?.[1]?.[16]).toBe(JSON.stringify(decisionSnapshot));
    expect(decisionInsert?.[1]?.[17]).toBe(helixEnvironmentTimeSha256(decisionSnapshot));
    nextRetained = { plan_id: successor.plan_id, plan_hash: successor.plan_hash,
      compilation_hash: successorCompilation.compilation_hash, resident_action_request_id: "action:previous",
      action_request_id: "action:test", frontier_id: nextFrontier.frontier_id,
      reasoning_binding_id: "binding:test", reasoning_binding_epoch: 1,
      client_continuation_ref: "continuation:test", checkpoint_association: checkpoint,
      responses_decision_snapshot: decisionSnapshot,
      responses_decision_snapshot_hash: helixEnvironmentTimeSha256(decisionSnapshot) };
    decisionQuery.mockClear();
    await expect(retainTemporalAdmission({ query: decisionQuery } as never, decisionInput))
      .resolves.toMatchObject({ replay: true });
    expect(decisionQuery.mock.calls.some(([sql]) => sql.includes("INSERT INTO"))).toBe(false);
    nextRetained.responses_decision_snapshot_hash = helixEnvironmentTimeSha256({ tampered: true });
    decisionQuery.mockClear();
    await expect(retainTemporalAdmission({ query: decisionQuery } as never, decisionInput))
      .rejects.toThrow("replay_conflict");
    expect(decisionQuery.mock.calls.some(([sql]) => sql.includes("INSERT INTO"))).toBe(false);
    evidenceRead.mockRestore();
    await expect(retainTemporalAdmission({ query } as never, retention)).resolves.toMatchObject({ retained: true, replay: false, execution_authority: false });
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO"))).toBe(true);
    retained = { plan_id: plan.plan_id, plan_hash: plan.plan_hash, compilation_hash: preflight.compilation.compilation_hash,
      resident_action_request_id: "action:test",
      action_request_id: "action:test", frontier_id: "frontier:test", reasoning_binding_id: "binding:test",
      reasoning_binding_epoch: 1, client_continuation_ref: "continuation:test" };
    query.mockClear();
    await expect(retainTemporalAdmission({ query } as never, retention)).resolves.toMatchObject({ replay: true });
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO"))).toBe(false);
    await expect(retainTemporalAdmission({ query } as never, { ...retention, continuationRef: "other" })).rejects.toThrow("task_mismatch");
    await expect(retainTemporalAdmission({ query } as never, { ...retention, runId: "other" })).rejects.toThrow("task_mismatch");
    retained.frontier_id = "other";
    await expect(retainTemporalAdmission({ query } as never, retention)).rejects.toThrow("replay_conflict");
    await expect(retainTemporalAdmission({ query } as never, { ...retention, preflight: { ...preflight,
      compilation: { ...preflight.compilation, compilation_hash: "0".repeat(64) } } })).rejects.toThrow("compilation_mismatch");
    retained = null;
    status = "running";
    await expect(retainTemporalAdmission({ query } as never, retention)).rejects.toThrow("already_dispatched");
    status = "admitted";
    goalRevision = 2;
    await expect(retainTemporalAdmission({ query } as never, retention)).rejects.toThrow("goal_stale");
    goalRevision = 1;
    frontierPresent = false;
    await expect(retainTemporalAdmission({ query } as never, retention)).rejects.toThrow("frontier_stale");
    frontierPresent = true;
    grantActive = false;
    await expect(retainTemporalAdmission({ query } as never, retention)).rejects.toThrow("goal_forbidden");
    // Execute retention SQL against the actual two migration schemas as well.
    // pg-mem is not evidence of PostgreSQL transaction isolation/rollback.
    const { Pool } = newDb().adapters.createPg();
    const pool = new Pool();
    try {
      await pool.query(`CREATE TABLE helix_environment_durable_goals(goal_id text PRIMARY KEY, current_sequence bigint, status text);
        CREATE TABLE helix_environment_durable_goal_participants(goal_id text, profile_id text, participant_id text, status text, scopes jsonb);
        CREATE TABLE helix_environment_action_requests(action_request_id text PRIMARY KEY, request_payload jsonb, policy_version bigint, status text);
        INSERT INTO helix_environment_durable_goals VALUES ('goal:test',1,'active');
        INSERT INTO helix_environment_durable_goal_participants VALUES ('goal:test','profile:test','participant:test','active','["steer"]');`);
      await migration082.run(pool as never, { enablePgvector: false });
      await migration083.run(pool as never, { enablePgvector: false });
      await migration085.run(pool as never, { enablePgvector: false });
      await migration086.run(pool as never, { enablePgvector: false });
      await migration133.run(pool as never, { enablePgvector: false });
      await pool.query(`INSERT INTO helix_environment_temporal_frontiers
        (frontier_id,goal_id,goal_revision,frontier_revision,observation_evidence_ref,observation_producer_epoch_ref,
        action_producer_epoch_ref,identity_hash,payload_hash,frontier_payload,observed_at,retained_until)
        VALUES ('frontier:test','goal:test',1,1,'evidence:test','epoch:observation','epoch:action','identity:test',$1,$2,
        '2026-01-01T00:00:00Z','2030-01-01T00:00:00Z')`, [helixEnvironmentTimeSha256(frontier), JSON.stringify(frontier)]);
      await pool.query(`INSERT INTO helix_environment_action_requests VALUES ('action:test',$1,1,'admitted')`, [JSON.stringify(payload)]);
      await expect(retainTemporalAdmission(pool as never, retention)).resolves.toMatchObject({ replay: false, resident_action_request_id: "action:test" });
      await expect(retainTemporalAdmission(pool as never, retention)).resolves.toMatchObject({ replay: true });
      const retainedRows = (await pool.query("SELECT * FROM helix_environment_temporal_plan_admissions")).rows;
      expect(retainedRows).toHaveLength(1);
      expect(retainedRows[0]).toMatchObject({ responses_decision_snapshot: null,
        responses_decision_snapshot_hash: null });
      // The same schema must persist a real Responses successor snapshot and
      // allow a fresh protected read after the resident root settles. pg-mem
      // exercises the SQL/JSON roundtrip, not disk restart or isolation.
      const childId = "action:responses-successor";
      const childPayload = { ...payload, action_request_id: childId,
        temporal_plan: successor, arguments: successorCompilation.arguments,
        provider_execution_id: "decision:test", idempotency_key: correctDecisionKey };
      await pool.query(`INSERT INTO helix_environment_action_requests
        (action_request_id,request_payload,policy_version,status)
        VALUES ($1,$2,1,'admitted')`, [childId, JSON.stringify(childPayload)]);
      await pool.query(`UPDATE helix_environment_temporal_frontiers
        SET frontier_payload=$1,payload_hash=$2 WHERE frontier_id=$3`,
      [JSON.stringify(nextFrontier), helixEnvironmentTimeSha256(nextFrontier),
        nextFrontier.frontier_id]);
      const persistedCheckpoint = { ...checkpoint, event_hash: checkpointHash,
        plan_id: plan.plan_id, plan_hash: plan.plan_hash };
      vi.spyOn(checkpointEvidence, "readTemporalCheckpointEvidence")
        .mockResolvedValue(persistedCheckpoint as never);
      await expect(retainTemporalAdmission(pool as never, {
        ...decisionInput, actionRequestId: childId,
      })).resolves.toMatchObject({ retained: true, replay: false,
        resident_action_request_id: "action:test" });
      const persisted = (await pool.query(`SELECT responses_decision_snapshot,
        responses_decision_snapshot_hash FROM helix_environment_temporal_plan_admissions
        WHERE action_request_id=$1`, [childId])).rows[0];
      expect(persisted).toMatchObject({ responses_decision_snapshot: decisionSnapshot,
        responses_decision_snapshot_hash: helixEnvironmentTimeSha256(decisionSnapshot) });
      const link = { decision_id: choice.proposal.decision_id,
        choice_source_hash: choice.proposal.choice_source_hash,
        choice_id: choice.proposal.choice_id,
        reasoning_binding_id: "binding:test", binding_epoch: 1,
        run_id: "run:test", checkpoint_event_id: "event:checkpoint",
        plan_id: successor.plan_id, plan_hash: successor.plan_hash,
        action_request_id: childId };
      const readerBinding = { profileRef: "profile:test",
        authenticatedMcpClientRef: "mcp:test", clientSessionRef: "session:test",
        clientContinuationRef: "continuation:test", bindingId: "binding:test",
        bindingEpoch: 1, helixConversationId: "helix:test",
        missionId: null, runId: "run:test" };
      const storedRow = async (id: string) => (await pool.query(`SELECT a.plan_id,
        a.plan_hash,a.reasoning_binding_id,a.reasoning_binding_epoch,
        a.client_continuation_ref,a.checkpoint_association,
        a.responses_decision_snapshot,a.responses_decision_snapshot_hash,
        r.request_payload FROM helix_environment_temporal_plan_admissions a
        JOIN helix_environment_action_requests r
          ON r.action_request_id=a.action_request_id
        WHERE a.action_request_id=$1 LIMIT 1`, [id])).rows[0] ?? null;
      await pool.query(`UPDATE helix_environment_action_requests
        SET status='failed' WHERE action_request_id='action:test'`);
      expect(await readProtectedResponsesDecisionSource({ link, binding: readerBinding },
        { verifyTaskAssociation: async () => ({}) } as never,
        storedRow)).toMatchObject({ status: "decision_source_verified",
          source: decisionSource, historical_evidence_only: true,
          execution_authority: false, automatic_replay_allowed: false });
      await expect(pool.query("UPDATE helix_environment_temporal_plan_admissions SET resident_action_request_id='missing-action'")).rejects.toThrow();
      await pool.query("UPDATE helix_environment_durable_goals SET current_sequence=2");
      await expect(retainTemporalAdmission(pool as never, retention)).rejects.toThrow("goal_stale");
    } finally { await pool.end(); }
  } else {
    await expect(result).rejects.toThrow();
    if (scenario !== "revoked_during_read") await expect(result).rejects.toBeInstanceOf(TemporalPlanError);
    if (scenario === "expired") await expect(result).rejects.toMatchObject({ code: "temporal_plan_frontier_expired_or_unmapped" });
    if (["no_executor", "executor_unlisted", "executor_without_native_fabric",
      "executor_without_start_deadline"].includes(scenario)) {
      await expect(result).rejects.toMatchObject({ code: "temporal_plan_executor_unavailable" });
    }
  }
});
