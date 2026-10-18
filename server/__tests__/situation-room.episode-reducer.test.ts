import { describe, expect, it } from "vitest";
import type { HelixWorldEvent } from "@shared/helix-world-event";
import {
  narrateSituationEpisode,
  predictFromSituationEpisode,
  reduceSituationEpisodes,
} from "../services/situation-room/situation-episode-reducer";

const base = {
  schema: "helix.world_event.v1" as const,
  room_id: "room:minecraft-minehut",
  source_id: "source:minecraft-server",
  world_id: "minecraft:minehut",
  actor_id: "player:datdampig",
  actor_label: "DatDamPig",
};

const event = (partial: Partial<HelixWorldEvent> & Pick<HelixWorldEvent, "event_type" | "ts">): HelixWorldEvent => ({
  ...base,
  evidence_refs: [`mc:${partial.event_type}:${partial.ts}`],
  ...partial,
});

describe("situation episode reducer", () => {
  it("groups dirt, surface transition, salmon handling, and damage into one episode", () => {
    const events: HelixWorldEvent[] = [
      event({
        event_type: "block_broken",
        ts: "2026-05-07T12:00:00.000Z",
        location: { dimension: "minecraft:overworld", x: 1, y: 58, z: 1 },
        meta: { block_id: "minecraft:dirt" },
      }),
      event({
        event_type: "item_acquired",
        ts: "2026-05-07T12:00:01.000Z",
        location: { dimension: "minecraft:overworld", x: 1, y: 58, z: 1 },
        inventory_delta: { item_id: "minecraft:dirt", count: 1 },
      }),
      event({
        event_type: "player_location_sample",
        ts: "2026-05-07T12:00:05.000Z",
        location: { dimension: "minecraft:overworld", x: 3, y: 69, z: 1 },
      }),
      event({
        event_type: "item_dropped",
        ts: "2026-05-07T12:00:07.000Z",
        location: { dimension: "minecraft:overworld", x: 3, y: 69, z: 1 },
        inventory_delta: { item_id: "minecraft:salmon", count: -1 },
      }),
      event({
        event_type: "player_damage",
        ts: "2026-05-07T12:00:09.000Z",
        location: { dimension: "minecraft:overworld", x: 4, y: 69, z: 1 },
        health_delta: { current_health: 4 },
        meta: { simulated: true },
      }),
    ];

    const episodes = reduceSituationEpisodes({
      roomId: base.room_id,
      worldId: base.world_id,
      events,
    });

    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({
      schema: "helix.situation_episode.v1",
      episode_type: "combat_risk",
      actor_label: "DatDamPig",
    });
    expect(episodes[0].summary_seed).toContain("dug dirt");
    expect(episodes[0].summary_seed).toContain("surfaced");
    expect(episodes[0].summary_seed).toContain("salmon");
    expect(episodes[0].summary_seed).toContain("4 health");

    const narration = narrateSituationEpisode(episodes[0]);
    expect(narration).toMatchObject({
      schema: "helix.situation_episode_narration.v1",
      perspective: "third_person",
    });
    expect(narration.text).toContain("salmon");

    const predictions = predictFromSituationEpisode(episodes[0]);
    expect(predictions[0]).toMatchObject({
      schema: "helix.situation_prediction.v1",
      predicted_goal: "survive immediate danger",
    });
  });

  it("does not emit episodes for routine location samples only", () => {
    const events: HelixWorldEvent[] = [
      event({
        event_type: "player_location_sample",
        ts: "2026-05-07T12:00:00.000Z",
        location: { dimension: "minecraft:overworld", x: 1, y: 66, z: 1 },
      }),
      event({
        event_type: "player_location_sample",
        ts: "2026-05-07T12:00:05.000Z",
        location: { dimension: "minecraft:overworld", x: 2, y: 66, z: 2 },
      }),
    ];

    expect(
      reduceSituationEpisodes({
        roomId: base.room_id,
        worldId: base.world_id,
        events,
      }),
    ).toEqual([]);
  });
});
