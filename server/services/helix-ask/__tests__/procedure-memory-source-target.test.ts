import { describe, expect, it } from "vitest";
import { arbitrateAskSourceTarget } from "../ask-source-target-arbitrator";

const arbitrate = (promptText: string) =>
  arbitrateAskSourceTarget({
    turnId: "ask:procedure-memory-source-target",
    threadId: "thread:procedure-memory-source-target",
    promptText,
  });

describe("procedure-memory source-target precedence", () => {
  it("routes an affirmative recall request before generic repo-concept inference", () => {
    const intent = arbitrate(
      "What does procedure memory say about the last scene?",
    );

    expect(intent).toMatchObject({
      target_source: "procedure_memory",
      target_kind: "procedure_memory",
      strength: "hard",
      precedence_reason: "hard_procedure_memory_recall_prompt",
    });
    expect(intent.reasons).toContain("explicit_procedure_memory_recall");
  });

  it.each([
    'Do not check procedure memory; just explain the phrase "procedure memory" generally.',
    "Later, if I ask what procedure memory says about the last scene, do not do it now.",
    'Earlier I asked, "What does procedure memory say about the last scene?" Do not repeat it.',
    'The console says "What does procedure memory say about the last scene?" Explain why that text is visible.',
  ])("does not execute contextual recall text: %s", (promptText) => {
    const intent = arbitrate(promptText);

    expect(intent.target_source).not.toBe("procedure_memory");
    expect(intent.precedence_reason).not.toBe(
      "hard_procedure_memory_recall_prompt",
    );
  });
});
