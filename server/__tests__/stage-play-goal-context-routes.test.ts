import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { helixStagePlayRouter } from "../routes/helix/stage-play";
import {
  enqueueStagePlayLiveSourceMailItem,
  resetStagePlayLiveSourceMailboxForTest,
} from "../services/stage-play/stage-play-live-source-mailbox-store";
import {
  recordStagePlayMicroReasonerRun,
  recordStagePlayProcessedMailPacket,
  resetStagePlayProcessedMailPacketStoreForTest,
} from "../services/stage-play/stage-play-processed-mail-packet-store";
import { resetStagePlayGoalContextStoreForTest } from "../services/stage-play/stage-play-goal-context-store";
import { WORKSTATION_AGENT_GOAL_DEFAULT_FINAL_REPORT_REQUIREMENTS } from "@shared/contracts/workstation-goal-context.v1";

const makeApp = () => {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/helix/stage-play", helixStagePlayRouter);
  return app;
};

beforeEach(() => {
  resetStagePlayLiveSourceMailboxForTest();
  resetStagePlayProcessedMailPacketStoreForTest();
  resetStagePlayGoalContextStoreForTest();
});

describe("Stage Play goal-context routes", () => {
  it("returns explicitly non-terminal goal sessions through the query endpoint", async () => {
    const app = makeApp();

    await request(app)
      .post("/api/helix/stage-play/goal-session")
      .send({
        threadId: "helix-ask:desktop",
        goalId: "goal:frog-classification",
        objective: "Monitor the image source and prepare frog classification evidence.",
        sourceRefs: ["visual_source:image-lens"],
        loopRefs: ["stage_play_mail_loop:helix-ask:desktop"],
        allowedActuators: [
          "live_env.query_visual_summaries",
          "live_env.set_workstation_loop_state",
          "live_env.narrator_bind_stream",
        ],
        finalReportRequirements: {
          ...WORKSTATION_AGENT_GOAL_DEFAULT_FINAL_REPORT_REQUIREMENTS,
          requiredEvidenceKinds: [
            ...WORKSTATION_AGENT_GOAL_DEFAULT_FINAL_REPORT_REQUIREMENTS.requiredEvidenceKinds,
            "goal_context_update",
            "terminal_authority_single_writer",
          ],
        },
      })
      .expect(200);

    const response = await request(app)
      .get("/api/helix/stage-play/goal-context")
      .query({ threadId: "helix-ask:desktop", goalId: "goal:frog-classification" })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      schema: "stage_play_goal_context_query_response/v1",
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });
    expect(response.body.agentGoalSessions[0]).toMatchObject({
      goalId: "goal:frog-classification",
      allowedActuators: expect.arrayContaining([
        "query_visual_summaries",
        "set_loop_state",
        "narrator_bind_stream",
      ]),
      authority: {
        assistantAnswer: false,
        finalReportsRequireTerminalAuthority: true,
        finalReportRequirements: expect.objectContaining({
          completedSolverPathRequired: true,
          evidenceReentryRequired: true,
          routeAuthorityRequired: true,
          terminalAuthoritySingleWriterRequired: true,
          requiredEvidenceKinds: expect.arrayContaining(["goal_context_update", "terminal_authority_single_writer"]),
        }),
      },
    });
  });

  it("updates goal-session lifecycle state through the action endpoint", async () => {
    const app = makeApp();

    await request(app)
      .post("/api/helix/stage-play/goal-session")
      .send({
        threadId: "helix-ask:desktop",
        goalId: "goal:operator-arc",
        objective: "Implement the goal-directed workstation operator architecture.",
        sourceRefs: ["stage_play_goal:operator-arc"],
      })
      .expect(200);

    const paused = await request(app)
      .post("/api/helix/stage-play/goal-session/action")
      .send({
        threadId: "helix-ask:desktop",
        goalId: "goal:operator-arc",
        action: "pause",
      })
      .expect(200);

    expect(paused.body).toMatchObject({
      ok: true,
      schema: "stage_play_goal_session_action_response/v1",
      action: "pause",
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
      session: {
        goalId: "goal:operator-arc",
        status: "paused",
      },
    });
    expect(paused.body.session.checkpoints.at(-1)).toMatchObject({
      summary: "Goal pause from the Helix Ask goal pill.",
      actionsTaken: expect.arrayContaining(["helix_ask_goal_pill:pause", "set_goal_status:paused"]),
    });

    const edited = await request(app)
      .post("/api/helix/stage-play/goal-session/action")
      .send({
        threadId: "helix-ask:desktop",
        goalId: "goal:operator-arc",
        action: "edit_objective",
        objective: "Expose goal controls on the Helix Ask bar.",
      })
      .expect(200);

    expect(edited.body.session).toMatchObject({
      goalId: "goal:operator-arc",
      status: "paused",
      objective: "Expose goal controls on the Helix Ask bar.",
      userVisibleSummary: "Expose goal controls on the Helix Ask bar.",
    });
    expect(edited.body.session.checkpoints.at(-1).actionsTaken).toEqual(expect.arrayContaining([
      "helix_ask_goal_pill:edit_objective",
      "edit_goal_objective",
    ]));

    const resumed = await request(app)
      .post("/api/helix/stage-play/goal-session/action")
      .send({
        threadId: "helix-ask:desktop",
        goalId: "goal:operator-arc",
        action: "resume",
      })
      .expect(200);

    expect(resumed.body.session.status).toBe("active");

    const archived = await request(app)
      .post("/api/helix/stage-play/goal-session/action")
      .send({
        threadId: "helix-ask:desktop",
        goalId: "goal:operator-arc",
        action: "archive",
      })
      .expect(200);

    expect(archived.body.session).toMatchObject({
      goalId: "goal:operator-arc",
      status: "stopped",
    });
    expect(archived.body.session.checkpoints.at(-1)).toMatchObject({
      summary: "Goal archived from the Helix Ask goal pill.",
      nextStep: "stop",
    });
  });

  it("adds backend-derived goal context to the live-source mailbox response", async () => {
    const app = makeApp();
    const mail = enqueueStagePlayLiveSourceMailItem({
      threadId: "helix-ask:desktop",
      roomId: "room:stage-play-route",
      environmentId: "env:desktop",
      sourceId: "visual_source:image-lens",
      sourceKind: "visual_frame",
      frameRef: "visual_frame:frog-route",
      evidenceRef: "visual_evidence:frog-route",
      summaryText: "ImageLens shows a frog image ready for classification.",
      summaryPreview: "Frog image visible in ImageLens.",
      objectiveId: "goal:frog-classification",
      objectiveText: "Monitor the image source and prepare frog classification evidence.",
      createdAt: "2026-06-17T14:10:00.000Z",
    });
    recordStagePlayMicroReasonerRun({
      artifactId: "stage_play_micro_reasoner_run",
      schemaVersion: "stage_play_micro_reasoner_run/v1",
      runId: "stage_play_micro_reasoner_run:frog-route",
      promptId: "stage_play_micro_reasoner_prompt:claim_extractor:v1",
      deckPresetId: "stage_play_micro_reasoner_prompt_preset:frog-classifier:v1",
      deckPresetTitle: "Frog classifier",
      deckRunPlan: "baseline_plus_prompted",
      deckRoleIndex: 1,
      deckRoleCount: 1,
      deckExecutionMode: "independent",
      deckProductRole: true,
      role: "claim_extractor",
      jobId: "stage_play_live_source_job:frog-route",
      sourceId: "visual_source:image-lens",
      mailIds: [mail.mailId],
      inputRefs: [mail.mailId],
      outputRefs: ["microdeck_output:frog-route"],
      inputPreview: "Frog image visible in ImageLens.",
      outputPreview: "Frog classification evidence is ready for review.",
      status: "completed",
      reasoningMode: "micro_live_interval",
      selectedDecision: "record_interpretation",
      salienceLevel: "medium",
      voiceCandidate: false,
      confidence: "high",
      startedAt: "2026-06-17T14:10:01.000Z",
      completedAt: "2026-06-17T14:10:02.000Z",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      context_role: "micro_reasoner_evidence",
    });
    recordStagePlayProcessedMailPacket({
      artifactId: "stage_play_processed_mail_packet",
      schemaVersion: "stage_play_processed_mail_packet/v1",
      packetId: "stage_play_processed_mail_packet:frog-route",
      jobId: "stage_play_live_source_job:frog-route",
      sourceId: "visual_source:image-lens",
      mailIds: [mail.mailId],
      visualEvidenceRefs: ["visual_evidence:frog-route"],
      observedFacts: ["A frog image is visible in ImageLens."],
      inferredFacts: ["The visual source can feed a frog classification MicroDeck."],
      uncertainties: ["Species is not terminally classified."],
      stableFactsUsed: ["ImageLens source is active."],
      changedFacts: ["New frog image captured."],
      sceneTags: ["image_lens"],
      activityTags: ["classification"],
      objectTags: ["frog"],
      matchedCriteria: ["frog_classification_candidate"],
      suppressedCriteria: [],
      riskMatches: [],
      opportunityMatches: ["classification_evidence"],
      voiceCalloutMatches: [],
      salience: {
        level: "medium",
        reasons: ["classification evidence available"],
        voiceCandidate: false,
      },
      recommendedNext: "record_interpretation",
      watchNext: ["frog markings"],
      resolutionState: "processed_packet_ready",
      microReasonerRunRefs: ["stage_play_micro_reasoner_run:frog-route"],
      evidenceRefs: ["stage_play_processed_mail_packet:frog-route", "microdeck_output:frog-route"],
      createdAt: "2026-06-17T14:10:03.000Z",
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
    });

    const response = await request(app)
      .get("/api/helix/stage-play/live-source-mail")
      .query({
        threadId: "helix-ask:desktop",
        sourceId: "visual_source:image-lens",
        view: "full",
      })
      .expect(200);

    expect(response.body.goalContextUpdates).toHaveLength(2);
    expect(response.body.goalContextUpdates[0]).toMatchObject({
      contentRef: "stage_play_processed_mail_packet:frog-route",
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(response.body.goalContextUpdates[1]).toMatchObject({
      producerKind: "visual_capture",
      updateKind: "visual_observation",
      contentRef: expect.stringMatching(/^stage_play_live_source_mail:/),
      authority: {
        assistantAnswer: false,
        terminalEligible: false,
        rawContentIncluded: false,
        postToolModelStepRequired: true,
      },
    });
    expect(response.body.agentGoalSessions[0]).toMatchObject({
      goalId: "goal:frog-classification",
      authority: {
        assistantAnswer: false,
        finalReportsRequireTerminalAuthority: true,
      },
    });
  });
});
