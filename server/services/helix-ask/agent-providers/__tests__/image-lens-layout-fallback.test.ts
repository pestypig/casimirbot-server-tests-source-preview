import { describe, expect, it } from "vitest";
import { buildImageLensObservationFallbackAnswer } from "../codex-provider";

describe("Image Lens layout fallback answer", () => {
  it("reports only typed visual layout evidence when provider text is unusable", () => {
    const answer = buildImageLensObservationFallbackAnswer({
      question: "Use Image Lens to report equation (47) line breaks, alignment, and bounding region.",
      capabilityLaneCallResults: [{
        capability: "visual_analysis.inspect_image_region",
        receipt: {
          region_label: "equation_47",
          bbox_px: { x: 70, y: 510, width: 1080, height: 180 },
          crop_image_ref: `data:image/png;base64,${"a".repeat(2_000)}`,
          extraction_status: "extracted",
          text_candidate: "max_R ...\ns.t. ...\n(47)",
          latex_candidate: "\\begin{aligned} ... \\end{aligned}",
          uncertainty: [],
          visual_layout_candidate: {
            displayed_line_count: 3,
            displayed_lines: ["max_R ...", "s.t. ...", "(47)"],
            horizontal_alignment: "aligned_at_relation",
            structure: "aligned_block",
            equation_bbox_px: { x: 18, y: 14, width: 1020, height: 142 },
            notes: ["constraint lines share an alignment column"],
          },
        },
      }],
    });

    expect(answer).toContain("Displayed line count: 3");
    expect(answer).toContain("### Text evidence");
    expect(answer).toContain("### Visual evidence");
    expect(answer).toContain("Typed-field completeness: complete");
    expect(answer).toContain("Missing typed fields: none");
    expect(answer).toContain("Horizontal alignment: aligned_at_relation");
    expect(answer).toContain("Structure: aligned_block");
    expect(answer).toContain("Equation bbox within crop: x=18, y=14, width=1020, height=142");
    expect(answer).toContain("Displayed line 3: (47)");
    expect(answer).toContain("constraint lines share an alignment column");
    expect(answer).not.toContain("data:image");
  });

  it("names an unavailable equation bound instead of printing null coordinates", () => {
    const answer = buildImageLensObservationFallbackAnswer({
      question: "Use Image Lens and name any missing typed visual evidence.",
      capabilityLaneCallResults: [{
        capability: "visual_analysis.inspect_image_region",
        receipt: {
          region_label: "equation_47",
          bbox_px: { x: 0, y: 0, width: 1224, height: 1584 },
          extraction_status: "extracted",
          text_candidate: "max_R ...",
          visual_layout_candidate: {
            displayed_line_count: 3,
            displayed_lines: ["max_R ...", "s.t. ...", "constraint ..."],
            horizontal_alignment: "left",
            structure: "multi_line",
            equation_bbox_px: null,
            notes: [],
          },
          uncertainty: [],
        },
      }],
    });

    expect(answer).toContain("Typed-field completeness: incomplete");
    expect(answer).toContain("Missing typed fields: visual_layout_candidate.equation_bbox_px");
    expect(answer).toContain("Equation bbox within crop: unavailable");
    expect(answer).not.toContain("x=null");
  });

  it("rejects a displayed line count that has no matching displayed lines", () => {
    const answer = buildImageLensObservationFallbackAnswer({
      question: "Report the visible equation layout.",
      capabilityLaneCallResults: [{
        capability: "visual_analysis.inspect_image_region",
        receipt: {
          region_label: "equation_47",
          bbox_px: { x: 0, y: 0, width: 1224, height: 1584 },
          extraction_status: "extracted",
          exact_equation_admissibility: "partial_candidate",
          visual_layout_candidate: {
            displayed_line_count: 5,
            displayed_lines: [],
            horizontal_alignment: "center",
            structure: "multi_line",
            equation_bbox_px: { x: 125, y: 50, width: 980, height: 75 },
            notes: [],
          },
          uncertainty: [],
        },
      }],
    });

    expect(answer).toContain("Typed-field completeness: incomplete");
    expect(answer).toContain("Missing typed fields: visual_layout_candidate.displayed_lines");
    expect(answer).toContain("Target-evidence admissibility: partial_candidate");
  });

  it("reports exact block promotion separately from exact row promotion", () => {
    const answer = buildImageLensObservationFallbackAnswer({
      question: "Inspect the complete displayed equation block (47).",
      capabilityLaneCallResults: [{
        capability: "visual_analysis.inspect_image_region",
        receipt: {
          region_label: "equation_47_block",
          bbox_px: { x: 80, y: 120, width: 1060, height: 300 },
          extraction_status: "extracted",
          equation_capture_mode: "exact_block",
          exact_equation_admissibility: "admissible_for_exact_equation",
          exact_row_promotion: {
            status: "not_applicable",
            reasons: ["multi_line_exact_equation_block_uses_block_promotion"],
          },
          exact_block_promotion: {
            status: "promoted",
            reasons: ["complete_multi_line_equation_block", "displayed_lines_complete"],
          },
          text_candidate: "max_R ...\ns.t. ...\nconstraint ... (47)",
          latex_candidate: "\\begin{aligned} ... \\tag{47} \\end{aligned}",
          visual_layout_candidate: {
            displayed_line_count: 3,
            displayed_lines: ["max_R ...", "s.t. ...", "constraint ... (47)"],
            horizontal_alignment: "aligned_at_relation",
            structure: "aligned_block",
            equation_bbox_px: { x: 20, y: 18, width: 1010, height: 250 },
            notes: [],
          },
          uncertainty: [],
        },
      }],
    });

    expect(answer).toContain("Equation capture mode: exact_block");
    expect(answer).toContain("Exact row promotion: not_applicable");
    expect(answer).toContain("Exact block promotion: promoted");
    expect(answer).toContain("complete_multi_line_equation_block");
  });
});
