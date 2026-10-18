import { beforeEach, describe, expect, it } from "vitest";
import { validateStagePlayBadgeGraphV1 } from "../../shared/contracts/stage-play-badge-graph.v1";
import type { StagePlayBadgeGraphV1 } from "../../shared/contracts/stage-play-badge-graph.v1";
import { validateStagePlayCheckpointRequestResultV1 } from "../../shared/contracts/stage-play-checkpoint-request-result.v1";
import { validateStagePlayJobPlanV1 } from "../../shared/contracts/stage-play-job-plan.v1";
import {
  recordLiveSourceObservation,
  resetLiveSourceObservationStoreForTest,
} from "../services/live-source/live-source-observation-store";
import { executeLiveEnvironmentTool } from "../services/helix-ask/live-environment-tool-adapter";
import { buildLiveEnvironmentRuntimePacket } from "../services/situation-room/live-environment-runtime-packet-builder";
import {
  createLiveAnswerEnvironment,
  getLiveAnswerEnvironment,
  resetLiveAnswerEnvironments,
} from "../services/situation-room/live-answer-environment-store";
import {
  ingestEnvironmentStateSnapshot,
  normalizeEnvironmentStateSnapshot,
  resetEnvironmentStateSnapshotWindowsForTest,
} from "../services/situation-room/environment-state-snapshot-window";
import { clearEventJournalForTest } from "../services/situation-room/event-journal-store";
import {
  getStagePlayCheckpointQueue,
  resetStagePlayCheckpointQueueForTest,
} from "../services/stage-play/stage-play-checkpoint-queue";
import {
  resetLiveSourceChunkBufferForTest,
  upsertLiveSourceProducer,
} from "../services/situation-room/live-source-chunk-buffer";
import {
  resetLiveSourceDescriptorsForTest,
  upsertLiveSourceDescriptor,
} from "../services/situation-room/live-source-descriptor-builder";
import { resetMinecraftNavigationStateStoreForTest } from "../services/situation-room/minecraft-navigation-state-store";
import { resetMinecraftWorldDeltaOverlaysForTest } from "../services/situation-room/minecraft-world-delta-overlay";
import { resetMinecraftWorldSenseWindows } from "../services/situation-room/minecraft-world-sense-window";

const threadId = "thread:stage-play-live-env-tool";
const roomId = "room:minecraft-stage-play-live-env-tool";
const environmentId = "live_env:stage-play";

beforeEach(() => {
  resetLiveAnswerEnvironments();
  resetLiveSourceObservationStoreForTest();
  resetEnvironmentStateSnapshotWindowsForTest();
  resetMinecraftNavigationStateStoreForTest();
  resetMinecraftWorldDeltaOverlaysForTest();
  resetMinecraftWorldSenseWindows();
  resetLiveSourceDescriptorsForTest();
  resetLiveSourceChunkBufferForTest();
  resetStagePlayCheckpointQueueForTest();
  clearEventJournalForTest();
});

