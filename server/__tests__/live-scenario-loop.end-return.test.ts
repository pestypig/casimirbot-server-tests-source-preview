import { beforeEach, describe, expect, it } from "vitest";
import { createRecordingAskTurnSink } from "../services/situation-room/ask-turn-sink";
import { runLiveScenarioLoop } from "../services/situation-room/live-scenario-loop";
import {
  queryMinecraftNavigationState,
  resetMinecraftNavigationStateStoreForTest,
} from "../services/situation-room/minecraft-navigation-state-store";

describe("live scenario loop End-return evidence integration", () => {
  beforeEach(() => {
    resetMinecraftNavigationStateStoreForTest();
  });

  it("uses route context cells as evidence without creating an ambient Ask turn", () => {
    const { sink, requests } = createRecordingAskTurnSink();
    const result = runLiveScenarioLoop({
      scenario_kind: "minecraft_route_monitor",
      askTurnSink: sink,
      now: "2026-05-31T12:00:00.000Z",
      events: [
        {
          kind: "transcript",
          transcript_id: "transcript:return-home",
          thread_id: "thread:minecraft",
          room_id: "room:minecraft",
          world_id: "minecraft:paper-server",
          text: "we need to get home from the End",
          transcript_mode: "ambient",
        },
        {
          kind: "minecraft_route_context",
          current_position: { dimension: "minecraft:the_end", x: 1000, y: 70, z: 1000 },
          chunk_surface_cells: [{
            dimension: "minecraft:the_end",
            x: 1040,
            y: 75,
            z: 980,
            block_type: "minecraft:end_gateway",
            tags: ["portal_or_gateway"],
            evidence_refs: ["chunk:gateway"],
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
          ender_pearl_known_available: true,
          respawn_location_known: true,
          evidence_refs: ["route:context"],
        },
      ],
    });

    expect(requests).toHaveLength(0);
    expect(result.objective?.creates_ask_turn).toBe(false);
    expect(result.rehearsal?.result_status).toBe("route_candidate_found");
    expect(result.rehearsal?.candidate_next_waypoint?.x).toBe(1040);
    expect(result.rehearsal?.evidence_refs).toEqual(expect.arrayContaining(["chunk:gateway", "overlay:bridge"]));
    expect(result.rehearsal?.instruction_authority).toBe("none");
    expect(result.ask_pack.raw_transcript_included).toBe(false);
    expect(result.ask_pack.items.every((item) => item.instruction_authority === "none")).toBe(true);
  });

  it("applies lifecycle events without creating hidden Ask turns", () => {
    const { sink, requests } = createRecordingAskTurnSink();
    const result = runLiveScenarioLoop({
      scenario_kind: "minecraft_route_monitor",
      askTurnSink: sink,
      now: "2026-05-31T12:00:05.000Z",
      events: [
        {
          kind: "transcript",
          transcript_id: "transcript:return-home",
          thread_id: "thread:minecraft",
          room_id: "room:minecraft",
          world_id: "minecraft:paper-server",
          text: "we need to get home from the End",
          transcript_mode: "ambient",
        },
        {
          kind: "minecraft_route_context",
          current_position: { dimension: "minecraft:the_end", x: 1000, y: 70, z: 1000 },
          observed_gateway_candidate: { dimension: "minecraft:the_end", x: 1040, y: 75, z: 980 },
          bridge_overlay_observed: true,
          ender_pearl_known_available: true,
          respawn_location_known: true,
          evidence_refs: ["route:context"],
        },
        {
          kind: "minecraft_world_event",
          event: {
            schema: "helix.world_event.v1",
            world_id: "minecraft:paper-server",
            room_id: "room:minecraft",
            source_id: "source:minecraft-paper-plugin",
            actor_id: "minecraft:player:datdampig",
            actor_label: "DatDamPig",
            ts: "2026-05-31T12:00:04.000Z",
            event_type: "player_death",
            location: { dimension: "minecraft:the_end", x: 1002, y: 20, z: 1002 },
            evidence_refs: ["event:death"],
          },
        },
      ],
    });

    expect(requests).toHaveLength(0);
    expect(result.objective?.lifecycle).toBe("stale");
    expect(result.objective?.intent_status).toBe("cancelled");
    expect(result.lifecycle_receipts[0]).toMatchObject({
      reason: "player_death",
      route_stage_status: "stale",
      instruction_authority: "none",
      ask_context_policy: "evidence_only",
      creates_ask_turn: false,
    });
    expect(queryMinecraftNavigationState({
      roomId: "room:minecraft",
      actorLabel: "DatDamPig",
    }).navigation_state).toMatchObject({
      route_status: "stale_route",
      route_lifecycle_status: "stale",
      route_intent_status: "cancelled",
    });
    expect(result.referral).toMatchObject({
      referral_type: "minecraft_route_assist",
      reason_code: "player_death_route_invalidated",
      instruction_authority: "none",
      ask_instruction_authority: "none",
      context_role: "operator_referral",
      creates_ask_turn: false,
      turn_triggered: false,
    });
    expect(result.ask_pack.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        schema: "helix.minecraft_route_lifecycle_receipt.v1",
        context_role: "tool_evidence",
        instruction_authority: "none",
        ask_instruction_authority: "none",
        fields: expect.objectContaining({
          reason: "player_death",
          next_lifecycle: "stale",
          next_intent_status: "cancelled",
        }),
      }),
    ]));
    expect(JSON.stringify(result.ask_pack)).not.toContain("Turn around");
  });
});
