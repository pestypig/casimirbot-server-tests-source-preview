import { describe, expect, it } from "vitest";
import {
  buildScholarlyAnalyticalEvidencePromptLines,
  buildScholarlyCurrentPromptIdentifierRecoveryBody,
  candidateHasInlineImageLensSource,
  ensureCodexPreGatewayRouteAuthority,
  isScholarlyFollowupReferencePrompt,
  scoreScholarlyMemoryForQuestion,
  scholarlyPdfSelectedAffordanceFromRuntimeLoop,
  shouldAttemptScholarlyPromptRecovery,
} from "../codex-provider";
import { readWorkstationGatewayCallRequestsForTurn } from "../explicit-workstation-gateway";
import { arbitrateAskSourceTarget } from "../../ask-source-target-arbitrator";
import {
  buildPromptDerivedCalculatorSolveGatewayCallRequests,
  buildPromptDerivedTheoryReflectionGatewayCallRequests,
} from "../prompt-named-tool-requests";

const recoveryFor = (question: string) => buildScholarlyCurrentPromptIdentifierRecoveryBody({
  body: {
    agent_runtime: "codex",
    question,
    committed_ask_route: { schema: "helix.committed_ask_route.v1", route: { source_target: "scientific_image_evidence" } },
    workstation_gateway_call: {
      capability_id: "visual_analysis.inspect_image_region",
      arguments: { source_id: "pdf-page-render:stale" },
    },
  },
  question,
});

