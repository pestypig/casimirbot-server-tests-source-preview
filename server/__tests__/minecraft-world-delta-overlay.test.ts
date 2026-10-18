import { beforeEach, describe, expect, it } from "vitest";
import type { HelixMinecraftSpatialEvent } from "@shared/helix-minecraft-spatial-event";
import {
  getMinecraftWorldDeltaOverlay,
  persistMinecraftWorldDeltaOverlay,
  reduceMinecraftWorldDeltaOverlay,
  resetMinecraftWorldDeltaOverlaysForTest,
} from "../services/situation-room/minecraft-world-delta-overlay";

const spatialBlockEvent = (
  eventType: "block_placed" | "block_broken",
  x: number,
  z: number,
): HelixMinecraftSpatialEvent => ({
  schema: "helix.minecraft_spatial_event.v1",
  event_id: `event:${eventType}:${x}:${z}`,
  room_id: "room:minecraft",
  world_id: "minecraft:paper-server",
  source_id: "source:minecraft-paper-plugin",
  actor_id: "minecraft:player:dan",
  actor_label: "dan",
  event_type: eventType,
  dimension: "minecraft:the_end",
  location: { x, y: 64, z },
  block: {
    before: eventType === "block_placed" ? "minecraft:air" : "minecraft:cobblestone",
    after: eventType === "block_placed" ? "minecraft:cobblestone" : "minecraft:air",
    target: "minecraft:cobblestone",
    face: null,
  },
  player_pose: { yaw: null, pitch: null, facing: null },
  environment: { light_level: null, biome: null, nearby_fluids: [], nearby_hostiles: [] },
  inventory_delta: null,
  evidence_refs: [`ref:${eventType}:${x}:${z}`],
  ts: `2026-05-31T00:00:0${x - 1}.000Z`,
  context_policy: "compact_context_pack_only",
  raw_logs_included: false,
});

describe("Minecraft world delta overlay persistence", () => {
  beforeEach(() => {
    resetMinecraftWorldDeltaOverlaysForTest();
  });

  it("persists block deltas by chunk so bridge evidence survives later events", () => {
    const first = persistMinecraftWorldDeltaOverlay(
      reduceMinecraftWorldDeltaOverlay(spatialBlockEvent("block_placed", 1, 1)),
    );
    const second = persistMinecraftWorldDeltaOverlay(
      reduceMinecraftWorldDeltaOverlay(spatialBlockEvent("block_placed", 2, 2)),
    );
    const persisted = getMinecraftWorldDeltaOverlay({
      roomId: "room:minecraft",
      worldId: "minecraft:paper-server",
      dimension: "minecraft:the_end",
      chunk: { x: 0, z: 0 },
    });

    expect(first?.block_deltas).toHaveLength(1);
    expect(second?.block_deltas).toHaveLength(2);
    expect(persisted?.block_deltas.map((delta) => [delta.x, delta.z])).toEqual([[1, 1], [2, 2]]);
    expect(persisted?.instruction_authority).toBe("none");
    expect(persisted?.ask_context_policy).toBe("evidence_only");
    expect(persisted?.creates_ask_turn).toBe(false);
  });
});
