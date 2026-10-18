import { describe, expect, it } from "vitest";
import { buildStagePlayBadgeGraphV1, type StagePlayBadgeGraphV1 } from "@shared/contracts/stage-play-badge-graph.v1";
import { evaluateStagePlayCheckpointFreshness } from "../services/stage-play/stage-play-checkpoint-freshness";

const graphFixture = (overrides: Partial<StagePlayBadgeGraphV1> = {}): StagePlayBadgeGraphV1 =>
  buildStagePlayBadgeGraphV1({
    graphId: overrides.graphId ?? "stage_play_badge_graph:freshness",
    title: "Checkpoint freshness fixture",
    description: "Fixture graph for checkpoint freshness tests.",
    generatedAt: "2026-06-03T12:00:00.000Z",
    sourceWindow: overrides.sourceWindow ?? {
      threadId: "thread:freshness",
      roomId: "room:freshness",
      environmentId: "env:freshness",
      fromTs: "2026-06-03T11:59:50.000Z",
      toTs: "2026-06-03T12:00:00.000Z",
      latestObservationRefs: ["live_source_observation:freshness"],
      latestSourceDescriptorRefs: ["live_source_descriptor:freshness"],
      latestSourceProducerRefs: ["live_source_producer:freshness"],
      latestRawSessionBufferRefs: [],
      latestSnapshotRefs: ["environment_snapshot:freshness"],
      latestDeltaOverlayRefs: [],
      latestNavigationRefs: [],
      sources: [{
        sourceId: "source:visual",
        modality: "visual_frame",
        status: "active",
        contribution: "Visual source.",
        fidelityScore: 0.8,
        selectedForStagePlay: true,
        routeTo: "narrative_stage_play",
        cadenceMs: 10000,
        lastEventTs: "2026-06-03T11:59:59.000Z",
        evidenceRefs: ["live_source_observation:freshness"],
      }],
      freshness: "fresh",
    },
    badges: [],
    edges: [],
    recommendedActions: [],
  });

describe("Stage Play checkpoint freshness", () => {
  it("fails closed when no checkpoint is available", () => {
    const result = evaluateStagePlayCheckpointFreshness({
      graph: graphFixture(),
      checkpoint: null,
    });

    expect(result).toMatchObject({
      schema: "stage_play_checkpoint_freshness/v1",
      fresh: false,
      reason: "no_checkpoint",
      assistant_answer: false,
      context_role: "tool_evidence",
    });
  });

  it("accepts a model-reviewed checkpoint when graph ids match", () => {
    const result = evaluateStagePlayCheckpointFreshness({
      graph: graphFixture(),
      checkpoint: {
        checkpointId: "ask:turn:fresh",
        graphId: "stage_play_badge_graph:freshness",
        createdAt: "2026-06-03T12:00:01.000Z",
        modelReviewed: true,
      },
    });

    expect(result).toMatchObject({
      fresh: true,
      reason: "checkpoint_model_reviewed_and_source_window_matches",
      staleBecause: [],
    });
  });

  it("accepts a model-reviewed checkpoint when source refs overlap", () => {
    const result = evaluateStagePlayCheckpointFreshness({
      graph: graphFixture({ graphId: "stage_play_badge_graph:new-id" }),
      checkpoint: {
        checkpointId: "ask:turn:fresh",
        createdAt: "2026-06-03T12:00:01.000Z",
        modelReviewed: true,
        evidenceRefs: ["live_source_observation:freshness"],
      },
    });

    expect(result.reason).toBe("checkpoint_model_reviewed_and_source_window_matches");
    expect(result.fresh).toBe(true);
  });

  it("rejects explicit source-window refs that no longer match the current graph", () => {
    const result = evaluateStagePlayCheckpointFreshness({
      graph: graphFixture({ graphId: "stage_play_badge_graph:new-id" }),
      checkpoint: {
        checkpointId: "ask:turn:old-window",
        createdAt: "2026-06-03T12:00:01.000Z",
        modelReviewed: true,
        sourceWindowRefs: ["live_source_observation:freshness"],
        evidenceRefs: ["live_source_observation:freshness"],
      },
    });

    expect(result).toMatchObject({
      fresh: false,
      reason: "source_window_ref_mismatch",
    });
  });

  it("rejects graph mismatch when source refs do not match", () => {
    const result = evaluateStagePlayCheckpointFreshness({
      graph: graphFixture(),
      checkpoint: {
        checkpointId: "ask:turn:old",
        graphId: "stage_play_badge_graph:old",
        createdAt: "2026-06-03T12:00:01.000Z",
        modelReviewed: true,
        evidenceRefs: ["live_source_observation:old"],
      },
    });

    expect(result).toMatchObject({
      fresh: false,
      reason: "graph_id_mismatch",
    });
  });

  it("rejects stale source windows", () => {
    const graph = graphFixture({
      sourceWindow: {
        ...graphFixture().sourceWindow,
        freshness: "stale",
      },
    });
    const result = evaluateStagePlayCheckpointFreshness({
      graph,
      checkpoint: {
        checkpointId: "ask:turn:fresh",
        graphId: graph.graphId,
        createdAt: "2026-06-03T12:00:01.000Z",
        modelReviewed: true,
      },
    });

    expect(result).toMatchObject({
      fresh: false,
      reason: "source_window_stale",
    });
  });

  it("rejects checkpoints produced before the latest source event", () => {
    const result = evaluateStagePlayCheckpointFreshness({
      graph: graphFixture(),
      checkpoint: {
        checkpointId: "ask:turn:expired",
        graphId: "stage_play_badge_graph:freshness",
        createdAt: "2026-06-03T11:59:58.000Z",
        modelReviewed: true,
      },
    });

    expect(result).toMatchObject({
      fresh: false,
      reason: "checkpoint_expired",
    });
  });
});