describe("live_env.reflect_stage_play_context", () => {
  it("is advertised as an evidence-only live environment tool", () => {
    const packet = buildLiveEnvironmentRuntimePacket({
      threadId,
      roomId,
      now: "2026-06-02T12:20:00.000Z",
    });

    expect(packet.available_tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tool_id: "live_env.describe_stage_builder",
        family: "live_env",
        creates_assistant_answer: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.query_stage_sources",
        family: "live_env",
        creates_assistant_answer: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.draft_stage_play_graph",
        family: "live_env",
        creates_assistant_answer: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.reflect_stage_play_context",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.plan_stage_play_job",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
      expect.objectContaining({
        tool_id: "live_env.request_stage_play_checkpoint",
        family: "live_env",
        creates_assistant_answer: false,
        requires_user_confirmation: false,
        can_run_automatically: true,
      }),
    ]));
    expect(packet.policy.may_mutate_sources).toBe(false);
  });

  it("plans a narrative Stage Play job without starting capture or answering", () => {
    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.plan_stage_play_job",
      thread_id: threadId,
      args: {
        objective: "I'm about to attach a YouTube tab and I want you to predict what happens next based on visual capture.",
      },
    });

    expect(observation).toMatchObject({
      tool_name: "live_env.plan_stage_play_job",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      instruction_authority: "none",
      ask_instruction_authority: "none",
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(observation.summary).toMatch(/Planned narrative_media Stage Play job/);
    expect(observation.summary).toContain("Browser tab visual source");
    expect(validateStagePlayJobPlanV1(observation.observation)).toEqual([]);
    expect(observation.observation).toMatchObject({
      artifactId: "stage_play_job_plan",
      schemaVersion: "stage_play_job_plan/v1",
      domain: "narrative_media",
      requiredSources: [
        expect.objectContaining({
          modality: "visual_frame",
          required: true,
          recommendedCadenceMs: 10_000,
          routeTo: "narrative_stage_play",
        }),
        expect.objectContaining({
          modality: "audio_transcript",
          required: false,
          routeTo: "narrative_stage_play",
        }),
      ],
      checkpointPolicy: {
        triggerOnFirstObservation: true,
        triggerOnSceneChange: true,
        triggerOnPredictionHorizonExpired: true,
        minMsSinceLastCheckpoint: 15_000,
        manualUserPriority: true,
      },
      predictionPolicy: {
        enabled: true,
        horizon: "next_scene_beat",
        validateAgainstNextWindow: true,
      },
      assistant_answer: false,
      context_role: "tool_evidence",
    });
    const plan = observation.observation as {
      nodeChain: Array<{ nodeId: string; nodeKind: string }>;
      missingSetup: string[];
      readinessChecks: Array<{ nextAction?: string | null }>;
    };
    expect(plan.nodeChain.map((node) => node.nodeId)).toEqual(expect.arrayContaining([
      "observer.live_sources",
      "source.visual_frame.active",
      "compact_observation.latest_visual",
      "interpreter.visual_scene",
      "checkpoint_request.queued",
      "helix_ask.checkpoint.latest",
      "answer_snapshot.latest",
      "live_output.current",
    ]));
    expect(plan.nodeChain.find((node) => node.nodeId === "helix_ask.checkpoint.latest")?.nodeKind).toBe("helix_ask_checkpoint");
    expect(plan.missingSetup).toEqual(expect.arrayContaining([
      "Browser tab visual source is needed for this Stage Play job.",
    ]));
    expect(plan.readinessChecks.map((check) => check.nextAction).filter(Boolean)).toContain(
      "Attach browser tab visual capture at 10s cadence.",
    );
    expect(JSON.stringify(observation)).not.toMatch(/assistant[_ -]?answer["']?\s*:\s*true/i);
    expect(JSON.stringify(observation)).not.toMatch(/capture_started|active_interval_started|live_pipeline_receipt/i);
  });

  it("returns a specific checkpoint receipt when no compact observation is available", () => {
    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.request_stage_play_checkpoint",
      thread_id: threadId,
      args: {
        room_id: roomId,
        job_id: "stage_play_job:checkpoint-tool-test",
        objective: "Create a bounded checkpoint for the current Stage Play graph.",
        reason: "user_requested_checkpoint",
        user_prompt_ref: "prompt:checkpoint-tool-test",
      },
    });
    const result = observation.observation as {
      schema: "stage_play_checkpoint_request_failure/v1";
      missing_field: string;
      assistant_answer: false;
      context_role: "tool_evidence";
    };

    expect(observation).toMatchObject({
      schema: "helix.live_environment_tool_observation.v1",
      tool_name: "live_env.request_stage_play_checkpoint",
      ok: false,
      assistant_answer: false,
      raw_content_included: false,
      instruction_authority: "none",
      ask_instruction_authority: "none",
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(observation.summary).toBe("Checkpoint request could not run because no compact observation refs.");
    expect(result).toMatchObject({
      schema: "stage_play_checkpoint_request_failure/v1",
      missing_field: "no compact observation refs",
      assistant_answer: false,
      context_role: "tool_evidence",
    });
    expect(JSON.stringify(observation)).not.toMatch(/assistant[_ -]?answer["']?\s*:\s*true/i);
    expect(JSON.stringify(observation)).not.toMatch(/final_answer|model_reviewed_answer|live_pipeline_receipt/i);
  });

  it("fills empty checkpoint args from the active visual Stage Play graph and runs the request", () => {
    const environment = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "turn:seed-visual-checkpoint",
      objective: "Run the Stage Play checkpoint for the active visual source.",
      preset: "narrative_scene_monitor",
      room_id: roomId,
      source_ids: ["source:visual-tab"],
      now: "2026-06-02T12:25:00.000Z",
    }).environment;
    upsertLiveSourceDescriptor({
      source_id: "source:visual-tab",
      thread_id: threadId,
      environment_id: environment.environment_id,
      modality: "visual_frame",
      user_label: "Browser tab visual",
      serving_context: {
        surface: "browser_tab",
        source_origin: "browser_getDisplayMedia",
        app_hint: "Chrome",
      },
      current_state: "active_interval",
      cadence_ms: 10000,
      latest_observation_refs: ["live_source_observation:visual-checkpoint"],
    });
    upsertLiveSourceProducer({
      sourceId: "source:visual-tab",
      threadId,
      modality: "visual_frame",
      status: "active",
      cadenceMs: 10000,
      captureMode: "interval",
      latestChunkId: "live_source_chunk:visual-checkpoint",
      now: "2026-06-02T12:25:01.000Z",
    });
    recordLiveSourceObservation({
      schema: "helix.live_source_observation.v1",
      observation_id: "live_source_observation:visual-checkpoint",
      thread_id: threadId,
      room_id: roomId,
      environment_id: environment.environment_id,
      source_id: "source:visual-tab",
      source_kind: "visual_frame",
      event_kind: "visual_frame_summary",
      observed_at: "2026-06-02T12:25:02.000Z",
      freshness: { status: "fresh", age_ms: 20 },
      provenance: { adapter: "browser.visual", confidence: "medium" },
      compact_summary: "A browser tab visual source is active with a compact scene observation.",
      evidence_refs: ["evidence:visual-checkpoint"],
      assistant_answer: false,
      raw_content_included: false,
    });

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.request_stage_play_checkpoint",
      thread_id: threadId,
      environment_id: environment.environment_id,
      args: {},
    });
    const result = observation.observation as {
      schema: "stage_play_checkpoint_request_result/v1";
      checkpointRequest: {
        checkpointRequestId: string;
        jobId: string;
        graphId: string;
        objective: string;
        status: string;
        compactObservationRefs: string[];
      };
      filledArgs: {
        thread_id: string;
        room_id: string;
        environment_id: string;
        graph_id: string;
        checkpoint_request_id: string;
        objective: string;
        source_refs: string[];
        compact_observation_refs: string[];
        perturbation_refs: string[];
        prior_answer_snapshot_refs: string[];
      };
      queueAction: { ok: boolean; action: string; reason: string };
      readyToRun: boolean;
      reason: string;
      assistant_answer: false;
      context_role: "tool_evidence";
    };

    expect(observation).toMatchObject({
      tool_name: "live_env.request_stage_play_checkpoint",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(observation.summary).toMatch(/Stage Play checkpoint request .* is running/);
    expect(validateStagePlayCheckpointRequestResultV1(result)).toEqual([]);
    expect(result.checkpointRequest.status).toBe("running");
    expect(result.readyToRun).toBe(true);
    expect(result.reason).toBe("queued");
    expect(result.queueAction).toMatchObject({ ok: true, action: "run", reason: "updated" });
    expect(result.filledArgs).toMatchObject({
      thread_id: threadId,
      room_id: roomId,
      environment_id: environment.environment_id,
      graph_id: result.checkpointRequest.graphId,
      checkpoint_request_id: result.checkpointRequest.checkpointRequestId,
      objective: "Run the Stage Play checkpoint for the active visual source.",
    });
    expect(result.filledArgs.source_refs).toEqual(expect.arrayContaining([
      "live_source_observation:visual-checkpoint",
      "live_source_chunk:visual-checkpoint",
    ]));
    expect(result.filledArgs.compact_observation_refs).toEqual(expect.arrayContaining([
      "live_source_observation:visual-checkpoint",
    ]));
    const queue = getStagePlayCheckpointQueue({ jobId: result.checkpointRequest.jobId });
    expect(queue.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        checkpointRequestId: result.checkpointRequest.checkpointRequestId,
        status: "running",
      }),
    ]));
    expect(JSON.stringify(observation)).not.toMatch(/assistant[_ -]?answer["']?\s*:\s*true/i);
    expect(JSON.stringify(observation)).not.toMatch(/I could not produce a terminal answer for this turn/i);
  });

  it("lets the model work through Stage Builder grammar, sources, and draft validation", () => {
    const environment = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "turn:seed",
      objective: "Build a model-driven Stage Play graph.",
      preset: "narrative_scene_monitor",
      room_id: roomId,
      source_ids: ["source:visual-tab"],
      now: "2026-06-02T12:19:00.000Z",
    }).environment;
    const descriptor = upsertLiveSourceDescriptor({
      source_id: "source:visual-tab",
      thread_id: threadId,
      environment_id: environment.environment_id,
      modality: "visual_frame",
      user_label: "Visual tab",
      serving_context: {
        surface: "browser_tab",
        source_origin: "browser_getDisplayMedia",
        app_hint: "Chrome",
      },
      current_state: "active_interval",
      cadence_ms: 10000,
      latest_observation_refs: ["visual_observation:stage-builder"],
    });
    const producer = upsertLiveSourceProducer({
      sourceId: "source:visual-tab",
      threadId,
      modality: "visual_frame",
      status: "active",
      cadenceMs: 10000,
      captureMode: "interval",
      latestChunkId: "live_source_chunk:stage-builder",
      now: "2026-06-02T12:19:01.000Z",
    });

    const catalogObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.describe_stage_builder",
      thread_id: threadId,
      environment_id: environment.environment_id,
    });
    expect(catalogObservation).toMatchObject({
      tool_name: "live_env.describe_stage_builder",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(JSON.stringify(catalogObservation.observation)).toContain("stage_play_builder_catalog/v1");
    expect(JSON.stringify(catalogObservation.observation)).toContain("source");
    expect(JSON.stringify(catalogObservation.observation)).toContain("interpreter");

    const sourceObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_stage_sources",
      thread_id: threadId,
      environment_id: environment.environment_id,
    });
    expect(sourceObservation.observation).toMatchObject({
      artifactId: "stage_play_source_query",
      sourceHandles: [
        expect.objectContaining({
          sourceId: "source:visual-tab",
          sourceClass: "visual_frame",
          descriptorId: descriptor.descriptor_id,
          producerId: producer.producer_id,
        }),
      ],
    });
    expect(sourceObservation.evidence_refs).toEqual(expect.arrayContaining([
      descriptor.descriptor_id,
      producer.producer_id,
      "visual_observation:stage-builder",
      "live_source_chunk:stage-builder",
    ]));

    const draft = {
      objective: "Interpret the current visual scene and predict likely next action.",
      nodes: [
        { id: "source.visual", kind: "source", bind: { sourceClass: "visual_frame", sourceId: "source:visual-tab" } },
        { id: "interpreter.stage", kind: "interpreter", parameters: { tool: "live_env.reflect_stage_play_context" } },
        { id: "actor.primary", kind: "actor" },
        { id: "procedure.next", kind: "procedural_binding" },
      ],
      edges: [
        { from: "source.visual", to: "interpreter.stage", relation: "feeds" },
        { from: "interpreter.stage", to: "actor.primary", relation: "interprets" },
        { from: "actor.primary", to: "procedure.next", relation: "constrains" },
      ],
      checkpointPolicy: {
        cadenceMs: 10000,
        completeEachWindow: true,
        standingJobRemainsOpen: true,
      },
    };

    const draftObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.draft_stage_play_graph",
      thread_id: threadId,
      environment_id: environment.environment_id,
      args: { draft },
    });
    expect(draftObservation).toMatchObject({
      tool_name: "live_env.draft_stage_play_graph",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(draftObservation.observation).toMatchObject({
      artifactId: "stage_play_graph_draft_validation",
      ok: true,
      resolvedSourceIds: ["source:visual-tab"],
      authority: {
        assistant_answer: false,
        terminal_eligible: false,
        agent_executable: false,
      },
    });

    const rejected = executeLiveEnvironmentTool({
      tool_name: "live_env.validate_stage_play_graph",
      thread_id: threadId,
      environment_id: environment.environment_id,
      args: {
        draft: {
          ...draft,
          nodes: [{ id: "source.bad", kind: "source", bind: { sourceClass: "visual_frame", sourceId: "source:missing" } }],
          edges: [{ from: "source.bad", to: "missing", relation: "feeds" }],
        },
      },
    });
    expect(rejected.ok).toBe(false);
    expect(JSON.stringify(rejected.observation)).toContain("source:missing");
    expect(JSON.stringify(rejected.observation)).not.toMatch(/agent[_ -]?executable\s*[:=]\s*true/i);
  });

  it("reports Live Answer projection status when no environment is available", () => {
    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.reflect_stage_play_context",
      thread_id: threadId,
      args: {
        room_id: roomId,
        objective: "reflect the current stage without an attached live answer card",
      },
    });
    const wrappedObservation = observation.observation as {
      schema: "stage_play_reflection_result/v1";
      liveAnswerProjection: {
        attempted: boolean;
        projected: boolean;
        deltaId: string | null;
        environmentId: string | null;
        changedLineKeys: string[];
        projectedLineKeys: string[];
        skippedLineKeys: string[];
        checkpointOnlySkipped: string[];
        reason: string;
      };
      assistant_answer: false;
      raw_content_included: false;
      context_role: "tool_evidence";
      ask_context_policy: "evidence_only";
    };

    expect(observation).toMatchObject({
      tool_name: "live_env.reflect_stage_play_context",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(observation.summary).toBe(
      "Built Stage Play graph but did not project Live Interpretation lanes: no_active_environment.",
    );
    expect(wrappedObservation).toMatchObject({
      schema: "stage_play_reflection_result/v1",
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
      liveAnswerProjection: {
        attempted: true,
        projected: false,
        deltaId: null,
        environmentId: null,
        changedLineKeys: [],
        projectedLineKeys: [],
        reason: "no_active_environment",
      },
    });
    expect(wrappedObservation.liveAnswerProjection.skippedLineKeys).toEqual(expect.arrayContaining([
      "risk",
      "possibilities",
      "unknowns",
      "next_check",
    ]));
    expect(wrappedObservation.liveAnswerProjection.skippedLineKeys).not.toContain("situation");
    expect(wrappedObservation.liveAnswerProjection.skippedLineKeys).not.toContain("debug_basis");
    expect(wrappedObservation.liveAnswerProjection.checkpointOnlySkipped).toEqual(expect.arrayContaining([
      "recommendation",
      "answer_snapshot",
      "voice_output",
    ]));
  });

  it("wraps Stage Play graph reflection as a non-authoritative tool observation", () => {
    const environment = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "turn:seed",
      objective: "Reflect local Minecraft world state into Stage Play.",
      preset: "minecraft_run_monitor",
      room_id: roomId,
      source_ids: ["source:minecraft-server"],
      now: "2026-06-02T12:20:00.000Z",
    }).environment;

    const snapshot = normalizeEnvironmentStateSnapshot({
      threadId,
      snapshot: {
        snapshot_id: "snapshot:stage-play-live-env-tool",
        domain: "minecraft",
        domain_adapter: "minecraft.adapter.v1",
        room_id: roomId,
        world_id: "minecraft:overworld",
        source_id: "source:minecraft-server",
        actor_id: "player:datdampig",
        actor_label: "DatDamPig",
        ts: "2026-06-02T12:20:01.000Z",
        actor_state: {
          pose: { position: { x: 1, y: 64, z: 1 } },
        },
        local_map: {
          radius: 3,
          salient_cells: [
            {
              cell_ref: "cell:walkable",
              cell_type: "minecraft:grass_block",
              position: { x: 1, y: 63, z: 2 },
              tags: ["walkable", "traversable"],
            },
          ],
          map_hash: "local-map",
          changed_since_last_snapshot: true,
        },
        chunk_snapshot_summary: {
          sampled_radius_chunks: 1,
          loaded_chunks_sampled: 1,
          surface_cells: [
            { cell_ref: "cell:surface", cell_type: "minecraft:grass_block", tags: ["walkable"] },
          ],
          route_corridor_cells: [],
          gateway_blocks: [],
          bridge_like_blocks: [],
          hazard_cells: [
            { cell_ref: "cell:drop", cell_type: "minecraft:air", tags: ["void_or_drop_risk"] },
          ],
          map_hash: "chunk-map",
          changed_since_last_snapshot: true,
          raw_chunk_included: false,
        },
        changed_sections: ["actor_state", "local_map", "chunk_snapshot_summary"],
        section_hashes: {
          actor_state: "actor",
          local_map: "local-map",
          chunk_snapshot_summary: "chunk-map",
        },
        evidence_refs: ["evidence:snapshot"],
      },
    });
    expect(snapshot).not.toBeNull();
    ingestEnvironmentStateSnapshot(snapshot!);

    recordLiveSourceObservation({
      schema: "helix.live_source_observation.v1",
      observation_id: "live_source_observation:stage-play-live-env-tool",
      thread_id: threadId,
      room_id: roomId,
      environment_id: environmentId,
      source_id: "source:minecraft-server",
      source_kind: "minecraft_world_events",
      event_kind: "position_update",
      observed_at: "2026-06-02T12:20:02.000Z",
      freshness: { status: "fresh", age_ms: 10 },
      provenance: { adapter: "minecraft.plugin", confidence: "high" },
      compact_summary: "Position update.",
      evidence_refs: ["evidence:observation", snapshot!.snapshot_id],
      assistant_answer: false,
      raw_content_included: false,
    });
    upsertLiveSourceDescriptor({
      source_id: "source:minecraft-server",
      thread_id: threadId,
      environment_id: environment.environment_id,
      modality: "world_event",
      user_label: "Minecraft world events",
      serving_context: {
        surface: "game",
        source_origin: "minehut_plugin",
      },
      current_state: "active",
      latest_observation_refs: ["live_source_observation:stage-play-live-env-tool"],
    });
    upsertLiveSourceProducer({
      sourceId: "source:minecraft-server",
      threadId,
      modality: "world_event",
      status: "active",
      captureMode: "push",
      latestChunkId: "live_source_chunk:minecraft-server",
      now: "2026-06-02T12:20:02.500Z",
    });

    const observation = executeLiveEnvironmentTool({
      tool_name: "live_env.reflect_stage_play_context",
      thread_id: threadId,
      environment_id: environment.environment_id,
      args: {
        room_id: roomId,
        objective: "move forward without stepping into the drop",
      },
    });
    const wrappedObservation = observation.observation as {
      schema: "stage_play_reflection_result/v1";
      graph: StagePlayBadgeGraphV1;
      outputLaneProjection: { artifactId: string; assistant_answer: false; terminal_eligible: false };
      liveAnswerProjection: {
        attempted: boolean;
        projected: boolean;
        deltaId: string | null;
        environmentId: string | null;
        changedLineKeys: string[];
        projectedLineKeys: string[];
        skippedLineKeys: string[];
        checkpointOnlySkipped: string[];
        reason: string;
      };
      assistant_answer: false;
      raw_content_included: false;
      terminal_eligible: false;
    };
    const graph = wrappedObservation.graph;

    expect(observation).toMatchObject({
      schema: "helix.live_environment_tool_observation.v1",
      tool_name: "live_env.reflect_stage_play_context",
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
      instruction_authority: "none",
      ask_instruction_authority: "none",
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(observation.summary).toMatch(/Built Stage Play graph and projected \d+ Live Interpretation lane\(s\)\./);
    expect(wrappedObservation).toMatchObject({
      schema: "stage_play_reflection_result/v1",
      assistant_answer: false,
      raw_content_included: false,
      terminal_eligible: false,
      outputLaneProjection: {
        artifactId: "stage_play_output_lane_projection",
        assistant_answer: false,
        terminal_eligible: false,
      },
      liveAnswerProjection: {
        attempted: true,
        projected: true,
        environmentId: environment.environment_id,
        reason: "projected",
      },
    });
    expect(wrappedObservation.liveAnswerProjection.deltaId).toMatch(/^live_answer_delta:/);
    expect(wrappedObservation.liveAnswerProjection.changedLineKeys).toEqual(expect.arrayContaining([
      "risk",
      "possibilities",
      "unknowns",
      "next_check",
    ]));
    expect(wrappedObservation.liveAnswerProjection.projectedLineKeys).toEqual(expect.arrayContaining([
      "risk",
      "possibilities",
      "unknowns",
      "next_check",
    ]));
    expect(wrappedObservation.liveAnswerProjection.changedLineKeys).not.toContain("debug_basis");
    expect(wrappedObservation.liveAnswerProjection.changedLineKeys).not.toContain("situation");
    expect(wrappedObservation.liveAnswerProjection.projectedLineKeys).not.toContain("recommendation");
    expect(wrappedObservation.liveAnswerProjection.projectedLineKeys).not.toContain("answer_snapshot");
    expect(wrappedObservation.liveAnswerProjection.projectedLineKeys).not.toContain("voice_output");
    expect(wrappedObservation.liveAnswerProjection.changedLineKeys).not.toContain("recommendation");
    expect(wrappedObservation.liveAnswerProjection.changedLineKeys).not.toContain("answer_snapshot");
    expect(wrappedObservation.liveAnswerProjection.changedLineKeys).not.toContain("voice_output");
    expect(wrappedObservation.liveAnswerProjection.skippedLineKeys).toEqual([]);
    expect(wrappedObservation.liveAnswerProjection.checkpointOnlySkipped).toEqual(expect.arrayContaining([
      "recommendation",
      "answer_snapshot",
      "voice_output",
    ]));
    expect(validateStagePlayBadgeGraphV1(graph)).toEqual([]);
    expect(graph.artifactId).toBe("stage_play_badge_graph");
    expect(graph.sourceWindow.latestObservationRefs).toEqual([
      "live_source_observation:stage-play-live-env-tool",
    ]);
    expect(graph.sourceWindow.latestSnapshotRefs).toEqual([
      "snapshot:stage-play-live-env-tool",
    ]);
    expect(graph.sourceWindow.latestSourceDescriptorRefs?.length).toBe(1);
    expect(graph.sourceWindow.latestSourceProducerRefs?.length).toBe(1);
    expect(graph.summary.badgeCount).toBeGreaterThan(0);
    expect(graph.summary.affordanceCount).toBeGreaterThan(0);
    expect(graph.summary.blockedAffordanceCount).toBeGreaterThan(0);
    const liveAnswerEnvironment = getLiveAnswerEnvironment(environment.environment_id);
    expect(liveAnswerEnvironment?.lines_by_key?.risk?.value).toMatch(/drop|fall|void|blocked/i);
    expect(liveAnswerEnvironment?.lines_by_key?.possibilities?.value).toMatch(/bridge|retreat|tunnel/i);
    expect(liveAnswerEnvironment?.lines_by_key?.recommendation?.value).toBe(
      "Awaiting rehearsal before recommending action.",
    );
    expect(liveAnswerEnvironment?.latest_evaluation?.model_invoked).toBe(false);
    expect(observation.evidence_refs).toEqual(expect.arrayContaining([
      "live_source_observation:stage-play-live-env-tool",
      "snapshot:stage-play-live-env-tool",
      "evidence:snapshot",
    ]));
    expect(graph.authority.agent_executable).toBe(false);
    expect(JSON.stringify(observation)).not.toContain("raw_chunk");
    expect(JSON.stringify(observation)).not.toContain("raw_user_text");
  });
});
