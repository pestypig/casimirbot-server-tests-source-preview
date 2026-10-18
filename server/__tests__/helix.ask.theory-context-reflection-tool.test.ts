import { describe, expect, it } from "vitest";

import { isHelixTheoryContextReflectionToolReceiptV1 } from "../../shared/contracts/helix-theory-context-reflection-tool-receipt.v1";
import type {
  HelixScholarlyFullTextObservation,
  HelixScholarlyResearchObservation,
} from "../../shared/helix-scholarly-research-observation";
import { runAskLevelTheoryContextReflectionTool } from "../services/helix-ask/theory-context-reflection-tool";

describe("Ask-level theory context reflection tool adapter", () => {
  it("wraps shared reflection as an Ask evidence receipt with requested panel sync", () => {
    const receipt = runAskLevelTheoryContextReflectionTool({
      turnId: "turn:ask-reflection",
      threadId: "thread:ask-reflection",
      prompt: "Where do source residual and QEI margin fit in the theory graph?",
      syncPanel: true,
      openPanel: false,
      panelOverlayMode: "live_answer_context",
    });

    expect(isHelixTheoryContextReflectionToolReceiptV1(receipt)).toBe(true);
    expect(receipt.authority.ask_context_policy).toBe("evidence_only");
    expect(receipt.reflectionV1.input.source).toBe("helix_ask");
    expect(receipt.explanationPlanV1?.terminal_eligible).toBe(false);
    expect(receipt.panelSync).toMatchObject({
      requested: true,
      applied: false,
      panelId: "theory-badge-graph",
      selectedLiveContextBlock: true,
      openPanel: false,
      overlayMode: "live_answer_context",
    });
  });

  it("builds reflection receipt without solving", () => {
    const receipt = runAskLevelTheoryContextReflectionTool({
      turnId: "turn:ask-reflection:no-solve",
      threadId: "thread:ask-reflection",
      prompt: "Map source residual and QEI margin in the theory graph.",
      buildExplanationPlan: false,
    });
    const serialized = JSON.stringify(receipt);

    expect(isHelixTheoryContextReflectionToolReceiptV1(receipt)).toBe(true);
    expect(receipt.explanationPlanV1).toBeNull();
    expect(serialized).not.toContain("calculatorArtifactV1");
    expect(serialized).not.toContain("runtimeReceiptV1");
  });

  it("optionally builds explanation plan", () => {
    const receipt = runAskLevelTheoryContextReflectionTool({
      turnId: "turn:ask-reflection:plan",
      threadId: "thread:ask-reflection",
      prompt: "Map source residual and QEI margin in the theory graph.",
      buildExplanationPlan: true,
    });

    expect(isHelixTheoryContextReflectionToolReceiptV1(receipt)).toBe(true);
    expect(receipt.explanationPlanV1).not.toBeNull();
    expect(receipt.explanationPlanV1?.terminal_eligible).toBe(false);
  });

  it("sets panelSync requested but not applied on the server", () => {
    const receipt = runAskLevelTheoryContextReflectionTool({
      turnId: "turn:ask-reflection:sync",
      threadId: "thread:ask-reflection",
      prompt: "Where does E=hf fit in the theory graph?",
      syncPanel: true,
    });

    expect(receipt.panelSync.requested).toBe(true);
    expect(receipt.panelSync.applied).toBe(false);
    expect(receipt.panelSync.overlayMode).toBe("live_answer_context");
  });

  it("does not return calculator/runtime receipts", () => {
    const receipt = runAskLevelTheoryContextReflectionTool({
      turnId: "turn:ask-reflection:no-runtime",
      threadId: "thread:ask-reflection",
      prompt: "Map Einstein tensor and source residual in the theory graph.",
      buildExplanationPlan: true,
    });
    const serialized = JSON.stringify(receipt);

    expect(serialized).not.toContain("scientific_calculator_step_trace");
    expect(serialized).not.toContain("theory_runtime_receipt");
    expect(serialized).not.toContain("starsim_runtime_receipt");
  });

  it("preserves authority false across receipt, reflection, and explanation plan", () => {
    const receipt = runAskLevelTheoryContextReflectionTool({
      turnId: "turn:ask-reflection:authority",
      threadId: "thread:ask-reflection",
      prompt: "Map source residual and QEI margin in the theory graph.",
      buildExplanationPlan: true,
    });

    expect(receipt.authority.assistant_answer).toBe(false);
    expect(receipt.authority.raw_content_included).toBe(false);
    expect(receipt.authority.terminal_eligible).toBe(false);
    expect(receipt.reflectionV1.assistant_answer).toBe(false);
    expect(receipt.reflectionV1.raw_content_included).toBe(false);
    expect(receipt.reflectionV1.terminal_eligible).toBe(false);
    expect(receipt.explanationPlanV1?.assistant_answer).toBe(false);
    expect(receipt.explanationPlanV1?.raw_content_included).toBe(false);
    expect(receipt.explanationPlanV1?.terminal_eligible).toBe(false);
  });

  it("maps scholarly observations into frontier literature evidence without terminal authority", () => {
    const scholarlyResearchObservation: HelixScholarlyResearchObservation = {
      schema: "helix.scholarly_research_observation.v1",
      artifact_id: "ask:server-frontier:scholarly_research_observation",
      turn_id: "ask:server-frontier",
      capability: "scholarly-research.lookup_papers",
      query: "qei_margin source residual",
      intent: "paper_search",
      providers_considered: ["arxiv"],
      providers_called: ["arxiv"],
      evidence_refs: [{
        ref: "arxiv:server-frontier",
        provider: "arxiv",
        retrieved_at_ms: 1781827200000,
      }],
      papers: [{
        result_id: "arxiv:server-frontier",
        title: "Synthetic frontier QEI paper",
        authors: [{ name: "Example Author" }],
        year: 2026,
        abstract: "The qei_margin = qei_bound - qei_sample diagnostic requires source residual closure.",
        identifiers: {
          arxiv_id: "2606.00002",
          url: "https://example.test/server-frontier",
        },
        evidence_refs: ["arxiv:server-frontier"],
        source_providers: ["arxiv"],
        confidence: "high",
      }],
      missing_requirements: [],
      selected_for_answer: true,
      assistant_answer: false,
      raw_content_included: false,
    };
    const scholarlyFullTextObservation: HelixScholarlyFullTextObservation = {
      schema: "helix.scholarly_full_text_observation.v1",
      artifact_id: "ask:server-frontier:scholarly_full_text_observation",
      turn_id: "ask:server-frontier",
      capability: "scholarly-research.fetch_full_text",
      query: scholarlyResearchObservation.query,
      paper_result_id: "arxiv:server-frontier",
      title: "Synthetic frontier QEI paper",
      source_kind: "pdf",
      source_pdf_ref: "artifact://scholarly-pdf/server-frontier.pdf",
      cache_integrity_hash: "sha256:server-frontier",
      total_pages: 5,
      pages_parsed: 5,
      page_text_refs: [],
      selected_chunks: [{
        chunk_id: "server-frontier-chunk",
        paper_result_id: "arxiv:server-frontier",
        title: "Synthetic frontier QEI paper",
        page_start: 2,
        page_end: 2,
        text_excerpt:
          "The source residual uses source_required and source_available in J/m^3 and cannot validate a physical mechanism.",
        relevance_score: 0.91,
        citation_ref: "arxiv:server-frontier#page=2",
        source_text_ref: "artifact://scholarly-pdf/server-frontier.pdf/page/2#text",
      }],
      visual_candidates: [],
      missing_requirements: [],
      selected_for_answer: true,
      assistant_answer: false,
      raw_content_included: false,
      context_policy: "compact_context_pack_only",
    };

    const receipt = runAskLevelTheoryContextReflectionTool({
      turnId: "turn:ask-reflection:frontier-literature",
      threadId: "thread:ask-reflection",
      prompt:
        "Run the Theory Frontier Seed Finder with scholarly full text and map extracted equations to semantic chunks.",
      buildExplanationPlan: true,
      scholarlyResearchObservation,
      scholarlyFullTextObservation,
    });

    expect(isHelixTheoryContextReflectionToolReceiptV1(receipt)).toBe(true);
    expect(receipt.frontierSearchV1?.artifactId).toBe("theory_frontier_search");
    expect(receipt.frontierLiteratureMapV1?.artifactId).toBe("theory_frontier_literature_map");
    expect(receipt.frontierLiteratureMapV1?.summary.mappingCount).toBeGreaterThan(0);
    expect(receipt.frontierLiteratureMapV1?.authority.assistant_answer).toBe(false);
    expect(receipt.frontierLiteratureMapV1?.authority.terminal_eligible).toBe(false);
    expect(receipt.frontierLiteratureMapV1?.authority.promotionAllowed).toBe(false);
  });
});
