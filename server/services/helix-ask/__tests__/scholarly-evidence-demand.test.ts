import { describe, expect, it } from "vitest";
import { deriveScholarlyEvidenceDemand } from "../scholarly-evidence-demand";

describe("scholarly evidence demand", () => {
  it("models passage or equation as alternative evidence products", () => {
    const demand = deriveScholarlyEvidenceDemand({
      promptText: [
        "Fetch and parse the full text for arXiv gr-qc/9510071.",
        "Return one page-numbered passage or equation supporting a quantum inequality.",
        "Do not search for other papers.",
      ].join(" "),
      workflow: "full_text_summary",
    });

    expect(demand).toMatchObject({
      satisfaction: "any_of",
      required_modes: ["full_text"],
      optional_modes: ["equation_extraction", "page_image_parse"],
      minimum_satisfying_depth: "full_text",
      derivation_reasons: ["passage_or_equation_is_disjunctive"],
    });
    expect(demand.alternatives).toEqual([
      {
        product: "page_grounded_passage",
        minimum_depth: "full_text",
        exactness: "bounded",
      },
      {
        product: "exact_equation",
        minimum_depth: "page_image_parse",
        exactness: "exact",
      },
    ]);
  });

  it("keeps an exact equation request on the page-image rail", () => {
    expect(deriveScholarlyEvidenceDemand({
      promptText: "Fetch the full text, then extract and transcribe its main equation exactly.",
      workflow: "full_text_summary",
    })).toMatchObject({
      satisfaction: "all_of",
      required_modes: ["equation_extraction", "page_image_parse", "full_text"],
      optional_modes: [],
      minimum_satisfying_depth: "page_image_parse",
      alternatives: [{
        product: "exact_equation",
        minimum_depth: "page_image_parse",
        exactness: "exact",
      }],
    });
  });

  it("scopes negated, historical, future, conditional, and quoted equation cues", () => {
    const prompts = [
      "Fetch full text and return a passage. Do not use Image Lens or extract equations.",
      "Previously I extracted the main equation. Fetch full text and return a passage now.",
      "Fetch full text and return a passage. Later, if needed, transcribe the main equation.",
      "Fetch full text and return a passage. If full text fails, use Image Lens to inspect an equation.",
      "Fetch full text and return a passage. The phrase `extract the equation exactly` is only an example.",
    ];

    for (const promptText of prompts) {
      expect(deriveScholarlyEvidenceDemand({
        promptText,
        workflow: "full_text_summary",
      })).toMatchObject({
        required_modes: ["full_text"],
        optional_modes: [],
        minimum_satisfying_depth: "full_text",
      });
    }
  });

  it("keeps an affirmative page render as a page-image requirement", () => {
    expect(deriveScholarlyEvidenceDemand({
      promptText: "Render and inspect PDF page 4 before answering.",
      workflow: "full_text_summary",
    })).toMatchObject({
      required_modes: ["page_image_parse", "full_text"],
      minimum_satisfying_depth: "page_image_parse",
    });
  });

  it("requires full text for a natural request to pull useful parts from a selected paper", () => {
    expect(deriveScholarlyEvidenceDemand({
      promptText: "Let's use this one. Pull out the useful parts.",
    })).toMatchObject({
      satisfaction: "all_of",
      required_modes: ["full_text"],
      optional_modes: [],
      minimum_satisfying_depth: "full_text",
      alternatives: [{
        product: "full_text_summary",
        minimum_depth: "full_text",
        exactness: "bounded",
      }],
      derivation_reasons: ["full_text_output_requested"],
    });
  });

  it("requires full text when a user naturally asks to get the selected paper PDF", () => {
    expect(deriveScholarlyEvidenceDemand({
      promptText: "Can you get the PDF for that paper and tell me what measurements it reports?",
    })).toMatchObject({
      satisfaction: "all_of",
      required_modes: ["full_text"],
      optional_modes: [],
      minimum_satisfying_depth: "full_text",
      derivation_reasons: ["full_text_output_requested"],
    });
  });

  it("does not attach a later identifier qualifier to an explicit full-text command", () => {
    expect(deriveScholarlyEvidenceDemand({
      promptText: [
        'Find one PDF-accessible primary paper for "Magnetar".',
        "Select exactly one paper, fetch or materialize its full text, and report its DOI or arXiv ID when available.",
      ].join(" "),
      workflow: "full_text_summary",
    })).toMatchObject({
      satisfaction: "all_of",
      required_modes: ["full_text"],
      optional_modes: [],
      minimum_satisfying_depth: "full_text",
      derivation_reasons: ["full_text_output_requested"],
    });
  });

  it("keeps an immediately qualified full-text fetch optional", () => {
    expect(deriveScholarlyEvidenceDemand({
      promptText: "Find the paper and fetch accessible full text if available, then report its metadata.",
      workflow: "full_text_summary",
    })).toMatchObject({
      required_modes: [],
      optional_modes: ["full_text"],
      minimum_satisfying_depth: "metadata_lookup",
      derivation_reasons: ["conditional_full_text_allows_metadata_fallback"],
    });
  });

  it("requires full text for a natural analytical comparison of a named paper", () => {
    expect(deriveScholarlyEvidenceDemand({
      promptText:
        "Compare the assumptions in arXiv 2105.03079 with the NHM2 whitepaper and explain which mismatch matters most.",
    })).toMatchObject({
      satisfaction: "all_of",
      required_modes: ["full_text"],
      optional_modes: [],
      minimum_satisfying_depth: "full_text",
      alternatives: [{
        product: "full_text_summary",
        minimum_depth: "full_text",
        exactness: "bounded",
      }],
      derivation_reasons: ["analytical_paper_comparison_requires_full_text"],
    });
  });

  it("does not execute historical, future, conditional, negated, or quoted paper comparisons", () => {
    const prompts = [
      "Previously I compared this paper with NHM2. Just list the paper metadata now.",
      "Later compare this paper with NHM2. For now, just list the paper metadata.",
      "If we compare this paper with NHM2, we should inspect its assumptions. Just list metadata now.",
      "Do not compare this paper with NHM2; only list its metadata.",
      'The phrase "compare this paper with NHM2" is an example. Just list metadata.',
    ];

    for (const promptText of prompts) {
      expect(deriveScholarlyEvidenceDemand({ promptText })).toMatchObject({
        required_modes: [],
        optional_modes: [],
        minimum_satisfying_depth: "metadata_lookup",
        derivation_reasons: ["metadata_evidence_satisfies_requested_workflow"],
      });
    }
  });
});
