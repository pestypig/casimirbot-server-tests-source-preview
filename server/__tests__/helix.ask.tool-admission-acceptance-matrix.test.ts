import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { planRouter } from "../routes/agi.plan";
import {
  createLiveAnswerEnvironment,
  resetLiveAnswerEnvironments,
} from "../services/situation-room/live-answer-environment-store";
import {
  ensureLiveSituationRunForEnvironment,
  resetLiveSituationRunsForTest,
} from "../services/situation-room/live-situation-run-store";
import {
  appendObservationJournalEntry,
  resetObservationJournalForTest,
} from "../services/situation-room/observation-journal-store";
import {
  recordLiveFieldEvaluation,
  resetLiveFieldEvaluationsForTest,
} from "../services/situation-room/live-field-evaluation-store";
import { resetProcedureEpochClosuresForTest } from "../services/situation-room/procedure-epoch-closure";
import { resetProcedureEpochLedgerForTest } from "../services/situation-room/procedure-epoch-ledger-store";
import { resetVisualComparisonSessionsForTest } from "../services/situation-room/visual-comparison-session-store";
import { resetVoiceLiveHandoffsForTest } from "../services/situation-room/voice-live-handoff-router";
import { resetLiveFieldWorkersForTest } from "../services/situation-room/live-field-worker-registry";
import { resetLiveFieldWorkerRunsForTest } from "../services/situation-room/live-field-worker-run-store";
import { resetProcedureReasoningSnapshotsForTest } from "../services/situation-room/procedure-reasoning-snapshot-store";
import { resetConversationalAnswerDistillationsForTest } from "../services/helix-ask/conversational-answer-distillation-store";
import {
  recordVisualSceneMemoryIndex,
  resetVisualSceneMemoryForTest,
} from "../services/situation-room/visual-scene-memory-store";
import { resetLiveSourceChunkBufferForTest } from "../services/situation-room/live-source-chunk-buffer";
import { resetLiveSourcePipelinesForTest } from "../services/helix-ask/live-source-pipeline-executor";
import { resetLiveWorkerLanesForTest } from "../services/situation-room/live-worker-lane-store";
import { resetLivePipelineLifecycleForTest } from "../services/situation-room/live-pipeline-lifecycle-store";
import { resetSituationSourceCapabilitiesForTest } from "../services/situation-room/situation-source-capability-store";
import { resetVisualSnapshotStoreForTest } from "../services/situation-room/visual-snapshot-store";
import { resetLiveSourceProducerBindingsForTest } from "../services/situation-room/live-source-producer-binding";
import { resetLiveSourceProducerLifecycleForTest } from "../services/situation-room/live-source-producer-lifecycle-store";
import { resetVisualProducerSchedulerAdoptionsForTest } from "../services/situation-room/visual-producer-scheduler-adoption-store";
import { resetClientCapabilityActionsForTest } from "../services/client-capabilities/client-action-queue";
import { resetClientCapabilityAdoptionsForTest } from "../services/client-capabilities/client-adoption-store";
import { resetReceiptPresentationSnapshotsForTest } from "../services/helix-ask/receipt-presentation-snapshot-store";
import { guardProductAuthority } from "../services/helix-ask/product-authority-guard";
import { buildToolCallAdmissionDecision } from "../services/helix-ask/tool-call-admission";
import { buildRouteProductContract } from "../services/helix-ask/route-product-contract";
import { guardTerminalArtifactSelection } from "../services/helix-ask/terminal-artifact-selection-guard";
import { arbitrateAskSourceTarget } from "../services/helix-ask/ask-source-target-arbitrator";
import { auditToolAdmissionCoverage } from "../services/helix-ask/tool-admission-coverage-audit";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/agi", planRouter);
  return app;
};

const resetAll = () => {
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
  resetProcedureReasoningSnapshotsForTest();
  resetConversationalAnswerDistillationsForTest();
  resetVisualSceneMemoryForTest();
  resetLiveSourcePipelinesForTest();
  resetLiveWorkerLanesForTest();
  resetLivePipelineLifecycleForTest();
  resetSituationSourceCapabilitiesForTest();
  resetVisualSnapshotStoreForTest();
  resetLiveSourceProducerBindingsForTest();
  resetLiveSourceProducerLifecycleForTest();
  resetVisualProducerSchedulerAdoptionsForTest();
  resetClientCapabilityActionsForTest();
  resetClientCapabilityAdoptionsForTest();
  resetReceiptPresentationSnapshotsForTest();
};

