import { describe, expect, it, beforeEach } from "vitest";
import type { HelixMinecraftRouteSolverObservation } from "../../shared/helix-minecraft-evidence";
import type { HelixWorldEvent } from "../../shared/helix-world-event";
import {
  recordLiveSourceObservation,
  resetLiveSourceObservationStoreForTest,
} from "../services/live-source/live-source-observation-store";
import {
  ingestEnvironmentStateSnapshot,
  normalizeEnvironmentStateSnapshot,
  resetEnvironmentStateSnapshotWindowsForTest,
} from "../services/situation-room/environment-state-snapshot-window";
import { clearEventJournalForTest, recordEventJournalEvent } from "../services/situation-room/event-journal-store";
import {
  resetLiveSourceChunkBufferForTest,
  upsertLiveSourceProducer,
} from "../services/situation-room/live-source-chunk-buffer";
import {
  resetLiveSourceDescriptorsForTest,
  upsertLiveSourceDescriptor,
} from "../services/situation-room/live-source-descriptor-builder";
import { recordMinecraftRouteSolverObservation, resetMinecraftNavigationStateStoreForTest } from "../services/situation-room/minecraft-navigation-state-store";
import {
  persistMinecraftWorldDeltaOverlay,
  reduceMinecraftWorldDeltaOverlay,
  resetMinecraftWorldDeltaOverlaysForTest,
} from "../services/situation-room/minecraft-world-delta-overlay";
import { ingestMinecraftWorldSenseEvent, resetMinecraftWorldSenseWindows } from "../services/situation-room/minecraft-world-sense-window";
import { resetSituationSourceCapabilitiesForTest } from "../services/situation-room/situation-source-capability-store";
import {
  resetStagePlaySourceRouteOverridesForTest,
  resolveStagePlaySourceWindow,
  upsertStagePlaySourceRouteOverride,
} from "../services/situation-room/stage-play-source-window";
import {
  recordStagePlayRawSessionBufferEntry,
  resetStagePlayRawSessionBufferForTest,
} from "../services/stage-play/stage-play-raw-session-buffer-store";

const roomId = "room:minecraft-stage-play";
const worldId = "minecraft:stage-world";
const threadId = "thread:stage-play";

beforeEach(() => {
  resetLiveSourceObservationStoreForTest();
  resetEnvironmentStateSnapshotWindowsForTest();
  resetMinecraftWorldDeltaOverlaysForTest();
  resetMinecraftNavigationStateStoreForTest();
  resetMinecraftWorldSenseWindows();
  resetLiveSourceDescriptorsForTest();
  resetLiveSourceChunkBufferForTest();
  resetSituationSourceCapabilitiesForTest();
  resetStagePlaySourceRouteOverridesForTest();
  resetStagePlayRawSessionBufferForTest();
  clearEventJournalForTest();
});

