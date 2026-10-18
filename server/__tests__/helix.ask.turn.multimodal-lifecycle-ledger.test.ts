import { describe, expect, it } from "vitest";
import { planMultimodalSubgoals } from "../services/helix-ask/multimodal-subgoal-planner";
import { runMultimodalWorkstationChain } from "../services/helix-ask/multimodal-workstation-chain-runner";
import { normalizeHelixTurnInputItems } from "../services/helix-ask/turn-input-item-normalizer";

describe("helix ask multimodal lifecycle ledger", () => {
  it("records itemized visual extraction to calculator lifecycle events", () => {
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
      turnId: "turn:lifecycle",
      context,
    });
    const result = runMultimodalWorkstationChain({
      threadId: "helix-ask:desktop",
      turnId: "turn:lifecycle",
      userGoal: question,
      context,
      subgoalPlan: plan,
    });

    expect(result.ok).toBe(true);
    expect(result.derived_equation?.expression).toBe("64 + 12 + 3");
    expect(result.calculator_result).toBe(79);
    expect(result.lifecycle_events.map((event) => event.item_type)).toContain("visualExtraction");
    expect(result.lifecycle_events.map((event) => event.item_type)).toContain("derivedEquation");
    expect(result.lifecycle_events.map((event) => event.item_type)).toContain("dynamicToolCall");
    expect(result.lifecycle_events.map((event) => event.item_type)).toContain("toolObservation");
    expect(result.lifecycle_events.map((event) => event.item_type)).toContain("workstationToolEvaluation");
    expect(result.lifecycle_events.at(-1)?.item_type).toBe("agentMessage");
    expect(result.lifecycle_events.at(-1)?.assistant_answer).toBe(true);
  });
});
