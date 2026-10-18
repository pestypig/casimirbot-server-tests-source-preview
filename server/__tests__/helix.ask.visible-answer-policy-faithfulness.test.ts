import { beforeAll, describe, expect, it } from "vitest";

import crypto from "node:crypto";
import { canonicalizeCasimirSpecValueV1 } from "@shared/contracts/casimir-spec-scientific-claim-ir.v1";
import { THEORY_EXPERIMENT_EXECUTION_CLOSURE_HASH_DOMAIN } from "@shared/contracts/theory-experiment-execution-closure.v1";
import {
  applyTerminalAnswerEnvelope,
  resolveTerminalAnswerEnvelope,
} from "../services/helix-ask/terminal-answer-envelope";
import { applyHelixTerminalAuthoritySingleWriter } from "../services/helix-ask/terminal-authority-single-writer";
import { evaluateVisibleAnswerPolicyFaithfulnessGate } from "../services/helix-ask/visible-answer-policy-faithfulness-gate";
import { buildTheoryExecutionClosureTerminalFixture } from "./fixtures/theory-execution-closure-terminal-fixture";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const buildModelOnlyPayload = (input: {
  prompt: string;
  answer?: string;
  negativeConstraints?: string[];
  executableOperatorCommands?: unknown[];
  actualToolCalls?: unknown[];
  includeLoopParityTrace?: boolean;
  toolLifecycleTraces?: unknown[];
}): Record<string, unknown> => {
  const answer =
    input.answer ??
    "The quoted label identifies a preparatory workflow action.";
  const actualToolCalls = input.actualToolCalls ?? [];
  return {
    turn_id: "ask:test:visible-no-tool-faithfulness",
    thread_id: "thread:test",
    terminal_artifact_kind: "direct_answer_text",
    final_answer_source: "model_direct_answer",
    source_target_intent: {
      target_source: "model_only",
      target_kind: "general_background",
    },
    canonical_goal_frame: {
      goal_kind: "model_only_concept",
      answer_scope: "model_only",
      required_terminal_kind: "direct_answer_text",
    },
    goal_satisfaction_evaluation: {
      satisfaction: "satisfied",
      next_decision: "allow_terminal",
    },
    agent_step_decision: {
      decision_id: "decision:model-direct",
      next_step: "answer",
      chosen_capability: "model.direct_answer",
    },
    agent_runtime_loop: {
      iterations: [
        {
          decision_id: "decision:model-direct",
          next_step: "answer",
          chosen_capability: "model.direct_answer",
          decision_timing: "terminal_review",
          decision_authority: "model",
          observation_role: "model_answer_draft",
          observed_artifact_refs: ["direct-answer-1"],
        },
      ],
    },
    direct_answer_text: {
      schema: "helix.direct_answer_text.v1",
      artifact_id: "direct-answer-1",
      source: "model_direct_answer",
      produced_by: "agent_runtime_loop",
      text: answer,
    },
    terminal_presentation: {
      schema: "helix.terminal_presentation.v1",
      concise_text: answer,
    },
    tool_use_restatement: {
      schemaVersion: "helix.tool_use_restatement.v1",
      userGoal: input.prompt,
      negativeConstraints: input.negativeConstraints ?? [],
      quotedOrContextualMentions: [],
    },
    ask_turn_solver_trace: {
      prompt_interpretation: {
        negative_constraints: input.negativeConstraints ?? [],
        contextual_tool_mentions: [],
        executable_operator_commands: input.executableOperatorCommands ?? [],
      },
    },
    workstation_gateway_call_results: actualToolCalls,
    capability_lane_call_results: [],
    ...(input.includeLoopParityTrace === false
      ? {}
      : {
          loop_parity_trace: {
            actual_tool_calls: actualToolCalls,
          },
        }),
    ...(input.toolLifecycleTraces
      ? { tool_lifecycle_traces: input.toolLifecycleTraces }
      : {}),
  };
};

