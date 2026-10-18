import { describe, expect, it } from "vitest";

import { arbitrateAskSourceTarget } from "../services/helix-ask/ask-source-target-arbitrator";
import { buildCommittedAskRoute, committedRouteAllowsTerminalKind } from "../services/helix-ask/committed-ask-route";
import {
  buildDocEvidenceSynthesisModelPrompt,
  buildDocEvidenceSynthesisPlan,
  chooseStrongerDocEvidenceSynthesisPlan,
  evaluateDocEvidenceSynthesisCoverage,
  materializeDocEvidenceSynthesisAnswer,
} from "../services/helix-ask/doc-evidence-synthesis";
import { isExplicitDocsPathLocateSynthesisPrompt } from "../services/helix-ask/docs-viewer-intent";
import { materializeFinalAnswerDraftTerminal } from "../services/helix-ask/final-answer-draft-terminal-materializer";
import { applyHelixTerminalAuthoritySingleWriter } from "../services/helix-ask/terminal-authority-single-writer";
import { interpretHelixAskPrompt } from "../services/helix-ask/prompt-interpretation";

const turnId = "ask:test-doc-evidence-synthesis";
const threadId = "thread:test-doc-evidence-synthesis";

const synthesisPayload = (prompt: string) => ({
  turn_id: turnId,
  active_prompt: prompt,
  source_target_intent: {
    schema: "helix.ask_source_target_intent.v1",
    turn_id: turnId,
    thread_id: threadId,
    target_source: "docs_viewer",
    target_kind: "docs_viewer",
    strength: "hard",
    reasons: ["explicit_docs_path_compare_source_target"],
    allow_no_tool_direct: false,
    assistant_answer: false,
    raw_content_included: false,
  },
  canonical_goal_frame: {
    turn_id: turnId,
    goal_kind: "doc_evidence_synthesis",
    answer_scope: "current_turn_doc",
    required_terminal_kind: "doc_evidence_synthesis_answer",
  },
  route_product_contract: {
    schema: "helix.route_product_contract.v1",
    turn_id: turnId,
    thread_id: threadId,
    source_target: "docs_viewer",
    allowed_terminal_artifact_kinds: ["doc_evidence_synthesis_answer", "typed_failure", "request_user_input"],
    forbidden_terminal_artifact_kinds: ["direct_answer_text", "model_only_concept", "doc_summary"],
    required_artifact_refs: [],
    precedence_reason: "explicit_docs_path_compare_source_target",
    assistant_answer: false,
    raw_content_included: false,
  },
});

const docsEvidenceArtifacts = [
  {
    artifact_id: "doc-summary:flow",
    turn_id: turnId,
    kind: "doc_summary",
    payload: {
      schema: "helix.doc_summary.v1",
      path: "/docs/helix-ask-flow.md",
      source_title: "Helix Ask Flow",
      anchors: ["Core flow"],
      answer_text: "Core flow explains prompt to route to tool observation to terminal authority.",
      assistant_answer: false,
      raw_content_included: false,
    },
  },
  {
    artifact_id: "doc-summary:discipline",
    turn_id: turnId,
    kind: "doc_summary",
    payload: {
      schema: "helix.doc_summary.v1",
      path: "/docs/helix-ask-codex-loop-discipline.md",
      source_title: "Helix Ask / Codex Loop Discipline",
      anchors: ["Patch-Time Contract", "Model Commentary Owns Step Choice"],
      answer_text: "The discipline doc separates Codex runtime ownership from Helix evidence policy.",
      assistant_answer: false,
      raw_content_included: false,
    },
  },
];

