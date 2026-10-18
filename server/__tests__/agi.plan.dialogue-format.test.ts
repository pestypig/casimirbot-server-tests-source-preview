import { describe, expect, it } from "vitest";

import { __testHelixAskDialogueFormatting } from "../routes/agi.plan";

describe("helix ask dialogue scientific formatting", () => {
  it("rewrites scientific micro report sections into conversational prose", () => {
    const input = [
      "Confirmed:",
      "- A quantum inequality bounds the duration and magnitude of negative energy. [docs/knowledge/physics/ford-roman-quantum-inequality.md]",
      "",
      "Reasoned connections (bounded):",
      "- These limits constrain exotic spacetime engineering and preserve causality. [docs/knowledge/physics/ford-roman-quantum-inequality.md]",
      "",
      "Next evidence:",
      "- Compare sampling-window assumptions across candidate derivations.",
      "- Searched terms: quantum inequality",
      "",
      "Sources: docs/knowledge/physics/ford-roman-quantum-inequality.md",
    ].join("\n");

    const output = __testHelixAskDialogueFormatting.rewriteConversationScientificVoice(input);

    expect(output).not.toContain("Confirmed:");
    expect(output).not.toContain("Reasoned connections (bounded):");
    expect(output).toContain("In practical terms");
    expect(output).toContain("Next step:");
    expect(output).toContain(
      "Sources: docs/knowledge/physics/ford-roman-quantum-inequality.md",
    );
  });

  it("leaves non-scientific answers unchanged", () => {
    const input = "A quantum inequality bounds negative energy over finite sampling intervals.";
    const output = __testHelixAskDialogueFormatting.rewriteConversationScientificVoice(input);
    expect(output).toBe(input);
  });
});
