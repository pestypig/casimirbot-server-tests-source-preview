import { describe, expect, it } from "vitest";

import { selectTheoryDepth } from "../services/helix-ask/theory-congruence/depth-policy";

describe("Helix Ask theory congruence depth policy", () => {
  it("defaults to direct depth when no evidence cue is present", () => {
    expect(selectTheoryDepth({ prompt: "Explain this in plain terms." }).depth).toBe("direct");
  });

  it("selects congruence trace for first-principles theory graph prompts", () => {
    const selection = selectTheoryDepth({
      prompt: "Use a congruence trace from first principles through calculator rows.",
    });
    expect(selection.depth).toBe("congruence_trace");
    expect(selection.reason).toBe("first_principles_theory_trace_prompt");
  });

  it("selects audit depth for validation or full scan prompts", () => {
    const selection = selectTheoryDepth({
      prompt: "Deep audit this and run benchmark coverage for forbidden claims.",
    });
    expect(selection.depth).toBe("audit_deep");
  });

  it("uses source grounded depth for claim-scope questions", () => {
    const selection = selectTheoryDepth({
      prompt: "What can and cannot claim from the badge graph here?",
    });
    expect(selection.depth).toBe("source_grounded");
  });

  it("does not treat contextual tool words as a request to run every tool", () => {
    const selection = selectTheoryDepth({
      prompt: "Earlier someone said run every theory tool, but do not do that now. Just explain what the badge graph can and cannot claim.",
    });
    expect(selection.depth).toBe("source_grounded");
  });
});
