import { beforeEach, describe, expect, it } from "vitest";
import { createMinecraftRouteObjective } from "@shared/helix-minecraft-route-objective";
import { buildEndReturnRouteRehearsal } from "../services/situation-room/minecraft-end-return-route-builder";
import { reduceMinecraftRouteObjectiveLifecycle } from "../services/situation-room/minecraft-route-lifecycle-reducer";
import {
  queryMinecraftNavigationState,
  recordMinecraftNavigationEvidence,
  recordMinecraftNavigationLifecycleFromWorldEvent,
  recordMinecraftRouteLifecycleReceipt,
  resetMinecraftNavigationStateStoreForTest,
} from "../services/situation-room/minecraft-navigation-state-store";

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

const rehearsal = buildEndReturnRouteRehearsal({
  objective,
  current_position: { dimension: "minecraft:the_end", x: 1000, y: 70, z: 1000 },
  observed_gateway_candidate: { dimension: "minecraft:the_end", x: 1040, y: 75, z: 980 },
  bridge_overlay_observed: true,
  ender_pearl_known_available: true,
  respawn_location_known: true,
  evidence_refs: ["route:context"],
  ts: "2026-05-31T12:00:00.000Z",
});

describe("Minecraft navigation lifecycle state", () => {
  beforeEach(() => {
    resetMinecraftNavigationStateStoreForTest();
  });

  it("persists completed lifecycle receipts into queryable navigation state", () => {
    const reduction = reduceMinecraftRouteObjectiveLifecycle({
      objective,
      rehearsal,
      event: {
        schema: "helix.world_event.v1",
        world_id: "minecraft:paper-server",
        room_id: "room:minecraft",
        source_id: "source:minecraft-paper-plugin",
        actor_label: "DatDamPig",
        ts: "2026-05-31T12:00:04.000Z",
        event_type: "dimension_transition",
        location: { dimension: "minecraft:overworld", x: 0, y: 64, z: 0 },
        meta: { from_dimension: "minecraft:the_end", to_dimension: "minecraft:overworld" },
        evidence_refs: ["event:overworld"],
      },
    });

    const state = recordMinecraftRouteLifecycleReceipt(reduction.receipt);
    const query = queryMinecraftNavigationState({ roomId: "room:minecraft", actorLabel: "DatDamPig" });

    expect(state.route_status).toBe("completed");
    expect(state.route_lifecycle_status).toBe("completed");
    expect(state.route_intent_status).toBe("completed");
    expect(state.latest_lifecycle_receipt_id).toBe(reduction.receipt.receipt_id);
    expect(state.latest_objective_id).toBe(objective.objective_id);
    expect(state.latest_rehearsal_id).toBe(rehearsal.route_rehearsal_id);
    expect(query.navigation_state?.route_status).toBe("completed");
    expect(query.navigation_state?.instruction_authority).toBe("none");
    expect(query.navigation_state?.creates_ask_turn).toBe(false);
  });

  it("persists stale lifecycle receipts for death invalidation", () => {
    const reduction = reduceMinecraftRouteObjectiveLifecycle({
      objective,
      rehearsal,
      event: {
        schema: "helix.world_event.v1",
        world_id: "minecraft:paper-server",
        room_id: "room:minecraft",
        source_id: "source:minecraft-paper-plugin",
        actor_label: "DatDamPig",
        ts: "2026-05-31T12:00:04.000Z",
        event_type: "player_death",
        location: { dimension: "minecraft:the_end", x: 1000, y: 20, z: 1000 },
        evidence_refs: ["event:death"],
      },
    });

    const state = recordMinecraftRouteLifecycleReceipt(reduction.receipt);

    expect(state.route_status).toBe("stale_route");
    expect(state.route_lifecycle_status).toBe("stale");
    expect(state.route_intent_status).toBe("cancelled");
    expect(state.ask_context_policy).toBe("evidence_only");
    expect(state.raw_user_text_included).toBe(false);
  });

  it("records lifecycle invalidation from production world events when a route is active", () => {
    recordMinecraftNavigationEvidence({
      routeRehearsal: {
        schema: "helix.minecraft_route_rehearsal.v1",
        rehearsal_id: "route_rehearsal:return-home",
        objective_id: "objective:return-home",
        room_id: "room:minecraft",
        world_id: "minecraft:paper-server",
        actor_label: "DatDamPig",
        route_kind: "return_home_from_end",
        candidate_next_waypoint: {
          label: "return End gateway",
          dimension: "minecraft:the_end",
          x: 1040,
          y: 75,
          z: 980,
          confidence: 0.75,
        },
        route_basis: ["observed_current_world"],
        evidence_refs: ["route:context"],
      } as any,
      now: "2026-05-31T12:00:00.000Z",
    });

    const receipt = recordMinecraftNavigationLifecycleFromWorldEvent({
      event: {
        schema: "helix.world_event.v1",
        world_id: "minecraft:paper-server",
        room_id: "room:minecraft",
        source_id: "source:minecraft-paper-plugin",
        actor_label: "DatDamPig",
        ts: "2026-05-31T12:00:04.000Z",
        event_type: "player_death",
        location: { dimension: "minecraft:the_end", x: 1000, y: 20, z: 1000 },
        evidence_refs: ["event:death"],
      },
    });
    const query = queryMinecraftNavigationState({ roomId: "room:minecraft", actorLabel: "DatDamPig" });

    expect(receipt?.reason).toBe("player_death");
    expect(receipt?.creates_ask_turn).toBe(false);
    expect(query.navigation_state?.route_status).toBe("stale_route");
    expect(query.navigation_state?.route_lifecycle_status).toBe("stale");
    expect(query.navigation_state?.route_intent_status).toBe("cancelled");
  });

  it("records End-return completion from production dimension transition events", () => {
    recordMinecraftNavigationEvidence({
      routeRehearsal: {
        schema: "helix.minecraft_route_rehearsal.v1",
        rehearsal_id: "route_rehearsal:return-home",
        objective_id: "objective:return-home",
        room_id: "room:minecraft",
        world_id: "minecraft:paper-server",
        actor_label: "DatDamPig",
        route_kind: "return_home_from_end",
        candidate_next_waypoint: {
          label: "return End gateway",
          dimension: "minecraft:the_end",
          x: 1040,
          y: 75,
          z: 980,
          confidence: 0.75,
        },
        route_basis: ["observed_current_world"],
        evidence_refs: ["route:context"],
      } as any,
      now: "2026-05-31T12:00:00.000Z",
    });

    const receipt = recordMinecraftNavigationLifecycleFromWorldEvent({
      event: {
        schema: "helix.world_event.v1",
        world_id: "minecraft:paper-server",
        room_id: "room:minecraft",
        source_id: "source:minecraft-paper-plugin",
        actor_label: "DatDamPig",
        ts: "2026-05-31T12:00:04.000Z",
        event_type: "dimension_transition",
        location: { dimension: "minecraft:overworld", x: 0, y: 64, z: 0 },
        meta: { from_dimension: "minecraft:the_end", to_dimension: "minecraft:overworld" },
        evidence_refs: ["event:overworld"],
      },
    });
    const query = queryMinecraftNavigationState({ roomId: "room:minecraft", actorLabel: "DatDamPig" });

    expect(receipt?.reason).toBe("dimension_transition_to_overworld");
    expect(query.navigation_state?.route_status).toBe("completed");
    expect(query.navigation_state?.route_lifecycle_status).toBe("completed");
    expect(query.navigation_state?.route_intent_status).toBe("completed");
  });
});