const seedVisualSituationRun = () => {
  const now = "2026-05-18T12:00:10.000Z";
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
    text: "A Windows File Explorer folder labeled \"PAPERPLAY 2\" is visible with artwork files.",
    evidence_refs: ["live_source_analysis_job:test"],
    model_invoked: true,
    confidence: 0.82,
    created_at: now,
  });
  const sceneEval = recordLiveFieldEvaluation({
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
    evidence_refs: [observation.observation_id],
    missing_evidence: [],
    corroboration_state: { visual: "present" },
    next_check: "Watch for changed folder contents.",
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    created_at: now,
    role: "ui_projection",
    assistant_answer: false,
    raw_content_included: false,
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
    missing_evidence: [],
    corroboration_state: { visual: "present" },
    next_check: "Compare the next captured frame for file changes.",
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    created_at: now,
    role: "ui_projection",
    assistant_answer: false,
    raw_content_included: false,
  });
  return { environment, run, observation, sceneEval };
};

const seedVisualSceneMemoryComparison = () => {
  const { run, observation, sceneEval } = seedVisualSituationRun();
  const priorAt = "2026-05-18T12:00:00.000Z";
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
    observation,
    evaluations: [sceneEval],
    procedureEpoch: {
      schema: "helix.live_procedure_epoch.v1",
      epoch_id: "procedure_epoch:paperplay",
      situation_run_id: run.situation_run_id,
      thread_id: run.thread_id,
      environment_id: run.environment_id,
      source_binding_id: run.source_binding_id,
      epoch: run.current_epoch,
      observation_refs: [observation.observation_id],
      field_evaluation_refs: [sceneEval.evaluation_id],
      prediction_refs: [],
      probe_result_refs: [],
      assistant_answer: false,
      raw_content_included: false,
      role: "validation",
      created_at: "2026-05-18T12:00:10.000Z",
    },
  });
};

const expectCleanToolAdmissionCoverage = (body: Record<string, any>, sourceTarget: string): void => {
  expect(body?.tool_admission_coverage_audit).toMatchObject({
    schema: "helix.tool_admission_coverage_audit.v1",
    ok: true,
    source_target: sourceTarget,
    tool_admission_required: true,
    violations: [],
  });
};

