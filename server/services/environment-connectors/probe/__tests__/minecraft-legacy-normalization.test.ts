import { describe, expect, it } from "vitest";
import {
  HELIX_MINECRAFT_PERCEPTION_SNAPSHOT_READ_CAPABILITY,
  HELIX_MINECRAFT_RECIPE_FACT_READ_CAPABILITY,
  HELIX_MINECRAFT_REGISTRY_FACT_READ_CAPABILITY,
  HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
} from "@shared/helix-environment-connector";
import {
  HELIX_ENVIRONMENT_PROBE_RESULT_SCHEMA,
  type HelixEnvironmentProbeResult,
  type HelixEnvironmentProbeType,
} from "@shared/helix-environment-probe";
import { validateEnvironmentConnectorSchemaValue } from "../../conformance";
import { readEnvironmentConnectorCapabilityDescriptor } from "../../catalog";
import {
  normalizeLegacyEnvironmentProbeResultForTests,
  outcomeForLegacyEnvironmentProbeResultForTests,
} from "../durable-broker";

const result = (
  probeType: HelixEnvironmentProbeType,
  payload: HelixEnvironmentProbeResult["result"],
  status: HelixEnvironmentProbeResult["status"] = "succeeded",
): HelixEnvironmentProbeResult => ({
  schema: HELIX_ENVIRONMENT_PROBE_RESULT_SCHEMA,
  probe_result_id: `probe_result:${probeType}`,
  probe_request_id: `probe_request:${probeType}`,
  source_id: "source:minecraft",
  room_id: "room:minecraft",
  domain: "minecraft",
  probe_type: probeType,
  status,
  result_summary: `${probeType} observation`,
  result: payload,
  sensor_scope: "sensor_observable",
  requires_caveat: false,
  side_effects_performed: false,
  commands_executed: [],
  world_mutation_performed: false,
  evidence_refs: [`minecraft:probe:${probeType}`],
  deterministic: true,
  model_invoked: false,
  assistant_answer: false,
  raw_content_included: false,
  context_policy: "compact_context_pack_only",
  created_at: "2026-07-29T12:00:00.000Z",
});

