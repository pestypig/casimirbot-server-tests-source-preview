import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildCasimirIndependentNumericalReplayPolicyV1 } from "../../../../shared/contracts/casimir-independent-numerical-replay-policy.v1";
import { buildCasimirIndependentNumericalVerificationRequestV1 } from "../../../../shared/contracts/casimir-independent-numerical-verification.v1";
import type { TheoryExperimentProcedureV1 } from "../../../../shared/contracts/theory-experiment-procedure.v1";
import { buildNhm2TheoryBadgeGraphV1 } from "../../../../shared/theory/nhm2-theory-badges";
import { buildTheoryContextReflection } from "../../../../shared/theory/theory-context-reflector";
import { compileTheoryExperimentProcedureV1 } from "../../../../shared/theory/theory-experiment-procedure-compiler";
import { CasimirIndependentNumericalExecutionCatalogResolutionErrorV1 } from "../casimir-independent-numerical-execution-catalog";
import { createCasimirIndependentNumericalVerifierJobService } from "../casimir-independent-numerical-verifier-job-service";
import { createInMemoryCasimirTheoryExecutionStateStoreV1 } from "../casimir-theory-execution-state-store";
import { buildNumericalLaneGenerationEvidence } from "./casimir-independent-numerical-generation-fixture";
import {
  buildRuntimeToolConfirmationTestReceipt,
  createTrustedRuntimeTestReplayLedger,
  verifyTrustedRuntimeTestReceipt,
} from "./runtime-tool-confirmation-fixture";

const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
const hash = (character: string): string => character.repeat(64);
const roots: string[] = [];
const PROCEDURE_TURN_ID = "ask:numerical-verifier:prepare";
const PROCEDURE_BADGE_ID = "study.casimir_dp.evidence_map_stage3";
const durableTestStateStore = () => ({
  ...createInMemoryCasimirTheoryExecutionStateStoreV1(),
  durability: "durable_postgres" as const,
});

const procedureEnvelope = (
  procedure: TheoryExperimentProcedureV1,
  turnId = PROCEDURE_TURN_ID,
): Record<string, unknown> => ({
  schema: "helix.current_turn_artifact.v1",
  turn_id: turnId,
  artifact_id: `${turnId}:procedure-observation`,
  assistant_answer: false,
  terminal_eligible: false,
  payload: {
    schema: "casimir.theory_experiment_procedure.observation.v1",
    status: "succeeded",
    procedure,
    assistant_answer: false,
    terminal_eligible: false,
  },
});

