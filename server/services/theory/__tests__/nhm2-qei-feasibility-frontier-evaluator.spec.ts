import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildNhm2QeiFeasibilityFrontier,
  type BuildNhm2QeiFeasibilityFrontierInputV1,
  type Nhm2QeiFeasibilityArtifactBindingV1,
  type Nhm2QeiFeasibilityEvaluationInputV1,
  type Nhm2QeiFeasibilityFrontierV1,
  type Nhm2QeiFeasibilityTheoremV1,
} from "../../../../shared/contracts/nhm2-qei-feasibility-frontier.v1";
import { buildTheoryRuntimeReceiptV1 } from "../../../../shared/contracts/theory-runtime-receipt.v1";
import {
  parseNhm2QeiFeasibilityFrontierCliArgs,
  runNhm2QeiFeasibilityFrontierCli,
} from "../../../../tools/nhm2/evaluate-qei-feasibility-frontier";
import {
  evaluateNhm2QeiFeasibilityFrontierFilesystem,
  isPinnedNhm2QeiRunId,
  isPinnedNhm2QeiRepoPath,
  NHM2_QEI_FEASIBILITY_MAX_BOUND_FILE_BYTES,
  readPinnedNhm2QeiJsonSource,
} from "../nhm2-qei-feasibility-frontier-evaluator";
import {
  buildTheoryRuntimeFreshnessProof,
  classifyTheoryRuntimeArtifacts,
  snapshotTheoryRuntimeOutput,
  writeTheoryRuntimeOutputManifest,
  writeTheoryRuntimePreSpawnSnapshotCommitment,
} from "../runtime-artifact-manifest";

const RUN_ID = "237";
const EPOCH_ID = "gr-agent-loop:237:0";
const GIT_SHA = "5".repeat(40);
const STARTED_AT = "2099-07-19T12:00:00.000Z";
const COMPLETED_AT = "2099-07-19T12:00:01.000Z";
const REQUEST_ID = "qei-frontier-request-237";
const RUNTIME_ID = "nhm2.qei.feasibility_frontier";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      fs.rm(root, { recursive: true, force: true }),
    ),
  );
});

const sha256 = (bytes: Buffer | string): string =>
  createHash("sha256").update(bytes).digest("hex");

async function writeJson(input: {
  projectRoot: string;
  repoPath: string;
  value: unknown;
}): Promise<{ repoPath: string; sha256: string; bytes: Buffer }> {
  const bytes = Buffer.from(`${JSON.stringify(input.value, null, 2)}\n`, "utf8");
  const absolutePath = path.join(
    input.projectRoot,
    ...input.repoPath.split("/"),
  );
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, bytes);
  return { repoPath: input.repoPath, sha256: sha256(bytes), bytes };
}

const runBinding = (
  artifactRef: string,
  digest: string,
): Nhm2QeiFeasibilityArtifactBindingV1 => ({
  artifactRef,
  sha256: digest,
  runId: RUN_ID,
  epochId: EPOCH_ID,
});

const boundFor = (
  tauSeconds: number,
  theorem: Nhm2QeiFeasibilityTheoremV1,
): number =>
  -theorem.K_Jm3_s4 / Math.pow(tauSeconds, 4) - theorem.safetySigma_Jm3;

const marginFor = (lhs: number, bound: number): number =>
  lhs >= 0 ? 0 : Math.abs(lhs) / Math.abs(bound);

function rawEvaluationArtifact(input: {
  evaluation: Nhm2QeiFeasibilityEvaluationInputV1;
  mutate?: (value: Record<string, unknown>) => void;
}): unknown {
  const evaluation = input.evaluation;
  const value: Record<string, unknown> = {
    artifactId: "nhm2_qei_raw_evaluation",
    schemaVersion: "nhm2_qei_raw_evaluation/v1",
    runId: RUN_ID,
    epochId: EPOCH_ID,
    candidateId: "candidate-a",
    evaluation: {
      evaluationId: evaluation.evaluationId,
      worldlineId: evaluation.worldlineId,
      samplingFamilyId: evaluation.samplingFamilyId,
      theoremId: evaluation.theoremId,
      tauSeconds: evaluation.tauSeconds,
      samplingNormalized: evaluation.samplingNormalized,
      lhs_Jm3: evaluation.lhs_Jm3,
      boundComputed_Jm3: evaluation.boundComputed_Jm3,
      boundPolicy_Jm3: evaluation.boundPolicy_Jm3,
      marginRawComputed: evaluation.marginRawComputed,
      marginPolicy: evaluation.marginPolicy,
      applicabilityStatus: evaluation.applicabilityStatus,
      tauConsistency: evaluation.tauConsistency,
      metricSemanticBinding: evaluation.metricSemanticBinding,
      policyEvidence: evaluation.policyEvidence,
      evidenceOrigin: evaluation.evidenceOrigin,
      binding: evaluation.binding,
    },
  };
  input.mutate?.(value);
  return value;
}

