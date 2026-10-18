import { describe, expect, it } from "vitest";
import {
  HELIX_MINECRAFT_PLAYER_EXECUTE_SEQUENCE_CAPABILITY,
  HELIX_MINECRAFT_PLAYER_SEQUENCE_SCHEMA,
  helixMinecraftFluidSequenceArgumentsSchema,
} from "@shared/helix-minecraft-fluid-sequence";
import { HELIX_MINECRAFT_PLAYER_ACTION_CAPABILITY_IDS } from "@shared/helix-minecraft-player-capabilities";
import { HELIX_MINECRAFT_FABRIC_PLAYER_ACTION_PROFILE_ID } from "@shared/helix-environment-action-adapter-profile";
import { listEnvironmentConnectorCapabilityDescriptors } from "../services/environment-connectors/catalog";
import { listEnvironmentActionAdapterProfiles } from "../services/situation-room/environment-action-adapter-registry";
import { environmentActionMinecraftManifests } from "../services/helix-ask/workstation-tool-gateway/environment-action";
import { environmentActionWorkflowMeasurementsValid } from "../services/environment-connectors/actions/action-broker";

const validSequence = () => ({
  action_kind: "execute_sequence" as const,
  sequence_schema: HELIX_MINECRAFT_PLAYER_SEQUENCE_SCHEMA,
  sequence_id: "sequence:tas_micro_course",
  ruleset: "survival_tas" as const,
  execution_plane: "player_embodiment" as const,
  scheduler_engine: "native_fabric" as const,
  optimization: {
    primary: "minimize_world_ticks" as const,
    record_wall_clock: true as const,
    stop_on_first_verified_success: true as const,
  },
  start_node_id: "node:sprint_jump",
  max_total_ticks: 200,
  required_checkpoint_ids: ["checkpoint:landed"],
  mutation_scope: {
    world_mutation_allowed: false,
    max_block_mutations: 0,
    max_inventory_transfers: 0,
    allowed_block_ids: [],
    allowed_regions: [],
    combat_allowed: false as const,
  },
  nodes: [
    {
      node_id: "node:sprint_jump",
      node_kind: "input_segment" as const,
      earliest_tick: 0,
      duration_ticks: 6,
      controls: {
        forward: 1 as const,
        strafe: 0 as const,
        sprint: true,
        sneak: false,
        jump: "pulse" as const,
        use: "idle" as const,
      },
      on_complete: "node:landed",
      on_failure: "node:failed",
    },
    {
      node_id: "node:landed",
      node_kind: "checkpoint" as const,
      earliest_tick: 6,
      checkpoint_id: "checkpoint:landed",
      condition: { condition_kind: "player_grounded" as const, expected: true },
      wait_up_to_ticks: 30,
      on_satisfied: "node:hotbar",
      on_timeout: "node:failed",
    },
    {
      node_id: "node:hotbar",
      node_kind: "workflow_action" as const,
      earliest_tick: 6,
      timeout_ticks: 20,
      action: { action_kind: "hotbar_select" as const, slot: 2 },
      on_success: "node:succeeded",
      on_failure: "node:failed",
    },
    {
      node_id: "node:succeeded",
      node_kind: "terminal" as const,
      terminal_outcome: "succeeded" as const,
      reason_code: "tas_checkpoint_complete",
    },
    {
      node_id: "node:failed",
      node_kind: "terminal" as const,
      terminal_outcome: "failed" as const,
      reason_code: "tas_checkpoint_failed",
    },
  ],
});