async function buildProcedureAdmissionFixture() {
  const graph = buildNhm2TheoryBadgeGraphV1();
  const generatedAt = "2026-07-25T00:00:00.000Z";
  const reflection = buildTheoryContextReflection({
    graph,
    prompt:
      "Compare the admitted definition with a pinned one-dimensional advection-diffusion numerical lane.",
    mentionedDomains: [PROCEDURE_BADGE_ID],
    generatedAt,
    reflectionId: `${PROCEDURE_TURN_ID}:reflection`,
  });
  const procedure = await compileTheoryExperimentProcedureV1({
    graph,
    turnId: PROCEDURE_TURN_ID,
    procedureId: "procedure:periodic-1d",
    generatedAt,
    reflection,
    request: {
      operation: "compare",
      target: "one-dimensional periodic advection diffusion",
      targetObservable: "concentration_field",
      scaleLog10M: { min: -3, max: 0 },
      coordinateFrame: "laboratory",
      initialBoundaryConditions: [
        "periodic domain",
        "sinusoidal initial concentration",
      ],
      formalSystem: null,
      requestedPrecision: "1e-3",
      evidenceMaturityCeiling: "diagnostic",
      normalizationStatus: "explicit",
    },
    selectedBadgeIds: [PROCEDURE_BADGE_ID],
    evidenceBindings: [
      {
        artifactRef: `${PROCEDURE_TURN_ID}:paper-sidecar`,
        kind: "research_paper_sidecar",
        schema: "helix.paper_evidence_sidecar.v1",
        sourceTurnId: PROCEDURE_TURN_ID,
        admissionTurnId: PROCEDURE_TURN_ID,
        contentSha256: hash("a"),
        admission: "current_turn_admitted",
        authority: "evidence_only",
        assistantAnswer: false,
        terminalEligible: false,
      },
    ],
    lanyon: {
      requested: true,
      caseId: "advection_diffusion_full_1d",
    },
  });
  return {
    procedure,
    turnId: PROCEDURE_TURN_ID,
    authoritativeEvidenceArtifacts: [procedureEnvelope(procedure)],
  };
}

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function fixture(input: { includeReplayLedger?: boolean } = {}) {
  const procedureAdmission = await buildProcedureAdmissionFixture();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "casimir-job-test-"));
  roots.push(root);
  const bytes = {
    harnessSource: "harness-source",
    harnessExecutable: "harness-executable",
    primarySource: "primary-source",
    primaryBuildManifest: "primary-build",
    primaryExecutable: "primary-executable",
    independentSource: "independent-source",
    independentBuildManifest: "independent-build",
    independentExecutable: "independent-executable",
  };
  const paths = Object.fromEntries(
    Object.keys(bytes).map((key) => [key, path.join(root, `${key}.bin`)]),
  ) as Record<keyof typeof bytes, string>;
  await Promise.all(
    (Object.keys(bytes) as Array<keyof typeof bytes>).map((key) =>
      fs.writeFile(paths[key], bytes[key]),
    ),
  );
  const primaryEnvironment = {
    environmentId: "primary-env",
    toolchainSha256: hash("1"),
    runtimeSha256: hash("2"),
    platformSha256: hash("3"),
  };
  const independentEnvironment = {
    environmentId: "independent-env",
    toolchainSha256: hash("4"),
    runtimeSha256: hash("5"),
    platformSha256: hash("6"),
  };
  const casimirSpec = {
    specId: "spec.1d",
    schemaVersion: "casimir_spec_scientific_claim_ir/v1" as const,
    semanticSha256: hash("a"),
    artifactSha256: hash("b"),
  };
  const claim = { claimId: "claim.1d", propositionSha256: hash("c") };
  const primaryEvidence = await buildNumericalLaneGenerationEvidence({
    lane: "primary",
    casimirSpec,
    claim,
    implementation: {
      implementationId: "primary",
      lineageId: "casimir",
      sourceSha256: digest(bytes.primarySource),
      buildManifestSha256: digest(bytes.primaryBuildManifest),
    },
  });
  const independentEvidence = await buildNumericalLaneGenerationEvidence({
    lane: "independent",
    casimirSpec,
    claim,
    implementation: {
      implementationId: "independent",
      lineageId: "lanyon",
      sourceSha256: digest(bytes.independentSource),
      buildManifestSha256: digest(bytes.independentBuildManifest),
    },
  });
  const request = await buildCasimirIndependentNumericalVerificationRequestV1({
    generatedAt: "2026-07-25T00:00:00.000Z",
    requestId: "job-request",
    casimirSpec,
    claim,
    primaryImplementation: primaryEvidence.implementationBinding,
    independentImplementation: independentEvidence.implementationBinding,
    frozenCase: {
      caseId: "periodic-1d",
      inputsSha256: hash("7"),
      meshSha256: hash("8"),
      initialConditionsSha256: hash("9"),
      boundaryConditionsSha256: hash("0"),
      observables: [{ observableId: "l2_error", unit: "1" }],
    },
    comparisonPolicy: {
      policyId: "comparison-v1",
      artifactSha256: hash("f"),
      norm: "linf",
      tolerances: [
        {
          observableId: "l2_error",
          absoluteTolerance: 1e-8,
          relativeTolerance: 1e-6,
        },
      ],
      minimumRefinementLevels: 3,
      minimumObservedOrder: 1.5,
      deterministicSeed: "fixed",
    },
    environments: {
      primary: primaryEnvironment,
      independent: independentEnvironment,
    },
    executionPolicy: {
      replayCount: 2,
      networkAllowed: false,
      arbitraryCommandAllowed: false,
      outerObservedProcessRequired: true,
    },
  });
  const policy = await buildCasimirIndependentNumericalReplayPolicyV1({
    generatedAt: "2026-07-25T00:00:00.000Z",
    policyId: "replay-v1",
    harness: {
      protocol: "casimir_numerical_harness_json_files/v1",
      launchMode: "native_executable",
      sourceSha256: digest(bytes.harnessSource),
      executableSha256: digest(bytes.harnessExecutable),
    },
    lanes: {
      primary: {
        implementationId: "primary",
        lineageId: "casimir",
        sourceSha256: digest(bytes.primarySource),
        buildManifestSha256: digest(bytes.primaryBuildManifest),
        executableSha256: digest(bytes.primaryExecutable),
        environment: primaryEnvironment,
      },
      independent: {
        implementationId: "independent",
        lineageId: "lanyon",
        sourceSha256: digest(bytes.independentSource),
        buildManifestSha256: digest(bytes.independentBuildManifest),
        executableSha256: digest(bytes.independentExecutable),
        environment: independentEnvironment,
      },
    },
    execution: {
      replayCount: 2,
      networkAllowed: false,
      arbitraryCommandAllowed: false,
      outerObservedProcessRequired: true,
      timeoutMs: 30_000,
      maxOutputBytes: 1_048_576,
      maximumRefinementLevels: 8,
    },
  });
  const procedure = {
    schemaVersion: "theory_experiment_procedure/v1" as const,
    procedureId: procedureAdmission.procedure.procedureId,
    procedureSha256: procedureAdmission.procedure.procedureSha256,
  };
  const executorCapability = {
    capabilityId: "executor:sandboxed-numerical-worker:v1",
    artifactSha256: hash("d"),
  };
  const sealedInput = {
    procedure,
    executorCapability,
    request,
    policy,
    primaryGenerationRequest: primaryEvidence.generationRequest,
    primaryProducerReceipt: primaryEvidence.producerReceipt,
    independentGenerationRequest: independentEvidence.generationRequest,
    independentProducerReceipt: independentEvidence.producerReceipt,
    harnessSourcePath: paths.harnessSource,
    harnessExecutablePath: paths.harnessExecutable,
    primarySourcePath: paths.primarySource,
    primaryBuildManifestPath: paths.primaryBuildManifest,
    primaryExecutablePath: paths.primaryExecutable,
    independentSourcePath: paths.independentSource,
    independentBuildManifestPath: paths.independentBuildManifest,
    independentExecutablePath: paths.independentExecutable,
  };
  const service = createCasimirIndependentNumericalVerifierJobService({
    resolveTrustedExecutionCatalogEntry: ({
      catalogEntryId,
      procedureId,
      procedureSha256,
    }) =>
      catalogEntryId === "catalog:periodic-1d" &&
      procedureId === procedure.procedureId &&
      procedureSha256 === procedure.procedureSha256
        ? sealedInput
        : null,
    verifyTrustedRuntimeReceipt: verifyTrustedRuntimeTestReceipt,
    ...(input.includeReplayLedger === false
      ? {}
      : {
          confirmationReplayLedger: createTrustedRuntimeTestReplayLedger(),
        }),
    now: () => Date.parse("2026-07-25T00:02:00.000Z"),
    resolveSandboxedExecutor: (expectedCapability) =>
      expectedCapability.capabilityId === executorCapability.capabilityId &&
      expectedCapability.artifactSha256 === executorCapability.artifactSha256
        ? {
            ...executorCapability,
            runner: async (run) => {
              await fs.writeFile(
                run.args[3],
                JSON.stringify({
                  schema: "casimir.independent_numerical_harness.output.v1",
                  requestArtifactSha256: request.artifactSha256,
                  policyArtifactSha256: policy.artifactSha256,
                  runs: {
                    primary: {
                      implementationId: "primary",
                      replays: [hash("1"), hash("1")].map(
                        (outputManifestSha256, index) => ({
                          outputManifestSha256,
                          transcriptSha256: index === 0 ? hash("2") : hash("3"),
                          refinementLevels: 3,
                        }),
                      ),
                    },
                    independent: {
                      implementationId: "independent",
                      replays: [hash("4"), hash("4")].map(
                        (outputManifestSha256, index) => ({
                          outputManifestSha256,
                          transcriptSha256: index === 0 ? hash("5") : hash("6"),
                          refinementLevels: 3,
                        }),
                      ),
                    },
                  },
                  comparisons: [
                    {
                      observableId: "l2_error",
                      unit: "1",
                      maximumAbsoluteError: 5e-9,
                      maximumRelativeError: 5e-7,
                      observedConvergenceOrder: 2,
                    },
                  ],
                  blockers: [],
                }),
              );
              return {
                startedAt: "2026-07-25T00:00:01.000Z",
                completedAt: "2026-07-25T00:00:02.000Z",
                exitCode: 0,
                signal: null,
                stdout: "",
                stderr: "",
                timedOut: false,
                outputLimitExceeded: false,
                spawnError: null,
              };
            },
          }
        : null,
  });
  return {
    service,
    sealedInput,
    procedure: procedureAdmission.procedure,
    turnId: procedureAdmission.turnId,
    authoritativeEvidenceArtifacts:
      procedureAdmission.authoritativeEvidenceArtifacts,
  };
}

