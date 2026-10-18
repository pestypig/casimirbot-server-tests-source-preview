import { describe, expect, it } from "vitest";
import {
  HELIX_INTERNET_SEARCH_CAPABILITY,
  HELIX_INTERNET_SEARCH_OBSERVATION_SCHEMA,
  HELIX_MODEL_SYNTHESIZE_FROM_INTERNET_SEARCH_CAPABILITY,
} from "@shared/helix-internet-search-observation";
import { arbitrateAskSourceTarget } from "../services/helix-ask/ask-source-target-arbitrator";
import { buildCapabilityPlan } from "../services/helix-ask/capability-planner";
import { buildCapabilityResultGate } from "../services/helix-ask/capability-result-gate";
import { detectContextualToolAdmissionSuppression } from "../services/helix-ask/contextual-tool-admission";
import { buildEvidenceReentryGate } from "../services/helix-ask/evidence-reentry-gate";
import { materializeFinalAnswerDraftTerminal } from "../services/helix-ask/final-answer-draft-terminal-materializer";
import { buildToolUseRestatement, detectInternetSearchIntent } from "../services/helix-ask/internet-search-intent";
import { buildRouteProductContract } from "../services/helix-ask/route-product-contract";
import { buildToolCallAdmissionDecision } from "../services/helix-ask/tool-call-admission";
import { buildAskTurnSolverTrace } from "../services/helix-ask/ask-turn-solver";
import { __testHelixRuntimeToolCallValidation } from "../routes/agi.plan";
import {
  isInternetSearchProviderConfigurationMissing,
  runInternetSearch,
  type InternetSearchFetch,
} from "../services/helix-ask/retrieval/internet-search";

const canonicalGoal = (goal_kind: string, required_terminal_kind: string | null) => ({
  turn_id: "ask:internet-search",
  goal_kind,
  answer_scope: "external_internet_search",
  required_terminal_kind,
  allows_workspace_context: false,
  allows_prior_artifacts: false,
  corpus_anchors: [],
  numeric_tokens: [],
  concept_tokens: [],
  confidence: "high",
  classifier_reasons: ["test"],
});

const internetSearchEnvKeys = [
  "TAVILY_API_KEY",
  "EXA_API_KEY",
  "GOOGLE_CUSTOM_SEARCH_API_KEY",
  "GOOGLE_CSE_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_CUSTOM_SEARCH_ENGINE_ID",
  "GOOGLE_CUSTOM_SEARCH_CX",
  "GOOGLE_CSE_CX",
  "GOOGLE_CSE_ID",
  "GOOGLE_SEARCH_ENGINE_ID",
] as const;

