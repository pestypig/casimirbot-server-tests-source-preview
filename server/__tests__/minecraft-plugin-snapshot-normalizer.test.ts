import { beforeEach, describe, expect, it } from "vitest";
import playerOpened from "../../fixtures/environment-state/minecraft/player-equivalent-open-chest.snapshot.json";
import privilegedClosed from "../../fixtures/environment-state/minecraft/privileged-closed-chest.snapshot.json";
import rawNbtRejected from "../../fixtures/environment-state/minecraft/raw-nbt-rejected.snapshot.json";
import outOfOrder from "../../fixtures/environment-state/minecraft/out-of-order-tick.snapshot.json";
import {
  ingestMinecraftPluginSnapshot,
  normalizeMinecraftPluginSnapshot,
  resetMinecraftPluginSnapshotNormalizerForTest,
} from "../services/situation-room/minecraft-plugin-snapshot-normalizer";
import { auditEnvironmentSourceContract } from "../services/situation-room/environment-source-contract-validator";
import { reduceEnvironmentAffordances } from "../services/situation-room/environment-affordance-reducer";
import { resetEnvironmentStateSnapshotWindowsForTest } from "../services/situation-room/environment-state-snapshot-window";

describe("Minecraft plugin snapshot normalizer", () => {
  beforeEach(() => {
    resetMinecraftPluginSnapshotNormalizerForTest();
    resetEnvironmentStateSnapshotWindowsForTest();
  });

  it("preserves player memory and privileged server sensor scope", () => {
    const player = normalizeMinecraftPluginSnapshot({ snapshot: playerOpened });
    const privileged = normalizeMinecraftPluginSnapshot({ snapshot: privilegedClosed });

    expect(player?.object_state?.nearby_containers?.[0]?.sensor_scope).toBe("player_memory");
    expect(privileged?.object_state?.nearby_containers?.[0]?.sensor_scope).toBe("privileged_server_state");
  });

  it("keeps raw NBT quarantined by contract audit", () => {
    const snapshot = normalizeMinecraftPluginSnapshot({ snapshot: rawNbtRejected });
    const audit = auditEnvironmentSourceContract({ subject: rawNbtRejected });

    expect(snapshot).toBeNull();
    expect(audit.ok).toBe(false);
    expect(audit.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "raw_nbt_included" }),
      ]),
    );
  });

  it("suppresses out-of-order source ticks", () => {
    ingestMinecraftPluginSnapshot({ snapshot: { ...playerOpened, source_tick: 100 } });
    const result = ingestMinecraftPluginSnapshot({ snapshot: outOfOrder });

    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/out_of_order/i);
  });

  it("preserves enriched nearby entity evidence without granting instruction authority", () => {
    const snapshot = normalizeMinecraftPluginSnapshot({
      snapshot: {
        ...playerOpened,
        object_state: {
          ...(playerOpened.object_state ?? {}),
          nearby_entities: [
            {
              object_ref: "entity:creeper",
              object_type: "minecraft:creeper",
              position: { x: 10, y: 64, z: 10 },
              velocity: { x: 0.1, y: 0, z: -0.2 },
              facing: "north",
              yaw: 180,
              pitch: 0,
              distance: 5,
              bounding_box: {
                min: { x: 9.7, y: 64, z: 9.7 },
                max: { x: 10.3, y: 65.8, z: 10.3 },
              },
              classification: ["hostile"],
              tags: ["hostile", "creeper"],
              state: { on_ground: true, fire_ticks: 0, passenger_count: 0 },
              living: { health: 20, max_health: 20, equipment_summary: [] },
              mob_ai: { target_ref: "entity:player", target_type: "minecraft:player", aware: true },
              threat: { threat_level: "warning", threat_reasons: ["hostile_entity", "close_range"] },
              evidence_trust: "server_observation",
              instruction_authority: "none",
              ask_context_policy: "evidence_only",
              raw_nbt_included: false,
              sensor_scope: "sensor_observable",
            },
          ],
        },
      },
    });

    const entity = snapshot?.object_state?.nearby_entities?.[0];
    expect(entity?.velocity).toEqual({ x: 0.1, y: 0, z: -0.2 });
    expect(entity?.classification).toContain("hostile");
    expect(entity?.threat?.threat_level).toBe("warning");
    expect(entity?.instruction_authority).toBe("none");
    expect(entity?.ask_context_policy).toBe("evidence_only");
    expect(entity?.raw_nbt_included).toBe(false);
  });

  it("preserves traversability local-map cells", () => {
    const snapshot = normalizeMinecraftPluginSnapshot({
      snapshot: {
        ...playerOpened,
        local_map: {
          sensor_scope: "sensor_observable",
          radius: 4,
          salient_cells: [
            {
              cell_ref: "cell:minecraft:overworld:1:63:1",
              cell_type: "minecraft:end_stone",
              position: { x: 1, y: 63, z: 1 },
              tags: ["traversability_sample", "walkable", "adjacent_column"],
              state: {
                walkable: true,
                step_up_candidate: false,
                blocked: false,
                floor_type: "minecraft:end_stone",
                feet_type: "minecraft:air",
                head_type: "minecraft:air",
              },
              sensor_scope: "sensor_observable",
            },
          ],
          map_hash: "hash",
          changed_since_last_snapshot: true,
        },
      },
    });

    const cell = snapshot?.local_map?.salient_cells?.[0];
    expect(snapshot?.local_map?.radius).toBe(4);
    expect(cell?.tags).toContain("walkable");
    expect(cell?.state?.walkable).toBe(true);
    expect(cell?.state?.floor_type).toBe("minecraft:end_stone");
  });

  it("preserves chunk snapshot summaries as server observation evidence", () => {
    const snapshot = normalizeMinecraftPluginSnapshot({
      snapshot: {
        ...playerOpened,
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
              state: {
                walkable: true,
                bridge_like: true,
                surface_type: "minecraft:end_stone",
                above_type: "minecraft:air",
                below_type: "minecraft:air",
              },
              sensor_scope: "sensor_observable",
            },
          ],
          route_corridor_cells: [
            {
              cell_ref: "chunk_cell:minecraft:the_end:16:64:16",
              cell_type: "minecraft:cobblestone",
              position: { x: 16, y: 64, z: 16 },
              tags: ["chunk_surface_sample", "route_corridor", "bridge_like", "traversable"],
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
          map_hash: "chunk-hash",
          changed_since_last_snapshot: true,
          evidence_trust: "server_observation",
          instruction_authority: "none",
          ask_context_policy: "evidence_only",
          raw_chunk_included: false,
        },
      },
    });

    const summary = snapshot?.chunk_snapshot_summary;
    const cell = summary?.surface_cells?.[0];
    expect(summary?.sampled_radius_chunks).toBe(0);
    expect(summary?.loaded_chunks_sampled).toBe(1);
    expect(summary?.instruction_authority).toBe("none");
    expect(summary?.ask_context_policy).toBe("evidence_only");
    expect(summary?.raw_chunk_included).toBe(false);
    expect(cell?.tags).toContain("bridge_like");
    expect(cell?.state?.surface_type).toBe("minecraft:end_stone");
    expect(summary?.route_corridor_cells?.[0]?.tags).toContain("route_corridor");
    expect(summary?.gateway_blocks?.[0]?.cell_type).toBe("minecraft:end_gateway");
    expect(summary?.bridge_like_blocks?.[0]?.cell_type).toBe("minecraft:cobblestone");
    expect(summary?.hazard_cells?.[0]?.tags).toContain("void_or_drop_risk");

    const affordances = reduceEnvironmentAffordances(snapshot!);
    expect(affordances.traversable).toContain("minecraft:end_stone");
  });

  it("preserves route-state pointers without granting instruction authority", () => {
    const snapshot = normalizeMinecraftPluginSnapshot({
      snapshot: {
        ...playerOpened,
        route_state: {
          active_objective_id: "objective:return-home",
          latest_rehearsal_id: "rehearsal:end-return",
          latest_drift_event_id: "drift:west",
          route_status: "wrong_direction_candidate",
          policy_surface_status: "not_candidate",
          updated_at: "2026-05-19T18:35:00.000Z",
          evidence_refs: ["rehearsal:end-return", "drift:west"],
          instruction_authority: "none",
          ask_context_policy: "evidence_only",
          raw_content_included: false,
        },
      },
    });

    expect(snapshot?.route_state?.active_objective_id).toBe("objective:return-home");
    expect(snapshot?.route_state?.latest_rehearsal_id).toBe("rehearsal:end-return");
    expect(snapshot?.route_state?.route_status).toBe("wrong_direction_candidate");
    expect(snapshot?.route_state?.instruction_authority).toBe("none");
    expect(snapshot?.route_state?.ask_context_policy).toBe("evidence_only");
    expect(snapshot?.route_state?.raw_content_included).toBe(false);
  });
});
