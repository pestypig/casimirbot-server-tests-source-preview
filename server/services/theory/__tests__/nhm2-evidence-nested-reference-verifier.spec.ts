import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { nhm2ExperimentReadyTheoryCandidateReceiptIdForRequest } from "../../../../shared/contracts/nhm2-experiment-ready-theory-candidate-manifest.v1";
import {
  NHM2_NUMERICAL_OBSERVABLE_PREDICTION_ARTIFACT_ID_PREFIX,
  NHM2_NUMERICAL_OBSERVABLE_PREDICTION_CONTRACT_VERSION,
  NHM2_NUMERICAL_OBSERVABLE_PREDICTION_REF_CONTRACT_VERSIONS,
  type Nhm2NumericalObservablePredictionV1,
} from "../../../../shared/contracts/nhm2-numerical-observable-prediction.v1";
import {
  NHM2_PREDICTION_FREEZE_REQUIRED_FALSIFIER_IDS,
  NHM2_PREDICTION_FREEZE_REQUIRED_OBSERVABLE_IDS,
  NHM2_PREDICTION_FREEZE_REQUIRED_RECEIPT_IDS,
  buildNhm2PredictionFalsifierFreeze,
  isNhm2PredictionFalsifierFreeze,
  type Nhm2PredictionFreezeHashedArtifactRefV1,
  type Nhm2PredictionFreezeObservableId,
} from "../../../../shared/contracts/nhm2-prediction-falsifier-freeze.v1";
import {
  nhm2EvidenceNestedReferenceProvenanceRule,
  verifyNhm2EvidenceNestedReferences,
  type Nhm2EvidenceNestedReferenceReceiptManifestEntry,
  type Nhm2EvidenceNestedReferenceRunIdentity,
  type Nhm2EvidenceNestedReferenceVerifiedPriorRunOutput,
} from "../nhm2-evidence-nested-reference-verifier";

const temporaryRoots: string[] = [];

const sha256 = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

const portable = (root: string, absolutePath: string): string =>
  path.relative(root, absolutePath).replace(/\\/g, "/");

async function fixture() {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "nhm2-nested-reference-"),
  );
  temporaryRoots.push(projectRoot);
  const outputDirectory = path.join(projectRoot, "runs", "primary-001");
  const inputDirectory = path.join(projectRoot, "inputs");
  await Promise.all([
    fs.mkdir(outputDirectory, { recursive: true }),
    fs.mkdir(inputDirectory, { recursive: true }),
  ]);
  const tensorPath = path.join(outputDirectory, "tensor.f64");
  const tensorBytes = Buffer.alloc(4 * 8, 7);
  const inputPath = path.join(inputDirectory, "atlas.json");
  const inputBytes = Buffer.from('{"atlas":"frozen"}\n', "utf8");
  await Promise.all([
    fs.writeFile(tensorPath, tensorBytes),
    fs.writeFile(inputPath, inputBytes),
  ]);
  const tensorRepoPath = portable(projectRoot, tensorPath);
  const inputRepoPath = portable(projectRoot, inputPath);
  const manifestEntry: Nhm2EvidenceNestedReferenceReceiptManifestEntry = {
    path: tensorRepoPath,
    sha256: sha256(tensorBytes),
    sizeBytes: tensorBytes.length,
    freshness: "new",
  };
  return {
    projectRoot,
    outputDirectory,
    tensorPath,
    tensorBytes,
    tensorRepoPath,
    inputPath,
    inputBytes,
    inputRepoPath,
    manifestEntry,
  };
}

async function independentCrossRunFixture() {
  const value = await fixture();
  const primaryDirectory = path.join(value.projectRoot, "runs", "primary-000");
  await fs.mkdir(primaryDirectory, { recursive: true });
  const primaryPath = path.join(primaryDirectory, "primary-tensor.f64");
  const primaryBytes = Buffer.alloc(4 * 8, 13);
  await fs.writeFile(primaryPath, primaryBytes);
  const primaryRepoPath = portable(value.projectRoot, primaryPath);
  const owningRunIdentity: Nhm2EvidenceNestedReferenceRunIdentity = {
    receiptId: "receipt-independent-001",
    runId: "run-independent-001",
    runtimeId: "runtime-independent-001",
  };
  const expectedPriorRunIdentity: Nhm2EvidenceNestedReferenceRunIdentity = {
    receiptId: "receipt-primary-001",
    runId: "run-primary-001",
    runtimeId: "runtime-primary-001",
  };
  const verifiedPriorRunOutput: Nhm2EvidenceNestedReferenceVerifiedPriorRunOutput =
    {
      path: primaryRepoPath,
      sha256: sha256(primaryBytes),
      sizeBytes: primaryBytes.length,
      freshness: "new",
      ...expectedPriorRunIdentity,
    };
  const arrayRef = (pathValue: string, bytes: Buffer) => ({
    path: pathValue,
    sha256: sha256(bytes),
    dtype: "float64",
    shape: [4, 1],
    sizeBytes: bytes.length,
    storageOrder: "row-major",
    componentOrder: ["rho_min"],
  });
  const evidence = {
    identity: {
      primaryExecution: { ...expectedPriorRunIdentity },
      independentPlan: { ...owningRunIdentity },
    },
    comparison: {
      fields: [
        {
          primaryRawOutput: arrayRef(primaryRepoPath, primaryBytes),
          independentRawOutput: arrayRef(
            value.tensorRepoPath,
            value.tensorBytes,
          ),
        },
      ],
    },
  };
  return {
    ...value,
    primaryPath,
    primaryBytes,
    primaryRepoPath,
    owningRunIdentity,
    expectedPriorRunIdentity,
    verifiedPriorRunOutput,
    evidence,
  };
}

const renderJson = (value: unknown): Buffer =>
  Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");

