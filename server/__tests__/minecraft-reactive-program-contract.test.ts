import { describe, expect, it } from "vitest";
import {
  HELIX_MINECRAFT_REACTIVE_PROGRAM_SCHEMA,
  helixMinecraftReactiveProgramArgumentsSchema,
  minecraftReactiveResourcesForAction,
} from "@shared/helix-minecraft-reactive-program";
import { helixMinecraftPlayerActionArgumentsSchema } from "@shared/helix-minecraft-player-capabilities";
import recoveryFixture from "../../scripts/fixtures/minecraft-combat-rec2-inventory-recovery-v1.json";
import latentRecoveryFixture from "../../scripts/fixtures/minecraft-combat-rec2a-latent-recovery-v1.json";
import pressureCommitFixture from "../../scripts/fixtures/minecraft-combat-rec2c-pressure-commit-v1.json";

const terminal = (nodeId: string, outcome = "succeeded") => ({
  node_id: nodeId,
  node_kind: "terminal",
  terminal_outcome: outcome,
  reason_code: `reason:${nodeId}`,
});

const validProgram = () => ({
  action_kind: "execute_reactive_program",
  program_schema: HELIX_MINECRAFT_REACTIVE_PROGRAM_SCHEMA,
  program_id: "program:guardian-fixture",
  ruleset: "survival_tas",
  execution_plane: "player_embodiment",
  scheduler_engine: "native_fabric_concurrent",
  max_total_ticks: 1_200,
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
      start_node_id: "node:camera-track",
      nodes: [
        {
          node_id: "node:camera-track",
          node_kind: "action",
          earliest_tick: 0,
          timeout_ticks: 620,
          action: {
            action_kind: "track_target",
            target: {
              target_kind: "entity_type",
              entity_type_id: "minecraft:bat",
              selection: "nearest",
            },
            aim_point: "render_center",
            max_acquisition_distance: 64,
            max_duration_ms: 30_000,
            max_turn_degrees_per_tick: 20,
            max_angular_acceleration_degrees_per_tick_squared: 4,
            prediction_ticks: 2,
            deadband_degrees: 0.5,
            reacquire_ticks: 20,
            require_line_of_sight: false,
            stop_below_health: 4,
          },
          on_success: "node:camera-done",
          on_failure: "node:camera-failed",
          on_timeout: "node:camera-failed",
        },
        terminal("node:camera-done"),
        terminal("node:camera-failed", "failed"),
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
          timeout_ticks: 100,
          action: {
            action_kind: "walk",
            direction: "forward",
            duration_ms: 1_000,
            sprint: false,
          },
          on_success: "node:walk-done",
          on_failure: "node:walk-failed",
          on_timeout: "node:walk-failed",
        },
        terminal("node:walk-done"),
        terminal("node:walk-failed", "failed"),
      ],
    },
    {
      lane_id: "lane:hand",
      lane_kind: "hand",
      priority: 70,
      required: true,
      activation: "immediate",
      resource_ceiling: ["main_hand", "off_hand"],
      start_node_id: "node:feed-repeat",
      nodes: [
        {
          node_id: "node:feed-repeat",
          node_kind: "repeat",
          earliest_tick: 0,
          action: {
            action_kind: "interact",
            target: "looked_at_entity",
            hand: "main_hand",
            interaction: "interact",
          },
          max_iterations: 5,
          timeout_ticks: 200,
          until_condition: {
            condition_kind: "player_grounded",
            expected: true,
          },
          on_complete: "node:feed-done",
          on_failure: "node:feed-failed",
          on_timeout: "node:feed-failed",
        },
        terminal("node:feed-done"),
        terminal("node:feed-failed", "failed"),
      ],
    },
    {
      lane_id: "lane:safety",
      lane_kind: "safety",
      priority: 255,
      required: false,
      activation: "interrupt_only",
      resource_ceiling: ["safety"],
      start_node_id: "node:safety-done",
      nodes: [terminal("node:safety-done")],
    },
  ],
  races: [],
  interrupts: [
    {
      interrupt_id: "interrupt:low-health",
      priority: 255,
      condition: {
        condition_kind: "health_at_least",
        health: 6,
      },
      trigger_when: "not_satisfied",
      debounce_ticks: 1,
      activate_lane_id: "lane:safety",
      cancel_lane_ids: ["lane:camera", "lane:locomotion", "lane:hand"],
      max_activations: 1,
    },
  ],
});

