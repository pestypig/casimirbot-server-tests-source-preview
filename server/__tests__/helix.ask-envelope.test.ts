import { describe, expect, it } from "vitest";

import { buildHelixAskEnvelope } from "../services/helix-ask/envelope";

describe("helix ask envelope practical paragraph promotion", () => {
  it("promotes 'In practical terms' paragraph into final answer while keeping tree walk in details", () => {
    const answer = [
      "Tree Walk: Warp Mechanics Walk (tree-derived; source: docs/knowledge/warp/warp-mechanics-tree.json)",
      "1. Walk: Warp Mechanics Tree - A walkable map of warp geometry, proxies, and control levers. (docs/knowledge/warp/warp-mechanics-tree.json)",
      "",
      "Negative energy density is a theoretical concept discussed in quantum field theory and GR thought experiments.",
      "",
      "In practical terms, negative energy density has not been observed in nature and remains a theoretical construct.",
      "",
      "The concept raises stability and causality concerns, so claims should stay bounded and uncertainty should remain explicit.",
      "",
      "Sources: open-world best-effort (no repo citations required).",
    ].join("\n");

    const envelope = buildHelixAskEnvelope({
      answer,
      format: "brief",
      tier: "F2",
      mode: "standard",
    });

    expect(envelope.answer).toContain(
      "In practical terms, negative energy density has not been observed in nature and remains a theoretical construct.",
    );
    expect(envelope.answer).toContain(
      "The concept raises stability and causality concerns, so claims should stay bounded and uncertainty should remain explicit.",
    );
    expect(envelope.sections?.some((section) => section.title === "Tree Walk")).toBe(true);
    const detailSections = (envelope.sections ?? []).filter((section) => section.layer === "details");
    expect(detailSections).toHaveLength(1);
    expect(detailSections[0]?.title).toBe("Tree Walk");
    const detailBodies = detailSections.map((section) => section.body.toLowerCase()).join("\n\n");
    expect(detailBodies).not.toContain("in practical terms");
  });

  it("does not duplicate practical paragraph when it is already in summary", () => {
    const answer = [
      "In practice, negative energy density remains hypothetical and should be treated as non-confirmed.",
      "",
      "Additional detail paragraph with bounded uncertainty and no direct observation in nature.",
    ].join("\n");

    const envelope = buildHelixAskEnvelope({
      answer,
      format: "brief",
      tier: "F1",
      mode: "standard",
    });

    const practiceMatches = envelope.answer.match(/in practice/gi) ?? [];
    expect(practiceMatches.length).toBe(1);
  });

  it("keeps non-tree-walk detail paragraphs in details for regular brief answers", () => {
    const answer = [
      "Negative energy density is a theoretical concept in physics tied to quantum effects.",
      "",
      "Additional explanatory paragraph that should remain in details when no tree walk block exists.",
    ].join("\n");

    const envelope = buildHelixAskEnvelope({
      answer,
      format: "brief",
      tier: "F1",
      mode: "standard",
    });

    expect(envelope.answer).toContain(
      "Negative energy density is a theoretical concept in physics tied to quantum effects.",
    );
    const detailsText = (envelope.sections ?? [])
      .filter((section) => section.layer === "details")
      .map((section) => section.body)
      .join("\n\n");
    expect(detailsText).toContain(
      "Additional explanatory paragraph that should remain in details when no tree walk block exists.",
    );
  });

  it("does not split path-citation answers into corrupted ts] fragments", () => {
    const answer = [
      "Claim-first explanation:",
      "1. [server/services/mixer/collapse.ts] Grounded equation candidates were retrieved, but no exact canonical line was verifiable in this turn.",
      "2. [shared/dp-collapse.ts] Current repository evidence maps to implementation operators.",
      "3. [cli/collapse-bench.ts] The retrieved files still provide mechanism-level context.",
    ].join("\n");

    const envelope = buildHelixAskEnvelope({
      answer,
      format: "brief",
      tier: "F1",
      mode: "extended",
    });

    expect(envelope.answer).toContain("[server/services/mixer/collapse.ts]");
    expect(envelope.answer).toContain("[shared/dp-collapse.ts]");
    expect(envelope.answer).not.toMatch(/\n\s*\d+\.\s*ts\]\s+Grounded/i);
    expect(envelope.answer).not.toContain("md]");
  });

  it("preserves structured deterministic section answers without summary reordering", () => {
    const answer = [
      "Definition:",
      "- In this codebase, warp bubble is grounded in docs/knowledge/warp/warp-bubble.md. [docs/knowledge/warp/warp-bubble.md]",
      "",
      "Why it matters:",
      "- It provides a repo-grounded definition with explicit scope for follow-up mechanism asks. [docs/knowledge/warp/warp-bubble.md]",
      "",
      "Key terms:",
      "- warp",
      "- bubble",
      "",
      "Repo anchors:",
      "- docs/knowledge/warp/warp-bubble.md",
      "",
      "Sources: docs/knowledge/warp/warp-bubble.md, modules/warp/natario-warp.ts",
    ].join("\n");

    const envelope = buildHelixAskEnvelope({
      answer,
      format: "brief",
      tier: "F1",
      mode: "standard",
    });

    expect(envelope.answer).toMatch(/^Definition:/m);
    expect(envelope.answer).toMatch(/^Why it matters:/m);
    expect(envelope.answer).toMatch(/^Key terms:/m);
    expect(envelope.answer).toMatch(/^Repo anchors:/m);
  });

  it("preserves research-contract manuscript sections in the answer card", () => {
    const answer = [
      "Motivation and Boundary:",
      "This campaign defines falsifiable reduced-order full-solve gates and reproducible evidence requirements; it is not a physical warp feasibility claim.",
      "",
      "Metric Setup:",
      "ADM notation is used with lapse, shift, and spatial metric mappings.",
      "",
      "Derivation Appendix:",
      "| source_id | equation_trace_id | equation | substitutions (with units) | mapped_entry_ids | mapped_framework_variables | recompute_status | blocker_reason |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |",
      "",
      "Provenance Table:",
      "| source_id | equation_trace_id | equation | substitutions (with units) | mapped_entry_ids | mapped_framework_variables | recompute_status | blocker_reason |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |",
      "",
      "Claim Discipline:",
      "- what can be said now",
      "",
      "Self-Check:",
      "- Boundary statement appears verbatim.",
    ].join("\n");

    const envelope = buildHelixAskEnvelope({
      answer,
      format: "brief",
      tier: "F1",
      mode: "standard",
    });

    expect(envelope.answer).toMatch(/^Motivation and Boundary:/m);
    expect(envelope.answer).toMatch(/^Metric Setup:/m);
    expect(envelope.answer).toMatch(/^Derivation Appendix:/m);
    expect(envelope.answer).toMatch(/^Provenance Table:/m);
    expect(envelope.answer).toMatch(/^Claim Discipline:/m);
    expect(envelope.answer).toMatch(/^Self-Check:/m);
  });
});
