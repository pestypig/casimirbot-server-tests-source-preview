import { describe, expect, it } from "vitest";
import {
  buildDerivedEquationFromDocEquationExtraction,
  buildDerivedEquationFromVisualExtraction,
  evaluateSimpleSumExpression,
  readCountsFromVisualExtraction,
} from "../services/helix-ask/derived-equation-builder";
import type { HelixVisualExtractionEvidence } from "@shared/helix-visual-extraction-evidence";
import type { HelixDocEquationExtraction } from "@shared/helix-doc-equation-extraction";

const extraction: HelixVisualExtractionEvidence = {
  schema: "helix.visual_extraction_evidence.v1",
  extraction_id: "visual-extraction:test",
  thread_id: "helix-ask:desktop",
  turn_id: "turn:test",
  source_evidence_refs: ["visual:test"],
  extraction_goal: "hotbar_item_counts",
  structured_result: {
    counts: [64, 12, 3],
  },
  confidence: 0.72,
  uncertainty: [],
  model_invoked: false,
  assistant_answer: false,
  raw_image_included: false,
  context_policy: "compact_context_pack_only",
};

describe("helix ask derived equation builder", () => {
  it("creates a calculator expression from visual extraction evidence", () => {
    const equation = buildDerivedEquationFromVisualExtraction({
      threadId: "helix-ask:desktop",
      turnId: "turn:test",
      extraction,
    });

    expect(equation?.expression).toBe("64 + 12 + 3");
    expect(equation?.assistant_answer).toBe(false);
    expect(equation?.raw_content_included).toBe(false);
  });

  it("evaluates simple calculator sum expressions deterministically for receipt summaries", () => {
    expect(evaluateSimpleSumExpression("64 + 12 + 3")).toBe(79);
    expect(evaluateSimpleSumExpression("64 + x")).toBeNull();
  });

  it("excludes unclear or low-confidence visual counts from derived equations", () => {
    const scopedExtraction: HelixVisualExtractionEvidence = {
      ...extraction,
      structured_result: {
        hotbar_slots: [
          { slot: 1, visible: true, count: 64, confidence: 0.9 },
          { slot: 2, visible: true, count: 12, confidence: 0.58 },
          { slot: 3, visible: true, count: 3, confidence: 0.8 },
        ],
        unclear_slots: [3],
      },
    };

    expect(readCountsFromVisualExtraction(scopedExtraction)).toEqual([64]);
    expect(
      buildDerivedEquationFromVisualExtraction({
        threadId: "helix-ask:desktop",
        turnId: "turn:test",
        extraction: scopedExtraction,
      })?.expression,
    ).toBe("64");
  });

  it("creates a derived equation from document equation extraction without prompt grafting", () => {
    const docExtraction: HelixDocEquationExtraction = {
      schema: "helix.doc_equation_extraction.v1",
      extraction_id: "doc-equation:test",
      thread_id: "helix-ask:desktop",
      turn_id: "turn:test",
      source_doc_path: "/docs/research/nhm2.md",
      equation_text: "tau = alpha * T",
      normalized_expression: "tau = alpha * T",
      location_hint: "line 42",
      confidence: 0.9,
      caveats: [],
      evidence_refs: ["doc:nhm2"],
      assistant_answer: false,
      raw_content_included: false,
      context_policy: "compact_context_pack_only",
      created_at: "2026-05-14T00:00:00.000Z",
    };

    const equation = buildDerivedEquationFromDocEquationExtraction({
      threadId: "helix-ask:desktop",
      turnId: "turn:test",
      extraction: docExtraction,
    });

    expect(equation?.expression).toBe("tau = alpha * T");
    expect(equation?.derived_from_refs).toContain("doc-equation:test");
    expect(equation?.assistant_answer).toBe(false);
  });
});