describe("Stage Play source window resolver", () => {
  it("resolves compact refs and facts from rich live-world evidence stores", () => {
    const snapshot = normalizeEnvironmentStateSnapshot({
      threadId,
      snapshot: {
        snapshot_id: "snapshot:stage-play:latest",
        domain: "minecraft",
        domain_adapter: "minecraft.adapter.v1",
        room_id: roomId,
        world_id: worldId,
        source_id: "source:minecraft-server",
        actor_id: "player:datdampig",
        actor_label: "DatDamPig",
        ts: "2026-06-02T12:00:01.000Z",
        actor_state: {
          pose: { position: { x: 10, y: 64, z: 10 }, facing: "north" },
        },
        local_map: {
          radius: 4,
          salient_cells: [
            {
              cell_ref: "cell:floor",
              cell_type: "minecraft:stone",
              position: { x: 10, y: 63, z: 10 },
              tags: ["walkable", "traversable"],
            },
          ],
          map_hash: "local-map-hash",
          changed_since_last_snapshot: true,
        },
        chunk_snapshot_summary: {
          sampled_radius_chunks: 1,
          loaded_chunks_sampled: 4,
          surface_cells: [{ cell_ref: "cell:surface", cell_type: "minecraft:stone", tags: ["walkable"] }],
          route_corridor_cells: [{ cell_ref: "cell:route", cell_type: "minecraft:cobblestone", tags: ["bridge_like"] }],
          gateway_blocks: [{ cell_ref: "cell:gateway", cell_type: "minecraft:end_gateway", tags: ["portal_or_gateway"] }],
          bridge_like_blocks: [{ cell_ref: "cell:bridge", cell_type: "minecraft:cobblestone", tags: ["bridge_like"] }],
          hazard_cells: [{ cell_ref: "cell:void", cell_type: "minecraft:air", tags: ["void_or_drop_risk"] }],
          map_hash: "chunk-map-hash",
          changed_since_last_snapshot: true,
          raw_chunk_included: false,
        },
        changed_sections: ["local_map", "chunk_snapshot_summary"],
        section_hashes: { local_map: "local-map-hash", chunk_snapshot_summary: "chunk-map-hash" },
        evidence_refs: ["evidence:snapshot"],
      },
    });
    expect(snapshot).not.toBeNull();
    ingestEnvironmentStateSnapshot(snapshot!);

    const observation = recordLiveSourceObservation({
      schema: "helix.live_source_observation.v1",
      observation_id: "live_source_observation:stage-play",
      thread_id: threadId,
      room_id: roomId,
      environment_id: "env:minecraft",
      source_id: "source:minecraft-server",
      source_kind: "minecraft_world_events",
      event_kind: "position_update",
      observed_at: "2026-06-02T12:00:02.000Z",
      freshness: { status: "fresh", age_ms: 50 },
      provenance: { adapter: "minecraft.plugin", confidence: "high" },
      compact_summary: "Player position update admitted as compact observation.",
      payload_summary: {
        position: { x: 10, y: 64, z: 10, dimension: "minecraft:overworld" },
      },
      evidence_refs: ["evidence:observation", snapshot!.snapshot_id],
      assistant_answer: false,
      raw_content_included: false,
    });

    const blockEvent = {
      schema: "helix.minecraft_spatial_event.v1",
      event_id: "minecraft_spatial_event:block-placed",
      room_id: roomId,
      world_id: worldId,
      source_id: "source:minecraft-server",
      actor_id: "player:datdampig",
      actor_label: "DatDamPig",
      event_type: "block_placed",
      dimension: "minecraft:overworld",
      location: { x: 16, y: 64, z: 16 },
      block: { after: "minecraft:cobblestone" },
      evidence_refs: ["evidence:block-delta"],
      ts: "2026-06-02T12:00:03.000Z",
      context_policy: "compact_context_pack_only",
      raw_logs_included: false,
    } as const;
    persistMinecraftWorldDeltaOverlay(reduceMinecraftWorldDeltaOverlay(blockEvent));

    const worldSenseEvent: HelixWorldEvent = {
      schema: "helix.world_event.v1",
      world_id: worldId,
      room_id: roomId,
      source_id: "source:minecraft-server",
      ts: "2026-06-02T12:00:04.000Z",
      actor_label: "DatDamPig",
      event_type: "hostile_context_sample",
      evidence_refs: ["evidence:world-sense"],
      meta: {
        nearby_hostiles: ["minecraft:zombie 6.0m"],
        fall_risk: "medium",
      },
    };
    recordEventJournalEvent({ event: worldSenseEvent, threadId, sourceFamily: "minecraft" });
    ingestMinecraftWorldSenseEvent(worldSenseEvent);

    const routeSolverObservation: HelixMinecraftRouteSolverObservation = {
      schema: "helix.minecraft_route_solver_observation.v1",
      observation_id: "minecraft_route_solver_observation:stage-play",
      room_id: roomId,
      world_id: worldId,
      actor_label: "DatDamPig",
      provider: "helix_chunk_graph",
      evidence_layer: "observed_current_world",
      evidence_trust: "server_observation",
      instruction_authority: "none",
      ask_context_policy: "evidence_only",
      creates_ask_turn: false,
      turn_triggered: false,
      ask_instruction_authority: "none",
      context_role: "tool_evidence",
      raw_user_text_included: false,
      from: { dimension: "minecraft:overworld", x: 10, y: 64, z: 10 },
      target: {
        ask_context_admissible: false,
        dimension: "minecraft:overworld",
        x: 20,
        y: 64,
        z: 20,
        target_type: "waypoint",
      },
      result_status: "partial_route",
      planner_observation_mode: "path_preview",
      planner_execution_state: "planning_only",
      planner_side_effect_risk: "none_observation_only",
      world_state_dependency: "server_observed",
      movement_requirements: ["walk", "bridge"],
      risk_flags: ["void_fall"],
      provider_confidence: 0.72,
      confidence_basis: ["server_blocks"],
      missing_evidence_codes: ["unknown_gateway"],
      missing_evidence: ["Gateway destination is not confirmed."],
      evidence_refs: ["evidence:route-solver"],
      reported_by_provider: true,
      normalized_by_deterministic_reducer: true,
      model_invoked_by_helix: false,
      ts: "2026-06-02T12:00:05.000Z",
    };
    recordMinecraftRouteSolverObservation(routeSolverObservation);
    const rawEntry = recordStagePlayRawSessionBufferEntry({
      threadId,
      roomId,
      sourceId: "source:minecraft-server",
      modality: "world_event",
      sourceEventId: blockEvent.event_id,
      fromTs: "2026-06-02T12:00:03.000Z",
      toTs: "2026-06-02T12:00:03.000Z",
      rawKind: "world_event_ref",
      rawRef: blockEvent.event_id,
      rawTextPreview: "Player placed a block near the corridor.",
      evidenceRefs: ["evidence:block-delta"],
      now: "2026-06-02T12:00:03.000Z",
    });

    const window = resolveStagePlaySourceWindow({
      roomId,
      threadId,
      worldId,
      environmentId: "env:minecraft",
      actorLabel: "DatDamPig",
      now: "2026-06-02T12:00:06.000Z",
    });

    expect(window.schemaVersion).toBe("stage_play_source_window/v1");
    expect(window.latestObservationRefs).toEqual([observation.observation_id]);
    expect(window.latestSnapshotRefs).toEqual([snapshot!.snapshot_id]);
    expect(window.latestDeltaOverlayRefs[0]).toMatch(/^minecraft_world_delta_overlay:/);
    expect(window.latestChunkSnapshotSampleRefs).toEqual([
      `chunk_snapshot_sample:${snapshot!.snapshot_id}:chunk-map-hash`,
    ]);
    expect(window.latestRouteSolverObservationRefs).toEqual([routeSolverObservation.observation_id]);
    expect(window.latestWorldSenseContextRefs[0]).toMatch(/^minecraft_world_sense_context:/);
    expect(window.latestEventWindowRefs[0]).toMatch(/^event_journal:/);
    expect(window.latestRawSessionBufferRefs).toEqual([rawEntry!.entryId]);
    expect(window.compactFacts.environmentSnapshot?.chunkSnapshot).toMatchObject({
      sampleRef: `chunk_snapshot_sample:${snapshot!.snapshot_id}:chunk-map-hash`,
      surfaceCellCount: 1,
      routeCorridorCellCount: 1,
      gatewayBlockCount: 1,
      bridgeLikeBlockCount: 1,
      hazardCellCount: 1,
    });
    expect(window.compactFacts.deltaOverlay).toMatchObject({
      blockDeltaCount: 1,
      traversalHints: ["walkable_added"],
    });
    expect(window.compactFacts.navigation?.latestSolverObservationRefs).toEqual([
      routeSolverObservation.observation_id,
    ]);
    expect(window.compactFacts.routeSolverObservations[0]).toMatchObject({
      observationId: routeSolverObservation.observation_id,
      resultStatus: "partial_route",
      plannerExecutionState: "planning_only",
      movementRequirements: ["walk", "bridge"],
      riskFlags: ["void_fall"],
    });
    expect(window.compactFacts.worldSense).toMatchObject({
      entityClusterCount: 0,
      environmentNoteCount: 2,
    });
    expect(window.compactFacts.eventWindow).toMatchObject({
      returnedCount: 1,
      eventTypes: ["hostile_context_sample"],
    });
    expect(window.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: "source:minecraft-server",
        modality: "minecraft_world_events",
        status: "active",
        selectedForStagePlay: true,
        routeTo: "world_stage_play",
        evidenceRefs: expect.arrayContaining([observation.observation_id]),
      }),
      expect.objectContaining({
        sourceId: "source:minecraft-server",
        modality: "environment_state",
        status: "active",
        selectedForStagePlay: true,
        routeTo: "world_stage_play",
        evidenceRefs: expect.arrayContaining([snapshot!.snapshot_id]),
      }),
      expect.objectContaining({
        modality: "visual_frame",
        status: "permission_required",
        selectedForStagePlay: false,
        routeTo: "visual_context",
        nextRequiredAction: "Start visual interval",
      }),
      expect.objectContaining({
        modality: "audio_transcript",
        status: "configured_missing",
        selectedForStagePlay: false,
        routeTo: "narrative_stage_play",
        nextRequiredAction: "Attach audio transcript",
      }),
    ]));
    expect(window.sources.some((source) =>
      source.sourceId === "source:minecraft-server" && source.evidenceRefs.includes(rawEntry!.entryId)
    )).toBe(true);
    expect(window.authority).toMatchObject({
      assistant_answer: false,
      raw_content_included: false,
      raw_payload_included: false,
      terminal_eligible: false,
      agent_executable: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
      instruction_authority: "none",
      ask_instruction_authority: "none",
    });
    expect(JSON.stringify(window)).not.toContain("raw_event");
    expect(JSON.stringify(window)).not.toContain("block_deltas");
    expect(JSON.stringify(window)).not.toContain("Player position update admitted as compact observation.");
  });

  it("retains active visual producers even when unrelated source descriptors exist", () => {
    const descriptor = upsertLiveSourceDescriptor({
      source_id: "source:audio-live-answer",
      thread_id: threadId,
      modality: "audio_transcript",
      current_state: "active",
      cadence_ms: 10000,
      serving_context: {
        surface: "browser_tab",
        source_origin: "workstation_panel",
      },
      latest_observation_refs: ["live_source_observation:audio-live-answer"],
    });
    const producer = upsertLiveSourceProducer({
      sourceId: "source:visual-live-answer",
      threadId,
      modality: "visual_frame",
      status: "active",
      cadenceMs: 10000,
      captureMode: "interval",
      latestChunkId: "live_source_chunk:visual-live-answer",
      now: "2026-06-02T12:00:07.000Z",
    });

    const window = resolveStagePlaySourceWindow({
      roomId,
      threadId,
      now: "2026-06-02T12:00:08.000Z",
    });

    expect(window.latestSourceDescriptorRefs).toEqual([descriptor.descriptor_id]);
    expect(window.latestSourceProducerRefs).toEqual([producer.producer_id]);
    expect(window.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: "source:audio-live-answer",
        modality: "audio_transcript",
      }),
      expect.objectContaining({
        sourceId: "source:visual-live-answer",
        modality: "visual_frame",
        status: "active",
        cadenceMs: 10000,
        evidenceRefs: expect.arrayContaining([
          producer.producer_id,
          "live_source_chunk:visual-live-answer",
        ]),
      }),
    ]));
  });

  it("applies user source route overrides to active visual producers", () => {
    const producer = upsertLiveSourceProducer({
      sourceId: "source:visual-live-answer",
      threadId,
      modality: "visual_frame",
      status: "active",
      cadenceMs: 10000,
      captureMode: "interval",
      latestChunkId: "live_source_chunk:visual-live-answer",
      now: "2026-06-02T12:00:07.000Z",
    });
    const override = upsertStagePlaySourceRouteOverride({
      threadId,
      roomId,
      sourceId: "source:visual-live-answer",
      modality: "visual_frame",
      routeTo: "narrative_stage_play",
      selectedForStagePlay: true,
      evidenceRefs: [producer.producer_id],
      now: "2026-06-02T12:00:08.000Z",
    });

    const window = resolveStagePlaySourceWindow({
      roomId,
      threadId,
      now: "2026-06-02T12:00:09.000Z",
    });

    expect(window.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: "source:visual-live-answer",
        modality: "visual_frame",
        status: "active",
        routeTo: "narrative_stage_play",
        selectedForStagePlay: true,
        evidenceRefs: expect.arrayContaining([
          producer.producer_id,
          override.overrideId,
        ]),
      }),
    ]));
    expect(window.sourceRoutes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: "source:visual-live-answer",
        modality: "visual_frame",
        routeTo: "narrative_stage_play",
        selected: true,
      }),
    ]));
  });

  it("keeps active producer freshness even before a compact observation row appears", () => {
    upsertLiveSourceProducer({
      sourceId: "source:visual-freshness",
      threadId,
      modality: "visual_frame",
      status: "active",
      cadenceMs: 15000,
      captureMode: "interval",
      latestChunkId: "live_source_chunk:visual-freshness",
      now: "2026-06-02T12:10:00.000Z",
    });

    const window = resolveStagePlaySourceWindow({
      threadId,
      now: "2026-06-02T12:10:01.000Z",
    });

    expect(window.freshness).toBe("fresh");
    expect(window.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: "source:visual-freshness",
        modality: "visual_frame",
        status: "active",
        selectedForStagePlay: true,
      }),
    ]));
  });

  it("uses source-level route override fallback when thread or environment context changes", () => {
    const producer = upsertLiveSourceProducer({
      sourceId: "source:visual-cross-context",
      threadId,
      modality: "visual_frame",
      status: "active",
      cadenceMs: 15000,
      captureMode: "interval",
      latestChunkId: "live_source_chunk:visual-cross-context",
      now: "2026-06-02T12:20:00.000Z",
    });
    const override = upsertStagePlaySourceRouteOverride({
      threadId: "thread:stage-play-ui-context",
      environmentId: "live_answer:ui-context",
      sourceId: "source:visual-cross-context",
      modality: "visual_frame",
      routeTo: "narrative_stage_play",
      selectedForStagePlay: true,
      evidenceRefs: ["ui:source-route"],
      now: "2026-06-02T12:20:01.000Z",
    });

    const window = resolveStagePlaySourceWindow({
      threadId,
      sourceId: "source:visual-cross-context",
      now: "2026-06-02T12:20:02.000Z",
    });

    expect(window.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: "source:visual-cross-context",
        modality: "visual_frame",
        status: "active",
        routeTo: "narrative_stage_play",
        selectedForStagePlay: true,
        evidenceRefs: expect.arrayContaining([
          producer.producer_id,
          override.overrideId,
          "ui:source-route",
        ]),
      }),
    ]));
  });
});