type FixtureOptions = {
  outcome?: "candidate_found" | "no_candidate" | "frontier_not_evaluable";
  mutateRaw?: (value: Record<string, unknown>) => void;
  mutateQuadrature?: (value: Record<string, unknown>) => void;
  theoremSetContentsMismatch?: boolean;
  runtimeEpochMismatch?: boolean;
  runtimeIdOverride?: string;
  profileOutsideRuntimeManifest?: boolean;
  preexistingRuntimeOutput?: boolean;
};

async function buildFixture(options: FixtureOptions = {}): Promise<{
  projectRoot: string;
  frontierPath: string;
  frontier: Nhm2QeiFeasibilityFrontierV1;
  rawPath: string;
  quadraturePath: string;
  runtimeReceiptPath: string;
  qftStatePath: string;
}> {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "nhm2-qei-frontier-fs-"),
  );
  roots.push(projectRoot);
  const outputDirectoryRepoPath = `artifacts/qei-runtime/${RUN_ID}`;
  const outputDirectory = path.join(
    projectRoot,
    ...outputDirectoryRepoPath.split("/"),
  );
  await fs.mkdir(outputDirectory, { recursive: true });
  const runtimeId = options.runtimeIdOverride ?? RUNTIME_ID;
  if (options.preexistingRuntimeOutput) {
    await fs.writeFile(
      path.join(outputDirectory, "preexisting.json"),
      "{}\n",
      "utf8",
    );
  }

  const before = await snapshotTheoryRuntimeOutput({
    projectRoot,
    outputDirectory,
  });
  const beforeCommitment =
    await writeTheoryRuntimePreSpawnSnapshotCommitment({
      projectRoot,
      requestId: REQUEST_ID,
      runtimeId,
      outputDirectory,
      beforeCapturedAt: STARTED_AT,
      gitSha: GIT_SHA,
      sourceTreeSha256: "f".repeat(64),
      worktreeClean: true,
      before,
    });

  const theoremProvenance = await writeJson({
    projectRoot,
    repoPath: "docs/research/qei/theorem-gaussian.json",
    value: {
      artifactId: "qei_theorem_provenance",
      theoremId: "ford-roman:gaussian",
      citation: "fixture",
    },
  });
  const theorem: Nhm2QeiFeasibilityTheoremV1 = {
    theoremId: "ford-roman:gaussian",
    samplingFamilyId: "gaussian",
    fieldType: "em",
    lowerBoundForm: "minus_K_over_tau_four_minus_safety_sigma",
    K_Jm3_s4: 1e-20,
    safetySigma_Jm3: 10,
    tauMinSeconds: 1e-9,
    tauMaxSeconds: 1e-3,
    stationaryTimelikeWorldlinesSupported: true,
    normalizedSamplingRequired: true,
    supported: true,
    provenanceRef: theoremProvenance.repoPath,
    provenanceSha256: theoremProvenance.sha256,
  };
  const theoremSet = await writeJson({
    projectRoot,
    repoPath: "artifacts/qei-static/theorem-set.json",
    value: {
      artifactId: "nhm2_qei_theorem_set",
      schemaVersion: "nhm2_qei_theorem_set/v1",
      theorems: options.theoremSetContentsMismatch ? [] : [theorem],
    },
  });

  const runManifest = await writeJson({
    projectRoot,
    repoPath: `${outputDirectoryRepoPath}/run-manifest.json`,
    value: {
      artifactId: "nhm2_qei_feasibility_run_manifest",
      schemaVersion: "nhm2_qei_feasibility_run_manifest/v1",
      runId: RUN_ID,
      epochId: EPOCH_ID,
      commitSha: GIT_SHA,
      startedAt: STARTED_AT,
      completedAt: COMPLETED_AT,
    },
  });
  const qftState = await writeJson({
    projectRoot,
    repoPath: `${outputDirectoryRepoPath}/qft-state.json`,
    value: {
      runId: RUN_ID,
      epochId: EPOCH_ID,
      stateClass: "hadamard",
      renormalizationScheme: "point_splitting",
      operatorMapping: "t_munu_uu_ren",
    },
  });
  const continuousObserver = await writeJson({
    projectRoot,
    repoPath: `${outputDirectoryRepoPath}/continuous-observer.json`,
    value: {
      runId: RUN_ID,
      epochId: EPOCH_ID,
      continuousCoverage: true,
      worldlineIds: ["wall-a"],
    },
  });
  const worldlineSet = await writeJson({
    projectRoot,
    repoPath: `${outputDirectoryRepoPath}/worldlines.json`,
    value: {
      runId: RUN_ID,
      epochId: EPOCH_ID,
      worldlineIds: ["wall-a"],
    },
  });
  const samplingFamilySet = await writeJson({
    projectRoot,
    repoPath: `${outputDirectoryRepoPath}/sampling-families.json`,
    value: {
      runId: RUN_ID,
      epochId: EPOCH_ID,
      samplingFamilyIds: ["gaussian"],
    },
  });
  const profile = await writeJson({
    projectRoot,
    repoPath: options.profileOutsideRuntimeManifest
      ? "artifacts/qei-inputs/candidate-profile.json"
      : `${outputDirectoryRepoPath}/candidate-profile.json`,
    value: {
      runId: RUN_ID,
      epochId: EPOCH_ID,
      candidateId: "candidate-a",
      profileId: "profile:candidate-a",
    },
  });
  const fullTensor = await writeJson({
    projectRoot,
    repoPath: `${outputDirectoryRepoPath}/full-tensor.json`,
    value: {
      runId: RUN_ID,
      epochId: EPOCH_ID,
      candidateId: "candidate-a",
      tensorBasis: "same_chart_full_tensor",
    },
  });

  const tauSeconds = 1e-6;
  const boundComputed = boundFor(tauSeconds, theorem);
  const lhs =
    options.outcome === "no_candidate" ? boundComputed : -100;
  const margin = marginFor(lhs, boundComputed);
  const rawPath = `${outputDirectoryRepoPath}/raw-evaluation.json`;
  const quadraturePath = `${outputDirectoryRepoPath}/quadrature.json`;
  const evaluation: Nhm2QeiFeasibilityEvaluationInputV1 = {
    evaluationId: "qei:wall-a:gaussian:1e-6",
    worldlineId: "wall-a",
    samplingFamilyId: "gaussian",
    theoremId: theorem.theoremId,
    tauSeconds,
    samplingNormalized: true,
    lhs_Jm3: lhs,
    boundComputed_Jm3: boundComputed,
    boundPolicy_Jm3: boundComputed,
    marginRawComputed: margin,
    marginPolicy: margin,
    applicabilityStatus: "PASS",
    tauConsistency: {
      tauVsDuty: "pass",
      tauVsLightCrossing: "pass",
      tauVsModulation: "pass",
    },
    metricSemanticBinding: {
      rhoSource: "warp.metric.T00.natario_sdf.shift",
      metricT00Ref: "warp.metric.T00.natario_sdf.shift",
      metricT00Si_Jm3: -1e6,
      metricDerived: true,
      metricContractOk: true,
      sameEpoch: true,
      quantitySemanticType: "ren_expectation_timelike_energy_density",
      worldlineClass: "timelike",
      dutyAppliedToMetricT00: false,
    },
    policyEvidence: {
      boundFloorApplied: false,
      policyOrFloorUsedAsIndependentAdmissionAuthority: false,
    },
    evidenceOrigin: "run_bound_evaluation",
    rawEvaluationEvidence: runBinding(rawPath, "0".repeat(64)),
    quadratureEvidence: runBinding(quadraturePath, "0".repeat(64)),
    binding: {
      runId: RUN_ID,
      epochId: EPOCH_ID,
      profileSha256: profile.sha256,
      fullTensorSha256: fullTensor.sha256,
      qftStateSha256: qftState.sha256,
      continuousObserverSha256: continuousObserver.sha256,
      worldlineSetSha256: worldlineSet.sha256,
      samplingFamilySetSha256: samplingFamilySet.sha256,
      theoremSetSha256: theoremSet.sha256,
    },
  };
  const raw = await writeJson({
    projectRoot,
    repoPath: rawPath,
    value: rawEvaluationArtifact({
      evaluation,
      mutate: options.mutateRaw,
    }),
  });
  evaluation.rawEvaluationEvidence.sha256 = raw.sha256;
  const quadratureValue: Record<string, unknown> = {
    artifactId: "nhm2_qei_quadrature",
    schemaVersion: "nhm2_qei_quadrature/v1",
    runId: RUN_ID,
    epochId: EPOCH_ID,
    candidateId: "candidate-a",
    evaluationId: evaluation.evaluationId,
    worldlineId: evaluation.worldlineId,
    samplingFamilyId: evaluation.samplingFamilyId,
    theoremId: evaluation.theoremId,
    tauSeconds: evaluation.tauSeconds,
    samplingNormalized: evaluation.samplingNormalized,
    lhs_Jm3: evaluation.lhs_Jm3,
    metricT00Si_Jm3: evaluation.metricSemanticBinding.metricT00Si_Jm3,
    rawEvaluationSha256: raw.sha256,
    theoremSetSha256: theoremSet.sha256,
    quadratureMethod: "normalized-weighted-sum",
    sampleCount: 2,
    converged: true,
    estimatedAbsoluteError_Jm3: 1e-9,
    normalizationIntegral: 1,
    normalizationTolerance: 1e-12,
    properTimeSeconds: [0, evaluation.tauSeconds],
    normalizedWeights: [0.5, 0.5],
    sampledEnergyDensity_Jm3: [evaluation.lhs_Jm3, evaluation.lhs_Jm3],
    binding: evaluation.binding,
  };
  options.mutateQuadrature?.(quadratureValue);
  const quadrature = await writeJson({
    projectRoot,
    repoPath: quadraturePath,
    value: quadratureValue,
  });
  evaluation.quadratureEvidence.sha256 = quadrature.sha256;

  const after = await snapshotTheoryRuntimeOutput({
    projectRoot,
    outputDirectory,
  });
  const entries = classifyTheoryRuntimeArtifacts({ before, after });
  const manifest = await writeTheoryRuntimeOutputManifest({
    projectRoot,
    outputDirectory,
    requestId: REQUEST_ID,
    runtimeId,
    gitSha: GIT_SHA,
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    generatedAt: COMPLETED_AT,
    entries,
    freshnessProof: buildTheoryRuntimeFreshnessProof({
      before,
      after,
      beforeCapturedAt: STARTED_AT,
      afterCapturedAt: COMPLETED_AT,
      beforeCommitmentPath: beforeCommitment.path,
      beforeCommitmentSha256: beforeCommitment.sha256,
    }),
  });
  const receipt = buildTheoryRuntimeReceiptV1({
    generatedAt: COMPLETED_AT,
    receiptId: "qei-frontier-receipt-237",
    runtimeId,
    graphId: "nhm2-theory-badge-graph",
    badgeIds: ["nhm2.qei.feasibility_frontier"],
    command: "npm run nhm2:qei:frontier:producer",
    args: {
      requestId: REQUEST_ID,
      runId: RUN_ID,
      epochId: options.runtimeEpochMismatch ? "stale-epoch" : EPOCH_ID,
    },
    status: "completed",
    outputs: {
      artifacts: entries.map((entry) => entry.path),
      scalars: {},
      units: {},
      gates: { runtime_artifact_freshness: "pass" },
      missingSignals: [],
      warnings: [],
      artifactManifest: manifest,
    },
    provenance: {
      gitSha: GIT_SHA,
      startedAt: STARTED_AT,
      completedAt: COMPLETED_AT,
      durationMs: 1_000,
    },
    execution: {
      command: "npm run nhm2:qei:frontier:producer",
      args: [],
      cwd: projectRoot,
      environment: {},
      outputDirectory: outputDirectoryRepoPath,
      outputDirectoryBound: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      error: null,
    },
    claimBoundary: {
      currentTier: "diagnostic",
      maximumTier: "reduced_order",
      promotionAllowed: false,
      promotionBlockedBy: ["empirical_receipts_missing"],
    },
  });
  const persistedReceipt = await writeJson({
    projectRoot,
    repoPath: `artifacts/research/theory-runtime-receipts/receipt-${"A".repeat(43)}.v1.json`,
    value: receipt,
  });

  const input: BuildNhm2QeiFeasibilityFrontierInputV1 = {
    generatedAt: COMPLETED_AT,
    provenance: {
      run: {
        runId: RUN_ID,
        commitSha: GIT_SHA,
        epochId: EPOCH_ID,
        startedAt: STARTED_AT,
        completedAt: COMPLETED_AT,
      },
      runManifest: runBinding(runManifest.repoPath, runManifest.sha256),
      runtimeReceipt: runBinding(
        persistedReceipt.repoPath,
        persistedReceipt.sha256,
      ),
      qftState: {
        ...runBinding(qftState.repoPath, qftState.sha256),
        stateClass: "hadamard",
        renormalizationScheme: "point_splitting",
        operatorMapping: "t_munu_uu_ren",
      },
      continuousObserver: runBinding(
        continuousObserver.repoPath,
        continuousObserver.sha256,
      ),
      worldlineSet: runBinding(worldlineSet.repoPath, worldlineSet.sha256),
      samplingFamilySet: runBinding(
        samplingFamilySet.repoPath,
        samplingFamilySet.sha256,
      ),
      theoremSet: {
        artifactRef: theoremSet.repoPath,
        sha256: theoremSet.sha256,
      },
      historicalOrUnboundDossierUsed: false,
    },
    domain: {
      candidateIds: ["candidate-a"],
      worldlineIds: ["wall-a"],
      samplingFamilyIds: ["gaussian"],
      tauSeconds: [tauSeconds],
      finiteDomainDeclared: true,
      cartesianCoverageRequired: true,
    },
    theorems: [theorem],
    candidates: [
      {
        candidateId: "candidate-a",
        profile: {
          ...runBinding(profile.repoPath, profile.sha256),
          profileId: "profile:candidate-a",
        },
        fullTensor: {
          ...runBinding(fullTensor.repoPath, fullTensor.sha256),
          tensorBasis: "same_chart_full_tensor",
        },
        metricConstruction: {
          kind: "recomputed_full_tensor",
          dutyScaledMetricT00: false,
          directT00ScalingApplied: false,
        },
        readiness: {
          fullTensorReady: options.outcome !== "frontier_not_evaluable",
          covariantConservationReady: true,
          continuousObserverReady: true,
        },
        evaluations: [evaluation],
      },
    ],
  };
  const frontier = buildNhm2QeiFeasibilityFrontier(input);
  const frontierPath = `artifacts/qei-frontiers/${RUN_ID}/frontier.json`;
  await writeJson({ projectRoot, repoPath: frontierPath, value: frontier });
  return {
    projectRoot,
    frontierPath,
    frontier,
    rawPath,
    quadraturePath,
    runtimeReceiptPath: persistedReceipt.repoPath,
    qftStatePath: qftState.repoPath,
  };
}

