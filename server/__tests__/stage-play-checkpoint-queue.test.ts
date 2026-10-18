import { beforeEach, describe, expect, it } from "vitest";
import { buildStagePlayBadgeGraphV1, type StagePlayBadgeGraphV1 } from "@shared/contracts/stage-play-badge-graph.v1";
import { buildStagePlayPerturbationEventV1 } from "@shared/contracts/stage-play-perturbation-event.v1";
import {
  applyStagePlayCheckpointQueueAction,
  completeStagePlayCheckpointRequestForGraph,
  enqueueManualStagePlayCheckpointRequest,
  getStagePlayCheckpointQueue,
  recordStagePlayCheckpointRequestFromPerturbation,
  resetStagePlayCheckpointQueueForTest,
} from "../services/stage-play/stage-play-checkpoint-queue";

function graphFixture(): StagePlayBadgeGraphV1 {
  return buildStagePlayBadgeGraphV1({
    generatedAt: "2026-06-03T10:00:00.000Z",
    graphId: "stage_play_badge_graph:queue",
    title: "Stage Play Badge Graph",
    description: "Track the live source and produce visible checkpoints.",
    sourceWindow: {
      threadId: "thread:queue",
      roomId: "room:queue",
      worldId: null,
      environmentId: "live_env:queue",
      fromTs: "2026-06-03T09:59:50.000Z",
      toTs: "2026-06-03T10:00:00.000Z",
      latestObservationRefs: ["live_source_observation:queue"],
      latestSourceDescriptorRefs: [],
      latestSourceProducerRefs: [],
      latestRawSessionBufferRefs: [],
      sources: [],
      sourceRoutes: [],
      latestSnapshotRefs: [],
      latestDeltaOverlayRefs: [],
      latestNavigationRefs: [],
      freshness: "fresh",
    },
    badges: [
      {
        id: "compact_observation.latest",
        title: "Latest Compact Observation",
        plainMeaning: "Compact source evidence.",
        whyItMatters: "Checkpoint requests should cite compact observations.",
        kind: "compact_observation",
        status: "observed",
        subjects: ["source"],
        tags: ["compact_observation"],
        liveBindings: [],
        sourceRefs: [{ kind: "stage_play_compact_observation", id: "stage_play_compact_observation:queue" }],
        evidenceRefs: ["stage_play_compact_observation:queue"],
        confidence: 0.8,
        missingEvidence: [],
        reasonCodes: ["compact_source_window"],
      },
      {
        id: "answer_snapshot.latest",
        title: "Latest Answer Snapshot",
        plainMeaning: "Prior reviewed answer.",
        whyItMatters: "Meaningful perturbations can stale it.",
        kind: "answer_snapshot",
        status: "observed",
        subjects: ["thread:queue"],
        tags: ["answer_snapshot"],
        liveBindings: [],
        sourceRefs: [],
        evidenceRefs: ["ask_turn_solver_trace:prior"],
        confidence: 0.9,
        missingEvidence: [],
        reasonCodes: ["model_reviewed"],
        output: {
          lineKey: "answer_snapshot",
          text: "Hold until the next frame.",
          state: "model_reviewed",
          voiceEligible: false,
        },
      },
    ],
    edges: [],
    recommendedActions: [],
  });
}

beforeEach(() => {
  resetStagePlayCheckpointQueueForTest();
});

