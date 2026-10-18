import { describe, expect, it } from "vitest";

import { buildAskTurnSolverTrace, evaluateAskTurnSolverHardGate } from "../services/helix-ask/ask-turn-solver";
import {
  assertCapabilityAllowedByCommittedRoute,
  buildCommittedAskRoute,
  buildRouteEvidenceAuthority,
  committedRouteAllowsTerminalKind,
  inferCommittedRouteToolFamily,
} from "../services/helix-ask/committed-ask-route";
import { interpretHelixAskPrompt } from "../services/helix-ask/prompt-interpretation";
import { auditRouteAuthority } from "../services/helix-ask/route-authority-audit";
import { resolveTerminalAnswerEnvelope } from "../services/helix-ask/terminal-answer-envelope";
import { applyHelixTerminalAuthoritySingleWriter } from "../services/helix-ask/terminal-authority-single-writer";
import { inferFinalAnswerDraftRouteFamily } from "../services/helix-ask/final-answer-draft-quality-gate";
import { buildHelixModelTurnPacket } from "../services/helix-ask/model-turn-packet";
import { runHelixModelTurnToolContinuation } from "../services/helix-ask/model-turn-tool-continuation";

const turnId = "ask:test:committed-route";
const promptText =
  "Compare docs/helix-ask-flow.md and docs/helix-ask-codex-loop-discipline.md in a two-column table.";

const docsSourceTarget = {
  schema: "helix.ask_source_target_intent.v1",
  turn_id: turnId,
  thread_id: "thread:test",
  target_source: "docs_viewer",
  target_kind: "docs_viewer",
  strength: "hard",
  explicit_cues: ["docs_path_compare"],
  reasons: ["explicit_docs_path_compare_source_target"],
  requested_outputs: ["file_path", "tool_call_eligibility"],
  suppressed_routes: ["repo_code_evidence_question", "model_only_concept"],
  precedence_reason: "explicit_docs_path_compare_source_target",
  must_enter_backend_ask: true,
  allow_client_shortcut: false,
  allow_no_tool_direct: false,
  confidence: 0.99,
  assistant_answer: false,
  raw_content_included: false,
};

const docsRouteContract = {
  schema: "helix.route_product_contract.v1",
  turn_id: turnId,
  thread_id: "thread:test",
  source_target: "docs_viewer",
  allowed_terminal_artifact_kinds: ["doc_evidence_synthesis", "typed_failure", "request_user_input"],
  forbidden_terminal_artifact_kinds: ["direct_answer_text", "model_only_concept"],
  required_artifact_refs: [],
  precedence_reason: "explicit_docs_path_compare_source_target",
  assistant_answer: false,
  raw_content_included: false,
};

