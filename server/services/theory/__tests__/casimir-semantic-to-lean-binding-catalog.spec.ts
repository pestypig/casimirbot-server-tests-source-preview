import { describe, expect, it } from "vitest";

import {
  inspectCasimirSemanticToLeanBindingCatalogV1,
  resolveCasimirSemanticToLeanBindingCatalogEntryV1,
} from "../casimir-semantic-to-lean-binding-catalog";
import { buildAdvectionDiffusionZeroGradientLeanBindingV1 } from "../../../../shared/scientific-evidence/advection-diffusion-zero-gradient-lean-binding";

const hash = (character: string): string => character.repeat(64);

describe("Casimir semantic-to-Lean binding catalog", () => {
  it("registers the reviewed zero-gradient correspondence binding", async () => {
    const expected =
      await buildAdvectionDiffusionZeroGradientLeanBindingV1();
    await expect(
      inspectCasimirSemanticToLeanBindingCatalogV1(),
    ).resolves.toMatchObject({
      configured: true,
      registeredBindingCount: 1,
      bindingIds: [expected.binding.bindingId],
      issues: [],
      authority: {
        semanticBindingRegistrationAuthority: true,
        formalPropositionChecked: false,
        scientificAuthority: false,
        assistantAnswer: false,
        terminalEligible: false,
      },
    });
    await expect(
      resolveCasimirSemanticToLeanBindingCatalogEntryV1({
        bindingId: expected.binding.bindingId,
        artifactSha256: expected.binding.artifactSha256,
        claimId: expected.binding.semanticClaim.claimId,
        semanticPropositionSha256:
          expected.binding.semanticClaim.propositionSha256,
        formalArtifactId:
          expected.binding.formalArtifact.formalArtifactId,
        observedTheoremTypeSha256:
          expected.binding.formalArtifact.observedTheoremTypeSha256,
      }),
    ).resolves.toMatchObject({
      bindingId: expected.binding.bindingId,
      status: "reviewed",
    });
  });

  it("rejects a caller-supplied lookalike binding that is not registered", async () => {
    await expect(
      resolveCasimirSemanticToLeanBindingCatalogEntryV1({
        bindingId: "semantic-to-lean:lookalike",
        artifactSha256: hash("1"),
        claimId: "claim:lookalike",
        semanticPropositionSha256: hash("2"),
        formalArtifactId: "casimir:lanyon:lookalike",
        observedTheoremTypeSha256: hash("3"),
      }),
    ).resolves.toBeNull();
  });
});
