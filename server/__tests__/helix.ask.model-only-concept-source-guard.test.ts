import { describe, expect, it } from "vitest";

import {
  detectModelOnlyConceptSourceSignal,
  hasExplicitModelOnlyConceptScope,
  isExplicitVisualInputRequest,
} from "../services/helix-ask/model-only-concept-source-guard";
import { detectRepoCodeEvidenceIntent } from "../services/helix-ask/repo-code-intent-detector";
import { detectRepoConceptDefinition } from "../services/helix-ask/repo-concept-detector";

const crossDomainConceptPrompts = [
  {
    name: "philosophy",
    prompt:
      "How should I understand free will if causality is real? Explain the difference between determinism, responsibility, and the everyday picture that a choice has to be uncaused to count as mine.",
    terms: ["free_will", "causality", "picture"],
  },
  {
    name: "history",
    prompt:
      "Why do empires often look stable right before they fragment? Compare the popular picture of sudden collapse with slower causes like incentives, legitimacy, logistics, and local identity.",
    terms: ["empire", "picture", "incentives", "identity"],
  },
  {
    name: "economics",
    prompt:
      "How should I understand markets as information systems? Explain what the price signal picture gets right and where incentives, externalities, and coordination failures make that picture misleading.",
    terms: ["market", "picture", "incentives"],
  },
  {
    name: "biology",
    prompt:
      "Why is evolution not just survival of the strongest? Explain selection, ecosystems, tradeoffs, and why the common picture of a ladder of progress is misleading.",
    terms: ["evolution", "selection", "ecosystem", "picture"],
  },
  {
    name: "math",
    prompt:
      "What does infinity mean in mathematics? Compare the intuitive picture of something endlessly large with the proof-based idea that different infinities can have different structures.",
    terms: ["infinity", "picture", "proof"],
  },
];

describe("Helix Ask model-only concept source guard", () => {
  it("defaults ordinary cross-domain concept prompts to model-only synthesis", () => {
    for (const { name, prompt, terms } of crossDomainConceptPrompts) {
      const signal = detectModelOnlyConceptSourceSignal(prompt);
      const repoIntent = detectRepoCodeEvidenceIntent(prompt);

      expect(signal.applies, name).toBe(true);
      expect(signal.schema, name).toBe("helix.model_only_concept_source_signal.v1");
      expect(signal.should_prefer_model_only_concept, name).toBe(true);
      expect(signal.explicit_project_source_request, name).toBe(false);
      expect(signal.explicit_visual_input_request, name).toBe(false);
      expect(signal.reason_codes, name).toEqual(
        expect.arrayContaining(["concept_explanation_prompt", "prefer_model_only_concept"]),
      );
      expect(signal.concept_terms, name).toEqual(expect.arrayContaining(terms));
      expect(repoIntent.repoEvidenceRequested, name).toBe(false);
      expect(repoIntent.reasons, name).toEqual(expect.arrayContaining(["model_only_concept_source_guard"]));
    }
  });

  it("does not treat figurative picture language as attached image intent", () => {
    expect(
      isExplicitVisualInputRequest(
        "Explain the philosophical picture where identity is a process rather than a fixed object.",
      ),
    ).toBe(false);
    expect(
      isExplicitVisualInputRequest(
        "In relativity, spacetime curvature is often pictured as a rubber sheet, but that picture seems misleading.",
      ),
    ).toBe(false);
    expect(isExplicitVisualInputRequest("Please describe this picture I attached.")).toBe(true);
  });

  it("does not block explicit repo/code source requests", () => {
    const prompt =
      "Where is the free will concept implemented in the code? Cite the file path and explain the source contract.";
    const signal = detectModelOnlyConceptSourceSignal(prompt);
    const repoIntent = detectRepoCodeEvidenceIntent(prompt);

    expect(signal.applies).toBe(false);
    expect(signal.explicit_project_source_request).toBe(true);
    expect(repoIntent.repoEvidenceRequested).toBe(true);
  });

  it("does not route explicit Theory Graph plus MoralGraph bridge prompts as model-only concepts", () => {
    const prompt =
      "Reflect fairness and due process through entropy, conservation, and self-organization in the Theory Badge Graph and MoralGraph.";
    const signal = detectModelOnlyConceptSourceSignal(prompt);

    expect(signal.applies).toBe(false);
    expect(signal.should_prefer_model_only_concept).toBe(false);
    expect(signal.explicit_project_source_request).toBe(true);
    expect(signal.reason_codes).toEqual(expect.arrayContaining(["explicit_project_source_request"]));
  });

  it("keeps ordinary entropy and justice concept prompts model-only when no graph source is requested", () => {
    const prompt =
      "How can entropy and justice be compared conceptually without treating physics as moral proof?";
    const signal = detectModelOnlyConceptSourceSignal(prompt);

    expect(signal.applies).toBe(true);
    expect(signal.should_prefer_model_only_concept).toBe(true);
    expect(signal.explicit_project_source_request).toBe(false);
  });

  it("keeps explicit conceptual Helix UI prompts out of repo/source routing", () => {
    const prompt =
      "For Helix UI, explain in plain language what the sampled quantum inequality margin means, why negative energy constraints matter for a warp or Casimir-style concept, and how to avoid mistaking the rubber-sheet or field-picture analogies for literal physics. Keep it conceptual, not code or repo-specific.";
    const signal = detectModelOnlyConceptSourceSignal(prompt);
    const repoIntent = detectRepoCodeEvidenceIntent(prompt);
    const repoConcept = detectRepoConceptDefinition(prompt);

    expect(hasExplicitModelOnlyConceptScope(prompt)).toBe(true);
    expect(signal.applies).toBe(true);
    expect(signal.explicit_model_only_scope).toBe(true);
    expect(signal.explicit_project_source_request).toBe(false);
    expect(signal.reason_codes).toEqual(
      expect.arrayContaining(["explicit_model_only_concept_scope", "prefer_model_only_concept"]),
    );
    expect(repoIntent.repoEvidenceRequested).toBe(false);
    expect(repoIntent.reasons).toEqual(expect.arrayContaining(["explicit_model_only_concept_scope"]));
    expect(repoConcept).toBeNull();
  });
});
