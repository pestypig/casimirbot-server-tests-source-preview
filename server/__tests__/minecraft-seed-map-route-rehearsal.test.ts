import { beforeEach, describe, expect, it } from "vitest";
import type { HelixWorldEvent } from "@shared/helix-world-event";
import { createLiveAnswerEnvironment, resetLiveAnswerEnvironments } from "../services/situation-room/live-answer-environment-store";
import {
  buildMinecraftSeedMapQueryFromWorldEvent,
  FixtureMinecraftSeedMapProvider,
} from "../services/situation-room/minecraft-seed-map-provider";
import { reduceMinecraftSpatialGraph } from "../services/situation-room/minecraft-spatial-graph";
import { rehearseMinecraftRoute } from "../services/situation-room/minecraft-route-rehearsal";
import {
  getMinecraftRouteDriftStateForTest,
  reduceMinecraftRouteDrift,
  resetMinecraftRouteDriftStateForTest,
} from "../services/situation-room/minecraft-route-drift";
import { buildMinecraftRouteObjective } from "../services/situation-room/minecraft-route-objective";
import { normalizeMinecraftRouteSolverObservation } from "../services/situation-room/minecraft-route-solver-observation";
import {
  normalizeMinecraftRoutePlannerObservation,
  routeSolverObservationAdapterCapabilities,
} from "../services/situation-room/minecraft-route-planner-observation-normalizer";
import { reduceMinecraftWorldDeltaOverlay } from "../services/situation-room/minecraft-world-delta-overlay";
import {
  ingestWorldEvent,
  resetWorldEventIngestState,
} from "../services/situation-room/world-event-ingest";
import { getLatestEnvironmentStateSnapshot } from "../services/situation-room/environment-state-snapshot-window";
import { recordMinecraftNavigationEvidence } from "../services/situation-room/minecraft-navigation-state-store";
import { resetSituationThreadBindings } from "../services/situation-room/thread-binding-store";

const locationEvent = (): HelixWorldEvent => ({
  schema: "helix.world_event.v1",
  world_id: "minecraft:seeded-local",
  room_id: "room:minecraft-seed-map",
  source_id: "source:minecraft-server",
  ts: "2026-05-20T12:00:00.000Z",
  actor_id: "player:datdampig",
  actor_label: "DatDamPig",
  event_type: "player_location_sample",
  location: { dimension: "minecraft:overworld", x: 0, y: 68, z: 0 },
  evidence_refs: ["mc:event:seeded-location"],
  meta: {
    seed: "123456789",
    minecraft_version: "1.21.4",
    edition: "java",
    seed_map: {
      radius_chunks: 64,
      selected_target_label: "village",
    },
  },
});