describe("NHM2 QEI feasibility frontier filesystem evaluator", () => {
  it("verifies every run-bound artifact and keeps the result diagnostic-only", async () => {
    const fixture = await buildFixture();

    const result = await evaluateNhm2QeiFeasibilityFrontierFilesystem({
      projectRoot: fixture.projectRoot,
      frontierPath: fixture.frontierPath,
      frontier: fixture.frontier,
      verifyGitObjects: false,
    });

    expect(result).toMatchObject({
      evaluationStatus: "complete",
      verdict: "candidate_found",
      filesystemVerified: true,
      runtimeReceiptFilesystemVerified: true,
      blockers: [],
      closureAssessment: {
        finiteDeclaredDomainOutcome: "candidate_found",
        worldlineQeiClosureEstablished: false,
        universalNoGoEstablished: false,
      },
      claimBoundary: {
        cannotSatisfyWorldlineQeiClosure: true,
        physicalViabilityClaimAllowed: false,
        transportClaimAllowed: false,
        propulsionClaimAllowed: false,
        routeEtaClaimAllowed: false,
        certifiedSpeedClaimAllowed: false,
      },
    });
    expect(result.verifiedArtifacts.length).toBeGreaterThanOrEqual(12);
    expect(result.publicationEnvelope).toEqual({
      sourceFrontierExcludedFromProducerManifestToAvoidHashCycle: true,
      publicationEnvelopeNotRuntimeFreshnessReceipt: true,
      sourceFrontierAndRuntimeReceiptHashesCoBound: true,
    });
    const persistedReceipt = JSON.parse(
      await fs.readFile(
        path.join(
          fixture.projectRoot,
          ...fixture.runtimeReceiptPath.split("/"),
        ),
        "utf8",
      ),
    );
    expect(
      persistedReceipt.outputs.artifactManifest.entries.some(
        (entry: { path: string }) => entry.path === fixture.frontierPath,
      ),
    ).toBe(false);
  });

  it("treats a fully verified finite-domain negative as successful evaluation, not a universal no-go", async () => {
    const fixture = await buildFixture({ outcome: "no_candidate" });

    const result = await evaluateNhm2QeiFeasibilityFrontierFilesystem({
      projectRoot: fixture.projectRoot,
      frontierPath: fixture.frontierPath,
      frontier: fixture.frontier,
      verifyGitObjects: false,
    });

    expect(result).toMatchObject({
      evaluationStatus: "complete",
      verdict: "no_candidate_within_declared_domain",
      filesystemVerified: true,
      closureAssessment: { universalNoGoEstablished: false },
    });
  });

  it("keeps filesystem verification separate when the source frontier itself is not evaluable", async () => {
    const fixture = await buildFixture({ outcome: "frontier_not_evaluable" });

    const result = await evaluateNhm2QeiFeasibilityFrontierFilesystem({
      projectRoot: fixture.projectRoot,
      frontierPath: fixture.frontierPath,
      frontier: fixture.frontier,
      verifyGitObjects: false,
    });

    expect(result).toMatchObject({
      evaluationStatus: "not_evaluable",
      verdict: "frontier_not_evaluable",
      filesystemVerified: true,
      runtimeReceiptFilesystemVerified: true,
    });
    expect(result.blockers).toContain(
      "source_frontier:candidate:candidate-a:full_tensor_not_ready",
    );
  });

  it("rejects byte tampering even when the parsed frontier still carries the old self-asserted hash", async () => {
    const fixture = await buildFixture();
    await fs.writeFile(
      path.join(fixture.projectRoot, ...fixture.rawPath.split("/")),
      "{}\n",
      "utf8",
    );

    const result = await evaluateNhm2QeiFeasibilityFrontierFilesystem({
      projectRoot: fixture.projectRoot,
      frontierPath: fixture.frontierPath,
      frontier: fixture.frontier,
      verifyGitObjects: false,
    });

    expect(result.verdict).toBe("frontier_not_evaluable");
    expect(result.filesystemVerified).toBe(false);
    expect(
      result.blockers.some((blocker) =>
        blocker.includes("raw_evaluation:sha256_mismatch"),
      ),
    ).toBe(true);
  });

  it("checks raw scalar and identity content rather than accepting a correctly hashed lie", async () => {
    const fixture = await buildFixture({
      mutateRaw: (value) => {
        const evaluation = value.evaluation as Record<string, unknown>;
        evaluation.lhs_Jm3 = -1;
      },
    });

    const result = await evaluateNhm2QeiFeasibilityFrontierFilesystem({
      projectRoot: fixture.projectRoot,
      frontierPath: fixture.frontierPath,
      frontier: fixture.frontier,
      verifyGitObjects: false,
    });

    expect(result.verdict).toBe("frontier_not_evaluable");
    expect(result.blockers).toContain(
      "candidate:candidate-a:evaluation:qei:wall-a:gaussian:1e-6:raw_evaluation_content_mismatch",
    );
  });

  it("checks quadrature normalization and sampled lhs against the row", async () => {
    const fixture = await buildFixture({
      mutateQuadrature: (value) => {
        value.lhs_Jm3 = -1;
        value.normalizationIntegral = 0.5;
      },
    });

    const result = await evaluateNhm2QeiFeasibilityFrontierFilesystem({
      projectRoot: fixture.projectRoot,
      frontierPath: fixture.frontierPath,
      frontier: fixture.frontier,
      verifyGitObjects: false,
    });

    expect(result.verdict).toBe("frontier_not_evaluable");
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining("quadrature:lhs_mismatch"),
        expect.stringContaining("quadrature:normalization_not_verified"),
      ]),
    );
  });

  it("rejects quadrature scalar spoofing when arrays do not reproduce the claimed lhs", async () => {
    const fixture = await buildFixture({
      mutateQuadrature: (value) => {
        value.sampledEnergyDensity_Jm3 = [-1, -1];
      },
    });

    const result = await evaluateNhm2QeiFeasibilityFrontierFilesystem({
      projectRoot: fixture.projectRoot,
      frontierPath: fixture.frontierPath,
      frontier: fixture.frontier,
      verifyGitObjects: false,
    });

    expect(result.verdict).toBe("frontier_not_evaluable");
    expect(
      result.blockers.some((blocker) =>
        blocker.includes("quadrature:lhs_not_reproduced_from_samples"),
      ),
    ).toBe(true);
  });

  it("binds theorem-set bytes to the exact theorem rows", async () => {
    const fixture = await buildFixture({ theoremSetContentsMismatch: true });

    const result = await evaluateNhm2QeiFeasibilityFrontierFilesystem({
      projectRoot: fixture.projectRoot,
      frontierPath: fixture.frontierPath,
      frontier: fixture.frontier,
      verifyGitObjects: false,
    });

    expect(result.verdict).toBe("frontier_not_evaluable");
    expect(result.blockers).toContain("theorem_set:contents_mismatch");
  });

  it("binds the runtime receipt to the same run and epoch after filesystem replay", async () => {
    const fixture = await buildFixture({ runtimeEpochMismatch: true });

    const result = await evaluateNhm2QeiFeasibilityFrontierFilesystem({
      projectRoot: fixture.projectRoot,
      frontierPath: fixture.frontierPath,
      frontier: fixture.frontier,
      verifyGitObjects: false,
    });

    expect(result.runtimeReceiptFilesystemVerified).toBe(true);
    expect(result.filesystemVerified).toBe(false);
    expect(result.blockers).toContain("runtime_receipt:epoch_id_mismatch");
  });

  it("rejects a self-consistent fresh receipt from the wrong runtime", async () => {
    const fixture = await buildFixture({
      runtimeIdOverride: "nhm2.unrelated.runtime",
    });

    const result = await evaluateNhm2QeiFeasibilityFrontierFilesystem({
      projectRoot: fixture.projectRoot,
      frontierPath: fixture.frontierPath,
      frontier: fixture.frontier,
      verifyGitObjects: false,
    });

    expect(result.runtimeReceiptFilesystemVerified).toBe(true);
    expect(result.filesystemVerified).toBe(false);
    expect(result.blockers).toContain("runtime_receipt:runtime_id_mismatch");
  });

  it("requires every non-circular run-bound artifact in the fresh producer manifest", async () => {
    const fixture = await buildFixture({
      profileOutsideRuntimeManifest: true,
    });

    const result = await evaluateNhm2QeiFeasibilityFrontierFilesystem({
      projectRoot: fixture.projectRoot,
      frontierPath: fixture.frontierPath,
      frontier: fixture.frontier,
      verifyGitObjects: false,
    });

    expect(result.runtimeReceiptFilesystemVerified).toBe(true);
    expect(result.filesystemVerified).toBe(false);
    expect(
      result.blockers.some((blocker) =>
        blocker.includes(
          "runtime_manifest:run_bound_artifact_missing:candidate:candidate-a:profile",
        ),
      ),
    ).toBe(true);
  });

  it("rejects a producer directory that was nonempty before execution", async () => {
    const fixture = await buildFixture({ preexistingRuntimeOutput: true });

    const result = await evaluateNhm2QeiFeasibilityFrontierFilesystem({
      projectRoot: fixture.projectRoot,
      frontierPath: fixture.frontierPath,
      frontier: fixture.frontier,
      verifyGitObjects: false,
    });

    expect(result.runtimeReceiptFilesystemVerified).toBe(false);
    expect(result.blockers).toContain(
      "runtime_receipt_filesystem:runtime_output_directory_not_exclusive",
    );
  });

  it("fails closed on malformed source values without trusting their verdict", async () => {
    const fixture = await buildFixture();
    const malformed = {
      ...fixture.frontier,
      verdict: "candidate_found",
      claimBoundary: { physicalViabilityClaimAllowed: true },
    };

    const result = await evaluateNhm2QeiFeasibilityFrontierFilesystem({
      projectRoot: fixture.projectRoot,
      frontierPath: fixture.frontierPath,
      frontier: malformed,
      verifyGitObjects: false,
    });

    expect(result).toMatchObject({
      verdict: "frontier_not_evaluable",
      filesystemVerified: false,
      sourceFrontier: {
        contractValidated: false,
        sourceVerdict: null,
      },
    });
  });

  it("rejects absolute, traversal, latest-alias, and backslash paths", () => {
    expect(isPinnedNhm2QeiRepoPath("artifacts/run-237/result.json")).toBe(true);
    expect(isPinnedNhm2QeiRepoPath("C:/tmp/result.json")).toBe(false);
    expect(isPinnedNhm2QeiRepoPath("../result.json")).toBe(false);
    expect(isPinnedNhm2QeiRepoPath("artifacts/latest/result.json")).toBe(false);
    expect(isPinnedNhm2QeiRepoPath("artifacts\\run-237\\result.json")).toBe(false);
    expect(isPinnedNhm2QeiRunId("run-237")).toBe(true);
    expect(isPinnedNhm2QeiRunId("gr-agent-loop:237:0")).toBe(false);
  });

  it("refuses oversized source bytes before reading them", async () => {
    const fixture = await buildFixture();
    const absoluteFrontierPath = path.join(
      fixture.projectRoot,
      ...fixture.frontierPath.split("/"),
    );
    await fs.truncate(
      absoluteFrontierPath,
      NHM2_QEI_FEASIBILITY_MAX_BOUND_FILE_BYTES + 1,
    );

    await expect(
      readPinnedNhm2QeiJsonSource({
        projectRoot: fixture.projectRoot,
        artifactRef: fixture.frontierPath,
      }),
    ).rejects.toThrow(/file_too_large/);
    const result = await evaluateNhm2QeiFeasibilityFrontierFilesystem({
      projectRoot: fixture.projectRoot,
      frontierPath: fixture.frontierPath,
      frontier: fixture.frontier,
      verifyGitObjects: false,
    });
    expect(result.filesystemVerified).toBe(false);
    expect(
      result.blockers.some((blocker) =>
        blocker.includes("source_frontier:file_too_large"),
      ),
    ).toBe(true);
  });

  it("refuses an oversized bound artifact and skips the unbounded receipt replay", async () => {
    const fixture = await buildFixture();
    await fs.truncate(
      path.join(fixture.projectRoot, ...fixture.qftStatePath.split("/")),
      NHM2_QEI_FEASIBILITY_MAX_BOUND_FILE_BYTES + 1,
    );

    const result = await evaluateNhm2QeiFeasibilityFrontierFilesystem({
      projectRoot: fixture.projectRoot,
      frontierPath: fixture.frontierPath,
      frontier: fixture.frontier,
      verifyGitObjects: false,
    });

    expect(result.filesystemVerified).toBe(false);
    expect(result.runtimeReceiptFilesystemVerified).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining("qft_state:file_too_large"),
        "runtime_receipt_filesystem:skipped_due_oversize_bound_file",
      ]),
    );
  });

  it("refuses a symlink source before CLI-style JSON loading", async () => {
    const fixture = await buildFixture();
    const linkPath = `artifacts/qei-frontiers/${RUN_ID}/frontier-link.json`;
    const absoluteLink = path.join(
      fixture.projectRoot,
      ...linkPath.split("/"),
    );
    const absoluteTarget = path.join(
      fixture.projectRoot,
      ...fixture.frontierPath.split("/"),
    );
    try {
      await fs.symlink(absoluteTarget, absoluteLink, "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }

    await expect(
      readPinnedNhm2QeiJsonSource({
        projectRoot: fixture.projectRoot,
        artifactRef: linkPath,
      }),
    ).rejects.toThrow(/symlink_forbidden/);
    const result = await evaluateNhm2QeiFeasibilityFrontierFilesystem({
      projectRoot: fixture.projectRoot,
      frontierPath: linkPath,
      frontier: fixture.frontier,
      verifyGitObjects: false,
    });
    expect(result.filesystemVerified).toBe(false);
    expect(result.blockers).toContain(
      `source_frontier:symlink_forbidden:${linkPath}`,
    );
  });
});

