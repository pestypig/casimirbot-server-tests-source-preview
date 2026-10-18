import { describe, expect, it } from "vitest";

import { evaluateFinalAnswerDraftQualityGate } from "../services/helix-ask/final-answer-draft-quality-gate";
import { materializeFinalAnswerDraftTerminal } from "../services/helix-ask/final-answer-draft-terminal-materializer";
import { applyHelixProjectionMismatchGate } from "../services/helix-ask/projection-mismatch-gate";
import {
  applyHelixTerminalAuthoritySingleWriter,
  applyTerminalProjectionKindGuard,
  syncHelixTypedFailureAuthorityPublicMirrors,
} from "../services/helix-ask/terminal-authority-single-writer";

const modelOnlyContract = (turnId: string) => ({
  schema: "helix.route_product_contract.v1",
  turn_id: turnId,
  thread_id: "thread:test",
  source_target: "model_only",
  allowed_terminal_artifact_kinds: ["direct_answer_text", "model_synthesized_answer", "typed_failure", "request_user_input"],
  forbidden_terminal_artifact_kinds: ["workspace_action_receipt", "client_projection"],
  required_artifact_refs: [],
  precedence_reason: "test",
  assistant_answer: false,
  raw_content_included: false,
});

const repoContract = (turnId: string) => ({
  schema: "helix.route_product_contract.v1",
  turn_id: turnId,
  thread_id: "thread:test",
  source_target: "repo_code",
  allowed_terminal_artifact_kinds: ["repo_code_evidence_answer", "typed_failure", "request_user_input"],
  forbidden_terminal_artifact_kinds: ["direct_answer_text", "model_synthesized_answer", "workspace_action_receipt"],
  side_artifact_kinds_allowed: ["repo_code_evidence_observation", "final_answer_draft", "repo_answer_text_quality_gate"],
  required_artifact_refs: [],
  precedence_reason: "test",
  assistant_answer: false,
  raw_content_included: false,
});

const researchLibraryObservation = (turnId: string) => ({
  artifact_id: `${turnId}:research_library_observation`,
  kind: "research_library_observation",
  payload: {
    schema: "helix.research_library_observation.v1",
    artifact_id: `${turnId}:research_library_observation`,
    selected_for_answer: true,
    selected_pages: [{
      page: 8,
      source_text_ref: "artifact://paper.pdf#page=8&text",
      text_excerpt: "Wasserstein evidence",
    }],
  },
});

const scholarlyContract = (turnId: string) => ({
  schema: "helix.route_product_contract.v1",
  turn_id: turnId,
  thread_id: "thread:test",
  source_target: "scholarly_research",
  allowed_terminal_artifact_kinds: ["scholarly_research_answer", "typed_failure", "request_user_input"],
  forbidden_terminal_artifact_kinds: ["direct_answer_text", "model_synthesized_answer", "doc_summary", "repo_code_evidence_answer"],
  side_artifact_kinds_allowed: ["scholarly_research_observation", "scholarly_full_text_observation", "final_answer_draft"],
  required_artifact_refs: [],
  precedence_reason: "test",
  assistant_answer: false,
  raw_content_included: false,
});

const liveSourceMailContract = (turnId: string) => ({
  schema: "helix.route_product_contract.v1",
  turn_id: turnId,
  thread_id: "thread:test",
  source_target: "live_source_mailbox",
  allowed_terminal_artifact_kinds: ["model_synthesized_answer", "typed_failure", "request_user_input"],
  forbidden_terminal_artifact_kinds: ["tool_receipt", "workspace_action_receipt", "live_environment_tool_observation"],
  side_artifact_kinds_allowed: ["stage_play_processed_mail_packet", "final_answer_draft"],
  required_artifact_refs: [],
  precedence_reason: "test",
  assistant_answer: false,
  raw_content_included: false,
});

const moralGraphContract = (turnId: string) => ({
  schema: "helix.route_product_contract.v1",
  turn_id: turnId,
  thread_id: "thread:test",
  source_target: "moral_graph",
  allowed_terminal_artifact_kinds: ["model_synthesized_answer", "typed_failure", "request_user_input"],
  forbidden_terminal_artifact_kinds: [
    "direct_answer_text",
    "doc_summary",
    "repo_code_evidence_answer",
    "scholarly_research_answer",
    "internet_search_answer",
    "workspace_action_receipt",
  ],
  side_artifact_kinds_allowed: ["moral_graph_reflection", "final_answer_draft"],
  required_artifact_refs: [],
  precedence_reason: "moral_graph_requires_reflection_observation_before_terminal_synthesis",
  assistant_answer: false,
  raw_content_included: false,
});

const docsEvidenceContract = (turnId: string) => ({
  schema: "helix.route_product_contract.v1",
  turn_id: turnId,
  thread_id: "thread:test",
  source_target: "docs_viewer",
  allowed_terminal_artifact_kinds: ["doc_evidence_synthesis_answer", "typed_failure", "request_user_input"],
  forbidden_terminal_artifact_kinds: ["direct_answer_text", "model_synthesized_answer", "tool_receipt"],
  side_artifact_kinds_allowed: ["doc_location_matches", "calculator_receipt", "final_answer_draft"],
  required_artifact_refs: [],
  precedence_reason: "test",
  assistant_answer: false,
  raw_content_included: false,
});

const addModelOnlyRuntimeProof = (payload: Record<string, unknown>): void => {
  payload.agent_runtime_loop = {
    iterations: [
      {
        iteration: 1,
        next_step: "answer",
        chosen_capability: "model.direct_answer",
        decision_authority: "llm",
        observation_role: "model_answer_draft",
      },
    ],
  };
  payload.goal_satisfaction_evaluation = {
    satisfaction: "satisfied",
    next_decision: "allow_terminal",
  };
};

const addRepoRuntimeProof = (payload: Record<string, unknown>, observationRef: string): void => {
  payload.agent_runtime_loop = {
    iterations: [
      {
        iteration: 1,
        next_step: "next_action",
        chosen_capability: "repo-code.search_concept",
        decision_authority: "llm",
        observed_artifact_refs: [observationRef],
      },
      {
        iteration: 2,
        next_step: "answer",
        chosen_capability: "model.synthesize_from_repo_evidence",
        decision_authority: "llm",
        observation_role: "model_answer_draft",
      },
    ],
  };
  payload.goal_satisfaction_evaluation = {
    satisfaction: "satisfied",
    next_decision: "allow_terminal",
  };
};

const addScholarlyRuntimeProof = (
  payload: Record<string, unknown>,
  lookupRef: string,
  fullTextRef: string,
): void => {
  payload.agent_runtime_loop = {
    iterations: [
      {
        iteration: 1,
        next_step: "next_action",
        chosen_capability: "scholarly-research.lookup_papers",
        decision_authority: "llm",
        observed_artifact_refs: [lookupRef],
      },
      {
        iteration: 2,
        next_step: "next_action",
        chosen_capability: "scholarly-research.fetch_full_text",
        decision_authority: "llm",
        observed_artifact_refs: [fullTextRef],
      },
      {
        iteration: 3,
        next_step: "answer",
        chosen_capability: "model.synthesize_from_scholarly_research",
        decision_authority: "llm",
        observation_role: "model_answer_draft",
      },
    ],
  };
  payload.goal_satisfaction_evaluation = {
    satisfaction: "satisfied",
    next_decision: "allow_terminal",
  };
};

const addCalculatorRuntimeProof = (
  payload: Record<string, unknown>,
  observationRef: string,
  artifactKind = "workstation_tool_evaluation",
): void => {
  payload.agent_step_decision = {
    schema: "helix.agent_step_decision.v1",
    decision_id: `${payload.turn_id}:decision:1`,
    chosen_capability: "scientific-calculator.solve_expression",
    decision_authority: "llm",
    decision_timing: "pre_action",
    assistant_answer: false,
    raw_content_included: false,
  };
  payload.runtime_tool_call = {
    schema: "helix.runtime_tool_call.v1",
    capability_key: "scientific-calculator.solve_expression",
    artifact_ref: observationRef,
    assistant_answer: false,
    raw_content_included: false,
  };
  payload.agent_runtime_loop = {
    schema: "helix.agent_runtime_loop.v1",
    iterations: [
      {
        iteration: 1,
        decision_id: `${payload.turn_id}:decision:1`,
        next_step: "next_action",
        chosen_capability: "scientific-calculator.solve_expression",
        executed_action_key: "scientific-calculator.solve_expression",
        decision_authority: "llm",
        decision_timing: "pre_action",
        observed_artifact_refs: [observationRef],
        artifact_refs: [observationRef],
        tool_observation: {
          kind: artifactKind,
          artifact_id: observationRef,
          status: "completed",
          ok: true,
        },
      },
      {
        iteration: 2,
        decision_id: `${payload.turn_id}:decision:2`,
        next_step: "answer",
        chosen_capability: "model.synthesize_from_tool_observation",
        decision_authority: "llm",
        decision_timing: "post_observation",
        observation_role: "model_answer_draft",
      },
    ],
    assistant_answer: false,
    raw_content_included: false,
  };
  payload.goal_satisfaction_evaluation = {
    schema: "helix.goal_satisfaction_evaluation.v1",
    canonical_goal_kind: "calculator_solve",
    required_terminal_kind: "workstation_tool_evaluation",
    terminal_artifact_kind: "workstation_tool_evaluation",
    satisfaction: "satisfied",
    next_decision: "allow_terminal",
    assistant_answer: false,
    raw_content_included: false,
  };
};

const addMoralGraphRuntimeProof = (payload: Record<string, unknown>, observationRef: string): void => {
  payload.agent_runtime_loop = {
    schema: "helix.agent_runtime_loop.v1",
    iterations: [
      {
        iteration: 1,
        next_step: "next_action",
        chosen_capability: "moral-graph.reflect_context",
        executed_action_key: "moral-graph.reflect_context",
        decision_authority: "llm",
        observed_artifact_refs: [observationRef],
      },
      {
        iteration: 2,
        next_step: "answer",
        chosen_capability: "model.synthesize_from_current_observations",
        decision_authority: "llm",
        observation_role: "model_answer_draft",
      },
    ],
    assistant_answer: false,
    raw_content_included: false,
  };
  payload.goal_satisfaction_evaluation = {
    schema: "helix.goal_satisfaction_evaluation.v1",
    canonical_goal_kind: "moral_graph_reflection",
    required_terminal_kind: "model_synthesized_answer",
    satisfaction: "satisfied",
    next_decision: "allow_terminal",
    assistant_answer: false,
    raw_content_included: false,
  };
};

