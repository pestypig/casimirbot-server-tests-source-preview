import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { planRouter } from "../routes/agi.plan";
import { API_PARITY_SCENARIOS, type HelixApiParityScenario } from "../services/helix-ask/api-parity-matrix";
import { buildApiParityProbeResult } from "../services/helix-ask/api-parity-probe";
import {
  CODEX_PARITY_AGENT_SPINE_CLASSES,
  CODEX_PARITY_AGENT_SPINE_FIRST_BROKEN_RAILS,
  CODEX_PARITY_AGENT_SPINE_RAIL_STATUSES,
  CODEX_PARITY_AGENT_SPINE_RAIL_TABLE_SCHEMA,
  CODEX_PARITY_AGENT_SPINE_REENTRY_STATUSES,
  CODEX_PARITY_AGENT_SPINE_REPAIR_TARGETS,
  CODEX_PARITY_AGENT_SPINE_STRING_OR_NULL_FIELDS,
  isCodexParityAgentSpineRailFailureCode,
} from "../services/helix-ask/codex-parity-agent-spine-contract";
import { resetHelixAskTurnAdmissionForTests } from "../services/helix-ask/ask-turn-admission";
import { resetConversationalAnswerDistillationsForTest } from "../services/helix-ask/conversational-answer-distillation-store";
import { resetLiveSourcePipelinesForTest } from "../services/helix-ask/live-source-pipeline-executor";
import { resetReceiptPresentationSnapshotsForTest } from "../services/helix-ask/receipt-presentation-snapshot-store";
import { HELIX_TOOL_RAIL_TERMINAL_FAILURE_RECONCILIATION_VERSION } from "../services/helix-ask/terminal-rail-failure-reconciliation";
import { resetClientCapabilityActionsForTest } from "../services/client-capabilities/client-action-queue";
import { resetClientCapabilityAdoptionsForTest } from "../services/client-capabilities/client-adoption-store";
import { resetLiveAnswerEnvironments } from "../services/situation-room/live-answer-environment-store";
import { createLiveAnswerEnvironment } from "../services/situation-room/live-answer-environment-store";
import { recordLiveFieldEvaluation, resetLiveFieldEvaluationsForTest } from "../services/situation-room/live-field-evaluation-store";
import { resetLiveFieldWorkerRunsForTest } from "../services/situation-room/live-field-worker-run-store";
import { resetLiveFieldWorkersForTest } from "../services/situation-room/live-field-worker-registry";
import { resetLivePipelineLifecycleForTest } from "../services/situation-room/live-pipeline-lifecycle-store";
import { ensureLiveSituationRunForEnvironment, resetLiveSituationRunsForTest } from "../services/situation-room/live-situation-run-store";
import { appendLiveSourceChunk, queueLiveSourceAnalysisJob, resetLiveSourceChunkBufferForTest } from "../services/situation-room/live-source-chunk-buffer";
import { resetLiveSourceProducerBindingsForTest } from "../services/situation-room/live-source-producer-binding";
import { resetLiveSourceProducerLifecycleForTest } from "../services/situation-room/live-source-producer-lifecycle-store";
import { resetLiveWorkerLanesForTest } from "../services/situation-room/live-worker-lane-store";
import { resetObservationJournalForTest } from "../services/situation-room/observation-journal-store";
import { appendObservationJournalEntry } from "../services/situation-room/observation-journal-store";
import { appendInterpretationCard, resetInterpretationCardsForTest } from "../services/situation-room/interpretation-card-store";
import { resetProcedureEpochClosuresForTest } from "../services/situation-room/procedure-epoch-closure";
import { resetProcedureEpochLedgerForTest } from "../services/situation-room/procedure-epoch-ledger-store";
import { resetProcedureReasoningSnapshotsForTest } from "../services/situation-room/procedure-reasoning-snapshot-store";
import { resetSituationSourceCapabilitiesForTest } from "../services/situation-room/situation-source-capability-store";
import { resetVisualComparisonSessionsForTest } from "../services/situation-room/visual-comparison-session-store";
import { resetVisualProducerSchedulerAdoptionsForTest } from "../services/situation-room/visual-producer-scheduler-adoption-store";
import { resetVisualSceneMemoryForTest } from "../services/situation-room/visual-scene-memory-store";
import { resetVisualSnapshotStoreForTest } from "../services/situation-room/visual-snapshot-store";
import { resetVoiceLiveHandoffsForTest } from "../services/situation-room/voice-live-handoff-router";
import { resetRuntimeMemoryGovernorForTests } from "../services/runtime/runtime-memory-governor";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/agi", planRouter);
  return app;
};

const resetAll = (): void => {
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
  resetInterpretationCardsForTest();
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
};

const parseSseEvents = (text: string): Array<{ event: string; data: Record<string, unknown> }> =>
  text
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => ({
      event: block.match(/^event:\s*(.+)$/m)?.[1]?.trim() ?? "message",
      data: JSON.parse(block.match(/^data:\s*(.+)$/m)?.[1]?.trim() ?? "{}") as Record<string, unknown>,
    }));

const expectNullableStringField = (record: Record<string, unknown>, key: string): void => {
  expect(record).toHaveProperty(key);
  const value = record[key];
  expect(value === null || typeof value === "string").toBe(true);
};

const expectNonEmptyStringArrayField = (record: Record<string, unknown>, key: string): void => {
  expect(record).toHaveProperty(key);
  expect(Array.isArray(record[key])).toBe(true);
  expect((record[key] as unknown[]).every((entry) => typeof entry === "string" && entry.trim().length > 0)).toBe(true);
};

const expectVisibleToolSurfaceMetadata = (record: Record<string, unknown>): void => {
  expect(record).toHaveProperty("visible_tool_surface_original_count");
  expect(record).toHaveProperty("visible_tool_surface_truncated");
  expect(typeof record.visible_tool_surface_original_count).toBe("number");
  expect(Number.isInteger(record.visible_tool_surface_original_count)).toBe(true);
  expect((record.visible_tool_surface_original_count as number)).toBeGreaterThanOrEqual(0);
  expect(typeof record.visible_tool_surface_truncated).toBe("boolean");
  const visibleSurfaceLength = Array.isArray(record.visible_tool_surface) ? record.visible_tool_surface.length : 0;
  expect((record.visible_tool_surface_original_count as number)).toBeGreaterThanOrEqual(visibleSurfaceLength);
  if (record.visible_tool_surface_truncated === true) {
    expect((record.visible_tool_surface_original_count as number)).toBeGreaterThan(visibleSurfaceLength);
  } else {
    expect(record.visible_tool_surface_original_count).toBe(visibleSurfaceLength);
  }
};

const CODEX_PARITY_CLASSES = [...CODEX_PARITY_AGENT_SPINE_CLASSES];

const expectCodexParityRailTableShape = (railTable: Record<string, unknown>, turnId: string): void => {
  expect(railTable).toMatchObject({
    schema: CODEX_PARITY_AGENT_SPINE_RAIL_TABLE_SCHEMA,
    turn_id: turnId,
    assistant_answer: false,
    terminal_eligible: false,
    raw_content_included: false,
  });
  expectNonEmptyStringArrayField(railTable, "visible_tool_surface");
  expectVisibleToolSurfaceMetadata(railTable);
  for (const key of CODEX_PARITY_AGENT_SPINE_STRING_OR_NULL_FIELDS) {
    expectNullableStringField(railTable, key);
  }
  expect(CODEX_PARITY_AGENT_SPINE_REENTRY_STATUSES).toContain(railTable.reentry_status as never);
  expect(CODEX_PARITY_AGENT_SPINE_RAIL_STATUSES).toContain(railTable.rail_status as never);
  expect(railTable.rail_status === "complete").toBe(railTable.codex_parity_class === "complete");
  expect(typeof railTable.reentry_proven).toBe("boolean");
  expect(railTable.reentry_proof_source === null || typeof railTable.reentry_proof_source === "string").toBe(true);
  if (railTable.reentry_status === "reentered") {
    expect(railTable.reentry_proven).toBe(true);
    expect(typeof railTable.reentry_proof_source).toBe("string");
    expect(String(railTable.reentry_proof_source).length).toBeGreaterThan(0);
  }
  if (railTable.rail_status === "complete" || railTable.codex_parity_class === "complete") {
    expect(railTable.reentry_status).toBe("reentered");
  }
  expect(typeof railTable.terminal_authority_proven).toBe("boolean");
  expect(railTable.terminal_authority_proof_source === null || typeof railTable.terminal_authority_proof_source === "string").toBe(true);
  if (railTable.selected_terminal_kind) {
    expect(railTable.terminal_authority_proven).toBe(true);
    expect(typeof railTable.terminal_authority_proof_source).toBe("string");
    expect(String(railTable.terminal_authority_proof_source).length).toBeGreaterThan(0);
  }
  expect(typeof railTable.visible_projection_proven).toBe("boolean");
  expect(railTable.visible_projection_source === null || typeof railTable.visible_projection_source === "string").toBe(true);
  if (railTable.visible_terminal_kind) {
    expect(railTable.visible_projection_proven).toBe(true);
    expect(typeof railTable.visible_projection_source).toBe("string");
    expect(String(railTable.visible_projection_source).length).toBeGreaterThan(0);
  }
  if (railTable.rail_status === "complete" || railTable.codex_parity_class === "complete") {
    expect(railTable.selected_terminal_kind).toBeTruthy();
    expect(railTable.visible_terminal_kind).toBeTruthy();
  }
  expectNonEmptyStringArrayField(railTable, "required_observation_kinds_for_requested_capability");
  expect(
    railTable.observed_artifact_supports_requested_capability === null ||
      typeof railTable.observed_artifact_supports_requested_capability === "boolean",
  ).toBe(true);
  if (railTable.requested_capability) {
    expect((railTable.required_observation_kinds_for_requested_capability as unknown[]).length).toBeGreaterThan(0);
    expect(typeof railTable.observed_artifact_supports_requested_capability).toBe("boolean");
    if (railTable.goal_satisfaction === "satisfied" || railTable.rail_status === "complete") {
      expect(railTable.observed_artifact_supports_requested_capability).toBe(true);
    }
  }
  expect(typeof railTable.admission_proven).toBe("boolean");
  if (railTable.admitted_capability) {
    expect(railTable.admission_proven).toBe(true);
    expect(typeof railTable.admission_proof_source).toBe("string");
    expect(String(railTable.admission_proof_source).length).toBeGreaterThan(0);
  }
  if (railTable.selected_capability || railTable.executed_capability) {
    expect(typeof railTable.admitted_capability).toBe("string");
    expect(String(railTable.admitted_capability).length).toBeGreaterThan(0);
  }
  expect(CODEX_PARITY_CLASSES).toContain(railTable.codex_parity_class);
  expect(railTable.normalized_codex_parity_classes).toEqual([...CODEX_PARITY_CLASSES]);
  if (railTable.codex_parity_class === "complete" || railTable.rail_status === "complete") {
    expect(railTable.first_broken_rail).toBeNull();
    expect(railTable.rail_failure_code).toBeNull();
  } else {
    expect(typeof railTable.first_broken_rail).toBe("string");
    expect(String(railTable.first_broken_rail).length).toBeGreaterThan(0);
    expect(CODEX_PARITY_AGENT_SPINE_FIRST_BROKEN_RAILS).toContain(railTable.first_broken_rail as never);
    expect(typeof railTable.rail_failure_code).toBe("string");
    expect(String(railTable.rail_failure_code).length).toBeGreaterThan(0);
    expect(isCodexParityAgentSpineRailFailureCode(railTable.rail_failure_code)).toBe(true);
    expect(typeof railTable.repair_target).toBe("string");
    expect(String(railTable.repair_target).length).toBeGreaterThan(0);
    expect(CODEX_PARITY_AGENT_SPINE_REPAIR_TARGETS).toContain(railTable.repair_target as never);
  }
};

