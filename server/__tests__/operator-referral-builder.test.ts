import { describe, expect, it } from "vitest";
import { createMinecraftRouteObjective } from "@shared/helix-minecraft-route-objective";
import { buildEndReturnRouteRehearsal } from "../services/situation-room/minecraft-end-return-route-builder";
import { buildRouteAssistOperatorReferral } from "../services/situation-room/operator-referral-builder";

const objective = createMinecraftRouteObjective({
  objective_id: "objective:return-home",
  room_id: "room:minecraft",
  world_id: "minecraft:paper",
  actor_label: "DatDamPig",
  intent_label: "return_home_from_end",
  intent_status: "confirmed",
  lifecycle: "active",
  created_from: "ambient_voice_intent",
  target_chain: [],
  confidence: 0.72,
  evidence_refs: ["voice:intent"],
  model_invoked_by_helix: false,
  updated_at: "2026-05-31T12:00:00.000Z",
});

const safetyExpectations = {
  instruction_authority: "none",
  ask_instruction_authority: "none",
  ask_context_policy: "operator_only",
  context_role: "operator_referral",
  creates_ask_turn: false,
  turn_triggered: false,
  raw_user_text_included: false,
  raw_transcript_included: false,
  raw_image_included: false,
  raw_audio_included: false,
  model_invoked: false,
};

describe("route assist operator referral builder", () => {
  it("refers player death route invalidation without Ask authority", () => {
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

    const referral = buildRouteAssistOperatorReferral({
      thread_id: "thread:minecraft",
      objective: { ...objective, lifecycle: "stale", intent_status: "cancelled" },
      rehearsal,
      lifecycle_receipts: [{
        schema: "helix.minecraft_route_lifecycle_receipt.v1",
        receipt_id: "lifecycle:death",
        objective_id: objective.objective_id,
        route_rehearsal_id: rehearsal.route_rehearsal_id,
        room_id: objective.room_id,
        world_id: objective.world_id,
        actor_label: objective.actor_label,
        reason: "player_death",
        previous_lifecycle: "active",
        next_lifecycle: "stale",
        previous_intent_status: "confirmed",
        next_intent_status: "cancelled",
        route_stage_status: "stale",
        evidence_refs: ["event:death"],
        instruction_authority: "none",
        ask_instruction_authority: "none",
        ask_context_policy: "evidence_only",
        context_role: "tool_evidence",
        creates_ask_turn: false,
        turn_triggered: false,
        raw_user_text_included: false,
        model_invoked: false,
        derived_by_deterministic_reducer: true,
        ts: "2026-05-31T12:00:02.000Z",
      }],
    });

    expect(referral).toMatchObject({
      ...safetyExpectations,
      referral_type: "minecraft_route_assist",
      reason_code: "player_death_route_invalidated",
      operator_action: "review_or_surface_guidance",
    });
    expect(referral?.evidence_refs).toEqual(expect.arrayContaining(["lifecycle:death", "event:death"]));
  });

  it("refers missing gateway evidence before low-confidence generic review", () => {
    const rehearsal = buildEndReturnRouteRehearsal({
      objective,
      current_position: { dimension: "minecraft:the_end", x: 1000, y: 70, z: 1000 },
      bridge_overlay_observed: false,
      ender_pearl_known_available: null,
      respawn_location_known: true,
      evidence_refs: ["route:no-gateway"],
      ts: "2026-05-31T12:00:00.000Z",
    });

    const referral = buildRouteAssistOperatorReferral({
      thread_id: "thread:minecraft",
      objective,
      rehearsal,
      drift: {
        schema: "helix.minecraft_route_drift_event.v1",
        drift_event_id: "drift:unknown",
        route_rehearsal_id: rehearsal.route_rehearsal_id,
        room_id: objective.room_id,
        world_id: objective.world_id,
        current_position: { dimension: "minecraft:the_end", x: 1000, y: 70, z: 1000 },
        heading_error_degrees: 0,
        distance_delta_blocks: 0,
        sample_count: 0,
        sample_window_ms: 0,
        drift_status: "unknown",
        stale_reason: "no_candidate_next_waypoint",
        salience_candidate: false,
        should_surface: false,
        evidence_refs: [rehearsal.route_rehearsal_id],
        normalized_by_deterministic_reducer: true,
        model_invoked_by_helix: false,
        instruction_authority: "none",
        ask_instruction_authority: "none",
        ask_context_policy: "evidence_only",
        context_role: "tool_evidence",
        creates_ask_turn: false,
        turn_triggered: false,
        raw_user_text_included: false,
        raw_transcript_included: false,
        raw_image_included: false,
        raw_caption_included: false,
        ask_admissible: true,
        ts: "2026-05-31T12:00:02.000Z",
      },
    });

    expect(referral).toMatchObject({
      ...safetyExpectations,
      reason_code: "return_route_unknown_gateway",
      operator_action: "request_missing_evidence",
    });
  });

  it("refers void-adjacent route risk", () => {
    const rehearsal = buildEndReturnRouteRehearsal({
      objective,
      current_position: { dimension: "minecraft:the_end", x: 1000, y: 70, z: 1000 },
      observed_gateway_candidate: { dimension: "minecraft:the_end", x: 1040, y: 75, z: 980 },
      block_delta_overlay_cells: [{
        dimension: "minecraft:the_end",
        x: 1004,
        y: 70,
        z: 998,
        block_type: "minecraft:cobblestone",
        tags: ["bridge_like", "void_edge"],
        evidence_refs: ["overlay:bridge:void"],
      }],
      bridge_overlay_observed: true,
      ender_pearl_known_available: true,
      respawn_location_known: true,
      evidence_refs: ["route:void"],
      ts: "2026-05-31T12:00:00.000Z",
    });

    const referral = buildRouteAssistOperatorReferral({
      thread_id: "thread:minecraft",
      objective,
      rehearsal,
    });

    expect(referral).toMatchObject({
      ...safetyExpectations,
      reason_code: "void_risk_on_route",
      operator_action: "review_or_surface_guidance",
    });
  });
});
