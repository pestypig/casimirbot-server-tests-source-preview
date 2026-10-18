import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { newDb } from "pg-mem";
import express from "express";
import httpRequest from "supertest";
import { createEnvironmentActionRouter } from "../../../../routes/environment-action-routes";
import { readFileSync } from "node:fs";
import * as roomDatabase from "../../../helix-ask/realtime-room/room-store/database";
import * as actionRegistry from "../../../situation-room/environment-action-adapter-registry";
import { verifyTemporalCheckpointSettlement } from "../temporal-checkpoint-settlement";
import { registerDirectMcpTemporalAssociation, revokeDirectMcpTemporalAssociation, verifyRegisteredDirectMcpTemporalAssociation } from "../direct-mcp-temporal-registry";
import { readTemporalCheckpointEvidence } from "../temporal-checkpoint-evidence";
import { resolveTemporalEventArguments, resolveTemporalEventChain, resolveTemporalResultChain, verifyTemporalSuccessorAcceptance } from "../temporal-event-plan";
import { environmentConnectorSha256 } from "../../catalog";
import { reactiveCheckpointMeasurementsValid } from "../../actions/reactive-checkpoint-measurements";
import { temporalSequenceResultMeasurementsValid, readRecordedWorkflowEvidence, leasePendingEnvironmentTemporalSuccessor, readEnvironmentTemporalDeliveryState } from "../../actions/action-broker";
import { helixEnvironmentActionRequestSchema } from "@shared/helix-environment-action";
import {
  buildHelixEnvironmentTemporalPlan,
  helixEnvironmentTimeSha256,
  type HelixEnvironmentTemporalPlan,
} from "../../../../../shared/helix-environment-time";
import {
  compileEnvironmentTimePlanToMinecraftFluidSequence,
  compileEnvironmentTimePlanToMinecraftFluidSequenceArtifact,
  compileEnvironmentTimePlanToMinecraftReactiveProgram,
  compileEnvironmentTimePlanToMinecraftReactiveProgramArtifact,
  MinecraftEnvironmentTimeCompileError,
} from "../minecraft-environment-time-compiler";

const buildPlan = (patch: Record<string, unknown> = {}): HelixEnvironmentTemporalPlan =>
  buildHelixEnvironmentTemporalPlan({
    plan_id: "plan:minecraft:compiler:1",
    previous_plan_id: null,
    previous_plan_hash: null,
    identity: {
      environment_id: "environment:minecraft:test",
      source_id: "source:fabric:test",
      subject_id: "player:test",
      producer_epoch: "epoch:7",
      authority_id: "authority:7",
      authority_revision: 1,
      goal_id: "goal:walk",
      goal_revision: 1,
      observation_revision: 2,
      affordance_revision: 3,
    },
    clocks: {
      environment: {
        kind: "tick",
        sequence: 100,
        resolution_unit: "minecraft_tick",
        nominal_units_per_second: 20,
      },
      monotonic: { origin_id: "fabric:7", elapsed_ms: 1_000 },
      audit_at: "2026-09-03T12:00:00.000Z",
    },
    adapter_id: "minecraft.fabric_client",
    adapter_version: "1",
    compiler_version: "environment_time_minecraft:1",
    resident_executor_version: "native_fabric:1",
    start_node_id: "walk",
    maximum_total_units: 80,
    monotonic_deadline_elapsed_ms: 10_000,
    watermarks: {
      decision_unit: 40,
      stop_unit: 60,
      committed_through_unit: 80,
      stabilization_node_id: "settled",
    },
    lanes: [{
      lane_id: "locomotion",
      priority: 100,
      resource_keys: ["resource:locomotion"],
    }],
    effect_ceiling: {},
    nodes: [
      {
        kind: "action",
        node_id: "walk",
        lane_id: "locomotion",
        capability_id: "com.casimirbot.minecraft.player.walk",
        capability_version: "1",
        arguments: {
          action_kind: "walk",
          direction: "forward",
          duration_ms: 500,
          sprint: false,
        },
        required_resources: ["resource:locomotion"],
        timing: {
          earliest_start_unit: 2,
          latest_start_unit: 10,
          maximum_duration_units: 20,
        },
        preconditions: [{
          kind: "adapter_condition",
          condition_id: "minecraft.player_grounded",
          arguments: { expected: true },
        }],
        completion_conditions: [{
          kind: "adapter_condition",
          condition_id: "minecraft.player_grounded",
          arguments: { expected: true },
        }],
        abort_guards: [],
        effect_budget: {},
        on_success_node_id: "settled",
        on_failure_node_id: "failed",
        on_timeout_node_id: "failed",
      },
      {
        kind: "checkpoint",
        node_id: "settled",
        checkpoint_id: "checkpoint:walk",
        required_evidence_kinds: ["player_pose"],
        condition: {
          kind: "adapter_condition",
          condition_id: "minecraft.player_grounded",
          arguments: { expected: true },
        },
        wait_up_to_units: 5,
        on_satisfied_node_id: "success",
        on_timeout_node_id: "failed",
      },
      { kind: "terminal", node_id: "success", outcome: "succeeded", reason_code: "done" },
      { kind: "terminal", node_id: "failed", outcome: "failed", reason_code: "failed" },
    ],
    ...patch,
  } as Parameters<typeof buildHelixEnvironmentTemporalPlan>[0]);

const resourceBindings = { "resource:locomotion": "locomotion" as const };
const fluidScope = {
  world_mutation_allowed: false,
  max_block_mutations: 0,
  max_inventory_transfers: 0,
  allowed_block_ids: [],
  allowed_regions: [],
  combat_allowed: false as const,
};

