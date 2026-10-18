import { describe, expect, it } from "vitest";
import { createMinecraftRouteObjective } from "@shared/helix-minecraft-route-objective";
import type { HelixWorldEvent } from "@shared/helix-world-event";
import { buildEndReturnRouteRehearsal } from "../services/situation-room/minecraft-end-return-route-builder";
import { reduceMinecraftRouteObjectiveLifecycle } from "../services/situation-room/minecraft-route-lifecycle-reducer";

const now = "2026-05-31T12:00:00.000Z";

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
  updated_at: now,
});

const rehearsal = buildEndReturnRouteRehearsal({
  objective,
  current_position: { dimension: "minecraft:the_end", x: 1000, y: 70, z: 1000 },
  observed_gateway_candidate: { dimension: "minecraft:the_end", x: 1040, y: 75, z: 980 },
  bridge_overlay_observed: true,
  ender_pearl_known_available: true,
  respawn_location_known: true,
  evidence_refs: ["route:context"],
  ts: now,
});

const event = (overrides: Partial<HelixWorldEvent>): HelixWorldEvent => ({
  schema: "helix.world_event.v1",
  world_id: "minecraft:paper-server",
  room_id: "room:minecraft",
  source_id: "source:minecraft-paper-plugin",
  actor_id: "minecraft:player:datdampig",
  actor_label: "DatDamPig",
  ts: "2026-05-31T12:00:02.000Z",
  event_type: "player_location_sample",
  location: { dimension: "minecraft:the_end", x: 1040, y: 75, z: 980 },
  evidence_refs: ["event:location"],
  ...overrides,
});

describe("Minecraft route lifecycle reducer", () => {
  it("records gateway reach as a stage receipt without completing the objective", () => {
    const reduced = reduceMinecraftRouteObjectiveLifecycle({
      objective,
      rehearsal,
      event: event({}),
    });

    expect(reduced.objective.lifecycle).toBe("active");
    expect(reduced.objective.intent_status).toBe("confirmed");
    expect(reduced.receipt.reason).toBe("gateway_reached");
    expect(reduced.receipt.route_stage_status).toBe("gateway_reached");
    expect(reduced.receipt.instruction_authority).toBe("none");
    expect(reduced.receipt.ask_context_policy).toBe("evidence_only");
    expect(reduced.receipt.creates_ask_turn).toBe(false);
  });

  it("stales the objective when the player dies", () => {
    const reduced = reduceMinecraftRouteObjectiveLifecycle({
      objective,
      rehearsal,
      event: event({
        event_type: "player_death",
        location: { dimension: "minecraft:the_end", x: 1004, y: 30, z: 1002 },
        evidence_refs: ["event:death"],
      }),
    });

    expect(reduced.objective.lifecycle).toBe("stale");
    expect(reduced.objective.intent_status).toBe("cancelled");
    expect(reduced.receipt.reason).toBe("player_death");
    expect(reduced.receipt.route_stage_status).toBe("stale");
    expect(reduced.receipt.raw_user_text_included).toBe(false);
  });

  it("completes return-home objective on transition back to the Overworld", () => {
    const reduced = reduceMinecraftRouteObjectiveLifecycle({
      objective,
      rehearsal,
      event: event({
        event_type: "dimension_transition",
        location: { dimension: "minecraft:overworld", x: 0, y: 64, z: 0 },
        meta: { from_dimension: "minecraft:the_end", to_dimension: "minecraft:overworld" },
        evidence_refs: ["event:overworld"],
      }),
    });

    expect(reduced.objective.lifecycle).toBe("completed");
    expect(reduced.objective.intent_status).toBe("completed");
    expect(reduced.receipt.reason).toBe("dimension_transition_to_overworld");
    expect(reduced.receipt.route_stage_status).toBe("completed");
    expect(reduced.receipt.context_role).toBe("tool_evidence");
  });
});