describe("Minecraft concurrent reactive program contract", () => {
  it("admits bounded parallel camera, locomotion, hand, and safety lanes", () => {
    const parsed =
      helixMinecraftReactiveProgramArgumentsSchema.parse(validProgram());
    expect(parsed.lanes).toHaveLength(4);
    expect(parsed.interrupts[0]?.trigger_when).toBe("not_satisfied");
  });

  it("derives exact resources from typed actions instead of trusting prose", () => {
    expect(
      minecraftReactiveResourcesForAction({
        action_kind: "attack",
        target_ref: "target:1234567890abcdef1234567890abcdef12345678",
        target_entity_type_id: "minecraft:zombie",
        target_classification: "hostile",
        max_acquisition_distance: 8,
        require_line_of_sight: true,
        minimum_attack_cooldown: 0.9,
        max_attack_pulses: 16,
        max_duration_ms: 20_000,
        stop_below_health: 6,
        friendly_fire: false,
      }),
    ).toEqual(["camera", "main_hand"]);
    expect(
      minecraftReactiveResourcesForAction({
        action_kind: "combat_guard",
        hostile_entity_type_ids: ["minecraft:zombie"],
        max_acquisition_distance: 16,
        require_line_of_sight: true,
        minimum_attack_cooldown: 0.9,
        max_attack_pulses: 32,
        max_target_switches: 4,
        target_commit_ticks: 8,
        retreat_start_distance: 2.5,
        retreat_stop_distance: 4,
        retreat_when_hostile_count_at_least: 1,
        max_duration_ms: 30_000,
        stop_below_health: 6,
        friendly_fire: false,
      }),
    ).toEqual([
      "camera",
      "locomotion",
      "main_hand",
      "off_hand",
      "native_workflow",
    ]);
    expect(
      minecraftReactiveResourcesForAction({
        action_kind: "mine",
        block_id: "minecraft:stone",
        count: 1,
        search_radius: 8,
      }),
    ).toEqual([
      "camera",
      "locomotion",
      "main_hand",
      "world",
      "native_workflow",
    ]);
    expect(
      minecraftReactiveResourcesForAction({
        action_kind: "interact",
        target: "looked_at_entity",
        hand: "off_hand",
        interaction: "interact",
      }),
    ).toEqual(["off_hand"]);
    expect(
      minecraftReactiveResourcesForAction({
        action_kind: "interact",
        target: "looked_at_entity",
        hand: "main_hand",
        interaction: "interact",
      }),
    ).toEqual(["main_hand"]);
    expect(
      minecraftReactiveResourcesForAction({
        action_kind: "place",
        block_id: "minecraft:water",
        positions: [{ x: 1, y: 64, z: 2 }],
        placement_method: "item_use",
        source_item_id: "minecraft:water_bucket",
        hand: "off_hand",
      }),
    ).toEqual([
      "camera",
      "locomotion",
      "off_hand",
      "inventory",
      "world",
      "native_workflow",
    ]);
  });

  it("admits the frozen REC2 craft-consume-reengage program", () => {
    const parsed =
      helixMinecraftReactiveProgramArgumentsSchema.parse(recoveryFixture);
    expect(parsed.mutation_scope.combat_allowed).toBe(true);
    expect(parsed.mutation_scope.max_inventory_transfers).toBe(3);
    expect(parsed.lanes[0]?.lane_kind).toBe("inventory");
    expect(parsed.lanes[1]?.activation).toBe("interrupt_only");
  });

  it("admits REC2A as combat-only opening work plus one dormant recovery contingency", () => {
    const parsed =
      helixMinecraftReactiveProgramArgumentsSchema.parse(latentRecoveryFixture);
    expect(parsed.mutation_scope.combat_allowed).toBe(true);
    expect(parsed.lanes[0]?.activation).toBe("immediate");
    expect(parsed.lanes[0]?.lane_kind).toBe("safety");
    expect(parsed.lanes[1]?.activation).toBe("interrupt_only");
    expect(parsed.interrupts).toHaveLength(1);
    expect(parsed.interrupts[0]?.cancel_lane_ids).toEqual([
      "lane:opening-combat",
    ]);
    const dormantActions = parsed.lanes[1]?.nodes.flatMap((node) =>
      "action" in node ? [node.action] : [],
    );
    expect(dormantActions?.map((action) => action.action_kind)).toEqual([
      "combat_guard",
      "craft",
      "consume",
      "equip",
      "combat_guard",
    ]);
    expect(
      dormantActions?.find(
        (action) =>
          action.action_kind === "combat_guard" &&
          action.combat_mode === "disengage_to_distance",
      ),
    ).toBeDefined();
  });

  it("admits REC2C as one health-triggered pressure commit followed by combat resumption", () => {
    const parsed =
      helixMinecraftReactiveProgramArgumentsSchema.parse(pressureCommitFixture);
    expect(parsed.mutation_scope.combat_allowed).toBe(true);
    expect(parsed.mutation_scope.max_inventory_transfers).toBe(2);
    expect(parsed.lanes[0]?.activation).toBe("immediate");
    expect(parsed.lanes[1]?.activation).toBe("interrupt_only");
    expect(parsed.interrupts).toHaveLength(1);
    expect(parsed.interrupts[0]?.cancel_lane_ids).toEqual([
      "lane:opening-combat",
    ]);
    const pressureActions = parsed.lanes[1]?.nodes.flatMap((node) =>
      "action" in node ? [node.action] : [],
    );
    expect(pressureActions?.map((action) => action.action_kind)).toEqual([
      "consume",
      "equip",
      "combat_guard",
    ]);
    expect(pressureActions?.[0]).toMatchObject({
      action_kind: "consume",
      item_id: "minecraft:golden_apple",
      minimum_food_gain: 0,
    });
  });

  it("does not let a reactive recovery graph smuggle combat through a noncombat scope", () => {
    const result = helixMinecraftReactiveProgramArgumentsSchema.safeParse({
      ...recoveryFixture,
      mutation_scope: {
        ...recoveryFixture.mutation_scope,
        combat_allowed: false,
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          issue.message.includes(
            "Reactive combat actions require mutation_scope.combat_allowed=true",
          ),
        ),
      ).toBe(true);
    }
  });

  it("requires exact source-item and hand identity for item-use placement", () => {
    expect(
      helixMinecraftPlayerActionArgumentsSchema.safeParse({
        action_kind: "place",
        block_id: "minecraft:water",
        positions: [{ x: 1, y: 64, z: 2 }],
        placement_method: "item_use",
      }).success,
    ).toBe(false);
    expect(
      helixMinecraftPlayerActionArgumentsSchema.safeParse({
        action_kind: "place",
        block_id: "minecraft:water",
        positions: [{ x: 1, y: 64, z: 2 }],
        placement_method: "item_use",
        source_item_id: "minecraft:water_bucket",
        hand: "off_hand",
      }).success,
    ).toBe(true);
  });

  it("admits one bounded collision-cell binding instead of placeholder coordinates", () => {
    const dynamicPlacement = {
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
    } as const;
    expect(
      helixMinecraftPlayerActionArgumentsSchema.safeParse(dynamicPlacement)
        .success,
    ).toBe(true);
    expect(
      helixMinecraftPlayerActionArgumentsSchema.safeParse({
        ...dynamicPlacement,
        positions: [{ x: 0, y: 0, z: 0 }],
      }).success,
    ).toBe(false);
    expect(
      helixMinecraftPlayerActionArgumentsSchema.safeParse({
        ...dynamicPlacement,
        position_binding: undefined,
      }).success,
    ).toBe(false);
    expect(
      helixMinecraftPlayerActionArgumentsSchema.safeParse({
        ...dynamicPlacement,
        position_binding: {
          ...dynamicPlacement.position_binding,
          max_distance_blocks: 7,
        },
      }).success,
    ).toBe(false);
    expect(
      helixMinecraftPlayerActionArgumentsSchema.safeParse({
        ...dynamicPlacement,
        cleanup_after_landing: true,
      }).success,
    ).toBe(true);
    expect(
      helixMinecraftPlayerActionArgumentsSchema.safeParse({
        ...dynamicPlacement,
        block_id: "minecraft:cobblestone",
        cleanup_after_landing: true,
      }).success,
    ).toBe(false);
    expect(
      helixMinecraftPlayerActionArgumentsSchema.safeParse({
        ...dynamicPlacement,
        positions: [{ x: 1, y: 64, z: 2 }],
        position_binding: undefined,
        cleanup_after_landing: true,
      }).success,
    ).toBe(false);
  });

  it("counts a dynamic landing cell as one admitted mutation", () => {
    const candidate = validProgram();
    candidate.mutation_scope = {
      world_mutation_allowed: true,
      max_block_mutations: 1,
      max_inventory_transfers: 1,
      allowed_block_ids: ["minecraft:water"],
      allowed_regions: [],
      combat_allowed: false,
    };
    candidate.lanes[0] = {
      ...candidate.lanes[0],
      lane_id: "lane:world",
      lane_kind: "world",
      resource_ceiling: [
        "camera",
        "locomotion",
        "hotbar",
        "main_hand",
        "inventory",
        "world",
        "native_workflow",
      ],
      start_node_id: "node:dynamic-place",
      nodes: [
        {
          node_id: "node:dynamic-place",
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
          on_success: "node:dynamic-place-done",
          on_failure: "node:dynamic-place-failed",
          on_timeout: "node:dynamic-place-failed",
        },
        terminal("node:dynamic-place-done"),
        terminal("node:dynamic-place-failed", "failed"),
      ],
    };
    candidate.interrupts[0]!.cancel_lane_ids[0] = "lane:world";
    expect(
      helixMinecraftReactiveProgramArgumentsSchema.safeParse(candidate).success,
    ).toBe(true);
    candidate.mutation_scope.max_block_mutations = 0;
    expect(
      helixMinecraftReactiveProgramArgumentsSchema.safeParse(candidate).success,
    ).toBe(false);
  });

  it("admits the selected interaction hand without requiring the other hand", () => {
    const candidate = validProgram();
    const lane = candidate.lanes[2]!;
    lane.resource_ceiling = ["off_hand"];
    lane.nodes[0] = {
      ...lane.nodes[0],
      action: {
        action_kind: "interact",
        target: "looked_at_entity",
        hand: "off_hand",
        interaction: "interact",
      },
    };
    expect(
      helixMinecraftReactiveProgramArgumentsSchema.safeParse(candidate).success,
    ).toBe(true);
  });

  it("rejects an interaction lane that declares only the wrong hand", () => {
    const candidate = validProgram();
    const lane = candidate.lanes[2]!;
    lane.resource_ceiling = ["main_hand"];
    lane.nodes[0] = {
      ...lane.nodes[0],
      action: {
        action_kind: "interact",
        target: "looked_at_entity",
        hand: "off_hand",
        interaction: "interact",
      },
    };
    const result =
      helixMinecraftReactiveProgramArgumentsSchema.safeParse(candidate);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          issue.message.includes("undeclared lane resource off_hand"),
        ),
      ).toBe(true);
    }
  });

  it("rejects an action whose lane omits a required resource lock", () => {
    const candidate = validProgram();
    candidate.lanes[0]!.resource_ceiling = [];
    const result =
      helixMinecraftReactiveProgramArgumentsSchema.safeParse(candidate);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          issue.message.includes("undeclared lane resource camera"),
        ),
      ).toBe(true);
    }
  });

  it("rejects graph cycles and requires bounded repeat nodes instead", () => {
    const candidate = validProgram();
    const lane = candidate.lanes[1]!;
    lane.nodes[1] = {
      node_id: "node:walk-done",
      node_kind: "branch",
      earliest_tick: 0,
      condition: { condition_kind: "player_grounded", expected: true },
      on_true: "node:walk",
      on_false: "node:walk-failed",
    };
    const result =
      helixMinecraftReactiveProgramArgumentsSchema.safeParse(candidate);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          issue.message.includes("must be acyclic"),
        ),
      ).toBe(true);
    }
  });

  it("rejects direct success terminals on failed or timed-out required work", () => {
    const candidate = validProgram();
    const lane = candidate.lanes[1]!;
    lane.nodes[0] = {
      ...lane.nodes[0],
      on_failure: "node:walk-done",
      on_timeout: "node:walk-done",
    };
    const result =
      helixMinecraftReactiveProgramArgumentsSchema.safeParse(candidate);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.filter((issue) =>
          issue.message.includes(
            "failure or timeout cannot transition directly to succeeded terminal",
          ),
        ),
      ).toHaveLength(2);
    }
  });

  it("allows a negative edge to enter explicit bounded recovery work", () => {
    const candidate = validProgram();
    const lane = candidate.lanes[1]!;
    lane.nodes.splice(1, 0, {
      node_id: "node:walk-recovery",
      node_kind: "action",
      earliest_tick: 0,
      timeout_ticks: 40,
      action: {
        action_kind: "walk",
        direction: "back",
        duration_ms: 250,
        sprint: false,
      },
      on_success: "node:walk-done",
      on_failure: "node:walk-failed",
      on_timeout: "node:walk-failed",
    });
    lane.nodes[0] = {
      ...lane.nodes[0],
      on_failure: "node:walk-recovery",
      on_timeout: "node:walk-recovery",
    };
    const result =
      helixMinecraftReactiveProgramArgumentsSchema.safeParse(candidate);
    expect(
      result.success,
      result.success ? undefined : JSON.stringify(result.error.issues),
    ).toBe(true);
  });

  it("multiplies mutation admission by the maximum repeat count", () => {
    const candidate = validProgram();
    candidate.mutation_scope = {
      world_mutation_allowed: true,
      max_block_mutations: 3,
      max_inventory_transfers: 3,
      allowed_block_ids: ["minecraft:stone"],
      allowed_regions: [],
      combat_allowed: false,
    };
    const lane = candidate.lanes[2]!;
    lane.resource_ceiling = [
      "camera",
      "locomotion",
      "main_hand",
      "world",
      "native_workflow",
    ];
    lane.nodes[0] = {
      ...lane.nodes[0],
      action: {
        action_kind: "mine",
        block_id: "minecraft:stone",
        count: 2,
        search_radius: 8,
      },
      max_iterations: 2,
      until_condition: undefined,
    };
    const result =
      helixMinecraftReactiveProgramArgumentsSchema.safeParse(candidate);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["mutation_scope", "max_block_mutations"],
            message: expect.stringContaining("required at least 4, received 3"),
          }),
          expect.objectContaining({
            path: ["mutation_scope", "max_inventory_transfers"],
            message: expect.stringContaining("required at least 4, received 3"),
          }),
        ]),
      );
    }
  });

  it("requires interrupts to activate only dormant interrupt lanes", () => {
    const candidate = validProgram();
    candidate.interrupts[0]!.activate_lane_id = "lane:camera";
    const result =
      helixMinecraftReactiveProgramArgumentsSchema.safeParse(candidate);
    expect(result.success).toBe(false);
  });

  it("rejects race members that do not exist", () => {
    const candidate = validProgram();
    candidate.races = [
      {
        race_id: "race:fixture",
        lane_ids: ["lane:camera", "lane:missing"],
        settle_on: "first_succeeded",
        cancel_remaining: true,
      },
    ];
    const result =
      helixMinecraftReactiveProgramArgumentsSchema.safeParse(candidate);
    expect(result.success).toBe(false);
  });

  it("keeps command-assisted and guidance rulesets off player embodiment", () => {
    for (const ruleset of [
      "command_assisted_sandbox",
      "copilot_speedrun",
    ] as const) {
      const candidate = validProgram();
      candidate.ruleset = ruleset;
      expect(
        helixMinecraftReactiveProgramArgumentsSchema.safeParse(candidate)
          .success,
      ).toBe(false);
    }
  });
});