describe("Minecraft seed map route rehearsal", () => {
  beforeEach(() => {
    resetWorldEventIngestState();
    resetSituationThreadBindings();
    resetLiveAnswerEnvironments();
  });

  it("emits caveated seed-map claims that are not player knowledge", () => {
    const event = locationEvent();
    const query = buildMinecraftSeedMapQueryFromWorldEvent({ event });
    const result = new FixtureMinecraftSeedMapProvider().querySeedMap(query!);
    const structure = result.claims.find((claim) => claim.kind === "structure_candidate");

    expect(structure).toMatchObject({
      evidence_layer: "seed_forecast",
      evidence_trust: "seed_forecast",
      instruction_authority: "none",
      ask_context_policy: "evidence_only",
      source: "seed_worldgen",
      sensor_scope: "sensor_observable",
      may_support_recommendation: false,
      raw_user_text_included: false,
      derived_by_deterministic_reducer: true,
      model_invoked: false,
      creates_ask_turn: false,
      turn_triggered: false,
      ask_instruction_authority: "none",
      context_role: "tool_evidence",
    });
    expect(structure?.limitations).toEqual(expect.arrayContaining([
      "not player-observed",
      "version-sensitive",
      "target_y_unknown",
      "seed/version mismatch possible",
      "generated baseline may differ from current player-modified world",
    ]));
    expect(structure?.position.y).toBeNull();
  });

  it("builds a spatial graph with seed candidates and missing-Y caveats", () => {
    const event = locationEvent();
    const query = buildMinecraftSeedMapQueryFromWorldEvent({ event });
    const result = new FixtureMinecraftSeedMapProvider().querySeedMap(query!);
    const graph = reduceMinecraftSpatialGraph({
      roomId: event.room_id,
      worldId: event.world_id,
      spatialEvent: {
        schema: "helix.minecraft_spatial_event.v1",
        event_id: "minecraft_spatial_event:test",
        room_id: event.room_id,
        world_id: event.world_id,
        source_id: event.source_id!,
        actor_id: event.actor_id,
        actor_label: event.actor_label,
        event_type: "player_location_sample",
        dimension: "minecraft:overworld",
        location: { x: 0, y: 68, z: 0 },
        block: null,
        player_pose: null,
        environment: null,
        inventory_delta: null,
        evidence_refs: event.evidence_refs,
        ts: event.ts,
        context_policy: "compact_context_pack_only",
        raw_logs_included: false,
      },
      seedClaims: result.claims,
      selectedTargetLabel: query?.selected_target_label,
    });

    expect(graph?.nodes.some((node) => node.kind === "structure_candidate" && node.sensor_scope === "sensor_observable")).toBe(true);
    expect(graph?.nodes.find((node) => node.kind === "current_position")?.evidence_layer).toBe("observed_current_world");
    expect(graph?.nodes.find((node) => node.kind === "structure_candidate")?.evidence_layer).toBe("seed_forecast");
    expect(graph?.edges[0]?.missing_evidence.join(" ")).toMatch(/No Y coordinate/i);
    expect(graph?.nodes.find((node) => node.kind === "structure_candidate")?.may_support_recommendation).toBe(false);
  });

  it("produces deterministic compact route rehearsal and lowers confidence for unknown terrain", () => {
    const event = locationEvent();
    const query = buildMinecraftSeedMapQueryFromWorldEvent({ event });
    const seedResult = new FixtureMinecraftSeedMapProvider().querySeedMap(query!);
    const spatialEvent = {
      schema: "helix.minecraft_spatial_event.v1" as const,
      event_id: "minecraft_spatial_event:deterministic",
      room_id: event.room_id,
      world_id: event.world_id,
      source_id: event.source_id!,
      actor_id: event.actor_id,
      actor_label: event.actor_label,
      event_type: "player_location_sample" as const,
      dimension: "minecraft:overworld",
      location: { x: 0, y: 68, z: 0 },
      evidence_refs: event.evidence_refs,
      ts: event.ts,
      context_policy: "compact_context_pack_only" as const,
      raw_logs_included: false as const,
    };
    const graph = reduceMinecraftSpatialGraph({
      roomId: event.room_id,
      worldId: event.world_id,
      spatialEvent,
      seedClaims: seedResult.claims,
      selectedTargetLabel: query?.selected_target_label,
    });
    const first = rehearseMinecraftRoute({ graph, actorLabel: "DatDamPig" });
    const second = rehearseMinecraftRoute({ graph, actorLabel: "DatDamPig" });

    expect(second).toEqual(first);
    expect(first?.steps.length).toBeLessThanOrEqual(3);
    expect(first).toMatchObject({
      evidence_trust: "route_math",
      instruction_authority: "none",
      ask_context_policy: "evidence_only",
      raw_user_text_included: false,
      derived_by_deterministic_reducer: true,
      model_invoked: false,
      creates_ask_turn: false,
      turn_triggered: false,
      ask_instruction_authority: "none",
      context_role: "tool_evidence",
    });
    expect(first?.route_summary_scope).toBe("ui_candidate_only");
    expect(first?.ask_context_admissible).toBe(false);
    expect(first?.missing_evidence_codes).toContain("route_corridor_unobserved");
    expect(first?.stages[0]?.route_basis).toEqual(expect.arrayContaining(["observed_current_world", "seed_forecast"]));
    expect(first?.route_summary).toMatch(/Candidate|Likely|Unknown/);
    expect(first?.route_summary).not.toMatch(/\bgo there\b/i);
    expect(first?.missing_evidence.join(" ")).toMatch(/block-level terrain/i);
    expect(first?.reachable_confidence).toBeLessThan(seedResult.claims.find((claim) => claim.kind === "structure_candidate")!.confidence);
  });

  it("updates live rehearsal lines while leaving recommendation gated", async () => {
    createLiveAnswerEnvironment({
      thread_id: "thread:seed-map",
      created_turn_id: "turn:seed-map",
      objective: "watch my Minecraft run",
      room_id: "room:minecraft-seed-map",
      source_ids: ["source:minecraft-server"],
      preset: "minecraft_run_monitor",
      now: "2026-05-20T11:59:00.000Z",
    });

    const result = await ingestWorldEvent(locationEvent(), {
      threadId: "thread:seed-map",
      turnId: "turn:seed-map",
    });
    const lines = result.live_answer_environment?.lines_by_key ?? {};

    expect(result.minecraft_route_rehearsal?.route_summary).toMatch(/candidate|likely|unknown/i);
    expect(lines.rehearsal?.value).toMatch(/candidate|likely|unknown/i);
    expect(lines.rehearsal?.value).not.toMatch(/\bgo\b/i);
    expect(lines.possibilities?.value).toMatch(/Candidate waypoint/i);
    expect(lines.unknowns?.value).toMatch(/not player-observed|No block-level terrain|Y coordinate/i);
    expect(lines.recommendation?.value).toBe("Awaiting companion policy gate.");
    expect(lines.recommendation?.value).not.toMatch(/\bgo\b/i);
  });

  it("records route lifecycle invalidation in the world-event ingest path", async () => {
    await ingestWorldEvent(locationEvent(), { appendToThread: false });

    const result = await ingestWorldEvent(
      {
        ...locationEvent(),
        ts: "2026-05-20T12:00:05.000Z",
        event_type: "player_death",
        location: { dimension: "minecraft:overworld", x: 12, y: 60, z: 12 },
        evidence_refs: ["mc:event:death"],
      },
      { appendToThread: false },
    );

    expect(result.minecraft_route_lifecycle_receipt).toMatchObject({
      schema: "helix.minecraft_route_lifecycle_receipt.v1",
      reason: "player_death",
      next_lifecycle: "stale",
      next_intent_status: "cancelled",
      instruction_authority: "none",
      ask_instruction_authority: "none",
      ask_context_policy: "evidence_only",
      context_role: "tool_evidence",
      creates_ask_turn: false,
      turn_triggered: false,
    });
  });

  it("derives route-corridor chunk facts from active navigation state", async () => {
    recordMinecraftNavigationEvidence({
      routeRehearsal: {
        schema: "helix.minecraft_route_rehearsal.v1",
        rehearsal_id: "route_rehearsal:corridor",
        objective_id: "objective:corridor",
        room_id: "room:minecraft-seed-map",
        world_id: "minecraft:seeded-local",
        actor_label: "DatDamPig",
        route_kind: "return_home_from_end",
        from: { dimension: "minecraft:overworld", x: 0, y: 68, z: 0 },
        to: { x: 20, y: 68, z: 20 },
        target_label: "gateway candidate",
        target_claim: null,
        route_summary: "Candidate route",
        steps: [],
        stages: [],
        candidate_next_waypoint: {
          label: "gateway candidate",
          dimension: "minecraft:overworld",
          x: 20,
          y: 68,
          z: 20,
          confidence: 0.7,
        },
        route_confidence: 0.7,
        reachable_confidence: 0.7,
        route_basis: ["observed_current_world"],
        missing_evidence: [],
        evidence_refs: ["route:corridor"],
        evidence_trust: "route_math",
        instruction_authority: "none",
        ask_context_policy: "evidence_only",
        creates_ask_turn: false,
        turn_triggered: false,
        ask_instruction_authority: "none",
        context_role: "tool_evidence",
        raw_user_text_included: false,
        derived_by_deterministic_reducer: true,
        normalized_by_deterministic_reducer: true,
        deterministic: true,
        model_invoked: false,
        model_invoked_by_helix: false,
        raw_logs_included: false,
        context_policy: "compact_context_pack_only",
        ts: "2026-05-20T12:00:00.000Z",
      } as any,
      now: "2026-05-20T12:00:00.000Z",
    });

    await ingestWorldEvent({
      schema: "helix.world_event.v1",
      world_id: "minecraft:seeded-local",
      room_id: "room:minecraft-seed-map",
      source_id: "source:minecraft-server",
      ts: "2026-05-20T12:00:01.000Z",
      actor_id: "player:datdampig",
      actor_label: "DatDamPig",
      event_type: "environment_state_snapshot",
      evidence_refs: ["mc:event:environment-snapshot"],
      meta: {
        snapshot: {
          schema: "helix.environment_state_snapshot.v1",
          snapshot_id: "environment_snapshot:route-corridor",
          domain: "minecraft",
          domain_adapter: "minecraft.paper_plugin.v1",
          room_id: "room:minecraft-seed-map",
          world_id: "minecraft:seeded-local",
          source_id: "source:minecraft-server",
          actor_id: "player:datdampig",
          actor_label: "DatDamPig",
          ts: "2026-05-20T12:00:01.000Z",
          actor_state: {
            sensor_scope: "player_observable",
            pose: {
              position: { x: 0, y: 68, z: 0 },
              yaw: 0,
              pitch: 0,
              facing: "south",
            },
          },
          chunk_snapshot_summary: {
            sensor_scope: "sensor_observable",
            sampled_radius_chunks: 1,
            loaded_chunks_sampled: 1,
            surface_cells: [
              {
                cell_ref: "chunk_cell:minecraft:overworld:8:68:8",
                cell_type: "minecraft:cobblestone",
                position: { x: 8, y: 68, z: 8 },
                tags: ["chunk_surface_sample", "traversable", "bridge_like"],
                sensor_scope: "sensor_observable",
              },
              {
                cell_ref: "chunk_cell:minecraft:overworld:16:68:16",
                cell_type: "minecraft:end_gateway",
                position: { x: 16, y: 68, z: 16 },
                tags: ["portal_or_gateway"],
                sensor_scope: "sensor_observable",
              },
              {
                cell_ref: "chunk_cell:minecraft:overworld:20:68:18",
                cell_type: "minecraft:air",
                position: { x: 20, y: 68, z: 18 },
                tags: ["void_or_drop_risk"],
                sensor_scope: "sensor_observable",
              },
              {
                cell_ref: "chunk_cell:minecraft:overworld:80:68:-80",
                cell_type: "minecraft:dirt",
                position: { x: 80, y: 68, z: -80 },
                tags: ["traversable"],
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
          section_hashes: {},
          changed_sections: ["chunk_snapshot_summary"],
          domain_specific: { minecraft: { raw_nbt_included: false } },
          evidence_refs: ["snapshot:route-corridor"],
          deterministic: true,
          model_invoked: false,
          assistant_answer: false,
          raw_payload_included: false,
          context_policy: "compact_context_pack_only",
        },
      },
    }, { appendToThread: false });

    const latest = getLatestEnvironmentStateSnapshot("room:minecraft-seed-map");
    const summary = latest?.chunk_snapshot_summary;

    expect(summary?.route_corridor_cells?.map((cell) => cell.cell_ref)).toEqual(expect.arrayContaining([
      "chunk_cell:minecraft:overworld:8:68:8",
      "chunk_cell:minecraft:overworld:16:68:16",
      "chunk_cell:minecraft:overworld:20:68:18",
    ]));
    expect(summary?.route_corridor_cells?.map((cell) => cell.cell_ref)).not.toContain("chunk_cell:minecraft:overworld:80:68:-80");
    expect(summary?.gateway_blocks?.[0]?.cell_type).toBe("minecraft:end_gateway");
    expect(summary?.bridge_like_blocks?.some((cell) => cell.cell_type === "minecraft:cobblestone")).toBe(true);
    expect(summary?.hazard_cells?.some((cell) => cell.cell_type === "minecraft:air")).toBe(true);
  });

  it("keeps block delta overlay separate from seed forecasts", () => {
    const overlay = reduceMinecraftWorldDeltaOverlay({
      schema: "helix.minecraft_spatial_event.v1",
      event_id: "minecraft_spatial_event:block-place",
      room_id: "room:minecraft-seed-map",
      world_id: "minecraft:seeded-local",
      source_id: "source:minecraft-server",
      actor_id: "player:datdampig",
      actor_label: "DatDamPig",
      event_type: "block_placed",
      dimension: "minecraft:the_end",
      location: { x: 16, y: 62, z: 16 },
      block: { before: "minecraft:air", after: "minecraft:cobblestone" },
      evidence_refs: ["mc:event:block-place"],
      ts: "2026-05-20T12:00:00.000Z",
      context_policy: "compact_context_pack_only",
      raw_logs_included: false,
    });

    expect(overlay).toMatchObject({
      evidence_layer: "persisted_block_delta_overlay",
      evidence_trust: "persisted_overlay",
      instruction_authority: "none",
      ask_context_policy: "evidence_only",
      raw_user_text_included: false,
      model_invoked: false,
      creates_ask_turn: false,
      turn_triggered: false,
      ask_instruction_authority: "none",
      context_role: "tool_evidence",
    });
    expect(overlay?.block_deltas[0]?.traversal_hint).toBe("walkable_added");
  });

  it("emits numeric route drift without hidden surface text", () => {
    resetMinecraftRouteDriftStateForTest();
    const route = {
      schema: "helix.minecraft_route_rehearsal.v1" as const,
      rehearsal_id: "minecraft_route_rehearsal:fixed",
      room_id: "room:minecraft-seed-map",
      world_id: "minecraft:seeded-local",
      actor_label: "DatDamPig",
      evidence_trust: "route_math" as const,
      instruction_authority: "none" as const,
      ask_context_policy: "evidence_only" as const,
      creates_ask_turn: false as const,
      turn_triggered: false as const,
      ask_instruction_authority: "none" as const,
      context_role: "tool_evidence" as const,
      objective_id: "minecraft_route_objective:fixed",
      route_kind: "single_dimension_waypoint" as const,
      from: { dimension: "minecraft:overworld", x: 0, y: 68, z: 0 },
      stages: [{
        stage_id: "minecraft_route_stage:fixed",
        label: "Candidate path to waypoint",
        from_dimension: "minecraft:overworld",
        to_dimension: "minecraft:overworld",
        target_type: "waypoint" as const,
        route_basis: ["observed_current_world" as const],
        reachable_confidence: 0.72,
        risk: "unknown" as const,
        missing_evidence: [],
      }],
      candidate_next_waypoint: {
        label: "east waypoint",
        dimension: "minecraft:overworld",
        x: 100,
        y: 68,
        z: 0,
        expected_direction: "east",
        confidence: 0.72,
      },
      route_confidence: 0.72,
      raw_user_text_included: false as const,
      derived_by_deterministic_reducer: true as const,
      normalized_by_deterministic_reducer: true as const,
      model_invoked_by_helix: false as const,
      ts: "2026-05-20T12:00:00.000Z",
      route_summary_scope: "ui_candidate_only" as const,
      ask_context_admissible: false as const,
      to: { x: 100, y: 68, z: 0 },
      target_label: "east waypoint",
      route_summary: "Candidate route math only.",
      steps: [],
      reachable_confidence: 0.72,
      missing_evidence: [],
      evidence_refs: ["mc:route"],
      deterministic: true as const,
      model_invoked: false as const,
      raw_logs_included: false as const,
      context_policy: "compact_context_pack_only" as const,
    };
    const sample = (x: number, ts: string) => reduceMinecraftRouteDrift({
      routeRehearsal: route,
      minSampleWindowMs: 1000,
      spatialEvent: {
        schema: "helix.minecraft_spatial_event.v1",
        event_id: `minecraft_spatial_event:sample:${x}`,
        room_id: route.room_id,
        world_id: route.world_id,
        source_id: "source:minecraft-server",
        actor_label: "DatDamPig",
        event_type: "player_location_sample",
        dimension: "minecraft:overworld",
        location: { x, y: 68, z: 0 },
        evidence_refs: [`mc:event:sample:${x}`],
        ts,
        context_policy: "compact_context_pack_only",
        raw_logs_included: false,
      },
    });

    const originalX = route.candidate_next_waypoint.x;
    route.candidate_next_waypoint.x = Number.NaN;
    expect(sample(0, "2026-05-20T12:00:00.000Z")).toBeNull();
    route.candidate_next_waypoint.x = Number.POSITIVE_INFINITY;
    expect(sample(0, "2026-05-20T12:00:00.000Z")).toBeNull();
    route.candidate_next_waypoint.x = originalX;
    expect(sample(0, "2026-05-20T12:00:00.000Z")).toBeNull();
    expect(sample(-20, "2026-05-20T12:00:01.000Z")).toBeNull();
    const drift = sample(-45, "2026-05-20T12:00:02.000Z");

    expect(drift).toMatchObject({
      drift_status: "wrong_direction",
      salience_candidate: true,
      policy_surface_status: "candidate_pending_gate",
      instruction_authority: "none",
      ask_context_policy: "evidence_only",
      raw_user_text_included: false,
      model_invoked: false,
      creates_ask_turn: false,
      turn_triggered: false,
      ask_instruction_authority: "none",
      context_role: "tool_evidence",
    });
    expect(drift?.sample_count).toBeGreaterThanOrEqual(3);
    expect(drift?.distance_delta_blocks).toBeGreaterThan(0);
    expect(drift).not.toHaveProperty("surface_text");
    const previousRouteState = getMinecraftRouteDriftStateForTest({
      roomId: route.room_id,
      worldId: route.world_id,
      actorLabel: "DatDamPig",
    })?.updated_at;
    expect(previousRouteState).toBe("2026-05-20T12:00:02.000Z");
    expect(getMinecraftRouteDriftStateForTest({
      roomId: route.room_id,
      worldId: route.world_id,
      actorLabel: "DatDamPig",
    })?.updated_at).toBe(previousRouteState);
  });

  it("stores transcript objectives as compact intent, not hidden Ask turns", () => {
    const ambient = buildMinecraftRouteObjective({
      roomId: "room:minecraft-seed-map",
      worldId: "minecraft:seeded-local",
      actorLabel: "DatDamPig",
      intentLabel: "return_home_from_end",
      transcriptMode: "ambient",
      evidenceRefs: ["mc:voice:intent"],
      ts: "2026-05-20T12:00:00.000Z",
    });
    const direct = buildMinecraftRouteObjective({
      roomId: "room:minecraft-seed-map",
      worldId: "minecraft:seeded-local",
      actorLabel: "DatDamPig",
      intentLabel: "return_home_from_end",
      transcriptMode: "direct_address",
      evidenceRefs: ["mc:voice:direct"],
      ts: "2026-05-20T12:00:01.000Z",
    });

    expect(ambient).toMatchObject({
      source: "voice_intent",
      transcript_mode: "ambient",
      creates_ask_turn: false,
      turn_triggered: false,
      ask_instruction_authority: "none",
      context_role: "tool_evidence",
      raw_user_text_included: false,
      instruction_authority: "none",
      ask_context_policy: "evidence_only",
    });
    expect(direct).toMatchObject({
      transcript_mode: "direct_address",
      creates_ask_turn: false,
      turn_triggered: false,
      direct_address_detected: true,
      salience_candidate: true,
      instruction_authority: "none",
    });
  });

  it("normalizes client planner reports as evidence, not route truth", () => {
    const observation = normalizeMinecraftRouteSolverObservation({
      roomId: "room:minecraft-seed-map",
      worldId: "minecraft:seeded-local",
      actorLabel: "DatDamPig",
      provider: "client_pathmind_observation",
      from: { dimension: "minecraft:the_end", x: 1000, y: 64, z: 1000 },
      target: {
        display_label: "return End gateway candidate",
        dimension: "minecraft:the_end",
        target_type: "end_gateway",
      },
      resultStatus: "partial_route",
      movementRequirements: ["walk", "bridge", "ender_pearl"],
      riskFlags: ["void_fall", "unknown_gateway"],
      providerConfidence: 0.61,
      missingEvidenceCodes: ["gateway_unconfirmed", "provider_report_unverified"],
      evidenceRefs: ["client:pathmind:route:1"],
      ts: "2026-05-20T12:00:00.000Z",
    });

    expect(observation).toMatchObject({
      provider: "client_pathmind_observation",
      evidence_layer: "client_route_planner_observation",
      evidence_trust: "client_planner_observation",
      instruction_authority: "none",
      ask_context_policy: "evidence_only",
      creates_ask_turn: false,
      turn_triggered: false,
      ask_instruction_authority: "none",
      context_role: "tool_evidence",
      raw_user_text_included: false,
      reported_by_provider: true,
      normalized_by_deterministic_reducer: true,
      model_invoked_by_helix: false,
      provider_confidence: 0.61,
      helix_fused_confidence: null,
      confidence_basis: ["client_planner"],
      missing_evidence_codes: ["gateway_unconfirmed", "provider_report_unverified"],
    });
    expect(observation.target.display_label_scope).toBe("ui_only");
    expect(observation.target.ask_context_admissible).toBe(false);
    expect(observation).not.toHaveProperty("surface_text");
    expect(observation).not.toHaveProperty("recommendation");
  });

  it("normalizes Pathmind runtime feedback as client planner evidence only", () => {
    const observation = normalizeMinecraftRoutePlannerObservation({
      roomId: "room:minecraft-seed-map",
      worldId: "minecraft:seeded-local",
      actorLabel: "DatDamPig",
      provider: "client_pathmind_observation",
      from: { dimension: "minecraft:the_end", x: 1000, y: 64, z: 1000 },
      target: { dimension: "minecraft:the_end", target_type: "end_gateway" },
      pathmind: {
        workflow_id: "wf:return-home",
        node_id: "node:travel-gateway",
        node_kind: "travel",
        runtime_state: "path_candidate",
        path_preview_available: true,
        execution_requested: false,
        execution_active: false,
      },
      evidenceRefs: ["client:pathmind:feedback:1"],
      ts: "2026-05-20T12:00:00.000Z",
    });

    expect(observation).toMatchObject({
      provider: "client_pathmind_observation",
      evidence_trust: "client_planner_observation",
      context_role: "tool_evidence",
      creates_ask_turn: false,
      turn_triggered: false,
      ask_instruction_authority: "none",
      planner_observation_mode: "path_preview",
      planner_execution_state: "planning_only",
      planner_side_effect_risk: "none_observation_only",
      result_status: "route_candidate_found",
    });
  });

  it("maps Baritone calculation results into evidence-only route status", () => {
    const observation = normalizeMinecraftRoutePlannerObservation({
      roomId: "room:minecraft-seed-map",
      worldId: "minecraft:seeded-local",
      actorLabel: "DatDamPig",
      provider: "client_baritone_observation",
      from: { dimension: "minecraft:overworld", x: 100, y: 64, z: 100 },
      target: { dimension: "minecraft:overworld", x: 112, y: 64, z: 104, target_type: "waypoint" },
      baritone: {
        calculation_type: "SUCCESS_SEGMENT",
        has_goal: true,
        has_current_path: true,
        estimated_ticks_to_goal: 340,
        positions: [
          { x: 100, y: 64, z: 100 },
          { x: 112, y: 64, z: 104 },
        ],
      },
      evidenceRefs: ["client:baritone:calc:1"],
      ts: "2026-05-20T12:00:00.000Z",
    });

    expect(observation.result_status).toBe("partial_route");
    expect(observation.planner_observation_mode).toBe("calculation_result");
    expect(observation.path_points).toHaveLength(2);
    expect(observation.baritone_path_state).toMatchObject({
      has_goal: true,
      has_current_path: true,
      estimated_ticks_to_goal: 340,
      path_kind: "current_execution_path",
    });
    expect(observation.instruction_authority).toBe("none");
    expect(observation.ask_context_policy).toBe("evidence_only");
  });

  it("preserves Baritone unreachable as world-change failure evidence", () => {
    const observation = normalizeMinecraftRoutePlannerObservation({
      roomId: "room:minecraft-seed-map",
      worldId: "minecraft:seeded-local",
      actorLabel: "DatDamPig",
      provider: "client_baritone_observation",
      from: { dimension: "minecraft:overworld", x: 100, y: 64, z: 100 },
      target: { dimension: "minecraft:overworld", x: 112, y: 64, z: 104, target_type: "waypoint" },
      baritone: {
        movement_status: "UNREACHABLE",
        is_pathing: true,
        has_current_path: true,
      },
      evidenceRefs: ["client:baritone:movement:1"],
      ts: "2026-05-20T12:00:00.000Z",
    });

    expect(observation.result_status).toBe("movement_unreachable_after_world_change");
    expect(observation.risk_flags).toContain("unknown_terrain");
    expect(observation.confidence_basis).toContain("client_planner");
    expect(observation.missing_evidence_codes).toContain("chunk_unobserved");
    expect(observation.planner_side_effect_risk).toBe("active_client_motion");
  });

  it("does not expose execution commands in the route solver adapter", () => {
    expect(routeSolverObservationAdapterCapabilities).not.toContain("set_goal" as never);
    expect(routeSolverObservationAdapterCapabilities).not.toContain("set_goal_and_path" as never);
    expect(routeSolverObservationAdapterCapabilities).not.toContain("execute_path" as never);
    expect(routeSolverObservationAdapterCapabilities).toContain("observe_path_state");
  });

  it("does not rehearse when seed or version metadata is missing", async () => {
    const event = locationEvent();
    const result = await ingestWorldEvent(
      {
        ...event,
        meta: {},
      },
      { appendToThread: false },
    );

    expect(result.minecraft_seed_map_claims).toEqual([]);
    expect(result.minecraft_route_rehearsal).toBeNull();
    expect(result.ok).toBe(true);
  });
});
