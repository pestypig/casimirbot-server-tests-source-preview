import { describe, expect, it, vi } from "vitest";
import * as roomDatabase from "../../../helix-ask/realtime-room/room-store/database";
import {
  HELIX_ENVIRONMENT_ACTION_REQUEST_SCHEMA,
  HELIX_ENVIRONMENT_ACTION_RESULT_SCHEMA,
  HELIX_ENVIRONMENT_CLOCK_SNAPSHOT_SCHEMA,
  helixEnvironmentActionRequestSchema,
  helixEnvironmentActionResultSchema,
} from "@shared/helix-environment-action";
import {
  canonicalizeEnvironmentActionResult,
  environmentActionWorkflowMeasurementsValid,
  environmentActionSequenceCheckpointMeasurementsValid,
  readRecordedWorkflowEvidence,
  submitEnvironmentActionWorkflowEvent,
  submitEnvironmentActionResult,
} from "../action-broker";
import { environmentConnectorSha256 } from "../../catalog";
import { minecraftPlayerCapabilityForActionKind } from "@shared/helix-minecraft-player-capabilities";
import { helixMinecraftFluidSequenceArgumentsSchema } from "@shared/helix-minecraft-fluid-sequence";

const startedAt = "2026-08-05T12:00:00.000Z";
const completedAt = "2026-08-05T12:00:05.000Z";

it("requires persistence even for an exact terminal-result retry with no SQL writes", async () => {
  const query = vi.fn(async (sql: string) => ({ rows: sql.includes("FROM helix_environment_action_requests")
    ? [{ ...request, status: "succeeded" }]
    : [{ result_payload: result, submitted_result_hash: environmentConnectorSha256(result),
      result_hash: environmentConnectorSha256(result), received_at: completedAt,
      provenance_valid: true, eligible_for_current_turn_reentry: false }] }));
  const transaction = vi.spyOn(roomDatabase, "withSharedRealtimeRoomTransaction")
    .mockImplementation(async callback => callback({ query } as never));
  try {
    const receipt = await submitEnvironmentActionResult({ claim: { authorityId: request.action_authority_id } as never, result });
    expect(receipt).toMatchObject({ replayed: true, observation: { terminal_eligible: false, eligible_for_current_turn_reentry: false } });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      requireLocalSnapshot: true,
      snapshotTables: ["helix_environment_action_results", "helix_environment_action_requests"],
    });
    expect(query.mock.calls.every(([sql]) => sql.trim().startsWith("SELECT"))).toBe(true);
  } finally { transaction.mockRestore(); }
});

const request = helixEnvironmentActionRequestSchema.parse({
  schema: HELIX_ENVIRONMENT_ACTION_REQUEST_SCHEMA,
  action_request_id: "environment_action_request:canonicalization",
  workflow_id: "environment_action_workflow:canonicalization",
  action_authority_id: "environment_action_authority:canonicalization",
  environment_binding_id: "environment_binding:canonicalization",
  room_id: "shared_realtime_room:canonicalization",
  source_id: "source:canonicalization",
  world_id: "minecraft:local:canonicalization",
  participant_id: "room_participant:canonicalization",
  subject_binding_id: "environment_subject_binding:canonicalization",
  subject_native_id: "player-uuid-canonicalization",
  run_id: "helix_agent_run:canonicalization",
  turn_id: "ask:canonicalization",
  provider_execution_id: "provider_execution:canonicalization",
  tool_call_id: "tool_call:canonicalization",
  catalog_snapshot_id: "environment_catalog:canonicalization",
  capability_id: "com.casimirbot.minecraft.player.navigate",
  capability_version: 1,
  action_kind: "navigate_to",
  effect_class: "continuous_control",
  workflow_mode: "long_running",
  requested_control_engine: "native_fabric",
  arguments: {
    action_kind: "navigate_to",
    destination: { x: 8, y: 64, z: 3 },
    arrival_radius: 1,
    allow_sprint: false,
    allow_dig: false,
    allow_place: false,
    engine_preference: "native_fabric",
  },
  preconditions: [],
  postconditions: [
    {
      condition_id: "postcondition:destination",
      condition_kind: "minecraft.player.position_within_radius",
      required: true,
      parameters: { x: 8, y: 64, z: 3, radius: 1 },
    },
  ],
  idempotency_key: "canonicalization-action-result",
  confirmation_state: "approved",
  approval_ref: "environment_action_approval:canonicalization",
  created_at: startedAt,
  deadline_at: "2026-08-05T12:01:00.000Z",
  constraints: {
    max_duration_ms: 60_000,
    max_distance_blocks: 128,
    max_block_mutations: 0,
    max_inventory_transfers: 0,
    manual_override_policy: "cancel",
    require_postcondition_verification: true,
    world_mutation_allowed: false,
    combat_allowed: false,
    host_access_allowed: false,
    automatic_replay_allowed: false,
  },
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
});

const result = helixEnvironmentActionResultSchema.parse({
  schema: HELIX_ENVIRONMENT_ACTION_RESULT_SCHEMA,
  action_request_id: request.action_request_id,
  workflow_id: request.workflow_id,
  action_execution_id: "environment_action_execution:canonicalization",
  capability_id: request.capability_id,
  capability_version: request.capability_version,
  action_kind: request.action_kind,
  outcome: "succeeded",
  summary: "The player reached the destination.",
  control_engine: "native_fabric",
  started_at: startedAt,
  completed_at: completedAt,
  progress_event_refs: ["environment_action_event:canonicalization"],
  postconditions: [
    {
      condition_id: "postcondition:destination",
      condition_kind: "minecraft.player.position_within_radius",
      required: true,
      status: "satisfied",
      summary: "The measured player position is within one block.",
      evidence_refs: ["environment_action_evidence:position-after"],
      checked_at: completedAt,
    },
  ],
  evidence_refs: ["environment_action_evidence:position-after"],
  side_effects_performed: true,
  player_motion_performed: true,
  player_interaction_performed: false,
  inventory_mutation_performed: false,
  world_mutation_performed: false,
  manual_override_detected: false,
  controls_released: true,
  host_access_performed: false,
  automatic_replay_performed: false,
  model_invoked: false,
  assistant_answer: false,
  raw_content_included: false,
});

