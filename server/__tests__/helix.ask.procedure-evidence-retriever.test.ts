import { beforeEach, describe, expect, it } from "vitest";
import type { HelixActiveSituationContext } from "@shared/helix-active-situation-context";
import type { HelixSituationEvidenceSelection } from "@shared/helix-situation-evidence-selection";
import { buildProcedureEvidenceRetrievalPlan } from "../services/helix-ask/procedure-evidence-retrieval-planner";
import { buildProcedureEvidenceRetrievalResult } from "../services/helix-ask/procedure-evidence-retriever";
import { appendObservationJournalEntry, resetObservationJournalForTest } from "../services/situation-room/observation-journal-store";
import { recordLiveFieldEvaluation, resetLiveFieldEvaluationsForTest } from "../services/situation-room/live-field-evaluation-store";

const threadId = "helix-ask:procedure-retriever-test";
const environmentId = "live_answer:procedure-retriever-test";
const situationRunId = "live_situation_run:procedure-retriever-test";

const activeContext = (input: {
  observationRefs: string[];
  fieldEvaluationRefs?: string[];
  probeRefs?: string[];
}): HelixActiveSituationContext => ({
  schema: "helix.active_situation_context.v1",
  context_id: "active_situation_context:procedure-retriever-test",
  thread_id: threadId,
  situation_run_id: situationRunId,
  environment_id: environmentId,
  source_binding_ids: ["source_binding:procedure-retriever-test"],
  source_binding_status_refs: ["source_binding_status:procedure-retriever-test"],
  observed_unbound_source_refs: [],
  repair_candidate_refs: [],
  latest_epoch: input.observationRefs.length,
  active_modalities: ["visual_frame"],
  latest_observation_refs: input.observationRefs,
  latest_field_evaluation_refs: input.fieldEvaluationRefs ?? [],
  latest_interpretation_run_refs: ["live_interpretation_run:procedure-retriever-test"],
  latest_interpretation_worker_run_refs: [],
  latest_interpretation_hypothesis_refs: ["live_interpretation_hypothesis:procedure-retriever-test"],
  latest_interpretation_graph_refs: ["live_interpretation_graph:procedure-retriever-test"],
  latest_interpretation_tangent_refs: [],
  latest_probe_result_refs: input.probeRefs ?? [],
  latest_closure_refs: ["procedure_epoch_closure:procedure-retriever-test"],
  latest_source_descriptor_refs: [],
  status: "active",
  freshness_summary: "Active procedure retriever test context.",
  assistant_answer: false,
  raw_content_included: false,
});

const evidenceSelection = (input: {
  observationRefs: string[];
  fieldEvaluationRefs?: string[];
  probeRefs?: string[];
}): HelixSituationEvidenceSelection => ({
  schema: "helix.situation_evidence_selection.v1",
  selection_id: "situation_evidence_selection:procedure-retriever-test",
  thread_id: threadId,
  situation_run_id: situationRunId,
  deictic_reference_id: "deictic_reference:procedure-retriever-test",
  selected_observation_refs: input.observationRefs,
  selected_field_evaluation_refs: input.fieldEvaluationRefs ?? [],
  selected_interpretation_run_refs: ["live_interpretation_run:procedure-retriever-test"],
  selected_interpretation_worker_run_refs: [],
  selected_interpretation_hypothesis_refs: ["live_interpretation_hypothesis:procedure-retriever-test"],
  selected_interpretation_graph_refs: ["live_interpretation_graph:procedure-retriever-test"],
  selected_interpretation_tangent_refs: [],
  selected_probe_result_refs: input.probeRefs ?? [],
  selected_epoch_closure_refs: ["procedure_epoch_closure:procedure-retriever-test"],
  selected_source_descriptor_refs: [],
  selected_source_refs: ["visual_source:procedure-retriever-test"],
  selected_source_binding_status_refs: ["source_binding_status:procedure-retriever-test"],
  rejected_unbound_source_refs: [],
  source_binding_ledger_refs: [],
  exclusion_reasons: ["raw_images_excluded"],
  answerable: input.observationRefs.length > 0,
  answerability_reason: "Selected procedure retriever test evidence.",
  assistant_answer: false,
  raw_content_included: false,
});

const recordObservation = (input: {
  observationId: string;
  text: string;
  createdAt: string;
}) =>
  appendObservationJournalEntry({
    thread_id: threadId,
    observation_id: input.observationId,
    role: "model_perception_observation",
    modality: "visual_frame",
    source_id: "visual_source:procedure-retriever-test",
    text: input.text,
    evidence_refs: [`visual_evidence:${input.observationId}`],
    model_invoked: true,
    confidence: 0.82,
    created_at: input.createdAt,
    assistant_answer: false,
    raw_content_included: false,
  });

const recordFieldEvaluation = (input: {
  evaluationId: string;
  fieldKey: string;
  value: string;
  observationId: string;
  confidence?: number;
}) =>
  recordLiveFieldEvaluation({
    schema: "helix.live_field_evaluation.v1",
    evaluation_id: input.evaluationId,
    worker_run_id: `field_worker_run:${input.evaluationId}`,
    worker_id: "field_worker:procedure_retriever_test",
    situation_run_id: situationRunId,
    thread_id: threadId,
    environment_id: environmentId,
    field_key: input.fieldKey,
    value: input.value,
    status: "supported",
    confidence: input.confidence ?? 0.74,
    evidence_refs: [input.observationId],
    missing_evidence: [],
    corroboration_state: { visual: "present" },
    next_check: "Compare the next captured frame.",
    expires_at: "2026-05-20T02:00:00.000Z",
    created_at: "2026-05-20T01:00:00.000Z",
    role: "ui_projection",
    assistant_answer: false,
    raw_content_included: false,
  });

