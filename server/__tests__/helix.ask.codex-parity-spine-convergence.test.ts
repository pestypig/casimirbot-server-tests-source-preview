import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { planRouter, resetHelixAskDebugPayloadCacheForTests } from "../routes/agi.plan";
import {
  CODEX_PARITY_AGENT_SPINE_CLASSES,
  CODEX_PARITY_AGENT_SPINE_FIRST_BROKEN_RAILS,
  CODEX_PARITY_AGENT_SPINE_RAIL_STATUSES,
  CODEX_PARITY_AGENT_SPINE_RAIL_TABLE_SCHEMA,
  CODEX_PARITY_AGENT_SPINE_REENTRY_STATUSES,
  CODEX_PARITY_AGENT_SPINE_REPAIR_TARGETS,
  CODEX_PARITY_AGENT_SPINE_STRING_OR_NULL_FIELDS,
  type CodexParityAgentSpineRailStatus,
  type CodexParityAgentSpineReentryStatus,
  isCodexParityAgentSpineRailFailureCode,
} from "../services/helix-ask/codex-parity-agent-spine-contract";
import { resetHelixAskTurnAdmissionForTests } from "../services/helix-ask/ask-turn-admission";
import { runtimeMemoryGovernor } from "../services/runtime/runtime-memory-governor";
import { resetStagePlayLiveSourceMailWakeStoreForTest } from "../services/stage-play/stage-play-live-source-mail-wake-store";

type RecordLike = Record<string, unknown>;

const CODEX_PARITY_CLASSES = [...CODEX_PARITY_AGENT_SPINE_CLASSES] as const;

type ExpectedRailOutcome = {
  visibleToolSurface: string[];
  selectedCapability?: string;
  admittedCapability?: string;
  executedCapability?: string;
  observationKind?: string;
  reentryStatus: CodexParityAgentSpineReentryStatus;
  goalSatisfaction: string;
  requiredTerminalKind?: string;
  selectedTerminalKind?: string;
  visibleTerminalKind?: string;
  railStatus: CodexParityAgentSpineRailStatus;
  codexParityClass: (typeof CODEX_PARITY_CLASSES)[number];
  railFailureCode?: string | null;
  firstBrokenRail?: string | null;
  repairTarget?: string | null;
};

type ExplicitCapabilityScenario = {
  id: string;
  prompt: string;
  requestedCapability: string;
  expected: ExpectedRailOutcome;
};

type TurnTerminalSnapshot = {
  finalStatus: string | null;
  responseType: string | null;
  finalAnswerSource: string | null;
  terminalErrorCode: string | null;
  selectedFinalAnswer: string;
};

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/agi", planRouter);
  return app;
};

const readRecord = (value: unknown): RecordLike | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RecordLike) : null;

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const expectNonEmptyStringArrayField = (record: RecordLike, key: string): void => {
  expect(record).toHaveProperty(key);
  expect(Array.isArray(record[key])).toBe(true);
  expect((record[key] as unknown[]).every((entry) => typeof entry === "string" && entry.trim().length > 0)).toBe(true);
};

const expectVisibleToolSurfaceMetadata = (record: RecordLike): void => {
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

const terminalSnapshotFor = (body: unknown): TurnTerminalSnapshot => {
  const record = readRecord(body);
  return {
    finalStatus: readString(record?.final_status),
    responseType: readString(record?.response_type),
    finalAnswerSource: readString(record?.final_answer_source),
    terminalErrorCode: readString(record?.terminal_error_code),
    selectedFinalAnswer: readString(record?.selected_final_answer) ?? readString(record?.answer) ?? readString(record?.text) ?? "",
  };
};

const expectTerminalProjectionForCompleteRail = (terminal: TurnTerminalSnapshot): void => {
  expect(terminal.finalStatus).toBe("final_answer");
  expect(terminal.responseType).toBe("final_answer");
  expect(terminal.terminalErrorCode).toBeNull();
  expect(terminal.finalAnswerSource).not.toBe("typed_failure");
  expect(terminal.selectedFinalAnswer.length).toBeGreaterThan(0);
};

const TEST_MIB = 1024 * 1024;

const resetEndpointAdmissionForTests = (): void => {
  runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
    memoryReader: () => ({
      rss: 512 * TEST_MIB,
      heapTotal: 256 * TEST_MIB,
      heapUsed: 128 * TEST_MIB,
      external: 8 * TEST_MIB,
      arrayBuffers: 1 * TEST_MIB,
    }),
    hostMemoryReader: () => ({
      freeMiB: 8192,
      totalMiB: 16384,
      freeRatio: 0.5,
    }),
  });
  resetHelixAskTurnAdmissionForTests();
};

