import { describe, expect, it } from "vitest";
import { normalizeHelixTurnInputItems } from "../services/helix-ask/turn-input-item-normalizer";

describe("helix ask multimodal input items", () => {
  it("keeps user text separate from visual evidence refs", () => {
    const context = normalizeHelixTurnInputItems({
      threadId: "helix-ask:desktop",
      request: {
        question: "describe this image",
        workspace_context_snapshot: {
          attached_visual_evidence: {
            evidence: {
              evidence_id: "visual_evidence:1",
              frame_id: "visual_frame:1",
              summary: "a Minecraft slime in a boat",
              assistant_answer: false,
              raw_image_included: false,
            },
          },
        },
      },
    });

    expect(context.turn_input_items).toEqual(
      expect.arrayContaining([
        { type: "text", text: "describe this image", source: "user" },
        expect.objectContaining({
          type: "evidence_ref",
          evidence_id: "visual_evidence:1",
          evidence_kind: "visual_frame_evidence",
          compact_summary: "a Minecraft slime in a boat",
        }),
        expect.objectContaining({
          type: "image",
          image_ref: "visual_frame:1",
          evidence_id: "visual_evidence:1",
          raw_image_included: false,
        }),
      ]),
    );
    expect(context.visual_evidence_refs).toEqual(["visual_evidence:1"]);
    expect(JSON.stringify(context.turn_input_items[0])).not.toContain("a Minecraft slime in a boat");
  });
});

