import { describe, expect, it, beforeEach } from "vitest";
import { buildStagePlayBadgeGraphV1, type StagePlayBadgeGraphV1 } from "@shared/contracts/stage-play-badge-graph.v1";
import {
  listStagePlayPerturbationEvents,
  recordStagePlayPerturbationFromGraph,
  resetStagePlayPerturbationEventsForTest,
} from "../services/stage-play/stage-play-perturbation-event-store";

const graphFixture = (input: {
  graphId?: string;
  observationRef: string;
  visualLastEventTs: string;
  sourceRoute?: "narrative_stage_play" | "visual_context";
  includeMissingEvidenceBadge?: boolean;
  includeAnswerSnapshot?: boolean;
}): StagePlayBadgeGraphV1 =>
  buildStagePlayBadgeGraphV1({
    generatedAt: input.visualLastEventTs,
    graphId: input.graphId ?? "stage_play_badge_graph:perturbation",
    title: "Perturbation graph fixture",
    description: "Fixture graph for perturbation reducer tests.",
    sourceWindow: {
      threadId: "thread:perturbation",
      roomId: null,
      environmentId: null,
      fromTs: input.visualLastEventTs,
      toTs: input.visualLastEventTs,
      latestObservationRefs: [input.observationRef],
      latestSourceDescriptorRefs: [],
      latestSourceProducerRefs: ["live_source_producer:visual"],
      latestRawSessionBufferRefs: [],
      latestSnapshotRefs: [],
      latestDeltaOverlayRefs: [],
      latestNavigationRefs: [],
      sources: [{
        sourceId: "visual_source:tab",
        modality: "visual_frame",
        status: "active",
        contribution: "Visual frame source.",
        fidelityScore: 0.8,
        selectedForStagePlay: true,
        routeTo: input.sourceRoute ?? "narrative_stage_play",
        cadenceMs: 10000,
        lastEventTs: input.visualLastEventTs,
        evidenceRefs: [input.observationRef],
      }],
      freshness: "fresh",
    },
    badges: [{
      id: "observer.live_sources",
      title: "Observer",
      plainMeaning: "Source custody.",
      whyItMatters: "Tracks source custody.",
      kind: "observer",
      status: "observed",
      subjects: ["visual_source:tab"],
      tags: ["observer"],
      liveBindings: [],
      sourceRefs: [{ kind: "live_source_producer", id: "live_source_producer:visual" }],
      evidenceRefs: [input.observationRef],
      confidence: 0.8,
      missingEvidence: [],
      reasonCodes: ["observer_source_custody"],
      admission: "auto",
    }, {
      id: "compact_observation.latest",
      title: "Compact observation",
      plainMeaning: "Latest compact observation.",
      whyItMatters: "Feeds interpretation.",
      kind: "compact_observation",
      status: "observed",
      subjects: ["visual_source:tab"],
      tags: ["compact_observation"],
      liveBindings: [],
      sourceRefs: [{ kind: "live_source_observation", id: input.observationRef }],
      evidenceRefs: [input.observationRef],
      confidence: 0.76,
      missingEvidence: [],
      reasonCodes: ["compact_source_window"],
      admission: "auto",
    },
    ...(input.includeMissingEvidenceBadge ? [{
      id: "missing_evidence.audio_transcript",
      title: "Audio transcript missing",
      plainMeaning: "Audio transcript is missing.",
      whyItMatters: "Narrative intent should not be overclaimed.",
      kind: "missing_evidence" as const,
      status: "missing_evidence" as const,
      subjects: ["visual_source:tab"],
      tags: ["missing_evidence"],
      liveBindings: [],
      sourceRefs: [{ kind: "live_source_observation" as const, id: input.observationRef }],
      evidenceRefs: [input.observationRef],
      confidence: 0.7,
      missingEvidence: ["Audio transcript source is needed for narrative intent."],
      reasonCodes: ["visual_active_audio_missing"],
      admission: "auto" as const,
    }] : []),
    ...(input.includeAnswerSnapshot ? [{
      id: "answer_snapshot.latest",
      title: "Answer snapshot",
      plainMeaning: "Latest model-reviewed answer snapshot.",
      whyItMatters: "The current checkpoint output should not stale itself.",
      kind: "answer_snapshot" as const,
      status: "observed" as const,
      subjects: ["turn:stage-play"],
      tags: ["answer_snapshot", "model_reviewed"],
      liveBindings: [],
      sourceRefs: [{ kind: "synthetic_evidence" as const, id: "turn:stage-play" }],
      evidenceRefs: [input.observationRef, "turn:stage-play"],
      confidence: 0.86,
      missingEvidence: [],
      reasonCodes: ["answer_snapshot_from_checkpoint"],
      output: {
        lineKey: "answer_snapshot",
        text: "Model-reviewed checkpoint is available.",
        state: "model_reviewed" as const,
        voiceEligible: false,
      },
      admission: "auto" as const,
    }] : [])],
    edges: [],
    recommendedActions: [],
  });