const resetConvergenceHarnessState = (): void => {
  resetEndpointAdmissionForTests();
  resetStagePlayLiveSourceMailWakeStoreForTest();
  resetHelixAskDebugPayloadCacheForTests();
};

const expectRailTableShape = (railTable: RecordLike, turnId: string): void => {
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
    expect(railTable).toHaveProperty(key);
    expect(railTable[key] === null || typeof railTable[key] === "string").toBe(true);
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
  if (railTable.rail_status === "complete" || railTable.codex_parity_class === "complete") {
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

const fetchRailTable = async (input: {
  app: express.Express;
  prompt: string;
  sessionId: string;
}): Promise<{
  turnId: string;
  turnRail: RecordLike;
  debugRail: RecordLike;
  terminal: TurnTerminalSnapshot;
}> => {
  resetEndpointAdmissionForTests();
  const turn = await request(input.app)
    .post("/api/agi/ask/turn")
    .send({
      sessionId: input.sessionId,
      question: input.prompt,
      mode: "read",
      debug: false,
    })
    .expect(200);
  const turnId = readString(turn.body?.turn_id);
  expect(turnId).toBeTruthy();
  const terminal = terminalSnapshotFor(turn.body);
  const debug = await request(input.app)
    .get(`/api/agi/ask/turn/${encodeURIComponent(turnId as string)}/debug-export?view=rail`)
    .expect(200);
  const turnRail = readRecord(turn.body?.codex_parity_agent_spine_rail_table);
  const debugRail = readRecord(debug.body?.payload?.codex_parity_agent_spine_rail_table);
  expect(turnRail).toBeTruthy();
  expect(debugRail).toBeTruthy();
  expectRailTableShape(turnRail as RecordLike, turnId as string);
  expectRailTableShape(debugRail as RecordLike, turnId as string);
  expect(debugRail).toEqual(turnRail);
  if (turnRail?.rail_status === "complete") {
    expectTerminalProjectionForCompleteRail(terminal);
  }
  (turn as unknown as { body?: unknown }).body = undefined;
  (debug as unknown as { body?: unknown }).body = undefined;
  resetConvergenceHarnessState();
  return { turnId: turnId as string, turnRail: turnRail as RecordLike, debugRail: debugRail as RecordLike, terminal };
};

const seedVisualCapture = async (input: {
  app: express.Express;
  sessionId: string;
}): Promise<void> => {
  await request(input.app)
    .post("/api/agi/situation/test-harness/live-visual-source")
    .send({
      thread_id: input.sessionId,
      source_id: `visual_source:spine-convergence:${Date.now()}`,
      scene_text: "A backend-seeded visual capture shows a workstation panel with a visible status table.",
      activity: "Reviewing a workstation panel with status rows.",
      objects: "workstation panel, status table, visible controls",
      confidence: 0.82,
    })
    .expect(200);
};

beforeEach(() => {
  resetConvergenceHarnessState();
});

afterEach(() => {
  resetConvergenceHarnessState();
});

const EXPLICIT_CAPABILITY_SCENARIOS: ExplicitCapabilityScenario[] = [
  {
    id: "calculator",
    prompt:
      "Call scientific-calculator.solve_expression with this exact expression: 2 + 2. Wait for calculator_receipt and answer from workstation_tool_evaluation.",
    requestedCapability: "scientific-calculator.solve_expression",
    expected: {
      visibleToolSurface: ["scientific-calculator.solve_expression"],
      executedCapability: "scientific-calculator.solve_expression",
      observationKind: "calculator_receipt",
      reentryStatus: "reentered",
      goalSatisfaction: "satisfied",
      requiredTerminalKind: "workstation_tool_evaluation",
      selectedTerminalKind: "workstation_tool_evaluation",
      visibleTerminalKind: "workstation_tool_evaluation",
      railStatus: "complete",
      codexParityClass: "complete",
      railFailureCode: null,
      firstBrokenRail: null,
      repairTarget: null,
    },
  },
  {
    id: "workspace_status",
    prompt: "Use workspace_os.status to inspect workstation status.",
    requestedCapability: "workspace_os.status",
    expected: {
      visibleToolSurface: ["workspace_os.status"],
      executedCapability: "workspace_os.status",
      observationKind: "workspace_os_status_observation",
      reentryStatus: "reentered",
      goalSatisfaction: "satisfied",
      requiredTerminalKind: "model_synthesized_answer",
      selectedTerminalKind: "model_synthesized_answer",
      visibleTerminalKind: "model_synthesized_answer",
      railStatus: "complete",
      codexParityClass: "complete",
      railFailureCode: null,
      firstBrokenRail: null,
      repairTarget: null,
    },
  },
  {
    id: "docs_locate",
    prompt: "Use docs-viewer.locate_in_doc to locate the rule of thumb in docs/helix-ask-codex-loop-discipline.md.",
    requestedCapability: "docs-viewer.locate_in_doc",
    expected: {
      visibleToolSurface: ["docs-viewer.locate_in_doc"],
      executedCapability: "docs-viewer.locate_in_doc",
      observationKind: "doc_location_matches",
      reentryStatus: "reentered",
      goalSatisfaction: "satisfied",
      requiredTerminalKind: "doc_location_matches",
      selectedTerminalKind: "doc_location_matches",
      visibleTerminalKind: "doc_location_matches",
      railStatus: "complete",
      codexParityClass: "complete",
      railFailureCode: null,
      firstBrokenRail: null,
      repairTarget: null,
    },
  },
  {
    id: "repo_search",
    prompt: "Use repo-code.search_concept to find where terminal authority selects the answer.",
    requestedCapability: "repo-code.search_concept",
    expected: {
      visibleToolSurface: ["repo-code.search_concept"],
      executedCapability: "repo-code.search_concept",
      observationKind: "repo_code_evidence_observation",
      reentryStatus: "reentered",
      goalSatisfaction: "not_satisfied",
      requiredTerminalKind: "repo_code_evidence_answer",
      selectedTerminalKind: "typed_failure",
      visibleTerminalKind: "typed_failure",
      railStatus: "fail_closed",
      codexParityClass: "observation_not_reentered",
      railFailureCode: "weak_evidence_repair_loop",
      firstBrokenRail: "evidence_reentry",
      repairTarget: "repo_retrieval_repair_policy",
    },
  },
  {
    id: "internet_search",
    prompt: "Use internet_search.web_research to find current public evidence about OpenAI Codex.",
    requestedCapability: "internet_search.web_research",
    expected: {
      visibleToolSurface: ["internet_search.web_research"],
      selectedCapability: "internet-search.search_web",
      admittedCapability: "internet-search.search_web",
      executedCapability: "internet-search.search_web",
      observationKind: "internet_search_observation",
      reentryStatus: "reentered",
      goalSatisfaction: "not_satisfied",
      requiredTerminalKind: "internet_search_answer",
      selectedTerminalKind: "typed_failure",
      visibleTerminalKind: "typed_failure",
      railStatus: "fail_closed",
      codexParityClass: "provider_config_missing",
      railFailureCode: "config_missing",
      firstBrokenRail: "config",
      repairTarget: "operator_config",
    },
  },
  {
    id: "live_source_mail",
    prompt: "Use live_env.read_processed_live_source_mail to inspect the latest processed live-source mail.",
    requestedCapability: "live_env.read_processed_live_source_mail",
    expected: {
      visibleToolSurface: ["live_env.read_processed_live_source_mail"],
      executedCapability: "live_env.read_processed_live_source_mail",
      observationKind: "reasoning_context",
      reentryStatus: "reentered",
      goalSatisfaction: "not_satisfied",
      requiredTerminalKind: "model_synthesized_answer",
      selectedTerminalKind: "typed_failure",
      visibleTerminalKind: "typed_failure",
      railStatus: "fail_closed",
      codexParityClass: "observation_missing",
      railFailureCode: "required_observation_missing",
      firstBrokenRail: "observation_artifact",
      repairTarget: "observation_materializer",
    },
  },
];

const CONVERGENCE_COVERAGE_IDS = [
  ...EXPLICIT_CAPABILITY_SCENARIOS.map((scenario) => scenario.id),
  "capability_catalog",
  "negated_contextual_tool_mentions",
  "visual_capture",
  "image_lens",
] as const;

describe("Helix Ask Codex-parity agent spine convergence", () => {
  it("keeps explicit convergence coverage for required tool families and failure classes", () => {
    expect(CODEX_PARITY_CLASSES).toEqual([
      "complete",
      "tool_surface_missing",
      "explicit_capability_demoted",
      "tool_admission_rejected",
      "selected_not_executed",
      "observation_missing",
      "observation_not_reentered",
      "goal_contract_mismatch",
      "terminal_product_not_allowed",
      "terminal_authority_mismatch",
      "visible_projection_mismatch",
      "debug_mirror_stale",
      "provider_config_missing",
    ]);

    expect([...CONVERGENCE_COVERAGE_IDS]).toEqual(
      expect.arrayContaining([
        "calculator",
        "workspace_status",
        "docs_locate",
        "repo_search",
        "internet_search",
        "live_source_mail",
        "capability_catalog",
        "negated_contextual_tool_mentions",
        "visual_capture",
        "image_lens",
      ]),
    );

    const requestedCapabilities = EXPLICIT_CAPABILITY_SCENARIOS.map((scenario) => scenario.requestedCapability);
    expect(requestedCapabilities).toEqual(
      expect.arrayContaining([
        "scientific-calculator.solve_expression",
        "workspace_os.status",
        "docs-viewer.locate_in_doc",
        "repo-code.search_concept",
        "internet_search.web_research",
        "live_env.read_processed_live_source_mail",
      ]),
    );

    const expectedClasses = Array.from(new Set(EXPLICIT_CAPABILITY_SCENARIOS.map((scenario) => scenario.expected.codexParityClass)));
    expect(expectedClasses).toEqual(
      expect.arrayContaining([
        "complete",
        "observation_not_reentered",
        "provider_config_missing",
        "observation_missing",
      ]),
    );
  });

  it.each<ExplicitCapabilityScenario>(EXPLICIT_CAPABILITY_SCENARIOS)("$id explicit capability is reflected in the API/debug rail table", async (scenario) => {
    const { turnRail } = await fetchRailTable({
      app: createApp(),
      prompt: scenario.prompt,
      sessionId: `helix-ask:spine-convergence:${scenario.id}:${Date.now()}`,
    });

    expect(turnRail.requested_capability).toBe(scenario.requestedCapability);
    expect(turnRail.visible_tool_surface).toEqual(expect.arrayContaining(scenario.expected.visibleToolSurface));
    expect(turnRail.selected_capability).toBe(scenario.expected.selectedCapability ?? scenario.requestedCapability);
    expect(turnRail.admitted_capability).toBe(
      scenario.expected.admittedCapability ?? scenario.expected.selectedCapability ?? scenario.requestedCapability,
    );
    expect(turnRail.executed_capability).toBe(scenario.expected.executedCapability ?? scenario.requestedCapability);
    expect(turnRail.observation_kind).toBe(scenario.expected.observationKind);
    expect(turnRail.reentry_status).toBe(scenario.expected.reentryStatus);
    expect(turnRail.goal_satisfaction).toBe(scenario.expected.goalSatisfaction);
    expect(turnRail.required_terminal_kind).toBe(scenario.expected.requiredTerminalKind);
    expect(turnRail.selected_terminal_kind).toBe(scenario.expected.selectedTerminalKind);
    expect(turnRail.visible_terminal_kind).toBe(scenario.expected.visibleTerminalKind);
    expect(turnRail.rail_status).toBe(scenario.expected.railStatus);
    expect(turnRail.codex_parity_class).toBe(scenario.expected.codexParityClass);
    expect(turnRail.rail_failure_code).toBe(scenario.expected.railFailureCode ?? null);
    expect(turnRail.first_broken_rail).toBe(scenario.expected.firstBrokenRail ?? null);
    expect(turnRail.repair_target).toBe(scenario.expected.repairTarget ?? null);
    expect(turnRail.codex_parity_class).not.toBe("explicit_capability_demoted");
  }, 60_000);

  it("answers capability catalog questions from runtime catalog evidence, not repo existence", async () => {
    const { turnRail, terminal } = await fetchRailTable({
      app: createApp(),
      prompt: "What tools are available for the helix ask to use?",
      sessionId: `helix-ask:spine-convergence:catalog:${Date.now()}`,
    });

    expect(turnRail.selected_capability).toBe("helix_ask.inspect_capability_catalog");
    expect(turnRail.admitted_capability).toBe("helix_ask.inspect_capability_catalog");
    expect(turnRail.executed_capability).toBe("helix_ask.inspect_capability_catalog");
    expect(turnRail.observation_kind).toBe("capability_registry");
    expect(turnRail.codex_parity_class).toBe("complete");
    expect(terminal.terminalErrorCode).not.toBe("terminal_kind_not_required");
    expect(terminal.finalAnswerSource).not.toBe("typed_failure");
    expect(terminal.selectedFinalAnswer).toMatch(/tool|capabil/i);
  }, 60_000);

  it("keeps negated calculator references suppressed instead of treating them as progress", async () => {
    const { turnRail } = await fetchRailTable({
      app: createApp(),
      prompt:
        "Do not call scientific-calculator.solve_expression. Explain why calculator receipts are observations rather than terminal authority.",
      sessionId: `helix-ask:spine-convergence:negated-calculator:${Date.now()}`,
    });

    expect(turnRail.requested_capability).toBeNull();
    expect(turnRail.visible_tool_surface).toEqual(expect.arrayContaining(["model.direct_answer"]));
    expect(turnRail.visible_tool_surface).not.toContain("scientific-calculator.solve_expression");
    expect(turnRail.visible_tool_surface).not.toContain("repo-code.search_concept");
    expect(turnRail.selected_capability).toBe("model.direct_answer");
    expect(turnRail.admitted_capability).toBe("model.direct_answer");
    expect(turnRail.executed_capability).toBe("model.direct_answer");
    expect(turnRail.required_terminal_kind).toBe("direct_answer_text");
    expect(turnRail.selected_terminal_kind).toBe("direct_answer_text");
    expect(turnRail.visible_terminal_kind).toBe("direct_answer_text");
    expect(turnRail.codex_parity_class).toBe("complete");
  }, 60_000);

  it("does not let a negated calculator reference suppress an explicit repo capability", async () => {
    const { turnRail } = await fetchRailTable({
      app: createApp(),
      prompt:
        "Do not call scientific-calculator.solve_expression. Use repo-code.search_concept to find where terminal authority selects the answer.",
      sessionId: `helix-ask:spine-convergence:negated-calculator-explicit-repo:${Date.now()}`,
    });

    expect(turnRail.requested_capability).toBe("repo-code.search_concept");
    expect(turnRail.visible_tool_surface).toEqual(expect.arrayContaining(["repo-code.search_concept"]));
    expect(turnRail.selected_capability).toBe("repo-code.search_concept");
    expect(turnRail.admitted_capability).toBe("repo-code.search_concept");
    expect(turnRail.executed_capability).toBe("repo-code.search_concept");
    expect(turnRail.executed_capability).not.toBe("scientific-calculator.solve_expression");
    expect(turnRail.observation_kind).toBe("repo_code_evidence_observation");
    expect(turnRail.required_terminal_kind).toBe("repo_code_evidence_answer");
    expect(turnRail.codex_parity_class).not.toBe("explicit_capability_demoted");
    expect(turnRail.codex_parity_class).not.toBe("tool_admission_rejected");
  }, 60_000);

  it("routes current-screen visual questions through visual capture evidence", async () => {
    const app = createApp();
    const sessionId = `helix-ask:spine-convergence:visual:${Date.now()}`;
    await seedVisualCapture({ app, sessionId });

    const { turnRail } = await fetchRailTable({
      app,
      prompt: "What is happening right now in the visual screen capture?",
      sessionId,
    });

    expect(turnRail.visible_tool_surface).toEqual(
      expect.arrayContaining(["situation-room.describe_visual_capture"]),
    );
    expect(turnRail.selected_capability).toBe("situation-room.describe_visual_capture");
    expect(turnRail.admitted_capability).toBe("situation-room.describe_visual_capture");
    expect(turnRail.executed_capability).toBe("situation-room.describe_visual_capture");
    expect(turnRail.codex_parity_class).toBe("complete");
  }, 60_000);

  it("executes an image lens alias through visual capture evidence", async () => {
    const app = createApp();
    const sessionId = `helix-ask:spine-convergence:image-lens:${Date.now()}`;
    await seedVisualCapture({ app, sessionId });

    const { turnRail } = await fetchRailTable({
      app,
      prompt: "Use image_lens.inspect to inspect the current image lens visual source.",
      sessionId,
    });
    expect(turnRail.requested_capability).toBe("image_lens.inspect");
    expect(turnRail.visible_tool_surface).toEqual(
      expect.arrayContaining(["image_lens.inspect", "situation-room.describe_visual_capture"]),
    );
    expect(turnRail.selected_capability).toBe("situation-room.describe_visual_capture");
    expect(turnRail.admitted_capability).toBe("situation-room.describe_visual_capture");
    expect(turnRail.executed_capability).toBe("situation-room.describe_visual_capture");
    expect(["visual_frame_evidence", "situation_context_pack", "visual_context_pack"]).toContain(turnRail.observation_kind);
    expect(turnRail.reentry_status).toBe("reentered");
    expect(turnRail.goal_satisfaction).toBe("satisfied");
    expect(turnRail.required_terminal_kind).toBe("situation_context_pack");
    expect(turnRail.selected_terminal_kind).not.toBe("typed_failure");
    expect(turnRail.visible_terminal_kind).not.toBe("typed_failure");
    expect(turnRail.first_broken_rail).toBeNull();
    expect(turnRail.repair_target).toBeNull();
    expect(turnRail.rail_failure_code).toBeNull();
    expect(turnRail.codex_parity_class).toBe("complete");
  }, 60_000);
});
