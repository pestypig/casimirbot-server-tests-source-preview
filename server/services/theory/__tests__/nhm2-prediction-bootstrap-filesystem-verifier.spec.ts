import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  NHM2_PREDICTION_BOOTSTRAP_FREEZE_ARTIFACT_ID,
  NHM2_PREDICTION_BOOTSTRAP_FREEZE_CONTRACT_VERSION,
  NHM2_PREDICTION_CONTENT_REPLAY_CONTRACT_VERSION,
  NHM2_PREDICTION_GENERATION_CANDIDATE_CONTRACT_VERSION,
  NHM2_PREDICTION_GENERATION_RUN_CONTRACT_VERSION,
  NHM2_PREDICTION_REPRODUCTION_CANDIDATE_CONTRACT_VERSION,
  computeNhm2PredictionBootstrapSetSha256,
  type Nhm2PredictionBootstrapArtifactRefV1,
  type Nhm2PredictionBootstrapClaimBoundaryV1,
  type Nhm2PredictionBootstrapFreezeV1,
  type Nhm2PredictionContentReplayEntryV1,
  type Nhm2PredictionContentReplayV1,
  type Nhm2PredictionGenerationCandidateV1,
  type Nhm2PredictionGenerationRunV1,
  type Nhm2PredictionReproductionCandidateV1,
} from "../../../../shared/contracts/nhm2-prediction-bootstrap-freeze.v1";
import {
  NHM2_NUMERICAL_OBSERVABLE_PREDICTION_ARTIFACT_ID_PREFIX,
  NHM2_NUMERICAL_OBSERVABLE_PREDICTION_CONTRACT_VERSION,
  NHM2_NUMERICAL_OBSERVABLE_PREDICTION_REF_CONTRACT_VERSIONS,
  type Nhm2NumericalObservablePredictionV1,
} from "../../../../shared/contracts/nhm2-numerical-observable-prediction.v1";
import {
  NHM2_PREDICTION_FREEZE_REQUIRED_OBSERVABLE_IDS,
  type Nhm2PredictionFreezeObservableId,
} from "../../../../shared/contracts/nhm2-prediction-falsifier-freeze.v1";
import {
  THEORY_RUNTIME_OUTPUT_MANIFEST_ARTIFACT_ID,
  THEORY_RUNTIME_OUTPUT_MANIFEST_SCHEMA_VERSION,
  THEORY_RUNTIME_RECEIPT_ARTIFACT_ID,
  THEORY_RUNTIME_RECEIPT_SCHEMA_VERSION,
  type TheoryRuntimeReceiptV1,
} from "../../../../shared/contracts/theory-runtime-receipt.v1";
import {
  NHM2_PREDICTION_BOOTSTRAP_HARD_MAX_FILE_BYTES,
  NHM2_PREDICTION_BOOTSTRAP_HARD_MAX_TOTAL_BYTES,
  NHM2_PREDICTION_BOOTSTRAP_MAX_CLOSURE_ENTRIES,
  NHM2_PREDICTION_BOOTSTRAP_MAX_FILE_COUNT,
  NHM2_PREDICTION_BOOTSTRAP_MAX_FREEZE_BYTES,
  NHM2_PREDICTION_BOOTSTRAP_MAX_JSON_DEPTH,
  NHM2_PREDICTION_BOOTSTRAP_MAX_PATH_DEPTH,
  verifyNhm2PredictionBootstrapFilesystem,
  type Nhm2PredictionBootstrapFilesystemViolationCode,
} from "../nhm2-prediction-bootstrap-filesystem-verifier";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

const SOURCE_COMMIT = "a".repeat(40);
const SOURCE_FROZEN = "2099-07-19T10:01:00.000Z";
const RUN_STARTED = "2099-07-19T10:05:00.000Z";
const RUN_COMPLETED = "2099-07-19T10:10:00.000Z";
const PREDICTION_GENERATED = "2099-07-19T10:12:00.000Z";
const REPLAY_GENERATED = "2099-07-19T10:13:00.000Z";
const TARGET_GENERATED = "2099-07-19T10:14:00.000Z";
const FROZEN = "2099-07-19T10:15:00.000Z";
const REPRODUCTION_START = "2099-07-19T10:20:00.000Z";
const DATA_OPENS = "2099-07-19T11:00:00.000Z";

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const boundary = (): Nhm2PredictionBootstrapClaimBoundaryV1 => ({
  theoryOnlyBootstrapEvidence: true,
  experimentReadyTheoryClosureClaimAllowed: false,
  physicalViabilityClaimAllowed: false,
  transportClaimAllowed: false,
  propulsionClaimAllowed: false,
  routeEtaClaimAllowed: false,
  speedAuthorityClaimAllowed: false,
  empiricalReceiptsRequired: true,
});

const unitFor = (observableId: Nhm2PredictionFreezeObservableId): string =>
  observableId === "delta_phi_f"
    ? "rad"
    : observableId === "delta_tau"
      ? "s"
      : observableId === "delta_F"
        ? "N"
        : observableId === "R_0i0j"
          ? "s^-2"
          : "J m^-3";

