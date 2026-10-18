import { beforeEach, describe, expect, it } from "vitest";
import type { HelixLiveSourceAnalysisJob } from "@shared/helix-live-source-analysis-job";
import type { HelixLiveSourceChunk } from "@shared/helix-live-source-chunk";
import {
  createLiveAnswerEnvironment,
  resetLiveAnswerEnvironments,
} from "../services/situation-room/live-answer-environment-store";
import { listAskHandoffs, resetAskHandoffsForTest } from "../services/helix-ask/ask-handoff-router";
import { listPlanContracts, resetPlanContractsForTest } from "../services/helix-ask/plan-contract-boundary-guard";
import { resetGoalCardsForTest } from "../services/situation-room/goal-finder-store";
import { resetInterpretationCardsForTest } from "../services/situation-room/interpretation-card-store";
import { resetLiveFieldEvaluationsForTest } from "../services/situation-room/live-field-evaluation-store";
import { resetLiveFieldWorkerRunsForTest } from "../services/situation-room/live-field-worker-run-store";
import { resetLiveFieldWorkersForTest } from "../services/situation-room/live-field-worker-registry";
import { resetLiveInterpretationGraphsForTest } from "../services/situation-room/live-interpretation-graph-store";
import {
  listActiveLiveInterpretationHypotheses,
  listLiveInterpretationHypotheses,
  resetLiveInterpretationHypothesesForTest,
} from "../services/situation-room/live-interpretation-hypothesis-store";
import { resetLiveInterpretationRunsForTest } from "../services/situation-room/live-interpretation-run-store";
import { resetLiveInterpretationWorkerRunsForTest } from "../services/situation-room/live-interpretation-worker-run-store";
import { resetLiveInterpretationWorkersForTest } from "../services/situation-room/live-interpretation-worker-registry";
import {
  listLiveInterpretationValidationArtifacts,
  resetLiveInterpretationValidationArtifactsForTest,
} from "../services/situation-room/live-interpretation-validation-artifact-store";
import { resetLiveSituationRunsForTest } from "../services/situation-room/live-situation-run-store";
import { resetLiveSourceIdentitiesForTest } from "../services/situation-room/live-source-identity-store";
import { resetLiveTangentEvaluationsForTest } from "../services/situation-room/live-tangent-evaluation-store";
import { resetObservationJournalForTest } from "../services/situation-room/observation-journal-store";
import { projectPresentStateCard } from "../services/situation-room/present-state-card-projector";
import { routeLiveSourceAnalysisOutput } from "../services/situation-room/live-source-analysis-output-router";
import { rejectForbiddenInterpretationWorkerOutput } from "../services/situation-room/live-interpretation-worker-runner";

const threadId = "helix-ask:desktop";

const visualChunk = (): HelixLiveSourceChunk => ({
  schema: "helix.live_source_chunk.v1",
  chunk_id: "live_source_chunk:field-workers",
  source_id: "source:documents",
  thread_id: threadId,
  environment_id: "live_answer:field-workers",
  modality: "visual_frame",
  sequence_index: 1,
  ts: "2026-05-17T21:30:00.000Z",
  payload_ref: "visual_frame:field-workers",
  compact_summary: "File Explorer shows a PAPERPLAY folder with image files and toolbar controls.",
  evidence_refs: [],
  raw_content_included: false,
  assistant_answer: false,
  context_policy: "compact_context_pack_only",
});

const jobFor = (chunk: HelixLiveSourceChunk): HelixLiveSourceAnalysisJob => ({
  schema: "helix.live_source_analysis_job.v1",
  job_id: "live_source_analysis_job:field-workers",
  chunk_id: chunk.chunk_id,
  worker_id: "worker:visual",
  thread_id: threadId,
  source_id: chunk.source_id,
  analyzer_id: "visual_frame_analyzer",
  status: "completed",
  output_refs: ["visual_evidence:field-workers"],
  summary: chunk.compact_summary,
  assistant_answer: false,
  raw_content_included: false,
});

