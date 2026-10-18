import { beforeEach, describe, expect, it } from "vitest";
import type { HelixLiveSourceAnalysisJob } from "@shared/helix-live-source-analysis-job";
import type { HelixLiveSourceChunk } from "@shared/helix-live-source-chunk";
import { HELIX_LIVE_ARBITRATION_CANDIDATE_SCHEMA } from "@shared/helix-live-arbitration-candidate";
import {
  createLiveAnswerEnvironment,
  resetLiveAnswerEnvironments,
} from "../services/situation-room/live-answer-environment-store";
import { resetAskHandoffsForTest } from "../services/helix-ask/ask-handoff-router";
import { listAskHandoffConsumptions, resetAskHandoffConsumptionsForTest } from "../services/helix-ask/ask-handoff-consumption-store";
import { listPlanContractExecutions, resetPlanContractExecutionsForTest } from "../services/helix-ask/plan-contract-execution-store";
import { resetGoalCardsForTest } from "../services/situation-room/goal-finder-store";
import { resetInterpretationCardsForTest } from "../services/situation-room/interpretation-card-store";
import {
  listLiveArbitrationCandidates,
  recordLiveArbitrationCandidate,
  resetLiveArbitrationCandidatesForTest,
} from "../services/situation-room/live-arbitration-candidate-store";
import { consumeLiveArbitrationCandidate } from "../services/situation-room/live-arbitration-candidate-consumer";
import { resetLiveConfidenceUpdatesForTest } from "../services/situation-room/live-confidence-update-store";
import { resetLiveFieldEvaluationsForTest } from "../services/situation-room/live-field-evaluation-store";
import { resetLiveFieldWorkerRunsForTest } from "../services/situation-room/live-field-worker-run-store";
import { resetLiveFieldWorkersForTest } from "../services/situation-room/live-field-worker-registry";
import { resetLiveObservationProbesForTest } from "../services/situation-room/live-observation-probe-store";
import { resetLiveProcedureEpochsForTest } from "../services/situation-room/live-procedure-epoch-store";
import { resetLiveProbeResultsForTest } from "../services/situation-room/live-probe-result-store";
import { resetLiveSituationPredictionsForTest } from "../services/situation-room/live-situation-prediction-store";
import { resetLiveSituationRunsForTest } from "../services/situation-room/live-situation-run-store";
import { resetLiveTangentEvaluationsForTest } from "../services/situation-room/live-tangent-evaluation-store";
import { resetObservationJournalForTest } from "../services/situation-room/observation-journal-store";
import {
  buildProcedureEpochReplay,
  listProcedureEpochLedger,
  resetProcedureEpochLedgerForTest,
} from "../services/situation-room/procedure-epoch-ledger-store";
import {
  listProcedureEpochClosures,
  resetProcedureEpochClosuresForTest,
} from "../services/situation-room/procedure-epoch-closure";
import { routeLiveSourceAnalysisOutput } from "../services/situation-room/live-source-analysis-output-router";

const threadId = "helix-ask:desktop";
const sourceId = "source:procedure-ledger";
const environmentId = "live_answer:procedure-ledger";

const visualChunk = (index: number, summary: string): HelixLiveSourceChunk => ({
  schema: "helix.live_source_chunk.v1",
  chunk_id: `live_source_chunk:ledger:${index}`,
  source_id: sourceId,
  thread_id: threadId,
  environment_id: environmentId,
  modality: "visual_frame",
  sequence_index: index,
  ts: `2026-05-17T23:10:${String(index).padStart(2, "0")}.000Z`,
  payload_ref: `visual_frame:ledger:${index}`,
  compact_summary: summary,
  evidence_refs: [],
  raw_content_included: false,
  assistant_answer: false,
  context_policy: "compact_context_pack_only",
});

const jobFor = (chunk: HelixLiveSourceChunk): HelixLiveSourceAnalysisJob => ({
  schema: "helix.live_source_analysis_job.v1",
  job_id: `live_source_analysis_job:ledger:${chunk.sequence_index}`,
  chunk_id: chunk.chunk_id,
  worker_id: "worker:visual",
  thread_id: chunk.thread_id,
  source_id: chunk.source_id,
  analyzer_id: "visual_frame_analyzer",
  status: "completed",
  output_refs: [`visual_evidence:ledger:${chunk.sequence_index}`],
  summary: chunk.compact_summary,
  assistant_answer: false,
  raw_content_included: false,
});

const routeSummary = (index: number, summary: string) => {
  const chunk = visualChunk(index, summary);
  return routeLiveSourceAnalysisOutput({
    job: jobFor(chunk),
    chunk,
    status: "completed",
    summary,
    outputRefs: [`visual_evidence:ledger:${index}`],
    modelInvoked: true,
  });
};

