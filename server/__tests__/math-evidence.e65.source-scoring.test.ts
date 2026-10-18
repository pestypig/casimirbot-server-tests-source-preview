import { describe, expect, it } from "vitest";

import { runMathEvidenceTool } from "../lib/mathEvidence";

describe("math evidence E65 source scoring", () => {
  it("audits generic NHM2 source selection as score-based, not hardcoded", () => {
    const result = runMathEvidenceTool({
      turn_id: "e65-scoring",
      query: "Find me an NHM2 source with a calculator-usable equation.",
      target_terms: ["NHM2", "calculator", "equation", "properTimeS_expected", "alpha"],
      calculator_intent: true,
      preferred_evidence_kinds: ["explicit_equation", "table_key_value", "derived_relation"],
    });

    expect(result.selected_artifact?.source_path).toBe("/docs/research/nhm2-frontier-distance-report.md");
    expect(result.anti_brittleness_audit.hardcoded_source_path_used).toBe(false);
    expect(result.anti_brittleness_audit.selected_by_score).toBe(true);
    expect(result.anti_brittleness_audit.selected_candidate_score?.explicit_formula_score).toBeGreaterThan(0);
    expect(result.anti_brittleness_audit.selected_candidate_score?.calculator_usability_score).toBeGreaterThan(0);
  });
});