describe("Helix Ask visible-answer no-tool policy faithfulness", () => {
  it.each([
    [
      "screen-visible label",
      "The screen text says `workspace.inspect`. Explain what that label means, but do not call it or any other tool.",
      ["do not call"],
    ],
    [
      "quoted tool name",
      'Explain the literal phrase "internet-search.search_web" as a software tool name. Never execute any tools.',
      ["never execute any tools"],
    ],
  ])(
    "requires an explicit non-execution acknowledgement for a %s explanation",
    (_label, prompt, negativeConstraints) => {
      const payload = buildModelOnlyPayload({ prompt, negativeConstraints });
      const gate = evaluateVisibleAnswerPolicyFaithfulnessGate({
        turnId: "ask:test:visible-no-tool-faithfulness",
        text: "The quoted label identifies a preparatory workflow action.",
        payload,
      });

      expect(gate.applies).toBe(true);
      expect(gate.ok).toBe(false);
      expect(gate.violations).toContain(
        "explicit_no_tool_acknowledgement_missing",
      );
    },
  );

  it("repairs the selected terminal presentation only after zero-call evidence is present", () => {
    const prompt =
      "The screen text says `workspace.inspect`. Explain what that label means, but do not call it or any other tool.";
    const payload = buildModelOnlyPayload({
      prompt,
      negativeConstraints: ["do not call"],
    });

    const envelope = resolveTerminalAnswerEnvelope(payload);
    applyTerminalAnswerEnvelope(payload, envelope);

    expect(envelope.terminal_text).toMatch(
      /I did not execute or call any tool for this explanation\.$/,
    );
    expect(payload.selected_final_answer).toBe(envelope.terminal_text);
    expect(payload.answer).toBe(envelope.terminal_text);
    expect(payload.terminal_presentation).toMatchObject({
      concise_text: envelope.terminal_text,
    });
    expect(payload.visible_answer_policy_faithfulness_gate).toMatchObject({
      ok: false,
      violations: ["explicit_no_tool_acknowledgement_missing"],
      repair_allowed: true,
    });
    expect(payload.visible_answer_policy_faithfulness_repair).toMatchObject({
      repaired: true,
      violations: ["explicit_no_tool_acknowledgement_missing"],
    });
  });

  it("repairs a pre-finalizer payload from empty executor surfaces and resolved terminal values", () => {
    const prompt =
      "The screen text says `workspace.inspect`. Explain what that label means, but do not call it or any other tool.";
    const payload = buildModelOnlyPayload({
      prompt,
      negativeConstraints: ["do not call"],
      includeLoopParityTrace: false,
    });
    delete payload.terminal_artifact_kind;
    delete payload.final_answer_source;

    const preFinalizerGate = evaluateVisibleAnswerPolicyFaithfulnessGate({
      turnId: "ask:test:visible-no-tool-faithfulness",
      text: "The quoted label identifies a preparatory workflow action.",
      payload: {
        ...payload,
        terminal_artifact_kind: "direct_answer_text",
        final_answer_source: "model_direct_answer",
      },
    });
    const envelope = resolveTerminalAnswerEnvelope(payload);

    expect(preFinalizerGate.violations).toContain(
      "explicit_no_tool_acknowledgement_missing",
    );
    expect(envelope.terminal_artifact_kind).toBe("direct_answer_text");
    expect(envelope.terminal_text).toMatch(
      /I did not execute or call any tool for this explanation\.$/,
    );
  });

  it("repairs from the finalizer prompt when prompt projections are not yet attached", () => {
    const prompt =
      "The screen text says `workspace.inspect`. Explain what that label means, but do not call it or any other tool.";
    const payload = buildModelOnlyPayload({
      prompt,
      negativeConstraints: [],
      includeLoopParityTrace: false,
    });
    delete payload.tool_use_restatement;
    delete payload.ask_turn_solver_trace;

    const envelope = resolveTerminalAnswerEnvelope(payload, { prompt });

    expect(envelope.terminal_text).toMatch(
      /I did not execute or call any tool for this explanation\.$/,
    );
  });

  it("repairs at the provider single-writer boundary from the active prompt and provider executor surfaces", () => {
    const prompt =
      "The screen says `theory-experiment-procedure.prepare`. Explain what that label means, but do not call it or any other tool.";
    const payload = buildModelOnlyPayload({
      prompt,
      negativeConstraints: [],
      includeLoopParityTrace: false,
    });
    delete payload.tool_use_restatement;
    delete payload.ask_turn_solver_trace;
    delete payload.workstation_gateway_call_results;
    delete payload.capability_lane_call_results;
    payload.debug = {
      workstation_gateway_call_results: [],
      capability_lane_call_results: [],
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      payload,
      turnId: "ask:test:visible-no-tool-faithfulness",
      threadId: "thread:test",
      prompt,
      artifactLedger: [],
    });

    expect(result.selected_terminal_artifact_kind).toBe("direct_answer_text");
    expect(result.visible_text).toMatch(
      /I did not execute or call any tool for this explanation\.$/,
    );
  });

  it("does not assert non-execution when either executor proof surface is absent", () => {
    const prompt =
      "The screen text says `workspace.inspect`. Explain what that label means, but do not call it or any other tool.";
    const payload = buildModelOnlyPayload({
      prompt,
      negativeConstraints: ["do not call"],
      includeLoopParityTrace: false,
    });
    delete payload.capability_lane_call_results;

    const gate = evaluateVisibleAnswerPolicyFaithfulnessGate({
      turnId: "ask:test:visible-no-tool-faithfulness",
      text: "The quoted label identifies a preparatory workflow action.",
      payload,
    });

    expect(gate.violations).not.toContain(
      "explicit_no_tool_acknowledgement_missing",
    );
    expect(gate.ok).toBe(true);
  });

  it("does not duplicate an acknowledgement already supplied by the model", () => {
    const prompt =
      "The screen text says `workspace.inspect`. Explain what that label means, but do not call it or any other tool.";
    const answer =
      "The label names a read-only inspection action. No tool was called for this explanation.";
    const payload = buildModelOnlyPayload({
      prompt,
      answer,
      negativeConstraints: ["do not call"],
    });

    const gate = evaluateVisibleAnswerPolicyFaithfulnessGate({
      turnId: "ask:test:visible-no-tool-faithfulness",
      text: answer,
      payload,
    });
    delete payload.tool_use_restatement;
    const envelope = resolveTerminalAnswerEnvelope(payload, { prompt });

    expect(gate.ok).toBe(true);
    expect(gate.violations).not.toContain(
      "explicit_no_tool_acknowledgement_missing",
    );
    expect(envelope.terminal_text).toBe(answer);
  });

  it("does not claim non-execution for a genuine affirmative command", () => {
    const prompt =
      "The screen shows `workspace.inspect`. Call it now and explain the result; do not call any other tool.";
    const actualToolCall = {
      tool_id: "workspace.inspect",
      family: "workspace_diagnostic",
      status: "succeeded",
    };
    const payload = buildModelOnlyPayload({
      prompt,
      negativeConstraints: ["do not call any other tool"],
      executableOperatorCommands: [
        {
          verb: "call",
          target: "workspace.inspect",
        },
      ],
      actualToolCalls: [actualToolCall],
    });

    const gate = evaluateVisibleAnswerPolicyFaithfulnessGate({
      turnId: "ask:test:visible-no-tool-faithfulness",
      text: "The inspection completed and returned a status result.",
      payload,
    });

    expect(gate.violations).not.toContain(
      "explicit_no_tool_acknowledgement_missing",
    );
    expect(gate.ok).toBe(true);
  });
});

