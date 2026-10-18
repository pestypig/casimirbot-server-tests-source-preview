import { beforeEach, describe, expect, it } from "vitest";

import {
  validateCasimirFormalVerificationPreparationReceiptIntegrityV1,
  type CasimirFormalVerificationPreparationReceiptV1,
} from "@shared/contracts/casimir-formal-verification-preparation.v1";

import { resetCasimirFormalVerificationPreparationStoreForTests } from "../../../theory/casimir-formal-verification-preparer";
import {
  THEORY_FORMAL_VERIFIER_INSPECT_ARTIFACT_FAMILY_CAPABILITY,
  THEORY_FORMAL_VERIFIER_PLAN_CAPABILITY,
  THEORY_FORMAL_VERIFIER_PREPARE_REQUEST_CAPABILITY,
  executeTheoryFormalVerifierGatewayCapability,
} from "../theory-formal-verifier";

describe("theory formal verifier prepared-request gate", () => {
  beforeEach(() => {
    resetCasimirFormalVerificationPreparationStoreForTests();
  });

  it("exposes exact audited theorem scope without promoting it to replay", async () => {
    const inspected =
      await executeTheoryFormalVerifierGatewayCapability({
        capabilityId:
          THEORY_FORMAL_VERIFIER_INSPECT_ARTIFACT_FAMILY_CAPABILITY,
        args: {
          formal_artifact_id:
            "casimir:lanyon:gr_hyperbolic_maxwell_1d:formal_source",
          theorem_name: "xHyperbolicity",
        },
        accountType: "developer",
        profileId: "profile:formal-audit",
        turnId: "ask:test:formal-audit",
      });

    expect(inspected).toMatchObject({
      ok: true,
      status: "succeeded",
      admissionReason: "formal_artifact_family_audit_inspected",
      missingRequirements: expect.arrayContaining(
        [
          "formal_generator_lineage_unavailable",
          "formal_c_implementation_placeholder_noop",
          "formal_c_refinement_unassessed",
          "formal_environment_unpinned",
          "formal_import_closure_unpinned",
          "semantic_to_lean_binding_required",
          "observed_theorem_type_required",
          "formal_execution_catalog_unconfigured",
          "formal_execution_catalog_inspector_unconfigured",
          "formal_external_sandbox_executor_unconfigured",
          "runtime_approval_receipt_issuer_unconfigured",
          "runtime_approval_receipt_replay_ledger_unconfigured",
          "formal_durable_job_state_store_unconfigured",
        ].map((code) =>
          expect.objectContaining({
            code,
            repair_action: "repair",
          }),
        ),
      ),
      observation: {
        schema:
          "casimir.theory_formal_verifier.artifact_family_audit_observation.v1",
        selectedTheorem: {
          theoremId: "gr_hyperbolic_maxwell_1d.xHyperbolicity",
          propertyKind: "real_typed_expression_witness",
          claimCeiling: "definition_well_typed",
          replay: {
            status: "blocked",
            observedTheoremTypeSha256: null,
          },
        },
        selectedCase: {
          artifactLineage: {
            generator: {
              status: "not_published_in_pinned_repository",
              blockerCode: "formal_generator_lineage_unavailable",
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
            authority: {
              executionEnrollmentAuthority: false,
              assistantAnswer: false,
              terminalEligible: false,
            },
          },
        },
        generationLineageAudit: {
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
        },
        runtimeReadiness: {
          schema:
            "casimir.theory_formal_verifier.runtime_readiness.v2",
          status: "blocked",
          composition: {
            executionCatalogResolverConfigured: false,
            executionCatalogInspectorConfigured: false,
            externalSandboxExecutorResolverConfigured: false,
            trustedReceiptVerifierConfigured: false,
            durableReplayLedgerConfigured: false,
            durableJobStateStoreConfigured: false,
          },
          catalog: {
            configured: false,
            entryCount: 0,
            issues: [],
          },
          configuredForExactResolutionAttempt: false,
          blockerCodes: [
            "formal_execution_catalog_unconfigured",
            "formal_execution_catalog_inspector_unconfigured",
            "formal_external_sandbox_executor_unconfigured",
            "runtime_approval_receipt_issuer_unconfigured",
            "runtime_approval_receipt_replay_ledger_unconfigured",
            "formal_durable_job_state_store_unconfigured",
          ],
          authority: {
            configurationEvidenceOnly: true,
            exactCatalogEntryResolved: false,
            exactExecutorResolved: false,
            assistantAnswer: false,
            terminalEligible: false,
          },
        },
        authority: {
          sourceAdmissionAuthority: true,
          generatorLineageRegistered: false,
          formalPropositionChecked: false,
          replayEligible: false,
          scientificAuthority: false,
          physicalAuthority: false,
          assistantAnswer: false,
          terminalEligible: false,
        },
        next_affordances: [],
        terminal_eligible: false,
        assistant_answer: false,
      },
    });
  });

  it("fails closed for a theorem-name lookalike and for a public account", async () => {
    const lookalike =
      await executeTheoryFormalVerifierGatewayCapability({
        capabilityId:
          THEORY_FORMAL_VERIFIER_INSPECT_ARTIFACT_FAMILY_CAPABILITY,
        args: {
          formal_artifact_id:
            "casimir:lanyon:gr_hyperbolic_maxwell_1d:formal_source",
          theorem_name: "Hyperbolicity",
        },
        accountType: "developer",
        profileId: "profile:formal-audit",
        turnId: "ask:test:formal-audit-lookalike",
      });
    expect(lookalike).toMatchObject({
      ok: false,
      status: "blocked",
      blockedReason: "formal_artifact_family_theorem_unregistered",
      observation: {
        selectedTheorem: null,
        next_affordances: [],
        terminal_eligible: false,
        assistant_answer: false,
      },
    });

    const publicResult =
      await executeTheoryFormalVerifierGatewayCapability({
        capabilityId:
          THEORY_FORMAL_VERIFIER_INSPECT_ARTIFACT_FAMILY_CAPABILITY,
        args: {},
        accountType: "user",
        profileId: "profile:public",
        turnId: "ask:test:formal-audit-public",
      });
    expect(publicResult).toMatchObject({
      ok: false,
      status: "blocked",
      blockedReason: "developer_account_required",
      observation: {
        terminal_eligible: false,
        assistant_answer: false,
      },
    });
  });

  it("re-enters an exact audited source observation without pretending it was generated", async () => {
    const turnId = "ask:test:formal-audit-continuation";
    const artifactRef = "formal-source-audit:gr-hyperbolic-maxwell-1d";
    const inspected =
      await executeTheoryFormalVerifierGatewayCapability({
        capabilityId:
          THEORY_FORMAL_VERIFIER_INSPECT_ARTIFACT_FAMILY_CAPABILITY,
        args: {
          formal_artifact_id:
            "casimir:lanyon:gr_hyperbolic_maxwell_1d:formal_source",
          theorem_name: "xHyperbolicity",
        },
        accountType: "developer",
        profileId: "profile:formal-audit",
        turnId,
      });
    expect(inspected.ok).toBe(true);

    const prepared =
      await executeTheoryFormalVerifierGatewayCapability({
        capabilityId:
          THEORY_FORMAL_VERIFIER_PREPARE_REQUEST_CAPABILITY,
        args: {
          procedure_artifact_ref: "procedure-artifact:gr-maxwell",
          procedure_id: "procedure:gr-maxwell",
          procedure_sha256: "a".repeat(64),
          semantic_admission_artifact_ref:
            "semantic-admission:gr-maxwell",
          formal_source_admission_artifact_ref: artifactRef,
          claim_id: "claim:gr-maxwell:x-hyperbolicity",
          formal_artifact_id:
            "casimir:lanyon:gr_hyperbolic_maxwell_1d:formal_source",
          theorem_name: "xHyperbolicity",
          environment_policy_id: "lean4-mathlib:gr-maxwell",
        },
        accountType: "developer",
        profileId: "profile:formal-audit",
        turnId,
        authoritativeEvidenceArtifacts: [
          {
            schema: "helix.current_turn_artifact.v1",
            turn_id: turnId,
            artifact_id: artifactRef,
            assistant_answer: false,
            terminal_eligible: false,
            payload: inspected.observation,
          },
        ],
      });

    const observation = prepared.observation as Record<string, any>;
    const receipt =
      observation.preparation_receipt as CasimirFormalVerificationPreparationReceiptV1;
    const codes = receipt.missingRequirements.map((entry) => entry.code);
    expect(receipt.admittedBindings).toMatchObject({
      artifactGenerationArtifactRef: null,
      formalSourceAdmissionArtifactRef: artifactRef,
      formalArtifactId:
        "casimir:lanyon:gr_hyperbolic_maxwell_1d:formal_source",
      formalSourceSha256:
        "7a7a82ccf996338fd0c788c65e5374894f4d3d58625c3f361088e0bd22fd9377",
      theoremPropertyKind: "real_typed_expression_witness",
      theoremClaimCeiling: "definition_well_typed",
    });
    expect(codes).not.toContain(
      "artifact_generation_receipt_not_admitted",
    );
    expect(codes).not.toContain("formal_source_root_unconfigured");
    expect(codes).toEqual(
      expect.arrayContaining([
        "authoritative_procedure_artifact_not_admitted",
        "semantic_admission_artifact_not_admitted",
        "formal_theorem_type_digest_required",
        "semantic_to_lean_binding_required",
        "formal_import_closure_required",
        "formal_environment_policy_catalog_unconfigured",
      ]),
    );
    expect(observation).toMatchObject({
      disposition: "blocked",
      next_affordances: [],
      terminal_eligible: false,
      assistant_answer: false,
    });
  });

  it("reports a malformed missing-requirements field without throwing", async () => {
    const issues =
      await validateCasimirFormalVerificationPreparationReceiptIntegrityV1({
        artifactId:
          "casimir_formal_verification_preparation_receipt/v1",
        schemaVersion: "1.0.0",
        generatedAt: new Date(0).toISOString(),
        preparedRequestId: "prepared:malformed",
        sourceTurnId: "turn:malformed",
        disposition: "blocked",
        bindings: {},
        missingRequirements: null,
        preparedSealedInputSha256: null,
        authority: {},
        receiptSha256: "0".repeat(64),
      });

    expect(issues).toEqual(
      expect.arrayContaining([
        "preparation_missing_requirements_invalid",
        "blocked_preparation_missing_reason",
      ]),
    );
  });

  it("keeps the current Lanyon Mathlib case blocked with typed closure requirements", async () => {
    const prepared =
      await executeTheoryFormalVerifierGatewayCapability({
        capabilityId:
          THEORY_FORMAL_VERIFIER_PREPARE_REQUEST_CAPABILITY,
        args: {
          procedure_artifact_ref: "procedure-artifact:lanyon",
          procedure_id: "procedure:lanyon:advection-diffusion",
          procedure_sha256: "a".repeat(64),
          semantic_admission_artifact_ref:
            "semantic-admission:lanyon",
          artifact_generation_artifact_ref:
            "artifact-generation:lanyon",
          claim_id: "claim:advection-diffusion",
          formal_artifact_id:
            "lanyon:advection_diffusion_full_1d",
          theorem_name: "xFluxConsistency",
          environment_policy_id: "lean4-mathlib:lanyon",
        },
        accountType: "developer",
        profileId: "profile:formal-preparation",
        turnId: "ask:test:formal-preparation",
        authoritativeEvidenceArtifacts: [],
      });

    expect(prepared).toMatchObject({
      ok: false,
      status: "blocked",
      admissionReason: "formal_prepared_request_blocked",
    });
    const observation = prepared.observation as Record<string, any>;
    const receipt =
      observation.preparation_receipt as CasimirFormalVerificationPreparationReceiptV1;
    expect(observation).toMatchObject({
      disposition: "blocked",
      next_affordances: [],
      terminal_eligible: false,
      assistant_answer: false,
    });
    expect(
      receipt.missingRequirements.map((entry) => entry.code),
    ).toEqual(
      expect.arrayContaining([
        "authoritative_procedure_artifact_not_admitted",
        "semantic_admission_artifact_not_admitted",
        "artifact_generation_receipt_not_admitted",
        "formal_claim_selection_required",
        "formal_theorem_selection_unregistered",
        "formal_theorem_type_digest_required",
        "semantic_to_lean_binding_required",
        "formal_import_closure_required",
        "formal_environment_policy_catalog_unconfigured",
        "formal_graph_snapshot_required",
        "formal_source_root_unconfigured",
      ]),
    );
    expect(
      await validateCasimirFormalVerificationPreparationReceiptIntegrityV1(
        receipt,
      ),
    ).toEqual([]);

    const plan =
      await executeTheoryFormalVerifierGatewayCapability({
        capabilityId: THEORY_FORMAL_VERIFIER_PLAN_CAPABILITY,
        args: {
          prepared_request_id: receipt.preparedRequestId,
        },
        accountType: "developer",
        profileId: "profile:formal-preparation",
        turnId: "ask:test:formal-plan",
      });
    expect(plan).toMatchObject({
      ok: false,
      status: "blocked",
      blockedReason: "formal_prepared_request_not_ready",
      error: "formal_prepared_request_not_ready",
    });
  });

  it("does not accept a caller-self-hashed semantic-to-Lean binding", async () => {
    const prepared =
      await executeTheoryFormalVerifierGatewayCapability({
        capabilityId:
          THEORY_FORMAL_VERIFIER_PREPARE_REQUEST_CAPABILITY,
        args: {
          procedure_artifact_ref: "procedure-artifact:lanyon",
          procedure_id: "procedure:lanyon:advection-diffusion",
          procedure_sha256: "a".repeat(64),
          semantic_admission_artifact_ref:
            "semantic-admission:lanyon",
          artifact_generation_artifact_ref:
            "artifact-generation:lanyon",
          claim_id: "claim:advection-diffusion",
          formal_artifact_id:
            "lanyon:advection_diffusion_full_1d",
          theorem_name: "xFluxConsistency",
          theorem_type_sha256: "b".repeat(64),
          semantic_to_lean_binding_id: "caller:binding:lookalike",
          semantic_to_lean_binding_sha256: "c".repeat(64),
          environment_policy_id: "lean4-mathlib:lanyon",
          sandbox_executor_capability_id:
            "caller:local-workstation:lookalike",
        },
        accountType: "developer",
        profileId: "profile:formal-preparation",
        turnId: "ask:test:formal-binding-lookalike",
        authoritativeEvidenceArtifacts: [],
      });

    const observation = prepared.observation as Record<string, any>;
    const codes = observation.preparation_receipt.missingRequirements.map(
      (entry: { code: string }) => entry.code,
    );
    expect(codes).toContain(
      "semantic_to_lean_binding_unregistered",
    );
    expect(codes).not.toContain("semantic_to_lean_binding_required");
    expect(codes).toContain(
      "formal_sandbox_executor_catalog_unconfigured",
    );
    expect(observation).toMatchObject({
      disposition: "blocked",
      next_affordances: [],
      terminal_eligible: false,
      assistant_answer: false,
      preparation_receipt: {
        admittedBindings: {
          theoremTypeSha256: null,
          semanticToLeanBindingId: null,
          semanticToLeanBindingSha256: null,
          sandboxExecutorCapabilityId: null,
          sandboxExecutorCapabilitySha256: null,
        },
      },
    });
  });

  it("does not let an unrelated True theorem and self-hashed caller policy reach plan preflight", async () => {
    const result =
      await executeTheoryFormalVerifierGatewayCapability({
        capabilityId: THEORY_FORMAL_VERIFIER_PLAN_CAPABILITY,
        args: {
          request: {
            claim: {
              claimId: "claim:unrelated-scientific-proposition",
              propositionSha256: "c".repeat(64),
            },
            formalArtifact: {
              theoremName: "unrelatedTrue",
              statementSha256: "c".repeat(64),
            },
          },
          policy: {
            policyId: "caller-self-hashed-policy",
            artifactSha256: "d".repeat(64),
          },
          theorem_source_path: "C:\\caller\\UnrelatedTrue.lean",
          import_source_paths: {},
        },
        accountType: "developer",
        profileId: "profile:formal-preparation",
        turnId: "ask:test:unrelated-true",
      });

    expect(result).toMatchObject({
      ok: false,
      status: "missing_input",
      admissionReason:
        "formal_verifier_prepared_request_gate_blocked",
      blockedReason: "formal_prepared_request_required",
      error: "formal_prepared_request_required",
    });
    expect(
      (result.observation as Record<string, any>).next_affordances,
    ).toEqual([]);
  });
});