describe("final_answer_draft terminal selection", () => {
  it("requires a visible citation for analytical claims over observed scholarly full text", () => {
    const turnId = "ask:test:scholarly-analytical-visible-citation";
    const fullTextArtifact = {
      artifact_id: `${turnId}:scholarly-full-text`,
      kind: "scholarly_full_text_observation",
      payload: {
        schema: "helix.scholarly_full_text_observation.v1",
        selected_chunks: [{
          text_excerpt: "The flow and its derivatives are smooth and bounded.",
          citation_ref: "artifact://scholarly-pdf/paper.pdf#page=4&char=10-80",
        }],
      },
    } as any;
    const prompt =
      "Which assumption mismatch matters most, and what remains unresolved?";
    const evaluate = (draftText: string) => evaluateFinalAnswerDraftQualityGate({
      turnId,
      finalAnswerDraftRef: `${turnId}:draft`,
      draftText,
      draftPayload: { support_refs: [fullTextArtifact.artifact_id] },
      promptText: prompt,
      routeProductContract: scholarlyContract(turnId),
      payload: { active_prompt: prompt },
      artifactLedger: [fullTextArtifact],
    });

    expect(evaluate(
      "The main mismatch is the smooth and bounded flow assumption.",
    ).violations).toContain("missing_visible_citation_for_scholarly_analysis");
    expect(evaluate(
      "The main mismatch is the smooth and bounded flow assumption [paper, p. 4](artifact://scholarly-pdf/paper.pdf#page=4&char=10-80).",
    ).violations).not.toContain("missing_visible_citation_for_scholarly_analysis");
  });

  it("rejects abbreviated or mislabeled scholarly page evidence links", () => {
    const turnId = "ask:test:invalid-page-evidence-links";
    const artifact = researchLibraryObservation(turnId);
    const gate = evaluateFinalAnswerDraftQualityGate({
      turnId,
      finalAnswerDraftRef: `${turnId}:draft`,
      draftText: "- Page 8: 7 exact case-sensitive occurrences — `…pdf#page=8&text`\n- [Page 8](artifact://paper.pdf#page=9&text)",
      draftPayload: { support_refs: [artifact.artifact_id] },
      promptText:
        "Within only pages 8 and 9, return the count per page and page-grounded evidence locations.",
      routeProductContract: scholarlyContract(turnId),
      payload: { active_prompt: "Return page-grounded evidence locations." },
      artifactLedger: [artifact],
    });

    expect(gate.ok).toBe(false);
    expect(gate.violations).toContain("invalid_page_evidence_links");
  });

  it("allows no match-location links only when every requested page explicitly reports zero occurrences", () => {
    const turnId = "ask:test:zero-page-evidence-links";
    const artifact = researchLibraryObservation(turnId);
    const prompt =
      "Within only pages 8 and 9, return the count per page and complete page-grounded evidence locations.";
    const evaluate = (draftText: string) => evaluateFinalAnswerDraftQualityGate({
      turnId,
      finalAnswerDraftRef: `${turnId}:draft`,
      draftText,
      draftPayload: { support_refs: [artifact.artifact_id] },
      promptText: prompt,
      routeProductContract: scholarlyContract(turnId),
      payload: { active_prompt: prompt },
      artifactLedger: [artifact],
    });

    const completeZeroGate = evaluate([
      "Page 8: **0** occurrences — no page-grounded match locations.",
      "Page 9: **0** occurrences — no page-grounded match locations.",
    ].join("\n\n"));
    const partialZeroGate = evaluate("Page 8: **0** occurrences — no page-grounded match locations.");
    const positiveWithoutLinkGate = evaluate([
      "Page 8: **1** occurrence — page-grounded evidence unavailable.",
      "Page 9: **0** occurrences — no page-grounded match locations.",
    ].join("\n\n"));

    expect(completeZeroGate.violations).not.toContain("invalid_page_evidence_links");
    expect(partialZeroGate.violations).toContain("invalid_page_evidence_links");
    expect(positiveWithoutLinkGate.violations).toContain("invalid_page_evidence_links");
  });

  it("requires exact admitted sentence boundaries for saved-page boundary prompts", () => {
    const turnId = "ask:test:page-boundary-sentences";
    const artifact = researchLibraryObservation(turnId);
    artifact.payload.selected_pages[0] = {
      ...artifact.payload.selected_pages[0],
      first_nonblank_sentence: "First actual sentence has enough words.",
      last_nonblank_sentence: "Last actual sentence also has enough words.",
    };
    const prompt =
      "From only page 8, return the first and last nonblank sentences exactly as extracted, followed by one complete page-grounded evidence link.";
    const evaluate = (draftText: string) => evaluateFinalAnswerDraftQualityGate({
      turnId,
      finalAnswerDraftRef: `${turnId}:draft`,
      draftText,
      draftPayload: { support_refs: [artifact.artifact_id] },
      promptText: prompt,
      routeProductContract: scholarlyContract(turnId),
      payload: { active_prompt: prompt },
      artifactLedger: [artifact],
    });
    const validGate = evaluate([
      "First actual sentence has enough words.",
      "Last actual sentence also has enough words.",
      "[Page 8](artifact://paper.pdf#page=8&text)",
    ].join("\n\n"));
    const fragmentGate = evaluate([
      "8 1 ∼ 6.",
      "Last actual sentence also has enough words.",
      "[Page 8](artifact://paper.pdf#page=8&text)",
    ].join("\n\n"));

    expect(validGate.violations).not.toContain("missing_requested_page_boundaries");
    expect(fragmentGate.violations).toContain("missing_requested_page_boundaries");
  });

  it("allows conditional Image Lens fallback only with an explicit grounded missing-visual report", () => {
    const turnId = "ask:test:conditional-visual-evidence";
    const artifact = researchLibraryObservation(turnId);
    const prompt = [
      "Use saved text first, then use Image Lens only if visual inspection is necessary.",
      "If page-image evidence cannot be materialized, report the exact missing requirement.",
      "Return separate Text evidence and Visual evidence sections with page-grounded references.",
    ].join(" ");
    const evaluate = (draftText: string, artifacts = [artifact]) => evaluateFinalAnswerDraftQualityGate({
      turnId,
      finalAnswerDraftRef: `${turnId}:draft`,
      draftText,
      draftPayload: { support_refs: [artifact.artifact_id] },
      promptText: prompt,
      routeProductContract: scholarlyContract(turnId),
      payload: { active_prompt: prompt },
      artifactLedger: artifacts,
    });
    const groundedMissing = evaluate([
      "## Text evidence",
      "Equation (47) is present. [Page 8](artifact://paper.pdf#page=8&text)",
      "## Visual evidence",
      "No page-image evidence was materialized because no rendered page or Image Lens source ID was supplied.",
    ].join("\n\n"));
    const inventedVisual = evaluate([
      "## Text evidence",
      "Equation (47) is present. [Page 8](artifact://paper.pdf#page=8&text)",
      "## Visual evidence",
      "Image Lens visually confirmed the displayed layout, although no rendered page source was available.",
    ].join("\n\n"));
    const missingSection = evaluate([
      "## Text evidence",
      "Equation (47) is present. [Page 8](artifact://paper.pdf#page=8&text)",
      "No rendered page was supplied.",
    ].join("\n\n"));
    const liveProviderAnswer = evaluate([
      "### Text evidence",
      "Saved machine-readable page-8 text locates equation **(47)** and its constraints. [Saved paper, page 8 text](artifact://paper.pdf#page=8&text)",
      "### Visual evidence",
      "No Image Lens inspection was run: the saved text was sufficient, and no page-image artifact was materialized.",
      "Exact missing requirement: a **rendered page-8 image reference or an Image Lens source ID with pixel bounds**. Without that, I cannot verify visual layout details such as alignment, line breaks, or display positioning.",
    ].join("\n\n"));

    expect(groundedMissing.violations).not.toContain("invalid_conditional_visual_evidence_answer");
    expect(liveProviderAnswer.violations).toEqual([]);
    expect(inventedVisual.violations).toContain("invalid_conditional_visual_evidence_answer");
    expect(missingSection.violations).toContain("invalid_conditional_visual_evidence_answer");
  });

  it("preserves an actionable Codex limitation grounded in a successful current-turn observation", () => {
    const turnId = "ask:test:grounded-evidence-limitation";
    const observationRef = `${turnId}:codex_normalized:live_environment_observation:1`;
    const observation = {
      artifact_id: observationRef,
      turn_id: turnId,
      kind: "live_environment_observation",
      status: "succeeded",
      payload: {
        schema: "helix.live_environment_observation.v1",
        turn_id: turnId,
        status: "succeeded",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    };
    const draftText = [
      "I cannot truthfully choose an exact wall coordinate from the admitted evidence alone.",
      "The current-turn observation only confirms the floor sample; the block-level shell geometry is missing.",
      "A fresh bounded spatial probe is required before I can proceed with a safe placement plan.",
    ].join("\n\n");
    const evaluate = (input: {
      supportRefs?: string[];
      artifacts?: typeof observation[];
      text?: string;
    }) =>
      evaluateFinalAnswerDraftQualityGate({
        turnId,
        finalAnswerDraftRef: `${turnId}:draft`,
        draftText: input.text ?? draftText,
        draftPayload: {
          grounded_in_observation_refs: input.supportRefs ?? [observationRef],
        },
        promptText:
          "Inspect the house shell and select one exact safe wall coordinate.",
        routeProductContract: modelOnlyContract(turnId),
        payload: { active_prompt: "Inspect the house shell." },
        artifactLedger: input.artifacts ?? [observation],
      });

    expect(evaluate({}).violations).not.toContain("refusal_without_error");
    expect(
      evaluate({ supportRefs: [`${turnId}:missing-observation`] }).violations,
    ).toContain("refusal_without_error");
    expect(
      evaluate({
        artifacts: [
          {
            ...observation,
            status: "failed",
            payload: { ...observation.payload, status: "failed" },
          },
        ],
      }).violations,
    ).toContain("refusal_without_error");
    expect(
      evaluate({
        artifacts: [
          {
            ...observation,
            turn_id: "ask:test:stale-turn",
            payload: {
              ...observation.payload,
              turn_id: "ask:test:stale-turn",
            },
          },
        ],
      }).violations,
    ).toContain("refusal_without_error");
    expect(
      evaluate({
        text: "I cannot answer this request. Please try again.",
      }).violations,
    ).toContain("refusal_without_error");
  });

  it("preserves a substantive Codex limitation structurally grounded in every completed compound rail", () => {
    const turnId = "ask:test:grounded-compound-limitation";
    const observationRefs = ["spatial", "walk", "status"].map(
      (suffix) => `${turnId}:observation:${suffix}`,
    );
    const artifacts = observationRefs.map((artifactId) => ({
      artifact_id: artifactId,
      turn_id: turnId,
      kind: "live_environment_observation",
      status: "succeeded",
      payload: {
        schema: "helix.live_environment_observation.v1",
        turn_id: turnId,
        status: "succeeded",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    }));
    const executionState = {
      schema: "helix.capability_itinerary_execution_state.v1",
      complete: true,
      compound_subgoal_ledger: observationRefs.map((observationRef) => ({
        satisfaction: "satisfied",
        rail_status: "complete",
        observation_ref: observationRef,
      })),
    };
    const draftText = [
      "A single bounded step was taken and the measured movement completed successfully.",
      "The fresh status observation confirms the player remained healthy and no forbidden mutation was reported.",
      "What I cannot fully verify from the compacted evidence is the exact cardinal direction and ideal headroom for the landing cell.",
    ].join("\n\n");
    const evaluate = (input?: {
      text?: string;
      supportRefs?: string[];
      artifacts?: typeof artifacts;
    }) =>
      evaluateFinalAnswerDraftQualityGate({
        turnId,
        finalAnswerDraftRef: `${turnId}:draft`,
        draftText: input?.text ?? draftText,
        draftPayload: {
          support_refs: input?.supportRefs ?? observationRefs,
        },
        promptText: "Inspect, walk one safe step, then check status.",
        routeProductContract: modelOnlyContract(turnId),
        payload: {
          active_prompt: "Inspect, walk one safe step, then check status.",
          capability_itinerary_execution_state: executionState,
        },
        artifactLedger: input?.artifacts ?? artifacts,
      });

    expect(evaluate().violations).not.toContain("refusal_without_error");
    expect(
      evaluate({ supportRefs: observationRefs.slice(0, 2) }).violations,
    ).toContain("refusal_without_error");
    expect(
      evaluate({
        artifacts: artifacts.map((artifact, index) =>
          index === 1
            ? {
                ...artifact,
                status: "failed",
                payload: { ...artifact.payload, status: "failed" },
              }
            : artifact,
        ),
      }).violations,
    ).toContain("refusal_without_error");
    expect(
      evaluate({ text: "I cannot answer this request. Please try again." })
        .violations,
    ).toContain("refusal_without_error");
  });

  it("enforces explicit per-bullet page reference counts and identities", () => {
    const turnId = "ask:test:per-bullet-page-evidence-links";
    const artifact = researchLibraryObservation(turnId);
    const prompt =
      "Every bullet must end with exactly two evidence references: one to page 8 and one to page 9.";
    const validBullet =
      "- Comparison. [Page 8](artifact://paper.pdf#page=8&text) [Page 9](artifact://paper.pdf#page=9&text)";
    const invalidGate = evaluateFinalAnswerDraftQualityGate({
      turnId,
      finalAnswerDraftRef: `${turnId}:invalid-draft`,
      draftText: `${validBullet}\n\n- Incomplete. [Page 8](artifact://paper.pdf#page=8&text)`,
      draftPayload: { support_refs: [artifact.artifact_id] },
      promptText: prompt,
      routeProductContract: scholarlyContract(turnId),
      payload: { active_prompt: prompt },
      artifactLedger: [artifact],
    });
    const validGate = evaluateFinalAnswerDraftQualityGate({
      turnId,
      finalAnswerDraftRef: `${turnId}:valid-draft`,
      draftText: `${validBullet}\n\n${validBullet}`,
      draftPayload: { support_refs: [artifact.artifact_id] },
      promptText: prompt,
      routeProductContract: scholarlyContract(turnId),
      payload: { active_prompt: prompt },
      artifactLedger: [artifact],
    });

    expect(invalidGate.violations).toContain("invalid_page_evidence_links");
    expect(validGate.violations).not.toContain("invalid_page_evidence_links");
  });

  it("materializes a grounded capability-catalog draft as capability_help_summary", () => {
    const turnId = "ask:test:capability-help-draft-materialization";
    const registryRef = `${turnId}:capability_registry`;
    const draftRef = `${turnId}:final_answer_draft`;
    const answerText = [
      "The research-paper workflow checks candidate relevance and available metadata before full-text retrieval.",
      "scholarly-research.fetch_full_text establishes parseability, and Image Lens is used selectively for visual page evidence.",
    ].join("\n");
    const contract = {
      schema: "helix.route_product_contract.v1",
      source_target: "runtime_evidence",
      allowed_terminal_artifact_kinds: ["capability_help_summary", "typed_failure"],
      forbidden_terminal_artifact_kinds: ["model_synthesized_answer", "direct_answer_text"],
    };
    const artifacts = [
      {
        artifact_id: registryRef,
        kind: "capability_registry",
        payload: {
          schema: "helix.capability_registry.v1",
          assistant_answer: false,
          terminal_eligible: false,
        },
      },
      {
        artifact_id: draftRef,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          kind: "final_answer_draft",
          text: answerText,
          support_refs: [registryRef],
          artifact_refs: [registryRef],
          authority: "llm_post_observation_composer",
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      active_prompt:
        "Does your research-paper tool choose parseable papers before using Image Lens? Answer from the capability contract.",
      canonical_goal_frame: {
        goal_kind: "capability_help",
        required_terminal_kind: "capability_help_summary",
      },
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      capability_plan: {
        selected_capability: "helix_ask.inspect_capability_catalog",
      },
      agent_step_decision: {
        chosen_capability: "model.direct_answer",
        next_step: "answer",
        decision_timing: "post_observation",
        decision_authority: "llm",
      },
      agent_runtime_loop: {
        executed_tool_call_count: 0,
        iterations: [{
          chosen_capability: "model.direct_answer",
          next_step: "answer",
          decision_timing: "post_observation",
          decision_authority: "llm",
          observation_role: "model_answer_draft",
        }],
      },
      tool_turn_chain_audit: {
        rail_status: "fail_closed",
        rail_failure_code: "terminal_not_materialized",
        first_broken_rail: "terminal_materialization",
        repair_target: "terminal_materializer",
        selected_capability: "helix_ask.inspect_capability_catalog",
        executed_capability: "helix_ask.inspect_capability_catalog",
      },
      route_product_contract: contract,
      current_turn_artifact_ledger: artifacts,
      terminal_error_code: "terminal_not_materialized",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      selected_final_answer: answerText.slice(0, 240),
      typed_failure: {
        error_code: "terminal_not_materialized",
        message: answerText,
        text: answerText.slice(0, 240),
      },
    };

    const result = materializeFinalAnswerDraftTerminal({
      turnId,
      payload,
      artifactLedger: artifacts,
      routeProductContract: contract,
    });

    expect(result).toMatchObject({
      ok: true,
      materialized_terminal_artifact_kind: "capability_help_summary",
      materialized_terminal_artifact_ref: `${turnId}:capability_help_summary:from_final_answer_draft`,
    });
    expect(payload.capability_help_summary).toMatchObject({
      schema: "helix.capability_help_summary.v1",
      text: answerText,
      answer_text: answerText,
      support_refs: expect.arrayContaining([registryRef]),
      terminal_eligible: true,
    });
    expect(artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        artifact_id: `${turnId}:capability_help_summary:from_final_answer_draft`,
        kind: "capability_help_summary",
      }),
    ]));

    const terminal = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });
    expect(terminal.selected_terminal_artifact_kind).toBe("capability_help_summary");
    expect(terminal.visible_text).toBe(answerText);
    expect(payload).toMatchObject({
      terminal_artifact_kind: "capability_help_summary",
      final_answer_source: "capability_help_summary",
      selected_final_answer: answerText,
      terminal_presentation: {
        terminal_artifact_kind: "capability_help_summary",
        concise_text: answerText,
      },
    });
    expect(payload.typed_failure).toBeUndefined();
  });
  it("materializes capability help summary from a runtime capability registry observation", () => {
    const turnId = "ask:test:catalog-observation-materializes-help";
    const registryRef = `${turnId}:capability_registry`;
    const artifacts = [
      {
        artifact_id: registryRef,
        kind: "capability_registry",
        payload: {
          schema: "helix.capability_registry.v1",
          capability_catalog_observation: {
            active_dynamic_tool_count: 4,
            retired_dynamic_tool_count: 1,
            information_reflection: [
              "docs-viewer.locate_in_doc",
              "repo-code.search_concept",
              "helix_ask.reflect_theory_context",
            ],
            utility: ["workspace_os.status", "scientific-calculator.solve_expression"],
          },
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt: "What tools are available for Helix Ask to use?",
      route_product_contract: {
        ...modelOnlyContract(turnId),
        source_target: "capability_catalog",
        allowed_terminal_artifact_kinds: ["capability_help_summary", "typed_failure", "request_user_input"],
        forbidden_terminal_artifact_kinds: ["debug_evidence_diagnosis", "repo_code_evidence_answer", "direct_answer_text"],
        side_artifact_kinds_allowed: ["capability_registry"],
      },
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "capability_help",
        required_terminal_kind: "capability_help_summary",
      },
      goal_satisfaction_evaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
        required_evidence: [
          { kind: "capability_registry", satisfied: true, evidence_ref: registryRef },
        ],
      },
      agent_runtime_loop: {
        schema: "helix.agent_runtime_loop.v1",
        iterations: [
          {
            iteration: 1,
            decision_id: `${turnId}:decision:catalog`,
            next_step: "tool",
            decision_authority: "llm",
            chosen_capability: "helix_ask.inspect_capability_catalog",
            observed_artifact_refs: [registryRef],
          },
          {
            iteration: 2,
            decision_id: `${turnId}:decision:answer`,
            next_step: "answer",
            decision_timing: "post_observation_terminal_review",
            decision_authority: "llm",
            chosen_capability: "model.synthesize_from_capability_registry",
            observed_artifact_refs: [registryRef],
            observation_role: "terminal_decision",
          },
        ],
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: artifacts,
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      selected_final_answer: "I could not complete that turn.",
      debug: {
        terminal_artifact_kind: "typed_failure",
        final_answer_source: "typed_failure",
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("capability_help_summary");
    expect(result.source).toBe("capability_help_summary");
    expect(result.visible_text).toContain("Helix Ask capability catalog");
    expect(result.visible_text).toContain("docs-viewer.locate_in_doc");
    expect(payload.capability_help_summary).toMatchObject({
      schema: "helix.capability_help_summary.v1",
      capability_catalog_ref: registryRef,
      support_refs: [registryRef],
      support_refs_count: 1,
      subgoal_observation_refs: [registryRef],
      subgoal_observation_refs_count: 1,
      source_families: ["capability_catalog"],
    });
    expect(payload.terminal_artifact_kind).toBe("capability_help_summary");
    expect(payload.final_answer_source).toBe("capability_help_summary");
    expect(payload.selected_terminal_support_refs).toEqual([registryRef]);
    expect(payload.terminal_synthesis_support_refs).toEqual([registryRef]);
    expect((payload.debug as Record<string, unknown>).terminal_artifact_kind).toBe("capability_help_summary");
    expect((payload.debug as Record<string, unknown>).selected_terminal_support_refs).toEqual([registryRef]);
  });

  it("materializes theory reflection answer from receipt and evaluation when no final draft exists", () => {
    const turnId = "ask:test:theory-reflection-receipt-materializes-answer";
    const receiptRef = `${turnId}:theory_context_reflection_tool_receipt`;
    const evaluationRef = `${turnId}:workstation_tool_evaluation`;
    const artifacts = [
      {
        artifact_id: receiptRef,
        kind: "helix_theory_context_reflection_tool_receipt",
        payload: {
          schema: "helix.theory_context_reflection_tool_receipt.v1",
          capability: "helix_ask.reflect_theory_context",
          tool_id: "helix_ask.reflect_theory_context",
          text: "Theory graph reflection found Needle Hull Mark 2 near hull geometry and Casimir cavity badges.",
          assistant_answer: false,
          terminal_eligible: false,
        },
      },
      {
        artifact_id: evaluationRef,
        kind: "workstation_tool_evaluation",
        payload: {
          schema: "helix.workstation_tool_evaluation.v1",
          evaluation_id: evaluationRef,
          result: "supports_subgoal",
          supports_goal: true,
          summary:
            "Theory reflection located Needle Hull Mark 2 near hull geometry, Casimir cavity coupling, stability checks, scalar cuts, and terminal solver policy.",
          answer_text: "I located this discussion in the Theory Badge Graph.",
          evidence_refs: [receiptRef],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt: "Use helix_ask.reflect_theory_context. What are the main components of Needle Hull Mark 2?",
      route_product_contract: {
        ...modelOnlyContract(turnId),
        source_target: "theory_locator",
        allowed_terminal_artifact_kinds: ["theory_context_reflection_answer", "typed_failure", "request_user_input"],
        forbidden_terminal_artifact_kinds: ["workstation_tool_evaluation", "tool_receipt", "direct_answer_text"],
        side_artifact_kinds_allowed: ["helix_theory_context_reflection_tool_receipt", "workstation_tool_evaluation"],
      },
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "theory_context_reflection",
        required_terminal_kind: "theory_context_reflection_answer",
      },
      goal_satisfaction_evaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
        required_evidence: [
          { kind: "helix_theory_context_reflection_tool_receipt", satisfied: true, evidence_ref: receiptRef },
          { kind: "workstation_tool_evaluation", satisfied: true, evidence_ref: evaluationRef },
        ],
      },
      agent_runtime_loop: {
        schema: "helix.agent_runtime_loop.v1",
        iterations: [
          {
            iteration: 1,
            decision_id: `${turnId}:decision:reflect`,
            next_step: "tool",
            decision_authority: "llm",
            chosen_capability: "helix_ask.reflect_theory_context",
            observed_artifact_refs: [receiptRef, evaluationRef],
          },
          {
            iteration: 2,
            decision_id: `${turnId}:decision:answer`,
            next_step: "answer",
            decision_timing: "post_observation_terminal_review",
            decision_authority: "llm",
            chosen_capability: "model.synthesize_from_theory_context_reflection",
            observed_artifact_refs: [receiptRef, evaluationRef],
            observation_role: "terminal_decision",
          },
        ],
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: artifacts,
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      selected_final_answer: "I could not complete that turn.",
      debug: {
        terminal_artifact_kind: "typed_failure",
        final_answer_source: "typed_failure",
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("theory_context_reflection_answer");
    expect(result.source).toBe("theory_context_reflection_answer");
    expect(result.visible_text).toContain("Main components:");
    expect(result.visible_text).toContain("Casimir cavity");
    expect(payload.theory_context_reflection_answer).toMatchObject({
      schema: "helix.theory_context_reflection_answer.v1",
      support_refs: [receiptRef, evaluationRef],
      support_refs_count: 2,
    });
    expect(payload.terminal_artifact_kind).toBe("theory_context_reflection_answer");
    expect(payload.final_answer_source).toBe("theory_context_reflection_answer");
    expect((payload.debug as Record<string, unknown>).terminal_artifact_kind).toBe("theory_context_reflection_answer");
  });

  it("does not materialize a theory reflection answer from a thin receipt without evaluation support", () => {
    const turnId = "ask:test:thin-theory-reflection-does-not-materialize";
    const receiptRef = `${turnId}:theory_context_reflection_tool_receipt`;
    const artifacts = [
      {
        artifact_id: receiptRef,
        kind: "helix_theory_context_reflection_tool_receipt",
        payload: {
          schema: "helix.theory_context_reflection_tool_receipt.v1",
          capability: "helix_ask.reflect_theory_context",
          tool_id: "helix_ask.reflect_theory_context",
          text: "Theory graph reflection observed a related badge.",
          assistant_answer: false,
          terminal_eligible: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt: "Use helix_ask.reflect_theory_context. Explain the main components.",
      route_product_contract: {
        ...modelOnlyContract(turnId),
        source_target: "theory_locator",
        allowed_terminal_artifact_kinds: ["theory_context_reflection_answer", "typed_failure", "request_user_input"],
        forbidden_terminal_artifact_kinds: ["workstation_tool_evaluation", "tool_receipt", "direct_answer_text"],
        side_artifact_kinds_allowed: ["helix_theory_context_reflection_tool_receipt"],
      },
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "theory_context_reflection",
        required_terminal_kind: "theory_context_reflection_answer",
      },
      goal_satisfaction_evaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
        required_evidence: [
          { kind: "helix_theory_context_reflection_tool_receipt", satisfied: true, evidence_ref: receiptRef },
        ],
      },
      current_turn_artifact_ledger: artifacts,
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      selected_final_answer: "I could not complete that turn.",
      debug: {
        terminal_artifact_kind: "typed_failure",
        final_answer_source: "typed_failure",
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(payload.theory_context_reflection_answer).toBeUndefined();
    expect(payload.terminal_artifact_kind).toBe("typed_failure");
  });

  it("adds scientific evidence guard text to theory reflection terminal answers", () => {
    const turnId = "ask:test:theory-reflection-scientific-final-answer-guard";
    const receiptRef = `${turnId}:theory_context_reflection_tool_receipt`;
    const evaluationRef = `${turnId}:workstation_tool_evaluation`;
    const scientificBranchGate = {
      schema: "helix.scientific_branch_gate.v1",
      status: "restricted",
      primary_domain: "weyl_bianchi",
      congruence_grade_floor: "domain_context_match",
      rejected_calculator_payload_ids: [
        "tokamak_thermal_pressure_payload",
        "tokamak_confinement_energy_payload",
      ],
      rejected_badge_ids: [],
      congruence_assessments: [
        {
          target_ref: "tokamak_thermal_pressure_payload",
          target_kind: "calculator_payload",
          grade: "false_friend",
          reasons: ["Target matched a blocked scientific branch hint for this evidence domain."],
          matched_symbols: [],
          blocked_by_branch_hint: true,
        },
      ],
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    const scientificRunTrace = {
      schema: "helix.scientific_run_trace.v1",
      trace_id: "scientific_run:test-bianchi-restricted",
      primary_domain: "weyl_bianchi",
      branch_gate_status: "restricted",
      congruence_grade_floor: "domain_context_match",
      rejected_calculator_payload_ids: [
        "tokamak_thermal_pressure_payload",
        "tokamak_confinement_energy_payload",
      ],
      rejected_badge_ids: [],
      final_answer_guard: {
        required_claim_boundary: "observation_ocr_graph_match_not_proof",
        must_disclose_uncertainty: true,
        must_disclose_rejections: true,
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    const artifacts = [
      {
        artifact_id: receiptRef,
        kind: "helix_theory_context_reflection_tool_receipt",
        payload: {
          schema: "helix.theory_context_reflection_tool_receipt.v1",
          capability: "helix_ask.reflect_theory_context",
          tool_id: "helix_ask.reflect_theory_context",
          text: "Theory graph reflection observed Weyl/Bianchi context.",
          observation: {
            schema: "helix.theory_context_reflection_observation.v1",
            scientific_branch_gate: scientificBranchGate,
            scientific_run_trace: scientificRunTrace,
          },
          assistant_answer: false,
          terminal_eligible: false,
        },
      },
      {
        artifact_id: evaluationRef,
        kind: "workstation_tool_evaluation",
        payload: {
          schema: "helix.workstation_tool_evaluation.v1",
          result: "supports_subgoal",
          capability: "theory_context_reflection",
          summary: "Theory reflection located discussion context as evidence only: Weyl/Bianchi crop context.",
          evidence_refs: [receiptRef],
          observation: {
            scientific_branch_gate: scientificBranchGate,
            scientific_run_trace: scientificRunTrace,
          },
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      active_prompt: "Use the Image Lens Bianchi/Weyl crop evidence in the Theory Badge Graph.",
      route_product_contract: {
        ...modelOnlyContract(turnId),
        source_target: "theory_locator",
        allowed_terminal_artifact_kinds: ["theory_context_reflection_answer", "typed_failure", "request_user_input"],
        forbidden_terminal_artifact_kinds: ["workstation_tool_evaluation", "tool_receipt", "direct_answer_text"],
        side_artifact_kinds_allowed: ["helix_theory_context_reflection_tool_receipt", "workstation_tool_evaluation"],
      },
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "theory_context_reflection",
        required_terminal_kind: "theory_context_reflection_answer",
      },
      goal_satisfaction_evaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
        required_evidence: [
          { kind: "helix_theory_context_reflection_tool_receipt", satisfied: true, evidence_ref: receiptRef },
          { kind: "workstation_tool_evaluation", satisfied: true, evidence_ref: evaluationRef },
        ],
      },
      agent_runtime_loop: {
        schema: "helix.agent_runtime_loop.v1",
        iterations: [
          {
            iteration: 1,
            decision_id: `${turnId}:decision:reflect`,
            next_step: "tool",
            decision_authority: "llm",
            chosen_capability: "helix_ask.reflect_theory_context",
            executed_action_key: "helix_ask.reflect_theory_context",
            observed_artifact_refs: [receiptRef, evaluationRef],
          },
          {
            iteration: 2,
            decision_id: `${turnId}:decision:answer`,
            next_step: "answer",
            decision_timing: "post_observation_terminal_review",
            decision_authority: "llm",
            chosen_capability: "model.synthesize_from_theory_context_reflection",
            observed_artifact_refs: [receiptRef, evaluationRef],
            observation_role: "terminal_decision",
          },
        ],
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: artifacts,
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      selected_final_answer: "I could not complete that turn.",
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("theory_context_reflection_answer");
    expect(result.visible_text).toContain("Scientific evidence guard:");
    expect(result.visible_text).toContain("Evidence domain: weyl_bianchi; branch gate: restricted");
    expect(result.visible_text).toContain("False-friend branch refs: tokamak_thermal_pressure_payload");
    expect(result.visible_text).toContain("tokamak_thermal_pressure_payload");
    expect(result.visible_text).toContain("OCR/LaTeX candidates and graph matches are observation evidence, not proof");
    expect(payload.theory_context_reflection_answer).toMatchObject({
      schema: "helix.theory_context_reflection_answer.v1",
      support_refs: [receiptRef, evaluationRef],
      scientific_final_answer_guard: expect.objectContaining({
        primaryDomain: "weyl_bianchi",
        branchGateStatus: "restricted",
        falseFriendRefs: ["tokamak_thermal_pressure_payload"],
        mustDiscloseRejections: true,
      }),
    });
  });

  it("renders blocked scientific evidence as a blocker instead of a theory reflection answer", () => {
    const turnId = "ask:test:theory-reflection-scientific-blocker-answer";
    const receiptRef = `${turnId}:theory_context_reflection_tool_receipt`;
    const evaluationRef = `${turnId}:workstation_tool_evaluation`;
    const scientificBranchGate = {
      schema: "helix.scientific_branch_gate.v1",
      status: "blocked",
      primary_domain: "unknown_math",
      congruence_grade_floor: "insufficient_evidence",
      rejected_calculator_payload_ids: [
        "tokamak_thermal_pressure_payload",
        "tokamak_confinement_energy_payload",
      ],
      rejected_badge_ids: [],
      congruence_assessments: [
        {
          target_ref: "tokamak_thermal_pressure_payload",
          target_kind: "calculator_payload",
          grade: "insufficient_evidence",
          reasons: ["Explicit scientific evidence was not admissible for calculator handoff."],
          matched_symbols: [],
          blocked_by_branch_hint: true,
        },
      ],
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    const scientificRunTrace = {
      schema: "helix.scientific_run_trace.v1",
      trace_id: "scientific_run:test-failed-crop-blocked",
      primary_domain: "unknown_math",
      branch_gate_status: "blocked",
      congruence_grade_floor: "insufficient_evidence",
      rejected_calculator_payload_ids: [
        "tokamak_thermal_pressure_payload",
        "tokamak_confinement_energy_payload",
      ],
      rejected_badge_ids: [],
      final_answer_guard: {
        required_claim_boundary: "observation_ocr_graph_match_not_proof",
        must_disclose_uncertainty: true,
        must_disclose_rejections: true,
      },
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    const artifacts = [
      {
        artifact_id: receiptRef,
        kind: "helix_theory_context_reflection_tool_receipt",
        payload: {
          schema: "helix.theory_context_reflection_tool_receipt.v1",
          capability: "helix_ask.reflect_theory_context",
          tool_id: "helix_ask.reflect_theory_context",
          text: "Theory graph reflection observed nearby tokamak context.",
          observation: {
            schema: "helix.theory_context_reflection_observation.v1",
            scientific_branch_gate: scientificBranchGate,
            scientific_run_trace: scientificRunTrace,
          },
          assistant_answer: false,
          terminal_eligible: false,
        },
      },
      {
        artifact_id: evaluationRef,
        kind: "workstation_tool_evaluation",
        payload: {
          schema: "helix.workstation_tool_evaluation.v1",
          result: "supports_subgoal",
          capability: "theory_context_reflection",
          summary: "Theory reflection located nearby tokamak context that should not become answer authority.",
          evidence_refs: [receiptRef],
          observation: {
            scientific_branch_gate: scientificBranchGate,
            scientific_run_trace: scientificRunTrace,
          },
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      active_prompt: "Use the failed Image Lens equation crop before any theory badge or calculator answer.",
      route_product_contract: {
        ...modelOnlyContract(turnId),
        source_target: "theory_locator",
        allowed_terminal_artifact_kinds: ["theory_context_reflection_answer", "typed_failure", "request_user_input"],
        forbidden_terminal_artifact_kinds: ["workstation_tool_evaluation", "tool_receipt", "direct_answer_text"],
        side_artifact_kinds_allowed: ["helix_theory_context_reflection_tool_receipt", "workstation_tool_evaluation"],
      },
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "theory_context_reflection",
        required_terminal_kind: "theory_context_reflection_answer",
      },
      goal_satisfaction_evaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
        required_evidence: [
          { kind: "helix_theory_context_reflection_tool_receipt", satisfied: true, evidence_ref: receiptRef },
          { kind: "workstation_tool_evaluation", satisfied: true, evidence_ref: evaluationRef },
        ],
      },
      agent_runtime_loop: {
        schema: "helix.agent_runtime_loop.v1",
        iterations: [
          {
            iteration: 1,
            decision_id: `${turnId}:decision:reflect`,
            next_step: "tool",
            decision_authority: "llm",
            chosen_capability: "helix_ask.reflect_theory_context",
            executed_action_key: "helix_ask.reflect_theory_context",
            observed_artifact_refs: [receiptRef, evaluationRef],
          },
          {
            iteration: 2,
            decision_id: `${turnId}:decision:answer`,
            next_step: "answer",
            decision_timing: "post_observation_terminal_review",
            decision_authority: "llm",
            observed_artifact_refs: [receiptRef, evaluationRef],
            observation_role: "terminal_decision",
          },
        ],
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: artifacts,
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      selected_final_answer: "I could not complete that turn.",
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("theory_context_reflection_answer");
    expect(result.visible_text).toContain("Scientific evidence blocker:");
    expect(result.visible_text).toContain("branch gate: blocked");
    expect(result.visible_text).toContain("not admissible for exact graph mapping or calculator handoff");
    expect(result.visible_text).toContain("Suppressed graph/calculator refs: tokamak_thermal_pressure_payload");
    expect(result.visible_text).toContain("no nearby theory badge, analogy, or calculator template may be substituted");
    expect(result.visible_text).not.toContain("Theory reflection located nearby tokamak context");
    expect(payload.theory_context_reflection_answer).toMatchObject({
      schema: "helix.theory_context_reflection_answer.v1",
      support_refs: [receiptRef, evaluationRef],
      scientific_final_answer_guard: expect.objectContaining({
        primaryDomain: "unknown_math",
        branchGateStatus: "blocked",
        congruenceGradeFloor: "insufficient_evidence",
        mustDiscloseRejections: true,
      }),
    });
  });

  it("selects a later complete final draft over an earlier weak direct answer", () => {
    const turnId = "ask:test:later-draft-over-direct";
    const draftText = [
      "- Charge: electrons are negative, while protons are positive.",
      "- Mass: electrons are much lighter than protons.",
      "- Role in atoms: electrons occupy shells/clouds around the nucleus, while protons sit in the nucleus and define element identity.",
      "Practical consequence: opposite charges bind electrons to nuclei, enabling stable atoms and chemistry.",
    ].join("\n");
    const artifacts = [
      {
        artifact_id: `${turnId}:direct`,
        kind: "direct_answer_text",
        payload: {
          schema: "helix.direct_answer_text.v1",
          text: "An electron is a fundamental subatomic particle with a negative electric charge.",
        },
      },
      {
        artifact_id: `${turnId}:draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: draftText,
          authority: "llm_post_observation_composer",
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt: "Compare an electron and a proton in three ways: charge, mass, and role in atoms. Then give one practical consequence of those differences.",
      route_product_contract: modelOnlyContract(turnId),
      canonical_goal_frame: {
        goal_kind: "model_only_concept",
        required_terminal_kind: "direct_answer_text",
      },
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: "An electron is a fundamental subatomic particle with a negative electric charge.",
      final_answer_source: "model_direct_answer",
      terminal_artifact_kind: "direct_answer_text",
    };
    addModelOnlyRuntimeProof(payload);

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(result.visible_text).toBe(draftText);
    expect(result.integrity.selected_over_direct_answer_text).toBe(true);
    expect(result.rejected_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "direct_answer_text", reason: "later_valid_final_answer_draft" }),
      ]),
    );
    expect(payload.selected_final_answer).toBe(draftText);
    expect((payload.final_answer_draft_selection as Record<string, unknown>).selected_over_direct_answer_text).toBe(true);
  });

  it("keeps fail-closed compound coverage from being re-promoted by a final draft", () => {
    const turnId = "ask:test:compound-fail-closed-over-draft";
    const draftText = "This draft looks complete, but the compound coverage gate has already failed closed.";
    const artifacts = [
      {
        artifact_id: `${turnId}:draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: draftText,
          authority: "llm_post_observation_composer",
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt: "Answer two required parts.",
      route_product_contract: modelOnlyContract(turnId),
      canonical_goal_frame: {
        goal_kind: "model_only_concept",
        required_terminal_kind: "model_synthesized_answer",
      },
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: draftText,
      final_answer_source: "final_answer_draft",
      terminal_artifact_kind: "model_synthesized_answer",
      compound_prompt_coverage_gate: {
        schema: "helix.compound_prompt_coverage_gate.v1",
        applies: true,
        passed: false,
        decision: "FAIL_CLOSED",
        unresolved_requirement_ids: ["R2"],
        resolutions: [
          {
            requirement_id: "R1",
            status: "answered",
          },
          {
            requirement_id: "R2",
            status: "failed_closed",
          },
        ],
      },
      goal_satisfaction_evaluation: {
        satisfaction: "not_satisfied",
        next_decision: "fail_closed",
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(result.source).toBe("typed_failure");
    expect(result.visible_text).toContain("compound");
    expect(payload.ok).toBe(false);
    expect(payload.final_status).toBe("final_failure");
    expect(payload.terminal_artifact_kind).toBe("typed_failure");
    expect(payload.final_answer_source).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("compound_prompt_coverage_incomplete");
    expect(payload.selected_final_answer).not.toBe(draftText);
    expect(result.rejected_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "model_synthesized_answer",
          reason: "missing_required_observation",
        }),
      ]),
    );
  });

  it("uses the first incomplete compound subgoal rail as the terminal typed failure", () => {
    const turnId = "ask:test:compound-subgoal-rail-terminal-failure";
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      ok: true,
      response_type: "final_answer",
      final_status: "final_answer",
      status: "final_answer",
      selected_final_answer: "Stale compound draft.",
      final_answer_source: "final_answer_draft",
      terminal_artifact_kind: "model_synthesized_answer",
      compound_prompt_coverage_gate: {
        schema: "helix.compound_prompt_coverage_gate.v1",
        applies: true,
        passed: false,
        decision: "FAIL_CLOSED",
        unresolved_requirement_ids: ["calculator-subgoal"],
      },
      capability_itinerary_execution_state: {
        schema: "helix.capability_itinerary_execution_state.v1",
        applies: true,
        compound_subgoal_ledger: [
          {
            subgoal_id: "docs-subgoal",
            requested_capability: "docs-viewer.locate_in_doc",
            selected_capability: "docs-viewer.locate_in_doc",
            executed_capability: "docs-viewer.locate_in_doc",
            observation_ref: `${turnId}:docs-location`,
            satisfaction: "satisfied",
            rail_status: "complete",
            rail_failure_code: null,
          },
          {
            subgoal_id: "calculator-subgoal",
            requested_capability: "scientific-calculator.solve_expression",
            selected_capability: "scientific-calculator.solve_expression",
            executed_capability: null,
            observation_ref: null,
            satisfaction: "failed",
            rail_status: "fail_closed",
            rail_failure_code: "missing_required_arg:latex",
            first_broken_rail: "capability_execution",
            repair_target: "subgoal_argument_extraction",
          },
        ],
      },
      goal_satisfaction_evaluation: {
        satisfaction: "not_satisfied",
        next_decision: "fail_closed",
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: [],
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(payload.final_status).toBe("final_failure");
    expect(payload.terminal_error_code).toBe("missing_required_arg:latex");
    expect(payload.selected_final_answer).toContain("scientific-calculator.solve_expression");
    expect(payload.selected_final_answer).toContain("missing required argument latex");
    expect(payload.typed_failure).toMatchObject({
      error_code: "missing_required_arg:latex",
      compound_rail_failure_code: "missing_required_arg:latex",
      compound_first_broken_rail: "capability_execution",
      compound_repair_target: "subgoal_argument_extraction",
      first_incomplete_compound_subgoal_id: "calculator-subgoal",
    });
  });

  it("syncs public mirrors from typed-failure authority after stale final-draft projection", () => {
    const turnId = "ask:test:typed-failure-authority-public-mirror";
    const staleDraft = "This stale draft should not remain the public answer.";
    const failureText =
      "I could not complete this compound turn because required prompt items failed closed or remain unresolved: R2.";
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      ok: true,
      response_type: "final_answer",
      final_status: "final_answer",
      status: "final_answer",
      selected_final_answer: staleDraft,
      answer: staleDraft,
      text: staleDraft,
      assistant_answer: staleDraft,
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      terminal_error_code: "terminal_consistency_violation",
      compound_prompt_coverage_gate: {
        schema: "helix.compound_prompt_coverage_gate.v1",
        applies: true,
        passed: false,
        decision: "FAIL_CLOSED",
        unresolved_requirement_ids: ["R2"],
      },
      terminal_answer_authority: {
        schema: "helix.terminal_authority.v1",
        thread_id: "thread:test",
        turn_id: turnId,
        terminal_kind: "failure",
        terminal_artifact_kind: "typed_failure",
        final_answer_source: "typed_failure",
        terminal_text_preview: failureText,
        server_authoritative: true,
        assistant_answer: false,
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        turn_id: turnId,
        terminal_artifact_kind: "model_synthesized_answer",
        concise_text: staleDraft,
        assistant_answer: false,
        raw_content_included: false,
      },
      typed_failure: {
        schema: "helix.typed_failure.v1",
        error_code: "terminal_consistency_violation",
        text: "Old consistency failure.",
        answer_text: "Old consistency failure.",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: `${turnId}:terminal_consistency:typed_failure`,
          turn_id: turnId,
          kind: "typed_failure",
          payload: {
            schema: "helix.typed_failure.v1",
            error_code: "terminal_consistency_violation",
            text: "Old consistency failure.",
            answer_text: "Old consistency failure.",
          },
        },
      ],
      debug: {
        ok: true,
        response_type: "final_answer",
        final_status: "final_answer",
        terminal_artifact_kind: "model_synthesized_answer",
        final_answer_source: "final_answer_draft",
        terminal_error_code: "terminal_consistency_violation",
        selected_final_answer: staleDraft,
      },
    };

    expect(syncHelixTypedFailureAuthorityPublicMirrors(payload)).toBe(true);

    expect(payload.ok).toBe(false);
    expect(payload.response_type).toBe("final_failure");
    expect(payload.final_status).toBe("final_failure");
    expect(payload.terminal_artifact_kind).toBe("typed_failure");
    expect(payload.final_answer_source).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("compound_prompt_coverage_incomplete");
    expect(payload.selected_final_answer).toBe(failureText);
    expect(payload.answer).toBe(failureText);
    expect(payload.text).toBe(failureText);
    expect(payload.terminal_presentation).toMatchObject({
      terminal_artifact_kind: "typed_failure",
      concise_text: failureText,
    });
    expect(payload.typed_failure).toMatchObject({
      error_code: "compound_prompt_coverage_incomplete",
      text: failureText,
      answer_text: failureText,
    });
    expect(payload.debug).toMatchObject({
      ok: false,
      response_type: "final_failure",
      final_status: "final_failure",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "compound_prompt_coverage_incomplete",
      selected_final_answer: failureText,
    });
    expect(JSON.stringify(payload.current_turn_artifact_ledger)).not.toContain("terminal_consistency_violation");
  });

  it("syncs public mirrors to the exact compound subgoal rail failure when authority is typed failure", () => {
    const turnId = "ask:test:typed-failure-authority-subgoal-rail-public-mirror";
    const staleDraft = "This stale draft should not remain the public answer.";
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      ok: true,
      response_type: "final_answer",
      final_status: "final_answer",
      status: "final_answer",
      selected_final_answer: staleDraft,
      answer: staleDraft,
      text: staleDraft,
      assistant_answer: staleDraft,
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      terminal_error_code: "terminal_consistency_violation",
      compound_prompt_coverage_gate: {
        schema: "helix.compound_prompt_coverage_gate.v1",
        applies: true,
        passed: false,
        decision: "FAIL_CLOSED",
        unresolved_requirement_ids: ["calculator-subgoal"],
      },
      capability_itinerary_execution_state: {
        schema: "helix.capability_itinerary_execution_state.v1",
        applies: true,
        compound_subgoal_ledger: [
          {
            subgoal_id: "calculator-subgoal",
            requested_capability: "scientific-calculator.solve_expression",
            selected_capability: "scientific-calculator.solve_expression",
            executed_capability: null,
            observation_ref: null,
            satisfaction: "failed",
            rail_status: "fail_closed",
            rail_failure_code: "invalid_arg:latex_is_prose",
            first_broken_rail: "capability_execution",
            repair_target: "subgoal_argument_extraction",
          },
        ],
      },
      terminal_answer_authority: {
        schema: "helix.terminal_authority.v1",
        thread_id: "thread:test",
        turn_id: turnId,
        terminal_kind: "failure",
        terminal_artifact_kind: "typed_failure",
        final_answer_source: "typed_failure",
        terminal_text_preview: "Old consistency failure.",
        server_authoritative: true,
        assistant_answer: false,
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        turn_id: turnId,
        terminal_artifact_kind: "model_synthesized_answer",
        concise_text: staleDraft,
        assistant_answer: false,
        raw_content_included: false,
      },
      typed_failure: {
        schema: "helix.typed_failure.v1",
        error_code: "terminal_consistency_violation",
        text: "Old consistency failure.",
        answer_text: "Old consistency failure.",
      },
      debug: {
        ok: true,
        response_type: "final_answer",
        final_status: "final_answer",
        terminal_artifact_kind: "model_synthesized_answer",
        final_answer_source: "final_answer_draft",
        terminal_error_code: "terminal_consistency_violation",
        selected_final_answer: staleDraft,
      },
    };

    expect(syncHelixTypedFailureAuthorityPublicMirrors(payload)).toBe(true);

    expect(payload.ok).toBe(false);
    expect(payload.response_type).toBe("final_failure");
    expect(payload.final_status).toBe("final_failure");
    expect(payload.terminal_artifact_kind).toBe("typed_failure");
    expect(payload.final_answer_source).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("invalid_arg:latex_is_prose");
    expect(payload.selected_final_answer).toContain("scientific-calculator.solve_expression");
    expect(payload.selected_final_answer).toContain("invalid argument latex_is_prose");
    expect(payload.typed_failure).toMatchObject({
      error_code: "invalid_arg:latex_is_prose",
      compound_rail_failure_code: "invalid_arg:latex_is_prose",
      compound_first_broken_rail: "capability_execution",
      compound_repair_target: "subgoal_argument_extraction",
      first_incomplete_compound_subgoal_id: "calculator-subgoal",
    });
    expect(payload.debug).toMatchObject({
      ok: false,
      response_type: "final_failure",
      final_status: "final_failure",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "invalid_arg:latex_is_prose",
    });
  });

  it("localizes typed failure public mirrors from the Ask language contract", () => {
    const turnId = "ask:test:localized-typed-failure";
    const localizedFailure = "No pude producir una respuesta terminal para este turno.";
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      language_contract: {
        schema: "helix.ask_language_contract.v1",
        input_modality: "typed",
        source_text:
          "Explain Helix Ask final answer language, pero responde en espaÃ±ol y usa evidencia del cÃ³digo.",
        source_language: "mixed",
        dominant_language: "mixed",
        requested_response_language: "es",
        explicit_response_language: "es",
        response_language: "es",
        language_detected: "mixed",
        language_confidence: 0.82,
        code_mixed: true,
        explicit_language_instruction: true,
        pivot_language: null,
        pivot_text: null,
        pivot_confidence: null,
        translated: false,
        reason_codes: ["explicit_spanish_response_instruction", "mixed_prompt"],
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        turn_id: turnId,
        terminal_kind: "failure",
        terminal_artifact_kind: "typed_failure",
        final_answer_source: "typed_failure",
        terminal_text_preview: "I could not produce a terminal answer for this turn.",
        server_authoritative: true,
        assistant_answer: false,
      },
      typed_failure: {
        schema: "helix.typed_failure.v1",
        error_code: "repo_evidence_relevance_failed",
        text: "I could not produce a terminal answer for this turn.",
        answer_text: "I could not produce a terminal answer for this turn.",
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        turn_id: turnId,
        terminal_artifact_kind: "typed_failure",
        concise_text: "I could not produce a terminal answer for this turn.",
      },
      debug: {},
    };

    expect(syncHelixTypedFailureAuthorityPublicMirrors(payload)).toBe(true);
    expect(payload.selected_final_answer).toBe(localizedFailure);
    expect(payload.answer).toBe(localizedFailure);
    expect(payload.text).toBe(localizedFailure);
    expect(payload.typed_failure).toMatchObject({
      message: localizedFailure,
      text: localizedFailure,
      answer_text: localizedFailure,
    });
    expect(payload.terminal_presentation).toMatchObject({
      concise_text: localizedFailure,
    });
    expect(payload.debug).toMatchObject({
      selected_final_answer: localizedFailure,
      answer: localizedFailure,
    });
  });

  it("blocks unsupported live-source mail drafts as source-backed synthesis", () => {
    const turnId = "ask:test:live-source-mail-unsupported-draft";
    const draftText = "The live-source mailbox looks healthy and no more action is needed.";
    const artifacts = [
      {
        artifact_id: `${turnId}:draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: draftText,
          authority: "llm_post_observation_composer",
          model_step_capability: "model.synthesize_from_live_source_mail",
          artifact_refs: [],
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      route_product_contract: liveSourceMailContract(turnId),
      canonical_goal_frame: {
        goal_kind: "live_source_mailbox_review",
        required_terminal_kind: "model_synthesized_answer",
      },
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: "I could not produce a terminal answer for this turn.",
      final_answer_source: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      terminal_error_code: "missing_allowed_terminal_artifact",
    };
    const gate = evaluateFinalAnswerDraftQualityGate({
      turnId,
      finalAnswerDraftRef: `${turnId}:draft`,
      draftText,
      draftPayload: artifacts[0]?.payload,
      routeProductContract: liveSourceMailContract(turnId),
      payload,
      artifactLedger: artifacts,
    });

    expect(gate.route_family).toBe("live_source_mail");
    expect(gate.violations).toContain("missing_support_refs_for_source_route");

    const materialized = materializeFinalAnswerDraftTerminal({
      turnId,
      payload,
      artifactLedger: artifacts,
      routeProductContract: liveSourceMailContract(turnId),
    });

    expect(materialized?.ok).toBe(false);
    expect(materialized?.blocked_reason).toBe("source_support_refs_missing");
    expect(payload.model_synthesized_answer).toBeUndefined();
  });

  it("recognizes support refs carried by a materialized provider route product", () => {
    const turnId = "ask:test:provider-route-product-support";
    const supportRef = `${turnId}:prior_environment_probe_evidence:verified`;
    const draftPayload = {
      schema: "helix.provider_route_product.v1",
      turn_id: turnId,
      kind: "model_synthesized_answer",
      text: "The target is visible and nearby, but path viability remains unproven.",
      support_refs: [supportRef],
      selected_observation_refs: [supportRef],
    };
    const gate = evaluateFinalAnswerDraftQualityGate({
      turnId,
      finalAnswerDraftRef: `${turnId}:model_synthesized_answer`,
      draftText: draftPayload.text,
      draftPayload,
      routeProductContract: {
        schema: "helix.route_product_contract.v1",
        turn_id: turnId,
        source_target: "world_event",
        required_terminal_kind: "model_synthesized_answer",
        allowed_terminal_artifact_kinds: [
          "model_synthesized_answer",
          "typed_failure",
        ],
      },
      payload: {
        turn_id: turnId,
        committed_ask_route: {
          route: { source_target: "world_event" },
          canonical_goal: {
            goal_kind: "environment_evidence_synthesis",
            required_terminal_kind: "model_synthesized_answer",
          },
        },
      },
      artifactLedger: [],
    });

    expect(gate.route_family).toBe("situation_room");
    expect(gate.violations).not.toContain(
      "missing_support_refs_for_source_route",
    );
    expect(gate.ok).toBe(true);
  });

  it("blocks result-only docs plus calculator drafts when the prompt asks to explain the connection", () => {
    const turnId = "ask:test:docs-calculator-result-only-connection";
    const docRef = `${turnId}:doc_location_matches`;
    const calculatorRef = `${turnId}:calculator_receipt`;
    const draftRef = `${turnId}:draft`;
    const prompt =
      "Use docs-viewer.locate_in_doc to cite the claim, then call scientific-calculator.solve_expression with expression 19+23, and explain the connection.";
    const artifacts = [
      {
        artifact_id: `${turnId}:execution_state`,
        kind: "capability_itinerary_execution_state",
        payload: {
          schema: "helix.capability_itinerary_execution_state.v1",
          complete: true,
          compound_subgoal_ledger: [
            {
              requested_capability: "docs-viewer.locate_in_doc",
              executed_capability: "docs-viewer.locate_in_doc",
              capability_family: "docs_viewer",
              observation_kind: "doc_location_matches",
              observation_ref: docRef,
              satisfaction: "satisfied",
              rail_status: "complete",
            },
            {
              requested_capability: "scientific-calculator.solve_expression",
              executed_capability: "scientific-calculator.solve_expression",
              capability_family: "calculator",
              observation_kind: "calculator_receipt",
              observation_ref: calculatorRef,
              satisfaction: "satisfied",
              rail_status: "complete",
            },
          ],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: docRef,
        kind: "doc_location_matches",
        payload: {
          schema: "helix.doc_location_matches.v1",
          matches: [
            {
              path: "/docs/helix-ask-codex-loop-discipline.md",
              line_start: 196,
              line_end: 203,
              heading: "Rule of thumb",
            },
          ],
        },
      },
      {
        artifact_id: calculatorRef,
        kind: "calculator_receipt",
        payload: {
          schema: "helix.calculator_receipt.v1",
          expression: "19+23",
          result: "42",
        },
      },
      {
        artifact_id: draftRef,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: "Result: 42.",
          prompt,
          authority: "llm_post_observation_compound_synthesis",
          model_step_capability: "model.synthesize_from_compound_subgoal_observations",
          support_refs: [docRef, calculatorRef],
          artifact_refs: [docRef, calculatorRef],
          grounded_in_observation_refs: [docRef, calculatorRef],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt: prompt,
      route_product_contract: docsEvidenceContract(turnId),
      canonical_goal_frame: {
        goal_kind: "doc_evidence_synthesis",
        required_terminal_kind: "doc_evidence_synthesis_answer",
      },
      capability_itinerary_execution_state: artifacts[0]?.payload,
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: "Result: 42.",
      final_answer_source: "final_answer_draft",
      terminal_artifact_kind: "model_synthesized_answer",
    };

    const gate = evaluateFinalAnswerDraftQualityGate({
      turnId,
      finalAnswerDraftRef: draftRef,
      draftText: "Result: 42.",
      draftPayload: artifacts[3]?.payload,
      promptText: prompt,
      routeProductContract: docsEvidenceContract(turnId),
      payload,
      artifactLedger: artifacts,
    });
    expect(gate.violations).toContain("generic_answer_for_compound_prompt");

    const materialized = materializeFinalAnswerDraftTerminal({
      turnId,
      payload,
      artifactLedger: artifacts,
      routeProductContract: docsEvidenceContract(turnId),
    });

    expect(materialized?.ok).toBe(false);
    expect(materialized?.blocked_reason).toBe("draft_missing_required_prompt_parts");
    expect(payload.doc_evidence_synthesis_answer).toBeUndefined();
  });

  it("allows docs plus calculator connection drafts that explain both evidence and calculation", () => {
    const turnId = "ask:test:docs-calculator-connection-covered";
    const docRef = `${turnId}:doc_location_matches`;
    const calculatorRef = `${turnId}:calculator_receipt`;
    const prompt =
      "Use docs-viewer.locate_in_doc to cite the claim, then call scientific-calculator.solve_expression with expression 19+23, and explain the connection.";
    const draftText =
      "The document evidence locates the rule-of-thumb claim, and the calculator expression 19+23 evaluates to 42. The connection is that the cited rule provides the policy context while the calculation gives the numeric check used in the explanation.";
    const artifacts = [
      {
        artifact_id: `${turnId}:execution_state`,
        kind: "capability_itinerary_execution_state",
        payload: {
          schema: "helix.capability_itinerary_execution_state.v1",
          complete: true,
          compound_subgoal_ledger: [
            {
              requested_capability: "docs-viewer.locate_in_doc",
              executed_capability: "docs-viewer.locate_in_doc",
              capability_family: "docs_viewer",
              observation_kind: "doc_location_matches",
              observation_ref: docRef,
              satisfaction: "satisfied",
              rail_status: "complete",
            },
            {
              requested_capability: "scientific-calculator.solve_expression",
              executed_capability: "scientific-calculator.solve_expression",
              capability_family: "calculator",
              observation_kind: "calculator_receipt",
              observation_ref: calculatorRef,
              satisfaction: "satisfied",
              rail_status: "complete",
            },
          ],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: docRef,
        kind: "doc_location_matches",
        payload: {
          schema: "helix.doc_location_matches.v1",
          matches: [
            {
              path: "/docs/helix-ask-codex-loop-discipline.md",
              line_start: 196,
              line_end: 203,
              heading: "Rule of thumb",
            },
          ],
        },
      },
      {
        artifact_id: calculatorRef,
        kind: "calculator_receipt",
        payload: {
          schema: "helix.calculator_receipt.v1",
          expression: "19+23",
          result: "42",
        },
      },
      {
        artifact_id: `${turnId}:draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: draftText,
          prompt,
          authority: "llm_post_observation_compound_synthesis",
          model_step_capability: "model.synthesize_from_compound_subgoal_observations",
          support_refs: [docRef, calculatorRef],
          artifact_refs: [docRef, calculatorRef],
          grounded_in_observation_refs: [docRef, calculatorRef],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];
    const gate = evaluateFinalAnswerDraftQualityGate({
      turnId,
      finalAnswerDraftRef: `${turnId}:draft`,
      draftText,
      draftPayload: artifacts[3]?.payload,
      promptText: prompt,
      routeProductContract: docsEvidenceContract(turnId),
      payload: {
        turn_id: turnId,
        active_prompt: prompt,
        route_product_contract: docsEvidenceContract(turnId),
        capability_itinerary_execution_state: artifacts[0]?.payload,
        current_turn_artifact_ledger: artifacts,
      },
      artifactLedger: artifacts,
    });

    expect(gate.ok).toBe(true);
    expect(gate.violations).not.toContain("generic_answer_for_compound_prompt");
  });

  it("materializes a supported repo draft into repo_code_evidence_answer", () => {
    const turnId = "ask:test:repo-draft-materialized";
    const draftText = "Helix Ask treats receipts as observations, while final answers must be model-authored synthesis selected by terminal authority.";
    const artifacts = [
      {
        artifact_id: `${turnId}:repo_obs`,
        kind: "repo_code_evidence_observation",
        payload: {
          schema: "helix.repo_code_evidence_observation.v1",
          evidence_refs: ["docs/helix-ask-codex-loop-discipline.md"],
          spans: [{ ref: "docs/helix-ask-codex-loop-discipline.md:1" }],
        },
      },
      {
        artifact_id: `${turnId}:synthesis_attempt`,
        kind: "repo_evidence_synthesis_attempt",
        payload: {
          schema: "helix.repo_evidence_synthesis_attempt.v1",
          model_step_capability: "model.synthesize_from_repo_evidence",
        },
      },
      {
        artifact_id: `${turnId}:draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: draftText,
          authority: "llm_post_observation_composer",
          model_step_capability: "model.synthesize_from_repo_evidence",
          artifact_refs: [`${turnId}:repo_obs`],
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      route_product_contract: repoContract(turnId),
      canonical_goal_frame: {
        goal_kind: "repo_entity_definition",
        required_terminal_kind: "repo_code_evidence_answer",
      },
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: "I could not produce a terminal answer for this turn.",
      final_answer_source: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      terminal_error_code: "missing_allowed_terminal_artifact",
    };
    addRepoRuntimeProof(payload, `${turnId}:repo_obs`);

    const materialized = materializeFinalAnswerDraftTerminal({
      turnId,
      payload,
      artifactLedger: artifacts,
      routeProductContract: repoContract(turnId),
    });

    expect(materialized?.ok).toBe(true);
    expect(materialized?.materialized_terminal_artifact_kind).toBe("repo_code_evidence_answer");
    expect(payload.repo_code_evidence_answer).toMatchObject({
      schema: "helix.repo_code_evidence_answer.v1",
      text: draftText,
      model_authored: true,
    });

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("repo_code_evidence_answer");
    expect(result.visible_text).toBe(draftText);
    expect(payload.terminal_error_code).toBeUndefined();
    expect(payload.repo_answer_text_quality_gate).toMatchObject({ ok: true });
  });

  it("materializes compound drafts from ledger-only itinerary execution state", () => {
    const turnId = "ask:test:compound-draft-ledger-only-execution-state";
    const workspaceSubgoalId = `${turnId}:compound_capability_subgoal:1:workspace_os_status`;
    const calculatorSubgoalId = `${turnId}:compound_capability_subgoal:2:scientific-calculator_solve_expression`;
    const workspaceObservationRef = `${turnId}:workspace_os_status_observation`;
    const calculatorObservationRef = `${turnId}:calculator_receipt`;
    const draftText = "Workspace status was inspected, and the calculator result was 45.";
    const artifacts = [
      {
        artifact_id: `${turnId}:compound_capability_contract`,
        kind: "compound_capability_contract",
        payload: {
          schema: "helix.compound_capability_contract.v1",
          turn_id: turnId,
          prompt_shape: "compound_capability",
          requires_all_subgoals: true,
          terminal_policy: "synthesize_from_satisfied_subgoal_observations",
          subgoals: [
            {
              subgoal_id: workspaceSubgoalId,
              order: 1,
              requested_capability: "workspace_os.status",
              runtime_capability: "workspace_os.status",
              capability_family: "workspace_diagnostic",
              required_observation_kinds: ["workspace_os_status_observation"],
              required_terminal_kind: "model_synthesized_answer",
              mandatory: true,
            },
            {
              subgoal_id: calculatorSubgoalId,
              order: 2,
              requested_capability: "scientific-calculator.solve_expression",
              runtime_capability: "scientific-calculator.solve_expression",
              capability_family: "calculator",
              required_observation_kinds: ["calculator_receipt", "workstation_tool_evaluation"],
              required_terminal_kind: "workstation_tool_evaluation",
              mandatory: true,
            },
          ],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: `${turnId}:capability_itinerary_execution_state`,
        kind: "capability_itinerary_execution_state",
        payload: {
          schema: "helix.capability_itinerary_execution_state.v1",
          turn_id: turnId,
          applies: true,
          complete: true,
          required_observation_families: ["workspace_diagnostic", "calculator"],
          missing_observation_families: [],
          missing_compound_subgoal_ids: [],
          missing_required_capabilities: [],
          compound_subgoal_ledger: [
            {
              subgoal_id: workspaceSubgoalId,
              order: 1,
              requested_capability: "workspace_os.status",
              runtime_capability: "workspace_os.status",
              selected_capability: "workspace_os.status",
              executed_capability: "workspace_os.status",
              capability_family: "workspace_diagnostic",
              observation_kind: "workspace_os_status_observation",
              observation_ref: workspaceObservationRef,
              satisfaction: "satisfied",
              rail_status: "complete",
            },
            {
              subgoal_id: calculatorSubgoalId,
              order: 2,
              requested_capability: "scientific-calculator.solve_expression",
              runtime_capability: "scientific-calculator.solve_expression",
              selected_capability: "scientific-calculator.solve_expression",
              executed_capability: "scientific-calculator.solve_expression",
              capability_family: "calculator",
              observation_kind: "calculator_receipt",
              observation_ref: calculatorObservationRef,
              satisfaction: "satisfied",
              rail_status: "complete",
            },
          ],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: workspaceObservationRef,
        kind: "workspace_os_status_observation",
        payload: {
          schema: "helix.workspace_os_status_observation.v1",
          capability_key: "workspace_os.status",
          compound_subgoal_id: workspaceSubgoalId,
        },
      },
      {
        artifact_id: calculatorObservationRef,
        kind: "calculator_receipt",
        payload: {
          schema: "helix.calculator_receipt.v1",
          capability_key: "scientific-calculator.solve_expression",
          compound_subgoal_id: calculatorSubgoalId,
          result: "45",
          expression: "5*9",
        },
      },
      {
        artifact_id: `${turnId}:draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: draftText,
          authority: "llm_post_observation_compound_synthesis",
          model_step_capability: "model.synthesize_from_compound_subgoal_observations",
          support_refs: [workspaceObservationRef, calculatorObservationRef],
          artifact_refs: [workspaceObservationRef, calculatorObservationRef],
          grounded_in_observation_refs: [workspaceObservationRef, calculatorObservationRef],
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      route_product_contract: modelOnlyContract(turnId),
      canonical_goal_frame: {
        goal_kind: "compound_tool",
        required_terminal_kind: "model_synthesized_answer",
      },
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: draftText,
      final_answer_source: "final_answer_draft",
      terminal_artifact_kind: "model_synthesized_answer",
      compound_subgoal_missing_summary: {
        schema: "helix.compound_subgoal_missing_summary.v1",
        missing_required_capabilities: ["scholarly_research"],
        missing_compound_subgoal_ids: [],
        assistant_answer: false,
        raw_content_included: false,
      },
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
    };

    const materialized = materializeFinalAnswerDraftTerminal({
      turnId,
      payload,
      artifactLedger: artifacts,
      routeProductContract: modelOnlyContract(turnId),
    });

    expect(materialized?.ok).toBe(true);
    expect(materialized?.materialized_terminal_artifact_kind).toBe("compound_evidence_synthesis_answer");
    expect(payload.compound_evidence_synthesis_answer).toMatchObject({
      schema: "helix.compound_evidence_synthesis_answer.v1",
      answer_text: draftText,
      subgoal_observation_refs: [workspaceObservationRef, calculatorObservationRef],
      subgoal_observation_refs_count: 2,
      source_families: ["workspace_diagnostic", "calculator"],
      model_step_capability: "model.synthesize_from_compound_subgoal_observations",
    });
  });

  it("mirrors selected compound synthesis support refs after terminal authority", () => {
    const turnId = "ask:test:compound-support-mirror";
    const workspaceSubgoalId = `${turnId}:subgoal:workspace`;
    const calculatorSubgoalId = `${turnId}:subgoal:calculator`;
    const workspaceObservationRef = "obs:workspace-status";
    const calculatorObservationRef = "obs:calculator";
    const draftText = "The workspace status is available, and the calculator result is 45.";
    const artifacts = [
      {
        artifact_id: `${turnId}:compound_contract`,
        kind: "compound_capability_contract",
        payload: {
          schema: "helix.compound_capability_contract.v1",
          turn_id: turnId,
          terminal_policy: "synthesize_from_satisfied_subgoal_observations",
          subgoals: [
            {
              subgoal_id: workspaceSubgoalId,
              order: 1,
              requested_capability: "workspace_os.status",
              runtime_capability: "workspace_os.status",
              capability_family: "workspace_diagnostic",
              mandatory: true,
            },
            {
              subgoal_id: calculatorSubgoalId,
              order: 2,
              requested_capability: "scientific-calculator.solve_expression",
              runtime_capability: "scientific-calculator.solve_expression",
              capability_family: "calculator",
              mandatory: true,
            },
          ],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: `${turnId}:execution_state`,
        kind: "capability_itinerary_execution_state",
        payload: {
          schema: "helix.capability_itinerary_execution_state.v1",
          turn_id: turnId,
          applies: true,
          complete: true,
          compound_subgoal_ledger: [
            {
              subgoal_id: workspaceSubgoalId,
              order: 1,
              requested_capability: "workspace_os.status",
              runtime_capability: "workspace_os.status",
              selected_capability: "workspace_os.status",
              executed_capability: "workspace_os.status",
              capability_family: "workspace_diagnostic",
              observation_kind: "workspace_os_status_observation",
              observation_ref: workspaceObservationRef,
              satisfaction: "satisfied",
              rail_status: "complete",
            },
            {
              subgoal_id: calculatorSubgoalId,
              order: 2,
              requested_capability: "scientific-calculator.solve_expression",
              runtime_capability: "scientific-calculator.solve_expression",
              selected_capability: "scientific-calculator.solve_expression",
              executed_capability: "scientific-calculator.solve_expression",
              capability_family: "calculator",
              observation_kind: "calculator_receipt",
              observation_ref: calculatorObservationRef,
              satisfaction: "satisfied",
              rail_status: "complete",
            },
          ],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: workspaceObservationRef,
        kind: "workspace_os_status_observation",
        payload: { schema: "helix.workspace_os_status_observation.v1" },
      },
      {
        artifact_id: calculatorObservationRef,
        kind: "calculator_receipt",
        payload: { schema: "helix.calculator_receipt.v1", result: "45" },
      },
      {
        artifact_id: `${turnId}:draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          turn_id: turnId,
          text: draftText,
          answer_text: draftText,
          authority: "llm_post_observation_compound_synthesis",
          model_step_capability: "model.synthesize_from_compound_subgoal_observations",
          support_refs: [workspaceObservationRef, calculatorObservationRef],
          artifact_refs: [workspaceObservationRef, calculatorObservationRef],
          grounded_in_observation_refs: [workspaceObservationRef, calculatorObservationRef],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      route_product_contract: modelOnlyContract(turnId),
      canonical_goal_frame: {
        goal_kind: "compound_tool",
        required_terminal_kind: "model_synthesized_answer",
      },
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: draftText,
      final_answer_source: "final_answer_draft",
      terminal_artifact_kind: "model_synthesized_answer",
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      debug: {
        selected_final_answer: "stale draft",
        final_answer_source: "model_synthesized_answer",
        terminal_artifact_kind: "model_synthesized_answer",
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("compound_evidence_synthesis_answer");
    expect(result.selected_terminal_support_refs).toEqual([workspaceObservationRef, calculatorObservationRef]);
    expect(payload.route_terminal_materialization).toMatchObject({
      materialization_ok: true,
      capability_itinerary_observation_missing_families: [],
      raw_capability_itinerary_observation_missing_families: expect.any(Array),
      compound_synthesis_readiness_complete: true,
    });
    expect(result.selected_terminal_subgoal_observation_refs).toEqual([workspaceObservationRef, calculatorObservationRef]);
    expect(result.selected_terminal_source_families).toEqual(["workspace_diagnostic", "calculator"]);
    expect(payload.selected_terminal_support_refs).toEqual([workspaceObservationRef, calculatorObservationRef]);
    expect(payload.terminal_synthesis_support_refs).toEqual([workspaceObservationRef, calculatorObservationRef]);
    expect(payload.selected_terminal_subgoal_observation_refs).toEqual([workspaceObservationRef, calculatorObservationRef]);
    expect(payload.compound_evidence_synthesis_answer).toMatchObject({
      support_refs: [workspaceObservationRef, calculatorObservationRef],
      subgoal_observation_refs: [workspaceObservationRef, calculatorObservationRef],
    });
    const debug = payload.debug as Record<string, unknown>;
    expect(debug.terminal_artifact_kind).toBe("compound_evidence_synthesis_answer");
    expect(debug.selected_terminal_support_refs).toEqual([workspaceObservationRef, calculatorObservationRef]);
    expect(debug.terminal_synthesis_support_refs).toEqual([workspaceObservationRef, calculatorObservationRef]);
    expect(debug.selected_terminal_subgoal_observation_refs).toEqual([workspaceObservationRef, calculatorObservationRef]);
    expect(debug.compound_evidence_synthesis_answer).toMatchObject({
      support_refs: [workspaceObservationRef, calculatorObservationRef],
      subgoal_observation_refs: [workspaceObservationRef, calculatorObservationRef],
    });
  });

  it("materializes a ledger-backed compound terminal when completed subgoals lack a final draft", () => {
    const turnId = "ask:test:compound-ledger-backed-no-draft";
    const docsSubgoalId = `${turnId}:subgoal:docs`;
    const calculatorSubgoalId = `${turnId}:subgoal:calculator`;
    const docObservationRef = `${turnId}:doc_location_matches`;
    const calculatorObservationRef = `${turnId}:calculator_receipt`;
    const artifacts = [
      {
        artifact_id: `${turnId}:compound_contract`,
        kind: "compound_capability_contract",
        payload: {
          schema: "helix.compound_capability_contract.v1",
          turn_id: turnId,
          prompt_shape: "compound_capability",
          requires_all_subgoals: true,
          terminal_policy: "synthesize_from_satisfied_subgoal_observations",
          subgoals: [
            {
              subgoal_id: docsSubgoalId,
              order: 1,
              requested_capability: "docs-viewer.locate_in_doc",
              runtime_capability: "docs-viewer.locate_in_doc",
              capability_family: "docs_viewer",
              required_observation_kinds: ["doc_location_matches"],
              required_terminal_kind: "doc_location_matches",
              mandatory: true,
            },
            {
              subgoal_id: calculatorSubgoalId,
              order: 2,
              requested_capability: "scientific-calculator.solve_expression",
              runtime_capability: "scientific-calculator.solve_expression",
              capability_family: "calculator",
              required_observation_kinds: ["calculator_receipt", "workstation_tool_evaluation"],
              required_terminal_kind: "workstation_tool_evaluation",
              mandatory: true,
            },
          ],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: `${turnId}:execution_state`,
        kind: "capability_itinerary_execution_state",
        payload: {
          schema: "helix.capability_itinerary_execution_state.v1",
          turn_id: turnId,
          applies: true,
          complete: true,
          required_observation_families: ["docs_viewer", "calculator"],
          missing_observation_families: [],
          missing_compound_subgoal_ids: [],
          missing_required_capabilities: [],
          compound_subgoal_ledger: [
            {
              subgoal_id: docsSubgoalId,
              order: 1,
              requested_capability: "docs-viewer.locate_in_doc",
              runtime_capability: "docs-viewer.locate_in_doc",
              selected_capability: "docs-viewer.locate_in_doc",
              executed_capability: "docs-viewer.locate_in_doc",
              capability_family: "docs_viewer",
              observation_kind: "doc_location_matches",
              observation_ref: docObservationRef,
              satisfaction: "satisfied",
              rail_status: "complete",
            },
            {
              subgoal_id: calculatorSubgoalId,
              order: 2,
              requested_capability: "scientific-calculator.solve_expression",
              runtime_capability: "scientific-calculator.solve_expression",
              selected_capability: "scientific-calculator.solve_expression",
              executed_capability: "scientific-calculator.solve_expression",
              capability_family: "calculator",
              observation_kind: "calculator_receipt",
              observation_ref: calculatorObservationRef,
              satisfaction: "satisfied",
              rail_status: "complete",
            },
          ],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: docObservationRef,
        kind: "doc_location_matches",
        payload: {
          schema: "helix.doc_location_matches.v1",
          matches: [
            {
              path: "docs/audits/research/helix-ask-codex-parity-model-turn-fidelity-audit-2026-06-12.md",
              line_start: 196,
              snippet: "Only the completed solver path may answer. The visible answer must project the same terminal artifact selected by terminal authority.",
            },
          ],
        },
      },
      {
        artifact_id: calculatorObservationRef,
        kind: "calculator_receipt",
        payload: {
          schema: "helix.calculator_receipt.v1",
          expression: "((sqrt(81)+ln(e^3))*7-5^2)/2",
          result: "29.5",
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      canonical_goal_frame: {
        goal_kind: "locate_in_doc",
        required_terminal_kind: "doc_location_matches",
      },
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: "I could not produce a terminal answer for this turn.",
      final_answer_source: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      terminal_error_code: "pending_request_missing",
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      tool_rail_failure_triage: {
        rail_status: "broken",
        rail_failure_code: "terminal_not_materialized",
        first_broken_rail: "terminal_materialization",
        repair_target: "terminal_materializer",
      },
      debug: {},
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      payload,
      artifactLedger: artifacts,
    });

    expect(payload.ledger_backed_compound_final_answer_draft_applied).toBe(true);
    expect(["doc_evidence_synthesis_answer", "compound_evidence_synthesis_answer"]).toContain(
      result.selected_terminal_artifact_kind,
    );
    expect(result.source).toBe("final_answer_draft");
    expect(result.visible_text).toContain("Document evidence");
    expect(result.visible_text).toContain("Calculator observation");
    expect(result.visible_text).toContain("Connection:");
    expect(payload.terminal_error_code).toBeUndefined();
    expect(payload.selected_terminal_support_refs).toEqual(
      expect.arrayContaining([docObservationRef, calculatorObservationRef]),
    );
    expect(payload.selected_terminal_subgoal_observation_refs).toEqual(
      expect.arrayContaining([docObservationRef, calculatorObservationRef]),
    );
  });

  it("fails compound synthesis when draft support refs omit a mandatory subgoal observation", () => {
    const turnId = "ask:test:compound-support-missing-fails-typed";
    const workspaceSubgoalId = `${turnId}:subgoal:workspace`;
    const calculatorSubgoalId = `${turnId}:subgoal:calculator`;
    const workspaceObservationRef = "obs:workspace-status";
    const calculatorObservationRef = "obs:calculator";
    const draftText = "The workspace status is available, and a calculation was requested.";
    const artifacts = [
      {
        artifact_id: `${turnId}:compound_contract`,
        kind: "compound_capability_contract",
        payload: {
          schema: "helix.compound_capability_contract.v1",
          turn_id: turnId,
          terminal_policy: "synthesize_from_satisfied_subgoal_observations",
          subgoals: [
            {
              subgoal_id: workspaceSubgoalId,
              order: 1,
              requested_capability: "workspace_os.status",
              runtime_capability: "workspace_os.status",
              capability_family: "workspace_diagnostic",
              mandatory: true,
            },
            {
              subgoal_id: calculatorSubgoalId,
              order: 2,
              requested_capability: "scientific-calculator.solve_expression",
              runtime_capability: "scientific-calculator.solve_expression",
              capability_family: "calculator",
              mandatory: true,
            },
          ],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: `${turnId}:execution_state`,
        kind: "capability_itinerary_execution_state",
        payload: {
          schema: "helix.capability_itinerary_execution_state.v1",
          turn_id: turnId,
          applies: true,
          complete: true,
          compound_subgoal_ledger: [
            {
              subgoal_id: workspaceSubgoalId,
              requested_capability: "workspace_os.status",
              executed_capability: "workspace_os.status",
              capability_family: "workspace_diagnostic",
              observation_kind: "workspace_os_status_observation",
              observation_ref: workspaceObservationRef,
              satisfaction: "satisfied",
              rail_status: "complete",
            },
            {
              subgoal_id: calculatorSubgoalId,
              requested_capability: "scientific-calculator.solve_expression",
              executed_capability: "scientific-calculator.solve_expression",
              capability_family: "calculator",
              observation_kind: "calculator_receipt",
              observation_ref: calculatorObservationRef,
              satisfaction: "satisfied",
              rail_status: "complete",
            },
          ],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: workspaceObservationRef,
        kind: "workspace_os_status_observation",
        payload: { schema: "helix.workspace_os_status_observation.v1" },
      },
      {
        artifact_id: calculatorObservationRef,
        kind: "calculator_receipt",
        payload: { schema: "helix.calculator_receipt.v1", result: "45" },
      },
      {
        artifact_id: `${turnId}:draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          turn_id: turnId,
          text: draftText,
          answer_text: draftText,
          authority: "llm_post_observation_compound_synthesis",
          model_step_capability: "model.synthesize_from_compound_subgoal_observations",
          support_refs: [workspaceObservationRef],
          artifact_refs: [workspaceObservationRef],
          grounded_in_observation_refs: [workspaceObservationRef],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      route_product_contract: modelOnlyContract(turnId),
      canonical_goal_frame: {
        goal_kind: "compound_tool",
        required_terminal_kind: "model_synthesized_answer",
      },
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: draftText,
      final_answer_source: "final_answer_draft",
      terminal_artifact_kind: "model_synthesized_answer",
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      debug: {
        terminal_artifact_kind: "model_synthesized_answer",
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("compound_subgoal_support_refs_missing");
    expect(payload.terminal_artifact_kind).toBe("typed_failure");
    expect(payload.final_answer_source).toBe("typed_failure");
    expect(payload.selected_terminal_support_refs).toEqual([]);
    expect(payload.terminal_synthesis_support_refs).toEqual([]);
    expect(payload.compound_subgoal_draft_support_coverage).toMatchObject({
      ok: false,
      required_observation_refs: [workspaceObservationRef, calculatorObservationRef],
      draft_support_refs: [workspaceObservationRef],
      missing_observation_refs: [calculatorObservationRef],
    });
    const debug = payload.debug as Record<string, unknown>;
    expect(debug.terminal_artifact_kind).toBe("typed_failure");
    expect(debug.terminal_error_code).toBe("compound_subgoal_support_refs_missing");
  });

  it("clears selected synthesis support mirrors when terminal authority fail-closes", () => {
    const turnId = "ask:test:typed-failure-clears-support-mirror";
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      route_product_contract: modelOnlyContract(turnId),
      selected_final_answer: "Stale compound answer.",
      final_answer_source: "final_answer_draft",
      terminal_artifact_kind: "compound_evidence_synthesis_answer",
      compound_evidence_synthesis_answer: {
        schema: "helix.compound_evidence_synthesis_answer.v1",
        artifact_id: `${turnId}:compound_answer`,
        turn_id: turnId,
        text: "Stale compound answer.",
        answer_text: "Stale compound answer.",
        support_refs: ["obs:catalog", "obs:workspace"],
        support_refs_count: 2,
        subgoal_observation_refs: ["obs:catalog", "obs:workspace"],
        subgoal_observation_refs_count: 2,
      },
      tool_rail_failure_triage: {
        schema: "helix.tool_rail_failure_triage.v1",
        rail_status: "fail_closed",
        rail_failure_code: "required_observation_missing",
        first_broken_rail: "observation_artifact",
        repair_target: "observation_materializer",
        selected_capability: "workspace_os.status",
        executed_capability: "workspace_os.status",
        assistant_answer: false,
        raw_content_included: false,
      },
      debug: {
        terminal_artifact_kind: "compound_evidence_synthesis_answer",
        selected_terminal_support_refs: ["obs:catalog", "obs:workspace"],
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      payload,
      artifactLedger: [],
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(result.selected_terminal_support_refs).toEqual([]);
    expect(result.selected_terminal_subgoal_observation_refs).toEqual([]);
    expect(payload.terminal_artifact_kind).toBe("typed_failure");
    expect(payload.final_answer_source).toBe("typed_failure");
    expect(payload.selected_terminal_support_refs).toEqual([]);
    expect(payload.terminal_synthesis_support_refs).toEqual([]);
    expect(payload.selected_terminal_subgoal_observation_refs).toEqual([]);
    const debug = payload.debug as Record<string, unknown>;
    expect(debug.terminal_artifact_kind).toBe("typed_failure");
    expect(debug.selected_terminal_support_refs).toEqual([]);
    expect(debug.terminal_synthesis_support_refs).toEqual([]);
    expect(debug.selected_terminal_subgoal_observation_refs).toEqual([]);
  });

  it("mirrors support refs from selected ledger-only visual terminal artifacts", () => {
    const turnId = "ask:test:visual-ledger-support-mirror";
    const visualArtifactRef = `${turnId}:visual_frame`;
    const visualObservationRef = `${turnId}:visual_observation`;
    const visualText = "The active visual frame shows the calculator panel ready for expression input.";
    const artifacts = [
      {
        artifact_id: visualArtifactRef,
        kind: "visual_frame_evidence",
        payload: {
          schema: "helix.visual_frame_evidence.v1",
          text: visualText,
          support_refs: [visualObservationRef],
          source_observation_refs: [visualObservationRef],
          source_families: ["visual_capture"],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        turn_id: turnId,
        thread_id: "thread:test",
        source_target: "visual_capture",
        allowed_terminal_artifact_kinds: ["visual_frame_evidence", "typed_failure", "request_user_input"],
        forbidden_terminal_artifact_kinds: ["direct_answer_text", "tool_receipt", "workspace_action_receipt"],
        required_artifact_refs: [],
        precedence_reason: "test",
        assistant_answer: false,
        raw_content_included: false,
      },
      canonical_goal_frame: {
        goal_kind: "visual_capture",
        required_terminal_kind: "visual_frame_evidence",
      },
      current_turn_artifact_ledger: artifacts,
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
        observed_results: [
          {
            kind: "visual_frame_evidence",
            ref: visualArtifactRef,
            supports_goal: true,
          },
        ],
      },
      debug: {
        terminal_artifact_kind: null,
        selected_terminal_support_refs: [],
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("visual_frame_evidence");
    expect(result.selected_terminal_support_refs).toEqual([visualObservationRef]);
    expect(result.selected_terminal_subgoal_observation_refs).toEqual([visualObservationRef]);
    expect(result.selected_terminal_source_families).toEqual(["visual_capture"]);
    expect(payload.terminal_artifact_kind).toBe("visual_frame_evidence");
    expect(payload.selected_terminal_support_refs).toEqual([visualObservationRef]);
    expect(payload.terminal_synthesis_support_refs).toEqual([visualObservationRef]);
    expect(payload.visual_frame_evidence).toMatchObject({
      text: visualText,
      support_refs: [visualObservationRef],
    });
    const debug = payload.debug as Record<string, unknown>;
    expect(debug.terminal_artifact_kind).toBe("visual_frame_evidence");
    expect(debug.selected_terminal_support_refs).toEqual([visualObservationRef]);
    expect(debug.terminal_synthesis_support_refs).toEqual([visualObservationRef]);
    expect(debug.visual_frame_evidence).toMatchObject({
      text: visualText,
      support_refs: [visualObservationRef],
    });
  });

  it("publishes a valid repo evidence answer instead of a stale continuation failure", () => {
    const turnId = "ask:test:repo-draft-over-stale-continuation";
    const draftText = "Helix Ask requires tool receipts to re-enter the solver as observations before terminal authority can select a visible answer.";
    const artifacts = [
      {
        artifact_id: `${turnId}:repo_obs`,
        kind: "repo_code_evidence_observation",
        payload: {
          schema: "helix.repo_code_evidence_observation.v1",
          evidence_refs: ["docs/helix-ask-codex-loop-discipline.md"],
          spans: [{ ref: "docs/helix-ask-codex-loop-discipline.md:171" }],
        },
      },
      {
        artifact_id: `${turnId}:synthesis_attempt`,
        kind: "repo_evidence_synthesis_attempt",
        payload: {
          schema: "helix.repo_evidence_synthesis_attempt.v1",
          model_step_capability: "model.synthesize_from_repo_evidence",
        },
      },
      {
        artifact_id: `${turnId}:draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: draftText,
          authority: "llm_post_observation_composer",
          model_step_capability: "model.synthesize_from_repo_evidence",
          artifact_refs: [`${turnId}:repo_obs`],
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      route_product_contract: repoContract(turnId),
      canonical_goal_frame: {
        goal_kind: "repo_code_evidence_question",
        required_terminal_kind: "repo_code_evidence_answer",
      },
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: "I could not complete this Ask turn because solver authority failed (poison_clean_but_authority_failed).",
      final_answer_source: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      solver_continuation_observation: {
        schema: "helix.solver_continuation_observation.v1",
        required_next_step: "answer",
      },
    };
    addRepoRuntimeProof(payload, `${turnId}:repo_obs`);

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("repo_code_evidence_answer");
    expect(result.visible_text).toBe(draftText);
    expect(result.rejected_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "typed_failure",
          reason: "stale_solver_continuation_superseded_by_repo_terminal",
        }),
      ]),
    );
    expect(payload.final_answer_source).toBe("final_answer_draft");
    expect(payload.terminal_artifact_kind).toBe("repo_code_evidence_answer");
  });

  it("publishes a valid scholarly answer instead of a stale continuation failure", () => {
    const turnId = "ask:test:scholarly-draft-over-stale-continuation";
    const lookupRef = `${turnId}:lookup`;
    const fullTextRef = `${turnId}:full_text`;
    const draftText = [
      "The paper identifies the Transformer as an encoder-decoder architecture built from stacked self-attention and position-wise feed-forward layers.",
      "It uses multi-head attention plus positional encodings to model token order without recurrence.",
      "Support: artifact://scholarly-pdf/test.pdf/page/2#text",
    ].join("\n");
    const artifacts = [
      {
        artifact_id: lookupRef,
        kind: "scholarly_research_observation",
        payload: {
          schema: "helix.scholarly_research_observation.v1",
          evidence_refs: ["arxiv:1706.03762"],
          papers: [{ title: "Attention Is All You Need" }],
        },
      },
      {
        artifact_id: fullTextRef,
        kind: "scholarly_full_text_observation",
        payload: {
          schema: "helix.scholarly_full_text_observation.v1",
          selected_chunks: [{
            chunk_ref: "artifact://scholarly-pdf/test.pdf/page/2#chunk/1",
            source_text_ref: "artifact://scholarly-pdf/test.pdf/page/2#text",
            text_excerpt: "The Transformer uses stacked self-attention and point-wise feed-forward layers.",
          }],
          page_text_refs: ["artifact://scholarly-pdf/test.pdf/page/2#text"],
        },
      },
      {
        artifact_id: `${turnId}:draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: draftText,
          authority: "llm_post_observation_composer",
          model_step_capability: "model.synthesize_from_scholarly_research",
          grounded_in_observation_refs: [lookupRef, fullTextRef],
          support_refs: [lookupRef, fullTextRef, "artifact://scholarly-pdf/test.pdf/page/2#text"],
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt: "Do research: fetch the PDF/full text for arXiv:1706.03762 and extract model architecture details.",
      route_product_contract: scholarlyContract(turnId),
      canonical_goal_frame: {
        goal_kind: "scholarly_research_lookup",
        required_terminal_kind: "scholarly_research_answer",
      },
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: "I could not complete this Ask turn because solver authority failed (solver_path_incomplete_before_terminal).",
      final_answer_source: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      solver_continuation_observation: {
        schema: "helix.solver_continuation_observation.v1",
        required_next_step: "answer",
      },
    };
    addScholarlyRuntimeProof(payload, lookupRef, fullTextRef);

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("scholarly_research_answer");
    expect(result.visible_text).toBe(draftText);
    expect(result.rejected_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "typed_failure",
          reason: "stale_solver_continuation_superseded_by_scholarly_terminal",
        }),
      ]),
    );
    expect(payload.final_answer_source).toBe("final_answer_draft");
    expect(payload.terminal_artifact_kind).toBe("scholarly_research_answer");
    expect(payload.scholarly_research_answer).toMatchObject({
      schema: "helix.scholarly_research_answer.v1",
      text: draftText,
      evidence_state: "answer_ready",
      support_refs: expect.arrayContaining([lookupRef, fullTextRef]),
    });
  });

  it("appends clickable scholarly citations from fetched full-text URLs", () => {
    const turnId = "ask:test:scholarly-citation-footer";
    const lookupRef = `${turnId}:lookup`;
    const fullTextRef = `${turnId}:full_text`;
    const draftText = [
      "The paper frames Hawking radiation as a tunneling process near the event horizon.",
      "It uses the fetched PDF chunks as the evidence basis for the answer.",
      "Support: artifact://scholarly-pdf/hawking/page/1#text",
    ].join("\n");
    const artifacts = [
      {
        artifact_id: lookupRef,
        kind: "scholarly_research_observation",
        payload: {
          schema: "helix.scholarly_research_observation.v1",
          papers: [{
            result_id: "arxiv:hep-th/9907001",
            title: "Hawking Radiation As Tunneling",
            identifiers: {
              arxiv_id: "hep-th/9907001",
              pdf_url: "https://arxiv.org/pdf/hep-th/9907001.pdf",
            },
          }],
        },
      },
      {
        artifact_id: fullTextRef,
        kind: "scholarly_full_text_observation",
        payload: {
          schema: "helix.scholarly_full_text_observation.v1",
          paper_result_id: "arxiv:hep-th/9907001",
          title: "Hawking Radiation As Tunneling",
          source_url: "https://arxiv.org/pdf/hep-th/9907001.pdf",
          pages_parsed: 5,
          selected_chunks: [{
            chunk_ref: "artifact://scholarly-pdf/hawking/page/1#chunk/1",
            source_text_ref: "artifact://scholarly-pdf/hawking/page/1#text",
            text_excerpt: "Hawking radiation can be viewed as tunneling.",
          }],
          page_text_refs: ["artifact://scholarly-pdf/hawking/page/1#text"],
        },
      },
      {
        artifact_id: `${turnId}:draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: draftText,
          authority: "llm_post_observation_composer",
          model_step_capability: "model.synthesize_from_scholarly_research",
          grounded_in_observation_refs: [lookupRef, fullTextRef],
          support_refs: [lookupRef, fullTextRef, "artifact://scholarly-pdf/hawking/page/1#text"],
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt: "Do research: fetch the PDF/full text for a Hawking radiation paper and cite it.",
      route_product_contract: scholarlyContract(turnId),
      canonical_goal_frame: {
        goal_kind: "scholarly_research_lookup",
        required_terminal_kind: "scholarly_research_answer",
      },
      current_turn_artifact_ledger: artifacts,
    };
    addScholarlyRuntimeProof(payload, lookupRef, fullTextRef);

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("scholarly_research_answer");
    expect(result.visible_text).toContain(draftText);
    expect(result.visible_text).toContain("Citations");
    expect(result.visible_text).toContain("- [Hawking Radiation As Tunneling](https://arxiv.org/pdf/hep-th/9907001.pdf) (PDF/full text; 5 parsed pages)");
    expect(payload.scholarly_research_answer).toMatchObject({
      schema: "helix.scholarly_research_answer.v1",
      answer_text: result.visible_text,
      evidence_state: "answer_ready",
      citations: [
        {
          label: "Hawking Radiation As Tunneling",
          url: "https://arxiv.org/pdf/hep-th/9907001.pdf",
          note: "PDF/full text; 5 parsed pages",
        },
      ],
    });
  });

  it("fails closed when a scholarly draft contradicts observed PDF/full-text evidence", () => {
    const turnId = "ask:test:scholarly-contradictory-draft";
    const lookupRef = `${turnId}:lookup`;
    const fullTextRef = `${turnId}:full_text`;
    const postToolRef = `${turnId}:post_tool_observation`;
    const draftText = "I cannot fetch or access external PDF documents, so I cannot summarize the paper.";
    const artifacts = [
      {
        artifact_id: lookupRef,
        kind: "scholarly_research_observation",
        payload: {
          schema: "helix.scholarly_research_observation.v1",
          evidence_refs: ["arxiv:1402.3952"],
          papers: [{ result_id: "arxiv:1402.3952", title: "Hawking Radiation from Higher-Dimensional Black Holes" }],
        },
      },
      {
        artifact_id: fullTextRef,
        kind: "scholarly_full_text_observation",
        payload: {
          schema: "helix.scholarly_full_text_observation.v1",
          paper_result_id: "arxiv:1402.3952",
          source_url: "https://arxiv.org/pdf/1402.3952v2.pdf",
          pages_parsed: 35,
          selected_chunks: [{
            chunk_ref: "arxiv:1402.3952:p1:c1",
            source_text_ref: "arxiv:1402.3952:p1#text",
            text_excerpt: "This paper reviews Hawking radiation from higher-dimensional black holes.",
          }],
          page_text_refs: [{ text_ref: "arxiv:1402.3952:p1#text" }],
        },
      },
      {
        artifact_id: postToolRef,
        kind: "agent_step_observation_packet",
        payload: {
          schema: "helix.agent_step_observation_packet.v1",
          status: "succeeded",
          post_tool_model_step_required: true,
          terminal_eligible: false,
          observed_artifact_refs: [lookupRef, fullTextRef],
        },
      },
      {
        artifact_id: `${turnId}:draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: draftText,
          authority: "llm_post_observation_composer",
          model_step_capability: "model.synthesize_from_scholarly_research",
          support_refs: [lookupRef, fullTextRef, "arxiv:1402.3952:p1#text"],
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt: "Do research: fetch the PDF/full text for arXiv:1402.3952 and summarize the Hawking radiation paper.",
      route_product_contract: scholarlyContract(turnId),
      canonical_goal_frame: {
        goal_kind: "scholarly_research_lookup",
        required_terminal_kind: "scholarly_research_answer",
      },
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: "I could not produce a terminal answer for this turn.",
      final_answer_source: "typed_failure",
      terminal_artifact_kind: "typed_failure",
    };
    addScholarlyRuntimeProof(payload, lookupRef, fullTextRef);

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(result.visible_text).toContain("PDF/full-text evidence was observed");
    expect(result.integrity.post_tool_model_step_satisfied).toBe(false);
    expect(result.rejected_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "model_synthesized_answer",
          reason: "route_contract_forbids_model_synthesized_answer",
        }),
      ]),
    );
    expect(payload.terminal_error_code).toBe("scholarly_answer_synthesis_failed_after_full_text_observed");
    expect(payload.terminal_artifact_kind).toBe("typed_failure");
    expect(payload.model_synthesized_answer).toBeUndefined();
    expect(payload.scholarly_research_answer).toBeUndefined();
    expect((payload.final_answer_draft_quality_gate as Record<string, unknown>).violations).toEqual(
      expect.arrayContaining(["contradicts_observed_scholarly_full_text"]),
    );
  });

  it("keeps deterministic scholarly fallback drafts nonterminal", () => {
    const turnId = "ask:test:scholarly-deterministic-fallback-nonterminal";
    const lookupRef = `${turnId}:lookup`;
    const fullTextRef = `${turnId}:full_text`;
    const artifacts = [
      {
        artifact_id: lookupRef,
        kind: "scholarly_research_observation",
        payload: {
          schema: "helix.scholarly_research_observation.v1",
          evidence_refs: ["arxiv:1402.3952"],
          papers: [{ result_id: "arxiv:1402.3952", title: "Hawking Radiation from Higher-Dimensional Black Holes" }],
        },
      },
      {
        artifact_id: fullTextRef,
        kind: "scholarly_full_text_observation",
        payload: {
          schema: "helix.scholarly_full_text_observation.v1",
          source_url: "https://arxiv.org/pdf/1402.3952v2.pdf",
          pages_parsed: 35,
          selected_chunks: [{
            chunk_ref: "arxiv:1402.3952:p1:c1",
            source_text_ref: "arxiv:1402.3952:p1#text",
            text_excerpt: "Hawking radiation from higher-dimensional black holes is reviewed.",
          }],
          page_text_refs: [{ text_ref: "arxiv:1402.3952:p1#text" }],
        },
      },
      {
        artifact_id: `${turnId}:post_tool_observation`,
        kind: "agent_step_observation_packet",
        payload: {
          schema: "helix.agent_step_observation_packet.v1",
          status: "succeeded",
          post_tool_model_step_required: true,
          terminal_eligible: false,
          observed_artifact_refs: [lookupRef, fullTextRef],
        },
      },
      {
        artifact_id: `${turnId}:draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: "Paper: Hawking Radiation from Higher-Dimensional Black Holes. Relevant PDF/full-text excerpts: arxiv:1402.3952:p1:c1.",
          authority: "deterministic_receipt_fallback",
          support_refs: [lookupRef, fullTextRef, "arxiv:1402.3952:p1#text"],
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt: "Do research: fetch the PDF/full text for arXiv:1402.3952 and summarize the paper.",
      route_product_contract: scholarlyContract(turnId),
      canonical_goal_frame: {
        goal_kind: "scholarly_research_lookup",
        required_terminal_kind: "scholarly_research_answer",
      },
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: "I could not produce a terminal answer for this turn.",
      final_answer_source: "typed_failure",
      terminal_artifact_kind: "typed_failure",
    };
    addScholarlyRuntimeProof(payload, lookupRef, fullTextRef);

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      threadId: "thread:test",
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(result.source).toBe("typed_failure");
    expect(result.visible_text).toContain("no valid model-authored scholarly answer");
    expect(result.rejected_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "final_answer_draft",
          reason: "deterministic_receipt_fallback_nonterminal",
        }),
      ]),
    );
    expect(payload.terminal_artifact_kind).toBe("typed_failure");
    expect(payload.final_answer_source).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("scholarly_answer_synthesis_failed_after_full_text_observed");
  });

  it("rejects fallback-like final drafts as successful terminals", () => {
    const gate = evaluateFinalAnswerDraftQualityGate({
      turnId: "ask:test:fallback-draft",
      finalAnswerDraftRef: "draft:fallback",
      draftText: "I could not produce a terminal answer for this turn.",
      routeProductContract: modelOnlyContract("ask:test:fallback-draft"),
      artifactLedger: [],
    });

    expect(gate.ok).toBe(false);
    expect(gate.violations).toContain("fallback_like_answer");
  });

  it("accepts a bounded missing-requirements synthesis from a typed theory procedure observation", () => {
    const turnId = "ask:test:theory-procedure-bounded-limitation";
    const observationRef = `${turnId}:theory_experiment_procedure_observation`;
    const routeProductContract = {
      schema: "helix.route_product_contract.v1",
      turn_id: turnId,
      source_target: "theory_locator",
      required_terminal_kind: "model_synthesized_answer",
      allowed_terminal_artifact_kinds: ["model_synthesized_answer", "typed_failure"],
      assistant_answer: false,
      raw_content_included: false,
    };
    const artifactLedger = [{
      artifact_id: observationRef,
      turn_id: turnId,
      kind: "theory_experiment_procedure_observation",
      status: "succeeded",
      payload: {
        schema: "casimir.theory_experiment_procedure.observation.v1",
        turn_id: turnId,
        status: "succeeded",
        output_role: "evidence_for_synthesis",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
        procedure: {
          lanyonEligibility: {
            requested: true,
            status: "ineligible",
            requestedCaseId: "unregistered_2d_adaptive_mesh_advection_diffusion",
            blockers: [
              "unsupported_lanyon_case",
              "target_observable_required",
              "coordinate_frame_required",
              "initial_boundary_conditions_required",
            ],
          },
          readiness: {
            status: "conditional",
            terminalSynthesisAllowed: false,
          },
          authority: {
            preparesProcedureOnly: true,
            executesTools: false,
            proofAuthority: false,
            numericalAuthority: false,
            empiricalAuthority: false,
            physicalTruthAuthority: false,
            terminalEligible: false,
            postToolModelStepRequired: true,
          },
        },
      },
    }];
    const draftText = [
      "The requested Lanyon case is ineligible; I cannot improvise support or treat it as eligible, and no code was run.",
      "Exact typed limitation and missing requirements:",
      "- unsupported_lanyon_case",
      "- target_observable_required",
      "- coordinate_frame_required",
      "- initial_boundary_conditions_required",
    ].join("\n");
    const gate = evaluateFinalAnswerDraftQualityGate({
      turnId,
      finalAnswerDraftRef: `${turnId}:draft`,
      draftText,
      draftPayload: {
        schema: "helix.final_answer_draft.v1",
        grounded_in_observation_refs: [observationRef],
      },
      promptText:
        "Do not improvise support or run code; give the exact typed limitation and missing requirements.",
      routeProductContract,
      payload: {
        active_prompt:
          "Do not improvise support or run code; give the exact typed limitation and missing requirements.",
        route_product_contract: routeProductContract,
        committed_ask_route: {
          schema: "helix.committed_ask_route.v1",
          route: {
            source_target: "theory_locator",
          },
          canonical_goal: {
            goal_kind: "theory_locator",
            required_terminal_kind: "model_synthesized_answer",
          },
        },
      },
      artifactLedger,
    });

    expect(gate).toMatchObject({
      ok: true,
      route_family: "theory_locator",
      violations: [],
    });

    const configureGate = evaluateFinalAnswerDraftQualityGate({
      turnId,
      finalAnswerDraftRef: `${turnId}:configure-draft`,
      draftText: [
        "The procedure is blocked at the Lanyon congruence stage.",
        "Exact typed limitation: unsupported_lanyon_case.",
        "I cannot configure Lanyon for the requested unregistered 2D adaptive-mesh case without a registered supported case.",
        "Missing requirements include target_observable_required, coordinate_frame_required, and initial_boundary_conditions_required.",
      ].join("\n"),
      draftPayload: {
        schema: "helix.final_answer_draft.v1",
        grounded_in_observation_refs: [observationRef],
      },
      promptText:
        "Do not improvise support or run code; give the exact typed limitation and missing requirements.",
      routeProductContract,
      payload: {
        active_prompt:
          "Do not improvise support or run code; give the exact typed limitation and missing requirements.",
        route_product_contract: routeProductContract,
        committed_ask_route: {
          schema: "helix.committed_ask_route.v1",
          route: { source_target: "theory_locator" },
          canonical_goal: {
            goal_kind: "theory_locator",
            required_terminal_kind: "model_synthesized_answer",
          },
        },
      },
      artifactLedger,
    });

    expect(configureGate).toMatchObject({
      ok: true,
      route_family: "theory_locator",
      violations: [],
    });

    const prepareGate = evaluateFinalAnswerDraftQualityGate({
      turnId,
      finalAnswerDraftRef: `${turnId}:prepare-draft`,
      draftText: [
        "Typed limitation: unsupported_lanyon_case; the requested 2D adaptive-mesh case is ineligible.",
        "I cannot prepare a valid Lanyon-backed procedure without target_observable_required, coordinate_frame_required, and initial_boundary_conditions_required.",
        "No code was run and no support was improvised.",
      ].join("\n"),
      draftPayload: {
        schema: "helix.final_answer_draft.v1",
        grounded_in_observation_refs: [observationRef],
      },
      promptText:
        "Do not improvise support or run code; give the exact typed limitation and missing requirements.",
      routeProductContract,
      payload: {
        active_prompt:
          "Do not improvise support or run code; give the exact typed limitation and missing requirements.",
        route_product_contract: routeProductContract,
        committed_ask_route: {
          schema: "helix.committed_ask_route.v1",
          route: { source_target: "theory_locator" },
          canonical_goal: {
            goal_kind: "theory_locator",
            required_terminal_kind: "model_synthesized_answer",
          },
        },
      },
      artifactLedger,
    });

    expect(prepareGate).toMatchObject({
      ok: true,
      route_family: "theory_locator",
      violations: [],
    });
  });

  it("accepts grounded missing-requirement reporting for an admitted procedure while retaining generic fallback rejection", () => {
    const turnId = "ask:test:theory-procedure-grounded-requirements";
    const observationRef = `${turnId}:theory_experiment_procedure_observation`;
    const routeProductContract = {
      schema: "helix.route_product_contract.v1",
      turn_id: turnId,
      source_target: "theory_locator",
      required_terminal_kind: "model_synthesized_answer",
      allowed_terminal_artifact_kinds: ["model_synthesized_answer", "typed_failure"],
      assistant_answer: false,
      raw_content_included: false,
    };
    const artifactLedger = [{
      artifact_id: observationRef,
      turn_id: turnId,
      kind: "theory_experiment_procedure_observation",
      status: "succeeded",
      payload: {
        schema: "casimir.theory_experiment_procedure.observation.v1",
        turn_id: turnId,
        status: "succeeded",
        output_role: "evidence_for_synthesis",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
        procedure: {
          lanyonEligibility: {
            requested: true,
            status: "eligible",
            requestedCaseId: "advection_diffusion_full_1d",
            blockers: [],
          },
          authority: {
            preparesProcedureOnly: true,
            executesTools: false,
            proofAuthority: false,
            numericalAuthority: false,
            empiricalAuthority: false,
            physicalTruthAuthority: false,
            terminalEligible: false,
            postToolModelStepRequired: true,
          },
        },
      },
    }];
    const commonInput = {
      turnId,
      finalAnswerDraftRef: `${turnId}:draft`,
      draftPayload: {
        schema: "helix.final_answer_draft.v1",
        grounded_in_observation_refs: [observationRef],
      },
      promptText:
        "Re-prepare the procedure and identify the missing semantic, formal, numerical, and observable requirements.",
      routeProductContract,
      payload: {
        active_prompt:
          "Re-prepare the procedure and identify the missing semantic, formal, numerical, and observable requirements.",
        route_product_contract: routeProductContract,
        committed_ask_route: {
          schema: "helix.committed_ask_route.v1",
          route: { source_target: "theory_locator" },
          canonical_goal: {
            goal_kind: "theory_locator",
            required_terminal_kind: "model_synthesized_answer",
          },
        },
      },
      artifactLedger,
    };

    const groundedGate = evaluateFinalAnswerDraftQualityGate({
      ...commonInput,
      draftText: [
        "The current procedure remains bounded preparation, not proof or physical validation.",
        "Missing requirements identified from current procedure evidence:",
        "- semantic_admission_required",
        "- registered_bridge_or_derivation_repair_required",
        "- independent_numerical_certificate_required",
        "- target_observable_required",
      ].join("\n"),
    });
    expect(groundedGate).toMatchObject({
      ok: true,
      route_family: "theory_locator",
      violations: [],
    });

    const genericFallbackGate = evaluateFinalAnswerDraftQualityGate({
      ...commonInput,
      draftText:
        "I could not produce a terminal answer because required artifacts were missing. Missing requirements remain. Please retry once.",
    });
    expect(genericFallbackGate.ok).toBe(false);
    expect(genericFallbackGate.violations).toContain("fallback_like_answer");
  });

  it("does not exempt bounded-looking limitation text without the exact current-turn procedure observation", () => {
    const turnId = "ask:test:theory-procedure-ungrounded-limitation";
    const gate = evaluateFinalAnswerDraftQualityGate({
      turnId,
      finalAnswerDraftRef: `${turnId}:draft`,
      draftText: [
        "The requested Lanyon case is ineligible; no code was run and no support was improvised.",
        "Exact typed limitation and missing requirements:",
        "- unsupported_lanyon_case",
      ].join("\n"),
      draftPayload: {
        schema: "helix.final_answer_draft.v1",
        grounded_in_observation_refs: [`${turnId}:missing_observation`],
      },
      routeProductContract: {
        schema: "helix.route_product_contract.v1",
        turn_id: turnId,
        source_target: "theory_locator",
        required_terminal_kind: "model_synthesized_answer",
        allowed_terminal_artifact_kinds: ["model_synthesized_answer", "typed_failure"],
      },
      artifactLedger: [],
    });

    expect(gate.ok).toBe(false);
    expect(gate.violations).toContain("fallback_like_answer");
  });

  it("still rejects terminal-unavailable boilerplate beside typed theory procedure evidence", () => {
    const turnId = "ask:test:theory-procedure-generic-fallback";
    const gate = evaluateFinalAnswerDraftQualityGate({
      turnId,
      finalAnswerDraftRef: `${turnId}:draft`,
      draftText:
        "I could not produce a terminal answer because required artifacts were missing. Please retry once.",
      routeProductContract: {
        schema: "helix.route_product_contract.v1",
        turn_id: turnId,
        source_target: "theory_locator",
        required_terminal_kind: "model_synthesized_answer",
        allowed_terminal_artifact_kinds: ["model_synthesized_answer", "typed_failure"],
      },
      artifactLedger: [{
        artifact_id: `${turnId}:theory_experiment_procedure_observation`,
        kind: "theory_experiment_procedure_observation",
        payload: {
          schema: "casimir.theory_experiment_procedure.observation.v1",
          status: "succeeded",
          output_role: "evidence_for_synthesis",
          terminal_eligible: false,
          assistant_answer: false,
        },
      }],
    });

    expect(gate.ok).toBe(false);
    expect(gate.violations).toContain("fallback_like_answer");
  });

  it("preserves theory-locator quality semantics for a grounded same-family compound procedure", () => {
    const turnId = "ask:test:theory-procedure-compound-lanyon-limitation";
    const observationRef = `${turnId}:theory_experiment_procedure_observation`;
    const routeProductContract = {
      schema: "helix.route_product_contract.v1",
      turn_id: turnId,
      source_target: "agent_provider_gateway_turn",
      required_terminal_kind: "compound_evidence_synthesis_answer",
      allowed_terminal_artifact_kinds: [
        "compound_evidence_synthesis_answer",
        "typed_failure",
      ],
      assistant_answer: false,
      raw_content_included: false,
    };
    const subgoals = [
      {
        subgoal_id: "prepare",
        capability_family: "theory_locator",
        requested_capability: "theory-experiment-procedure.prepare",
      },
      {
        subgoal_id: "evaluate",
        capability_family: "theory_locator",
        requested_capability:
          "theory-experiment-procedure.evaluate_closure",
      },
      {
        subgoal_id: "reflect",
        capability_family: "theory_locator",
        requested_capability: "helix_ask.reflect_theory_context",
      },
    ];
    const artifactLedger = [
      {
        artifact_id: observationRef,
        turn_id: turnId,
        kind: "theory_experiment_procedure_observation",
        status: "succeeded",
        payload: {
          schema: "casimir.theory_experiment_procedure.observation.v1",
          turn_id: turnId,
          status: "succeeded",
          output_role: "evidence_for_synthesis",
          terminal_eligible: false,
          post_tool_model_step_required: true,
          assistant_answer: false,
          raw_content_included: false,
          procedure: {
            lanyonEligibility: {
              requested: true,
              status: "ineligible",
              requestedCaseId: "unregistered_2d_adaptive_mesh",
              blockers: [
                "unsupported_lanyon_case",
                "target_observable_required",
                "coordinate_frame_required",
              ],
            },
            authority: {
              preparesProcedureOnly: true,
              executesTools: false,
              proofAuthority: false,
              numericalAuthority: false,
              empiricalAuthority: false,
              physicalTruthAuthority: false,
              terminalEligible: false,
              postToolModelStepRequired: true,
            },
          },
        },
      },
    ];
    const payload = {
      active_prompt:
        "Use the current theory procedure, closure, and reflection evidence to report the exact Lanyon limitation and missing requirements.",
      route_product_contract: routeProductContract,
      committed_ask_route: {
        schema: "helix.committed_ask_route.v1",
        route: { source_target: "theory_locator" },
        canonical_goal: {
          goal_kind: "theory_locator",
          required_terminal_kind: "compound_evidence_synthesis_answer",
        },
      },
      compound_capability_contract: {
        schema: "helix.compound_capability_contract.v1",
        subgoals,
        required_observation_families: ["theory_locator"],
      },
      capability_itinerary_execution_state: {
        schema: "helix.capability_itinerary_execution_state.v1",
        complete: false,
        required_observation_families: ["theory_locator"],
        compound_subgoal_ledger: [
          {
            ...subgoals[0],
            satisfaction: "failed",
            rail_status: "failed",
          },
        ],
      },
      compound_subgoal_rail_statuses: subgoals.map((subgoal) => ({
        ...subgoal,
        satisfaction: "satisfied",
        rail_status: "complete",
        observation_ref: `${turnId}:${subgoal.subgoal_id}:observation`,
      })),
      compound_capability_synthesis_readiness: {
        schema: "helix.compound_capability_synthesis_readiness.v1",
        applies: true,
        complete: false,
        has_failed_subgoal: true,
        required_terminal_kind: "compound_evidence_synthesis_answer",
      },
    };
    const commonInput = {
      turnId,
      finalAnswerDraftRef: `${turnId}:provider-route-product`,
      draftPayload: {
        schema: "helix.provider_route_product.v1",
        support_refs: [observationRef],
        selected_observation_refs: [observationRef],
      },
      promptText: payload.active_prompt,
      routeProductContract,
      payload,
      artifactLedger,
    };

    const boundedGate = evaluateFinalAnswerDraftQualityGate({
      ...commonInput,
      draftText: [
        "The current theory procedure and closure evidence do not admit the requested Lanyon case.",
        "Exact typed limitation and missing requirements:",
        "- unsupported_lanyon_case",
        "- target_observable_required",
        "- coordinate_frame_required",
        "This is a bounded preparation result, not a proof, numerical certificate, or claim about physical truth.",
      ].join("\n"),
    });
    expect(boundedGate).toMatchObject({
      ok: true,
      route_family: "theory_locator",
      violations: [],
    });

    const fallbackGate = evaluateFinalAnswerDraftQualityGate({
      ...commonInput,
      draftText:
        "I could not produce a terminal answer because required artifacts were missing. Missing requirements remain. Please retry once.",
    });
    expect(fallbackGate.route_family).toBe("theory_locator");
    expect(fallbackGate.ok).toBe(false);
    expect(fallbackGate.violations).toContain("fallback_like_answer");
  });

  it("projection gate repairs visible stale direct answer when a later valid draft exists", () => {
    const turnId = "ask:test:projection-direct-to-draft";
    const draftText = [
      "- Charge: electrons are negative; protons are positive.",
      "- Mass: electrons are much lighter than protons.",
      "- Role in atoms: electrons occupy shells/clouds; protons are in the nucleus and define element identity.",
      "Practical consequence: charge attraction helps form stable atoms.",
    ].join("\n");
    const artifacts = [
      {
        artifact_id: `${turnId}:direct`,
        kind: "direct_answer_text",
        payload: { schema: "helix.direct_answer_text.v1", text: "An electron is a fundamental subatomic particle." },
      },
      {
        artifact_id: `${turnId}:draft`,
        kind: "final_answer_draft",
        payload: { schema: "helix.final_answer_draft.v1", text: draftText },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      active_prompt: "Compare an electron and a proton in three ways: charge, mass, and role in atoms. Then give one practical consequence of those differences.",
      route_product_contract: modelOnlyContract(turnId),
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: "An electron is a fundamental subatomic particle.",
      final_answer_source: "model_direct_answer",
      terminal_artifact_kind: "direct_answer_text",
    };
    addModelOnlyRuntimeProof(payload);

    const result = applyHelixProjectionMismatchGate({
      turn_id: turnId,
      artifact_ledger: artifacts,
      current_payload: payload,
      current_visible_text: "An electron is a fundamental subatomic particle.",
    });

    expect(result.internal_turn_success.outcome).toBe("internal_success_and_visible_success");
    expect(result.terminal_projection_health.projection_mismatch_repaired).toBe(true);
    expect(payload.selected_final_answer).toBe(draftText);
    expect((payload.terminal_authority_single_writer as Record<string, unknown>)).toBeTruthy();
  });

  it("fails closed when visible projection disagrees with typed failure authority", () => {
    const turnId = "ask:test:projection-kind-typed-failure";
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      selected_final_answer: "A good-looking but unauthorized answer.",
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        turn_id: turnId,
        terminal_artifact_kind: "model_synthesized_answer",
        concise_text: "A good-looking but unauthorized answer.",
      },
    };
    const result = applyTerminalProjectionKindGuard(payload, {
      schema: "helix.terminal_authority_single_writer_result.v1",
      turn_id: turnId,
      selected_terminal_artifact_ref: "typed_failure:test",
      selected_terminal_artifact_kind: "typed_failure",
      visible_text: "The authorized failure.",
      assistant_answer: false,
      source: "typed_failure",
      rejected_candidates: [],
      writes: {
        payload_text: "The authorized failure.",
        payload_answer: "The authorized failure.",
        payload_assistant_answer: "The authorized failure.",
        payload_selected_final_answer: "The authorized failure.",
        terminal_presentation_concise_text: "The authorized failure.",
        debug_selected_final_answer: "The authorized failure.",
      },
      integrity: {
        single_writer_applied: true,
        visible_matches_selected_artifact: true,
        visible_matches_draft: true,
        stale_failure_visible: false,
        receipt_visible_as_answer: false,
        post_tool_model_step_satisfied: true,
        legacy_terminal_candidate_count: 0,
        forbidden_terminal_candidate_count: 0,
        payload_mirror_written_after_terminal_selection: true,
      },
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(result.integrity.terminal_projection_guard_applied).toBe(true);
    expect(result.integrity.terminal_projection_guard_action).toBe("fail_closed");
    expect(result.integrity.terminal_projection_failure_code).toBe("terminal_projection_mismatch");
    expect(payload.terminal_artifact_kind).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("terminal_projection_mismatch");
    expect((payload.terminal_presentation as Record<string, unknown>).terminal_artifact_kind).toBe("typed_failure");
  });

  it("projects the authority-selected artifact when presentation kind is stale", () => {
    const turnId = "ask:test:projection-kind-repair";
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      terminal_artifact_kind: "direct_answer_text",
      final_answer_source: "model_direct_answer",
      selected_final_answer: "Stale direct text.",
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        turn_id: turnId,
        terminal_artifact_kind: "direct_answer_text",
        concise_text: "Stale direct text.",
      },
    };
    const result = applyTerminalProjectionKindGuard(payload, {
      schema: "helix.terminal_authority_single_writer_result.v1",
      turn_id: turnId,
      selected_terminal_artifact_ref: `${turnId}:draft`,
      selected_terminal_artifact_kind: "model_synthesized_answer",
      visible_text: "Authority-selected draft text.",
      assistant_answer: false,
      source: "final_answer_draft",
      rejected_candidates: [],
      writes: {
        payload_text: "Authority-selected draft text.",
        payload_answer: "Authority-selected draft text.",
        payload_assistant_answer: "Authority-selected draft text.",
        payload_selected_final_answer: "Authority-selected draft text.",
        terminal_presentation_concise_text: "Authority-selected draft text.",
        debug_selected_final_answer: "Authority-selected draft text.",
      },
      integrity: {
        single_writer_applied: true,
        visible_matches_selected_artifact: true,
        visible_matches_draft: true,
        stale_failure_visible: false,
        receipt_visible_as_answer: false,
        post_tool_model_step_satisfied: true,
        legacy_terminal_candidate_count: 0,
        forbidden_terminal_candidate_count: 0,
        payload_mirror_written_after_terminal_selection: true,
      },
    });

    expect(result.integrity.terminal_projection_guard_applied).toBe(true);
    expect(result.integrity.terminal_projection_guard_action).toBe("project_authority_artifact");
    expect(payload.terminal_artifact_kind).toBe("model_synthesized_answer");
    expect((payload.terminal_presentation as Record<string, unknown>).terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(payload.selected_final_answer).toBe("Authority-selected draft text.");
  });

  it("fails closed when calculator route has only a model-authored draft and no calculator observation", () => {
    const turnId = "ask:test:calculator-draft-without-receipt";
    const draftText =
      "I cannot perform calculations or access tools directly. However, sqrt(81)=9 and ln(e^3)=3, so the result is 29.5.";
    const artifacts = [
      {
        artifact_id: `${turnId}:draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: draftText,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      canonical_goal_frame: {
        turn_id: turnId,
        goal_kind: "calculator_solve",
        required_terminal_kind: "workstation_tool_evaluation",
      },
      source_target_intent: {
        schema: "helix.ask_source_target_intent.v1",
        target_source: "calculator_stream",
        target_kind: "calculator_stream",
        strength: "hard",
        must_enter_backend_ask: true,
        allow_client_shortcut: false,
        allow_no_tool_direct: false,
      },
      route_product_contract: {
        ...modelOnlyContract(turnId),
        source_target: "calculator_stream",
        allowed_terminal_artifact_kinds: ["model_synthesized_answer", "typed_failure", "request_user_input"],
        forbidden_terminal_artifact_kinds: ["direct_answer_text", "model_only_concept", "no_tool_direct"],
      },
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: draftText,
      final_answer_source: "model_direct_answer",
      terminal_artifact_kind: "direct_answer_text",
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        turn_id: turnId,
        terminal_artifact_kind: "direct_answer_text",
        concise_text: draftText,
      },
    };
    addModelOnlyRuntimeProof(payload);

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(payload.terminal_artifact_kind).toBe("typed_failure");
    expect(payload.final_answer_source).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("calculator_tool_answer_support_missing");
    expect((payload.calculator_tool_answer_support as Record<string, unknown>).missing_reason).toBe("calculator_result_missing");
    expect(result.rejected_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "model_synthesized_answer",
          source: "final_answer_draft",
          reason: "missing_required_observation",
        }),
      ]),
    );
  });

  it("uses calculator missing-support failure when hard calculator route metadata is present before canonical frame repair", () => {
    const turnId = "ask:test:calculator-route-metadata-before-frame";
    const draftText =
      "I cannot perform calculations or access tools directly, but the expression evaluates to 29.5 by mental math.";
    const artifacts = [
      {
        artifact_id: `${turnId}:draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: draftText,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      route_reason_code: "calculator_solve / model_synthesized_answer",
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: draftText,
      final_answer_source: "final_answer_draft",
      terminal_artifact_kind: "model_synthesized_answer",
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        turn_id: turnId,
        terminal_artifact_kind: "model_synthesized_answer",
        concise_text: draftText,
      },
    };
    addModelOnlyRuntimeProof(payload);

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(result.integrity.terminal_projection_guard_applied).toBe(false);
    expect(result.integrity.terminal_projection_failure_code).toBeNull();
    expect(payload.terminal_artifact_kind).toBe("typed_failure");
    expect(payload.final_answer_source).toBe("typed_failure");
    expect(payload.terminal_error_code).toBe("calculator_tool_answer_support_missing");
    expect((payload.terminal_presentation as Record<string, unknown>).terminal_artifact_kind).toBe("typed_failure");
    expect((payload.calculator_tool_answer_support as Record<string, unknown>).applies).toBe(true);
  });

  it("selects calculator workstation evaluation over a model-authored draft", () => {
    const turnId = "ask:test:calculator-evaluation-terminal";
    const artifacts = [
      {
        artifact_id: `${turnId}:workstation_tool_evaluation`,
        kind: "workstation_tool_evaluation",
        payload: {
          schema: "helix.workstation_tool_evaluation.v1",
          evaluation_id: `${turnId}:workstation_tool_evaluation`,
          supports_goal: true,
          summary: "The calculator evaluated ((sqrt(81)+ln(e^3))*7-5^2)/2 and produced 29.5.",
        },
      },
      {
        artifact_id: `${turnId}:draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: "A model-authored draft says the expression is 29.5.",
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      source_target_intent: {
        schema: "helix.ask_source_target_intent.v1",
        target_source: "calculator_stream",
        target_kind: "calculator_stream",
      },
      route_product_contract: {
        ...modelOnlyContract(turnId),
        source_target: "calculator_stream",
        allowed_terminal_artifact_kinds: ["workstation_tool_evaluation", "model_synthesized_answer", "typed_failure"],
      },
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: "A model-authored draft says the expression is 29.5.",
      final_answer_source: "final_answer_draft",
      terminal_artifact_kind: "model_synthesized_answer",
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        turn_id: turnId,
        terminal_artifact_kind: "model_synthesized_answer",
        concise_text: "A model-authored draft says the expression is 29.5.",
      },
    };
    addCalculatorRuntimeProof(payload, `${turnId}:workstation_tool_evaluation`);

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(result.source).toBe("workstation_tool_evaluation");
    expect(payload.terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(payload.final_answer_source).toBe("workstation_tool_evaluation");
    expect(payload.selected_final_answer).toContain("produced 29.5");
    expect((payload.terminal_presentation as Record<string, unknown>).terminal_artifact_kind).toBe(
      "workstation_tool_evaluation",
    );
    expect(payload.terminal_error_code).toBeUndefined();
  });

  it("materializes calculator workstation evaluation text through the backend synthesizer", () => {
    const turnId = "ask:test:calculator-evaluation-synthesized-terminal";
    const expression = "((sqrt(81)+ln(e^3))*7-5^2)/2";
    const prompt = `Use the scientific calculator to solve ${expression}.`;
    const plan = {
      schema: "helix.workstation_tool_plan.v1",
      plan_id: `${turnId}:plan`,
      thread_id: "thread:test",
      turn_id: turnId,
      goal: prompt,
      intent: "calculator_solve",
      steps: [
        {
          step_id: "solve_expression",
          kind: "run_panel_action",
          panel_id: "scientific-calculator",
          action_id: "solve_expression",
          args: {
            latex: expression,
            calculator_setup: {
              schema: "helix.calculator_setup_context.v1",
              expression: "(81)+",
              display_latex: "(81)+",
              domain: "generic",
              subgoal: "Evaluate the supplied calculator expression.",
              equation: null,
              variables: [],
              result_unit: null,
              interpretation_prompt: null,
            },
          },
          required: true,
        },
      ],
      missing_requirements: [],
      created_at: "2026-06-16T00:00:00.000Z",
    };
    const artifacts = [
      {
        artifact_id: `${turnId}:workstation_tool_evaluation`,
        kind: "workstation_tool_evaluation",
        payload: {
          schema: "helix.workstation_tool_evaluation.v1",
          evaluation_id: `${turnId}:workstation_tool_evaluation`,
          plan_id: plan.plan_id,
          thread_id: "thread:test",
          turn_id: turnId,
          goal: prompt,
          subgoal: "Evaluate the supplied calculator expression.",
          tool_receipt_ids: [`${turnId}:calculator_receipt`],
          supports_goal: true,
          summary: `Calculator-backed result: ${expression} = 29.5.`,
          evidence_refs: [`${turnId}:calculator_receipt`],
          deterministic: true,
          model_invoked: false,
          created_at: "2026-06-16T00:00:00.000Z",
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt: prompt,
      workstation_tool_plan: plan,
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "calculator_solve",
        required_terminal_kind: "workstation_tool_evaluation",
      },
      source_target_intent: {
        schema: "helix.ask_source_target_intent.v1",
        target_source: "calculator_stream",
        target_kind: "calculator_stream",
      },
      route_product_contract: {
        ...modelOnlyContract(turnId),
        source_target: "calculator_stream",
        allowed_terminal_artifact_kinds: ["workstation_tool_evaluation", "model_synthesized_answer", "typed_failure"],
        required_terminal_kinds: ["workstation_tool_evaluation"],
      },
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: "Calculator-backed result: stale UI text.",
      final_answer_source: "final_answer_draft",
      terminal_artifact_kind: "model_synthesized_answer",
    };
    addCalculatorRuntimeProof(payload, `${turnId}:workstation_tool_evaluation`);

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(result.source).toBe("workstation_tool_evaluation");
    expect(payload.terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(payload.final_answer_source).toBe("workstation_tool_evaluation");
    expect((payload.terminal_answer_authority as Record<string, unknown>).final_answer_source).toBe(
      "workstation_tool_evaluation",
    );
    expect((payload.resolved_turn_summary as Record<string, unknown>).final_answer_source).toBe(
      "workstation_tool_evaluation",
    );
    expect((payload.resolved_turn_summary as Record<string, unknown>).resolved_route_label).toBe(
      "calculator_solve / workstation_tool_evaluation",
    );
    expect(payload.selected_final_answer).toContain("Calculator verification plan completed.");
    expect(payload.selected_final_answer).toContain(`Expression: ${expression}`);
    expect(payload.selected_final_answer).toContain("Result: 29.5");
    expect(payload.selected_final_answer).toContain("Trace source: scientific-calculator.solve_expression.");
    expect(payload.selected_final_answer).not.toContain("stale UI text");
    expect((payload.terminal_presentation as Record<string, unknown>).concise_text).toBe(payload.selected_final_answer);
    expect((payload.workstation_tool_terminal_synthesis as Record<string, unknown>).applied).toBe(true);
  });

  it("materializes calculator receipt into workstation evaluation when provider text mode does not return a terminal", () => {
    const turnId = "ask:test:calculator-receipt-materializes-workstation-evaluation";
    const receiptRef = `${turnId}:calculator_receipt`;
    const artifacts = [
      {
        artifact_id: receiptRef,
        kind: "calculator_receipt",
        payload: {
          schema: "helix.calculator_receipt.v1",
          kind: "calculator_receipt",
          capability_key: "scientific-calculator.solve_expression",
          expression: "2+2",
          normalized_expression: "2+2",
          result: "4",
          status: "succeeded",
          terminal_eligible: false,
          post_tool_model_step_required: true,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt:
        "Call scientific-calculator.solve_expression with this exact expression: 2+2. Wait for calculator_receipt and answer from workstation_tool_evaluation.",
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "calculator_solve",
        required_terminal_kind: "workstation_tool_evaluation",
      },
      source_target_intent: {
        schema: "helix.ask_source_target_intent.v1",
        target_source: "calculator_stream",
        target_kind: "calculator_stream",
        requested_outputs: ["calculator_receipt", "workstation_tool_evaluation"],
      },
      route_product_contract: {
        ...modelOnlyContract(turnId),
        source_target: "calculator_stream",
        allowed_terminal_artifact_kinds: ["workstation_tool_evaluation", "typed_failure", "request_user_input"],
        required_terminal_kinds: ["workstation_tool_evaluation"],
      },
      current_turn_artifact_ledger: artifacts,
      provider_reasoning_reentry: {
        schema: "helix.provider_reasoning_reentry.v1",
        status: "not_run",
        normalized_observation_packet_count: 1,
        solver_completed: true,
        goal_satisfaction_compatible: true,
      },
    };
    addCalculatorRuntimeProof(payload, receiptRef, "calculator_receipt");

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(result.source).toBe("workstation_tool_evaluation");
    expect(payload.terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(payload.final_answer_source).toBe("workstation_tool_evaluation");
    expect(payload.terminal_error_code).toBeUndefined();
    expect(payload.selected_final_answer).toContain("Calculator verification plan completed.");
    expect(payload.selected_final_answer).toContain("Expression: 2+2");
    expect(payload.selected_final_answer).toContain("Result: 4");
    expect(payload.workstation_tool_evaluation).toMatchObject({
      schema: "helix.workstation_tool_evaluation.v1",
      supports_goal: true,
      expression: "2+2",
      result_text: "4",
    });
    expect(artifacts.some((artifact) => artifact.kind === "workstation_tool_evaluation")).toBe(true);
  });

  it("materializes explicit calculator workstation evaluation requests from provider gateway turns", () => {
    const turnId = "ask:test:calculator-gateway-provider-terminal-frame";
    const receiptRef = `${turnId}:codex_normalized:calculator_receipt:1`;
    const artifacts = [
      {
        artifact_id: receiptRef,
        kind: "calculator_receipt",
        payload: {
          schema: "helix.calculator_receipt.v1",
          kind: "calculator_receipt",
          capability_key: "scientific-calculator.solve_expression",
          source_capability_id: "scientific-calculator.solve_expression",
          expression: "2+2",
          normalized_expression: "2+2",
          result: "4",
          status: "succeeded",
          terminal_eligible: false,
          post_tool_model_step_required: true,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt:
        "Call scientific-calculator.solve_expression with this exact expression: 2+2. Wait for calculator_receipt and answer from workstation_tool_evaluation.",
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "agent_provider_gateway_turn",
        requested_capability: "scientific-calculator.solve_expression",
        required_terminal_kind: "agent_provider_terminal_candidate",
        source: "codex_provider_workstation_gateway_projection",
        assistant_answer: false,
        raw_content_included: false,
      },
      provider_gateway_debug_summary: {
        schema: "helix.provider_gateway_debug_summary.v1",
        requested_capabilities: ["scientific-calculator.solve_expression"],
        admitted_capabilities: ["scientific-calculator.solve_expression"],
        executed_capabilities: ["scientific-calculator.solve_expression"],
        gateway_successful_tool_observation_count: 1,
        terminal_candidate_present: false,
        terminal_authority_granted: false,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: artifacts,
      provider_reasoning_reentry: {
        schema: "helix.provider_reasoning_reentry.v1",
        status: "not_run",
        normalized_observation_packet_count: 1,
        solver_completed: true,
        goal_satisfaction_compatible: true,
      },
    };
    addCalculatorRuntimeProof(payload, receiptRef, "calculator_receipt");

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(result.source).toBe("workstation_tool_evaluation");
    expect(payload.terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(payload.final_answer_source).toBe("workstation_tool_evaluation");
    expect(payload.terminal_error_code).toBeUndefined();
    expect(payload.selected_final_answer).toContain("Calculator verification plan completed.");
    expect(payload.selected_final_answer).toContain("Expression: 2+2");
    expect(payload.selected_final_answer).toContain("Result: 4");
    expect(payload.workstation_tool_evaluation).toMatchObject({
      schema: "helix.workstation_tool_evaluation.v1",
      source: "calculator_receipt_materialization",
      expression: "2+2",
      result_text: "4",
    });
    expect(artifacts.some((artifact) => artifact.kind === "workstation_tool_evaluation")).toBe(true);
  });

  it("lets satisfied calculator workstation evaluation supersede stale continuation state", () => {
    const turnId = "ask:test:calculator-evaluation-stale-continuation";
    const terminalText = "Calculator-backed result: ((sqrt(81)+ln(e^3))*7-5^2)/2 = 29.5.";
    const artifacts = [
      {
        artifact_id: `${turnId}:workstation_tool_evaluation`,
        kind: "workstation_tool_evaluation",
        payload: {
          schema: "helix.workstation_tool_evaluation.v1",
          evaluation_id: `${turnId}:workstation_tool_evaluation`,
          supports_goal: true,
          result_summary: terminalText,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "calculator_solve",
        required_terminal_kind: "workstation_tool_evaluation",
      },
      source_target_intent: {
        schema: "helix.ask_source_target_intent.v1",
        target_source: "calculator_stream",
        target_kind: "calculator_stream",
      },
      route_product_contract: {
        ...modelOnlyContract(turnId),
        source_target: "calculator_stream",
        allowed_terminal_artifact_kinds: ["workstation_tool_evaluation", "typed_failure"],
        required_terminal_kinds: ["workstation_tool_evaluation"],
      },
      goal_satisfaction_evaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        canonical_goal_kind: "calculator_solve",
        required_terminal_kind: "workstation_tool_evaluation",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
        observed_results: [
          {
            ref: `${turnId}:workstation_tool_evaluation`,
            kind: "workstation_tool_evaluation",
            status: "observed",
            supports_goal: true,
          },
        ],
      },
      solver_continuation_observation: {
        schema: "helix.solver_continuation_observation.v1",
        required_next_step: "model.synthesize_from_tool_observation",
      },
      pending_server_request: {
        schema: "helix.pending_server_request.v1",
        reason: "stale_continuation",
      },
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: "I could not produce a terminal answer for this turn.",
      final_answer_source: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      terminal_error_code: "pending_request_missing",
    };
    addCalculatorRuntimeProof(payload, `${turnId}:workstation_tool_evaluation`);

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(result.source).toBe("workstation_tool_evaluation");
    expect(result.rejected_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "stale_solver_continuation_superseded_by_workstation_terminal",
        }),
      ]),
    );
    expect(payload.terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(payload.final_answer_source).toBe("workstation_tool_evaluation");
    expect(payload.selected_final_answer).toBe(terminalText);
    expect(payload.terminal_error_code).toBeUndefined();
    expect(payload.pending_server_request).toBeUndefined();
    expect(payload.pending_request).toBeUndefined();
    expect(payload.stale_pending_server_request).toEqual(
      expect.objectContaining({ reason: "stale_continuation" }),
    );
  });

  it("materializes theory workstation evaluation from ledger preview text", () => {
    const turnId = "ask:test:theory-workstation-preview-terminal";
    const terminalText = [
      "I located this discussion in the Theory Badge Graph, then built a first-principles explanation route from that reflection.",
      "The graph route suggests the Needle Hull Mark 2 full solve is organized around hull geometry, Casimir cavity coupling, stability checks, and terminal solver policy.",
    ].join("\n");
    const artifacts = [
      {
        artifact_id: `${turnId}:theory_context_reflection_tool_receipt`,
        kind: "helix_theory_context_reflection_tool_receipt",
        payload: {
          schema: "helix.theory_context_reflection_tool_receipt.v1",
          capability: "helix_ask.reflect_theory_context",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: `${turnId}:workstation_tool_evaluation`,
        kind: "workstation_tool_evaluation",
        text_preview: terminalText,
        supports_goal: true,
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      active_prompt: "Tell me about the Needle Hull Mark 2 full solve in the badge graph. What are its main components ??",
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "theory_context_reflection",
        required_terminal_kind: "workstation_tool_evaluation",
      },
      route_product_contract: {
        ...modelOnlyContract(turnId),
        source_target: "theory_context_reflection",
        allowed_terminal_artifact_kinds: ["workstation_tool_evaluation", "model_synthesized_answer", "typed_failure"],
        required_terminal_kinds: ["workstation_tool_evaluation"],
        required_evidence: ["helix_theory_context_reflection_tool_receipt", "workstation_tool_evaluation"],
      },
      goal_satisfaction_evaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        canonical_goal_kind: "theory_context_reflection",
        required_terminal_kind: "workstation_tool_evaluation",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
        observed_results: [
          {
            ref: `${turnId}:theory_context_reflection_tool_receipt`,
            kind: "helix_theory_context_reflection_tool_receipt",
            status: "observed",
            supports_goal: true,
          },
          {
            ref: `${turnId}:workstation_tool_evaluation`,
            kind: "workstation_tool_evaluation",
            status: "observed",
            supports_goal: true,
          },
        ],
      },
      agent_runtime_loop: {
        schema: "helix.agent_runtime_loop.v1",
        iterations: [
          {
            decision_id: `${turnId}:agent_runtime_loop:decision:1`,
            chosen_capability: "helix_ask.reflect_theory_context",
            executed_action_key: "helix_ask.reflect_theory_context",
            next_step: "tool",
            runtime_tool_call: {
              capability_key: "helix_ask.reflect_theory_context",
            },
            observed_artifact_refs: [
              `${turnId}:theory_context_reflection_tool_receipt`,
              `${turnId}:workstation_tool_evaluation`,
            ],
            tool_observation: {
              status: "completed",
              ok: true,
              kind: "helix_theory_context_reflection_tool_receipt",
              capability: "helix_ask.reflect_theory_context",
            },
          },
        ],
      },
      agent_step_decision: {
        schema: "helix.agent_step_decision.v1",
        decision_id: `${turnId}:agent_step_decision:answer`,
        decision_timing: "post_observation_terminal_review",
        decision_authority: "deterministic_policy_fallback",
        next_step: "answer",
        chosen_capability: "model.direct_answer",
      },
      solver_continuation_observation: {
        schema: "helix.solver_continuation_observation.v1",
        required_next_step: "answer",
      },
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: "I could not complete this Ask turn because solver authority failed (solver_path_incomplete_before_terminal).",
      final_answer_source: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      terminal_error_code: "solver_path_incomplete_before_terminal",
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(result.source).toBe("workstation_tool_evaluation");
    expect(result.visible_text).toBe(terminalText);
    expect(result.rejected_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "stale_solver_continuation_superseded_by_workstation_terminal",
        }),
      ]),
    );
    expect(payload.terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(payload.final_answer_source).toBe("workstation_tool_evaluation");
    expect(payload.selected_final_answer).toBe(terminalText);
    expect(payload.terminal_error_code).toBeUndefined();
  });

  it("mirrors workstation terminal authority into single-writer selected fields", () => {
    const turnId = "ask:test:workstation-authority-mirror";
    const terminalRef = `${turnId}:workstation_tool_evaluation`;
    const terminalText = [
      "I located this discussion in the Theory Badge Graph, then built a first-principles explanation route from that reflection.",
      "The graph route supports a workstation terminal answer.",
    ].join("\n");
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      active_prompt: "Tell me about the Needle Hull Mark 2 full solve in the badge graph.",
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "theory_context_reflection",
      },
      route_product_contract: {
        ...modelOnlyContract(turnId),
        source_target: "theory_context_reflection",
        allowed_terminal_artifact_kinds: ["workstation_tool_evaluation", "model_synthesized_answer", "typed_failure"],
      },
      goal_satisfaction_evaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        canonical_goal_kind: "theory_context_reflection",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      agent_step_decision: {
        schema: "helix.agent_step_decision.v1",
        decision_id: `${turnId}:agent_step_decision:answer`,
        decision_timing: "post_observation_terminal_review",
        decision_authority: "deterministic_policy_fallback",
        next_step: "answer",
        chosen_capability: "model.direct_answer",
        assistant_answer: false,
        raw_content_included: false,
      },
      agent_runtime_loop: {
        schema: "helix.agent_runtime_loop.v1",
        iterations: [
          {
            decision_id: `${turnId}:agent_runtime_loop:decision:1`,
            chosen_capability: "helix_ask.reflect_theory_context",
            executed_action_key: "helix_ask.reflect_theory_context",
            next_step: "tool",
            decision_authority: "deterministic_policy_fallback",
            decision_timing: "post_observation",
            observed_artifact_refs: [
              `${turnId}:theory_context_reflection_tool_receipt`,
              terminalRef,
            ],
          },
          {
            decision_id: `${turnId}:agent_runtime_loop:decision:2`,
            chosen_capability: "model.direct_answer",
            next_step: "answer",
            decision_authority: "deterministic_policy_fallback",
            decision_timing: "terminal_review",
            observation_role: "model_answer_draft",
          },
        ],
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        terminal_artifact_kind: "workstation_tool_evaluation",
        final_answer_source: "workstation_tool_evaluation",
        terminal_artifact_id: terminalRef,
        terminal_text_preview: terminalText,
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        terminal_artifact_kind: "workstation_tool_evaluation",
        final_answer_source: "workstation_tool_evaluation",
        concise_text: terminalText,
        assistant_answer: false,
        raw_content_included: false,
      },
      selected_final_answer: terminalText,
      answer: terminalText,
      text: terminalText,
      final_answer_source: "workstation_tool_evaluation",
      terminal_artifact_kind: "workstation_tool_evaluation",
      terminal_artifact_id: terminalRef,
      current_turn_artifact_ledger: [
        {
          artifact_id: `${turnId}:theory_context_reflection_tool_receipt`,
          kind: "helix_theory_context_reflection_tool_receipt",
          payload: {
            schema: "helix.theory_context_reflection_tool_receipt.v1",
            capability: "helix_ask.reflect_theory_context",
            tool_id: "helix_ask.reflect_theory_context",
            assistant_answer: false,
            terminal_eligible: false,
          },
        },
      ],
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      payload,
      artifactLedger: payload.current_turn_artifact_ledger as unknown[],
    });

    expect(result.selected_terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(result.selected_terminal_artifact_ref).toBe(terminalRef);
    expect(result.source).toBe("workstation_tool_evaluation");
    expect(result.audit?.selectedArtifactKind).toBe("workstation_tool_evaluation");
    expect(result.audit?.selectedArtifactRef).toBe(terminalRef);
    expect(result.integrity.materialized_terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(result.integrity.materialized_terminal_artifact_ref).toBe(terminalRef);
    expect(payload.terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(payload.final_answer_source).toBe("workstation_tool_evaluation");
  });

  it("materializes theory reflection explanation drafts instead of terminalizing the workstation evaluation", () => {
    const turnId = "ask:test:theory-reflection-explanation-draft";
    const receiptRef = `${turnId}:theory_context_reflection_tool_receipt`;
    const evaluationRef = `${turnId}:workstation_tool_evaluation`;
    const draftRef = `${turnId}:theory_context_reflection_final_answer_draft`;
    const answerText = [
      "Needle Hull Mark 2 is organized around hull geometry, Casimir cavity coupling, stability checks, and terminal solver policy.",
      "The theory reflection is supporting evidence for those components; it is not the terminal answer by itself.",
    ].join("\n");
    const artifacts = [
      {
        artifact_id: receiptRef,
        kind: "helix_theory_context_reflection_tool_receipt",
        payload: {
          schema: "helix.theory_context_reflection_tool_receipt.v1",
          capability: "helix_ask.reflect_theory_context",
          tool_id: "helix_ask.reflect_theory_context",
          assistant_answer: false,
          terminal_eligible: false,
        },
      },
      {
        artifact_id: evaluationRef,
        kind: "workstation_tool_evaluation",
        payload: {
          schema: "helix.workstation_tool_evaluation.v1",
          evaluation_id: evaluationRef,
          result: "supports_subgoal",
          supports_goal: true,
          summary: "Theory reflection located discussion context as evidence only.",
          answer_text: "I located this discussion in the Theory Badge Graph.",
          evidence_refs: [receiptRef],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: draftRef,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          turn_id: turnId,
          goal_kind: "theory_context_reflection",
          required_terminal_kind: "theory_context_reflection_answer",
          authority: "llm_post_observation_composer",
          composer_scope: "source_tool_backed",
          llm_error_code: null,
          duration_ms: 0,
          text: answerText,
          artifact_refs: [receiptRef, evaluationRef],
          receipt_refs: [receiptRef],
          coverage_refs: [evaluationRef],
          support_refs: [receiptRef, evaluationRef],
          grounded_in_observation_refs: [receiptRef, evaluationRef],
          model_step_capability: "model.synthesize_from_theory_context_reflection",
          unsupported_claim_guard: {
            source_targeted: true,
            policy: "selected_artifacts_only",
          },
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      active_prompt: "Tell me about the Needle Hull Mark 2 full solve in the badge graph. What are its main components?",
      route_product_contract: {
        ...modelOnlyContract(turnId),
        source_target: "theory_locator",
        allowed_terminal_artifact_kinds: ["theory_context_reflection_answer", "model_synthesized_answer", "typed_failure", "request_user_input"],
        forbidden_terminal_artifact_kinds: ["workstation_tool_evaluation", "direct_answer_text", "tool_receipt"],
        side_artifact_kinds_allowed: ["helix_theory_context_reflection_tool_receipt", "workstation_tool_evaluation", "final_answer_draft"],
      },
      canonical_goal_frame: {
        schema: "helix.canonical_goal_frame.v1",
        goal_kind: "theory_context_reflection",
        required_terminal_kind: "theory_context_reflection_answer",
      },
      goal_satisfaction_evaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        canonical_goal_kind: "theory_context_reflection",
        required_terminal_kind: "theory_context_reflection_answer",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
        observed_results: [
          { ref: receiptRef, kind: "helix_theory_context_reflection_tool_receipt", status: "observed", supports_goal: true },
          { ref: evaluationRef, kind: "workstation_tool_evaluation", status: "observed", supports_goal: true },
          { ref: draftRef, kind: "final_answer_draft", status: "observed", supports_goal: true },
        ],
      },
      agent_runtime_loop: {
        schema: "helix.agent_runtime_loop.v1",
        iterations: [
          {
            iteration: 1,
            chosen_capability: "helix_ask.reflect_theory_context",
            executed_action_key: "helix_ask.reflect_theory_context",
            next_step: "tool",
            observed_artifact_refs: [receiptRef, evaluationRef],
          },
          {
            iteration: 2,
            chosen_capability: "model.synthesize_from_theory_context_reflection",
            next_step: "answer",
            observed_artifact_refs: [receiptRef, evaluationRef, draftRef],
          },
        ],
      },
      final_answer_draft: artifacts[2].payload,
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: "I located this discussion in the Theory Badge Graph.",
      final_answer_source: "workstation_tool_evaluation",
      terminal_artifact_kind: "workstation_tool_evaluation",
      terminal_artifact_id: evaluationRef,
      debug: {
        selected_final_answer: "I located this discussion in the Theory Badge Graph.",
        final_answer_source: "workstation_tool_evaluation",
        terminal_artifact_kind: "workstation_tool_evaluation",
        terminal_presentation: {
          schema: "helix.terminal_presentation.v1",
          terminal_artifact_kind: "workstation_tool_evaluation",
          concise_text: "I located this discussion in the Theory Badge Graph.",
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("theory_context_reflection_answer");
    expect(result.source).toBe("final_answer_draft");
    expect(result.visible_text).toBe(answerText);
    expect(payload.theory_context_reflection_answer).toMatchObject({
      schema: "helix.theory_context_reflection_answer.v1",
      answer_text: answerText,
      support_refs: expect.arrayContaining([receiptRef, evaluationRef]),
    });
    expect(payload.terminal_artifact_kind).toBe("theory_context_reflection_answer");
    expect(payload.final_answer_source).toBe("final_answer_draft");
    expect((payload.debug as Record<string, unknown>).terminal_artifact_kind).toBe("theory_context_reflection_answer");
    expect((payload.debug as Record<string, unknown>).final_answer_source).toBe("final_answer_draft");
    expect((payload.debug as Record<string, unknown>).selected_final_answer).toBe(answerText);
    expect((payload.debug as Record<string, unknown>).theory_context_reflection_answer).toMatchObject({
      answer_text: answerText,
      support_refs: expect.arrayContaining([receiptRef, evaluationRef]),
    });
    expect(result.integrity.receipt_visible_as_answer).toBe(false);
  });

  it("keeps calculator receipts as side artifacts when a final draft explains the result", () => {
    const turnId = "ask:test:calculator-draft";
    const artifacts = [
      {
        artifact_id: `${turnId}:receipt`,
        kind: "calculator_receipt",
        payload: { text: "2*(3+4)=14" },
      },
      {
        artifact_id: `${turnId}:draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: "2*(3+4) equals 14 because the parentheses are evaluated first: 3+4=7, then 2*7=14.",
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      route_product_contract: {
        ...modelOnlyContract(turnId),
        source_target: "calculator_stream",
        allowed_terminal_artifact_kinds: ["model_synthesized_answer", "typed_failure", "request_user_input"],
      },
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: "2*(3+4)=14",
    };
    addModelOnlyRuntimeProof(payload);

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(result.visible_text).toContain("2*7=14");
    expect(result.integrity.receipt_visible_as_answer).toBe(false);
  });

  it("materializes a Moral Graph answer only when the draft supports the Moral Graph observation", () => {
    const turnId = "ask:test:moral-graph-supported-draft";
    const moralRef = `${turnId}:moral_graph_reflection:1`;
    const answerText =
      "The Moral Graph frames this as agency-preserving disclosure: identify the dependency, the lost planning choices, and the repair path without making a character verdict.";
    const artifacts = [
      {
        artifact_id: moralRef,
        kind: "moral_graph_reflection",
        payload: {
          schema: "helix.moral_graph_reflection_observation.v1",
          artifact_id: moralRef,
          located_badge_ids: ["agency-preserving-disclosure", "dependency-transparency-gate"],
          claim_boundary_notes: ["procedural reflection, not character verdict"],
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: `${turnId}:draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: answerText,
          artifact_refs: [moralRef],
          support_refs: [moralRef],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt: "Use the Moral Graph reflection tool to reflect on withheld information and agency loss.",
      route_product_contract: moralGraphContract(turnId),
      canonical_goal_frame: {
        goal_kind: "moral_graph_reflection",
        required_terminal_kind: "model_synthesized_answer",
      },
      capability_plan: {
        capability_family: "moral_graph_reflection",
        requested_capability: "moral-graph.reflect_context",
        selected_capability: "moral-graph.reflect_context",
      },
      tool_call_admission_decision: {
        requested_capability: "moral-graph.reflect_context",
        requested_capability_family: "moral_graph_reflection",
        selected_capability: "moral-graph.reflect_context",
      },
      current_turn_artifact_ledger: artifacts,
      selected_final_answer: "Stale page-grounded equation evidence should not survive.",
    };
    addMoralGraphRuntimeProof(payload, moralRef);

    const materialized = materializeFinalAnswerDraftTerminal({
      turnId,
      payload,
      artifactLedger: artifacts,
      routeProductContract: moralGraphContract(turnId),
    });
    expect(materialized?.ok).toBe(true);
    expect(materialized?.materialized_terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(payload.model_synthesized_answer).toMatchObject({
      support_refs: expect.arrayContaining([moralRef]),
      source_families: expect.arrayContaining(["moral_graph_reflection"]),
    });

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(result.visible_text).toBe(answerText);
    expect(payload.selected_final_answer).toBe(answerText);
    expect(payload.selected_final_answer).not.toContain("equation evidence");
  });

  it("fails closed when a Moral Graph route has only stale scientific sidecar support", () => {
    const turnId = "ask:test:moral-graph-stale-sidecar-blocked";
    const moralRef = `${turnId}:moral_graph_reflection:1`;
    const staleScientificRef = `${turnId}:scientific_image_evidence:prior`;
    const staleCalculatorRef = `${turnId}:calculator_receipt:prior`;
    const artifacts = [
      {
        artifact_id: moralRef,
        kind: "moral_graph_reflection",
        payload: {
          schema: "helix.moral_graph_reflection_observation.v1",
          artifact_id: moralRef,
          located_badge_ids: ["agency-preserving-disclosure"],
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: staleScientificRef,
        kind: "scientific_image_evidence_continuity_summary",
        payload: {
          schema: "helix.scientific_image_evidence_continuity_summary.v1",
          text: "Stale page-grounded equation evidence.",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: staleCalculatorRef,
        kind: "calculator_receipt",
        payload: {
          schema: "helix.calculator_receipt.v1",
          expression: "stale prior expression",
          result: "42",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
      {
        artifact_id: `${turnId}:draft`,
        kind: "final_answer_draft",
        payload: {
          schema: "helix.final_answer_draft.v1",
          text: "I have page-grounded equation evidence available, so this can support a bounded conceptual reflection.",
          artifact_refs: [staleScientificRef, staleCalculatorRef],
          support_refs: [staleScientificRef, staleCalculatorRef],
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ];
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      thread_id: "thread:test",
      active_prompt: "Use the Moral Graph reflection tool. Reflect on withheld information and lost agency.",
      route_product_contract: moralGraphContract(turnId),
      canonical_goal_frame: {
        goal_kind: "moral_graph_reflection",
        required_terminal_kind: "model_synthesized_answer",
      },
      capability_plan: {
        capability_family: "moral_graph_reflection",
        requested_capability: "moral-graph.reflect_context",
        selected_capability: "moral-graph.reflect_context",
      },
      tool_call_admission_decision: {
        requested_capability: "moral-graph.reflect_context",
        requested_capability_family: "moral_graph_reflection",
        selected_capability: "moral-graph.reflect_context",
      },
      current_turn_artifact_ledger: artifacts,
      scholarly_pdf_workbench_state: {
        schema: "helix.scholarly_pdf_workbench_state.v1",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      scientific_image_evidence_continuation_lookup: {
        schema: "helix.scientific_image_evidence_continuation_lookup.v1",
        selected_evidence_ref: staleScientificRef,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      selected_final_answer: "I have page-grounded equation evidence available.",
    };
    addMoralGraphRuntimeProof(payload, moralRef);

    const materialized = materializeFinalAnswerDraftTerminal({
      turnId,
      payload,
      artifactLedger: artifacts,
      routeProductContract: moralGraphContract(turnId),
    });
    expect(materialized?.ok).toBe(false);
    expect(materialized?.blocked_reason).toBe("source_support_refs_missing");

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId,
      payload,
      artifactLedger: artifacts,
    });

    expect(result.selected_terminal_artifact_kind).toBe("typed_failure");
    expect(payload.terminal_artifact_kind).toBe("typed_failure");
    expect(["post_tool_model_step_missing", "terminal_projection_mismatch"]).toContain(payload.terminal_error_code);
    expect(String(payload.selected_final_answer)).not.toContain("page-grounded equation evidence available");
  });
});
