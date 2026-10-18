import { describe, expect, it } from "vitest";

import {
  isExplicitVisualEpochDeltaPrompt,
  routeHelixMultimodalIntent,
} from "../services/helix-ask/multimodal-intent-router";

const visualContextFor = (text: string) => ({
  schema: "helix.multimodal_turn_context.v1",
  thread_id: "helix-ask:desktop",
  turn_input_items: [
    { type: "text", text, source: "user" },
    {
      type: "evidence_ref",
      evidence_id: "visual_evidence:current",
      evidence_kind: "visual_frame_evidence",
      compact_summary: "Current frame summary only.",
      assistant_answer: false,
      raw_content_included: false,
    },
  ],
  visual_evidence_refs: ["visual_evidence:current"],
  selected_evidence_refs: ["visual_evidence:current"],
  raw_image_included: false,
  assistant_answer: false,
  context_policy: "compact_context_pack_only",
} as any);

describe("helix ask multimodal intent router", () => {
  it.each([
    "What changed in the visual screen capture compared with the previous scene epoch?",
    "What is different from the previous frame?",
    "Compare current visual capture to prior one.",
    "Since the last screenshot, what changed?",
    "What changed since the previous visual?",
  ])("keeps explicit visual epoch delta prompts out of single-frame visual synthesis: %s", (promptText) => {
    expect(isExplicitVisualEpochDeltaPrompt(promptText)).toBe(true);

    const route = routeHelixMultimodalIntent(visualContextFor(promptText));

    expect(route.route).toBe("none");
    expect(route.selected_evidence_refs).toEqual([]);
    expect(route.visual_summary).toBeNull();
    expect(route.docs_route_allowed).toBe(true);
  });

  it("still allows ordinary visual description prompts to use multimodal visual answers", () => {
    const route = routeHelixMultimodalIntent(visualContextFor("Describe the visual screen capture."));

    expect(route.route).toBe("multimodal_visual_answer");
    expect(route.selected_evidence_refs).toEqual(["visual_evidence:current"]);
    expect(route.visual_summary).toBe("Current frame summary only.");
  });
});