const seedIdentitySource = (input: {
  threadId: string;
  sourceId: string;
  environmentId?: string | null;
  observationId?: string;
}) => {
  const now = new Date().toISOString();
  const chunk = appendLiveSourceChunk({
    source_id: input.sourceId,
    thread_id: input.threadId,
    environment_id: input.environmentId,
    modality: "visual_frame",
    ts: now,
    compact_summary: "A parity-seeded visual frame is available.",
    evidence_refs: ["visual_evidence:api-parity"],
  }).chunk;
  const job = queueLiveSourceAnalysisJob({
    chunk,
    status: "completed",
    outputRefs: ["visual_evidence:api-parity"],
  });
  const observation = appendObservationJournalEntry({
    thread_id: input.threadId,
    observation_id: input.observationId ?? `observation:api-parity:${input.sourceId.replace(/[^a-z0-9]+/gi, "-")}`,
    role: "model_perception_observation",
    modality: "visual_frame",
    source_id: input.sourceId,
    text: "A parity-seeded visual frame is available.",
    evidence_refs: [chunk.chunk_id, job.job_id],
    model_invoked: true,
    confidence: 0.8,
    created_at: now,
    assistant_answer: false,
    raw_content_included: false,
  });
  return { now, chunk, observation };
};

const recordIdentityField = (input: {
  threadId: string;
  environmentId: string;
  situationRunId: string;
  observationId: string;
}): void => {
  const now = new Date().toISOString();
  recordLiveFieldEvaluation({
    schema: "helix.live_field_evaluation.v1",
    evaluation_id: `field_eval:api-parity:${input.situationRunId}:activity`,
    worker_run_id: `field_worker_run:api-parity:${input.situationRunId}:activity`,
    worker_id: "field_worker:api_parity_identity",
    situation_run_id: input.situationRunId,
    thread_id: input.threadId,
    environment_id: input.environmentId,
    field_key: "activity",
    value: "Reviewing parity-seeded visual evidence.",
    status: "supported",
    confidence: 0.8,
    evidence_refs: [input.observationId],
    missing_evidence: [],
    corroboration_state: { visual: "present" },
    next_check: "Compare the next frame.",
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    created_at: now,
    role: "ui_projection",
    assistant_answer: false,
    raw_content_included: false,
  });
};

const seedScenario = async (
  app: express.Express,
  scenario: HelixApiParityScenario,
  threadId: string,
): Promise<void> => {
  if (scenario.seed === "none") return;
  if (scenario.seed === "active_run_with_unbound_visual_source") {
    await request(app)
      .post("/api/agi/situation/test-harness/live-visual-source")
      .send({
        scenario: "active_run_with_unbound_visual_source",
        thread_id: threadId,
        bound_source_id: `visual_source:${scenario.id}:bound`,
        unbound_source_id: `visual_source:${scenario.id}:fresh`,
        bound_scene_text: "A backend-seeded visual capture shows File Explorer open to a research folder.",
        unbound_scene_text: "A fresh visual capture shows the Helix Ask UI with worker-lane debug output.",
        confidence: 0.82,
      })
      .expect(200);
    return;
  }
  if (scenario.seed === "live_source_identity_missing_environment_source") {
    const { environment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: `seed:${scenario.id}`,
      objective: "Answer from visual evidence.",
      preset: "custom",
      source_ids: [],
    });
    seedIdentitySource({ threadId, sourceId: `visual_source:${scenario.id}:fresh`, environmentId: environment.environment_id });
    return;
  }
  if (scenario.seed === "live_source_identity_no_situation_run") {
    const sourceId = `visual_source:${scenario.id}:bound`;
    const { environment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: `seed:${scenario.id}`,
      objective: "Answer from visual evidence.",
      preset: "custom",
      source_ids: [sourceId],
    });
    seedIdentitySource({ threadId, sourceId, environmentId: environment.environment_id });
    return;
  }
  if (scenario.seed === "live_source_identity_no_field_evaluations") {
    const sourceId = `visual_source:${scenario.id}:bound`;
    const { environment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: `seed:${scenario.id}`,
      objective: "Answer from visual evidence.",
      preset: "custom",
      source_ids: [sourceId],
    });
    const { observation } = seedIdentitySource({ threadId, sourceId, environmentId: environment.environment_id });
    ensureLiveSituationRunForEnvironment({ environment, observation, advanceEpoch: true });
    return;
  }
  if (scenario.seed === "live_source_identity_stale_interpretation") {
    const sourceId = `visual_source:${scenario.id}:bound`;
    const { environment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: `seed:${scenario.id}`,
      objective: "Answer from visual evidence.",
      preset: "custom",
      source_ids: [sourceId],
    });
    const { observation } = seedIdentitySource({ threadId, sourceId, environmentId: environment.environment_id });
    const run = ensureLiveSituationRunForEnvironment({ environment, observation, advanceEpoch: true });
    recordIdentityField({ threadId, environmentId: environment.environment_id, situationRunId: run.situation_run_id, observationId: observation.observation_id });
    appendInterpretationCard({
      thread_id: threadId,
      title: "Expired visual interpretation",
      summary: "This interpretation is stale.",
      evidence_refs: [observation.observation_id],
      confidence: 0.8,
      expires_at: "2000-01-01T00:00:00.000Z",
    });
    return;
  }
  if (scenario.seed === "live_source_identity_wrong_environment") {
    const sourceId = `visual_source:${scenario.id}:bound`;
    const { environment: wrongEnvironment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: `seed:${scenario.id}:wrong`,
      objective: "Other visual environment.",
      preset: "custom",
      source_ids: [sourceId],
      now: "2026-05-20T00:00:00.000Z",
    });
    const { environment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: `seed:${scenario.id}:active`,
      objective: "Answer from visual evidence.",
      preset: "custom",
      source_ids: [sourceId],
      now: "2026-05-20T00:01:00.000Z",
    });
    const { observation } = seedIdentitySource({ threadId, sourceId, environmentId: wrongEnvironment.environment_id });
    const run = ensureLiveSituationRunForEnvironment({ environment, observation, advanceEpoch: true });
    recordIdentityField({ threadId, environmentId: environment.environment_id, situationRunId: run.situation_run_id, observationId: observation.observation_id });
    appendInterpretationCard({
      thread_id: threadId,
      title: "Visual interpretation",
      summary: "The current visual frame has been interpreted.",
      evidence_refs: [observation.observation_id],
      confidence: 0.8,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    return;
  }
  await request(app)
    .post("/api/agi/situation/test-harness/live-visual-source")
    .send({
      thread_id: threadId,
      source_id: `visual_source:${scenario.id}`,
      scene_text:
        scenario.seed === "visual_frame_with_start_button"
          ? "A backend-seeded visual capture shows a workstation panel with a visible Start button and status controls."
          : "A backend-seeded visual capture shows File Explorer open to a research folder.",
      activity:
        scenario.seed === "visual_frame_with_start_button"
          ? "Reviewing a workstation panel that includes a Start button."
          : "Reviewing a research folder in File Explorer.",
      objects:
        scenario.seed === "visual_frame_with_start_button"
          ? "workstation panel, Start button, status controls"
          : "File Explorer window, research folder, visible file list",
      confidence: 0.82,
    })
    .expect(200);
};

