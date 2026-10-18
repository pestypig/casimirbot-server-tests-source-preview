import { describe, expect, it } from "vitest";
import { createMinecraftRouteObjective } from "@shared/helix-minecraft-route-objective";
import { buildEndReturnRouteRehearsal } from "../services/situation-room/minecraft-end-return-route-builder";

const objective = createMinecraftRouteObjective({
  objective_id: "objective:return-home",
  room_id: "room:minecraft",
  world_id: "minecraft:paper-server",
  actor_label: "DatDamPig",
  intent_label: "return_home_from_end",
  intent_status: "confirmed",
  lifecycle: "active",
  created_from: "ambient_voice_intent",
  target_chain: [],
  confidence: 0.72,
  evidence_refs: ["voice:intent:return-home"],
  model_invoked_by_helix: false,
  updated_at: "2026-05-31T12:00:00.000Z",
});

describe("Minecraft End-return route builder", () => {
  it("uses chunk gateway and bridge overlay evidence instead of only a boolean route hint", () => {
    const rehearsal = buildEndReturnRouteRehearsal({
      objective,
      current_position: { dimension: "minecraft:the_end", x: 1000, y: 70, z: 1000 },
      chunk_surface_cells: [
        {
          dimension: "minecraft:the_end",
          x: 1040,
          y: 75,
          z: 980,
          block_type: "minecraft:end_gateway",
          tags: ["chunk_surface_sample", "portal_or_gateway"],
          evidence_refs: ["chunk:gateway"],
        },
        {
          dimension: "minecraft:the_end",
          x: 1004,
          y: 70,
          z: 998,
          block_type: "minecraft:cobblestone",
          tags: ["chunk_surface_sample", "bridge_like", "traversable"],
          evidence_refs: ["chunk:bridge"],
        },
      ],
      block_delta_overlay_cells: [{
        dimension: "minecraft:the_end",
        x: 1004,
        y: 70,
        z: 998,
        block_type: "minecraft:cobblestone",
        tags: ["bridge_like"],
        evidence_refs: ["overlay:bridge"],
      }],
      bridge_overlay_observed: false,
      ender_pearl_known_available: true,
      respawn_location_known: true,
      evidence_refs: ["route:context"],
      ts: "2026-05-31T12:00:02.000Z",
    });

    expect(rehearsal.result_status).toBe("route_candidate_found");
    expect(rehearsal.candidate_next_waypoint).toMatchObject({
      dimension: "minecraft:the_end",
      x: 1040,
      z: 980,
      confidence: 0.68,
    });
    expect(rehearsal.route_confidence).toBeGreaterThan(0.8);
    expect(rehearsal.stages[0]?.route_basis).toEqual(expect.arrayContaining([
      "observed_current_world",
      "persisted_block_delta_overlay",
    ]));
    expect(rehearsal.evidence_refs).toEqual(expect.arrayContaining([
      "chunk:gateway",
      "chunk:bridge",
      "overlay:bridge",
    ]));
    expect(rehearsal.instruction_authority).toBe("none");
    expect(rehearsal.ask_context_policy).toBe("evidence_only");
    expect(rehearsal.creates_ask_turn).toBe(false);
  });

  it("does not invent a gateway when chunk and overlay evidence only show bridge blocks", () => {
    const rehearsal = buildEndReturnRouteRehearsal({
      objective,
      current_position: { dimension: "minecraft:the_end", x: 1000, y: 70, z: 1000 },
      chunk_surface_cells: [{
        dimension: "minecraft:the_end",
        x: 1004,
        y: 70,
        z: 998,
        block_type: "minecraft:cobblestone",
        tags: ["bridge_like", "traversable"],
        evidence_refs: ["chunk:bridge"],
      }],
      block_delta_overlay_cells: [{
        dimension: "minecraft:the_end",
        x: 1004,
        y: 70,
        z: 998,
        block_type: "minecraft:cobblestone",
        tags: ["bridge_like"],
        evidence_refs: ["overlay:bridge"],
      }],
      bridge_overlay_observed: false,
      ender_pearl_known_available: null,
      respawn_location_known: false,
      evidence_refs: ["route:context"],
      ts: "2026-05-31T12:00:02.000Z",
    });

    expect(rehearsal.result_status).toBe("not_enough_evidence");
    expect(rehearsal.candidate_next_waypoint).toBeNull();
    expect(rehearsal.missing_evidence_codes).toContain("no_gateway_candidate");
    expect(rehearsal.missing_evidence_codes).toContain("no_observed_gateway");
    expect(JSON.stringify(rehearsal)).not.toContain("1100");
  });
});
