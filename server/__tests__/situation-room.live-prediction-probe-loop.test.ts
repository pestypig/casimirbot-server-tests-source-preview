import { beforeEach, describe, expect, it } from "vitest";
import type { HelixObservationJournalEntry } from "@shared/helix-observation-journal";
import type { HelixLiveSourceAnalysisJob } from "@shared/helix-live-source-analysis-job";
import type { HelixLiveSourceChunk } from "@shared/helix-live-source-chunk";
import {
  createLiveAnswerEnvironment,
  resetLiveAnswerEnvironments,
} from "../services/situation-room/live-answer-environment-store";
import { resetAskHandoffsForTest } from "../services/helix-ask/ask-handoff-router";
import { resetGoalCardsForTest } from "../services/situation-room/goal-finder-store";
import { resetInterpretationCardsForTest } from "../services/situation-room/interpretation-card-store";
import { resetLiveArbitrationCandidatesForTest, listLiveArbitrationCandidates } from "../services/situation-room/live-arbitration-candidate-store";
import { resetLiveConfidenceUpdatesForTest, listLiveConfidenceUpdates } from "../services/situation-room/live-confidence-update-store";
import { resetLiveFieldEvaluationsForTest } from "../services/situation-room/live-field-evaluation-store";
import { resetLiveFieldWorkerRunsForTest } from "../services/situation-room/live-field-worker-run-store";
import { resetLiveFieldWorkersForTest } from "../services/situation-room/live-field-worker-registry";
import { resetLiveObservationProbesForTest, listLiveObservationProbes } from "../services/situation-room/live-observation-probe-store";
import { resetLiveProcedureEpochsForTest, listLiveProcedureEpochs } from "../services/situation-room/live-procedure-epoch-store";
import { resetLiveProbeResultsForTest, listLiveProbeResults } from "../services/situation-room/live-probe-result-store";
import { resetLiveSituationPredictionsForTest, listLiveSituationPredictions } from "../services/situation-room/live-situation-prediction-store";
import { resetLiveSituationRunsForTest, listLiveSituationRuns } from "../services/situation-room/live-situation-run-store";
import { resetLiveTangentEvaluationsForTest, listLiveTangentEvaluations } from "../services/situation-room/live-tangent-evaluation-store";
import { resetObservationJournalForTest } from "../services/situation-room/observation-journal-store";
import { resetProcedureEpochLedgerForTest, listProcedureEpochLedger } from "../services/situation-room/procedure-epoch-ledger-store";
import { routeLiveSourceAnalysisOutput } from "../services/situation-room/live-source-analysis-output-router";
import { runObservationProbesForObservation } from "../services/situation-room/live-observation-probe-runner";
import { recordLiveObservationProbe } from "../services/situation-room/live-observation-probe-store";

const threadId = "helix-ask:desktop";

const visualChunk = (index: number, summary: string): HelixLiveSourceChunk => ({
  schema: "helix.live_source_chunk.v1",
  chunk_id: `live_source_chunk:probe:${index}`,
  source_id: "source:documents",
  thread_id: threadId,
  environment_id: "live_answer:probe",
  modality: "visual_frame",
  sequence_index: index,
  ts: `2026-05-17T22:10:${String(index).padStart(2, "0")}.000Z`,
  payload_ref: `visual_frame:probe:${index}`,
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
  thread_id: chunk.thread_id,
  source_id: chunk.source_id,
  analyzer_id: "visual_frame_analyzer",
  status: "completed",
  output_refs: [`visual_evidence:probe:${chunk.sequence_index}`],
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
    outputRefs: [`visual_evidence:probe:${index}`],
    modelInvoked: true,
  });
};

const directObservation = (index: number, summary: string): HelixObservationJournalEntry => ({
  schema: "helix.observation_journal_entry.v1",
  observation_id: `observation:probe:direct:${index}`,
  thread_id: threadId,
  room_id: null,
  source_id: "source:documents",
  role: "model_perception_observation",
  modality: "visual_frame",
  text: summary,
  evidence_refs: [`visual_evidence:probe:direct:${index}`],
  model_invoked: true,
  confidence: 0.7,
  observed_at: `2026-05-17T22:12:${String(index).padStart(2, "0")}.000Z`,
  ingested_at: `2026-05-17T22:12:${String(index).padStart(2, "0")}.000Z`,
  available_at: `2026-05-17T22:12:${String(index).padStart(2, "0")}.000Z`,
  source_seq: index,
  replay_status: "live",
  source_binding_id: null,
  raw_image_ref: null,
  raw_content_included: false,
  assistant_answer: false,
  context_policy: "compact_context_pack_only",
  created_at: `2026-05-17T22:12:${String(index).padStart(2, "0")}.000Z`,
});