describe("environment action result canonicalization", () => {
  const checkpointSequenceRequest = {
    ...request,
    action_kind: "execute_sequence",
    arguments: {
      action_kind: "execute_sequence",
      sequence_schema: "helix.minecraft.player_sequence.v1",
      sequence_id: "sequence:checkpoint",
      ruleset: "survival_tas",
      execution_plane: "player_embodiment",
      scheduler_engine: "native_fabric",
      optimization: { primary: "minimize_world_ticks", record_wall_clock: true, stop_on_first_verified_success: true },
      start_node_id: "node:checkpoint",
      max_total_ticks: 40,
      required_checkpoint_ids: ["checkpoint:grounded"],
      mutation_scope: { world_mutation_allowed: false, max_block_mutations: 0, max_inventory_transfers: 0, allowed_block_ids: [], allowed_regions: [], combat_allowed: false },
      nodes: [
        { node_id: "node:checkpoint", node_kind: "checkpoint", earliest_tick: 0, checkpoint_id: "checkpoint:grounded", condition: { condition_kind: "player_grounded", expected: true }, wait_up_to_ticks: 10, on_satisfied: "node:success", on_timeout: "node:failed" },
        { node_id: "node:success", node_kind: "terminal", terminal_outcome: "succeeded", reason_code: "complete" },
        { node_id: "node:failed", node_kind: "terminal", terminal_outcome: "failed", reason_code: "failed" },
      ],
    },
  };
  const checkpointSettlement = { checkpoint_id: "checkpoint:grounded", node_id: "node:checkpoint", tick_index: 3, scheduler_ticks_elapsed: 4, monotonic_elapsed_ns: 150_000_000 };
  const checkpointMeasurements = {
    sequence_completed: true, sequence_id: "sequence:checkpoint", ruleset: "survival_tas", executed_node_count: 2,
    required_checkpoints_satisfied: 1, satisfied_checkpoint_ids: ["checkpoint:grounded"], scheduler_ticks_elapsed: 4,
    condition_observation_count: 1,
    condition_observations: [{ node_id: "node:checkpoint", tick_index: 3, condition_kind: "player_grounded", satisfied: true }],
    checkpoint_settlements: [checkpointSettlement],
  };
  const validCheckpointMeasurements = (measurements: Record<string, unknown>) => environmentActionWorkflowMeasurementsValid({
    request: checkpointSequenceRequest,
    result: { ...result, action_kind: "execute_sequence", duration_ticks: 4 },
    measurements,
  });

  it("validates measured checkpoint timing against the admitted sequence", () => {
    expect(validCheckpointMeasurements(checkpointMeasurements)).toBe(true);
  });

  it("retains legacy finite-result compatibility without inventing timing", () => {
    const { checkpoint_settlements: omitted, ...legacy } = checkpointMeasurements;
    expect(omitted).toHaveLength(1);
    expect(validCheckpointMeasurements(legacy)).toBe(true);
    expect(legacy).not.toHaveProperty("checkpoint_settlements");
  });

  it("validates partial checkpoint evidence without demanding future checkpoints", () => {
    const sequence = helixMinecraftFluidSequenceArgumentsSchema.parse(checkpointSequenceRequest.arguments);
    const partial = { ...checkpointMeasurements, required_checkpoints_satisfied: 0, satisfied_checkpoint_ids: [], checkpoint_settlements: [], condition_observations: [] };
    expect(environmentActionSequenceCheckpointMeasurementsValid({ sequence, measurements: partial, require_complete: false })).toBe(true);
    expect(environmentActionSequenceCheckpointMeasurementsValid({ sequence, measurements: partial, require_complete: true })).toBe(false);
    expect(environmentActionSequenceCheckpointMeasurementsValid({ sequence, measurements: { ...checkpointMeasurements, checkpoint_settlements: [{ ...checkpointSettlement, node_id: "node:forged" }] }, require_complete: false })).toBe(false);
  });

  it("retains checkpoint timing when a sequence hits its terminal tick ceiling", () => {
    const sequence = helixMinecraftFluidSequenceArgumentsSchema.parse(checkpointSequenceRequest.arguments);
    const exhausted = { ...checkpointMeasurements, scheduler_ticks_elapsed: sequence.max_total_ticks + 1 };
    expect(environmentActionSequenceCheckpointMeasurementsValid({ sequence, measurements: exhausted, require_complete: false })).toBe(true);
    expect(environmentActionSequenceCheckpointMeasurementsValid({ sequence, measurements: exhausted, require_complete: true })).toBe(false);
  });

  it.each([true, false])("checks checkpoint evidence before production event persistence (valid=%s)", async (valid) => {
    const statements: string[] = [];
    const query = vi.fn(async (sql: string) => {
      statements.push(sql);
      if (sql.includes("FROM helix_environment_action_requests")) return { rows: [{ ...checkpointSequenceRequest, status: "running", connector_manifest_id: "manifest:test", request_payload: checkpointSequenceRequest }] };
      if (sql.includes("FROM helix_environment_action_connector_manifests")) return { rows: [{ manifest_id: "manifest:test", producer_epoch_ref: "epoch:test" }] };
      return { rows: [] };
    });
    const transaction = vi.spyOn(roomDatabase, "withSharedRealtimeRoomTransaction")
      .mockImplementation(async (callback) => callback({ query } as never));
    try {
      const event = {
        schema: "helix.environment_action.workflow_event.v1", event_id: "event:checkpoint",
        action_request_id: request.action_request_id, workflow_id: request.workflow_id, sequence: 0,
        event_type: "workflow.progress", workflow_state: "running", progress_fraction: 0.5,
        summary: "Checkpoint observed.", control_engine: "native_fabric",
        measurements: { ...checkpointMeasurements, checkpoint_settlements: [{ ...checkpointSettlement, checkpoint_id: valid ? checkpointSettlement.checkpoint_id : "checkpoint:forged" }] },
        evidence_refs: [], manual_override_detected: false, controls_released: false, created_at: completedAt,
        content_role: "environment_action_event_not_assistant_answer", answer_authority: false,
        assistant_answer: false, terminal_eligible: false, raw_content_included: false,
      };
      const pending = submitEnvironmentActionWorkflowEvent({ claim: { authorityId: request.action_authority_id } as never, event });
      expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
        requireLocalSnapshot: true,
        snapshotTables: ["helix_environment_action_workflow_events", "helix_environment_action_requests"],
      });
      if (valid) await expect(pending).resolves.toMatchObject({ replayed: false });
      else await expect(pending).rejects.toMatchObject({ code: "action_event_invalid" });
      expect(statements.some((sql) => sql.includes("INSERT INTO helix_environment_action_workflow_events"))).toBe(valid);
    } finally {
      transaction.mockRestore();
    }
  });

  it.each([
    { checkpoint_id: "checkpoint:forged" },
    { node_id: "node:success" },
    { tick_index: 4 },
    { tick_index: -1 },
    { scheduler_ticks_elapsed: 5 },
    { monotonic_elapsed_ns: -1 },
    { monotonic_elapsed_ns: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects malformed checkpoint settlement %j", (patch) => {
    expect(validCheckpointMeasurements({ ...checkpointMeasurements, checkpoint_settlements: [{ ...checkpointSettlement, ...patch }] })).toBe(false);
  });

  it("rejects duplicate, missing and unsupported settlement evidence", () => {
    for (const settlements of [[], [checkpointSettlement, checkpointSettlement], null]) {
      expect(validCheckpointMeasurements({ ...checkpointMeasurements, checkpoint_settlements: settlements })).toBe(false);
    }
    expect(validCheckpointMeasurements({ ...checkpointMeasurements, condition_observations: [{ ...checkpointMeasurements.condition_observations[0], satisfied: false }] })).toBe(false);
  });

  it("admits only bounded typed manual-override causes", () => {
    const canceled = helixEnvironmentActionResultSchema.parse({
      ...result,
      outcome: "request_canceled",
      summary: "Manual player input canceled the workflow (reason: screen_open).",
      postconditions: result.postconditions.map((condition) => ({
        ...condition,
        status: "not_checked" as const,
      })),
      side_effects_performed: false,
      player_motion_performed: false,
      manual_override_detected: true,
      manual_override_reason: "screen_open",
    });

    expect(canceled.manual_override_reason).toBe("screen_open");
    expect(() => helixEnvironmentActionResultSchema.parse({
      ...canceled,
      manual_override_reason: "untrusted_free_text",
    })).toThrow();
  });

  const measurementScenarios = [
    {
      actionKind: "navigate_to",
      arguments: {
        action_kind: "navigate_to",
        destination: { x: 8, y: 64, z: 3 },
        arrival_radius: 1,
        allow_sprint: false,
        allow_dig: false,
        allow_place: false,
        engine_preference: "native_fabric",
      },
      measurements: { distance_blocks: 0.5, arrival_radius: 1 },
    },
    {
      actionKind: "look_at",
      arguments: {
        action_kind: "look_at",
        target: { target_kind: "current_focus" },
        max_turn_degrees_per_tick: 15,
      },
      measurements: {
        target_kind: "current_focus",
        view_retained: true,
        final_yaw: 15,
        final_pitch: -4,
      },
    },
    {
      actionKind: "look_at",
      arguments: {
        action_kind: "look_at",
        target: {
          target_kind: "relative_rotation",
          yaw_delta_degrees: 20,
          pitch_delta_degrees: 5,
        },
        max_turn_degrees_per_tick: 15,
      },
      measurements: {
        target_kind: "relative_rotation",
        requested_yaw_delta_degrees: 20,
        requested_pitch_delta_degrees: 5,
        initial_yaw: 10,
        initial_pitch: -5,
        target_yaw: 30,
        target_pitch: 0,
        final_yaw: 30,
        final_pitch: 0,
        applied_yaw_delta_degrees: 20,
        applied_pitch_delta_degrees: 5,
        yaw_error_degrees: 0,
        pitch_error_degrees: 0,
      },
    },
    {
      actionKind: "walk",
      arguments: { action_kind: "walk", direction: "forward", duration_ms: 500, sprint: false },
      measurements: { distance_blocks: 1.25 },
    },
    {
      actionKind: "jump",
      arguments: { action_kind: "jump", count: 2 },
      measurements: { confirmed_jumps: 2 },
    },
    {
      actionKind: "interact",
      arguments: {
        action_kind: "interact",
        target: "looked_at_block",
        hand: "main_hand",
        interaction: "use",
      },
      measurements: {
        interaction_accepted: true,
        target: "looked_at_block",
        hand: "main_hand",
        interaction: "use",
      },
    },
    {
      actionKind: "attack",
      arguments: {
        action_kind: "attack",
        target_ref: "target:1234567890abcdef1234567890abcdef12345678",
        target_entity_type_id: "minecraft:zombie",
        target_classification: "hostile",
        max_acquisition_distance: 4.5,
        require_line_of_sight: true,
        minimum_attack_cooldown: 0.9,
        max_attack_pulses: 16,
        max_duration_ms: 20_000,
        stop_below_health: 6,
        friendly_fire: false,
      },
      measurements: {
        target_ref: "target:1234567890abcdef1234567890abcdef12345678",
        target_entity_type_id: "minecraft:zombie",
        target_classification: "hostile",
        friendly_fire: false,
        attack_pulses: 4,
        confirmed_hurt_or_health_transitions: 4,
        rejected_attack_pulses: 0,
        target_defeated: true,
        safety_interrupted: false,
      },
    },
    {
      actionKind: "combat_guard",
      arguments: {
        action_kind: "combat_guard",
        hostile_entity_type_ids: ["minecraft:skeleton"],
        max_acquisition_distance: 24,
        require_line_of_sight: true,
        minimum_attack_cooldown: 0.9,
        max_attack_pulses: 48,
        max_target_switches: 4,
        target_commit_ticks: 10,
        retreat_start_distance: 2.5,
        retreat_stop_distance: 4,
        retreat_when_hostile_count_at_least: 2,
        max_duration_ms: 45_000,
        stop_below_health: 12,
        friendly_fire: false,
        approach_policy: "local_reroute_bounded",
        max_approach_ticks: 500,
        cover_policy: "lateral_bounded",
        max_cover_ticks: 160,
        projectile_response: "shield_or_sidestep",
        projectile_evasion_horizon_ticks: 8,
        max_evasion_ticks: 240,
        shield_hand: "off_hand",
        max_shield_hold_ticks: 240,
      },
      measurements: {
        reason_code: "hostiles_cleared",
        target_classification: "hostile",
        selected_target_ref: `target:${"a".repeat(32)}`,
        friendly_fire: false,
        attack_pulses: 4,
        target_switches: 0,
        peak_hostile_count: 1,
        eligible_hostile_count: 0,
        player_health: 20,
        approach_policy: "local_reroute_bounded",
        approach_ticks: 53,
        cover_policy: "lateral_bounded",
        cover_ticks: 0,
        projectile_response: "shield_or_sidestep",
        evasion_ticks: 0,
        shield_hand: "off_hand",
        shield_ticks: 0,
        world_mutations_performed: 0,
        inventory_mutations_performed: 0,
      },
    },
    {
      actionKind: "hotbar_select",
      arguments: { action_kind: "hotbar_select", slot: 2 },
      measurements: { selection_matches: true, selected_slot: 2 },
    },
    {
      actionKind: "equip",
      arguments: { action_kind: "equip", item_id: "minecraft:shield", destination: "off_hand" },
      measurements: { equipment_matches: true, item_id: "minecraft:shield", destination: "off_hand" },
    },
    {
      actionKind: "follow",
      arguments: {
        action_kind: "follow",
        subject_ref: "environment_subject:friend",
        distance: 3,
        max_duration_ms: 1_000,
        stop_below_health: 6,
      },
      measurements: { target_present: true, duration_ticks: 20 },
    },
    {
      actionKind: "collect",
      arguments: { action_kind: "collect", item_or_block_id: "minecraft:apple", count: 2, search_radius: 8 },
      measurements: { item_id: "minecraft:apple", collected_count: 2 },
    },
    {
      actionKind: "mine",
      arguments: { action_kind: "mine", block_id: "minecraft:stone", count: 2, search_radius: 8 },
      measurements: { block_id: "minecraft:stone", removed_count: 2, world_mutations_performed: 2 },
    },
    {
      actionKind: "place",
      arguments: {
        action_kind: "place",
        block_id: "minecraft:cobblestone",
        positions: [{ x: 1, y: 64, z: 1 }, { x: 1, y: 65, z: 1 }],
      },
      measurements: { block_id: "minecraft:cobblestone", verified_positions: 2, world_mutations_performed: 2 },
    },
    {
      actionKind: "craft",
      arguments: { action_kind: "craft", output_item_id: "minecraft:stick", count: 4 },
      measurements: { output_item_id: "minecraft:stick", produced_count: 4 },
    },
    {
      actionKind: "consume",
      arguments: {
        action_kind: "consume",
        item_id: "minecraft:mushroom_stew",
        count: 1,
        hand: "main_hand",
        max_duration_ms: 8_000,
        stop_below_health: 8,
        minimum_food_gain: 6,
        expected_remainder_item_id: "minecraft:bowl",
      },
      measurements: {
        reason_code: "consume_postconditions_satisfied",
        item_id: "minecraft:mushroom_stew",
        consumed_count: 1,
        hand: "main_hand",
        food_before: 8,
        food_after: 14,
        food_gain: 6,
        health_before: 12,
        health_after: 12,
        health_delta: 0,
        use_ticks: 33,
        expected_remainder_item_id: "minecraft:bowl",
        remainder_item_delta: 1,
        world_mutations_performed: 0,
      },
    },
    {
      actionKind: "inventory_transfer",
      arguments: {
        action_kind: "inventory_transfer",
        direction: "withdraw",
        item_id: "minecraft:apple",
        count: 2,
        container_target: "current_open_container",
      },
      measurements: { item_id: "minecraft:apple", direction: "withdraw", transferred_count: 2 },
    },
  ] as const;

  for (const scenario of measurementScenarios) {
    it(`requires action-specific terminal measurements for ${scenario.actionKind}`, () => {
      const motionKinds = new Set([
        "navigate_to", "look_at", "walk", "jump", "combat_guard", "follow", "collect", "mine", "place",
      ]);
      const interactionKinds = new Set([
        "interact", "attack", "combat_guard", "mine", "place", "craft", "consume", "inventory_transfer",
      ]);
      const inventoryKinds = new Set([
        "hotbar_select", "equip", "collect", "mine", "place", "craft", "consume", "inventory_transfer",
      ]);
      const worldMutationKinds = new Set(["mine", "place"]);
      const matrixRequest = helixEnvironmentActionRequestSchema.parse({
        ...request,
        action_request_id: `environment_action_request:matrix:${scenario.actionKind}`,
        workflow_id: `environment_action_workflow:matrix:${scenario.actionKind}`,
        capability_id: minecraftPlayerCapabilityForActionKind(scenario.actionKind),
        action_kind: scenario.actionKind,
        effect_class: worldMutationKinds.has(scenario.actionKind)
          ? "world_mutation"
          : motionKinds.has(scenario.actionKind)
            ? "player_motion"
            : inventoryKinds.has(scenario.actionKind)
              ? "player_inventory"
              : "player_interaction",
        arguments: scenario.arguments,
        postconditions: [{
          condition_id: `postcondition:matrix:${scenario.actionKind}`,
          condition_kind: `minecraft.matrix.${scenario.actionKind}`,
          required: true,
          parameters: {},
        }],
        idempotency_key: `canonicalization-matrix-${scenario.actionKind}`,
        constraints: {
          ...request.constraints,
          max_block_mutations: worldMutationKinds.has(scenario.actionKind) ? 100 : 0,
          max_inventory_transfers: inventoryKinds.has(scenario.actionKind) ? 100 : 0,
          world_mutation_allowed: worldMutationKinds.has(scenario.actionKind),
        },
      });
      const matrixResult = helixEnvironmentActionResultSchema.parse({
        ...result,
        action_request_id: matrixRequest.action_request_id,
        workflow_id: matrixRequest.workflow_id,
        capability_id: matrixRequest.capability_id,
        action_kind: scenario.actionKind,
        postconditions: [{
          condition_id: `postcondition:matrix:${scenario.actionKind}`,
          condition_kind: `minecraft.matrix.${scenario.actionKind}`,
          required: true,
          status: "satisfied",
          summary: "The action-specific matrix postcondition was measured.",
          evidence_refs: [`environment_action_event:matrix:${scenario.actionKind}`],
          checked_at: completedAt,
        }],
        evidence_refs: [`environment_action_event:matrix:${scenario.actionKind}`],
        side_effects_performed: true,
        player_motion_performed: motionKinds.has(scenario.actionKind),
        player_interaction_performed: interactionKinds.has(scenario.actionKind),
        inventory_mutation_performed: inventoryKinds.has(scenario.actionKind),
        world_mutation_performed: worldMutationKinds.has(scenario.actionKind),
        ...(scenario.actionKind === "combat_guard" ? {
          started_clock: {
            schema: HELIX_ENVIRONMENT_CLOCK_SNAPSHOT_SCHEMA,
            clock_id: "minecraft_client_tick_clock:combat-guard",
            clock_kind: "minecraft_game_tick",
            tick_rate_hz: 20,
            tick_index: 1_000,
            world_tick_index: 50_000,
            synchronization: "server_synchronized",
            observed_at: startedAt,
          },
          completed_clock: {
            schema: HELIX_ENVIRONMENT_CLOCK_SNAPSHOT_SCHEMA,
            clock_id: "minecraft_client_tick_clock:combat-guard",
            clock_kind: "minecraft_game_tick",
            tick_rate_hz: 20,
            tick_index: 1_090,
            world_tick_index: 50_090,
            synchronization: "server_synchronized",
            observed_at: completedAt,
          },
          duration_ticks: 90,
        } : {}),
      });
      expect(environmentActionWorkflowMeasurementsValid({
        request: matrixRequest,
        result: matrixResult,
        measurements: scenario.measurements,
      })).toBe(true);
      expect(environmentActionWorkflowMeasurementsValid({
        request: matrixRequest,
        result: matrixResult,
        measurements: {},
      })).toBe(false);
    });
  }

  it("requires exact measured proof that the bounded resident guardian was armed", () => {
    const guardianArguments = {
      action_kind: "arm_viability_guardian" as const,
      profile_id: "resident.minecraft.fabric-guardian.v1" as const,
      duration_ticks: 2_400,
      minimum_air: 80,
      dangerous_vertical_velocity: -0.72,
      maximum_swim_ticks: 200,
      maximum_observation_age_ticks: 1,
      response_repertoire: [
        "swim_up",
        "release_controls",
        "request_semantic_replan",
      ] as const,
    };
    const guardianRequest = helixEnvironmentActionRequestSchema.parse({
      ...request,
      action_request_id: "environment_action_request:resident-guardian",
      workflow_id: "environment_action_workflow:resident-guardian",
      capability_id: "com.casimirbot.minecraft.player.viability_guardian.arm",
      action_kind: "arm_viability_guardian",
      effect_class: "continuous_control",
      workflow_mode: "single_action",
      arguments: guardianArguments,
      postconditions: [{
        condition_id: "postcondition:resident-guardian",
        condition_kind: "minecraft.player.viability_guardian_armed",
        required: true,
        parameters: {
          profile_id: guardianArguments.profile_id,
          duration_ticks: guardianArguments.duration_ticks,
        },
      }],
      idempotency_key: "canonicalization-resident-guardian",
    });
    const guardianResult = helixEnvironmentActionResultSchema.parse({
      ...result,
      action_request_id: guardianRequest.action_request_id,
      workflow_id: guardianRequest.workflow_id,
      capability_id: guardianRequest.capability_id,
      action_kind: guardianRequest.action_kind,
      postconditions: [{
        condition_id: "postcondition:resident-guardian",
        condition_kind: "minecraft.player.viability_guardian_armed",
        required: true,
        status: "satisfied",
        summary: "The resident guardian profile was armed.",
        evidence_refs: ["environment_action_event:resident-guardian"],
        checked_at: completedAt,
      }],
      evidence_refs: ["environment_action_event:resident-guardian"],
      side_effects_performed: false,
      player_motion_performed: false,
      player_interaction_performed: false,
    });
    const measurements = {
      guardian_armed: true,
      guardian_profile_id: guardianArguments.profile_id,
      guardian_duration_ticks: guardianArguments.duration_ticks,
      controls_released: true,
    };

    expect(environmentActionWorkflowMeasurementsValid({
      request: guardianRequest,
      result: guardianResult,
      measurements,
    })).toBe(true);
    expect(environmentActionWorkflowMeasurementsValid({
      request: guardianRequest,
      result: guardianResult,
      measurements: { ...measurements, guardian_duration_ticks: 200 },
    })).toBe(false);
    expect(environmentActionWorkflowMeasurementsValid({
      request: guardianRequest,
      result: guardianResult,
      measurements: { ...measurements, controls_released: false },
    })).toBe(false);
  });

  it("requires exact measured proof that the resident guardian was disarmed", () => {
    const disarmRequest = helixEnvironmentActionRequestSchema.parse({
      ...request,
      action_request_id: "environment_action_request:resident-disarm",
      workflow_id: "environment_action_workflow:resident-disarm",
      capability_id:
        "com.casimirbot.minecraft.player.viability_guardian.disarm",
      action_kind: "disarm_viability_guardian",
      effect_class: "continuous_control",
      workflow_mode: "single_action",
      arguments: {
        action_kind: "disarm_viability_guardian",
        profile_id: "resident.minecraft.fabric-guardian.v1",
      },
      postconditions: [{
        condition_id: "postcondition:resident-disarm",
        condition_kind: "minecraft.player.viability_guardian_disarmed",
        required: true,
        parameters: {
          profile_id: "resident.minecraft.fabric-guardian.v1",
        },
      }],
      idempotency_key: "canonicalization-resident-disarm",
    });
    const disarmResult = helixEnvironmentActionResultSchema.parse({
      ...result,
      action_request_id: disarmRequest.action_request_id,
      workflow_id: disarmRequest.workflow_id,
      capability_id: disarmRequest.capability_id,
      action_kind: disarmRequest.action_kind,
      postconditions: [{
        condition_id: "postcondition:resident-disarm",
        condition_kind: "minecraft.player.viability_guardian_disarmed",
        required: true,
        status: "satisfied",
        summary: "The resident guardian profile was disarmed.",
        evidence_refs: ["environment_action_event:resident-disarm"],
        checked_at: completedAt,
      }],
      evidence_refs: ["environment_action_event:resident-disarm"],
      side_effects_performed: false,
      player_motion_performed: false,
      player_interaction_performed: false,
    });
    const measurements = {
      guardian_armed: false,
      guardian_profile_id: "resident.minecraft.fabric-guardian.v1",
      controls_released: true,
    };

    expect(environmentActionWorkflowMeasurementsValid({
      request: disarmRequest,
      result: disarmResult,
      measurements,
    })).toBe(true);
    expect(environmentActionWorkflowMeasurementsValid({
      request: disarmRequest,
      result: disarmResult,
      measurements: { ...measurements, controls_released: false },
    })).toBe(false);
  });

  it("requires action-specific measured proof for a successful workflow", () => {
    expect(environmentActionWorkflowMeasurementsValid({
      request,
      result,
      measurements: {
        distance_blocks: 0.75,
        arrival_radius: 1,
        final_x: 7.5,
        final_y: 64,
        final_z: 3,
      },
    })).toBe(true);
    expect(environmentActionWorkflowMeasurementsValid({
      request,
      result,
      measurements: {},
    })).toBe(false);
  });

  it("requires measured path distance for a budgeted navigation success", () => {
    const budgetedRequest = helixEnvironmentActionRequestSchema.parse({
      ...request,
      arguments: {
        ...request.arguments,
        max_duration_ms: 3_000,
        max_distance_blocks: 2.5,
      },
      constraints: {
        ...request.constraints,
        max_duration_ms: 3_000,
        max_distance_blocks: 2.5,
      },
    });
    const measurements = {
      distance_blocks: 0.75,
      arrival_radius: 1,
      final_x: 7.5,
      final_y: 64,
      final_z: 3,
      navigation_path_distance_blocks: 2,
      max_distance_blocks: 2.5,
    };
    expect(environmentActionWorkflowMeasurementsValid({
      request: budgetedRequest, result, measurements,
    })).toBe(true);
    expect(environmentActionWorkflowMeasurementsValid({
      request: helixEnvironmentActionRequestSchema.parse({
        ...budgetedRequest,
        constraints: { ...budgetedRequest.constraints, max_distance_blocks: 3 },
      }), result, measurements,
    })).toBe(false);
    for (const invalidMeasurements of [
      { ...measurements, navigation_path_distance_blocks: undefined },
      { ...measurements, navigation_path_distance_blocks: 2.6 },
      { ...measurements, max_distance_blocks: 3 },
    ]) {
      expect(environmentActionWorkflowMeasurementsValid({
        request: budgetedRequest, result, measurements: invalidMeasurements,
      })).toBe(false);
    }
  });

  it("accepts an all-required guardian settled by its exact admitted interrupt", () => {
    const guardianArguments = {
      action_kind: "execute_reactive_program" as const,
      program_schema: "helix.minecraft.reactive_program.v1" as const,
      program_id: "program:handled-health-interrupt",
      ruleset: "survival_tas" as const,
      execution_plane: "player_embodiment" as const,
      scheduler_engine: "native_fabric_concurrent" as const,
      max_total_ticks: 200,
      completion_policy: {
        mode: "all_required" as const,
        cancel_remaining_on_settle: true as const,
      },
      mutation_scope: {
        world_mutation_allowed: false,
        max_block_mutations: 0,
        max_inventory_transfers: 0,
        allowed_block_ids: [],
        allowed_regions: [],
        combat_allowed: false,
      },
      lanes: [{
        lane_id: "lane:camera",
        lane_kind: "camera" as const,
        priority: 200,
        required: true,
        activation: "immediate" as const,
        resource_ceiling: ["camera" as const],
        start_node_id: "node:camera",
        nodes: [{
          node_id: "node:camera",
          node_kind: "action" as const,
          earliest_tick: 0,
          timeout_ticks: 200,
          action: {
            action_kind: "look_at" as const,
            target: { target_kind: "current_focus" as const },
            max_turn_degrees_per_tick: 10,
          },
          on_success: "node:camera:done",
          on_failure: "node:camera:failed",
          on_timeout: "node:camera:failed",
        }, {
          node_id: "node:camera:done",
          node_kind: "terminal" as const,
          terminal_outcome: "succeeded" as const,
          reason_code: "camera_complete",
        }, {
          node_id: "node:camera:failed",
          node_kind: "terminal" as const,
          terminal_outcome: "canceled" as const,
          reason_code: "camera_not_completed",
        }],
      }, {
        lane_id: "lane:safety",
        lane_kind: "safety" as const,
        priority: 255,
        required: false,
        activation: "interrupt_only" as const,
        resource_ceiling: ["safety" as const],
        start_node_id: "node:safety",
        nodes: [{
          node_id: "node:safety",
          node_kind: "terminal" as const,
          terminal_outcome: "canceled" as const,
          reason_code: "low_health_stop",
        }],
      }],
      races: [],
      interrupts: [{
        interrupt_id: "interrupt:low-health",
        priority: 255,
        condition: { condition_kind: "health_at_least" as const, health: 19 },
        trigger_when: "not_satisfied" as const,
        debounce_ticks: 1,
        activate_lane_id: "lane:safety",
        cancel_lane_ids: ["lane:camera"],
        max_activations: 1 as const,
      }],
    };
    const guardianRequest = helixEnvironmentActionRequestSchema.parse({
      ...request,
      action_request_id: "environment_action_request:handled-interrupt",
      workflow_id: "environment_action_workflow:handled-interrupt",
      capability_id: "com.casimirbot.minecraft.player.guardian.execute",
      action_kind: "execute_reactive_program",
      effect_class: "continuous_control",
      arguments: guardianArguments,
      idempotency_key: "canonicalization-handled-interrupt",
    });
    const guardianResult = helixEnvironmentActionResultSchema.parse({
      ...result,
      action_request_id: guardianRequest.action_request_id,
      workflow_id: guardianRequest.workflow_id,
      capability_id: guardianRequest.capability_id,
      action_kind: guardianRequest.action_kind,
      side_effects_performed: false,
      player_motion_performed: false,
      player_interaction_performed: false,
      inventory_mutation_performed: false,
      world_mutation_performed: false,
      started_clock: {
        schema: HELIX_ENVIRONMENT_CLOCK_SNAPSHOT_SCHEMA,
        clock_id: "minecraft_client_tick_clock:handled-interrupt",
        clock_kind: "minecraft_game_tick",
        tick_rate_hz: 20,
        tick_index: 1_000,
        world_tick_index: 50_000,
        synchronization: "server_synchronized",
        observed_at: startedAt,
      },
      completed_clock: {
        schema: HELIX_ENVIRONMENT_CLOCK_SNAPSHOT_SCHEMA,
        clock_id: "minecraft_client_tick_clock:handled-interrupt",
        clock_kind: "minecraft_game_tick",
        tick_rate_hz: 20,
        tick_index: 1_110,
        world_tick_index: 50_110,
        synchronization: "server_synchronized",
        observed_at: completedAt,
      },
      duration_ticks: 110,
    });
    const measurements = {
      program_schema: "helix.minecraft.reactive_program.v1",
      program_id: guardianArguments.program_id,
      reactive_program_completed: true,
      reason_code: "reactive_program_interrupted",
      settled_interrupt_id: "interrupt:low-health",
      tick_index: 110,
      active_lane_count: 0,
      lanes: [{
        lane_id: "lane:camera",
        lane_kind: "camera",
        state: "canceled",
        node_id: "node:camera",
        held_resources: [],
        iteration: 0,
        tick_index: 110,
        controls_released: true,
      }, {
        lane_id: "lane:safety",
        lane_kind: "safety",
        state: "canceled",
        node_id: "node:safety",
        held_resources: [],
        iteration: 0,
        tick_index: 110,
        controls_released: true,
      }],
      condition_observations: [{
        node_id: "interrupt:low-health",
        tick_index: 0,
        condition_kind: "health_at_least",
        satisfied: true,
      }, {
        node_id: "interrupt:low-health",
        tick_index: 110,
        condition_kind: "health_at_least",
        satisfied: false,
      }],
      condition_observation_count: 2,
      resource_conflict_count: 0,
      interrupt_count: 1,
      controls_released: true,
      executed_action_count: 0,
      max_concurrent_lane_count: 1,
      parallel_tick_count: 0,
      race_outcomes: [],
      race_outcome_count: 0,
      placement_predictions: [],
      placement_prediction_count: 0,
      placement_action_success_count: 0,
      placement_mutation_success_count: 0,
      world_mutations_performed: 0,
      inventory_mutations_performed: 0,
    };

    expect(environmentActionWorkflowMeasurementsValid({
      request: guardianRequest,
      result: guardianResult,
      measurements,
    })).toBe(true);
    expect(environmentActionWorkflowMeasurementsValid({
      request: guardianRequest,
      result: guardianResult,
      measurements: {
        ...measurements,
        settled_interrupt_id: "interrupt:forged",
      },
    })).toBe(false);
  });

  it("preserves success only when every admitted required postcondition is proven", () => {
    expect(canonicalizeEnvironmentActionResult({
      request,
      result,
      identityValid: true,
      envelopeValid: true,
      currentTurn: true,
      workflowEvidenceValid: true,
      verifiedTerminalMeasurements: {
        distance_blocks: 0.5,
        arrival_radius: 1,
        final_x: 8,
        final_y: 64,
        final_z: 3,
        dispatch_to_first_tick_ms: 14,
        resident_computation_ms: 3,
        scheduler_ticks: 12,
        active_control_ticks: 11,
        stalled_ticks: 1,
        missed_ticks: 0,
        measurement_authority: false,
        answer_authority: false,
        terminal_eligible: false,
      },
    })).toMatchObject({
      outcome: "succeeded",
      verified_terminal_measurements: {
        distance_blocks: 0.5,
        final_x: 8,
        dispatch_to_first_tick_ms: 14,
        resident_computation_ms: 3,
        scheduler_ticks: 12,
        active_control_ticks: 11,
        stalled_ticks: 1,
        missed_ticks: 0,
        measurement_authority: false,
        answer_authority: false,
        terminal_eligible: false,
      },
    });
  });

  it("re-enters bounded terminal diagnostics for a failed reactive workflow", async () => {
    const eventId = "environment_action_event:reactive-failed";
    const failedResult = helixEnvironmentActionResultSchema.parse({
      ...result,
      outcome: "failed",
      summary: "A required reactive lane failed or was canceled.",
      progress_event_refs: [eventId],
      postconditions: result.postconditions.map((condition) => ({
        ...condition,
        status: "not_checked" as const,
        evidence_refs: [eventId],
      })),
    });
    const measurements = {
      reason_code: "reactive_required_lane_failed",
      failed_lane_id: "locomotion",
      race_outcomes: [{
        race_id: "stop_on_low_health",
        winner_lane_id: "camera",
        settle_on: "first_terminal",
        settled_tick: 1,
        canceled_lane_ids: ["locomotion"],
      }],
      condition_observations: [{
        node_id: "health_floor_stop",
        tick_index: 1,
        condition_kind: "health_at_least",
        satisfied: true,
      }],
    };
    const evidence = await readRecordedWorkflowEvidence({
      db: {
        query: async () => ({
          rows: [{
            event_id: eventId,
            event_payload: {
              schema: "helix.environment_action.workflow_event.v1",
              event_id: eventId,
              action_request_id: request.action_request_id,
              workflow_id: request.workflow_id,
              sequence: 2,
              event_type: "workflow.failed",
              workflow_state: "failed",
              progress_fraction: null,
              summary: failedResult.summary,
              control_engine: "native_fabric",
              measurements,
              evidence_refs: [],
              manual_override_detected: false,
              controls_released: true,
              created_at: completedAt,
              content_role: "environment_action_event_not_assistant_answer",
              answer_authority: false,
              assistant_answer: false,
              terminal_eligible: false,
              raw_content_included: false,
            },
          }],
        }),
      } as never,
      request,
      result: failedResult,
    });

    expect(evidence).toEqual({
      valid: true,
      terminalMeasurements: measurements,
    });
  });

  it("turns a connector success with substituted postcondition identity into a typed failure", () => {
    const substituted = helixEnvironmentActionResultSchema.parse({
      ...result,
      postconditions: [{
        ...result.postconditions[0],
        condition_id: "postcondition:different-goal",
      }],
    });
    expect(canonicalizeEnvironmentActionResult({
      request,
      result: substituted,
      identityValid: true,
      envelopeValid: true,
      currentTurn: true,
      workflowEvidenceValid: true,
    })).toMatchObject({
      outcome: "postcondition_failed",
      summary:
        "The connector reported success, but its terminal measurements did not prove every required action postcondition.",
      controls_released: true,
      automatic_replay_performed: false,
    });
  });

  it("keeps late success as provenance without granting current-turn success", () => {
    expect(canonicalizeEnvironmentActionResult({
      request,
      result,
      identityValid: true,
      envelopeValid: true,
      currentTurn: false,
      workflowEvidenceValid: true,
    }).outcome).toBe("action_outcome_unknown");
  });

  it("fails a mismatched result envelope closed before postcondition admission", () => {
    expect(canonicalizeEnvironmentActionResult({
      request,
      result,
      identityValid: true,
      envelopeValid: false,
      currentTurn: true,
      workflowEvidenceValid: true,
    }).outcome).toBe("capability_version_changed");
  });

  it("rejects success whose postcondition refs do not resolve to recorded workflow evidence", () => {
    expect(canonicalizeEnvironmentActionResult({
      request,
      result,
      identityValid: true,
      envelopeValid: true,
      currentTurn: true,
      workflowEvidenceValid: false,
    })).toMatchObject({
      outcome: "postcondition_failed",
      summary:
        "The connector reported success, but the matching terminal workflow event and its current execution-window measurements were not recorded consistently.",
    });
  });

  it("rejects measured world mutation that exceeds the admitted request scope", () => {
    const mineRequest = helixEnvironmentActionRequestSchema.parse({
      ...request,
      action_request_id: "environment_action_request:mine-canonicalization",
      workflow_id: "environment_action_workflow:mine-canonicalization",
      capability_id: "com.casimirbot.minecraft.player.mine",
      action_kind: "mine",
      effect_class: "world_mutation",
      arguments: {
        action_kind: "mine",
        block_id: "minecraft:stone",
        count: 2,
        search_radius: 8,
      },
      postconditions: [{
        condition_id: "postcondition:mine",
        condition_kind: "minecraft.world.matching_blocks_removed",
        required: true,
        parameters: { block_id: "minecraft:stone", count: 2 },
      }],
      idempotency_key: "canonicalization-mine-result",
      constraints: {
        ...request.constraints,
        max_block_mutations: 2,
        max_inventory_transfers: 2,
        world_mutation_allowed: true,
      },
    });
    const mineResult = helixEnvironmentActionResultSchema.parse({
      ...result,
      action_request_id: mineRequest.action_request_id,
      workflow_id: mineRequest.workflow_id,
      capability_id: mineRequest.capability_id,
      action_kind: "mine",
      postconditions: [{
        condition_id: "postcondition:mine",
        condition_kind: "minecraft.world.matching_blocks_removed",
        required: true,
        status: "satisfied",
        summary: "Two matching blocks were observed removed.",
        evidence_refs: ["environment_action_event:mine"],
        checked_at: completedAt,
      }],
      evidence_refs: ["environment_action_event:mine"],
      player_motion_performed: true,
      player_interaction_performed: true,
      inventory_mutation_performed: false,
      world_mutation_performed: true,
    });
    expect(environmentActionWorkflowMeasurementsValid({
      request: mineRequest,
      result: mineResult,
      measurements: {
        block_id: "minecraft:stone",
        removed_count: 2,
        world_mutations_performed: 2,
      },
    })).toBe(true);
    expect(environmentActionWorkflowMeasurementsValid({
      request: mineRequest,
      result: mineResult,
      measurements: {
        block_id: "minecraft:stone",
        removed_count: 3,
        world_mutations_performed: 3,
      },
    })).toBe(false);
  });
});