describe("Helix Ask docs evidence synthesis answer", () => {
  it("materializes multi-doc compare drafts into doc_evidence_synthesis_answer", () => {
    const prompt =
      "Compare docs/helix-ask-flow.md and docs/helix-ask-codex-loop-discipline.md in a two-column table of the main routing rules.";
    const payload: Record<string, unknown> = synthesisPayload(prompt);
    payload.committed_ask_route = buildCommittedAskRoute({
      turnId,
      promptText: prompt,
      selectedRoute: "docs_viewer.local_docs_path_compare",
      payload,
      promptInterpretation: interpretHelixAskPrompt(prompt),
    });
    const finalDraft = {
      artifact_id: "draft:compare",
      turn_id: turnId,
      kind: "final_answer_draft",
      payload: {
        schema: "helix.final_answer_draft.v1",
        artifact_id: "draft:compare",
        text: "Flow owns the operational Ask route sequence; discipline owns the Codex/Helix boundary. Both require observations before terminal authority.",
        artifact_refs: ["doc-summary:flow", "doc-summary:discipline"],
        assistant_answer: false,
        raw_content_included: false,
      },
    };

    const materialized = materializeFinalAnswerDraftTerminal({
      turnId,
      payload,
      artifactLedger: [...docsEvidenceArtifacts, finalDraft],
      routeProductContract: payload.route_product_contract as Record<string, unknown>,
    });

    expect(materialized?.ok).toBe(true);
    expect(materialized?.materialized_terminal_artifact_kind).toBe("doc_evidence_synthesis_answer");
    expect(payload.doc_evidence_synthesis_answer).toMatchObject({
      schema: "helix.doc_evidence_synthesis_answer.v1",
      terminal_artifact_kind: "doc_evidence_synthesis_answer",
      source_target: "docs_viewer",
      goal_kind: "doc_evidence_synthesis",
      synthesis_kind: "compare",
      source_docs: expect.arrayContaining([
        expect.objectContaining({ path: "/docs/helix-ask-flow.md" }),
        expect.objectContaining({ path: "/docs/helix-ask-codex-loop-discipline.md" }),
      ]),
      terminal_eligible: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(
      (payload.current_turn_artifact_ledger as Array<{ kind?: string; artifact_id?: string }>).some(
        (artifact) =>
          artifact.kind === "doc_evidence_synthesis_answer" &&
          artifact.artifact_id === materialized?.materialized_terminal_artifact_ref,
      ),
    ).toBe(true);
  });

  it("materializes docs compare from preserved plan when active_prompt is empty", () => {
    const prompt =
      "Compare docs/helix-ask-flow.md and docs/helix-ask-codex-loop-discipline.md. Give three differences in what each document is responsible for.";
    const payload: Record<string, unknown> = synthesisPayload("");
    payload.active_prompt = "";
    payload.doc_evidence_synthesis_plan = {
      schema: "helix.doc_evidence_synthesis_plan.v1",
      turn_id: turnId,
      synthesis_kind: "compare",
      required_doc_paths: [
        "/docs/helix-ask-flow.md",
        "/docs/helix-ask-codex-loop-discipline.md",
      ],
      required_anchors: [],
      required_questions: [prompt],
      required_observation_kinds: ["doc_summary"],
      terminal_product: "doc_evidence_synthesis_answer",
      assistant_answer: false,
      raw_content_included: false,
    };
    const finalDraft = {
      artifact_id: "draft:compare-preserved-plan",
      turn_id: turnId,
      kind: "final_answer_draft",
      payload: {
        schema: "helix.final_answer_draft.v1",
        artifact_id: "draft:compare-preserved-plan",
        text: "Flow owns the operational Ask flow; discipline owns the Codex-parity method.",
        goal_kind: "doc_evidence_synthesis",
        required_terminal_kind: "doc_evidence_synthesis_answer",
        artifact_refs: ["doc-summary:flow", "doc-summary:discipline"],
        support_refs: ["doc-summary:flow", "doc-summary:discipline"],
        assistant_answer: false,
        raw_content_included: false,
      },
    };

    const result = materializeFinalAnswerDraftTerminal({
      turnId,
      payload,
      artifactLedger: [...docsEvidenceArtifacts, finalDraft],
      routeProductContract: payload.route_product_contract as Record<string, unknown>,
    });

    expect(result?.ok).toBe(true);
    expect(result?.materialized_terminal_artifact_kind).toBe("doc_evidence_synthesis_answer");
    expect((payload.doc_evidence_synthesis_plan as { synthesis_kind?: string }).synthesis_kind).toBe("compare");
    expect(payload.doc_evidence_synthesis_answer).toMatchObject({
      synthesis_kind: "compare",
      source_docs: expect.arrayContaining([
        expect.objectContaining({ path: "/docs/helix-ask-flow.md" }),
        expect.objectContaining({ path: "/docs/helix-ask-codex-loop-discipline.md" }),
      ]),
    });
    expect(payload.docs_synthesis_debug).toMatchObject({
      materializer_called: true,
      materializer_plan_synthesis_kind: "compare",
      materializer_support_refs_count: expect.any(Number),
      materialization_ok: true,
    });
  });

  it("materializes docs synthesis from payload ledger when artifactLedger argument is stale", () => {
    const prompt =
      "Compare docs/helix-ask-flow.md and docs/helix-ask-codex-loop-discipline.md. Give three differences in what each document is responsible for.";
    const payload: Record<string, unknown> = synthesisPayload(prompt);
    const finalDraft = {
      artifact_id: "draft:payload-ledger-only",
      turn_id: turnId,
      kind: "final_answer_draft",
      payload: {
        schema: "helix.final_answer_draft.v1",
        artifact_id: "draft:payload-ledger-only",
        text: "Flow owns route sequencing; discipline owns the runtime boundary.",
        goal_kind: "doc_evidence_synthesis",
        required_terminal_kind: "doc_evidence_synthesis_answer",
        artifact_refs: ["doc-summary:flow", "doc-summary:discipline"],
        support_refs: ["doc-summary:flow", "doc-summary:discipline"],
        assistant_answer: false,
        raw_content_included: false,
      },
    };
    payload.current_turn_artifact_ledger = [...docsEvidenceArtifacts, finalDraft];

    const result = materializeFinalAnswerDraftTerminal({
      turnId,
      payload,
      artifactLedger: docsEvidenceArtifacts,
      routeProductContract: payload.route_product_contract as Record<string, unknown>,
    });

    expect(result?.ok).toBe(true);
    expect(result?.materialized_terminal_artifact_kind).toBe("doc_evidence_synthesis_answer");
    expect(payload.doc_evidence_synthesis_answer).toBeTruthy();
    expect(payload.docs_synthesis_debug).toMatchObject({
      materializer_called: true,
      materialization_ok: true,
      support_refs_count: expect.any(Number),
    });
  });

  it("does not let a weaker rebuilt plan overwrite a preserved compare plan", () => {
    const preserved = buildDocEvidenceSynthesisPlan({
      turnId,
      promptText:
        "Compare docs/helix-ask-flow.md and docs/helix-ask-codex-loop-discipline.md. Give three differences.",
    });
    const rebuilt = buildDocEvidenceSynthesisPlan({
      turnId,
      promptText: "",
    });

    const chosen = chooseStrongerDocEvidenceSynthesisPlan(preserved, rebuilt);

    expect(chosen.synthesis_kind).toBe("compare");
    expect(chosen.required_doc_paths).toEqual([
      "/docs/helix-ask-flow.md",
      "/docs/helix-ask-codex-loop-discipline.md",
    ]);
  });

  it("builds a model synthesis packet with doc evidence refs and requested output shape", () => {
    const prompt =
      "Compare docs/helix-ask-flow.md and docs/helix-ask-codex-loop-discipline.md. Give three differences in what each document is responsible for.";
    const plan = buildDocEvidenceSynthesisPlan({ turnId, promptText: prompt });
    const modelPrompt = buildDocEvidenceSynthesisModelPrompt({
      promptText: prompt,
      plan,
      evidenceArtifacts: docsEvidenceArtifacts,
    });

    expect(modelPrompt).toContain("Required terminal kind: doc_evidence_synthesis_answer");
    expect(modelPrompt).toContain("Synthesis kind: compare");
    expect(modelPrompt).toContain("Evidence 1: doc-summary:flow");
    expect(modelPrompt).toContain("Evidence 2: doc-summary:discipline");
    expect(modelPrompt).toContain("Give the requested comparison");
    expect(modelPrompt).toContain("Use only the document observations below");
  });

  it("lets terminal authority select the materialized docs synthesis answer", () => {
    const prompt =
      "Compare docs/helix-ask-flow.md and docs/helix-ask-codex-loop-discipline.md and explain the implication for route authority.";
    const payload: Record<string, unknown> = synthesisPayload(prompt);
    payload.goal_satisfaction_evaluation = {
      schema: "helix.goal_satisfaction_evaluation.v1",
      turn_id: turnId,
      satisfaction: "satisfied",
      next_decision: "allow_terminal",
      assistant_answer: false,
      raw_content_included: false,
    };
    payload.committed_ask_route = buildCommittedAskRoute({
      turnId,
      promptText: prompt,
      selectedRoute: "docs_viewer.local_docs_path_compare",
      payload,
      promptInterpretation: interpretHelixAskPrompt(prompt),
    });
    const finalDraft = {
      artifact_id: "draft:terminal",
      turn_id: turnId,
      kind: "final_answer_draft",
      payload: {
        schema: "helix.final_answer_draft.v1",
        artifact_id: "draft:terminal",
        text: "The implication is that Docs receipts describe evidence, while route authority requires a completed synthesis artifact before visible final text.",
        artifact_refs: ["doc-summary:flow", "doc-summary:discipline"],
        assistant_answer: false,
        raw_content_included: false,
      },
    };
    payload.current_turn_artifact_ledger = [...docsEvidenceArtifacts, finalDraft];
    payload.agent_step_decision = {
      decision_id: "decision:docs-terminal-review",
      decision_timing: "post_observation",
      decision_authority: "model",
      next_step: "answer",
      chosen_capability: "model.direct_answer",
      assistant_answer: false,
      raw_content_included: false,
    };
    payload.agent_runtime_loop = {
      schema: "helix.agent_runtime_loop.v1",
      iterations: [
        {
          decision_id: "decision:docs-summary",
          decision_timing: "pre_observation",
          decision_authority: "model",
          next_step: "tool",
          chosen_capability: "docs-viewer.summarize_doc",
          observed_artifact_refs: ["doc-summary:flow", "doc-summary:discipline"],
        },
        {
          decision_id: "decision:docs-terminal-review",
          decision_timing: "post_observation",
          decision_authority: "model",
          next_step: "answer",
          chosen_capability: "model.direct_answer",
          observed_artifact_refs: ["draft:terminal"],
          observation_role: "model_answer_draft",
        },
      ],
      assistant_answer: false,
      raw_content_included: false,
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId,
      payload,
      artifactLedger: [...docsEvidenceArtifacts, finalDraft],
    });

    expect(result.selected_terminal_artifact_kind).toBe("doc_evidence_synthesis_answer");
    expect(result.visible_text).toContain("completed synthesis artifact");
    expect(payload.terminal_artifact_kind).toBe("doc_evidence_synthesis_answer");
    expect(payload.final_answer_source).toBe("final_answer_draft");
  });

  it("lets a required docs synthesis terminal supersede a stale solver continuation observation", () => {
    const prompt =
      "Locate Patch-Time Contract in docs/helix-ask-codex-loop-discipline.md and turn it into a five-step checklist.";
    const payload: Record<string, unknown> = synthesisPayload(prompt);
    const docLocation = {
      artifact_id: "doc-location:discipline-patch-time-contract",
      turn_id: turnId,
      kind: "doc_location_result",
      payload: {
        schema: "helix.doc_location_result.v1",
        path: "/docs/helix-ask-codex-loop-discipline.md",
        query: "Patch-Time Contract",
        anchors: ["Patch-Time Contract"],
        matches: [
          {
            anchor: "Patch-Time Contract",
            evidence_ref: "doc-location:discipline-patch-time-contract#patch-time-contract",
          },
        ],
        assistant_answer: false,
        raw_content_included: false,
      },
    };
    payload.solver_continuation_observation = {
      schema: "helix.solver_continuation_observation.v1",
      required_next_step: "model.direct_answer",
      reason: "stale continuation marker from pre-materialization state",
      assistant_answer: false,
      raw_content_included: false,
    };
    payload.agent_step_decision = {
      schema: "helix.agent_step_decision.v1",
      decision_id: "decision:model-synthesis-after-locate",
      next_step: "answer",
      chosen_capability: "model.direct_answer",
      decision_source: "llm",
      decision_authority: "llm",
      decision_timing: "post_observation",
      assistant_answer: false,
      raw_content_included: false,
    };
    const finalDraft = {
      artifact_id: "draft:stale-continuation-docs",
      turn_id: turnId,
      kind: "final_answer_draft",
      payload: {
        schema: "helix.final_answer_draft.v1",
        artifact_id: "draft:stale-continuation-docs",
        text: "1. Classify the patch. 2. Keep Codex-owned runtime separate. 3. Preserve route authority. 4. Require evidence re-entry. 5. Terminalize only the route-required artifact.",
        goal_kind: "doc_evidence_synthesis",
        required_terminal_kind: "doc_evidence_synthesis_answer",
        artifact_refs: ["doc-location:discipline-patch-time-contract", "doc-summary:discipline"],
        support_refs: ["doc-location:discipline-patch-time-contract", "doc-summary:discipline"],
        assistant_answer: false,
        raw_content_included: false,
      },
    };
    payload.agent_runtime_loop = {
      schema: "helix.agent_runtime_loop.v1",
      iterations: [
        {
          decision_id: "decision:locate-patch-time-contract",
          next_step: "use_tool",
          chosen_capability: "docs-viewer.locate_in_doc",
          decision_source: "llm",
          decision_authority: "llm",
          executed_action_key: "docs-viewer.locate_in_doc",
          observed_artifact_refs: ["doc-location:discipline-patch-time-contract"],
          tool_observation: {
            status: "completed",
            ok: true,
            artifact_id: "doc-location:discipline-patch-time-contract",
          },
        },
        {
          decision_id: "decision:model-synthesis-after-locate",
          next_step: "answer",
          chosen_capability: "model.direct_answer",
          decision_source: "llm",
          decision_authority: "llm",
          observed_artifact_refs: ["draft:stale-continuation-docs"],
          observation_role: "model_answer_draft",
        },
      ],
      assistant_answer: false,
      raw_content_included: false,
    };
    payload.current_turn_artifact_ledger = [docLocation, docsEvidenceArtifacts[1], finalDraft];
    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId,
      payload,
      artifactLedger: [docLocation, docsEvidenceArtifacts[1], finalDraft],
    });

    expect(result.selected_terminal_artifact_kind).toBe("doc_evidence_synthesis_answer");
    expect(payload.terminal_artifact_kind).toBe("doc_evidence_synthesis_answer");
    expect(payload.terminal_error_code).toBeUndefined();
    expect(result.rejected_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "typed_failure",
          reason: "stale_solver_continuation_superseded_by_required_docs_terminal",
        }),
      ]),
    );
  });

  it("materializes docs synthesis from a draft-level terminal contract when route surfaces are absent", () => {
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      active_prompt:
        "Compare docs/helix-ask-flow.md and docs/helix-ask-codex-loop-discipline.md. Give three differences in what each document is responsible for.",
    };
    const finalDraft = {
      artifact_id: "draft:self-routed-docs",
      turn_id: turnId,
      kind: "final_answer_draft",
      payload: {
        schema: "helix.final_answer_draft.v1",
        artifact_id: "draft:self-routed-docs",
        text: "Flow owns the user-facing route sequence; discipline owns the Codex parity boundary.",
        goal_kind: "doc_evidence_synthesis",
        required_terminal_kind: "doc_evidence_synthesis_answer",
        artifact_refs: ["doc-summary:flow", "doc-summary:discipline"],
        support_refs: ["doc-summary:flow", "doc-summary:discipline"],
        assistant_answer: false,
        raw_content_included: false,
      },
    };

    const materialized = materializeFinalAnswerDraftTerminal({
      turnId,
      payload,
      artifactLedger: [...docsEvidenceArtifacts, finalDraft],
    });

    expect(materialized?.ok).toBe(true);
    expect(materialized?.materialized_terminal_artifact_kind).toBe("doc_evidence_synthesis_answer");
    expect(payload.doc_evidence_synthesis_answer).toMatchObject({
      terminal_artifact_kind: "doc_evidence_synthesis_answer",
      goal_kind: "doc_evidence_synthesis",
      support_refs: expect.arrayContaining(["doc-summary:flow", "doc-summary:discipline"]),
    });
  });

  it("lets same-turn canonical docs synthesis goal authorize materialization without route product contract", () => {
    const prompt =
      "Compare docs/helix-ask-flow.md and docs/helix-ask-codex-loop-discipline.md. Give three differences in what each document is responsible for.";
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      active_prompt: prompt,
      canonical_goal_frame: {
        turn_id: turnId,
        goal_kind: "doc_evidence_synthesis",
        required_terminal_kind: "doc_evidence_synthesis_answer",
      },
    };
    const finalDraft = {
      artifact_id: "draft:canonical-contract",
      turn_id: turnId,
      kind: "final_answer_draft",
      payload: {
        schema: "helix.final_answer_draft.v1",
        artifact_id: "draft:canonical-contract",
        text: "Flow owns routing; discipline owns Codex parity boundaries.",
        artifact_refs: ["doc-summary:flow", "doc-summary:discipline"],
        support_refs: ["doc-summary:flow", "doc-summary:discipline"],
        assistant_answer: false,
        raw_content_included: false,
      },
    };

    const result = materializeFinalAnswerDraftTerminal({
      turnId,
      payload,
      artifactLedger: [...docsEvidenceArtifacts, finalDraft],
    });

    expect(result?.ok).toBe(true);
    expect(result?.materialized_terminal_artifact_kind).toBe("doc_evidence_synthesis_answer");
    expect(payload.docs_synthesis_debug).toMatchObject({
      materializer_contract_allowed: true,
      materializer_goal_kind: "doc_evidence_synthesis",
      materializer_required_terminal_kind: "doc_evidence_synthesis_answer",
    });
  });

  it("lets canonical docs synthesis goal override stale route product allowed kinds", () => {
    const prompt =
      "Compare docs/helix-ask-flow.md and docs/helix-ask-codex-loop-discipline.md. Give three differences in what each document is responsible for.";
    const payload: Record<string, unknown> = synthesisPayload(prompt);
    payload.route_product_contract = {
      schema: "helix.route_product_contract.v1",
      turn_id: turnId,
      source_target: "docs_viewer",
      allowed_terminal_artifact_kinds: ["typed_failure", "request_user_input"],
      forbidden_terminal_artifact_kinds: ["doc_summary"],
      assistant_answer: false,
      raw_content_included: false,
    };
    const finalDraft = {
      artifact_id: "draft:stale-contract",
      turn_id: turnId,
      kind: "final_answer_draft",
      payload: {
        schema: "helix.final_answer_draft.v1",
        artifact_id: "draft:stale-contract",
        text: "Flow owns routing; discipline owns runtime separation.",
        artifact_refs: ["doc-summary:flow", "doc-summary:discipline"],
        support_refs: ["doc-summary:flow", "doc-summary:discipline"],
        assistant_answer: false,
        raw_content_included: false,
      },
    };

    const result = materializeFinalAnswerDraftTerminal({
      turnId,
      payload,
      artifactLedger: [...docsEvidenceArtifacts, finalDraft],
      routeProductContract: payload.route_product_contract as Record<string, unknown>,
    });

    expect(result?.ok).toBe(true);
    expect(result?.materialized_terminal_artifact_kind).toBe("doc_evidence_synthesis_answer");
    expect(payload.docs_synthesis_debug).toMatchObject({
      materializer_contract_allowed: true,
      materializer_goal_kind_source: "canonical_goal_frame.goal_kind",
      materializer_required_terminal_kind_source: "canonical_goal_frame.required_terminal_kind",
    });
  });

  it("keeps same-turn committed route forbid authoritative for docs synthesis terminals", () => {
    const prompt =
      "Compare docs/helix-ask-flow.md and docs/helix-ask-codex-loop-discipline.md. Give three differences.";
    const payload: Record<string, unknown> = synthesisPayload(prompt);
    const committedRoute = buildCommittedAskRoute({
      turnId,
      promptText: prompt,
      selectedRoute: "docs_viewer.local_docs_path_compare",
      payload,
      promptInterpretation: interpretHelixAskPrompt(prompt),
    });
    payload.committed_ask_route = {
      ...committedRoute,
      canonical_goal: {
        ...committedRoute.canonical_goal,
        forbidden_terminal_artifact_kinds: [
          ...committedRoute.canonical_goal.forbidden_terminal_artifact_kinds,
          "doc_evidence_synthesis_answer",
        ],
      },
    };
    const finalDraft = {
      artifact_id: "draft:committed-forbid",
      turn_id: turnId,
      kind: "final_answer_draft",
      payload: {
        schema: "helix.final_answer_draft.v1",
        artifact_id: "draft:committed-forbid",
        text: "This should not terminalize because the same-turn committed route forbids it.",
        artifact_refs: ["doc-summary:flow", "doc-summary:discipline"],
        support_refs: ["doc-summary:flow", "doc-summary:discipline"],
        assistant_answer: false,
        raw_content_included: false,
      },
    };

    const result = materializeFinalAnswerDraftTerminal({
      turnId,
      payload,
      artifactLedger: [...docsEvidenceArtifacts, finalDraft],
      routeProductContract: payload.route_product_contract as Record<string, unknown>,
    });

    expect(result?.ok).toBe(false);
    expect(payload.doc_evidence_synthesis_answer).toBeUndefined();
    expect(payload.docs_synthesis_debug).toMatchObject({
      materializer_contract_allowed: false,
      materializer_contract_disallow_reason: "same_turn_committed_route_forbids_doc_evidence_synthesis_answer",
    });
  });

  it("lets compound docs+calculator synthesis override stale single-doc terminal metadata", () => {
    const prompt =
      "Use docs-viewer.locate_in_doc to locate the rule of thumb, then run scientific-calculator.solve_expression with 19+23.";
    const payload: Record<string, unknown> = {
      ...synthesisPayload(prompt),
      canonical_goal_frame: {
        turn_id: turnId,
        goal_kind: "locate_in_doc",
        answer_scope: "current_turn_doc",
        required_terminal_kind: "doc_location_matches",
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        turn_id: turnId,
        thread_id: threadId,
        source_target: "docs_viewer",
        allowed_terminal_artifact_kinds: ["doc_location_matches", "typed_failure"],
        forbidden_terminal_artifact_kinds: ["direct_answer_text", "model_only_concept", "doc_summary"],
        required_artifact_refs: [],
        precedence_reason: "explicit_docs_path_locate_source_target",
        assistant_answer: false,
        raw_content_included: false,
      },
      capability_itinerary: {
        schema: "helix.capability_itinerary.v1",
        prompt_shape: "compound_tool",
        terminal_success_criteria: {
          required_observation_families: ["docs_viewer", "calculator"],
          required_capabilities: ["docs-viewer.locate_in_doc", "scientific-calculator.solve_expression"],
          allowed_terminal_artifact_kinds: [
            "doc_location_matches",
            "workstation_tool_evaluation",
            "model_synthesized_answer",
            "doc_evidence_synthesis_answer",
          ],
          forbidden_terminal_artifact_kinds: ["tool_receipt"],
          compound_terminal_policy: "synthesize_from_satisfied_subgoal_observations",
          requires_post_observation_synthesis: true,
        },
        compound_capability_contract: {
          schema: "helix.compound_capability_contract.v1",
          subgoals: [
            {
              requested_capability: "docs-viewer.locate_in_doc",
              required_terminal_kind: "doc_location_matches",
              terminal_contribution_kind: "doc_location_matches",
            },
            {
              requested_capability: "scientific-calculator.solve_expression",
              required_terminal_kind: "workstation_tool_evaluation",
              terminal_contribution_kind: "workstation_tool_evaluation",
            },
          ],
        },
        assistant_answer: false,
        raw_content_included: false,
      },
      compound_capability_synthesis_readiness: {
        schema: "helix.compound_capability_synthesis_readiness.v1",
        applies: true,
        complete: true,
        synthesis_required: false,
        has_docs_subgoal: true,
        support_refs: ["doc-summary:discipline", "calculator:19-plus-23"],
        goal_kind: "doc_evidence_synthesis",
        required_terminal_kind: "doc_evidence_synthesis_answer",
        synthesis_terminal_kind: "doc_evidence_synthesis_answer",
        assistant_answer: false,
        raw_content_included: false,
      },
    };
    const committedRoute = buildCommittedAskRoute({
      turnId,
      promptText: prompt,
      selectedRoute: "docs_viewer.locate_in_doc",
      payload,
      promptInterpretation: interpretHelixAskPrompt(prompt),
    });
    payload.committed_ask_route = {
      ...committedRoute,
      canonical_goal: {
        ...committedRoute.canonical_goal,
        goal_kind: "locate_in_doc",
        required_terminal_kind: "doc_location_matches",
        allowed_terminal_artifact_kinds: ["doc_location_matches", "typed_failure"],
        forbidden_terminal_artifact_kinds: ["direct_answer_text", "model_only_concept", "doc_summary"],
      },
    };
    const finalDraft = {
      artifact_id: "draft:compound-docs-calculator",
      turn_id: turnId,
      kind: "final_answer_draft",
      payload: {
        schema: "helix.final_answer_draft.v1",
        artifact_id: "draft:compound-docs-calculator",
        text: "The rule was located in the discipline doc, and 19+23 evaluates to 42.",
        artifact_refs: ["doc-summary:discipline", "calculator:19-plus-23"],
        support_refs: ["doc-summary:discipline", "calculator:19-plus-23"],
        assistant_answer: false,
        raw_content_included: false,
      },
    };

    const result = materializeFinalAnswerDraftTerminal({
      turnId,
      payload,
      artifactLedger: [
        docsEvidenceArtifacts[1],
        {
          artifact_id: "calculator:19-plus-23",
          turn_id: turnId,
          kind: "calculator_receipt",
          payload: {
            schema: "helix.calculator_receipt.v1",
            result_text: "42",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
        finalDraft,
      ],
      routeProductContract: payload.route_product_contract as Record<string, unknown>,
    });

    expect(result?.ok).toBe(true);
    expect(result?.materialized_terminal_artifact_kind).toBe("doc_evidence_synthesis_answer");
    expect(payload.docs_synthesis_debug).toMatchObject({
      materializer_contract_allowed: true,
      materializer_goal_kind_source: "route_product_contract.allowed_terminal_artifact_kinds",
      materializer_required_terminal_kind_source: "route_product_contract.allowed_terminal_artifact_kinds",
    });
  });

  it("rejects doc_summary as the terminal product for a synthesis route", () => {
    const prompt =
      "Compare docs/helix-ask-flow.md and docs/helix-ask-codex-loop-discipline.md.";
    const payload: Record<string, unknown> = synthesisPayload(prompt);
    const committedRoute = buildCommittedAskRoute({
      turnId,
      promptText: prompt,
      selectedRoute: "docs_viewer.local_docs_path_compare",
      payload,
      promptInterpretation: interpretHelixAskPrompt(prompt),
    });

    expect(committedRouteAllowsTerminalKind({
      committedRoute,
      terminalArtifactKind: "doc_evidence_synthesis_answer",
      finalAnswerSource: "final_answer_draft",
    })).toBe(true);
    expect(committedRouteAllowsTerminalKind({
      committedRoute,
      terminalArtifactKind: "doc_summary",
      finalAnswerSource: "artifact_synthesis",
    })).toBe(false);
  });

  it("treats explicit single-doc cite-anchor explanations as synthesis, not summary-only", () => {
    const prompt =
      "Explain why model commentary owns step choice using docs/helix-ask-codex-loop-discipline.md and cite section anchors.";
    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText: prompt });
    const plan = buildDocEvidenceSynthesisPlan({ turnId, promptText: prompt });
    const coverage = evaluateDocEvidenceSynthesisCoverage({
      turnId,
      plan,
      evidenceArtifacts: [docsEvidenceArtifacts[1]],
    });

    expect(isExplicitDocsPathLocateSynthesisPrompt(prompt)).toBe(true);
    expect(sourceTargetIntent.target_source).toBe("docs_viewer");
    expect(sourceTargetIntent.precedence_reason).toBe("explicit_docs_path_locate_synthesis_source_target");
    expect(plan.synthesis_kind).toBe("locate_then_explain");
    expect(coverage.sufficient).toBe(true);
  });

  it("keeps quoted docs-path prompts model-only and forbids docs terminals", () => {
    const prompt = '"Open docs/helix-ask-flow.md" is the command I typed earlier; explain whether that should run now.';
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      source_target_intent: {
        schema: "helix.ask_source_target_intent.v1",
        turn_id: turnId,
        thread_id: threadId,
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
    };
    const committedRoute = buildCommittedAskRoute({
      turnId,
      promptText: prompt,
      selectedRoute: "conversation:simple",
      payload,
      promptInterpretation: interpretHelixAskPrompt(prompt),
    });

    expect(committedRoute.route.source_target).toBe("model_only");
    expect(committedRoute.capability_policy.suppressed_tool_families).toEqual(expect.arrayContaining(["docs_viewer"]));
    expect(committedRouteAllowsTerminalKind({
      committedRoute,
      terminalArtifactKind: "direct_answer_text",
      finalAnswerSource: "model_direct_answer",
    })).toBe(true);
    expect(committedRouteAllowsTerminalKind({
      committedRoute,
      terminalArtifactKind: "doc_evidence_synthesis_answer",
      finalAnswerSource: "final_answer_draft",
    })).toBe(false);
  });

  it("does not materialize when one requested compare document lacks evidence", () => {
    const prompt =
      "Compare docs/helix-ask-flow.md and docs/helix-ask-codex-loop-discipline.md.";
    const payload: Record<string, unknown> = synthesisPayload(prompt);
    const result = materializeDocEvidenceSynthesisAnswer({
      turnId,
      promptText: prompt,
      payload,
      artifactLedger: [docsEvidenceArtifacts[0]],
      answerText: "A one-sided comparison is not enough.",
      finalAnswerDraftRef: "draft:partial",
    });

    expect(result.ok).toBe(false);
    expect(result.blocked_reason).toBe("doc_evidence_coverage_missing");
    expect(result.coverage.missing_requirements).toEqual(expect.arrayContaining(["multi_doc_coverage"]));
  });

  it("does not treat empty doc_location_matches as citation-grade docs synthesis evidence", () => {
    const prompt =
      "Use docs-viewer.locate_in_doc to find where docs/helix-ask-codex-loop-discipline.md says routes choose procedures. Answer only from the docs-viewer observation and cite the document evidence.";
    const payload: Record<string, unknown> = synthesisPayload(prompt);
    const emptyLocation = {
      artifact_id: "doc-location:empty",
      turn_id: turnId,
      kind: "doc_location_matches",
      payload: {
        schema: "helix.doc_location_matches.v1",
        kind: "doc_location_matches",
        query: "routes choose procedures",
        source_path: "/docs/helix-ask-codex-loop-discipline.md",
        matches: [],
        match_count: 0,
        assistant_answer: false,
        raw_content_included: false,
      },
    };
    const finalDraft = {
      artifact_id: "draft:empty-location",
      turn_id: turnId,
      kind: "final_answer_draft",
      payload: {
        schema: "helix.final_answer_draft.v1",
        artifact_id: "draft:empty-location",
        text: "The document states that routes choose procedures.",
        support_refs: ["doc-location:empty"],
        artifact_refs: ["doc-location:empty"],
        assistant_answer: false,
        raw_content_included: false,
      },
    };

    const result = materializeDocEvidenceSynthesisAnswer({
      turnId,
      promptText: prompt,
      payload,
      artifactLedger: [emptyLocation, finalDraft],
      answerText: "The document states that routes choose procedures.",
      finalAnswerDraftRef: "draft:empty-location",
    });

    expect(result.ok).toBe(false);
    expect(result.blocked_reason).toBe("doc_evidence_coverage_missing");
    expect(result.coverage.missing_requirements).toEqual(
      expect.arrayContaining(["doc_evidence_observation"]),
    );
  });

  it("accepts runtime compound doc-location support refs as docs synthesis coverage", () => {
    const prompt =
      "Use docs-viewer.locate_in_doc to find where docs/helix-ask-codex-loop-discipline.md says routes choose procedures, then call scientific-calculator.solve_expression for 19+23. Explain the connection from both observations.";
    const docsRef = "doc-location:compound-runtime";
    const calculatorRef = "calculator:compound-runtime";
    const payload: Record<string, unknown> = synthesisPayload(prompt);
    payload.compound_capability_synthesis_readiness = {
      schema: "helix.compound_capability_synthesis_readiness.v1",
      applies: true,
      complete: true,
      synthesis_required: true,
      goal_kind: "doc_evidence_synthesis",
      required_terminal_kind: "doc_evidence_synthesis_answer",
      synthesis_terminal_kind: "doc_evidence_synthesis_answer",
      support_refs: [docsRef, calculatorRef],
      assistant_answer: false,
      raw_content_included: false,
    };
    payload.compound_subgoal_rail_statuses = [
      {
        subgoal_id: "docs",
        requested_capability: "docs-viewer.locate_in_doc",
        runtime_capability: "docs-viewer.locate_in_doc",
        selected_capability: "docs-viewer.locate_in_doc",
        executed_capability: "docs-viewer.locate_in_doc",
        observation_kind: "doc_location_matches",
        observation_ref: docsRef,
        satisfaction: "satisfied",
        rail_status: "complete",
      },
      {
        subgoal_id: "calculator",
        requested_capability: "scientific-calculator.solve_expression",
        runtime_capability: "scientific-calculator.solve_expression",
        selected_capability: "scientific-calculator.solve_expression",
        executed_capability: "scientific-calculator.solve_expression",
        observation_kind: "calculator_receipt",
        observation_ref: calculatorRef,
        satisfaction: "satisfied",
        rail_status: "complete",
      },
    ];
    const location = {
      artifact_id: docsRef,
      turn_id: turnId,
      kind: "doc_location_matches",
      payload: {
        schema: "helix.doc_location_matches.v1",
        kind: "doc_location_matches",
        query: "routes choose procedures",
        source_path: "/docs/helix-ask-codex-loop-discipline.md",
        matches: [
          {
            path: "/docs/helix-ask-codex-loop-discipline.md",
            heading: "Turn-Chain Fundamentals",
            snippet: "Routes choose procedures. Tools produce observations.",
          },
        ],
        match_count: 1,
        assistant_answer: false,
        raw_content_included: false,
      },
    };
    const finalDraft = {
      artifact_id: "draft:compound-runtime",
      turn_id: turnId,
      kind: "final_answer_draft",
      payload: {
        schema: "helix.final_answer_draft.v1",
        artifact_id: "draft:compound-runtime",
        goal_kind: "doc_evidence_synthesis",
        required_terminal_kind: "doc_evidence_synthesis_answer",
        text: "The document observation identifies the rule-of-thumb section, and the calculator observation gives 42.",
        support_refs: [docsRef, calculatorRef],
        artifact_refs: [docsRef, calculatorRef],
        assistant_answer: false,
        raw_content_included: false,
      },
    };

    const result = materializeDocEvidenceSynthesisAnswer({
      turnId,
      promptText: prompt,
      payload,
      artifactLedger: [location, finalDraft],
      answerText: "The document observation identifies the rule-of-thumb section, and the calculator observation gives 42.",
      finalAnswerDraftRef: "draft:compound-runtime",
    });

    expect(result.ok).toBe(true);
    expect(result.blocked_reason).not.toBe("doc_evidence_coverage_missing");
    expect(result.coverage.observed_artifact_refs).toContain(docsRef);
    expect(result.coverage.final_answer_draft_support_refs).toEqual(expect.arrayContaining([docsRef, calculatorRef]));
    expect(result.answer?.terminal_artifact_kind).toBe("doc_evidence_synthesis_answer");
    expect(result.answer?.source_docs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/docs/helix-ask-codex-loop-discipline.md",
          evidence_refs: [docsRef],
        }),
      ]),
    );
  });

  it("materializes line-backed doc_location_matches with visible document evidence citations", () => {
    const prompt =
      "Use docs-viewer.locate_in_doc to find where docs/helix-ask-codex-loop-discipline.md says routes choose procedures. Answer only from the docs-viewer observation and cite the document evidence.";
    const payload: Record<string, unknown> = synthesisPayload(prompt);
    const location = {
      artifact_id: "doc-location:routes",
      turn_id: turnId,
      kind: "doc_location_matches",
      payload: {
        schema: "helix.doc_location_matches.v1",
        kind: "doc_location_matches",
        query: "routes choose procedures",
        source_path: "/docs/helix-ask-codex-loop-discipline.md",
        matches: [
          {
            path: "/docs/helix-ask-codex-loop-discipline.md",
            heading: "Turn-Chain Fundamentals",
            line_start: 196,
            line_end: 202,
            snippet: "Routes choose procedures. Tools produce observations.",
          },
        ],
        match_count: 1,
        assistant_answer: false,
        raw_content_included: false,
      },
    };
    const finalDraft = {
      artifact_id: "draft:routes",
      turn_id: turnId,
      kind: "final_answer_draft",
      payload: {
        schema: "helix.final_answer_draft.v1",
        artifact_id: "draft:routes",
        text: "The document states that routes choose procedures.",
        support_refs: ["doc-location:routes"],
        artifact_refs: ["doc-location:routes"],
        assistant_answer: false,
        raw_content_included: false,
      },
    };

    const result = materializeDocEvidenceSynthesisAnswer({
      turnId,
      promptText: prompt,
      payload,
      artifactLedger: [location, finalDraft],
      answerText: "The document states that routes choose procedures.",
      finalAnswerDraftRef: "draft:routes",
    });

    expect(result.ok).toBe(true);
    expect(result.answer?.answer_text).toContain("Document evidence:");
    expect(result.answer?.answer_text).toContain("/docs/helix-ask-codex-loop-discipline.md:L196-L202");
    expect(result.answer?.source_docs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/docs/helix-ask-codex-loop-discipline.md",
          evidence_refs: ["doc-location:routes"],
        }),
      ]),
    );
  });

  it("lets route-product docs synthesis dominate stale locate-in-doc terminal metadata", () => {
    const prompt =
      "Use docs-viewer.locate_in_doc to find where docs/helix-ask-codex-loop-discipline.md says routes choose procedures. Answer only from the docs-viewer observation and cite the document evidence.";
    const payload: Record<string, unknown> = synthesisPayload(prompt);
    payload.canonical_goal_frame = {
      turn_id: turnId,
      goal_kind: "locate_in_doc",
      required_terminal_kind: "doc_location_matches",
    };
    payload.committed_ask_route = {
      schema: "helix.committed_ask_route.v1",
      turn_id: turnId,
      route: { source_target: "docs_viewer" },
      canonical_goal: {
        goal_kind: "locate_in_doc",
        required_terminal_kind: "doc_location_matches",
        allowed_terminal_artifact_kinds: ["doc_location_matches", "typed_failure"],
        forbidden_terminal_artifact_kinds: [],
      },
    };
    const location = {
      artifact_id: "doc-location:routes-stale-contract",
      turn_id: turnId,
      kind: "doc_location_matches",
      payload: {
        schema: "helix.doc_location_matches.v1",
        kind: "doc_location_matches",
        query: "routes choose procedures",
        source_path: "/docs/helix-ask-codex-loop-discipline.md",
        matches: [
          {
            path: "/docs/helix-ask-codex-loop-discipline.md",
            heading: "Turn-Chain Fundamentals",
            line_start: 196,
            line_end: 202,
            snippet: "Routes choose procedures. Tools produce observations.",
          },
        ],
        match_count: 1,
        assistant_answer: false,
        raw_content_included: false,
      },
    };
    const finalDraft = {
      artifact_id: "draft:routes-stale-contract",
      turn_id: turnId,
      kind: "final_answer_draft",
      payload: {
        schema: "helix.final_answer_draft.v1",
        artifact_id: "draft:routes-stale-contract",
        text: "The document states that routes choose procedures.",
        required_terminal_kind: "doc_location_matches",
        support_refs: ["doc-location:routes-stale-contract"],
        artifact_refs: ["doc-location:routes-stale-contract"],
        assistant_answer: false,
        raw_content_included: false,
      },
    };

    const result = materializeDocEvidenceSynthesisAnswer({
      turnId,
      promptText: prompt,
      payload,
      artifactLedger: [location, finalDraft],
      answerText: "The document states that routes choose procedures.",
      finalAnswerDraftRef: "draft:routes-stale-contract",
    });

    expect(result.ok).toBe(true);
    expect(result.blocked_reason).not.toBe("route_contract_disallowed");
    expect(payload.docs_synthesis_debug).toMatchObject({
      materializer_contract_allowed: true,
      materializer_goal_kind_source: "route_product_contract.allowed_terminal_artifact_kinds",
      materializer_required_terminal_kind: "doc_evidence_synthesis_answer",
    });
  });

  it("lets completed compound docs itinerary dominate stale locate-in-doc terminal metadata", () => {
    const prompt =
      "Use docs-viewer.locate_in_doc to find where docs/helix-ask-codex-loop-discipline.md says routes choose procedures, then run scientific-calculator.solve_expression with 19+23.";
    const payload: Record<string, unknown> = synthesisPayload(prompt);
    payload.route_product_contract = {
      ...(payload.route_product_contract as Record<string, unknown>),
      allowed_terminal_artifact_kinds: ["doc_location_matches", "typed_failure", "workstation_tool_evaluation"],
      forbidden_terminal_artifact_kinds: ["doc_evidence_synthesis_answer", "direct_answer_text"],
    };
    payload.canonical_goal_frame = {
      turn_id: turnId,
      goal_kind: "locate_in_doc",
      required_terminal_kind: "doc_location_matches",
    };
    payload.committed_ask_route = {
      schema: "helix.committed_ask_route.v1",
      turn_id: turnId,
      route: { source_target: "docs_viewer" },
      canonical_goal: {
        goal_kind: "locate_in_doc",
        required_terminal_kind: "doc_location_matches",
        allowed_terminal_artifact_kinds: ["doc_location_matches", "typed_failure"],
        forbidden_terminal_artifact_kinds: ["doc_evidence_synthesis_answer"],
      },
    };
    payload.capability_itinerary = {
      schema: "helix.capability_itinerary.v1",
      terminal_success_criteria: {
        required_observation_families: ["docs_viewer", "calculator"],
        required_capabilities: ["docs-viewer.locate_in_doc", "scientific-calculator.solve_expression"],
        allowed_terminal_artifact_kinds: ["final_answer_draft"],
        requires_post_observation_synthesis: true,
      },
      planned_steps: [
        { requested_capability: "docs-viewer.locate_in_doc" },
        { requested_capability: "scientific-calculator.solve_expression" },
      ],
      execution_state: {
        complete: true,
        compound_subgoal_ledger: [
          {
            requested_capability: "docs-viewer.locate_in_doc",
            executed_capability: "docs-viewer.locate_in_doc",
            observation_ref: "doc-location:routes-compound",
            satisfaction: "satisfied",
            rail_status: "complete",
          },
          {
            requested_capability: "scientific-calculator.solve_expression",
            executed_capability: "scientific-calculator.solve_expression",
            observation_ref: "calculator:19-plus-23",
            satisfaction: "satisfied",
            rail_status: "complete",
          },
        ],
      },
    };
    const location = {
      artifact_id: "doc-location:routes-compound",
      turn_id: turnId,
      kind: "doc_location_matches",
      payload: {
        schema: "helix.doc_location_matches.v1",
        kind: "doc_location_matches",
        query: "routes choose procedures",
        source_path: "/docs/helix-ask-codex-loop-discipline.md",
        matches: [
          {
            path: "/docs/helix-ask-codex-loop-discipline.md",
            heading: "Turn-Chain Fundamentals",
            line_start: 196,
            line_end: 202,
            snippet: "Routes choose procedures. Tools produce observations.",
          },
        ],
        match_count: 1,
        assistant_answer: false,
        raw_content_included: false,
      },
    };
    const finalDraft = {
      artifact_id: "draft:routes-compound",
      turn_id: turnId,
      kind: "final_answer_draft",
      payload: {
        schema: "helix.final_answer_draft.v1",
        artifact_id: "draft:routes-compound",
        text: "The document states that routes choose procedures, and the calculator result is 42.",
        required_terminal_kind: "doc_location_matches",
        support_refs: ["doc-location:routes-compound", "calculator:19-plus-23"],
        artifact_refs: ["doc-location:routes-compound", "calculator:19-plus-23"],
        assistant_answer: false,
        raw_content_included: false,
      },
    };

    const result = materializeDocEvidenceSynthesisAnswer({
      turnId,
      promptText: prompt,
      payload,
      artifactLedger: [location, finalDraft],
      answerText: "The document states that routes choose procedures, and the calculator result is 42.",
      finalAnswerDraftRef: "draft:routes-compound",
    });

    expect(result.ok).toBe(true);
    expect(result.blocked_reason).not.toBe("route_contract_disallowed");
    expect(payload.docs_synthesis_debug).toMatchObject({
      materializer_contract_allowed: true,
      materializer_goal_kind_source: "capability_itinerary.terminal_success_criteria",
      materializer_required_terminal_kind: "doc_evidence_synthesis_answer",
    });
    expect(payload.doc_evidence_synthesis_answer).toMatchObject({
      terminal_artifact_kind: "doc_evidence_synthesis_answer",
      goal_kind: "doc_evidence_synthesis",
    });
  });

  it("does not materialize a model draft without doc support refs", () => {
    const prompt =
      "Compare docs/helix-ask-flow.md and docs/helix-ask-codex-loop-discipline.md.";
    const payload: Record<string, unknown> = synthesisPayload(prompt);
    const finalDraft = {
      artifact_id: "draft:no-refs",
      turn_id: turnId,
      kind: "final_answer_draft",
      payload: {
        schema: "helix.final_answer_draft.v1",
        artifact_id: "draft:no-refs",
        text: "Flow explains routing, while discipline explains runtime boundaries.",
        assistant_answer: false,
        raw_content_included: false,
      },
    };

    const result = materializeDocEvidenceSynthesisAnswer({
      turnId,
      promptText: prompt,
      payload,
      artifactLedger: [...docsEvidenceArtifacts, finalDraft],
      answerText: "Flow explains routing, while discipline explains runtime boundaries.",
      finalAnswerDraftRef: "draft:no-refs",
    });

    expect(result.ok).toBe(false);
    expect(result.blocked_reason).toBe("doc_evidence_coverage_missing");
    expect(result.coverage.support_refs_count).toBe(0);
    expect(result.coverage.missing_requirements).toEqual(
      expect.arrayContaining(["final_answer_draft_doc_support_refs"]),
    );
  });
});