const readApiParityScenarioFilter = (): Set<string> | null => {
  const raw = process.env.HELIX_API_PARITY_SCENARIO_ID ?? process.env.HELIX_API_PARITY_SCENARIO_IDS;
  if (!raw?.trim()) return null;
  const ids = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return ids.length > 0 ? new Set(ids) : null;
};

const enabledParityScenarioFilter = readApiParityScenarioFilter();
const enabledParityScenarios = API_PARITY_SCENARIOS.filter((scenario) =>
  scenario.enabled && (!enabledParityScenarioFilter || enabledParityScenarioFilter.has(scenario.id)),
);

const buildCompleteCapabilityCatalogRailTable = (
  turnId: string,
  prompt: string,
): Record<string, unknown> => ({
  schema: CODEX_PARITY_AGENT_SPINE_RAIL_TABLE_SCHEMA,
  turn_id: turnId,
  prompt,
  requested_capability: null,
  visible_tool_surface: ["helix_ask.inspect_capability_catalog"],
  visible_tool_surface_original_count: 1,
  visible_tool_surface_truncated: false,
  selected_capability: "helix_ask.inspect_capability_catalog",
  admitted_capability: "helix_ask.inspect_capability_catalog",
  admission_proof_source: "operational_capability_trace.policy_admitted_capability",
  admission_proven: true,
  executed_capability: "helix_ask.inspect_capability_catalog",
  observation_kind: "capability_registry",
  observation_ref: `${turnId}:capability_registry_inspect:capability_registry:1`,
  required_observation_kinds_for_requested_capability: [],
  observed_artifact_supports_requested_capability: null,
  reentry_status: "reentered",
  reentry_proof_source: "capability_help_summary_materialized_from_catalog_observation",
  reentry_proven: true,
  goal_satisfaction: "satisfied",
  required_terminal_kind: "capability_help_summary",
  selected_terminal_kind: "capability_help_summary",
  terminal_authority_proof_source: "terminal_answer_authority.terminal_artifact_kind",
  terminal_authority_proven: true,
  visible_terminal_kind: "capability_help_summary",
  visible_projection_source: "terminal_presentation.terminal_artifact_kind",
  visible_projection_proven: true,
  first_broken_rail: null,
  repair_target: null,
  codex_parity_class: "complete",
  normalized_codex_parity_classes: [...CODEX_PARITY_CLASSES],
  rail_status: "complete",
  rail_failure_code: null,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
});

const buildCompleteCapabilityCatalogAskTurn = (railTable: Record<string, unknown>): Record<string, unknown> => ({
  turn_id: railTable.turn_id,
  final_status: "final_answer",
  response_type: "final_answer",
  final_answer_source: "capability_help_summary",
  terminal_artifact_kind: "capability_help_summary",
  selected_final_answer: "Helix Ask can use capability catalog tools.",
  codex_parity_agent_spine_rail_table: railTable,
  terminal_answer_authority: {
    server_authoritative: true,
    terminal_artifact_kind: "capability_help_summary",
    final_answer_source: "capability_help_summary",
  },
  route_authority_audit: {
    route_authority_ok: true,
    violation_codes: [],
  },
  poison_audit: {
    ok: true,
  },
  loop_parity_trace: {
    admitted_tool_families: ["capability_catalog"],
    actual_tool_calls: [{ tool_id: "helix_ask.inspect_capability_catalog", family: "capability_catalog" }],
    unexpected_tool_calls: [],
    observations_created: [{ kind: "capability_registry" }],
    evidence_selected_for_answer: [{ kind: "capability_registry" }],
    short_circuit_risk_flags: [],
  },
  ask_turn_solver_trace: {
    completed_solver_path: true,
    selected_primary_intent: "capability_catalog",
    primary_intent: { route: "capability_catalog" },
    prompt_interpretation: {
      prompt_shape: "capability_catalog",
      contextual_tool_mentions: [],
      executable_operator_commands: [],
    },
    solver_short_circuit_flags: [],
  },
  capability_selection_result: {
    capability_id: "helix_ask.inspect_capability_catalog",
  },
  capability_selection_trace: [{ selected_capability: "helix_ask.inspect_capability_catalog" }],
});

