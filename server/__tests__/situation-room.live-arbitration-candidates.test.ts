import { beforeEach, describe, expect, it } from "vitest";
import type { HelixLiveSourceAnalysisJob } from "@shared/helix-live-source-analysis-job";
import type { HelixLiveSourceChunk } from "@shared/helix-live-source-chunk";
import {
  HELIX_LIVE_ARBITRATION_CANDIDATE_SCHEMA,
  type HelixLiveArbitrationCandidate,
} from "@shared/helix-live-arbitration-candidate";
import {
  createLiveAnswerEnvironment,
  resetLiveAnswerEnvironments,
} from "../services/situation-room/live-answer-environment-store";
import { listAskHandoffs, resetAskHandoffsForTest } from "../services/helix-ask/ask-handoff-router";
import { listPlanContracts, resetPlanContractsForTest } from "../services/helix-ask/plan-contract-boundary-guard";
import { resetGoalCardsForTest } from "../services/situation-room/goal-finder-store";
import { resetInterpretationCardsForTest } from "../services/situation-room/interpretation-card-store";
import { resetLiveArbitrationCandidatesForTest, listLiveArbitrationCandidates, recordLiveArbitrationCandidate } from "../services/situation-room/live-arbitration-candidate-store";
import { consumeLiveArbitrationCandidate } from "../services/situation-room/live-arbitration-candidate-consumer";
import { resetLiveFieldEvaluationsForTest } from "../services/situation-room/live-field-evaluation-store";
import { resetLiveFieldWorkerRunsForTest } from "../services/situation-room/live-field-worker-run-store";
import { resetLiveFieldWorkersForTest } from "../services/situation-room/live-field-worker-registry";
import { resetLiveSituationRunsForTest, listLiveSituationRuns } from "../services/situation-room/live-situation-run-store";
import { resetLiveTangentEvaluationsForTest } from "../services/situation-room/live-tangent-evaluation-store";
import { resetObservationJournalForTest } from "../services/situation-room/observation-journal-store";
import { routeLiveSourceAnalysisOutput } from "../services/situation-room/live-source-analysis-output-router";
import { resetSituationRunAcceptancesForTest, runSituationRunAcceptance } from "../services/situation-room/situation-run-acceptance-runner";

const threadId = "helix-ask:desktop";

const visualChunk = (): HelixLiveSourceChunk => ({
  schema: "helix.live_source_chunk.v1",
  chunk_id: "live_source_chunk:arbitration",
  source_id: "source:documents",
  thread_id: threadId,
  environment_id: "live_answer:arbitration",
  modality: "visual_frame",
  sequence_index: 1,
  ts: "2026-05-17T22:00:00.000Z",
  payload_ref: "visual_frame:arbitration",
  compact_summary: "File Explorer shows a PAPERPLAY folder with image files and toolbar controls.",
  evidence_refs: [],
  raw_content_included: false,
  assistant_answer: false,
  context_policy: "compact_context_pack_only",
});

const jobFor = (chunk: HelixLiveSourceChunk): HelixLiveSourceAnalysisJob => ({
  schema: "helix.live_source_analysis_job.v1",
  job_id: "live_source_analysis_job:arbitration",
  chunk_id: chunk.chunk_id,
  worker_id: "worker:visual",
  thread_id: threadId,
  source_id: chunk.source_id,
  analyzer_id: "visual_frame_analyzer",
  status: "completed",
  output_refs: ["visual_evidence:arbitration"],
  summary: chunk.compact_summary,
  assistant_answer: false,
  raw_content_included: false,
});

const seedRun = () => {
  createLiveAnswerEnvironment({
    thread_id: threadId,
    created_turn_id: "ask:arbitration",
    objective: "Using the latest visual observation, describe my current screen as a generic workstation live answer.",
    preset: "custom",
    source_ids: ["source:documents"],
  });
  const chunk = visualChunk();
  return routeLiveSourceAnalysisOutput({
    job: jobFor(chunk),
    chunk,
    status: "completed",
    summary: chunk.compact_summary,
    outputRefs: ["visual_evidence:arbitration"],
    modelInvoked: true,
  });
};

const candidateFromRun = (overrides: Partial<HelixLiveArbitrationCandidate> = {}): HelixLiveArbitrationCandidate => {
  const run = listLiveSituationRuns({ threadId }).at(-1);
  if (!run) throw new Error("missing_seed_run");
  return recordLiveArbitrationCandidate({
    schema: HELIX_LIVE_ARBITRATION_CANDIDATE_SCHEMA,
    candidate_id: `live_arbitration_candidate:test:${overrides.candidate_type ?? "silent"}`,
    situation_run_id: run.situation_run_id,
    thread_id: run.thread_id,
    environment_id: run.environment_id,
    source_binding_id: run.source_binding_id,
    epoch: run.current_epoch,
    candidate_type: "silent_update",
    reason: "test candidate",
    priority: "info",
    evidence_refs: ["obs:test"],
    field_evaluation_refs: ["live_field_eval:test"],
    tangent_refs: [],
    status: "pending",
    expires_at: "2026-05-17T22:01:00.000Z",
    assistant_answer: false,
    raw_content_included: false,
    ...overrides,
  });
};

