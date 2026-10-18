import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import {
  helixStagePlayRouter,
  resolveStagePlayWakeManualRunForRoute,
} from "../routes/helix/stage-play";
import {
  createLiveAnswerEnvironment,
  resetLiveAnswerEnvironments,
} from "../services/situation-room/live-answer-environment-store";
import {
  listStagePlayCheckpointRequests,
  resetStagePlayCheckpointQueueForTest,
} from "../services/stage-play/stage-play-checkpoint-queue";
import {
  resetLiveSourceChunkBufferForTest,
  upsertLiveSourceProducer,
} from "../services/situation-room/live-source-chunk-buffer";
import {
  enqueueStagePlayLiveSourceMailItem,
  resetStagePlayLiveSourceMailboxForTest,
} from "../services/stage-play/stage-play-live-source-mailbox-store";
import {
  recordStagePlayLiveSourceMailTranscriptEntries,
  resetStagePlayLiveSourceMailTranscriptStoreForTest,
} from "../services/stage-play/stage-play-live-source-mail-transcript-store";
import { resetStagePlayGoalContextStoreForTest } from "../services/stage-play/stage-play-goal-context-store";
import { resetStagePlayProcessedMailPacketStoreForTest } from "../services/stage-play/stage-play-processed-mail-packet-store";

function makeApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/helix/stage-play", helixStagePlayRouter);
  return app;
}

beforeEach(() => {
  resetLiveAnswerEnvironments();
  resetStagePlayCheckpointQueueForTest();
  resetStagePlayLiveSourceMailboxForTest();
  resetStagePlayLiveSourceMailTranscriptStoreForTest();
  resetStagePlayGoalContextStoreForTest();
  resetStagePlayProcessedMailPacketStoreForTest();
  resetLiveSourceChunkBufferForTest();
});