describe("Helix Ask visible-answer theory identity coverage", () => {
  const prompt =
    "Locate the Stage 3 Casimir-DP evidence-map theory and the energy-density theory in the Theory Badge Graph. Explain their registered relationship and claim boundary without treating graph proximity as proof.";

  const theoryPayload = (): Record<string, unknown> => ({
    terminal_artifact_kind: "theory_context_reflection_answer",
    final_answer_source: "theory_context_reflection_answer",
    tool_use_restatement: {
      userGoal: prompt,
    },
  });

  it("flags a theory-reflection terminal that drops a requested graph identity", () => {
    const gate = evaluateVisibleAnswerPolicyFaithfulnessGate({
      turnId: "ask:test:theory-identity-coverage",
      text: "The graph places the energy-density theory near diagnostic claim-boundary rows. Proximity is context evidence, not proof.",
      payload: theoryPayload(),
    });

    expect(gate.applies).toBe(true);
    expect(gate.ok).toBe(false);
    expect(gate.violations).toContain(
      "requested_theory_identity_coverage_missing",
    );
  });

  it("does not flag a bounded answer that retains every requested graph identity", () => {
    const gate = evaluateVisibleAnswerPolicyFaithfulnessGate({
      turnId: "ask:test:theory-identity-coverage",
      text: "The requested Stage 3 Casimir-DP evidence-map theory and energy-density theory are query anchors. The reflection can describe registered rows, but graph proximity is not proof.",
      payload: theoryPayload(),
    });

    expect(gate.ok).toBe(true);
    expect(gate.violations).not.toContain(
      "requested_theory_identity_coverage_missing",
    );
  });

  it("repairs only the visible theory-reflection presentation with a bounded query-scope line", () => {
    const answer =
      "The graph places the energy-density theory near diagnostic claim-boundary rows. Proximity is context evidence, not proof.";
    const payload = {
      ...theoryPayload(),
      turn_id: "ask:test:theory-identity-coverage",
      thread_id: "thread:test",
      selected_final_answer: answer,
      answer,
      text: answer,
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        concise_text: answer,
      },
    };

    const envelope = resolveTerminalAnswerEnvelope(payload);

    expect(envelope.terminal_text).toContain(
      "Stage 3 Casimir-DP evidence-map theory",
    );
    expect(envelope.terminal_text).toContain("energy-density theory");
    expect(envelope.terminal_text).toContain("query scope only");
    expect(envelope.terminal_text).toContain(
      "does not assert a registered relationship or proof",
    );
  });

  it("repairs theory identity coverage from the single-writer prompt before prompt projections attach", () => {
    const answer =
      "The graph places the energy-density theory near diagnostic claim-boundary rows. Proximity is context evidence, not proof.";
    const payload = {
      ...theoryPayload(),
      turn_id: "ask:test:theory-identity-coverage",
      thread_id: "thread:test",
      selected_final_answer: answer,
      answer,
      text: answer,
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        concise_text: answer,
      },
    };
    delete (payload as Record<string, unknown>).tool_use_restatement;

    const envelope = resolveTerminalAnswerEnvelope(payload, { prompt });

    expect(envelope.terminal_text).toContain(
      "Stage 3 Casimir-DP evidence-map theory",
    );
    expect(envelope.terminal_text).toContain("query scope only");
  });
});