describe("Casimir independent numerical verifier jobs", () => {
  it("reports server-owned numerical runtime readiness without accepting caller claims", () => {
    const unconfigured =
      createCasimirIndependentNumericalVerifierJobService();
    expect(unconfigured.inspectConfiguration()).toEqual({
      schema:
        "casimir.independent_numerical_verifier.runtime_inspection.v1",
      executionCatalogConfigured: false,
      sandboxExecutorConfigured: false,
      trustedReceiptVerifierConfigured: false,
      durableReplayLedgerConfigured: false,
      durableJobStateStoreConfigured: false,
      readyForConfirmedExecution: false,
      assistantAnswer: false,
      terminalEligible: false,
    });

    const configured =
      createCasimirIndependentNumericalVerifierJobService({
        resolveTrustedExecutionCatalogEntry: async () => null,
        resolveSandboxedExecutor: async () => null,
        verifyTrustedRuntimeReceipt: verifyTrustedRuntimeTestReceipt,
        confirmationReplayLedger: createTrustedRuntimeTestReplayLedger(),
        stateStore: durableTestStateStore(),
      });
    expect(configured.inspectConfiguration()).toMatchObject({
      executionCatalogConfigured: true,
      sandboxExecutorConfigured: true,
      trustedReceiptVerifierConfigured: true,
      durableReplayLedgerConfigured: true,
      durableJobStateStoreConfigured: true,
      readyForConfirmedExecution: true,
      assistantAnswer: false,
      terminalEligible: false,
    });
  });

  it("turns a persisted running replay from a previous service process into an actionable failure", async () => {
    const stateStore = durableTestStateStore();
    await stateStore.put("job", "numerical-job:interrupted", {
      jobId: "numerical-job:interrupted",
      planId: "numerical-plan:interrupted",
      ownerKey: "developer:developer-a",
      requestId: "numerical-request:interrupted",
      status: "running",
      certificate: null,
      issues: [],
    });
    const restarted =
      createCasimirIndependentNumericalVerifierJobService({
        stateStore,
      });

    await expect(
      restarted.readResult({
        accountType: "developer",
        profileId: "developer-a",
        jobId: "numerical-job:interrupted",
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "failed",
      issues: ["numerical_job_interrupted_by_server_restart"],
    });
    await expect(
      stateStore.get("job", "numerical-job:interrupted"),
    ).resolves.toMatchObject({
      status: "failed",
      issues: ["numerical_job_interrupted_by_server_restart"],
    });
  });

  it("rejects missing, copied, stale-turn, ambiguous, and invalid procedure evidence before catalog resolution", async () => {
    const {
      procedure,
      turnId,
      authoritativeEvidenceArtifacts,
    } = await buildProcedureAdmissionFixture();
    let catalogResolutionCalls = 0;
    const service = createCasimirIndependentNumericalVerifierJobService({
      resolveTrustedExecutionCatalogEntry: () => {
        catalogResolutionCalls += 1;
        return null;
      },
    });
    const baseInput = {
      accountType: "developer" as const,
      profileId: "developer-a",
      turnId,
      catalogEntryId: "catalog:periodic-1d",
      procedureId: procedure.procedureId,
      procedureSha256: procedure.procedureSha256,
    };

    await expect(service.prepareRequest(baseInput)).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      issues: ["numerical_authoritative_evidence_artifacts_required"],
    });
    await expect(
      service.prepareRequest({
        ...baseInput,
        authoritativeEvidenceArtifacts: [],
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      issues: [
        "numerical_authoritative_procedure_artifact_not_admitted",
      ],
    });
    await expect(
      service.prepareRequest({
        ...baseInput,
        authoritativeEvidenceArtifacts: [
          procedureEnvelope(procedure, "ask:numerical-verifier:stale"),
        ],
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      issues: [
        "numerical_authoritative_procedure_artifact_not_admitted",
      ],
    });
    await expect(
      service.prepareRequest({
        ...baseInput,
        authoritativeEvidenceArtifacts: [
          ...authoritativeEvidenceArtifacts,
          structuredClone(authoritativeEvidenceArtifacts[0]),
        ],
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      issues: ["numerical_authoritative_procedure_artifact_ambiguous"],
    });
    const substitutedProcedure = structuredClone(procedure);
    substitutedProcedure.request.target = "caller-substituted target";
    await expect(
      service.prepareRequest({
        ...baseInput,
        authoritativeEvidenceArtifacts: [
          procedureEnvelope(substitutedProcedure),
        ],
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      issues: ["numerical_authoritative_procedure_artifact_invalid"],
    });
    expect(catalogResolutionCalls).toBe(0);
  });

  it("re-enters only bounded typed catalog admission issues", async () => {
    const {
      procedure,
      turnId,
      authoritativeEvidenceArtifacts,
    } = await buildProcedureAdmissionFixture();
    const service = createCasimirIndependentNumericalVerifierJobService({
      resolveTrustedExecutionCatalogEntry: () => {
        throw new CasimirIndependentNumericalExecutionCatalogResolutionErrorV1([
          "numerical_executor_sandbox_capability_insufficient",
          "C:\\private\\bundle\\must-not-reenter",
        ]);
      },
    });
    await expect(
      service.prepareRequest({
        accountType: "developer",
        profileId: "developer-a",
        turnId,
        authoritativeEvidenceArtifacts,
        catalogEntryId: "catalog:periodic-1d",
        procedureId: procedure.procedureId,
        procedureSha256: procedure.procedureSha256,
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      issues: ["numerical_executor_sandbox_capability_insufficient"],
    });
  });

  it("fails closed without a server-owned catalog and rejects forged prepared ids", async () => {
    const admission = await buildProcedureAdmissionFixture();
    const unconfigured = createCasimirIndependentNumericalVerifierJobService();
    await expect(
      unconfigured.prepareRequest({
        accountType: "developer",
        profileId: "developer-a",
        turnId: admission.turnId,
        authoritativeEvidenceArtifacts:
          admission.authoritativeEvidenceArtifacts,
        catalogEntryId: "caller-authored-entry",
        procedureId: admission.procedure.procedureId,
        procedureSha256: admission.procedure.procedureSha256,
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      issues: ["numerical_execution_catalog_unconfigured"],
    });

    const {
      service,
      sealedInput,
      procedure,
      turnId,
      authoritativeEvidenceArtifacts,
    } = await fixture();
    await expect(
      service.plan({
        accountType: "developer",
        profileId: "developer-a",
        preparedRequestId: "caller-forged-prepared-id",
        sealedInput,
      } as any),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      issues: ["numerical_prepared_request_not_found"],
    });

    const prepared = await service.prepareRequest({
      accountType: "developer",
      profileId: "developer-a",
      turnId,
      authoritativeEvidenceArtifacts,
      catalogEntryId: "catalog:periodic-1d",
      procedureId: procedure.procedureId,
      procedureSha256: procedure.procedureSha256,
    });
    await expect(
      service.plan({
        accountType: "developer",
        profileId: "developer-b",
        preparedRequestId: prepared.preparedRequestId,
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      issues: ["numerical_prepared_request_not_found"],
    });
  });

  it("does not treat a bare process runner as sandbox authority", async () => {
    const {
      sealedInput,
      procedure,
      turnId,
      authoritativeEvidenceArtifacts,
    } = await fixture();
    const service = createCasimirIndependentNumericalVerifierJobService({
      resolveTrustedExecutionCatalogEntry: () => sealedInput,
      runner: async () => {
        throw new Error("bare_runner_must_not_execute");
      },
    });
    const prepared = await service.prepareRequest({
      accountType: "developer",
      profileId: "developer-a",
      turnId,
      authoritativeEvidenceArtifacts,
      catalogEntryId: "catalog:periodic-1d",
      procedureId: procedure.procedureId,
      procedureSha256: procedure.procedureSha256,
    });
    await expect(
      service.plan({
        accountType: "developer",
        profileId: "developer-a",
        preparedRequestId: prepared.preparedRequestId,
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      issues: expect.arrayContaining([
        "numerical_sandbox_executor_unconfigured",
      ]),
    });
  });

  it("requires a developer account, server-prepared exact plan, and explicit confirmation", async () => {
    const {
      service,
      procedure,
      turnId,
      authoritativeEvidenceArtifacts,
    } = await fixture();
    const blocked = await service.prepareRequest({
      accountType: "user",
      profileId: "public",
      catalogEntryId: "catalog:periodic-1d",
      procedureId: procedure.procedureId,
      procedureSha256: procedure.procedureSha256,
    });
    expect(blocked).toMatchObject({
      ok: false,
      status: "blocked",
      issues: ["developer_account_required"],
    });
    const prepared = await service.prepareRequest({
      accountType: "developer",
      profileId: "developer-a",
      turnId,
      authoritativeEvidenceArtifacts,
      catalogEntryId: "catalog:periodic-1d",
      procedureId: procedure.procedureId,
      procedureSha256: procedure.procedureSha256,
    });
    expect(prepared).toMatchObject({
      ok: true,
      status: "prepared",
      catalogEntryId: "catalog:periodic-1d",
    });
    const planned = await service.plan({
      accountType: "developer",
      profileId: "developer-a",
      preparedRequestId: prepared.preparedRequestId,
    });
    expect(planned).toMatchObject({ ok: true, status: "ready" });
    const unconfirmed = await service.start({
      accountType: "developer",
      profileId: "developer-a",
      planId: planned.planId,
    });
    expect(unconfirmed).toMatchObject({
      ok: false,
      status: "needs_confirmation",
      issues: ["runtime_approval_receipt_required"],
    });
    const legacy = await service.start({
      accountType: "developer",
      profileId: "developer-a",
      planId: planned.planId,
      approvalToken: "confirmed",
    });
    expect(legacy).toMatchObject({
      ok: false,
      status: "blocked",
      issues: ["runtime_approval_legacy_token_rejected"],
    });
  });

  it("fails closed when a trusted receipt verifier lacks a durable replay ledger", async () => {
    const {
      service,
      procedure,
      turnId: preparationTurnId,
      authoritativeEvidenceArtifacts,
    } = await fixture({
      includeReplayLedger: false,
    });
    const prepared = await service.prepareRequest({
      accountType: "developer",
      profileId: "developer-a",
      turnId: preparationTurnId,
      authoritativeEvidenceArtifacts,
      catalogEntryId: "catalog:periodic-1d",
      procedureId: procedure.procedureId,
      procedureSha256: procedure.procedureSha256,
    });
    const planned = await service.plan({
      accountType: "developer",
      profileId: "developer-a",
      preparedRequestId: prepared.preparedRequestId,
    });
    const sessionId = "session:numerical-verifier:no-ledger";
    const turnId = "ask:numerical-verifier:no-ledger";
    const approvalReceipt = await buildRuntimeToolConfirmationTestReceipt({
      binding: {
        capabilityId: "theory-independent-numerical-verifier.start",
        planId: planned.planId as string,
        accountType: "developer",
        profileId: "developer-a",
        sessionId,
        turnId,
        sealedInputSha256: planned.sealedInputSha256 as string,
      },
      requestId: "request:numerical-verifier:no-ledger",
      receiptId: "receipt:numerical-verifier:no-ledger",
    });

    await expect(
      service.start({
        accountType: "developer",
        profileId: "developer-a",
        planId: planned.planId,
        sessionId,
        turnId,
        approvalReceipt,
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      issues: ["runtime_approval_receipt_replay_ledger_unconfigured"],
    });
  });

  it("runs the sealed plan and isolates the evidence result by owner", async () => {
    const {
      service,
      procedure,
      turnId: preparationTurnId,
      authoritativeEvidenceArtifacts,
    } = await fixture();
    const prepared = await service.prepareRequest({
      accountType: "developer",
      profileId: "developer-a",
      turnId: preparationTurnId,
      authoritativeEvidenceArtifacts,
      catalogEntryId: "catalog:periodic-1d",
      procedureId: procedure.procedureId,
      procedureSha256: procedure.procedureSha256,
    });
    const planned = await service.plan({
      accountType: "developer",
      profileId: "developer-a",
      preparedRequestId: prepared.preparedRequestId,
    });
    const sessionId = "session:numerical-verifier";
    const turnId = "ask:numerical-verifier";
    const approvalReceipt = await buildRuntimeToolConfirmationTestReceipt({
      binding: {
        capabilityId: "theory-independent-numerical-verifier.start",
        planId: planned.planId as string,
        accountType: "developer",
        profileId: "developer-a",
        sessionId,
        turnId,
        sealedInputSha256: planned.sealedInputSha256 as string,
      },
    });
    const started = await service.start({
      accountType: "developer",
      profileId: "developer-a",
      planId: planned.planId,
      sessionId,
      turnId,
      approvalReceipt,
    });
    expect(started).toMatchObject({ ok: true, status: "running" });
    expect(
      await service.readResult({
        accountType: "developer",
        profileId: "developer-b",
        jobId: started.jobId,
      }),
    ).toMatchObject({
      ok: false,
      status: "blocked",
      issues: ["independent_numerical_job_not_found"],
    });
    let result = await service.readResult({
      accountType: "developer",
      profileId: "developer-a",
      jobId: started.jobId,
    });
    for (
      let attempt = 0;
      attempt < 20 && result.status === "running";
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      result = await service.readResult({
        accountType: "developer",
        profileId: "developer-a",
        jobId: started.jobId,
      });
    }
    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      certificate: {
        status: "passed",
        authority: {
          validatesNumericalImplementation: false,
          validatesTheory: false,
          terminalEligible: false,
        },
      },
    });
  });
});
