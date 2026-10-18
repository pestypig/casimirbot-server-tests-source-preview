import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RETIRED_WORKSPACE_ACTION_REGISTRY,
  RETIRED_WORKSTATION_DYNAMIC_TOOL_ACTIONS,
  WORKSTATION_DYNAMIC_TOOL_ACTIONS,
  WORKSPACE_ACTION_REGISTRY,
} from "@shared/workstation-dynamic-tools";
import {
  resetAccountSessionStore,
  signInLocalAccountSession,
} from "../services/helix-account/account-session-store";
import { composeLiveSourcePipelinePlan } from "../services/helix-ask/live-source-pipeline-composer";
import {
  executeLiveSourcePipelinePlan,
  resetLiveSourcePipelinesForTest,
} from "../services/helix-ask/live-source-pipeline-executor";
import { resetLiveSourceChunkBufferForTest } from "../services/situation-room/live-source-chunk-buffer";
import { resetLiveAnswerEnvironments } from "../services/situation-room/live-answer-environment-store";
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
import { classifyLiveSourceContinuationIntent } from "../services/helix-ask/live-source-continuation-intent";
import { buildLiveEnvironmentBindingDiagnosis } from "../services/helix-ask/live-environment-binding-diagnosis";
import { buildRouteProductContract } from "../services/helix-ask/route-product-contract";
import { guardTerminalArtifactSelection } from "../services/helix-ask/terminal-artifact-selection-guard";
import { auditRouteAuthority } from "../services/helix-ask/route-authority-audit";
import { resetHelixAskTurnAdmissionForTests } from "../services/helix-ask/ask-turn-admission";
import { resetRuntimeMemoryGovernorForTests } from "../services/runtime/runtime-memory-governor";
import {
  createLiveAnswerEnvironment,
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
import {
  recordLiveInterpretationHypothesis,
  resetLiveInterpretationHypothesesForTest,
} from "../services/situation-room/live-interpretation-hypothesis-store";
import type { HelixLiveSourceProducerFreshness } from "@shared/helix-live-source-producer-freshness";

// Route fixtures must not scan or append to the operator's durable history.
// Keep the real persistent ledger enabled, but give this worker its own files.
const ledgerEnvironment = vi.hoisted(() => {
  const previous = process.env.HELIX_THREAD_LEDGER_PATH;
  process.env.HELIX_THREAD_LEDGER_PATH =
    `artifacts/nav1o-routing-test-ledgers/${process.pid}-${Date.now()}/ledger.jsonl`;
  return { previous };
});

afterAll(() => {
  if (ledgerEnvironment.previous === undefined) delete process.env.HELIX_THREAD_LEDGER_PATH;
  else process.env.HELIX_THREAD_LEDGER_PATH = ledgerEnvironment.previous;
});

const threadId = "thread:live-source-continuation";
let developerSessionCookie = "";

const createApp = async (): Promise<express.Express> => {
  const { planRouter } = await import("../routes/agi.plan");
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use((req, _res, next) => {
    req.headers.cookie = developerSessionCookie;
    next();
  });
  app.use("/api/agi", planRouter);
  return app;
};

const freshProducer = (overrides: Partial<HelixLiveSourceProducerFreshness> = {}): HelixLiveSourceProducerFreshness => ({
  schema: "helix.live_source_producer_freshness.v1",
  producer_id: "live_source_producer:diagnosis-unit",
  source_id: "visual_source:diagnosis-unit",
  thread_id: "helix-ask:desktop",
  readiness_state: "ready",
  cadence_ms: 10_000,
  last_capture_at: new Date().toISOString(),
  last_chunk_id: "live_source_chunk:diagnosis-unit",
  last_analysis_job_id: "live_source_analysis_job:diagnosis-unit",
  last_visual_evidence_id: "visual_evidence:diagnosis-unit",
  last_card_delta_at: "2026-05-19T00:00:01.000Z",
  client_action_request_id: "client_action:diagnosis-unit",
  client_action_status: "completed",
  client_adoption_id: "client_adoption:diagnosis-unit",
  client_adoption_ok: true,
  client_adoption_status: "adopted",
  client_observed_state: {
    client_stream_confirmed: true,
    interval_active: true,
    cadence_ms: 10_000,
  },
  is_fresh: true,
  stale_reason: null,
  next_required_action: null,
  assistant_answer: false,
  raw_content_included: false,
  ...overrides,
});

const seedSituationRun = (input: {
  sourceId?: string;
  threadId?: string;
  withObservation?: boolean;
  withFieldEvaluation?: boolean;
  withInterpretation?: boolean;
} = {}) => {
  const now = new Date().toISOString();
  const sourceId = input.sourceId ?? "visual_source:diagnosis-unit";
  const situationThreadId = input.threadId ?? "helix-ask:desktop";
  const { environment } = createLiveAnswerEnvironment({
    thread_id: situationThreadId,
    created_turn_id: "ask:diagnosis-seed",
    objective: "Use visual SituationRun evidence for live diagnosis tests.",
    preset: "custom",
    source_ids: [sourceId],
    now,
  });
  const run = ensureLiveSituationRunForEnvironment({
    environment,
    advanceEpoch: false,
    now,
  });
  const observation = input.withObservation === false
    ? null
    : appendObservationJournalEntry({
        thread_id: situationThreadId,
        observation_id: "observation:diagnosis-unit",
        kind: "model_perception_observation",
        modality: "visual_frame",
        source_id: sourceId,
        text: "A live visual frame is available for diagnosis.",
        evidence_refs: ["visual_evidence:diagnosis-unit"],
        model_invoked: true,
        confidence: 0.8,
        created_at: now,
      });
  if (input.withFieldEvaluation && observation) {
    recordLiveFieldEvaluation({
      schema: "helix.live_field_evaluation.v1",
      evaluation_id: "field_eval:diagnosis-unit",
      worker_run_id: "field_worker_run:diagnosis-unit",
      worker_id: "field_worker:diagnosis-unit",
      situation_run_id: run.situation_run_id,
      thread_id: run.thread_id,
      environment_id: run.environment_id,
      field_key: "scene",
      value: "The current visual scene has a supported field evaluation.",
      status: "supported",
      confidence: 0.75,
      evidence_refs: [observation.observation_id],
      missing_evidence: [],
      corroboration_state: { visual: "present" },
      next_check: null,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      created_at: now,
      role: "ui_projection",
      assistant_answer: false,
      raw_content_included: false,
    });
  }
  if (input.withInterpretation) {
    recordLiveInterpretationHypothesis({
      schema: "helix.live_interpretation_hypothesis.v1",
      hypothesis_id: "live_interpretation_hypothesis:diagnosis-unit",
      interpretation_worker_run_id: "live_interpretation_worker_run:diagnosis-unit",
      interpretation_run_id: "live_interpretation_run:diagnosis-unit",
      situation_run_id: run.situation_run_id,
      source_epoch: run.current_epoch,
      latest_source_epoch: run.current_epoch,
      lens: "scene_neutral",
      kind: "activity",
      claim: "The live procedure state has an active interpretation.",
      normalized_key: "diagnosis-unit",
      confidence: 0.7,
      evidence_refs: ["field_eval:diagnosis-unit"],
      missing_evidence: [],
      uncertainty: [],
      status: "active",
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      assistant_answer: false,
      raw_content_included: false,
      role: "validation",
    });
  }
  return { environment, run, observation };
};

const seedBackendVisualSource = async (app: express.Express, targetThreadId = threadId) => {
  await request(app)
    .post("/api/agi/situation/test-harness/live-visual-source")
    .send({
      thread_id: targetThreadId,
      source_id: "visual_source:diagnosis-unit",
      scene_text: "A backend-seeded visual capture shows a workstation screen available for route tests.",
      activity: "Reviewing the current screen without changing live capture controls.",
      objects: "Workstation window, visible screen content, route-test controls",
      confidence: 0.82,
    })
    .expect(200);
};

describe("live source continuation Ask routing", () => {
  // Opt-in diagnostics: flush the worker profile before Vitest terminates it.
  // Profile only test execution, excluding the cold import and fixture reset.
  let workerProfiler: import("node:inspector/promises").Session | null = null;
  afterEach(async () => {
    const profiler = workerProfiler;
    workerProfiler = null;
    if (!profiler) return;
    try {
      const { profile } = await profiler.post("Profiler.stop");
      const { mkdir, writeFile } = await import("node:fs/promises");
      const directory = "artifacts/nav1o-routing-worker-profiles";
      await mkdir(directory, { recursive: true });
      const output = `${directory}/worker-${process.pid}-${Date.now()}.cpuprofile`;
      await writeFile(output, JSON.stringify(profile), { flag: "wx" });
      console.info(`[routing-profile] ${output}`);
    } finally {
      profiler.disconnect();
    }
  });
  // The retired route is intentionally large and can take longer than an
  // individual behavior budget to cold-load on constrained acceptance hosts.
  // Pay that one-time module cost in suite setup so route assertions continue
  // to measure request behavior rather than TypeScript transform latency.
  beforeAll(async () => {
    await import("../routes/agi.plan");
  }, 120_000);

  beforeEach(async () => {
    await resetAccountSessionStore();
    const accountReceipt = await signInLocalAccountSession({
      profile_id: "profile:live-source-continuation-test",
      account_type: "developer",
    });
    developerSessionCookie = `helix_session=${encodeURIComponent(
      accountReceipt.session?.session_id ?? "",
    )}`;
    resetLiveSourcePipelinesForTest();
    resetLiveSourceChunkBufferForTest();
    resetLiveAnswerEnvironments();
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
    resetLiveSituationRunsForTest();
    resetObservationJournalForTest();
    resetLiveFieldEvaluationsForTest();
    resetLiveInterpretationHypothesesForTest();
    resetHelixAskTurnAdmissionForTests();
    resetRuntimeMemoryGovernorForTests({
      memoryReader: () => ({
        rss: 300 * 1024 * 1024,
        heapTotal: 180 * 1024 * 1024,
        heapUsed: 120 * 1024 * 1024,
        external: 8 * 1024 * 1024,
        arrayBuffers: 4 * 1024 * 1024,
      }),
      hostMemoryReader: () => ({
        freeMiB: 4096,
        totalMiB: 8192,
        freeRatio: 0.5,
      }),
    });
  });

  beforeEach(async () => {
    if (process.env.HELIX_ROUTING_WORKER_PROFILE !== "1") return;
    const { Session } = await import("node:inspector/promises");
    workerProfiler = new Session();
    workerProfiler.connect();
    await workerProfiler.post("Profiler.enable");
    await workerProfiler.post("Profiler.start");
  });

  it("routes keep-checking-screen prompts to live pipeline setup instead of model-only", async () => {
    const app = await createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: threadId,
        question: "ok can you keep checking my screen as a live answer?",
        debug: true,
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("live_source_continuation");
    expect(response.body?.route_reason_code).not.toBe("conversation:simple");
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("live_source_continuation");
    expect(response.body?.canonical_goal_frame?.allows_workspace_context).toBe(true);
    expect(response.body?.canonical_goal_frame?.allows_prior_artifacts).toBe(true);
    expect(response.body?.canonical_goal_frame?.required_terminal_kind).toBe("live_pipeline_receipt");
    expect(response.body?.final_answer_source).toBe("live_pipeline_receipt");
    expect(response.body?.pipeline_plan_id).toMatch(/^live_source_pipeline_plan:/);
    expect(response.body?.pipeline_receipt_id).toMatch(/^live_source_pipeline_receipt:/);
    expect(response.body?.visual_producer_id).toMatch(/^live_source_producer:/);
    expect(response.body?.action_envelope?.workstation_actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ panel_id: "situation-room", action_id: "pipeline.compose" }),
      expect.objectContaining({ panel_id: "situation-room", action_id: "pipeline.execute" }),
    ]));
    expect(response.body?.action_envelope?.governance?.dispatch).toBe("suppress");
    expect(response.body?.tool_trace_disclosure?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: "situation-room.pipeline.compose", authority: "evidence_only" }),
      expect.objectContaining({ tool: "situation-room.pipeline.execute", authority: "mutation_receipt" }),
    ]));
    expect(response.body?.tool_trace_disclosure?.assistant_answer).toBe(false);
    expect(response.body?.tool_trace_disclosure?.terminal_eligible).toBe(false);
    expect(response.body?.live_pipeline_turn_receipt?.assistant_answer).toBe(false);
    expect(response.body?.cadence_ms).toBe(15_000);
    expect(response.body?.producer_binding_status).toBe("bound");
    expect(response.body?.live_runtime_context?.suggested_action).toBeTruthy();
    expect(response.body?.terminal_answer_authority?.server_authoritative).toBe(true);
    expect(response.body?.poison_audit?.ok).toBe(true);

    const debug = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(response.body.turn_id)}/debug-export`)
      .expect(200);
    expect(debug.body?.payload?.canonical_goal_frame?.goal_kind).toBe("live_source_continuation");
    expect(debug.body?.payload?.live_runtime_context?.suggested_action).toBeTruthy();
    expect(debug.body?.payload?.pipeline_plan_id).toBe(response.body?.pipeline_plan_id);
    expect(debug.body?.payload?.pipeline_receipt_id).toBe(response.body?.pipeline_receipt_id);
    expect(debug.body?.payload?.action_envelope?.workstation_actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ panel_id: "situation-room", action_id: "pipeline.compose" }),
      expect.objectContaining({ panel_id: "situation-room", action_id: "pipeline.execute" }),
    ]));
    expect(debug.body?.payload?.tool_trace_disclosure?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: "situation-room.pipeline.compose" }),
      expect.objectContaining({ tool: "situation-room.pipeline.execute" }),
    ]));
    expect(debug.body?.payload?.tool_trace_disclosure?.assistant_answer).toBe(false);
    expect(debug.body?.payload?.tool_trace_disclosure?.terminal_eligible).toBe(false);
    expect(debug.body?.payload?.visual_producer_id).toBe(response.body?.visual_producer_id);
    expect(debug.body?.payload?.cadence_ms).toBe(15_000);
    expect(debug.body?.payload?.terminal_answer_authority?.server_authoritative).toBe(true);
  }, 90_000);

  it("sets requested visual cadence for every-N-seconds continuation prompts", async () => {
    const app = await createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: threadId,
        question: "keep checking my screen as a live answer every 10 seconds",
        debug: true,
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("live_pipeline_control");
    expect(response.body?.cadence_ms).toBe(10_000);
    expect(response.body?.action_envelope?.workstation_actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ panel_id: "situation-room", action_id: "live-source.set_rate" }),
    ]));
    expect(response.body?.tool_trace_disclosure?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: "situation-room.live-source.set_rate", authority: "mutation_receipt" }),
    ]));
    expect(response.body?.tool_trace_disclosure?.assistant_answer).toBe(false);
    expect(response.body?.tool_trace_disclosure?.terminal_eligible).toBe(false);
    expect(response.body?.live_pipeline_turn_receipt?.assistant_answer).toBe(false);
    expect(response.body?.visual_producer_cadence_receipt?.cadence?.capture_mode).toBe("interval");
    expect(response.body?.visual_producer_cadence_receipt?.cadence?.cadence_ms).toBe(10_000);
    expect(response.body?.visual_producer_cadence_receipt?.cadence?.status).toBe("permission_required");
    expect(response.body?.live_source_coverage).toMatchObject({
      schema: "helix.live_source_coverage.v1",
      goal_kind: "live_interval_set",
      coverage: "complete",
      next_decision: "allow_terminal",
    });
    expect(response.body?.answer ?? response.body?.text).toContain("every 10 seconds");
  }, 90_000);

  it("does not turn a negated interval mention inside a screen question into cadence control", async () => {
    const question =
      "all right cool can you review what is happening right now in the screen capture I haven't started the interval 10 seconds yet";
    const app = await createApp();
    await seedBackendVisualSource(app);
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: threadId,
        question,
        debug: true,
      })
      .expect(200);

    expect(classifyLiveSourceContinuationIntent(question)).toBeNull();
    expect(response.body?.route_reason_code).toBe("situation_context_question");
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("situation_context_question");
    expect(response.body?.source_target_intent).toMatchObject({
      target_source: "visual_capture",
      target_kind: "visual_capture",
    });
    expect(response.body?.source_target_intent?.explicit_cues).toContain("screen_capture");
    expect(response.body?.final_answer_source).not.toBe("live_pipeline_receipt");
    expect(response.body?.terminal_artifact_kind).not.toBe("live_pipeline_receipt");
    expect(response.body?.action_id).not.toBe("situation-room.live-source.set_rate");
    expect(response.body?.workspace_action_receipt?.action_id).not.toBe("situation-room.live-source.set_rate");
    expect(response.body?.visual_producer_cadence_receipt).toBeFalsy();
    expect(response.body?.tool_call_admission_decision?.source_target).not.toBe("live_pipeline");
    expect(response.body?.route_authority_audit).toMatchObject({
      schema: "helix.route_authority_audit.v1",
      source_target: "visual_capture",
      route_authority_ok: true,
    });
    expect(response.body?.ask_turn_solver_trace).toMatchObject({
      schema: "helix.ask_turn_solver_trace.v1",
      selected_primary_intent: "content_question",
      route_authority_ok: true,
      assistant_answer: false,
      raw_content_included: false,
      intent_arbitration: {
        schema: "helix.intent_arbitration.v1",
        selected_primary_intent_kind: "content_question",
      },
      final_arbitration: {
        selected_route: "situation_context_question",
      },
    });
    expect(response.body?.ask_turn_solver_trace?.intent_hypotheses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          schema: "helix.intent_hypothesis.v1",
          kind: "content_question",
          assistant_answer: false,
          raw_content_included: false,
        }),
      ]),
    );
    expect(response.body?.ask_turn_solver_trace?.prompt_interpretation?.contextual_tool_mentions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          verb_or_cue: "interval_cadence",
          reason: "negated",
        }),
      ]),
    );
    expect(response.body?.ask_turn_solver_trace?.prompt_interpretation?.executable_operator_commands).toEqual([]);
    expect(response.body?.ask_turn_solver_trace?.final_arbitration?.terminal_artifact_kind).not.toBe("live_pipeline_receipt");
    expect(response.body?.ask_turn_solver_trace?.solver_risk_flags ?? []).not.toContain("contextual_tool_mention_executed");
    expect(JSON.stringify(response.body?.loop_parity_trace?.actual_tool_calls ?? [])).not.toContain("situation-room.live-source.set_rate");

    const debugExport = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(response.body.turn_id)}/debug-export`)
      .expect(200);
    expect(debugExport.body?.payload?.ask_turn_solver_trace?.trace_id).toBe(response.body?.ask_turn_solver_trace?.trace_id);
  }, 90_000);

  it("treats future/contextual cadence language in visual questions as visual evidence context", async () => {
    const question = "review the current screen before I start the 10 second interval";
    const app = await createApp();
    await seedBackendVisualSource(app);
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: threadId,
        question,
        debug: true,
      })
      .expect(200);

    expect(classifyLiveSourceContinuationIntent(question)).toBeNull();
    expect(response.body?.route_reason_code).toBe("situation_context_question");
    expect(response.body?.source_target_intent).toMatchObject({
      target_source: "visual_capture",
      target_kind: "visual_capture",
    });
    expect(response.body?.live_source_continuation_intent).toBeFalsy();
    expect(response.body?.action_id).not.toBe("situation-room.live-source.set_rate");
    expect(response.body?.final_answer_source).not.toBe("live_pipeline_receipt");
    expect(response.body?.route_authority_audit?.source_target).toBe("visual_capture");
    expect(response.body?.route_authority_audit?.route_authority_ok).toBe(true);
  }, 90_000);

  it("keeps procedure-epoch visual questions out of live pipeline receipts even when asking about interval state", async () => {
    const question = "what changed since the previous visual capture, and was the 10 second interval running?";
    const app = await createApp();
    await seedBackendVisualSource(app);
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: threadId,
        question,
        debug: true,
      })
      .expect(200);

    expect(classifyLiveSourceContinuationIntent(question)).toBeNull();
    expect(response.body?.source_target_intent?.target_source).toBe("procedure_memory");
    expect(response.body?.source_target_intent?.target_kind).toBe("situation_epoch");
    expect(response.body?.route_reason_code).not.toBe("live_pipeline_control");
    expect(response.body?.terminal_artifact_kind).not.toBe("live_pipeline_receipt");
    expect(response.body?.final_answer_source).not.toBe("live_pipeline_receipt");
    expect(response.body?.action_id).not.toBe("situation-room.live-source.set_rate");
    expect(response.body?.route_authority_audit?.source_target).toBe("procedure_memory");
    expect(response.body?.route_authority_audit?.route_authority_ok).toBe(true);
  }, 90_000);

  it("rejects live pipeline receipts at the terminal guard for visual-content prompts even under live-pipeline source target", () => {
    const contract = buildRouteProductContract({
      turnId: "ask:guard-unit",
      threadId,
      promptText: "review the current screen before I start the 10 second interval",
      sourceTargetIntent: {
        target_source: "live_pipeline",
        target_kind: "live_pipeline",
        requested_outputs: ["live_pipeline_receipt"],
      },
    });
    const guard = guardTerminalArtifactSelection({
      contract,
      terminalArtifactKind: "live_pipeline_receipt",
    });

    expect(contract.precedence_reason).toBe("live_pipeline_receipt_rejected_for_visual_or_procedure_content_request");
    expect(contract.forbidden_terminal_artifact_kinds).toContain("live_pipeline_receipt");
    expect(guard.allowed).toBe(false);
    expect(guard.reason).toBe("terminal_artifact_forbidden_by_route_product_contract");
    expect(auditRouteAuthority({
      turnId: "ask:guard-unit",
      promptText: "review the current screen before I start the 10 second interval",
      selectedRoute: "live_pipeline_control",
      terminalArtifactKind: "live_pipeline_receipt",
      finalAnswerSource: "live_pipeline_receipt",
      sourceTargetIntent: {
        target_source: "live_pipeline",
        target_kind: "live_pipeline",
      },
      routeProductContract: contract,
      terminalArtifactSelectionGuard: guard,
    })).toMatchObject({
      route_authority_ok: false,
      route_authority_violation_code: "receipt_used_as_content_answer",
      primary_violation_code: "receipt_used_as_content_answer",
      violation_codes: expect.arrayContaining([
        "receipt_used_as_content_answer",
        "pipeline_status_used_as_live_cognition",
        "visual_evidence_bypassed",
        "terminal_product_authority_mismatch",
      ]),
      terminal_artifact_allowed: false,
    });
  });

  it("routes direct visual interval commands to producer cadence control", async () => {
    const app = await createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: threadId,
        question: "ok set the interval to 10 seconds on the visual capture",
        debug: true,
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("live_pipeline_control");
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("live_pipeline_control");
    expect(response.body?.canonical_goal_frame?.allows_workspace_context).toBe(true);
    expect(response.body?.source_target_intent).toMatchObject({
      target_source: "live_pipeline",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
    });
    expect(response.body?.route_product_contract).toMatchObject({
      schema: "helix.route_product_contract.v1",
      source_target: "live_pipeline",
    });
    expect(response.body?.route_product_contract?.allowed_terminal_artifact_kinds).toContain("live_pipeline_receipt");
    expect(response.body?.route_product_contract?.forbidden_terminal_artifact_kinds).toContain("situation_context_pack");
    expect(response.body?.tool_call_admission_decision).toMatchObject({
      schema: "helix.tool_call_admission_decision.v1",
      source_target: "live_pipeline",
      required: true,
      admitted_tool_families: ["live_pipeline"],
    });
    expect(response.body?.tool_call_admission_decision?.forbidden_terminal_artifact_kinds).toContain("situation_context_pack");
    expect(response.body?.terminal_artifact_selection_guard).toMatchObject({
      schema: "helix.terminal_artifact_selection_guard.v1",
      allowed: true,
      terminal_artifact_kind: "live_pipeline_receipt",
    });
    expect(response.body?.action_id).toBe("situation-room.live-source.set_rate");
    expect(response.body?.cadence_ms).toBe(10_000);
    expect(response.body?.workspace_action_receipt?.action_id).toBe("situation-room.live-source.set_rate");
    expect(response.body?.workspace_action_receipt?.state_observed).toBe(true);
    expect(response.body?.visual_producer_cadence_receipt?.action_id).toBe("situation-room.live-source.set_rate");
    expect(response.body?.visual_producer_cadence_receipt?.cadence?.capture_mode).toBe("interval");
    expect(response.body?.visual_producer_cadence_receipt?.cadence?.cadence_ms).toBe(10_000);
    expect(response.body?.live_source_coverage).toMatchObject({
      schema: "helix.live_source_coverage.v1",
      goal_kind: "live_interval_set",
      coverage: "complete",
    });
    expect(response.body?.client_action_request?.schema).toBe("helix.client_capability_action.v1");
    expect(response.body?.client_action_request?.capability).toBe("visual_capture");
    expect(response.body?.client_action_request?.action).toBe("request_permission");
    expect(response.body?.client_action_request_ids).toContain(response.body?.client_action_request?.action_request_id);
    expect(response.body?.final_answer_source).toBe("live_pipeline_receipt");
    expect(response.body?.answer).toMatch(/Requested visual capture every 10 seconds|Visual capture is running every 10 seconds/);
    expect(response.body?.answer).not.toContain("Producer freshness:");
    expect(response.body?.answer).not.toContain("Pipeline:");
    expect(response.body?.ask_turn_preflight_context?.schema).toBe("helix.ask_turn_preflight_context.v1");
    expect(response.body?.ask_turn_preflight_context?.retrieval_required_signal).toBeTruthy();
    expect(response.body?.terminal_presentation?.schema).toBe("helix.terminal_presentation.v1");
    expect(response.body?.terminal_presentation?.concise_text).toBe(response.body?.answer);
    expect(response.body?.terminal_presentation_coverage_audit).toMatchObject({
      schema: "helix.terminal_presentation_coverage_audit.v1",
      terminal_presenter_used: true,
      raw_route_text_returned: false,
      violations: [],
    });
    expect(response.body?.receipt_presentation_snapshot?.schema).toBe("helix.receipt_presentation_snapshot.v1");
    expect(response.body?.receipt_presentation_snapshot?.full_summary).toContain("Producer freshness:");
    expect(response.body?.source_binding_statuses?.some((entry: any) =>
      entry?.schema === "helix.source_binding_status.v1" &&
      entry?.modality === "visual_frame"
    )).toBe(true);
    expect(
      response.body?.current_turn_artifact_ledger?.some(
        (entry: any) => entry?.payload?.schema === "helix.live_pipeline_turn_receipt.v1",
      ),
    ).toBe(true);
    expect(response.body?.live_answer_environment?.objective).not.toBe("ok set the interval to 10 seconds on the visual capture");
    expect(response.body?.terminal_answer_authority?.server_authoritative).toBe(true);
    expect(response.body?.poison_audit?.ok).toBe(true);
  }, 20_000);

  it("redirects direct live-answer create cadence commands to producer control", async () => {
    const app = await createApp();
    const response = await request(app)
      .post("/api/agi/situation/live-answer-environment/create")
      .send({
        thread_id: "helix-ask:desktop",
        objective: "ok set the interval to 10 seconds on the visual capture",
      })
      .expect(200);

    expect(response.body?.schema).toBe("helix.live_answer_environment_control_redirect_response.v1");
    expect(response.body?.redirected_from).toBe("live_answer_environment_create");
    expect(response.body?.action).toBe("situation-room.live-source.set_rate");
    expect(response.body?.action_id).toBe("situation-room.live-source.set_rate");
    expect(response.body?.cadence_ms).toBe(10_000);
    expect(response.body?.workspace_action_receipt?.action_id).toBe("situation-room.live-source.set_rate");
    expect(response.body?.workspace_action_receipt?.state_observed).toBe(true);
    expect(response.body?.visual_producer_cadence_receipt?.action_id).toBe("situation-room.live-source.set_rate");
    expect(response.body?.visual_producer_cadence_receipt?.cadence?.capture_mode).toBe("interval");
    expect(response.body?.visual_producer_cadence_receipt?.cadence?.cadence_ms).toBe(10_000);
    expect(response.body?.live_answer_environment?.objective).not.toBe("ok set the interval to 10 seconds on the visual capture");
    expect(response.body?.assistant_answer).toBe(false);
  });

  it("uses the same cadence receipt shape as the direct producer set-cadence endpoint", async () => {
    const app = await createApp();
    const response = await request(app)
      .post("/api/agi/situation/live-source/producer/set-cadence")
      .send({
        thread_id: "helix-ask:desktop",
        source_id: "visual_source:parity",
        cadence_ms: 10_000,
        capture_mode: "interval",
        client_stream_confirmed: true,
      })
      .expect(200);

    expect(response.body?.action_id).toBe("situation-room.live-source.set_rate");
    expect(response.body?.workspace_action_receipt?.action_id).toBe("situation-room.live-source.set_rate");
    expect(response.body?.workspace_action_receipt?.state_observed).toBe(true);
    expect(response.body?.client_action_request?.schema).toBe("helix.client_capability_action.v1");
    expect(response.body?.client_action_request?.capability).toBe("visual_capture");
    expect(response.body?.client_action_request?.args?.source_id).toBe("visual_source:parity");
    expect(response.body?.client_action_request?.args?.cadence_ms).toBe(10_000);
    expect(response.body?.client_action_request_ids).toContain(response.body.client_action_request.action_request_id);
    expect(response.body?.receipt).toMatchObject({
      schema: "helix.visual_producer_cadence_receipt.v1",
      action_id: "situation-room.live-source.set_rate",
      source_id: "visual_source:parity",
      thread_id: "helix-ask:desktop",
      cadence_ms: 10_000,
      capture_mode: "interval",
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("records generic client capability adoption for visual producer requests", async () => {
    const app = await createApp();
    const cadence = await request(app)
      .post("/api/agi/situation/live-source/producer/set-cadence")
      .send({
        thread_id: "helix-ask:desktop",
        source_id: "visual_source:client-action",
        cadence_ms: 10_000,
        capture_mode: "interval",
        client_stream_confirmed: true,
      })
      .expect(200);

    const pending = await request(app)
      .get("/api/agi/client-action/pending?thread_id=helix-ask%3Adesktop")
      .expect(200);
    expect(pending.body?.actions?.map((entry: any) => entry.action_request_id)).toContain(
      cadence.body.client_action_request.action_request_id,
    );

    const adoption = await request(app)
      .post(`/api/agi/client-action/${encodeURIComponent(cadence.body.client_action_request.action_request_id)}/adopt`)
      .send({
        thread_id: "helix-ask:desktop",
        source_id: "visual_source:client-action",
        producer_id: cadence.body.producer.producer_id,
        client_id: "current_browser",
        ok: true,
        observed_state: {
          client_stream_confirmed: true,
          interval_active: true,
          cadence_ms: 10_000,
        },
      })
      .expect(200);

    expect(adoption.body?.adoption).toMatchObject({
      schema: "helix.client_capability_adoption.v1",
      action_request_id: cadence.body.client_action_request.action_request_id,
      thread_id: "helix-ask:desktop",
      capability: "visual_capture",
      action: "adopt_producer",
      source_id: "visual_source:client-action",
      producer_id: cadence.body.producer.producer_id,
      ok: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    const adoptions = await request(app)
      .get("/api/agi/client-action/adoptions?thread_id=helix-ask%3Adesktop")
      .expect(200);
    expect(adoptions.body?.adoptions?.map((entry: any) => entry.adoption_id)).toContain(adoption.body.adoption.adoption_id);
  });

  it("records scheduler adoption through the producer adoption endpoint", async () => {
    const app = await createApp();
    const cadence = await request(app)
      .post("/api/agi/situation/live-source/producer/set-cadence")
      .send({
        thread_id: "helix-ask:desktop",
        source_id: "visual_source:adoption-route",
        cadence_ms: 10_000,
        capture_mode: "interval",
      })
      .expect(200);

    const adoption = await request(app)
      .post("/api/agi/situation/live-source/producer/adopt")
      .send({
        producer_id: cadence.body?.producer?.producer_id,
        source_id: "visual_source:adoption-route",
        thread_id: "helix-ask:desktop",
        cadence_ms: 10_000,
        capture_mode: "interval",
        client_stream_confirmed: true,
        interval_active: true,
      })
      .expect(200);

    expect(adoption.body?.adoption).toMatchObject({
      schema: "helix.visual_producer_scheduler_adoption.v1",
      producer_id: cadence.body?.producer?.producer_id,
      source_id: "visual_source:adoption-route",
      thread_id: "helix-ask:desktop",
      cadence_ms: 10_000,
      capture_mode: "interval",
      client_stream_confirmed: true,
      interval_active: true,
      status: "adopted",
      assistant_answer: false,
      raw_content_included: false,
    });

    const list = await request(app)
      .get("/api/agi/situation/live-source/producer/adoptions?thread_id=helix-ask%3Adesktop")
      .expect(200);
    expect(list.body?.adoptions?.map((entry: any) => entry.adoption_id)).toContain(adoption.body.adoption.adoption_id);
  });

  it("normalizes reverse visual interval wording to a 10 second producer cadence", async () => {
    const app = await createApp();
    const askResponse = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: threadId,
        question: "Ok set this visual source on 10 seconds interval",
        debug: true,
      })
      .expect(200);

    expect(askResponse.body?.route_reason_code).toBe("live_pipeline_control");
    expect(askResponse.body?.action_id).toBe("situation-room.live-source.set_rate");
    expect(askResponse.body?.cadence_ms).toBe(10_000);
    expect(askResponse.body?.visual_producer_cadence_receipt?.cadence_ms).toBe(10_000);
    expect(askResponse.body?.live_answer_environment?.objective).not.toBe("Ok set this visual source on 10 seconds interval");

    const createResponse = await request(app)
      .post("/api/agi/situation/live-answer-environment/create")
      .send({
        thread_id: "helix-ask:desktop",
        objective: "Ok set this visual source on 10 seconds interval",
      })
      .expect(200);

    expect(createResponse.body?.schema).toBe("helix.live_answer_environment_control_redirect_response.v1");
    expect(createResponse.body?.action_id).toBe("situation-room.live-source.set_rate");
    expect(createResponse.body?.cadence_ms).toBe(10_000);
    expect(createResponse.body?.visual_producer_cadence_receipt?.cadence_ms).toBe(10_000);
    expect(createResponse.body?.live_answer_environment?.objective).not.toBe("Ok set this visual source on 10 seconds interval");
  }, 20_000);

  it("keeps the retired visual producer rate action out of active workstation affordances", () => {
    expect(WORKSTATION_DYNAMIC_TOOL_ACTIONS).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          panel_id: "situation-room-pipelines",
          action_id: "live-source.set_rate",
          required_args: ["cadence_ms"],
        }),
      ]),
    );
    expect(WORKSPACE_ACTION_REGISTRY).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action_key: "situation-room.live-source.set_rate",
          target_id: "situation-room-pipelines",
          action_id: "live-source.set_rate",
          terminal_receipt_required: true,
        }),
      ]),
    );
    expect(RETIRED_WORKSTATION_DYNAMIC_TOOL_ACTIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          panel_id: "situation-room-pipelines",
          action_id: "live-source.set_rate",
          required_args: ["cadence_ms"],
        }),
      ]),
    );
    expect(RETIRED_WORKSPACE_ACTION_REGISTRY).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action_key: "situation-room.live-source.set_rate",
          target_id: "situation-room-pipelines",
          action_id: "live-source.set_rate",
          terminal_receipt_required: true,
        }),
      ]),
    );
  });

  it("routes producer status questions to pipeline inspection with freshness evidence", async () => {
    const app = await createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: threadId,
        question: "is my screen live source still updating?",
        debug: true,
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("live_pipeline_inspect");
    expect(response.body?.producer_freshness?.next_required_action).toBeTruthy();
    expect(response.body?.visual_cadence_acceptance?.assistant_answer).toBe(false);
    expect(response.body?.terminal_answer_authority?.server_authoritative).toBe(true);
  }, 20_000);

  it("routes worker-lane live cognition questions to binding diagnosis", async () => {
    const app = await createApp();
    const cadence = await request(app)
      .post("/api/agi/situation/live-source/producer/set-cadence")
      .send({
        thread_id: "helix-ask:desktop",
        source_id: "visual_source:diagnosis",
        cadence_ms: 15_000,
        capture_mode: "interval",
        client_stream_confirmed: true,
      })
      .expect(200);
    await request(app)
      .post(`/api/agi/client-action/${encodeURIComponent(cadence.body.client_action_request.action_request_id)}/adopt`)
      .send({
        thread_id: "helix-ask:desktop",
        source_id: "visual_source:diagnosis",
        producer_id: cadence.body.producer.producer_id,
        client_id: "current_browser",
        ok: true,
        observed_state: {
          client_stream_confirmed: true,
          interval_active: true,
          cadence_ms: 10_000,
        },
      })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "helix-ask:desktop",
        question: "why are the worker lanes not updating even though visual capture is running?",
        debug: true,
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("live_environment_binding_diagnosis");
    expect(response.body?.canonical_goal_frame?.required_terminal_kind).toBe("live_environment_binding_diagnosis");
    expect(response.body?.final_answer_source).toBe("live_environment_binding_diagnosis");
    expect(response.body?.terminal_artifact_kind).toBe("live_environment_binding_diagnosis");
    expect(response.body?.live_environment_binding_diagnosis).toMatchObject({
      schema: "helix.live_environment_binding_diagnosis.v2",
      target_source: "visual_capture",
      client_adoption_status: "adopted",
      client_interval_active: true,
      server_cadence_ms: 15_000,
      client_observed_cadence_ms: 10_000,
      cadence_match: false,
      capture_ready: true,
      scene_procedure_ready: false,
      live_card_ready: false,
      blocking_reason: "producer_stale",
      next_required_action: "capture_frame_now",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(response.body?.live_environment_binding_diagnosis?.source_freshness?.status).toBe("stale");
    expect(response.body?.live_environment_binding_diagnosis?.auntie_dot?.sensor_readiness_summary).toContain("Sensor readiness:");
    expect(response.body?.live_environment_binding_diagnosis?.auntie_dot?.mission_state_summary).toContain("Mission-state interpretation:");
    expect(response.body?.latest_field_evaluation_absence_reason).toBeTruthy();
    expect(response.body?.latest_interpretation_absence_reason).toBeTruthy();
    expect(response.body?.answer).toContain("Capture alone is not live cognition");
    expect(response.body?.answer).toContain("Sensor readiness:");
    expect(response.body?.answer).toContain("Mission-state interpretation:");
    expect(response.body?.answer).not.toContain("Visual capture is running every");
    expect(response.body?.terminal_answer_authority?.server_authoritative).toBe(true);
    expect(response.body?.terminal_grounding_authority).toMatchObject({
      status: "validated",
      evidence_reentry_authority: "route_self_terminal",
      runtime_lifecycle_verified: false,
    });
    expect(response.body?.poison_audit?.ok).toBe(true);
  }, 60_000);

  it("keeps capture readiness separate from missing SituationRun cognition", () => {
    const diagnosis = buildLiveEnvironmentBindingDiagnosis({
      turnId: "ask:diagnosis-no-run",
      threadId: "helix-ask:desktop",
      sourceId: "visual_source:diagnosis-unit",
      producerId: "live_source_producer:diagnosis-unit",
      producerFreshness: freshProducer(),
      producerBindingStatus: "bound",
      serverCadenceMs: 10_000,
    });

    expect(diagnosis).toMatchObject({
      schema: "helix.live_environment_binding_diagnosis.v2",
      capture_ready: true,
      scene_procedure_ready: false,
      live_card_ready: false,
      active_situation_run_status: "missing",
      blocking_reason: "no_active_situation_run",
      next_required_action: "create_or_resume_situation_run",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(diagnosis.latest_observation_refs).toEqual([]);
    expect(diagnosis.summary).toContain("Sensor readiness:");
    expect(diagnosis.summary).toContain("Mission-state interpretation:");
  });

  it("blocks procedure readiness when the producer freshness is stale", () => {
    seedSituationRun({ withObservation: true, withFieldEvaluation: true, withInterpretation: true });

    const diagnosis = buildLiveEnvironmentBindingDiagnosis({
      turnId: "ask:diagnosis-stale-source",
      threadId: "helix-ask:desktop",
      sourceId: "visual_source:diagnosis-unit",
      producerId: "live_source_producer:diagnosis-unit",
      producerFreshness: freshProducer({
        is_fresh: false,
        readiness_state: "stale",
        stale_reason: "no_chunk_after_two_cadence_windows",
        next_required_action: "capture_frame_now",
      }),
      producerBindingStatus: "bound",
      serverCadenceMs: 10_000,
    });

    expect(diagnosis.capture_ready).toBe(true);
    expect(diagnosis.source_freshness.status).toBe("stale");
    expect(diagnosis.scene_procedure_ready).toBe(false);
    expect(diagnosis.blocking_reason).toBe("producer_stale");
    expect(diagnosis.next_required_action).toBe("capture_frame_now");
  });

  it("requires field evaluations and interpretations before scene procedure readiness", () => {
    seedSituationRun({ withObservation: true });
    const noFields = buildLiveEnvironmentBindingDiagnosis({
      turnId: "ask:diagnosis-no-fields",
      threadId: "helix-ask:desktop",
      sourceId: "visual_source:diagnosis-unit",
      producerFreshness: freshProducer(),
      producerBindingStatus: "bound",
      serverCadenceMs: 10_000,
    });

    expect(noFields.latest_observation_refs.length).toBeGreaterThan(0);
    expect(noFields.field_evaluation_refs).toEqual([]);
    expect(noFields.scene_procedure_ready).toBe(false);
    expect(noFields.blocking_reason).toBe("no_field_evaluations");
    expect(noFields.next_required_action).toBe("run_field_workers_for_latest_observation");

    resetLiveFieldEvaluationsForTest();
    resetLiveInterpretationHypothesesForTest();
    recordLiveFieldEvaluation({
      schema: "helix.live_field_evaluation.v1",
      evaluation_id: "field_eval:diagnosis-unit",
      worker_run_id: "field_worker_run:diagnosis-unit",
      worker_id: "field_worker:diagnosis-unit",
      situation_run_id: noFields.situation_run_id ?? "",
      thread_id: "helix-ask:desktop",
      environment_id: noFields.live_environment_id ?? "",
      field_key: "scene",
      value: "Field evidence exists without interpretation.",
      status: "supported",
      confidence: 0.7,
      evidence_refs: ["observation:diagnosis-unit"],
      missing_evidence: [],
      corroboration_state: { visual: "present" },
      next_check: null,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      created_at: new Date().toISOString(),
      role: "ui_projection",
      assistant_answer: false,
      raw_content_included: false,
    });
    const noInterpretations = buildLiveEnvironmentBindingDiagnosis({
      turnId: "ask:diagnosis-no-interpretations",
      threadId: "helix-ask:desktop",
      sourceId: "visual_source:diagnosis-unit",
      producerFreshness: freshProducer(),
      producerBindingStatus: "bound",
      serverCadenceMs: 10_000,
    });

    expect(noInterpretations.field_evaluation_refs.length).toBeGreaterThan(0);
    expect(noInterpretations.interpretation_refs).toEqual([]);
    expect(noInterpretations.blocking_reason).toBe("no_interpretation_artifacts");
    expect(noInterpretations.next_required_action).toBe("run_interpretation_workers_for_latest_evaluations");
  });

  it("keeps a ready procedure separate from a missing live card delta", () => {
    seedSituationRun({ withObservation: true, withFieldEvaluation: true, withInterpretation: true });

    const diagnosis = buildLiveEnvironmentBindingDiagnosis({
      turnId: "ask:diagnosis-no-card",
      threadId: "helix-ask:desktop",
      sourceId: "visual_source:diagnosis-unit",
      producerFreshness: freshProducer({ last_card_delta_at: null }),
      producerBindingStatus: "bound",
      serverCadenceMs: 10_000,
    });

    expect(diagnosis.scene_procedure_ready).toBe(true);
    expect(diagnosis.live_card_ready).toBe(false);
    expect(diagnosis.card_delta_status).toBe("missing");
    expect(diagnosis.blocking_reason).toBe("card_delta_missing");
    expect(diagnosis.next_required_action).toBe("repair_card_projection_binding");
  });

  it("routes scene comparison through procedure evidence and keeps diagnosis as a side artifact", async () => {
    const app = await createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "helix-ask:desktop",
        question: "Okay, what are we looking at now and how does it compare to the last scene epoch?",
        debug: true,
      })
      .expect(200);

    expect(response.body?.route_reason_code).not.toBe("live_environment_binding_diagnosis");
    expect(response.body?.terminal_artifact_kind).not.toBe("live_environment_binding_diagnosis");
    expect([
      "visual_scene_comparison_result",
      "procedure_epoch_replay",
      "situation_context_pack_with_epoch_evidence",
      "typed_failure",
    ]).toContain(response.body?.terminal_artifact_kind);
    expect(response.body?.side_artifacts?.live_environment_binding_diagnosis?.schema).toBe(
      "helix.live_environment_binding_diagnosis.v2",
    );
  }, 30_000);

  it("returns typed failure rather than a receipt when procedure memory is unavailable", async () => {
    const app = await createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "helix-ask:desktop",
        question: "What does procedure memory say about the last scene?",
        debug: true,
      })
      .expect(200);

    expect(response.body?.terminal_artifact_kind).toBe("typed_failure");
    expect(response.body?.typed_failure).toMatchObject({
      schema: "helix.typed_failure.v1",
      failure_kind: "procedure_memory_unavailable",
      requested_capability: "procedure_memory",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(response.body?.typed_failure?.repair_hint).toBeTruthy();
    expect(response.body?.final_answer_source).not.toBe("live_pipeline_receipt");
    expect(response.body?.answer).not.toContain("Pipeline:");
    expect(response.body?.answer).toContain("Auntie Dot: sensors are separate from mission memory.");
    expect(response.body?.terminal_error_code).toBe(
      "PROCEDURE_MEMORY_ACTIVE_SITUATION_RUN_MISSING",
    );
    expect(response.body?.agent_runtime_loop_admission).toMatchObject({
      admitted: false,
      mode: "skip",
      reason: "authoritative_typed_failure_terminal",
    });
    expect(
      response.body?.current_turn_artifact_ledger?.some((entry: any) =>
        ["runtime_tool_call", "runtime_tool_observation"].includes(
          entry?.kind,
        ),
      ),
    ).toBe(false);
  }, 60_000);

  it("does not classify scene-epoch comparison prompts as binding diagnosis", () => {
    const comparisonIntent = classifyLiveSourceContinuationIntent(
      "Okay, what are we looking at now and how does it compare to the last scene epoch?",
    );
    const healthIntent = classifyLiveSourceContinuationIntent(
      "why are the worker lanes not updating even though visual capture is running?",
    );

    expect(comparisonIntent?.kind).not.toBe("live_environment_binding_diagnosis");
    expect(comparisonIntent).toBeNull();
    expect(healthIntent?.kind).toBe("live_environment_binding_diagnosis");
  });

  it("routes Minecraft event attachment questions to world binding diagnostics", async () => {
    const app = await createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: threadId,
        question: "are Minecraft events attached to this thread?",
        debug: true,
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("live_pipeline_inspect");
    expect(response.body?.world_event_thread_binding_check?.schema).toBe("helix.world_event_thread_binding_check.v1");
    expect(response.body?.world_event_thread_binding_check?.assistant_answer).toBe(false);
    expect(response.body?.source_binding_statuses?.some((entry: any) =>
      entry?.schema === "helix.source_binding_status.v1" &&
      entry?.modality === "world_event" &&
      ["observed_unbound", "stale"].includes(entry.status)
    )).toBe(true);
    expect(response.body?.terminal_answer_authority?.server_authoritative).toBe(true);
  }, 20_000);

  it("routes explicit live repair prompts to live runtime repair", async () => {
    const app = await createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: threadId,
        question: "fix the live screen source",
        debug: true,
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("live_runtime_repair");
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("live_runtime_repair");
    expect(response.body?.live_runtime_repair_plan?.schema).toBe("helix.live_runtime_repair_plan.v1");
    expect(response.body?.terminal_answer_authority?.server_authoritative).toBe(true);
    expect(response.body?.poison_audit?.ok).toBe(true);
  }, 20_000);

  it("repairs an existing live pipeline for not-updating prompts", async () => {
    const plan = composeLiveSourcePipelinePlan({
      threadId: "helix-ask:desktop",
      objective: "Watch this screen as a live answer.",
    });
    const { receipt } = executeLiveSourcePipelinePlan(plan);
    const app = await createApp();

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: threadId,
        question: "why is the visual source not updating?",
        debug: true,
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("live_runtime_repair");
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("live_runtime_repair");
    expect(response.body?.live_runtime_context?.active_pipeline_id).toBe(receipt.pipeline_id);
    expect(response.body?.pipeline_dashboard?.pipeline_id).toBe(receipt.pipeline_id);
    expect(response.body?.live_runtime_repair_plan?.assistant_answer).toBe(false);
    expect(response.body?.final_answer_source).toBe("live_pipeline_receipt");
    expect(response.body?.poison_audit?.assistant_history_projection_count).toBe(0);
  }, 20_000);

  it("does not hijack unrelated model-only science questions", async () => {
    const app = await createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: threadId,
        question: "what is a neutron star glitch?",
        agentRuntime: "helix",
        agent_runtime: "helix",
        debug: true,
      })
      .expect(200);

    expect(response.body?.route_reason_code).not.toMatch(/^live_/);
    expect(response.body?.canonical_goal_frame?.goal_kind).not.toMatch(/^live_/);
    expect(response.body?.ask_turn_preflight_context?.schema).toBe("helix.ask_turn_preflight_context.v1");
    expect(response.body?.terminal_presentation?.schema).toBe("helix.terminal_presentation.v1");
    expect(response.body?.terminal_presentation_coverage_audit).toMatchObject({
      terminal_presenter_used: true,
      raw_route_text_returned: false,
      violations: [],
    });
  }, 90_000);
});