async function numericalPredictionFreezeFixture(options?: {
  nullDiagnosticSeed?: boolean;
  predictionUnitMismatch?: boolean;
  predictionSignMismatch?: boolean;
  predictionIdentityMismatch?: boolean;
}) {
  const value = await fixture();
  const inputsDirectory = path.join(value.projectRoot, "inputs", "prediction");
  await fs.mkdir(inputsDirectory, { recursive: true });

  const writeInput = async (repoPath: string, data: unknown) => {
    const bytes = renderJson(data);
    const absolutePath = path.join(value.projectRoot, ...repoPath.split("/"));
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, bytes);
    return { repoPath, bytes, sha256: sha256(bytes) };
  };
  const support = await writeInput("inputs/prediction/support.json", {
    artifactId: "test-only.prediction-support",
    contractVersion: "test_only_prediction_support/v1",
  });
  const supportRef: Nhm2PredictionFreezeHashedArtifactRefV1 = {
    artifactId: "test-only.prediction-support",
    path: support.repoPath,
    schemaVersion: "test_only_prediction_support/v1",
    sha256: support.sha256,
  };

  const provenanceFiles = await Promise.all(
    (
      [
        [
          "runReceipt",
          NHM2_NUMERICAL_OBSERVABLE_PREDICTION_REF_CONTRACT_VERSIONS.runReceipt,
        ],
        [
          "source",
          NHM2_NUMERICAL_OBSERVABLE_PREDICTION_REF_CONTRACT_VERSIONS.source,
        ],
        [
          "derivation",
          NHM2_NUMERICAL_OBSERVABLE_PREDICTION_REF_CONTRACT_VERSIONS.derivation,
        ],
        [
          "uncertainty",
          NHM2_NUMERICAL_OBSERVABLE_PREDICTION_REF_CONTRACT_VERSIONS.uncertainty,
        ],
      ] as const
    ).map(async ([role, schemaVersion]) => {
      const written = await writeInput(
        `inputs/prediction/provenance/${role}.json`,
        {
          artifactId: `test-only.prediction.${role}`,
          contractVersion: schemaVersion,
          fixtureOnly: true,
        },
      );
      return [
        role,
        {
          artifactId: `test-only.prediction.${role}`,
          path: written.repoPath,
          schemaVersion,
          sha256: written.sha256,
        },
      ] as const;
    }),
  );
  const provenanceRefs = Object.fromEntries(provenanceFiles) as Record<
    (typeof provenanceFiles)[number][0],
    (typeof provenanceFiles)[number][1]
  >;

  const candidateId = "test-only-candidate";
  const selectedProfileId = "test-only-profile";
  const freezeId = "test-only-freeze";
  const modelId = "test-only-model";
  const parameterSetId = "test-only-parameters";
  const uncertaintyBudgetId = "test-only-uncertainty";
  const solverId = "test-only-solver";
  const solverVersion = "1.0.0";
  const sourceCommitSha = "a".repeat(40);
  const frozenAt = "2099-07-19T12:00:00.000Z";
  const dataCollectionOpensAt = "2099-07-19T13:00:00.000Z";
  const observableMetadata = Object.fromEntries(
    NHM2_PREDICTION_FREEZE_REQUIRED_OBSERVABLE_IDS.map((observableId) => [
      observableId,
      {
        definition: `test-only scalar statistic for ${observableId}`,
        unit: observableId === "delta_phi_f" ? "rad" : "test-unit",
        expectedSignOrPhase:
          observableId === "delta_phi_f"
            ? "test-only expected phase"
            : "test-only expected positive sign",
        analysisWindow: "test-only pre-data analysis window",
      },
    ]),
  ) as Record<
    Nhm2PredictionFreezeObservableId,
    {
      definition: string;
      unit: string;
      expectedSignOrPhase: string;
      analysisWindow: string;
    }
  >;

  const predictionFiles = await Promise.all(
    NHM2_PREDICTION_FREEZE_REQUIRED_OBSERVABLE_IDS.map(async (observableId) => {
      const metadata = observableMetadata[observableId];
      const injectMismatch = observableId === "delta_F";
      const predictionUnit =
        options?.predictionUnitMismatch === true && injectMismatch
          ? "other-test-unit"
          : metadata.unit;
      const predictionStatement =
        options?.predictionSignMismatch === true && injectMismatch
          ? "different test-only expected positive sign"
          : metadata.expectedSignOrPhase;
      const prediction: Nhm2NumericalObservablePredictionV1 = {
        artifactId: `${NHM2_NUMERICAL_OBSERVABLE_PREDICTION_ARTIFACT_ID_PREFIX}.${observableId}`,
        contractVersion: NHM2_NUMERICAL_OBSERVABLE_PREDICTION_CONTRACT_VERSION,
        generatedAt: frozenAt,
        frozenAt,
        dataCollectionOpensAt,
        binding: {
          candidateId:
            options?.predictionIdentityMismatch === true && injectMismatch
              ? "different-test-only-candidate"
              : candidateId,
          selectedProfileId,
          freezeId,
          modelId,
          parameterSetId,
          uncertaintyBudgetId,
        },
        observable: {
          observableId,
          definition: metadata.definition,
          unit: predictionUnit,
          centralValue: 1,
          coverageInterval: {
            lower: 0.5,
            upper: 1.5,
            coverageProbability: 0.95,
            unit: predictionUnit,
          },
          signOrPhase:
            observableId === "delta_phi_f"
              ? {
                  kind: "phase",
                  statement: predictionStatement,
                  expectedPhaseRadians: 1,
                }
              : {
                  kind: "positive",
                  statement: predictionStatement,
                  expectedPhaseRadians: null,
                },
          scalingLaw: {
            expression: "y = k x",
            independentVariables: ["x"],
            validityDomain: "test-only bounded fixture domain",
          },
          analysisWindow: metadata.analysisWindow,
        },
        derivation: {
          runId: `test-only-derivation-${observableId}`,
          runtimeId: "test-only-prediction-runtime",
          solverId,
          solverVersion,
          sourceCommitSha,
          runReceiptRef: provenanceRefs.runReceipt,
          sourceRef: provenanceRefs.source,
          derivationRef: provenanceRefs.derivation,
        },
        uncertainty: {
          uncertaintyBudgetId,
          method: "test-only bounded propagation",
          sourceIds: ["test-only-source"],
          derivationRef: provenanceRefs.uncertainty,
        },
        provenanceBoundary: {
          theoryOnly: true,
          dataBoundary: "pre_data",
          empiricalDataUsed: false,
          diagnosticSeed: false,
        },
        claimBoundary: {
          numericalPredictionOnly: true,
          physicalPredictionAuthority: false,
          physicalViabilityClaimAllowed: false,
          transportClaimAllowed: false,
          propulsionClaimAllowed: false,
          routeEtaClaimAllowed: false,
          speedAuthorityClaimAllowed: false,
        },
      };
      const artifact = options?.nullDiagnosticSeed
        ? {
            artifactId: `nhm2.prediction.${observableId}`,
            contractVersion: "nhm2_frozen_observable_prediction/v1",
            generatedAt: frozenAt,
            observableId,
            definition: metadata.definition,
            unit: metadata.unit,
            expectedSignOrPhase:
              "null-only guard: no non-zero physical sign or phase is authorized",
            numericPrediction: null,
            historicalSeedFreshness: "preexisting",
            physicalPredictionAuthority: false,
          }
        : prediction;
      const repoPath = `inputs/prediction/observables/${observableId}.json`;
      const written = await writeInput(repoPath, artifact);
      return {
        observableId,
        metadata: {
          ...metadata,
          expectedSignOrPhase: options?.nullDiagnosticSeed
            ? "null-only guard: no non-zero physical sign or phase is authorized"
            : metadata.expectedSignOrPhase,
        },
        ref: {
          artifactId: artifact.artifactId,
          path: written.repoPath,
          schemaVersion: artifact.contractVersion,
          sha256: written.sha256,
        },
      };
    }),
  );

  const runtimeId = "test-only-primary-runtime";
  const requestId = "test-only-primary-request";
  const freeze = buildNhm2PredictionFalsifierFreeze({
    generatedAt: frozenAt,
    frozenAt,
    dataCollectionOpensAt,
    selectedProfileId,
    freezeId,
    registrationBinding: {
      candidateId,
      candidateManifestPath: "inputs/prediction/candidate-manifest.json",
      candidateManifestSha256: "f".repeat(64),
      runId: "test-only-primary-run",
      requestId,
      receiptId: nhm2ExperimentReadyTheoryCandidateReceiptIdForRequest(
        runtimeId,
        requestId,
      ),
      runtimeId,
      plannedOutputDirectory: portable(
        value.projectRoot,
        value.outputDirectory,
      ),
    },
    model: {
      modelId,
      modelVersion: "1.0.0",
      solverId,
      solverVersion,
      sourceCommitSha,
      definitionRef: supportRef,
      inputManifestRef: supportRef,
    },
    parameterSet: {
      parameterSetId,
      parameterCount: 1,
      manifestRef: supportRef,
    },
    observables: predictionFiles.map((entry) => ({
      observableId: entry.observableId,
      ...entry.metadata,
      uncertaintyBudgetId,
      predictionRef: entry.ref,
    })),
    uncertaintyBudget: {
      uncertaintyBudgetId,
      method: "test-only bounded propagation",
      coverageProbability: 0.95,
      sourceIds: ["test-only-source"],
      observableIds: [...NHM2_PREDICTION_FREEZE_REQUIRED_OBSERVABLE_IDS],
      budgetRef: supportRef,
      covarianceRef: supportRef,
    },
    nullControlPlan: {
      controls: [
        {
          controlId: "test-only-null-control",
          targetObservableIds: [
            ...NHM2_PREDICTION_FREEZE_REQUIRED_OBSERVABLE_IDS,
          ],
          intervention: "test-only intervention",
          expectedOutcome: "test-only null outcome",
          rejectionRule: "test-only rejection rule",
        },
      ],
      planRef: supportRef,
    },
    blindingPlan: {
      blindedFieldIds: ["test-only-blinded-field"],
      unblindingTrigger: "test-only analysis freeze",
      keyCustodianRole: "test-only-custodian",
      analysisRole: "test-only-analysis",
      experimentRole: "test-only-experiment",
      planRef: supportRef,
    },
    decisionPlan: {
      multiplicityMethod: "test-only familywise method",
      familywiseAlpha: 0.05,
      rules: [
        {
          ruleId: "test-only-decision-rule",
          targetObservableIds: [
            ...NHM2_PREDICTION_FREEZE_REQUIRED_OBSERVABLE_IDS,
          ],
          statistic: "test-only statistic",
          comparator: "gt",
          thresholdLower: 0,
          thresholdUpper: null,
          unit: "test-unit",
          falsifierId: NHM2_PREDICTION_FREEZE_REQUIRED_FALSIFIER_IDS[0],
          nullDisposition: "retain test-only null",
          signalDisposition: "record test-only signal",
        },
      ],
      planRef: supportRef,
    },
    falsifierRegistry: {
      falsifiers: NHM2_PREDICTION_FREEZE_REQUIRED_FALSIFIER_IDS.map(
        (falsifierId) => ({
          falsifierId,
          frozenModelId: modelId,
          targetObservableIds: [
            ...NHM2_PREDICTION_FREEZE_REQUIRED_OBSERVABLE_IDS,
          ],
          trigger: "test-only falsifier trigger",
          consequence: "test-only theory disposition",
        }),
      ),
      registryRef: supportRef,
    },
    registrationReceipts: NHM2_PREDICTION_FREEZE_REQUIRED_RECEIPT_IDS.map(
      (receiptId) => ({
        receiptId,
        freezeId,
        selectedProfileId,
        modelId,
        registeredAt: frozenAt,
        issuerId: "test-only-issuer",
        appendOnlyRegistryId: "test-only-registry",
        dataBoundary: "pre_data" as const,
        subjectRef: supportRef,
        registryEntryRef: supportRef,
        signatureRef: supportRef,
        timestampAuthorityRef: supportRef,
      }),
    ),
    analysisCode: {
      repository: "test-only/repository",
      sourceCommitSha,
      entrypoint: "tools/test-only.ts",
      deterministicSeedPolicy: "test-only fixed seed",
      sourceTreeRef: supportRef,
      dependencyLockRef: supportRef,
      environmentRef: supportRef,
      protocolRef: supportRef,
    },
    supersessionPolicy: {
      policyId: "test-only-immutable-supersession",
      policyRef: supportRef,
    },
    freezeManifestRef: supportRef,
  });
  expect(isNhm2PredictionFalsifierFreeze(freeze)).toBe(true);
  expect(freeze.readiness).toMatchObject({
    predictionFreezeReady: true,
    blockers: [],
  });

  return {
    ...value,
    freeze,
    predictionFiles,
    allowedImmutableInputPaths: [
      support.repoPath,
      ...provenanceFiles.map(([, ref]) => ref.path),
      ...predictionFiles.map((entry) => entry.ref.path),
    ],
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("NHM2 evidence nested-reference verifier", () => {
  it("requires owning-run provenance for each computed evidence family", () => {
    const computedFields = [
      ["full_apparatus_source_tensor", "/sourceTensor/rawTotalTensorArray"],
      [
        "full_apparatus_source_tensor",
        "/metricComparison/rawAbsoluteResidualArray",
      ],
      ["covariant_conservation", "/divergence/components/0/residualArray"],
      ["continuous_observer_optimizer", "/extrema/rawExtremaArray"],
      ["worldline_qei", "/worldlines/0/integral/integralReceipt"],
      [
        "dynamic_backreaction_stability_causality",
        "/evolution/samples/0/geometryState",
      ],
      [
        "finite_temperature_finite_geometry_maxwell_stress",
        "/finiteGeometry/maxwellStressTensor",
      ],
      ["mechanical_support_control_margin", "/nonlinearFea/stressField"],
      ["mechanical_support_control_margin", "/nonlinearFea/loadMap"],
      [
        "independent_numerical_replication",
        "/comparison/fields/0/independentRawOutput",
      ],
      ["independent_numerical_replication", "/coldRun/coldStartLog"],
      ["independent_numerical_replication", "/frozenReplay/replayedInputs"],
      ["independent_numerical_replication", "/frozenReplay/replayTranscript"],
      ["independent_numerical_replication", "/comparison/rawComparisonTable"],
      [
        "independent_numerical_replication",
        "/discrepancyDisposition/uncertaintyBudget",
      ],
      [
        "independent_numerical_replication",
        "/discrepancyDisposition/dispositionLog",
      ],
      ["independent_numerical_replication", "/reproducibilityPins/pinLedger"],
    ] as const;

    for (const [evidenceId, location] of computedFields) {
      expect(
        nhm2EvidenceNestedReferenceProvenanceRule({ evidenceId, location }),
      ).toEqual({
        provenanceClass: "computed_output",
        requiredScope: "owning_run_output",
      });
    }
  });

  it("classifies independent primary arrays as exact verified prior-run outputs", () => {
    expect(
      nhm2EvidenceNestedReferenceProvenanceRule({
        evidenceId: "independent_numerical_replication",
        location: "/comparison/fields/0/primaryRawOutput",
      }),
    ).toEqual({
      provenanceClass: "prior_computed_output",
      requiredScope: "verified_prior_run_output",
    });
    expect(
      nhm2EvidenceNestedReferenceProvenanceRule({
        evidenceId: "independent_numerical_replication",
        location: "/comparison/fields/0/independentRawOutput",
      }),
    ).toEqual({
      provenanceClass: "computed_output",
      requiredScope: "owning_run_output",
    });
  });

  it("verifies independent and primary raw arrays against two exact receipt identities", async () => {
    const value = await independentCrossRunFixture();
    const result = await verifyNhm2EvidenceNestedReferences({
      projectRoot: value.projectRoot,
      evidenceId: "independent_numerical_replication",
      planOutputDirectory: value.outputDirectory,
      allowedImmutableInputPaths: [],
      receiptManifestEntries: [value.manifestEntry],
      owningRunIdentity: value.owningRunIdentity,
      expectedPriorRunIdentity: value.expectedPriorRunIdentity,
      verifiedPriorRunOutputs: [value.verifiedPriorRunOutput],
      evidence: value.evidence,
    });

    expect(result).toMatchObject({
      status: "pass",
      verified: true,
      referenceCount: 2,
      blockers: [],
    });
    expect(result.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          location: "/comparison/fields/0/primaryRawOutput",
          scope: "verified_prior_run_output",
          provenanceClass: "prior_computed_output",
          verified: true,
        }),
        expect.objectContaining({
          location: "/comparison/fields/0/independentRawOutput",
          scope: "run_output",
          provenanceClass: "computed_output",
          verified: true,
        }),
      ]),
    );
  });

  it("rejects current-run substitution, missing prior verification, and copied identity swaps", async () => {
    const value = await independentCrossRunFixture();
    const currentRunSubstitution = structuredClone(value.evidence);
    currentRunSubstitution.comparison.fields[0].primaryRawOutput = {
      ...currentRunSubstitution.comparison.fields[0].independentRawOutput,
    };
    const noVerifiedPrior = await verifyNhm2EvidenceNestedReferences({
      projectRoot: value.projectRoot,
      evidenceId: "independent_numerical_replication",
      planOutputDirectory: value.outputDirectory,
      allowedImmutableInputPaths: [],
      receiptManifestEntries: [value.manifestEntry],
      owningRunIdentity: value.owningRunIdentity,
      expectedPriorRunIdentity: value.expectedPriorRunIdentity,
      verifiedPriorRunOutputs: [],
      evidence: currentRunSubstitution,
    });
    expect(noVerifiedPrior.status).toBe("fail");
    expect(noVerifiedPrior.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "prior_computed_reference_requires_verified_prior_run_output",
        ),
      ]),
    );

    const identitySwap = structuredClone(value.evidence);
    identitySwap.identity.primaryExecution.receiptId = "receipt-copied-999";
    const swapped = await verifyNhm2EvidenceNestedReferences({
      projectRoot: value.projectRoot,
      evidenceId: "independent_numerical_replication",
      planOutputDirectory: value.outputDirectory,
      allowedImmutableInputPaths: [],
      receiptManifestEntries: [value.manifestEntry],
      owningRunIdentity: value.owningRunIdentity,
      expectedPriorRunIdentity: value.expectedPriorRunIdentity,
      verifiedPriorRunOutputs: [value.verifiedPriorRunOutput],
      evidence: identitySwap,
    });
    expect(swapped.status).toBe("fail");
    expect(swapped.blockers).toContain(
      "independent_primary_execution_identity_mismatch",
    );

    const conflicting = structuredClone(value.evidence);
    conflicting.comparison.fields.push({
      primaryRawOutput: {
        ...conflicting.comparison.fields[0].primaryRawOutput,
        sha256: "1".repeat(64),
      },
      independentRawOutput: {
        ...conflicting.comparison.fields[0].independentRawOutput,
      },
    });
    const conflict = await verifyNhm2EvidenceNestedReferences({
      projectRoot: value.projectRoot,
      evidenceId: "independent_numerical_replication",
      planOutputDirectory: value.outputDirectory,
      allowedImmutableInputPaths: [],
      receiptManifestEntries: [value.manifestEntry],
      owningRunIdentity: value.owningRunIdentity,
      expectedPriorRunIdentity: value.expectedPriorRunIdentity,
      verifiedPriorRunOutputs: [value.verifiedPriorRunOutput],
      evidence: conflicting,
    });
    expect(conflict.status).toBe("fail");
    expect(conflict.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining("reference_hash_conflict"),
        expect.stringContaining("verified_prior_run_manifest_sha256_mismatch"),
      ]),
    );
  });

  it("rejects preexisting prior artifacts and the same receipt on both sides", async () => {
    const value = await independentCrossRunFixture();
    const sameIdentity = { ...value.owningRunIdentity };
    const evidence = structuredClone(value.evidence);
    evidence.identity.primaryExecution = sameIdentity;
    const result = await verifyNhm2EvidenceNestedReferences({
      projectRoot: value.projectRoot,
      evidenceId: "independent_numerical_replication",
      planOutputDirectory: value.outputDirectory,
      allowedImmutableInputPaths: [],
      receiptManifestEntries: [value.manifestEntry],
      owningRunIdentity: value.owningRunIdentity,
      expectedPriorRunIdentity: sameIdentity,
      verifiedPriorRunOutputs: [
        {
          ...value.verifiedPriorRunOutput,
          ...sameIdentity,
          freshness: "preexisting",
        },
      ],
      evidence,
    });

    expect(result.status).toBe("fail");
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "independent_prior_receipt_same_as_owning_receipt",
        expect.stringContaining("freshness_not_new"),
        expect.stringContaining("same_as_owning_receipt"),
      ]),
    );
  });

  it("rejects historical alpha 0.7 bytes even when presented as a prior-run map entry", async () => {
    const value = await independentCrossRunFixture();
    const historicalPath = path.join(
      value.projectRoot,
      "artifacts",
      "research",
      "full-solve",
      "profile-campaign-runs",
      "stage1_centerline_alpha_0p7000_historical",
      "primary.f64",
    );
    await fs.mkdir(path.dirname(historicalPath), { recursive: true });
    await fs.writeFile(historicalPath, value.primaryBytes);
    const historicalRepoPath = portable(value.projectRoot, historicalPath);
    const evidence = structuredClone(value.evidence);
    evidence.comparison.fields[0].primaryRawOutput.path = historicalRepoPath;
    const result = await verifyNhm2EvidenceNestedReferences({
      projectRoot: value.projectRoot,
      evidenceId: "independent_numerical_replication",
      planOutputDirectory: value.outputDirectory,
      allowedImmutableInputPaths: [],
      receiptManifestEntries: [value.manifestEntry],
      owningRunIdentity: value.owningRunIdentity,
      expectedPriorRunIdentity: value.expectedPriorRunIdentity,
      verifiedPriorRunOutputs: [
        {
          ...value.verifiedPriorRunOutput,
          path: historicalRepoPath,
        },
      ],
      evidence,
    });

    expect(result.status).toBe("fail");
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining("historical_alpha_07_forbidden"),
        expect.stringContaining(
          "historical_alpha_07_computed_reference_forbidden",
        ),
      ]),
    );
  });

  it("permits only named frozen configuration, solver, CAD, and material inputs", () => {
    expect(
      nhm2EvidenceNestedReferenceProvenanceRule({
        evidenceId: "full_apparatus_source_tensor",
        location: "/identity/atlas",
      }),
    ).toEqual({
      provenanceClass: "frozen_configuration",
      requiredScope: "immutable_input",
    });
    expect(
      nhm2EvidenceNestedReferenceProvenanceRule({
        evidenceId: "dynamic_backreaction_stability_causality",
        location: "/evolution/integrator",
      }),
    ).toEqual({
      provenanceClass: "frozen_solver",
      requiredScope: "immutable_input",
    });
    for (const location of [
      "/stressFluctuations/renormalizationPrescription",
      "/stressFluctuations/renormalizationCounterterms",
      "/stressFluctuations/finiteRenormalization",
      "/stressFluctuations/smearingFunction",
      "/stressFluctuations/samplingBasis",
      "/stressFluctuations/semiclassicalityCriterion",
      "/stressFluctuations/samplingWindow/definition",
      "/constraintConsistency/renormalizationPrescription",
      "/constraintConsistency/renormalizationCounterterms",
      "/constraintConsistency/finiteRenormalization",
      "/constraintConsistency/formulation",
      "/constraintConsistency/regulator",
      "/constraintConsistency/operatorOrdering",
      "/constraintConsistency/smearingFunctions",
      "/constraintConsistency/countertermEvidence",
      "/constraintConsistency/bracketResiduals/0/normalizationDefinition",
      "/constraintConsistency/bracketResiduals/0/normalizationMethod",
      "/constraintConsistency/antisymmetryResidual/definition",
      "/constraintConsistency/jacobiIdentityResidual/definition",
    ]) {
      expect(
        nhm2EvidenceNestedReferenceProvenanceRule({
          evidenceId: "semiclassical_state",
          location,
        }),
        location,
      ).toEqual({
        provenanceClass: "frozen_configuration",
        requiredScope: "immutable_input",
      });
    }
    expect(
      nhm2EvidenceNestedReferenceProvenanceRule({
        evidenceId: "semiclassical_state",
        location: "/stressFluctuations/psdAnalysis",
      }),
    ).toEqual({
      provenanceClass: "computed_output",
      requiredScope: "owning_run_output",
    });
    expect(
      nhm2EvidenceNestedReferenceProvenanceRule({
        evidenceId: "finite_temperature_finite_geometry_maxwell_stress",
        location: "/finiteGeometry/cadModel",
      }),
    ).toEqual({
      provenanceClass: "frozen_cad",
      requiredScope: "immutable_input",
    });
    expect(
      nhm2EvidenceNestedReferenceProvenanceRule({
        evidenceId: "finite_temperature_finite_geometry_maxwell_stress",
        location: "/dielectricResponse/datasets/0/epsilonImaginary",
      }),
    ).toEqual({
      provenanceClass: "frozen_material",
      requiredScope: "immutable_input",
    });
    expect(
      nhm2EvidenceNestedReferenceProvenanceRule({
        evidenceId: "prediction_falsifier_freeze",
        location: "/observables/0/predictionRef",
      }),
    ).toEqual({
      provenanceClass: "frozen_prediction",
      requiredScope: "immutable_input",
    });
  });

  it("separates formal replay sources and kernel from replay outputs", async () => {
    const value = await fixture();
    const kernelPath = path.join(
      value.projectRoot,
      "inputs",
      "lean-kernel.bin",
    );
    const kernelBytes = Buffer.from("pinned-lean-kernel", "utf8");
    await fs.writeFile(kernelPath, kernelBytes);
    const kernelRepoPath = portable(value.projectRoot, kernelPath);

    const writeOutput = async (name: string, contents: string) => {
      const absolutePath = path.join(value.outputDirectory, name);
      const bytes = Buffer.from(contents, "utf8");
      await fs.writeFile(absolutePath, bytes);
      const repoPath = portable(value.projectRoot, absolutePath);
      return {
        ref: { path: repoPath, sha256: sha256(bytes) },
        receipt: {
          path: repoPath,
          sha256: sha256(bytes),
          sizeBytes: bytes.length,
          freshness: "new" as const,
        },
      };
    };
    const outputs = {
      replayManifest: await writeOutput("formal-replay.json", "{}"),
      sourceLedger: await writeOutput("source-ledger.json", "[]"),
      theoremLedger: await writeOutput("theorem-ledger.json", "[]"),
      axiomLedger: await writeOutput("axiom-ledger.json", "[]"),
      assumptionLedger: await writeOutput("assumption-ledger.json", "[]"),
      transcript: await writeOutput("aggregate-transcript.txt", "proved"),
      claimProof: await writeOutput("claim-lock-proof.olean", "proof"),
      claimTranscript: await writeOutput("claim-lock-transcript.txt", "proved"),
    };
    const sourceRef = {
      path: value.inputRepoPath,
      sha256: sha256(value.inputBytes),
    };
    const kernelRef = {
      path: kernelRepoPath,
      sha256: sha256(kernelBytes),
    };
    const rawEvidence = {
      identity: {
        formalPlan: {
          solver: kernelRef,
          environmentLock: sourceRef,
        },
      },
      sourceHashRecomputation: {
        sources: [
          {
            sourceId: "frozen-source",
            ...sourceRef,
            expectedSha256: sourceRef.sha256,
            recomputedSha256: sourceRef.sha256,
          },
        ],
      },
      formalKernelReplay: {
        manifest: outputs.replayManifest.ref,
        preRunSourceLedger: outputs.sourceLedger.ref,
        preRunSourceArtifacts: [sourceRef, kernelRef],
        kernelBinary: kernelRef,
        theoremReplayLedger: outputs.theoremLedger.ref,
        usedAxiomLedger: outputs.axiomLedger.ref,
        usedAssumptionLedger: outputs.assumptionLedger.ref,
        aggregateReplayTranscript: outputs.transcript.ref,
        claimLockProof: outputs.claimProof.ref,
        claimLockTranscript: outputs.claimTranscript.ref,
      },
      theoremScope: {
        scopeManifest: sourceRef,
        theoremSource: sourceRef,
      },
      kernelReplay: {
        kernelBinary: kernelRef,
        theoremBundle: sourceRef,
        proofTerm: outputs.claimProof.ref,
        replayTranscript: outputs.claimTranscript.ref,
      },
      assumptions: {
        entries: [{ evidence: sourceRef }],
        assumptionLedger: outputs.assumptionLedger.ref,
        booleanScanReport: outputs.transcript.ref,
      },
    };
    const evidence = JSON.parse(
      JSON.stringify(rawEvidence),
    ) as typeof rawEvidence;
    const receiptManifestEntries = Object.values(outputs).map(
      (entry) => entry.receipt,
    );
    const result = await verifyNhm2EvidenceNestedReferences({
      projectRoot: value.projectRoot,
      evidenceId: "formal_manifest_certificate",
      planOutputDirectory: value.outputDirectory,
      allowedImmutableInputPaths: [value.inputRepoPath, kernelRepoPath],
      receiptManifestEntries,
      evidence,
    });

    expect(result.blockers).toEqual([]);
    expect(result).toMatchObject({ status: "pass", verified: true });
    expect(
      result.references.find(
        (entry) =>
          entry.location === "/formalKernelReplay/preRunSourceArtifacts/0",
      ),
    ).toMatchObject({
      scope: "immutable_input",
      provenanceClass: "frozen_configuration",
      verified: true,
    });
    expect(
      result.references.find(
        (entry) => entry.location === "/formalKernelReplay/kernelBinary",
      ),
    ).toMatchObject({
      scope: "immutable_input",
      provenanceClass: "frozen_solver",
      verified: true,
    });
    expect(
      result.references.find(
        (entry) => entry.location === "/formalKernelReplay/claimLockProof",
      ),
    ).toMatchObject({
      scope: "run_output",
      provenanceClass: "computed_output",
      verified: true,
    });

    const outputSubstitutedForSource = structuredClone(evidence);
    outputSubstitutedForSource.formalKernelReplay.preRunSourceArtifacts[0] =
      outputs.replayManifest.ref;
    const sourceSwap = await verifyNhm2EvidenceNestedReferences({
      projectRoot: value.projectRoot,
      evidenceId: "formal_manifest_certificate",
      planOutputDirectory: value.outputDirectory,
      allowedImmutableInputPaths: [value.inputRepoPath, kernelRepoPath],
      receiptManifestEntries,
      evidence: outputSubstitutedForSource,
    });
    expect(sourceSwap.status).toBe("fail");
    expect(sourceSwap.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining("frozen_reference_requires_pre_run_input"),
      ]),
    );

    const inputSubstitutedForProof = structuredClone(evidence);
    inputSubstitutedForProof.formalKernelReplay.claimLockProof = sourceRef;
    const proofSwap = await verifyNhm2EvidenceNestedReferences({
      projectRoot: value.projectRoot,
      evidenceId: "formal_manifest_certificate",
      planOutputDirectory: value.outputDirectory,
      allowedImmutableInputPaths: [value.inputRepoPath, kernelRepoPath],
      receiptManifestEntries,
      evidence: inputSubstitutedForProof,
    });
    expect(proofSwap.status).toBe("fail");
    expect(proofSwap.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "computed_reference_requires_owning_plan_output",
        ),
      ]),
    );
  });

  it("admits all six exact numerical predictions only as frozen pre-run inputs", async () => {
    const value = await numericalPredictionFreezeFixture();
    const frozenSemanticSha256 = value.freeze.semanticSha256;
    const frozenBytes = JSON.stringify(value.freeze);
    const result = await verifyNhm2EvidenceNestedReferences({
      projectRoot: value.projectRoot,
      evidenceId: "prediction_falsifier_freeze",
      planOutputDirectory: value.outputDirectory,
      allowedImmutableInputPaths: value.allowedImmutableInputPaths,
      receiptManifestEntries: [],
      evidence: value.freeze,
    });

    expect(result).toMatchObject({
      status: "pass",
      verified: true,
      blockers: [],
    });
    const predictionReferences = result.references.filter((reference) =>
      /^\/observables\/\d+\/predictionRef$/.test(reference.location),
    );
    expect(predictionReferences).toHaveLength(6);
    expect(
      predictionReferences.every(
        (reference) =>
          reference.scope === "immutable_input" &&
          reference.provenanceClass === "frozen_prediction" &&
          reference.requiredScope === "immutable_input" &&
          reference.verified,
      ),
    ).toBe(true);
    expect(value.freeze.semanticSha256).toBe(frozenSemanticSha256);
    expect(JSON.stringify(value.freeze)).toBe(frozenBytes);
    expect(isNhm2PredictionFalsifierFreeze(value.freeze)).toBe(true);
  });

  it("cannot close a fresh freeze wrapper over the current null diagnostic seed", async () => {
    const value = await numericalPredictionFreezeFixture({
      nullDiagnosticSeed: true,
    });
    expect(value.freeze.readiness.predictionFreezeReady).toBe(true);

    const result = await verifyNhm2EvidenceNestedReferences({
      projectRoot: value.projectRoot,
      evidenceId: "prediction_falsifier_freeze",
      planOutputDirectory: value.outputDirectory,
      allowedImmutableInputPaths: value.allowedImmutableInputPaths,
      receiptManifestEntries: [],
      evidence: value.freeze,
    });

    expect(result).toMatchObject({ status: "fail", verified: false });
    expect(
      result.blockers.filter((blocker) =>
        blocker.includes("numerical_prediction_schema_invalid"),
      ),
    ).toHaveLength(6);
  });

  it("rejects predictions detached from enclosing unit, sign, or candidate identity", async () => {
    const cases = [
      {
        options: { predictionUnitMismatch: true },
        blocker: "numerical_prediction_unit_mismatch",
      },
      {
        options: { predictionSignMismatch: true },
        blocker: "numerical_prediction_sign_or_phase_mismatch",
      },
      {
        options: { predictionIdentityMismatch: true },
        blocker: "numerical_prediction_candidate_id_mismatch",
      },
    ] as const;
    for (const testCase of cases) {
      const value = await numericalPredictionFreezeFixture(testCase.options);
      const result = await verifyNhm2EvidenceNestedReferences({
        projectRoot: value.projectRoot,
        evidenceId: "prediction_falsifier_freeze",
        planOutputDirectory: value.outputDirectory,
        allowedImmutableInputPaths: value.allowedImmutableInputPaths,
        receiptManifestEntries: [],
        evidence: value.freeze,
      });
      expect(result.status, testCase.blocker).toBe("fail");
      expect(
        result.blockers.some((blocker) => blocker.includes(testCase.blocker)),
        testCase.blocker,
      ).toBe(true);
    }
  });

  it("requires every numerical-prediction provenance ref in the frozen input closure", async () => {
    const value = await numericalPredictionFreezeFixture();
    const allowedImmutableInputPaths = value.allowedImmutableInputPaths.filter(
      (repoPath) => !repoPath.endsWith("/provenance/source.json"),
    );
    const result = await verifyNhm2EvidenceNestedReferences({
      projectRoot: value.projectRoot,
      evidenceId: "prediction_falsifier_freeze",
      planOutputDirectory: value.outputDirectory,
      allowedImmutableInputPaths,
      receiptManifestEntries: [],
      evidence: value.freeze,
    });

    expect(result.status).toBe("fail");
    expect(
      result.blockers.some((blocker) =>
        blocker.includes(
          "numerical_prediction_provenance_ref_not_frozen:source",
        ),
      ),
    ).toBe(true);
  });

  it("verifies nested run arrays and exact immutable inputs without interpreting summaries", async () => {
    const value = await fixture();
    const result = await verifyNhm2EvidenceNestedReferences({
      projectRoot: value.projectRoot,
      evidenceId: "full_apparatus_source_tensor",
      planOutputDirectory: value.outputDirectory,
      allowedImmutableInputPaths: [value.inputRepoPath],
      receiptManifestEntries: [value.manifestEntry],
      evidence: {
        callerSuppliedScientificSummary: {
          tensorMaximum: Number.NaN,
          claimedPass: true,
        },
        sourceTensor: {
          components: [
            {
              component: "T00",
              rawArray: {
                path: value.tensorRepoPath,
                sha256: `sha256:${sha256(value.tensorBytes)}`,
                dtype: "float64",
                shape: [4],
                sizeBytes: 32,
                storageOrder: "row-major",
                componentOrder: ["T00"],
              },
            },
          ],
        },
        identity: {
          atlas: {
            path: value.inputRepoPath,
            sha256: sha256(value.inputBytes),
          },
        },
      },
    });

    expect(result).toMatchObject({
      status: "pass",
      verified: true,
      referenceCount: 2,
      blockers: [],
    });
    expect(result.references.map((entry) => entry.scope).sort()).toEqual([
      "immutable_input",
      "run_output",
    ]);
    expect(
      result.references.find((entry) => entry.scope === "run_output"),
    ).toMatchObject({
      expectedFloat64Bytes: 32,
      declaredSizeBytes: 32,
      sizeBytes: 32,
      verified: true,
    });
  });

  it("rejects degenerate or incompletely typed full-apparatus arrays", async () => {
    const value = await fixture();
    const result = await verifyNhm2EvidenceNestedReferences({
      projectRoot: value.projectRoot,
      evidenceId: "full_apparatus_source_tensor",
      planOutputDirectory: value.outputDirectory,
      allowedImmutableInputPaths: [],
      receiptManifestEntries: [value.manifestEntry],
      evidence: {
        sourceTensor: {
          components: [
            {
              component: "T00",
              rawArray: {
                path: value.tensorRepoPath,
                sha256: sha256(value.tensorBytes),
                dtype: "float64",
                shape: [0],
                sizeBytes: 8,
                componentOrder: [],
              },
            },
          ],
        },
      },
    });

    expect(result.status).toBe("fail");
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining("float64_shape_invalid"),
        expect.stringContaining("float64_storage_order_required"),
        expect.stringContaining("float64_component_array_order_invalid"),
        expect.stringContaining("float64_declared_size_byte_length_mismatch"),
      ]),
    );
  });

  it("independently enforces typed bytes for finite-geometry and mechanical arrays", async () => {
    const cases = [
      {
        evidenceId:
          "finite_temperature_finite_geometry_maxwell_stress" as const,
        evidence: (reference: Record<string, unknown>) => ({
          thermodynamics: { matsubaraFrequencies: reference },
        }),
        componentOrder: ["angular_frequency"],
        unit: "rad/s",
      },
      {
        evidenceId: "mechanical_support_control_margin" as const,
        evidence: (reference: Record<string, unknown>) => ({
          activeControl: { commandTrace: reference },
        }),
        componentOrder: ["command"],
        unit: "V",
      },
    ];

    for (const testCase of cases) {
      const value = await fixture();
      const reference = {
        path: value.tensorRepoPath,
        sha256: sha256(value.tensorBytes),
        dtype: "float64",
        shape: [4],
        sizeBytes: value.tensorBytes.length,
        storageOrder: "row-major",
        componentOrder: testCase.componentOrder,
        unit: testCase.unit,
      };
      const pass = await verifyNhm2EvidenceNestedReferences({
        projectRoot: value.projectRoot,
        evidenceId: testCase.evidenceId,
        planOutputDirectory: value.outputDirectory,
        allowedImmutableInputPaths: [],
        receiptManifestEntries: [value.manifestEntry],
        evidence: testCase.evidence(reference),
      });
      expect(pass.status, testCase.evidenceId).toBe("pass");
      expect(pass.references[0]).toMatchObject({
        expectedFloat64Bytes: 32,
        declaredSizeBytes: 32,
        sizeBytes: 32,
        verified: true,
      });

      const fail = await verifyNhm2EvidenceNestedReferences({
        projectRoot: value.projectRoot,
        evidenceId: testCase.evidenceId,
        planOutputDirectory: value.outputDirectory,
        allowedImmutableInputPaths: [],
        receiptManifestEntries: [value.manifestEntry],
        evidence: testCase.evidence({
          ...reference,
          shape: [0],
          sizeBytes: 8,
          componentOrder: [],
          unit: "",
        }),
      });
      expect(fail.status, testCase.evidenceId).toBe("fail");
      expect(fail.blockers, testCase.evidenceId).toEqual(
        expect.arrayContaining([
          expect.stringContaining("float64_shape_invalid"),
          expect.stringContaining("float64_component_order_required"),
          expect.stringContaining("float64_unit_required"),
          expect.stringContaining("float64_declared_size_byte_length_mismatch"),
        ]),
      );
    }
  });

  it("requires fixed encoding metadata and byte agreement for semiclassical numerical arrays", async () => {
    const value = await fixture();
    const reference = {
      ref: value.tensorRepoPath,
      sha256: sha256(value.tensorBytes),
      dtype: "float64",
      binaryEncoding: "raw_ieee754",
      endianness: "little",
      shape: [1, 4],
      sizeBytes: value.tensorBytes.length,
      storageOrder: "row-major",
      componentOrder: [
        "nabla_mu_T_mu0",
        "nabla_mu_T_mu1",
        "nabla_mu_T_mu2",
        "nabla_mu_T_mu3",
      ],
      unit: "J/m^4",
    };
    const pass = await verifyNhm2EvidenceNestedReferences({
      projectRoot: value.projectRoot,
      evidenceId: "semiclassical_state",
      planOutputDirectory: value.outputDirectory,
      allowedImmutableInputPaths: [],
      receiptManifestEntries: [value.manifestEntry],
      evidence: { wardIdentity: { divergenceSamples: reference } },
    });
    expect(pass.status).toBe("pass");

    const fail = await verifyNhm2EvidenceNestedReferences({
      projectRoot: value.projectRoot,
      evidenceId: "semiclassical_state",
      planOutputDirectory: value.outputDirectory,
      allowedImmutableInputPaths: [],
      receiptManifestEntries: [value.manifestEntry],
      evidence: {
        wardIdentity: {
          divergenceSamples: {
            ...reference,
            binaryEncoding: null,
            endianness: null,
            shape: [5],
            sizeBytes: 40,
          },
        },
      },
    });
    expect(fail.status).toBe("fail");
    expect(fail.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining("float64_raw_ieee754_encoding_required"),
        expect.stringContaining("float64_little_endian_required"),
        expect.stringContaining("float64_shape_byte_length_mismatch"),
        expect.stringContaining("float64_declared_size_byte_length_mismatch"),
      ]),
    );
  });

  it("requires strict float64 encoding for v2 noise-kernel and constraint-bracket arrays", async () => {
    const value = await fixture();
    const reference = {
      ref: value.tensorRepoPath,
      sha256: sha256(value.tensorBytes),
      dtype: "float64",
      binaryEncoding: "raw_ieee754",
      endianness: "little",
      shape: [1, 4],
      sizeBytes: value.tensorBytes.length,
      storageOrder: "row-major",
      componentOrder: ["hamiltonian", "momentum_x", "momentum_y", "momentum_z"],
      unit: "constraint_density",
    };
    const copyReference = () => ({
      ...reference,
      shape: [...reference.shape],
      componentOrder: [...reference.componentOrder],
    });
    const copyNoiseReference = () => ({
      ...copyReference(),
      shape: [1, 1, 4],
    });
    const pass = await verifyNhm2EvidenceNestedReferences({
      projectRoot: value.projectRoot,
      evidenceId: "semiclassical_state",
      planOutputDirectory: value.outputDirectory,
      allowedImmutableInputPaths: [],
      receiptManifestEntries: [value.manifestEntry],
      evidence: {
        stressFluctuations: { noiseKernel: copyNoiseReference() },
        constraintConsistency: {
          bracketResiduals: [
            {
              computedBracket: copyReference(),
              classicalStructureFunctionTarget: copyReference(),
              residual: copyReference(),
            },
          ],
          antisymmetryResidual: { residual: copyReference() },
          jacobiIdentityResidual: { residual: copyReference() },
        },
      },
    });
    expect(pass.status, JSON.stringify(pass.blockers)).toBe("pass");

    const fail = await verifyNhm2EvidenceNestedReferences({
      projectRoot: value.projectRoot,
      evidenceId: "semiclassical_state",
      planOutputDirectory: value.outputDirectory,
      allowedImmutableInputPaths: [],
      receiptManifestEntries: [value.manifestEntry],
      evidence: {
        stressFluctuations: {
          noiseKernel: {
            ...copyNoiseReference(),
            binaryEncoding: null,
            endianness: null,
          },
        },
        constraintConsistency: {
          bracketResiduals: [{ residual: { ...copyReference(), dtype: null } }],
          antisymmetryResidual: {
            residual: { ...copyReference(), binaryEncoding: null },
          },
          jacobiIdentityResidual: {
            residual: { ...copyReference(), endianness: null },
          },
        },
      },
    });
    expect(fail.status).toBe("fail");
    expect(fail.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining("float64_raw_ieee754_encoding_required"),
        expect.stringContaining("float64_little_endian_required"),
        expect.stringContaining("float64_dtype_required"),
        expect.stringContaining("float64_raw_ieee754_encoding_required"),
        expect.stringContaining("float64_little_endian_required"),
      ]),
    );
  });

  it("requires fixed encoding metadata and byte agreement for QEI worldline arrays", async () => {
    const value = await fixture();
    const reference = {
      path: value.tensorRepoPath,
      sha256: sha256(value.tensorBytes),
      dtype: "float64",
      binaryEncoding: "raw_ieee754",
      endianness: "little",
      shape: [4],
      sizeBytes: value.tensorBytes.length,
      storageOrder: "row-major",
      componentOrder: ["tau"],
      unit: "s",
    };
    const pass = await verifyNhm2EvidenceNestedReferences({
      projectRoot: value.projectRoot,
      evidenceId: "worldline_qei",
      planOutputDirectory: value.outputDirectory,
      allowedImmutableInputPaths: [],
      receiptManifestEntries: [value.manifestEntry],
      evidence: { worldlines: [{ properTimeGrid: reference }] },
    });
    expect(pass.status).toBe("pass");

    const fail = await verifyNhm2EvidenceNestedReferences({
      projectRoot: value.projectRoot,
      evidenceId: "worldline_qei",
      planOutputDirectory: value.outputDirectory,
      allowedImmutableInputPaths: [],
      receiptManifestEntries: [value.manifestEntry],
      evidence: {
        worldlines: [
          {
            properTimeGrid: {
              ...reference,
              binaryEncoding: null,
              endianness: null,
              sizeBytes: 8,
            },
          },
        ],
      },
    });
    expect(fail.status).toBe("fail");
    expect(fail.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining("float64_raw_ieee754_encoding_required"),
        expect.stringContaining("float64_little_endian_required"),
        expect.stringContaining("float64_declared_size_shape_mismatch"),
        expect.stringContaining("float64_declared_size_byte_length_mismatch"),
      ]),
    );
  });

  it("rejects changed output and resolves semiclassical ref fragments to the file", async () => {
    const value = await fixture();
    const result = await verifyNhm2EvidenceNestedReferences({
      projectRoot: value.projectRoot,
      evidenceId: "semiclassical_state",
      planOutputDirectory: portable(value.projectRoot, value.outputDirectory),
      allowedImmutableInputPaths: [],
      receiptManifestEntries: [
        { ...value.manifestEntry, freshness: "changed" },
      ],
      evidence: {
        components: [
          {
            ref: `${value.tensorRepoPath}#T00`,
            sha256: sha256(value.tensorBytes),
          },
        ],
      },
    });

    expect(result.status).toBe("fail");
    expect(
      result.blockers.some((entry) =>
        entry.includes("receipt_manifest_freshness_not_new"),
      ),
    ).toBe(true);
    expect(result.references[0]).toMatchObject({
      referenceKey: "ref",
      path: value.tensorRepoPath,
      scope: "run_output",
      verified: false,
    });
  });

  it("rejects a new evidence wrapper over a preexisting historical alpha 0.7 tensor", async () => {
    const value = await fixture();
    const historicalPath = path.join(
      value.projectRoot,
      "artifacts",
      "research",
      "full-solve",
      "profile-campaign-runs",
      "stage1_centerline_alpha_0p7000_observer_compatible_source_campaign_screen_v1",
      "raw-total-tensor.f64",
    );
    const historicalBytes = Buffer.alloc(4 * 8, 11);
    await fs.mkdir(path.dirname(historicalPath), { recursive: true });
    await fs.writeFile(historicalPath, historicalBytes);
    const historicalRepoPath = portable(value.projectRoot, historicalPath);

    const result = await verifyNhm2EvidenceNestedReferences({
      projectRoot: value.projectRoot,
      evidenceId: "full_apparatus_source_tensor",
      planOutputDirectory: value.outputDirectory,
      allowedImmutableInputPaths: [historicalRepoPath],
      receiptManifestEntries: [],
      evidence: {
        sourceTensor: {
          rawTotalTensorArray: {
            path: historicalRepoPath,
            sha256: sha256(historicalBytes),
          },
        },
      },
    });

    expect(result).toMatchObject({
      status: "fail",
      verified: false,
      referenceCount: 1,
    });
    expect(result.references[0]).toMatchObject({
      scope: "immutable_input",
      provenanceClass: "computed_output",
      requiredScope: "owning_run_output",
      verified: false,
    });
    expect(
      result.blockers.some((entry) =>
        entry.includes("historical_alpha_07_computed_reference_forbidden"),
      ),
    ).toBe(true);
    expect(
      result.blockers.some((entry) =>
        entry.includes("computed_reference_requires_owning_plan_output"),
      ),
    ).toBe(true);
  });

  it("rejects a run-generated file in a field that must have been frozen pre-run", async () => {
    const value = await fixture();
    const result = await verifyNhm2EvidenceNestedReferences({
      projectRoot: value.projectRoot,
      evidenceId: "full_apparatus_source_tensor",
      planOutputDirectory: value.outputDirectory,
      allowedImmutableInputPaths: [],
      receiptManifestEntries: [value.manifestEntry],
      evidence: {
        identity: {
          atlas: {
            path: value.tensorRepoPath,
            sha256: sha256(value.tensorBytes),
          },
        },
      },
    });

    expect(result.status).toBe("fail");
    expect(result.references[0]).toMatchObject({
      scope: "run_output",
      provenanceClass: "frozen_configuration",
      requiredScope: "immutable_input",
      verified: false,
    });
    expect(
      result.blockers.some((entry) =>
        entry.includes("frozen_reference_requires_pre_run_input"),
      ),
    ).toBe(true);
  });

  it("requires exact receipt membership, hash, size, and fresh classification for outputs", async () => {
    const value = await fixture();
    const evidence = {
      path: value.tensorRepoPath,
      sha256: sha256(value.tensorBytes),
    };
    const cases: Array<{
      entries: Nhm2EvidenceNestedReferenceReceiptManifestEntry[];
      blocker: string;
    }> = [
      { entries: [], blocker: "receipt_manifest_entry_missing" },
      {
        entries: [{ ...value.manifestEntry, sha256: "1".repeat(64) }],
        blocker: "receipt_manifest_sha256_mismatch",
      },
      {
        entries: [{ ...value.manifestEntry, sizeBytes: 31 }],
        blocker: "receipt_manifest_size_mismatch",
      },
      {
        entries: [{ ...value.manifestEntry, freshness: "preexisting" }],
        blocker: "receipt_manifest_freshness_not_new",
      },
      {
        entries: [value.manifestEntry, value.manifestEntry],
        blocker: "receipt_manifest_entry_ambiguous",
      },
    ];

    for (const testCase of cases) {
      const result = await verifyNhm2EvidenceNestedReferences({
        projectRoot: value.projectRoot,
        evidenceId: "full_apparatus_source_tensor",
        planOutputDirectory: value.outputDirectory,
        allowedImmutableInputPaths: [],
        receiptManifestEntries: testCase.entries,
        evidence,
      });
      expect(result.status, testCase.blocker).toBe("fail");
      expect(
        result.blockers.some((blocker) => blocker.includes(testCase.blocker)),
        testCase.blocker,
      ).toBe(true);
    }
  });

  it("rejects hash mismatches, float64 shape/byte mismatches, and conflicting hashes", async () => {
    const value = await fixture();
    const result = await verifyNhm2EvidenceNestedReferences({
      projectRoot: value.projectRoot,
      evidenceId: "full_apparatus_source_tensor",
      planOutputDirectory: value.outputDirectory,
      allowedImmutableInputPaths: [],
      receiptManifestEntries: [value.manifestEntry],
      evidence: {
        first: {
          path: value.tensorRepoPath,
          sha256: "2".repeat(64),
          dtype: "float64",
          shape: [1],
        },
        second: {
          path: value.tensorRepoPath,
          sha256: sha256(value.tensorBytes),
        },
      },
    });

    expect(result.status).toBe("fail");
    expect(
      result.blockers.some((entry) =>
        entry.includes("reference_sha256_mismatch"),
      ),
    ).toBe(true);
    expect(
      result.blockers.some((entry) =>
        entry.includes("float64_shape_byte_length_mismatch"),
      ),
    ).toBe(true);
    expect(
      result.blockers.some((entry) =>
        entry.includes("reference_hash_conflict"),
      ),
    ).toBe(true);
  });

  it("rejects traversal, absolute, backslash, dummy, out-of-scope, and unresolvable references", async () => {
    const value = await fixture();
    const outsidePath = path.join(value.projectRoot, "outside.bin");
    const outsideBytes = Buffer.from("outside", "utf8");
    const dummyPath = path.join(value.projectRoot, "inputs", "dummy.bin");
    const dummyBytes = Buffer.from(
      "real bytes but placeholder identity",
      "utf8",
    );
    await Promise.all([
      fs.writeFile(outsidePath, outsideBytes),
      fs.writeFile(dummyPath, dummyBytes),
    ]);
    const result = await verifyNhm2EvidenceNestedReferences({
      projectRoot: value.projectRoot,
      evidenceId: "full_apparatus_source_tensor",
      planOutputDirectory: value.outputDirectory,
      allowedImmutableInputPaths: [portable(value.projectRoot, dummyPath)],
      receiptManifestEntries: [],
      evidence: {
        traversal: {
          path: "runs/primary-001/../escape.bin",
          sha256: "1".repeat(64),
        },
        absolute: {
          path: path.resolve(outsidePath),
          sha256: sha256(outsideBytes),
        },
        backslash: {
          path: "runs\\primary-001\\tensor.f64",
          sha256: sha256(value.tensorBytes),
        },
        dummy: {
          path: portable(value.projectRoot, dummyPath),
          sha256: sha256(dummyBytes),
        },
        outside: {
          path: portable(value.projectRoot, outsidePath),
          sha256: sha256(outsideBytes),
        },
        missing: { path: "inputs/missing.bin", sha256: "3".repeat(64) },
        zeroHash: { path: value.inputRepoPath, sha256: "0".repeat(64) },
      },
    });

    expect(result.status).toBe("fail");
    expect(
      result.blockers.some((entry) =>
        entry.includes("reference_path_not_portable"),
      ),
    ).toBe(true);
    expect(
      result.blockers.some((entry) =>
        entry.includes("reference_path_dummy_or_unresolved"),
      ),
    ).toBe(true);
    expect(
      result.blockers.some((entry) =>
        entry.includes("reference_scope_unbound"),
      ),
    ).toBe(true);
    expect(
      result.blockers.some((entry) => entry.includes("reference_unresolvable")),
    ).toBe(true);
    expect(
      result.blockers.some((entry) =>
        entry.includes("reference_sha256_missing_or_invalid"),
      ),
    ).toBe(true);
  });

  it("rejects a symlink even when its target and hash would otherwise pass", async () => {
    const value = await fixture();
    const linkPath = path.join(value.outputDirectory, "tensor-link.f64");
    try {
      await fs.symlink(value.tensorPath, linkPath, "file");
    } catch (error) {
      if (
        ["EPERM", "EACCES", "ENOTSUP"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      ) {
        return;
      }
      throw error;
    }
    const linkRepoPath = portable(value.projectRoot, linkPath);
    const result = await verifyNhm2EvidenceNestedReferences({
      projectRoot: value.projectRoot,
      evidenceId: "full_apparatus_source_tensor",
      planOutputDirectory: value.outputDirectory,
      allowedImmutableInputPaths: [],
      receiptManifestEntries: [{ ...value.manifestEntry, path: linkRepoPath }],
      evidence: {
        path: linkRepoPath,
        sha256: sha256(value.tensorBytes),
      },
    });

    expect(result.status).toBe("fail");
    expect(
      result.blockers.some((entry) =>
        entry.includes("reference_symlink_forbidden"),
      ),
    ).toBe(true);
  });
});