describe("procedure evidence retriever", () => {
  beforeEach(() => {
    resetObservationJournalForTest();
    resetLiveFieldEvaluationsForTest();
  });

  it("selects current and prior procedure refs and emits changed, stable, and unclear fields for comparison", () => {
    recordObservation({
      observationId: "observation:previous",
      text: "The screen shows File Explorer open to a research folder.",
      createdAt: "2026-05-20T01:00:00.000Z",
    });
    recordObservation({
      observationId: "observation:current",
      text: "The screen now shows a code editor with terminal logs.",
      createdAt: "2026-05-20T01:00:10.000Z",
    });
    recordFieldEvaluation({
      evaluationId: "field_eval:activity:previous",
      fieldKey: "activity",
      value: "Reviewing files in a research folder.",
      observationId: "observation:previous",
    });
    recordFieldEvaluation({
      evaluationId: "field_eval:activity:current",
      fieldKey: "activity",
      value: "Reviewing code and terminal output.",
      observationId: "observation:current",
    });

    const observationRefs = ["observation:previous", "observation:current"];
    const fieldEvaluationRefs = ["field_eval:activity:previous", "field_eval:activity:current"];
    const context = activeContext({
      observationRefs,
      fieldEvaluationRefs,
      probeRefs: [],
    });
    const selection = evidenceSelection({
      observationRefs,
      fieldEvaluationRefs,
      probeRefs: [],
    });
    const plan = buildProcedureEvidenceRetrievalPlan({
      turnId: "ask:procedure-retriever-comparison",
      promptText: "What changed since the previous visual capture?",
      activeContext: context,
      selection,
      sourceTargets: ["procedure_log"],
      evidenceRequired: true,
    });

    const result = buildProcedureEvidenceRetrievalResult({
      plan,
      activeContext: context,
      selection,
    });

    expect(plan.task).toBe("comparison");
    expect(result).toMatchObject({
      schema: "helix.procedure_evidence_retrieval_result.v1",
      turn_id: "ask:procedure-retriever-comparison",
      retrieval_plan_id: `procedure_evidence_retrieval_plan:${plan.prompt_hash}`,
      answerability: "answerable",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.selected_current_refs).toEqual(expect.arrayContaining([
      "observation:current",
      "field_eval:activity:current",
    ]));
    expect(result.selected_prior_refs).toEqual(expect.arrayContaining([
      "observation:previous",
      "field_eval:activity:previous",
    ]));
    expect(result.selected_epoch_refs).toEqual(["procedure_epoch_closure:procedure-retriever-test"]);
    expect(result.selected_field_evaluation_refs).toEqual(fieldEvaluationRefs);
    expect(result.selected_interpretation_refs).toEqual(expect.arrayContaining([
      "live_interpretation_run:procedure-retriever-test",
      "live_interpretation_hypothesis:procedure-retriever-test",
    ]));
    expect(result.changed_facts[0]).toMatchObject({
      current_refs: expect.arrayContaining(["observation:current"]),
      prior_refs: expect.arrayContaining(["observation:previous"]),
    });
    expect(result.changed_facts[0]?.claim).toContain("Current observation differs from prior observation");
    expect(result.stable_facts.length).toBeGreaterThan(0);
    expect(result.uncertainty).toEqual(expect.arrayContaining([
      expect.objectContaining({
        issue: "probe_refs_missing",
        effect_on_answer: "Probe-specific claims should be avoided or caveated.",
      }),
    ]));
    expect(result.rejected_refs).toEqual(expect.arrayContaining([
      { ref: "selection", reason: "raw_images_excluded" },
    ]));
  });

  it("forbids current-state-only synthesis for comparison prompts without prior evidence", () => {
    recordObservation({
      observationId: "observation:current-only",
      text: "The latest screen shows a docs viewer.",
      createdAt: "2026-05-20T01:00:10.000Z",
    });
    recordFieldEvaluation({
      evaluationId: "field_eval:scene:current-only",
      fieldKey: "scene",
      value: "Docs viewer is visible.",
      observationId: "observation:current-only",
    });

    const observationRefs = ["observation:current-only"];
    const fieldEvaluationRefs = ["field_eval:scene:current-only"];
    const context = activeContext({ observationRefs, fieldEvaluationRefs });
    const selection = evidenceSelection({ observationRefs, fieldEvaluationRefs });
    const plan = buildProcedureEvidenceRetrievalPlan({
      turnId: "ask:procedure-retriever-current-only",
      promptText: "Compare this visual capture to the previous epoch.",
      activeContext: context,
      selection,
      evidenceRequired: true,
    });

    const result = buildProcedureEvidenceRetrievalResult({
      plan,
      activeContext: context,
      selection,
    });

    expect(plan.task).toBe("comparison");
    expect(result.selected_current_refs).toEqual(expect.arrayContaining([
      "observation:current-only",
      "field_eval:scene:current-only",
    ]));
    expect(result.selected_prior_refs).toEqual([]);
    expect(result.changed_facts).toEqual([]);
    expect(result.stable_facts.length).toBeGreaterThan(0);
    expect(result.answerability).toBe("partially_answerable");
    expect(result.uncertainty).toEqual(expect.arrayContaining([
      expect.objectContaining({
        issue: "prior_evidence_missing",
        effect_on_answer: "Comparison answer must be partial or rejected; current-state-only synthesis is not enough.",
      }),
    ]));
    expect(result.rejected_refs).toEqual(expect.arrayContaining([
      { ref: "prior_observation", reason: "missing_prior_ref_for_comparison_task" },
    ]));
  });
});