describe("Helix Ask API parity matrix", () => {
  beforeEach(resetAll);

  it("reconstructs the retained scientific-image comparison route when client metadata is absent", async () => {
    const app = createApp();
    const prompt =
      "Using the saved machine-readable page-8 text and the Image Lens crop, compare equation (47) row by row. Report the actual detected display-row count, symbol/subscript agreements, and mismatches. Do not promote exact-block evidence unless every displayed line and label agrees.";
    const ask = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "helix-ask:api-parity:scientific-image-route-recovery",
        question: prompt,
        mode: "read",
        debug: true,
      })
      .expect(200);
    const debug = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(ask.body.turn_id)}/debug-export`)
      .expect(200);
    const payload = debug.body?.payload ?? {};
    const committedRoute = payload.ask_turn_solver_trace?.committed_ask_route;

    expect(payload.ask_turn_procedure_trace).toMatchObject({
      route_proposal: expect.objectContaining({
        source: expect.not.stringMatching(/uncommitted_or_legacy/),
      }),
    });
    expect(committedRoute).toMatchObject({
      route: {
        source_target: "scientific_image_evidence",
      },
    });
    expect(committedRoute?.capability_policy?.required_capability_families ?? [])
      .not.toContain("visual_analysis");
    expect(payload.source_target_intent).toMatchObject({
      target_source: "scientific_image_evidence",
      suppressed_routes: expect.arrayContaining(["fresh_image_lens_capture"]),
    });
    expect(payload.source_target_intent).not.toHaveProperty("mandatory_next_tool");
    expect(String(payload.selected_final_answer ?? "")).not.toContain("Reattach it and resend");
  }, 60_000);

  it("overrides conflicting client research-library metadata for retained scientific-image comparison", async () => {
    const app = createApp();
    const prompt =
      "Using the saved machine-readable page-8 text and the latest retained scientific Image Lens sidecar for https://arxiv.org/pdf/2401.12345, compare equation (47) row by row. Report symbol and subscript agreements and mismatches. Do not render the PDF again, do not run a new Image Lens crop, and do not promote exact evidence unless the two sources agree.";
    const ask = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "helix-ask:api-parity:scientific-image-conflicting-research-route",
        question: prompt,
        mode: "read",
        debug: true,
        source_target_intent: {
          schema: "helix.ask_source_target_intent.v1",
          target_source: "research_library",
          target_kind: "saved_research_document",
          strength: "hard",
          requested_capability: "research-library.read_document",
          must_enter_backend_ask: true,
          allow_client_shortcut: false,
        },
      })
      .expect(200);
    const debug = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(ask.body.turn_id)}/debug-export`)
      .expect(200);
    const payload = debug.body?.payload ?? {};
    const committedRoute = payload.ask_turn_solver_trace?.committed_ask_route;

    expect(committedRoute).toMatchObject({
      route: {
        source_target: "scientific_image_evidence",
        strength: "hard",
      },
      terminal_product: {
        evidence_reentry_required: true,
        followup_reasoning_required: true,
      },
    });
    expect(committedRoute?.capability_policy?.required_capability_families ?? [])
      .not.toContain("visual_analysis");
    expect(payload.source_target_intent).toMatchObject({
      target_source: "scientific_image_evidence",
      reuse_retained_scientific_image_sidecar: true,
      suppressed_routes: expect.arrayContaining(["fresh_image_lens_crop"]),
    });
    expect(payload.canonical_goal_frame).toMatchObject({
      goal_kind: "scholarly_research",
      required_terminal_kind: "scholarly_research_answer",
    });
    expect(payload.ask_turn_procedure_trace?.route_proposal?.requested_capability)
      .not.toBe("research-library.read_document");
  }, 60_000);

  it("reconstructs the retained scientific-image comparison route on the UI stream path", async () => {
    const app = createApp();
    const prompt =
      "Using the saved machine-readable page-8 text and the Image Lens crop, compare equation (47) row by row. Report the actual detected display-row count, symbol/subscript agreements, and mismatches. Do not promote exact-block evidence unless every displayed line and label agrees.";
    const stream = await request(app)
      .post("/api/agi/ask/turn/stream")
      .send({
        sessionId: "helix-ask:api-parity:scientific-image-stream-route-recovery",
        question: prompt,
        mode: "read",
        debug: true,
        source_target_intent: {
          schema: "helix.ask_source_target_intent.v1",
          target_source: "model_only",
          target_kind: "general_background",
          strength: "hard",
          must_enter_backend_ask: false,
          allow_client_shortcut: true,
          allow_no_tool_direct: true,
        },
        })
      .expect(200);
    const turnFinal = parseSseEvents(stream.text).find((entry) => entry.event === "turn_final")?.data;
    expect(turnFinal?.turn_id).toEqual(expect.any(String));
    const debug = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(String(turnFinal?.turn_id))}/debug-export`)
      .expect(200);
    const payload = debug.body?.payload ?? {};

    expect(payload.ask_turn_solver_trace?.committed_ask_route).toMatchObject({
      route: {
        source_target: "scientific_image_evidence",
      },
    });
    expect(payload.ask_turn_solver_trace?.committed_ask_route?.capability_policy?.required_capability_families ?? [])
      .not.toContain("visual_analysis");
    expect(payload.source_target_intent).toMatchObject({
      target_source: "scientific_image_evidence",
      suppressed_routes: expect.arrayContaining(["fresh_image_lens_capture"]),
    });
  }, 60_000);

  it.each(enabledParityScenarios)("$id stays procedural through top-level Ask", async (scenario) => {
    const app = createApp();
    const threadId = `helix-ask:api-parity:${scenario.id}`;
    await seedScenario(app, scenario, threadId);

    const ask = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: threadId,
        question: scenario.prompt,
        mode: "read",
        debug: true,
      })
      .expect(200);
    const debug = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(ask.body.turn_id)}/debug-export`)
      .expect(200);
    const railTable = debug.body?.payload?.codex_parity_agent_spine_rail_table;
    const debugRailTable = debug.body?.payload?.debug?.codex_parity_agent_spine_rail_table;
    const indexedRailTable = debug.body?.payload?.artifact_query_index?.codex_parity_agent_spine_rail_table;
    const debugIndexedRailTable = debug.body?.payload?.debug?.artifact_query_index?.codex_parity_agent_spine_rail_table;
    expect(railTable && typeof railTable === "object" && !Array.isArray(railTable)).toBe(true);
    expect(debugRailTable && typeof debugRailTable === "object" && !Array.isArray(debugRailTable)).toBe(true);
    expect(indexedRailTable && typeof indexedRailTable === "object" && !Array.isArray(indexedRailTable)).toBe(true);
    expect(debugIndexedRailTable && typeof debugIndexedRailTable === "object" && !Array.isArray(debugIndexedRailTable)).toBe(true);
    expectCodexParityRailTableShape(railTable as Record<string, unknown>, ask.body.turn_id);
    expectCodexParityRailTableShape(debugRailTable as Record<string, unknown>, ask.body.turn_id);
    expectCodexParityRailTableShape(indexedRailTable as Record<string, unknown>, ask.body.turn_id);
    expectCodexParityRailTableShape(debugIndexedRailTable as Record<string, unknown>, ask.body.turn_id);
    expect(debugRailTable).toMatchObject({
      codex_parity_class: railTable.codex_parity_class,
      first_broken_rail: railTable.first_broken_rail,
      repair_target: railTable.repair_target,
    });
    expect(indexedRailTable).toMatchObject({
      codex_parity_class: railTable.codex_parity_class,
      first_broken_rail: railTable.first_broken_rail,
      repair_target: railTable.repair_target,
    });
    expect(debugIndexedRailTable).toMatchObject({
      codex_parity_class: railTable.codex_parity_class,
      first_broken_rail: railTable.first_broken_rail,
      repair_target: railTable.repair_target,
    });
    expect(debugRailTable).toEqual(railTable);
    expect(indexedRailTable).toEqual(railTable);
    expect(debugIndexedRailTable).toEqual(railTable);
    if (railTable.codex_parity_class === "complete") {
      expect(railTable.first_broken_rail).toBeNull();
    } else {
      expect(typeof railTable.first_broken_rail).toBe("string");
    }
    const probe = buildApiParityProbeResult({
      scenario,
      askTurn: ask.body,
      debugExport: debug.body,
      terminalEventSeen: true,
      streamClosedAfterTerminal: true,
    });
    expect(probe).toMatchObject({
      schema: "helix.api_parity_probe_result.v1",
      scenario_id: scenario.id,
      debug_export_available: true,
      terminal_authority_ok: true,
      terminal_failure_reconciliation_runtime: {
        available: true,
        version: HELIX_TOOL_RAIL_TERMINAL_FAILURE_RECONCILIATION_VERSION,
        current: true,
      },
      rail_table: {
        present: true,
        turn_id: railTable.turn_id,
        prompt: railTable.prompt,
        visible_tool_surface: railTable.visible_tool_surface,
        codex_parity_class: railTable.codex_parity_class,
        normalized_codex_parity_classes: railTable.normalized_codex_parity_classes,
        first_broken_rail: railTable.first_broken_rail,
        repair_target: railTable.repair_target,
        observation_ref: railTable.observation_ref,
        selected_terminal_kind: railTable.selected_terminal_kind,
        visible_terminal_kind: railTable.visible_terminal_kind,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      procedural_ok: true,
      failures: [],
    });
    expect(probe.rail_table.selected_terminal_kind).toBe(probe.rail_table.visible_terminal_kind);
    if (probe.rail_table.codex_parity_class === "complete") {
      expect(probe.rail_table.first_broken_rail).toBeNull();
    } else {
      expect(typeof probe.rail_table.first_broken_rail).toBe("string");
      expect(probe.rail_table.first_broken_rail?.length).toBeGreaterThan(0);
    }
    if (scenario.expected.live_source_identity_ok !== false) {
      expect(probe.route_authority.ok).toBe(true);
    }
    expect(probe.loop_parity_trace.unexpected_tool_calls).toEqual([]);
    const continuationAccepted =
      Boolean(probe.solver_continuation_observation?.reason) &&
      probe.solver_continuation_count !== undefined &&
      probe.solver_continuation_count > 0;
    if (scenario.expected.live_source_identity_ok !== false && !continuationAccepted) {
      expect(probe.loop_parity_trace.short_circuit_risk_flags).toEqual([]);
      expect(probe.ask_turn_solver_trace.solver_short_circuit_flags).toEqual([]);
    }
    if (scenario.expected.live_source_identity_ok !== false) {
      expect(probe.poison_audit_ok && !probe.route_authority.ok).toBe(false);
    }
  }, 120_000);

  it("rejects a complete rail table when the answer envelope is still a typed failure", () => {
    const scenario: HelixApiParityScenario = {
      id: "complete_rail_typed_failure_envelope",
      description: "A complete rail cannot mask a failed visible/API terminal envelope.",
      enabled: true,
      seed: "none",
      prompt: "What tools are available for the helix ask to use?",
      expected: {},
    };
    const railTable = {
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      turn_id: "ask:test:complete-rail-typed-failure",
      prompt: scenario.prompt,
      requested_capability: null,
      visible_tool_surface: ["helix_ask.inspect_capability_catalog"],
      selected_capability: "helix_ask.inspect_capability_catalog",
      admitted_capability: "helix_ask.inspect_capability_catalog",
      admission_proof_source: "tool_call_admission_decision.admitted_capability",
      admission_proven: true,
      executed_capability: "helix_ask.inspect_capability_catalog",
      observation_kind: "capability_registry",
      observation_ref: "capability_catalog_observation",
      required_observation_kinds_for_requested_capability: [],
      observed_artifact_supports_requested_capability: null,
      reentry_status: "reentered",
      reentry_proof_source: "tool_followup_decision.evidence_reentered",
      reentry_proven: true,
      goal_satisfaction: "satisfied",
      required_terminal_kind: "capability_help_summary",
      selected_terminal_kind: "capability_help_summary",
      terminal_authority_proof_source: "terminal_answer_authority.terminal_artifact_kind",
      terminal_authority_proven: true,
      visible_terminal_kind: "capability_help_summary",
      visible_projection_source: "terminal_presentation.terminal_artifact_kind",
      visible_projection_proven: true,
      first_broken_rail: null,
      repair_target: null,
      codex_parity_class: "complete",
      normalized_codex_parity_classes: [...CODEX_PARITY_CLASSES],
      rail_status: "complete",
      rail_failure_code: null,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    const askTurn = {
      turn_id: railTable.turn_id,
      final_status: "final_failure",
      response_type: "final_failure",
      terminal_error_code: "terminal_kind_not_required",
      final_answer_source: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      selected_final_answer:
        "I could not complete this Ask turn because solver controller blocked terminal answer (terminal_kind_not_required).",
      codex_parity_agent_spine_rail_table: railTable,
      ask_turn_solver_trace: {
        completed_solver_path: true,
        selected_primary_intent: "capability_help",
        solver_short_circuit_flags: [],
      },
      loop_parity_trace: {
        admitted_tool_families: ["capability_catalog"],
        actual_tool_calls: [],
        unexpected_tool_calls: [],
        short_circuit_risk_flags: [],
      },
      route_authority_audit: {
        route_authority_ok: true,
        violation_codes: [],
      },
      poison_audit: {
        ok: true,
      },
      terminal_answer_authority: {
        server_authoritative: true,
        final_answer_source: "typed_failure",
        terminal_artifact_kind: "typed_failure",
      },
    };

    const probe = buildApiParityProbeResult({
      scenario,
      askTurn,
      debugExport: { payload: askTurn },
      terminalEventSeen: true,
      streamClosedAfterTerminal: true,
    });

    expect(probe.procedural_ok).toBe(false);
    expect(probe.failures).toEqual(
      expect.arrayContaining([
        "complete_rail_terminal_error:terminal_kind_not_required",
        "complete_rail_typed_failure_terminal",
        "complete_rail_non_final_response:final_failure/final_failure",
      ]),
    );
  });

  it("rejects stale or answer-like rail table mirrors", () => {
    const scenario: HelixApiParityScenario = {
      id: "rail_table_debug_identity_stale",
      description: "A successful-looking answer cannot hide a stale or answer-bearing rail mirror.",
      enabled: true,
      seed: "none",
      prompt: "What tools are available for the helix ask to use?",
      expected: {},
    };
    const actualTurnId = "ask:test:actual-rail-debug-identity";
    const railTable = {
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      turn_id: "ask:test:stale-rail-debug-identity",
      prompt: scenario.prompt,
      requested_capability: "helix_ask.inspect_capability_catalog",
      visible_tool_surface: ["helix_ask.inspect_capability_catalog"],
      selected_capability: "helix_ask.inspect_capability_catalog",
      admitted_capability: "helix_ask.inspect_capability_catalog",
      admission_proof_source: "tool_call_admission_decision.admitted_capability",
      admission_proven: true,
      executed_capability: "helix_ask.inspect_capability_catalog",
      observation_kind: "capability_registry",
      observation_ref: "capability_catalog_observation",
      required_observation_kinds_for_requested_capability: ["capability_registry"],
      observed_artifact_supports_requested_capability: true,
      reentry_status: "reentered",
      reentry_proof_source: "tool_followup_decision.evidence_reentered",
      reentry_proven: true,
      goal_satisfaction: "satisfied",
      required_terminal_kind: "capability_help_summary",
      selected_terminal_kind: "capability_help_summary",
      terminal_authority_proof_source: "terminal_answer_authority.terminal_artifact_kind",
      terminal_authority_proven: true,
      visible_terminal_kind: "capability_help_summary",
      visible_projection_source: "terminal_presentation.terminal_artifact_kind",
      visible_projection_proven: true,
      first_broken_rail: null,
      repair_target: null,
      codex_parity_class: "complete",
      normalized_codex_parity_classes: [...CODEX_PARITY_CLASSES],
      rail_status: "complete",
      rail_failure_code: null,
      assistant_answer: true,
      terminal_eligible: true,
      raw_content_included: true,
    };
    const askTurn = {
      turn_id: actualTurnId,
      final_status: "final_answer",
      response_type: "final_answer",
      final_answer_source: "capability_help_summary",
      terminal_artifact_kind: "capability_help_summary",
      selected_final_answer: "The available Helix Ask tools are exposed through the runtime capability catalog.",
      codex_parity_agent_spine_rail_table: railTable,
      ask_turn_solver_trace: {
        completed_solver_path: true,
        selected_primary_intent: "capability_help",
        solver_short_circuit_flags: [],
      },
      loop_parity_trace: {
        admitted_tool_families: ["capability_catalog"],
        actual_tool_calls: [],
        unexpected_tool_calls: [],
        short_circuit_risk_flags: [],
      },
      route_authority_audit: {
        route_authority_ok: true,
        violation_codes: [],
      },
      poison_audit: {
        ok: true,
      },
      terminal_answer_authority: {
        server_authoritative: true,
        final_answer_source: "capability_help_summary",
        terminal_artifact_kind: "capability_help_summary",
      },
    };

    const probe = buildApiParityProbeResult({
      scenario,
      askTurn,
      debugExport: { payload: askTurn },
      terminalEventSeen: true,
      streamClosedAfterTerminal: true,
    });

    expect(probe.procedural_ok).toBe(false);
    expect(probe.rail_table).toMatchObject({
      turn_id: railTable.turn_id,
      assistant_answer: true,
      terminal_eligible: true,
      raw_content_included: true,
    });
    expect(probe.failures).toEqual(
      expect.arrayContaining([
        `rail_turn_id_mismatch:${railTable.turn_id}!=${actualTurnId}`,
        "rail_assistant_answer_not_false",
        "rail_terminal_eligible_not_false",
        "rail_raw_content_included_not_false",
      ]),
    );
  });

  it("rejects API/debug bundles without a current terminal failure reconciliation runtime marker", () => {
    const scenario: HelixApiParityScenario = {
      id: "terminal_failure_reconciliation_runtime_marker_stale",
      description: "The API probe must identify stale server bundles that predate rail-terminal reconciliation.",
      enabled: true,
      seed: "none",
      prompt: "What tools are available for the helix ask to use?",
      expected: {},
    };
    const railTable = buildCompleteCapabilityCatalogRailTable(
      "ask:test:terminal-failure-reconciliation-marker",
      scenario.prompt,
    );
    const askTurn = buildCompleteCapabilityCatalogAskTurn(railTable);

    const missingMarkerProbe = buildApiParityProbeResult({
      scenario,
      askTurn,
      debugExport: { payload: askTurn },
      terminalEventSeen: true,
      streamClosedAfterTerminal: true,
    });

    expect(missingMarkerProbe.procedural_ok).toBe(false);
    expect(missingMarkerProbe.failures).toContain(
      "debug_mirror_stale:tool_rail_terminal_failure_reconciliation_runtime_missing",
    );

    const staleMarkerProbe = buildApiParityProbeResult({
      scenario,
      askTurn: {
        ...askTurn,
        tool_rail_terminal_failure_reconciliation_runtime: {
          schema: "helix.tool_rail_terminal_failure_reconciliation.runtime.v1",
          version: "stale.localhost.bundle",
          available: true,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      debugExport: { payload: askTurn },
      terminalEventSeen: true,
      streamClosedAfterTerminal: true,
    });

    expect(staleMarkerProbe.procedural_ok).toBe(false);
    expect(staleMarkerProbe.failures).toContain(
      `debug_mirror_stale:tool_rail_terminal_failure_reconciliation_runtime_version:stale.localhost.bundle!=${HELIX_TOOL_RAIL_TERMINAL_FAILURE_RECONCILIATION_VERSION}`,
    );
    expect(staleMarkerProbe.terminal_failure_reconciliation_runtime).toMatchObject({
      available: true,
      version: "stale.localhost.bundle",
      current: false,
    });
  });

  it("rejects a rail table whose normalized parity-class contract drifted", () => {
    const scenario: HelixApiParityScenario = {
      id: "rail_table_class_contract_drift",
      description: "A successful-looking answer cannot hide a stale rail-class mirror.",
      enabled: true,
      seed: "none",
      prompt: "What tools are available for the helix ask to use?",
      expected: {},
    };
    const railTable = {
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      turn_id: "ask:test:rail-class-contract-drift",
      prompt: scenario.prompt,
      requested_capability: "helix_ask.inspect_capability_catalog",
      visible_tool_surface: ["helix_ask.inspect_capability_catalog"],
      selected_capability: "helix_ask.inspect_capability_catalog",
      admitted_capability: "helix_ask.inspect_capability_catalog",
      admission_proof_source: "tool_call_admission_decision.admitted_capability",
      admission_proven: true,
      executed_capability: "helix_ask.inspect_capability_catalog",
      observation_kind: "capability_registry",
      observation_ref: "capability_catalog_observation",
      required_observation_kinds_for_requested_capability: ["capability_registry"],
      observed_artifact_supports_requested_capability: true,
      reentry_status: "reentered",
      reentry_proof_source: "tool_followup_decision.evidence_reentered",
      reentry_proven: true,
      goal_satisfaction: "satisfied",
      required_terminal_kind: "capability_help_summary",
      selected_terminal_kind: "capability_help_summary",
      terminal_authority_proof_source: "terminal_answer_authority.terminal_artifact_kind",
      terminal_authority_proven: true,
      visible_terminal_kind: "capability_help_summary",
      visible_projection_source: "terminal_presentation.terminal_artifact_kind",
      visible_projection_proven: true,
      first_broken_rail: null,
      repair_target: null,
      codex_parity_class: "complete",
      normalized_codex_parity_classes: CODEX_PARITY_CLASSES.filter((entry) => entry !== "debug_mirror_stale"),
      rail_status: "complete",
      rail_failure_code: null,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    const askTurn = {
      turn_id: railTable.turn_id,
      final_status: "final_answer",
      response_type: "final_answer",
      final_answer_source: "capability_help_summary",
      terminal_artifact_kind: "capability_help_summary",
      selected_final_answer: "The available Helix Ask tools are exposed through the runtime capability catalog.",
      codex_parity_agent_spine_rail_table: railTable,
      ask_turn_solver_trace: {
        completed_solver_path: true,
        selected_primary_intent: "capability_help",
        solver_short_circuit_flags: [],
      },
      loop_parity_trace: {
        admitted_tool_families: ["capability_catalog"],
        actual_tool_calls: [],
        unexpected_tool_calls: [],
        short_circuit_risk_flags: [],
      },
      route_authority_audit: {
        route_authority_ok: true,
        violation_codes: [],
      },
      poison_audit: {
        ok: true,
      },
      terminal_answer_authority: {
        server_authoritative: true,
        final_answer_source: "capability_help_summary",
        terminal_artifact_kind: "capability_help_summary",
      },
    };

    const probe = buildApiParityProbeResult({
      scenario,
      askTurn,
      debugExport: { payload: askTurn },
      terminalEventSeen: true,
      streamClosedAfterTerminal: true,
    });

    expect(probe.procedural_ok).toBe(false);
    expect(probe.failures).toContain("rail_normalized_codex_parity_classes_mismatch");
    expect(probe.failures).not.toContain("complete_rail_typed_failure_terminal");
  });

  it("rejects non-complete rails without failure and repair handles", () => {
    const scenario: HelixApiParityScenario = {
      id: "rail_table_broken_handles_missing",
      description: "A fail-closed rail must expose the first broken rail, failure code, and repair target.",
      enabled: true,
      seed: "none",
      prompt: "Use docs-viewer.locate_in_doc to cite where this claim appears.",
      expected: {},
    };
    const railTable = {
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      turn_id: "ask:test:broken-handles-missing",
      prompt: scenario.prompt,
      requested_capability: "docs-viewer.locate_in_doc",
      visible_tool_surface: ["docs-viewer.locate_in_doc"],
      selected_capability: "docs-viewer.locate_in_doc",
      admitted_capability: "docs-viewer.locate_in_doc",
      admission_proof_source: "tool_call_admission_decision.admitted_capability",
      admission_proven: true,
      executed_capability: "docs-viewer.locate_in_doc",
      observation_kind: null,
      observation_ref: null,
      required_observation_kinds_for_requested_capability: ["doc_location_matches"],
      observed_artifact_supports_requested_capability: false,
      reentry_status: "no_observation",
      reentry_proof_source: null,
      reentry_proven: false,
      goal_satisfaction: "not_satisfied",
      required_terminal_kind: "doc_location_matches",
      selected_terminal_kind: "typed_failure",
      terminal_authority_proof_source: "terminal_answer_authority.terminal_artifact_kind",
      terminal_authority_proven: true,
      visible_terminal_kind: "typed_failure",
      visible_projection_source: "terminal_presentation.terminal_artifact_kind",
      visible_projection_proven: true,
      first_broken_rail: "observation_artifact",
      repair_target: null,
      codex_parity_class: "observation_missing",
      normalized_codex_parity_classes: [...CODEX_PARITY_CLASSES],
      rail_status: "fail_closed",
      rail_failure_code: null,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    const askTurn = {
      turn_id: railTable.turn_id,
      final_status: "final_failure",
      response_type: "final_failure",
      terminal_error_code: "observation_missing",
      final_answer_source: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      selected_final_answer: "I could not complete this turn because the requested observation was missing.",
      codex_parity_agent_spine_rail_table: railTable,
      ask_turn_solver_trace: {
        completed_solver_path: false,
        selected_primary_intent: "locate_in_doc",
        solver_short_circuit_flags: [],
      },
      loop_parity_trace: {
        admitted_tool_families: ["docs_viewer"],
        actual_tool_calls: [],
        unexpected_tool_calls: [],
        short_circuit_risk_flags: [],
      },
      route_authority_audit: {
        route_authority_ok: true,
        violation_codes: [],
      },
      poison_audit: {
        ok: true,
      },
      terminal_answer_authority: {
        server_authoritative: true,
        final_answer_source: "typed_failure",
        terminal_artifact_kind: "typed_failure",
      },
    };

    const probe = buildApiParityProbeResult({
      scenario,
      askTurn,
      debugExport: { payload: askTurn },
      terminalEventSeen: true,
      streamClosedAfterTerminal: true,
    });

    expect(probe.procedural_ok).toBe(false);
    expect(probe.failures).toEqual(
      expect.arrayContaining([
        "rail_non_complete_without_rail_failure_code",
        "rail_non_complete_without_repair_target",
      ]),
    );

    const invalidVocabularyRailTable = {
      ...railTable,
      visible_tool_surface: ["docs-viewer.locate_in_doc", ""],
      visible_tool_surface_original_count: 1,
      visible_tool_surface_truncated: true,
      required_observation_kinds_for_requested_capability: ["doc_location_matches", 7],
      normalized_codex_parity_classes: [...CODEX_PARITY_CLASSES, 7],
      first_broken_rail: "made_up_rail",
      repair_target: "unknown_layer",
      rail_failure_code: "repo_evidence_weak_after_repair",
    };
    const invalidVocabularyProbe = buildApiParityProbeResult({
      scenario,
      askTurn: {
        ...askTurn,
        codex_parity_agent_spine_rail_table: invalidVocabularyRailTable,
      },
      debugExport: { payload: { ...askTurn, codex_parity_agent_spine_rail_table: invalidVocabularyRailTable } },
      terminalEventSeen: true,
      streamClosedAfterTerminal: true,
    });

    expect(invalidVocabularyProbe.procedural_ok).toBe(false);
    expect(invalidVocabularyProbe.failures).toEqual(
      expect.arrayContaining([
        "rail_first_broken_rail_invalid:made_up_rail",
        "rail_failure_code_invalid:repo_evidence_weak_after_repair",
        "rail_normalized_codex_parity_classes_entries_invalid",
        "rail_repair_target_invalid:unknown_layer",
        "rail_required_observation_kinds_entries_invalid",
        "rail_visible_tool_surface_original_count_less_than_surface",
        "rail_visible_tool_surface_truncated_without_hidden_entries",
        "rail_visible_tool_surface_entries_invalid",
      ]),
    );

    const emptyObservationContractRailTable = {
      ...railTable,
      repair_target: "observation_materializer",
      rail_failure_code: "observation_missing",
      required_observation_kinds_for_requested_capability: [],
    };
    const emptyObservationContractProbe = buildApiParityProbeResult({
      scenario,
      askTurn: {
        ...askTurn,
        codex_parity_agent_spine_rail_table: emptyObservationContractRailTable,
      },
      debugExport: { payload: { ...askTurn, codex_parity_agent_spine_rail_table: emptyObservationContractRailTable } },
      terminalEventSeen: true,
      streamClosedAfterTerminal: true,
    });

    expect(emptyObservationContractProbe.procedural_ok).toBe(false);
    expect(emptyObservationContractProbe.failures).toContain("rail_requested_observation_kinds_empty");
  });

  it("rejects stale budget exhaustion when a fail-closed rail already names the missing observation", () => {
    const scenario: HelixApiParityScenario = {
      id: "fail_closed_rail_stale_budget_exhaustion",
      description: "A fail-closed observation rail must not leave the public envelope on generic budget exhaustion.",
      enabled: true,
      seed: "none",
      prompt: "Use live_env.read_processed_live_source_mail to inspect the latest processed live-source mail.",
      expected: {
        solver_completed: false,
      },
    };
    const railTable = {
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      turn_id: "ask:test:stale-budget-fail-closed-rail",
      prompt: scenario.prompt,
      requested_capability: "live_env.read_processed_live_source_mail",
      visible_tool_surface: ["live_env.read_processed_live_source_mail"],
      visible_tool_surface_original_count: 1,
      visible_tool_surface_truncated: false,
      selected_capability: "live_env.read_processed_live_source_mail",
      admitted_capability: "live_env.read_processed_live_source_mail",
      admission_proof_source: "tool_call_admission_decision.selected_capability",
      admission_proven: true,
      executed_capability: "live_env.read_processed_live_source_mail",
      observation_kind: "reasoning_context",
      observation_ref: "ask:test:reasoning_context:1",
      required_observation_kinds_for_requested_capability: ["stage_play_processed_mail_packet"],
      observed_artifact_supports_requested_capability: false,
      reentry_status: "reentered",
      reentry_proof_source: "tool_lifecycle_trace.lifecycle_stage",
      reentry_proven: true,
      goal_satisfaction: "not_satisfied",
      required_terminal_kind: "model_synthesized_answer",
      selected_terminal_kind: "typed_failure",
      terminal_authority_proof_source: "terminal_answer_authority.terminal_artifact_kind",
      terminal_authority_proven: true,
      visible_terminal_kind: "typed_failure",
      visible_projection_source: "terminal_presentation.terminal_artifact_kind",
      visible_projection_proven: true,
      first_broken_rail: "observation_artifact",
      repair_target: "observation_materializer",
      codex_parity_class: "observation_missing",
      normalized_codex_parity_classes: [...CODEX_PARITY_CLASSES],
      rail_status: "fail_closed",
      rail_failure_code: "required_observation_missing",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    const askTurn = {
      turn_id: railTable.turn_id,
      final_status: "final_failure",
      response_type: "final_failure",
      terminal_error_code: "agent_loop_budget_exhausted",
      final_answer_source: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      selected_final_answer:
        "I could not complete this turn because the agent loop exhausted its max tool calls budget before satisfying the goal.",
      codex_parity_agent_spine_rail_table: railTable,
      ask_turn_solver_trace: {
        completed_solver_path: false,
        selected_primary_intent: "live_source_mailbox",
        solver_short_circuit_flags: [],
      },
      loop_parity_trace: {
        admitted_tool_families: ["live_environment"],
        actual_tool_calls: ["live_env.read_processed_live_source_mail"],
        unexpected_tool_calls: [],
        short_circuit_risk_flags: [],
      },
      route_authority_audit: {
        route_authority_ok: true,
        violation_codes: [],
      },
      poison_audit: {
        ok: true,
      },
      terminal_answer_authority: {
        server_authoritative: true,
        final_answer_source: "typed_failure",
        terminal_artifact_kind: "typed_failure",
        terminal_error_code: "agent_loop_budget_exhausted",
      },
      terminal_presentation: {
        terminal_artifact_kind: "typed_failure",
        terminal_error_code: "agent_loop_budget_exhausted",
      },
    };

    const probe = buildApiParityProbeResult({
      scenario,
      askTurn,
      debugExport: { payload: askTurn },
      terminalEventSeen: true,
      streamClosedAfterTerminal: true,
    });

    expect(probe.procedural_ok).toBe(false);
    expect(probe.failures).toContain("fail_closed_rail_stale_budget_exhaustion:agent_loop_budget_exhausted");
  });

  it("rejects fail-closed rails that project as normal final answers", () => {
    const scenario: HelixApiParityScenario = {
      id: "fail_closed_rail_normal_answer_projection",
      description: "A fail-closed rail must project as a typed failure, not as a normal final answer.",
      enabled: true,
      seed: "none",
      prompt: "Use live_env.read_processed_live_source_mail to inspect the latest processed live-source mail.",
      expected: {
        solver_completed: false,
      },
    };
    const railTable = {
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      turn_id: "ask:test:fail-closed-normal-answer-projection",
      prompt: scenario.prompt,
      requested_capability: "live_env.read_processed_live_source_mail",
      visible_tool_surface: ["live_env.read_processed_live_source_mail"],
      visible_tool_surface_original_count: 1,
      visible_tool_surface_truncated: false,
      selected_capability: "live_env.read_processed_live_source_mail",
      admitted_capability: "live_env.read_processed_live_source_mail",
      admission_proof_source: "tool_call_admission_decision.selected_capability",
      admission_proven: true,
      executed_capability: "live_env.read_processed_live_source_mail",
      observation_kind: "reasoning_context",
      observation_ref: "ask:test:reasoning_context:1",
      required_observation_kinds_for_requested_capability: ["stage_play_processed_mail_packet"],
      observed_artifact_supports_requested_capability: false,
      reentry_status: "reentered",
      reentry_proof_source: "tool_lifecycle_trace.lifecycle_stage",
      reentry_proven: true,
      goal_satisfaction: "not_satisfied",
      required_terminal_kind: "model_synthesized_answer",
      selected_terminal_kind: "model_synthesized_answer",
      terminal_authority_proof_source: "terminal_answer_authority.terminal_artifact_kind",
      terminal_authority_proven: true,
      visible_terminal_kind: "model_synthesized_answer",
      visible_projection_source: "terminal_presentation.terminal_artifact_kind",
      visible_projection_proven: true,
      first_broken_rail: "observation_artifact",
      repair_target: "observation_materializer",
      codex_parity_class: "observation_missing",
      normalized_codex_parity_classes: [...CODEX_PARITY_CLASSES],
      rail_status: "fail_closed",
      rail_failure_code: "required_observation_missing",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    const askTurn = {
      turn_id: railTable.turn_id,
      final_status: "final_answer",
      response_type: "final_answer",
      final_answer_source: "model_synthesized_answer",
      terminal_artifact_kind: "model_synthesized_answer",
      selected_final_answer: "Here is a normal-looking answer without the required mailbox observation.",
      codex_parity_agent_spine_rail_table: railTable,
      tool_rail_terminal_failure_reconciliation_runtime: {
        schema: "helix.tool_rail_terminal_failure_reconciliation.runtime.v1",
        version: HELIX_TOOL_RAIL_TERMINAL_FAILURE_RECONCILIATION_VERSION,
        available: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      ask_turn_solver_trace: {
        completed_solver_path: false,
        selected_primary_intent: "live_source_mailbox",
        solver_short_circuit_flags: [],
      },
      loop_parity_trace: {
        admitted_tool_families: ["live_environment"],
        actual_tool_calls: ["live_env.read_processed_live_source_mail"],
        unexpected_tool_calls: [],
        short_circuit_risk_flags: [],
      },
      route_authority_audit: {
        route_authority_ok: true,
        violation_codes: [],
      },
      poison_audit: {
        ok: true,
      },
      terminal_answer_authority: {
        server_authoritative: true,
        final_answer_source: "model_synthesized_answer",
        terminal_artifact_kind: "model_synthesized_answer",
      },
      terminal_presentation: {
        terminal_artifact_kind: "model_synthesized_answer",
      },
    };

    const probe = buildApiParityProbeResult({
      scenario,
      askTurn,
      debugExport: { payload: askTurn },
      terminalEventSeen: true,
      streamClosedAfterTerminal: true,
    });

    expect(probe.procedural_ok).toBe(false);
    expect(probe.failures).toEqual(
      expect.arrayContaining([
        "fail_closed_rail_missing_terminal_error_code",
        "fail_closed_rail_not_typed_failure:model_synthesized_answer/model_synthesized_answer",
        "fail_closed_rail_non_failure_response:final_answer/final_answer",
      ]),
    );
  });

  it("rejects selected or executed capability progress without admission proof", () => {
    const scenario: HelixApiParityScenario = {
      id: "rail_table_admission_proof_missing",
      description: "Selected/executed capability progress must be backed by an admitted capability rail.",
      enabled: true,
      seed: "none",
      prompt: "Use workspace_os.status to inspect workstation status.",
      expected: {},
    };
    const railTable = {
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      turn_id: "ask:test:admission-proof-missing",
      prompt: scenario.prompt,
      requested_capability: "workspace_os.status",
      visible_tool_surface: ["workspace_os.status"],
      selected_capability: "workspace_os.status",
      admitted_capability: null,
      admission_proof_source: null,
      admission_proven: false,
      executed_capability: "workspace_os.status",
      observation_kind: "workspace_os_status_observation",
      observation_ref: "workspace_os_status_observation:test",
      required_observation_kinds_for_requested_capability: ["workspace_os_status_observation"],
      observed_artifact_supports_requested_capability: true,
      reentry_status: "reentered",
      reentry_proof_source: "tool_followup_decision.evidence_reentered",
      reentry_proven: true,
      goal_satisfaction: "satisfied",
      required_terminal_kind: "model_synthesized_answer",
      selected_terminal_kind: "model_synthesized_answer",
      terminal_authority_proof_source: "terminal_answer_authority.terminal_artifact_kind",
      terminal_authority_proven: true,
      visible_terminal_kind: "model_synthesized_answer",
      visible_projection_source: "terminal_presentation.terminal_artifact_kind",
      visible_projection_proven: true,
      first_broken_rail: null,
      repair_target: null,
      codex_parity_class: "complete",
      normalized_codex_parity_classes: [...CODEX_PARITY_CLASSES],
      rail_status: "complete",
      rail_failure_code: null,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    const askTurn = {
      turn_id: railTable.turn_id,
      final_status: "final_answer",
      response_type: "final_answer",
      final_answer_source: "model_synthesized_answer",
      terminal_artifact_kind: "model_synthesized_answer",
      selected_final_answer: "Workspace OS status returned capability records.",
      codex_parity_agent_spine_rail_table: railTable,
      ask_turn_solver_trace: {
        completed_solver_path: true,
        selected_primary_intent: "workspace_status",
        solver_short_circuit_flags: [],
      },
      loop_parity_trace: {
        admitted_tool_families: ["workspace_action"],
        actual_tool_calls: [],
        unexpected_tool_calls: [],
        short_circuit_risk_flags: [],
      },
      route_authority_audit: {
        route_authority_ok: true,
        violation_codes: [],
      },
      poison_audit: {
        ok: true,
      },
      terminal_answer_authority: {
        server_authoritative: true,
        final_answer_source: "model_synthesized_answer",
        terminal_artifact_kind: "model_synthesized_answer",
      },
    };

    const probe = buildApiParityProbeResult({
      scenario,
      askTurn,
      debugExport: { payload: askTurn },
      terminalEventSeen: true,
      streamClosedAfterTerminal: true,
    });

    expect(probe.procedural_ok).toBe(false);
    expect(probe.failures).toContain("rail_admitted_capability_missing");
  });

  it("rejects satisfied requested-capability goals without matching observation support", () => {
    const scenario: HelixApiParityScenario = {
      id: "rail_table_requested_observation_support_missing",
      description: "Goal satisfaction cannot rely on an observation that fails the requested capability contract.",
      enabled: true,
      seed: "none",
      prompt: "Use docs-viewer.locate_in_doc to cite where this claim appears.",
      expected: {},
    };
    const railTable = {
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      turn_id: "ask:test:requested-observation-support-missing",
      prompt: scenario.prompt,
      requested_capability: "docs-viewer.locate_in_doc",
      visible_tool_surface: ["docs-viewer.locate_in_doc"],
      selected_capability: "docs-viewer.locate_in_doc",
      admitted_capability: "docs-viewer.locate_in_doc",
      admission_proof_source: "tool_call_admission_decision.admitted_capability",
      admission_proven: true,
      executed_capability: "docs-viewer.locate_in_doc",
      observation_kind: "doc_summary",
      observation_ref: "doc_summary:test",
      required_observation_kinds_for_requested_capability: ["doc_location_matches", "doc_evidence_location"],
      observed_artifact_supports_requested_capability: false,
      reentry_status: "reentered",
      reentry_proof_source: "tool_followup_decision.evidence_reentered",
      reentry_proven: true,
      goal_satisfaction: "satisfied",
      required_terminal_kind: "doc_location_matches",
      selected_terminal_kind: "doc_location_matches",
      terminal_authority_proof_source: "terminal_answer_authority.terminal_artifact_kind",
      terminal_authority_proven: true,
      visible_terminal_kind: "doc_location_matches",
      visible_projection_source: "terminal_presentation.terminal_artifact_kind",
      visible_projection_proven: true,
      first_broken_rail: null,
      repair_target: null,
      codex_parity_class: "complete",
      normalized_codex_parity_classes: [...CODEX_PARITY_CLASSES],
      rail_status: "complete",
      rail_failure_code: null,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    const askTurn = {
      turn_id: railTable.turn_id,
      final_status: "final_answer",
      response_type: "final_answer",
      final_answer_source: "doc_location_matches",
      terminal_artifact_kind: "doc_location_matches",
      selected_final_answer: "Located the requested claim in the current document.",
      codex_parity_agent_spine_rail_table: railTable,
      ask_turn_solver_trace: {
        completed_solver_path: true,
        selected_primary_intent: "locate_in_doc",
        solver_short_circuit_flags: [],
      },
      loop_parity_trace: {
        admitted_tool_families: ["docs_viewer"],
        actual_tool_calls: [],
        unexpected_tool_calls: [],
        short_circuit_risk_flags: [],
      },
      route_authority_audit: {
        route_authority_ok: true,
        violation_codes: [],
      },
      poison_audit: {
        ok: true,
      },
      terminal_answer_authority: {
        server_authoritative: true,
        final_answer_source: "doc_location_matches",
        terminal_artifact_kind: "doc_location_matches",
      },
    };

    const probe = buildApiParityProbeResult({
      scenario,
      askTurn,
      debugExport: { payload: askTurn },
      terminalEventSeen: true,
      streamClosedAfterTerminal: true,
    });

    expect(probe.procedural_ok).toBe(false);
    expect(probe.failures).toContain("rail_goal_satisfied_without_requested_observation_support");
  });

  it("rejects reentered rails without re-entry proof", () => {
    const scenario: HelixApiParityScenario = {
      id: "rail_table_reentry_proof_missing",
      description: "Re-entry status must say what proof made the observation model-visible again.",
      enabled: true,
      seed: "none",
      prompt: "Use repo-code.search_concept to find where terminal authority selects the answer.",
      expected: {},
    };
    const railTable = {
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      turn_id: "ask:test:reentry-proof-missing",
      prompt: scenario.prompt,
      requested_capability: "repo-code.search_concept",
      visible_tool_surface: ["repo-code.search_concept"],
      selected_capability: "repo-code.search_concept",
      admitted_capability: "repo-code.search_concept",
      admission_proof_source: "tool_call_admission_decision.admitted_capability",
      admission_proven: true,
      executed_capability: "repo-code.search_concept",
      observation_kind: "repo_code_evidence_observation",
      observation_ref: "repo_code_evidence_observation:test",
      required_observation_kinds_for_requested_capability: ["repo_code_evidence_observation"],
      observed_artifact_supports_requested_capability: true,
      reentry_status: "reentered",
      reentry_proof_source: null,
      reentry_proven: false,
      goal_satisfaction: "satisfied",
      required_terminal_kind: "repo_code_evidence_answer",
      selected_terminal_kind: "repo_code_evidence_answer",
      terminal_authority_proof_source: "terminal_answer_authority.terminal_artifact_kind",
      terminal_authority_proven: true,
      visible_terminal_kind: "repo_code_evidence_answer",
      visible_projection_source: "terminal_presentation.terminal_artifact_kind",
      visible_projection_proven: true,
      first_broken_rail: null,
      repair_target: null,
      codex_parity_class: "complete",
      normalized_codex_parity_classes: [...CODEX_PARITY_CLASSES],
      rail_status: "complete",
      rail_failure_code: null,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    const askTurn = {
      turn_id: railTable.turn_id,
      final_status: "final_answer",
      response_type: "final_answer",
      final_answer_source: "repo_code_evidence_answer",
      terminal_artifact_kind: "repo_code_evidence_answer",
      selected_final_answer: "Terminal authority selection is defined in the repo evidence.",
      codex_parity_agent_spine_rail_table: railTable,
      ask_turn_solver_trace: {
        completed_solver_path: true,
        selected_primary_intent: "repo_concept_explanation",
        solver_short_circuit_flags: [],
      },
      loop_parity_trace: {
        admitted_tool_families: ["repo_code"],
        actual_tool_calls: [],
        unexpected_tool_calls: [],
        short_circuit_risk_flags: [],
      },
      route_authority_audit: {
        route_authority_ok: true,
        violation_codes: [],
      },
      poison_audit: {
        ok: true,
      },
      terminal_answer_authority: {
        server_authoritative: true,
        final_answer_source: "repo_code_evidence_answer",
        terminal_artifact_kind: "repo_code_evidence_answer",
      },
    };

    const probe = buildApiParityProbeResult({
      scenario,
      askTurn,
      debugExport: { payload: askTurn },
      terminalEventSeen: true,
      streamClosedAfterTerminal: true,
    });

    expect(probe.procedural_ok).toBe(false);
    expect(probe.failures).toEqual(
      expect.arrayContaining(["rail_reentry_proof_source_missing", "rail_reentry_not_proven"]),
    );
  });

  it("rejects terminal authority without a proof source", () => {
    const scenario: HelixApiParityScenario = {
      id: "rail_table_terminal_authority_proof_missing",
      description: "A selected terminal kind must cite the terminal authority writer that selected it.",
      enabled: true,
      seed: "none",
      prompt: "Use workspace_os.status to inspect workstation status.",
      expected: {},
    };
    const railTable = {
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      turn_id: "ask:test:terminal-authority-proof-missing",
      prompt: scenario.prompt,
      requested_capability: "workspace_os.status",
      visible_tool_surface: ["workspace_os.status"],
      selected_capability: "workspace_os.status",
      admitted_capability: "workspace_os.status",
      admission_proof_source: "tool_call_admission_decision.admitted_capability",
      admission_proven: true,
      executed_capability: "workspace_os.status",
      observation_kind: "workspace_os_status_observation",
      observation_ref: "workspace_os_status_observation:test",
      required_observation_kinds_for_requested_capability: ["workspace_os_status_observation"],
      observed_artifact_supports_requested_capability: true,
      reentry_status: "reentered",
      reentry_proof_source: "tool_followup_decision.evidence_reentered",
      reentry_proven: true,
      goal_satisfaction: "satisfied",
      required_terminal_kind: "model_synthesized_answer",
      selected_terminal_kind: "model_synthesized_answer",
      terminal_authority_proof_source: null,
      terminal_authority_proven: false,
      visible_terminal_kind: "model_synthesized_answer",
      visible_projection_source: "terminal_presentation.terminal_artifact_kind",
      visible_projection_proven: true,
      first_broken_rail: null,
      repair_target: null,
      codex_parity_class: "complete",
      normalized_codex_parity_classes: [...CODEX_PARITY_CLASSES],
      rail_status: "complete",
      rail_failure_code: null,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    const askTurn = {
      turn_id: railTable.turn_id,
      final_status: "final_answer",
      response_type: "final_answer",
      final_answer_source: "model_synthesized_answer",
      terminal_artifact_kind: "model_synthesized_answer",
      selected_final_answer: "Workspace OS status returned capability records.",
      codex_parity_agent_spine_rail_table: railTable,
      ask_turn_solver_trace: {
        completed_solver_path: true,
        selected_primary_intent: "workspace_status",
        solver_short_circuit_flags: [],
      },
      loop_parity_trace: {
        admitted_tool_families: ["workspace_action"],
        actual_tool_calls: [],
        unexpected_tool_calls: [],
        short_circuit_risk_flags: [],
      },
      route_authority_audit: {
        route_authority_ok: true,
        violation_codes: [],
      },
      poison_audit: {
        ok: true,
      },
      terminal_answer_authority: {
        server_authoritative: true,
        final_answer_source: "model_synthesized_answer",
        terminal_artifact_kind: "model_synthesized_answer",
      },
    };

    const probe = buildApiParityProbeResult({
      scenario,
      askTurn,
      debugExport: { payload: askTurn },
      terminalEventSeen: true,
      streamClosedAfterTerminal: true,
    });

    expect(probe.procedural_ok).toBe(false);
    expect(probe.failures).toEqual(
      expect.arrayContaining(["rail_terminal_authority_proof_source_missing", "rail_terminal_authority_not_proven"]),
    );
  });

  it("rejects a rail table whose status and normalized class disagree about completion", () => {
    const scenario: HelixApiParityScenario = {
      id: "rail_table_completion_status_class_mismatch",
      description: "Rail status and Codex parity class must agree on whether the spine is complete.",
      enabled: true,
      seed: "none",
      prompt: "Use repo-code.search_concept to find where terminal authority selects the answer.",
      expected: {},
    };
    const railTable = {
      schema: "helix.codex_parity_agent_spine_rail_table.v1",
      turn_id: "ask:test:completion-status-class-mismatch",
      prompt: scenario.prompt,
      requested_capability: "repo-code.search_concept",
      visible_tool_surface: ["repo-code.search_concept"],
      selected_capability: "repo-code.search_concept",
      admitted_capability: "repo-code.search_concept",
      admission_proof_source: "tool_call_admission_decision.admitted_capability",
      admission_proven: true,
      executed_capability: "repo-code.search_concept",
      observation_kind: "repo_code_evidence_observation",
      observation_ref: "repo_code_evidence_observation:test",
      required_observation_kinds_for_requested_capability: ["repo_code_evidence_observation"],
      observed_artifact_supports_requested_capability: true,
      reentry_status: "reentered",
      reentry_proof_source: "tool_followup_decision.evidence_reentered",
      reentry_proven: true,
      goal_satisfaction: "not_satisfied",
      required_terminal_kind: "repo_code_evidence_answer",
      selected_terminal_kind: "typed_failure",
      terminal_authority_proof_source: "terminal_answer_authority.terminal_artifact_kind",
      terminal_authority_proven: true,
      visible_terminal_kind: "typed_failure",
      visible_projection_source: "terminal_presentation.terminal_artifact_kind",
      visible_projection_proven: true,
      first_broken_rail: "evidence_reentry",
      repair_target: "repo_retrieval_repair_policy",
      codex_parity_class: "observation_not_reentered",
      normalized_codex_parity_classes: [...CODEX_PARITY_CLASSES],
      rail_status: "complete",
      rail_failure_code: "weak_evidence_repair_loop",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    const askTurn = {
      turn_id: railTable.turn_id,
      final_status: "final_failure",
      response_type: "final_failure",
      terminal_error_code: "repo_evidence_weak_after_repair",
      final_answer_source: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      selected_final_answer: "I could not complete that turn. Cause: repo_evidence_weak_after_repair.",
      codex_parity_agent_spine_rail_table: railTable,
      ask_turn_solver_trace: {
        completed_solver_path: true,
        selected_primary_intent: "repo_concept_explanation",
        solver_short_circuit_flags: [],
      },
      loop_parity_trace: {
        admitted_tool_families: ["repo_code"],
        actual_tool_calls: [],
        unexpected_tool_calls: [],
        short_circuit_risk_flags: [],
      },
      route_authority_audit: {
        route_authority_ok: true,
        violation_codes: [],
      },
      poison_audit: {
        ok: true,
      },
      terminal_answer_authority: {
        server_authoritative: true,
        final_answer_source: "typed_failure",
        terminal_artifact_kind: "typed_failure",
      },
    };

    const probe = buildApiParityProbeResult({
      scenario,
      askTurn,
      debugExport: { payload: askTurn },
      terminalEventSeen: true,
      streamClosedAfterTerminal: true,
    });

    expect(probe.procedural_ok).toBe(false);
    expect(probe.failures).toEqual(
      expect.arrayContaining(["rail_completion_status_class_mismatch:complete/observation_not_reentered"]),
    );
  });
});
