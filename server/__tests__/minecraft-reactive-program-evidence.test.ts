import { describe, expect, it } from "vitest";
import {
  HELIX_MINECRAFT_PLAYER_EXECUTE_REACTIVE_PROGRAM_CAPABILITY,
  HELIX_MINECRAFT_REACTIVE_PROGRAM_SCHEMA,
  helixMinecraftReactiveProgramArgumentsSchema,
} from "@shared/helix-minecraft-reactive-program";
import { environmentActionWorkflowMeasurementsValid } from "../services/environment-connectors/actions/action-broker";

const program = helixMinecraftReactiveProgramArgumentsSchema.parse({
  action_kind: "execute_reactive_program",
  program_schema: HELIX_MINECRAFT_REACTIVE_PROGRAM_SCHEMA,
  program_id: "program:evidence-fixture",
  ruleset: "survival_tas",
  execution_plane: "player_embodiment",
  scheduler_engine: "native_fabric_concurrent",
  max_total_ticks: 200,
  completion_policy: {
    mode: "all_required",
    cancel_remaining_on_settle: true,
  },
  mutation_scope: {
    world_mutation_allowed: false,
    max_block_mutations: 0,
    max_inventory_transfers: 0,
    allowed_block_ids: [],
    allowed_regions: [],
    combat_allowed: false,
  },
  lanes: [
    {
      lane_id: "lane:camera",
      lane_kind: "camera",
      priority: 80,
      required: true,
      activation: "immediate",
      resource_ceiling: ["camera"],
      start_node_id: "node:look",
      nodes: [
        {
          node_id: "node:look",
          node_kind: "action",
          earliest_tick: 0,
          timeout_ticks: 20,
          action: {
            action_kind: "look_at",
            target: {
              target_kind: "relative_rotation",
              yaw_delta_degrees: 10,
              pitch_delta_degrees: 0,
            },
            max_turn_degrees_per_tick: 5,
          },
          on_success: "node:camera-done",
          on_failure: "node:camera-failed",
          on_timeout: "node:camera-failed",
        },
        {
          node_id: "node:camera-done",
          node_kind: "terminal",
          terminal_outcome: "succeeded",
          reason_code: "camera_done",
        },
        {
          node_id: "node:camera-failed",
          node_kind: "terminal",
          terminal_outcome: "failed",
          reason_code: "camera_failed",
        },
      ],
    },
    {
      lane_id: "lane:locomotion",
      lane_kind: "locomotion",
      priority: 60,
      required: true,
      activation: "immediate",
      resource_ceiling: ["locomotion"],
      start_node_id: "node:walk",
      nodes: [
        {
          node_id: "node:walk",
          node_kind: "action",
          earliest_tick: 0,
          timeout_ticks: 40,
          action: {
            action_kind: "walk",
            direction: "forward",
            duration_ms: 500,
            sprint: false,
          },
          on_success: "node:walk-done",
          on_failure: "node:walk-failed",
          on_timeout: "node:walk-failed",
        },
        {
          node_id: "node:walk-done",
          node_kind: "terminal",
          terminal_outcome: "succeeded",
          reason_code: "walk_done",
        },
        {
          node_id: "node:walk-failed",
          node_kind: "terminal",
          terminal_outcome: "failed",
          reason_code: "walk_failed",
        },
      ],
    },
  ],
  races: [],
  interrupts: [],
});

const request = {
  action_kind: "execute_reactive_program",
  capability_id: HELIX_MINECRAFT_PLAYER_EXECUTE_REACTIVE_PROGRAM_CAPABILITY,
  capability_version: 1,
  arguments: program,
  constraints: {
    max_block_mutations: 0,
    max_inventory_transfers: 0,
    world_mutation_allowed: false,
  },
};

const result = {
  outcome: "succeeded",
  duration_ticks: 14,
  side_effects_performed: true,
  player_motion_performed: true,
  player_interaction_performed: false,
  inventory_mutation_performed: false,
  world_mutation_performed: false,
};

