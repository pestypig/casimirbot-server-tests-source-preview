import { describe, expect, it } from "vitest";
import { extractionFromVisionText } from "../image-lens-region-inspection";

describe("Image Lens vision response parsing", () => {
  it("recovers typed visual layout from malformed outer JSON", () => {
    const extraction = extractionFromVisionText(`{
      "text_candidate": "equation (47)",
      "latex_candidate": "\\max_{R} \\operatorname{Tr}(R)",
      "visual_layout_candidate": {
        "displayed_line_count": 3,
        "displayed_lines": ["max R", "s.t. constraint", "(47)"],
        "horizontal_alignment": "aligned_at_relation",
        "structure": "aligned_block",
        "equation_bbox_px": {"x": 80, "y": 410, "width": 920, "height": 170},
        "notes": []
      },
      "uncertainty": []
    }`, "fixture:malformed-latex");

    expect(extraction.text_candidate).toBe("equation (47)");
    expect(extraction.visual_layout_candidate).toEqual({
      displayed_line_count: 3,
      displayed_lines: ["max R", "s.t. constraint", "(47)"],
      horizontal_alignment: "aligned_at_relation",
      structure: "aligned_block",
      equation_bbox_px: { x: 80, y: 410, width: 920, height: 170 },
      notes: [],
    });
  });
});