describe("Stage Play checkpoint queue", () => {
  it("queues meaningful perturbations but not minor frame pulses", () => {
    const graph = graphFixture();
    const minor = buildStagePlayPerturbationEventV1({
      perturbationId: "stage_play_perturbation_event:minor",
      jobId: "stage_play_job:queue",
      graphId: graph.graphId,
      sourceWindowFromRefs: ["live_source_observation:old"],
      sourceWindowToRefs: ["live_source_observation:new"],
      reason: "new_visual_frame",
      affectedBadgeIds: ["compact_observation.latest"],
      staleAnswerSnapshotIds: [],
      materiality: "minor",
      checkpointSuggested: false,
      evidenceRefs: ["live_source_observation:new"],
      createdAt: "2026-06-03T10:00:01.000Z",
    });

    expect(recordStagePlayCheckpointRequestFromPerturbation({
      jobId: "stage_play_job:queue",
      graph,
      perturbation: minor,
      now: "2026-06-03T10:00:01.000Z",
    })).toBeNull();
    expect(getStagePlayCheckpointQueue({ jobId: "stage_play_job:queue" }).requests).toEqual([]);

    const meaningful = buildStagePlayPerturbationEventV1({
      perturbationId: "stage_play_perturbation_event:meaningful",
      jobId: "stage_play_job:queue",
      graphId: graph.graphId,
      sourceWindowFromRefs: ["live_source_observation:new"],
      sourceWindowToRefs: ["live_source_observation:next"],
      reason: "scene_change",
      affectedBadgeIds: ["compact_observation.latest"],
      staleAnswerSnapshotIds: ["answer_snapshot.latest"],
      materiality: "meaningful",
      checkpointSuggested: true,
      evidenceRefs: ["live_source_observation:next"],
      createdAt: "2026-06-03T10:00:02.000Z",
    });
    const request = recordStagePlayCheckpointRequestFromPerturbation({
      jobId: "stage_play_job:queue",
      graph,
      perturbation: meaningful,
      now: "2026-06-03T10:00:02.000Z",
    });

    expect(request).toMatchObject({
      artifactId: "stage_play_checkpoint_request",
      reason: "meaningful_perturbation",
      status: "queued",
      assistant_answer: false,
      context_role: "tool_evidence",
    });
    expect(request?.perturbationRefs).toEqual(["stage_play_perturbation_event:meaningful"]);
    expect(request?.priorAnswerSnapshotRefs).toEqual(expect.arrayContaining(["answer_snapshot.latest"]));
  });

  it("prioritizes manual requests and allows only one running checkpoint", () => {
    const graph = graphFixture();
    const automatic = buildStagePlayPerturbationEventV1({
      perturbationId: "stage_play_perturbation_event:auto",
      jobId: "stage_play_job:queue",
      graphId: graph.graphId,
      sourceWindowFromRefs: [],
      sourceWindowToRefs: ["live_source_observation:queue"],
      reason: "first_usable_observation",
      affectedBadgeIds: ["compact_observation.latest"],
      staleAnswerSnapshotIds: [],
      materiality: "meaningful",
      checkpointSuggested: true,
      evidenceRefs: ["live_source_observation:queue"],
      createdAt: "2026-06-03T10:00:01.000Z",
    });
    recordStagePlayCheckpointRequestFromPerturbation({
      jobId: "stage_play_job:queue",
      graph,
      perturbation: automatic,
      now: "2026-06-03T10:00:01.000Z",
    });
    const manual = enqueueManualStagePlayCheckpointRequest({
      jobId: "stage_play_job:queue",
      graph,
      objective: "Manually checkpoint this scene.",
      userPromptRef: "user_prompt:queue",
      now: "2026-06-03T10:00:02.000Z",
    });

    expect(getStagePlayCheckpointQueue({ jobId: "stage_play_job:queue" }).requests[0]).toMatchObject({
      checkpointRequestId: manual.checkpointRequestId,
      reason: "user_requested_checkpoint",
    });

    const runManual = applyStagePlayCheckpointQueueAction({
      jobId: "stage_play_job:queue",
      action: "run",
      checkpointRequestId: manual.checkpointRequestId,
      now: "2026-06-03T10:00:03.000Z",
    });
    expect(runManual.ok).toBe(true);
    expect(runManual.request?.status).toBe("running");

    const automaticRequest = getStagePlayCheckpointQueue({ jobId: "stage_play_job:queue" })
      .requests.find((request) => request.reason === "first_usable_observation");
    const runAutomatic = applyStagePlayCheckpointQueueAction({
      jobId: "stage_play_job:queue",
      action: "run",
      checkpointRequestId: automaticRequest?.checkpointRequestId,
      now: "2026-06-03T10:00:04.000Z",
    });
    expect(runAutomatic.ok).toBe(false);
    expect(runAutomatic.reason).toBe("running_request_exists");
  });

  it("completes the matching running checkpoint when a model-reviewed Ask receipt is stored", () => {
    const graph = graphFixture();
    const manual = enqueueManualStagePlayCheckpointRequest({
      jobId: "stage_play_job:queue",
      graph,
      objective: "Checkpoint the current visual scene.",
      userPromptRef: "user_prompt:queue",
      now: "2026-06-03T10:00:02.000Z",
    });
    const runManual = applyStagePlayCheckpointQueueAction({
      jobId: "stage_play_job:queue",
      action: "run",
      checkpointRequestId: manual.checkpointRequestId,
      now: "2026-06-03T10:00:03.000Z",
    });
    expect(runManual.request?.status).toBe("running");

    const completion = completeStagePlayCheckpointRequestForGraph({
      graphId: graph.graphId,
      now: "2026-06-03T10:00:04.000Z",
    });

    expect(completion).toMatchObject({
      ok: true,
      action: "complete",
      request: expect.objectContaining({
        checkpointRequestId: manual.checkpointRequestId,
        status: "completed",
      }),
      assistant_answer: false,
      context_role: "tool_evidence",
    });
    expect(getStagePlayCheckpointQueue({ jobId: "stage_play_job:queue" }).requests[0]).toMatchObject({
      checkpointRequestId: manual.checkpointRequestId,
      status: "completed",
    });
  });

  it("completes by exact checkpoint request id even when the graph id has shifted", () => {
    const graph = graphFixture();
    const manual = enqueueManualStagePlayCheckpointRequest({
      jobId: "stage_play_job:queue",
      graph,
      objective: "Checkpoint after Observer route changes.",
      userPromptRef: "user_prompt:queue",
      now: "2026-06-03T10:01:02.000Z",
    });
    applyStagePlayCheckpointQueueAction({
      jobId: "stage_play_job:queue",
      action: "run",
      checkpointRequestId: manual.checkpointRequestId,
      now: "2026-06-03T10:01:03.000Z",
    });

    const completion = completeStagePlayCheckpointRequestForGraph({
      graphId: "stage_play_badge_graph:route-shifted",
      checkpointRequestId: manual.checkpointRequestId,
      now: "2026-06-03T10:01:04.000Z",
    });

    expect(completion).toMatchObject({
      ok: true,
      request: expect.objectContaining({
        checkpointRequestId: manual.checkpointRequestId,
        status: "completed",
      }),
    });
  });
});