describe("live arbitration candidates", () => {
  beforeEach(() => {
    resetLiveAnswerEnvironments();
    resetObservationJournalForTest();
    resetInterpretationCardsForTest();
    resetGoalCardsForTest();
    resetAskHandoffsForTest();
    resetPlanContractsForTest();
    resetLiveSituationRunsForTest();
    resetLiveFieldWorkersForTest();
    resetLiveFieldWorkerRunsForTest();
    resetLiveFieldEvaluationsForTest();
    resetLiveTangentEvaluationsForTest();
    resetLiveArbitrationCandidatesForTest();
    resetSituationRunAcceptancesForTest();
  });

  it("records and consumes low urgency candidates as silent updates without an Ask answer", () => {
    const routed = seedRun();
    resetAskHandoffsForTest();
    const candidate = routed.live_arbitration_candidate;
    expect(candidate).toMatchObject({
      candidate_type: "silent_update",
      status: "pending",
      assistant_answer: false,
    });
    const consumption = consumeLiveArbitrationCandidate({
      candidateId: candidate!.candidate_id,
      now: "2026-05-17T22:00:10.000Z",
    });
    expect(consumption).toMatchObject({
      decision: "silent_update",
      status: "consumed",
      assistant_answer: false,
    });
    expect(consumption.ask_handoff).toBeNull();
    expect(consumption.plan_contract).toBeNull();
    expect(listAskHandoffs({ threadId })).toHaveLength(0);
    expect(listPlanContracts({ threadId })).toHaveLength(0);
  });

  it("creates AskHandoff only through candidate consumption", () => {
    seedRun();
    resetAskHandoffsForTest();
    const candidate = candidateFromRun({
      candidate_id: "live_arbitration_candidate:test:ask",
      candidate_type: "ask_handoff_candidate",
      priority: "notice",
      proposed_output: {
        handoff_type: "helix_ask_reasoning",
        question: "What changed in the current screen?",
      },
    });
    expect(listAskHandoffs({ threadId })).toHaveLength(0);
    const consumption = consumeLiveArbitrationCandidate({
      candidateId: candidate.candidate_id,
      mode: "explicit_ask",
      now: "2026-05-17T22:00:10.000Z",
    });
    expect(consumption.decision).toBe("ask_handoff");
    expect(consumption.ask_handoff?.assistant_answer).toBe(false);
    expect(consumption.ask_handoff?.selected_evidence_refs).toContain("live_field_eval:test");
    expect(listAskHandoffs({ threadId })).toHaveLength(1);
  });

  it("creates PlanContract but does not execute it", () => {
    seedRun();
    const candidate = candidateFromRun({
      candidate_id: "live_arbitration_candidate:test:plan",
      candidate_type: "plan_contract_candidate",
      priority: "warn",
      proposed_output: {
        plan_action_id: "situation-room.live-source.capture_now",
      },
    });
    const consumption = consumeLiveArbitrationCandidate({
      candidateId: candidate.candidate_id,
      now: "2026-05-17T22:00:10.000Z",
    });
    expect(consumption.decision).toBe("plan_contract");
    expect(consumption.plan_contract).toMatchObject({
      action_id: "situation-room.live-source.capture_now",
      client_adoption_required: true,
      can_execute_itself: false,
      assistant_answer: false,
    });
    expect(listPlanContracts({ threadId })).toHaveLength(1);
  });

  it("creates request_user_input artifacts through candidate consumption", () => {
    seedRun();
    const candidate = candidateFromRun({
      candidate_id: "live_arbitration_candidate:test:request",
      candidate_type: "request_user_input_candidate",
      priority: "warn",
      proposed_output: {
        missing_input: "Which file should I inspect?",
      },
    });
    const consumption = consumeLiveArbitrationCandidate({
      candidateId: candidate.candidate_id,
      now: "2026-05-17T22:00:10.000Z",
    });
    expect(consumption.decision).toBe("request_user_input");
    expect(consumption.request_user_input).toMatchObject({
      question: "Which file should I inspect?",
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("suppresses stale epoch and unbound candidates", () => {
    seedRun();
    const stale = candidateFromRun({
      candidate_id: "live_arbitration_candidate:test:stale",
      epoch: 999,
    });
    const unbound = candidateFromRun({
      candidate_id: "live_arbitration_candidate:test:unbound",
      source_binding_id: "source_binding:wrong",
    });
    expect(consumeLiveArbitrationCandidate({
      candidateId: stale.candidate_id,
      now: "2026-05-17T22:00:10.000Z",
    }).status).toBe("suppressed");
    expect(consumeLiveArbitrationCandidate({
      candidateId: unbound.candidate_id,
      now: "2026-05-17T22:00:10.000Z",
    }).status).toBe("suppressed");
  });

  it("runs the generic visual SituationRun acceptance harness", () => {
    seedRun();
    const acceptance = runSituationRunAcceptance({
      threadId,
      scenario: "generic_visual_folder",
      now: "2026-05-17T22:00:10.000Z",
    });
    expect(acceptance.ok).toBe(true);
    expect(acceptance.assistant_answer).toBe(false);
    expect(acceptance.checks.find((entry) => entry.check === "silent_update_candidate")?.passed).toBe(true);
    expect(listLiveArbitrationCandidates({ threadId })).not.toHaveLength(0);
  });
});
