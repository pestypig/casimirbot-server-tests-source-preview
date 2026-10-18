import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { planRouter } from "../routes/agi.plan";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

const ACCEPTANCE_PROMPTS = [
  "Open up a docs panel.",
  "Open the NHM2 white paper from docs.",
  "What doc are we looking at right now?",
  "Find lapse shift in the current doc.",
  "Can you tell me what an electron is?",
  "A 3 kg cart starts from rest and reaches 12 m/s in 4 seconds. Use calculator for acceleration, force, KE.",
  "A pendulum is 2 m long. Estimate period with calculator.",
  "Describe the visual capture.",
  "Set the live interval to 10 seconds.",
  "Create a note summarizing the active doc.",
] as const;

const NHM2_DOC_PATH = "/docs/research/nhm2-current-status-whitepaper.md";

const withEnv = async <T,>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> => {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(env)) {
    previous.set(key, process.env[key]);
    const value = env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

const ledger = (payload: Record<string, any>) =>
  Array.isArray(payload?.current_turn_artifact_ledger) ? payload.current_turn_artifact_ledger : [];

const findArtifactPayload = (payload: Record<string, any>, kind: string): Record<string, any> | null => {
  const direct = payload?.[kind];
  if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct;
  const artifact = ledger(payload).find((entry: any) => entry?.kind === kind);
  return artifact?.payload && typeof artifact.payload === "object" ? artifact.payload : null;
};

const artifactPayloads = (payload: Record<string, any>, kind: string): Array<Record<string, any>> =>
  [
    ...(payload?.[kind] && typeof payload[kind] === "object" && !Array.isArray(payload[kind]) ? [payload[kind]] : []),
    ...ledger(payload)
    .filter((entry: any) => entry?.kind === kind)
    .map((entry: any) => entry?.payload)
    .filter((entry: any): entry is Record<string, any> => entry && typeof entry === "object"),
  ];

const allCoverageArtifacts = (payload: Record<string, any>) =>
  ledger(payload).filter((entry: any) => /coverage|satisfaction|evaluation/i.test(String(entry?.kind ?? "")));

const hasObservedToolResult = (payload: Record<string, any>) => {
  const loop = findArtifactPayload(payload, "agent_runtime_loop");
  const hasRuntimeObservation = artifactPayloads(payload, "runtime_tool_observation").length > 0;
  const hasObservedIteration = Boolean(loop?.iterations?.some((iteration: any) =>
    iteration.chosen_capability &&
    Array.isArray(iteration.observed_artifact_refs) &&
    iteration.observed_artifact_refs.length > 0
  ));
  const hasReceiptArtifact = ledger(payload).some((entry: any) =>
    /receipt|results|location|identity|evaluation/i.test(String(entry?.kind ?? ""))
  );
  return hasRuntimeObservation || hasObservedIteration || hasReceiptArtifact;
};

const assertCodexShapedDebug = (payload: Record<string, any>, options: {
  requireToolExecution?: boolean;
  expectedCapability?: string;
  expectedCoverageKind?: string;
  allowModelOnly?: boolean;
} = {}) => {
  expect(findArtifactPayload(payload, "available_capabilities")).toMatchObject({
    schema: "helix.available_capabilities.v1",
    manifest_role: "model_visible_tool_menu",
  });

  const loop = findArtifactPayload(payload, "agent_runtime_loop");
  const runtimeIntent = findArtifactPayload(payload, "runtime_intent_packet");
  const authorityAudit = findArtifactPayload(payload, "runtime_authority_audit");
  const finalDraft = findArtifactPayload(payload, "final_answer_draft");
  const goalSatisfaction = findArtifactPayload(payload, "goal_satisfaction_evaluation");
  const agentDecisions = artifactPayloads(payload, "agent_step_decision");

  if (!options.allowModelOnly) {
    expect(runtimeIntent).toMatchObject({
      schema: "helix.runtime_intent_packet.v1",
      completion_authority: "agent_runtime_loop_and_goal_satisfaction",
    });
    expect(loop).toMatchObject({
      schema: "helix.agent_runtime_loop.v1",
      runtime_role: "generic_next_action_observe_loop",
    });
    expect(authorityAudit).toMatchObject({
      schema: "helix.runtime_authority_audit.v1",
      runtime_loop_present: true,
      all_subgoals_observed_terminal_authority: false,
    });
  }

  expect(agentDecisions.length).toBeGreaterThan(0);
  expect(goalSatisfaction).toMatchObject({
    schema: "helix.goal_satisfaction_evaluation.v1",
  });
  expect(allCoverageArtifacts(payload).length).toBeGreaterThan(0);

  if (loop) {
    expect(loop.iterations?.length).toBeGreaterThan(0);
    for (const iteration of loop.iterations ?? []) {
      expect(String(iteration.decision_ref ?? "")).toMatch(/:agent_step_decision(?::|$)/);
      expect(["llm", "deterministic_policy", "deterministic_policy_fallback", "deterministic_fallback"]).toContain(iteration.decision_source);
      expect(["llm", "deterministic_policy", "deterministic_policy_fallback", "deterministic_fallback"]).toContain(iteration.decision_authority);
      expect(iteration.stop_reason).not.toBe("all_subgoals_observed");
      if (iteration.observation_role === "executed_tool_result") {
        expect(iteration.observed_artifact_refs?.length ?? 0).toBeGreaterThan(0);
        expect(iteration.goal_satisfaction_ref ?? iteration.satisfaction_observation_ref).toBeTruthy();
      }
    }
    expect(["answered", "terminal_satisfied", "ask_user", "failed", "budget_exhausted"]).toContain(loop.stop_reason);
    if (loop.stop_reason === "answered" || loop.stop_reason === "terminal_satisfied") {
      expect(goalSatisfaction?.satisfaction).toBe("satisfied");
    }
  }

  if (options.requireToolExecution) {
    expect(hasObservedToolResult(payload)).toBe(true);
    expect(findArtifactPayload(payload, "observation_review")).toMatchObject({
      schema: "helix.observation_review.v1",
    });
  }
  if (options.expectedCapability && loop) {
    const availableCapabilities = findArtifactPayload(payload, "available_capabilities");
    const modelVisibleKeys = Array.isArray(availableCapabilities?.model_visible_capability_keys)
      ? availableCapabilities.model_visible_capability_keys
      : [];
    expect(
      loop.iterations?.some((iteration: any) => iteration.chosen_capability === options.expectedCapability) ||
      agentDecisions.some((decision: any) => decision.chosen_capability === options.expectedCapability) ||
      modelVisibleKeys.includes(options.expectedCapability),
    ).toBe(true);
  }
  if (options.expectedCoverageKind) {
    expect(findArtifactPayload(payload, options.expectedCoverageKind)).toBeTruthy();
  }
  if (finalDraft) {
    expect(finalDraft).toMatchObject({
      schema: "helix.final_answer_draft.v1",
    });
  }
};

const askAndDebug = async (args: {
  question: string;
  env?: Record<string, string | undefined>;
  workspace?: Record<string, unknown>;
}) => withEnv(args.env ?? {}, async () => {
  const app = createApp();
  const sessionId = `codex-shaped-debug-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const ask = await request(app)
    .post("/api/agi/ask/turn")
    .send({
      question: args.question,
      mode: "read",
      debug: true,
      sessionId,
      workspace_context_snapshot: {
        sessionId,
        activePanel: "docs-viewer",
        activeDocPath: NHM2_DOC_PATH,
        docContextPath: NHM2_DOC_PATH,
        hasDocContext: true,
        docContextValid: true,
        ...(args.workspace ?? {}),
      },
    })
    .expect(200);

  const debug = await request(app)
    .get(`/api/agi/ask/turn/${encodeURIComponent(ask.body.turn_id)}/debug-export`)
    .expect(200);

  expect(debug.body?.ok).toBe(true);
  return { ask: ask.body, debug: debug.body.payload };
});

describe("Helix Ask Codex-shaped debug parity", () => {
  it("keeps the phase-10 acceptance prompt set explicit", () => {
    expect(ACCEPTANCE_PROMPTS).toHaveLength(10);
    expect(ACCEPTANCE_PROMPTS).toEqual(expect.arrayContaining([
      "Open up a docs panel.",
      "Open the NHM2 white paper from docs.",
      "Can you tell me what an electron is?",
      "Set the live interval to 10 seconds.",
    ]));
  });

  it("exports model-visible loop artifacts for docs panel tool use", async () => {
    const { debug } = await askAndDebug({
      question: "Open up a docs panel.",
      env: {
        HELIX_AGENT_STEP_DECISION_LLM: "1",
        HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX: "0",
        HELIX_AGENT_STEP_DECISION_TEST_RESPONSE: JSON.stringify([
          {
            next_step: "next_action",
            chosen_capability: "docs-viewer.open",
            reason: "The user asked to open the Docs panel, so the panel-open capability is the next action.",
            args: {},
            expected_artifacts: ["workspace_action_receipt"],
            confidence: 0.98,
          },
          {
            next_step: "answer",
            chosen_capability: null,
            reason: "The docs-viewer.open receipt satisfies the panel-open goal.",
            args: {},
            expected_artifacts: ["workspace_action_receipt"],
            confidence: 0.98,
          },
        ]),
      },
    });
    assertCodexShapedDebug(debug, {
      requireToolExecution: true,
      expectedCapability: "docs-viewer.open",
    });
    expect(debug.resolved_turn_summary?.terminal_artifact_kind).toBe("workspace_action_receipt");
  }, 60000);

  it("exports model-selected search/open observations for document opening", async () => {
    const { debug } = await askAndDebug({
      question: "Open the NHM2 white paper from docs.",
      env: {
        HELIX_AGENT_STEP_DECISION_LLM: "1",
        HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX: "0",
        HELIX_AGENT_STEP_DECISION_TEST_RESPONSE: JSON.stringify([
          {
            next_step: "next_action",
            chosen_capability: "docs-viewer.search_docs",
            reason: "Search docs for the requested NHM2 white paper before opening it.",
            args: { query: "NHM2 white paper", limit: 5 },
            expected_artifacts: ["doc_search_results", "doc_candidate_validation"],
            confidence: 0.96,
          },
          {
            next_step: "next_action",
            chosen_capability: "docs-viewer.open_doc_by_path",
            reason: "Open the validated NHM2 current-status whitepaper path.",
            args: { path: NHM2_DOC_PATH },
            expected_artifacts: ["doc_open_receipt"],
            confidence: 0.97,
          },
          {
            next_step: "answer",
            chosen_capability: null,
            reason: "The open-doc receipt satisfies the requested document-open goal.",
            args: {},
            expected_artifacts: ["doc_open_receipt"],
            confidence: 0.98,
          },
        ]),
      },
    });
    assertCodexShapedDebug(debug, {
      requireToolExecution: true,
      expectedCapability: "docs-viewer.open_doc_by_path",
      expectedCoverageKind: "doc_open_coverage",
    });
    expect(debug.goal_satisfaction_evaluation?.satisfaction).toBe("satisfied");
  }, 60000);

  it("repairs unknown-source discovery away from repeated repo search after forbidden external lookup", async () => {
    const { debug } = await askAndDebug({
      question: "find NHM2 theory white paper",
      env: {
        HELIX_AGENT_STEP_DECISION_LLM: "1",
        HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX: "0",
        HELIX_AGENT_STEP_DECISION_TEST_RESPONSE: JSON.stringify([
          {
            next_step: "next_action",
            chosen_capability: "scholarly-research.lookup_papers",
            reason: "Try scholarly lookup for the requested paper.",
            args: { query: "NHM2 theory white paper" },
            expected_artifacts: ["scholarly_research_observation"],
            confidence: 0.9,
          },
          {
            next_step: "next_action",
            chosen_capability: "repo-code.search_concept",
            reason: "Search repo evidence after the external lookup was rejected.",
            args: { query: "NHM2 theory white paper" },
            expected_artifacts: ["repo_code_evidence_observation"],
            confidence: 0.86,
          },
          {
            next_step: "next_action",
            chosen_capability: "repo-code.search_concept",
            reason: "Repeat repo search.",
            args: { query: "NHM2 theory white paper" },
            expected_artifacts: ["repo_code_evidence_observation"],
            confidence: 0.72,
          },
        ]),
      },
    });

    expect(debug.tool_call_admission_decision).toMatchObject({
      source_target: "unknown",
      admission_mode: "unknown_source_discovery",
    });
    const validations = artifactPayloads(debug, "runtime_tool_call_validation");
    const scholarlyRuntimeRejected = validations.some((validation) =>
      validation.capability_key === "scholarly-research.lookup_papers" &&
      validation.valid === false &&
      validation.errors?.some((error: string) => /runtime_capability_(?:family_forbidden|not_admitted)_by_tool_policy/.test(error))
    );
    const repairs = artifactPayloads(debug, "unknown_source_discovery_continuation_repair");
    expect(
      scholarlyRuntimeRejected ||
      repairs.some((repair) => repair.repaired_to === "workspace-directory.resolve")
    ).toBe(true);
    expect(repairs.some((repair) => repair.repaired_to === "workspace-directory.resolve")).toBe(true);
    expect(repairs.some((repair) => repair.repaired_to === "model.direct_answer")).toBe(true);
    expect(repairs.some((repair) => repair.repaired_to === "docs-viewer.locate_in_doc")).toBe(false);
    const workspaceDirectoryResolution = findArtifactPayload(debug, "workspace_directory_resolution");
    expect(workspaceDirectoryResolution?.selected_doc_path).toBe("docs/research/nhm2-current-status-whitepaper.md");
    expect(JSON.stringify(debug)).toContain("workspace://workspace/docs/research/nhm2-current-status-whitepaper.md");
    const loop = findArtifactPayload(debug, "agent_runtime_loop");
    expect(loop?.iterations?.some((iteration: any) => iteration.chosen_capability === "workspace-directory.resolve")).toBe(true);
    expect(loop?.iterations?.some((iteration: any) => iteration.chosen_capability === "docs-viewer.locate_in_doc")).toBe(false);
    expect(loop?.iterations?.filter((iteration: any) => iteration.chosen_capability === "repo-code.search_concept").length ?? 0).toBeLessThanOrEqual(1);
  }, 90000);

  it("exports model-selected calculator iterations and calculator coverage", async () => {
    const { debug } = await askAndDebug({
      question: "A 3 kg cart starts from rest and reaches 12 m/s in 4 seconds. Use calculator for acceleration, force, KE.",
      env: {
        HELIX_AGENT_STEP_DECISION_LLM: "1",
        HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX: "0",
        HELIX_AGENT_STEP_DECISION_TEST_RESPONSE: JSON.stringify([
          {
            next_step: "next_action",
            chosen_capability: "scientific-calculator.solve_expression",
            reason: "Compute acceleration from the velocity change over time.",
            args: { latex: "(12-0)/4", compound_subgoal_id: "acceleration" },
            expected_artifacts: ["calculator_receipt", "calculator_subgoal_receipt", "calculator_plan_coverage"],
            confidence: 0.97,
          },
          {
            next_step: "next_action",
            chosen_capability: "scientific-calculator.solve_expression",
            reason: "Use mass times acceleration to compute force.",
            args: { latex: "3*3", compound_subgoal_id: "force" },
            expected_artifacts: ["calculator_receipt", "calculator_subgoal_receipt", "calculator_plan_coverage"],
            confidence: 0.97,
          },
          {
            next_step: "next_action",
            chosen_capability: "scientific-calculator.solve_expression",
            reason: "Compute kinetic energy at 12 m/s.",
            args: { latex: "0.5*3*12^2", compound_subgoal_id: "kinetic_energy" },
            expected_artifacts: ["calculator_receipt", "calculator_subgoal_receipt", "calculator_plan_coverage"],
            confidence: 0.97,
          },
          {
            next_step: "answer",
            chosen_capability: null,
            reason: "Calculator receipts cover acceleration, force, and kinetic energy.",
            args: {},
            expected_artifacts: ["workstation_tool_evaluation"],
            confidence: 0.98,
          },
        ]),
        HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE:
          "Acceleration: 3 m/s^2. Force: 9 N. Kinetic energy: 216 J.",
      },
    });
    assertCodexShapedDebug(debug, {
      requireToolExecution: true,
      expectedCapability: "scientific-calculator.solve_expression",
      expectedCoverageKind: "calculator_plan_coverage",
    });
    expect(findArtifactPayload(debug, "calculator_plan_coverage")?.coverage).toBe("complete");
    expect(String(debug.finalAnswer ?? debug.selected_final_answer ?? "")).toContain("216 J");
  }, 60000);

  it("exports an answer decision for active document identity without treating ambient docs as a tool result", async () => {
    const { debug } = await askAndDebug({
      question: "What doc are we looking at right now?",
      env: {
        HELIX_AGENT_STEP_DECISION_LLM: "1",
        HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX: "0",
        HELIX_AGENT_STEP_DECISION_TEST_RESPONSE: JSON.stringify([
          {
            next_step: "answer",
            chosen_capability: null,
            reason: "The active doc identity evidence satisfies the current-document question.",
            args: {},
            expected_artifacts: ["active_doc_identity"],
            confidence: 0.98,
          },
        ]),
      },
    });
    assertCodexShapedDebug(debug);
    expect(debug.resolved_turn_summary?.terminal_artifact_kind).toBe("active_doc_identity");
    expect(String(debug.finalAnswer ?? debug.selected_final_answer ?? "")).toContain(NHM2_DOC_PATH);
  }, 60000);

  it("uses repaired note action args when model-selected note capability args are empty", async () => {
    const { debug } = await askAndDebug({
      question: "Create a workstation note titled Runtime Args Test with body Preserve repaired args inside the loop.",
      env: {
        HELIX_AGENT_STEP_DECISION_LLM: "1",
        HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX: "0",
        HELIX_AGENT_STEP_DECISION_TEST_RESPONSE: JSON.stringify([
          {
            next_step: "next_action",
            chosen_capability: "workstation-notes.create_note",
            reason: "The user asked to create a workstation note.",
            args: {},
            expected_artifacts: ["note_update_receipt"],
            confidence: 0.97,
          },
          {
            next_step: "answer",
            chosen_capability: null,
            reason: "The note creation receipt satisfies the mutation goal.",
            args: {},
            expected_artifacts: ["note_update_receipt"],
            confidence: 0.98,
          },
        ]),
      },
    });

    assertCodexShapedDebug(debug, {
      requireToolExecution: true,
      expectedCapability: "workstation-notes.create_note",
      expectedCoverageKind: "notes_mutation_coverage",
    });
    const invalidArgSummaries = artifactPayloads(debug, "runtime_tool_observation")
      .map((entry) => String(entry.summary ?? ""))
      .filter((entry) => /missing_required_arg:title/i.test(entry));
    expect(invalidArgSummaries).toEqual([]);
    expect(debug.final_answer_source).not.toBe("typed_failure");
    expect(String(debug.finalAnswer ?? debug.selected_final_answer ?? "")).toMatch(/Runtime Args Test|note/i);
  }, 60000);
});
