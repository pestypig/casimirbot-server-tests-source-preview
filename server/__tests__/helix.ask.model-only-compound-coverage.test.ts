import { describe, expect, it } from "vitest";

import { buildHelixCompoundPromptContract } from "../services/helix-ask/prompt-interpretation";
import { applyModelDirectAnswerDraftStep } from "../services/helix-ask/model-direct-answer-step";
import { evaluateModelOnlyCompoundCoverageFromAnswer } from "../services/helix-ask/model-only-compound-coverage";
import { buildSolverControllerDecision } from "../services/helix-ask/solver-controller-decision";
import { applyHelixTerminalAuthoritySingleWriter } from "../services/helix-ask/terminal-authority-single-writer";

const prompt = "Compare an electron and a proton in three ways: charge, mass, and role in atoms. Then give one practical consequence of those differences.";
const completeAnswer = [
  "- Charge: electrons are negative, while protons are positive.",
  "- Mass: electrons are much lighter than protons.",
  "- Role in atoms: electrons occupy shells/clouds around the nucleus and participate in bonding, while protons sit in the nucleus and help define element identity.",
  "Practical consequence: opposite charges bind electrons to nuclei, enabling stable atoms and chemistry.",
].join("\n");

const basePayload = (turnId: string): Record<string, unknown> => ({
  turn_id: turnId,
  thread_id: "thread:test",
  active_prompt: prompt,
  route_reason_code: "model_only_concept",
  final_status: "final_answer",
  canonical_goal_frame: {
    turn_id: turnId,
    goal_kind: "model_only_concept",
    answer_scope: "model_only",
    required_terminal_kind: "direct_answer_text",
  },
  source_target_intent: {
    target_source: "unknown",
    target_kind: "unknown",
    strength: "none",
    allow_no_tool_direct: true,
  },
  route_authority_audit: {
    route_authority_ok: true,
  },
  poison_audit: {
    ok: true,
    violations: [],
  },
  terminal_equivalence_harness_result: {
    ok: true,
  },
  terminal_answer_authority: {
    route: "model_only_concept",
    terminal_artifact_kind: "direct_answer_text",
  },
  current_turn_artifact_ledger: [],
});

const withModelAnswer = (turnId: string, answer: string): Record<string, unknown> =>
  applyModelDirectAnswerDraftStep({
    turnId,
    promptText: prompt,
    payload: basePayload(turnId),
    agentStepDecision: {
      decision_id: `${turnId}:decision`,
      next_step: "answer",
      chosen_capability: "model.direct_answer",
    },
    draftText: answer,
  });

const installCoverage = (payload: Record<string, unknown>, turnId: string) => {
  const contract = buildHelixCompoundPromptContract(prompt, []);
  const artifacts = payload.current_turn_artifact_ledger as Array<Record<string, unknown>>;
  const coverage = evaluateModelOnlyCompoundCoverageFromAnswer({
    turnId,
    payload,
    artifactLedger: artifacts,
    promptText: prompt,
    compoundContract: contract,
  });
  payload.model_only_compound_coverage_from_answer = coverage;
  payload.compound_prompt_coverage_gate = coverage.compound_prompt_coverage_gate;
  if (coverage.passed) {
    payload.goal_satisfaction_evaluation = {
      schema: "helix.goal_satisfaction_evaluation.v1",
      satisfaction: "satisfied",
      next_decision: "allow_terminal",
      reason: "model_only_compound_answer_covers_required_parts",
    };
    payload.selected_final_answer = coverage.selected_candidate?.text;
    payload.answer = coverage.selected_candidate?.text;
    payload.text = coverage.selected_candidate?.text;
    payload.terminal_artifact_kind = coverage.selected_candidate?.artifact_kind === "final_answer_draft"
      ? "model_synthesized_answer"
      : "direct_answer_text";
    payload.final_answer_source = coverage.selected_candidate?.artifact_kind === "final_answer_draft"
      ? "final_answer_draft"
      : "model_direct_answer";
  }
  return coverage;
};