describe("Helix Ask committed route contract", () => {
  it.each([
    "workstation.active_context",
    "workstation.readable_surface.observe",
    "account_session.set_interface_language",
  ])("classifies workstation gateway capability %s for committed-route admission", (capability) => {
    expect(inferCommittedRouteToolFamily(capability)).toBe("workstation_action");
  });

  it("keeps route evidence authority terminal allowance consistent with the required terminal kind", () => {
    const authority = buildRouteEvidenceAuthority({
      committedRoute: {
        schema: "helix.committed_ask_route.v1",
        turn_id: "ask:test:theory-reflection-authority-consistency",
        commit_id: "committed-route:test-theory-reflection",
        prompt_hash: "hash",
        committed_at_stage: "post_prompt_source_arbitration",
        prompt_intent: {
          primary_intent_kind: "general_reasoning",
          secondary_intent_kinds: [],
          interpretation_ref: "prompt_interpretation",
          arbitration_ref: "intent_arbitration",
        },
        route: {
          selected_route: "/ask",
          source_target: "theory_locator",
          target_kind: "theory_locator",
          strength: "hard",
          source_identity: null,
          route_reason: "explicit_capability_contract",
          stale_metadata_policy: "ignore_unless_matches_commit",
        },
        canonical_goal: {
          goal_kind: "theory_locator",
          required_terminal_kind: "theory_context_reflection_answer",
          allowed_terminal_artifact_kinds: ["final_answer_draft", "compound_evidence_synthesis_answer", "model_synthesized_answer"],
          forbidden_terminal_artifact_kinds: ["tool_receipt", "calculator_receipt"],
        },
        capability_policy: {
          allowed_tool_families: ["workstation_tool_gateway", "theory_locator"],
          suppressed_tool_families: [],
          required_capability_families: ["theory_locator"],
          mutating_families_allowed: false,
        },
        suppression: {
          contextual_tool_mentions: [],
          negative_constraints: [],
          suppressed_families: [],
          firewall_required: true,
        },
        terminal_product: {
          terminal_authority_required: true,
          evidence_reentry_required: true,
          followup_reasoning_required: false,
          required_terminal_product: "theory_context_reflection_answer",
        },
        transitions: [],
        compatibility: {
          source_goal_capability_terminal_compatible: true,
          stale_metadata_ignored: false,
          shortcut_firewall_applied: false,
          violations: [],
        },
        assistant_answer: false,
        raw_content_included: false,
      },
      payload: {
        turn_id: "ask:test:theory-reflection-authority-consistency",
      },
    });

    expect(authority.required_terminal_kind).toBe("theory_context_reflection_answer");
    expect(authority.allowed_terminal_artifact_kinds).toContain("theory_context_reflection_answer");
    expect(authority.forbidden_terminal_artifact_kinds).not.toContain("theory_context_reflection_answer");
  });

  it("allows direct model terminal products for plain no-source prompts", () => {
    const promptInterpretation = interpretHelixAskPrompt("Answer normally with no tools: what is 2+2?");
    const committedRoute = buildCommittedAskRoute({
      turnId: "ask:test:plain-model-only",
      promptText: "Answer normally with no tools: what is 2+2?",
      selectedRoute: "/ask",
      payload: {
        turn_id: "ask:test:plain-model-only",
        tool_call_admission_decision: {
          admitted_tool_families: ["model_only"],
        },
      },
      promptInterpretation,
      intentArbitration: {
        schema: "helix.intent_arbitration.v1",
        selected_primary_intent_id: "intent:general",
        selected_primary_intent_kind: "general_reasoning",
        secondary_intent_ids: [],
        contextual_tool_mentions: [],
        executable_operator_commands: [],
        route_candidates_allowed: ["/ask"],
        route_candidates_suppressed: [],
        terminal_products_allowed: ["typed_failure", "request_user_input"],
        terminal_products_forbidden: ["client_projection"],
        ambiguity_status: "resolved",
        assistant_answer: false,
        raw_content_included: false,
      },
    });

    expect(committedRoute.route.source_target).toBe("unknown");
    expect(committedRoute.canonical_goal.goal_kind).toBe("model_only_concept");
    expect(committedRoute.canonical_goal.required_terminal_kind).toBe("direct_answer_text");
    expect(committedRoute.canonical_goal.allowed_terminal_artifact_kinds).toEqual(expect.arrayContaining([
      "direct_answer_text",
      "model_synthesized_answer",
      "final_answer_draft",
      "agent_provider_terminal_candidate",
    ]));
    expect(committedRoute.terminal_product.required_terminal_product).toBe("direct_answer_text");

    const authority = buildRouteEvidenceAuthority({
      committedRoute,
      payload: {
        turn_id: "ask:test:plain-model-only",
        tool_call_admission_decision: {
          admitted_tool_families: ["model_only"],
        },
      },
    });
    expect(authority.terminal_product_allowed).toBe(true);
    expect(authority.allowed_terminal_artifact_kinds).toContain("direct_answer_text");
    expect(authority.allowed_terminal_artifact_kinds).toContain("agent_provider_terminal_candidate");
  });

  it("selects a direct answer for model-only routes with unknown source target", () => {
    const prompt = "theres a paper still in the image lens, can you see it?";
    const testTurnId = "ask:test:model-only-unknown-source-direct-answer";
    const promptInterpretation = interpretHelixAskPrompt(prompt);
    const payload: Record<string, unknown> = {
      turn_id: testTurnId,
      tool_call_admission_decision: {
        admitted_tool_families: ["model_only"],
      },
      canonical_goal_frame: {
        goal_kind: "model_only_concept",
        answer_scope: "model_only",
        required_terminal_kind: "direct_answer_text",
      },
      goal_satisfaction_evaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
    };
    payload.committed_ask_route = buildCommittedAskRoute({
      turnId: testTurnId,
      promptText: prompt,
      selectedRoute: "/ask",
      payload,
      promptInterpretation,
      intentArbitration: {
        schema: "helix.intent_arbitration.v1",
        selected_primary_intent_id: "intent:general",
        selected_primary_intent_kind: "general_reasoning",
        secondary_intent_ids: [],
        contextual_tool_mentions: [],
        executable_operator_commands: [],
        route_candidates_allowed: ["/ask"],
        route_candidates_suppressed: [],
        terminal_products_allowed: ["direct_answer_text"],
        terminal_products_forbidden: [],
        ambiguity_status: "resolved",
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    payload.route_evidence_authority = buildRouteEvidenceAuthority({
      committedRoute: payload.committed_ask_route as ReturnType<typeof buildCommittedAskRoute>,
      payload,
    });
    const answerText = "I can see there is still a paper loaded in Image Lens.";
    const artifactLedger = [{
      kind: "direct_answer_text",
      artifact_id: `${testTurnId}:model_only:direct_answer_text`,
      payload: {
        schema: "helix.direct_answer_text.v1",
        kind: "direct_answer_text",
        text: answerText,
        answer_text: answerText,
      },
    }];
    payload.current_turn_artifact_ledger = artifactLedger;

    const writer = applyHelixTerminalAuthoritySingleWriter({
      turnId: testTurnId,
      payload,
      artifactLedger,
    });

    expect((payload.committed_ask_route as ReturnType<typeof buildCommittedAskRoute>).route.source_target).toBe("unknown");
    expect(writer.selected_terminal_artifact_kind).toBe("direct_answer_text");
    expect(writer.source).toBe("direct_answer_text");
    expect(writer.visible_text).toBe(answerText);
    expect(payload.terminal_artifact_kind).toBe("direct_answer_text");
  });

  it("commits the admitted repo runtime capability with explicit route authority", () => {
    const prompt =
      "Find where the Helix Ask terminal authority is implemented in this codebase.";
    const testTurnId = "ask:test:repo-runtime-capability-route-repair";
    const payload: Record<string, unknown> = {
      turn_id: testTurnId,
      source_target_intent: {
        target_source: "repo_code",
        target_kind: "repo_code",
        strength: "hard",
        precedence_reason: "explicit_repo_code_source_target",
      },
      canonical_goal_frame: {
        goal_kind: "unknown",
        required_terminal_kind: "unknown",
      },
      tool_call_admission_decision: {
        requested_capability: "repo.search",
        selected_capability: "repo.search",
        admitted_capability: "repo.search",
        admitted_tool_families: ["repo_code"],
      },
    };
    const initial = buildCommittedAskRoute({
      turnId: testTurnId,
      promptText: prompt,
      selectedRoute: "/ask",
      payload,
    });
    expect(initial.route).toMatchObject({
      source_target: "repo_code",
      target_kind: "repo_code",
      strength: "hard",
      route_reason: "explicit_capability_contract",
    });
    expect(initial.canonical_goal).toMatchObject({
      goal_kind: "repo_evidence",
      required_terminal_kind: "repo_code_evidence_answer",
    });
    expect(initial.canonical_goal.allowed_terminal_artifact_kinds).toContain(
      "repo_code_evidence_answer",
    );
  });

  it("reports a specific runtime failure when model-only direct answer artifact is missing", () => {
    const prompt = "theres a paper still in the image lens, can you see it?";
    const testTurnId = "ask:test:model-only-runtime-not-called";
    const promptInterpretation = interpretHelixAskPrompt(prompt);
    const payload: Record<string, unknown> = {
      turn_id: testTurnId,
      selected_final_answer: "I could not produce a terminal answer for this turn.",
      final_answer_source: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      typed_failure: {
        schema: "helix.typed_failure.v1",
        error_code: "typed_failure",
        text: "I could not produce a terminal answer for this turn.",
      },
      tool_call_admission_decision: {
        admitted_tool_families: ["model_only"],
      },
      canonical_goal_frame: {
        goal_kind: "model_only_concept",
        answer_scope: "model_only",
        required_terminal_kind: "direct_answer_text",
      },
      goal_satisfaction_evaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
    };
    payload.committed_ask_route = buildCommittedAskRoute({
      turnId: testTurnId,
      promptText: prompt,
      selectedRoute: "/ask",
      payload,
      promptInterpretation,
      intentArbitration: {
        schema: "helix.intent_arbitration.v1",
        selected_primary_intent_id: "intent:general",
        selected_primary_intent_kind: "general_reasoning",
        secondary_intent_ids: [],
        contextual_tool_mentions: [],
        executable_operator_commands: [],
        route_candidates_allowed: ["/ask"],
        route_candidates_suppressed: [],
        terminal_products_allowed: ["direct_answer_text"],
        terminal_products_forbidden: [],
        ambiguity_status: "resolved",
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    payload.route_evidence_authority = buildRouteEvidenceAuthority({
      committedRoute: payload.committed_ask_route as ReturnType<typeof buildCommittedAskRoute>,
      payload,
    });

    const writer = applyHelixTerminalAuthoritySingleWriter({
      turnId: testTurnId,
      payload,
      artifactLedger: [],
    });

    expect(writer.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("model_runtime_not_called");
    expect(payload.selected_final_answer).toContain("required direct answer artifact");

    const authFailureText = "Codex was called, but this model is unavailable for the active authentication mode.";
    payload.terminal_error_code = "codex_model_not_supported_for_auth_mode";
    payload.terminal_failure_text = authFailureText;
    payload.selected_final_answer = authFailureText;
    payload.typed_failure = {
      schema: "helix.typed_failure.v1",
      error_code: "codex_model_not_supported_for_auth_mode",
      text: authFailureText,
    };
    const preservedFailureWriter = applyHelixTerminalAuthoritySingleWriter({
      turnId: testTurnId,
      payload,
      artifactLedger: [],
    });
    expect(preservedFailureWriter.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("codex_model_not_supported_for_auth_mode");
    expect(payload.selected_final_answer).toBe(authFailureText);
  });

  it("selects a direct answer when the committed route is only present in the solver trace", () => {
    const prompt = "theres a paper still in the image lens, can you see it?";
    const testTurnId = "ask:test:model-only-trace-route-direct-answer";
    const promptInterpretation = interpretHelixAskPrompt(prompt);
    const routePayload: Record<string, unknown> = {
      turn_id: testTurnId,
      tool_call_admission_decision: {
        admitted_tool_families: ["model_only"],
      },
      canonical_goal_frame: {
        goal_kind: "model_only_concept",
        answer_scope: "model_only",
        required_terminal_kind: "direct_answer_text",
      },
    };
    const committedRoute = buildCommittedAskRoute({
      turnId: testTurnId,
      promptText: prompt,
      selectedRoute: "/ask",
      payload: routePayload,
      promptInterpretation,
      intentArbitration: {
        schema: "helix.intent_arbitration.v1",
        selected_primary_intent_id: "intent:general",
        selected_primary_intent_kind: "general_reasoning",
        secondary_intent_ids: [],
        contextual_tool_mentions: [],
        executable_operator_commands: [],
        route_candidates_allowed: ["/ask"],
        route_candidates_suppressed: [],
        terminal_products_allowed: ["direct_answer_text"],
        terminal_products_forbidden: [],
        ambiguity_status: "resolved",
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    const routeEvidenceAuthority = buildRouteEvidenceAuthority({
      committedRoute,
      payload: routePayload,
    });
    const answerText = "Yes. The Image Lens panel still has a paper loaded.";
    const artifactLedger = [{
      kind: "direct_answer_text",
      artifact_id: `${testTurnId}:model_only:direct_answer_text`,
      payload: {
        schema: "helix.direct_answer_text.v1",
        kind: "direct_answer_text",
        text: answerText,
        answer_text: answerText,
      },
    }];
    const payload: Record<string, unknown> = {
      turn_id: testTurnId,
      ask_turn_solver_trace: {
        schema: "helix.ask_turn_solver_trace.v1",
        turn_id: testTurnId,
        committed_ask_route: committedRoute,
        route_evidence_authority: routeEvidenceAuthority,
      },
      current_turn_artifact_ledger: artifactLedger,
      goal_satisfaction_evaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
    };

    const writer = applyHelixTerminalAuthoritySingleWriter({
      turnId: testTurnId,
      payload,
      artifactLedger,
    });

    expect(payload.committed_ask_route).toMatchObject({
      schema: "helix.committed_ask_route.v1",
      canonical_goal: {
        goal_kind: "model_only_concept",
        required_terminal_kind: "direct_answer_text",
      },
    });
    expect(payload.route_evidence_authority).toMatchObject({
      schema: "helix.route_evidence_authority.v1",
      required_terminal_kind: "direct_answer_text",
    });
    expect(writer.selected_terminal_artifact_kind).toBe("direct_answer_text");
    expect(writer.source).toBe("direct_answer_text");
    expect(writer.visible_text).toBe(answerText);
  });

  it("reports runtime-not-called when a trace-only model route has no direct answer artifact", () => {
    const prompt = "theres a paper still in the image lens, can you see it?";
    const testTurnId = "ask:test:model-only-trace-route-runtime-not-called";
    const promptInterpretation = interpretHelixAskPrompt(prompt);
    const routePayload: Record<string, unknown> = {
      turn_id: testTurnId,
      tool_call_admission_decision: {
        admitted_tool_families: ["model_only"],
      },
      canonical_goal_frame: {
        goal_kind: "model_only_concept",
        answer_scope: "model_only",
        required_terminal_kind: "direct_answer_text",
      },
    };
    const committedRoute = buildCommittedAskRoute({
      turnId: testTurnId,
      promptText: prompt,
      selectedRoute: "/ask",
      payload: routePayload,
      promptInterpretation,
      intentArbitration: {
        schema: "helix.intent_arbitration.v1",
        selected_primary_intent_id: "intent:general",
        selected_primary_intent_kind: "general_reasoning",
        secondary_intent_ids: [],
        contextual_tool_mentions: [],
        executable_operator_commands: [],
        route_candidates_allowed: ["/ask"],
        route_candidates_suppressed: [],
        terminal_products_allowed: ["direct_answer_text"],
        terminal_products_forbidden: [],
        ambiguity_status: "resolved",
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    const routeEvidenceAuthority = buildRouteEvidenceAuthority({
      committedRoute,
      payload: routePayload,
    });
    const payload: Record<string, unknown> = {
      turn_id: testTurnId,
      selected_final_answer: "I could not produce a terminal answer for this turn.",
      final_answer_source: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      typed_failure: {
        schema: "helix.typed_failure.v1",
        error_code: "typed_failure",
        text: "I could not produce a terminal answer for this turn.",
      },
      ask_turn_solver_trace: {
        schema: "helix.ask_turn_solver_trace.v1",
        turn_id: testTurnId,
        committed_ask_route: committedRoute,
        route_evidence_authority: routeEvidenceAuthority,
      },
    };

    const writer = applyHelixTerminalAuthoritySingleWriter({
      turnId: testTurnId,
      payload,
      artifactLedger: [],
    });

    expect(writer.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("model_runtime_not_called");
    expect(payload.selected_final_answer).toContain("required direct answer artifact");
  });

  it("keeps quoted and negated tool-name explanations on a direct model terminal contract", () => {
    const prompt =
      "Explain the literal phrase `internet-search.search_web` as a software tool name. Do not browse, search, retrieve web evidence, or call tools.";
    const promptInterpretation = interpretHelixAskPrompt(prompt);
    const committedRoute = buildCommittedAskRoute({
      turnId: "ask:test:quoted-tool-model-only",
      promptText: prompt,
      selectedRoute: "/ask",
      payload: {
        turn_id: "ask:test:quoted-tool-model-only",
        tool_call_admission_decision: {
          admitted_tool_families: ["model_only"],
          suppressed_tool_families: ["internet_search"],
        },
      },
      promptInterpretation,
      intentArbitration: {
        schema: "helix.intent_arbitration.v1",
        selected_primary_intent_id: "intent:general",
        selected_primary_intent_kind: "general_reasoning",
        secondary_intent_ids: [],
        contextual_tool_mentions: promptInterpretation.contextual_tool_mentions,
        executable_operator_commands: [],
        route_candidates_allowed: ["/ask"],
        route_candidates_suppressed: ["internet_search"],
        terminal_products_allowed: ["typed_failure", "request_user_input"],
        terminal_products_forbidden: ["internet_search_answer", "client_projection"],
        ambiguity_status: "resolved",
        assistant_answer: false,
        raw_content_included: false,
      },
    });

    expect(committedRoute.canonical_goal.goal_kind).toBe("model_only_concept");
    expect(committedRoute.canonical_goal.allowed_terminal_artifact_kinds).toContain("direct_answer_text");
    expect(committedRoute.capability_policy.allowed_tool_families).not.toContain("internet_search");
    expect(committedRoute.capability_policy.suppressed_tool_families).toContain("internet_search");
  });

  it("records docs route versus stale model-only goal as incompatible", () => {
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      active_prompt: promptText,
      source_target_intent: docsSourceTarget,
      route_product_contract: docsRouteContract,
      canonical_goal_frame: {
        turn_id: turnId,
        goal_kind: "model_only_concept",
        required_terminal_kind: "direct_answer_text",
      },
      tool_call_admission_decision: {
        admitted_tool_families: ["docs_viewer"],
      },
    };

    const trace = buildAskTurnSolverTrace({
      turnId,
      promptText,
      selectedRoute: "docs_viewer.local_docs_path_compare",
      terminalArtifactKind: "direct_answer_text",
      finalAnswerSource: "model_direct_answer",
      payload,
    });

    expect(trace.committed_ask_route?.route.source_target).toBe("docs_viewer");
    expect(trace.committed_ask_route?.canonical_goal.goal_kind).toBe("model_only_concept");
    expect(trace.committed_route_compatibility?.violations).toContain(
      "source_target_goal_mismatch:model_only_concept_for_source_backed_route",
    );
  });

  it("blocks a model-requested capability that is suppressed by the committed route", () => {
    const prompt = '"Open docs/helix-ask-flow.md" is the command I typed earlier; explain whether that should run now.';
    const promptInterpretation = interpretHelixAskPrompt(prompt);
    const committedRoute = buildCommittedAskRoute({
      turnId,
      promptText: prompt,
      selectedRoute: "conversation:simple",
      promptInterpretation,
      payload: {
        turn_id: turnId,
        source_target_intent: {
          ...docsSourceTarget,
          target_source: "model_only",
          target_kind: "general_background",
          strength: "soft",
          allow_no_tool_direct: true,
        },
        canonical_goal_frame: {
          turn_id: turnId,
          goal_kind: "model_only_concept",
          required_terminal_kind: "direct_answer_text",
        },
        tool_call_admission_decision: {
          admitted_tool_families: ["model_only"],
          suppressed_tool_families: ["docs_viewer", "repo_code"],
        },
      },
    });

    const admission = assertCapabilityAllowedByCommittedRoute({
      committedRoute,
      capabilityId: "docs-viewer.open_doc_by_path",
      args: { path: "docs/helix-ask-flow.md" },
    });

    expect(admission.allowed).toBe(false);
    expect(admission.reason).toBe("committed_route_tool_family_suppressed");
  });

  it("fails closed when a known non-model capability has no committed route", () => {
    const admission = assertCapabilityAllowedByCommittedRoute({
      committedRoute: null,
      capabilityId: "scholarly-research.lookup_papers",
    });

    expect(admission.allowed).toBe(false);
    expect(admission.inferred_family).toBe("scholarly_research");
    expect(admission.reason).toBe("committed_route_missing_for_tool_capability");
  });

  it("keeps model-only compatibility when no committed route exists", () => {
    const admission = assertCapabilityAllowedByCommittedRoute({
      committedRoute: null,
      capabilityId: "model.direct_answer",
    });

    expect(admission.allowed).toBe(true);
    expect(admission.reason).toBe("committed_route_missing_model_only_compatibility");
  });

  it("allows scholarly lookup when the committed route admits scholarly research", () => {
    const committedRoute = buildCommittedAskRoute({
      turnId,
      promptText: "Look up arXiv 1106.5543 and summarize the paper metadata.",
      selectedRoute: "scholarly_research.lookup",
      payload: {
        turn_id: turnId,
        source_target_intent: {
          ...docsSourceTarget,
          target_source: "scholarly_research",
          target_kind: "paper_lookup",
          strength: "hard",
        },
        route_product_contract: {
          ...docsRouteContract,
          source_target: "scholarly_research",
          allowed_terminal_artifact_kinds: ["scholarly_research_answer", "typed_failure"],
          forbidden_terminal_artifact_kinds: ["model_synthesized_answer"],
        },
        canonical_goal_frame: {
          turn_id: turnId,
          goal_kind: "scholarly_research_answer",
          required_terminal_kind: "scholarly_research_answer",
        },
        tool_call_admission_decision: {
          admitted_tool_families: ["scholarly_research"],
        },
      },
    });

    const admission = assertCapabilityAllowedByCommittedRoute({
      committedRoute,
      capabilityId: "scholarly-research.lookup_papers",
    });

    expect(admission.allowed).toBe(true);
    expect(admission.inferred_family).toBe("scholarly_research");
    expect(admission.reason).toBe("capability_allowed_by_committed_route");
  });

  it("admits an explicit capability's semantic family alongside its gateway transport family", () => {
    const prompt = "Use only the Moral Graph. Reflect on whether I should apologize after snapping at a coworker.";
    const committedRoute = buildCommittedAskRoute({
      turnId: "ask:test:moral-graph-semantic-family",
      promptText: prompt,
      selectedRoute: "/ask",
      payload: {
        turn_id: "ask:test:moral-graph-semantic-family",
        tool_call_admission_decision: {
          requested_capability: "moral-graph.reflect_context",
          selected_capability: "moral-graph.reflect_context",
          admitted_tool_families: ["workstation_action"],
        },
      },
    });

    expect(committedRoute.route.source_target).toBe("moral_graph");
    expect(committedRoute.capability_policy.allowed_tool_families).toEqual(
      expect.arrayContaining(["workstation_action", "moral_graph_reflection"]),
    );
    expect(committedRoute.capability_policy.required_capability_families).toContain("moral_graph_reflection");
    expect(assertCapabilityAllowedByCommittedRoute({
      committedRoute,
      capabilityId: "moral-graph.reflect_context",
      fromShortcut: true,
    })).toMatchObject({ allowed: true, inferred_family: "moral_graph_reflection" });
    expect(assertCapabilityAllowedByCommittedRoute({
      committedRoute,
      capabilityId: "internet-search.search_web",
      fromShortcut: true,
    })).toMatchObject({ allowed: false, reason: "selected_capability_not_allowed_by_committed_route" });
  });

  it("projects route evidence authority without turning candidates into terminal authority", () => {
    const committedRoute = buildCommittedAskRoute({
      turnId,
      promptText,
      selectedRoute: "docs_viewer.local_docs_path_compare",
      payload: {
        turn_id: turnId,
        source_target_intent: docsSourceTarget,
        route_product_contract: docsRouteContract,
        canonical_goal_frame: {
          turn_id: turnId,
          goal_kind: "doc_evidence_synthesis",
          required_terminal_kind: "doc_evidence_synthesis",
        },
        tool_call_admission_decision: {
          selected_capability: "docs-viewer.locate_in_doc",
          admitted_capability: "docs-viewer.locate_in_doc",
          admitted_tool_families: ["docs_viewer"],
          suppressed_tool_families: ["scholarly_research"],
        },
        current_turn_artifact_ledger: [{
          artifact_id: "ask:test:doc-observation:1",
          kind: "docs_viewer_observation",
        }],
      },
    });

    const authority = buildRouteEvidenceAuthority({
      committedRoute,
      payload: {
        turn_id: turnId,
        tool_call_admission_decision: {
          selected_capability: "docs-viewer.locate_in_doc",
          admitted_capability: "docs-viewer.locate_in_doc",
          admitted_tool_families: ["docs_viewer"],
        },
        current_turn_artifact_ledger: [{
          artifact_id: "ask:test:doc-observation:1",
          kind: "docs_viewer_observation",
        }],
      },
    });

    expect(authority.schema).toBe("helix.route_evidence_authority.v1");
    expect(authority.candidate_tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability_id: "docs-viewer.locate_in_doc",
        family: "docs_viewer",
      }),
    ]));
    expect(authority.admitted_tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability_id: "docs-viewer.locate_in_doc",
        family: "docs_viewer",
      }),
    ]));
    expect(authority.supporting_evidence_refs).toContain("ask:test:doc-observation:1");
    expect(authority.allowed_terminal_artifact_kinds).toContain("doc_evidence_synthesis");
    expect(authority.terminal_product_allowed).toBe(true);
    expect(authority.assistant_answer).toBe(false);
  });

  it("preserves the committed route through model-turn continuation and blocks dispatch", async () => {
    const committedRoute = buildCommittedAskRoute({
      turnId,
      promptText,
      selectedRoute: "docs_viewer.local_docs_path_compare",
      payload: {
        turn_id: turnId,
        source_target_intent: docsSourceTarget,
        route_product_contract: docsRouteContract,
        canonical_goal_frame: {
          turn_id: turnId,
          goal_kind: "doc_evidence_synthesis",
          required_terminal_kind: "doc_evidence_synthesis",
        },
        tool_call_admission_decision: {
          admitted_tool_families: ["docs_viewer"],
          suppressed_tool_families: ["live_environment"],
        },
      },
    });
    const packet = buildHelixModelTurnPacket({
      turnId,
      promptText,
      payload: {
        turn_id: turnId,
        committed_ask_route: committedRoute,
        source_target_intent: docsSourceTarget,
        route_product_contract: docsRouteContract,
      },
      artifactLedger: [],
      availableCapabilities: [],
    });
    let executed = false;

    const result = await runHelixModelTurnToolContinuation({
      packet,
      payload: { turn_id: turnId, committed_ask_route: committedRoute },
      executeCapability: () => {
        executed = true;
        return { status: "succeeded" };
      },
      testResponseOverrides: [{
        status: "tool_call_requested",
        requested_tool_call: {
          capability_id: "live_env.read_processed_live_source_mail",
          args: {},
        },
      }],
    });

    expect(executed).toBe(false);
    expect(result.status).toBe("tool_continuation_blocked");
    expect(result.payload.committed_route_tool_admission).toMatchObject({
      allowed: false,
      reason: "committed_route_tool_family_suppressed",
    });
    expect(result.packets[0].committed_ask_route?.commit_id).toBe(committedRoute.commit_id);
  });

  it("terminal envelope rejects terminal kinds outside the committed route product", () => {
    const committedRoute = buildCommittedAskRoute({
      turnId,
      promptText,
      selectedRoute: "docs_viewer.local_docs_path_compare",
      payload: {
        turn_id: turnId,
        source_target_intent: docsSourceTarget,
        route_product_contract: docsRouteContract,
        canonical_goal_frame: {
          turn_id: turnId,
          goal_kind: "doc_evidence_synthesis",
          required_terminal_kind: "doc_evidence_synthesis",
        },
      },
    });
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      committed_ask_route: committedRoute,
      terminal_artifact_kind: "direct_answer_text",
      final_answer_source: "model_direct_answer",
      selected_final_answer: "This stale model-only answer should not publish.",
    };

    const envelope = resolveTerminalAnswerEnvelope(payload);

    expect(envelope.terminal_artifact_kind).toBe("typed_failure");
    expect(payload.committed_route_terminal_rejection).toMatchObject({
      reason: "committed_route_terminal_product_mismatch",
    });
  });

  it("allows model-only answers for quoted docs-path explanations while keeping docs terminals forbidden", () => {
    const prompt = '"Open docs/helix-ask-flow.md" is the command I typed earlier; explain whether that should run now.';
    const promptInterpretation = interpretHelixAskPrompt(prompt);
    const committedRoute = buildCommittedAskRoute({
      turnId,
      promptText: prompt,
      selectedRoute: "conversation:simple",
      promptInterpretation,
      payload: {
        turn_id: turnId,
        source_target_intent: {
          schema: "helix.ask_source_target_intent.v1",
          turn_id: turnId,
          thread_id: "thread:test",
          target_source: "model_only",
          target_kind: "general_background",
          strength: "soft",
          reasons: ["quoted_tool_command", "historical_tool_reference"],
          allow_no_tool_direct: true,
          assistant_answer: false,
          raw_content_included: false,
        },
        canonical_goal_frame: {
          turn_id: turnId,
          goal_kind: "model_only_concept",
          required_terminal_kind: "direct_answer_text",
        },
        tool_call_admission_decision: {
          admitted_tool_families: ["model_only"],
          suppressed_tool_families: ["docs_viewer", "repo_code"],
        },
      },
    });

    expect(committedRoute.route.source_target).toBe("model_only");
    expect(committedRoute.canonical_goal.goal_kind).toBe("model_only_concept");
    expect(committedRoute.capability_policy.suppressed_tool_families).toEqual(
      expect.arrayContaining(["docs_viewer", "repo_code"]),
    );
    expect(committedRoute.canonical_goal.allowed_terminal_artifact_kinds).toEqual(
      expect.arrayContaining(["direct_answer_text", "model_synthesized_answer", "final_answer_draft"]),
    );

    expect(committedRouteAllowsTerminalKind({
      committedRoute,
      terminalArtifactKind: "direct_answer_text",
      finalAnswerSource: "model_direct_answer",
    })).toBe(true);
    expect(committedRouteAllowsTerminalKind({
      committedRoute,
      terminalArtifactKind: "final_answer_draft",
      finalAnswerSource: "final_answer_draft",
    })).toBe(true);
    expect(committedRouteAllowsTerminalKind({
      committedRoute,
      terminalArtifactKind: "doc_summary",
      finalAnswerSource: "artifact_synthesis",
    })).toBe(false);

    const payload: Record<string, unknown> = {
      turn_id: turnId,
      committed_ask_route: committedRoute,
      terminal_artifact_kind: "direct_answer_text",
      final_answer_source: "model_direct_answer",
      selected_final_answer: "No. That quoted path is historical text to analyze, not a Docs Viewer command.",
    };

    const envelope = resolveTerminalAnswerEnvelope(payload);

    expect(envelope.terminal_artifact_kind).toBe("direct_answer_text");
    expect(envelope.final_answer_source).toBe("model_direct_answer");
    expect(envelope.terminal_text).toContain("not a Docs Viewer command");
    expect(payload.committed_route_terminal_rejection).toBeUndefined();

    const docsTerminalPayload: Record<string, unknown> = {
      turn_id: turnId,
      committed_ask_route: committedRoute,
      terminal_artifact_kind: "doc_summary",
      final_answer_source: "artifact_synthesis",
      selected_final_answer: "Summary: Helix Ask Flow",
    };

    const rejectedEnvelope = resolveTerminalAnswerEnvelope(docsTerminalPayload);

    expect(rejectedEnvelope.terminal_artifact_kind).toBe("typed_failure");
    expect(docsTerminalPayload.committed_route_terminal_rejection).toMatchObject({
      reason: "committed_route_terminal_product_mismatch",
      rejected_terminal_artifact_kind: "doc_summary",
    });
  });

  it("normalizes stale docs goal metadata under a model-only quoted docs command route", () => {
    const prompt =
      '"Open docs/helix-ask-flow.md and summarize it" is a quoted command from an earlier turn, not an instruction for this turn. Explain briefly whether Helix Ask should execute Docs Viewer now, and why.';
    const promptInterpretation = interpretHelixAskPrompt(prompt);
    const committedRoute = buildCommittedAskRoute({
      turnId,
      promptText: prompt,
      selectedRoute: "dispatch:act",
      promptInterpretation,
      payload: {
        turn_id: turnId,
        source_target_intent: {
          schema: "helix.ask_source_target_intent.v1",
          turn_id: turnId,
          thread_id: "thread:test",
          target_source: "model_only",
          target_kind: "general_background",
          strength: "hard",
          reasons: ["quoted_tool_command", "historical_tool_reference"],
          precedence_reason: "explicit_model_only_target",
          allow_no_tool_direct: true,
          assistant_answer: false,
          raw_content_included: false,
        },
        route_product_contract: {
          schema: "helix.route_product_contract.v1",
          turn_id: turnId,
          thread_id: "thread:test",
          source_target: "docs_viewer",
          allowed_terminal_artifact_kinds: [
            "doc_location_result",
            "request_user_input",
            "typed_failure",
            "active_doc_identity",
            "doc_open_receipt",
            "doc_summary",
            "model_synthesized_answer",
          ],
          forbidden_terminal_artifact_kinds: [
            "repo_code_evidence_answer",
            "direct_answer_text",
            "model_only_concept",
          ],
          precedence_reason: "docs_source_target_allows_only_document_terminal_products",
          assistant_answer: false,
          raw_content_included: false,
        },
        canonical_goal_frame: {
          turn_id: turnId,
          goal_kind: "summarize_doc",
          required_terminal_kind: "unknown",
        },
        tool_call_admission_decision: {
          admitted_tool_families: ["model_only"],
          suppressed_tool_families: ["workstation_action"],
        },
      },
    });

    expect(committedRoute.route.source_target).toBe("model_only");
    expect(committedRoute.canonical_goal).toMatchObject({
      goal_kind: "model_only_concept",
      required_terminal_kind: "direct_answer_text",
    });
    expect(committedRoute.capability_policy.suppressed_tool_families).toEqual(
      expect.arrayContaining(["docs_viewer", "repo_code"]),
    );
    expect(committedRoute.canonical_goal.allowed_terminal_artifact_kinds).toEqual(
      expect.arrayContaining(["direct_answer_text", "model_synthesized_answer", "final_answer_draft"]),
    );
    expect(committedRoute.canonical_goal.allowed_terminal_artifact_kinds).not.toContain("doc_summary");
    expect(committedRoute.canonical_goal.forbidden_terminal_artifact_kinds).toEqual(
      expect.arrayContaining(["doc_summary", "doc_open_receipt", "doc_evidence_synthesis_answer"]),
    );
    expect(committedRoute.canonical_goal.forbidden_terminal_artifact_kinds).not.toContain("direct_answer_text");

    expect(committedRouteAllowsTerminalKind({
      committedRoute,
      terminalArtifactKind: "direct_answer_text",
      finalAnswerSource: "model_direct_answer",
    })).toBe(true);
    expect(committedRouteAllowsTerminalKind({
      committedRoute,
      terminalArtifactKind: "final_answer_draft",
      finalAnswerSource: "model_direct_answer",
    })).toBe(true);
    expect(committedRouteAllowsTerminalKind({
      committedRoute,
      terminalArtifactKind: "doc_summary",
      finalAnswerSource: "artifact_synthesis",
    })).toBe(false);

    const envelope = resolveTerminalAnswerEnvelope({
      turn_id: turnId,
      committed_ask_route: committedRoute,
      terminal_artifact_kind: "direct_answer_text",
      final_answer_source: "model_direct_answer",
      selected_final_answer: "No. The quoted command is historical text, not a Docs Viewer instruction.",
    });

    expect(envelope.terminal_artifact_kind).toBe("direct_answer_text");
    expect(envelope.terminal_text).toContain("historical text");

    const routeAuthority = auditRouteAuthority({
      turnId,
      promptText: prompt,
      selectedRoute: "dispatch:act",
      terminalArtifactKind: "direct_answer_text",
      finalAnswerSource: "model_direct_answer",
      sourceTargetIntent: {
        target_source: "model_only",
        target_kind: "general_background",
        strength: "hard",
      },
      routeProductContract: {
        schema: "helix.route_product_contract.v1",
        source_target: "docs_viewer",
        allowed_terminal_artifact_kinds: ["doc_summary", "model_synthesized_answer"],
        forbidden_terminal_artifact_kinds: ["direct_answer_text", "model_only_concept"],
        precedence_reason: "docs_source_target_allows_only_document_terminal_products",
      },
      terminalArtifactSelectionGuard: { allowed: true },
      productAuthorityGuard: { allowed: true },
      committedAskRoute: committedRoute,
    });

    expect(routeAuthority.source_target).toBe("model_only");
    expect(routeAuthority.allowed_terminal_artifact_kinds).toEqual(
      expect.arrayContaining(["direct_answer_text", "model_synthesized_answer", "final_answer_draft"]),
    );
    expect(routeAuthority.forbidden_terminal_artifact_kinds).toEqual(expect.arrayContaining(["doc_summary"]));
    expect(routeAuthority.terminal_artifact_allowed).toBe(true);
    expect(routeAuthority.route_authority_ok).toBe(true);
    expect(routeAuthority.violation_codes).toEqual([]);

    const staleRouteAuthority = {
      ...routeAuthority,
      route_authority_ok: false,
      primary_violation_code: "poison_clean_but_authority_failed",
      route_authority_violation_code: "poison_clean_but_authority_failed",
      violation_codes: ["poison_clean_but_authority_failed"],
    };
    const hardGatePayload: Record<string, unknown> = {
      turn_id: turnId,
      active_prompt: prompt,
      committed_ask_route: committedRoute,
      source_target_intent: {
        target_source: "model_only",
        target_kind: "general_background",
        strength: "hard",
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "docs_viewer",
        allowed_terminal_artifact_kinds: ["doc_summary", "model_synthesized_answer"],
        forbidden_terminal_artifact_kinds: ["direct_answer_text", "model_only_concept"],
      },
      canonical_goal_frame: {
        goal_kind: "summarize_doc",
        required_terminal_kind: "unknown",
      },
      route_authority_audit: staleRouteAuthority,
      poison_audit: { ok: true },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        server_authoritative: true,
        terminal_artifact_kind: "direct_answer_text",
        final_answer_source: "model_direct_answer",
      },
      terminal_artifact_kind: "direct_answer_text",
      final_answer_source: "model_direct_answer",
      goal_satisfaction_evaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      runtime_authority_audit: {
        schema: "helix.runtime_authority_audit.v1",
        ok: true,
      },
      current_turn_artifact_ledger: [
        {
          kind: "direct_answer_text",
          payload: {
            kind: "direct_answer_text",
            text: "No. The quoted command is historical text, not a Docs Viewer instruction.",
          },
        },
        {
          kind: "final_answer_draft",
          payload: {
            kind: "final_answer_draft",
            text: "No. The quoted command is historical text, not a Docs Viewer instruction.",
          },
        },
        {
          kind: "runtime_authority_audit",
          payload: {
            schema: "helix.runtime_authority_audit.v1",
            ok: true,
          },
        },
      ],
    };
    const trace = buildAskTurnSolverTrace({
      turnId,
      promptText: prompt,
      selectedRoute: "dispatch:act",
      terminalArtifactKind: "direct_answer_text",
      finalAnswerSource: "model_direct_answer",
      payload: hardGatePayload,
    });
    hardGatePayload.ask_turn_solver_trace = trace;

    const hardGate = evaluateAskTurnSolverHardGate({
      turnId,
      payload: hardGatePayload,
      trace,
      loopParityTrace: {
        route_authority_ok: false,
        poison_audit_ok: true,
        terminal_authority_ok: true,
        short_circuit_risk_flags: ["poison_clean_but_authority_failed"],
        actual_tool_calls: [],
      },
    });

    expect(hardGate.failed).toBe(false);
    expect(hardGate.failure_codes).not.toContain("poison_clean_but_authority_failed");
  });

  it("publishes model-only direct answers despite stale docs route-product contract metadata", () => {
    const prompt =
      '"Open docs/helix-ask-flow.md and summarize it" is a quoted command from an earlier turn, not an instruction for this turn. Explain briefly whether Helix Ask should execute Docs Viewer now, and why.';
    const promptInterpretation = interpretHelixAskPrompt(prompt);
    const committedRoute = buildCommittedAskRoute({
      turnId,
      promptText: prompt,
      selectedRoute: "dispatch:act",
      promptInterpretation,
      payload: {
        turn_id: turnId,
        source_target_intent: {
          target_source: "model_only",
          target_kind: "general_background",
          strength: "hard",
          reasons: ["quoted_tool_command", "historical_tool_reference"],
          precedence_reason: "explicit_model_only_target",
          allow_no_tool_direct: true,
          assistant_answer: false,
          raw_content_included: false,
        },
        route_product_contract: {
          schema: "helix.route_product_contract.v1",
          source_target: "docs_viewer",
          allowed_terminal_artifact_kinds: ["doc_summary", "model_synthesized_answer"],
          forbidden_terminal_artifact_kinds: ["direct_answer_text", "model_only_concept"],
          precedence_reason: "docs_source_target_allows_only_document_terminal_products",
          assistant_answer: false,
          raw_content_included: false,
        },
        canonical_goal_frame: {
          goal_kind: "summarize_doc",
          required_terminal_kind: "unknown",
        },
        tool_call_admission_decision: {
          admitted_tool_families: ["model_only"],
          suppressed_tool_families: ["docs_viewer", "repo_code"],
        },
      },
    });
    const answerText = "No. Helix Ask should not execute Docs Viewer because the quoted command is historical context for this turn.";
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      active_prompt: prompt,
      committed_ask_route: committedRoute,
      source_target_intent: {
        target_source: "model_only",
        target_kind: "general_background",
        strength: "hard",
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "docs_viewer",
        allowed_terminal_artifact_kinds: ["doc_summary", "model_synthesized_answer"],
        forbidden_terminal_artifact_kinds: ["direct_answer_text", "model_only_concept"],
        precedence_reason: "docs_source_target_allows_only_document_terminal_products",
      },
      canonical_goal_frame: {
        goal_kind: "summarize_doc",
        required_terminal_kind: "unknown",
      },
      goal_satisfaction_evaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      runtime_authority_audit: {
        schema: "helix.runtime_authority_audit.v1",
        ok: true,
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        server_authoritative: true,
        terminal_artifact_kind: "direct_answer_text",
        final_answer_source: "model_direct_answer",
      },
    };
    const artifactLedger = [
      {
        kind: "direct_answer_text",
        artifact_id: `${turnId}:model_only:direct_answer_text`,
        payload: {
          schema: "helix.direct_answer_text.v1",
          kind: "direct_answer_text",
          text: answerText,
          answer_text: answerText,
        },
      },
      {
        kind: "final_answer_draft",
        artifact_id: `${turnId}:final_answer_draft`,
        payload: {
          schema: "helix.final_answer_draft.v1",
          kind: "final_answer_draft",
          text: answerText,
          answer_text: answerText,
        },
      },
      {
        kind: "direct_answer_text",
        artifact_id: `${turnId}:model_only:direct_answer_text:latest`,
        payload: {
          schema: "helix.direct_answer_text.v1",
          kind: "direct_answer_text",
          text: answerText,
          answer_text: answerText,
        },
      },
    ];
    payload.current_turn_artifact_ledger = artifactLedger;

    expect(inferFinalAnswerDraftRouteFamily({
      payload,
      routeProductContract: payload.route_product_contract as Record<string, unknown>,
      artifactLedger,
    })).toBe("model_only");

    const writer = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      payload,
      artifactLedger,
    });
    expect(writer.selected_terminal_artifact_kind).toBe("direct_answer_text");
    expect(writer.source).toBe("direct_answer_text");
    expect(writer.visible_text).toBe(answerText);
    expect(payload.terminal_artifact_kind).toBe("direct_answer_text");
    expect(payload.final_answer_source).toBe("model_direct_answer");
    expect(payload.selected_final_answer).toBe(answerText);
  });
});
