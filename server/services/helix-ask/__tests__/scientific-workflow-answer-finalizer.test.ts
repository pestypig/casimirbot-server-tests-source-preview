import { describe, expect, it } from "vitest";
import type { ScientificImageEvidenceSidecarV1 } from "@shared/scientific-evidence-adaptor";
import {
  finalizeScientificWorkflowAnswer,
  shouldUseRawScientificWorkflowAuditAnswer,
} from "../scientific-workflow-answer-finalizer";

const buildSidecar = (overrides: Partial<ScientificImageEvidenceSidecarV1> = {}): ScientificImageEvidenceSidecarV1 => ({
  schema: "helix.scientific_image_evidence_sidecar.v1",
  sidecar_id: "ask:test:scientific_image_evidence_sidecar",
  created_at_ms: 1,
  source_kind: "pdf_page_render",
  source_ref_hash: "sha256:test-page",
  crop_regions: [],
  packet_refs: [],
  packets: [],
  selected_evidence_object: null,
  exact_equation_summary: {
    admissible_row_count: 0,
    promoted_row_count: 0,
    partial_row_count: 0,
    rejected_row_count: 0,
    promotion_blockers: [],
  },
  historical_blockers: [],
  claim_boundary: {
    proof_authority: false,
    physical_validation: false,
    badge_promotion: false,
    calculator_authority: false,
  },
  ...overrides,
});

describe("scientific workflow answer finalizer", () => {
  it("keeps raw continuity text for explicit audit prompts", () => {
    const rawText = [
      "I am using the latest scientific Image Lens evidence chain, not a fresh scholarly lookup.",
      "Evidence depth: `exact_row_promoted`.",
      "Sidecar: `ask:test:scientific_image_evidence_sidecar`.",
      "Source image hash: `sha256:test-page`.",
    ].join("\n");

    expect(shouldUseRawScientificWorkflowAuditAnswer(
      "Tell me which promoted page-grounded equation row, page number, crop ref, Image Lens source/hash, and evidence depth you are currently using.",
    )).toBe(true);
    expect(finalizeScientificWorkflowAnswer({
      promptText: "Run a scientific Image Lens evidence continuity audit. Report only sidecar id and source image hash.",
      rawText,
      sidecar: buildSidecar(),
    })).toBe(rawText);
  });

  it("translates missing sidecar with an active page source into a user-facing next step", () => {
    const answer = finalizeScientificWorkflowAnswer({
      promptText: "What does this page evidence mean for the theory graph?",
      rawText: "I found an active Image Lens page/source state, but no recoverable scientific Image Lens sidecar for this continuity audit.\nLookup keys checked: `a`, `b`.",
      sidecar: null,
      sourceState: {
        sourceId: "pdf-page-render:test",
        sourceHash: "sha256:test-page",
        pageNumber: 5,
        cropRef: "sha256:test-page#crop=1,2,3,4",
      },
    });

    expect(answer).toContain("page source to work from");
    expect(answer).toContain("scientific sidecar missing");
    expect(answer).toContain("recreate or restore");
    expect(answer).not.toContain("Lookup keys checked");
    expect(answer).not.toContain("sha256:test-page#crop");
  });

  it("frames partial equation evidence as a locator rather than handoff authority", () => {
    const answer = finalizeScientificWorkflowAnswer({
      promptText: "How should I understand the equation evidence?",
      rawText: "Evidence depth: `exact_row_partial`.",
      sidecar: buildSidecar({
        exact_equation_summary: {
          admissible_row_count: 0,
          promoted_row_count: 0,
          partial_row_count: 7,
          rejected_row_count: 0,
          promotion_blockers: ["retry_row_does_not_overlap_prior_page_equation_candidate"],
        },
        historical_blockers: ["retry_row_does_not_overlap_prior_page_equation_candidate"],
      }),
    });

    expect(answer).toContain("equation-like evidence");
    expect(answer).toContain("too weak for graph reflection");
    expect(answer).toContain("partial rows: 7");
    expect(answer).toContain("crop the complete equation row");
  });

  it("allows promoted row evidence only as bounded conceptual reflection", () => {
    const answer = finalizeScientificWorkflowAnswer({
      promptText: "How is this relevant to the current theory graph?",
      rawText: "Evidence depth: `exact_row_promoted`.",
      sidecar: buildSidecar({
        exact_equation_summary: {
          admissible_row_count: 1,
          promoted_row_count: 1,
          partial_row_count: 0,
          rejected_row_count: 0,
          promotion_blockers: ["requested_label_matched", "single_clean_row"],
        },
      }),
    });

    expect(answer).toContain("bounded conceptual reflection");
    expect(answer).toContain("diagnostic");
    expect(answer).toContain("does not prove");
    expect(answer).toContain("promoted exact rows: 1");
  });

  it("preserves promoted complete equation blocks as bounded exact evidence", () => {
    const answer = finalizeScientificWorkflowAnswer({
      promptText: "How is this complete equation block relevant to the current theory graph?",
      rawText: "Evidence depth: `exact_block_promoted`.",
      sidecar: buildSidecar({
        evidence_depth: "exact_block_promoted",
        exact_equation_summary: {
          admissible_row_count: 0,
          promoted_row_count: 0,
          partial_row_count: 0,
          rejected_row_count: 0,
          admissible_block_count: 1,
          promoted_block_count: 1,
          partial_block_count: 0,
          rejected_block_count: 0,
          promotion_blockers: [],
        },
      }),
    });

    expect(answer).toContain("bounded conceptual reflection");
    expect(answer).toContain("Evidence state: exact_block_promoted");
    expect(answer).toContain("promoted exact rows: 0");
    expect(answer).toContain("promoted exact blocks: 1");
    expect(answer).not.toContain("not a promoted full equation row");
  });
});