const createProbeSeed = () => {
  createLiveAnswerEnvironment({
    thread_id: threadId,
    created_turn_id: "ask:probe",
    objective: "Keep interpreting this generic visual workstation screen.",
    preset: "custom",
    source_ids: ["source:documents"],
  });
  routeSummary(1, "File Explorer shows a PAPERPLAY folder with image files and toolbar controls.");
  const run = listLiveSituationRuns({ threadId }).at(-1);
  const probe = listLiveObservationProbes({ threadId, includeExpired: true }).find((entry) => entry.status === "waiting_for_observation");
  const prediction = probe
    ? listLiveSituationPredictions({ threadId, includeExpired: true }).find((entry) => entry.prediction_id === probe.prediction_id)
    : null;
  expect(run).toBeTruthy();
  expect(probe).toBeTruthy();
  expect(prediction).toBeTruthy();
  return {
    run: run!,
    probe: probe!,
    prediction: prediction!,
  };
};

describe("live situation prediction probe loop", () => {
  beforeEach(() => {
    resetLiveAnswerEnvironments();
    resetObservationJournalForTest();
    resetInterpretationCardsForTest();
    resetGoalCardsForTest();
    resetAskHandoffsForTest();
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
  });

  it("turns field next_check into predictions and passive probes", () => {
    createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "ask:probe",
      objective: "Keep interpreting this generic visual workstation screen.",
      preset: "custom",
      source_ids: ["source:documents"],
    });
    const routed = routeSummary(1, "File Explorer shows a PAPERPLAY folder with image files and toolbar controls.");
    expect(routed.live_situation_predictions.length).toBeGreaterThan(0);
    expect(routed.live_observation_probes.length).toBeGreaterThan(0);
    expect(routed.live_situation_predictions.every((entry) => entry.assistant_answer === false && entry.role === "validation")).toBe(true);
    expect(listLiveSituationPredictions({ threadId })).not.toHaveLength(0);
    expect(listLiveObservationProbes({ threadId }).some((entry) => entry.status === "waiting_for_observation")).toBe(true);
  });

  it("records a satisfied probe result and positive confidence update", () => {
    createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "ask:probe",
      objective: "Keep interpreting this generic visual workstation screen.",
      preset: "custom",
      source_ids: ["source:documents"],
    });
    routeSummary(1, "File Explorer shows a PAPERPLAY folder with image files and toolbar controls.");
    const second = routeSummary(2, "The same File Explorer folder remains visible and one image file is selected.");
    const satisfied = second.live_probe_results.find((entry) => entry.status === "satisfied");
    expect(satisfied).toBeTruthy();
    expect(second.live_confidence_updates.some((entry) => entry.probe_result_id === satisfied?.probe_result_id && entry.confidence_delta > 0)).toBe(true);
    expect(satisfied?.spawned_tangent_refs).toEqual([]);
    expect(satisfied?.spawned_candidate_refs).toEqual([]);
    expect(listLiveObservationProbes({ threadId, includeExpired: true }).some((entry) => entry.probe_id === satisfied?.probe_id && entry.assistant_answer === false)).toBe(true);
    expect(listLiveProbeResults({ threadId }).some((entry) => entry.observed_signals.includes("selection_changed"))).toBe(true);
    expect(listLiveProcedureEpochs({ threadId }).at(-1)?.epoch).toBe(2);
  });

  it("records contradicted probe result and spawns only pending validation candidates", () => {
    createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "ask:probe",
      objective: "Keep interpreting this generic visual workstation screen.",
      preset: "custom",
      source_ids: ["source:documents"],
    });
    routeSummary(1, "File Explorer shows a PAPERPLAY folder with image files and toolbar controls.");
    const second = routeSummary(2, "A different app window changed to a browser tab instead of the folder view.");
    const contradicted = second.live_probe_results.find((entry) => entry.status === "contradicted");
    expect(contradicted).toBeTruthy();
    expect(contradicted?.spawned_tangent_refs.length).toBeGreaterThan(0);
    expect(contradicted?.spawned_candidate_refs.length).toBeGreaterThan(0);
    const tangent = listLiveTangentEvaluations({ threadId }).find((entry) => contradicted?.spawned_tangent_refs.includes(entry.tangent_id));
    expect(tangent?.tangent_type).toBe("contradiction_tangent");
    expect(tangent?.assistant_answer).toBe(false);
    const candidates = listLiveArbitrationCandidates({ threadId, includeExpired: true });
    const candidate = candidates.find((entry) => contradicted?.spawned_candidate_refs.includes(entry.candidate_id));
    expect(candidate?.status).toBe("pending");
    expect(candidate?.assistant_answer).toBe(false);
  });

  it("records inconclusive probe result without spawning tangent or arbitration", () => {
    const { run, prediction } = createProbeSeed();
    const result = runObservationProbesForObservation({
      run: { ...run, current_epoch: run.current_epoch + 1 },
      observation: directObservation(2, "A neutral settings panel is visible with generic toggles and no recognizable workstation evidence."),
      now: "2026-05-17T22:12:02.000Z",
    });
    const inconclusive = result.probe_results.find((entry) => entry.status === "inconclusive");
    expect(inconclusive).toBeTruthy();
    expect(inconclusive?.confidence_delta).toBe(0);
    expect(inconclusive?.spawned_tangent_refs).toEqual([]);
    expect(inconclusive?.spawned_candidate_refs).toEqual([]);
    expect(listLiveObservationProbes({ threadId, includeExpired: true }).some((entry) => entry.probe_id === inconclusive?.probe_id && entry.status === "completed")).toBe(true);
    expect(listLiveSituationPredictions({ threadId, includeExpired: true }).find((entry) => entry.prediction_id === prediction.prediction_id)?.status).toBe("inconclusive");
  });

  it("records expired probe result and small negative confidence update", () => {
    const { run, probe, prediction } = createProbeSeed();
    const now = new Date(Date.parse(probe.expires_at) + 1_000).toISOString();
    const result = runObservationProbesForObservation({
      run: { ...run, current_epoch: run.current_epoch + 1 },
      observation: directObservation(2, "The same File Explorer folder remains visible and one image file is selected."),
      now,
    });
    const expired = result.probe_results.find((entry) => entry.status === "expired");
    expect(expired).toBeTruthy();
    expect(listLiveObservationProbes({ threadId, includeExpired: true }).find((entry) => entry.probe_id === probe.probe_id)?.status).toBe("expired");
    expect(listLiveSituationPredictions({ threadId, includeExpired: true }).find((entry) => entry.prediction_id === prediction.prediction_id)?.status).toBe("expired");
    expect(result.confidence_updates.find((entry) => entry.probe_result_id === expired?.probe_result_id)?.confidence_delta).toBeLessThan(0);
    expect(expired?.spawned_tangent_refs).toEqual([]);
    expect(expired?.spawned_candidate_refs).toEqual([]);
  });

  it("records blocked probe result for source binding mismatch without spawning candidates", () => {
    const { run, probe, prediction } = createProbeSeed();
    recordLiveObservationProbe({ ...probe, source_binding_id: "source_binding:stale-a" });
    const result = runObservationProbesForObservation({
      run: { ...run, current_epoch: run.current_epoch + 1, source_binding_id: "source_binding:active-b" },
      observation: directObservation(2, "The same File Explorer folder remains visible and one image file is selected."),
      now: "2026-05-17T22:12:02.000Z",
    });
    const blocked = result.probe_results.find((entry) => entry.status === "blocked");
    expect(blocked).toBeTruthy();
    expect(listLiveObservationProbes({ threadId, includeExpired: true }).find((entry) => entry.probe_id === probe.probe_id)?.status).toBe("blocked_unbound");
    expect(result.confidence_updates.find((entry) => entry.probe_result_id === blocked?.probe_result_id)?.confidence_delta).toBe(0);
    expect(blocked?.spawned_tangent_refs).toEqual([]);
    expect(blocked?.spawned_candidate_refs).toEqual([]);
    expect(listLiveSituationPredictions({ threadId, includeExpired: true }).find((entry) => entry.prediction_id === prediction.prediction_id)?.status).not.toBe("contradicted");
  });

  it("keeps all prediction probe result and confidence artifacts out of assistant answers", () => {
    createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "ask:probe",
      objective: "Keep interpreting this generic visual workstation screen.",
      preset: "custom",
      source_ids: ["source:documents"],
    });
    routeSummary(1, "File Explorer shows a PAPERPLAY folder with image files and toolbar controls.");
    routeSummary(2, "A different app window changed to a browser tab instead of the folder view.");
    const artifacts = [
      ...listLiveSituationPredictions({ threadId, includeExpired: true }),
      ...listLiveObservationProbes({ threadId, includeExpired: true }),
      ...listLiveProbeResults({ threadId }),
      ...listLiveConfidenceUpdates({ threadId }),
      ...listLiveTangentEvaluations({ threadId }),
      ...listLiveArbitrationCandidates({ threadId, includeExpired: true }),
      ...listLiveProcedureEpochs({ threadId }),
      ...listProcedureEpochLedger({ threadId }),
    ];
    expect(artifacts.length).toBeGreaterThan(0);
    for (const artifact of artifacts) {
      expect(artifact.assistant_answer).toBe(false);
      expect(artifact.raw_content_included).toBe(false);
    }
  });
});