describe("Minecraft Environment Time compatibility compiler", () => {
  it("keeps the native continuity fixture identical to actual compiler output", () => {
    for (const name of ["compiled-walk-continuity", "compiled-rolling-walk"]) {
    const fixture = JSON.parse(readFileSync(`minecraft/helix-fabric-player-agent/src/test/resources/${name}.json`, "utf8"));
    expect(compileEnvironmentTimePlanToMinecraftFluidSequenceArtifact({
      plan: fixture.source, mutation_scope: fluidScope, resource_bindings: resourceBindings,
    })).toEqual(fixture.artifact);
    }
  });

  it("preserves the millisecond walk parameter instead of claiming input-segment continuity", () => {
    const source = buildPlan();
    const walk = source.nodes.find(node => node.kind === "action")!;
    if (walk.kind !== "action") throw new Error("fixture action missing");
    // Deliberately not a multiple of a nominal 50 ms tick. A rolling repair
    // must preserve the native ceil(ms / 50) and measured-motion semantics.
    walk.arguments = { ...walk.arguments, duration_ms: 525 };
    const { plan_hash: _hash, ...draft } = source;
    const artifact = compileEnvironmentTimePlanToMinecraftFluidSequenceArtifact({
      plan: buildHelixEnvironmentTemporalPlan(draft),
      mutation_scope: fluidScope, resource_bindings: resourceBindings,
    });
    expect(artifact.arguments.nodes.some(node => node.node_kind === "input_segment")).toBe(false);
    const compiled = artifact.arguments.nodes.find(node => node.node_kind === "workflow_action");
    expect(compiled).toMatchObject({ node_kind: "workflow_action", action: { duration_ms: 525 } });
    expect(artifact.execution_authority).toBe(false);
  });

  it("validates terminal completion across retained plans without erasing the resident ceiling", async () => {
    const plan = buildPlan({ watermarks: { decision_unit: 40, stop_unit: 60, committed_through_unit: 70, stabilization_node_id: "settled" } });
    const next = buildPlan({ plan_id: "next-terminal", previous_plan_id: plan.plan_id, previous_plan_hash: plan.plan_hash,
      clocks: { ...plan.clocks, environment: { ...plan.clocks.environment, sequence: 170 } } });
    const requestFor = (source: typeof plan) => helixEnvironmentActionRequestSchema.parse({
      schema: "helix.environment_action.request.v1", action_request_id: source.previous_plan_id ? "action:successor" : "action:terminal", workflow_id: "workflow:terminal",
      action_authority_id: source.identity.authority_id, environment_binding_id: source.identity.environment_id,
      room_id: "room", source_id: source.identity.source_id, world_id: "world", participant_id: "participant",
      subject_binding_id: source.identity.subject_id, subject_native_id: "player", run_id: "run", turn_id: "turn",
      provider_execution_id: "provider", tool_call_id: "tool", catalog_snapshot_id: "catalog",
      capability_id: "com.casimirbot.minecraft.player.execute_sequence", capability_version: 1,
      action_kind: "execute_sequence", effect_class: "continuous_control", workflow_mode: "long_running",
      requested_control_engine: "native_fabric", temporal_plan: source,
      arguments: compileEnvironmentTimePlanToMinecraftFluidSequenceArtifact({ plan: source,
        mutation_scope: fluidScope, resource_bindings: resourceBindings }).arguments,
      preconditions: [], postconditions: [{ condition_id: "sequence-complete", condition_kind: "minecraft.player.sequence_completed",
        required: true, parameters: {} }], idempotency_key: source.plan_id,
      confirmation_state: "approved", approval_ref: "approval", created_at: "2026-09-05T00:00:00Z",
      deadline_at: "2026-09-05T00:01:00Z", constraints: { max_duration_ms: 60000, max_distance_blocks: 128,
        max_block_mutations: 0, max_inventory_transfers: 0, manual_override_policy: "cancel",
        require_postcondition_verification: true, world_mutation_allowed: false, combat_allowed: false,
        host_access_allowed: false, automatic_replay_allowed: false },
      answer_authority: false, assistant_answer: false, terminal_eligible: false, raw_content_included: false,
    });
    const root = requestFor(plan); const successor = requestFor(next);
    const measured = (action: typeof root, elapsed: number) => {
      const args = action.arguments as any;
      const checkpoints = args.nodes.filter((node: any) => node.node_kind === "checkpoint");
      const observations = args.nodes.filter((node: any) => node.condition).map((node: any) => ({
        node_id: node.node_id, condition_kind: node.condition.condition_kind, tick_index: 10, satisfied: true }));
      return { sequence_id: args.sequence_id, ruleset: args.ruleset, sequence_completed: true,
        executed_node_count: args.nodes.length, required_checkpoints_satisfied: args.required_checkpoint_ids.length,
        satisfied_checkpoint_ids: checkpoints.map((node: any) => node.checkpoint_id), scheduler_ticks_elapsed: elapsed,
        condition_observations: observations, condition_observation_count: observations.length,
        checkpoint_settlements: checkpoints.map((node: any) => ({ node_id: node.node_id,
          checkpoint_id: node.checkpoint_id, tick_index: 10, scheduler_ticks_elapsed: 11, monotonic_elapsed_ns: 500000000 })),
        player_motion_performed: true, player_interaction_performed: false, inventory_mutation_performed: false,
        world_mutations_performed: 0, inventory_mutations_performed: 0 };
    };
    const historical = measured(root, 71);
    const checkpoint = historical.checkpoint_settlements.at(-1)!;
    const acceptance = { sequence_id: next.plan_id, predecessor_sequence_id: plan.plan_id,
      checkpoint_id: checkpoint.checkpoint_id, accepted_client_tick: 120,
      accepted_monotonic_elapsed_ms: 2000, committed_client_tick: 170, lead_ticks: 50,
      queue_depth: 1, execution_started: false, terminal_eligible: false };
    const acceptanceDb = { query: async (_sql: string, values: unknown[]) => {
      const source = values[0] === plan.plan_id ? plan : next;
      return { rows: [{ source_plan: source, compilation_artifact: compileEnvironmentTimePlanToMinecraftFluidSequenceArtifact({
        plan: source, mutation_scope: fluidScope, resource_bindings: resourceBindings }),
        resident_action_request_id: root.action_request_id, request_payload: source === plan ? root : successor,
        status: "leased", checkpoint_association: { resident_action_request_id: root.action_request_id,
          workflow_id: root.workflow_id, plan_id: plan.plan_id, plan_hash: plan.plan_hash,
          checkpoint_id: checkpoint.checkpoint_id, native_node_id: checkpoint.node_id,
          native_tick_index: checkpoint.tick_index, workflow_monotonic_elapsed_ns: checkpoint.monotonic_elapsed_ns } }] };
    } };
    const acceptanceClock = { tick_index: 120, monotonic: { origin_id: plan.clocks.monotonic.origin_id, elapsed_ms: 2000 } };
    const checkAcceptance = (patch = {}, clock = acceptanceClock) => verifyTemporalSuccessorAcceptance(acceptanceDb as never,
      root, { ...historical, temporal_successor_acceptance: { ...acceptance, ...patch } }, plan.identity.producer_epoch, clock);
    await expect(checkAcceptance()).resolves.toBe(successor.action_request_id);
    for (const patch of [{ predecessor_sequence_id: "wrong" }, { sequence_id: plan.plan_id },
      { checkpoint_id: "wrong" }, { accepted_client_tick: 160 }, { lead_ticks: 999 },
      { committed_client_tick: 171 }, { execution_started: true }, { terminal_eligible: true },
      { queue_depth: 2 }, { accepted_monotonic_elapsed_ms: 10000 }]) {
      await expect(checkAcceptance(patch)).rejects.toThrow();
    }
    await expect(checkAcceptance({}, { ...acceptanceClock, tick_index: 119 })).rejects.toThrow();
    await expect(checkAcceptance({}, { ...acceptanceClock, monotonic: { origin_id: "wrong", elapsed_ms: 2000 } })).rejects.toThrow();
    const current = { ...measured(successor, 12), completed_sequence_measurements: [historical], resident_handoff_count: 1,
      resident_tick_index: 81, resident_effect_totals: { player_motion_performed: true, player_interaction_performed: false,
        inventory_mutation_performed: false, world_mutation_performed: false, side_effects_performed: true,
        world_mutations_performed: 0, inventory_mutations_performed: 0 } };
    const chain = [{ plan, request: root, arguments: root.arguments, measurements: historical, require_complete: true },
      { plan: next, request: successor, arguments: successor.arguments, measurements: current, require_complete: true }];
    const result = { outcome: "succeeded", controls_released: true, started_at: "2026-09-05T00:00:00Z",
      completed_at: "2026-09-05T00:00:05Z", duration_ticks: 100, completed_clock: { tick_index: 200 },
      player_motion_performed: true, player_interaction_performed: false, inventory_mutation_performed: false,
      world_mutation_performed: false, side_effects_performed: true };
    const verify = () => temporalSequenceResultMeasurementsValid({ request: root, result: result as never, measurements: current, chain });
    expect(verify()).toBe(true);
    const terminalResult = { ...result, progress_event_refs: ["event:terminal"], postconditions: [] };
    const terminalEvent = { schema: "helix.environment_action.workflow_event.v1", event_id: "event:terminal",
      action_request_id: root.action_request_id, workflow_id: root.workflow_id, sequence: 2,
      event_type: "workflow.succeeded", workflow_state: "succeeded", progress_fraction: 1,
      summary: "Resident sequence settled", control_engine: "native_fabric", measurements: current, evidence_refs: [],
      manual_override_detected: false, controls_released: true, created_at: result.completed_at,
      content_role: "environment_action_event_not_assistant_answer", answer_authority: false,
      assistant_answer: false, terminal_eligible: false, raw_content_included: false };
    const db = { query: async (sql: string, values: unknown[]) => {
      if (sql.includes("helix_environment_action_workflow_events")) return { rows: [{ event_id: terminalEvent.event_id,
        event_payload: terminalEvent, producer_epoch_ref: plan.identity.producer_epoch }] };
      const source = values[0] === plan.plan_id ? plan : next;
      return { rows: [{ source_plan: source, compilation_artifact: compileEnvironmentTimePlanToMinecraftFluidSequenceArtifact({
        plan: source, mutation_scope: fluidScope, resource_bindings: resourceBindings }),
        resident_action_request_id: root.action_request_id, request_payload: source === plan ? root : successor,
        status: source === plan ? "succeeded" : "running" }] };
    } };
    const read = () => readRecordedWorkflowEvidence({ db: db as never, request: root, result: terminalResult as never });
    expect((await read()).valid).toBe(true);
    terminalEvent.controls_released = false; expect((await read()).valid).toBe(false); terminalEvent.controls_released = true;
    // Exercise the internal delivery transaction with retained identities, not
    // connector-supplied task credentials. The query adapter is mocked here.
    try {
      for (const scenario of ["direct", "valid", "lease_response_loss", "http_response_loss", "controls", "goal_stopped", "goal_revision", "checkpoint", "binding", "stale_event"]) {
        const realStorage = ["valid", "direct", "lease_response_loss", "http_response_loss"].includes(scenario);
        let leased = false;
        let mutations = 0;
        const direct = scenario === "direct";
        const associationId = direct ? "direct_mcp_context:test-successor" : "binding";
        const continuationRef = direct ? "direct_mcp_session:test-successor" : "continuation";
        if (direct) expect(await registerDirectMcpTemporalAssociation({ association: {
          kind: "direct_mcp_client", associationId, associationEpoch: 1, continuationRef,
          profileRef: "owner", runId: root.run_id, roomId: root.room_id, participantId: root.participant_id,
        }, verify: async () => {} })).toBe(true);
        if (direct) expect(await verifyRegisteredDirectMcpTemporalAssociation({ associationId,
          associationEpoch: 1, continuationRef, profileRef: "owner", runId: root.run_id,
          roomId: root.room_id, participantId: root.participant_id })).toBe(true);
        const fixtureToken = "synthetic-et6-connector-test-only";
        let fixtureScopes = ["action.poll"];
        const deadline = new Date(Date.now() + 60000).toISOString();
        const runningEvent = { ...terminalEvent, event_type: "workflow.progress", workflow_state: "running",
          controls_released: false, measurements: historical, created_at: new Date(Date.now() - (scenario === "stale_event" ? 6000 : 0)).toISOString() };
        const rootRow = { request_payload: root, status: "running", action_request_id: root.action_request_id,
          connector_manifest_id: "manifest", deadline_at: deadline, policy_version: 1 };
        // Exercise the real candidate/status/lease SQL together with the real
        // broker in the positive scenario. Authority/heartbeat fixtures below
        // remain mocked; this is not full authenticated persistence coverage.
        const memory = newDb();
        memory.public.none(`CREATE TABLE helix_environment_action_requests (
          action_request_id text primary key, action_authority_id text, run_id text,
          request_payload jsonb, status text, connector_manifest_id text,
          deadline_at timestamptz, policy_version integer, attempt_count integer,
          leased_at timestamptz, lease_expires_at timestamptz, updated_at timestamptz);
          CREATE TABLE helix_environment_temporal_plan_admissions (
          action_request_id text, resident_action_request_id text, previous_plan_id text,
          previous_plan_hash text, checkpoint_association jsonb, reasoning_binding_id text,
          reasoning_binding_epoch integer, client_continuation_ref text, source_plan jsonb);`);
        const { Pool } = memory.adapters.createPg();
        const sqlPool = new Pool();
        for (const action of [root, successor]) await sqlPool.query(`INSERT INTO helix_environment_action_requests
          (action_request_id,action_authority_id,run_id,request_payload,status,connector_manifest_id,deadline_at,policy_version,attempt_count)
          VALUES ($1,$2,$3,$4,$5,'manifest',$6,1,0)`, [action.action_request_id, action.action_authority_id,
            action.run_id, JSON.stringify(action), action === root ? "running" : "admitted", deadline]);
        await sqlPool.query(`INSERT INTO helix_environment_temporal_plan_admissions VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8)`,
          [successor.action_request_id, root.action_request_id, plan.plan_id, plan.plan_hash, JSON.stringify({
            resident_action_request_id: root.action_request_id, workflow_id: root.workflow_id, plan_id: plan.plan_id,
            plan_hash: plan.plan_hash, checkpoint_id: "checkpoint:walk", native_node_id: "settled",
            native_tick_index: 10, workflow_monotonic_elapsed_ns: 500000000 }), associationId, continuationRef, JSON.stringify(next)]);
        const query = vi.fn(async (sql: string, values?: unknown[]) => {
          if (realStorage && /temporal_plan_admissions|FROM helix_environment_action_requests|UPDATE helix_environment_action_requests/.test(sql)) {
            const result = await sqlPool.query(sql, values);
            if (sql.includes("SET status='leased'")) {
              mutations += result.rows.length;
              if (scenario.endsWith("response_loss") && result.rows.length) throw new Error("fixture_after_lease_write");
            }
            return result;
          }
          if (sql.includes("FROM helix_environment_action_authorities a")) return { rows: [{ authority_status: "active",
            authority_expires_at: null, environment_status: "active", source_status: "active", room_status: "open",
            action_authority_id: root.action_authority_id, environment_binding_id: root.environment_binding_id,
            room_id: root.room_id, source_id: root.source_id, world_id: root.world_id,
            participant_id: root.participant_id, subject_binding_id: root.subject_binding_id, subject_native_id: root.subject_native_id,
            room_source_binding_id: "room-source", connector_installation_id: "installation",
            adapter_profile_id: "adapter", domain_adapter: "minecraft.fabric_client", source_adapter_profile_id: "source-adapter",
            token_hash: `sha256:${createHash("sha256").update(fixtureToken).digest("hex")}`, scopes: fixtureScopes,
            owner_profile_id: "owner", credential_id: "credential", policy_version: 1, credential_status: "active", credential_expires_at: deadline }] };
          if (sql.includes("connector_manifests")) return { rows: [{ manifest_id: "manifest", producer_epoch_ref: plan.identity.producer_epoch }] };
          if (sql.includes("connector_heartbeats")) return { rows: [{ status: "active", received_at: new Date(), emergency_stop_latched: false, control_engines: [] }] };
          if (sql.includes("durable_goals")) return { rows: [{ status: scenario === "goal_stopped" ? "canceled" : "active", current_sequence: scenario === "goal_revision" ? 2 : 1 }] };
          if (sql.includes("helix_environment_temporal_frontiers")) {
            const frontier = { schema: "environment.affordance_frontier.v1", frontier_id: "frontier:successor",
              identity: next.identity, clocks: next.clocks,
              expires_at_environment_sequence: next.clocks.environment.sequence + 100,
              entries: [], newly_available_capability_ids: [], newly_blocked_capability_ids: [],
              materially_changed_capability_ids: [], expired_capability_ids: [],
              strategy_recommendation_included: false, execution_authority: false,
              answer_authority: false, assistant_answer: false, terminal_eligible: false };
            return { rows: [{ frontier_payload: frontier, payload_hash: helixEnvironmentTimeSha256(frontier),
              retained_until: deadline, observed_at: new Date().toISOString() }] };
          }
          if (sql.includes("action_control_requests")) return { rows: scenario === "controls" ? [{}] : [] };
          if (sql.includes("action_workflow_events")) return { rows: [{ event_payload: runningEvent, event_hash: environmentConnectorSha256(runningEvent),
            producer_epoch_ref: plan.identity.producer_epoch, created_at: runningEvent.created_at }] };
          if (sql.includes("temporal_plan_admissions")) return { rows: leased && !sql.includes("a.source_plan") ? [] : [{ request_payload: successor,
            source_plan: next, status: leased ? "leased" : "admitted",
            action_request_id: successor.action_request_id, deadline_at: deadline, reasoning_binding_id: associationId, reasoning_binding_epoch: 1,
            client_continuation_ref: continuationRef, checkpoint_association: { resident_action_request_id: root.action_request_id,
              workflow_id: root.workflow_id, plan_id: plan.plan_id, plan_hash: plan.plan_hash, checkpoint_id: "checkpoint:walk",
              native_node_id: "settled", native_tick_index: scenario === "checkpoint" ? 9 : 10, workflow_monotonic_elapsed_ns: 500000000 } }] };
          if (sql.includes("SET status='leased'")) { leased = true; mutations++; return { rows: [{ request_payload: successor }] }; }
          if (sql.includes("FROM helix_environment_action_requests")) return { rows: [rootRow] };
          return { rows: [] };
        });
        vi.spyOn(roomDatabase, "withSharedRealtimeRoomTransaction").mockImplementation(async work => work({ query } as never));
        vi.spyOn(actionRegistry, "resolveEnvironmentActionAdapterProfile").mockReturnValue({ profile: { freshness: { heartbeat_max_age_ms: 30000 } } } as never);
        const deliveryInput = { claim: { ownerProfileId: "owner", credentialId: "credential",
          authorityId: root.action_authority_id, policyVersion: 1, environmentBindingId: root.environment_binding_id, roomId: root.room_id,
          sourceId: root.source_id, worldId: root.world_id, participantId: root.participant_id, subjectBindingId: root.subject_binding_id,
          subjectNativeId: root.subject_native_id } as Parameters<typeof leasePendingEnvironmentTemporalSuccessor>[0]["claim"], residentActionRequestId: root.action_request_id,
          predecessorPlanId: plan.plan_id, predecessorPlanHash: plan.plan_hash, checkpointId: "checkpoint:walk",
          bindingStore: direct ? undefined : { inspect: () => {
            return { status: scenario === "binding" ? "revoked" : "active", binding_epoch: 1, run_id: root.run_id,
              provider_thread_ref_hash: createHash("sha256").update("continuation").digest("hex") } as never;
          } } };
        const lease = () => leasePendingEnvironmentTemporalSuccessor(deliveryInput);
        if (direct) expect(await readEnvironmentTemporalDeliveryState(deliveryInput)).toMatchObject({
          action_request_id: successor.action_request_id,
        });
        if (scenario === "valid" || scenario === "direct") {
          const competing = await Promise.all(Array.from({ length: 8 }, () => lease()));
          expect(competing.filter(value => value !== null)).toEqual([successor]);
          expect((await sqlPool.query("SELECT attempt_count FROM helix_environment_action_requests WHERE action_request_id=$1",
            [successor.action_request_id])).rows[0].attempt_count).toBe(1);
        } else if (scenario === "http_response_loss") {
          vi.spyOn(roomDatabase, "readSharedRealtimeRoomDatabase").mockResolvedValue({ query } as never);
          const app = express().use(createEnvironmentActionRouter(deliveryInput.bindingStore));
          const endpoint = `/v1/authorities/${encodeURIComponent(root.action_authority_id)}/requests/temporal-successor`;
          const body = { resident_action_request_id: root.action_request_id, predecessor_plan_id: plan.plan_id,
            predecessor_plan_hash: plan.plan_hash, checkpoint_id: "checkpoint:walk" };
          const unauthorized = await httpRequest(app).post(endpoint).set("Authorization", "Bearer wrong-fixture-token").send(body);
          expect(unauthorized.status).toBe(401);
          expect(mutations).toBe(0);
          fixtureScopes = [];
          const denied = await httpRequest(app).post(endpoint).set("Authorization", `Bearer ${fixtureToken}`).send(body);
          expect(denied.status).toBe(403);
          expect(mutations).toBe(0);
          fixtureScopes = ["action.poll"];
          const failed = await httpRequest(app).post(endpoint).set("Authorization", `Bearer ${fixtureToken}`).send(body);
          expect(failed.status).toBe(503);
          expect(failed.body).toMatchObject({ ok: false, error: "action_connector_unavailable", terminal_eligible: false });
          expect(failed.body).not.toHaveProperty("action_request");
          const repeated = await httpRequest(app).post(endpoint).set("Authorization", `Bearer ${fixtureToken}`).send(body);
          expect(repeated.status).toBe(200);
          expect(repeated.body).toMatchObject({ action_request: null, automatic_replay_allowed: false });
          const reconciled = await httpRequest(app).post(endpoint + "/status").set("Authorization", `Bearer ${fixtureToken}`).send(body);
          expect(reconciled.status).toBe(200);
          expect(reconciled.headers["cache-control"]).toBe("no-store");
          expect(reconciled.body).toMatchObject({ delivery_state: { recorded_status: "leased", effects_verified: false },
            absence_proves_no_effects: false, execution_authority: false, automatic_replay_allowed: false });
          expect(reconciled.body).not.toHaveProperty("action_request");
          expect((await sqlPool.query("SELECT attempt_count FROM helix_environment_action_requests WHERE action_request_id=$1",
            [successor.action_request_id])).rows[0].attempt_count).toBe(1);
        } else if (scenario === "lease_response_loss") {
          await expect(lease()).rejects.toThrow("fixture_after_lease_write");
          expect((await sqlPool.query("SELECT status,attempt_count FROM helix_environment_action_requests WHERE action_request_id=$1",
            [successor.action_request_id])).rows[0]).toEqual({ status: "leased", attempt_count: 1 });
        } else expect(await lease(), scenario).toBeNull();
        expect(await lease(), `${scenario} duplicate`).toBeNull();
        expect(mutations, scenario).toBe(realStorage ? 1 : 0);
        const beforeInspection = mutations;
        const inspected = await readEnvironmentTemporalDeliveryState(deliveryInput);
        if (scenario === "binding") expect(inspected).toBeNull();
        else expect(inspected).toMatchObject({ action_request_id: successor.action_request_id,
          recorded_status: realStorage ? "leased" : "admitted", effects_verified: false,
          automatic_replay_allowed: false, execution_authority: false });
        expect(mutations).toBe(beforeInspection);
        if (scenario === "direct") {
          revokeDirectMcpTemporalAssociation(associationId);
          expect(await readEnvironmentTemporalDeliveryState(deliveryInput)).toBeNull();
        }
        if (scenario === "valid") {
          for (const patch of [
            { checkpointId: "wrong" }, { predecessorPlanHash: "wrong" },
            { claim: { ...deliveryInput.claim, ownerProfileId: "wrong" } },
            { claim: { ...deliveryInput.claim, subjectBindingId: "wrong" } },
            { claim: { ...deliveryInput.claim, credentialId: "wrong" } },
            { bindingStore: { inspect: () => ({ status: "active", binding_epoch: 2, run_id: root.run_id,
              provider_thread_ref_hash: createHash("sha256").update("continuation").digest("hex") } as never) } },
            { bindingStore: { inspect: () => ({ status: "active", binding_epoch: 1, run_id: "wrong",
              provider_thread_ref_hash: createHash("sha256").update("continuation").digest("hex") } as never) } },
            { bindingStore: { inspect: () => ({ status: "active", binding_epoch: 1, run_id: root.run_id,
              provider_thread_ref_hash: createHash("sha256").update("wrong").digest("hex") } as never) } },
          ]) expect(await readEnvironmentTemporalDeliveryState({ ...deliveryInput, ...patch })).toBeNull();
          expect(mutations).toBe(beforeInspection);
        }
        await sqlPool.end();
        vi.restoreAllMocks();
      }
    } finally { vi.restoreAllMocks(); }
    historical.sequence_completed = false; expect(verify()).toBe(false); historical.sequence_completed = true;
    historical.scheduler_ticks_elapsed = 70; expect(verify()).toBe(false); historical.scheduler_ticks_elapsed = 71;
    current.resident_tick_index = 80; expect(verify()).toBe(false); current.resident_tick_index = 81;
    root.constraints.max_duration_ms = 4999; expect(verify()).toBe(false); root.constraints.max_duration_ms = 60000;
    result.controls_released = false; expect(verify()).toBe(false);
  });
  it("resolves only delivered intact plan graphs for the exact resident identity", async () => {
    const plan = buildPlan();
    const compilation = compileEnvironmentTimePlanToMinecraftFluidSequenceArtifact({ plan,
      mutation_scope: fluidScope, resource_bindings: resourceBindings });
    const resident = { action_request_id: "resident", action_kind: "execute_sequence", temporal_plan: plan,
      run_id: "run", room_id: "room", world_id: "world", participant_id: "participant", subject_native_id: "player",
      subject_binding_id: plan.identity.subject_id, action_authority_id: plan.identity.authority_id,
      environment_binding_id: plan.identity.environment_id, source_id: plan.identity.source_id };
    const base = { source_plan: plan, compilation_artifact: compilation, resident_action_request_id: "resident",
      request_payload: { ...resident, action_request_id: "plan-action", arguments: compilation.arguments }, status: "leased" };
    let row = base;
    const db = { query: async () => ({ rows: [row] }) };
    const read = () => resolveTemporalEventArguments(db as never, resident as never, { sequence_id: plan.plan_id }, plan.identity.producer_epoch);
    expect(await read()).toEqual(compilation.arguments);
    row = { ...base, status: "admitted" };
    await expect(read()).rejects.toThrow("not_delivered");
    row = { ...base, resident_action_request_id: "other" };
    await expect(read()).rejects.toThrow("integrity_mismatch");
    row = { ...base, compilation_artifact: { ...compilation, compilation_hash: "damaged" } };
    await expect(read()).rejects.toThrow("integrity_mismatch");
    row = { ...base, request_payload: { ...base.request_payload, room_id: "other" } };
    await expect(read()).rejects.toThrow("identity_mismatch");
    row = base;
    await expect(resolveTemporalEventArguments(db as never, resident as never, { sequence_id: plan.plan_id }, "other-epoch")).rejects.toThrow("integrity_mismatch");
    await expect(resolveTemporalEventArguments(db as never, resident as never, {}, plan.identity.producer_epoch)).rejects.toThrow("plan_missing");
    const next = buildPlan({ plan_id: "next", previous_plan_id: plan.plan_id, previous_plan_hash: plan.plan_hash });
    const nextCompilation = compileEnvironmentTimePlanToMinecraftFluidSequenceArtifact({ plan: next,
      mutation_scope: fluidScope, resource_bindings: resourceBindings });
    const nextRow = { ...base, source_plan: next, compilation_artifact: nextCompilation,
      request_payload: { ...base.request_payload, temporal_plan: next, arguments: nextCompilation.arguments } };
    const chainDb = { query: async (_sql: string, values: unknown[]) => ({ rows: [values[0] === next.plan_id ? nextRow : base] }) };
    const historical = { sequence_id: plan.plan_id, sequence_completed: true, checkpoint_settlements: [], satisfied_checkpoint_ids: [] };
    const current = { sequence_id: next.plan_id, resident_handoff_count: 1, completed_sequence_measurements: [historical], checkpoint_settlements: [], satisfied_checkpoint_ids: [] };
    const chain = (measurements: Record<string, unknown>) => resolveTemporalEventChain(chainDb as never, resident as never, measurements, plan.identity.producer_epoch, false);
    expect((await chain(current)).map(item => item.require_complete)).toEqual([true, false]);
    await expect(chain({ sequence_id: next.plan_id, checkpoint_settlements: [], satisfied_checkpoint_ids: [] })).rejects.toThrow("chain_mismatch");
    await expect(chain({ ...current, checkpoint_settlements: undefined })).rejects.toThrow("history_invalid");
    await expect(chain({ ...current, completed_sequence_measurements: [{ ...historical, checkpoint_settlements: undefined }] })).rejects.toThrow("history_invalid");
    await expect(chain({ ...current, resident_handoff_count: 2 })).rejects.toThrow("history_invalid");
    await expect(chain({ ...current, resident_handoff_count: 2, completed_sequence_measurements: [historical, historical] })).rejects.toThrow("chain_mismatch");
    await expect(chain({ ...current, completed_sequence_measurements: [{ ...historical, sequence_completed: false }] })).rejects.toThrow("history_invalid");
    await expect(chain({ ...current, completed_sequence_measurements: [{ ...historical, sequence_id: next.plan_id }] })).rejects.toThrow("chain_mismatch");
    const terminalDb = { query: async (_sql: string, values: unknown[]) => ({ rows: [values[0] === next.plan_id ? nextRow : { ...base, status: "succeeded" }] }) };
    await expect(resolveTemporalEventChain(terminalDb as never, resident as never, current, plan.identity.producer_epoch, true)).rejects.toThrow("not_delivered");
    const terminalChain = await resolveTemporalResultChain(terminalDb as never, resident as never, current, plan.identity.producer_epoch);
    expect(terminalChain.map(entry => entry.plan.plan_id)).toEqual([plan.plan_id, next.plan_id]);
    expect(terminalChain.every(entry => entry.require_complete)).toBe(true);
    const badTerminalDb = { query: async () => ({ rows: [{ ...base, status: "canceled" }] }) };
    await expect(resolveTemporalResultChain(badTerminalDb as never, resident as never, { ...historical }, plan.identity.producer_epoch)).rejects.toThrow("not_delivered");
  });

  it.each(["serial", "reactive"])("requires the latest explicit checkpoint from cumulative %s evidence", engine => {
    const original = buildPlan();
    const checkpoint = original.nodes.find(node => node.kind === "checkpoint")!;
    const plan = buildPlan({ nodes: original.nodes.map(node => node.node_id === "settled"
      ? { ...node, on_satisfied_node_id: "second" } : node).concat({ ...checkpoint,
        node_id: "second", checkpoint_id: "checkpoint:second" }) });
    const compilation = engine === "serial"
      ? compileEnvironmentTimePlanToMinecraftFluidSequenceArtifact({ plan, mutation_scope: fluidScope, resource_bindings: resourceBindings })
      : compileEnvironmentTimePlanToMinecraftReactiveProgramArtifact({ plan, mutation_scope: fluidScope, resource_bindings: resourceBindings, lane_kind: "locomotion" });
    const first = { node_id: "settled", checkpoint_id: "checkpoint:walk", tick_index: 12, monotonic_elapsed_ns: 600 };
    const second = { node_id: "second", checkpoint_id: "checkpoint:second", tick_index: 13, monotonic_elapsed_ns: 700 };
    const verify = (settlements: unknown, checkpointId: string) => verifyTemporalCheckpointSettlement({ plan, compilation, settlements, checkpointId });
    expect(() => verify([first, second], first.checkpoint_id)).toThrow("not_latest");
    expect(verify([first, second], second.checkpoint_id)).toMatchObject({ native_tick_index: 13 });
    expect(() => verify([second, first], first.checkpoint_id)).toThrow("clock_invalid");
    expect(() => verify([first, { ...second, monotonic_elapsed_ns: 500 }], second.checkpoint_id)).toThrow("clock_invalid");
    expect(verify([first, { node_id: "walk.post.0", checkpoint_id: "generated", tick_index: 14, monotonic_elapsed_ns: 800 }], first.checkpoint_id))
      .toMatchObject({ native_tick_index: 12 });
    // Array order preserves native settlement order even within one tick.
    expect(() => verify([first, { ...second, tick_index: 12, monotonic_elapsed_ns: 600 }], first.checkpoint_id)).toThrow("not_latest");
  });

  it("resolves only fresh exact workflow checkpoint events with intact hashes", async () => {
    const plan = buildPlan();
    const compilation = compileEnvironmentTimePlanToMinecraftFluidSequenceArtifact({ plan,
      mutation_scope: fluidScope, resource_bindings: resourceBindings });
    const action = { action_request_id: "action:test", run_id: "run:test", workflow_id: "workflow:test",
      room_id: "room:test", world_id: "world:test", environment_binding_id: plan.identity.environment_id,
      source_id: plan.identity.source_id, subject_binding_id: plan.identity.subject_id,
      action_authority_id: plan.identity.authority_id, temporal_plan: plan };
    const clock = { schema: "helix.environment_clock_snapshot.v1", clock_id: "clock:test", clock_kind: "minecraft_game_tick",
      tick_rate_hz: 20, tick_index: 112, world_tick_index: 200, synchronization: "client_local",
      observed_at: "2026-09-05T00:00:00Z", monotonic: { origin_id: "fabric:7", elapsed_ms: 1600 } };
    const event = { schema: "helix.environment_event.v1", event_id: "event:test", sequence: 1,
      event_type: "workflow.progress", domain: "minecraft", domain_adapter: "minecraft.fabric_client",
      room_id: action.room_id, world_id: action.world_id, source_id: action.source_id,
      producer_epoch_ref: plan.identity.producer_epoch, producer_plane: "player_embodiment",
      subject_ref: action.subject_binding_id, workflow_ref: action.workflow_id, summary: "Checkpoint measured",
      attributes: { clock, action_event_ref: "action-event:test", active_workflow: { workflow_ref: action.workflow_id, workflow_state: "running", manual_override_detected: false },
        workflow_measurements: { sequence_id: compilation.arguments.sequence_id, checkpoint_settlements: [{ checkpoint_id: "checkpoint:walk", node_id: "settled", tick_index: 12, monotonic_elapsed_ns: 600 }] } },
      evidence_refs: [], occurred_at: "2026-09-05T00:00:00Z", observed_at: "2026-09-05T00:00:00Z", provenance: "measured",
      raw_event_included: false, content_role: "environment_event_not_assistant_answer", answer_authority: false,
      assistant_answer: false, terminal_eligible: false, raw_content_included: false };
    let payload = event;
    let hash = environmentConnectorSha256(payload);
    let actionEvent = { schema: "helix.environment_action.workflow_event.v1", event_id: "action-event:test",
      action_request_id: action.action_request_id, workflow_id: action.workflow_id, sequence: 1,
      event_type: "workflow.progress", workflow_state: "running", progress_fraction: 0.2, summary: "Checkpoint measured",
      control_engine: "native_fabric", clock, measurements: event.attributes.workflow_measurements, evidence_refs: [],
      manual_override_detected: false, controls_released: false, created_at: event.occurred_at,
      content_role: "environment_action_event_not_assistant_answer", answer_authority: false, assistant_answer: false,
      terminal_eligible: false, raw_content_included: false };
    let retainedPlan = plan;
    let retainedCompilation = compilation;
    let residentActionId: string | null = action.action_request_id;
    let anchorRows: Array<{ event_id: string; event_payload: unknown; event_hash: string }> | null = null;
    let referencedRows: Array<{ event_id: string; event_payload: unknown; event_hash: string }> | null = null;
    const queriedValues: unknown[][] = [];
    let pairedActionRows: unknown[] = [];
    const query = async (sql: string, values: unknown[] = []) => (queriedValues.push(values), { rows: sql.includes("FROM helix_environment_temporal_plan_admissions")
      ? [{ source_plan: retainedPlan, compilation_artifact: retainedCompilation, resident_action_request_id: residentActionId }]
      : sql.includes("FROM helix_environment_action_workflow_events") && sql.includes("event_id=$3")
      ? pairedActionRows
      : sql.includes("FROM helix_environment_action_workflow_events")
      ? [{ event_id: actionEvent.event_id, event_payload: actionEvent, event_hash: environmentConnectorSha256(actionEvent), producer_epoch_ref: plan.identity.producer_epoch }]
      : sql.includes("FROM helix_environment_action_requests")
      ? [{ request_payload: action }] : sql.includes("WHERE event_id=$1") && referencedRows
      ? referencedRows : sql.includes("LIMIT 256") && anchorRows
      ? anchorRows : [{ event_id: "event:test", event_payload: payload, event_hash: hash }] });
    const input = { plan, compilation, checkpointId: "checkpoint:walk", actionRequestId: "action:test", eventId: "event:test", runId: "run:test" };
    expect(await readTemporalCheckpointEvidence({ query } as never, input)).toMatchObject({ event_id: "event:test", execution_authority: false });
    // Characterize the independent delivery-lane race: a newer critical
    // progress event can overtake its environment projection even when the
    // checkpoint itself has not changed. An empty critical lane alone does
    // not prove that the server has a coherent evidence pair.
    const pairedActionEvent = actionEvent;
    actionEvent = { ...actionEvent, event_id: "action-event:newer", sequence: 2 };
    await expect(readTemporalCheckpointEvidence({ query } as never, input))
      .rejects.toThrow("temporal_checkpoint_action_event_mismatch");
    pairedActionRows = [{ event_id: pairedActionEvent.event_id, event_payload: pairedActionEvent,
      event_hash: environmentConnectorSha256(pairedActionEvent), producer_epoch_ref: plan.identity.producer_epoch }];
    expect(await readTemporalCheckpointEvidence({ query } as never, input))
      .toMatchObject({ action_event_id: pairedActionEvent.event_id, execution_authority: false });
    const safeLatest = actionEvent;
    const appendedSettlement = { ...pairedActionEvent.measurements.checkpoint_settlements[0],
      checkpoint_id: "checkpoint:newer", node_id: "newer", tick_index: 13, monotonic_elapsed_ns: 700 };
    actionEvent = { ...safeLatest, measurements: { ...safeLatest.measurements,
      checkpoint_settlements: [...pairedActionEvent.measurements.checkpoint_settlements, appendedSettlement] } };
    expect(await readTemporalCheckpointEvidence({ query } as never, input))
      .toMatchObject({ action_event_id: pairedActionEvent.event_id, execution_authority: false });
    for (const changedLatest of [
      { ...safeLatest, manual_override_detected: true },
      { ...safeLatest, workflow_state: "canceled", controls_released: true },
      { ...safeLatest, measurements: { ...safeLatest.measurements, sequence_id: "different-plan" } },
      { ...safeLatest, measurements: { ...safeLatest.measurements, checkpoint_settlements: [] } },
      { ...safeLatest, measurements: { ...safeLatest.measurements,
        checkpoint_settlements: [{ ...pairedActionEvent.measurements.checkpoint_settlements[0], tick_index: 11 }, appendedSettlement] } },
      { ...safeLatest, sequence: 0 },
      { ...safeLatest, sequence: pairedActionEvent.sequence },
    ]) {
      actionEvent = changedLatest;
      await expect(readTemporalCheckpointEvidence({ query } as never, input))
        .rejects.toThrow("temporal_checkpoint_action_event_mismatch");
    }
    actionEvent = { ...safeLatest, clock: { ...clock, tick_index: 111 } };
    await expect(readTemporalCheckpointEvidence({ query } as never, input))
      .rejects.toThrow("temporal_checkpoint_clock_unmapped");
    actionEvent = safeLatest;
    pairedActionRows = [];
    payload = { ...event, attributes: { ...event.attributes, action_event_ref: actionEvent.event_id } };
    hash = environmentConnectorSha256(payload);
    expect(await readTemporalCheckpointEvidence({ query } as never, input))
      .toMatchObject({ action_event_id: "action-event:newer", execution_authority: false });
    // Matching references must not hide a stop or manual takeover.
    actionEvent = { ...actionEvent, manual_override_detected: true };
    await expect(readTemporalCheckpointEvidence({ query } as never, input))
      .rejects.toThrow("temporal_checkpoint_action_event_mismatch");
    actionEvent = pairedActionEvent;
    payload = event;
    hash = environmentConnectorSha256(payload);
    const anchorEvent = { ...event, event_id: "event:anchor", sequence: 0,
      attributes: { ...event.attributes, clock: { ...clock, observed_at: "2026-09-04T23:59:59Z" } },
      observed_at: "2026-09-04T23:59:59Z" };
    anchorRows = [{ event_id: anchorEvent.event_id, event_payload: anchorEvent, event_hash: environmentConnectorSha256(anchorEvent) }];
    expect(await readTemporalCheckpointEvidence({ query } as never, input)).toMatchObject({
      event_id: "event:test", observed_at: event.observed_at,
      checkpoint_anchor: { event_id: "event:anchor", observed_at: anchorEvent.observed_at, world_tick_index: 200 },
    });
    // A newer running progress envelope does not replace the submitted locator.
    referencedRows = anchorRows;
    const racedInput = { ...input, eventId: anchorEvent.event_id };
    expect(await readTemporalCheckpointEvidence({ query } as never, racedInput)).toMatchObject({
      event_id: "event:anchor", latest_event_id: "event:test",
      event_hash: environmentConnectorSha256(anchorEvent), latest_event_hash: hash,
    });
    referencedRows = [];
    await expect(readTemporalCheckpointEvidence({ query } as never, racedInput)).rejects.toThrow("event_stale");
    const changed = { ...anchorEvent, attributes: { ...anchorEvent.attributes,
      workflow_measurements: { ...anchorEvent.attributes.workflow_measurements,
        checkpoint_settlements: [{ checkpoint_id: "checkpoint:walk", node_id: "settled", tick_index: 11, monotonic_elapsed_ns: 500 }] } } };
    referencedRows = [{ event_id: changed.event_id, event_payload: changed, event_hash: environmentConnectorSha256(changed) }];
    await expect(readTemporalCheckpointEvidence({ query } as never, racedInput)).rejects.toThrow("anchor_settlement_changed");
    referencedRows = null;
    anchorRows[0].event_hash = "invalid";
    await expect(readTemporalCheckpointEvidence({ query } as never, input)).rejects.toThrow("anchor_hash_mismatch");
    const wrongAnchor = { ...anchorEvent, subject_ref: "wrong" };
    anchorRows = [{ event_id: wrongAnchor.event_id, event_payload: wrongAnchor, event_hash: environmentConnectorSha256(wrongAnchor) }];
    await expect(readTemporalCheckpointEvidence({ query } as never, input)).rejects.toThrow("anchor_identity_mismatch");
    for (const state of ["canceled", "succeeded"]) {
      const invalid = { ...anchorEvent, attributes: { ...anchorEvent.attributes,
        active_workflow: { ...anchorEvent.attributes.active_workflow, workflow_state: state } } };
      anchorRows = [{ event_id: invalid.event_id, event_payload: invalid, event_hash: environmentConnectorSha256(invalid) }];
      await expect(readTemporalCheckpointEvidence({ query } as never, input)).rejects.toThrow("anchor_state_invalid");
    }
    const futureClock = { ...anchorEvent, attributes: { ...anchorEvent.attributes, clock } };
    anchorRows = [{ event_id: futureClock.event_id, event_payload: futureClock, event_hash: environmentConnectorSha256(futureClock) }];
    await expect(readTemporalCheckpointEvidence({ query } as never, input)).rejects.toThrow("anchor_clock_invalid");
    anchorRows = null;
    residentActionId = null;
    await expect(readTemporalCheckpointEvidence({ query } as never, input)).rejects.toThrow("resident_association_mismatch");
    residentActionId = action.action_request_id;
    actionEvent = { ...actionEvent, measurements: { ...actionEvent.measurements, sequence_id: "other-plan" } };
    await expect(readTemporalCheckpointEvidence({ query } as never, input)).rejects.toThrow("native_plan_mismatch");
    actionEvent = { ...actionEvent, measurements: event.attributes.workflow_measurements };
    actionEvent = { ...actionEvent, action_request_id: "other" };
    await expect(readTemporalCheckpointEvidence({ query } as never, input)).rejects.toThrow("action_event_mismatch");
    actionEvent = { ...actionEvent, action_request_id: action.action_request_id };
    for (const changedClock of [{ ...clock, tick_index: 111 }, { ...clock, world_tick_index: 201 },
      { ...clock, monotonic: { ...clock.monotonic, origin_id: "other" } }]) {
      actionEvent = { ...actionEvent, clock: changedClock };
      await expect(readTemporalCheckpointEvidence({ query } as never, input)).rejects.toThrow("clock_unmapped");
    }
    actionEvent = { ...actionEvent, clock };
    await expect(readTemporalCheckpointEvidence({ query } as never, { ...input, eventId: "old" })).rejects.toThrow("event_stale");
    hash = "sha256:" + "0".repeat(64);
    await expect(readTemporalCheckpointEvidence({ query } as never, input)).rejects.toThrow("hash_mismatch");
    for (const field of ["room_id", "world_id", "source_id", "subject_ref", "producer_epoch_ref", "workflow_ref"] as const) {
      payload = { ...event, [field]: "other" };
      hash = environmentConnectorSha256(payload);
      await expect(readTemporalCheckpointEvidence({ query } as never, input)).rejects.toThrow("identity_or_state_mismatch");
    }
    retainedPlan = buildPlan({ plan_id: "plan:next", previous_plan_id: plan.plan_id, previous_plan_hash: plan.plan_hash });
    retainedCompilation = compileEnvironmentTimePlanToMinecraftFluidSequenceArtifact({ plan: retainedPlan,
      mutation_scope: fluidScope, resource_bindings: resourceBindings });
    payload = { ...event, attributes: { ...event.attributes, workflow_measurements: { ...event.attributes.workflow_measurements,
      sequence_id: retainedCompilation.arguments.sequence_id } } };
    hash = environmentConnectorSha256(payload);
    actionEvent = { ...actionEvent, measurements: payload.attributes.workflow_measurements };
    queriedValues.length = 0;
    const successorInput = { ...input, plan: retainedPlan, compilation: retainedCompilation, actionRequestId: "action:next" };
    expect(await readTemporalCheckpointEvidence({ query } as never, successorInput)).toMatchObject({
      action_request_id: "action:next", resident_action_request_id: "action:test", plan_id: "plan:next" });
    expect(queriedValues).toContainEqual(["action:test"]);
    expect(queriedValues).toContainEqual(["action:test", "workflow:test"]);
    actionEvent = { ...actionEvent, measurements: event.attributes.workflow_measurements };
    await expect(readTemporalCheckpointEvidence({ query } as never, successorInput)).rejects.toThrow("native_plan_mismatch");
  });

  it("hash-binds only explicit source checkpoints, not generated postconditions", () => {
    const plan = buildPlan();
    const serial = compileEnvironmentTimePlanToMinecraftFluidSequenceArtifact({ plan,
      mutation_scope: fluidScope, resource_bindings: resourceBindings });
    const reactive = compileEnvironmentTimePlanToMinecraftReactiveProgramArtifact({ plan,
      mutation_scope: fluidScope, resource_bindings: resourceBindings, lane_kind: "locomotion" });
    const expected = [{ source_node_id: "settled", source_checkpoint_id: "checkpoint:walk",
      native_node_id: "settled", native_checkpoint_id: "checkpoint:walk" }];
    expect(serial.source_checkpoint_bindings).toEqual(expected);
    expect(reactive.source_checkpoint_bindings).toEqual(expected);
    expect(serial.arguments.nodes.some(n => n.node_kind === "checkpoint" && n.node_id === "walk.post.0")).toBe(true);
    expect(serial.source_checkpoint_bindings.some(n => n.native_node_id === "walk.post.0")).toBe(false);
    const measured = { checkpoint_id: "checkpoint:walk", node_id: "settled", tick_index: 12, monotonic_elapsed_ns: 600_000_000 };
    const reactiveMeasured = { ...measured, lane_id: "environment_time" };
    const evidence = { checkpoint_settlements: [reactiveMeasured], satisfied_checkpoint_ids: ["checkpoint:walk"], tick_index: 12,
      condition_observations: [{ node_id: "settled", tick_index: 12, condition_kind: "player_grounded", satisfied: true }] };
    expect(reactiveCheckpointMeasurementsValid(reactive.arguments, evidence)).toBe(true);
    expect(reactiveCheckpointMeasurementsValid(reactive.arguments, { ...evidence, condition_observations: [] })).toBe(false);
    expect(reactiveCheckpointMeasurementsValid(reactive.arguments, { ...evidence,
      checkpoint_settlements: [{ ...reactiveMeasured, lane_id: "other" }] })).toBe(false);
    expect(reactiveCheckpointMeasurementsValid(reactive.arguments, { ...evidence,
      checkpoint_settlements: [reactiveMeasured, reactiveMeasured] })).toBe(false);
    const verify = (settlements: unknown, checkpointId = "checkpoint:walk") => verifyTemporalCheckpointSettlement({
      plan, compilation: serial, settlements, checkpointId });
    expect(verify([measured])).toMatchObject({ native_tick_index: 12, execution_authority: false });
    expect(() => verify([measured, measured])).toThrow("missing_or_duplicate");
    expect(() => verify([], "walk.post.0")).toThrow("source_mismatch");
    for (const tick of [-1, 80, 1.5, NaN]) {
      expect(() => verify([{ ...measured, tick_index: tick }])).toThrow("clock_invalid");
    }
    expect(() => verify([{ ...measured, node_id: "other" }])).toThrow("missing_or_duplicate");
  });

  it("compiles the same admitted action and graph outcomes into both existing engines", () => {
    const plan = buildPlan();
    const serial = compileEnvironmentTimePlanToMinecraftFluidSequence({
      plan,
      mutation_scope: fluidScope,
      resource_bindings: resourceBindings,
    });
    const reactive = compileEnvironmentTimePlanToMinecraftReactiveProgram({
      plan,
      mutation_scope: fluidScope,
      resource_bindings: resourceBindings,
      lane_kind: "locomotion",
    });
    const serialAction = serial.nodes.find((node) => node.node_kind === "workflow_action");
    const reactiveAction = reactive.lanes[0].nodes.find((node) => node.node_kind === "action");
    expect(serialAction).toMatchObject({ earliest_tick: 2, latest_start_tick: 10 });
    expect(reactiveAction).toMatchObject({ earliest_tick: 2, latest_start_tick: 10 });
    expect(serialAction && "action" in serialAction ? serialAction.action : null).toEqual(
      reactiveAction && "action" in reactiveAction ? reactiveAction.action : null,
    );
    expect(serial.start_node_id).toBe(reactive.lanes[0].start_node_id);
    expect(serial.nodes.some((node) => node.node_kind === "checkpoint" && node.checkpoint_id === "checkpoint:walk")).toBe(true);
    expect(reactive.lanes[0].nodes.some((node) => node.node_kind === "checkpoint" && node.checkpoint_id === "checkpoint:walk")).toBe(true);
    expect(compileEnvironmentTimePlanToMinecraftFluidSequenceArtifact({
      plan,
      mutation_scope: fluidScope,
      resource_bindings: resourceBindings,
    })).toMatchObject({
      source_plan_id: plan.plan_id,
      source_plan_hash: plan.plan_hash,
      source_goal_id: plan.identity.goal_id,
      execution_authority: false,
      answer_authority: false,
      terminal_eligible: false,
    });
  });

  it("fails closed on adapter, clock, capability, resource and condition mismatch", () => {
    const cases: Array<[HelixEnvironmentTemporalPlan, string]> = [
      [buildPlan({ adapter_id: "robot.sim" }), "adapter_mismatch"],
      [buildPlan({ clocks: { ...buildPlan().clocks, environment: { ...buildPlan().clocks.environment, kind: "frame" } } }), "clock_mismatch"],
    ];
    for (const [plan, code] of cases) {
      expect(() => compileEnvironmentTimePlanToMinecraftReactiveProgram({
        plan,
        mutation_scope: fluidScope,
        resource_bindings: resourceBindings,
        lane_kind: "locomotion",
      })).toThrowError(expect.objectContaining({ code }));
    }
    expect(() => compileEnvironmentTimePlanToMinecraftReactiveProgram({
      plan: buildPlan(),
      mutation_scope: fluidScope,
      lane_kind: "locomotion",
    })).toThrowError(expect.objectContaining({ code: "resource_mismatch" }));
  });

  it("does not approximate abort guards or serial-only timeout/cancel semantics", () => {
    const base = buildPlan();
    const nodes = structuredClone(base.nodes);
    const action = nodes[0];
    if (action.kind !== "action") throw new Error("fixture");
    action.abort_guards = [{
      kind: "adapter_condition",
      condition_id: "minecraft.health_at_least",
      arguments: { health: 5 },
    }];
    expect(() => compileEnvironmentTimePlanToMinecraftFluidSequence({
      plan: buildPlan({ nodes }),
      mutation_scope: fluidScope,
      resource_bindings: resourceBindings,
    })).toThrow(MinecraftEnvironmentTimeCompileError);

    const distinct = structuredClone(base.nodes);
    const distinctAction = distinct[0];
    if (distinctAction.kind !== "action") throw new Error("fixture");
    distinctAction.on_timeout_node_id = "timeout";
    distinct.push({ kind: "terminal", node_id: "timeout", outcome: "failed", reason_code: "timeout" });
    expect(() => compileEnvironmentTimePlanToMinecraftFluidSequence({
      plan: buildPlan({ nodes: distinct }),
      mutation_scope: fluidScope,
      resource_bindings: resourceBindings,
    })).toThrowError(expect.objectContaining({ code: "unsupported_semantics" }));
  });
});
