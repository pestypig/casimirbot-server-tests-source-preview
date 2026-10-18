import express from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { planRouter } from "../routes/agi.plan";
import { resetConversationalAnswerDistillationsForTest } from "../services/helix-ask/conversational-answer-distillation-store";
import { resetLiveSourcePipelinesForTest } from "../services/helix-ask/live-source-pipeline-executor";
import { resetReceiptPresentationSnapshotsForTest } from "../services/helix-ask/receipt-presentation-snapshot-store";
import { resetClientCapabilityActionsForTest } from "../services/client-capabilities/client-action-queue";
import { resetClientCapabilityAdoptionsForTest } from "../services/client-capabilities/client-adoption-store";
import { resetLiveAnswerEnvironments } from "../services/situation-room/live-answer-environment-store";
import { resetLiveFieldEvaluationsForTest } from "../services/situation-room/live-field-evaluation-store";
import { resetLiveFieldWorkerRunsForTest } from "../services/situation-room/live-field-worker-run-store";
import { resetLiveFieldWorkersForTest } from "../services/situation-room/live-field-worker-registry";
import { resetLivePipelineLifecycleForTest } from "../services/situation-room/live-pipeline-lifecycle-store";
import { resetLiveSituationRunsForTest } from "../services/situation-room/live-situation-run-store";
import { resetLiveSourceChunkBufferForTest } from "../services/situation-room/live-source-chunk-buffer";
import { resetLiveSourceProducerBindingsForTest } from "../services/situation-room/live-source-producer-binding";
import { resetLiveSourceProducerLifecycleForTest } from "../services/situation-room/live-source-producer-lifecycle-store";
import { resetLiveWorkerLanesForTest } from "../services/situation-room/live-worker-lane-store";
import { resetObservationJournalForTest } from "../services/situation-room/observation-journal-store";
import { resetProcedureEpochClosuresForTest } from "../services/situation-room/procedure-epoch-closure";
import { resetProcedureEpochLedgerForTest } from "../services/situation-room/procedure-epoch-ledger-store";
import { resetProcedureReasoningSnapshotsForTest } from "../services/situation-room/procedure-reasoning-snapshot-store";
import { resetSituationSourceCapabilitiesForTest } from "../services/situation-room/situation-source-capability-store";
import { resetVisualComparisonSessionsForTest } from "../services/situation-room/visual-comparison-session-store";
import { resetVisualProducerSchedulerAdoptionsForTest } from "../services/situation-room/visual-producer-scheduler-adoption-store";
import { resetVisualSceneMemoryForTest } from "../services/situation-room/visual-scene-memory-store";
import { resetVisualSnapshotStoreForTest } from "../services/situation-room/visual-snapshot-store";
import { resetVoiceLiveHandoffsForTest } from "../services/situation-room/voice-live-handoff-router";
import {
  expectAnswerMentionsAny,
  expectCodexParityRailTable,
  expectContextualToolMention,
  expectNegativeConstraint,
  expectNoMutatingToolCalls,
  expectNoShortCircuitFlags,
  expectNoTerminalArtifact,
  expectPrimaryIntent,
  expectRouteAuthorityOk,
  expectRouteNotSelected,
  expectSolverTrace,
  expectTerminalAuthorityOk,
} from "./helpers/expect-helix-solver-trace";
import { resetHelixAskTurnAdmissionForTests } from "../services/helix-ask/ask-turn-admission";
import { runtimeMemoryGovernor } from "../services/runtime/runtime-memory-governor";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/agi", planRouter);
  return app;
};

const TEST_MIB = 1024 * 1024;

const benchmarkLlmEnvKeys = [
  "LLM_POLICY",
  "LLM_RUNTIME",
  "LLM_HTTP_ALLOW_DEFAULT_OPENAI_BASE",
  "LLM_HTTP_BASE",
  "ENABLE_LLM_LOCAL_SPAWN",
  "LLM_LOCAL_CMD",
  "HELIX_ASK_AGENT_RUNTIME",
  "CODEX_AGENT_FAKE_STDOUT",
  "CODEX_AGENT_FAKE_EXIT_CODE",
] as const;
const benchmarkPreviousLlmEnv = Object.fromEntries(
  benchmarkLlmEnvKeys.map((key) => [key, process.env[key]]),
) as Record<(typeof benchmarkLlmEnvKeys)[number], string | undefined>;