const handoffsDoNotOriginateFromInterpretationWorkers = (): boolean =>
  listAskHandoffs({ threadId, limit: 50 }).every((handoff) =>
    ![
      ...handoff.selected_evidence_refs,
      ...handoff.interpretation_refs,
      ...handoff.goal_refs,
    ].some((ref) => /\blive_interpretation_(?:worker_run|hypothesis|artifact)\b/.test(ref))
  );

describe("live situation field workers", () => {
  beforeEach(() => {
    resetLiveAnswerEnvironments();
    resetObservationJournalForTest();
    resetInterpretationCardsForTest();
    resetGoalCardsForTest();
    resetAskHandoffsForTest();
    resetPlanContractsForTest();
    resetLiveSituationRunsForTest();
    resetLiveSourceIdentitiesForTest();
    resetLiveFieldWorkersForTest();
    resetLiveFieldWorkerRunsForTest();
    resetLiveFieldEvaluationsForTest();
    resetLiveInterpretationRunsForTest();
    resetLiveInterpretationWorkersForTest();
    resetLiveInterpretationWorkerRunsForTest();
    resetLiveInterpretationHypothesesForTest();
    resetLiveInterpretationValidationArtifactsForTest();
    resetLiveInterpretationGraphsForTest();
    resetLiveTangentEvaluationsForTest();
  });

  it("creates a generic visual SituationRun, workers, and tentative Activity evaluation", () => {
    createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "ask:field-workers",
      objective: "Using the latest visual observation, describe my current screen as a generic workstation live answer.",
      preset: "custom",
      source_ids: ["source:documents"],
    });
    const chunk = visualChunk();
    const routed = routeLiveSourceAnalysisOutput({
      job: jobFor(chunk),
      chunk,
      status: "completed",
      summary: chunk.compact_summary,
      outputRefs: ["visual_evidence:field-workers"],
      modelInvoked: true,
    });

    expect(routed.live_situation_run).toMatchObject({
      modality_scope: "generic_visual",
      status: "active",
      assistant_answer: false,
      source_binding_id: expect.stringMatching(/^source_binding:/),
      primary_source_identity_ref: expect.stringMatching(/^live_source_identity:/),
      latest_observation_ref: expect.stringMatching(/^observation:/),
      terminal_authority_required: true,
      current_epoch: 1,
    });
    expect(routed.live_source_identity).toMatchObject({
      schema: "helix.live_source_identity.v1",
      source_id: "source:documents",
      source_binding_id: expect.stringMatching(/^source_binding:/),
      latest_epoch: 1,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(routed.live_cognition_promotion.observation).toMatchObject({
      source_id: "source:documents",
      source_identity_ref: expect.stringMatching(/^live_source_identity:/),
      source_binding_id: expect.stringMatching(/^source_binding:/),
      source_epoch: 1,
      source_seq: 1,
      assistant_answer: false,
    });
    expect(routed.live_situation_run?.terminal_policy).toMatchObject({
      worker_outputs_are_terminal: false,
      tangent_outputs_are_terminal: false,
      terminal_authority_required: true,
    });
    expect(routed.live_situation_run?.corroboration_policy).toMatchObject({
      audio_required: false,
      user_steering_required: false,
      missing_corroboration_effect: "lower_confidence_not_block",
    });
    expect(routed.live_field_workers.length).toBeGreaterThanOrEqual(6);
    expect(routed.live_field_workers.every((worker) => worker.may_execute_tool === false && worker.assistant_answer === false)).toBe(true);
    expect(routed.live_field_worker_runs.length).toBe(routed.live_field_workers.length);
    expect(routed.live_field_worker_runs.every((run) => run.status === "completed" && run.assistant_answer === false)).toBe(true);
    expect(routed.live_field_worker_runs.every((run) => Array.isArray(run.tool_calls) && run.tool_calls.length === 0)).toBe(true);
    const activity = routed.live_field_evaluations.find((entry) => entry.field_key === "activity");
    expect(activity).toMatchObject({
      status: "tentative",
      assistant_answer: false,
      raw_content_included: false,
      worker_run_id: expect.stringMatching(/^live_field_worker_run:/),
    });
    expect(activity?.value).toMatch(/browsing|reviewing|organizing/i);
    expect(activity?.missing_evidence.join(" ")).toMatch(/audio\/user steering/i);
    expect(activity?.corroboration_state.audio_transcript).toBe("missing_not_required");
    expect(routed.live_handoff_arbitration?.arbitration.decision).toBe("silent_update");
    expect(routed.live_handoff_arbitration?.arbitration.candidate?.type).toBe("none");
  });

  it("classifies Task Manager as performance metrics instead of a browser tab", () => {
    createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "ask:task-manager-field-workers",
      objective: "Using the latest visual observation, describe my current screen as a generic workstation live answer.",
      preset: "custom",
      source_ids: ["source:documents"],
    });
    const chunk: HelixLiveSourceChunk = {
      ...visualChunk(),
      chunk_id: "live_source_chunk:task-manager",
      compact_summary: "The screen displays Windows Task Manager on the Performance tab with CPU, Memory, Disk, Ethernet, and GPU metrics.",
      payload_ref: "visual_frame:task-manager",
    };
    const routed = routeLiveSourceAnalysisOutput({
      job: jobFor(chunk),
      chunk,
      status: "completed",
      summary: chunk.compact_summary,
      outputRefs: ["visual_evidence:task-manager"],
      modelInvoked: true,
    });

    const activity = routed.live_field_evaluations.find((entry) => entry.field_key === "activity");
    const objects = routed.live_field_evaluations.find((entry) => entry.field_key === "objects");
    expect(activity?.value).toMatch(/Task Manager performance metrics/i);
    expect(objects?.value).toContain("Windows Task Manager");
    expect(objects?.value).toContain("CPU panel");
    expect(objects?.value).toContain("GPU panels");
    expect(objects?.value).not.toMatch(/browser tab/i);
  });

  it("uses field evaluations before fallback in canonical projection", () => {
    createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "ask:field-workers",
      objective: "Using the latest visual observation, describe my current screen as a generic workstation live answer.",
      preset: "custom",
      source_ids: ["source:documents"],
    });
    const chunk = visualChunk();
    routeLiveSourceAnalysisOutput({
      job: jobFor(chunk),
      chunk,
      status: "completed",
      summary: chunk.compact_summary,
      outputRefs: ["visual_evidence:field-workers"],
      modelInvoked: true,
    });
    const card = projectPresentStateCard({ threadId });
    const activityProjection = card.live_card_line_projection?.lines.find((line) => line.key === "activity");
    expect(activityProjection?.reasoner_id).toMatch(/^live_field_eval:/);
    expect(activityProjection?.value).toMatch(/browsing|reviewing|organizing/i);
    expect(JSON.stringify(card)).not.toContain("Waiting for visual activity evidence");
    expect(JSON.stringify(card)).not.toContain("No visual/event pair was available to align");
  });

  it("does not attach field evaluations from an unbound source", () => {
    createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "ask:field-workers",
      objective: "Using the latest visual observation, describe my current screen as a generic workstation live answer.",
      preset: "custom",
      source_ids: ["source:documents"],
    });
    const chunk = {
      ...visualChunk(),
      chunk_id: "live_source_chunk:unbound",
      source_id: "source:other-window",
    };
    const routed = routeLiveSourceAnalysisOutput({
      job: jobFor(chunk),
      chunk,
      status: "completed",
      summary: chunk.compact_summary,
      outputRefs: ["visual_evidence:unbound"],
      modelInvoked: true,
    });
    expect(routed.live_situation_run?.source_binding_id).toMatch(/^source_binding:/);
    expect(routed.live_field_workers).toEqual([]);
    expect(routed.live_field_worker_runs).toEqual([]);
    expect(routed.live_field_evaluations).toEqual([]);
    expect(routed.live_interpretation_run).toBeNull();
    expect(routed.live_interpretation_workers).toEqual([]);
    expect(routed.live_interpretation_worker_runs).toEqual([]);
    expect(routed.live_interpretation_hypotheses).toEqual([]);
  });

  it("seeds durable interpretation workers from the first bound visual summary", () => {
    createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "ask:interpretation-workers",
      objective: "Using the latest visual observation, describe what document or folder view I am looking at.",
      preset: "custom",
      source_ids: ["source:documents"],
    });
    const chunk = visualChunk();
    const routed = routeLiveSourceAnalysisOutput({
      job: jobFor(chunk),
      chunk,
      status: "completed",
      summary: chunk.compact_summary,
      outputRefs: ["visual_evidence:field-workers"],
      modelInvoked: true,
    });

    expect(routed.live_interpretation_run).toMatchObject({
      situation_run_id: routed.live_situation_run?.situation_run_id,
      source_id: "source:documents",
      modality_scope: "generic_visual",
      objective_text: "Using the latest visual observation, describe what document or folder view I am looking at.",
      status: "active",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(routed.live_interpretation_run?.active_lenses).toEqual(expect.arrayContaining([
      "scene_neutral",
      "activity",
      "objects",
      "uncertainty",
      "verifier_lane",
      "protocol_lane",
      "risk_lane",
      "workstation_affordance_lane",
      "user_notice_lane",
    ]));
    expect(routed.live_interpretation_run?.first_scene_epoch_id).toBe(routed.live_interpretation_run?.current_scene_epoch_id);
    expect(routed.live_interpretation_run?.allowed_worker_kinds).toEqual([
      "scene_neutral",
      "activity",
      "objects",
      "uncertainty",
      "verifier",
      "protocol_lane",
      "risk_lane",
      "workstation_affordance_lane",
      "user_notice_lane",
    ]);
    expect(routed.live_interpretation_workers.length).toBe(routed.live_interpretation_run?.active_lenses.length);
    expect(routed.live_interpretation_workers.map((worker) => worker.kind)).toEqual([
      "scene_neutral",
      "activity",
      "objects",
      "uncertainty",
      "verifier",
      "protocol_lane",
      "risk_lane",
      "workstation_affordance_lane",
      "user_notice_lane",
    ]);
    expect(routed.live_interpretation_workers.every((worker) =>
      worker.may_execute_tool === false &&
      worker.can_execute_tools === false &&
      worker.can_create_ask_handoff === false &&
      worker.can_create_plan_contract === false &&
      worker.can_emit_assistant_answer === false &&
      worker.may_emit_assistant_answer === false &&
      worker.assistant_answer === false
    )).toBe(true);
    expect(routed.live_interpretation_worker_runs.length).toBe(routed.live_interpretation_workers.length);
    expect(routed.live_interpretation_worker_runs.every((run) =>
      run.status === "completed" &&
      run.scene_epoch_id === routed.live_interpretation_run?.first_scene_epoch_id &&
      run.artifact_count === 1 &&
      run.hypothesis_count === 1 &&
      run.assistant_answer === false &&
      run.raw_content_included === false
    )).toBe(true);
    expect(routed.live_interpretation_hypotheses.length).toBe(routed.live_interpretation_workers.length);
    expect(routed.live_interpretation_validation_artifacts.length).toBe(routed.live_interpretation_workers.length);
    expect(routed.live_interpretation_validation_artifacts.every((artifact) =>
      artifact.role === "validation" &&
      artifact.assistant_answer === false &&
      artifact.raw_content_included === false
    )).toBe(true);
    expect(routed.live_interpretation_hypotheses.every((hypothesis) =>
      hypothesis.assistant_answer === false &&
      hypothesis.raw_content_included === false &&
      hypothesis.role === "validation" &&
      hypothesis.evidence_refs.some((ref) => ref.startsWith("observation:")) &&
      !hypothesis.evidence_refs.includes("Using the latest visual observation, describe what document or folder view I am looking at.")
    )).toBe(true);
    const activity = routed.live_interpretation_hypotheses.find((hypothesis) => hypothesis.lens === "activity");
    expect(activity?.missing_evidence.join(" ")).toMatch(/audio\/user steering/i);
    expect(activity?.confidence).toBeLessThan(0.7);
    expect(routed.live_interpretation_graph?.nodes).toEqual(
      expect.arrayContaining(routed.live_interpretation_hypotheses.map((hypothesis) => hypothesis.hypothesis_id)),
    );
    expect(routed.live_interpretation_graph?.edges.map((edge) => edge.relation)).toEqual(
      expect.arrayContaining(["seeded_by", "observed_in", "emitted_by", "derived_from"]),
    );
    expect(handoffsDoNotOriginateFromInterpretationWorkers()).toBe(true);
    expect(listPlanContracts({ threadId, limit: 20 })).toEqual([]);
  });

  it("records interpretation contradictions as validation tangents without action authority", () => {
    createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "ask:interpretation-contradiction",
      objective: "Track what is visible on the current screen.",
      preset: "custom",
      source_ids: ["source:documents"],
    });
    const first = visualChunk();
    routeLiveSourceAnalysisOutput({
      job: jobFor(first),
      chunk: first,
      status: "completed",
      summary: first.compact_summary,
      outputRefs: ["visual_evidence:first"],
      modelInvoked: true,
    });
    const second: HelixLiveSourceChunk = {
      ...visualChunk(),
      chunk_id: "live_source_chunk:browser-contradiction",
      sequence_index: 2,
      ts: "2026-05-17T21:30:10.000Z",
      payload_ref: "visual_frame:browser-contradiction",
      compact_summary: "A browser tab is visible with a web page and site navigation controls.",
    };
    const routed = routeLiveSourceAnalysisOutput({
      job: jobFor(second),
      chunk: second,
      status: "completed",
      summary: second.compact_summary,
      outputRefs: ["visual_evidence:second"],
      modelInvoked: true,
    });

    expect(routed.live_interpretation_hypotheses.some((hypothesis) =>
      hypothesis.status === "contradicted" &&
      (hypothesis.contradicts ?? []).length > 0
    )).toBe(true);
    const verifierContradiction = routed.live_interpretation_hypotheses.find((hypothesis) =>
      hypothesis.lens === "verifier_lane" &&
      hypothesis.status === "contradicted"
    );
    expect(verifierContradiction).toBeTruthy();
    expect(routed.live_interpretation_validation_artifacts.some((artifact) =>
      artifact.artifact_type === "contradiction" &&
      artifact.payload.hypothesis_id === verifierContradiction?.hypothesis_id
    )).toBe(true);
    const allHypotheses = listLiveInterpretationHypotheses({
      interpretationRunId: routed.live_interpretation_run?.interpretation_run_id,
      limit: 100,
    });
    expect(allHypotheses.some((hypothesis) =>
      hypothesis.status === "contradicted" &&
      hypothesis.validation_state?.contradicted_by_hypothesis_id === verifierContradiction?.hypothesis_id
    )).toBe(true);
    expect(routed.live_interpretation_graph?.edges.some((edge) => edge.relation === "contradicts")).toBe(true);
    expect(routed.live_interpretation_tangents.length).toBeGreaterThan(0);
    expect(routed.live_interpretation_tangents.every((tangent) =>
      tangent.tangent_type === "contradiction_tangent" &&
      tangent.assistant_answer === false &&
      tangent.raw_content_included === false &&
      tangent.recommended_handoff.type === "none"
    )).toBe(true);
    expect(handoffsDoNotOriginateFromInterpretationWorkers()).toBe(true);
    expect(listPlanContracts({ threadId, limit: 20 })).toEqual([]);
  });

  it("expires stale interpretation hypotheses after epoch TTL without reinforcement", () => {
    createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "ask:interpretation-expiry",
      objective: "Track transient visible objects on the workstation.",
      preset: "custom",
      source_ids: ["source:documents"],
    });
    const first: HelixLiveSourceChunk = {
      ...visualChunk(),
      compact_summary: "A red mug is present on the workstation beside a notes window.",
    };
    const firstRoute = routeLiveSourceAnalysisOutput({
      job: jobFor(first),
      chunk: first,
      status: "completed",
      summary: first.compact_summary,
      outputRefs: ["visual_evidence:red-mug"],
      modelInvoked: true,
    });
    const runId = firstRoute.live_interpretation_run?.interpretation_run_id;
    expect(runId).toBeTruthy();

    for (let index = 2; index <= 5; index += 1) {
      const next: HelixLiveSourceChunk = {
        ...visualChunk(),
        chunk_id: `live_source_chunk:expiry:${index}`,
        sequence_index: index,
        ts: `2026-05-17T21:30:${String(index * 10).padStart(2, "0")}.000Z`,
        payload_ref: `visual_frame:expiry:${index}`,
        compact_summary: "A blank notes window is visible with no mug mentioned.",
      };
      routeLiveSourceAnalysisOutput({
        job: { ...jobFor(next), job_id: `live_source_analysis_job:expiry:${index}` },
        chunk: next,
        status: "completed",
        summary: next.compact_summary,
        outputRefs: [`visual_evidence:expiry:${index}`],
        modelInvoked: true,
      });
    }

    const hypotheses = listLiveInterpretationHypotheses({ interpretationRunId: runId, limit: 300 });
    expect(hypotheses.some((hypothesis) =>
      hypothesis.status === "expired" &&
      Boolean(hypothesis.expired_at) &&
      /red mug|mug/i.test(hypothesis.claim)
    )).toBe(true);
    expect(listLiveInterpretationValidationArtifacts({
      interpretationRunId: runId,
      artifactType: "expiry",
    }).length).toBeGreaterThan(0);
    expect(listActiveLiveInterpretationHypotheses({ interpretationRunId: runId, limit: 300 })
      .some((hypothesis) => hypothesis.status === "expired")).toBe(false);
    expect(handoffsDoNotOriginateFromInterpretationWorkers()).toBe(true);
    expect(listPlanContracts({ threadId, limit: 20 })).toEqual([]);
  });

  it("blocks interpretation worker terminal authority attempts at the gate", () => {
    createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "ask:interpretation-terminal-gate",
      objective: "Track current screen interpretation.",
      preset: "custom",
      source_ids: ["source:documents"],
    });
    const chunk = visualChunk();
    const routed = routeLiveSourceAnalysisOutput({
      job: jobFor(chunk),
      chunk,
      status: "completed",
      summary: chunk.compact_summary,
      outputRefs: ["visual_evidence:terminal-gate"],
      modelInvoked: true,
    });
    const workerRun = routed.live_interpretation_worker_runs[0];
    expect(workerRun).toBeTruthy();

    const rejected = rejectForbiddenInterpretationWorkerOutput({
      interpretationRun: routed.live_interpretation_run!,
      workerRun,
      attemptedOutput: {
        assistant_answer: true,
        terminal_authority: true,
        tool_calls: [{ name: "dangerous.tool" }],
        ask_handoff: { schema: "helix.ask_handoff.v1" },
        plan_contract: { schema: "helix.plan_contract.v1" },
      },
      now: "2026-05-17T21:30:15.000Z",
    });

    expect(rejected.validation.ok).toBe(false);
    expect(rejected.worker_run.status).toBe("failed");
    expect(rejected.worker_run.failure_reason).toContain("assistant_answer_true");
    expect(rejected.artifact.artifact_type).toBe("gate_block");
    expect(listLiveInterpretationValidationArtifacts({
      interpretationRunId: routed.live_interpretation_run?.interpretation_run_id,
      artifactType: "gate_block",
    }).length).toBeGreaterThan(0);
    expect(handoffsDoNotOriginateFromInterpretationWorkers()).toBe(true);
    expect(listPlanContracts({ threadId, limit: 20 })).toEqual([]);
  });
});