describe("GET /api/helix/stage-play/graph", () => {
  it("returns a stage_play_badge_graph/v1 artifact", async () => {
    const app = makeApp();

    const response = await request(app).get("/api/helix/stage-play/graph").expect(200);

    expect(response.body.artifactId).toBe("stage_play_badge_graph");
    expect(response.body.schemaVersion).toBe("stage_play_badge_graph/v1");
    expect(response.body.badges).toEqual(expect.any(Array));
    expect(response.body.edges).toEqual(expect.any(Array));
    expect(response.body.recommendedActions).toEqual(expect.any(Array));
    expect(response.body.authority).toMatchObject({
      assistant_answer: false,
      raw_content_included: false,
      terminal_eligible: false,
      agent_executable: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
    expect(JSON.stringify(response.body)).not.toMatch(/\braw[_ -]?(?:chunk|nbt|log|user[_ -]?text)\b/i);
  });

  it("uses query identifiers to scope the transient source window", async () => {
    const app = makeApp();

    const response = await request(app)
      .get("/api/helix/stage-play/graph")
      .query({
        threadId: "thread:ui-live",
        roomId: "room:ui-live",
        environmentId: "live_env:ui-live",
      })
      .expect(200);

    expect(response.body.sourceWindow).toMatchObject({
      threadId: "thread:ui-live",
      roomId: "room:ui-live",
      environmentId: "live_env:ui-live",
    });
  });

  it("exposes checkpoint queue controls as evidence-only route actions", async () => {
    const app = makeApp();
    upsertLiveSourceProducer({
      sourceId: "visual_source:queue-route",
      threadId: "thread:queue-route",
      modality: "visual_frame",
      status: "active",
      cadenceMs: 10000,
      captureMode: "interval",
      latestChunkId: "live_source_chunk:queue-route",
      now: "2026-06-03T12:00:00.000Z",
    });

    const graphResponse = await request(app)
      .get("/api/helix/stage-play/graph")
      .query({ threadId: "thread:queue-route", recordSideEffects: "true" })
      .expect(200);
    const requestId = graphResponse.body.checkpointRequests[0]?.checkpointRequestId;
    const jobId = graphResponse.body.checkpointRequests[0]?.jobId;
    expect(requestId).toMatch(/^stage_play_checkpoint_request:/);
    expect(jobId).toMatch(/^stage_play_job:/);

    const queueResponse = await request(app)
      .get("/api/helix/stage-play/checkpoint-queue")
      .query({ jobId })
      .expect(200);
    expect(queueResponse.body).toMatchObject({
      schema: "stage_play_checkpoint_queue/v1",
      assistant_answer: false,
      context_role: "tool_evidence",
    });
    expect(queueResponse.body.requests[0]).toMatchObject({
      checkpointRequestId: requestId,
      status: "queued",
    });

    const runResponse = await request(app)
      .post("/api/helix/stage-play/checkpoint-queue/action")
      .send({
        jobId,
        checkpointRequestId: requestId,
        action: "run",
      })
      .expect(200);
    expect(runResponse.body).toMatchObject({
      ok: true,
      schema: "stage_play_checkpoint_queue_action_response/v1",
      action: "run",
      reason: "updated",
      assistant_answer: false,
      context_role: "tool_evidence",
    });
    expect(runResponse.body.request.status).toBe("running");
  });

  it("keeps graph polling read-only unless side effects are explicitly requested", async () => {
    const app = makeApp();
    upsertLiveSourceProducer({
      sourceId: "visual_source:read-only-route",
      threadId: "thread:read-only-route",
      modality: "visual_frame",
      status: "active",
      cadenceMs: 10000,
      captureMode: "interval",
      latestChunkId: "live_source_chunk:read-only-route",
      now: "2026-06-03T12:00:00.000Z",
    });

    await request(app)
      .get("/api/helix/stage-play/graph")
      .query({ threadId: "thread:read-only-route" })
      .expect(200);

    expect(listStagePlayCheckpointRequests({ limit: 10 })).toEqual([]);
  });

  it("returns builder catalog and source-query artifacts for the panel", async () => {
    const app = makeApp();

    const response = await request(app)
      .get("/api/helix/stage-play/builder")
      .query({
        threadId: "thread:stage-builder",
        environmentId: "live_env:stage-builder",
      })
      .expect(200);

    expect(response.body.artifactId).toBe("stage_play_builder_context");
    expect(response.body.catalog.schemaVersion).toBe("stage_play_builder_catalog/v1");
    expect(response.body.sourceQuery.schemaVersion).toBe("stage_play_source_query/v1");
    expect(response.body.sourceQuery.threadId).toBe("thread:stage-builder");
    expect(response.body.sourceQuery.environmentId).toBe("live_env:stage-builder");
    expect(response.body.authority).toMatchObject({
      assistant_answer: false,
      terminal_eligible: false,
      agent_executable: false,
      context_role: "tool_evidence",
      ask_context_policy: "evidence_only",
    });
  });

  it("validates stage graph drafts without granting execution authority", async () => {
    const app = makeApp();

    const response = await request(app)
      .post("/api/helix/stage-play/draft/validate")
      .send({
        threadId: "thread:stage-builder",
        draft: {
          artifactId: "stage_play_graph_draft",
          schemaVersion: "stage_play_graph_draft/v1",
          draftId: "draft:missing-source",
          objective: "Assemble a source-bound stage.",
          nodes: [
            {
              id: "source.visual",
              kind: "source",
              bind: {
                sourceClass: "visual_frame",
                sourceId: "source:missing",
              },
            },
          ],
          edges: [],
          checkpointPolicy: {
            completeEachWindow: true,
            standingJobRemainsOpen: true,
          },
        },
      })
      .expect(422);

    expect(response.body.artifactId).toBe("stage_play_graph_draft_validation");
    expect(response.body.schemaVersion).toBe("stage_play_graph_draft_validation/v1");
    expect(response.body.ok).toBe(false);
    expect(response.body.issues.join("\n")).toMatch(/source:missing/);
    expect(response.body.authority).toMatchObject({
      assistant_answer: false,
      terminal_eligible: false,
      agent_executable: false,
    });
  });

  it("projects Stage Play output lanes into a created compatible Live Answer environment", async () => {
    const app = makeApp();

    const response = await request(app)
      .post("/api/helix/stage-play/project-live-answer")
      .send({
        threadId: "thread:stage-project",
        objective: "Project the current Stage Play graph into Live Answer.",
        createIfMissing: true,
        ensureStagePlayLineSchema: true,
        preferredPreset: "custom",
      })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      schema: "stage_play_live_answer_projection_response/v1",
      reason: "projected",
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      terminal_eligible: false,
    });
    expect(response.body.graph.artifactId).toBe("stage_play_badge_graph");
    expect(response.body.outputLaneProjection).toMatchObject({
      artifactId: "stage_play_output_lane_projection",
      assistant_answer: false,
      terminal_eligible: false,
      post_tool_model_step_required: true,
    });
    expect(response.body.environmentEnsure).toMatchObject({
      created: true,
      repairedLineSchema: false,
    });
    expect(response.body.environmentEnsure.addedLineKeys).toEqual(expect.arrayContaining([
      "situation",
      "actor_state",
      "resources",
      "affordances",
      "risk",
      "possibilities",
      "rehearsal",
      "recommendation",
      "answer_snapshot",
      "voice_output",
      "unknowns",
      "next_check",
      "debug_basis",
    ]));
    expect(response.body.liveAnswerEnvironment.lines.map((line: { key: string }) => line.key)).toEqual(expect.arrayContaining([
      "situation",
      "actor_state",
      "resources",
      "affordances",
      "risk",
      "possibilities",
      "rehearsal",
      "recommendation",
      "answer_snapshot",
      "voice_output",
      "unknowns",
      "debug_basis",
    ]));
    expect(response.body.projectedLineKeys).toEqual(expect.arrayContaining([
      "risk",
      "possibilities",
      "unknowns",
      "next_check",
    ]));
    expect(response.body.projectedLineKeys).not.toContain("situation");
    expect(response.body.projectedLineKeys).not.toContain("actor_state");
    expect(response.body.projectedLineKeys).not.toContain("recommendation");
    expect(response.body.projectedLineKeys).not.toContain("answer_snapshot");
    expect(response.body.projectedLineKeys).not.toContain("voice_output");
    expect(response.body.checkpointOnlySkipped).toEqual(expect.arrayContaining([
      "recommendation",
      "answer_snapshot",
      "voice_output",
    ]));
    expect(response.body.liveAnswerDelta).toMatchObject({
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      model_invoked: false,
    });
  });

  it("returns evidence-only JSON errors for oversized debug projection payloads", async () => {
    const app = makeApp();

    const response = await request(app)
      .post("/api/helix/stage-play/project-live-answer")
      .send({
        threadId: "thread:oversized-stage-play-probe",
        objective: "x".repeat(300_000),
      })
      .expect(413);

    expect(response.body).toMatchObject({
      ok: false,
      error: "stage_play_request_body_too_large",
      assistant_answer: false,
      raw_content_included: false,
      context_role: "tool_evidence",
      terminal_eligible: false,
      limitBytes: 262144,
    });
    expect(response.body.receivedBytes).toBeGreaterThan(262144);

    const followup = await request(app)
      .post("/api/helix/stage-play/project-live-answer")
      .send({
        threadId: "thread:oversized-stage-play-probe",
        objective: "Server should still answer after a rejected probe.",
        createIfMissing: true,
        ensureStagePlayLineSchema: true,
      })
      .expect(200);

    expect(followup.body).toMatchObject({
      ok: true,
      schema: "stage_play_live_answer_projection_response/v1",
      assistant_answer: false,
      context_role: "tool_evidence",
    });
  });

  it("reports a line schema mismatch instead of partially projecting incompatible Live Interpretation lanes", async () => {
    const app = makeApp();
    const { environment } = createLiveAnswerEnvironment({
      thread_id: "thread:stage-schema-mismatch",
      created_turn_id: "turn:generic",
      objective: "Generic visual live answer.",
      preset: "custom",
      now: "2026-06-02T14:00:00.000Z",
    });

    const response = await request(app)
      .post("/api/helix/stage-play/project-live-answer")
      .send({
        threadId: "thread:stage-schema-mismatch",
        environmentId: environment.environment_id,
        objective: "Try to project without changing the line schema.",
        ensureStagePlayLineSchema: false,
      })
      .expect(200);

    expect(response.body.reason).toBe("line_schema_mismatch");
    expect(response.body.liveAnswerDelta).toBeNull();
    expect(response.body.projectedLineKeys).toEqual([]);
    expect(response.body.skippedLineKeys).toEqual(expect.arrayContaining([
      "risk",
      "possibilities",
      "unknowns",
    ]));
    expect(response.body.skippedLineKeys).not.toContain("next_check");
    expect(response.body.skippedLineKeys).not.toContain("recommendation");
    expect(response.body.skippedLineKeys).not.toContain("answer_snapshot");
    expect(response.body.skippedLineKeys).not.toContain("voice_output");
    expect(response.body.checkpointOnlySkipped).toEqual(expect.arrayContaining([
      "recommendation",
      "answer_snapshot",
      "voice_output",
    ]));
    expect(response.body.liveAnswerEnvironment.environment_id).toBe(environment.environment_id);
  });

  it("repairs an explicitly selected generic environment with Stage Play line keys", async () => {
    const app = makeApp();
    const { environment } = createLiveAnswerEnvironment({
      thread_id: "thread:stage-explicit-repair",
      created_turn_id: "turn:generic",
      objective: "Generic visual live answer.",
      preset: "custom",
      now: "2026-06-02T14:10:00.000Z",
    });

    const response = await request(app)
      .post("/api/helix/stage-play/project-live-answer")
      .send({
        threadId: "thread:stage-explicit-repair",
        environmentId: environment.environment_id,
        objective: "Repair this selected environment for Stage Play output.",
        ensureStagePlayLineSchema: true,
      })
      .expect(200);

    expect(response.body.reason).toBe("projected");
    expect(response.body.liveAnswerEnvironment.environment_id).toBe(environment.environment_id);
    expect(response.body.environmentEnsure).toMatchObject({
      created: false,
      repairedLineSchema: true,
    });
    expect(response.body.environmentEnsure.missingBefore).toEqual(expect.arrayContaining([
      "situation",
      "actor_state",
      "possibilities",
      "recommendation",
      "answer_snapshot",
      "voice_output",
      "unknowns",
      "debug_basis",
    ]));
    expect(response.body.environmentEnsure.addedLineKeys).toEqual(expect.arrayContaining([
      "situation",
      "actor_state",
      "resources",
      "affordances",
      "risk",
      "possibilities",
      "rehearsal",
      "recommendation",
      "answer_snapshot",
      "voice_output",
      "unknowns",
      "debug_basis",
    ]));
    expect(response.body.liveAnswerEnvironment.lines.map((line: { key: string }) => line.key)).toEqual(expect.arrayContaining([
      "situation",
      "actor_state",
      "recommendation",
      "answer_snapshot",
      "voice_output",
      "debug_basis",
    ]));
    expect(response.body.projectedLineKeys).toEqual(expect.arrayContaining([
      "risk",
      "possibilities",
      "unknowns",
      "next_check",
    ]));
    expect(response.body.projectedLineKeys).not.toContain("recommendation");
    expect(response.body.projectedLineKeys).not.toContain("answer_snapshot");
    expect(response.body.projectedLineKeys).not.toContain("voice_output");
    expect(response.body.checkpointOnlySkipped).toEqual(expect.arrayContaining([
      "recommendation",
      "answer_snapshot",
      "voice_output",
    ]));
    expect(response.body.liveAnswerEnvironment.lines.find((line: { key: string; visibility: string }) =>
      line.key === "debug_basis"
    )?.visibility).toBe("situation_panel");
    expect(response.body.liveAnswerDelta).toMatchObject({
      assistant_answer: false,
      terminal_eligible: false,
      model_invoked: false,
    });
  });

  it("creates a Stage Play environment instead of repairing a generic active environment when none is explicit", async () => {
    const app = makeApp();
    const { environment } = createLiveAnswerEnvironment({
      thread_id: "thread:stage-generic-active",
      created_turn_id: "turn:generic",
      objective: "Generic visual live answer.",
      preset: "custom",
      now: "2026-06-02T14:20:00.000Z",
    });

    const response = await request(app)
      .post("/api/helix/stage-play/project-live-answer")
      .send({
        threadId: "thread:stage-generic-active",
        objective: "Create a Stage Play surface for this thread.",
        createIfMissing: true,
        ensureStagePlayLineSchema: true,
      })
      .expect(200);

    expect(response.body.reason).toBe("projected");
    expect(response.body.liveAnswerEnvironment.environment_id).not.toBe(environment.environment_id);
    expect(response.body.environmentEnsure).toMatchObject({
      created: true,
      repairedLineSchema: false,
    });
    expect(response.body.environmentEnsure.missingBefore).toEqual(expect.arrayContaining([
      "situation",
      "actor_state",
      "possibilities",
      "recommendation",
      "answer_snapshot",
      "voice_output",
      "unknowns",
      "debug_basis",
    ]));
    expect(response.body.liveAnswerEnvironment.lines.map((line: { key: string }) => line.key)).toEqual(expect.arrayContaining([
      "situation",
      "actor_state",
      "resources",
      "affordances",
      "risk",
      "possibilities",
      "rehearsal",
      "recommendation",
      "answer_snapshot",
      "voice_output",
      "unknowns",
      "next_check",
      "debug_basis",
    ]));
    expect(response.body.projectedLineKeys).toEqual(expect.arrayContaining([
      "risk",
      "possibilities",
      "unknowns",
      "next_check",
    ]));
    expect(response.body.projectedLineKeys).not.toContain("recommendation");
    expect(response.body.projectedLineKeys).not.toContain("answer_snapshot");
    expect(response.body.projectedLineKeys).not.toContain("voice_output");
    expect(response.body.checkpointOnlySkipped).toEqual(expect.arrayContaining([
      "recommendation",
      "answer_snapshot",
      "voice_output",
    ]));
  });
});