describe("Minecraft legacy probe normalization", () => {
  it("normalizes one same-revision perception snapshot and preserves explicit UI unknowns", () => {
    const details = {
      snapshot_schema: "helix.minecraft_perception_snapshot.v1",
      observation_revision: 420,
      game_tick: 420,
      capture_duration_ms: 3.25,
      dimension: "minecraft:overworld",
      actor: {
        position: { x: 1.5, y: 64, z: -2.5 },
        velocity: { x: 0.1, y: 0, z: -0.2 },
        yaw: 90,
        pitch: 4,
        health: 18,
        max_health: 20,
        food_level: 16,
        air: 300,
        on_ground: true,
        on_fire: false,
        freezing: false,
      },
      focus: {
        kind: "block",
        distance_blocks: 3.5,
        line_of_sight: true,
        occlusion: "none",
        block_id: "minecraft:stone",
        position: { x: 4, y: 64, z: -2 },
        aim_position: { x: 4.5, y: 64.5, z: -1.5 },
      },
      entities: [{
        entity_type: "minecraft:zombie",
        classification: "hostile",
        distance_blocks: 6,
        bearing_degrees: -35,
        relative_elevation_blocks: 0,
        closing_speed_blocks_per_second: 2.5,
        targeting_actor: true,
        line_of_sight: false,
        occlusion: "block",
      }],
      projectiles: [{
        projectile_ref: "projectile:arrow-1",
        incarnation_ref: "projectile_incarnation:arrow-1",
        projectile_type_id: "minecraft:arrow",
        owner_ref: "projectile_owner:skeleton-1",
        position: { x: 7.5, y: 65.5, z: -2.5 },
        velocity: { x: -0.45, y: 0, z: 0 },
        acceleration: { x: 0, y: -0.05, z: 0 },
        support_ticks: 20,
        predicted_collision_tick: 12,
        predicted_impact_position: { x: 1.8, y: 64.9, z: -2.5 },
        threat_classification: "collision",
        evidence_complete: true,
        occluded: false,
      }],
      hazards: [{
        kind: "lava",
        position: { x: 2, y: 63, z: -2 },
        distance_blocks: 1.25,
        bearing_degrees: 12,
        critical: true,
      }],
      movement_candidates: ["forward", "right", "back", "left"].map(
        (relative_direction, index) => ({
          cardinal_direction: ["south", "west", "north", "east"][index],
          relative_direction,
          target_feet_position: { x: index, y: 64, z: 0 },
          support_position: { x: index, y: 63, z: 0 },
          support_block: index === 0 ? "minecraft:stone" : "helix:unobserved",
          evidence_complete: index === 0,
          feet_clear: index === 0,
          head_clear: index === 0,
          drop_depth_blocks: index === 0 ? 0 : 7,
          drop_scan_complete: index === 0,
          nearby_hazard_count: 0,
          nearby_fluid_count: 0,
          safe_candidate: index === 0,
        }),
      ),
      navigation_frontier: {
        frontier_schema: "helix.minecraft_navigation_frontier.v1",
        planner: "casimirbot_native_bounded_dijkstra",
        movement_model: ["walk", "diagonal", "ascend", "descend"],
        origin: { x: 1, y: 64, z: -3 },
        horizontal_radius: 4,
        vertical_radius: 6,
        reachable_foothold_count: 12,
        evidence_complete: true,
        coverage_boundary_reached: false,
        route_step_limit_reached: false,
        ranked_frontiers: [{
          destination: { x: 1, y: 65, z: -2 },
          steps: [{
            from: { x: 1, y: 64, z: -3 },
            to: { x: 1, y: 65, z: -2 },
            movement: "ascend",
            cost: 16,
          }],
          cost: 16,
          displacement_blocks: 1.41,
          vertical_gain_blocks: 1,
          coverage_boundary: false,
        }],
        selection_authority: "runtime_codex",
      },
      inventory: {
        item_count: 1,
        slots: [{ slot: 0, item: "minecraft:iron_pickaxe", count: 1 }],
      },
      coverage: {
        horizontal_radius: 4,
        vertical_radius: 8,
        loaded_region_complete: false,
        unknown_cell_count: 153,
        entities_complete: true,
        projectiles_complete: true,
        hazards_complete: true,
        omitted_categories: ["client_screen", "manual_input"],
      },
      ui_state: {
        server_container_open: false,
        same_revision: false,
        client_screen_state: "unobserved",
        input_capture_known: false,
        input_activity: false,
        freshness: "unobserved",
      },
      world_rules: {
        keep_inventory: false,
      },
      semantic_fingerprint: `sha256:${"a".repeat(64)}`,
      connector_private_field: "must-not-leak",
    };
    const normalized = normalizeLegacyEnvironmentProbeResultForTests(
      result("perception_snapshot", { confidence: 0.95, details }),
    );
    const descriptor = readEnvironmentConnectorCapabilityDescriptor(
      HELIX_MINECRAFT_PERCEPTION_SNAPSHOT_READ_CAPABILITY,
    );

    expect(normalized).not.toHaveProperty("connector_private_field");
    expect(normalized).toMatchObject({
      observation_revision: 420,
      game_tick: 420,
      coverage: {
        loaded_region_complete: false,
        unknown_cell_count: 153,
        projectiles_complete: true,
      },
      projectiles: [{
        projectile_type_id: "minecraft:arrow",
        threat_classification: "collision",
        predicted_collision_tick: 12,
        evidence_complete: true,
        occluded: false,
      }],
      ui_state: {
        client_screen_state: "unobserved",
        input_capture_known: false,
        same_revision: false,
      },
      world_rules: {
        keep_inventory: false,
      },
      navigation_frontier: {
        planner: "casimirbot_native_bounded_dijkstra",
        reachable_foothold_count: 12,
        selection_authority: "runtime_codex",
        ranked_frontiers: [expect.objectContaining({
          vertical_gain_blocks: 1,
          steps: [expect.objectContaining({ movement: "ascend" })],
        })],
      },
    });
    expect(normalized.movement_candidates).toEqual(
      expect.arrayContaining([expect.objectContaining({
        relative_direction: "forward",
        drop_depth_blocks: 0,
        safe_candidate: true,
      })]),
    );
    expect(
      validateEnvironmentConnectorSchemaValue(
        descriptor!.output_schema,
        normalized,
      ),
    ).toEqual([]);
  });

  it.each([
    [
      "actor_status",
      {
        confidence: 0.98,
        details: {
          health: 18,
          max_health: 20,
          food_level: 14,
          saturation: 4.5,
          actor_label: "DatDamPig",
          game_mode: "survival",
          world: "minecraft:overworld",
          position: { x: 1.5, y: 64, z: -2.25 },
          yaw: 149.03,
          pitch: 10.95,
          looked_at_block: {
            block_id: "minecraft:note_block",
            position: { x: 1, y: 64, z: 2 },
            aim_position: { x: 1.5, y: 64.5, z: 2.5 },
            distance_blocks: 3.25,
            within_interaction_range: true,
            private_hit_payload: "must-not-leak",
          },
          status_flags: ["sprinting"],
          active_effects: [
            {
              effect: "minecraft:hunger",
              amplifier: 1,
              duration_ticks: 1200,
            },
          ],
          mechanics_state: {
            mod_id: "mr_crimson_curse",
            mod_version: "1.4.1",
            state_source: "allowlisted_scoreboard_observation",
            raw_command_output_included: false,
            raw_nbt_included: false,
            status: "observed",
            global_mass: 37,
            global_points: 45,
            infection_phase: 3,
            private_scoreboard_value: "must-not-leak",
          },
        },
      },
      {
        health: 18,
        max_health: 20,
        food_level: 14,
        saturation: 4.5,
        actor_label: "DatDamPig",
        game_mode: "survival",
        world: "minecraft:overworld",
        position: { x: 1.5, y: 64, z: -2.25 },
        yaw: 149.03,
        pitch: 10.95,
        looked_at_block: {
          block_id: "minecraft:note_block",
          position: { x: 1, y: 64, z: 2 },
          aim_position: { x: 1.5, y: 64.5, z: 2.5 },
          distance_blocks: 3.25,
          within_interaction_range: true,
        },
        status_flags: ["sprinting"],
          active_effects: [
          {
            effect: "minecraft:hunger",
            amplifier: 1,
            duration_ticks: 1200,
          },
        ],
      },
    ],
    [
      "nearby_entities",
      {
        confidence: 0.9,
        details: {
          entity_count: 1,
          entities: [
            {
              entity_type: "minecraft:zombie",
              entity_label: "Zombie",
              classification: "hostile",
              distance_blocks: 6.25,
              targeting_actor: true,
              health: 18,
              max_health: 20,
            },
          ],
          mechanics_state: {
            mod_id: "mr_crimson_curse",
            mod_version: "1.4.1",
            state_source: "allowlisted_scoreboard_observation",
            raw_command_output_included: false,
            raw_nbt_included: false,
            status: "observed",
            global_mass: 37,
            global_points: 45,
            infection_phase: 3,
          },
        },
      },
      {
        entity_count: 1,
        entities: [
          {
            entity_type: "minecraft:zombie",
            entity_label: "Zombie",
            classification: "hostile",
            distance_blocks: 6.25,
            targeting_actor: true,
            health: 18,
            max_health: 20,
          },
        ],
      },
    ],
    [
      "hazard_check",
      {
        hazard_present: true,
        confidence: 0.82,
        details: {
          hostile_entity_count: 2,
          nearest_hostile_distance_blocks: 4.5,
          environmental_hazard_block_count: 1,
          nearest_environmental_hazard_distance_blocks: 3.2,
          environmental_hazard_types: ["magma_block"],
          actor_on_fire: false,
          actor_freezing: false,
        },
      },
      {
        hazard_present: true,
        hostile_entity_count: 2,
        nearest_hostile_distance_blocks: 4.5,
        environmental_hazard_block_count: 1,
        nearest_environmental_hazard_distance_blocks: 3.2,
        environmental_hazard_types: ["magma_block"],
        actor_on_fire: false,
        actor_freezing: false,
      },
    ],
    [
      "local_map_summary",
      {
        confidence: 0.8,
        details: {
          sampled_floor_blocks: 81,
          solid_floor_blocks: 72,
          open_floor_blocks: 9,
          hazardous_floor_blocks: 1,
          liquid_floor_blocks: 0,
        },
      },
      {
        sampled_floor_blocks: 81,
        solid_floor_blocks: 72,
        open_floor_blocks: 9,
        hazardous_floor_blocks: 1,
        liquid_floor_blocks: 0,
      },
    ],
    [
      "spatial_region",
      {
        confidence: 0.99,
        details: {
          purpose: "fire_safety",
          center: { x: 10, y: 64, z: -4 },
          horizontal_radius: 1,
          vertical_radius: 1,
          sample_count: 27,
          bounds: {
            min: { x: 9, y: 63, z: -5 },
            max: { x: 11, y: 65, z: -3 },
          },
          palette: [{ block: "minecraft:stone_bricks", count: 26 }],
          columns: [
            {
              x: 10,
              z: -4,
              runs: [
                {
                  y_start: 63,
                  y_end: 65,
                  block: "minecraft:stone_bricks",
                  flags: ["solid"],
                },
              ],
            },
          ],
          anchors: [
            {
              kind: "hearth_base",
              block: "minecraft:netherrack",
              position: { x: 10, y: 63, z: -4 },
            },
          ],
          fireplace_candidates: [
            {
              base_position: { x: 10, y: 63, z: -4 },
              fire_position: { x: 10, y: 64, z: -4 },
              base_block: "minecraft:netherrack",
              flammable_within_two: 0,
              solid_nonflammable_enclosure: 4,
              replaceable_fire_cell: true,
              safe_candidate: true,
            },
          ],
        },
      },
      {
        purpose: "fire_safety",
        center: { x: 10, y: 64, z: -4 },
        horizontal_radius: 1,
        vertical_radius: 1,
        sample_count: 27,
        bounds: {
          min: { x: 9, y: 63, z: -5 },
          max: { x: 11, y: 65, z: -3 },
        },
        fireplace_candidates: [
          expect.objectContaining({ safe_candidate: true }),
        ],
      },
    ],
    [
      "line_of_sight",
      { line_of_sight: true, distance_blocks: 9.5, confidence: 0.85 },
      { line_of_sight: true, distance_blocks: 9.5 },
    ],
    [
      "crop_state",
      {
        crop_mature: false,
        confidence: 0.9,
        details: { block_type: "minecraft:wheat" },
      },
      { crop_mature: false, crop_type: "minecraft:wheat" },
    ],
    [
      "reachability",
      {
        feasible: true,
        reachable: false,
        distance_blocks: 8,
        confidence: 0.72,
      },
      {
        within_probe_radius: true,
        within_interaction_range: false,
        distance_blocks: 8,
      },
    ],
  ] as const)(
    "normalizes %s into the trusted northbound result shape",
    (probeType, payload, expected) => {
      expect(
        normalizeLegacyEnvironmentProbeResultForTests(
          result(probeType, payload),
        ),
      ).toMatchObject({
        result_summary: `${probeType} observation`,
        ...expected,
      });
    },
  );

  it.each(["target_unavailable", "target_ambiguous"] as const)(
    "preserves typed actor identity failure %s",
    (failureCode) => {
      const failed = result(
        "actor_status",
        {
          confidence: 0.2,
          details: { failure_code: failureCode },
        },
        "failed",
      );
      expect(outcomeForLegacyEnvironmentProbeResultForTests(failed)).toBe(
        failureCode,
      );
      expect(normalizeLegacyEnvironmentProbeResultForTests(failed)).toEqual({
        result_summary: "actor_status observation",
      });
    },
  );

  it("expands the bounded Fabric spatial wire encoding into trusted model evidence", () => {
    const normalized = normalizeLegacyEnvironmentProbeResultForTests(
      result("spatial_region", {
        confidence: 0.95,
        details: {
          purpose: "structure_planning",
          center: { x: 10, y: 64, z: -4 },
          horizontal_radius: 1,
          vertical_radius: 1,
          requested_length: 5,
          requested_height: 3,
          requested_orientation: "north_south",
          requested_relative_side: "west",
          sample_count: 27,
          bounds: {
            min: { x: 9, y: 63, z: -5 },
            max: { x: 11, y: 65, z: -3 },
          },
          palette: [
            { block: "minecraft:stone_bricks", count: 18 },
            { block: "minecraft:air", count: 9 },
          ],
          palette_complete: true,
          column_encoding: "relative_xz_relative_y_palette_flags_v1",
          columns: [
            {
              offset: [0, 0],
              runs: [
                { y: [-1, 0], p: 0, f: 4 },
                { y: [1, 1], p: 1, f: 17 },
              ],
            },
          ],
          columns_complete: false,
          retained_column_count: 1,
          omitted_column_count: 8,
          omitted_run_count: 2,
          omitted_palette_block_types: 0,
          wire_details_json_bytes: 1_024,
          anchors: [],
          anchors_complete: true,
          retained_anchor_count: 0,
          omitted_anchor_count: 0,
          fireplace_candidates: [],
          fireplace_candidates_complete: false,
          retained_fireplace_candidate_count: 0,
          omitted_fireplace_candidate_count: 2,
          build_line_candidates: [
            {
              orientation: "north_south",
              relative_side: "west",
              from: { x: 7, y: 64, z: -6 },
              to: { x: 7, y: 64, z: -2 },
              length: 5,
              minimum_clear_height: 4,
              minimum_actor_distance: 3,
              nearest_anchor_distance: 5,
              ground_blocks: ["minecraft:grass_block"],
              target_cells_replaceable: true,
              target_cells_air: true,
              ground_solid_nonhazardous: true,
              fluid_cells: 0,
              flammable_cells: 0,
              block_entity_cells: 0,
              safe_candidate: true,
            },
          ],
          build_line_candidates_complete: true,
          retained_build_line_candidate_count: 1,
          omitted_build_line_candidate_count: 0,
        },
      }),
    );

    expect(normalized).toMatchObject({
      column_encoding: "expanded_relative_xz_relative_y_palette_flags_v1",
      columns_complete: false,
      palette_complete: true,
      retained_column_count: 1,
      omitted_column_count: 8,
      omitted_run_count: 2,
      wire_details_json_bytes: 1_024,
      anchors_complete: true,
      retained_anchor_count: 0,
      omitted_anchor_count: 0,
      fireplace_candidates_complete: false,
      retained_fireplace_candidate_count: 0,
      omitted_fireplace_candidate_count: 2,
      retained_build_line_candidate_count: 1,
      omitted_build_line_candidate_count: 0,
      build_line_candidates_complete: true,
      requested_length: 5,
      requested_height: 3,
      requested_orientation: "north_south",
      requested_relative_side: "west",
      build_line_candidates: [
        expect.objectContaining({
          orientation: "north_south",
          relative_side: "west",
          length: 5,
          target_cells_air: true,
          safe_candidate: true,
        }),
      ],
      block_position_samples: [
        {
          block: "minecraft:stone_bricks",
          total_count: 18,
          positions: [
            { x: 10, y: 63, z: -4 },
            { x: 10, y: 64, z: -4 },
          ],
        },
      ],
      columns: [
        {
          x: 10,
          z: -4,
          runs: [
            {
              y_start: 63,
              y_end: 64,
              block: "minecraft:stone_bricks",
              flags: ["solid"],
            },
            {
              y_start: 65,
              y_end: 65,
              block: "minecraft:air",
              flags: ["air", "replaceable"],
            },
          ],
        },
      ],
    });
    const descriptor = readEnvironmentConnectorCapabilityDescriptor(
      HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
    );
    expect(descriptor).not.toBeNull();
    expect(
      validateEnvironmentConnectorSchemaValue(
        descriptor!.output_schema,
        normalized,
      ),
    ).toEqual([]);
  });

  it("normalizes exact geometry verification and recomputes terminal match flags", () => {
    const spatialDetails = {
      purpose: "structure_verification",
      center: { x: -39, y: 68, z: -12 },
      horizontal_radius: 7,
      vertical_radius: 8,
      sample_count: 3_825,
      bounds: {
        min: { x: -46, y: 60, z: -19 },
        max: { x: -32, y: 76, z: -5 },
      },
      palette: [{ block: "minecraft:stone_bricks", count: 15 }],
      palette_complete: true,
      column_encoding: "relative_xz_relative_y_palette_flags_v1",
      columns: [],
      columns_complete: true,
      retained_column_count: 0,
      omitted_column_count: 0,
      omitted_run_count: 0,
      omitted_palette_block_types: 0,
      wire_details_json_bytes: 2_000,
      anchors: [],
      anchors_complete: true,
      retained_anchor_count: 0,
      omitted_anchor_count: 0,
      fireplace_candidates: [],
      fireplace_candidates_complete: true,
      retained_fireplace_candidate_count: 0,
      omitted_fireplace_candidate_count: 0,
      build_line_candidates: [],
      build_line_candidates_complete: true,
      retained_build_line_candidate_count: 0,
      omitted_build_line_candidate_count: 0,
      target_geometry_verification: {
        from: { x: -46, y: 69, z: -16 },
        to: { x: -42, y: 71, z: -16 },
        expected_block: "minecraft:stone_bricks",
        total_cells: 15,
        sampled_cells: 15,
        matching_cells: 15,
        mismatched_cells: 0,
        unobserved_cells: 0,
        mismatch_samples: [],
        within_survey_bounds: true,
        complete: true,
        all_match: true,
      },
    };
    const normalized = normalizeLegacyEnvironmentProbeResultForTests(
      result("spatial_region", {
        confidence: 0.95,
        details: spatialDetails,
      }),
    );

    expect(normalized.target_geometry_verification).toEqual(
      expect.objectContaining({
        total_cells: 15,
        matching_cells: 15,
        complete: true,
        all_match: true,
      }),
    );
    const descriptor = readEnvironmentConnectorCapabilityDescriptor(
      HELIX_MINECRAFT_SPATIAL_REGION_INSPECT_CAPABILITY,
    );
    expect(
      validateEnvironmentConnectorSchemaValue(
        descriptor!.output_schema,
        normalized,
      ),
    ).toEqual([]);

    const inconsistent = normalizeLegacyEnvironmentProbeResultForTests(
      result("spatial_region", {
        confidence: 0.95,
        details: {
          ...spatialDetails,
          target_geometry_verification: {
            ...spatialDetails.target_geometry_verification,
            matching_cells: 14,
          },
        },
      }),
    );
    expect(inconsistent).not.toHaveProperty("target_geometry_verification");
  });

  it("normalizes a bounded live registry fact against its catalog schema", () => {
    const normalized = normalizeLegacyEnvironmentProbeResultForTests(
      result("registry_fact", {
        confidence: 1,
        details: {
          game_version: "1.21.8",
          registry_kind: "block",
          requested_resource_id: "minecraft:netherrack",
          registered: true,
          canonical_resource_id: "minecraft:netherrack",
          ignored_connector_field: "not admitted",
        },
      }),
    );
    const descriptor = readEnvironmentConnectorCapabilityDescriptor(
      HELIX_MINECRAFT_REGISTRY_FACT_READ_CAPABILITY,
    );

    expect(normalized).toEqual({
      result_summary: "registry_fact observation",
      game_version: "1.21.8",
      registry_kind: "block",
      requested_resource_id: "minecraft:netherrack",
      registered: true,
      canonical_resource_id: "minecraft:netherrack",
    });
    expect(
      validateEnvironmentConnectorSchemaValue(
        descriptor!.output_schema,
        normalized,
      ),
    ).toEqual([]);
  });

  it("normalizes bounded live recipe facts without admitting arbitrary payload", () => {
    const normalized = normalizeLegacyEnvironmentProbeResultForTests(
      result("recipe_fact", {
        confidence: 1,
        details: {
          game_version: "1.21.8",
          query_kind: "output_item_id",
          requested_resource_id: "minecraft:stone_bricks",
          match_count: 1,
          matches_complete: true,
          matches: [
            {
              recipe_id: "minecraft:stone_bricks",
              recipe_type: "minecraft:crafting",
              serializer_id: "minecraft:crafting_shaped",
              group: "",
              result_item_ids: ["minecraft:stone_bricks"],
              result_resolution_complete: true,
              arbitrary_recipe_json: { ignored: true },
            },
          ],
        },
      }),
    );
    const descriptor = readEnvironmentConnectorCapabilityDescriptor(
      HELIX_MINECRAFT_RECIPE_FACT_READ_CAPABILITY,
    );

    expect(normalized).toEqual({
      result_summary: "recipe_fact observation",
      game_version: "1.21.8",
      query_kind: "output_item_id",
      requested_resource_id: "minecraft:stone_bricks",
      match_count: 1,
      matches_complete: true,
      matches: [
        {
          recipe_id: "minecraft:stone_bricks",
          recipe_type: "minecraft:crafting",
          serializer_id: "minecraft:crafting_shaped",
          group: "",
          result_item_ids: ["minecraft:stone_bricks"],
          result_resolution_complete: true,
        },
      ],
    });
    expect(
      validateEnvironmentConnectorSchemaValue(
        descriptor!.output_schema,
        normalized,
      ),
    ).toEqual([]);
  });
});