type Fixture = {
  root: string;
  freezePath: string;
  freezeSha256: string;
  closurePaths: string[];
};

async function buildFixture(): Promise<Fixture> {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "nhm2-prediction-bootstrap-fs-"),
  );
  roots.push(root);
  const files = new Map<string, Buffer>();
  const put = <T extends { artifactId: string }>(
    repoPath: string,
    schemaVersion: string,
    value: T,
  ): Nhm2PredictionBootstrapArtifactRefV1 => {
    const bytes = Buffer.from(JSON.stringify(value), "utf8");
    files.set(repoPath, bytes);
    return {
      artifactId: value.artifactId,
      path: repoPath,
      schemaVersion,
      sha256: sha256(bytes),
      sizeBytes: bytes.byteLength,
      mediaType: "application/json",
    };
  };

  const candidate: Nhm2PredictionGenerationCandidateV1 = {
    artifactId: "nhm2_prediction_generation_candidate",
    contractVersion: NHM2_PREDICTION_GENERATION_CANDIDATE_CONTRACT_VERSION,
    generatedAt: "2099-07-19T10:00:00.000Z",
    frozenAt: SOURCE_FROZEN,
    dataCollectionOpensAt: DATA_OPENS,
    candidateId: "nhm2-prediction-generation-candidate-001",
    manifestId: "nhm2-prediction-generation-manifest-001",
    laneId: "nhm2_shift_lapse",
    selectedProfileId: "nhm2-profile-alpha-0p7000-fresh-campaign",
    freezeId: "nhm2-prediction-bootstrap-freeze-001",
    sourceCommitSha: SOURCE_COMMIT,
    model: {
      modelId: "nhm2-coupled-model-001",
      parameterSetId: "nhm2-parameter-set-001",
      uncertaintyBudgetId: "nhm2-uncertainty-budget-001",
      uncertaintyMethod:
        "joint discretization and material covariance propagation",
      uncertaintySourceIds: [
        "solver-discretization-covariance",
        "material-model-covariance",
      ],
    },
    targetReservation: {
      candidateId: "nhm2-reproduction-candidate-002",
      manifestId: "nhm2-reproduction-manifest-002",
      requestId: "nhm2-reproduction-request-002",
      runId: "nhm2-reproduction-run-002",
      receiptId: "nhm2-reproduction-receipt-002",
      runtimeId: "nhm2-reproduction-runtime-002",
    },
    plannedGenerationRun: {
      requestId: "nhm2-prediction-generation-request-001",
      runId: "nhm2-prediction-generation-run-001",
      receiptId: "nhm2-prediction-generation-receipt-001",
      runtimeId: "nhm2-prediction-generation-runtime-001",
      solverId: "nhm2-coupled-prediction-solver",
      solverVersion: "1.0.0",
      outputDirectory: "bundle/run-001",
    },
    observableTargets: NHM2_PREDICTION_FREEZE_REQUIRED_OBSERVABLE_IDS.map(
      (observableId, index) => ({
        observableId,
        definition: `replayable numerical observable ${observableId}`,
        unit: unitFor(observableId),
        analysisWindow: `sealed analysis window ${index + 1}`,
        targetTime: `2099-07-19T11:${String(10 + index).padStart(2, "0")}:00.000Z`,
      }),
    ),
    provenanceBoundary: {
      sourceKind: "fresh_prediction_generation",
      historicalImport: false,
      legacyAlpha07ArtifactUsed: false,
      diagnosticSeed: false,
    },
    claimBoundary: boundary(),
  };
  const candidateRef = put(
    "bundle/candidate.json",
    NHM2_PREDICTION_GENERATION_CANDIDATE_CONTRACT_VERSION,
    candidate,
  );

  const sourceRefs = NHM2_PREDICTION_FREEZE_REQUIRED_OBSERVABLE_IDS.map(
    (observableId, index) =>
      put(
        `bundle/source-${observableId}.json`,
        NHM2_NUMERICAL_OBSERVABLE_PREDICTION_REF_CONTRACT_VERSIONS.source,
        {
          artifactId: `nhm2.prediction_source_snapshot.${observableId}`,
          contractVersion:
            NHM2_NUMERICAL_OBSERVABLE_PREDICTION_REF_CONTRACT_VERSIONS.source,
          generatedAt: RUN_COMPLETED,
          observableId,
          candidateId: candidate.candidateId,
          runId: candidate.plannedGenerationRun.runId,
          sourceCommitSha: SOURCE_COMMIT,
          sourceArraySha256: String(index + 1).repeat(64),
        },
      ),
  );
  const run: Nhm2PredictionGenerationRunV1 = {
    artifactId: "nhm2_prediction_generation_run",
    contractVersion: NHM2_PREDICTION_GENERATION_RUN_CONTRACT_VERSION,
    generatedAt: RUN_COMPLETED,
    candidateRef,
    identity: {
      candidateId: candidate.candidateId,
      selectedProfileId: candidate.selectedProfileId,
      requestId: candidate.plannedGenerationRun.requestId,
      runId: candidate.plannedGenerationRun.runId,
      receiptId: candidate.plannedGenerationRun.receiptId,
      runtimeId: candidate.plannedGenerationRun.runtimeId,
    },
    solver: {
      solverId: candidate.plannedGenerationRun.solverId,
      solverVersion: candidate.plannedGenerationRun.solverVersion,
      sourceCommitSha: SOURCE_COMMIT,
    },
    execution: {
      outputDirectory: candidate.plannedGenerationRun.outputDirectory,
      startedAt: RUN_STARTED,
      completedAt: RUN_COMPLETED,
      durationMs: 300_000,
      exitCode: 0,
    },
    sourceSnapshotRefs: sourceRefs,
    claimBoundary: boundary(),
  };
  const runRef = put(
    "bundle/run.json",
    NHM2_PREDICTION_GENERATION_RUN_CONTRACT_VERSION,
    run,
  );

  const receiptOutputs = [runRef, ...sourceRefs];
  const receipt: TheoryRuntimeReceiptV1 = {
    artifactId: THEORY_RUNTIME_RECEIPT_ARTIFACT_ID,
    schemaVersion: THEORY_RUNTIME_RECEIPT_SCHEMA_VERSION,
    generatedAt: "2099-07-19T10:11:00.000Z",
    receiptId: run.identity.receiptId,
    runtimeId: run.identity.runtimeId,
    graphId: "nhm2.prediction_generation",
    badgeIds: ["nhm2.prediction_generation.runtime"],
    command: "nhm2-prediction-generation",
    args: { candidateId: candidate.candidateId },
    status: "completed",
    outputs: {
      artifacts: receiptOutputs.map((ref) => ref.path),
      scalars: { exitCode: 0 },
      units: { exitCode: null },
      gates: { prediction_generation_runtime: "pass" },
      missingSignals: [],
      warnings: [],
      artifactManifest: {
        artifactId: THEORY_RUNTIME_OUTPUT_MANIFEST_ARTIFACT_ID,
        schemaVersion: THEORY_RUNTIME_OUTPUT_MANIFEST_SCHEMA_VERSION,
        generatedAt: "2099-07-19T10:10:30.000Z",
        requestId: run.identity.requestId,
        runtimeId: run.identity.runtimeId,
        gitSha: SOURCE_COMMIT,
        startedAt: RUN_STARTED,
        completedAt: RUN_COMPLETED,
        outputDirectory: run.execution.outputDirectory,
        boundToExecution: true,
        manifestPath: "bundle/runtime-output-manifest.json",
        manifestSha256: "b".repeat(64),
        entries: receiptOutputs.map((ref) => ({
          path: ref.path,
          sha256: ref.sha256,
          sizeBytes: ref.sizeBytes,
          modifiedAt: RUN_COMPLETED,
          freshness: "new" as const,
        })),
      },
      artifactEvidence: receiptOutputs.map((ref) => ({
        path: ref.path,
        sha256: ref.sha256,
        freshness: "new" as const,
        status: "pass" as const,
        gates: { raw_bytes_hash_bound: "pass" as const },
      })),
    },
    provenance: {
      gitSha: SOURCE_COMMIT,
      startedAt: RUN_STARTED,
      completedAt: RUN_COMPLETED,
      durationMs: 300_000,
    },
    execution: {
      command: "nhm2-prediction-generation",
      args: ["--candidate", candidateRef.path],
      cwd: "casimirbot",
      environment: { NHM2_RUN_ID: run.identity.runId },
      outputDirectory: run.execution.outputDirectory,
      outputDirectoryBound: true,
      exitCode: 0,
      stdout: "prediction source generation completed",
      stderr: "",
      timedOut: false,
      error: null,
    },
    claimBoundary: {
      currentTier: "diagnostic",
      maximumTier: "diagnostic",
      promotionAllowed: false,
      promotionBlockedBy: ["experimental receipts remain absent"],
    },
  };
  const receiptRef = put(
    "bundle/receipt.json",
    THEORY_RUNTIME_RECEIPT_SCHEMA_VERSION,
    receipt,
  );

  const predictions: Nhm2NumericalObservablePredictionV1[] = [];
  const predictionRefs: Nhm2PredictionBootstrapArtifactRefV1[] = [];
  const derivationRefs: Nhm2PredictionBootstrapArtifactRefV1[] = [];
  const uncertaintyRefs: Nhm2PredictionBootstrapArtifactRefV1[] = [];
  NHM2_PREDICTION_FREEZE_REQUIRED_OBSERVABLE_IDS.forEach(
    (observableId, index) => {
      const derivationRef = put(
        `bundle/derivation-${observableId}.json`,
        NHM2_NUMERICAL_OBSERVABLE_PREDICTION_REF_CONTRACT_VERSIONS.derivation,
        {
          artifactId: `nhm2.prediction_derivation.${observableId}`,
          contractVersion:
            NHM2_NUMERICAL_OBSERVABLE_PREDICTION_REF_CONTRACT_VERSIONS.derivation,
          generatedAt: PREDICTION_GENERATED,
          observableId,
          runId: run.identity.runId,
          sourceRef: sourceRefs[index],
          equationId: `nhm2-observable-equation-${index + 1}`,
        },
      );
      derivationRefs.push(derivationRef);
      const uncertaintyRef = put(
        `bundle/uncertainty-${observableId}.json`,
        NHM2_NUMERICAL_OBSERVABLE_PREDICTION_REF_CONTRACT_VERSIONS.uncertainty,
        {
          artifactId: `nhm2.prediction_uncertainty.${observableId}`,
          contractVersion:
            NHM2_NUMERICAL_OBSERVABLE_PREDICTION_REF_CONTRACT_VERSIONS.uncertainty,
          generatedAt: PREDICTION_GENERATED,
          observableId,
          uncertaintyBudgetId: candidate.model.uncertaintyBudgetId,
          method: candidate.model.uncertaintyMethod,
          sourceIds: candidate.model.uncertaintySourceIds,
          derivationRef,
        },
      );
      uncertaintyRefs.push(uncertaintyRef);
      const centralValue = 1 + index / 10;
      const phase = observableId === "delta_phi_f";
      const prediction: Nhm2NumericalObservablePredictionV1 = {
        artifactId: `${NHM2_NUMERICAL_OBSERVABLE_PREDICTION_ARTIFACT_ID_PREFIX}.${observableId}`,
        contractVersion: NHM2_NUMERICAL_OBSERVABLE_PREDICTION_CONTRACT_VERSION,
        generatedAt: PREDICTION_GENERATED,
        frozenAt: FROZEN,
        dataCollectionOpensAt: DATA_OPENS,
        binding: {
          candidateId: candidate.targetReservation.candidateId,
          selectedProfileId: candidate.selectedProfileId,
          freezeId: candidate.freezeId,
          modelId: candidate.model.modelId,
          parameterSetId: candidate.model.parameterSetId,
          uncertaintyBudgetId: candidate.model.uncertaintyBudgetId,
        },
        observable: {
          observableId,
          definition: candidate.observableTargets[index].definition,
          unit: candidate.observableTargets[index].unit,
          centralValue,
          coverageInterval: {
            lower: 0.5,
            upper: 2,
            coverageProbability: 0.95,
            unit: candidate.observableTargets[index].unit,
          },
          signOrPhase: phase
            ? {
                kind: "phase",
                statement: "positive phase excursion in the sealed window",
                expectedPhaseRadians: centralValue,
              }
            : {
                kind: "positive",
                statement: "positive signed observable in the sealed window",
                expectedPhaseRadians: null,
              },
          scalingLaw: {
            expression: "observable = calibrated_amplitude * drive_scale",
            independentVariables: ["drive_scale"],
            validityDomain: "frozen bounded source and geometry domain",
          },
          analysisWindow: candidate.observableTargets[index].analysisWindow,
        },
        derivation: {
          runId: run.identity.runId,
          runtimeId: run.identity.runtimeId,
          solverId: run.solver.solverId,
          solverVersion: run.solver.solverVersion,
          sourceCommitSha: SOURCE_COMMIT,
          runReceiptRef: {
            artifactId: receiptRef.artifactId,
            path: receiptRef.path,
            schemaVersion: receiptRef.schemaVersion,
            sha256: receiptRef.sha256,
          },
          sourceRef: {
            artifactId: sourceRefs[index].artifactId,
            path: sourceRefs[index].path,
            schemaVersion: sourceRefs[index].schemaVersion,
            sha256: sourceRefs[index].sha256,
          },
          derivationRef: {
            artifactId: derivationRef.artifactId,
            path: derivationRef.path,
            schemaVersion: derivationRef.schemaVersion,
            sha256: derivationRef.sha256,
          },
        },
        uncertainty: {
          uncertaintyBudgetId: candidate.model.uncertaintyBudgetId,
          method: candidate.model.uncertaintyMethod,
          sourceIds: candidate.model.uncertaintySourceIds,
          derivationRef: {
            artifactId: uncertaintyRef.artifactId,
            path: uncertaintyRef.path,
            schemaVersion: uncertaintyRef.schemaVersion,
            sha256: uncertaintyRef.sha256,
          },
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
      predictions.push(prediction);
      predictionRefs.push(
        put(
          `bundle/prediction-${observableId}.json`,
          NHM2_NUMERICAL_OBSERVABLE_PREDICTION_CONTRACT_VERSION,
          prediction,
        ),
      );
    },
  );

  const setEntries = predictions.map((prediction, index) => ({
    observableId: prediction.observable.observableId,
    ref: predictionRefs[index],
    prediction,
  }));
  const predictionSetSha256 =
    computeNhm2PredictionBootstrapSetSha256(setEntries);
  const replayEntries: Nhm2PredictionContentReplayEntryV1[] = predictions.map(
    (prediction, index) => ({
      observableId: prediction.observable.observableId,
      targetTime: candidate.observableTargets[index].targetTime,
      analysisWindow: prediction.observable.analysisWindow,
      unit: prediction.observable.unit,
      centralValue: prediction.observable.centralValue,
      intervalLower: prediction.observable.coverageInterval.lower,
      intervalUpper: prediction.observable.coverageInterval.upper,
      coverageProbability:
        prediction.observable.coverageInterval.coverageProbability,
      predictionRef: predictionRefs[index],
      sourceSnapshotRef: sourceRefs[index],
      derivationRef: derivationRefs[index],
      uncertaintyRef: uncertaintyRefs[index],
    }),
  );
  const replay: Nhm2PredictionContentReplayV1 = {
    artifactId: "nhm2_prediction_content_replay",
    contractVersion: NHM2_PREDICTION_CONTENT_REPLAY_CONTRACT_VERSION,
    generatedAt: REPLAY_GENERATED,
    candidateRef,
    runRef,
    receiptRef,
    identity: {
      candidateId: candidate.candidateId,
      selectedProfileId: candidate.selectedProfileId,
      requestId: run.identity.requestId,
      runId: run.identity.runId,
      receiptId: run.identity.receiptId,
      runtimeId: run.identity.runtimeId,
      freezeId: candidate.freezeId,
    },
    algorithm: "reopen_hash_and_recompute_prediction_payload/v1",
    predictionSetSha256,
    entries: replayEntries,
    result: "verified",
    claimBoundary: boundary(),
  };
  const replayRef = put(
    "bundle/content-replay.json",
    NHM2_PREDICTION_CONTENT_REPLAY_CONTRACT_VERSION,
    replay,
  );
  const target: Nhm2PredictionReproductionCandidateV1 = {
    artifactId: "nhm2_prediction_reproduction_candidate",
    contractVersion: NHM2_PREDICTION_REPRODUCTION_CANDIDATE_CONTRACT_VERSION,
    generatedAt: TARGET_GENERATED,
    frozenAt: FROZEN,
    dataCollectionOpensAt: DATA_OPENS,
    candidateId: candidate.targetReservation.candidateId,
    manifestId: candidate.targetReservation.manifestId,
    laneId: "nhm2_shift_lapse",
    selectedProfileId: candidate.selectedProfileId,
    freezeId: candidate.freezeId,
    supersession: {
      predecessorCandidateId: candidate.candidateId,
      predecessorManifestId: candidate.manifestId,
      predecessorRef: candidateRef,
      originalImmutable: true,
      inPlaceMutationForbidden: true,
    },
    contentReplayRef: replayRef,
    predictionSetSha256,
    predictionRefs,
    reproductionRun: {
      requestId: candidate.targetReservation.requestId,
      runId: candidate.targetReservation.runId,
      receiptId: candidate.targetReservation.receiptId,
      runtimeId: candidate.targetReservation.runtimeId,
      plannedStartAt: REPRODUCTION_START,
    },
    claimBoundary: boundary(),
  };
  const targetRef = put(
    "bundle/target-candidate.json",
    NHM2_PREDICTION_REPRODUCTION_CANDIDATE_CONTRACT_VERSION,
    target,
  );

  const closure = [
    candidateRef,
    runRef,
    receiptRef,
    replayRef,
    targetRef,
    ...sourceRefs,
    ...derivationRefs,
    ...uncertaintyRefs,
    ...predictionRefs,
  ].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const freezePath = "bootstrap-freeze.json";
  const freeze: Nhm2PredictionBootstrapFreezeV1 = {
    artifactId: NHM2_PREDICTION_BOOTSTRAP_FREEZE_ARTIFACT_ID,
    contractVersion: NHM2_PREDICTION_BOOTSTRAP_FREEZE_CONTRACT_VERSION,
    generatedAt: FROZEN,
    frozenAt: FROZEN,
    freezePath,
    freezeId: candidate.freezeId,
    source: {
      candidateRef,
      runRef,
      receiptRef,
      contentReplayRef: replayRef,
    },
    targetCandidateRef: targetRef,
    predictionSetSha256,
    predictionRefs,
    artifactClosure: {
      algorithm: "sha256_raw_utf8_json/v1",
      ordering: "path_code_unit_ascending/v1",
      entries: closure,
    },
    claimBoundary: boundary(),
  };
  files.set(freezePath, Buffer.from(JSON.stringify(freeze), "utf8"));

  for (const [repoPath, bytes] of files) {
    const absolutePath = path.join(root, ...repoPath.split("/"));
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, bytes);
  }
  return {
    root,
    freezePath,
    freezeSha256: sha256(files.get(freezePath)!),
    closurePaths: closure.map((ref) => ref.path),
  };
}

