import { describe, expect, it } from "vitest";
import { normalizeMinecraftSourceEvent } from "../services/live-source/normalize-minecraft-source-event";

describe("LiveSourceObservation", () => {
  it("normalizes Minecraft route state as evidence only", () => {
    const observation = normalizeMinecraftSourceEvent({
      thread_id: "thread:live-source",
      source_id: "minecraft:local",
      observed_at: "2026-05-27T10:00:00.000Z",
      now: new Date("2026-05-27T10:00:01.000Z"),
      position: { x: 10, y: 64, z: -20, dimension: "overworld" },
      route_state: { status: "on_route", target: "base", distance_from_route: 0 },
      evidence_refs: ["minecraft:event:1"],
    });

    expect(observation.schema).toBe("helix.live_source_observation.v1");
    expect(observation.source_kind).toBe("minecraft_world_events");
    expect(observation.event_kind).toBe("route_state");
    expect(observation.freshness.status).toBe("fresh");
    expect(observation.payload_summary?.route_state?.status).toBe("on_route");
    expect(observation.assistant_answer).toBe(false);
    expect(observation.raw_content_included).toBe(false);
  });
});