const measurements = {
  program_schema: HELIX_MINECRAFT_REACTIVE_PROGRAM_SCHEMA,
  program_id: program.program_id,
  reactive_program_completed: true,
  tick_index: 14,
  active_lane_count: 0,
  executed_action_count: 2,
  condition_observations: [],
  condition_observation_count: 0,
  resource_conflict_count: 0,
  interrupt_count: 0,
  controls_released: true,
  world_mutations_performed: 0,
  inventory_mutations_performed: 0,
  collected_count: 0,
  produced_count: 0,
  transferred_count: 0,
  max_concurrent_lane_count: 2,
  parallel_tick_count: 2,
  race_outcomes: [],
  race_outcome_count: 0,
  placement_predictions: [],
  placement_prediction_count: 0,
  placement_action_success_count: 0,
  placement_mutation_success_count: 0,
  player_motion_performed: true,
  player_interaction_performed: false,
  lanes: program.lanes.map((lane) => ({
    lane_id: lane.lane_id,
    lane_kind: lane.lane_kind,
    state: "succeeded",
    node_id: lane.nodes.find(
      (node) =>
        node.node_kind === "terminal" && node.terminal_outcome === "succeeded",
    )?.node_id,
    held_resources: [],
    iteration: 0,
    tick_index: 14,
    controls_released: true,
  })),
};

const dynamicPlacementProgram =
  helixMinecraftReactiveProgramArgumentsSchema.parse({
    action_kind: "execute_reactive_program",
    program_schema: HELIX_MINECRAFT_REACTIVE_PROGRAM_SCHEMA,
    program_id: "program:dynamic-placement-evidence",
    ruleset: "survival_tas",
    execution_plane: "player_embodiment",
    scheduler_engine: "native_fabric_concurrent",
    max_total_ticks: 100,
    completion_policy: {
      mode: "all_required",
      cancel_remaining_on_settle: true,
    },
    mutation_scope: {
      world_mutation_allowed: true,
      max_block_mutations: 1,
      max_inventory_transfers: 1,
      allowed_block_ids: ["minecraft:water"],
      allowed_regions: [
        {
          min: { x: -82, y: 80, z: -40 },
          max: { x: -78, y: 82, z: -36 },
        },
      ],
      combat_allowed: false,
    },
    lanes: [
      {
        lane_id: "lane:world",
        lane_kind: "world",
        priority: 100,
        required: true,
        activation: "immediate",
        resource_ceiling: [
          "camera",
          "locomotion",
          "hotbar",
          "main_hand",
          "inventory",
          "world",
          "native_workflow",
        ],
        start_node_id: "node:place",
        nodes: [
          {
            node_id: "node:place",
            node_kind: "action",
            earliest_tick: 0,
            timeout_ticks: 40,
            action: {
              action_kind: "place",
              block_id: "minecraft:water",
              position_binding: {
                binding_kind: "predicted_collision_cell",
                horizon_ticks: 5,
                max_distance_blocks: 6,
                require_replaceable: true,
              },
              placement_method: "item_use",
              source_item_id: "minecraft:water_bucket",
              hand: "main_hand",
            },
            on_success: "node:done",
            on_failure: "node:failed",
            on_timeout: "node:failed",
          },
          {
            node_id: "node:done",
            node_kind: "terminal",
            terminal_outcome: "succeeded",
            reason_code: "placement_done",
          },
          {
            node_id: "node:failed",
            node_kind: "terminal",
            terminal_outcome: "failed",
            reason_code: "placement_failed",
          },
        ],
      },
    ],
    races: [],
    interrupts: [],
  });

const dynamicPlacementPrediction = {
  lane_id: "lane:world",
  action_kind: "place",
  model_schema: "helix.minecraft.short_horizon_trajectory.v1",
  position_binding_kind: "predicted_collision_cell",
  target_position: { x: -80, y: 81, z: -38 },
  actor_position_at_resolution: { x: -79.5, y: 84, z: -38.5 },
  horizon_ticks: 5,
  first_collision_tick: 3,
  max_distance_blocks: 6,
  require_replaceable: true,
  applicable: true,
  reason: "airborne_vanilla_approximation",
  predicted_reachable: true,
  support_candidate_count: 1,
  first_reachable_tick: 2,
  initial_distance: 4,
  minimum_predicted_distance: 2,
};