describe("NHM2 QEI feasibility frontier evaluator CLI", () => {
  it("atomically writes the default run-specific report and exits zero for a finite-domain negative", async () => {
    const fixture = await buildFixture({ outcome: "no_candidate" });

    const result = await runNhm2QeiFeasibilityFrontierCli({
      argv: ["--frontier", fixture.frontierPath],
      projectRoot: fixture.projectRoot,
      verifyGitObjects: false,
    });

    expect(result.exitCode).toBe(0);
    expect(result.outputPath).toBe(
      `artifacts/research/full-solve/qei-feasibility-frontier-runs/${RUN_ID}/qei-feasibility-frontier-evaluation.json`,
    );
    const disk = JSON.parse(
      await fs.readFile(
        path.join(fixture.projectRoot, ...result.outputPath.split("/")),
        "utf8",
      ),
    );
    expect(disk).toEqual(result.evaluation);
    expect(disk.verdict).toBe("no_candidate_within_declared_domain");
  });

  it("returns exit two only for frontier_not_evaluable", async () => {
    const fixture = await buildFixture({ outcome: "frontier_not_evaluable" });

    const result = await runNhm2QeiFeasibilityFrontierCli({
      argv: ["--frontier", fixture.frontierPath],
      projectRoot: fixture.projectRoot,
      verifyGitObjects: false,
    });

    expect(result.exitCode).toBe(2);
    expect(result.evaluation.filesystemVerified).toBe(true);
  });

  it("publishes immutably and refuses to overwrite a prior run envelope", async () => {
    const fixture = await buildFixture();
    const first = await runNhm2QeiFeasibilityFrontierCli({
      argv: ["--frontier", fixture.frontierPath],
      projectRoot: fixture.projectRoot,
      verifyGitObjects: false,
    });
    const absoluteOutput = path.join(
      fixture.projectRoot,
      ...first.outputPath.split("/"),
    );
    const before = await fs.readFile(absoluteOutput);

    await expect(
      runNhm2QeiFeasibilityFrontierCli({
        argv: ["--frontier", fixture.frontierPath],
        projectRoot: fixture.projectRoot,
        verifyGitObjects: false,
      }),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await fs.readFile(absoluteOutput)).toEqual(before);
  });

  it("treats malformed or escaping invocation arguments as errors", () => {
    expect(() => parseNhm2QeiFeasibilityFrontierCliArgs([])).toThrow(
      /--frontier/,
    );
    expect(() =>
      parseNhm2QeiFeasibilityFrontierCliArgs([
        "--frontier",
        "artifacts/frontier.json",
        "--output",
        "../escape.json",
      ]),
    ).toThrow(/--output/);
    expect(() =>
      parseNhm2QeiFeasibilityFrontierCliArgs(["--unknown"]),
    ).toThrow(/Unknown argument/);
  });

  it("rejects an output override outside the source run's evaluation directory", async () => {
    const fixture = await buildFixture();

    await expect(
      runNhm2QeiFeasibilityFrontierCli({
        argv: [
          "--frontier",
          fixture.frontierPath,
          "--output",
          "artifacts/research/full-solve/qei-feasibility-frontier-runs/238/evaluation.json",
        ],
        projectRoot: fixture.projectRoot,
        verifyGitObjects: false,
      }),
    ).rejects.toThrow(/pinned run directory/);
  });

  it("refuses a symlinked publication-root ancestor", async () => {
    const fixture = await buildFixture();
    const outside = await fs.mkdtemp(
      path.join(os.tmpdir(), "nhm2-qei-envelope-escape-"),
    );
    roots.push(outside);
    const parent = path.join(
      fixture.projectRoot,
      "artifacts",
      "research",
      "full-solve",
    );
    const link = path.join(parent, "qei-feasibility-frontier-runs");
    await fs.mkdir(parent, { recursive: true });
    try {
      await fs.symlink(
        outside,
        link,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }

    await expect(
      runNhm2QeiFeasibilityFrontierCli({
        argv: ["--frontier", fixture.frontierPath],
        projectRoot: fixture.projectRoot,
        verifyGitObjects: false,
      }),
    ).rejects.toThrow(/symlink ancestor/);
    expect(await fs.readdir(outside)).toEqual([]);
  });
});
