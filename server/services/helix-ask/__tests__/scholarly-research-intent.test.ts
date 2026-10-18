import { describe, expect, it } from "vitest";
import {
  deriveDirectScholarlyPortfolioQueries,
  detectScholarlyResearchIntent,
  extractScholarlyArxivId,
  hasFullyNegatedScholarlyResearchInstruction,
} from "../scholarly-research-intent";
import { arbitrateAskSourceTarget } from "../ask-source-target-arbitrator";

describe("scholarly research intent", () => {
  it("does not admit scholarly research from a quoted tool identifier in a calculator request", () => {
    const intent = detectScholarlyResearchIntent(
      "Use the Scientific Calculator to compute (8 * 9) + 1. The string `internet-search.search_web` is only a non-executable example. Report the numeric result only.",
    );

    expect(intent.researchRequested).toBe(false);
    expect(intent.explicitCues).not.toContain("research_lookup_action");
    expect(intent.explicitCues).not.toContain("scholarly_full_text_or_pdf");
  });

  it("keeps a calculator check with prior-paper context out of scholarly lookup", () => {
    const prompt =
      "Can you use the calculator to check 8 times 9, then explain how that simple check differs from evaluating the paper's equation candidate?";
    const intent = detectScholarlyResearchIntent(prompt);

    expect(intent.researchRequested).toBe(false);
    expect(intent.explicitCues).not.toContain("research_lookup_action");
    expect(arbitrateAskSourceTarget({
      turnId: "ask:test:calculator-with-paper-context",
      threadId: "thread:test",
      promptText: prompt,
    })).toMatchObject({
      target_source: "calculator_stream",
      target_kind: "calculator_stream",
      precedence_reason: "calculator_tool_source_target",
    });
  });

  it("routes a deictic calculator verification through the calculator stream", () => {
    expect(arbitrateAskSourceTarget({
      turnId: "ask:test:deictic-calculator-check",
      threadId: "thread:test",
      promptText: "Check that in the calculator.",
    })).toMatchObject({
      target_source: "calculator_stream",
      target_kind: "calculator_stream",
      strength: "hard",
      allow_no_tool_direct: false,
    });
  });

  it("still admits an explicit request to cross-check scholarly literature", () => {
    const intent = detectScholarlyResearchIntent(
      "Cross-check the scholarly literature for primary studies about magnetar giant flares.",
    );

    expect(intent.researchRequested).toBe(true);
    expect(intent.explicitCues).toContain("research_lookup_action");
  });

  it("plans lookup and full text for an analytical comparison of a named paper", () => {
    const intent = detectScholarlyResearchIntent(
      "Compare the assumptions in arXiv 2105.03079 with the NHM2 whitepaper and explain which mismatch matters most.",
    );

    expect(intent).toMatchObject({
      researchRequested: true,
      scholarlyIntent: {
        requires_full_text: true,
        terminal_evidence_requirement: "full_text",
        evidence_demand: {
          required_modes: ["full_text"],
          derivation_reasons: ["analytical_paper_comparison_requires_full_text"],
        },
      },
    });
    expect(intent.plannedScholarlyCapabilityChain.planned_capabilities).toEqual([
      "scholarly-research.lookup_papers",
      "scholarly-research.fetch_full_text",
    ]);
    expect(intent.plannedScholarlyCapabilityChain.terminal_evidence_requirement).toBe("full_text");
  });

  it("keeps a citation request scoped to the currently open local document", () => {
    const intent = detectScholarlyResearchIntent(
      "According to the currently open NHM2 status whitepaper, identify the unresolved blockers. Use only the current document and cite section headings.",
    );

    expect(intent.researchRequested).toBe(false);
  });

  it("keeps an explicit repo-relative docs path out of scholarly research", () => {
    const intent = detectScholarlyResearchIntent(
      "Open docs/research/nhm2-current-status-whitepaper.md. Within section \u201c6.7 Twin Paradox trip clocking interpretation,\u201d return only complete prose sentences containing the literal lowercase token alpha. Exclude display equations, headings, identifiers, and sentence fragments. Preserve original wording and line numbers. Do not summarize.",
    );

    expect(intent.researchRequested).toBe(false);
  });

  it("keeps local docs and repo citation requests on their explicit evidence tools", () => {
    const prompts = [
      "Use docs-viewer.locate_in_doc to find the section in the open document. Answer only from the docs-viewer observation and cite the document evidence.",
      "Use repo-code.search_concept to find terminal authority. Answer only from repo/code evidence and cite file paths.",
    ];

    for (const prompt of prompts) {
      expect(detectScholarlyResearchIntent(prompt).researchRequested).toBe(false);
    }
  });

  it("keeps full-text suitability checks metadata-only when fetching and Image Lens are negated", () => {
    const intent = detectScholarlyResearchIntent(
      "Find research papers about quantum inequality sampling constraints. Explain which returned papers have a structured source suitable for attempting full-text parsing. Do not use Image Lens and do not fetch full text.",
    );

    expect(intent.researchRequested).toBe(true);
    expect(intent.fullTextRequested).toBe(false);
    expect(intent.scholarlyIntent.requested_workflow).toBe("metadata_search");
    expect(intent.scholarlyIntent.requires_full_text).toBe(false);
    expect(intent.scholarlyIntent.requested_outputs).toEqual(["paper_metadata"]);
    expect(intent.scholarlyIntent.evidence_demand).toMatchObject({
      alternatives: [{ product: "paper_metadata", minimum_depth: "metadata_lookup" }],
      required_modes: [],
      minimum_satisfying_depth: "metadata_lookup",
    });
  });

  it("selects a typographically quoted paper title for metadata-only lookup", () => {
    const intent = detectScholarlyResearchIntent([
      "LOOKUP_SMOKE_03 — Search arXiv for “Quantum Field Theory Constrains Traversable Wormhole Geometries” by Ford and Roman.",
      "Use scholarly lookup only and return the title, authors, DOI, and arXiv ID.",
      "Do not fetch full text or inspect PDF pages.",
    ].join(" "));

    expect(intent.researchRequested).toBe(true);
    expect(intent.normalizedQuery).toBe("Quantum Field Theory Constrains Traversable Wormhole Geometries");
    expect(intent.scholarlyIntent.query_normalization_reasons).toEqual(["quoted_topic_selected"]);
    expect(intent.scholarlyIntent.requested_workflow).toBe("metadata_search");
    expect(intent.plannedScholarlyCapabilityChain.planned_capabilities)
      .toEqual(["scholarly-research.lookup_papers"]);
  });

  it("extracts the topic from a natural primary-paper recommendation request", () => {
    const intent = detectScholarlyResearchIntent(
      "Can you give me a good primary research paper about magnetars that we can work with?",
    );

    expect(intent.researchRequested).toBe(true);
    expect(intent.normalizedQuery).toBe("magnetars");
    expect(intent.scholarlyIntent.query_normalization_reasons).toEqual([
      "explicit_primary_paper_topic_selected",
    ]);
    expect(intent.plannedScholarlyCapabilityChain.planned_capabilities).toEqual([
      "scholarly-research.lookup_papers",
    ]);
  });

  it("reduces a polite citation request to its scholarly topic", () => {
    const intent = detectScholarlyResearchIntent(
      "Okay, can you cite research about magnetars?",
    );

    expect(intent.researchRequested).toBe(true);
    expect(intent.normalizedQuery).toBe("magnetars");
    expect(intent.plannedScholarlyCapabilityChain.planned_capabilities).toEqual([
      "scholarly-research.lookup_papers",
    ]);
  });

  it.each([
    "Okay, can you look for papers about a magnetar?",
    "Could you look for papers about a magnetar?",
  ])("routes a natural paper lookup through scholarly evidence: %s", (prompt) => {
    const intent = detectScholarlyResearchIntent(prompt);

    expect(intent).toMatchObject({
      researchRequested: true,
      strength: "hard",
      normalizedQuery: "magnetar",
    });
    expect(intent.explicitCues).toContain("scholarly_paper_lookup");
    expect(intent.plannedScholarlyCapabilityChain.planned_capabilities).toEqual([
      "scholarly-research.lookup_papers",
    ]);
    expect(arbitrateAskSourceTarget({
      turnId: "ask:natural-magnetar-paper-lookup",
      threadId: "helix-ask:test",
      promptText: prompt,
      activeWorkspaceSourceResolution: {
        active_panel_id: "docs-viewer",
        active_doc_path: "docs/research/nhm2-current-status-whitepaper.md",
      },
    })).toMatchObject({
      target_source: "scholarly_research",
      target_kind: "scholarly_research",
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
    });
  });

  it.each([
    "Do not look for papers about a magnetar; answer from general knowledge.",
    "Later, look for papers about a magnetar. For now, explain what a magnetar is.",
    "If needed, look for papers about a magnetar; do not do that now.",
    'The prior instruction was "look for papers about a magnetar"; explain the wording only.',
    "I looked for papers about magnetars earlier; do not search again.",
    "The screen says look for papers about a magnetar; explain the label without executing it.",
  ])("does not execute a contextual natural paper lookup: %s", (prompt) => {
    expect(arbitrateAskSourceTarget({
      turnId: `ask:contextual-natural-paper:${prompt.length}`,
      threadId: "helix-ask:test",
      promptText: prompt,
    }).target_source).toBe("model_only");
  });

  it("plans direct full-text retrieval without an unwanted lookup subgoal", () => {
    const intent = detectScholarlyResearchIntent(
      "Use scholarly-research.fetch_full_text directly on https://arxiv.org/pdf/2401.12345. Report whether machine-readable full text was obtained. Do not run scholarly-research.lookup_papers or use Image Lens.",
    );

    expect(intent.researchRequested).toBe(true);
    expect(intent.arxivId).toBe("2401.12345");
    expect(intent.plannedScholarlyCapabilityChain.planned_capabilities)
      .toEqual(["scholarly-research.fetch_full_text"]);
    expect(intent.plannedScholarlyCapabilityChain.terminal_evidence_requirement).toBe("full_text");
  });

  it("treats an affirmative quoted PDF affordance as a direct fetch", () => {
    const prompt =
      'extract this "Full-text / PDF affordance - PDF: https://arxiv.org/pdf/astro-ph/0503030v1.pdf - Full-text URL: http://arxiv.org/abs/astro-ph/0503030v1" into research docs';
    const intent = detectScholarlyResearchIntent(prompt);

    expect(intent).toMatchObject({
      researchRequested: true,
      arxivId: "astro-ph/0503030v1",
      fullTextRequested: true,
    });
    expect(intent.plannedScholarlyCapabilityChain.planned_capabilities).toEqual([
      "scholarly-research.fetch_full_text",
    ]);
  });

  it("treats supplied scholarly links as supporting context instead of an implicit full-text command", () => {
    const prompt = [
      "Dan Dennett may be wrong if consciousness is holographic and the self is represented across microtubule frequency scales.",
      "https://ingentaconnect.com/content/imp/jcs/2026/00000033/f0020001/art00013;jsessionid=synthetic-session-id",
      "Small holographic regions may recover a lower-resolution image.",
      "https://pubmed.ncbi.nlm.nih.gov/2813384/",
      "https://karlpribram.com/wp-content/uploads/pdf/theory/T-167.pdf",
    ].join(" ");
    const intent = detectScholarlyResearchIntent(prompt);

    expect(intent).toMatchObject({
      researchRequested: true,
      strength: "soft",
      pmid: "2813384",
      supportingSourceOnly: true,
      fullTextRequested: false,
      scholarlyIntent: {
        requested_workflow: "metadata_search",
        requires_full_text: false,
        supporting_sources_only: true,
      },
    });
    expect(intent.sourceUrls).toEqual([
      "https://ingentaconnect.com/content/imp/jcs/2026/00000033/f0020001/art00013",
      "https://pubmed.ncbi.nlm.nih.gov/2813384/",
      "https://karlpribram.com/wp-content/uploads/pdf/theory/T-167.pdf",
    ]);
    expect(intent.sourceTargets.map((target) => [target.kind, target.retrieval_strategy])).toEqual([
      ["publisher", "direct_full_text"],
      ["pubmed", "metadata_lookup"],
      ["pdf", "direct_full_text"],
    ]);
    expect(intent.normalizedQuery).not.toMatch(/https?:\/\/|jsessionid/i);
    expect(intent.plannedScholarlyCapabilityChain.planned_capabilities).toEqual([
      "scholarly-research.fetch_full_text",
      "scholarly-research.lookup_papers",
    ]);
    expect(arbitrateAskSourceTarget({
      turnId: "ask:mixed-conceptual-supporting-sources",
      threadId: "helix-ask:test",
      promptText: prompt,
    })).toMatchObject({
      target_source: "scholarly_research",
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
    });
  });

  it("keeps an explicitly labeled source portfolio supporting despite incidental retrieval wording", () => {
    const prompt = [
      "Evaluate the hypothesis rather than merely reporting retrieval status.",
      "Treat these as supporting sources, continue reasoning if one is unavailable, and keep evidence boundaries explicit.",
      "https://ingentaconnect.com/content/imp/jcs/2026/00000033/f0020001/art00013",
      "https://pubmed.ncbi.nlm.nih.gov/2813384/",
      "https://karlpribram.com/wp-content/uploads/pdf/theory/T-167.pdf",
      "Do not search the repo.",
    ].join(" ");
    const intent = detectScholarlyResearchIntent(prompt);

    expect(intent).toMatchObject({
      researchRequested: true,
      supportingSourceOnly: true,
      strength: "soft",
    });
    expect(intent.sourceTargets).toHaveLength(3);
    expect(intent.plannedScholarlyCapabilityChain.planned_capabilities).toEqual([
      "scholarly-research.fetch_full_text",
      "scholarly-research.lookup_papers",
    ]);
  });

  it("keeps a repo-only search prohibition scoped away from an admitted scholarly citation", () => {
    const prompt = [
      "Evaluate a multiscale holographic-self hypothesis.",
      "Treat the source as supporting context and keep evidence boundaries explicit.",
      "https://pubmed.ncbi.nlm.nih.gov/2813384/",
      "Do not search the repo.",
    ].join(" ");

    expect(detectScholarlyResearchIntent(prompt)).toMatchObject({
      researchRequested: true,
      supportingSourceOnly: true,
    });
    expect(arbitrateAskSourceTarget({
      turnId: "ask:scoped-repo-prohibition-scholarly-source",
      threadId: "helix-ask:test",
      promptText: prompt,
    })).toMatchObject({
      target_source: "scholarly_research",
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
    });
  });

  it("keeps URL examples model-only when every current scholarly action is negated", () => {
    const prompt = [
      "Do not fetch, look up, open, or search any source now.",
      "These URLs are examples only: https://pubmed.ncbi.nlm.nih.gov/2813384/",
      "and https://karlpribram.com/wp-content/uploads/pdf/theory/T-167.pdf.",
      "Explain what evidence would be needed without claiming those papers were inspected.",
    ].join(" ");

    expect(detectScholarlyResearchIntent(prompt).researchRequested).toBe(false);
    expect(arbitrateAskSourceTarget({
      turnId: "ask:negated-scholarly-url-examples",
      threadId: "helix-ask:test",
      promptText: prompt,
    }).target_source).toBe("model_only");
  });

  it("resolves DOI metadata before a requested dependent full-text fetch", () => {
    const intent = detectScholarlyResearchIntent(
      "Look up DOI 10.1073/pnas.86.20.8152, fetch accessible full text if available, and summarize the fetched evidence.",
    );

    expect(intent.scholarlyIntent).toMatchObject({
      requested_workflow: "full_text_summary",
      requires_full_text: false,
      terminal_evidence_requirement: "metadata",
      evidence_demand: {
        alternatives: [{ product: "paper_metadata", minimum_depth: "metadata_lookup" }],
        required_modes: [],
        optional_modes: ["full_text"],
        minimum_satisfying_depth: "metadata_lookup",
        derivation_reasons: ["conditional_full_text_allows_metadata_fallback"],
      },
    });
    expect(intent.plannedScholarlyCapabilityChain.planned_capabilities).toEqual([
      "scholarly-research.lookup_papers",
      "scholarly-research.fetch_full_text",
    ]);
    expect(intent.plannedScholarlyCapabilityChain.terminal_evidence_requirement).toBe("metadata");
  });

  it("keeps an affirmative PMID metadata lookup when full text is negated", () => {
    const intent = detectScholarlyResearchIntent(
      "Look up PMID 2813384 and report its metadata. Do not fetch full text.",
    );

    expect(intent).toMatchObject({
      researchRequested: true,
      pmid: "2813384",
      fullTextRequested: false,
    });
    expect(intent.plannedScholarlyCapabilityChain.planned_capabilities).toEqual([
      "scholarly-research.lookup_papers",
    ]);
  });

  it("does not execute a future PMID lookup", () => {
    const prompt =
      "Later, if needed, look up PMID 2813384. For now explain the evidence boundary without running tools.";

    expect(detectScholarlyResearchIntent(prompt).researchRequested).toBe(true);
    expect(arbitrateAskSourceTarget({
      turnId: "ask:future-pmid-lookup",
      threadId: "helix-ask:test",
      promptText: prompt,
    }).target_source).toBe("model_only");
  });

  it("keeps explicit general-web citation searches out of scholarly research", () => {
    expect(detectScholarlyResearchIntent(
      "Search the web for current OpenAI API status and cite the sources you use.",
    ).researchRequested).toBe(false);
  });

  it("recognizes a natural-language direct fetch for an old-style arXiv identifier", () => {
    const prompt =
      "FULLTEXT_SMOKE_01 — Fetch and parse the full text for arXiv gr-qc/9510071. Return the title, parsed page count, and one page-numbered passage or equation. Do not search for other papers.";
    const intent = detectScholarlyResearchIntent(prompt);

    expect(intent).toMatchObject({
      researchRequested: true,
      arxivId: "gr-qc/9510071",
      fullTextRequested: true,
      scholarlyIntent: {
        requested_workflow: "full_text_summary",
        terminal_evidence_requirement: "full_text",
        evidence_demand: {
          satisfaction: "any_of",
          required_modes: ["full_text"],
          optional_modes: ["equation_extraction", "page_image_parse"],
          minimum_satisfying_depth: "full_text",
        },
      },
    });
    expect(intent.plannedScholarlyCapabilityChain.planned_capabilities)
      .toEqual(["scholarly-research.fetch_full_text"]);

    expect(arbitrateAskSourceTarget({
      turnId: "ask:scholarly-natural-direct-full-text",
      threadId: "helix-ask:test",
      promptText: prompt,
    })).toMatchObject({
      target_source: "scholarly_research",
      target_kind: "scholarly_research",
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
    });
  });

  it("recognizes a bare old-style arXiv identity in an affirmative extraction follow-up", () => {
    const prompt = "extract that magnetar paper, astro-ph/0503030v1";
    const intent = detectScholarlyResearchIntent(prompt);

    expect(extractScholarlyArxivId(prompt)).toBe("astro-ph/0503030v1");
    expect(intent).toMatchObject({
      researchRequested: true,
      arxivId: "astro-ph/0503030v1",
      fullTextRequested: true,
    });
    expect(intent.plannedScholarlyCapabilityChain.planned_capabilities).toEqual([
      "scholarly-research.fetch_full_text",
    ]);
  });

  it("does not turn fully negated, quoted, historical, or future scholarly wording into a current route", () => {
    const prompts = [
      "Do not search arXiv for Ford and Roman. Do not fetch full text; answer from general knowledge.",
      '"Search arXiv for Ford and Roman" was the prior instruction. Do not fetch full text; explain the instruction.',
      "I searched arXiv for Ford and Roman earlier. Do not fetch full text; summarize what the request means.",
      "Later, if needed, search arXiv for Ford and Roman. Do not fetch full text; for now answer from general knowledge.",
    ];

    for (const [index, promptText] of prompts.entries()) {
      expect(arbitrateAskSourceTarget({
        turnId: `ask:scholarly-contextual-${index}`,
        threadId: "helix-ask:test",
        promptText,
      }).target_source).toBe("model_only");
    }
  });

  it("keeps an affirmative page mount active when later inspection operations are negated", () => {
    const prompt = [
      "Use the selected paper from the prior step.",
      "Mount PDF page 1 as a source only.",
      "Do not inspect, crop, OCR, analyze, extract, or read it yet.",
      "Report whether typed page-mount evidence was created.",
    ].join(" ");

    expect(hasFullyNegatedScholarlyResearchInstruction(prompt)).toBe(false);
  });

  it("does not resurrect a naturally worded direct fetch when full text is explicitly negated", () => {
    const prompt =
      "Do not fetch or parse the full text for arXiv gr-qc/9510071; answer from general knowledge.";
    const intent = detectScholarlyResearchIntent(prompt);

    expect(intent.fullTextRequested).toBe(false);
    expect(intent.plannedScholarlyCapabilityChain.planned_capabilities)
      .not.toContain("scholarly-research.fetch_full_text");
    expect(arbitrateAskSourceTarget({
      turnId: "ask:scholarly-negated-natural-direct-full-text",
      threadId: "helix-ask:test",
      promptText: prompt,
    }).target_source).toBe("model_only");
  });

  it("preserves lookup then fetch when both steps are affirmatively requested", () => {
    const intent = detectScholarlyResearchIntent(
      "Use scholarly-research.lookup_papers to resolve https://arxiv.org/abs/2401.12345, then use scholarly-research.fetch_full_text.",
    );

    expect(intent.plannedScholarlyCapabilityChain.planned_capabilities).toEqual([
      "scholarly-research.lookup_papers",
      "scholarly-research.fetch_full_text",
    ]);
  });

  it("keeps full-text portfolio instructions out of the scholarly search query", () => {
    const intent = detectScholarlyResearchIntent(
      "Find research papers about quantum inequality sampling constraints in curved spacetime. Fetch the best three accessible sources and summarize only from full text.",
    );

    expect(intent.researchRequested).toBe(true);
    expect(intent.normalizedQuery).toBe("quantum inequality sampling constraints in curved spacetime");
    expect(intent.scholarlyIntent.requested_workflow).toBe("full_text_summary");
  });

  it("splits an explicit three-topic full-text request into a bounded lookup portfolio", () => {
    expect(deriveDirectScholarlyPortfolioQueries(
      "quantum-inequality constraints on negative energy, traversable wormholes, or warp drives",
      3,
    )).toEqual([
      "quantum-inequality constraints on negative energy",
      "quantum-inequality constraints on traversable wormholes",
      "quantum-inequality constraints on warp drives",
    ]);
  });
});
