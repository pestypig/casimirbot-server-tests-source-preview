import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { HelixLiveSourceAnalysisJob } from "@shared/helix-live-source-analysis-job";
import type { HelixLiveSourceChunk } from "@shared/helix-live-source-chunk";

import { planRouter } from "../routes/agi.plan";
import {
  createLiveAnswerEnvironment,
  resetLiveAnswerEnvironments,
} from "../services/situation-room/live-answer-environment-store";
import { resetLiveFieldEvaluationsForTest } from "../services/situation-room/live-field-evaluation-store";
import { resetLiveFieldWorkerRunsForTest } from "../services/situation-room/live-field-worker-run-store";
import { resetLiveFieldWorkersForTest } from "../services/situation-room/live-field-worker-registry";
import { resetLiveInterpretationGraphsForTest } from "../services/situation-room/live-interpretation-graph-store";
import { resetLiveInterpretationHypothesesForTest } from "../services/situation-room/live-interpretation-hypothesis-store";
import { resetLiveInterpretationRunsForTest } from "../services/situation-room/live-interpretation-run-store";
import { resetLiveInterpretationValidationArtifactsForTest } from "../services/situation-room/live-interpretation-validation-artifact-store";
import { resetLiveInterpretationWorkerRunsForTest } from "../services/situation-room/live-interpretation-worker-run-store";
import { resetLiveInterpretationWorkersForTest } from "../services/situation-room/live-interpretation-worker-registry";
import { routeLiveSourceAnalysisOutput } from "../services/situation-room/live-source-analysis-output-router";
import { resetLiveSituationRunsForTest } from "../services/situation-room/live-situation-run-store";
import { resetLiveSourceIdentitiesForTest } from "../services/situation-room/live-source-identity-store";
import { resetObservationJournalForTest } from "../services/situation-room/observation-journal-store";
import { resetProcedureEpochClosuresForTest } from "../services/situation-room/procedure-epoch-closure";
import { resetProcedureEpochLedgerForTest } from "../services/situation-room/procedure-epoch-ledger-store";

const threadId = "helix-ask:desktop";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/agi", planRouter);
  return app;
};

const chunkFor = (sequenceIndex: number, summary: string): HelixLiveSourceChunk => ({
  schema: "helix.live_source_chunk.v1",
  chunk_id: `live_source_chunk:delta:${sequenceIndex}`,
  source_id: "source:documents",
  thread_id: threadId,
  environment_id: "live_answer:delta",
  modality: "visual_frame",
  sequence_index: sequenceIndex,
  ts: `2026-05-19T06:00:${String(sequenceIndex).padStart(2, "0")}.000Z`,
  payload_ref: `visual_frame:delta:${sequenceIndex}`,
  compact_summary: summary,
  evidence_refs: [],
  raw_content_included: false,
  assistant_answer: false,
  context_policy: "compact_context_pack_only",
});

const jobFor = (chunk: HelixLiveSourceChunk): HelixLiveSourceAnalysisJob => ({
  schema: "helix.live_source_analysis_job.v1",
  job_id: `live_source_analysis_job:${chunk.sequence_index}`,
  chunk_id: chunk.chunk_id,
  worker_id: "worker:visual",
  thread_id: threadId,
  source_id: chunk.source_id,
  analyzer_id: "visual_frame_analyzer",
  status: "completed",
  output_refs: [`visual_evidence:${chunk.sequence_index}`],
  summary: chunk.compact_summary,
  assistant_answer: false,
  raw_content_included: false,
});

const routeChunk = (chunk: HelixLiveSourceChunk): void => {
  routeLiveSourceAnalysisOutput({
    job: jobFor(chunk),
    chunk,
    status: "completed",
    summary: chunk.compact_summary,
    outputRefs: [`visual_evidence:${chunk.sequence_index}`],
    modelInvoked: true,
  });
};

describe("helix ask live interpretation delta routing", () => {
  beforeEach(() => {
    resetLiveAnswerEnvironments();
    resetLiveSituationRunsForTest();
    resetLiveSourceIdentitiesForTest();
    resetObservationJournalForTest();
    resetProcedureEpochClosuresForTest();
    resetProcedureEpochLedgerForTest();
    resetLiveFieldWorkersForTest();
    resetLiveFieldWorkerRunsForTest();
    resetLiveFieldEvaluationsForTest();
    resetLiveInterpretationRunsForTest();
    resetLiveInterpretationWorkersForTest();
    resetLiveInterpretationWorkerRunsForTest();
    resetLiveInterpretationHypothesesForTest();
    resetLiveInterpretationValidationArtifactsForTest();
    resetLiveInterpretationGraphsForTest();
  });

  it("answers explicit visual epoch deltas from durable interpretation state", async () => {
    createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "ask:delta-seed",
      objective: "Use the latest visual observation to describe the current workstation screen.",
      preset: "custom",
      source_ids: ["source:documents"],
    });
    routeChunk(chunkFor(1, "File Explorer shows a PAPERPLAY folder with image files and toolbar controls."));
    routeChunk(chunkFor(2, "The screen displays Windows Task Manager on the Performance tab with CPU and memory metrics."));

    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        question: "What changed in the visual screen capture compared with the previous scene epoch?",
        sessionId: threadId,
        debug: true,
      })
      .expect(200);

    expect(response.body.route_reason_code).toBe("live_interpretation_epoch_delta");
    expect(response.body.final_answer_source).toBe("live_interpretation_delta");
    expect(response.body.terminal_artifact_kind).toBe("interpretation_epoch_delta");
    expect(response.body.answer).toContain("Compared with the previous scene epoch");
    expect(response.body.answer).not.toContain("The attached image shows");
    expect(response.body.live_interpretation_run?.interpretation_run_id).toMatch(/^live_interpretation_run:/);
    expect(response.body.live_interpretation_worker_runs.length).toBeGreaterThan(0);
    expect(response.body.live_interpretation_hypotheses.length).toBeGreaterThan(0);
    expect(response.body.live_interpretation_graph?.edges.length).toBeGreaterThan(0);
    expect(response.body.live_interpretation_epoch_delta).toMatchObject({
      schema: "helix.live_interpretation_epoch_delta.v1",
      interpretation_run_id: response.body.live_interpretation_run.interpretation_run_id,
      previous_scene_epoch_id: expect.any(String),
      current_scene_epoch_id: expect.any(String),
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(response.body.terminal_answer_authority).toMatchObject({
      route: "live_interpretation_epoch_delta",
      final_answer_source: "live_interpretation_delta",
      terminal_artifact_kind: "interpretation_epoch_delta",
      server_authoritative: true,
    });
  });
});
