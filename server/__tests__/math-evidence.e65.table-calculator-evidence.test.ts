import { describe, expect, it } from "vitest";

import { runMathEvidenceTool } from "../lib/mathEvidence";

const MISSION_TIME_PATH =
  "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/warp-nhm2-mission-time-comparison-2026-04-27.md";

describe("math evidence E65 table calculator evidence", () => {
  it("extracts role-bound table facts and a derived calculator relation", () => {
    const result = runMathEvidenceTool({
      turn_id: "e65-table",
      query: "Find me NHM2 calculator-usable evidence for alpha 0p7000.",
      source_hint: { path: MISSION_TIME_PATH, explicit_user_path: true },
      target_terms: ["NHM2", "alpha", "0.7", "properVsCoordinate_ratio", "coordinateVsClassical_ratio"],
      calculator_intent: true,
      preferred_evidence_kinds: ["table_key_value", "derived_relation"],
    });

    expect(result.selected_artifact?.kind).toBe("doc_calculator_evidence");
    if (result.selected_artifact?.kind !== "doc_calculator_evidence") throw new Error("expected calculator evidence");
    expect(result.selected_artifact.source_path).toBe(MISSION_TIME_PATH);
    expect(result.selected_artifact.derived_relations.map((relation) => relation.expression)).toContain(
      "proper_time = alpha * coordinate_time",
    );
    const roles = result.selected_artifact.fields.map((field) => field.semantic_role);
    expect(roles).toContain("alpha");
    expect(roles).toContain("proper_vs_coordinate_ratio");
    expect(roles).toContain("coordinate_vs_classical_ratio");
    expect(result.selected_artifact.snippets.length).toBeGreaterThan(0);
  });

  it("prefers table evidence for alpha evidence prompts even when an explicit formula exists elsewhere", () => {
    const result = runMathEvidenceTool({
      turn_id: "e65-table-preference",
      query: "Find me NHM2 calculator-usable evidence for alpha 0p7000.",
      target_terms: ["NHM2", "alpha", "0p7000", "properVsCoordinate_ratio", "coordinateVsClassical_ratio"],
      calculator_intent: true,
    });

    expect(result.selected_artifact?.kind).toBe("doc_calculator_evidence");
    if (result.selected_artifact?.kind !== "doc_calculator_evidence") throw new Error("expected calculator evidence");
    expect(result.selected_artifact.source_path).toContain("warp-nhm2-mission-time-comparison");
    expect(result.selected_artifact.derived_relations.map((relation) => relation.expression)).toContain(
      "proper_time = alpha * coordinate_time",
    );
  });
});