const withInternetSearchEnv = async <T>(
  env: Partial<Record<(typeof internetSearchEnvKeys)[number], string | undefined>>,
  fn: () => Promise<T>,
): Promise<T> => {
  const previous = new Map<string, string | undefined>();
  for (const key of internetSearchEnvKeys) {
    previous.set(key, process.env[key]);
    if (Object.prototype.hasOwnProperty.call(env, key)) {
      const value = env[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }
  try {
    return await fn();
  } finally {
    for (const key of internetSearchEnvKeys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

describe("Helix internet search tool admission", () => {
  it("restates synthetic current-affairs analysis as a required internet evidence plan", () => {
    const promptText = [
      "Assess this current border conflict ceasefire resource-capacity scenario:",
      "Country A's marginal gains become too expensive, Country B has enough air defense capacity,",
      "and regional trade partners decide infrastructure stability is worth more than battlefield leverage.",
      "Is that a true prediction decision makers should keep in mind?",
    ].join(" ");
    const restatement = buildToolUseRestatement(promptText);
    expect(restatement).toMatchObject({
      artifactId: "tool_use_restatement",
      schemaVersion: "helix.tool_use_restatement.v1",
      freshnessRequired: true,
      currentAffairsRequired: true,
      requiredToolFamilies: ["internet_search"],
      notTerminal: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(restatement.minimumEvidencePlan).toMatchObject({
      minSearches: 2,
      minIndependentSources: 2,
      citationRequired: true,
    });

    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId: "ask:current-affairs",
      threadId: "helix-ask:test",
      promptText,
    });
    expect(sourceTargetIntent).toMatchObject({
      target_source: "internet_search",
      strength: "hard",
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
    });
    expect(sourceTargetIntent.explicit_cues).toEqual(expect.arrayContaining([
      "freshness_required",
      "current_affairs_required",
    ]));

    const routeProductContract = buildRouteProductContract({
      turnId: "ask:current-affairs",
      threadId: "helix-ask:test",
      sourceTargetIntent,
      promptText,
    });
    const toolAdmission = buildToolCallAdmissionDecision({
      turnId: "ask:current-affairs",
      sourceTargetIntent,
      routeProductContract,
      promptText,
    });
    expect(toolAdmission).toMatchObject({
      source_target: "internet_search",
      required: true,
      admitted_tool_families: ["internet_search"],
    });

    const plan = buildCapabilityPlan({
      turnId: "ask:current-affairs",
      promptText,
      sourceTargetIntent,
      routeProductContract,
      toolCallAdmissionDecision: toolAdmission,
      canonicalGoalFrame: canonicalGoal("internet_search_lookup", "internet_search_answer"),
    });
    expect(plan).toMatchObject({
      capability_family: "internet_search",
      requested_action: HELIX_INTERNET_SEARCH_CAPABILITY,
      admission_status: "needs_evidence",
      required_terminal_kind: "internet_search_answer",
    });

    const noReceiptGate = buildEvidenceReentryGate({
      turnId: "ask:current-affairs",
      payload: {
        current_turn_artifact_ledger: [],
      },
      primaryIntent: "content_question",
      terminalArtifactKind: "model_only_concept",
      finalAnswerSource: "model_only_concept",
      finalArbitrationRan: true,
      sourceEvidenceRequired: true,
      allowedTerminalProducts: ["internet_search_answer"],
      toolUseRestatement: restatement,
    });
    expect(noReceiptGate.completed).toBe(false);
    expect(noReceiptGate.violation_codes).toEqual(expect.arrayContaining([
      "source_observation_terminal_without_selection",
      "internet_search_evidence_plan_incomplete",
    ]));
  });

  it.each([
    {
      label: "negated cue",
      prompt: "Do not browse, just rewrite this paragraph about current events.",
      reason: "negated_tool_instruction",
    },
    {
      label: "screen-visible cue",
      prompt: "The phrase 'latest war update' appears on screen, do not search it.",
      reason: "screen_visible_tool_reference",
    },
    {
      label: "future/conditional cue",
      prompt: "In the future I may ask you to search current events, but not now.",
      reason: "hypothetical_tool_reference",
    },
    {
      label: "historical cue",
      prompt: "Earlier I searched current events; explain what that search step was meant to prove.",
      reason: "historical_tool_reference",
    },
    {
      label: "quoted cue",
      prompt: "Quote this prompt literally: 'search the latest conflict news'.",
      reason: "quoted_tool_command",
    },
    {
      label: "mixed intent prompt",
      prompt: "Country A / Country B current ceasefire reconstruction capacity analysis: do not browse; identify what evidence would be needed.",
      reason: "negated_tool_instruction",
    },
  ])("suppresses internet admission for adversarial $label", ({ prompt, reason }) => {
    const suppression = detectContextualToolAdmissionSuppression(prompt);
    expect(suppression).toMatchObject({
      tool_admission_suppressed: true,
      suppression_reason: reason,
      verb_or_cue: "internet_search.web_research",
    });
    const restatement = buildToolUseRestatement(prompt);
    expect(restatement.requiredToolFamilies).not.toContain("internet_search");
    expect(restatement.negativeConstraints.length + restatement.quotedOrContextualMentions.length).toBeGreaterThan(0);
    expect(detectInternetSearchIntent(prompt).searchRequested).toBe(false);

    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId: `ask:internet-adversarial:${reason}`,
      threadId: "helix-ask:test",
      promptText: prompt,
    });
    expect(sourceTargetIntent.target_source).not.toBe("internet_search");

    const toolAdmission = buildToolCallAdmissionDecision({
      turnId: `ask:internet-adversarial:${reason}`,
      sourceTargetIntent,
      promptText: prompt,
    });
    expect(toolAdmission.admitted_tool_families).not.toContain("internet_search");
  });

  it("allows no-browse current-event rewrites from supplied text only", () => {
    const prompt = [
      "Do not browse, just rewrite this paragraph about current events:",
      "Country A and Country B are discussing a possible ceasefire.",
    ].join(" ");
    const restatement = buildToolUseRestatement(prompt);
    expect(restatement.currentAffairsRequired).toBe(false);
    expect(restatement.freshnessRequired).toBe(false);
    expect(restatement.requiredToolFamilies).not.toContain("internet_search");
    expect(restatement.negativeConstraints).toEqual(expect.arrayContaining([
      expect.stringMatching(/do not browse/i),
      "supplied_text_only_task",
    ]));

    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId: "ask:no-browse-rewrite",
      threadId: "helix-ask:test",
      promptText: prompt,
    });
    expect(sourceTargetIntent.target_source).not.toBe("internet_search");

    const toolAdmission = buildToolCallAdmissionDecision({
      turnId: "ask:no-browse-rewrite",
      sourceTargetIntent,
      promptText: prompt,
    });
    expect(toolAdmission.admitted_tool_families).not.toContain("internet_search");
  });

  it("does not treat current Image Lens PDF page crop prompts as internet freshness requests", () => {
    const prompt = [
      "Use the current page 5 Image Lens PDF page.",
      "Crop only the exact equation row for equation (7) using bbox x=73, y=570, width=1077, height=87.",
      "Promote only if the returned crop itself contains the full equation body plus label (7).",
    ].join(" ");
    const restatement = buildToolUseRestatement(prompt);
    expect(restatement.freshnessRequired).toBe(false);
    expect(restatement.currentAffairsRequired).toBe(false);
    expect(restatement.requiredToolFamilies).not.toContain("internet_search");

    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId: "ask:current-image-lens-page-crop",
      threadId: "helix-ask:test",
      promptText: prompt,
    });
    expect(sourceTargetIntent.target_source).not.toBe("internet_search");

    const toolAdmission = buildToolCallAdmissionDecision({
      turnId: "ask:current-image-lens-page-crop",
      sourceTargetIntent,
      promptText: prompt,
    });
    expect(toolAdmission.admitted_tool_families).not.toContain("internet_search");
  });

  it("keeps a newest processed Minecraft mailbox packet on the local environment route", () => {
    const prompt = [
      "Read the newest unread processed Minecraft packet for this room.",
      "Record an evidence-grounded checkpoint for that exact packet and revise the next semantic plan only if its evidence warrants a change.",
      "Do not reuse prior turns, take a reflex action, or substitute a status probe.",
    ].join(" ");
    const restatement = buildToolUseRestatement(prompt);
    const internetIntent = detectInternetSearchIntent(prompt);
    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId: "ask:g4-natural-mailbox-prompt",
      threadId: "helix-ask:test",
      promptText: prompt,
    });
    const toolAdmission = buildToolCallAdmissionDecision({
      turnId: "ask:g4-natural-mailbox-prompt",
      sourceTargetIntent,
      promptText: prompt,
    });

    expect(restatement.freshnessRequired).toBe(false);
    expect(restatement.requiredToolFamilies).not.toContain("internet_search");
    expect(internetIntent.searchRequested).toBe(false);
    expect(sourceTargetIntent.target_source).not.toBe("internet_search");
    expect(toolAdmission.admitted_tool_families).not.toContain("internet_search");
  });

  it("keeps a current durable Minecraft room-goal report on bound room evidence", () => {
    const prompt = [
      "Using the canonical durable Minecraft goal in this room, report whether it completed.",
      "Summarize the verified wake-driven replanning, connector-epoch recovery, restored viable control, and terminal milestone state.",
      "Use current room evidence; do not execute a new game action or invent progress.",
    ].join(" ");
    const restatement = buildToolUseRestatement(prompt);
    const internetIntent = detectInternetSearchIntent(prompt);
    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId: "ask:g5-natural-room-goal-report",
      threadId: "helix-ask:room:test",
      promptText: prompt,
    });
    const toolAdmission = buildToolCallAdmissionDecision({
      turnId: "ask:g5-natural-room-goal-report",
      sourceTargetIntent,
      promptText: prompt,
    });

    expect(restatement.freshnessRequired).toBe(false);
    expect(restatement.requiredToolFamilies).not.toContain("internet_search");
    expect(internetIntent.searchRequested).toBe(false);
    expect(sourceTargetIntent.target_source).not.toBe("internet_search");
    expect(toolAdmission.admitted_tool_families).not.toContain("internet_search");
  });

  it.each([
    [
      "scientific closure preparation",
      "Continue with that exact enrollment. Prepare a current-turn execution plan changing permitted Dxx from 0.01 to 0.02 while freezing every other registered input. Bind the plan to the same badge orientation, source claim, Lanyon semantics, pinned Lean contract, primary and independent numerics, confirmation policy, and closure evaluator. Prepare only; do not start or evaluate.",
    ],
    [
      "scientific closure evaluation",
      "Now call scientific-evidence-closure.evaluate for that exact current-turn plan, using only current-turn confirmation, formal, and numerical artifacts that actually exist. If trusted confirmation or external sandbox attestations are absent, return the exact actionable blockers. Do not invent receipts, do not call the result canonical, and do not promote synthetic closure to empirical or physical evidence.",
    ],
  ])("does not reinterpret %s as current-web search", (_label, prompt) => {
    const restatement = buildToolUseRestatement(prompt);
    const internetIntent = detectInternetSearchIntent(prompt);
    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId: "ask:scientific-closure-current-turn",
      threadId: "helix-ask:test",
      promptText: prompt,
    });

    expect(restatement.freshnessRequired).toBe(false);
    expect(restatement.currentAffairsRequired).toBe(false);
    expect(restatement.requiredToolFamilies).not.toContain("internet_search");
    expect(internetIntent.searchRequested).toBe(false);
    expect(sourceTargetIntent.target_source).not.toBe("internet_search");
  });

  it("records quoted current-events phrases without admitting internet search from the quote alone", () => {
    const prompt = "Quote this prompt literally: 'search the latest conflict news'.";
    const restatement = buildToolUseRestatement(prompt);
    expect(restatement.quotedOrContextualMentions).toEqual(expect.arrayContaining([
      "'search the latest conflict news'",
    ]));
    expect(restatement.requiredToolFamilies).not.toContain("internet_search");

    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId: "ask:quoted-current-events",
      threadId: "helix-ask:test",
      promptText: prompt,
    });
    expect(sourceTargetIntent.target_source).not.toBe("internet_search");
  });

  it("keeps future or conditional browse mentions non-executable until an affirmative current request exists", () => {
    const prompt = "In the future I may ask you to search current events, but not now.";
    const restatement = buildToolUseRestatement(prompt);
    expect(restatement.requiredToolFamilies).not.toContain("internet_search");
    expect(restatement.negativeConstraints).toEqual(expect.arrayContaining([
      "hypothetical_tool_reference",
    ]));

    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId: "ask:future-browse-mention",
      threadId: "helix-ask:test",
      promptText: prompt,
    });
    expect(sourceTargetIntent.target_source).not.toBe("internet_search");
  });

  it("fails evidence re-entry when a complex current-affairs plan lacks independent search receipts", () => {
    const turnId = "ask:current-affairs-reentry";
    const restatement = buildToolUseRestatement("ongoing current-affairs resource constraint prompt: assess a ceasefire capacity prediction for decision makers.");
    const oneSourcePayload = {
      current_turn_artifact_ledger: [{
        artifact_id: `${turnId}:internet_search_observation:one`,
        kind: "internet_search_observation",
        payload: {
          schema: HELIX_INTERNET_SEARCH_OBSERVATION_SCHEMA,
          artifact_id: `${turnId}:internet_search_observation:one`,
          selected_for_answer: true,
          results: [{
            result_id: "source-a:1",
            title: "Source A",
            url: "https://source-a.example/current-analysis",
          }],
        },
      }],
    };
    const incompleteGate = buildEvidenceReentryGate({
      turnId,
      payload: oneSourcePayload,
      primaryIntent: "content_question",
      terminalArtifactKind: "internet_search_answer",
      finalAnswerSource: "model_synthesis_from_internet_search",
      finalArbitrationRan: true,
      sourceEvidenceRequired: true,
      allowedTerminalProducts: ["internet_search_answer"],
      toolUseRestatement: restatement,
    });
    expect(incompleteGate.violation_codes).toContain("internet_search_evidence_plan_incomplete");
    expect(incompleteGate.completed).toBe(false);

    const twoSourcePayload = {
      current_turn_artifact_ledger: [
        oneSourcePayload.current_turn_artifact_ledger[0],
        {
          artifact_id: `${turnId}:internet_search_observation:two`,
          kind: "internet_search_observation",
          payload: {
            schema: HELIX_INTERNET_SEARCH_OBSERVATION_SCHEMA,
            artifact_id: `${turnId}:internet_search_observation:two`,
            selected_for_answer: true,
            results: [{
              result_id: "source-b:1",
              title: "Source B",
              url: "https://source-b.example/current-analysis",
            }],
          },
        },
      ],
    };
    const completeGate = buildEvidenceReentryGate({
      turnId,
      payload: twoSourcePayload,
      primaryIntent: "content_question",
      terminalArtifactKind: "internet_search_answer",
      finalAnswerSource: "model_synthesis_from_internet_search",
      finalArbitrationRan: true,
      sourceEvidenceRequired: true,
      allowedTerminalProducts: ["internet_search_answer"],
      toolUseRestatement: restatement,
    });
    expect(completeGate.violation_codes).not.toContain("internet_search_evidence_plan_incomplete");
    expect(completeGate.completed).toBe(true);
  });

  it("surfaces tool-use restatement in the ask turn solver trace", () => {
    const turnId = "ask:solver-current-affairs";
    const promptText = "ongoing current-affairs resource constraint prompt: should Country A / Country B decision makers treat ceasefire capacity margins as predictive?";
    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId,
      threadId: "helix-ask:test",
      promptText,
    });
    const routeProductContract = buildRouteProductContract({
      turnId,
      threadId: "helix-ask:test",
      sourceTargetIntent,
      promptText,
    });
    const trace = buildAskTurnSolverTrace({
      turnId,
      promptText,
      selectedRoute: "internet_search_lookup",
      terminalArtifactKind: "direct_answer_text",
      finalAnswerSource: "model_direct_answer",
      payload: {
        turn_id: turnId,
        source_target_intent: sourceTargetIntent,
        route_product_contract: routeProductContract,
      },
    });
    expect(trace.tool_use_restatement).toMatchObject({
      schemaVersion: "helix.tool_use_restatement.v1",
      freshnessRequired: true,
      currentAffairsRequired: true,
      requiredToolFamilies: ["internet_search"],
      notTerminal: true,
    });
    expect(trace.evidence_reentry.required).toBe(true);
    expect(trace.evidence_reentry_gate.violation_codes).toEqual(expect.arrayContaining([
      "source_observation_terminal_without_selection",
      "internet_search_evidence_plan_incomplete",
    ]));
  });

  it("routes explicit web search prompts to the internet search evidence path", () => {
    const promptText = "Search the web for the latest NASA Artemis news and include source links.";
    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId: "ask:internet-search",
      threadId: "helix-ask:test",
      promptText,
    });
    expect(sourceTargetIntent).toMatchObject({
      target_source: "internet_search",
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(sourceTargetIntent.requested_outputs).toEqual(expect.arrayContaining([
      "web_search_results",
      "web_page_snippets",
      "source_links",
      "typed_failure",
    ]));

    const routeProductContract = buildRouteProductContract({
      turnId: "ask:internet-search",
      threadId: "helix-ask:test",
      sourceTargetIntent,
      promptText,
    });
    expect(routeProductContract).toMatchObject({
      source_target: "internet_search",
      precedence_reason: "internet_search_source_target_allows_only_external_web_evidence_terminal_products",
    });
    expect(routeProductContract.allowed_terminal_artifact_kinds).toContain("internet_search_answer");
    expect(routeProductContract.forbidden_terminal_artifact_kinds).toEqual(expect.arrayContaining([
      "direct_answer_text",
      "model_only_concept",
      "repo_code_evidence_answer",
      "scholarly_research_answer",
      "doc_summary",
    ]));

    const toolAdmission = buildToolCallAdmissionDecision({
      turnId: "ask:internet-search",
      sourceTargetIntent,
      routeProductContract,
      promptText,
    });
    expect(toolAdmission).toMatchObject({
      source_target: "internet_search",
      required: true,
      admitted_tool_families: ["internet_search"],
      reason: "internet_search_requires_external_web_evidence_path",
      assistant_answer: false,
      raw_content_included: false,
    });

    const plan = buildCapabilityPlan({
      turnId: "ask:internet-search",
      promptText,
      sourceTargetIntent,
      routeProductContract,
      toolCallAdmissionDecision: toolAdmission,
      canonicalGoalFrame: canonicalGoal("internet_search_lookup", "internet_search_answer"),
    });
    expect(plan).toMatchObject({
      capability_family: "internet_search",
      requested_action: HELIX_INTERNET_SEARCH_CAPABILITY,
      source_target: "internet_search",
      required_terminal_kind: "internet_search_answer",
      mutating: false,
      operator_command_required: false,
      operator_command_present: false,
      admission_status: "needs_evidence",
    });

    const result = buildCapabilityResultGate({
      plan,
      terminalArtifactKind: "internet_search_observation",
      terminalArtifactId: "ask:internet-search:internet_search_observation",
      currentTurnArtifacts: [
        {
          artifact_id: "ask:internet-search:internet_search_observation",
          kind: "internet_search_observation",
          turn_id: "ask:internet-search",
          payload: {
            schema: HELIX_INTERNET_SEARCH_OBSERVATION_SCHEMA,
            artifact_id: "ask:internet-search:internet_search_observation",
            evidence_refs: ["google_custom_search:nasa"],
            results: [{
              result_id: "google_custom_search:nasa",
              title: "NASA Artemis",
              url: "https://www.nasa.gov/artemis/",
            }],
          },
        },
      ],
      reenteredRefs: ["ask:internet-search:internet_search_observation"],
    });
    expect(result).toMatchObject({
      status: "succeeded",
      selected_for_answer: true,
      reentered_solver: true,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("keeps DOI and arXiv citation prompts on the scholarly research path", () => {
    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId: "ask:not-internet-search",
      threadId: "helix-ask:test",
      promptText: "Search arXiv for Hawking radiation citations and DOI references.",
    });
    expect(sourceTargetIntent.target_source).toBe("scholarly_research");
    expect(sourceTargetIntent.target_source).not.toBe("internet_search");
  });

  it("rejects empty internet search runtime args instead of falling back to the full prompt", () => {
    const availableCapabilities = {
      schema: "helix.available_capabilities.v1",
      turn_id: "ask:internet-validation",
      tool_admission_suppressed: false,
      capabilities: [
        {
          capability_key: HELIX_INTERNET_SEARCH_CAPABILITY,
          requires_action: true,
          availability: "available",
          goal_fit: "primary",
        },
      ],
    } as any;

    const emptySearch = __testHelixRuntimeToolCallValidation.validateHelixRuntimeToolCall({
      availableCapabilities,
      call: {
        schema: "helix.runtime_tool_call.v1",
        turn_id: "ask:internet-validation",
        call_id: "call:internet-empty",
        capability_key: HELIX_INTERNET_SEARCH_CAPABILITY,
        args: {},
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(emptySearch.validation.valid).toBe(false);
    expect(emptySearch.validation.args_valid).toBe(false);
    expect(emptySearch.validation.errors).toContain("missing_required_arg:query");

    const validSearch = __testHelixRuntimeToolCallValidation.validateHelixRuntimeToolCall({
      availableCapabilities,
      call: {
        schema: "helix.runtime_tool_call.v1",
        turn_id: "ask:internet-validation",
        call_id: "call:internet-query",
        capability_key: HELIX_INTERNET_SEARCH_CAPABILITY,
        args: { query: "latest NASA Artemis news" },
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(validSearch.validation.valid).toBe(true);
  });

  it("normalizes Google Custom Search results from alias env names into a nonterminal internet observation", async () => {
    const fetchImpl: InternetSearchFetch = async (url) => {
      const parsed = new URL(url);
      expect(parsed.hostname).toBe("www.googleapis.com");
      expect(parsed.searchParams.get("key")).toBe("alias-key");
      expect(parsed.searchParams.get("cx")).toBe("alias-engine");
      expect(parsed.searchParams.get("q")).toContain("latest NASA Artemis news");
      expect(parsed.searchParams.get("q")).toContain("site:nasa.gov");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [{
            title: "NASA Artemis Update",
            link: "https://www.nasa.gov/news/artemis-update",
            snippet: "NASA published an Artemis program update.",
            cacheId: "nasa-artemis-update",
          }],
        }),
      };
    };

    await withInternetSearchEnv({
      GOOGLE_API_KEY: "alias-key",
      GOOGLE_CSE_CX: "alias-engine",
    }, async () => {
      const observation = await runInternetSearch({
        turnId: "ask:google-search",
        callId: "call:google-search",
        query: "latest NASA Artemis news",
        providers: ["google_custom_search"],
        domains: ["nasa.gov"],
        limit: 3,
        fetchImpl,
      });
      expect(observation).toMatchObject({
        schema: HELIX_INTERNET_SEARCH_OBSERVATION_SCHEMA,
        artifact_id: "call:google-search:internet_search_observation",
        capability: HELIX_INTERNET_SEARCH_CAPABILITY,
        providers_considered: ["google_custom_search"],
        providers_called: ["google_custom_search"],
        selected_for_answer: true,
        assistant_answer: false,
        raw_content_included: false,
      });
      expect(observation.results).toEqual([
        expect.objectContaining({
          title: "NASA Artemis Update",
          url: "https://www.nasa.gov/news/artemis-update",
          source_provider: "google_custom_search",
          evidence_refs: [expect.stringContaining("google_custom_search:")],
        }),
      ]);
    });
  });

  it("marks missing provider configuration as nonretryable search evidence", async () => {
    await withInternetSearchEnv({}, async () => {
      const observation = await runInternetSearch({
        turnId: "ask:internet-config-missing",
        callId: "call:internet-config-missing",
        query: "latest NASA Artemis news",
        providers: ["google_custom_search"],
        limit: 3,
        fetchImpl: async () => {
          throw new Error("fetch should not run without provider keys");
        },
      });

      expect(observation).toMatchObject({
        schema: HELIX_INTERNET_SEARCH_OBSERVATION_SCHEMA,
        selected_for_answer: false,
        provider_configuration_missing: true,
        providers_called: [],
        results: [],
        assistant_answer: false,
        raw_content_included: false,
      });
      expect(observation.missing_requirements).toEqual(expect.arrayContaining([
        "google_custom_search_requires_google_custom_search_key_and_engine_id",
        "no_internet_search_results_returned",
      ]));
      expect(isInternetSearchProviderConfigurationMissing(observation)).toBe(true);
    });
  });

  it("materializes model-authored internet answers only after web observations and support refs", () => {
    const turnId = "ask:internet-materialize";
    const observationRef = `${turnId}:internet_search_observation`;
    const draftRef = `${turnId}:final_answer_draft`;
    const routeProductContract = {
      source_target: "internet_search",
      allowed_terminal_artifact_kinds: ["internet_search_answer", "typed_failure", "request_user_input"],
      forbidden_terminal_artifact_kinds: ["direct_answer_text", "scholarly_research_answer", "repo_code_evidence_answer"],
    };
    const artifacts = [
      {
        artifact_id: observationRef,
        kind: "internet_search_observation",
        payload: {
          schema: HELIX_INTERNET_SEARCH_OBSERVATION_SCHEMA,
          artifact_id: observationRef,
          evidence_refs: ["google_custom_search:nasa-artemis-update"],
          results: [{
            result_id: "google_custom_search:nasa-artemis-update",
            title: "NASA Artemis Update",
            url: "https://www.nasa.gov/news/artemis-update",
            snippet: "NASA published an Artemis program update.",
            evidence_refs: ["google_custom_search:nasa-artemis-update"],
          }],
        },
      },
      {
        artifact_id: draftRef,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: "NASA has an Artemis update available from its web source. Source: https://www.nasa.gov/news/artemis-update",
          authority: "llm_post_observation_composer",
          model_step_capability: HELIX_MODEL_SYNTHESIZE_FROM_INTERNET_SEARCH_CAPABILITY,
          grounded_in_observation_refs: [observationRef],
          artifact_refs: [observationRef],
          support_refs: [observationRef, "google_custom_search:nasa-artemis-update", "https://www.nasa.gov/news/artemis-update"],
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      active_prompt: "Search the web for the latest NASA Artemis news and include source links.",
      route_product_contract: routeProductContract,
      canonical_goal_frame: {
        goal_kind: "internet_search_lookup",
        required_terminal_kind: "internet_search_answer",
      },
      current_turn_artifact_ledger: artifacts,
    };

    const result = materializeFinalAnswerDraftTerminal({
      turnId,
      payload,
      artifactLedger: artifacts,
      routeProductContract,
    });

    expect(result).toMatchObject({
      ok: true,
      materialized_terminal_artifact_kind: "internet_search_answer",
      materialized_terminal_artifact_ref: `${turnId}:internet_search_answer:from_final_answer_draft`,
    });
    expect(payload.internet_search_answer).toMatchObject({
      schema: "helix.internet_search_answer.v1",
      answer_text: expect.stringContaining("https://www.nasa.gov/news/artemis-update"),
      model_authored: true,
      model_step_capability: HELIX_MODEL_SYNTHESIZE_FROM_INTERNET_SEARCH_CAPABILITY,
      support_refs: expect.arrayContaining([
        observationRef,
        "google_custom_search:nasa-artemis-update",
        "https://www.nasa.gov/news/artemis-update",
      ]),
    });
  });
});