describe("GET /api/helix/stage-play/live-source-mail/transcript", () => {
  it("returns durable live-source mail transcript entries as evidence-only rows", async () => {
    const app = makeApp();
    const entries = recordStagePlayLiveSourceMailTranscriptEntries({
      threadId: "thread:mail-transcript-route",
      roomId: "room:mail-transcript-route",
      wakeRequestId: "stage_play_live_source_mail_wake:route",
      wakeResultId: "stage_play_live_source_mail_wake_result:route",
      askTurnId: "ask:mail-transcript-route",
      decisionIds: ["stage_play_live_source_mail_decision:route"],
      mailIds: ["stage_play_live_source_mail:route"],
      sourceIds: ["visual_source:route"],
      evidenceRefs: ["visual_evidence:route"],
      createdAt: "2026-06-04T12:00:00.000Z",
      rows: [
        {
          rowId: "row:mail-received",
          rowKind: "mail_received",
          title: "Observation mail",
          body: "Visual summary received. Preview: route summary.",
          source: {
            toolName: null,
            artifactId: "stage_play_live_source_mail:route",
            artifactKind: "stage_play_live_source_mail_item",
          },
          evidenceRefs: ["stage_play_live_source_mail:route", "visual_evidence:route"],
          authority: "tool_evidence",
          assistantAnswer: false,
          terminalEligible: false,
          createdAt: "2026-06-04T12:00:00.000Z",
        },
      ],
    });

    const response = await request(app)
      .get("/api/helix/stage-play/live-source-mail/transcript")
      .query({ threadId: "thread:mail-transcript-route" })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      schema: "stage_play_live_source_mail_transcript_response/v1",
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });
    expect(response.body.transcriptEntryIds).toEqual([entries[0].entryId]);
    expect(response.body.entries[0]).toMatchObject({
      artifactId: "stage_play_live_source_mail_transcript_entry",
      entryId: entries[0].entryId,
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });
    expect(response.body.transcriptRows[0]).toMatchObject({
      rowKind: "mail_received",
      body: "Visual summary received. Preview: route summary.",
      assistantAnswer: false,
      terminalEligible: false,
    });
    expect(response.body.evidenceRefs).toEqual(expect.arrayContaining([
      entries[0].entryId,
      "stage_play_live_source_mail:route",
      "visual_evidence:route",
    ]));
  });
});