describe("model-only compound coverage from answer artifacts", () => {
  it("records Codex-style decision source and authority on model answer draft iterations", () => {
    const turnId = "ask:test:model-direct-runtime-authority";
    const payload = withModelAnswer(turnId, completeAnswer);
    const loop = payload.agent_runtime_loop as { iterations?: Array<Record<string, unknown>> };
    const answerIteration = loop.iterations?.find((iteration) => iteration.chosen_capability === "model.direct_answer");

    expect(answerIteration).toMatchObject({
      decision_source: "llm",
      decision_authority: "llm",
      next_step: "answer",
      observation_role: "model_answer_draft",
    });
    expect(payload.agent_step_decision).toMatchObject({
      decision_source: "llm",
      decision_authority: "llm",
      chosen_capability: "model.direct_answer",
    });
  });

  it("writes support refs and terminal metadata into model answer drafts", () => {
    const turnId = "ask:test:model-direct-doc-support-refs";
    const payload = applyModelDirectAnswerDraftStep({
      turnId,
      promptText: prompt,
      payload: basePayload(turnId),
      agentStepDecision: {
        decision_id: `${turnId}:decision`,
        next_step: "answer",
        chosen_capability: "model.direct_answer",
      },
      draftText: completeAnswer,
      artifactRefs: ["doc-summary:flow", "doc-summary:discipline"],
      supportRefs: ["doc-summary:flow", "doc-summary:discipline"],
      evidenceRefs: ["doc-summary:flow", "doc-summary:discipline"],
      goalKind: "doc_evidence_synthesis",
      requiredTerminalKind: "doc_evidence_synthesis_answer",
      modelStepCapability: "model.direct_answer",
    });
    const draft = payload.final_answer_draft as Record<string, unknown>;

    expect(draft).toMatchObject({
      goal_kind: "doc_evidence_synthesis",
      required_terminal_kind: "doc_evidence_synthesis_answer",
      model_step_capability: "model.direct_answer",
      artifact_refs: ["doc-summary:flow", "doc-summary:discipline"],
      support_refs: ["doc-summary:flow", "doc-summary:discipline"],
      evidence_refs: ["doc-summary:flow", "doc-summary:discipline"],
    });
  });

  it("normalizes preserved runtime loop iterations before appending a model answer draft", () => {
    const turnId = "ask:test:model-direct-normalizes-existing-loop";
    const payload = applyModelDirectAnswerDraftStep({
      turnId,
      promptText: prompt,
      payload: {
        ...basePayload(turnId),
        agent_runtime_loop: {
          schema: "helix.agent_runtime_loop.v1",
          iterations: [
            {
              iteration: 1,
              next_step: "next_action",
              chosen_capability: "docs-viewer.locate_in_doc",
              observation_role: "tool_observation",
            },
            {
              iteration: 2,
              next_step: "answer",
              chosen_capability: "model.direct_answer",
              decision_authority: "model",
              observation_role: "model_answer_draft",
            },
          ],
        },
      },
      agentStepDecision: {
        decision_id: `${turnId}:decision`,
        next_step: "answer",
        chosen_capability: "model.direct_answer",
      },
      draftText: completeAnswer,
    });
    const loop = payload.agent_runtime_loop as { iterations?: Array<Record<string, unknown>> };

    expect(loop.iterations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chosen_capability: "docs-viewer.locate_in_doc",
          decision_source: "deterministic_policy_fallback",
          decision_authority: "deterministic_policy_fallback",
        }),
        expect.objectContaining({
          chosen_capability: "model.direct_answer",
          decision_source: "llm",
          decision_authority: "llm",
        }),
      ]),
    );
    expect(loop.iterations?.every((iteration) =>
      iteration.decision_source === "llm" ||
      iteration.decision_source === "deterministic_policy_fallback",
    )).toBe(true);
    expect(loop.iterations?.every((iteration) =>
      iteration.decision_authority === "llm" ||
      iteration.decision_authority === "deterministic_policy_fallback",
    )).toBe(true);
  });

  it("passes electron/proton model-only compound coverage from the final draft", () => {
    const turnId = "ask:test:model-only-compound-pass";
    const payload = withModelAnswer(turnId, completeAnswer);
    const coverage = installCoverage(payload, turnId);

    expect(coverage.passed).toBe(true);
    expect(coverage.coverage_source).toBe("final_answer_draft");
    expect(coverage.unresolved_requirement_ids).toEqual([]);
    expect(payload.goal_satisfaction_evaluation).toMatchObject({
      satisfaction: "satisfied",
      next_decision: "allow_terminal",
    });

    const decision = buildSolverControllerDecision({
      turnId,
      finalRoute: "model_only_concept",
      payload,
    });
    expect(decision.blocking_reasons).not.toContain("compound_prompt_coverage_incomplete");
    expect(decision.decision).toBe("allow_terminal");
  });

  it("does not let stale model-only coverage supersede explicit compound tool capability requirements", () => {
    const turnId = "ask:test:model-only-compound-tool-contract";
    const payload = withModelAnswer(turnId, completeAnswer);
    const coverage = installCoverage(payload, turnId);
    payload.compound_capability_contract = {
      schema: "helix.compound_capability_contract.v1",
      turn_id: turnId,
      prompt_shape: "compound_capability",
      requires_all_subgoals: true,
      terminal_policy: "synthesize_from_satisfied_subgoal_observations",
      subgoals: [
        {
          subgoal_id: `${turnId}:compound_capability_subgoal:1:internet_search_web_research`,
          order: 1,
          requested_capability: "internet_search.web_research",
          runtime_capability: "internet-search.search_web",
          required_observation_kinds: ["internet_search_observation"],
          satisfaction: "pending",
        },
        {
          subgoal_id: `${turnId}:compound_capability_subgoal:2:scientific_calculator_solve_expression`,
          order: 2,
          requested_capability: "scientific-calculator.solve_expression",
          runtime_capability: "scientific-calculator.solve_expression",
          required_observation_kinds: ["calculator_result"],
          satisfaction: "pending",
        },
      ],
    };
    payload.tool_call_admission_decision = {
      compound_requested_capabilities: [
        "internet_search.web_research",
        "scientific-calculator.solve_expression",
      ],
    };
    payload.compound_prompt_coverage_gate = {
      schema: "helix.compound_prompt_coverage_gate.v1",
      applies: true,
      passed: false,
      decision: "FAIL_CLOSED",
      required_count: 2,
      answered_count: 0,
      unresolved_requirement_ids: ["internet_search.web_research", "scientific-calculator.solve_expression"],
    };

    const decision = buildSolverControllerDecision({
      turnId,
      finalRoute: "model_only_concept",
      payload,
    });

    expect(coverage.passed).toBe(true);
    expect(decision.blocking_reasons).toContain("compound_prompt_coverage_incomplete");
    expect(decision.compound_prompt_coverage_gate_superseded_by_answer_artifact).toBeUndefined();
    expect(decision.decision).not.toBe("allow_terminal");
  });

  it("keeps weak direct answers from satisfying compound coverage", () => {
    const turnId = "ask:test:model-only-compound-weak";
    const payload = withModelAnswer(turnId, "An electron is a fundamental subatomic particle.");
    const coverage = installCoverage(payload, turnId);

    expect(coverage.passed).toBe(false);
    expect(coverage.unresolved_requirement_ids.length).toBeGreaterThan(0);
  });

  it("uses a later good final draft over an earlier weak direct answer", () => {
    const turnId = "ask:test:model-only-compound-later-draft";
    const payload = withModelAnswer(turnId, completeAnswer);
    const artifacts = payload.current_turn_artifact_ledger as Array<Record<string, unknown>>;
    const direct = artifacts.find((artifact) => artifact.kind === "direct_answer_text");
    if (direct?.payload && typeof direct.payload === "object") {
      (direct.payload as Record<string, unknown>).text = "An electron is a fundamental subatomic particle.";
      (direct.payload as Record<string, unknown>).answer_text = "An electron is a fundamental subatomic particle.";
    }
    const coverage = installCoverage(payload, turnId);

    expect(coverage.passed).toBe(true);
    expect(coverage.candidate_kind).toBe("final_answer_draft");
    expect(coverage.coverage_source).toBe("final_answer_draft");
  });

  it("does not let source-targeted repo/docs prompts use generic model-only coverage", () => {
    const turnId = "ask:test:model-only-compound-source-forbidden";
    const payload = withModelAnswer(turnId, completeAnswer);
    payload.canonical_goal_frame = {
      turn_id: turnId,
      goal_kind: "repo_entity_definition",
      answer_scope: "source_tool_backed",
      required_terminal_kind: "repo_code_evidence_answer",
    };
    payload.source_target_intent = {
      target_source: "repo_code",
      target_kind: "repo_code",
      strength: "hard",
      allow_no_tool_direct: false,
    };
    payload.route_product_contract = {
      source_target: "repo_code",
    };

    const coverage = evaluateModelOnlyCompoundCoverageFromAnswer({
      turnId,
      payload,
      artifactLedger: payload.current_turn_artifact_ledger as Array<Record<string, unknown>>,
      promptText: "Open the docs viewer, find the Helix Ask Codex loop discipline document, and summarize what it says about receipts and final answers.",
      compoundContract: buildHelixCompoundPromptContract("Open the docs viewer, find the Helix Ask Codex loop discipline document, and summarize what it says about receipts and final answers.", []),
    });

    expect(coverage.applies).toBe(false);
    expect(coverage.route_scope).toBe("source_targeted_forbidden");
  });

  it("does not let typed failure outrank a coverage-valid model-only final draft", () => {
    const turnId = "ask:test:model-only-compound-terminal";
    const payload = withModelAnswer(turnId, completeAnswer);
    const coverage = installCoverage(payload, turnId);
    payload.terminal_artifact_kind = "typed_failure";
    payload.final_answer_source = "typed_failure";
    payload.terminal_error_code = "compound_prompt_coverage_incomplete";
    payload.typed_failure = {
      schema: "helix.typed_failure.v1",
      error_code: "compound_prompt_coverage_incomplete",
      message: "I could not complete this Ask turn because required compound prompt items were not resolved.",
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: payload.current_turn_artifact_ledger as Array<Record<string, unknown>>,
    });

    expect(coverage.passed).toBe(true);
    expect(result.selected_terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(result.source).toBe("final_answer_draft");
    expect(result.rejected_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "typed_failure",
          reason: "coverage_valid_model_only_answer_exists",
        }),
      ]),
    );
    expect(payload.final_answer_source).not.toBe("typed_failure");
  });
});
