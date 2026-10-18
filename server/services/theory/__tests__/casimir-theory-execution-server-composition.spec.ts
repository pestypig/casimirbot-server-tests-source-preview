import { afterEach, describe, expect, it } from "vitest";

import {
  inspectCasimirFormalVerifierRuntimeReadinessV2,
} from "../casimir-formal-verifier-job-service.v2";
import {
  installCasimirFormalExecutionDependenciesForServerV2,
  installCasimirTheoryExecutionRuntimeApprovalDependenciesForServerV1,
  installCasimirTheoryExecutionStateDependenciesForServerV1,
  resetCasimirTheoryExecutionServerCompositionForTestsV1,
} from "../casimir-theory-execution-server-composition";
import { createInMemoryCasimirTheoryExecutionStateStoreV1 } from "../casimir-theory-execution-state-store";

describe("Casimir theory execution server composition", () => {
  afterEach(() => {
    resetCasimirTheoryExecutionServerCompositionForTestsV1();
  });

  it("merges approval trust and formal execution dependencies in either installation order", () => {
    installCasimirTheoryExecutionStateDependenciesForServerV1({
      formalStateStore: {
        ...createInMemoryCasimirTheoryExecutionStateStoreV1(),
        durability: "durable_postgres",
      },
    });
    installCasimirFormalExecutionDependenciesForServerV2({
      resolveTrustedExecutionCatalogEntry: () => null,
      inspectTrustedExecutionCatalog: () => ({
        schema:
          "casimir.formal_verification_execution_catalog.v2",
        configured: true,
        entryCount: 1,
        entries: [
          {
            executionCatalogEntryId: "catalog-entry:test",
            enrollmentId: "enrollment:test",
            enrollmentArtifactSha256: "a".repeat(64),
            procedureId: "procedure:test",
            procedureSha256: "b".repeat(64),
            requestId: "request:test",
            requestArtifactSha256: "c".repeat(64),
            sealedInputSha256: "d".repeat(64),
            executorCapabilityId: "executor:test",
            executorCapabilitySha256: "e".repeat(64),
            generatorRegistrationId: "generator:test",
            generatorRevisionSha256: "f".repeat(64),
          },
        ],
        issues: [],
        authority: {
          serverInstalledCatalogOnly: true,
          callerSuppliedExecutionAuthority: false,
          assistantAnswer: false,
          terminalEligible: false,
        },
      }),
      resolveExternalSandboxExecutor: () => null,
    });
    expect(
      inspectCasimirFormalVerifierRuntimeReadinessV2(),
    ).toMatchObject({
      status: "blocked",
      composition: {
        executionCatalogResolverConfigured: true,
        executionCatalogInspectorConfigured: true,
        externalSandboxExecutorResolverConfigured: true,
        trustedReceiptVerifierConfigured: false,
        durableReplayLedgerConfigured: false,
        durableJobStateStoreConfigured: true,
      },
      catalog: {
        configured: true,
        entryCount: 1,
        issues: [],
      },
      blockerCodes: [
        "runtime_approval_receipt_issuer_unconfigured",
        "runtime_approval_receipt_replay_ledger_unconfigured",
      ],
    });

    installCasimirTheoryExecutionRuntimeApprovalDependenciesForServerV1(
      {
        verifyTrustedRuntimeReceipt: () => ({ ok: true }),
        confirmationReplayLedger: {
          consumeOnce: () => ({ status: "consumed" }),
        },
      },
    );
    expect(
      inspectCasimirFormalVerifierRuntimeReadinessV2(),
    ).toMatchObject({
      status: "configured",
      composition: {
        executionCatalogResolverConfigured: true,
        executionCatalogInspectorConfigured: true,
        externalSandboxExecutorResolverConfigured: true,
        trustedReceiptVerifierConfigured: true,
        durableReplayLedgerConfigured: true,
        durableJobStateStoreConfigured: true,
      },
      configuredForExactResolutionAttempt: true,
      blockerCodes: [],
      authority: {
        configurationEvidenceOnly: true,
        exactCatalogEntryResolved: false,
        exactExecutorResolved: false,
        assistantAnswer: false,
        terminalEligible: false,
      },
    });

    installCasimirFormalExecutionDependenciesForServerV2({});
    expect(
      inspectCasimirFormalVerifierRuntimeReadinessV2(),
    ).toMatchObject({
      status: "blocked",
      composition: {
        executionCatalogResolverConfigured: false,
        executionCatalogInspectorConfigured: false,
        externalSandboxExecutorResolverConfigured: false,
        trustedReceiptVerifierConfigured: true,
        durableReplayLedgerConfigured: true,
        durableJobStateStoreConfigured: true,
      },
      blockerCodes: [
        "formal_execution_catalog_unconfigured",
        "formal_execution_catalog_inspector_unconfigured",
        "formal_external_sandbox_executor_unconfigured",
      ],
    });
  });
});