describe("Helix Ask visible-answer unsupported Lanyon boundary coverage", () => {
  const turnId = "ask:test:unsupported-lanyon-boundary";
  const answer =
    "Lanyon is ineligible for this request. Exact typed limitation: `unsupported_lanyon_case`.";
  const procedureObservation = {
    artifact_id: `${turnId}:codex_normalized:theory_experiment_procedure_observation:1`,
    kind: "theory_experiment_procedure_observation",
    payload: {
      schema: "casimir.theory_experiment_procedure.observation.v1",
      turn_id: turnId,
      status: "succeeded",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      procedure: {
        lanyonEligibility: {
          requested: true,
          status: "ineligible",
          requestedCaseId: "unregistered_2d_adaptive_mesh_advection_diffusion",
          blockers: ["unsupported_lanyon_case"],
        },
        authority: {
          preparesProcedureOnly: true,
          executesTools: false,
          terminalEligible: false,
          assistantAnswer: false,
        },
      },
    },
  };
  const payload = (): Record<string, unknown> => ({
    turn_id: turnId,
    thread_id: "thread:test",
    terminal_artifact_kind: "model_synthesized_answer",
    final_answer_source: "final_answer_draft",
    selected_final_answer: answer,
    answer,
    text: answer,
    current_turn_artifact_ledger: [procedureObservation],
    terminal_presentation: {
      schema: "helix.terminal_presentation.v1",
      concise_text: answer,
    },
  });

  it("repairs an ineligible procedure answer with the requested case and verified non-execution boundary", () => {
    const activePayload = payload();
    const gate = evaluateVisibleAnswerPolicyFaithfulnessGate({
      turnId,
      text: answer,
      payload: activePayload,
    });
    const envelope = resolveTerminalAnswerEnvelope(activePayload);

    expect(gate.violations).toContain(
      "unsupported_lanyon_boundary_coverage_missing",
    );
    expect(envelope.terminal_text).toContain(
      "unregistered_2d_adaptive_mesh_advection_diffusion",
    );
    expect(envelope.terminal_text).toContain(
      "2D adaptive mesh advection diffusion",
    );
    expect(envelope.terminal_text).toContain(
      "did not run code or execute a Lanyon job",
    );
  });

  it("does not infer the boundary from a stale or non-authoritative observation", () => {
    const activePayload = payload();
    const staleArtifact = structuredClone(procedureObservation);
    staleArtifact.payload.turn_id = "ask:test:stale-turn";
    staleArtifact.payload.procedure.authority.executesTools = true;
    activePayload.current_turn_artifact_ledger = [staleArtifact];

    const gate = evaluateVisibleAnswerPolicyFaithfulnessGate({
      turnId,
      text: answer,
      payload: activePayload,
    });

    expect(gate.violations).not.toContain(
      "unsupported_lanyon_boundary_coverage_missing",
    );
  });
});

