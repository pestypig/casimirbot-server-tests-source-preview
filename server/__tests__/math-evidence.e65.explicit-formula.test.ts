import { describe, expect, it } from "vitest";

import { runMathEvidenceTool } from "../lib/mathEvidence";

describe("math evidence E65 explicit formula", () => {
  it("selects the NHM2 calculator formula source by score and builds ingest", () => {
    const result = runMathEvidenceTool({
      turn_id: "e65-explicit",
      query: "Find me an NHM2 source with a calculator-usable equation.",
      target_terms: ["NHM2", "calculator", "equation", "properTimeS_expected", "coordinateTimeS", "alpha"],
      calculator_intent: true,
      preferred_evidence_kinds: ["explicit_equation", "table_key_value", "derived_relation"],
    });

    expect(result.selected_artifact?.kind).toBe("doc_equation_location");
    expect(result.selected_artifact?.source_path).toBe("/docs/research/nhm2-frontier-distance-report.md");
    expect(JSON.stringify(result.selected_artifact)).toContain("properTimeS_expected = alpha * T");
    expect(result.anti_brittleness_audit.hardcoded_source_path_used).toBe(false);
    expect(result.anti_brittleness_audit.selected_by_score).toBe(true);
    expect(result.selected_artifact?.kind === "doc_equation_location" && result.selected_artifact.calculator_ingest?.expression).toContain(
      "properTimeS_expected = alpha * T",
    );
  });
});
