import { describe, expect, it } from "vitest";

import { arbitrateAskSourceTarget } from "../services/helix-ask/ask-source-target-arbitrator";
import { buildToolCallAdmissionDecision } from "../services/helix-ask/tool-call-admission";
import { buildHelixCapabilityItinerary } from "../services/helix-ask/capability-itinerary";
import { buildToolUseRestatement } from "../services/helix-ask/internet-search-intent";
import { detectRepoCodeEvidenceIntent } from "../services/helix-ask/repo-code-intent-detector";
import { buildCommittedAskRoute } from "../services/helix-ask/committed-ask-route";
import { __testHelixRuntimeToolCallValidation } from "../routes/agi.plan";

const turnId = "ask:test-docs-search-admission";
const threadId = "thread:test-docs-search-admission";
const prompt = "Search docs for Helix Ask console debug and tell me which document path you found.";

describe("Helix Ask docs-search admission", () => {
  it("treats a natural named-document explanation as a hard Docs Viewer lookup", () => {
    const promptText = 'Ok we have a doc called "Casimir Dp Quantum Foam Study" what this abot?';
    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, promptText, sourceTargetIntent });
    const itinerary = buildHelixCapabilityItinerary({
      turnId,
      promptText,
      toolCallAdmissionDecision: admission,
      availableCapabilities: {
        capabilities: [
          { capability_key: "docs-viewer.search_docs", availability: "available" },
          { capability_key: "repo-code.search_concept", availability: "available" },
        ],
      },
    });

    expect(sourceTargetIntent).toMatchObject({
      target_source: "docs_viewer",
      strength: "hard",
      precedence_reason: "named_doc_summary_source_target",
      allow_no_tool_direct: false,
    });
    expect(sourceTargetIntent.reasons).toEqual(
      expect.arrayContaining(["named_document_title_suppresses_repo_entity_inference"]),
    );
    expect(admission).toMatchObject({
      source_target: "docs_viewer",
      required: true,
    });
    expect(admission.admitted_tool_families).toContain("docs_viewer");
    expect(admission.admitted_tool_families).not.toContain("model_only");
    expect(admission.forbidden_routes).toEqual(expect.arrayContaining(["model_only_concept", "no_tool_direct"]));
    expect(itinerary.relevant_tool_families).toEqual(["docs_viewer"]);
    expect(itinerary.terminal_success_criteria.required_observation_families).toEqual(["docs_viewer"]);
    expect(itinerary.planned_steps).toEqual([
      expect.objectContaining({
        tool_family: "docs_viewer",
        capability_hint: "docs-viewer.search_docs",
      }),
    ]);
  });

  it("routes a natural local-document lookup to Docs Viewer before repo-code inference", () => {
    const promptText = "Find the local document about Helix Ask terminal authority and tell me which document you used.";
    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, promptText, sourceTargetIntent });

    expect(sourceTargetIntent).toMatchObject({
      target_source: "docs_viewer",
      strength: "hard",
      precedence_reason: "natural_local_document_lookup_source_target",
      allow_no_tool_direct: false,
    });
    expect(sourceTargetIntent.reasons).toEqual(
      expect.arrayContaining(["explicit_local_document_scope_suppresses_repo_entity_inference"]),
    );
    expect(admission.admitted_tool_families).toContain("docs_viewer");
    expect(admission.admitted_tool_families).not.toContain("repo_code");
  });

  it.each([
    "Can you find the Casimir-DP quantum foam study?",
    "Find the NHM2 current status whitepaper.",
  ])("routes a definite multi-word named workspace artifact through Docs Viewer: %s", (promptText) => {
    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, promptText, sourceTargetIntent });

    expect(sourceTargetIntent).toMatchObject({
      target_source: "docs_viewer",
      strength: "hard",
      precedence_reason: "natural_local_document_lookup_source_target",
      allow_no_tool_direct: false,
    });
    expect(admission.admitted_tool_families).toContain("docs_viewer");
    expect(admission.admitted_tool_families).not.toContain("model_only");
    expect(admission.admitted_tool_families).not.toContain("scholarly_research");
  });

  it.each([
    "Find a study about magnetars.",
    "Find the best study about magnetars.",
    "Find the latest published magnetar study online.",
    "Do not find the Casimir-DP quantum foam study.",
    "Later, find the Casimir-DP quantum foam study.",
    "Earlier you found the Casimir-DP quantum foam study.",
    'The screen says "Find the Casimir-DP quantum foam study." Explain that text.',
  ])("does not reinterpret generic or dormant study language as a workspace document command: %s", (promptText) => {
    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, promptText, sourceTargetIntent });

    expect(sourceTargetIntent.precedence_reason, promptText).not.toBe(
      "natural_local_document_lookup_source_target",
    );
    expect(admission.admitted_tool_families, promptText).not.toContain("docs_viewer");
  });

  it("routes a natural docs-topic explanation through Docs Viewer before model-only synthesis", () => {
    const promptText = "Can you look for docs about NHM2 and explain what it is?";
    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, promptText, sourceTargetIntent });

    expect(sourceTargetIntent).toMatchObject({
      target_source: "docs_viewer",
      strength: "hard",
      precedence_reason: "natural_docs_topic_summary_source_target",
      allow_no_tool_direct: false,
    });
    expect(sourceTargetIntent.explicit_cues).toEqual(
      expect.arrayContaining(["natural_docs_topic_summary", "NHM2"]),
    );
    expect(admission.admitted_tool_families).toContain("docs_viewer");
    expect(admission.admitted_tool_families).not.toContain("model_only");
  });

  it("routes a natural trailing document name through Docs Viewer before model-only synthesis", () => {
    const promptText = "Okay, can you look at the NHM tube doc and explain what it's about?";
    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, promptText, sourceTargetIntent });

    expect(sourceTargetIntent).toMatchObject({
      target_source: "docs_viewer",
      strength: "hard",
      precedence_reason: "natural_docs_topic_summary_source_target",
      allow_no_tool_direct: false,
    });
    expect(sourceTargetIntent.explicit_cues).toEqual(
      expect.arrayContaining(["natural_docs_topic_summary", "NHM tube"]),
    );
    expect(admission.admitted_tool_families).toContain("docs_viewer");
    expect(admission.admitted_tool_families).not.toContain("model_only");
  });

  it("routes a named status document main-idea request through Docs Viewer", () => {
    const promptText = "Look at the NHM2 Status Document and give me the main idea.";
    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, promptText, sourceTargetIntent });

    expect(sourceTargetIntent).toMatchObject({
      target_source: "docs_viewer",
      strength: "hard",
      allow_no_tool_direct: false,
    });
    expect(admission.admitted_tool_families).toContain("docs_viewer");
    expect(admission.admitted_tool_families).not.toContain("model_only");
  });

  it("routes a named document relation follow-up through Docs Viewer", () => {
    const promptText = "And how does this relate to the Casimir DP quantum foam document?";
    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, promptText, sourceTargetIntent });

    expect(sourceTargetIntent).toMatchObject({
      target_source: "docs_viewer",
      strength: "hard",
      precedence_reason: "named_doc_relation_source_target",
      allow_no_tool_direct: false,
      requested_outputs: expect.arrayContaining(["doc_summary", "line_backed_source"]),
    });
    expect(sourceTargetIntent.explicit_cues).toEqual(
      expect.arrayContaining(["named_doc_relation", "Casimir DP quantum foam"]),
    );
    expect(admission.admitted_tool_families).toContain("docs_viewer");
    expect(admission.admitted_tool_families).not.toContain("model_only");
  });

  it("keeps contextual natural docs-topic language out of Docs Viewer admission", () => {
    const prompts = [
      "Do not look for docs about NHM2; just explain NHM2 generally.",
      "Later, look for docs about NHM2 and explain it.",
      "Earlier you looked for docs about NHM2 and explained it.",
      'The screen says "look for docs about NHM2 and explain it"; explain that UI text.',
      "Do not compare this with the Casimir DP quantum foam document.",
      "Later, compare this with the Casimir DP quantum foam document.",
      'The screen says "how does this relate to the Casimir DP quantum foam document?"; explain that UI text.',
    ];

    for (const promptText of prompts) {
      const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
      const admission = buildToolCallAdmissionDecision({ turnId, promptText, sourceTargetIntent });
      expect(sourceTargetIntent.precedence_reason, promptText).not.toBe("natural_docs_topic_summary_source_target");
      expect(admission.admitted_tool_families, promptText).not.toContain("docs_viewer");
    }
  });

  it("does not turn document mentions into hard Docs Viewer operations", () => {
    const prompts = [
      "NHM2 document",
      "Tell me about the NHM2 document.",
      "Tell me about the phrase NHM2 document.",
      "We were discussing the NHM2 document.",
      "The NHM2 document says the bridge is open.",
      'The screen shows "NHM2 document" as a label.',
    ];

    for (const promptText of prompts) {
      const restatement = buildToolUseRestatement(promptText);
      const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
      const admission = buildToolCallAdmissionDecision({ turnId, promptText, sourceTargetIntent });

      expect(restatement.requiredToolFamilies, promptText).not.toContain("docs_viewer");
      expect(sourceTargetIntent.strength, promptText).not.toBe("hard");
      expect(admission.admitted_tool_families, promptText).not.toContain("docs_viewer");
      expect(admission.admitted_tool_families, promptText).not.toContain("repo_code");
    }
  });

  it("gives explicit Docs operations precedence over soft repo-code inference", () => {
    const prompts = [
      "Search for the NHM2 document and explain it.",
      "Read the NHM2 Status document and summarize its main idea.",
      "Open the NHM2 document and tell me what it says.",
    ];

    for (const promptText of prompts) {
      const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
      const admission = buildToolCallAdmissionDecision({ turnId, promptText, sourceTargetIntent });

      expect(sourceTargetIntent, promptText).toMatchObject({
        target_source: "docs_viewer",
        strength: "hard",
        allow_no_tool_direct: false,
      });
      expect(admission.admitted_tool_families, promptText).toContain("docs_viewer");
      expect(admission.admitted_tool_families, promptText).not.toContain("repo_code");
      expect(admission.admitted_tool_families, promptText).not.toContain("internet_search");
    }
  });

  it("keeps a named-document search-read-summary compound prompt on Docs Viewer", () => {
    const promptText =
      'Find the document called "Casimir Dp Quantum Foam Study", read the best matching result, and explain what it is about in a short paragraph.';
    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, promptText, sourceTargetIntent });

    expect(sourceTargetIntent).toMatchObject({
      target_source: "docs_viewer",
      strength: "hard",
      precedence_reason: "named_doc_summary_source_target",
      allow_no_tool_direct: false,
    });
    expect(admission.admitted_tool_families).toContain("docs_viewer");
    expect(admission.admitted_tool_families).not.toContain("scholarly_research");
  });

  it("does not reinterpret repo-like words inside a document title as a repo-code subgoal", () => {
    const promptText = 'What is the doc called "Helix Ask Codex Loop Discipline" about?';
    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, promptText, sourceTargetIntent });
    const itinerary = buildHelixCapabilityItinerary({
      turnId,
      promptText,
      toolCallAdmissionDecision: admission,
      availableCapabilities: {
        capabilities: [
          { capability_key: "docs-viewer.search_docs", availability: "available" },
          { capability_key: "repo-code.search_concept", availability: "available" },
        ],
      },
    });

    expect(sourceTargetIntent.target_source).toBe("docs_viewer");
    expect(itinerary.relevant_tool_families).toEqual(["docs_viewer"]);
    expect(itinerary.relevant_tool_families).not.toContain("repo_code");
  });

  it("does not admit named-document lookup from contextual mentions", () => {
    const prompts = [
      'Do not look up the doc called "Casimir Dp Quantum Foam Study"; explain the wording only.',
      '\'We have a doc called "Casimir Dp Quantum Foam Study" what is it about?\' was my earlier prompt. Do not search now.',
      'If we later have a doc called "Casimir Dp Quantum Foam Study", what should we ask to learn what it is about?',
      'The visible text on screen says doc called "Casimir Dp Quantum Foam Study"; explain the label without searching.',
    ];

    for (const promptText of prompts) {
      const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
      const admission = buildToolCallAdmissionDecision({ turnId, promptText, sourceTargetIntent });
      expect(sourceTargetIntent.target_source).not.toBe("docs_viewer");
      expect(admission.admitted_tool_families).not.toContain("docs_viewer");
    }
  });

  it("treats affirmative local docs search as a hard docs-viewer evidence path", () => {
    const restatement = buildToolUseRestatement(prompt);
    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId,
      threadId,
      promptText: prompt,
    });
    const admission = buildToolCallAdmissionDecision({
      turnId,
      promptText: prompt,
      sourceTargetIntent,
    });
    const itinerary = buildHelixCapabilityItinerary({
      turnId,
      promptText: prompt,
      toolCallAdmissionDecision: admission,
      availableCapabilities: {
        capabilities: [
          {
            capability_key: "docs-viewer.search_docs",
            availability: "available",
          },
        ],
      },
    });

    expect(restatement.requiredToolFamilies).toContain("docs_viewer");
    expect(restatement.requiredToolFamilies).not.toContain("internet_search");
    expect(sourceTargetIntent).toMatchObject({
      target_source: "docs_viewer",
      strength: "hard",
      precedence_reason: "explicit_docs_search_source_target",
      allow_no_tool_direct: false,
    });
    expect(admission).toMatchObject({
      source_target: "docs_viewer",
      required: true,
      admitted_tool_families: ["docs_viewer"],
      reason: "docs_viewer_requires_document_tool_path",
    });
    expect(admission.forbidden_routes).toEqual(expect.arrayContaining(["model_only_concept", "no_tool_direct"]));
    expect(admission.forbidden_terminal_artifact_kinds).toEqual(expect.arrayContaining(["no_tool_direct", "model_only_concept"]));
    expect(itinerary.relevant_tool_families).toContain("docs_viewer");
    expect(itinerary.planned_steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool_family: "docs_viewer",
          capability_hint: "docs-viewer.search_docs",
          required_observation_kinds: expect.arrayContaining([
            "doc_search_results",
            "doc_candidate_validation",
            "doc_evidence_location",
          ]),
        }),
      ]),
    );
    expect(itinerary.terminal_success_criteria.typed_failure_codes).toContain("docs_viewer_observation_missing");
  });

  it("does not admit docs viewer from negated, quoted, historical, or explanatory docs-search mentions", () => {
    const prompts = [
      "Do not search docs for Helix Ask console debug; just explain what the prompt is asking.",
      '"Search docs for Helix Ask console debug" is the command I typed earlier; explain whether it should run.',
      "Earlier we searched docs for Helix Ask console debug; what kind of evidence should the next patch require?",
      "Explain what the docs viewer search tool is for without searching docs.",
    ];

    for (const promptText of prompts) {
      const restatement = buildToolUseRestatement(promptText);
      const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
      const admission = buildToolCallAdmissionDecision({ turnId, promptText, sourceTargetIntent });

      expect(restatement.requiredToolFamilies).not.toContain("docs_viewer");
      expect(sourceTargetIntent.target_source).not.toBe("docs_viewer");
      expect(admission.admitted_tool_families).not.toContain("docs_viewer");
    }
  });

  it("does not treat a Docs Viewer topic label as an active document command", () => {
    const promptText =
      "Docs Viewer: strongest dynamic surface for Helix Ask console evidence. Review this as an implementation claim, not the current document.";
    const restatement = buildToolUseRestatement(promptText);
    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, promptText, sourceTargetIntent });

    expect(restatement.requiredToolFamilies).not.toContain("docs_viewer");
    expect(sourceTargetIntent.target_source).not.toBe("docs_viewer");
    expect(sourceTargetIntent.target_source).not.toBe("active_doc");
    expect(sourceTargetIntent.requested_outputs).not.toContain("file_path");
    expect(admission.admitted_tool_families).not.toContain("docs_viewer");
    expect(admission.reason).not.toBe("docs_viewer_requires_document_tool_path");
  });

  it("does not treat a Docs Viewer capability-coverage claim as an active document command", () => {
    const promptText =
      "Docs Viewer: strongest dynamic surface. All 14 dynamic actions have some test evidence; core actions like open, locate_in_doc, summarize_doc, search_docs, and explain_paper are well represented.";
    const restatement = buildToolUseRestatement(promptText);
    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, promptText, sourceTargetIntent });

    expect(restatement.requiredToolFamilies).not.toContain("docs_viewer");
    expect(sourceTargetIntent.target_source).not.toBe("docs_viewer");
    expect(sourceTargetIntent.target_source).not.toBe("active_doc");
    expect(sourceTargetIntent.requested_outputs).not.toContain("file_path");
    expect(admission.admitted_tool_families).not.toContain("docs_viewer");
    expect(admission.reason).not.toBe("docs_viewer_requires_document_tool_path");
  });

  it("routes exact two-doc markdown comparison to Docs Viewer instead of repo-code", () => {
    const promptText =
      "Compare docs/helix-ask-flow.md and docs/helix-ask-codex-loop-discipline.md in a two-column table of the main routing rules.";
    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, promptText, sourceTargetIntent });
    const repoIntent = detectRepoCodeEvidenceIntent(promptText);

    expect(repoIntent).toMatchObject({
      repoEvidenceRequested: false,
      strength: "none",
    });
    expect(repoIntent.reasons).toContain("docs_viewer_exact_doc_path_request_not_repo_code");
    expect(sourceTargetIntent).toMatchObject({
      target_source: "docs_viewer",
      strength: "hard",
      precedence_reason: "explicit_docs_path_compare_source_target",
      allow_no_tool_direct: false,
    });
    expect(sourceTargetIntent.reasons).toEqual(expect.arrayContaining(["local_docs_path_suppresses_repo_code"]));
    expect(admission.admitted_tool_families).toContain("docs_viewer");
    expect(admission.admitted_tool_families).not.toContain("repo_code");
  });

  it("routes exact markdown locate plus synthesis to Docs Viewer locate instead of repo-code", () => {
    const promptText =
      "In docs/helix-ask-codex-loop-discipline.md, locate Patch-Time Contract and turn the evidence into a short runbook.";
    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, promptText, sourceTargetIntent });
    const repoIntent = detectRepoCodeEvidenceIntent(promptText);

    expect(repoIntent).toMatchObject({
      repoEvidenceRequested: false,
      strength: "none",
    });
    expect(sourceTargetIntent).toMatchObject({
      target_source: "docs_viewer",
      strength: "hard",
      precedence_reason: "explicit_docs_path_locate_synthesis_source_target",
      allow_no_tool_direct: false,
    });
    expect(sourceTargetIntent.requested_outputs).toEqual(expect.arrayContaining(["file_path", "tool_call_eligibility"]));
    expect(admission.admitted_tool_families).toContain("docs_viewer");
    expect(admission.admitted_tool_families).not.toContain("repo_code");
  });

  it("does not execute quoted bare docs-path commands as Docs Viewer or repo-code", () => {
    const promptText =
      '"Open docs/helix-ask-flow.md" is the command I typed earlier; explain whether that should run now.';
    const restatement = buildToolUseRestatement(promptText);
    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, promptText, sourceTargetIntent });
    const repoIntent = detectRepoCodeEvidenceIntent(promptText);

    expect(restatement.requiredToolFamilies).not.toContain("docs_viewer");
    expect(repoIntent.repoEvidenceRequested).toBe(false);
    expect(sourceTargetIntent.target_source).not.toBe("docs_viewer");
    expect(sourceTargetIntent.target_source).not.toBe("repo_code");
    expect(sourceTargetIntent.reasons).toEqual(expect.arrayContaining(["explicit_model_only_target"]));
    expect(admission.admitted_tool_families).not.toContain("docs_viewer");
    expect(admission.admitted_tool_families).not.toContain("repo_code");
    expect(admission.tool_admission_suppressed).toBe(true);
    expect(admission.suppression_reason).toBe("quoted_tool_command");
  });

  it("does not leave exact docs-path compare turns with a model-only committed route goal", () => {
    const promptText =
      "Compare docs/helix-ask-flow.md and docs/helix-ask-codex-loop-discipline.md in a two-column table of the main routing rules.";
    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, promptText, sourceTargetIntent });
    const committedRoute = buildCommittedAskRoute({
      turnId,
      promptText,
      selectedRoute: "docs_viewer.local_docs_path_compare",
      payload: {
        turn_id: turnId,
        source_target_intent: sourceTargetIntent,
        route_product_contract: {
          schema: "helix.route_product_contract.v1",
          turn_id: turnId,
          thread_id: threadId,
          source_target: "docs_viewer",
          allowed_terminal_artifact_kinds: ["doc_evidence_synthesis", "typed_failure", "request_user_input"],
          forbidden_terminal_artifact_kinds: ["direct_answer_text", "model_only_concept"],
          required_artifact_refs: [],
          precedence_reason: "explicit_docs_path_compare_source_target",
          assistant_answer: false,
          raw_content_included: false,
        },
        canonical_goal_frame: {
          turn_id: turnId,
          goal_kind: "doc_evidence_synthesis",
          answer_scope: "current_turn_doc",
          required_terminal_kind: "doc_evidence_synthesis_answer",
          classifier_reasons: ["explicit_docs_path_compare_goal", "evidence_target_arbitration_selected_docs_viewer"],
        },
        tool_call_admission_decision: admission,
      },
    });

    expect(sourceTargetIntent.target_source).toBe("docs_viewer");
    expect(sourceTargetIntent.precedence_reason).toBe("explicit_docs_path_compare_source_target");
    expect(committedRoute.canonical_goal.goal_kind).toBe("doc_evidence_synthesis");
    expect(committedRoute.canonical_goal.required_terminal_kind).toBe("doc_evidence_synthesis_answer");
    expect(committedRoute.compatibility.violations).not.toContain(
      "source_target_goal_mismatch:model_only_concept_for_source_backed_route",
    );
  });

  it("does not turn a Docs Viewer capability-coverage claim into a doc-open Ask turn", () => {
    const promptText =
      "Docs Viewer: strongest dynamic surface. All 14 dynamic actions have some test evidence; core actions like open, locate_in_doc, summarize_doc, search_docs, and explain_paper are well represented.";
    const sourceTargetIntent = arbitrateAskSourceTarget({ turnId, threadId, promptText });
    const admission = buildToolCallAdmissionDecision({ turnId, promptText, sourceTargetIntent });

    expect(sourceTargetIntent.target_source).not.toBe("docs_viewer");
    expect(sourceTargetIntent.target_source).not.toBe("active_doc");
    expect(sourceTargetIntent.reasons ?? []).toContain("docs_viewer_topic_label_not_active_doc_command");
    expect(sourceTargetIntent.suppressed_routes ?? []).toEqual(
      expect.arrayContaining(["active_doc_identity", "active_doc_summary", "doc_open_best"]),
    );
    expect(admission.admitted_tool_families).not.toContain("docs_viewer");
    expect(admission.admitted_tool_families).not.toContain("active_doc");
  });

  it("rejects repo-code runtime calls under hard docs-viewer admission", () => {
    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId,
      threadId,
      promptText: prompt,
    });
    const admission = buildToolCallAdmissionDecision({
      turnId,
      promptText: prompt,
      sourceTargetIntent,
    });
    const availableCapabilities = {
      capabilities: [
        {
          capability_key: "repo-code.search_concept",
          requires_action: true,
          availability: "available",
          goal_fit: "forbidden",
        },
        {
          capability_key: "docs-viewer.search_docs",
          requires_action: true,
          availability: "available",
          goal_fit: "primary",
        },
      ],
    } as any;

    const rejectedRepoCall = __testHelixRuntimeToolCallValidation.validateHelixRuntimeToolCall({
      availableCapabilities,
      toolCallAdmissionDecision: admission,
      call: {
        schema: "helix.runtime_tool_call.v1",
        turn_id: turnId,
        call_id: "call:repo-search",
        capability_key: "repo-code.search_concept",
        args: { query: "Helix Ask console debug" },
        assistant_answer: false,
        raw_content_included: false,
      },
    });

    expect(rejectedRepoCall.validation.valid).toBe(false);
    expect(rejectedRepoCall.validation.errors).toEqual(
      expect.arrayContaining([
        "forbidden_capability_for_goal",
        "runtime_capability_not_admitted_by_tool_policy:repo-code.search_concept:repo_code|runtime_evidence",
        "runtime_tool_forbidden_by_tool_policy:repo-code.search_concept",
      ]),
    );
  });

  it("does not runtime-suppress an explicit compound calculator subgoal omitted from blocked capability keys", () => {
    const promptText =
      "First call docs-viewer.locate_in_doc on docs/helix-ask-codex-loop-discipline.md for the query 'routes choose procedures'. Then call scientific-calculator.solve_expression on '19 + 23'. Synthesize both observations.";
    const admission = buildToolCallAdmissionDecision({
      turnId: "ask:compound-runtime-admission",
      promptText,
      sourceTargetIntent: {
        target_source: "docs_viewer",
        target_kind: "docs_viewer",
        explicit_cues: ["docs-viewer.locate_in_doc"],
      },
      canonicalGoalFrame: {
        goal_kind: "locate_in_doc",
        required_terminal_kind: "doc_location_matches",
      },
    });

    expect(admission.admitted_tool_families).toEqual(
      expect.arrayContaining(["docs_viewer", "calculator", "workstation_action"]),
    );
    expect(admission.forbidden_tool_families ?? []).not.toContain("calculator");

    const availableCapabilities = {
      schema: "helix.available_capabilities.v1",
      capabilities: [
        {
          capability_key: "scientific-calculator.solve_expression",
          requires_action: true,
          availability: "available",
          goal_fit: "primary",
        },
      ],
      tool_admission_suppressed: true,
      contextual_tool_suppression: {
        suppression_reason: "quoted_or_contextual_tool_reference",
        verb_or_cue: "on",
        blocked_capability_keys: ["model.direct_answer"],
        explicit_capability_override_keys: ["scientific-calculator.solve_expression"],
      },
    } as any;

    const validation = __testHelixRuntimeToolCallValidation.validateHelixRuntimeToolCall({
      availableCapabilities,
      toolCallAdmissionDecision: admission,
      call: {
        schema: "helix.runtime_tool_call.v1",
        turn_id: "ask:compound-runtime-admission",
        call_id: "call:calculator",
        capability_key: "scientific-calculator.solve_expression",
        args: { latex: "19 + 23" },
        assistant_answer: false,
        raw_content_included: false,
      },
    });

    expect(validation.validation.errors).not.toContain("contextual_tool_reference_suppressed");
    expect(validation.validation.errors).not.toContain(
      "runtime_capability_family_forbidden_by_tool_policy:scientific-calculator.solve_expression:calculator",
    );
    expect(validation.validation.valid).toBe(true);
  });
});