describe("procedure epoch ledger and handoff closure", () => {
  beforeEach(() => {
    resetLiveAnswerEnvironments();
    resetObservationJournalForTest();
    resetInterpretationCardsForTest();
    resetGoalCardsForTest();
    resetAskHandoffsForTest();
    resetAskHandoffConsumptionsForTest();
    resetPlanContractExecutionsForTest();
    resetLiveSituationRunsForTest();
    resetLiveFieldWorkersForTest();
    resetLiveFieldWorkerRunsForTest();
    resetLiveFieldEvaluationsForTest();
    resetLiveTangentEvaluationsForTest();
    resetLiveArbitrationCandidatesForTest();
    resetLiveSituationPredictionsForTest();
    resetLiveObservationProbesForTest();
    resetLiveProbeResultsForTest();
    resetLiveConfidenceUpdatesForTest();
    resetLiveProcedureEpochsForTest();
    resetProcedureEpochLedgerForTest();
    resetProcedureEpochClosuresForTest();
  });

  it("records a replayable observation to closure chain for each epoch", () => {
    createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "ask:ledger",
      objective: "Keep interpreting this generic visual workstation screen.",
      preset: "custom",
      source_ids: [sourceId],
    });
    const routed = routeSummary(1, "File Explorer shows a folder with image files and toolbar controls.");
    const ledger = listProcedureEpochLedger({ threadId, situationRunId: routed.live_situation_run?.situation_run_id });
    expect(ledger.map((entry) => entry.item_kind)).toContain("observation");
    expect(ledger.map((entry) => entry.item_kind)).toContain("field_worker_run");
    expect(ledger.map((entry) => entry.item_kind)).toContain("field_evaluation");
    expect(ledger.map((entry) => entry.item_kind)).toContain("prediction");
    expect(ledger.map((entry) => entry.item_kind)).toContain("probe");
    expect(ledger.map((entry) => entry.item_kind)).toContain("arbitration_candidate");
    expect(ledger.every((entry) => entry.assistant_answer === false && entry.raw_content_included === false)).toBe(true);
    const closure = listProcedureEpochClosures({ threadId, situationRunId: routed.live_situation_run?.situation_run_id }).at(-1);
    expect(closure?.status).toBe("silent_update");
    const replay = buildProcedureEpochReplay({
      situationRunId: routed.live_situation_run?.situation_run_id ?? "",
      epoch: 1,
      closureId: closure?.closure_id,
    });
    expect(replay.ledger_items.length).toBeGreaterThan(0);
    expect(replay.causality_graph.length).toBeGreaterThan(0);
    expect(replay.assistant_answer).toBe(false);
  });

  it("consumes handoff and plan candidates into traces without execution or answers", () => {
    createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "ask:ledger",
      objective: "Keep interpreting this generic visual workstation screen.",
      preset: "custom",
      source_ids: [sourceId],
    });
    const routed = routeSummary(1, "File Explorer shows a folder with image files and toolbar controls.");
    const run = routed.live_situation_run;
    expect(run).toBeTruthy();
    const askCandidate = listLiveArbitrationCandidates({ threadId, status: "pending", includeExpired: true })
      .find((entry) => entry.candidate_type === "silent_update");
    expect(askCandidate).toBeTruthy();
    const silent = consumeLiveArbitrationCandidate({ candidateId: askCandidate?.candidate_id ?? "" });
    expect(silent.decision).toBe("silent_update");

    const planCandidate = recordLiveArbitrationCandidate({
      schema: HELIX_LIVE_ARBITRATION_CANDIDATE_SCHEMA,
      candidate_id: "live_arbitration_candidate:plan-ledger",
      situation_run_id: run?.situation_run_id ?? "",
      thread_id: threadId,
      environment_id: run?.environment_id ?? environmentId,
      source_binding_id: run?.source_binding_id ?? "",
      epoch: run?.current_epoch ?? 1,
      candidate_type: "plan_contract_candidate",
      reason: "Visible workstation affordance can be inspected if requested.",
      priority: "notice",
      evidence_refs: routed.live_field_evaluations.slice(0, 1).map((entry) => entry.evaluation_id),
      field_evaluation_refs: routed.live_field_evaluations.slice(0, 1).map((entry) => entry.evaluation_id),
      tangent_refs: [],
      proposed_output: {
        plan_action_id: "situation-room.live-source.capture_now",
      },
      status: "pending",
      expires_at: "2026-05-17T23:12:00.000Z",
      assistant_answer: false,
      raw_content_included: false,
    });
    const plan = consumeLiveArbitrationCandidate({ candidateId: planCandidate.candidate_id, now: "2026-05-17T23:11:00.000Z" });
    expect(plan.decision).toBe("plan_contract");
    expect(plan.plan_contract?.can_execute_itself).toBe(false);
    expect(listPlanContractExecutions({ situationRunId: run?.situation_run_id }).at(-1)?.runtime_status).toBe("pending");
    expect(listAskHandoffConsumptions({ threadId }).every((entry) => entry.assistant_answer === false)).toBe(true);
    expect(listProcedureEpochLedger({ threadId }).some((entry) => entry.item_kind === "plan_contract")).toBe(true);
  });
});