describe("GET /api/helix/stage-play/live-source-visual-summaries", () => {
  it("returns compact visual summary mail as evidence-only observations", async () => {
    const app = makeApp();
    const mail = enqueueStagePlayLiveSourceMailItem({
      threadId: "thread:visual-summary-feed",
      roomId: "room:visual-summary-feed",
      environmentId: "live_env:visual-summary-feed",
      sourceId: "visual_source:visual-summary-feed",
      sourceKind: "visual_frame",
      frameRef: "visual_frame:visual-summary-feed",
      evidenceRef: "visual_evidence:visual-summary-feed",
      observationRef: "live_source_observation:visual-summary-feed",
      summaryText: "A compact visual summary says the Helix Ask Chrome UI is showing a live answer panel.",
      summaryPreview: "Helix Ask Chrome UI with live answer panel.",
      confidence: 0.84,
      createdAt: "2026-06-04T12:00:00.000Z",
    });

    const response = await request(app)
      .get("/api/helix/stage-play/live-source-visual-summaries")
      .query({ threadId: "thread:visual-summary-feed", sourceId: "visual_source:visual-summary-feed" })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      schema: "stage_play_live_source_visual_summary_feed/v1",
      requestedThreadId: "thread:visual-summary-feed",
      mailboxThreadId: "thread:visual-summary-feed",
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });
    expect(response.body.counts).toMatchObject({
      summaryCount: 1,
      unreadCount: 1,
    });
    expect(response.body.latestSummary).toMatchObject({
      mailId: mail.mailId,
      sourceId: "visual_source:visual-summary-feed",
      sourceKind: "visual_frame",
      summaryText: "A compact visual summary says the Helix Ask Chrome UI is showing a live answer panel.",
      confidence: 0.84,
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });
    expect(response.body.evidenceRefs).toEqual(expect.arrayContaining([
      mail.mailId,
      "visual_evidence:visual-summary-feed",
      "live_source_observation:visual-summary-feed",
    ]));
    expect(JSON.stringify(response.body)).not.toMatch(/\b(?:image_ref|raw_image|base64|data:image)\b/i);
  });
});