describe("current-prompt exact scholarly recovery", () => {
  it("requires passage-level conditions for analytical full-text follow-ups", () => {
    const lines = buildScholarlyAnalyticalEvidencePromptLines({
      question:
        "Which assumption mismatch matters most if someone applies that paper directly, and what remains unresolved?",
      evidenceState: "full_text_usable",
      passageSelectionSource: "cached_pdf_followup_rerank",
    });

    expect(lines.join("\n")).toContain("name the concrete assumptions");
    expect(lines.join("\n")).toContain("Cite their bounded passage references");
    expect(lines.join("\n")).toContain("unresolved transfer");
    expect(buildScholarlyAnalyticalEvidencePromptLines({
      question: "What is this paper called?",
      evidenceState: "full_text_usable",
      passageSelectionSource: "cached_pdf_followup_rerank",
    })).toEqual([]);
  });

  it("admits the recrowned Step 3 QTE prompt after a runtime restart", () => {
    const recovery = recoveryFor(
      "Continue from selected-paper evidence ref `ask:paper:memory`, retained rendered-page evidence ref `pdf-page-render:stale`, and the pinned workflow objective: \"Fetch and parse the full text for arXiv gr-qc/9510071. Return the paper title, parsed page count, and one page-numbered passage or equation supporting a quantum inequality. Do not search for other papers.\". The retained page ref is a provenance anchor; use it as the Image Lens `source_id` only when the active source also carries materializable page-image data. Inspect the already mounted PDF page 2 with Image Lens. If its image bytes are unavailable after a runtime restart, re-materialize page 2 directly from the canonical DOI, arXiv identifier, or canonical paper URL in the typed paper evidence or pinned objective, without a broad lookup or selecting another paper. Then run `visual_analysis.inspect_image_region` on page 2 to extract the first displayed equation as observation-only evidence.",
    );

    expect(recovery).toMatchObject({
      query: "arXiv:gr-qc/9510071",
      identifier_kind: "arxiv",
    });
  });

  it("admits exact arXiv rematerialization while preserving a no-other-papers objective", () => {
    const recovery = recoveryFor([
      "Continue from stale page ref `pdf-page-render:stale` and the pinned objective:",
      '"Fetch and parse the full text for arXiv gr-qc/9510071. Do not search for other papers."',
      "If image bytes are unavailable after restart, re-materialize page 2 directly from the canonical arXiv identifier.",
      "Then inspect page 2 with Image Lens.",
    ].join(" "));

    expect(recovery).toMatchObject({
      query: "arXiv:gr-qc/9510071",
      source: "current_prompt_exact_scholarly_identifier",
      identifier_kind: "arxiv",
    });
    expect(recovery?.body.question).toContain("Restrict retrieval to this exact identifier");
    expect(recovery?.body.question).toContain("Materialize PDF page 2");
    expect(recovery?.body.question).not.toContain("pdf-page-render:stale");
    expect(recovery?.body.committed_ask_route).toBeUndefined();
    expect(recovery?.body.workstation_gateway_call).toBeUndefined();

    const gatewayRequests = readWorkstationGatewayCallRequestsForTurn({
      body: recovery?.body ?? {},
      includePlannerDerived: true,
    });
    expect(gatewayRequests).toHaveLength(1);
    expect(gatewayRequests[0]).toMatchObject({
      capability_id: "scholarly-research.fetch_full_text",
      arguments: {
        source_url: "https://arxiv.org/pdf/gr-qc/9510071.pdf",
        source_target_intent: {
          arxiv_id: "gr-qc/9510071",
          terminal_evidence_requirement: "full_text",
        },
      },
    });
  });

  it("re-materializes an exact current-prompt page even when stale prior paper memory exists", () => {
    expect(shouldAttemptScholarlyPromptRecovery({
      currentPromptRecoveryPresent: true,
      priorRecordPresent: true,
      lookupStatus: "found",
    })).toBe(true);
    expect(shouldAttemptScholarlyPromptRecovery({
      currentPromptRecoveryPresent: false,
      priorRecordPresent: true,
      lookupStatus: "found",
    })).toBe(false);
    expect(shouldAttemptScholarlyPromptRecovery({
      currentPromptRecoveryPresent: false,
      priorRecordPresent: false,
      lookupStatus: "missing",
    })).toBe(true);
  });

  it("lets an explicit equation inspection dominate incidental provenance wording", () => {
    const question = [
      "Continue from the retained page ref as a provenance anchor.",
      "Inspect only PDF page 2 with Image Lens and extract the first displayed equation.",
      "If page 2 has no candidate, stop; the workflow will choose at most one bounded adjacent-page retry.",
      "Report the source id, page number, crop ref, and extraction status.",
    ].join(" ");
    expect(scholarlyPdfSelectedAffordanceFromRuntimeLoop(question)).toBe("find_first_displayed_equation");
    expect(scholarlyPdfSelectedAffordanceFromRuntimeLoop(
      "Audit provenance for the retained evidence chain and report which paper and page are in use.",
    )).toBe("audit_provenance");
  });

  it("requires actual inline image bytes before treating a PDF page candidate as materialized", () => {
    expect(candidateHasInlineImageLensSource({
      page_image_ref: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
    })).toBe(true);
    expect(candidateHasInlineImageLensSource({
      page_image_ref: "pdf-page-render:magnetar-page-2",
      source_image_ref: "artifact://magnetar.pdf#page=2",
    })).toBe(false);
  });

  it("recognizes a natural this-document equation follow-up as retained scholarly work", () => {
    expect(isScholarlyFollowupReferencePrompt(
      "Ok can you find an equation we can use in this doc?",
    )).toBe(true);
  });

  it("prefers the selected paper's PDF memory for a natural numbered-page Image Lens follow-up", () => {
    const common = {
      schema: "helix.scholarly_followup_evidence_memory_record.v1",
      memory_id: "memory:test",
      turn_id: "turn:test",
      thread_keys: ["thread:test"],
      stored_at_ms: Date.now(),
      terminal_artifact_kind: "compound_evidence_synthesis_answer",
      selected_for_answer: true,
      selected_for_exploration: false,
      runtime_selected_result_ids: ["openalex:selected-paper"],
      runtime_semantic_selection_status: "matched",
      evidence_grade: "answer_grade",
      paper_count: 1,
      papers: [{
        result_id: "openalex:selected-paper",
        title: "SN 2015bn",
        identifiers: { doi: "10.3847/example" },
      }],
      abstract_or_snippet_refs: [],
      missing_requirements: [],
      next_affordances: [],
      observation_refs: [],
      page_image_affordance_refs: [],
      page_image_observation_refs: [],
      equation_evidence_refs: [],
      scientific_evidence_packet_refs: [],
      theory_badge_graph_reflection_refs: [],
      provider_gateway_packet_refs: [],
      source_result_error: null,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    const lookupRecord = {
      ...common,
      memory_id: "memory:lookup",
      source_capability_id: "scholarly-research.lookup_papers",
      query: "Magnetar that we can use for a multi-step analysis",
      evidence_state: "lookup_usable",
      source_pdf_ref: null,
      cache_path: null,
      page_text_refs: [],
    } as any;
    const fullTextRecord = {
      ...common,
      memory_id: "memory:full-text",
      source_capability_id: "scholarly-research.fetch_full_text",
      query: "SN 2015bn",
      evidence_state: "full_text_usable",
      source_pdf_ref: "artifact://scholarly-pdf/selected.pdf",
      cache_path: "C:\\cache\\selected.pdf",
      page_text_refs: ["artifact://scholarly-pdf/selected.pdf/page/2#text"],
    } as any;
    const question = [
      "Use the Magnetar paper you just fetched.",
      "Open page 2 in Image Lens, but do not analyze it yet.",
    ].join(" ");

    expect(scoreScholarlyMemoryForQuestion(fullTextRecord, question))
      .toBeGreaterThan(scoreScholarlyMemoryForQuestion(lookupRecord, question));
  });

  it("prefers full-text memory for an analytical assumption-boundary follow-up", () => {
    const common = {
      schema: "helix.scholarly_followup_evidence_memory_record.v1",
      turn_id: "turn:test",
      thread_keys: ["thread:test"],
      stored_at_ms: Date.now(),
      terminal_artifact_kind: "compound_evidence_synthesis_answer",
      selected_for_answer: true,
      selected_for_exploration: false,
      runtime_selected_result_ids: ["arxiv:selected-paper"],
      runtime_semantic_selection_status: "matched",
      evidence_grade: "answer_grade",
      paper_count: 1,
      papers: [{
        result_id: "arxiv:selected-paper",
        title: "Warp Drive With Zero Expansion",
        identifiers: { arxiv_id: "gr-qc/0107097" },
      }],
      abstract_or_snippet_refs: [],
      missing_requirements: [],
      next_affordances: [],
      observation_refs: [],
      page_image_affordance_refs: [],
      page_image_observation_refs: [],
      equation_evidence_refs: [],
      scientific_evidence_packet_refs: [],
      theory_badge_graph_reflection_refs: [],
      provider_gateway_packet_refs: [],
      source_result_error: null,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    const lookupRecord = {
      ...common,
      memory_id: "memory:lookup",
      source_capability_id: "scholarly-research.lookup_papers",
      query: "warp drive zero expansion",
      evidence_state: "lookup_usable",
      source_pdf_ref: null,
      cache_path: null,
      page_text_refs: [],
    } as any;
    const fullTextRecord = {
      ...common,
      memory_id: "memory:full-text",
      source_capability_id: "scholarly-research.fetch_full_text",
      query: "Warp Drive With Zero Expansion",
      evidence_state: "full_text_usable",
      source_pdf_ref: "artifact://scholarly-pdf/selected.pdf",
      cache_path: "C:\\cache\\selected.pdf",
      page_text_refs: ["artifact://scholarly-pdf/selected.pdf/page/2#text"],
    } as any;
    const question =
      "Which assumption mismatch matters most if someone applies that paper directly, and what does it not validate?";

    expect(scoreScholarlyMemoryForQuestion(fullTextRecord, question))
      .toBeGreaterThan(scoreScholarlyMemoryForQuestion(lookupRecord, question));
  });

  it.each([
    {
      question: "Can you use the calculator to check 8 times 9, then explain how that simple check differs from evaluating the paper's equation candidate?",
      targetSource: "calculator_stream",
      capability: "scientific-calculator.solve_expression",
    },
    {
      question: "Now reflect what we learned from this paper, the equation search, and the calculator check into the Theory Badge Graph. Separate what the evidence supports from what remains unresolved.",
      targetSource: "theory_locator",
      capability: "helix_ask.reflect_theory_context",
    },
  ])("preserves the current explicit $targetSource operator over a prior-paper follow-up referent", ({
    question,
    targetSource,
    capability,
  }) => {
    expect(isScholarlyFollowupReferencePrompt(question)).toBe(true);
    const body: Record<string, unknown> = {
      question,
      source_target_intent: arbitrateAskSourceTarget({
        turnId: `ask:test:${targetSource}`,
        threadId: "thread:test",
        promptText: question,
      }),
    };
    const currentRequests = targetSource === "calculator_stream"
      ? buildPromptDerivedCalculatorSolveGatewayCallRequests(body)
      : buildPromptDerivedTheoryReflectionGatewayCallRequests(body);
    expect(currentRequests).toHaveLength(1);
    expect(body.source_target_intent).toMatchObject({ target_source: targetSource });

    ensureCodexPreGatewayRouteAuthority({
      body,
      turnId: `ask:test:${targetSource}`,
    });

    expect(body.source_target_intent).toMatchObject({ target_source: targetSource });
    expect(body.tool_call_admission_decision).toMatchObject({
      required: true,
      requested_capability: capability,
      selected_capability: capability,
      admitted_capability: capability,
    });
  });

  it.each([
    "Do not use this doc to find an equation.",
    "Later, find an equation we can use in this document.",
    "Earlier you tried to find an equation in this PDF.",
    'The screen says "find an equation in this doc"; explain that message.',
  ])("does not admit non-current document-followup wording: %s", (question) => {
    expect(isScholarlyFollowupReferencePrompt(question)).toBe(false);
  });

  it.each([
    'The UI says "audit provenance for this paper"; inspect page 2 and extract the displayed equation.',
    "Previously we audited provenance for this paper; inspect page 2 and extract the displayed equation.",
    "Later we could audit provenance for this paper; inspect page 2 and extract the displayed equation.",
  ])("does not let contextual audit language override affirmative visual work: %s", (question) => {
    expect(scholarlyPdfSelectedAffordanceFromRuntimeLoop(question)).toBe("find_first_displayed_equation");
  });

  it("admits an exact DOI and canonical URL only for affirmative current execution", () => {
    expect(recoveryFor(
      "Re-materialize page 4 directly from DOI 10.1103/PhysRevD.53.5496, then inspect that PDF page.",
    )).toMatchObject({
      query: "10.1103/physrevd.53.5496",
      identifier_kind: "doi",
    });
    expect(recoveryFor(
      "Reload page 3 directly from canonical URL https://arxiv.org/pdf/2401.12345.pdf, then inspect the PDF page.",
    )).toMatchObject({
      query: "arXiv:2401.12345",
      identifier_kind: "arxiv",
    });
  });

  it.each([
    "The UI says \"re-materialize page 2 from arXiv gr-qc/9510071\"; treat that as screen text only.",
    "Previously we re-materialized page 2 from arXiv gr-qc/9510071.",
    "Later we could re-materialize page 2 from arXiv gr-qc/9510071.",
    "If needed, re-materialize page 2 from arXiv gr-qc/9510071.",
    "Do not re-materialize or fetch page 2 from arXiv gr-qc/9510071.",
    "Inspect stale source pdf-page-render:stale on page 2 without retrieving a paper.",
  ])("does not execute contextual, negated, or stale-ref-only text: %s", (question) => {
    expect(recoveryFor(question)).toBeNull();
  });
});
