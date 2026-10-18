import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createLiveAnswerEnvironment,
  resetLiveAnswerEnvironments,
} from "../services/situation-room/live-answer-environment-store";
import { ensureLiveSituationRunForEnvironment, resetLiveSituationRunsForTest } from "../services/situation-room/live-situation-run-store";
import { appendObservationJournalEntry, resetObservationJournalForTest } from "../services/situation-room/observation-journal-store";
import { recordLiveFieldEvaluation, resetLiveFieldEvaluationsForTest } from "../services/situation-room/live-field-evaluation-store";
import { recordProcedureEpochClosure, resetProcedureEpochClosuresForTest } from "../services/situation-room/procedure-epoch-closure";
import { resetProcedureEpochLedgerForTest } from "../services/situation-room/procedure-epoch-ledger-store";
import { resetVisualComparisonSessionsForTest } from "../services/situation-room/visual-comparison-session-store";
import { resetVoiceLiveHandoffsForTest } from "../services/situation-room/voice-live-handoff-router";
import { resetLiveFieldWorkersForTest } from "../services/situation-room/live-field-worker-registry";
import { resetLiveFieldWorkerRunsForTest } from "../services/situation-room/live-field-worker-run-store";
import { ensureLiveInterpretationRun, resetLiveInterpretationRunsForTest } from "../services/situation-room/live-interpretation-run-store";
import { recordLiveInterpretationWorkerRun, resetLiveInterpretationWorkerRunsForTest } from "../services/situation-room/live-interpretation-worker-run-store";
import { recordLiveInterpretationHypothesis, resetLiveInterpretationHypothesesForTest } from "../services/situation-room/live-interpretation-hypothesis-store";
import { updateLiveInterpretationGraph, resetLiveInterpretationGraphsForTest } from "../services/situation-room/live-interpretation-graph-store";
import { recordLiveTangentEvaluation, resetLiveTangentEvaluationsForTest } from "../services/situation-room/live-tangent-evaluation-store";
import { resetProcedureReasoningSnapshotsForTest } from "../services/situation-room/procedure-reasoning-snapshot-store";
import { resetConversationalAnswerDistillationsForTest } from "../services/helix-ask/conversational-answer-distillation-store";
import {
  recordVisualSceneMemoryIndex,
  resetVisualSceneMemoryForTest,
} from "../services/situation-room/visual-scene-memory-store";
import {
  resetLiveSourceChunkBufferForTest,
  upsertLiveSourceProducer,
} from "../services/situation-room/live-source-chunk-buffer";
import { routeSituationContextTurn } from "../services/helix-ask/situation-context-turn-router";
import { arbitrateAskSourceTarget } from "../services/helix-ask/ask-source-target-arbitrator";
import { buildRouteProductContract } from "../services/helix-ask/route-product-contract";

const createApp = async (): Promise<{ app: express.Express }> => {
  const agi = await import("../routes/agi.plan");
  const app = express();
  app.use(express.json());
  app.use("/api/agi", agi.planRouter);
  return { app };
};

const seedVisualSituationRun = () => {
  const now = new Date().toISOString();
  const { environment } = createLiveAnswerEnvironment({
    thread_id: "helix-ask:desktop",
    created_turn_id: "ask:seed",
    objective: "Use the latest visual observation to describe the current workstation screen.",
    preset: "custom",
    source_ids: ["visual_source:test"],
    now,
  });
  const run = ensureLiveSituationRunForEnvironment({
    environment,
    advanceEpoch: false,
    now,
  });
  const observation = appendObservationJournalEntry({
    thread_id: "helix-ask:desktop",
    observation_id: "observation:folder-view",
    kind: "model_perception_observation",
    modality: "visual_frame",
    source_id: "visual_source:test",
    text: "A Windows File Explorer folder is visible with research files.",
    evidence_refs: ["live_source_analysis_job:test"],
    model_invoked: true,
    confidence: 0.82,
    created_at: now,
  });
  recordLiveFieldEvaluation({
    schema: "helix.live_field_evaluation.v1",
    evaluation_id: "field_eval:activity",
    worker_run_id: "field_worker_run:activity",
    worker_id: "field_worker:activity",
    situation_run_id: run.situation_run_id,
    thread_id: run.thread_id,
    environment_id: run.environment_id,
    field_key: "activity",
    value: "Likely browsing, reviewing, or organizing visible workstation files.",
    status: "supported",
    confidence: 0.62,
    evidence_refs: [observation.observation_id],
    missing_evidence: ["No audio/user steering corroboration."],
    corroboration_state: { visual: "present", transcript: "missing_not_required" },
    next_check: "Compare the next captured frame for selection, window, or content changes.",
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    created_at: now,
    role: "ui_projection",
    assistant_answer: false,
    raw_content_included: false,
  });
  recordLiveFieldEvaluation({
    schema: "helix.live_field_evaluation.v1",
    evaluation_id: "field_eval:objects",
    worker_run_id: "field_worker_run:objects",
    worker_id: "field_worker:objects",
    situation_run_id: run.situation_run_id,
    thread_id: run.thread_id,
    environment_id: run.environment_id,
    field_key: "objects",
    value: "File Explorer window, folder view, visible file entries.",
    status: "supported",
    confidence: 0.7,
    evidence_refs: [observation.observation_id],
    missing_evidence: [],
    corroboration_state: { visual: "present" },
    next_check: "Watch for a selected file or opened document.",
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    created_at: now,
    role: "ui_projection",
    assistant_answer: false,
    raw_content_included: false,
  });
  recordProcedureEpochClosure({
    situation_run_id: run.situation_run_id,
    thread_id: run.thread_id,
    environment_id: run.environment_id,
    source_binding_id: run.source_binding_id,
    epoch: run.current_epoch,
    status: "silent_update",
    card_updated: true,
    confidence_changes: ["field_eval:activity"],
    created_at: now,
  });
  return { environment, run, observation };
};

