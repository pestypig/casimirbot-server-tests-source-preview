import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { executeLiveEnvironmentTool } from "../services/helix-ask/live-environment-tool-adapter";
import { resetLiveAnswerEnvironments } from "../services/situation-room/live-answer-environment-store";
import { resetLiveSourceChunkBufferForTest } from "../services/situation-room/live-source-chunk-buffer";
import { resetSituationSourceCapabilitiesForTest } from "../services/situation-room/situation-source-capability-store";
import { clearInterpretedEventLogForTest } from "../services/situation-room/interpreted-event-log-store";
import { resetVisualSnapshotStoreForTest } from "../services/situation-room/visual-snapshot-store";
import { resetStagePlayLiveSourceMailboxForTest } from "../services/stage-play/stage-play-live-source-mailbox-store";
import {
  listStagePlayGoalContextUpdates,
  resetStagePlayGoalContextStoreForTest,
} from "../services/stage-play/stage-play-goal-context-store";

const threadId = "helix-ask:desktop";

const createApp = async (): Promise<express.Express> => {
  const { planRouter } = await import("../routes/agi.plan");
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/agi", planRouter);
  return app;
};

describe("Helix Ask ImageLens goal-context bridge", () => {
  beforeEach(() => {
    resetVisualSnapshotStoreForTest();
    resetSituationSourceCapabilitiesForTest();
    resetLiveAnswerEnvironments();
    resetLiveSourceChunkBufferForTest();
    clearInterpretedEventLogForTest();
    resetStagePlayLiveSourceMailboxForTest();
    resetStagePlayGoalContextStoreForTest();
  });

  it("routes ImageLens crop analysis into goal-scoped visual summary context", async () => {
    const app = await createApp();
    const sourceId = "visual_source:image-lens";
    const goalId = "goal:image-lens-frog";
    const analysisResponse = await request(app)
      .post("/api/agi/situation/visual-frame/analyze")
      .send({
        thread_id: threadId,
        room_id: "room:image-lens",
        source_id: sourceId,
        source_surface: "image_lens_crop",
        capture_mode: "manual",
        crop_only: true,
        crop_region_id: "frog-region",
        image_base64:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6f5VQAAAAASUVORK5CYII=",
        summary: "ImageLens crop shows a small green frog on a leaf.",
        detected_objects: ["frog", "leaf"],
        objective: "Classify frog imagery from ImageLens.",
      })
      .expect(200);

    expect(analysisResponse.body).toMatchObject({
      ok: true,
      assistant_answer: false,
      raw_image_included: false,
      stage_play_live_source_mail_item: {
        sourceId,
        sourceKind: "visual_frame",
        summary: expect.objectContaining({
          preview: expect.stringContaining("small green frog"),
        }),
      },
    });

    const sessionObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.start_agent_goal_session",
      thread_id: threadId,
      args: {
        room_id: "room:image-lens",
        source_id: sourceId,
        goal_id: goalId,
        objective: "Classify frog imagery from ImageLens.",
        context_feeds: ["visual_summaries"],
        allowed_actuators: ["query_visual_summaries"],
      },
    });
    expect(sessionObservation.ok).toBe(true);

    const queryObservation = executeLiveEnvironmentTool({
      tool_name: "live_env.query_visual_summaries",
      thread_id: threadId,
      args: {
        room_id: "room:image-lens",
        source_id: sourceId,
        goal_id: goalId,
      },
    });
    const payload = queryObservation.observation as any;

    expect(queryObservation).toMatchObject({
      tool_name: "live_env.query_visual_summaries",
      ok: true,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(payload).toMatchObject({
      schema: "stage_play_workstation_context_feed_query_result/v1",
      feedKind: "visual_summaries",
      requiredActuator: "query_visual_summaries",
      matchedAllowedActuators: ["query_visual_summaries"],
      matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:query_visual_summaries"],
      terminalAuthority: {
        status: "not_terminal",
        finalAnswerEligible: false,
        completedSolverPathRequired: true,
        terminalAuthoritySingleWriterRequired: true,
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(payload.goalContextUpdates).toEqual([
      expect.objectContaining({
        producerKind: "visual_capture",
        updateKind: "visual_observation",
        preview: expect.stringContaining("small green frog"),
        sourceRefs: expect.arrayContaining([sourceId]),
        evidenceRefs: expect.arrayContaining([
          analysisResponse.body.evidence.evidence_id,
          analysisResponse.body.evidence.frame_id,
        ]),
        authority: {
          assistantAnswer: false,
          terminalEligible: false,
          rawContentIncluded: false,
          postToolModelStepRequired: true,
        },
      }),
    ]);
    expect(payload.agentGoalSession).toMatchObject({
      goalId,
      checkpoints: expect.arrayContaining([
        expect.objectContaining({
          actionsTaken: expect.arrayContaining(["query_visual_summaries", "live_env.query_visual_summaries"]),
          nextStep: "continue",
        }),
      ]),
    });

    const queryUpdate = listStagePlayGoalContextUpdates({
      threadId,
      contentRef: payload.resultId,
      producerKind: "route_watch",
      limit: 1,
    })[0];
    expect(queryUpdate).toMatchObject({
      updateKind: "route_evidence",
      toolIdentity: {
        requestedToolName: "live_env.query_visual_summaries",
        canonicalToolName: "live_env.query_visual_summaries",
        matchedAllowedActuators: ["query_visual_summaries"],
        matchedAllowedActuatorRefs: ["agent_goal_allowed_actuator:query_visual_summaries"],
      },
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
  }, 30000);
});