const codes = (
  result: Awaited<ReturnType<typeof verifyNhm2PredictionBootstrapFilesystem>>,
): Nhm2PredictionBootstrapFilesystemViolationCode[] =>
  result.violations.map((violation) => violation.code);

const freezeAbsolutePath = (fixture: Fixture): string =>
  path.join(fixture.root, ...fixture.freezePath.split("/"));

const readFixtureFreeze = async (
  fixture: Fixture,
): Promise<Nhm2PredictionBootstrapFreezeV1> =>
  JSON.parse(
    await fs.readFile(freezeAbsolutePath(fixture), "utf8"),
  ) as Nhm2PredictionBootstrapFreezeV1;

const writeFixtureFreeze = async (
  fixture: Fixture,
  value: unknown,
): Promise<string> => {
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  await fs.writeFile(freezeAbsolutePath(fixture), bytes);
  return sha256(bytes);
};

describe("NHM2 prediction bootstrap filesystem verifier", () => {
  it("verifies the exact contained bytes without granting physical authority", async () => {
    const fixture = await buildFixture();
    const result = await verifyNhm2PredictionBootstrapFilesystem({
      bootstrapRoot: fixture.root,
      freezeArtifactPath: fixture.freezePath,
      expectedFreezeSha256: fixture.freezeSha256,
    });

    expect(result.verified).toBe(true);
    if (!result.verified) throw new Error(JSON.stringify(result.violations));
    expect(result.files).toHaveLength(fixture.closurePaths.length + 1);
    expect(result.contentVerification.valid).toBe(true);
    expect(result.claimBoundary).toMatchObject({
      filesystemAndContentVerificationOnly: true,
      experimentReadyTheoryClosureClaimAllowed: false,
      physicalViabilityClaimAllowed: false,
      transportClaimAllowed: false,
      propulsionClaimAllowed: false,
      routeEtaClaimAllowed: false,
      speedAuthorityClaimAllowed: false,
    });
    expect(Object.keys(result)).not.toContain("status");
    expect(Object.keys(result)).not.toContain("pass");
    expect(Object.keys(result)).not.toContain("ready");
  });

  it("rejects traversal and a caller-supplied freeze hash mismatch", async () => {
    const fixture = await buildFixture();
    const traversal = await verifyNhm2PredictionBootstrapFilesystem({
      bootstrapRoot: fixture.root,
      freezeArtifactPath: "../bootstrap-freeze.json",
      expectedFreezeSha256: fixture.freezeSha256,
    });
    expect(codes(traversal)).toContain("freeze_path_escape");

    const wrongHash = await verifyNhm2PredictionBootstrapFilesystem({
      bootstrapRoot: fixture.root,
      freezeArtifactPath: fixture.freezePath,
      expectedFreezeSha256: "f".repeat(64),
    });
    expect(codes(wrongHash)).toContain("freeze_sha256_mismatch");
  });

  it("rejects any undeclared file in the recursive inventory", async () => {
    const fixture = await buildFixture();
    await fs.writeFile(
      path.join(fixture.root, "undeclared.json"),
      "{}",
      "utf8",
    );

    const result = await verifyNhm2PredictionBootstrapFilesystem({
      bootstrapRoot: fixture.root,
      freezeArtifactPath: fixture.freezePath,
      expectedFreezeSha256: fixture.freezeSha256,
    });
    expect(result.verified).toBe(false);
    expect(codes(result)).toContain("filesystem_extra_file");
  });

  it("stops a filesystem inventory that exceeds the regular-file cap", async () => {
    const fixture = await buildFixture();
    await Promise.all(
      Array.from(
        { length: NHM2_PREDICTION_BOOTSTRAP_MAX_FILE_COUNT },
        (_, index) =>
          fs.writeFile(
            path.join(fixture.root, `undeclared-${index}.json`),
            "{}",
            "utf8",
          ),
      ),
    );

    const result = await verifyNhm2PredictionBootstrapFilesystem({
      bootstrapRoot: fixture.root,
      freezeArtifactPath: fixture.freezePath,
      expectedFreezeSha256: fixture.freezeSha256,
    });
    expect(result.verified).toBe(false);
    expect(codes(result)).toContain("filesystem_resource_limit_exceeded");
  });

  it("enforces fixed and caller-bounded byte ceilings before semantic replay", async () => {
    const fixture = await buildFixture();
    const freezeStat = await fs.stat(freezeAbsolutePath(fixture));

    const perFileLimited = await verifyNhm2PredictionBootstrapFilesystem({
      bootstrapRoot: fixture.root,
      freezeArtifactPath: fixture.freezePath,
      expectedFreezeSha256: fixture.freezeSha256,
      maxFileBytes: 1,
    });
    expect(codes(perFileLimited)).toContain(
      "filesystem_resource_limit_exceeded",
    );

    const aggregateLimited = await verifyNhm2PredictionBootstrapFilesystem({
      bootstrapRoot: fixture.root,
      freezeArtifactPath: fixture.freezePath,
      expectedFreezeSha256: fixture.freezeSha256,
      maxTotalBytes: freezeStat.size + 1,
    });
    expect(codes(aggregateLimited)).toContain(
      "filesystem_resource_limit_exceeded",
    );

    const invalidFileLimit = await verifyNhm2PredictionBootstrapFilesystem({
      bootstrapRoot: fixture.root,
      freezeArtifactPath: fixture.freezePath,
      expectedFreezeSha256: fixture.freezeSha256,
      maxFileBytes: NHM2_PREDICTION_BOOTSTRAP_HARD_MAX_FILE_BYTES + 1,
    });
    expect(codes(invalidFileLimit)).toEqual(["verifier_input_invalid"]);

    const invalidTotalLimit = await verifyNhm2PredictionBootstrapFilesystem({
      bootstrapRoot: fixture.root,
      freezeArtifactPath: fixture.freezePath,
      expectedFreezeSha256: fixture.freezeSha256,
      maxTotalBytes: NHM2_PREDICTION_BOOTSTRAP_HARD_MAX_TOTAL_BYTES + 1,
    });
    expect(codes(invalidTotalLimit)).toEqual(["verifier_input_invalid"]);

    const oversizedFreeze = Buffer.alloc(
      NHM2_PREDICTION_BOOTSTRAP_MAX_FREEZE_BYTES + 1,
      0x20,
    );
    await fs.writeFile(freezeAbsolutePath(fixture), oversizedFreeze);
    const freezeLimited = await verifyNhm2PredictionBootstrapFilesystem({
      bootstrapRoot: fixture.root,
      freezeArtifactPath: fixture.freezePath,
      expectedFreezeSha256: sha256(oversizedFreeze),
    });
    expect(codes(freezeLimited)).toContain(
      "filesystem_resource_limit_exceeded",
    );
    expect(freezeLimited.claimBoundary.physicalViabilityClaimAllowed).toBe(
      false,
    );
  });

  it("rejects non-canonical, BOM-prefixed, and invalid UTF-8 freeze bytes", async () => {
    const nonCanonicalFixture = await buildFixture();
    const freeze = await readFixtureFreeze(nonCanonicalFixture);
    const nonCanonicalBytes = Buffer.from(JSON.stringify(freeze, null, 2));
    await fs.writeFile(
      freezeAbsolutePath(nonCanonicalFixture),
      nonCanonicalBytes,
    );
    const nonCanonical = await verifyNhm2PredictionBootstrapFilesystem({
      bootstrapRoot: nonCanonicalFixture.root,
      freezeArtifactPath: nonCanonicalFixture.freezePath,
      expectedFreezeSha256: sha256(nonCanonicalBytes),
    });
    expect(codes(nonCanonical)).toContain("freeze_json_not_canonical");

    const bomFixture = await buildFixture();
    const bomBytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      await fs.readFile(freezeAbsolutePath(bomFixture)),
    ]);
    await fs.writeFile(freezeAbsolutePath(bomFixture), bomBytes);
    const bom = await verifyNhm2PredictionBootstrapFilesystem({
      bootstrapRoot: bomFixture.root,
      freezeArtifactPath: bomFixture.freezePath,
      expectedFreezeSha256: sha256(bomBytes),
    });
    expect(codes(bom)).toContain("freeze_bom_forbidden");

    const invalidUtf8Fixture = await buildFixture();
    const invalidUtf8Bytes = Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff]);
    await fs.writeFile(
      freezeAbsolutePath(invalidUtf8Fixture),
      invalidUtf8Bytes,
    );
    const invalidUtf8 = await verifyNhm2PredictionBootstrapFilesystem({
      bootstrapRoot: invalidUtf8Fixture.root,
      freezeArtifactPath: invalidUtf8Fixture.freezePath,
      expectedFreezeSha256: sha256(invalidUtf8Bytes),
    });
    expect(codes(invalidUtf8)).toContain("freeze_utf8_invalid");
  });

  it("preflights every closure artifact as bounded canonical UTF-8 JSON", async () => {
    const nonCanonicalFixture = await buildFixture();
    const artifactPath = nonCanonicalFixture.closurePaths[0];
    const artifactAbsolutePath = path.join(
      nonCanonicalFixture.root,
      ...artifactPath.split("/"),
    );
    const artifact = JSON.parse(
      await fs.readFile(artifactAbsolutePath, "utf8"),
    ) as unknown;
    await fs.writeFile(
      artifactAbsolutePath,
      Buffer.from(JSON.stringify(artifact, null, 2), "utf8"),
    );
    const nonCanonical = await verifyNhm2PredictionBootstrapFilesystem({
      bootstrapRoot: nonCanonicalFixture.root,
      freezeArtifactPath: nonCanonicalFixture.freezePath,
      expectedFreezeSha256: nonCanonicalFixture.freezeSha256,
    });
    expect(codes(nonCanonical)).toContain("artifact_json_not_canonical");

    const invalidUtf8Fixture = await buildFixture();
    const invalidArtifactPath = invalidUtf8Fixture.closurePaths[0];
    await fs.writeFile(
      path.join(invalidUtf8Fixture.root, ...invalidArtifactPath.split("/")),
      Buffer.from([0x7b, 0xff, 0x7d]),
    );
    const invalidUtf8 = await verifyNhm2PredictionBootstrapFilesystem({
      bootstrapRoot: invalidUtf8Fixture.root,
      freezeArtifactPath: invalidUtf8Fixture.freezePath,
      expectedFreezeSha256: invalidUtf8Fixture.freezeSha256,
    });
    expect(codes(invalidUtf8)).toContain("artifact_utf8_invalid");
  });

  it("bounds JSON depth, closure count, and portable path depth", async () => {
    const deepJsonFixture = await buildFixture();
    let deepValue: unknown = 0;
    for (
      let depth = 0;
      depth <= NHM2_PREDICTION_BOOTSTRAP_MAX_JSON_DEPTH;
      depth += 1
    ) {
      deepValue = [deepValue];
    }
    const deepJsonSha256 = await writeFixtureFreeze(deepJsonFixture, deepValue);
    const deepJson = await verifyNhm2PredictionBootstrapFilesystem({
      bootstrapRoot: deepJsonFixture.root,
      freezeArtifactPath: deepJsonFixture.freezePath,
      expectedFreezeSha256: deepJsonSha256,
    });
    expect(codes(deepJson)).toContain("filesystem_resource_limit_exceeded");

    const closureFixture = await buildFixture();
    const oversizedClosure = await readFixtureFreeze(closureFixture);
    const seedRef = oversizedClosure.artifactClosure.entries[0];
    while (
      oversizedClosure.artifactClosure.entries.length <=
      NHM2_PREDICTION_BOOTSTRAP_MAX_CLOSURE_ENTRIES
    ) {
      oversizedClosure.artifactClosure.entries.push(seedRef);
    }
    const oversizedClosureSha256 = await writeFixtureFreeze(
      closureFixture,
      oversizedClosure,
    );
    const closureLimited = await verifyNhm2PredictionBootstrapFilesystem({
      bootstrapRoot: closureFixture.root,
      freezeArtifactPath: closureFixture.freezePath,
      expectedFreezeSha256: oversizedClosureSha256,
    });
    expect(codes(closureLimited)).toContain(
      "filesystem_resource_limit_exceeded",
    );

    const pathFixture = await buildFixture();
    const deepPathFreeze = await readFixtureFreeze(pathFixture);
    deepPathFreeze.artifactClosure.entries[0].path = `${Array.from(
      { length: NHM2_PREDICTION_BOOTSTRAP_MAX_PATH_DEPTH + 1 },
      (_, index) => `d${index}`,
    ).join("/")}/artifact.json`;
    const deepPathSha256 = await writeFixtureFreeze(
      pathFixture,
      deepPathFreeze,
    );
    const pathLimited = await verifyNhm2PredictionBootstrapFilesystem({
      bootstrapRoot: pathFixture.root,
      freezeArtifactPath: pathFixture.freezePath,
      expectedFreezeSha256: deepPathSha256,
    });
    expect(codes(pathLimited)).toContain("filesystem_resource_limit_exceeded");
  });

  it("rejects symbolic links and hardlinks where the platform permits them", async () => {
    const hardlinkFixture = await buildFixture();
    const hardlinkTarget = path.join(
      hardlinkFixture.root,
      ...hardlinkFixture.closurePaths[0].split("/"),
    );
    const externalHardlink = path.join(
      path.dirname(hardlinkFixture.root),
      `nhm2-bootstrap-hardlink-${Date.now()}.json`,
    );
    roots.push(externalHardlink);
    try {
      await fs.link(hardlinkTarget, externalHardlink);
      const hardlinked = await verifyNhm2PredictionBootstrapFilesystem({
        bootstrapRoot: hardlinkFixture.root,
        freezeArtifactPath: hardlinkFixture.freezePath,
        expectedFreezeSha256: hardlinkFixture.freezeSha256,
      });
      expect(codes(hardlinked)).toContain("filesystem_entry_hardlinked");
    } catch (error) {
      if (
        !["EPERM", "ENOTSUP", "EACCES"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      ) {
        throw error;
      }
    }

    const symlinkFixture = await buildFixture();
    const symlinkTarget = path.join(
      symlinkFixture.root,
      ...symlinkFixture.closurePaths[0].split("/"),
    );
    const externalSource = path.join(
      path.dirname(symlinkFixture.root),
      `nhm2-bootstrap-symlink-${Date.now()}.json`,
    );
    roots.push(externalSource);
    await fs.copyFile(symlinkTarget, externalSource);
    await fs.rm(symlinkTarget);
    try {
      await fs.symlink(externalSource, symlinkTarget, "file");
      const linked = await verifyNhm2PredictionBootstrapFilesystem({
        bootstrapRoot: symlinkFixture.root,
        freezeArtifactPath: symlinkFixture.freezePath,
        expectedFreezeSha256: symlinkFixture.freezeSha256,
      });
      expect(codes(linked)).toContain("filesystem_entry_symlink_or_reparse");
    } catch (error) {
      if (
        !["EPERM", "ENOTSUP", "EACCES"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      ) {
        throw error;
      }
    }
  });

  it("re-stats and re-hashes every file after semantic replay to reject TOCTOU mutation", async () => {
    const fixture = await buildFixture();
    const mutationPath = fixture.closurePaths.find((repoPath) =>
      repoPath.includes("prediction-DeltaTmunu_xt"),
    );
    if (mutationPath == null) throw new Error("prediction fixture missing");

    const result = await verifyNhm2PredictionBootstrapFilesystem({
      bootstrapRoot: fixture.root,
      freezeArtifactPath: fixture.freezePath,
      expectedFreezeSha256: fixture.freezeSha256,
      afterSemanticVerificationForTesting: async () => {
        await fs.appendFile(
          path.join(fixture.root, ...mutationPath.split("/")),
          " ",
          "utf8",
        );
      },
    });
    expect(result.verified).toBe(false);
    expect(codes(result)).toEqual(
      expect.arrayContaining([
        "filesystem_file_changed",
        "filesystem_inventory_changed",
      ]),
    );
  });
});
