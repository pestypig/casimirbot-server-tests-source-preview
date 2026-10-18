import { describe, expect, it } from "vitest";
import { __testCapsuleGrounding } from "../routes/agi.plan";

describe("capsule grounding helpers", () => {
  it("down-weights capsule terms when explicit topic shift is present", () => {
    expect(__testCapsuleGrounding.detectCapsuleTopicShift("Actually let's switch topics to propulsion limits.")).toBe(true);
    const terms = __testCapsuleGrounding.resolveCapsuleMustKeepTerms(
      {
        mustKeepTerms: ["negative", "energy", "density", "casimir", "warp", "bubble", "metric"],
        preferredEvidencePaths: [],
      },
      true,
    );
    expect(terms.length).toBeLessThanOrEqual(4);
  });

  it("detects retrieval drift when focus terms are absent", () => {
    const drift = __testCapsuleGrounding.isCapsuleRetrievalDriftDetected({
      contextText: "General discussion about unrelated UI details.",
      contextFiles: ["client/src/components/helix/HelixAskPill.tsx"],
      mustKeepTerms: ["negative", "energy"],
      preferredEvidencePaths: [],
    });
    expect(drift).toBe(true);
  });

  it("accepts preferred anchor path matches from answer citations", () => {
    const hasAnchor = __testCapsuleGrounding.answerHasCapsulePreferredAnchor(
      "Answer body.\n\nSources: docs/knowledge/physics/einstein-field-equations.md",
      ["docs/knowledge/physics/einstein-field-equations.md"],
    );
    expect(hasAnchor).toBe(true);
  });

  it("rewrites with focus anchor and sources when guards fail", () => {
    const rewritten = __testCapsuleGrounding.rewriteAnswerWithCapsuleConstraints({
      answer: "Warp drives are theoretical.",
      mustKeepTerms: ["negative energy density"],
      preferredEvidencePaths: ["docs/knowledge/physics/einstein-field-equations.md"],
      requireAnchor: true,
    });
    expect(rewritten.toLowerCase()).toContain("focus anchor");
    expect(rewritten).toContain("Sources:");
  });

  it("marks short deictic prompts as ambiguous", () => {
    expect(__testCapsuleGrounding.isCapsuleIntentAmbiguous("Where is that?")).toBe(true);
    expect(__testCapsuleGrounding.isCapsuleIntentAmbiguous("Explain negative energy density and its Casimir link.")).toBe(false);
  });

  it("skips open-world marker when tree walk already contains citations", () => {
    const shouldSkip = __testCapsuleGrounding.shouldAppendOpenWorldSourcesMarker({
      answerText: "General open-world answer body without explicit sources line.",
      treeWalkBlock:
        "Tree Walk: Physics Foundations Walk (tree-derived; source: docs/knowledge/physics/physics-foundations-tree.json)",
    });
    expect(shouldSkip).toBe(false);

    const shouldAppend = __testCapsuleGrounding.shouldAppendOpenWorldSourcesMarker({
      answerText: "General open-world answer body without explicit sources line.",
      treeWalkBlock: "",
    });
    expect(shouldAppend).toBe(true);
  });
});
