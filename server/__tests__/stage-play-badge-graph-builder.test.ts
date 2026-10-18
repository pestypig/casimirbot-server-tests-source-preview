import { describe, expect, it } from "vitest";
import playerOpened from "../../fixtures/environment-state/minecraft/player-equivalent-open-chest.snapshot.json";
import {
  isStagePlayBadgeGraphV1,
  validateStagePlayBadgeGraphV1,
} from "../../shared/contracts/stage-play-badge-graph.v1";
import { normalizeMinecraftPluginSnapshot } from "../services/situation-room/minecraft-plugin-snapshot-normalizer";
import { reduceEnvironmentAffordances } from "../services/situation-room/environment-affordance-reducer";
import { buildStagePlayBadgeGraph } from "../services/situation-room/stage-play-badge-graph-builder";
import { normalizeMinecraftSourceEvent } from "../services/live-source/normalize-minecraft-source-event";

describe("Stage Play Badge Graph builder", () => {
  it("builds a transient action-world graph from rich environment snapshot evidence", () => {
    const snapshot = normalizeMinecraftPluginSnapshot({
      snapshot: {
        ...playerOpened,
        snapshot_id: "snapshot:stage-play:rich-world",
        local_map: {
          sensor_scope: "sensor_observable",
          radius: 4,
          salient_cells: [
            {
              cell_ref: "cell:minecraft:the_end:1:63:1",
              cell_type: "minecraft:end_stone",
              position: { x: 1, y: 63, z: 1 },
              tags: ["traversability_sample", "walkable", "traversable", "adjacent_column"],
              state: {
                walkable: true,
                floor_type: "minecraft:end_stone",
                feet_type: "minecraft:air",
                head_type: "minecraft:air",
              },
              sensor_scope: "sensor_observable",
            },
          ],
          map_hash: "local-map-hash",
          changed_since_last_snapshot: true,
        },
        chunk_snapshot_summary: {
          sensor_scope: "sensor_observable",
          sampled_radius_chunks: 0,
          loaded_chunks_sampled: 1,
          surface_cells: [
            {
              cell_ref: "chunk_cell:minecraft:the_end:12:64:12",
              cell_type: "minecraft:end_stone",
              position: { x: 12, y: 64, z: 12 },
              tags: ["chunk_surface_sample", "walkable", "traversable", "bridge_like"],
              state: { walkable: true, bridge_like: true },
              sensor_scope: "sensor_observable",
            },
          ],
          route_corridor_cells: [
            {
              cell_ref: "chunk_cell:minecraft:the_end:16:64:16",
              cell_type: "minecraft:cobblestone",
              position: { x: 16, y: 64, z: 16 },
              tags: ["route_corridor", "bridge_like", "traversable"],
              state: { bridge_like: true },
              sensor_scope: "sensor_observable",
            },
          ],
          gateway_blocks: [
            {
              cell_ref: "chunk_cell:minecraft:the_end:20:75:20",
              cell_type: "minecraft:end_gateway",
              position: { x: 20, y: 75, z: 20 },
              tags: ["portal_or_gateway"],
              sensor_scope: "sensor_observable",
            },
          ],
          bridge_like_blocks: [
            {
              cell_ref: "chunk_cell:minecraft:the_end:16:64:16",
              cell_type: "minecraft:cobblestone",
              position: { x: 16, y: 64, z: 16 },
              tags: ["bridge_like"],
              sensor_scope: "sensor_observable",
            },
          ],
          hazard_cells: [
            {
              cell_ref: "chunk_cell:minecraft:the_end:18:64:18",
              cell_type: "minecraft:air",
              position: { x: 18, y: 64, z: 18 },
              tags: ["void_or_drop_risk"],
              sensor_scope: "sensor_observable",
            },
          ],
          map_hash: "chunk-map-hash",
          changed_since_last_snapshot: true,
          evidence_trust: "server_observation",
          instruction_authority: "none",
          ask_context_policy: "evidence_only",
          raw_chunk_included: false,
        },
      },
    });

    expect(snapshot).not.toBeNull();
    const affordanceContext = reduceEnvironmentAffordances(snapshot!);
    const graph = buildStagePlayBadgeGraph({
      environmentState: snapshot!,
      affordanceContext,
      objective: "return through the gateway without falling",
      now: "2026-06-02T12:00:00.000Z",
    });

    expect(validateStagePlayBadgeGraphV1(graph)).toEqual([]);
    expect(isStagePlayBadgeGraphV1(graph)).toBe(true);
    expect(graph.artifactId).toBe("stage_play_badge_graph");
    expect(graph.schemaVersion).toBe("stage_play_badge_graph/v1");
    expect(graph.sourceWindow.latestSnapshotRefs).toEqual(["snapshot:stage-play:rich-world"]);
    expect(graph.sourceWindow.roomId).toBe(snapshot!.room_id);
    expect(graph.badges.map((badge) => badge.id)).toEqual(
      expect.arrayContaining([
        "affordance:move_through_traversable_cells",
        "affordance:use_bridge_like_blocks",
        "affordance:inspect_gateway_or_portal",
        "blocked:move_into_hazard_cells",
        "binding:bridge_path",
        "binding:tactical_retreat",
      ]),
    );
    expect(graph.badges.find((badge) => badge.id === "affordance:inspect_gateway_or_portal")).toMatchObject({
      kind: "affordance",
      status: "ask_user_required",
      admission: "ask_user",
    });
    expect(graph.badges.find((badge) => badge.id === "blocked:move_into_hazard_cells")).toMatchObject({
      kind: "blocked_affordance",
      status: "blocked",
      admission: "blocked",
    });
    expect(graph.badges.find((badge) => badge.id === "binding:bridge_path")?.intentModule?.verb).toBe("bridge");
    expect(graph.badges.find((badge) => badge.id === "binding:tactical_retreat")?.intentModule?.verb).toBe("retreat");
    expect(graph.badges.some((badge) =>
      badge.liveBindings.some((binding) => binding.bindingKind === "portal_or_gateway"),
    )).toBe(true);
    expect(graph.badges.some((badge) =>
      badge.liveBindings.some((binding) => binding.bindingKind === "hazard_cell"),
    )).toBe(true);
    expect(graph.edges.map((edge) => edge.relation)).toEqual(
      expect.arrayContaining(["enables", "produces", "blocks", "sourced_by"]),
    );
    expect(graph.recommendedActions.map((action) => action.actionType)).toEqual(
      expect.arrayContaining(["explain_candidate", "blocked_move_notice"]),
    );
    expect(graph.recommendedActions.every((action) => action.agentExecutable === false)).toBe(true);
    expect(graph.summary.affordanceCount).toBeGreaterThanOrEqual(3);
    expect(graph.summary.blockedAffordanceCount).toBe(1);
    expect(graph.summary.proceduralBindingCount).toBeGreaterThanOrEqual(2);
    expect(graph.badges.map((badge) => badge.id)).toEqual(
      expect.arrayContaining(["binding:bridge_path", "binding:tactical_retreat"]),
    );
    expect(graph.authority).toMatchObject({
      assistant_answer: false,
      raw_content_included: false,
      raw_payload_included: false,
      terminal_eligible: false,
      agent_executable: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
      instruction_authority: "none",
      ask_instruction_authority: "none",
    });
  });

  it("keeps LiveSourceObservation compact and links it as source-window evidence", () => {
    const snapshot = normalizeMinecraftPluginSnapshot({
      snapshot: {
        ...playerOpened,
        snapshot_id: "snapshot:stage-play:compact-live-source",
      },
    });
    const observation = normalizeMinecraftSourceEvent({
      source_id: "source:minecraft-server",
      room_id: "room:minecraft-minehut",
      environment_id: "env:minecraft",
      observed_at: "2026-06-02T12:00:00.000Z",
      position: { x: 12, y: 64, z: -4, dimension: "minecraft:the_end" },
      evidence_refs: [snapshot!.snapshot_id],
      now: new Date("2026-06-02T12:00:01.000Z"),
    });

    expect(observation.payload_summary?.position).toEqual({
      x: 12,
      y: 64,
      z: -4,
      dimension: "minecraft:the_end",
    });
    expect(observation.payload_summary).not.toHaveProperty("local_map");
    expect(observation.payload_summary).not.toHaveProperty("chunk_snapshot_summary");

    const graph = buildStagePlayBadgeGraph({
      environmentState: snapshot!,
      liveSourceObservations: [observation],
      now: "2026-06-02T12:00:02.000Z",
    });

    expect(validateStagePlayBadgeGraphV1(graph)).toEqual([]);
    expect(graph.sourceWindow.latestObservationRefs).toEqual([observation.observation_id]);
    expect(graph.sourceWindow.latestSnapshotRefs).toEqual([snapshot!.snapshot_id]);
    expect(JSON.stringify(graph)).toContain(observation.observation_id);
    expect(JSON.stringify(graph)).toContain(snapshot!.snapshot_id);
    expect(graph.authority.agent_executable).toBe(false);
    expect(graph.recommendedActions.every((action) => action.agentExecutable === false)).toBe(true);
  });
});
