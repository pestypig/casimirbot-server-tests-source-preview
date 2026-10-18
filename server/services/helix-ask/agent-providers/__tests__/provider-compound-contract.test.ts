import { describe, expect, it } from "vitest";

import { resolveProviderCompoundPromptContract } from "../provider-compound-contract";

describe("provider compound contract projection", () => {
  it("derives the canonical compound contract before provider tool continuation", () => {
    const contract = resolveProviderCompoundPromptContract({
      payload: {},
      promptText:
        'Safely test the gamerule now. First query "/gamerule doDaylightCycle". Then restore it and query it again to verify restoration.',
    });

    expect(contract).toMatchObject({
      schema: "helix.compound_prompt_contract.v1",
      requirements: [
        expect.objectContaining({ id: "R1" }),
        expect.objectContaining({ id: "R2", depends_on: ["R1"] }),
      ],
      output_contract: expect.objectContaining({
        allow_partial_answer: false,
      }),
    });
  });

  it("preserves an already projected canonical contract", () => {
    const existing = resolveProviderCompoundPromptContract({
      payload: {},
      promptText:
        "Test the first requirement now. Then test the second requirement.",
    });
    expect(existing).not.toBeNull();

    expect(
      resolveProviderCompoundPromptContract({
        payload: { compound_prompt_contract: existing },
        promptText: "Different prompt text that must not replace the contract.",
      }),
    ).toBe(existing);
  });

  it("keeps inspect, checkpoint, mutation, verification, and fallback in a Minecraft build contract", () => {
    const contract = resolveProviderCompoundPromptContract({
      payload: {},
      promptText:
        "Build a short stone-brick wall west of me. Inspect first, avoid the chest and my player, capture a bounded checkpoint, place blocks only into air, then inspect again and leave the verified wall standing. If the location is unsafe, do not mutate and explain why.",
    });

    const requirementText =
      contract?.requirements.map((requirement) => requirement.text).join(" | ") ??
      "";
    expect(contract?.requirements.length).toBeGreaterThanOrEqual(6);
    expect(requirementText).toMatch(/Build a short stone-brick wall/i);
    expect(requirementText).toMatch(/Inspect first/i);
    expect(requirementText).toMatch(/avoid the chest/i);
    expect(requirementText).toMatch(/capture a bounded checkpoint/i);
    expect(requirementText).toMatch(/place blocks only into air/i);
    expect(requirementText).toMatch(/inspect again/i);
    expect(requirementText).toMatch(/leave the verified wall standing/i);
    expect(requirementText).toMatch(/explain why/i);
  });
});