describe("Helix Ask tool admission acceptance matrix", () => {
  beforeEach(resetAll);

  it("admits current visual prompts to the SituationRun product path", async () => {
    const app = createApp();
    seedVisualSituationRun();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "helix-ask:desktop",
        question: "What file am I looking at right now?",
        debug: true,
      })
      .expect(200);

    expect(response.body?.source_target_intent).toMatchObject({
      target_source: "visual_capture",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
    });
    expect(response.body?.tool_call_admission_decision).toMatchObject({
      schema: "helix.tool_call_admission_decision.v1",
      required: true,
      admitted_tool_families: ["situation_run"],
    });
    expect(response.body?.route_product_contract?.forbidden_terminal_artifact_kinds).toEqual(
      expect.arrayContaining([
        "active_doc_identity",
        "doc_summary",
        "doc_location_matches",
        "process_graph_overview",
        "no_tool_direct",
        "model_only_concept",
      ]),
    );
    expect(response.body?.terminal_artifact_kind).toBe("situation_context_pack");
    expect(response.body?.terminal_artifact_selection_guard?.allowed).toBe(true);
    expect(response.body?.product_authority_guard?.allowed).toBe(true);
    expect(response.body?.route_authority_audit).toMatchObject({
      schema: "helix.route_authority_audit.v1",
      source_target: "visual_capture",
      terminal_artifact_kind: "situation_context_pack",
      route_authority_ok: true,
      route_authority_violation_code: null,
    });
    expect(response.body?.loop_parity_trace).toMatchObject({
      schema: "helix.loop_parity_trace.v1",
      selected_route: response.body?.route_reason_code,
      admitted_tool_families: ["situation_run"],
      actual_tool_calls: [],
      unexpected_tool_calls: [],
      route_authority_ok: true,
      short_circuit_risk_flags: [],
    });
    expectCleanToolAdmissionCoverage(response.body, "visual_capture");
    expect(response.body?.terminal_answer_authority?.server_authoritative).toBe(true);
    expect(response.body?.poison_audit?.ok).toBe(true);
  }, 60000);

  it("admits live cadence commands to concise live-pipeline receipt presentation", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "thread:tool-admission-live",
        question: "Set the visual capture interval to 10 seconds.",
        debug: true,
      })
      .expect(200);

    expect(response.body?.source_target_intent?.target_source).toBe("live_pipeline");
    expect(response.body?.tool_call_admission_decision).toMatchObject({
      required: true,
      admitted_tool_families: ["live_pipeline"],
    });
    expect(response.body?.terminal_artifact_kind).toBe("live_pipeline_receipt");
    expect(response.body?.answer).toMatch(/every 10 seconds|10 seconds/i);
    expect(response.body?.answer).not.toContain("Producer freshness:");
    expect(response.body?.receipt_presentation_snapshot?.full_summary).toContain("Producer freshness:");
    expect(response.body?.product_authority_guard?.allowed).toBe(true);
    expect(response.body?.route_authority_audit).toMatchObject({
      schema: "helix.route_authority_audit.v1",
      source_target: "live_pipeline",
      terminal_artifact_kind: "live_pipeline_receipt",
      route_authority_ok: true,
      route_authority_violation_code: null,
    });
    expect(response.body?.loop_parity_trace).toMatchObject({
      schema: "helix.loop_parity_trace.v1",
      selected_route: "live_pipeline_control",
      admitted_tool_families: ["live_pipeline"],
      unexpected_tool_calls: [],
      route_authority_ok: true,
    });
    expect(response.body?.loop_parity_trace?.actual_tool_calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool_id: "situation-room.live-source.set_rate",
          family: "live_pipeline",
          admitted: true,
          mutating: true,
        }),
      ]),
    );
    expectCleanToolAdmissionCoverage(response.body, "live_pipeline");
  }, 30000);

  it("admits structured docs locate prompts to doc_location_result and suppresses visual deictic routing", async () => {
    const app = createApp();
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
        sessionId: "helix-ask:desktop",
        question,
        debug: true,
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

    expect(response.body?.source_target_intent?.target_source).toBe("docs_viewer");
    expect(response.body?.tool_call_admission_decision).toMatchObject({
      required: true,
      admitted_tool_families: ["docs_viewer"],
    });
    expect(response.body?.deictic_reference ?? null).toBeNull();
    expect(response.body?.terminal_artifact_kind).toBe("doc_location_result");
    expect(response.body?.route_product_contract?.forbidden_terminal_artifact_kinds).toContain("situation_context_pack");
    expect(response.body?.terminal_artifact_selection_guard?.allowed).toBe(true);
    expect(response.body?.product_authority_guard?.allowed).toBe(true);
    expectCleanToolAdmissionCoverage(response.body, "docs_viewer");
    expect(String(response.body?.answer ?? "")).toContain("Locations:");
    expect(String(response.body?.answer ?? "")).not.toContain("File Explorer");
  }, 60000);

  it("admits repo-code implementation questions away from model-only and no-tool-direct", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: `tool-admission-repo-${Date.now()}`,
        question: "Starting from the top of the agentic turn-based system, can the agent make the right tool calls?",
        debug: true,
      })
      .expect(200);

    expect(response.body?.source_target_intent?.target_source).toBe("repo_code");
    expect(response.body?.tool_call_admission_decision).toMatchObject({
      required: true,
      admitted_tool_families: ["repo_code"],
    });
    expect(response.body?.tool_call_admission_decision?.forbidden_routes).toEqual(
      expect.arrayContaining(["model_only_concept"]),
    );
    expect(response.body?.route_product_contract?.forbidden_terminal_artifact_kinds).toEqual(
      expect.arrayContaining(["no_tool_direct", "model_only_concept", "process_graph_overview"]),
    );
    expectCleanToolAdmissionCoverage(response.body, "repo_code");
    expect(response.body?.final_answer_source).not.toBe("no_tool_direct");
  }, 90000);

  it("admits procedure-memory scene deltas through epoch replay and forbids process graph overview", async () => {
    const app = createApp();
    seedVisualSituationRun();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "helix-ask:desktop",
        question: "What changed between the last scene and what I'm looking at now?",
        debug: true,
      })
      .expect(200);

    expect(response.body?.source_target_intent).toMatchObject({
      target_source: "procedure_memory",
      target_kind: "situation_epoch",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
    });
    expect(response.body?.tool_call_admission_decision).toMatchObject({
      required: true,
      admitted_tool_families: expect.arrayContaining(["procedure_memory", "situation_run"]),
    });
    expect(response.body?.deictic_reference?.reference_type).toBe("latest_epoch_change");
    expect(response.body?.terminal_artifact_kind).toBe("typed_failure");
    expect(response.body?.typed_failure?.error_code).toBe("procedure_epoch_previous_unavailable");
    expect(response.body?.tool_call_admission_decision?.forbidden_terminal_artifact_kinds).toContain("process_graph_overview");
    expect(response.body?.tool_call_admission_decision?.forbidden_terminal_artifact_kinds).toContain("no_tool_direct");
    expect(response.body?.tool_call_admission_decision?.forbidden_terminal_artifact_kinds).toContain("model_only_concept");
    expect(response.body?.tool_call_admission_decision?.forbidden_terminal_artifact_kinds).toContain("live_environment_binding_diagnosis");
    expect(response.body?.product_authority_guard?.allowed).toBe(true);
    expectCleanToolAdmissionCoverage(response.body, "procedure_memory");
  }, 60000);

  it.each([
    "Compare this to the SUN folder scene.",
    "Find the Camera Roll scene.",
    "What changed since the audio export folder?",
    "Compare the current Task Manager scene to the last folder scene.",
  ])("admits semantic visual scene-memory prompt %s", async (question) => {
    const app = createApp();
    seedVisualSituationRun();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "helix-ask:desktop",
        question,
        debug: true,
      })
      .expect(200);

    expect(response.body?.source_target_intent).toMatchObject({
      target_source: "procedure_memory",
      strength: "hard",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
    });
    expect(["visual_scene_memory", "situation_epoch"]).toContain(response.body?.source_target_intent?.target_kind);
    expect(response.body?.source_target_intent?.requested_outputs).toEqual(expect.arrayContaining([
      "procedure_epoch_replay",
      "field_evaluation_refs",
      "interpretation_refs",
      "current_visual_state",
      "visual_scene_query_intent",
      "selected_visual_scene_set",
      "visual_scene_comparison_result",
      "typed_failure",
    ]));
    expect(response.body?.tool_call_admission_decision?.required).toBe(true);
    expect(response.body?.tool_call_admission_decision?.admitted_tool_families).toEqual(
      expect.arrayContaining(["procedure_memory", "situation_run"]),
    );
    expect(response.body?.route_product_contract?.forbidden_terminal_artifact_kinds).toEqual(
      expect.arrayContaining([
        "process_graph_overview",
        "no_tool_direct",
        "model_only_concept",
        "doc_location_result",
      ]),
    );
    expect(response.body?.final_answer_source).not.toBe("no_tool_direct");
    expect(response.body?.terminal_artifact_kind).not.toBe("process_graph_overview");
    expect(response.body?.terminal_answer_authority?.server_authoritative).toBe(true);
  }, 60000);

  it("keeps scene-epoch comparison prompts on procedure replay instead of binding diagnosis", async () => {
    const app = createApp();
    seedVisualSituationRun();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "helix-ask:desktop",
        question: "Okay, what are we looking at now and how does it compare to the last scene epoch?",
        debug: true,
      })
      .expect(200);

    expect(response.body?.source_target_intent).toMatchObject({
      target_source: "procedure_memory",
      target_kind: "situation_epoch",
    });
    expect(response.body?.route_reason_code).toBe("procedure_epoch_replay_question");
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("procedure_epoch_replay_question");
    expect(response.body?.terminal_artifact_kind).toBe("typed_failure");
    expect(response.body?.typed_failure?.error_code).toBe("procedure_epoch_previous_unavailable");
    expect(response.body?.final_answer_source).not.toBe("live_environment_binding_diagnosis");
    expect(response.body?.tool_call_admission_decision?.forbidden_terminal_artifact_kinds).toContain("live_environment_binding_diagnosis");
    expectCleanToolAdmissionCoverage(response.body, "procedure_memory");
  }, 60000);

  it("keeps scene-epoch prompts from terminating as process graph overview", async () => {
    const app = createApp();
    seedVisualSituationRun();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "helix-ask:desktop",
        question: "What changed since the last scene epoch?",
        debug: true,
      })
      .expect(200);

    expect(["procedure_memory", "situation_epoch"]).toContain(response.body?.source_target_intent?.target_source);
    expect(response.body?.source_target_intent).toMatchObject({
      target_kind: "situation_epoch",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
    });
    expect(response.body?.tool_call_admission_decision).toMatchObject({
      required: true,
      admitted_tool_families: expect.arrayContaining(["procedure_memory"]),
    });
    expect(response.body?.tool_call_admission_decision?.forbidden_terminal_artifact_kinds).toEqual(
      expect.arrayContaining(["process_graph_overview", "no_tool_direct", "model_only_concept"]),
    );
    expect(["procedure_epoch_replay", "visual_scene_comparison_result", "situation_context_pack_with_epoch_evidence", "typed_failure"]).toContain(
      response.body?.terminal_artifact_kind,
    );
    expect(response.body?.final_answer_source).not.toBe("process_graph_overview");
    expect(response.body?.final_answer_source).not.toBe("live_environment_binding_diagnosis");
    expect(response.body?.final_answer_source).not.toBe("no_tool_direct");
  }, 60000);

  it("admits explicit process graph prompts only to workstation process products", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "helix-ask:desktop",
        question: "What changed in the process graph?",
        debug: true,
      })
      .expect(200);

    expect(response.body?.source_target_intent).toMatchObject({
      target_source: "process_graph",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
    });
    expect(response.body?.tool_call_admission_decision?.admitted_tool_families).toContain("process_graph");
    expect(response.body?.terminal_artifact_kind).toBe("process_graph_overview");
    expect(response.body?.route_product_contract?.forbidden_terminal_artifact_kinds).toEqual(
      expect.arrayContaining(["procedure_epoch_replay", "visual_scene_comparison_result", "repo_code_evidence_answer", "doc_location_result", "no_tool_direct", "model_only_concept"]),
    );
  }, 60000);

  it.each([
    "What changed since the previous visual?",
    "Compare current scene to last capture.",
    "Show the evidence for why you said that.",
    "Replay that procedure memory.",
  ])("does not let process graph steal non-workstation prompt %s", async (question) => {
    const app = createApp();
    seedVisualSituationRun();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "helix-ask:desktop",
        question,
        debug: true,
      })
      .expect(200);

    expect(response.body?.source_target_intent?.target_source).not.toBe("process_graph");
    expect(response.body?.terminal_artifact_kind).not.toBe("process_graph_overview");
    expect(response.body?.final_answer_source).not.toBe("process_graph_overview");
  }, 60000);

  it("answers generic previous/current scene replay with procedure epoch replay when two observations exist", async () => {
    const app = createApp();
    seedVisualSceneMemoryComparison();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "helix-ask:desktop",
        question: "What changed since last seen epoch?",
        debug: true,
      })
      .expect(200);

    expect(response.body?.source_target_intent).toMatchObject({
      target_source: "procedure_memory",
      target_kind: "situation_epoch",
      strength: "hard",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
    });
    expect(response.body?.route_reason_code).toBe("procedure_epoch_replay_question");
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("procedure_epoch_replay_question");
    expect(response.body?.terminal_artifact_kind).toBe("procedure_epoch_replay");
    expect(response.body?.final_answer_source).toBe("procedure_epoch_replay");
    expect(response.body?.procedure_epoch_replay).toMatchObject({
      schema: "helix.procedure_epoch_replay.v1",
    });
    expect(String(response.body?.answer)).toMatch(
      /Current observation[\s\S]+Previous observation[\s\S]+Changed elements[\s\S]+Unchanged elements[\s\S]+Uncertainty[\s\S]+Evidence refs[\s\S]+Terminal authority/,
    );
    expect(response.body?.route_product_contract?.forbidden_terminal_artifact_kinds).toContain("visual_scene_comparison_result");
    expect(response.body?.terminal_answer_authority?.server_authoritative).toBe(true);
  }, 60000);

  it("wraps semantic scene-memory comparisons as evidence under procedure replay authority", async () => {
    const app = createApp();
    seedVisualSceneMemoryComparison();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "helix-ask:desktop",
        question: "Compare what I'm looking at now to the last SOHO folder scene.",
        debug: true,
      })
      .expect(200);

    expect(response.body?.visual_scene_query_intent?.schema).toBe("helix.visual_scene_query_intent.v1");
    expect(response.body?.selected_visual_scene_set).toMatchObject({
      schema: "helix.selected_visual_scene_set.v1",
      selection_reason: "matched_scene_memory_terms",
    });
    expect(response.body?.selected_visual_scene_set?.selected_scenes[0]?.scene_memory?.visible_title).toBe("SOHO");
    expect(response.body?.visual_scene_comparison_result?.schema).toBe("helix.visual_scene_comparison_result.v1");
    expect(["procedure_epoch_replay", "visual_scene_comparison_result", "typed_failure"]).toContain(response.body?.terminal_artifact_kind);
    expect(response.body?.terminal_artifact_kind).not.toBe("process_graph_overview");
    expect(response.body?.route_product_contract?.allowed_terminal_artifact_kinds).toEqual(
      expect.arrayContaining(["visual_scene_comparison_result", "selected_visual_scene_set"]),
    );
    expect(response.body?.terminal_artifact_selection_guard?.allowed).toBe(true);
    expect(response.body?.product_authority_guard?.allowed).toBe(true);
    expectCleanToolAdmissionCoverage(response.body, "procedure_memory");
  }, 60000);

  it("rejects terminal products forbidden by tool admission", () => {
    const prompt = "Starting from the top of the agentic turn-based system, can the agent make the right tool calls?";
    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId: "ask:guard-unit",
      threadId: "thread:guard-unit",
      promptText: prompt,
    });
    const routeProductContract = buildRouteProductContract({
      turnId: "ask:guard-unit",
      threadId: "thread:guard-unit",
      sourceTargetIntent,
      promptText: prompt,
    });
    const toolCallAdmissionDecision = buildToolCallAdmissionDecision({
      turnId: "ask:guard-unit",
      sourceTargetIntent,
      routeProductContract,
      promptText: prompt,
    });
    const terminalArtifactSelectionGuard = guardTerminalArtifactSelection({
      contract: routeProductContract,
      terminalArtifactKind: "situation_context_pack",
    });
    const productAuthorityGuard = guardProductAuthority({
      sourceTargetIntent,
      toolCallAdmissionDecision,
      routeProductContract,
      terminalArtifactSelectionGuard,
      terminalArtifactKind: "situation_context_pack",
    });

    expect(terminalArtifactSelectionGuard.allowed).toBe(false);
    expect(productAuthorityGuard).toMatchObject({
      schema: "helix.product_authority_guard.v1",
      allowed: false,
      rejected_terminal_candidate: expect.objectContaining({
        terminal_artifact_kind: "situation_context_pack",
      }),
    });
  });

  it("fails closed instead of throwing when a projected terminal policy omits runtime arrays", () => {
    const prompt = "Prepare the bounded scientific evidence plan.";
    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId: "ask:terminal-policy-projection",
      threadId: "thread:terminal-policy-projection",
      promptText: prompt,
    });
    const routeProductContract = buildRouteProductContract({
      turnId: "ask:terminal-policy-projection",
      threadId: "thread:terminal-policy-projection",
      sourceTargetIntent,
      promptText: prompt,
    });

    expect(() =>
      guardTerminalArtifactSelection({
        contract: {
          ...routeProductContract,
          forbidden_terminal_artifact_kinds: undefined,
        } as unknown as typeof routeProductContract,
        terminalArtifactKind: "typed_failure",
      }),
    ).not.toThrow();

    expect(
      guardTerminalArtifactSelection({
        contract: {
          ...routeProductContract,
          allowed_terminal_artifact_kinds: undefined,
          forbidden_terminal_artifact_kinds: undefined,
        } as unknown as typeof routeProductContract,
        terminalArtifactKind: "typed_failure",
      }),
    ).toMatchObject({
      allowed: false,
      reason: "terminal_artifact_policy_missing",
    });
  });

  it("uses a docs route-product contract to admit docs tools when source target arbitration is unknown", () => {
    const prompt = "summarize docs about paper ingestion contracts in 4 bullets include paths";
    const routeProductContract = buildRouteProductContract({
      turnId: "ask:docs-topic-admission",
      threadId: "thread:docs-topic-admission",
      sourceTargetIntent: {
        schema: "helix.ask_source_target_intent.v1",
        target_source: "unknown",
      },
      promptText: prompt,
    });
    const toolCallAdmissionDecision = buildToolCallAdmissionDecision({
      turnId: "ask:docs-topic-admission",
      sourceTargetIntent: {
        schema: "helix.ask_source_target_intent.v1",
        target_source: "unknown",
      },
      routeProductContract,
      promptText: prompt,
    });

    expect(routeProductContract.source_target).toBe("docs_viewer");
    expect(toolCallAdmissionDecision.source_target).toBe("docs_viewer");
    expect(toolCallAdmissionDecision.required).toBe(true);
    expect(toolCallAdmissionDecision.admitted_tool_families).toContain("docs_viewer");
    expect(toolCallAdmissionDecision.admitted_tool_families).not.toContain("model_only");
  });

  it("flags retrieval-required turns that did not resolve a source target", () => {
    const audit = auditToolAdmissionCoverage({
      payload: {
        ask_turn_preflight_context: {
          retrieval_required_signal: {
            required: true,
          },
        },
        source_target_intent: {
          schema: "helix.ask_source_target_intent.v1",
          target_source: "unknown",
        },
        terminal_answer_authority: {
          schema: "helix.turn_terminal_authority.v1",
          server_authoritative: true,
          terminal_artifact_kind: "situation_context_pack",
        },
      },
    });

    expect(audit).toMatchObject({
      schema: "helix.tool_admission_coverage_audit.v1",
      ok: false,
      retrieval_required: true,
      source_target: "unknown",
    });
    expect(audit.violations).toEqual(expect.arrayContaining(["missing_tool_admission_decision", "retrieval_required_has_source_target"]));
  });

  it("treats unknown-source discovery as an articulated retrieval state", () => {
    const routeProductContract = buildRouteProductContract({
      turnId: "ask:unknown-source-discovery-audit",
      threadId: "thread:unknown-source-discovery-audit",
      sourceTargetIntent: {
        schema: "helix.ask_source_target_intent.v1",
        target_source: "unknown",
      },
      promptText: "find NHM2 theory white paper",
    });
    const toolCallAdmissionDecision = buildToolCallAdmissionDecision({
      turnId: "ask:unknown-source-discovery-audit",
      sourceTargetIntent: {
        schema: "helix.ask_source_target_intent.v1",
        target_source: "unknown",
      },
      routeProductContract,
      promptText: "find NHM2 theory white paper",
    });
    const audit = auditToolAdmissionCoverage({
      payload: {
        ask_turn_preflight_context: {
          retrieval_required_signal: {
            required: true,
          },
        },
        source_target_intent: {
          schema: "helix.ask_source_target_intent.v1",
          target_source: "unknown",
        },
        route_product_contract: routeProductContract,
        tool_call_admission_decision: toolCallAdmissionDecision,
        product_authority_guard: {
          schema: "helix.product_authority_guard.v1",
          allowed: true,
          reason: "test",
        },
        terminal_presentation: {
          schema: "helix.terminal_presentation.v1",
          terminal_artifact_kind: "tool_evaluation",
        },
        terminal_answer_authority: {
          schema: "helix.turn_terminal_authority.v1",
          server_authoritative: true,
          terminal_artifact_kind: "tool_evaluation",
        },
      },
    });

    expect(routeProductContract.source_target).toBe("unknown");
    expect(routeProductContract.precedence_reason).toBe("unknown_source_discovery_allows_bounded_readonly_evidence_products");
    expect(routeProductContract.allowed_terminal_artifact_kinds).toEqual(
      expect.arrayContaining(["doc_location_result", "repo_code_evidence_answer", "tool_evaluation", "model_synthesized_answer"]),
    );
    expect(routeProductContract.forbidden_terminal_artifact_kinds).toEqual(
      expect.arrayContaining(["scholarly_research_answer", "internet_search_answer", "no_tool_direct", "model_only_concept"]),
    );
    expect(toolCallAdmissionDecision.source_target).toBe("unknown");
    expect(toolCallAdmissionDecision.admission_mode).toBe("unknown_source_discovery");
    expect(audit).toMatchObject({
      schema: "helix.tool_admission_coverage_audit.v1",
      ok: true,
      retrieval_required: true,
      source_target: "unknown",
      violations: [],
    });
    expect(audit.checks.find((check) => check.check === "retrieval_required_has_source_target")).toMatchObject({
      passed: true,
      evidence: "unknown_source_discovery",
    });
  });
});