const isolatePromptBenchmarkFromConfiguredLlmBackends = (): void => {
  process.env.LLM_POLICY = "";
  process.env.LLM_RUNTIME = "";
  process.env.LLM_HTTP_ALLOW_DEFAULT_OPENAI_BASE = "0";
  process.env.LLM_HTTP_BASE = "";
  process.env.ENABLE_LLM_LOCAL_SPAWN = "0";
  process.env.LLM_LOCAL_CMD = "";
  process.env.HELIX_ASK_AGENT_RUNTIME = "codex";
  process.env.CODEX_AGENT_FAKE_STDOUT =
    "This is a bounded conceptual answer produced without executing a workstation capability.";
  process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
};

const restorePromptBenchmarkLlmEnvironment = (): void => {
  for (const key of benchmarkLlmEnvKeys) {
    const previous = benchmarkPreviousLlmEnv[key];
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
};

const resetAll = (): void => {
  isolatePromptBenchmarkFromConfiguredLlmBackends();
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
  resetHelixAskTurnAdmissionForTests();
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
};

type BenchmarkCase = {
  id: string;
  category: string;
  prompt: string;
  primary: string[];
  contextualCue?: string;
  negativeConstraints?: RegExp[];
  answerMentions?: { label: string; patterns: RegExp[] };
  forbidRoutes?: string[];
  forbidArtifacts?: string[];
  requireNoShortCircuit?: boolean;
  requireRouteAuthority?: boolean;
  requireNoGatewayCalls?: boolean;
};

const forbiddenControlArtifacts = [
  "live_pipeline_receipt",
  "workspace_action_receipt",
  "visual_producer_cadence_receipt",
];

const cases: BenchmarkCase[] = [
  {
    id: "contextual_environment_probe_explanation",
    category: "contextual environment tool mention",
    prompt:
      "The connector documentation mentions room.environment.probe; explain what that capability means.",
    primary: ["general_reasoning", "content_question", "debug_diagnosis"],
    forbidRoutes: ["workspace_action", "live_pipeline_control"],
    forbidArtifacts: forbiddenControlArtifacts,
    requireNoGatewayCalls: true,
  },
  {
    id: "negated_minecraft_inventory_probe",
    category: "negated environment probe",
    prompt:
      "Do not check the Minecraft inventory; just explain what an inventory probe could observe.",
    primary: ["general_reasoning", "content_question"],
    negativeConstraints: [/do not check/i],
    forbidRoutes: ["workspace_action", "live_pipeline_control"],
    forbidArtifacts: forbiddenControlArtifacts,
    requireNoGatewayCalls: true,
  },
  {
    id: "minecraft_command_syntax_documentation_only",
    category: "Minecraft command-text documentation",
    prompt:
      "Before doing anything in Minecraft, look up the connected environment mechanics for how to capture only the exact wall footprint as a rollback checkpoint. Cite the exact source file and line range and give the exact command form. Do not execute any Minecraft command.",
    primary: [
      "implementation_question",
      "content_question",
      "general_reasoning",
      "debug_diagnosis",
    ],
    negativeConstraints: [/do not execute/i],
    forbidRoutes: ["workspace_action", "live_pipeline_control"],
    forbidArtifacts: forbiddenControlArtifacts,
  },
  {
    id: "future_conditional_environment_probe",
    category: "future/conditional environment probe",
    prompt:
      "If we check the current actor's Minecraft inventory later, what permission and freshness checks should happen first?",
    primary: ["general_reasoning", "debug_diagnosis"],
    forbidRoutes: ["workspace_action", "live_pipeline_control"],
    forbidArtifacts: forbiddenControlArtifacts,
    requireNoGatewayCalls: true,
  },
  {
    id: "historical_environment_probe",
    category: "historical environment probe",
    prompt:
      "Why did the previous turn mention com.casimirbot.minecraft.inventory.check, and did that prove a probe actually ran?",
    primary: ["debug_diagnosis", "general_reasoning"],
    forbidRoutes: ["workspace_action", "live_pipeline_control"],
    forbidArtifacts: forbiddenControlArtifacts,
    requireNoGatewayCalls: true,
  },
  {
    id: "quoted_screen_environment_probe",
    category: "quoted/screen-visible environment probe",
    prompt:
      "The screen says 'check inventory now'; explain that label without running the environment probe.",
    primary: ["content_question", "general_reasoning"],
    negativeConstraints: [/without running/i],
    forbidRoutes: ["workspace_action", "live_pipeline_control"],
    forbidArtifacts: forbiddenControlArtifacts,
    requireNoGatewayCalls: true,
  },
  {
    id: "mixed_environment_probe_explanation_only",
    category: "mixed-intent environment probe",
    prompt:
      "Help me understand the room state, but do not probe the inventory yet; describe what evidence would be needed.",
    primary: ["general_reasoning", "debug_diagnosis", "status_question"],
    negativeConstraints: [/do not probe/i],
    forbidRoutes: ["workspace_action", "live_pipeline_control"],
    forbidArtifacts: forbiddenControlArtifacts,
    requireNoGatewayCalls: true,
  },
  {
    id: "negated_interval_check_first",
    category: "negated command",
    prompt:
      "I haven't started the interval yet; explain what I should check first.",
    primary: ["general_reasoning", "debug_diagnosis", "status_question"],
    contextualCue: "interval",
    forbidRoutes: ["live_pipeline_control"],
    forbidArtifacts: forbiddenControlArtifacts,
  },
  {
    id: "negated_click_no_action",
    category: "negated command",
    prompt:
      "I did not click Start; explain the safest next diagnostic question.",
    primary: ["debug_diagnosis", "general_reasoning"],
    contextualCue: "click",
    forbidRoutes: ["workspace_action", "live_pipeline_control"],
    forbidArtifacts: forbiddenControlArtifacts,
  },
  {
    id: "historical_set_rate_justified",
    category: "historical tool mention",
    prompt:
      "Why did the previous answer suggest set_rate, and was that actually justified?",
    primary: ["debug_diagnosis"],
    contextualCue: "set_rate",
    forbidRoutes: ["live_pipeline_control"],
    forbidArtifacts: forbiddenControlArtifacts,
  },
  {
    id: "historical_tool_call_without_repeat",
    category: "historical tool mention",
    prompt:
      "The last turn mentioned a repair tool; explain whether that was a diagnosis or an action.",
    primary: ["debug_diagnosis", "general_reasoning"],
    contextualCue: "repair",
    forbidRoutes: ["live_pipeline_control", "workspace_action"],
    forbidArtifacts: forbiddenControlArtifacts,
  },
  {
    id: "conceptual_review_no_settings",
    category: "mixed intent",
    prompt: "Review this conceptually, but do not change any settings.",
    primary: ["general_reasoning", "debug_diagnosis"],
    negativeConstraints: [/do not change/i],
    forbidRoutes: ["live_pipeline_control", "workspace_action"],
    forbidArtifacts: forbiddenControlArtifacts,
  },
  {
    id: "explain_before_future_click",
    category: "mixed intent",
    prompt:
      "Explain the likely state before I click Start, without clicking anything.",
    primary: ["general_reasoning", "debug_diagnosis", "status_question"],
    contextualCue: "click",
    negativeConstraints: [/without clicking/i],
    forbidRoutes: ["workspace_action"],
    forbidArtifacts: forbiddenControlArtifacts,
  },
  {
    id: "quoted_start_capture",
    category: "false affordance / screen-visible tool word",
    prompt: "The text says 'Start Capture' on the page. What does that imply?",
    primary: ["content_question", "general_reasoning"],
    contextualCue: "quoted_tool_text",
    forbidRoutes: ["live_pipeline_control", "workspace_action"],
    forbidArtifacts: forbiddenControlArtifacts,
  },
  {
    id: "screen_visible_start_button",
    category: "false affordance / screen-visible tool word",
    prompt:
      "The screen shows a Start button; describe what that label implies without pressing it.",
    primary: ["content_question", "general_reasoning"],
    contextualCue: "start",
    negativeConstraints: [/without pressing/i],
    forbidRoutes: ["workspace_action", "live_pipeline_control"],
    forbidArtifacts: forbiddenControlArtifacts,
  },
  {
    id: "negated_calculator_open_no_action",
    category: "negated command",
    prompt:
      "Do not open the scientific calculator; just explain what E = h * f is missing.",
    primary: ["general_reasoning", "debug_diagnosis"],
    contextualCue: "calculator",
    negativeConstraints: [/do not open/i],
    forbidRoutes: ["workspace_action"],
    forbidArtifacts: forbiddenControlArtifacts,
  },
  {
    id: "future_calculator_prefill_no_action",
    category: "future/conditional tool mention",
    prompt:
      "Before I later put E = h * f into the calculator, tell me what evidence would be needed.",
    primary: ["general_reasoning", "debug_diagnosis"],
    contextualCue: "calculator",
    forbidRoutes: ["workspace_action"],
    forbidArtifacts: forbiddenControlArtifacts,
  },
  {
    id: "historical_calculator_tool_call_no_repeat",
    category: "historical tool mention",
    prompt:
      "Why did the previous turn call scientific-calculator.solve_expression, and was that justified?",
    primary: ["debug_diagnosis", "general_reasoning"],
    contextualCue: "scientific-calculator.solve_expression",
    forbidRoutes: ["workspace_action", "calculator_solve"],
    forbidArtifacts: forbiddenControlArtifacts,
  },
  {
    id: "quoted_calculator_label_no_action",
    category: "false affordance / screen-visible tool word",
    prompt:
      "The screen label says 'open the calculator'; describe what that label means without opening it.",
    primary: ["content_question", "general_reasoning"],
    contextualCue: "calculator",
    negativeConstraints: [/without opening/i],
    forbidRoutes: ["workspace_action"],
    forbidArtifacts: forbiddenControlArtifacts,
  },
  {
    id: "curly_quoted_theory_procedure_no_action",
    category: "false affordance / quoted scientific tool text",
    prompt:
      "The note quotes “Prepare a theory experiment procedure for badge study.casimir_dp.evidence_map_stage3.” What does this text mean?",
    primary: ["content_question", "general_reasoning"],
    forbidRoutes: ["theory_locator"],
    forbidArtifacts: [
      ...forbiddenControlArtifacts,
      "theory_experiment_procedure_observation",
    ],
  },
  {
    id: "debug_facts_rank_failure",
    category: "multi-step debug reasoning",
    prompt:
      "Given these debug facts: producer fresh, environment has no selected observations, and field evaluations are empty. Infer the most likely failure and rank alternatives.",
    primary: ["debug_diagnosis", "general_reasoning"],
    forbidArtifacts: forbiddenControlArtifacts,
  },
  {
    id: "capture_running_no_evidence_causes",
    category: "multi-step debug reasoning",
    prompt:
      "I think the capture is running but the answer says no evidence. What are three possible causes?",
    primary: ["debug_diagnosis", "general_reasoning", "status_question"],
    forbidRoutes: ["live_pipeline_control"],
    forbidArtifacts: forbiddenControlArtifacts,
  },
  {
    id: "ambiguous_capture_status",
    category: "ambiguous goal",
    prompt:
      "The capture might be stale or maybe the evidence selector missed it. What would you check?",
    primary: ["debug_diagnosis", "general_reasoning", "status_question"],
    forbidRoutes: ["live_pipeline_control"],
    forbidArtifacts: forbiddenControlArtifacts,
  },
  {
    id: "ambiguous_it_failed",
    category: "ambiguous goal",
    prompt:
      "It failed again; reason through what information is missing before recommending an action.",
    primary: ["general_reasoning", "debug_diagnosis"],
    forbidRoutes: ["workspace_action", "live_pipeline_control"],
    forbidArtifacts: forbiddenControlArtifacts,
  },
  {
    id: "open_run_nothing_debug_export",
    category: "instruction conflict",
    prompt: "Open nothing and run nothing; just reason from this debug export.",
    primary: ["debug_diagnosis", "general_reasoning"],
    negativeConstraints: [/open nothing/i, /run nothing/i],
    forbidRoutes: ["workspace_action", "live_pipeline_control"],
    forbidArtifacts: forbiddenControlArtifacts,
  },
  {
    id: "do_not_repair_reason_only",
    category: "instruction conflict",
    prompt:
      "Do not repair or refresh anything; explain what evidence would justify repair.",
    primary: ["debug_diagnosis", "general_reasoning"],
    negativeConstraints: [/do not repair/i],
    contextualCue: "repair",
    forbidRoutes: ["live_pipeline_control", "workspace_action"],
    forbidArtifacts: forbiddenControlArtifacts,
  },
  {
    id: "fresh_producer_no_selected_observations",
    category: "counterfactual diagnosis",
    prompt:
      "If the producer is fresh but the environment has no selected observations, what would you suspect?",
    primary: ["debug_diagnosis", "general_reasoning"],
    forbidRoutes: ["live_pipeline_control"],
    forbidArtifacts: forbiddenControlArtifacts,
  },
  {
    id: "counterfactual_field_empty",
    category: "counterfactual diagnosis",
    prompt:
      "If field evaluations are empty while the producer is healthy, what failure modes remain?",
    primary: ["debug_diagnosis", "general_reasoning", "status_question"],
    forbidArtifacts: forbiddenControlArtifacts,
  },
  {
    id: "implementation_plan_no_runtime",
    category: "implementation planning",
    prompt:
      "Plan how to add a guard for this behavior without running tools or changing settings.",
    primary: [
      "implementation_question",
      "repo_evidence_question",
      "general_reasoning",
    ],
    negativeConstraints: [/without running/i],
    forbidRoutes: ["live_pipeline_control", "workspace_action"],
    forbidArtifacts: forbiddenControlArtifacts,
  },
  {
    id: "implementation_question_no_receipt",
    category: "implementation planning",
    prompt:
      "Where should the solver record that a receipt is an observation and not an answer?",
    primary: [
      "implementation_question",
      "repo_evidence_question",
      "general_reasoning",
    ],
    forbidArtifacts: forbiddenControlArtifacts,
  },
  {
    id: "helix_codex_policy_comparison",
    category: "repo/Codex discipline comparison prompt",
    prompt:
      "Compare Helix Ask to Codex here: are we duplicating Codex runtime or adding evidence policy?",
    primary: [
      "repo_evidence_question",
      "implementation_question",
      "general_reasoning",
    ],
    forbidRoutes: ["live_pipeline_control", "workspace_action"],
    forbidArtifacts: forbiddenControlArtifacts,
  },
  {
    id: "poison_clean_not_route_authority",
    category: "repo/Codex discipline comparison prompt",
    prompt:
      "Explain why a clean poison audit is not enough if route authority fails.",
    primary: [
      "debug_diagnosis",
      "implementation_question",
      "general_reasoning",
    ],
    forbidArtifacts: forbiddenControlArtifacts,
  },
];

const promptBenchmarkPreludeOnly = process.env.HELIX_PROMPT_BENCHMARK_PRELUDE_ONLY === "1";
const promptBenchmarkCaseFilter = (() => {
  const raw = process.env.HELIX_PROMPT_BENCHMARK_CASE_IDS?.trim();
  if (!raw) return null;
  const ids = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return ids.length > 0 ? new Set(ids) : null;
})();
const enabledPromptBenchmarkCases = promptBenchmarkPreludeOnly
  ? []
  : promptBenchmarkCaseFilter
    ? cases.filter((scenario) => promptBenchmarkCaseFilter.has(scenario.id))
    : cases;

describe("Helix Ask prompt-only adversarial problem-solving benchmark", () => {
  beforeEach(resetAll);
  afterAll(restorePromptBenchmarkLlmEnvironment);

  const preludeTest = promptBenchmarkCaseFilter && !promptBenchmarkPreludeOnly ? it.skip : it;

  preludeTest("demotes an anaphoric scholarly request with a failure-only antecedent before source admission", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "helix-ask:prompt-solving:failure-only-referent",
        question:
          "Find scholarly references supporting the scientific claims we just discussed. Fetch the best three accessible sources.",
        mode: "read",
        debug: true,
        workspace_context_snapshot: {
          chat_referent_context: {
            schema: "helix.ask.chat_referent_context.v1",
            previous_assistant_final_answer: {
              role: "assistant",
              reply_id: "reply-failure-only",
              source_ref: "chat.final_answer.previous:reply-failure-only",
              text: "I could not complete that turn. Cause: terminal_authority_missing.",
            },
          },
        },
      })
      .expect(200);

    expect(response.body.canonical_goal_frame).toMatchObject({
      goal_kind: "model_only_concept",
      answer_scope: "model_only",
      required_terminal_kind: "direct_answer_text",
      classifier_reasons: expect.arrayContaining([
        "conversational_referent_resolved_before_source_admission",
        "referent_cannot_supply_requested_evidence",
      ]),
    });
    expect(response.body.workstation_gateway_call_results ?? []).toHaveLength(
      0,
    );
  }, 60_000);

  preludeTest("preserves scholarly source admission when a blocked referent still names an explicit current-turn topic", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "helix-ask:prompt-solving:explicit-topic-fallback",
        question:
          "Find scholarly references supporting the quantum-inequality claims we discussed. Search arXiv and the other scholarly providers, and fetch the best three accessible sources.",
        mode: "read",
        debug: true,
        workspace_context_snapshot: {
          chat_referent_context: {
            schema: "helix.ask.chat_referent_context.v1",
            previous_assistant_final_answer: {
              role: "assistant",
              reply_id: "reply-unrelated-runtime",
              source_ref: "chat.final_answer.previous:reply-unrelated-runtime",
              text: "Runtime verification can switch a neural-network controller to a safe backup.",
            },
          },
        },
      })
      .expect(200);

    expect(response.body.canonical_goal_frame?.goal_kind).not.toBe(
      "model_only_concept",
    );
    expect(
      response.body.canonical_goal_frame?.classifier_reasons ?? [],
    ).not.toContain("referent_cannot_supply_requested_evidence");
    expect(response.body.tool_call_admission_decision).toMatchObject({
      source_target: "scholarly_research",
      required: true,
      admitted_tool_families: expect.arrayContaining(["scholarly_research"]),
    });
  }, 60_000);

  preludeTest("does not demote an anaphoric scholarly request when the retained answer contains a scientific claim", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        sessionId: "helix-ask:prompt-solving:scientific-referent",
        question:
          "Find scholarly references supporting the scientific claims we just discussed. Fetch the best three accessible sources.",
        mode: "read",
        debug: true,
        workspace_context_snapshot: {
          chat_referent_context: {
            schema: "helix.ask.chat_referent_context.v1",
            previous_assistant_final_answer: {
              role: "assistant",
              reply_id: "reply-scientific",
              source_ref: "chat.final_answer.previous:reply-scientific",
              text: "Quantum inequalities constrain weighted negative-energy averages over finite sampling intervals.",
            },
          },
        },
      })
      .expect(200);

    expect(
      response.body.canonical_goal_frame?.classifier_reasons ?? [],
    ).not.toContain("referent_cannot_supply_requested_evidence");
    expect(response.body.canonical_goal_frame?.goal_kind).not.toBe(
      "model_only_concept",
    );
  }, 60_000);

  preludeTest("contains at least 20 prompt-only cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
  });

  it.each(enabledPromptBenchmarkCases)(
    "$category: $id",
    async (scenario) => {
      const app = createApp();
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          sessionId: `helix-ask:prompt-solving:${scenario.id}`,
          question: scenario.prompt,
          mode: "read",
          debug: true,
        })
        .expect(200);

      expectSolverTrace(response.body);
      expectCodexParityRailTable(response.body);
      expectPrimaryIntent(response.body, scenario.primary);
      expectNoMutatingToolCalls(response.body);
      expectNoTerminalArtifact(
        response.body,
        scenario.forbidArtifacts ?? forbiddenControlArtifacts,
      );
      for (const route of scenario.forbidRoutes ?? []) {
        expectRouteNotSelected(response.body, [route]);
      }
      if (scenario.contextualCue) {
        expectContextualToolMention(response.body, scenario.contextualCue);
      }
      for (const constraint of scenario.negativeConstraints ?? []) {
        expectNegativeConstraint(response.body, constraint);
      }
      if (scenario.requireRouteAuthority) {
        expectRouteAuthorityOk(response.body);
      }
      expectTerminalAuthorityOk(response.body);
      if (scenario.answerMentions) {
        expectAnswerMentionsAny(
          response.body,
          scenario.answerMentions.patterns,
          scenario.answerMentions.label,
        );
      }
      if (scenario.requireNoShortCircuit) {
        expectNoShortCircuitFlags(response.body);
      }
      if (scenario.requireNoGatewayCalls) {
        expect(
          response.body.workstation_gateway_call_results ?? [],
          "admission failure: contextual environment tool language executed a gateway call",
        ).toHaveLength(0);
      }
    },
    60_000,
  );
});
