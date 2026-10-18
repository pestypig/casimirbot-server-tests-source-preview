import { describe, expect, it } from "vitest";
import { planMultimodalSubgoals } from "../services/helix-ask/multimodal-subgoal-planner";
import { normalizeHelixTurnInputItems } from "../services/helix-ask/turn-input-item-normalizer";

describe("helix ask multimodal subgoal planner", () => {
  it("keeps describe-image prompts as direct final synthesis", () => {
    const context = normalizeHelixTurnInputItems({
      threadId: "helix-ask:desktop",
      request: {
        question: "describe this image",
        turn_input_items: [
          { type: "text", text: "describe this image", source: "user" },
          {
            type: "evidence_ref",
            evidence_id: "visual:test",
            evidence_kind: "visual_frame_evidence",
            compact_summary: "a Minecraft slime in a boat",
            assistant_answer: false,
            raw_content_included: false,
          },
        ],
      },
    });
    const plan = planMultimodalSubgoals({
      threadId: "helix-ask:desktop",
      turnId: "turn:direct",
      context,
    });

    expect(plan.required_items).toEqual(["final_synthesis"]);
  });

  it("plans visual extraction, equation building, calculator, and final synthesis for image calculator goals", () => {
    const question = "From the image, use the calculator to add up how many items I have in my hotbar.";
    const context = normalizeHelixTurnInputItems({
      threadId: "helix-ask:desktop",
      request: {
        question,
        turn_input_items: [
          { type: "text", text: question, source: "user" },
          {
            type: "evidence_ref",
            evidence_id: "visual:test",
            evidence_kind: "visual_frame_evidence",
            compact_summary: "hotbar counts: 64, 12, 3",
            assistant_answer: false,
            raw_content_included: false,
          },
        ],
      },
    });
    const plan = planMultimodalSubgoals({
      threadId: "helix-ask:desktop",
      turnId: "turn:tool",
      context,
    });

    expect(plan.required_items).toEqual([
      "visual_extraction",
      "equation_builder",
      "calculator_tool",
      "final_synthesis",
    ]);
    expect(plan.workstation_tools).toContain("scientific-calculator.solve_with_steps");
    expect(plan.assistant_answer).toBe(false);
  });
});
