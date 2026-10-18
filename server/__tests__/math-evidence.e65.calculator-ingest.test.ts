import { describe, expect, it } from "vitest";

import { runMathEvidenceTool } from "../lib/mathEvidence";

const MISSION_TIME_PATH =
  "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/warp-nhm2-mission-time-comparison-2026-04-27.md";

describe("math evidence E65 calculator ingest", () => {
  it("creates ingest payloads for explicit and table-derived evidence", () => {
    const explicit = runMathEvidenceTool({
      turn_id: "e65-ingest-explicit",
      query: "Find me an NHM2 source with a calculator-usable equation.",
      target_terms: ["NHM2", "properTimeS_expected", "alpha"],
      calculator_intent: true,
      preferred_evidence_kinds: ["explicit_equation"],
    });
    expect(explicit.selected_artifact?.kind).toBe("doc_equation_location");
    if (explicit.selected_artifact?.kind !== "doc_equation_location") throw new Error("expected equation artifact");
    expect(explicit.selected_artifact.calculator_ingest?.source_artifact_id).toBe(explicit.selected_artifact.artifact_id);
    expect(explicit.selected_artifact.calculator_ingest?.source_path).toBe(explicit.selected_artifact.source_path);
    expect(explicit.selected_artifact.calculator_ingest?.variables.length).toBeGreaterThan(0);

    const table = runMathEvidenceTool({
      turn_id: "e65-ingest-table",
      query: "Use the mission-time comparison evidence to prepare calculator inputs for alpha 0p7000.",
      source_hint: { path: MISSION_TIME_PATH, explicit_user_path: true },
      target_terms: ["NHM2", "alpha", "0.7"],
      calculator_intent: true,
      preferred_evidence_kinds: ["table_key_value", "derived_relation"],
    });
    expect(table.selected_artifact?.kind).toBe("doc_calculator_evidence");
    if (table.selected_artifact?.kind !== "doc_calculator_evidence") throw new Error("expected calculator artifact");
    expect(table.selected_artifact.calculator_ingest?.expression).toBe("proper_time = alpha * coordinate_time");
    expect(table.selected_artifact.calculator_ingest?.assumptions).toContain(
      "Derived from table evidence rather than explicit formula line.",
    );
  });
});