const seedVisualSituationRunWithInterpretation = () => {
  const seeded = seedVisualSituationRun();
  const now = new Date().toISOString();
  const interpretationRun = ensureLiveInterpretationRun({
    run: seeded.run,
    observation: seeded.observation,
    now,
  });
  const workerRun = recordLiveInterpretationWorkerRun({
    schema: "helix.live_interpretation_worker_run.v1",
    interpretation_worker_run_id: "live_interpretation_worker_run:bridge-activity",
    interpretation_worker_id: "live_interpretation_worker:activity",
    worker_kind: "activity",
    situation_run_id: seeded.run.situation_run_id,
    interpretation_run_id: interpretationRun.interpretation_run_id,
    thread_id: seeded.run.thread_id,
    source_epoch: seeded.run.current_epoch,
    scene_epoch_id: seeded.observation.observation_id,
    trigger_observation_refs: [seeded.observation.observation_id],
    trigger_summary_refs: [seeded.observation.observation_id],
    status: "completed",
    model_invoked: false,
    model_budget_used: "none",
    input_digest: "bridge-input",
    output_digest: "bridge-output",
    artifact_count: 1,
    hypothesis_count: 1,
    failure_reason: null,
    started_at: now,
    completed_at: now,
    output_hypothesis_id: "live_interpretation_hypothesis:bridge-activity",
    assistant_answer: false,
    raw_content_included: false,
    role: "validation",
  });
  const hypothesis = recordLiveInterpretationHypothesis({
    schema: "helix.live_interpretation_hypothesis.v1",
    hypothesis_id: "live_interpretation_hypothesis:bridge-activity",
    interpretation_worker_run_id: workerRun.interpretation_worker_run_id,
    interpretation_run_id: interpretationRun.interpretation_run_id,
    situation_run_id: seeded.run.situation_run_id,
    source_epoch: seeded.run.current_epoch,
    latest_source_epoch: seeded.run.current_epoch,
    lens: "activity",
    kind: "activity",
    claim: "The user is likely reviewing a research folder in File Explorer.",
    normalized_key: "reviewing_research_folder",
    confidence: 0.71,
    evidence_refs: [seeded.observation.observation_id],
    missing_evidence: [],
    uncertainty: [],
    supports: [],
    contradicts: [],
    supersedes: [],
    predicted_signals: ["folder_navigation_change"],
    recommended_next_check: "Compare the next epoch for folder navigation or selection changes.",
    recommended_candidate: "silent_update",
    status: "active",
    stale_after_epoch_count: 3,
    validation_state: {},
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    assistant_answer: false,
    raw_content_included: false,
    role: "validation",
  });
  const graph = updateLiveInterpretationGraph({
    interpretationRun,
    hypotheses: [hypothesis],
    workerRuns: [workerRun],
    artifacts: [],
    now,
  });
  const tangent = recordLiveTangentEvaluation({
    schema: "helix.live_tangent_evaluation.v1",
    tangent_id: "live_tangent:bridge-activity",
    situation_run_id: seeded.run.situation_run_id,
    thread_id: seeded.run.thread_id,
    tangent_type: "interpretation_bridge_check",
    trigger_observation_refs: [seeded.observation.observation_id],
    claim: "Interpretation bridge tangent remains validation evidence only.",
    confidence: 0.6,
    evidence_refs: [hypothesis.hypothesis_id],
    missing_evidence: [],
    supports: [hypothesis.hypothesis_id],
    contradicts: [],
    recommended_handoff: { type: "none", reason: "validation_only" },
    assistant_answer: false,
    raw_content_included: false,
    role: "validation",
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  return { ...seeded, interpretationRun, workerRun, hypothesis, graph, tangent };
};

const seedTemporalVisualSituationRun = () => {
  const now = "2026-05-18T12:00:00.000Z";
  const { environment } = createLiveAnswerEnvironment({
    thread_id: "helix-ask:desktop",
    created_turn_id: "ask:temporal-seed",
    objective: "Use time-windowed visual observations.",
    preset: "custom",
    source_ids: ["visual_source:temporal"],
    now,
  });
  const run = ensureLiveSituationRunForEnvironment({
    environment,
    advanceEpoch: false,
    now,
  });
  return { environment, run };
};

const seedVisualSceneMemoryComparison = () => {
  const { environment, run } = seedVisualSituationRun();
  const priorAt = "2026-05-18T12:00:00.000Z";
  const currentAt = "2026-05-18T12:00:10.000Z";
  const priorObservation = appendObservationJournalEntry({
    thread_id: "helix-ask:desktop",
    observation_id: "observation:soho-folder",
    kind: "model_perception_observation",
    modality: "visual_frame",
    source_id: "visual_source:test",
    text: "A Windows File Explorer folder labeled \"SOHO\" is visible with solar assets.",
    evidence_refs: ["live_source_analysis_job:soho"],
    model_invoked: true,
    confidence: 0.8,
    created_at: priorAt,
  });
  const priorSceneEval = recordLiveFieldEvaluation({
    schema: "helix.live_field_evaluation.v1",
    evaluation_id: "field_eval:scene:soho",
    worker_run_id: "field_worker_run:scene:soho",
    worker_id: "field_worker:scene",
    situation_run_id: run.situation_run_id,
    thread_id: run.thread_id,
    environment_id: run.environment_id,
    field_key: "scene",
    value: "The screen shows File Explorer in a folder labeled \"SOHO\" with solar-observation files including soho-index.png.",
    status: "supported",
    confidence: 0.77,
    evidence_refs: [priorObservation.observation_id],
    missing_evidence: [],
    corroboration_state: { visual: "present" },
    next_check: null,
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    created_at: priorAt,
    role: "ui_projection",
    assistant_answer: false,
    raw_content_included: false,
  });
  const currentObservation = appendObservationJournalEntry({
    thread_id: "helix-ask:desktop",
    observation_id: "observation:paperplay-folder",
    kind: "model_perception_observation",
    modality: "visual_frame",
    source_id: "visual_source:test",
    text: "A Windows File Explorer folder labeled \"PAPERPLAY 2\" is visible with artwork files.",
    evidence_refs: ["live_source_analysis_job:paperplay"],
    model_invoked: true,
    confidence: 0.83,
    created_at: currentAt,
  });
  const currentSceneEval = recordLiveFieldEvaluation({
    schema: "helix.live_field_evaluation.v1",
    evaluation_id: "field_eval:scene:paperplay",
    worker_run_id: "field_worker_run:scene:paperplay",
    worker_id: "field_worker:scene",
    situation_run_id: run.situation_run_id,
    thread_id: run.thread_id,
    environment_id: run.environment_id,
    field_key: "scene",
    value: "The screen shows File Explorer in a folder labeled \"PAPERPLAY 2\" with artwork files including paperplay-cover.png.",
    status: "supported",
    confidence: 0.81,
    evidence_refs: [currentObservation.observation_id],
    missing_evidence: [],
    corroboration_state: { visual: "present" },
    next_check: null,
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    created_at: currentAt,
    role: "ui_projection",
    assistant_answer: false,
    raw_content_included: false,
  });
  recordVisualSceneMemoryIndex({
    situationRunId: run.situation_run_id,
    threadId: run.thread_id,
    environmentId: run.environment_id,
    epoch: 0,
    observation: priorObservation,
    evaluations: [priorSceneEval],
    procedureEpoch: {
      schema: "helix.live_procedure_epoch.v1",
      epoch_id: "procedure_epoch:soho",
      situation_run_id: run.situation_run_id,
      thread_id: run.thread_id,
      environment_id: run.environment_id,
      source_binding_id: run.source_binding_id,
      epoch: 0,
      observation_refs: [priorObservation.observation_id],
      field_evaluation_refs: [priorSceneEval.evaluation_id],
      prediction_refs: [],
      probe_result_refs: [],
      assistant_answer: false,
      raw_content_included: false,
      role: "validation",
      created_at: priorAt,
    },
  });
  recordVisualSceneMemoryIndex({
    situationRunId: run.situation_run_id,
    threadId: run.thread_id,
    environmentId: run.environment_id,
    epoch: run.current_epoch,
    observation: currentObservation,
    evaluations: [currentSceneEval],
    procedureEpoch: {
      schema: "helix.live_procedure_epoch.v1",
      epoch_id: "procedure_epoch:paperplay",
      situation_run_id: run.situation_run_id,
      thread_id: run.thread_id,
      environment_id: run.environment_id,
      source_binding_id: run.source_binding_id,
      epoch: run.current_epoch,
      observation_refs: [currentObservation.observation_id],
      field_evaluation_refs: [currentSceneEval.evaluation_id],
      prediction_refs: [],
      probe_result_refs: [],
      assistant_answer: false,
      raw_content_included: false,
      role: "validation",
      created_at: currentAt,
    },
  });
  return { environment, run };
};

const seedSemanticVisualSceneMemoryExamples = () => {
  const { environment, run } = seedVisualSituationRun();
  const addScene = (input: {
    title: string;
    observationId: string;
    evaluationId: string;
    epochId: string;
    timestamp: string;
    text: string;
  }) => {
    const observation = appendObservationJournalEntry({
      thread_id: "helix-ask:desktop",
      observation_id: input.observationId,
      kind: "model_perception_observation",
      modality: "visual_frame",
      source_id: "visual_source:test",
      text: input.text,
      evidence_refs: [`live_source_analysis_job:${input.title.toLowerCase().replace(/\s+/g, "-")}`],
      model_invoked: true,
      confidence: 0.84,
      created_at: input.timestamp,
    });
    const sceneEval = recordLiveFieldEvaluation({
      schema: "helix.live_field_evaluation.v1",
      evaluation_id: input.evaluationId,
      worker_run_id: `field_worker_run:scene:${input.title.toLowerCase().replace(/\s+/g, "-")}`,
      worker_id: "field_worker:scene",
      situation_run_id: run.situation_run_id,
      thread_id: run.thread_id,
      environment_id: run.environment_id,
      field_key: "scene",
      value: input.text,
      status: "supported",
      confidence: 0.82,
      evidence_refs: [observation.observation_id],
      missing_evidence: [],
      corroboration_state: { visual: "present" },
      next_check: null,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      created_at: input.timestamp,
      role: "ui_projection",
      assistant_answer: false,
      raw_content_included: false,
    });
    recordVisualSceneMemoryIndex({
      situationRunId: run.situation_run_id,
      threadId: run.thread_id,
      environmentId: run.environment_id,
      epoch: 0,
      observation,
      evaluations: [sceneEval],
      procedureEpoch: {
        schema: "helix.live_procedure_epoch.v1",
        epoch_id: input.epochId,
        situation_run_id: run.situation_run_id,
        thread_id: run.thread_id,
        environment_id: run.environment_id,
        source_binding_id: run.source_binding_id,
        epoch: 0,
        observation_refs: [observation.observation_id],
        field_evaluation_refs: [sceneEval.evaluation_id],
        prediction_refs: [],
        probe_result_refs: [],
        assistant_answer: false,
        raw_content_included: false,
        role: "validation",
        created_at: input.timestamp,
      },
    });
  };
  addScene({
    title: "SUN",
    observationId: "observation:sun-folder",
    evaluationId: "field_eval:scene:sun",
    epochId: "procedure_epoch:sun",
    timestamp: "2026-05-18T12:00:01.000Z",
    text: "The screen shows File Explorer in a folder labeled \"SUN\" with solar-observation files including sun-map.png and flare-data.csv.",
  });
  addScene({
    title: "Camera Roll",
    observationId: "observation:camera-roll",
    evaluationId: "field_eval:scene:camera-roll",
    epochId: "procedure_epoch:camera-roll",
    timestamp: "2026-05-18T12:00:02.000Z",
    text: "The screen shows File Explorer in a Camera Roll folder labeled \"Camera Roll\" with photos including IMG_0001.jpg.",
  });
  addScene({
    title: "audio export",
    observationId: "observation:audio-export-folder",
    evaluationId: "field_eval:scene:audio-export",
    epochId: "procedure_epoch:audio-export",
    timestamp: "2026-05-18T12:00:03.000Z",
    text: "The screen shows File Explorer in a folder labeled \"audio export\" with rendered audio files including mixdown.wav and stems.zip.",
  });
  addScene({
    title: "Task Manager",
    observationId: "observation:task-manager-current",
    evaluationId: "field_eval:scene:task-manager-current",
    epochId: "procedure_epoch:task-manager-current",
    timestamp: "2026-05-18T12:00:04.000Z",
    text: "The screen shows Windows Task Manager titled \"Task Manager\" on the Performance tab.",
  });
  return { environment, run };
};

describe("thread-bound situation context bridge", () => {
  beforeEach(() => {
    resetLiveAnswerEnvironments();
    resetLiveSituationRunsForTest();
    resetObservationJournalForTest();
    resetLiveFieldEvaluationsForTest();
    resetProcedureEpochClosuresForTest();
    resetProcedureEpochLedgerForTest();
    resetVisualComparisonSessionsForTest();
    resetVoiceLiveHandoffsForTest();
    resetLiveSourceChunkBufferForTest();
    resetLiveFieldWorkersForTest();
    resetLiveFieldWorkerRunsForTest();
    resetLiveInterpretationRunsForTest();
    resetLiveInterpretationWorkerRunsForTest();
    resetLiveInterpretationHypothesesForTest();
    resetLiveInterpretationGraphsForTest();
    resetLiveTangentEvaluationsForTest();
    resetProcedureReasoningSnapshotsForTest();
    resetConversationalAnswerDistillationsForTest();
    resetVisualSceneMemoryForTest();
  });
  it("resolves a typed selected-file prompt through active SituationRun evidence", () => {
    seedVisualSituationRun();
    const route = routeSituationContextTurn({
      threadId: "helix-ask:desktop",
      promptText: "Can you see the file I'm clicking on right now?",
      inputModality: "typed",
    });

    expect(route.route).toBe("situation_context_question");
    expect(route.deictic_reference).toMatchObject({
      reference_type: "selected_visible_file",
      candidate_signal: true,
      resolution_status: "resolved",
      assistant_answer: false,
    });
    expect(route.situation_evidence_selection.answerable).toBe(true);
    expect(route.situation_evidence_selection.selected_observation_refs).toContain("observation:folder-view");
    expect(route.situation_evidence_selection.raw_content_included).toBe(false);
    expect(route.answer_text).toContain("can't confirm the clicked file");
    expect(route.answer_text).not.toContain("Evidence refs:");
    expect(route.reasoning_snapshot?.assistant_answer).toBe(false);
    expect(route.answer_distillation?.assistant_answer).toBe(false);
  });

  it("selects interpretation artifacts as first-class Ask evidence", () => {
    const seeded = seedVisualSituationRunWithInterpretation();
    const route = routeSituationContextTurn({
      threadId: "helix-ask:desktop",
      promptText: "What am I looking at now in the visual screen capture?",
      inputModality: "typed",
      turnId: "ask:interpretation-bridge",
    });

    expect(route.active_situation_context.latest_interpretation_run_refs).toContain(seeded.interpretationRun.interpretation_run_id);
    expect(route.active_situation_context.latest_interpretation_worker_run_refs).toContain(seeded.workerRun.interpretation_worker_run_id);
    expect(route.active_situation_context.latest_interpretation_hypothesis_refs).toContain(seeded.hypothesis.hypothesis_id);
    expect(route.active_situation_context.latest_interpretation_graph_refs).toContain(seeded.graph.graph_id);
    expect(route.active_situation_context.latest_interpretation_tangent_refs).toContain(seeded.tangent.tangent_id);
    expect(route.situation_evidence_selection.selected_interpretation_run_refs).toContain(seeded.interpretationRun.interpretation_run_id);
    expect(route.situation_evidence_selection.selected_interpretation_worker_run_refs).toContain(seeded.workerRun.interpretation_worker_run_id);
    expect(route.situation_evidence_selection.selected_interpretation_hypothesis_refs).toContain(seeded.hypothesis.hypothesis_id);
    expect(route.situation_evidence_selection.selected_interpretation_graph_refs).toContain(seeded.graph.graph_id);
    expect(route.situation_evidence_selection.selected_interpretation_tangent_refs).toContain(seeded.tangent.tangent_id);
    expect(route.reasoning_snapshot?.full_reasoning_summary).toContain(seeded.hypothesis.hypothesis_id);
    expect(route.answer_distillation?.selected_evidence_refs).toContain(seeded.hypothesis.hypothesis_id);
  });

  it("creates a voice live handoff instead of quick-response authority", () => {
    seedVisualSituationRun();
    const route = routeSituationContextTurn({
      threadId: "helix-ask:desktop",
      promptText: "Can you see the file I'm clicking on right now?",
      inputModality: "voice",
    });

    expect(route.voice_live_handoff).toMatchObject({
      route: "situation_context_question",
      quick_response_suppressed: true,
      assistant_answer: false,
    });
    expect(route.answer_distillation?.style).toBe("voice");
    expect(route.answer_text).not.toContain("Source refs:");
    expect(route.answer_text).not.toContain("Details are saved in the procedure log");
  });

  it("sets up a visual comparison session from the current observation", () => {
    const { run } = seedVisualSituationRun();
    const route = routeSituationContextTurn({
      threadId: "helix-ask:desktop",
      promptText: "Compare this file with the next one I show you.",
      inputModality: "typed",
    });

    expect(route.route).toBe("visual_comparison_setup");
    expect(route.comparison_session).toMatchObject({
      situation_run_id: run.situation_run_id,
      baseline_observation_ref: "observation:folder-view",
      waiting_for_next_visual_observation: true,
      assistant_answer: false,
    });
  });

  it("does not convert unrelated concept prompts into situation routes", () => {
    seedVisualSituationRun();
    const route = routeSituationContextTurn({
      threadId: "helix-ask:desktop",
      promptText: "What is a neutron star glitch?",
      inputModality: "typed",
    });

    expect(route.route).toBe("none");
    expect(route.deictic_reference.candidate_signal).toBe(false);
  });

  it("ask turn answers deictic visual prompts from selected situation evidence", async () => {
    const { app } = await createApp();
    seedVisualSituationRun();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Can you see the file I'm clicking on right now?",
        mode: "read",
        debug: true,
        sessionId: "helix-ask:desktop",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("situation_context_question");
    expect(response.body?.deictic_reference?.reference_type).toBe("selected_visible_file");
    expect(response.body?.situation_evidence_selection?.selected_observation_refs).toContain("observation:folder-view");
    expect(String(response.body?.answer ?? "")).toContain("can't confirm the clicked file");
    expect(String(response.body?.answer ?? "")).not.toContain("Evidence refs:");
    expect(response.body?.procedure_reasoning_snapshot?.assistant_answer).toBe(false);
    expect(response.body?.answer_distillation?.assistant_answer).toBe(false);
    expect(String(response.body?.answer ?? "")).not.toContain("I cannot access any files");
    expect(response.body?.terminal_answer_authority?.server_authoritative).toBe(true);
  }, 60000);

  it("does not let active-doc identity override an explicit visual screen-capture target", async () => {
    const { app } = await createApp();
    seedVisualSituationRun();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Actually, what file am I looking at in the visual screen capture?",
        mode: "read",
        debug: true,
        sessionId: "helix-ask:desktop",
        workspace_context_snapshot: {
          sessionId: "helix-ask:desktop",
          activePanel: "live-answer-environment",
          activeDocPath: "/docs/research/nhm2-current-status-whitepaper.md",
          hasDocContext: true,
          docContextValid: true,
          docContextPath: "/docs/research/nhm2-current-status-whitepaper.md",
        },
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("situation_context_question");
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("situation_context_question");
    expect(response.body?.terminal_artifact_kind).toBe("situation_context_pack");
    expect(response.body?.deictic_reference?.candidate_signal).toBe(true);
    expect(response.body?.situation_evidence_selection?.answerable).toBe(true);
    expect(String(response.body?.selected_final_answer ?? "")).not.toContain("Active doc:");
    expect(String(response.body?.selected_final_answer ?? "")).not.toContain("nhm2-current-status-whitepaper");
    expect(response.body?.terminal_presentation?.schema).toBe("helix.terminal_presentation.v1");
    expect(response.body?.poison_audit?.ok).toBe(true);
  }, 60000);

  it("routes explicit visual capture content questions through SituationRun evidence", async () => {
    const { app } = await createApp();
    seedVisualSituationRun();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Explain, what is in the visual capture?",
        mode: "read",
        debug: true,
        sessionId: "helix-ask:desktop",
        workspace_context_snapshot: {
          sessionId: "helix-ask:desktop",
          activePanel: "docs-viewer",
          activeDocPath: "/docs/research/nhm2-current-status-whitepaper.md",
          hasDocContext: true,
          docContextValid: true,
          docContextPath: "/docs/research/nhm2-current-status-whitepaper.md",
        },
      })
      .expect(200);

    const finalAnswer = String(response.body?.selected_final_answer ?? response.body?.answer ?? "");
    expect(response.body?.source_target_intent).toMatchObject({
      target_source: "visual_capture",
      target_kind: "visual_capture",
      strength: "hard",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
      precedence_reason: "explicit_visual_source_target",
    });
    expect(response.body?.ask_turn_preflight_context?.source_target_intent).toMatchObject({
      target_source: "visual_capture",
      must_enter_backend_ask: true,
    });
    expect(response.body?.route_product_contract).toMatchObject({
      source_target: "visual_capture",
    });
    expect(response.body?.route_reason_code).toBe("situation_context_question");
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("situation_context_question");
    expect(response.body?.deictic_reference).toMatchObject({
      reference_type: "current_screen",
      candidate_signal: true,
      resolution_status: "resolved",
    });
    expect(response.body?.terminal_artifact_kind).toBe("situation_context_pack");
    expect(finalAnswer).toMatch(/browsing|reviewing|organizing|File Explorer/i);
    expect(finalAnswer).toContain("The useful signal is");
    expect(finalAnswer).not.toContain("Details are saved in the procedure log");
    expect(finalAnswer).not.toContain("Source refs:");
    expect(finalAnswer).not.toContain("McGurk");
    expect(finalAnswer).not.toContain("phenomenon where visual information");
    expect(finalAnswer).not.toContain("Explained the active document");
    expect(response.body?.terminal_answer_authority?.server_authoritative).toBe(true);
    expect(response.body?.poison_audit?.ok).toBe(true);
  }, 60000);

  it("routes plural visuals description prompts through SituationRun evidence", async () => {
    const { app } = await createApp();
    seedVisualSituationRun();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Okay, can you describe what the visuals are?",
        mode: "read",
        debug: true,
        sessionId: "helix-ask:desktop",
      })
      .expect(200);

    const finalAnswer = String(response.body?.selected_final_answer ?? response.body?.answer ?? "");
    expect(response.body?.source_target_intent).toMatchObject({
      target_source: "visual_capture",
      target_kind: "visual_capture",
      strength: "hard",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
    });
    expect(response.body?.ask_turn_preflight_context?.source_target_intent).toMatchObject({
      target_source: "visual_capture",
      must_enter_backend_ask: true,
    });
    expect(response.body?.route_reason_code).toBe("situation_context_question");
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("situation_context_question");
    expect(response.body?.deictic_reference).toMatchObject({
      reference_type: "current_screen",
      candidate_signal: true,
      resolution_status: "resolved",
    });
    expect(response.body?.terminal_artifact_kind).toBe("situation_context_pack");
    expect(finalAnswer).not.toContain("Visuals refer to images");
    expect(finalAnswer).not.toContain("charts, graphs, and videos");
    expect(finalAnswer).toMatch(/File Explorer|browsing|reviewing|organizing/i);
  }, 60000);

  it("does not treat visual screen content questions as live pipeline continuation", async () => {
    const { app } = await createApp();
    seedVisualSituationRun();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Can you describe what we can see now in the visual screen capture?",
        mode: "read",
        debug: true,
        sessionId: "helix-ask:desktop",
      })
      .expect(200);

    const finalAnswer = String(response.body?.selected_final_answer ?? response.body?.answer ?? "");
    expect(response.body?.source_target_intent).toMatchObject({
      target_source: "visual_capture",
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
    });
    expect(response.body?.route_reason_code).toBe("situation_context_question");
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("situation_context_question");
    expect(response.body?.terminal_artifact_kind).toBe("situation_context_pack");
    expect(response.body?.final_answer_source).not.toBe("live_pipeline_receipt");
    expect(finalAnswer).not.toContain("Visual capture is running every");
    expect(finalAnswer).toMatch(/File Explorer|browsing|reviewing|organizing/i);
  }, 60000);

  it("fail-closes explicit visual capture prompts without model-only concept answers when no visual evidence is bound", async () => {
    const { app } = await createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Explain, what is in the visual capture?",
        mode: "read",
        debug: true,
        sessionId: "helix-ask:desktop",
      })
      .expect(200);

    const finalAnswer = String(response.body?.selected_final_answer ?? response.body?.answer ?? "");
    expect(response.body?.source_target_intent).toMatchObject({
      target_source: "visual_capture",
      target_kind: "visual_capture",
      strength: "hard",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
      precedence_reason: "explicit_visual_source_target",
    });
    expect(response.body?.ask_turn_preflight_context?.source_target_intent).toMatchObject({
      target_source: "visual_capture",
      must_enter_backend_ask: true,
    });
    expect(response.body?.route_reason_code).toBe("situation_context_question");
    expect(response.body?.deictic_reference).toMatchObject({
      reference_type: "current_screen",
      candidate_signal: true,
    });
    expect(response.body?.situation_evidence_selection?.answerable).toBe(false);
    expect(finalAnswer).toMatch(/active visual SituationRun|no server-bound active SituationRun evidence/i);
    expect(finalAnswer).not.toContain("McGurk");
    expect(finalAnswer).not.toContain("phenomenon where visual information");
    expect(response.body?.terminal_answer_authority?.server_authoritative).toBe(true);
  }, 60000);

  it("keeps explicit visual prompts on the visual terminal presentation when an active doc is present", async () => {
    const { app } = await createApp();
    seedVisualSituationRun();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Okay, explain the screen capture right now.",
        mode: "read",
        debug: true,
        sessionId: "helix-ask:desktop",
        workspace_context_snapshot: {
          sessionId: "helix-ask:desktop",
          activePanel: "docs-viewer",
          activeDocPath: "/docs/research/nhm2-current-status-whitepaper.md",
          hasDocContext: true,
          docContextValid: true,
          docContextPath: "/docs/research/nhm2-current-status-whitepaper.md",
        },
      })
      .expect(200);

    const finalAnswer = String(response.body?.selected_final_answer ?? "");
    expect(response.body?.route_reason_code).toBe("situation_context_question");
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("situation_context_question");
    expect(response.body?.source_target_intent).toMatchObject({
      target_source: "visual_capture",
      target_kind: "visual_capture",
      strength: "hard",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
      precedence_reason: "explicit_visual_source_target",
    });
    expect(response.body?.ask_turn_preflight_context?.source_target_intent).toMatchObject({
      target_source: "visual_capture",
      must_enter_backend_ask: true,
    });
    expect(response.body?.terminal_artifact_kind).toBe("situation_context_pack");
    expect(response.body?.terminal_presentation?.concise_text).toBe(finalAnswer);
    expect(finalAnswer).toContain("File Explorer");
    expect(finalAnswer).not.toContain("Explained the active document");
    expect(finalAnswer).not.toContain("Key claim: The current document context");
    expect(finalAnswer).not.toContain("nhm2-current-status-whitepaper");
    expect(response.body?.terminal_answer_authority?.terminal_text_preview).toBe(finalAnswer);
    expect(response.body?.poison_audit?.ok).toBe(true);
  }, 60000);

  it("does not let visual SituationRun hijack structured docs-viewer locate prompts", async () => {
    const { app } = await createApp();
    seedVisualSituationRun();
    const question = [
      "Find where this topic is addressed in the current docs viewer context.",
      "Return a short \"Locations:\" list with anchors/sections and one-line evidence snippets.",
      "Document path: docs/research/nhm2-current-status-whitepaper.md",
      "Locate query: \"Okay, can you open up Docs and read me the latest NHM2 white paper?\"",
    ].join("\n");
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question,
        mode: "read",
        debug: true,
        sessionId: "helix-ask:desktop",
        workspace_context_snapshot: {
          sessionId: "helix-ask:desktop",
          activePanel: "docs-viewer",
          activeDocPath: "/docs/research/nhm2-current-status-whitepaper.md",
          hasDocContext: true,
          docContextValid: true,
          docContextPath: "/docs/research/nhm2-current-status-whitepaper.md",
        },
      })
      .expect(200);

    const finalAnswer = String(response.body?.selected_final_answer ?? response.body?.answer ?? "");
    expect(response.body?.source_target_intent).toMatchObject({
      target_source: "docs_viewer",
      target_kind: "docs_viewer",
      strength: "hard",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
      precedence_reason: "explicit_docs_viewer_source_target",
    });
    expect(response.body?.route_product_contract).toMatchObject({
      schema: "helix.route_product_contract.v1",
      thread_id: "helix-ask:desktop",
      source_target: "docs_viewer",
    });
    expect(response.body?.route_product_contract?.allowed_terminal_artifact_kinds).toEqual(
      expect.arrayContaining(["doc_location_result", "docs_viewer_receipt", "workspace_action_receipt"]),
    );
    expect(response.body?.route_product_contract?.forbidden_terminal_artifact_kinds).toEqual(
      expect.arrayContaining(["situation_context_pack", "no_tool_direct", "model_only_concept"]),
    );
    expect(response.body?.ask_turn_preflight_context?.deictic_reference).toBeNull();
    expect(response.body?.deictic_reference ?? null).toBeNull();
    expect(response.body?.terminal_artifact_kind).toBe("doc_location_result");
    expect(response.body?.doc_location_result).toMatchObject({
      schema: "helix.doc_location_result.v1",
      turn_id: expect.stringMatching(/^ask:/),
      doc_path: "docs/research/nhm2-current-status-whitepaper.md",
      locate_query: "Okay, can you open up Docs and read me the latest NHM2 white paper?",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(response.body?.doc_location_result?.result_id).toMatch(/^doc_location_result:/);
    expect(response.body?.doc_location_result?.locations?.length).toBeGreaterThan(0);
    expect(response.body?.terminal_artifact_selection_guard?.allowed).toBe(true);
    expect(finalAnswer).toContain("Locations:");
    expect(finalAnswer).not.toContain("File Explorer");
    expect(finalAnswer).not.toContain("visible workstation files");
    expect(response.body?.route_history_debug?.rejected_route_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route: "situation_context_question",
          target_source: "docs_viewer",
        }),
      ]),
    );
    expect(response.body?.terminal_presentation?.schema).toBe("helix.terminal_presentation.v1");
    expect(response.body?.terminal_answer_authority?.server_authoritative).toBe(true);
    expect(response.body?.poison_audit?.ok).toBe(true);
  }, 60000);

  it("ask turn keeps missing live context inside the situation bridge instead of model-only fallback", async () => {
    const { app } = await createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Can you see the file that I'm clicking right now",
        mode: "read",
        debug: true,
        sessionId: "helix-ask:desktop",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("situation_context_question");
    expect(response.body?.final_answer_source).toBe("typed_failure");
    expect(response.body?.terminal_artifact_kind).toBe("typed_failure");
    expect(response.body?.deictic_reference?.reference_type).toBe("selected_visible_file");
    expect(response.body?.active_situation_context?.status).toBe("missing");
    expect(response.body?.situation_evidence_selection?.answerable).toBe(false);
    expect(String(response.body?.answer ?? "")).toContain("active visual SituationRun");
    expect(response.body?.terminal_presentation?.schema).toBe("helix.terminal_presentation.v1");
    expect(String(response.body?.answer ?? "")).not.toContain("model_only");
    expect(response.body?.poison_audit?.ok).toBe(true);
  }, 60000);

  it("ask turn handles current-file deictic prompts without retrieval initialization errors", async () => {
    const { app } = await createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Okay, what file am I looking at now?",
        mode: "read",
        debug: true,
        sessionId: "helix-ask:desktop",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("situation_context_question");
    expect(String(response.body?.answer ?? "")).not.toContain("retrievalRequiredSignal");
    expect(response.body?.final_answer_source).toBe("typed_failure");
    expect(response.body?.terminal_artifact_kind).toBe("typed_failure");
    expect(String(response.body?.answer ?? "")).toContain("active visual SituationRun");
    expect(response.body?.deictic_reference?.candidate_signal).toBe(true);
    expect(response.body?.ask_turn_preflight_context?.schema).toBe("helix.ask_turn_preflight_context.v1");
    expect(response.body?.ask_turn_preflight_context?.retrieval_required_signal).toBeTruthy();
    expect(response.body?.terminal_presentation?.schema).toBe("helix.terminal_presentation.v1");
    expect(response.body?.terminal_presentation?.concise_text).toBe(response.body?.answer);
    expect(response.body?.terminal_presentation_coverage_audit).toMatchObject({
      schema: "helix.terminal_presentation_coverage_audit.v1",
      terminal_presenter_used: true,
      raw_route_text_returned: false,
    });
    expect(response.body?.poison_audit?.ok).toBe(true);
  }, 60000);

  it("freezes live visual context at the ask timestamp and excludes post-anchor observations", () => {
    const { run } = seedTemporalVisualSituationRun();
    const inventoryObservation = appendObservationJournalEntry({
      thread_id: "helix-ask:desktop",
      observation_id: "observation:inventory-open",
      kind: "model_perception_observation",
      modality: "visual_frame",
      source_id: "visual_source:temporal",
      text: "The player has the inventory open.",
      evidence_refs: ["visual_frame:inventory"],
      model_invoked: true,
      confidence: 0.84,
      observed_at: "2026-05-18T12:00:08.000Z",
      created_at: "2026-05-18T12:00:08.500Z",
      available_at: "2026-05-18T12:00:09.000Z",
    });
    appendObservationJournalEntry({
      thread_id: "helix-ask:desktop",
      observation_id: "observation:cave-entered",
      kind: "model_perception_observation",
      modality: "visual_frame",
      source_id: "visual_source:temporal",
      text: "The player has entered a cave.",
      evidence_refs: ["visual_frame:cave"],
      model_invoked: true,
      confidence: 0.82,
      observed_at: "2026-05-18T12:00:12.000Z",
      created_at: "2026-05-18T12:00:12.500Z",
      available_at: "2026-05-18T12:00:13.000Z",
    });
    recordLiveFieldEvaluation({
      schema: "helix.live_field_evaluation.v1",
      evaluation_id: "field_eval:scene:inventory",
      worker_run_id: "field_worker_run:scene:inventory",
      worker_id: "field_worker:scene",
      situation_run_id: run.situation_run_id,
      thread_id: run.thread_id,
      environment_id: run.environment_id,
      field_key: "scene",
      value: "The visible screen shows an open inventory.",
      status: "supported",
      confidence: 0.8,
      evidence_refs: [inventoryObservation.observation_id],
      missing_evidence: [],
      corroboration_state: { visual: "present" },
      next_check: "Watch for inventory changes.",
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      created_at: "2026-05-18T12:00:09.000Z",
      role: "ui_projection",
      assistant_answer: false,
      raw_content_included: false,
    });
    recordLiveFieldEvaluation({
      schema: "helix.live_field_evaluation.v1",
      evaluation_id: "field_eval:scene:cave",
      worker_run_id: "field_worker_run:scene:cave",
      worker_id: "field_worker:scene",
      situation_run_id: run.situation_run_id,
      thread_id: run.thread_id,
      environment_id: run.environment_id,
      field_key: "scene",
      value: "The visible screen shows the player entering a cave.",
      status: "supported",
      confidence: 0.8,
      evidence_refs: ["observation:cave-entered"],
      missing_evidence: [],
      corroboration_state: { visual: "present" },
      next_check: "Watch for hostile mobs.",
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      created_at: "2026-05-18T12:00:13.000Z",
      role: "ui_projection",
      assistant_answer: false,
      raw_content_included: false,
    });

    const route = routeSituationContextTurn({
      threadId: "helix-ask:desktop",
      promptText: "Dottie, what am I doing?",
      inputModality: "voice",
      speechEndAt: "2026-05-18T12:00:10.000Z",
      serverReceivedAt: "2026-05-18T12:00:14.000Z",
      answerStartedAt: "2026-05-18T12:00:14.000Z",
    });

    expect(route.route).toBe("situation_context_question");
    expect(route.live_context_window_binding?.window.to_ts).toBe("2026-05-18T12:00:10.000Z");
    expect(route.live_context_window_binding?.included_observation_refs).toContain("observation:inventory-open");
    expect(route.live_context_window_binding?.excluded_observation_refs).toEqual(
      expect.arrayContaining([
        { ref: "observation:cave-entered", reason: "after_anchor" },
      ]),
    );
    expect(route.situation_evidence_selection.selected_observation_refs).toContain("observation:inventory-open");
    expect(route.situation_evidence_selection.selected_observation_refs).not.toContain("observation:cave-entered");
    expect(route.situation_evidence_selection.selected_field_evaluation_refs).toContain("field_eval:scene:inventory");
    expect(route.situation_evidence_selection.selected_field_evaluation_refs).not.toContain("field_eval:scene:cave");
    expect(String(route.answer_text ?? "")).toContain("inventory");
    expect(String(route.answer_text ?? "")).not.toContain("cave");
  });

  it("allows late-arriving pre-anchor observations only when available before answer start", () => {
    const { run } = seedTemporalVisualSituationRun();
    appendObservationJournalEntry({
      thread_id: "helix-ask:desktop",
      observation_id: "observation:late-frame",
      kind: "model_perception_observation",
      modality: "visual_frame",
      source_id: "visual_source:temporal",
      text: "A frame captured before the question shows the player opening a chest.",
      evidence_refs: ["visual_frame:late"],
      model_invoked: true,
      confidence: 0.84,
      observed_at: "2026-05-18T12:00:08.000Z",
      created_at: "2026-05-18T12:00:10.500Z",
      available_at: "2026-05-18T12:00:10.500Z",
    });
    appendObservationJournalEntry({
      thread_id: "helix-ask:desktop",
      observation_id: "observation:late-translation",
      kind: "transcript_observation",
      modality: "audio_transcript",
      source_id: "translation:guest",
      text: "A translation became available after the answer started.",
      evidence_refs: ["translation:late"],
      model_invoked: false,
      confidence: 0.8,
      observed_at: "2026-05-18T12:00:07.000Z",
      created_at: "2026-05-18T12:00:12.000Z",
      available_at: "2026-05-18T12:00:12.000Z",
    });
    recordLiveFieldEvaluation({
      schema: "helix.live_field_evaluation.v1",
      evaluation_id: "field_eval:scene:late-frame",
      worker_run_id: "field_worker_run:scene:late-frame",
      worker_id: "field_worker:scene",
      situation_run_id: run.situation_run_id,
      thread_id: run.thread_id,
      environment_id: run.environment_id,
      field_key: "scene",
      value: "The visible screen shows a chest being opened.",
      status: "supported",
      confidence: 0.8,
      evidence_refs: ["observation:late-frame"],
      missing_evidence: [],
      corroboration_state: { visual: "present" },
      next_check: "Watch for item transfer.",
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      created_at: "2026-05-18T12:00:10.500Z",
      role: "ui_projection",
      assistant_answer: false,
      raw_content_included: false,
    });

    const route = routeSituationContextTurn({
      threadId: "helix-ask:desktop",
      promptText: "What am I looking at?",
      inputModality: "typed",
      submittedAt: "2026-05-18T12:00:11.000Z",
      answerStartedAt: "2026-05-18T12:00:11.000Z",
    });

    expect(route.live_context_window_binding?.included_observation_refs).toContain("observation:late-frame");
    expect(route.live_context_window_binding?.excluded_observation_refs).toEqual(
      expect.arrayContaining([
        { ref: "observation:late-translation", reason: "not_available_before_answer" },
      ]),
    );
    expect(route.situation_evidence_selection.selected_observation_refs).toContain("observation:late-frame");
    expect(String(route.answer_text ?? "")).toContain("chest");
    expect(String(route.answer_text ?? "")).not.toContain("translation");
  });

  it("distills visible folder evidence into a grammatical file answer", () => {
    const { run, observation } = seedVisualSituationRun();
    recordLiveFieldEvaluation({
      schema: "helix.live_field_evaluation.v1",
      evaluation_id: "field_eval:scene:sdo",
      worker_run_id: "field_worker_run:scene",
      worker_id: "field_worker:scene",
      situation_run_id: run.situation_run_id,
      thread_id: run.thread_id,
      environment_id: run.environment_id,
      field_key: "scene",
      value: "The visible scene showcases a file directory labeled \"SDO-Solar Dynamics Observatory,\" containing various folders and files related to solar observation and data analysis.",
      status: "supported",
      confidence: 0.7,
      evidence_refs: [observation.observation_id],
      missing_evidence: [],
      corroboration_state: { visual: "present" },
      next_check: "Watch for a selected file or opened document.",
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      created_at: new Date().toISOString(),
      role: "ui_projection",
      assistant_answer: false,
      raw_content_included: false,
    });

    const route = routeSituationContextTurn({
      threadId: "helix-ask:desktop",
      promptText: "Okay, can you describe what file I'm looking at now?",
      inputModality: "typed",
    });

    expect(route.route).toBe("situation_context_question");
    expect(route.answer_distillation?.concise_answer).toContain("You're viewing a folder labeled \"SDO-Solar Dynamics Observatory\"");
    expect(route.answer_distillation?.concise_answer).toContain("can't confirm a specific selected file");
    expect(String(route.answer_text ?? "")).not.toContain("You're looking at The visible scene");
    expect(String(route.answer_text ?? "")).not.toContain("Observatory.\" with");
    expect(String(route.answer_text ?? "")).not.toContain("..");
    expect(String(route.answer_text ?? "")).not.toContain("Evidence refs:");
  });

  it("does not truncate visual object descriptions mid-word in the final answer", () => {
    const { run, observation } = seedVisualSituationRun();
    recordLiveFieldEvaluation({
      schema: "helix.live_field_evaluation.v1",
      evaluation_id: "field_eval:scene:ide",
      worker_run_id: "field_worker_run:scene",
      worker_id: "field_worker:scene",
      situation_run_id: run.situation_run_id,
      thread_id: run.thread_id,
      environment_id: run.environment_id,
      field_key: "scene",
      value: "A programming environment focused on a project titled \"Fix Helix Ask route authority.\"",
      status: "supported",
      confidence: 0.74,
      evidence_refs: [observation.observation_id],
      missing_evidence: [],
      corroboration_state: { visual: "present" },
      next_check: "Watch for changed files or terminal output.",
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      created_at: new Date().toISOString(),
      role: "ui_projection",
      assistant_answer: false,
      raw_content_included: false,
    });
    recordLiveFieldEvaluation({
      schema: "helix.live_field_evaluation.v1",
      evaluation_id: "field_eval:objects:ide",
      worker_run_id: "field_worker_run:objects",
      worker_id: "field_worker:objects",
      situation_run_id: run.situation_run_id,
      thread_id: run.thread_id,
      environment_id: run.environment_id,
      field_key: "objects",
      value:
        "A sidebar with project management options, the CasimirBot project, recent chat context, changed files, terminal output, and recent file edits connected to the Helix Ask route-authority work.",
      status: "supported",
      confidence: 0.76,
      evidence_refs: [observation.observation_id],
      missing_evidence: [],
      corroboration_state: { visual: "present" },
      next_check: "Watch for the next selected file or command output.",
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      created_at: new Date().toISOString(),
      role: "ui_projection",
      assistant_answer: false,
      raw_content_included: false,
    });

    const route = routeSituationContextTurn({
      threadId: "helix-ask:desktop",
      promptText: "Okay, can you explain what you're seeing in the visual screen capture?",
      inputModality: "typed",
    });

    const answer = String(route.answer_text ?? "");
    expect(answer).toContain("project management options");
    expect(answer).toContain("recent file edits");
    expect(answer).not.toMatch(/\boptio(?:\.\.|\.\.\.)/i);
    expect(answer).not.toContain("Details are saved in the procedure log");
    expect(answer).not.toContain("Source refs:");
  });

  it("streaming ask turn handles explicit UUID deictic prompts without retrieval initialization errors", async () => {
    const { app } = await createApp();
    const turnId = "3450f3b2-9bb3-4ed1-9be4-d50273209029";
    const response = await request(app)
      .post("/api/agi/ask/turn/stream")
      .send({
        question: "Okay, what file am I looking at now?",
        mode: "read",
        debug: true,
        sessionId: "helix-ask:desktop",
        traceId: turnId,
        turnId,
      })
      .expect(200);

    expect(response.text).toContain("event: turn_final");
    expect(response.text).toContain('"route_reason_code":"situation_context_question"');
    expect(response.text).toContain('"schema":"helix.ask_turn_preflight_context.v1"');
    expect(response.text).toContain('"schema":"helix.terminal_presentation.v1"');
    expect(response.text).not.toContain("retrievalRequiredSignal");
    expect(response.text).not.toContain("Cannot access");
  }, 60000);

  it("reports an unbound live visual producer instead of claiming no live source exists", () => {
    upsertLiveSourceProducer({
      sourceId: "visual_source:desktop-active",
      threadId: "helix-ask:desktop",
      modality: "visual_frame",
      status: "active",
      cadenceMs: 10000,
      captureMode: "interval",
      now: new Date().toISOString(),
    });

    const route = routeSituationContextTurn({
      threadId: "122b027e-56a4-41e7-8d65-dd9e1bd7af36",
      promptText: "OK, what am I looking at now?",
      inputModality: "typed",
    });

    expect(route.route).toBe("situation_context_question");
    expect(route.active_situation_context.status).toBe("unbound");
    expect(route.active_situation_context.thread_id).toBe("helix-ask:desktop");
    expect(route.active_situation_context.freshness_summary).toContain("live visual source producer exists");
    expect(route.active_situation_context.next_required_action).toBe("create_or_bind_situation_run");
    expect(route.situation_evidence_selection.answerable).toBe(false);
  });

  it("surfaces an explicit repair candidate for an unbound visual producer with observations", () => {
    upsertLiveSourceProducer({
      sourceId: "visual_source:desktop-active",
      threadId: "helix-ask:desktop",
      modality: "visual_frame",
      status: "active",
      cadenceMs: 10000,
      captureMode: "interval",
      now: new Date().toISOString(),
    });
    appendObservationJournalEntry({
      thread_id: "helix-ask:desktop",
      observation_id: "observation:barrier-formula-screen",
      kind: "model_perception_observation",
      modality: "visual_frame",
      source_id: "visual_source:desktop-active",
      text: "A file or document view is visible with a formula related to barrier height.",
      evidence_refs: ["live_source_analysis_job:test"],
      model_invoked: true,
      confidence: 0.76,
      created_at: new Date().toISOString(),
    });

    const route = routeSituationContextTurn({
      threadId: "122b027e-56a4-41e7-8d65-dd9e1bd7af36",
      promptText: "You see any files I'm looking at for the barrier height, I'm looking at one formula.",
      inputModality: "typed",
    });

    expect(route.route).toBe("situation_context_question");
    expect(route.binding_repair?.status).toBe("candidate_created");
    expect(route.binding_repair?.requires_explicit_acceptance).toBe(true);
    expect(route.active_situation_context.status).toBe("unbound");
    expect(route.active_situation_context.situation_run_id).toBeNull();
    expect(route.active_situation_context.repair_candidate_refs).toContain(route.binding_repair?.repair_candidate_id);
    expect(route.situation_evidence_selection.answerable).toBe(false);
    expect(route.situation_evidence_selection.selected_observation_refs).not.toContain("observation:barrier-formula-screen");
    expect(String(route.answer_text ?? "")).toContain("Repair candidate created");
    expect(String(route.answer_text ?? "")).toContain("Explicit acceptance is required");
    expect(String(route.answer_text ?? "")).not.toContain("Evidence refs:");
  });

  it("auto-binds a fresh producer for explicit visual screen-capture questions", () => {
    const now = new Date().toISOString();
    upsertLiveSourceProducer({
      sourceId: "visual_source:desktop-active",
      threadId: "helix-ask:desktop",
      modality: "visual_frame",
      status: "active",
      cadenceMs: null,
      captureMode: "manual",
      now,
    });
    appendObservationJournalEntry({
      thread_id: "helix-ask:desktop",
      observation_id: "observation:visual-capture-current",
      kind: "model_perception_observation",
      modality: "visual_frame",
      source_id: "visual_source:desktop-active",
      text: "A current visual capture frame shows a file management workspace.",
      evidence_refs: ["live_source_analysis_job:visual-capture-current"],
      model_invoked: true,
      confidence: 0.78,
      observed_at: now,
      ingested_at: now,
      available_at: now,
      created_at: now,
    });

    const route = routeSituationContextTurn({
      threadId: "122b027e-56a4-41e7-8d65-dd9e1bd7af36",
      promptText: "Okay, can you review what is happening right now in the visual screen capture?",
      inputModality: "typed",
      turnId: "ask:auto-bind-visual-capture",
      submittedAt: now,
      answerStartedAt: now,
    });

    expect(route.route).toBe("situation_context_question");
    expect(route.active_situation_context.status).toBe("active");
    expect(route.active_situation_context.situation_run_id).toMatch(/^live_situation_run:/);
    expect(route.active_situation_context.environment_id).toMatch(/^live_answer:/);
    expect(route.situation_evidence_selection.answerable).toBe(true);
    expect(route.situation_evidence_selection.selected_source_refs).toContain("visual_source:desktop-active");
    expect(route.situation_evidence_selection.selected_observation_refs.length).toBeGreaterThan(0);
    expect(route.answer_text).toContain("file management workspace");
    expect(route.answer_text).toContain("I'm seeing");
    expect(route.answer_text).not.toContain("Source refs:");
    expect(route.answer_text).not.toContain("Details are saved in the procedure log");
  });

  it("does not auto-accept a fresh visual capture repair into an existing SituationRun", () => {
    seedVisualSituationRun();
    const now = new Date().toISOString();
    upsertLiveSourceProducer({
      sourceId: "visual_source:chrome-current",
      threadId: "helix-ask:desktop",
      modality: "visual_frame",
      status: "active",
      cadenceMs: null,
      captureMode: "manual",
      now,
    });
    appendObservationJournalEntry({
      thread_id: "helix-ask:desktop",
      observation_id: "observation:chrome-visual-current",
      kind: "model_perception_observation",
      modality: "visual_frame",
      source_id: "visual_source:chrome-current",
      text: "A Chrome visual capture frame shows the Helix Ask test UI and worker-lane debug output.",
      evidence_refs: ["live_source_analysis_job:chrome-visual-current"],
      model_invoked: true,
      confidence: 0.79,
      observed_at: now,
      ingested_at: now,
      available_at: now,
      created_at: now,
    });

    const route = routeSituationContextTurn({
      threadId: "122b027e-56a4-41e7-8d65-dd9e1bd7af36",
      promptText: "Okay, can you explain what the visual capture is seeing right now?",
      inputModality: "typed",
      turnId: "ask:auto-accept-active-run-visual-capture",
      submittedAt: now,
      answerStartedAt: now,
    });

    expect(route.route).toBe("situation_context_question");
    expect(route.active_situation_context.status).toBe("active");
    expect(route.active_situation_context.situation_run_id).toMatch(/^live_situation_run:/);
    expect(route.situation_evidence_selection.answerable).toBe(true);
    expect(route.binding_repair).toMatchObject({
      status: "candidate_created",
      source_id: "visual_source:chrome-current",
      proposed_replay_policy: "future_only",
    });
    expect(route.situation_evidence_selection.selected_source_refs).not.toContain("visual_source:chrome-current");
    expect(JSON.stringify(route.situation_evidence_selection.rejected_unbound_source_refs)).toContain("source_binding_status:");
    expect(route.situation_evidence_selection.selected_observation_refs.length).toBeGreaterThan(0);
    expect(route.answer_text).not.toContain("Helix Ask test UI");
    expect(route.answer_text).toContain("I'm seeing");
    expect(route.answer_text).not.toContain("Source refs:");
    expect(route.answer_text).not.toContain("Details are saved in the procedure log");
  });

  it("recalls saved evidence through a snapshot expansion prompt", () => {
    seedVisualSituationRun();
    const first = routeSituationContextTurn({
      threadId: "helix-ask:desktop",
      promptText: "What am I looking at now?",
      inputModality: "typed",
      turnId: "ask:first",
    });
    expect(first.answer_distillation?.expansion_available).toBe(true);

    const recall = routeSituationContextTurn({
      threadId: "helix-ask:desktop",
      promptText: "Show the evidence.",
      inputModality: "typed",
      turnId: "ask:recall",
    });

    expect(recall.route).toBe("procedure_epoch_replay_question");
    expect(recall.answer_text).toContain("Reasoning snapshot:");
    expect(recall.answer_text).toContain("Evidence refs:");
    expect(recall.answer_text).toContain("observation:folder-view");
    expect(recall.procedure_memory_recall).toMatchObject({
      schema: "helix.procedure_memory_recall.v1",
      recall_type: "show_evidence",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(recall.procedure_memory_recall?.snapshot_refs).toContain(first.reasoning_snapshot?.snapshot_id);
    expect(recall.answer_distillation?.assistant_answer).toBe(false);
    expect(recall.reasoning_snapshot?.assistant_answer).toBe(false);
  });

  it.each([
    ["Show the evidence.", "procedure_memory_recall", "brief_evidence"],
    ["What did you base that on?", "procedure_memory_recall", "brief_evidence"],
    ["Why did you say that?", "answer_distillation_expansion", "expanded_trace"],
    ["Replay that.", "procedure_epoch_replay", "epoch_replay"],
    ["What changed in the last situation epoch?", "procedure_epoch_replay", "epoch_replay"],
  ])("hard-routes %s to procedure recall products", (promptText, route, mode) => {
    seedVisualSituationRun();
    routeSituationContextTurn({
      threadId: "helix-ask:desktop",
      promptText: "What am I looking at now?",
      inputModality: "typed",
      turnId: "ask:anchor",
    });

    const sourceTarget = arbitrateAskSourceTarget({
      turnId: "ask:recall-route",
      threadId: "helix-ask:desktop",
      promptText,
    });
    const contract = buildRouteProductContract({
      turnId: "ask:recall-route",
      threadId: "helix-ask:desktop",
      sourceTargetIntent: sourceTarget,
      promptText,
    });
    const recall = routeSituationContextTurn({
      threadId: "helix-ask:desktop",
      promptText,
      inputModality: "typed",
      turnId: "ask:recall-route",
    });

    expect(sourceTarget).toMatchObject({
      strength: "hard",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
    });
    expect(sourceTarget.suppressed_routes).toEqual(expect.arrayContaining([
      "process_graph_overview",
      "raw_logs",
      "generic_context_pack",
      "legacy_context_pack",
      "no_tool_direct",
      "model_only_concept",
    ]));
    expect(contract.allowed_terminal_artifact_kinds).toContain(route);
    expect(contract.forbidden_terminal_artifact_kinds).toEqual(expect.arrayContaining([
      "process_graph_overview",
      "no_tool_direct",
      "model_only_concept",
      "generic_context_pack",
      "raw_logs",
    ]));
    expect(recall.procedure_memory_recall).toMatchObject({
      mode,
      terminal_artifact_kind: route,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(JSON.stringify(recall.procedure_memory_recall)).not.toMatch(/raw_(?:image|audio|logs|frame)|process_graph_snapshot/i);
    expect(recall.answer_text).not.toMatch(/raw logs|raw image|raw audio|process graph/i);
  });

  it("routes polite docs-panel open prompts to docs viewer identity instead of doc search topic text", () => {
    const sourceTarget = arbitrateAskSourceTarget({
      turnId: "ask:open-docs-panel",
      threadId: "helix-ask:desktop",
      promptText: "Okay, open the docs for me.",
    });

    expect(sourceTarget).toMatchObject({
      target_source: "docs_viewer",
      target_kind: "docs_viewer",
      strength: "hard",
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
    });
    expect(sourceTarget.explicit_cues).toContain("docs_panel_open");
    expect(sourceTarget.suppressed_routes).toEqual(expect.arrayContaining(["doc_open_best", "model_only_concept"]));
  });

  it("suppresses negated docs-panel open prompts to model-only explanation", () => {
    const sourceTarget = arbitrateAskSourceTarget({
      turnId: "ask:negated-docs-panel",
      threadId: "helix-ask:desktop",
      promptText: "Do not open the docs viewer; just explain what the docs viewer is for.",
    });

    expect(sourceTarget).toMatchObject({
      target_source: "model_only",
      target_kind: "general_background",
      strength: "hard",
      allow_no_tool_direct: true,
      precedence_reason: "explicit_model_only_target",
    });
    expect(sourceTarget.reasons).toEqual(expect.arrayContaining(["negative_workspace_scope"]));
  });

  it("routes live-capture content prompts to visual evidence instead of model-only answers", () => {
    const sourceTarget = arbitrateAskSourceTarget({
      turnId: "ask:live-capture-content",
      threadId: "helix-ask:desktop",
      promptText: "Describe what you see in the live capture.",
    });

    expect(sourceTarget).toMatchObject({
      target_source: "visual_capture",
      target_kind: "visual_capture",
      strength: "hard",
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
    });
    expect(sourceTarget.explicit_cues).toContain("live_capture_content");
    expect(sourceTarget.suppressed_routes).toEqual(expect.arrayContaining(["live_pipeline_control", "model_only_concept", "no_tool_direct"]));
  });

  it("prefers active SituationRun refs over legacy context packs for recall", () => {
    seedVisualSituationRun();
    routeSituationContextTurn({
      threadId: "helix-ask:desktop",
      promptText: "What am I looking at now?",
      inputModality: "typed",
      turnId: "ask:anchor",
    });

    const recall = routeSituationContextTurn({
      threadId: "helix-ask:desktop",
      promptText: "Show the evidence.",
      inputModality: "typed",
      turnId: "ask:active-precedence",
    });

    expect(recall.procedure_memory_recall?.selection_precedence[0]).toBe("active_situation_run");
    expect(recall.procedure_memory_recall?.selected_evidence_refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source_scope: "active_situation_run" }),
      ]),
    );
  });

  it("typed-fails when procedure recall evidence is missing", () => {
    const recall = routeSituationContextTurn({
      threadId: "helix-ask:desktop",
      promptText: "Why did you say that?",
      inputModality: "typed",
      turnId: "ask:missing-recall",
    });

    expect(recall.typed_failure).toMatchObject({
      schema: "helix.typed_failure.v1",
      failure_code: "PROCEDURE_MEMORY_ACTIVE_SITUATION_RUN_MISSING",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(recall.answer_text).toContain("Failure: PROCEDURE_MEMORY_ACTIVE_SITUATION_RUN_MISSING");
    expect(recall.answer_text).not.toMatch(/I think|probably|based on general/i);
  });

  it("suppresses voice recall when not terminal-authorized", () => {
    const recall = routeSituationContextTurn({
      threadId: "helix-ask:desktop",
      promptText: "Replay that.",
      inputModality: "voice",
      turnId: "ask:voice-recall",
    });

    expect(recall.voice_live_handoff).toMatchObject({
      quick_response_suppressed: true,
      assistant_answer: false,
    });
    expect(recall.typed_failure?.failure_code).toBe("PROCEDURE_RECALL_VOICE_NOT_TERMINAL_AUTHORIZED");
  });

  it("routes scene-delta prompts through procedure replay and refuses fake comparisons without prior evidence", () => {
    seedVisualSituationRun();
    const route = routeSituationContextTurn({
      threadId: "helix-ask:desktop",
      promptText: "Okay, can you describe what changed since last scene?",
      inputModality: "typed",
      turnId: "ask:scene-delta",
    });

    expect(route.route).toBe("procedure_epoch_replay_question");
    expect(route.deictic_reference.reference_type).toBe("latest_epoch_change");
    expect(route.procedure_evidence_retrieval_plan).toMatchObject({
      schema: "helix.procedure_evidence_retrieval_plan.v1",
      task: "comparison",
      anchor: "latest_visual_epoch",
      compare_against: "previous_epoch",
      evidence_required: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(route.procedure_evidence_retrieval_plan?.requested_facets).toEqual(expect.arrayContaining([
      "scene",
      "field_evaluations",
      "interpretations",
      "probes",
      "uncertainty",
    ]));
    expect(route.procedure_evidence_retrieval_result).toMatchObject({
      schema: "helix.procedure_evidence_retrieval_result.v1",
      answerability: "partially_answerable",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(route.procedure_evidence_retrieval_result?.selected_current_refs).toEqual(expect.arrayContaining([
      "observation:folder-view",
      "field_eval:activity",
    ]));
    expect(route.procedure_evidence_retrieval_result?.selected_prior_refs).toEqual([]);
    expect(route.procedure_evidence_retrieval_result?.uncertainty).toEqual(expect.arrayContaining([
      expect.objectContaining({
        issue: "prior_evidence_missing",
      }),
    ]));
    expect(route.situation_evidence_selection.selected_field_evaluation_refs).toContain("field_eval:activity");
    expect(route.reasoning_snapshot?.full_reasoning_summary).toContain(
      "previous visual observation evidence is unavailable",
    );
    expect(route.procedure_memory_recall).toMatchObject({
      schema: "helix.procedure_memory_recall.v1",
      recall_type: "epoch_replay",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(route.typed_failure).toMatchObject({
      schema: "helix.typed_failure.v1",
      error_code: "procedure_epoch_previous_unavailable",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(route.answer_text).not.toContain("The attached image shows");
  });

  it.each([
    "okay what is it visual screen capture see now and how does it compare to last epochs",
    "Okay, what changed since last seen epoch?",
    "What changed since the previous visual?",
    "Compare current scene to last capture.",
    "What changed in the visual epoch?",
    "Okay, so what is the difference between the last scene in the scene I'm looking at now",
  ])("routes %s through procedure epoch replay", (promptText) => {
    seedVisualSituationRun();
    const sourceTarget = arbitrateAskSourceTarget({
      turnId: "ask:scene-delta-admission",
      threadId: "helix-ask:desktop",
      promptText,
    });
    const route = routeSituationContextTurn({
      threadId: "helix-ask:desktop",
      promptText,
      inputModality: "typed",
      turnId: "ask:scene-delta-admission",
    });

    expect(sourceTarget).toMatchObject({
      target_source: "procedure_memory",
      target_kind: "situation_epoch",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
    });
    expect(sourceTarget.requested_outputs).toEqual(
      expect.arrayContaining([
        "procedure_epoch_replay",
        "field_evaluation_refs",
        "interpretation_refs",
        "current_visual_state",
      ]),
    );
    expect(route.route).toBe("procedure_epoch_replay_question");
    expect(route.deictic_reference.reference_type).toBe("latest_epoch_change");
    expect(route.procedure_evidence_retrieval_plan).toMatchObject({
      schema: "helix.procedure_evidence_retrieval_plan.v1",
      task: "comparison",
      evidence_required: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(route.procedure_evidence_retrieval_plan?.requested_facets).toEqual(expect.arrayContaining([
      "scene",
      "activity",
      "objects",
      "field_evaluations",
      "interpretations",
      "uncertainty",
    ]));
    expect(route.procedure_evidence_retrieval_result).toMatchObject({
      schema: "helix.procedure_evidence_retrieval_result.v1",
      answerability: "partially_answerable",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(route.procedure_evidence_retrieval_result?.selected_current_refs).toEqual(expect.arrayContaining([
      "observation:folder-view",
      "field_eval:activity",
    ]));
    expect(route.procedure_evidence_retrieval_result?.selected_prior_refs).toEqual([]);
    expect(route.procedure_evidence_retrieval_result?.stable_facts.length).toBeGreaterThan(0);
    expect(route.procedure_evidence_retrieval_result?.uncertainty).toEqual(expect.arrayContaining([
      expect.objectContaining({
        issue: "prior_evidence_missing",
      }),
    ]));
    expect(route.procedure_memory_recall?.recall_type).toBe("epoch_replay");
    expect(route.situation_evidence_selection.selected_observation_refs.length).toBeGreaterThan(0);
    expect(route.situation_evidence_selection.selected_field_evaluation_refs).toContain("field_eval:activity");
    expect(route.reasoning_snapshot?.full_reasoning_summary).toContain("Current observation");
    expect(route.reasoning_snapshot?.full_reasoning_summary).toContain("Previous observation");
    expect(route.reasoning_snapshot?.full_reasoning_summary).toContain("previous visual observation evidence is unavailable");
    expect(route.answer_text).toContain("Current observation");
    expect(route.answer_text).toContain("Previous observation");
    expect(route.answer_text).toContain("Changed elements since previous epoch");
    expect(route.answer_text).toContain("Unchanged elements / stable");
    expect(route.answer_text).toContain("Uncertainty / unclear");
    expect(route.answer_text).not.toContain("The attached image shows");
    expect(route.typed_failure).toMatchObject({
      schema: "helix.typed_failure.v1",
      error_code: "procedure_epoch_previous_unavailable",
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("selects a prior visual scene by props and compares it with the current scene", () => {
    seedVisualSceneMemoryComparison();
    const route = routeSituationContextTurn({
      threadId: "helix-ask:desktop",
      promptText: "Compare what I'm looking at now to the last SOHO folder scene.",
      inputModality: "typed",
      turnId: "ask:scene-memory-compare",
    });

    expect(route.route).toBe("procedure_epoch_replay_question");
    expect(route.visual_scene_query_intent).toMatchObject({
      schema: "helix.visual_scene_query_intent.v1",
      compare_to_current: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(route.visual_scene_query_intent?.query_terms.map((term) => term.toLowerCase())).toContain("soho");
    expect(route.selected_visual_scene_set).toMatchObject({
      schema: "helix.selected_visual_scene_set.v1",
      selection_reason: "matched_scene_memory_terms",
      confidence: expect.any(Number),
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(route.selected_visual_scene_set?.evidence_refs.length).toBeGreaterThan(0);
    expect(route.selected_visual_scene_set?.missing_evidence).toEqual([]);
    expect(route.selected_visual_scene_set?.selected_scenes[0]?.scene_memory.visible_title).toBe("SOHO");
    expect(route.visual_scene_comparison_result).toMatchObject({
      schema: "helix.visual_scene_comparison_result.v1",
      role: "validation",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(route.visual_scene_comparison_result?.changed_app_or_window.join(" ")).toContain("SOHO");
    expect(route.visual_scene_comparison_result?.changed_user_focus.join(" ")).toContain("soho-index.png");
    expect(route.visual_scene_comparison_result?.next_check).toContain("Capture another visual epoch");
    expect(route.visual_scene_comparison_result?.summary).toContain("Compared current epoch");
    expect(route.visual_scene_comparison_result?.summary).toContain("SOHO");
    expect(route.answer_text).toContain("Current observation");
    expect(route.answer_text).toContain("Previous observation");
    expect(route.answer_text).not.toContain("The attached image shows");
  });

  it("retrieves the SUN folder scene semantically and compares it with current Task Manager", () => {
    seedSemanticVisualSceneMemoryExamples();
    const route = routeSituationContextTurn({
      threadId: "helix-ask:desktop",
      promptText: "Compare this to the SUN folder scene.",
      inputModality: "typed",
      turnId: "ask:scene-memory-sun",
    });

    expect(route.relative_session_semantic_intent).toMatchObject({
      schema: "helix.relative_session_semantic_intent.v1",
      local_label_terms: expect.arrayContaining(["SUN"]),
      target_domain: "visual_scene_memory",
      requires_binding: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(route.selected_session_semantic_binding).toMatchObject({
      schema: "helix.selected_session_semantic_binding.v1",
      selected_bindings: [
        expect.objectContaining({
          user_phrase: "SUN",
          bound_kind: "visual_scene",
          evidence_refs: expect.arrayContaining(["observation:sun-folder", "field_eval:scene:sun"]),
        }),
      ],
      ambiguity: "none",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(route.visual_scene_query_intent).toMatchObject({
      schema: "helix.visual_scene_query_intent.v1",
      semantic_binding_refs: expect.arrayContaining([
        route.selected_session_semantic_binding?.selected_bindings[0]?.bound_ref,
      ]),
      bound_query_terms: expect.arrayContaining(["sun"]),
      query_mode: "compare_prior_to_current",
      target_scene_kind: "folder",
      target_file_folder_terms: expect.arrayContaining(["sun"]),
      compare_to_current: true,
      requires_current_scene: true,
      strength: "hard",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(route.selected_visual_scene_set).toMatchObject({
      schema: "helix.selected_visual_scene_set.v1",
      candidate_pool_size: expect.any(Number),
      source_target_ref: "procedure_memory:situation_epoch",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(route.selected_visual_scene_set?.selected_scenes[0]?.scene_memory.visible_title).toBe("SUN");
    expect(route.selected_visual_scene_set?.rejected_candidates.length).toBeGreaterThan(0);
    expect(route.selected_visual_scene_set?.evidence_refs).toEqual(expect.arrayContaining([
      "observation:sun-folder",
      "field_eval:scene:sun",
      "observation:task-manager-current",
      "field_eval:scene:task-manager-current",
    ]));
    expect(route.visual_scene_comparison_result).toMatchObject({
      schema: "helix.visual_scene_comparison_result.v1",
      role: "validation",
      prior_scene_evidence_refs: expect.arrayContaining(["observation:sun-folder", "field_eval:scene:sun"]),
      current_scene_evidence_refs: expect.arrayContaining(["observation:task-manager-current", "field_eval:scene:task-manager-current"]),
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("returns selected scene set for find-only Camera Roll prompts", () => {
    seedSemanticVisualSceneMemoryExamples();
    const route = routeSituationContextTurn({
      threadId: "helix-ask:desktop",
      promptText: "Find the Camera Roll scene.",
      inputModality: "typed",
      turnId: "ask:scene-memory-camera-roll",
    });

    expect(route.relative_session_semantic_intent?.local_label_terms).toEqual(expect.arrayContaining(["Camera Roll"]));
    expect(route.selected_session_semantic_binding?.selected_bindings[0]).toMatchObject({
      user_phrase: "Camera Roll",
      bound_kind: "visual_scene",
      match_basis: "visible_label",
    });
    expect(route.visual_scene_query_intent).toMatchObject({
      query_mode: "find_prior_scene",
      compare_to_current: false,
      requires_current_scene: false,
      target_scene_kind: "media_roll",
    });
    expect(route.selected_visual_scene_set?.selected_scenes[0]?.scene_memory.visible_title).toBe("Camera Roll");
    expect(route.visual_scene_comparison_result).toBeNull();
    expect(route.typed_failure).toBeNull();
  });

  it("compares changes since the audio export folder", () => {
    seedSemanticVisualSceneMemoryExamples();
    const route = routeSituationContextTurn({
      threadId: "helix-ask:desktop",
      promptText: "What changed since the audio export folder?",
      inputModality: "typed",
      turnId: "ask:scene-memory-audio-export",
    });

    expect(route.selected_session_semantic_binding?.selected_bindings[0]).toMatchObject({
      user_phrase: "audio export",
      bound_kind: "visual_scene",
      match_basis: "visible_label",
    });
    expect(route.visual_scene_query_intent).toMatchObject({
      query_mode: "changed_since_prior",
      compare_to_current: true,
      target_file_folder_terms: expect.arrayContaining(["audio export"]),
    });
    expect(route.selected_visual_scene_set?.selected_scenes[0]?.scene_memory.visible_title).toBe("audio export");
    expect(route.visual_scene_comparison_result).toMatchObject({
      schema: "helix.visual_scene_comparison_result.v1",
      role: "validation",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(route.visual_scene_comparison_result?.changed_app_or_window.join(" ")).toMatch(/File Explorer|Task Manager/i);
  });

  it("compares current Task Manager to the last folder scene", () => {
    seedSemanticVisualSceneMemoryExamples();
    const route = routeSituationContextTurn({
      threadId: "helix-ask:desktop",
      promptText: "Compare the current Task Manager scene to the last folder scene.",
      inputModality: "typed",
      turnId: "ask:scene-memory-task-manager-last-folder",
    });

    expect(route.visual_scene_query_intent).toMatchObject({
      query_mode: "compare_current_app_to_prior_kind",
      target_app_terms: ["task manager"],
      target_scene_kind: "folder",
      relative_time: "last_folder_scene",
      compare_to_current: true,
      requires_current_scene: true,
    });
    expect(route.selected_visual_scene_set?.selection_policy).toBe("last_kind_match");
    expect(route.selected_visual_scene_set?.selected_scenes[0]?.scene_memory.visible_title).toBe("audio export");
    expect(route.visual_scene_comparison_result?.summary).toContain("Compared current epoch");
    expect(route.visual_scene_comparison_result?.changed_app_or_window.join(" ")).toMatch(/File Explorer|Task Manager/i);
  });

  it("returns a typed failure when no prior visual scene matches the requested props", () => {
    seedVisualSceneMemoryComparison();
    const route = routeSituationContextTurn({
      threadId: "helix-ask:desktop",
      promptText: "Compare what I'm looking at now to the last MOON folder scene.",
      inputModality: "typed",
      turnId: "ask:scene-memory-no-match",
    });

    expect(route.route).toBe("procedure_epoch_replay_question");
    expect(route.visual_scene_query_intent).toMatchObject({
      schema: "helix.visual_scene_query_intent.v1",
      compare_to_current: true,
    });
    expect(route.selected_visual_scene_set).toMatchObject({
      schema: "helix.selected_visual_scene_set.v1",
      selected_scenes: [],
      selection_reason: "no_scene_memory_match",
      missing_evidence: ["prior_scene_match_missing"],
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(route.visual_scene_comparison_result).toBeNull();
    expect(route.typed_failure).toMatchObject({
      schema: "helix.typed_failure.v1",
      error_code: "visual_scene_memory_no_match",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(route.answer_text).toContain("could not find a prior visual scene");
    expect(route.answer_text).toContain("Missing evidence: prior_scene_match_missing");
  });
});