describe("Minecraft fluid sequence contract", () => {
  it("admits a bounded acyclic survival TAS program", () => {
    expect(helixMinecraftFluidSequenceArgumentsSchema.parse(validSequence()))
      .toMatchObject({
        action_kind: "execute_sequence",
        ruleset: "survival_tas",
        max_total_ticks: 200,
      });
  });

  it("keeps inventory mutation admission independent from world mutation", () => {
    const candidate = validSequence();
    candidate.mutation_scope.max_inventory_transfers = 4;
    const hotbar = candidate.nodes.find(
      (node) => node.node_id === "node:hotbar",
    )!;
    hotbar.on_success = "node:craft";
    candidate.nodes.splice(candidate.nodes.length - 2, 0, {
      node_id: "node:craft",
      node_kind: "workflow_action" as const,
      earliest_tick: 6,
      timeout_ticks: 40,
      action: {
        action_kind: "craft" as const,
        output_item_id: "minecraft:oak_planks",
        count: 4,
        recipe_id: null,
      },
      on_success: "node:succeeded",
      on_failure: "node:failed",
    } as never);

    expect(
      helixMinecraftFluidSequenceArgumentsSchema.safeParse(candidate).success,
    ).toBe(true);
    expect(candidate.mutation_scope).toMatchObject({
      world_mutation_allowed: false,
      max_block_mutations: 0,
      max_inventory_transfers: 4,
      allowed_block_ids: [],
      allowed_regions: [],
    });
  });

  it("defines future rulesets without admitting them through Player Embodiment", () => {
    const candidate = validSequence();
    candidate.ruleset = "command_assisted_sandbox" as never;
    const parsed = helixMinecraftFluidSequenceArgumentsSchema.safeParse(candidate);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path[0] === "ruleset"))
        .toBe(true);
    }
  });

  it("admits only typed adaptive state conditions needed for TAS replanning", () => {
    const conditions = [
      {
        condition_kind: "focus_reachable",
        expected: true,
        max_distance: 4.5,
      },
      {
        condition_kind: "vertical_velocity_at_most",
        velocity_y: -0.6,
      },
      {
        condition_kind: "predicted_collision_within",
        max_ticks: 8,
        expected: true,
      },
      {
        condition_kind: "placement_reachable_within",
        position: { x: 1, y: 63, z: 1 },
        horizon_ticks: 6,
        expected: true,
      },
      { condition_kind: "dimension_is", dimension: "minecraft:overworld" },
      {
        condition_kind: "equipment_item_is",
        destination: "main_hand",
        item_id: "minecraft:iron_pickaxe",
      },
      {
        condition_kind: "portal_nearby",
        portal_kind: "nether_portal",
        radius: 8,
        expected: true,
      },
      {
        condition_kind: "hazard_clear",
        hazard_kinds: ["lava", "hostile", "void_fall"],
        radius: 6,
      },
      {
        condition_kind: "recipe_craftable",
        output_item_id: "minecraft:crafting_table",
        expected: true,
      },
    ];
    for (const condition of conditions) {
      const candidate = validSequence();
      candidate.nodes[1] = {
        ...candidate.nodes[1],
        condition,
      } as never;
      expect(
        helixMinecraftFluidSequenceArgumentsSchema.safeParse(candidate).success,
      ).toBe(true);
    }
  });

  it("rejects graph cycles instead of allowing an unbounded local loop", () => {
    const candidate = validSequence();
    candidate.nodes[2] = {
      ...candidate.nodes[2],
      on_success: "node:sprint_jump",
    } as never;
    const parsed = helixMinecraftFluidSequenceArgumentsSchema.safeParse(candidate);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) =>
        issue.message.includes("acyclic"))).toBe(true);
    }
  });

  it("requires declared mutation and inventory ceilings for embedded workflows", () => {
    const candidate = validSequence();
    candidate.nodes[2] = {
      node_id: "node:hotbar",
      node_kind: "workflow_action",
      earliest_tick: 6,
      timeout_ticks: 40,
      action: {
        action_kind: "place",
        block_id: "minecraft:cobblestone",
        positions: [{ x: 1, y: 64, z: 1 }],
      },
      on_success: "node:succeeded",
      on_failure: "node:failed",
    } as never;
    const parsed = helixMinecraftFluidSequenceArgumentsSchema.safeParse(candidate);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) =>
        issue.path.includes("max_block_mutations"))).toBe(true);
    }
  });

  it("preserves the original 13 action identities and adds one sequence identity", () => {
    const profile = listEnvironmentActionAdapterProfiles().find((record) =>
      record.profile.profile_id === HELIX_MINECRAFT_FABRIC_PLAYER_ACTION_PROFILE_ID,
    )?.profile;
    expect(profile).toBeDefined();
    const ids = profile!.capabilities.map((capability) => capability.capability_id);
    expect(HELIX_MINECRAFT_PLAYER_ACTION_CAPABILITY_IDS.every((id) =>
      ids.includes(id))).toBe(true);
    expect(ids).toContain(HELIX_MINECRAFT_PLAYER_EXECUTE_SEQUENCE_CAPABILITY);
    expect(ids).toHaveLength(HELIX_MINECRAFT_PLAYER_ACTION_CAPABILITY_IDS.length);

    const descriptors = listEnvironmentConnectorCapabilityDescriptors({
      adapterProfileId: HELIX_MINECRAFT_FABRIC_PLAYER_ACTION_PROFILE_ID,
    });
    expect(descriptors.find((descriptor) =>
      descriptor.capability_id === HELIX_MINECRAFT_PLAYER_EXECUTE_SEQUENCE_CAPABILITY))
      .toMatchObject({ capability_class: "act", capability_version: 1 });
  });

  it("publishes the sequence as a non-terminal model tool without a command-plane escalation", () => {
    const manifest = environmentActionMinecraftManifests.find((entry) =>
      entry.capability_id === HELIX_MINECRAFT_PLAYER_EXECUTE_SEQUENCE_CAPABILITY,
    );
    expect(manifest).toMatchObject({
      mode: "act",
      mutating: true,
      shell_access: false,
      terminal_eligible: false,
      post_tool_model_step_required: true,
    });
    expect(manifest?.description).toContain("Player Embodiment plane");
    expect(manifest?.description).not.toContain("host shell");
    expect(manifest?.input_schema).toMatchObject({
      type: "object",
      properties: {
        ruleset: { enum: ["survival_tas"] },
      },
    });
  });

  it("accepts sequence success only with bounded duration and every required checkpoint", () => {
    const sequence = validSequence();
    const request = {
      action_kind: "execute_sequence",
      arguments: sequence,
      constraints: {
        max_distance_blocks: 1_000,
        max_block_mutations: 0,
        max_inventory_transfers: 0,
        world_mutation_allowed: false,
      },
    };
    const result = {
      outcome: "succeeded",
      side_effects_performed: true,
      player_motion_performed: true,
      player_interaction_performed: false,
      inventory_mutation_performed: true,
      world_mutation_performed: false,
      duration_ticks: 18,
    };
    const measurements = {
      sequence_completed: true,
      sequence_id: sequence.sequence_id,
      ruleset: sequence.ruleset,
      executed_node_count: 4,
      required_checkpoints_satisfied: 1,
      condition_observation_count: 1,
      condition_observations: [{
        node_id: "node:landed",
        tick_index: 8,
        condition_kind: "player_grounded",
        satisfied: true,
      }],
      world_mutations_performed: 0,
    };
    expect(environmentActionWorkflowMeasurementsValid({
      request: request as never,
      result: result as never,
      measurements,
    })).toBe(true);
    expect(environmentActionWorkflowMeasurementsValid({
      request: request as never,
      result: result as never,
      measurements: { ...measurements, required_checkpoints_satisfied: 0 },
    })).toBe(false);
    expect(environmentActionWorkflowMeasurementsValid({
      request: request as never,
      result: { ...result, duration_ticks: 201 } as never,
      measurements,
    })).toBe(false);
    expect(environmentActionWorkflowMeasurementsValid({
      request: request as never,
      result: result as never,
      measurements: {
        ...measurements,
        condition_observation_count: 2,
        condition_observations: [
          ...measurements.condition_observations,
          ...measurements.condition_observations,
        ],
      },
    })).toBe(false);
  });
});