describe("Helix Ask theory execution-closure claim ceiling", () => {
  const turnId = "ask:test:execution-closure-claim-ceiling";
  const blockedTurnId = `${turnId}:blocked`;
  const selectedTerminalRef = `${turnId}:model_synthesized_answer`;
  const blockedSelectedTerminalRef = `${blockedTurnId}:model_synthesized_answer`;
  let readyArtifacts: Record<string, unknown>[] = [];
  let blockedArtifacts: Record<string, unknown>[] = [];
  let closureArtifact: Record<string, unknown> = {};
  let blockedClosureArtifact: Record<string, unknown> = {};
  let semanticSupportRef = "";

  beforeAll(async () => {
    const ready = await buildTheoryExecutionClosureTerminalFixture({
      turnId,
      semanticReady: true,
    });
    const blocked = await buildTheoryExecutionClosureTerminalFixture({
      turnId: blockedTurnId,
      semanticReady: false,
    });
    readyArtifacts = ready.artifacts;
    blockedArtifacts = blocked.artifacts;
    closureArtifact = ready.closureArtifact;
    blockedClosureArtifact = blocked.closureArtifact;
    semanticSupportRef = ready.semanticSupportRef ?? "";
  });

  const payload = (): Record<string, unknown> => ({
    turn_id: turnId,
    terminal_artifact_kind: "model_synthesized_answer",
    terminal_artifact_id: selectedTerminalRef,
    model_synthesized_answer: {
      schema: "helix.model_synthesized_answer.v1",
      artifact_id: selectedTerminalRef,
      support_refs: [closureArtifact.artifact_id, semanticSupportRef],
      assistant_answer: false,
      raw_content_included: false,
    },
    current_turn_artifact_ledger: structuredClone(readyArtifacts),
  });
  const terminalPayload = (text: string): Record<string, unknown> => ({
    ...payload(),
    thread_id: "thread:test:execution-closure-claim-ceiling",
    final_answer_source: "model_synthesized_answer",
    selected_final_answer: text,
    model_synthesized_answer: {
      schema: "helix.model_synthesized_answer.v1",
      artifact_id: selectedTerminalRef,
      answer_text: text,
      support_refs: [closureArtifact.artifact_id, semanticSupportRef],
      assistant_answer: false,
      raw_content_included: false,
    },
    terminal_presentation: {
      schema: "helix.terminal_presentation.v1",
      concise_text: text,
    },
  });
  const blockedPayload = (): Record<string, unknown> => ({
    turn_id: blockedTurnId,
    terminal_artifact_kind: "model_synthesized_answer",
    terminal_artifact_id: blockedSelectedTerminalRef,
    model_synthesized_answer: {
      schema: "helix.model_synthesized_answer.v1",
      artifact_id: blockedSelectedTerminalRef,
      support_refs: [blockedClosureArtifact.artifact_id],
      assistant_answer: false,
      raw_content_included: false,
    },
    current_turn_artifact_ledger: structuredClone(blockedArtifacts),
  });
  const blockedTerminalPayload = (text: string): Record<string, unknown> => ({
    ...blockedPayload(),
    thread_id: "thread:test:execution-closure-synthesis-blocked",
    final_answer_source: "model_synthesized_answer",
    selected_final_answer: text,
    model_synthesized_answer: {
      schema: "helix.model_synthesized_answer.v1",
      artifact_id: blockedSelectedTerminalRef,
      answer_text: text,
      support_refs: [blockedClosureArtifact.artifact_id],
      assistant_answer: false,
      raw_content_included: false,
    },
    terminal_presentation: {
      schema: "helix.terminal_presentation.v1",
      concise_text: text,
    },
  });

  it("rejects formal, numerical, empirical, and physical-truth claims above a semantic ceiling", () => {
    const text = [
      "Lean verified the candidate.",
      "The independent numerical replay passed.",
      "Measurements confirmed it.",
      "This theory has been validated as true.",
    ].join(" ");
    const gate = evaluateVisibleAnswerPolicyFaithfulnessGate({
      turnId,
      text,
      payload: terminalPayload(text),
    });

    expect(gate.violations).toContain(
      "theory_execution_closure_claim_ceiling_exceeded",
    );
    expect(gate.violations).toContain(
      "theory_execution_closure_physical_truth_overclaim",
    );
  });

  it("allows a bounded semantic comparison that names its open verification limits", () => {
    const text =
      "Under the admitted semantic definition and graph relation, candidate A is the current evidence-coverage preference. Pinned Lanyon artifact admission, formal replay, independent numerical closure, and empirical grounding remain open; this is not a truth probability.";
    const gate = evaluateVisibleAnswerPolicyFaithfulnessGate({
      turnId,
      text,
      payload: terminalPayload(text),
    });

    expect(gate.violations).not.toContain(
      "theory_execution_closure_claim_ceiling_exceeded",
    );
    expect(gate.violations).not.toContain(
      "theory_execution_closure_physical_truth_overclaim",
    );
    expect(gate.ok).toBe(true);
  });

  it("uses an exact materialized terminal instead of treating earlier projection kinds as ambiguous", () => {
    const text =
      "Under the admitted semantic definition and graph relation, candidate A is the current evidence-coverage preference. Pinned Lanyon artifact admission, formal replay, independent numerical closure, and empirical grounding remain open; this is not a truth probability.";
    const activePayload = terminalPayload(text);
    const compoundRef = `${turnId}:compound_evidence_synthesis_answer`;
    activePayload.terminal_authority_single_writer = {
      selected_terminal_artifact_kind: "agent_provider_terminal_candidate",
      selected_terminal_artifact_ref: `${turnId}:provider_candidate`,
    };
    activePayload.provider_route_product_materialization = {
      materialized_terminal_artifact_kind:
        "compound_evidence_synthesis_answer",
      materialized_terminal_artifact_ref: compoundRef,
    };
    activePayload.compound_evidence_synthesis_answer = {
      schema: "helix.compound_evidence_synthesis_answer.v1",
      artifact_id: compoundRef,
      support_refs: [closureArtifact.artifact_id, semanticSupportRef],
      assistant_answer: false,
      raw_content_included: false,
    };

    const gate = evaluateVisibleAnswerPolicyFaithfulnessGate({
      turnId,
      text,
      payload: activePayload,
    });

    expect(gate.ok).toBe(true);
    expect(gate.violations).not.toContain(
      "theory_execution_closure_terminal_binding_invalid",
    );
    expect(gate.theory_execution_closure_invalid_terminal_ref).toBeFalsy();
  });

  it("binds the latest supported closure retry for the same prepared procedure", () => {
    const text =
      "Under the admitted semantic definition and graph relation, candidate A is the current evidence-coverage preference. Pinned Lanyon artifact admission, formal replay, independent numerical closure, and empirical grounding remain open; this is not a truth probability.";
    const activePayload = terminalPayload(text);
    const retryClosure = structuredClone(closureArtifact);
    retryClosure.artifact_id = `${turnId}:execution_closure:retry`;
    const retryClosurePayload = record(retryClosure.payload);
    const retryClosureBody = record(retryClosurePayload.closure);
    retryClosureBody.generatedAt = "2099-01-01T00:00:00.000Z";
    activePayload.current_turn_artifact_ledger = [
      ...structuredClone(readyArtifacts),
      retryClosure,
    ];
    (
      activePayload.model_synthesized_answer as Record<string, unknown>
    ).support_refs = [
      closureArtifact.artifact_id,
      retryClosure.artifact_id,
      semanticSupportRef,
    ];

    const gate = evaluateVisibleAnswerPolicyFaithfulnessGate({
      turnId,
      text,
      payload: activePayload,
    });

    expect(gate.violations).not.toContain(
      "theory_execution_closure_terminal_binding_invalid",
    );
    expect(gate.violations).toContain(
      "theory_execution_closure_artifact_invalid",
    );
  });

  it("rejects a physical-truth probability even when phrased as calibrated confidence", () => {
    const text = [
      "Under the admitted semantic definition, candidate A has the strongest current evidence coverage.",
      "It is 95% likely to be physically correct.",
      "Pinned Lanyon artifact admission, formal replay, independent numerical closure, and empirical grounding remain open.",
    ].join(" ");
    const gate = evaluateVisibleAnswerPolicyFaithfulnessGate({
      turnId,
      text,
      payload: terminalPayload(text),
    });

    expect(gate.violations).toContain(
      "theory_execution_closure_physical_truth_overclaim",
    );
  });

  it("does not let one open-limit clause lend negative polarity to successful numerical or empirical claims", () => {
    const text = [
      "Under the admitted semantic definition, candidate A has the strongest current evidence coverage.",
      "Formal replay remains open.",
      "Independent numerical verification passed.",
      "Empirical grounding passed.",
      "Pinned Lanyon artifact admission remains open.",
    ].join(" ");
    const gate = evaluateVisibleAnswerPolicyFaithfulnessGate({
      turnId,
      text,
      payload: terminalPayload(text),
    });

    expect(gate.violations).toContain(
      "theory_execution_closure_open_requirements_omitted",
    );
    expect(
      gate.theory_execution_closure_readiness
        ?.uncoveredOpenRequirementCodes,
    ).toEqual(
      expect.arrayContaining([
        "independent_numerical_certificate_required",
        "empirical_observation_required",
      ]),
    );
  });

  it("fails the terminal envelope closed instead of publishing a closure overclaim", () => {
    const text = [
      "Lean verified the candidate.",
      "The independent numerical replay passed.",
      "This theory has been validated as true.",
    ].join(" ");
    const activePayload = terminalPayload(text);

    const envelope = resolveTerminalAnswerEnvelope(activePayload);
    applyTerminalAnswerEnvelope(activePayload, envelope);

    expect(envelope).toMatchObject({
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      authority_origin: "typed_failure",
    });
    expect(envelope.terminal_text).not.toContain("validated as true");
    expect(envelope.terminal_text).toContain(
      "claimed physical truth beyond the authenticated execution-closure authority",
    );
    expect(activePayload).toMatchObject({
      terminal_error_code: "theory_execution_closure_physical_truth_overclaim",
      selected_final_answer: envelope.terminal_text,
      visible_answer_policy_faithfulness_rejection: {
        schema: "helix.visible_answer_policy_faithfulness_rejection.v1",
        violation: "theory_execution_closure_physical_truth_overclaim",
        retry_required: true,
      },
    });
  });

  it("keeps an answer inside the authenticated closure ceiling terminal-eligible", () => {
    const text =
      "Under the admitted semantic definition and graph relation, candidate A is the current evidence-coverage preference. Pinned Lanyon artifact admission, formal replay, independent numerical closure, and empirical grounding remain open; this is not a truth probability.";
    const activePayload = terminalPayload(text);

    const envelope = resolveTerminalAnswerEnvelope(activePayload);

    expect(envelope).toMatchObject({
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "model_synthesized_answer",
      terminal_text: text,
    });
    expect(activePayload).not.toHaveProperty(
      "visible_answer_policy_faithfulness_rejection",
    );
  });

  it("blocks a candidate preference when the authenticated closure forbids model synthesis", () => {
    const activePayload = blockedPayload();
    const gate = evaluateVisibleAnswerPolicyFaithfulnessGate({
      turnId: blockedTurnId,
      text: "Candidate A is the best-supported scientific answer and should be preferred over candidate B.",
      payload: activePayload,
    });

    expect(gate.violations).toContain(
      "theory_execution_closure_synthesis_blocked",
    );
    expect(gate.theory_execution_closure_readiness).toMatchObject({
      status: "blocked",
      modelSynthesisAllowed: false,
      blockerCodes: expect.arrayContaining(["candidate_set_incomparable"]),
    });
  });

  it("terminalizes blocked synthesis as an actionable typed failure", () => {
    const text =
      "Candidate A is the best-supported scientific answer and should be preferred over candidate B.";
    const activePayload = blockedTerminalPayload(text);

    const envelope = resolveTerminalAnswerEnvelope(activePayload);
    applyTerminalAnswerEnvelope(activePayload, envelope);

    expect(envelope).toMatchObject({
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
    });
    expect(envelope.terminal_text).toContain(
      "authenticated execution closure marks model synthesis as blocked",
    );
    expect(envelope.terminal_text).toContain("candidate_set_incomparable");
    expect(activePayload).toMatchObject({
      terminal_error_code: "theory_execution_closure_synthesis_blocked",
      visible_answer_policy_faithfulness_rejection: {
        blocker_codes: expect.arrayContaining(["candidate_set_incomparable"]),
        open_requirement_codes: expect.arrayContaining([
          "semantic_admission_current_turn_reentry_required",
        ]),
      },
    });
  });

  it("allows an authenticated blocked-status report that names every exact open requirement", () => {
    const closure = record(record(blockedClosureArtifact.payload).closure);
    const readiness = record(closure.synthesisReadiness);
    const openRequirementCodes = (readiness.openRequirementCodes as unknown[])
      .filter((value): value is string => typeof value === "string");
    const text = [
      "Model synthesis is blocked and remains procedure_only; no code was run.",
      "Exact open requirements:",
      ...openRequirementCodes.map((code) => `- ${code}`),
    ].join("\n");
    const activePayload = blockedTerminalPayload(text);

    const gate = evaluateVisibleAnswerPolicyFaithfulnessGate({
      turnId: blockedTurnId,
      text,
      payload: activePayload,
    });

    expect(gate.violations).not.toContain(
      "theory_execution_closure_synthesis_blocked",
    );
    expect(gate.ok).toBe(true);
  });

  it("fails closed when a bounded comparison omits an exact required support ref", () => {
    const text =
      "Under the admitted semantic definition and graph relation, candidate A is the current evidence-coverage preference. Pinned Lanyon artifact admission, formal replay, independent numerical closure, and empirical grounding remain open.";
    const activePayload = terminalPayload(text);
    (
      activePayload.model_synthesized_answer as Record<string, unknown>
    ).support_refs = [closureArtifact.artifact_id];
    activePayload.final_answer_draft = {
      schema: "helix.final_answer_draft.v1",
      draft_id: `${turnId}:stale_unselected_draft`,
      support_refs: [closureArtifact.artifact_id, semanticSupportRef],
      assistant_answer: false,
      raw_content_included: false,
    };

    const envelope = resolveTerminalAnswerEnvelope(activePayload);

    expect(envelope).toMatchObject({
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
    });
    expect(activePayload).toMatchObject({
      terminal_error_code: "theory_execution_closure_support_refs_missing",
      visible_answer_policy_faithfulness_rejection: {
        missing_required_support_refs: expect.arrayContaining([
          semanticSupportRef,
        ]),
      },
    });
  });

  it("does not let an unselected stale draft supply the selected terminal's closure binding", () => {
    const text =
      "Under the admitted semantic definition and graph relation, candidate A is the current evidence-coverage preference. Pinned Lanyon artifact admission, formal replay, independent numerical closure, and empirical grounding remain open.";
    const activePayload = terminalPayload(text);
    (
      activePayload.model_synthesized_answer as Record<string, unknown>
    ).support_refs = [semanticSupportRef];
    activePayload.final_answer_draft = {
      schema: "helix.final_answer_draft.v1",
      draft_id: `${turnId}:stale_unselected_closure_draft`,
      support_refs: [closureArtifact.artifact_id, semanticSupportRef],
      assistant_answer: false,
      raw_content_included: false,
    };

    const envelope = resolveTerminalAnswerEnvelope(activePayload);

    expect(envelope).toMatchObject({
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
    });
    expect(activePayload).toMatchObject({
      terminal_error_code:
        "theory_execution_closure_terminal_binding_invalid",
      visible_answer_policy_faithfulness_rejection: {
        invalid_terminal_artifact_ref:
          "selected_terminal_does_not_bind_execution_closure",
      },
    });
  });

  it("fails closed when a bounded comparison drops authenticated open requirements", () => {
    const text =
      "Under the admitted semantic definition and graph relation, candidate A is the current evidence-coverage preference.";
    const activePayload = terminalPayload(text);

    const envelope = resolveTerminalAnswerEnvelope(activePayload);

    expect(envelope).toMatchObject({
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
    });
    expect(activePayload).toMatchObject({
      terminal_error_code: "theory_execution_closure_open_requirements_omitted",
      visible_answer_policy_faithfulness_rejection: {
        uncovered_open_requirement_codes: expect.arrayContaining([
          "artifact_generation_receipt_required",
          "formal_certificate_required",
          "independent_numerical_certificate_required",
          "empirical_observation_required",
          "formal_certificate_current_turn_reentry_required",
          "numerical_certificate_current_turn_reentry_required",
          "empirical_observation_current_turn_reentry_required",
        ]),
      },
    });
  });

  it("marks a normalized closure invalid after an authority substitution", () => {
    const activePayload = payload();
    const substituted = structuredClone(closureArtifact);
    record(
      record(record(substituted.payload).closure).authority,
    ).validatesTheory = true;
    activePayload.current_turn_artifact_ledger = [substituted];
    const gate = evaluateVisibleAnswerPolicyFaithfulnessGate({
      turnId,
      text: "Lean verified the candidate.",
      payload: activePayload,
    });

    expect(gate.violations).not.toContain(
      "theory_execution_closure_claim_ceiling_exceeded",
    );
    expect(gate.violations).toContain(
      "theory_execution_closure_artifact_invalid",
    );
  });

  it("marks a normalized closure invalid when its wrapper hash is not bound to the closure", () => {
    const activePayload = payload();
    const substituted = structuredClone(closureArtifact);
    substituted.content_sha256 = "b".repeat(64);
    activePayload.current_turn_artifact_ledger = [substituted];
    const gate = evaluateVisibleAnswerPolicyFaithfulnessGate({
      turnId,
      text: "Lean verified the candidate.",
      payload: activePayload,
    });

    expect(gate.violations).not.toContain(
      "theory_execution_closure_claim_ceiling_exceeded",
    );
    expect(gate.violations).toContain(
      "theory_execution_closure_artifact_invalid",
    );
  });

  it("marks a normalized closure invalid after a post-normalization readiness mutation", () => {
    const activePayload = payload();
    const substituted = structuredClone(closureArtifact);
    const readiness = record(
      record(record(substituted.payload).closure).synthesisReadiness,
    );
    readiness.reason = `${String(readiness.reason)} tampered`;
    activePayload.current_turn_artifact_ledger = [substituted];
    const gate = evaluateVisibleAnswerPolicyFaithfulnessGate({
      turnId,
      text: "Candidate A should be preferred.",
      payload: activePayload,
    });

    expect(gate.violations).toContain(
      "theory_execution_closure_artifact_invalid",
    );
  });

  it("rejects a bound closure whose ranking policy digest was substituted even after rehashing", () => {
    const text =
      "Under the admitted semantic definition and graph relation, candidate A is the current evidence-coverage preference. Pinned Lanyon artifact admission, formal replay, independent numerical closure, and empirical grounding remain open.";
    const activePayload = terminalPayload(text);
    const substituted = structuredClone(closureArtifact);
    const substitutedRef = `${turnId}:closure:substituted-ranking-policy`;
    substituted.artifact_id = substitutedRef;
    const substitutedClosure = record(record(substituted.payload).closure);
    record(substitutedClosure.ranking).policySha256 = "b".repeat(64);
    const unsignedClosure = { ...substitutedClosure };
    delete unsignedClosure.closureSha256;
    delete unsignedClosure.artifactId;
    delete unsignedClosure.schemaVersion;
    const substitutedClosureSha256 = crypto
      .createHash("sha256")
      .update(
        canonicalizeCasimirSpecValueV1({
          domain: THEORY_EXPERIMENT_EXECUTION_CLOSURE_HASH_DOMAIN,
          value: unsignedClosure,
        }),
      )
      .digest("hex");
    substitutedClosure.closureSha256 = substitutedClosureSha256;
    substituted.content_sha256 = substitutedClosureSha256;
    activePayload.current_turn_artifact_ledger = [
      ...structuredClone(readyArtifacts),
      substituted,
    ];
    (
      activePayload.model_synthesized_answer as Record<string, unknown>
    ).support_refs = [substitutedRef, semanticSupportRef];

    const gate = evaluateVisibleAnswerPolicyFaithfulnessGate({
      turnId,
      text,
      payload: activePayload,
    });

    expect(gate.violations).toContain(
      "theory_execution_closure_artifact_invalid",
    );
    expect(gate.theory_execution_closure_invalid_artifact_ref).toBe(
      substitutedRef,
    );
  });

  it.each([
    "theory_context_reflection_answer",
    "agent_provider_terminal_candidate",
  ])(
    "fails closed for blocked closure synthesis through %s",
    (terminalKind) => {
      const text =
        "Candidate A is the best-supported scientific answer and should be preferred over candidate B.";
      const alternativeTerminalRef = `${blockedTurnId}:${terminalKind}`;
      const activePayload: Record<string, unknown> = {
        ...blockedPayload(),
        thread_id: "thread:test:execution-closure-alternative-terminal",
        terminal_artifact_kind: terminalKind,
        terminal_artifact_id: alternativeTerminalRef,
        final_answer_source: terminalKind,
        selected_final_answer: text,
        [terminalKind]: {
          schema: `helix.${terminalKind}.v1`,
          artifact_id: alternativeTerminalRef,
          answer_text: text,
          support_refs: [blockedClosureArtifact.artifact_id],
          assistant_answer: false,
          raw_content_included: false,
        },
        terminal_presentation: {
          schema: "helix.terminal_presentation.v1",
          concise_text: text,
        },
      };

      const envelope = resolveTerminalAnswerEnvelope(activePayload);

      expect(envelope).toMatchObject({
        terminal_artifact_kind: "typed_failure",
        final_answer_source: "typed_failure",
      });
      expect(activePayload.terminal_error_code).toBe(
        "theory_execution_closure_synthesis_blocked",
      );
    },
  );
});