beforeEach(() => {
  resetStagePlayPerturbationEventsForTest();
});

describe("Stage Play perturbation event store", () => {
  it("records first usable observation as meaningful and checkpoint-suggesting", () => {
    const result = recordStagePlayPerturbationFromGraph({
      jobId: "stage_play_job:test",
      graph: graphFixture({
        observationRef: "live_source_observation:first",
        visualLastEventTs: "2026-06-03T12:00:00.000Z",
      }),
      now: "2026-06-03T12:00:00.000Z",
    });

    expect(result.event).toMatchObject({
      reason: "first_usable_observation",
      materiality: "meaningful",
      checkpointSuggested: true,
      assistant_answer: false,
      context_role: "tool_evidence",
    });
    expect(result.latestEvents).toHaveLength(1);
  });

  it("records subsequent visual-only frame changes as minor pulse events", () => {
    recordStagePlayPerturbationFromGraph({
      jobId: "stage_play_job:test",
      graph: graphFixture({
        observationRef: "live_source_observation:first",
        visualLastEventTs: "2026-06-03T12:00:00.000Z",
      }),
      now: "2026-06-03T12:00:00.000Z",
    });
    const result = recordStagePlayPerturbationFromGraph({
      jobId: "stage_play_job:test",
      graph: graphFixture({
        graphId: "stage_play_badge_graph:perturbation:next",
        observationRef: "live_source_observation:next-frame",
        visualLastEventTs: "2026-06-03T12:00:10.000Z",
      }),
      now: "2026-06-03T12:00:10.000Z",
    });

    expect(result.event).toMatchObject({
      reason: "new_visual_frame",
      materiality: "minor",
      checkpointSuggested: false,
      staleAnswerSnapshotIds: [],
    });
    expect(listStagePlayPerturbationEvents({ jobId: "stage_play_job:test", limit: 10 })).toHaveLength(2);
  });

  it("does not stale a model-reviewed answer snapshot when the checkpoint itself resolves missing evidence", () => {
    recordStagePlayPerturbationFromGraph({
      jobId: "stage_play_job:test",
      graph: graphFixture({
        observationRef: "live_source_observation:first",
        visualLastEventTs: "2026-06-03T12:00:00.000Z",
        includeMissingEvidenceBadge: true,
      }),
      now: "2026-06-03T12:00:00.000Z",
    });

    const result = recordStagePlayPerturbationFromGraph({
      jobId: "stage_play_job:test",
      graph: graphFixture({
        observationRef: "live_source_observation:first",
        visualLastEventTs: "2026-06-03T12:00:05.000Z",
        includeAnswerSnapshot: true,
      }),
      now: "2026-06-03T12:00:05.000Z",
    });

      expect(result.event).toMatchObject({
        reason: "missing_evidence_resolved",
        materiality: "minor",
        checkpointSuggested: false,
        staleAnswerSnapshotIds: [],
      });
  });
});