describe("GET /api/helix/stage-play/live-source-mail", () => {
  it("returns a slim overview projection while preserving the full debug view", async () => {
    const app = makeApp();
    const longSummary = [
      "Minecraft visual source shows a player moving through a cave corridor with repeated torch, sword, and inventory details.",
      "This deliberately long summary represents the high-churn observer payload that should not be sent every second.",
      "The complete text remains available from the full mailbox capture path for debugging.",
    ].join(" ").repeat(10);
    enqueueStagePlayLiveSourceMailItem({
      threadId: "thread:mail-overview-route",
      roomId: "room:mail-overview-route",
      sourceId: "visual_source:mail-overview-route",
      sourceKind: "visual_frame",
      frameRef: "visual_frame:mail-overview-route",
      evidenceRef: "visual_evidence:mail-overview-route",
      summaryText: longSummary,
      createdAt: "2026-06-04T12:00:00.000Z",
    });

    const full = await request(app)
      .get("/api/helix/stage-play/live-source-mail")
      .query({ threadId: "thread:mail-overview-route", view: "full" })
      .expect(200);
    const defaultView = await request(app)
      .get("/api/helix/stage-play/live-source-mail")
      .query({ threadId: "thread:mail-overview-route" })
      .expect(200);
    const overview = await request(app)
      .get("/api/helix/stage-play/live-source-mail")
      .query({ threadId: "thread:mail-overview-route", view: "overview", limit: 8 })
      .expect(200);

    expect(full.body.view).toBe("full");
    expect(defaultView.body.view).toBe("overview");
    expect(overview.body.view).toBe("overview");
    expect(full.body.mailItems[0].summary.text.length).toBeGreaterThan(overview.body.mailItems[0].summary.text.length);
    expect(overview.body.mailItems[0].summary.text.length).toBeLessThanOrEqual(703);
    expect(overview.body).toMatchObject({
      assistant_answer: false,
      terminal_eligible: false,
      context_role: "tool_evidence",
      raw_content_included: false,
    });
  });

  it("expires old hot mail into compact interval receipts", async () => {
    const app = makeApp();
    const threadId = "thread:mail-retention-route";
    for (let index = 0; index < 86; index += 1) {
      enqueueStagePlayLiveSourceMailItem({
        threadId,
        roomId: "room:mail-retention-route",
        sourceId: "visual_source:mail-retention-route",
        sourceKind: "visual_frame",
        frameRef: `visual_frame:mail-retention-route-${index}`,
        evidenceRef: `visual_evidence:mail-retention-route-${index}`,
        summaryText: `Minecraft neutral spatial observer frame ${index}. ${"terrain and hotbar details ".repeat(30)}`,
        createdAt: new Date(Date.UTC(2026, 5, 4, 12, 0, index)).toISOString(),
      });
    }

    const response = await request(app)
      .get("/api/helix/stage-play/live-source-mail")
      .query({ threadId, view: "full", limit: 100 })
      .expect(200);

    expect(response.body.retention.mailbox).toMatchObject({
      schema: "stage_play_live_source_mailbox_retention/v1",
      hotLimit: 80,
      retainedMailCount: 80,
      compactedMailCount: 6,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(response.body.mailItems).toHaveLength(80);
    expect(response.body.mailItems[0].summary.text).toContain("frame 6");
    expect(response.body.compactionIntervals.mail[0]).toMatchObject({
      artifactId: "stage_play_live_source_mail_compaction_interval",
      compactedMailCount: 6,
      startMailId: expect.stringMatching(/^stage_play_live_source_mail:/),
      endMailId: expect.stringMatching(/^stage_play_live_source_mail:/),
      raw_content_included: false,
    });
    expect(JSON.stringify(response.body.compactionIntervals.mail)).not.toContain("terrain and hotbar details terrain");
  });
});

describe("GET /api/helix/stage-play/goal-context", () => {
  it("returns agent goal sessions as non-terminal tool evidence", async () => {
    const app = makeApp();

    await request(app)
      .post("/api/helix/stage-play/goal-session")
      .send({
        threadId: "helix-ask:desktop",
        goalId: "goal:frog-classification",
        objective: "Monitor the image source and prepare frog classification evidence.",
        sourceRefs: ["visual_source:image-lens"],
        loopRefs: ["stage_play_mail_loop:helix-ask:desktop"],
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
    expect(response.body.agentGoalSessions).toHaveLength(1);
    expect(response.body.agentGoalSessions[0]).toMatchObject({
      goalId: "goal:frog-classification",
      authority: {
        assistantAnswer: false,
        finalReportsRequireTerminalAuthority: true,
      },
    });
  });
});

describe("GET /api/helix/stage-play/live-source-mail/transcript", () => {
  it("returns compact transcript rows by default while preserving the full debug view", async () => {
    const app = makeApp();
    const longBody = "Minecraft gameplay observer transcript payload. ".repeat(120);
    recordStagePlayLiveSourceMailTranscriptEntries({
      threadId: "thread:mail-transcript-route",
      wakeRequestId: "stage_play_live_source_mail_wake:transcript-route",
      mailIds: ["stage_play_live_source_mail:transcript-route"],
      sourceIds: ["visual_source:transcript-route"],
      evidenceRefs: Array.from({ length: 40 }, (_, index) => `visual_evidence:transcript-route-${index}`),
      rows: [
        {
          rowId: "stage_play_live_source_mail_transcript_row:transcript-route",
          rowKind: "processed_mail_packet",
          title: "Processed packet",
          body: longBody,
          source: {
            artifactId: "stage_play_processed_mail_packet:transcript-route",
            artifactKind: "processed_mail_packet",
          },
          evidenceRefs: Array.from({ length: 40 }, (_, index) => `stage_play_evidence_ref:transcript-route-${index}`),
          causalTrace: {
            schemaVersion: "live_source_causal_trace/v1",
            traceId: "live_source_causal_trace:transcript-route",
            cycleId: "live_source_cycle:transcript-route",
            parentRefs: Array.from({ length: 40 }, (_, index) => `parent:transcript-route-${index}`),
            causedBy: ["stage_play_live_source_mail:transcript-route"],
            producedRefs: ["stage_play_live_source_mail_transcript_row:transcript-route"],
            sourceIds: ["visual_source:transcript-route"],
            evidenceRefs: Array.from({ length: 40 }, (_, index) => `trace_evidence_ref:transcript-route-${index}`),
          },
        },
      ],
    });

    const compact = await request(app)
      .get("/api/helix/stage-play/live-source-mail/transcript")
      .query({ threadId: "thread:mail-transcript-route" })
      .expect(200);
    const full = await request(app)
      .get("/api/helix/stage-play/live-source-mail/transcript")
      .query({ threadId: "thread:mail-transcript-route", view: "full" })
      .expect(200);

    expect(compact.body.view).toBe("overview");
    expect(full.body.view).toBe("full");
    expect(compact.body.entries[0].row.body.length).toBeLessThan(full.body.entries[0].row.body.length);
    expect(compact.body.entries[0].evidenceRefs.length).toBeLessThan(full.body.entries[0].evidenceRefs.length);
    expect(compact.body.transcriptRows[0].body.length).toBeLessThanOrEqual(703);
    expect(compact.body.transcriptRows[0].evidenceRefs.length).toBeLessThanOrEqual(12);
    expect(compact.body.transcriptRows[0].causalTrace).toBeUndefined();
  });

  it("expires old hot transcript rows into compact interval receipts", async () => {
    const app = makeApp();
    const threadId = "thread:mail-transcript-retention-route";
    recordStagePlayLiveSourceMailTranscriptEntries({
      threadId,
      wakeRequestId: "stage_play_live_source_mail_wake:transcript-retention-route",
      mailIds: ["stage_play_live_source_mail:transcript-retention-route"],
      sourceIds: ["visual_source:transcript-retention-route"],
      rows: Array.from({ length: 186 }, (_, index) => ({
        rowId: `stage_play_live_source_mail_transcript_row:retention-${index}`,
        rowKind: index % 2 === 0 ? "processed_mail_packet" : "agent_decision",
        title: `Transcript row ${index}`,
        body: `Detailed Minecraft gameplay row ${index}. ${"observer payload ".repeat(80)}`,
        source: {
          artifactId: `stage_play_processed_mail_packet:retention-${index}`,
          artifactKind: "processed_mail_packet",
        },
        evidenceRefs: [`stage_play_evidence_ref:retention-${index}`],
        authority: "tool_evidence",
        assistantAnswer: false,
        terminalEligible: false,
        createdAt: new Date(Date.UTC(2026, 5, 4, 12, 0, index)).toISOString(),
      })),
    });

    const response = await request(app)
      .get("/api/helix/stage-play/live-source-mail/transcript")
      .query({ threadId, view: "full", limit: 200 })
      .expect(200);

    expect(response.body.retention).toMatchObject({
      schema: "stage_play_live_source_mail_transcript_retention/v1",
      hotLimit: 96,
      retainedEntryCount: 96,
      compactedEntryCount: 90,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(response.body.entries).toHaveLength(96);
    expect(response.body.compactionIntervals[0]).toMatchObject({
      artifactId: "stage_play_live_source_mail_transcript_compaction_interval",
      compactedEntryCount: 90,
      raw_content_included: false,
    });
    expect(JSON.stringify(response.body.compactionIntervals)).not.toContain("observer payload observer payload observer payload");
  });
});

describe("POST /api/helix/stage-play/live-source-mail/job", () => {
  it("stores a watch-job policy without reading mail", async () => {
    const app = makeApp();

    const response = await request(app)
      .post("/api/helix/stage-play/live-source-mail/job")
      .send({
        threadId: "thread:stage-play-watch-policy-route",
        roomId: "room:stage-play-watch-policy-route",
        sourceIds: ["visual_source:watch-policy-route"],
        objectiveText: "Watch the visual source and only announce if a hostile mob appears.",
        decisionPolicyPrompt: "Only announce hostile mobs. Suppress ordinary motion.",
        importanceCriteria: ["hostile mob appears"],
        suppressCriteria: ["ordinary motion"],
        allowVoiceCallout: true,
        voiceRequiresUrgency: true,
      })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      schema: "stage_play_live_source_watch_job_policy_response/v1",
      watchJobPolicyRef: expect.stringMatching(/^stage_play_live_source_watch_job_policy:/),
      watch_job_policy_ref: expect.stringMatching(/^stage_play_live_source_watch_job_policy:/),
      policy: {
        artifactId: "stage_play_live_source_watch_job_policy",
        objectiveText: "Watch the visual source and only announce if a hostile mob appears.",
        decisionPolicyPrompt: "Only announce hostile mobs. Suppress ordinary motion.",
        sourceIds: ["visual_source:watch-policy-route"],
        outputPolicy: {
          allowTextAnswer: true,
          allowVoiceCallout: true,
          voiceRequiresUrgency: true,
        },
        importanceCriteria: ["hostile mob appears"],
        suppressCriteria: ["ordinary motion"],
        assistant_answer: false,
        terminal_eligible: false,
      },
      jobState: {
        objective: "Watch the visual source and only announce if a hostile mob appears.",
        watchJobPolicyRef: expect.stringMatching(/^stage_play_live_source_watch_job_policy:/),
        nextLoopState: "armed_for_next_summary",
      },
      assistant_answer: false,
      terminal_eligible: false,
    });

    const mailbox = await request(app)
      .get("/api/helix/stage-play/live-source-mail")
      .query({ threadId: "thread:stage-play-watch-policy-route" })
      .expect(200);

    expect(mailbox.body.mailItems).toEqual([]);
    expect(mailbox.body.watchJobPolicies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        policyId: response.body.watchJobPolicyRef,
      }),
    ]));
  });
});

describe("live-source mail wake route parsing", () => {
  it("treats boolean manualRun payloads as manual wake requests", () => {
    expect(resolveStagePlayWakeManualRunForRoute({ trigger: "auto", manualRun: true }, {})).toBe(true);
    expect(resolveStagePlayWakeManualRunForRoute({ trigger: "auto", manual_run: true }, {})).toBe(true);
    expect(resolveStagePlayWakeManualRunForRoute({ trigger: "manual" }, {})).toBe(true);
    expect(resolveStagePlayWakeManualRunForRoute({ trigger: "auto", manualRun: false }, {})).toBe(false);
    expect(resolveStagePlayWakeManualRunForRoute({}, { manualRun: "true" })).toBe(true);
    expect(resolveStagePlayWakeManualRunForRoute({}, { manual_run: "true" })).toBe(true);
  });
});
