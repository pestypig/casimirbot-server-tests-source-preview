import { describe, expect, it } from "vitest";
import type { HelixWorldEvent } from "@shared/helix-world-event";
import { normalizeMinecraftWorldEventToSignal } from "../services/situation-room/minecraft-event-normalizer";
import { buildSituationSemanticEvents } from "../services/situation-room/situation-semantic-dictionary";

const buildSignal = (event: HelixWorldEvent) =>
  normalizeMinecraftWorldEventToSignal({ event, signalId: `signal:${event.event_type}` });

describe("situation semantic dictionary", () => {
  it("maps oak log acquisition to resource gathering and wood goal clues", () => {
    const event: HelixWorldEvent = {
      schema: "helix.world_event.v1",
      world_id: "minecraft:minehut",
      room_id: "room:minecraft",
      source_id: "source:minecraft-server",
      ts: "2026-05-06T10:00:00.000Z",
      actor_id: "player:datdampig",
      actor_label: "DatDamPig",
      event_type: "item_acquired",
      inventory_delta: { item: "minecraft:oak_log", count: 1 },
      evidence_refs: ["mc:item:oak_log"],
    };

    const [semantic] = buildSituationSemanticEvents({ event, signal: buildSignal(event) });

    expect(semantic).toMatchObject({
      schema: "helix.situation_semantic_event.v1",
      verb: "gathered",
      object: "oak log",
      tags: expect.arrayContaining(["resource_gathering", "goal_progress"]),
      goal_clues: expect.arrayContaining(["gather_wood", "craft_tools", "build_shelter"]),
      evidence_refs: ["mc:item:oak_log"],
    });
  });

  it("keeps location samples low-noise travel semantics", () => {
    const event: HelixWorldEvent = {
      schema: "helix.world_event.v1",
      world_id: "minecraft:minehut",
      room_id: "room:minecraft",
      source_id: "source:minecraft-server",
      ts: "2026-05-06T10:00:01.000Z",
      actor_id: "player:datdampig",
      actor_label: "DatDamPig",
      event_type: "player_location_sample",
      location: { dimension: "minecraft:overworld", x: 10, y: 64, z: -4 },
      evidence_refs: ["mc:location:1"],
    };

    const [semantic] = buildSituationSemanticEvents({ event, signal: buildSignal(event) });

    expect(semantic.tags).toEqual(["travel"]);
    expect(semantic.goal_clues).toEqual([]);
    expect(semantic.risk_clues).toEqual([]);
  });

  it("maps low-health damage to risk semantics", () => {
    const event: HelixWorldEvent = {
      schema: "helix.world_event.v1",
      world_id: "minecraft:minehut",
      room_id: "room:minecraft",
      source_id: "source:minecraft-server",
      ts: "2026-05-06T10:00:02.000Z",
      actor_id: "player:datdampig",
      actor_label: "DatDamPig",
      event_type: "player_damage",
      health_delta: { current_health: 4 },
      evidence_refs: ["mc:damage:1"],
      meta: { hostile_nearby: true },
    };

    const [semantic] = buildSituationSemanticEvents({ event, signal: buildSignal(event) });

    expect(semantic.tags).toEqual(expect.arrayContaining(["risk", "combat"]));
    expect(semantic.risk_clues).toEqual(expect.arrayContaining(["low_health", "hostile_nearby"]));
  });
});
