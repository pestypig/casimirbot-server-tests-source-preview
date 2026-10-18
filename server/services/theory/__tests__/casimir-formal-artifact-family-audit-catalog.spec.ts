import { beforeEach, describe, expect, it } from "vitest";

import {
  inspectCasimirFormalArtifactFamilyAuditCatalogV1,
  queryCasimirFormalArtifactFamilyAuditCatalogV1,
  resetCasimirFormalArtifactFamilyAuditCatalogForTestsV1,
  resolveCasimirFormalArtifactFamilyTheoremCatalogEntryV1,
} from "../casimir-formal-artifact-family-audit-catalog";

describe("Casimir formal artifact family audit catalog", () => {
  beforeEach(() => {
    resetCasimirFormalArtifactFamilyAuditCatalogForTestsV1();
  });

  it("publishes a server-governed, non-terminal source audit", async () => {
    expect(await inspectCasimirFormalArtifactFamilyAuditCatalogV1()).toEqual(
      expect.objectContaining({
        configured: true,
        auditArtifactSha256:
          "b0a82f7d2d929c80dec5df24f90f83f6dc693b2558c43739dee840493acf266a",
        generationLineageAuditArtifactSha256:
          "9ab2c849a8dc568d0ed27bf4bdf869bcdc649b95f321c3a79989d77d09874431",
        generatorLineageStatus:
          "not_published_in_pinned_repository",
        executionEnrollmentEligible: false,
        executionEnrollmentBlockers: [
          "formal_generator_lineage_unavailable",
        ],
        repositoryCommitSha: "b13da44d9e93e9f3c8dbdab48590fc2e08a8bff3",
        theoremCount: 156,
        issues: [],
        assistantAnswer: false,
        terminalEligible: false,
      }),
    );
  });

  it("supports bounded discovery without caller-supplied source authority", async () => {
    const result =
      await queryCasimirFormalArtifactFamilyAuditCatalogV1({});
    expect(result).toMatchObject({
      ok: true,
      status: "succeeded",
      selectedCase: null,
      selectedTheorem: null,
      authority: {
        sourceAdmissionAuthority: true,
        formalPropositionChecked: false,
        replayEligible: false,
        assistantAnswer: false,
        terminalEligible: false,
      },
    });
    expect(result.cases).toHaveLength(6);
    expect(result.generationLineageAudit).toMatchObject({
      recursiveTreeInspection: {
        complete: true,
        truncated: false,
        entryCount: 32,
        generatorCandidatePaths: [],
      },
      generatorLineage: {
        status: "not_published_in_pinned_repository",
        blockerCode: "formal_generator_lineage_unavailable",
      },
      authority: {
        generatorRegistrationAuthority: false,
        executionEnrollmentAuthority: false,
      },
    });
  });

  it("resolves only an exact artifact, source hash, and theorem tuple", async () => {
    const entry =
      await resolveCasimirFormalArtifactFamilyTheoremCatalogEntryV1({
        formalArtifactId:
          "casimir:lanyon:gr_hyperbolic_maxwell_1d:formal_source",
        formalSourceSha256:
          "7a7a82ccf996338fd0c788c65e5374894f4d3d58625c3f361088e0bd22fd9377",
        theoremName: "xHyperbolicity",
      });
    expect(entry).toMatchObject({
      theorem: {
        theoremId: "gr_hyperbolic_maxwell_1d.xHyperbolicity",
        propertyKind: "real_typed_expression_witness",
        claimCeiling: "definition_well_typed",
        replay: {
          status: "blocked",
          observedTheoremTypeSha256: null,
        },
      },
      authority: {
        serverGovernedSourceAudit: true,
        exactDeclarationBound: true,
        exactPropositionSourceBound: true,
        generatorLineageRegistered: false,
        observedTheoremTypeBound: false,
        replayEligible: false,
        formalPropositionChecked: false,
        scientificAuthority: false,
        physicalAuthority: false,
        assistantAnswer: false,
        terminalEligible: false,
      },
    });
    const selected =
      await queryCasimirFormalArtifactFamilyAuditCatalogV1({
        formalArtifactId:
          "casimir:lanyon:gr_hyperbolic_maxwell_1d:formal_source",
        theoremName: "xHyperbolicity",
      });
    expect(selected.selectedCase).toMatchObject({
      artifactLineage: {
        specification: {
          logicalPath:
            "specifications/gr_hyperbolic_maxwell_1d.rkt",
        },
        formalSource: {
          logicalPath: "proofs/gr_hyperbolic_maxwell_1d.lean",
        },
        implementationSource: {
          logicalPath:
            "implementations/gr_hyperbolic_maxwell_1d.c",
          entrypointStatus: "placeholder_noop",
          formalRefinementStatus: "unassessed",
        },
        generator: {
          status: "not_published_in_pinned_repository",
        },
        completeForExecutionEnrollment: false,
      },
      executionEnrollmentReadiness: {
        status: "blocked",
        blockerCodes: expect.arrayContaining([
          "formal_generator_lineage_unavailable",
          "formal_c_implementation_placeholder_noop",
          "formal_c_refinement_unassessed",
          "formal_environment_unpinned",
          "formal_import_closure_unpinned",
          "semantic_to_lean_binding_required",
          "observed_theorem_type_required",
        ]),
      },
    });
  });

  it.each([
    {
      formalArtifactId:
        "casimir:lanyon:gr_maxwell_1d:formal_source",
      formalSourceSha256:
        "7a7a82ccf996338fd0c788c65e5374894f4d3d58625c3f361088e0bd22fd9377",
      theoremName: "xHyperbolicity",
    },
    {
      formalArtifactId:
        "casimir:lanyon:gr_hyperbolic_maxwell_1d:formal_source",
      formalSourceSha256: "0".repeat(64),
      theoremName: "xHyperbolicity",
    },
    {
      formalArtifactId:
        "casimir:lanyon:gr_hyperbolic_maxwell_1d:formal_source",
      formalSourceSha256:
        "7a7a82ccf996338fd0c788c65e5374894f4d3d58625c3f361088e0bd22fd9377",
      theoremName: "Hyperbolicity",
    },
  ])("fails closed for a substituted tuple", async (input) => {
    expect(
      await resolveCasimirFormalArtifactFamilyTheoremCatalogEntryV1(input),
    ).toBeNull();
  });
});
