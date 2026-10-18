import { describe, expect, it } from "vitest";
import {
  buildEvidenceUnitsFromText,
  selectEvidencePassages,
  selectEvidencePassagesWithCoverage,
} from "../retrieval/evidence-passage-selection";

describe("evidence passage selection", () => {
  it("keeps sentence boundaries and gives exact query terms priority over generic metadata", () => {
    const units = [
      ...buildEvidenceUnitsFromText({
        page: 1,
        text: "Abstract. This magnetar paper discusses future telescopes and broad emission geometry.",
      }),
      ...buildEvidenceUnitsFromText({
        page: 3,
        text: "Results. We show that line energy is linear with line width within error bars. The magnetic flux tube shape can be determined when width, depth, and energy are studied concurrently.",
      }),
    ];

    const passages = selectEvidencePassages({
      units,
      query: 'What does it say about "line energy is linear with line width"?',
      source_ref: "artifact://scholarly-pdf/test.pdf",
      title: "Probing Magnetars Using Spectral Lines",
      max_passages: 2,
    });

    expect(passages[0]).toMatchObject({ page: 3, section: "Results" });
    expect(passages[0]?.text).toContain("line energy is linear with line width within error bars.");
    expect(passages[0]?.text.trim().endsWith(".")).toBe(true);
    expect(passages[0]?.citation_ref).toMatch(/#page=3&char=\d+-\d+/);
    expect(passages[0]?.citation_label).toBe("Probing Magnetars Using Spectral Lines, p. 3, Results");
  });

  it("uses structural summary sections when a casual prompt has no topical terms", () => {
    const units = buildEvidenceUnitsFromText({
      page: 1,
      text: [
        "Title page material without a claim.",
        "",
        "Abstract",
        "The study reports a bounded diagnostic result and explicitly withholds a physical viability claim.",
        "",
        "References",
        "A long reference entry about an unrelated historical source.",
      ].join("\n"),
    });

    const passages = selectEvidencePassages({
      units,
      query: "Can you explain what this paper is about?",
      source_ref: "artifact://scholarly-pdf/summary.pdf",
      title: "Bounded Study",
      max_passages: 1,
    });

    expect(passages[0]).toMatchObject({ section: "Abstract" });
    expect(passages[0]?.text).toContain("withholds a physical viability claim");
  });

  it("keeps content after an inline section label", () => {
    const units = buildEvidenceUnitsFromText({
      page: 3,
      text: "Results. The model reports constraints and caveats for the proposed field.",
    });

    expect(units).toEqual([
      expect.objectContaining({
        page: 3,
        section: "Results",
        text: "The model reports constraints and caveats for the proposed field.",
      }),
    ]);
  });

  it("covers assumptions and limitations for analytical comparison prompts", () => {
    const units = buildEvidenceUnitsFromText({
      text: [
        "# Abstract",
        "The paper reports a generic energy-condition result for warp geometries.",
        "",
        "# Assumptions",
        "The derivation assumes unit lapse and a flat spatial three-metric.",
        "",
        "# Limitations",
        "The result does not validate a particular engineered source or a lapse-extended construction.",
      ].join("\n"),
    });

    const passages = selectEvidencePassagesWithCoverage({
      units,
      query:
        "Compare this paper with NHM2 and explain what it supports and what it does not validate.",
      source_ref: "artifact://scholarly-pdf/warp.pdf",
      title: "Generic Warp Drives",
      max_passages: 3,
    });

    expect(passages).toHaveLength(3);
    expect(passages.map((entry) => entry.section)).toEqual(
      expect.arrayContaining(["Abstract", "Assumptions", "Limitations"]),
    );
    expect(passages.map((entry) => entry.text).join(" ")).toContain(
      "unit lapse and a flat spatial three-metric",
    );
    expect(passages.map((entry) => entry.text).join(" ")).toContain(
      "does not validate a particular engineered source",
    );
  });

  it("covers prose-declared setup assumptions without an assumptions heading", () => {
    const units = buildEvidenceUnitsFromText({
      page: 4,
      text: [
        "The flow vector and its derivatives are assumed to be smooth and bounded.",
        "This ADM-like decomposition has unit lapse and a flat spatial three-metric.",
        "The weak energy condition must hold for all timelike observers.",
      ].join(" "),
    });

    const passages = selectEvidencePassagesWithCoverage({
      units,
      query:
        "Which assumption mismatch matters most when applying this paper to another model?",
      source_ref: "artifact://scholarly-pdf/warp.pdf",
      title: "Generic Warp Drives",
      max_passages: 3,
    });

    const evidence = passages.map((entry) => entry.text).join(" ");
    expect(passages[0]?.text).toContain(
      "flow vector and its derivatives are assumed",
    );
    expect(evidence).toContain("unit lapse and a flat spatial three-metric");
    expect(evidence).toContain("all timelike observers");
  });
});