describe("Minecraft reactive-program terminal evidence", () => {
  it("accepts exact settled lane and resource-release evidence", () => {
    expect(
      environmentActionWorkflowMeasurementsValid({
        request: request as any,
        result: result as any,
        measurements,
      }),
    ).toBe(true);
  });

  it("rejects a success claim while a required lane still holds controls", () => {
    expect(
      environmentActionWorkflowMeasurementsValid({
        request: request as any,
        result: result as any,
        measurements: {
          ...measurements,
          lanes: measurements.lanes.map((lane, index) =>
            index === 0
              ? {
                  ...lane,
                  held_resources: ["camera"],
                  controls_released: false,
                }
              : lane,
          ),
        },
      }),
    ).toBe(false);
  });

  it("rejects a forged parallel receipt", () => {
    expect(
      environmentActionWorkflowMeasurementsValid({
        request: request as any,
        result: result as any,
        measurements: {
          ...measurements,
          max_concurrent_lane_count: 1,
          parallel_tick_count: 2,
        },
      }),
    ).toBe(false);
  });

  it("rejects an undeclared race outcome", () => {
    expect(
      environmentActionWorkflowMeasurementsValid({
        request: request as any,
        result: result as any,
        measurements: {
          ...measurements,
          race_outcomes: [
            {
              race_id: "race:forged",
              winner_lane_id: "lane:camera",
              settle_on: "first_succeeded",
              settled_tick: 1,
              canceled_lane_ids: ["lane:locomotion"],
            },
          ],
          race_outcome_count: 1,
        },
      }),
    ).toBe(false);
  });

  it("accepts a collision-bound placement only when its resolved cell remains in scope", () => {
    const dynamicMeasurements = {
      program_schema: HELIX_MINECRAFT_REACTIVE_PROGRAM_SCHEMA,
      program_id: dynamicPlacementProgram.program_id,
      reactive_program_completed: true,
      tick_index: 10,
      active_lane_count: 0,
      executed_action_count: 1,
      condition_observations: [],
      condition_observation_count: 0,
      resource_conflict_count: 0,
      interrupt_count: 0,
      controls_released: true,
      world_mutations_performed: 1,
      inventory_mutations_performed: 1,
      collected_count: 0,
      produced_count: 0,
      transferred_count: 0,
      max_concurrent_lane_count: 1,
      parallel_tick_count: 0,
      race_outcomes: [],
      race_outcome_count: 0,
      placement_predictions: [dynamicPlacementPrediction],
      placement_prediction_count: 1,
      placement_action_success_count: 1,
      placement_mutation_success_count: 1,
      player_motion_performed: true,
      player_interaction_performed: true,
      lanes: [
        {
          lane_id: "lane:world",
          lane_kind: "world",
          state: "succeeded",
          node_id: "node:done",
          held_resources: [],
          iteration: 0,
          tick_index: 10,
          controls_released: true,
        },
      ],
    };
    const dynamicRequest = {
      ...request,
      arguments: dynamicPlacementProgram,
      constraints: {
        max_block_mutations: 1,
        max_inventory_transfers: 1,
        world_mutation_allowed: true,
      },
    };
    const dynamicResult = {
      ...result,
      duration_ticks: 10,
      player_interaction_performed: true,
      inventory_mutation_performed: true,
      world_mutation_performed: true,
    };
    expect(
      environmentActionWorkflowMeasurementsValid({
        request: dynamicRequest as any,
        result: dynamicResult as any,
        measurements: dynamicMeasurements,
      }),
    ).toBe(true);
    expect(
      environmentActionWorkflowMeasurementsValid({
        request: dynamicRequest as any,
        result: dynamicResult as any,
        measurements: {
          ...dynamicMeasurements,
          placement_predictions: [
            {
              ...dynamicPlacementPrediction,
              target_position: { x: -70, y: 81, z: -38 },
            },
          ],
        },
      }),
    ).toBe(false);
  });
});
