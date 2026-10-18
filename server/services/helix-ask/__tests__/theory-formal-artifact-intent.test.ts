import { describe, expect, it } from "vitest";

import { arbitrateAskSourceTarget } from "../ask-source-target-arbitrator";
import { detectContextualToolAdmissionSuppression } from "../contextual-tool-admission";
import { extractExplicitCapabilityContracts } from "../explicit-capability-contract";
import { buildPromptNamedCapabilityGatewayCallRequests } from "../agent-providers/prompt-named-tool-requests";
import {
  THEORY_FORMAL_VERIFIER_INSPECT_ARTIFACT_FAMILY_CAPABILITY,
  buildTheoryFormalArtifactInspectionPromptArguments,
  isAffirmativeTheoryFormalArtifactInspectionPrompt,
} from "../theory-formal-artifact-intent";

const NATURAL_PROMPT =
  "Inspect the registered GR-Maxwell one-dimensional formal source around xHyperbolicity. What does that theorem name actually prove, and what does it not prove? Do not run Lean.";

describe("natural formal artifact-family inspection", () => {
  it("binds the registered artifact and theorem without admitting Lean execution", () => {
    expect(isAffirmativeTheoryFormalArtifactInspectionPrompt(NATURAL_PROMPT)).toBe(true);
    expect(
      buildTheoryFormalArtifactInspectionPromptArguments(NATURAL_PROMPT),
    ).toEqual({
      formal_artifact_id:
        "casimir:lanyon:gr_hyperbolic_maxwell_1d:formal_source",
      theorem_name: "xHyperbolicity",
    });
    expect(
      extractExplicitCapabilityContracts(NATURAL_PROMPT).map(
        (entry) => entry.contract.capability,
      ),
    ).toContain(THEORY_FORMAL_VERIFIER_INSPECT_ARTIFACT_FAMILY_CAPABILITY);
    expect(
      buildPromptNamedCapabilityGatewayCallRequests({
        question: NATURAL_PROMPT,
      }),
    ).toEqual([
      expect.objectContaining({
        capability_id:
          THEORY_FORMAL_VERIFIER_INSPECT_ARTIFACT_FAMILY_CAPABILITY,
        mode: "read",
        arguments: expect.objectContaining({
          formal_artifact_id:
            "casimir:lanyon:gr_hyperbolic_maxwell_1d:formal_source",
          theorem_name: "xHyperbolicity",
        }),
      }),
    ]);
    expect(
      arbitrateAskSourceTarget({
        turnId: "ask:test:formal-natural",
        threadId: "thread:test:formal-natural",
        promptText: NATURAL_PROMPT,
      }),
    ).toMatchObject({
      target_source: "theory_locator",
      target_kind: "theory_formal_artifact_family",
      strength: "hard",
    });
  });

  it.each([
    "Do not inspect the registered GR-Maxwell one-dimensional formal source around xHyperbolicity; explain the label only.",
    "Later inspect the registered GR-Maxwell one-dimensional formal source around xHyperbolicity.",
    "Earlier we inspected the registered GR-Maxwell one-dimensional formal source around xHyperbolicity.",
    '"Inspect the registered GR-Maxwell one-dimensional formal source around xHyperbolicity" is a quoted example.',
    "The debug panel shows the registered GR-Maxwell one-dimensional formal source; explain that text.",
  ])("does not execute a contextual formal inspection: %s", (prompt) => {
    expect(isAffirmativeTheoryFormalArtifactInspectionPrompt(prompt)).toBe(false);
    expect(
      extractExplicitCapabilityContracts(prompt).map(
        (entry) => entry.contract.capability,
      ),
    ).not.toContain(
      THEORY_FORMAL_VERIFIER_INSPECT_ARTIFACT_FAMILY_CAPABILITY,
    );
    expect(
      buildPromptNamedCapabilityGatewayCallRequests({ question: prompt }),
    ).toEqual([]);
  });

  it("suppresses a generic no-tools instruction before family cue detection", () => {
    const prompt =
      "I saw `theory-formal-verifier.inspect_artifact_family` in the debug panel. Just explain the label; do not call tools.";
    expect(detectContextualToolAdmissionSuppression(prompt)).toMatchObject({
      tool_admission_suppressed: true,
      suppression_reason: "negated_tool_instruction",
      verb_or_cue: "all_tools",
    });
    expect(
      arbitrateAskSourceTarget({
        turnId: "ask:test:formal-label",
        threadId: "thread:test:formal-label",
        promptText: prompt,
      }),
    ).toMatchObject({
      target_source: "model_only",
      target_kind: "general_background",
    });
  });
});
