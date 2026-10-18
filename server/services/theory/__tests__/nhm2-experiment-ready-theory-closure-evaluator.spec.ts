import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildNhm2ContinuousObserverOptimizer } from "../../../../shared/contracts/nhm2-continuous-observer-optimizer.v1";
import { buildNhm2CovariantConservation } from "../../../../shared/contracts/nhm2-covariant-conservation.v1";
import { buildNhm2DynamicBackreactionStabilityCausality } from "../../../../shared/contracts/nhm2-dynamic-backreaction-stability-causality.v1";
import {
  NHM2_INDEPENDENT_NUMERICAL_REPLICATION_SERVER_REPLAY_BLOCKERS,
  buildNhm2IndependentNumericalReplication,
} from "../../../../shared/contracts/nhm2-independent-numerical-replication.v1";
import {
  NHM2_EXPERIMENT_READY_THEORY_CANDIDATE_MANIFEST_EXECUTION_PLAN_ROLES,
  NHM2_EXPERIMENT_READY_THEORY_CANDIDATE_NUMERIC_POLICY_SET_ARTIFACT_ID,
  NHM2_EXPERIMENT_READY_THEORY_CANDIDATE_NUMERIC_POLICY_SET_CONTRACT_VERSION,
  buildNhm2ExperimentReadyTheoryCandidateManifest,
  buildNhm2ExperimentReadyTheoryCandidateNumericPolicySetArtifact,
  computeNhm2ExperimentReadyTheoryCandidateNonNumericCheckPolicySha256,
  computeNhm2ExperimentReadyTheoryCandidateNumericPolicyEntrySha256,
  nhm2ExperimentReadyTheoryFormalRunSpecPath,
  nhm2ExperimentReadyTheoryCandidateReceiptIdForRequest,
  type Nhm2ExperimentReadyTheoryCandidateBindingsV1,
  type Nhm2ExperimentReadyTheoryCandidateEvidenceRole,
  type Nhm2ExperimentReadyTheoryCandidateExecutionPlanRole,
  type Nhm2ExperimentReadyTheoryCandidateExecutionPlanV1,
  type Nhm2ExperimentReadyTheoryCandidateHashedBindingV1,
} from "../../../../shared/contracts/nhm2-experiment-ready-theory-candidate-manifest.v1";
import {
  NHM2_EXPERIMENT_READY_THEORY_CLOSURE_EVIDENCE_CONTRACT_VERSIONS,
  NHM2_EXPERIMENT_READY_THEORY_CLOSURE_EVIDENCE_IDS,
  NHM2_EXPERIMENT_READY_THEORY_CLOSURE_NUMERIC_CHECK_POLICIES,
  NHM2_EXPERIMENT_READY_THEORY_CLOSURE_REQUIRED_CHECKS,
  buildNhm2ExperimentReadyTheoryClosure,
  type Nhm2ExperimentReadyTheoryClosureAssurance,
  type Nhm2ExperimentReadyTheoryClosureCandidateIdentityV1,
  type Nhm2ExperimentReadyTheoryClosureEvidenceId,
  type Nhm2ExperimentReadyTheoryClosureEvidenceV1,
} from "../../../../shared/contracts/nhm2-experiment-ready-theory-closure.v1";
import {
  buildNhm2PredictionFalsifierFreeze,
  type Nhm2PredictionFreezeCandidateRegistrationBindingV1,
} from "../../../../shared/contracts/nhm2-prediction-falsifier-freeze.v1";
import { buildNhm2SemiclassicalStateRealizabilityV2 as buildNhm2SemiclassicalStateRealizability } from "../../../../shared/contracts/nhm2-semiclassical-state-realizability.v2";
import { buildNhm2WorldlineQeiCoverage } from "../../../../shared/contracts/nhm2-worldline-qei-coverage.v1";
import {
  buildTheoryRuntimeReceiptV1,
  type TheoryRuntimeReceiptV1,
} from "../../../../shared/contracts/theory-runtime-receipt.v1";
import {
  buildTheoryRuntimeFreshnessProof,
  classifyTheoryRuntimeArtifacts,
  snapshotTheoryRuntimeOutput,
  writeTheoryRuntimeOutputManifest,
  writeTheoryRuntimePreSpawnSnapshotCommitment,
} from "../runtime-artifact-manifest";
import {
  NHM2_FORMAL_OUTER_OBSERVATION_CHECK_IDS,
  buildNhm2FormalOuterObservationEvidence,
} from "../nhm2-formal-outer-observation-evidence-adapter";
import {
  NHM2_FORMAL_KERNEL_AXIOM_TRANSCRIPT_MARKER,
  NHM2_FORMAL_KERNEL_REQUIRED_THEOREM_NAME,
  NHM2_FORMAL_KERNEL_THEOREM_TRANSCRIPT_MARKER,
  computeNhm2FormalKernelLedgerSha256,
  type Nhm2FormalKernelExecutionObservationV1,
  type Nhm2FormalKernelLedgerKind,
  type Nhm2FormalKernelSealedLedgerV1,
} from "../nhm2-formal-kernel-executor";
import { writeTheoryRuntimeReceiptArtifact } from "../theory-runtime-receipt-store";
import {
  NHM2_SEMICLASSICAL_V2_SERVER_CONTENT_REPLAY_BLOCKER,
  evaluateNhm2ExperimentReadyTheoryClosureFilesystem,
  nhm2SemiclassicalV2AuthorityBlockers,
  theoryRuntimeReceiptContainsProducerInterval,
} from "../nhm2-experiment-ready-theory-closure-evaluator";
import {
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_EXECUTION_ARTIFACT_ID,
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_EXECUTION_CONTRACT_VERSION,
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_OUTER_FILENAME,
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_ARTIFACT_ID,
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_CONTRACT_VERSION,
  type Nhm2ExperimentReadyTheoryFormalExecutionArtifactV1,
  type Nhm2ExperimentReadyTheoryFormalRunSpecV1,
} from "../../../../tools/nhm2/run-experiment-ready-theory-formal";

const GENERATED_AT = "2099-07-19T11:58:00.000Z";
const FROZEN_AT = "2099-07-19T11:59:00.000Z";
const RUNTIME_ID = "nhm2.shift_lapse.alpha_sweep";
const CANDIDATE_ID = "nhm2-alpha07-constructibility-candidate-v1";
const SELECTED_PROFILE_ID = "stage1_centerline_alpha_0p7000_candidate_v1";
const CHART_ID = "nhm2-asymptotic-cartesian-v1";
const ATLAS_ID = "nhm2-alpha07-atlas-v1";
const UNITS_ID = "nhm2-si-stress-energy-v1";
const NORMALIZATION_ID = "nhm2-full-apparatus-normalization-v1";
const MANIFEST_ID = "nhm2-alpha07-constructibility-manifest-v1";
const CANDIDATE_MANIFEST_PATH =
  "artifacts/nhm2/theory-candidate/constructibility-candidate-manifest.v1.json";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

const normalizeRepoPath = (value: string): string => value.replace(/\\/g, "/");

const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

describe("NHM2 semiclassical v2 evaluator authority", () => {
  const dynamicEvidence = {
    artifactPath: "artifacts/run/dynamic-evidence.v1.json",
    sha256: "a".repeat(64),
  };
  const boundReference = {
    ref: `${dynamicEvidence.artifactPath}#stochastic-response`,
    sha256: `sha256:${dynamicEvidence.sha256}`,
  };

  it("binds both stochastic-response references and still requires server content replay", () => {
    const blockers = nhm2SemiclassicalV2AuthorityBlockers({
      metricResponseEvidence: boundReference,
      stabilityEvidence: boundReference,
      dynamicEvidence,
    });

    expect(blockers).toEqual([
      NHM2_SEMICLASSICAL_V2_SERVER_CONTENT_REPLAY_BLOCKER,
    ]);
  });

  it("rejects either v2 stochastic-response reference when it is not the registered dynamic evidence", () => {
    const blockers = nhm2SemiclassicalV2AuthorityBlockers({
      metricResponseEvidence: {
        ref: "artifacts/run/unbound-metric-response.json",
        sha256: "b".repeat(64),
      },
      stabilityEvidence: {
        ref: "artifacts/run/unbound-stability.json",
        sha256: "c".repeat(64),
      },
      dynamicEvidence,
    });

    expect(blockers).toEqual(
      expect.arrayContaining([
        NHM2_SEMICLASSICAL_V2_SERVER_CONTENT_REPLAY_BLOCKER,
        "semiclassical_state_noise_kernel_metric_response_dynamic_binding_mismatch",
        "semiclassical_state_noise_kernel_stability_dynamic_binding_mismatch",
      ]),
    );
  });
});

const populatedForwardReceiptOrOutputHashes = (
  value: unknown,
  parentPath = "",
): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      populatedForwardReceiptOrOutputHashes(entry, `${parentPath}[${index}]`),
    );
  }
  if (value == null || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, entry]) => {
      const fieldPath = parentPath.length > 0 ? `${parentPath}.${key}` : key;
      const lowerKey = key.toLowerCase();
      const parentBindsForwardArtifact =
        /(?:^|\.)(?:receipt|receiptartifact|outputmanifest)(?:\.|$)/i.test(
          parentPath,
        );
      const populatedForwardHash =
        typeof entry === "string" &&
        entry.length > 0 &&
        (lowerKey === "receiptsha256" ||
          lowerKey === "outputmanifestsha256" ||
          (lowerKey === "sha256" && parentBindsForwardArtifact));
      return [
        ...(populatedForwardHash ? [fieldPath] : []),
        ...populatedForwardReceiptOrOutputHashes(entry, fieldPath),
      ];
    },
  );
};

const jsonBytes = (value: unknown): Buffer =>
  Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");

async function writeJson(input: {
  projectRoot: string;
  repoPath: string;
  value: unknown;
}): Promise<{ path: string; sha256: string; sizeBytes: number }> {
  const repoPath = normalizeRepoPath(input.repoPath);
  const absolutePath = path.join(input.projectRoot, ...repoPath.split("/"));
  const bytes = jsonBytes(input.value);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, bytes);
  return { path: repoPath, sha256: sha256(bytes), sizeBytes: bytes.length };
}

async function writeCanonicalJson(input: {
  projectRoot: string;
  repoPath: string;
  value: unknown;
}): Promise<{ path: string; sha256: string; sizeBytes: number }> {
  const repoPath = normalizeRepoPath(input.repoPath);
  const absolutePath = path.join(input.projectRoot, ...repoPath.split("/"));
  const bytes = Buffer.from(JSON.stringify(input.value), "utf8");
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, bytes);
  return { path: repoPath, sha256: sha256(bytes), sizeBytes: bytes.length };
}

const formalLedger = (
  kind: Nhm2FormalKernelLedgerKind,
  rootPath: string,
  entries: Nhm2FormalKernelSealedLedgerV1["entries"],
): Nhm2FormalKernelSealedLedgerV1 => ({
  kind,
  rootPath,
  entries,
  ledgerSha256: computeNhm2FormalKernelLedgerSha256({ kind, entries }),
});

const formalReplayOutputInventorySha256 = (
  entries: readonly {
    relativePath: string;
    sha256: string;
    sizeBytes: number;
  }[],
): string =>
  sha256(
    JSON.stringify({
      domain: "nhm2_formal_kernel_output_inventory/v1",
      entries: entries.map((entry) => ({
        relativePath: entry.relativePath,
        sha256: entry.sha256,
        sizeBytes: entry.sizeBytes,
      })),
    }),
  );

const formalOuterInventorySha256 = (
  entries: readonly { path: string; sha256: string; sizeBytes: number }[],
): string =>
  sha256(
    `nhm2_formal_outer_inventory/v1\0${JSON.stringify(
      entries.map((entry) => [entry.path, entry.sha256, entry.sizeBytes]),
    )}`,
  );

async function writeFormalV2Outputs(input: {
  projectRoot: string;
  candidateManifest: ReturnType<
    typeof buildNhm2ExperimentReadyTheoryCandidateManifest
  >;
  candidateManifestWritten: {
    path: string;
    sha256: string;
    sizeBytes: number;
  };
  plan: Nhm2ExperimentReadyTheoryCandidateExecutionPlanV1;
  startedAt: string;
  completedAt: string;
  evidencePath: string;
}): Promise<{ path: string; sha256: string; sizeBytes: number }> {
  const outputRoot = path.join(
    input.projectRoot,
    ...input.plan.expectedInvocation.outputDirectory.split("/"),
  );
  const sourceRoot = path.join(input.projectRoot, "formal-sealed-source");
  const toolchainRoot = path.join(input.projectRoot, "formal-sealed-toolchain");
  const inputRoot = path.join(input.projectRoot, "formal-sealed-input");
  const replayOne = path.join(outputRoot, "replay-one");
  const replayTwo = path.join(outputRoot, "replay-two");
  const sourceEntries = [
    "ExperimentReadyReplayDriver.lean",
    "NHM2Formal.lean",
    "NHM2Formal/ClaimBoundary.lean",
    "NHM2Formal/ExperimentReadyClaimLocks.lean",
    "lakefile.lean",
    "lean-toolchain",
  ]
    .sort()
    .map((relativePath, index) => ({
      relativePath,
      sha256: sha256(`formal-source-${index}`),
      sizeBytes: 100 + index,
    }));
  const sourceLedger = formalLedger("source", sourceRoot, sourceEntries);
  const toolchainEntries = [
    { relativePath: "bin/lake.exe", sha256: sha256("lake"), sizeBytes: 2_000 },
    { relativePath: "bin/lean.exe", sha256: sha256("lean"), sizeBytes: 3_000 },
  ];
  const toolchainLedger = formalLedger(
    "toolchain",
    toolchainRoot,
    toolchainEntries,
  );
  const inputLedger = formalLedger("input", inputRoot, [
    {
      relativePath: input.candidateManifestWritten.path,
      sha256: input.candidateManifestWritten.sha256,
      sizeBytes: input.candidateManifestWritten.sizeBytes,
    },
  ]);
  const sourceRoleByPath = {
    "lakefile.lean": "lakefile",
    "lean-toolchain": "lean_toolchain",
    "NHM2Formal.lean": "root_module",
    "NHM2Formal/ClaimBoundary.lean": "claim_boundary",
    "NHM2Formal/ExperimentReadyClaimLocks.lean": "experiment_ready_claim_locks",
    "ExperimentReadyReplayDriver.lean": "replay_driver",
  } as const;
  const identity = {
    candidateId: input.candidateManifest.bindings.candidate.candidateId,
    candidateManifestId: input.candidateManifest.manifestId,
    candidateManifestSha256: input.candidateManifestWritten.sha256,
    candidateFrozenAt: input.candidateManifest.frozenAt,
    requestId: input.plan.requestId,
    runId: input.plan.runId,
    receiptId: input.plan.receiptId,
    runtimeId: input.plan.runtimeId,
    sourceCommitSha: input.plan.sourceCommitSha,
  };
  const claimBoundary = {
    formalLogicReplayOnly: true,
    outerObservedExecutionOnly: true,
    numericalPhysicsValidated: false,
    empiricalValidationEstablished: false,
    experimentReadyTheoryClosureClaimAllowed: false,
    physicalViabilityClaimAllowed: false,
    transportClaimAllowed: false,
    propulsionClaimAllowed: false,
    routeEtaClaimAllowed: false,
    speedAuthorityClaimAllowed: false,
  } as const;
  const driverPath = path.join(sourceRoot, "ExperimentReadyReplayDriver.lean");
  const leanPath = path.join(toolchainRoot, "bin", "lean.exe");
  const lakePath = path.join(toolchainRoot, "bin", "lake.exe");
  const driverEntry = sourceEntries.find(
    (entry) => entry.relativePath === "ExperimentReadyReplayDriver.lean",
  )!;
  const formalRunSpecPath = nhm2ExperimentReadyTheoryFormalRunSpecPath({
    outputDirectory: input.plan.expectedInvocation.outputDirectory,
    runId: input.plan.runId,
  });
  const spec: Nhm2ExperimentReadyTheoryFormalRunSpecV1 = {
    artifactId: NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_ARTIFACT_ID,
    contractVersion:
      NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_CONTRACT_VERSION,
    generatedAt: "2099-07-19T11:59:10.000Z",
    sealedAt: "2099-07-19T11:59:30.000Z",
    identity,
    planBinding: structuredClone(input.plan),
    theoremName: NHM2_FORMAL_KERNEL_REQUIRED_THEOREM_NAME,
    formalSourceBindings: {
      authority: "server_owned_formal_project",
      projectRoot: sourceRoot,
      entries: sourceEntries.map((entry) => ({
        sourceRole:
          sourceRoleByPath[entry.relativePath as keyof typeof sourceRoleByPath],
        path: path.join(sourceRoot, ...entry.relativePath.split("/")),
        sha256: entry.sha256,
        sizeBytes: entry.sizeBytes,
      })),
    },
    toolchainBindings: {
      authority: "sealed_lean_toolchain",
      toolchainRoot,
      entries: [
        {
          toolchainRole: "lake_executable",
          path: lakePath,
          sha256: toolchainEntries[0].sha256,
          sizeBytes: toolchainEntries[0].sizeBytes,
        },
        {
          toolchainRole: "lean_executable",
          path: leanPath,
          sha256: toolchainEntries[1].sha256,
          sizeBytes: toolchainEntries[1].sizeBytes,
        },
      ],
    },
    executor: {
      theoremName: NHM2_FORMAL_KERNEL_REQUIRED_THEOREM_NAME,
      executableRole: "lean",
      executables: {
        lean: {
          absolutePath: leanPath,
          sha256: toolchainEntries[1].sha256,
          sizeBytes: toolchainEntries[1].sizeBytes,
        },
        lake: {
          absolutePath: lakePath,
          sha256: toolchainEntries[0].sha256,
          sizeBytes: toolchainEntries[0].sizeBytes,
        },
      },
      ledgers: {
        source: sourceLedger,
        toolchain: toolchainLedger,
        input: inputLedger,
      },
      outputRoot,
      replayWorkdirs: [replayOne, replayTwo],
      environmentAllowlist: ["LEAN_PATH"],
      environment: { LEAN_PATH: sourceRoot },
      executableArguments: [driverPath, "-o", "proof.olean"],
      expectedOutputPaths: ["proof.olean"],
      timeoutMs: 60_000,
      maxCapturedOutputBytes: 1_048_576,
    },
    outerArtifactPath: `${input.plan.expectedInvocation.outputDirectory}/${NHM2_EXPERIMENT_READY_THEORY_FORMAL_OUTER_FILENAME}`,
    claimBoundary,
  };
  const specWritten = await writeCanonicalJson({
    projectRoot: input.projectRoot,
    repoPath: formalRunSpecPath,
    value: spec,
  });

  const receiptStartMs = Date.parse(input.startedAt);
  const replayOneStartedAt = new Date(receiptStartMs + 100).toISOString();
  const replayOneCompletedAt = new Date(receiptStartMs + 300).toISOString();
  const replayTwoStartedAt = new Date(receiptStartMs + 400).toISOString();
  const replayTwoCompletedAt = new Date(receiptStartMs + 600).toISOString();
  const observedAt = new Date(receiptStartMs + 700).toISOString();
  const stdout = `${NHM2_FORMAL_KERNEL_THEOREM_TRANSCRIPT_MARKER}\n${NHM2_FORMAL_KERNEL_AXIOM_TRANSCRIPT_MARKER}\n`;
  const oleanBytes = Buffer.from("nhm2-formal-v2-olean", "utf8");
  const outputSha256 = sha256(oleanBytes);
  const ledgerObservation = (kind: Nhm2FormalKernelLedgerKind) => ({
    kind,
    observedAt: replayOneStartedAt,
    ledgerSha256: spec.executor.ledgers[kind].ledgerSha256,
    entryCount: spec.executor.ledgers[kind].entries.length,
    entries: structuredClone(spec.executor.ledgers[kind].entries),
  });
  const replay = (
    replayIndex: 1 | 2,
    cwd: string,
    startedAt: string,
    completedAt: string,
  ) => {
    const output = {
      relativePath: "proof.olean",
      sha256: outputSha256,
      sizeBytes: oleanBytes.byteLength,
      modifiedAt: completedAt,
      freshness: "new" as const,
    };
    return {
      replayIndex,
      executableRole: "lean" as const,
      process: {
        executableRole: "lean" as const,
        command: leanPath,
        args: [...spec.executor.executableArguments],
        cwd,
        environment: { ...spec.executor.environment },
        startedAt,
        completedAt,
        durationMs: Date.parse(completedAt) - Date.parse(startedAt),
        exitCode: 0,
        signal: null,
        stdout,
        stderr: "",
        stdoutSha256: sha256(stdout),
        stderrSha256: sha256(""),
        stdoutBytes: Buffer.byteLength(stdout, "utf8"),
        stderrBytes: 0,
        timedOut: false,
        outputLimitExceeded: false,
        spawnError: null,
      },
      transcript: {
        theoremMarker: NHM2_FORMAL_KERNEL_THEOREM_TRANSCRIPT_MARKER,
        axiomMarker: NHM2_FORMAL_KERNEL_AXIOM_TRANSCRIPT_MARKER,
      },
      outputInventorySha256: formalReplayOutputInventorySha256([output]),
      outputs: [output],
      postRunLedgers: {
        source: ledgerObservation("source"),
        toolchain: ledgerObservation("toolchain"),
        input: ledgerObservation("input"),
      },
    };
  };
  const observation: Nhm2FormalKernelExecutionObservationV1 = {
    artifactId: "nhm2.formal_kernel_execution_observation",
    contractVersion: "nhm2_formal_kernel_execution_observation/v1",
    generatedAt: observedAt,
    theoremName: NHM2_FORMAL_KERNEL_REQUIRED_THEOREM_NAME,
    executableRole: "lean",
    status: "pass",
    executables: structuredClone(spec.executor.executables),
    preRunLedgers: {
      source: ledgerObservation("source"),
      toolchain: ledgerObservation("toolchain"),
      input: ledgerObservation("input"),
    },
    replays: [
      replay(1, replayOne, replayOneStartedAt, replayOneCompletedAt),
      replay(2, replayTwo, replayTwoStartedAt, replayTwoCompletedAt),
    ],
    replayAgreement: {
      executableRolesExact: true,
      commandsExact: true,
      environmentsExact: true,
      transcriptsExact: true,
      outputInventoriesExact: true,
      sealedLedgersStable: true,
    },
    claimBoundary: {
      formalLogicReplayOnly: true,
      numericalPhysicsValidated: false,
      empiricalValidationEstablished: false,
      physicalViabilityClaimAllowed: false,
      transportClaimAllowed: false,
      propulsionClaimAllowed: false,
      routeEtaClaimAllowed: false,
      speedAuthorityClaimAllowed: false,
      operatingSystemHermeticityAsserted: false,
      filesystemSandboxAsserted: false,
    },
  };
  const replayEntries = [
    {
      path: "replay-one/proof.olean",
      sha256: outputSha256,
      sizeBytes: oleanBytes.byteLength,
    },
    {
      path: "replay-two/proof.olean",
      sha256: outputSha256,
      sizeBytes: oleanBytes.byteLength,
    },
  ];
  const executionArtifact: Nhm2ExperimentReadyTheoryFormalExecutionArtifactV1 =
    {
      artifactId: NHM2_EXPERIMENT_READY_THEORY_FORMAL_EXECUTION_ARTIFACT_ID,
      contractVersion:
        NHM2_EXPERIMENT_READY_THEORY_FORMAL_EXECUTION_CONTRACT_VERSION,
      generatedAt: observedAt,
      identity,
      inputs: {
        candidateManifest: {
          path: input.candidateManifestWritten.path,
          sha256: input.candidateManifestWritten.sha256,
          sizeBytes: input.candidateManifestWritten.sizeBytes,
        },
        formalRunSpec: {
          path: specWritten.path,
          sha256: specWritten.sha256,
          sizeBytes: specWritten.sizeBytes,
        },
      },
      planRole: "formal_kernel",
      theoremName: NHM2_FORMAL_KERNEL_REQUIRED_THEOREM_NAME,
      replayOutputInventory: {
        algorithm: "sha256_canonical_tuple_list/v1",
        entries: replayEntries,
        inventorySha256: formalOuterInventorySha256(replayEntries),
      },
      executionObservation: observation,
      claimBoundary,
    };
  const trustedContext = {
    candidate: {
      candidateId: input.candidateManifest.bindings.candidate.candidateId,
      candidateManifestId: input.candidateManifest.manifestId,
      candidateManifestPath: input.candidateManifestWritten.path,
      candidateManifestSha256: input.candidateManifestWritten.sha256,
      candidateManifestSizeBytes: input.candidateManifestWritten.sizeBytes,
      candidateFrozenAt: input.candidateManifest.frozenAt,
      claimBoundary: input.candidateManifest.claimBoundary,
    },
    formalPlan: input.plan,
    formalRunSpec: {
      path: specWritten.path,
      sha256: specWritten.sha256,
      sizeBytes: specWritten.sizeBytes,
      value: spec,
    },
  };
  const evidence = buildNhm2FormalOuterObservationEvidence({
    executionArtifact,
    executionObservation: observation,
    trustedContext,
  });
  expect(evidence.status, JSON.stringify(evidence, null, 2)).toBe("pass");

  await fs.mkdir(replayOne, { recursive: true });
  await fs.mkdir(replayTwo, { recursive: true });
  await fs.writeFile(path.join(replayOne, "proof.olean"), oleanBytes);
  await fs.writeFile(path.join(replayTwo, "proof.olean"), oleanBytes);
  await writeCanonicalJson({
    projectRoot: input.projectRoot,
    repoPath: `${input.plan.expectedInvocation.outputDirectory}/${NHM2_EXPERIMENT_READY_THEORY_FORMAL_OUTER_FILENAME}`,
    value: executionArtifact,
  });
  const evidenceWritten = await writeCanonicalJson({
    projectRoot: input.projectRoot,
    repoPath: input.evidencePath,
    value: evidence,
  });
  const outputMtime = new Date(receiptStartMs + 800);
  await Promise.all(
    [
      path.join(replayOne, "proof.olean"),
      path.join(replayTwo, "proof.olean"),
      path.join(outputRoot, NHM2_EXPERIMENT_READY_THEORY_FORMAL_OUTER_FILENAME),
      path.join(input.projectRoot, ...input.evidencePath.split("/")),
    ].map((entry) => fs.utimes(entry, outputMtime, outputMtime)),
  );
  expect(Date.parse(input.completedAt)).toBeGreaterThanOrEqual(
    outputMtime.getTime(),
  );
  expect(evidence.checks.map((entry) => entry.checkId)).toEqual([
    ...NHM2_FORMAL_OUTER_OBSERVATION_CHECK_IDS,
  ]);
  return evidenceWritten;
}

async function writeDescriptor(input: {
  projectRoot: string;
  artifactId: string;
  contractVersion: string;
  identity: Record<string, string>;
  additional?: Record<string, unknown>;
}): Promise<Nhm2ExperimentReadyTheoryCandidateHashedBindingV1> {
  const repoPath = `artifacts/nhm2/theory-candidate/inputs/${input.artifactId}.json`;
  const written = await writeJson({
    projectRoot: input.projectRoot,
    repoPath,
    value: {
      artifactId: input.artifactId,
      contractVersion: input.contractVersion,
      ...input.identity,
      ...input.additional,
    },
  });
  return {
    artifactId: input.artifactId,
    contractVersion: input.contractVersion,
    path: written.path,
    sha256: written.sha256,
  };
}

const planRoleForEvidence = (
  evidenceRole: Nhm2ExperimentReadyTheoryCandidateEvidenceRole,
): Nhm2ExperimentReadyTheoryCandidateExecutionPlanRole => {
  if (evidenceRole === "independent_numerical_replication") {
    return "independent_numerical";
  }
  if (evidenceRole === "formal_manifest_certificate") return "formal_kernel";
  return "primary_numerical";
};

const assuranceFor = (
  evidenceId: Nhm2ExperimentReadyTheoryClosureEvidenceId,
): Nhm2ExperimentReadyTheoryClosureAssurance => {
  if (evidenceId === "independent_numerical_replication") {
    return "independent_computation";
  }
  if (evidenceId === "formal_manifest_certificate") return "formal_proof";
  if (evidenceId === "prediction_falsifier_freeze") {
    return "frozen_prediction";
  }
  return "computed";
};

const commitForPlan = (
  role: Nhm2ExperimentReadyTheoryCandidateExecutionPlanRole,
): string =>
  ({
    primary_numerical: "a".repeat(40),
    independent_numerical: "b".repeat(40),
    formal_kernel: "c".repeat(40),
  })[role];

const buildEnvironment = (input: {
  bindings: Nhm2ExperimentReadyTheoryCandidateBindingsV1;
  outputDirectory: string;
  requestId: string;
  receiptId: string;
  runId: string;
}) => [
  {
    name: "NHM2_ATLAS_SHA256",
    valueKind: "literal" as const,
    value: input.bindings.atlas.sha256,
  },
  {
    name: "NHM2_CANDIDATE_ID",
    valueKind: "literal" as const,
    value: input.bindings.candidate.candidateId,
  },
  {
    name: "NHM2_CANDIDATE_MANIFEST_SHA256",
    valueKind: "candidate_manifest_raw_sha256" as const,
    value: null,
  },
  {
    name: "NHM2_CHART_ID",
    valueKind: "literal" as const,
    value: input.bindings.chart.chartId,
  },
  {
    name: "NHM2_NORMALIZATION_SHA256",
    valueKind: "literal" as const,
    value: input.bindings.normalization.sha256,
  },
  {
    name: "NHM2_OUTPUT_DIR",
    valueKind: "literal" as const,
    value: input.outputDirectory,
  },
  {
    name: "NHM2_RUN_ID",
    valueKind: "literal" as const,
    value: input.runId,
  },
  {
    name: "NHM2_SELECTED_PROFILE_ID",
    valueKind: "literal" as const,
    value: input.bindings.profile.selectedProfileId,
  },
  {
    name: "NHM2_UNITS_SHA256",
    valueKind: "literal" as const,
    value: input.bindings.units.sha256,
  },
  {
    name: "THEORY_RUNTIME_ID",
    valueKind: "literal" as const,
    value: RUNTIME_ID,
  },
  {
    name: "THEORY_RUNTIME_RECEIPT_ID",
    valueKind: "literal" as const,
    value: input.receiptId,
  },
  {
    name: "THEORY_RUNTIME_REQUEST_ID",
    valueKind: "literal" as const,
    value: input.requestId,
  },
];

async function buildExecutionPlans(input: {
  projectRoot: string;
  bindings: Nhm2ExperimentReadyTheoryCandidateBindingsV1;
}): Promise<Nhm2ExperimentReadyTheoryCandidateExecutionPlanV1[]> {
  const plans: Nhm2ExperimentReadyTheoryCandidateExecutionPlanV1[] = [];
  for (const role of NHM2_EXPERIMENT_READY_THEORY_CANDIDATE_MANIFEST_EXECUTION_PLAN_ROLES) {
    const requestId = `constructibility-${role}-request-v1`;
    const runId = `constructibility-${role}-run-v1`;
    const receiptId = nhm2ExperimentReadyTheoryCandidateReceiptIdForRequest(
      RUNTIME_ID,
      requestId,
    );
    const outputDirectory = `artifacts/nhm2/theory-candidate/runs/${runId}`;
    const implementationId = `casimirbot-${role}-implementation-v1`;
    const solverIdentity = {
      solverId: `nhm2-${role}-solver`,
      solverVersion: "1.0.0",
      implementationId,
    };
    const environmentIdentity = {
      environmentId: `nhm2-${role}-environment-v1`,
    };
    const solver = await writeDescriptor({
      projectRoot: input.projectRoot,
      artifactId: `nhm2.${role}_solver`,
      contractVersion: `nhm2_${role}_solver/v1`,
      identity: solverIdentity,
    });
    const environmentLock = await writeDescriptor({
      projectRoot: input.projectRoot,
      artifactId: `nhm2.${role}_environment`,
      contractVersion: `nhm2_${role}_environment/v1`,
      identity: environmentIdentity,
    });
    const npmScript = `nhm2:constructibility:${role}`;
    const formalRunSpecPath =
      role === "formal_kernel"
        ? nhm2ExperimentReadyTheoryFormalRunSpecPath({
            outputDirectory,
            runId,
          })
        : null;
    plans.push({
      planRole: role,
      requestId,
      runId,
      receiptId,
      runtimeId: RUNTIME_ID,
      sourceCommitSha: commitForPlan(role),
      deterministicSeedPolicy: `frozen-seed:${role}`,
      solver: { ...solver, ...solverIdentity },
      environmentLock: { ...environmentLock, ...environmentIdentity },
      expectedInvocation: {
        entrypoint: `npm run ${npmScript}`,
        command: "npm",
        args:
          formalRunSpecPath == null
            ? ["run", "-s", npmScript]
            : [
                "run",
                "-s",
                npmScript,
                "--",
                "--candidate-manifest",
                CANDIDATE_MANIFEST_PATH,
                "--formal-run-spec",
                formalRunSpecPath,
              ],
        cwd: ".",
        environment: buildEnvironment({
          bindings: input.bindings,
          outputDirectory,
          requestId,
          receiptId,
          runId,
        }),
        outputDirectory,
      },
    });
  }
  return plans;
}

function blockedPredictionArtifact(
  registrationBinding: Nhm2PredictionFreezeCandidateRegistrationBindingV1 = {
    candidateId: CANDIDATE_ID,
    candidateManifestPath:
      "artifacts/nhm2/theory-candidate/constructibility-candidate-manifest.v1.json",
    candidateManifestSha256: "f".repeat(64),
    runId: "constructibility-primary_numerical-run-v1",
    requestId: "constructibility-primary_numerical-request-v1",
    receiptId: nhm2ExperimentReadyTheoryCandidateReceiptIdForRequest(
      RUNTIME_ID,
      "constructibility-primary_numerical-request-v1",
    ),
    runtimeId: RUNTIME_ID,
    plannedOutputDirectory:
      "artifacts/nhm2/theory-candidate/runs/constructibility-primary_numerical-run-v1",
  },
) {
  return buildNhm2PredictionFalsifierFreeze({
    generatedAt: GENERATED_AT,
    frozenAt: "2099-07-19T11:57:00.000Z",
    dataCollectionOpensAt: "2099-07-19T13:00:00.000Z",
    selectedProfileId: SELECTED_PROFILE_ID,
    freezeId: "constructibility-prediction-freeze-v1",
    registrationBinding,
    model: {
      modelId: "nhm2-alpha07-model-v1",
      modelVersion: "1.0.0",
      solverId: "nhm2-primary-solver",
      solverVersion: "1.0.0",
      sourceCommitSha: "a".repeat(40),
      definitionRef: null,
      inputManifestRef: null,
    },
    parameterSet: {
      parameterSetId: "nhm2-alpha07-parameters-v1",
      parameterCount: 0,
      manifestRef: null,
    },
    observables: [],
    uncertaintyBudget: {
      uncertaintyBudgetId: "nhm2-alpha07-uncertainty-v1",
      method: "producer unavailable",
      coverageProbability: 0.95,
      sourceIds: [],
      observableIds: [],
      budgetRef: null,
      covarianceRef: null,
    },
    nullControlPlan: { controls: [], planRef: null },
    blindingPlan: {
      blindedFieldIds: [],
      unblindingTrigger: "not yet produced",
      keyCustodianRole: "independent custodian",
      analysisRole: "analysis",
      experimentRole: "experiment",
      planRef: null,
    },
    decisionPlan: {
      multiplicityMethod: "not yet produced",
      familywiseAlpha: 0.05,
      rules: [],
      planRef: null,
    },
    falsifierRegistry: { falsifiers: [], registryRef: null },
    registrationReceipts: [],
    analysisCode: {
      repository: "casimirbot/nhm2",
      sourceCommitSha: "a".repeat(40),
      entrypoint: "tools/nhm2/not-yet-produced.ts",
      deterministicSeedPolicy: "frozen seed required",
      sourceTreeRef: null,
      dependencyLockRef: null,
      environmentRef: null,
      protocolRef: null,
    },
    supersessionPolicy: {
      policyId: "nhm2-prediction-supersession-v1",
      policyRef: null,
    },
    freezeManifestRef: null,
  });
}

function rawEvidenceFor(
  evidenceId: Nhm2ExperimentReadyTheoryClosureEvidenceId,
  predictionRegistrationBinding?: Nhm2PredictionFreezeCandidateRegistrationBindingV1,
  historicalComputedRef?: { path: string; sha256: string },
  independentCrossRunContext?: {
    primaryRawOutput: {
      path: string;
      sha256: string;
      sizeBytes: number;
    };
    primaryPlan: Nhm2ExperimentReadyTheoryCandidateExecutionPlanV1;
    independentPlan: Nhm2ExperimentReadyTheoryCandidateExecutionPlanV1;
  },
  producerDeclaresIndependentPass = false,
): unknown {
  if (evidenceId === "semiclassical_state") {
    return buildNhm2SemiclassicalStateRealizability({
      generatedAt: GENERATED_AT,
      laneId: "nhm2_shift_lapse",
      selectedProfileId: SELECTED_PROFILE_ID,
    });
  }
  if (evidenceId === "covariant_conservation") {
    return buildNhm2CovariantConservation({ generatedAt: GENERATED_AT });
  }
  if (evidenceId === "continuous_observer_optimizer") {
    return buildNhm2ContinuousObserverOptimizer({ generatedAt: GENERATED_AT });
  }
  if (evidenceId === "worldline_qei") {
    return buildNhm2WorldlineQeiCoverage({ generatedAt: GENERATED_AT });
  }
  if (evidenceId === "dynamic_backreaction_stability_causality") {
    return buildNhm2DynamicBackreactionStabilityCausality({
      generatedAt: GENERATED_AT,
    });
  }
  if (evidenceId === "prediction_falsifier_freeze") {
    return blockedPredictionArtifact(predictionRegistrationBinding);
  }
  if (
    evidenceId === "independent_numerical_replication" &&
    independentCrossRunContext != null
  ) {
    const { primaryPlan, independentPlan, primaryRawOutput } =
      independentCrossRunContext;
    return {
      artifactId: evidenceId,
      contractVersion:
        NHM2_EXPERIMENT_READY_THEORY_CLOSURE_EVIDENCE_CONTRACT_VERSIONS[
          evidenceId
        ],
      identity: {
        primaryExecution: {
          receiptId: primaryPlan.receiptId,
          runId: primaryPlan.runId,
          runtimeId: primaryPlan.runtimeId,
        },
        independentPlan: {
          receiptId: independentPlan.receiptId,
          runId: independentPlan.runId,
          runtimeId: independentPlan.runtimeId,
        },
      },
      comparison: {
        fields: [
          {
            primaryRawOutput: {
              ...primaryRawOutput,
              dtype: "float64",
              shape: [4, 1],
              storageOrder: "row-major",
              componentOrder: ["rho_min"],
            },
          },
        ],
      },
      producerStatus: "cross_run_provenance_probe_only",
      claimBoundary: {
        physicalViabilityClaimAllowed: false,
        transportClaimAllowed: false,
      },
    };
  }
  if (
    evidenceId === "independent_numerical_replication" &&
    producerDeclaresIndependentPass
  ) {
    const metadataOnly = buildNhm2IndependentNumericalReplication({
      generatedAt: GENERATED_AT,
    });
    return {
      ...metadataOnly,
      checks: metadataOnly.checks.map((check) => ({
        ...check,
        status: "pass",
        blockers: [],
      })),
      status: "pass",
      independentNumericalReplicationReady: true,
      blockers: [],
    };
  }
  return {
    artifactId: evidenceId,
    contractVersion:
      NHM2_EXPERIMENT_READY_THEORY_CLOSURE_EVIDENCE_CONTRACT_VERSIONS[
        evidenceId
      ],
    producerStatus: "not_implemented",
    ...(evidenceId === "full_apparatus_source_tensor" &&
    historicalComputedRef != null
      ? {
          sourceTensor: {
            rawTotalTensorArray: historicalComputedRef,
          },
        }
      : {}),
    claimBoundary: {
      physicalViabilityClaimAllowed: false,
      transportClaimAllowed: false,
    },
  };
}

const metricValueFor = (policy: {
  comparator: "lt" | "lte" | "gt" | "gte";
  threshold: number;
}): number => {
  const offset = Math.max(Math.abs(policy.threshold) * 0.1, 1e-6);
  if (policy.comparator === "lt") return policy.threshold - offset;
  if (policy.comparator === "gt") return policy.threshold + offset;
  return policy.threshold;
};

async function buildConstructibleFixture(options?: {
  wrapHistoricalAlpha07ComputedArray?: boolean;
  includeIndependentCrossRunProbe?: boolean;
  failPrimaryReceipt?: boolean;
  producerDeclaresIndependentPass?: boolean;
  formalArtifactMode?:
    | "valid_v2"
    | "legacy_certificate_v1"
    | "legacy_replay_manifest_v1"
    | "malformed_v2";
  addUnexpectedFormalOutput?: boolean;
  formalEvidenceMtimeOutsideReceipt?: boolean;
}): Promise<{
  projectRoot: string;
  artifactPath: string;
  artifact: ReturnType<typeof buildNhm2ExperimentReadyTheoryClosure>;
  firstEvidenceAbsolutePath: string;
  primaryCrossRunProbePath: string | null;
}> {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "nhm2-theory-closure-evaluator-"),
  );
  tempRoots.push(projectRoot);

  let historicalComputedRef: { path: string; sha256: string } | undefined;
  if (options?.wrapHistoricalAlpha07ComputedArray === true) {
    const historicalRepoPath =
      "artifacts/research/full-solve/profile-campaign-runs/stage1_centerline_alpha_0p7000_observer_compatible_source_campaign_screen_v1/raw-total-tensor.f64";
    const historicalAbsolutePath = path.join(
      projectRoot,
      ...historicalRepoPath.split("/"),
    );
    const historicalBytes = Buffer.alloc(4 * 8, 19);
    await fs.mkdir(path.dirname(historicalAbsolutePath), { recursive: true });
    await fs.writeFile(historicalAbsolutePath, historicalBytes);
    historicalComputedRef = {
      path: historicalRepoPath,
      sha256: sha256(historicalBytes),
    };
  }

  const candidateDescriptor = await writeDescriptor({
    projectRoot,
    artifactId: "nhm2.candidate_definition",
    contractVersion: "nhm2_candidate_definition/v1",
    identity: { candidateId: CANDIDATE_ID },
    additional:
      historicalComputedRef == null
        ? undefined
        : { committedHistoricalSeed: historicalComputedRef },
  });
  const profileDescriptor = await writeDescriptor({
    projectRoot,
    artifactId: "nhm2.selected_profile",
    contractVersion: "nhm2_selected_profile/v1",
    identity: { selectedProfileId: SELECTED_PROFILE_ID },
  });
  const chartDescriptor = await writeDescriptor({
    projectRoot,
    artifactId: "nhm2.chart_definition",
    contractVersion: "nhm2_chart_definition/v1",
    identity: { chartId: CHART_ID },
  });
  const atlasDescriptor = await writeDescriptor({
    projectRoot,
    artifactId: "nhm2.mask_atlas",
    contractVersion: "nhm2_mask_atlas/v1",
    identity: { atlasId: ATLAS_ID },
  });
  const unitsDescriptor = await writeDescriptor({
    projectRoot,
    artifactId: "nhm2.units_definition",
    contractVersion: "nhm2_units_definition/v1",
    identity: { unitsId: UNITS_ID },
  });
  const normalizationDescriptor = await writeDescriptor({
    projectRoot,
    artifactId: "nhm2.normalization_definition",
    contractVersion: "nhm2_normalization_definition/v1",
    identity: { normalizationId: NORMALIZATION_ID },
  });
  const bindings: Nhm2ExperimentReadyTheoryCandidateBindingsV1 = {
    candidate: { ...candidateDescriptor, candidateId: CANDIDATE_ID },
    profile: {
      ...profileDescriptor,
      selectedProfileId: SELECTED_PROFILE_ID,
    },
    chart: { ...chartDescriptor, chartId: CHART_ID },
    atlas: { ...atlasDescriptor, atlasId: ATLAS_ID },
    units: { ...unitsDescriptor, unitsId: UNITS_ID },
    normalization: {
      ...normalizationDescriptor,
      normalizationId: NORMALIZATION_ID,
    },
  };

  const policyArtifact =
    buildNhm2ExperimentReadyTheoryCandidateNumericPolicySetArtifact(
      "nhm2-alpha07-constructibility-numeric-policy-v1",
    );
  const policyPath =
    "configs/nhm2/constructibility-authoritative-numeric-policy.v1.json";
  const policyWritten = await writeJson({
    projectRoot,
    repoPath: policyPath,
    value: policyArtifact,
  });
  const supersession = {
    policyId: "nhm2-theory-candidate-immutable-supersession-v1",
    contractVersion: "nhm2_theory_candidate_supersession/v1",
  };
  const supersessionPath =
    "configs/nhm2/constructibility-candidate-supersession.v1.json";
  const supersessionWritten = await writeJson({
    projectRoot,
    repoPath: supersessionPath,
    value: supersession,
  });

  const executionPlans = await buildExecutionPlans({ projectRoot, bindings });
  const predictionFreezePreview = blockedPredictionArtifact();
  const expectedEvidenceOutputs =
    NHM2_EXPERIMENT_READY_THEORY_CLOSURE_EVIDENCE_IDS.map((evidenceRole) => {
      const plan = executionPlans.find(
        (entry) => entry.planRole === planRoleForEvidence(evidenceRole),
      );
      if (plan == null) throw new Error(`Missing plan for ${evidenceRole}`);
      return {
        evidenceRole,
        outputPath: `${plan.expectedInvocation.outputDirectory}/evidence/${evidenceRole}.json`,
        contractVersion:
          NHM2_EXPERIMENT_READY_THEORY_CLOSURE_EVIDENCE_CONTRACT_VERSIONS[
            evidenceRole
          ],
        requestId: plan.requestId,
        runId: plan.runId,
        receiptId: plan.receiptId,
        runtimeId: plan.runtimeId,
      };
    });
  const candidateManifest = buildNhm2ExperimentReadyTheoryCandidateManifest({
    generatedAt: GENERATED_AT,
    frozenAt: FROZEN_AT,
    manifestId: MANIFEST_ID,
    bindings,
    executionPlans,
    expectedEvidenceOutputs,
    predictionFreezeCommitment: {
      contractVersion: predictionFreezePreview.contractVersion,
      semanticSha256: predictionFreezePreview.semanticSha256,
      frozenAt: predictionFreezePreview.frozenAt,
    },
    numericCheckPolicySet: {
      artifactId:
        NHM2_EXPERIMENT_READY_THEORY_CANDIDATE_NUMERIC_POLICY_SET_ARTIFACT_ID,
      contractVersion:
        NHM2_EXPERIMENT_READY_THEORY_CANDIDATE_NUMERIC_POLICY_SET_CONTRACT_VERSION,
      policySetId: policyArtifact.policySetId,
      artifactPath: policyWritten.path,
      artifactRawSha256: policyWritten.sha256,
      semanticSha256: policyArtifact.semanticSha256,
    },
    supersession: {
      policyId: supersession.policyId,
      policyPath: supersessionPath,
      policyContractVersion: supersession.contractVersion,
      policySha256: supersessionWritten.sha256,
      originalManifestImmutable: true,
      inPlaceMutationForbidden: true,
      supersedingManifestRequiresNewManifestId: true,
      supersedingManifestRequiresPredecessorSha256: true,
      predecessorManifestId: null,
      predecessorManifestSha256: null,
    },
  });
  expect(candidateManifest.readiness).toMatchObject({
    preRunManifestReady: true,
    blockers: [],
  });
  expect(
    candidateManifest.expectedEvidenceOutputs.every(
      (output) =>
        !("sha256" in output) &&
        !("receiptPath" in output) &&
        !("receiptSha256" in output),
    ),
  ).toBe(true);
  expect(
    candidateManifest.executionPlans.every(
      (plan) => !("receiptPath" in plan) && !("receiptSha256" in plan),
    ),
  ).toBe(true);
  const candidateManifestWritten = await writeJson({
    projectRoot,
    repoPath: CANDIDATE_MANIFEST_PATH,
    value: candidateManifest,
  });

  const rawEvidenceById = new Map<
    Nhm2ExperimentReadyTheoryClosureEvidenceId,
    { path: string; sha256: string }
  >();
  const receiptByPlanRole = new Map<
    Nhm2ExperimentReadyTheoryCandidateExecutionPlanRole,
    TheoryRuntimeReceiptV1
  >();
  const persistedReceiptByPlanRole = new Map<
    Nhm2ExperimentReadyTheoryCandidateExecutionPlanRole,
    Awaited<ReturnType<typeof writeTheoryRuntimeReceiptArtifact>>
  >();
  let primaryCrossRunProbe: {
    path: string;
    sha256: string;
    sizeBytes: number;
  } | null = null;

  for (const [planIndex, plan] of executionPlans.entries()) {
    const outputDirectory = path.join(
      projectRoot,
      ...plan.expectedInvocation.outputDirectory.split("/"),
    );
    await fs.mkdir(outputDirectory, { recursive: true });
    const startedAt = new Date(
      Date.parse("2099-07-19T12:00:00.000Z") + planIndex * 2_000,
    ).toISOString();
    const completedAt = new Date(Date.parse(startedAt) + 1_000).toISOString();
    const before = await snapshotTheoryRuntimeOutput({
      projectRoot,
      outputDirectory,
    });
    const beforeCommitment = await writeTheoryRuntimePreSpawnSnapshotCommitment(
      {
        projectRoot,
        requestId: plan.requestId,
        runtimeId: plan.runtimeId,
        outputDirectory,
        beforeCapturedAt: startedAt,
        gitSha: plan.sourceCommitSha,
        sourceTreeSha256: sha256(`clean-source-tree:${plan.planRole}`),
        worktreeClean: true,
        before,
      },
    );
    if (
      options?.includeIndependentCrossRunProbe === true &&
      plan.planRole === "primary_numerical"
    ) {
      const probeBytes = Buffer.alloc(4 * 8, 23);
      const probePath = `${plan.expectedInvocation.outputDirectory}/raw/primary-cross-run-probe.f64`;
      const probeAbsolutePath = path.join(projectRoot, ...probePath.split("/"));
      await fs.mkdir(path.dirname(probeAbsolutePath), { recursive: true });
      await fs.writeFile(probeAbsolutePath, probeBytes);
      primaryCrossRunProbe = {
        path: probePath,
        sha256: sha256(probeBytes),
        sizeBytes: probeBytes.length,
      };
    }
    const planOutputs = expectedEvidenceOutputs.filter(
      (entry) => entry.receiptId === plan.receiptId,
    );
    for (const output of planOutputs) {
      if (output.evidenceRole === "formal_manifest_certificate") {
        let written = await writeFormalV2Outputs({
          projectRoot,
          candidateManifest,
          candidateManifestWritten,
          plan,
          startedAt,
          completedAt,
          evidencePath: output.outputPath,
        });
        const mode = options?.formalArtifactMode ?? "valid_v2";
        if (mode !== "valid_v2") {
          const contractVersion =
            mode === "legacy_certificate_v1"
              ? "nhm2_formal_manifest_certificate/v1"
              : mode === "legacy_replay_manifest_v1"
                ? "nhm2_formal_kernel_replay_manifest/v1"
                : "nhm2_formal_manifest_certificate/v2";
          written = await writeCanonicalJson({
            projectRoot,
            repoPath: output.outputPath,
            value: {
              artifactId: "malformed-or-superseded-formal-artifact",
              contractVersion,
              evidenceRole: "formal_manifest_certificate",
              status: "pass",
              checks: [],
            },
          });
          const mtime = new Date(Date.parse(startedAt) + 800);
          await fs.utimes(
            path.join(projectRoot, ...output.outputPath.split("/")),
            mtime,
            mtime,
          );
        }
        if (options?.addUnexpectedFormalOutput === true) {
          const unexpectedPath = path.join(
            outputDirectory,
            "legacy-replay.json",
          );
          await fs.writeFile(unexpectedPath, "{}", "utf8");
          const mtime = new Date(Date.parse(startedAt) + 800);
          await fs.utimes(unexpectedPath, mtime, mtime);
        }
        if (options?.formalEvidenceMtimeOutsideReceipt === true) {
          const outside = new Date(Date.parse(startedAt) - 10_000);
          await fs.utimes(
            path.join(projectRoot, ...output.outputPath.split("/")),
            outside,
            outside,
          );
        }
        rawEvidenceById.set(output.evidenceRole, written);
        continue;
      }
      // This fixture proves the envelope DAG. Domain artifacts remain
      // fail-closed and their schema constructibility is covered by their own
      // focused contract specs; none may bind a receipt/output hash that only
      // exists after this file is emitted.
      const rawEvidence = rawEvidenceFor(
        output.evidenceRole,
        output.evidenceRole === "prediction_falsifier_freeze"
          ? {
              candidateId: CANDIDATE_ID,
              candidateManifestPath: candidateManifestWritten.path,
              candidateManifestSha256: candidateManifestWritten.sha256,
              runId: plan.runId,
              requestId: plan.requestId,
              receiptId: plan.receiptId,
              runtimeId: plan.runtimeId,
              plannedOutputDirectory: plan.expectedInvocation.outputDirectory,
            }
          : undefined,
        historicalComputedRef,
        output.evidenceRole === "independent_numerical_replication" &&
          primaryCrossRunProbe != null
          ? {
              primaryRawOutput: primaryCrossRunProbe,
              primaryPlan: executionPlans.find(
                (entry) => entry.planRole === "primary_numerical",
              )!,
              independentPlan: plan,
            }
          : undefined,
        output.evidenceRole === "independent_numerical_replication" &&
          options?.producerDeclaresIndependentPass === true,
      );
      expect(
        populatedForwardReceiptOrOutputHashes(rawEvidence),
        `${output.evidenceRole} contains a forward receipt/output hash`,
      ).toEqual([]);
      const written = await writeJson({
        projectRoot,
        repoPath: output.outputPath,
        value: rawEvidence,
      });
      rawEvidenceById.set(output.evidenceRole, written);
    }
    const after = await snapshotTheoryRuntimeOutput({
      projectRoot,
      outputDirectory,
    });
    const entries = classifyTheoryRuntimeArtifacts({ before, after });
    expect(entries.every((entry) => entry.freshness === "new")).toBe(true);
    const outputManifest = await writeTheoryRuntimeOutputManifest({
      projectRoot,
      outputDirectory,
      requestId: plan.requestId,
      runtimeId: plan.runtimeId,
      gitSha: plan.sourceCommitSha,
      startedAt,
      completedAt,
      generatedAt: completedAt,
      entries,
      freshnessProof: buildTheoryRuntimeFreshnessProof({
        before,
        after,
        beforeCapturedAt: startedAt,
        afterCapturedAt: completedAt,
        beforeCommitmentPath: beforeCommitment.path,
        beforeCommitmentSha256: beforeCommitment.sha256,
      }),
    });
    const environment = Object.fromEntries(
      plan.expectedInvocation.environment.map((entry) => [
        entry.name,
        entry.valueKind === "candidate_manifest_raw_sha256"
          ? candidateManifestWritten.sha256
          : entry.value,
      ]),
    ) as Record<string, string>;
    const receipt = buildTheoryRuntimeReceiptV1({
      generatedAt: completedAt,
      receiptId: plan.receiptId,
      runtimeId: plan.runtimeId,
      graphId: "theory-graph.nhm2.constructibility",
      badgeIds: ["nhm2.meta.experiment_ready_theory_closure"],
      command: plan.expectedInvocation.command,
      args: {
        requestId: plan.requestId,
        entrypointCommand: plan.expectedInvocation.entrypoint,
        candidateId: CANDIDATE_ID,
        selectedProfileId: SELECTED_PROFILE_ID,
        chartId: CHART_ID,
        runId: plan.runId,
        candidateManifestSha256: candidateManifestWritten.sha256,
        atlasSha256: bindings.atlas.sha256,
        unitsSha256: bindings.units.sha256,
        normalizationSha256: bindings.normalization.sha256,
      },
      status:
        options?.failPrimaryReceipt === true &&
        plan.planRole === "primary_numerical"
          ? "failed"
          : "completed",
      outputs: {
        artifacts: entries.map((entry) => entry.path),
        scalars: {},
        units: {},
        gates: { runtime_artifact_freshness: "pass" },
        missingSignals: [],
        warnings: [],
        artifactManifest: outputManifest,
      },
      provenance: {
        gitSha: plan.sourceCommitSha,
        startedAt,
        completedAt,
        durationMs: 1_000,
      },
      execution: {
        command: plan.expectedInvocation.command,
        args: [...plan.expectedInvocation.args],
        cwd: plan.expectedInvocation.cwd,
        environment,
        outputDirectory: plan.expectedInvocation.outputDirectory,
        outputDirectoryBound: true,
        exitCode:
          options?.failPrimaryReceipt === true &&
          plan.planRole === "primary_numerical"
            ? 1
            : 0,
        stdout: "fixture completed\n",
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
    receiptByPlanRole.set(plan.planRole, receipt);
    persistedReceiptByPlanRole.set(
      plan.planRole,
      await writeTheoryRuntimeReceiptArtifact({
        projectRoot,
        requestId: plan.requestId,
        receipt,
      }),
    );
  }

  const primaryPlan = executionPlans.find(
    (entry) => entry.planRole === "primary_numerical",
  );
  if (primaryPlan == null) throw new Error("Primary plan missing");
  const primaryReceipt = persistedReceiptByPlanRole.get("primary_numerical");
  if (primaryReceipt == null) throw new Error("Primary receipt missing");
  const candidate: Nhm2ExperimentReadyTheoryClosureCandidateIdentityV1 = {
    candidateId: CANDIDATE_ID,
    laneId: "nhm2_shift_lapse",
    selectedProfileId: SELECTED_PROFILE_ID,
    primaryRunId: primaryPlan.runId,
    chartId: CHART_ID,
    unitsRef: UNITS_ID,
    unitsSha256: bindings.units.sha256,
    normalizationRef: NORMALIZATION_ID,
    normalizationSha256: bindings.normalization.sha256,
    atlasPath: bindings.atlas.path,
    atlasSha256: bindings.atlas.sha256,
    candidateManifestPath: candidateManifestWritten.path,
    candidateManifestSha256: candidateManifestWritten.sha256,
    candidateManifestId: MANIFEST_ID,
    candidateManifestContractVersion:
      "nhm2_experiment_ready_theory_candidate_manifest/v1",
    numericPolicySetPath: policyWritten.path,
    numericPolicySetSha256: policyWritten.sha256,
    numericPolicySetSemanticSha256: policyArtifact.semanticSha256,
    primaryGitSha: primaryPlan.sourceCommitSha,
    primaryRequestId: primaryPlan.requestId,
    primaryRuntimeId: primaryPlan.runtimeId,
    primaryReceiptId: primaryPlan.receiptId,
    primaryReceiptPath: primaryReceipt.path,
    primaryReceiptSha256: primaryReceipt.sha256,
  };
  const policyByCheckId = new Map(
    policyArtifact.policies.map((policy) => [policy.checkId, policy]),
  );
  const evidence: Nhm2ExperimentReadyTheoryClosureEvidenceV1[] =
    NHM2_EXPERIMENT_READY_THEORY_CLOSURE_EVIDENCE_IDS.map((evidenceId) => {
      const planRole = planRoleForEvidence(evidenceId);
      const plan = executionPlans.find((entry) => entry.planRole === planRole);
      const raw = rawEvidenceById.get(evidenceId);
      const persistedReceipt = persistedReceiptByPlanRole.get(planRole);
      if (plan == null || raw == null || persistedReceipt == null) {
        throw new Error(`Incomplete fixture for ${evidenceId}`);
      }
      return {
        evidenceId,
        artifactContractVersion:
          NHM2_EXPERIMENT_READY_THEORY_CLOSURE_EVIDENCE_CONTRACT_VERSIONS[
            evidenceId
          ],
        artifactPath: raw.path,
        sha256: raw.sha256,
        receiptId: plan.receiptId,
        receiptPath: persistedReceipt.path,
        receiptSha256: persistedReceipt.sha256,
        candidateId: CANDIDATE_ID,
        candidateManifestSha256: candidateManifestWritten.sha256,
        runId: plan.runId,
        selectedProfileId: SELECTED_PROFILE_ID,
        chartId: CHART_ID,
        unitsRef: UNITS_ID,
        unitsSha256: bindings.units.sha256,
        normalizationRef: NORMALIZATION_ID,
        normalizationSha256: bindings.normalization.sha256,
        atlasSha256: bindings.atlas.sha256,
        gitSha: plan.sourceCommitSha,
        producerId: `fixture-producer:${evidenceId}`,
        implementationId: plan.solver.implementationId,
        independenceGroup: `constructibility-${planRole}-group`,
        assurance: assuranceFor(evidenceId),
        schemaValidated: true,
        assertionOnly: false,
        proxy: false,
        metricEcho: false,
        verdict: "pass",
        checks: Object.fromEntries(
          NHM2_EXPERIMENT_READY_THEORY_CLOSURE_REQUIRED_CHECKS[evidenceId].map(
            (checkId) => {
              const numericPolicy = policyByCheckId.get(
                checkId as (typeof policyArtifact.policies)[number]["checkId"],
              );
              return [
                checkId,
                {
                  pass: true,
                  method: `fixture:${evidenceId}:${checkId}`,
                  evidenceRef: `${raw.path}#/checks/${checkId}`,
                  frozenPolicyId: `${evidenceId}.${checkId}`,
                  policyManifestSha256: candidateManifestWritten.sha256,
                  frozenPolicySha256:
                    numericPolicy == null
                      ? computeNhm2ExperimentReadyTheoryCandidateNonNumericCheckPolicySha256(
                          { evidenceRole: evidenceId, checkId },
                        )
                      : computeNhm2ExperimentReadyTheoryCandidateNumericPolicyEntrySha256(
                          numericPolicy,
                        ),
                  policySetSemanticSha256: policyArtifact.semanticSha256,
                  metricValue:
                    numericPolicy == null
                      ? null
                      : metricValueFor(numericPolicy),
                  tolerance: numericPolicy?.threshold ?? null,
                  units: numericPolicy?.unit ?? null,
                },
              ];
            },
          ),
        ),
        blockers: [],
      };
    });

  const artifact = buildNhm2ExperimentReadyTheoryClosure({
    generatedAt: "2099-07-19T12:00:10.000Z",
    candidate,
    evidence,
    runtimeReceipts:
      NHM2_EXPERIMENT_READY_THEORY_CANDIDATE_MANIFEST_EXECUTION_PLAN_ROLES.map(
        (role) => {
          const receipt = receiptByPlanRole.get(role);
          if (receipt == null) throw new Error(`Missing receipt for ${role}`);
          return receipt;
        },
      ),
  });
  if (options?.failPrimaryReceipt !== true) {
    expect(
      artifact.gates.every((gate) => gate.status === "pass"),
      JSON.stringify(artifact.gates, null, 2),
    ).toBe(true);
  }
  const artifactPath =
    "artifacts/nhm2/theory-closure/constructibility-evaluation-input.v1.json";
  await writeJson({ projectRoot, repoPath: artifactPath, value: artifact });
  const firstEvidence = rawEvidenceById.get(
    NHM2_EXPERIMENT_READY_THEORY_CLOSURE_EVIDENCE_IDS[0],
  );
  if (firstEvidence == null) throw new Error("First evidence missing");
  return {
    projectRoot,
    artifactPath,
    artifact,
    primaryCrossRunProbePath: primaryCrossRunProbe?.path ?? null,
    firstEvidenceAbsolutePath: path.join(
      projectRoot,
      ...firstEvidence.path.split("/"),
    ),
  };
}

describe("NHM2 experiment-ready theory-closure filesystem evaluator", () => {
  it("accepts a producer interval strictly inside the receipt interval", () => {
    expect(
      theoryRuntimeReceiptContainsProducerInterval({
        receiptStartedAt: "2026-07-19T12:00:00.000Z",
        receiptCompletedAt: "2026-07-19T12:00:10.000Z",
        producerStartedAt: "2026-07-19T12:00:01.000Z",
        producerCompletedAt: "2026-07-19T12:00:09.000Z",
      }),
    ).toBe(true);
  });

  it("accepts inclusive receipt boundaries", () => {
    expect(
      theoryRuntimeReceiptContainsProducerInterval({
        receiptStartedAt: "2026-07-19T12:00:00.000Z",
        receiptCompletedAt: "2026-07-19T12:00:10.000Z",
        producerStartedAt: "2026-07-19T12:00:00.000Z",
        producerCompletedAt: "2026-07-19T12:00:10.000Z",
      }),
    ).toBe(true);
  });

  it("rejects producer intervals outside the receipt envelope", () => {
    const receipt = {
      receiptStartedAt: "2026-07-19T12:00:00.000Z",
      receiptCompletedAt: "2026-07-19T12:00:10.000Z",
    };
    expect(
      theoryRuntimeReceiptContainsProducerInterval({
        ...receipt,
        producerStartedAt: "2026-07-19T11:59:59.999Z",
        producerCompletedAt: "2026-07-19T12:00:09.000Z",
      }),
    ).toBe(false);
    expect(
      theoryRuntimeReceiptContainsProducerInterval({
        ...receipt,
        producerStartedAt: "2026-07-19T12:00:01.000Z",
        producerCompletedAt: "2026-07-19T12:00:10.001Z",
      }),
    ).toBe(false);
  });

  it("rejects missing, invalid, and inverted intervals", () => {
    const receipt = {
      receiptStartedAt: "2026-07-19T12:00:00.000Z",
      receiptCompletedAt: "2026-07-19T12:00:10.000Z",
    };
    expect(
      theoryRuntimeReceiptContainsProducerInterval({
        ...receipt,
        producerStartedAt: null,
        producerCompletedAt: "2026-07-19T12:00:09.000Z",
      }),
    ).toBe(false);
    expect(
      theoryRuntimeReceiptContainsProducerInterval({
        ...receipt,
        producerStartedAt: "invalid",
        producerCompletedAt: "2026-07-19T12:00:09.000Z",
      }),
    ).toBe(false);
    expect(
      theoryRuntimeReceiptContainsProducerInterval({
        ...receipt,
        producerStartedAt: "2026-07-19T12:00:09.000Z",
        producerCompletedAt: "2026-07-19T12:00:01.000Z",
      }),
    ).toBe(false);
  });

  it("constructs the two-phase hash DAG and reaches only fail-closed evidence blockers", async () => {
    const fixture = await buildConstructibleFixture();

    const result = await evaluateNhm2ExperimentReadyTheoryClosureFilesystem({
      projectRoot: fixture.projectRoot,
      artifactPath: fixture.artifactPath,
      artifact: fixture.artifact,
      verifyGitObjects: false,
    });

    expect(result).toMatchObject({
      status: "not_ready",
      gateStatus: "not_ready",
      filesystemVerified: false,
      candidateManifestValidated: true,
      evidenceAdapterCoverageComplete: false,
    });
    expect(result.blockers.length).toBeGreaterThan(0);
    expect(result.blockers).toContain(
      `evidence:semiclassical_state:${NHM2_SEMICLASSICAL_V2_SERVER_CONTENT_REPLAY_BLOCKER}`,
    );
    expect(
      result.blockers.every(
        (blocker) =>
          blocker.startsWith("evidence:") ||
          blocker.startsWith("evidence_nested_reference:"),
      ),
    ).toBe(true);
    expect(
      result.blockers.some((blocker) =>
        blocker.startsWith("evidence_nested_reference:"),
      ),
    ).toBe(true);
    expect(
      result.blockers.some((blocker) =>
        blocker.includes("evidence_adapter_unavailable"),
      ),
    ).toBe(false);
    expect(
      result.blockers.some((blocker) => blocker.includes("schema_invalid")),
    ).toBe(true);
    expect(
      result.blockers.filter((blocker) =>
        /^(?:candidate_|receipt:|runtime_|closure_artifact:|evidence_not_in_verified_receipt|evidence_hash_mismatch|evidence_not_new|git_commit_unavailable)/.test(
          blocker,
        ),
      ),
    ).toEqual([]);
    expect(
      result.blockers.filter(
        (blocker) =>
          blocker.includes("formal_manifest_certificate") &&
          (blocker.includes("formal_v2_") ||
            blocker.includes("adapter_validation_failed")),
      ),
      JSON.stringify(result.blockers, null, 2),
    ).toEqual([]);
  });

  it("cannot promote a producer-declared metadata-only independent pass without server replay", async () => {
    const fixture = await buildConstructibleFixture({
      producerDeclaresIndependentPass: true,
    });

    const result = await evaluateNhm2ExperimentReadyTheoryClosureFilesystem({
      projectRoot: fixture.projectRoot,
      artifactPath: fixture.artifactPath,
      artifact: fixture.artifact,
      verifyGitObjects: false,
    });

    expect(result).toMatchObject({
      status: "not_ready",
      gateStatus: "not_ready",
      filesystemVerified: false,
      evidenceAdapterCoverageComplete: false,
    });
    expect(result.blockers).toContain(
      "evidence:independent_numerical_replication:independent_numerical_replication_schema_invalid",
    );
    for (const blocker of NHM2_INDEPENDENT_NUMERICAL_REPLICATION_SERVER_REPLAY_BLOCKERS) {
      expect(result.blockers).toContain(
        `evidence:independent_numerical_replication:${blocker}`,
      );
    }
  });

  it.each([["legacy_certificate_v1"], ["legacy_replay_manifest_v1"]] as const)(
    "rejects superseded %s bytes for formal authority",
    async (formalArtifactMode) => {
      const fixture = await buildConstructibleFixture({ formalArtifactMode });

      const result = await evaluateNhm2ExperimentReadyTheoryClosureFilesystem({
        projectRoot: fixture.projectRoot,
        artifactPath: fixture.artifactPath,
        artifact: fixture.artifact,
        verifyGitObjects: false,
      });

      expect(result.status).toBe("not_ready");
      expect(result.gateStatus).toBe("not_ready");
      expect(result.blockers).toContain(
        "evidence:formal_manifest_certificate:formal_v2_required_legacy_or_unknown_contract_rejected",
      );
    },
  );

  it("turns malformed v2 evidence into a typed not-ready blocker", async () => {
    const fixture = await buildConstructibleFixture({
      formalArtifactMode: "malformed_v2",
    });

    const result = await evaluateNhm2ExperimentReadyTheoryClosureFilesystem({
      projectRoot: fixture.projectRoot,
      artifactPath: fixture.artifactPath,
      artifact: fixture.artifact,
      verifyGitObjects: false,
    });

    expect(result.status).toBe("not_ready");
    expect(result.gateStatus).toBe("not_ready");
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "evidence:formal_manifest_certificate:adapter_validation_failed",
        "evidence:formal_manifest_certificate:formal_v2_published_bytes_do_not_match_rebuild",
      ]),
    );
  });

  it("requires exactly the two replay outputs, outer artifact, and v2 certificate", async () => {
    const fixture = await buildConstructibleFixture({
      addUnexpectedFormalOutput: true,
    });

    const result = await evaluateNhm2ExperimentReadyTheoryClosureFilesystem({
      projectRoot: fixture.projectRoot,
      artifactPath: fixture.artifactPath,
      artifact: fixture.artifact,
      verifyGitObjects: false,
    });

    expect(result.status).toBe("not_ready");
    expect(result.blockers).toContain(
      "evidence:formal_manifest_certificate:formal_v2_exact_four_output_inventory_required",
    );
  });

  it("requires receipt-bound freshness and modification intervals", async () => {
    const fixture = await buildConstructibleFixture({
      formalEvidenceMtimeOutsideReceipt: true,
    });

    const result = await evaluateNhm2ExperimentReadyTheoryClosureFilesystem({
      projectRoot: fixture.projectRoot,
      artifactPath: fixture.artifactPath,
      artifact: fixture.artifact,
      verifyGitObjects: false,
    });

    expect(result.status).toBe("not_ready");
    expect(
      result.blockers.some((blocker) =>
        blocker.startsWith(
          "evidence:formal_manifest_certificate:formal_v2_output_not_fresh_or_bounded:",
        ),
      ),
      JSON.stringify(result.blockers, null, 2),
    ).toBe(true);
  });

  it("rejects an arbitrary well-formed numeric policy-entry hash", async () => {
    const fixture = await buildConstructibleFixture();
    const mechanics = fixture.artifact.evidence.find(
      (entry) => entry.evidenceId === "mechanical_support_control_margin",
    );
    expect(mechanics).toBeDefined();
    mechanics!.checks.support_retention_overlap_lower95_gt_one.frozenPolicySha256 =
      sha256("arbitrary-but-well-formed-numeric-policy-entry");
    await writeJson({
      projectRoot: fixture.projectRoot,
      repoPath: fixture.artifactPath,
      value: fixture.artifact,
    });

    const result = await evaluateNhm2ExperimentReadyTheoryClosureFilesystem({
      projectRoot: fixture.projectRoot,
      artifactPath: fixture.artifactPath,
      artifact: fixture.artifact,
      verifyGitObjects: false,
    });

    expect(result.candidateManifestValidated).toBe(false);
    expect(result.blockers).toContain(
      "candidate_numeric_policy_binding_mismatch:mechanical_support_control_margin:support_retention_overlap_lower95_gt_one",
    );
  });

  it("rejects a numeric check carrying another frozen policy entry's hash", async () => {
    const fixture = await buildConstructibleFixture();
    const policyArtifact =
      buildNhm2ExperimentReadyTheoryCandidateNumericPolicySetArtifact(
        "digest-probe-policy-set",
      );
    const swappedPolicy = policyArtifact.policies.find(
      (entry) =>
        entry.checkId === "pull_in_buckling_contact_stiction_margins_positive",
    );
    const mechanics = fixture.artifact.evidence.find(
      (entry) => entry.evidenceId === "mechanical_support_control_margin",
    );
    expect(swappedPolicy).toBeDefined();
    expect(mechanics).toBeDefined();
    mechanics!.checks.support_retention_overlap_lower95_gt_one.frozenPolicySha256 =
      computeNhm2ExperimentReadyTheoryCandidateNumericPolicyEntrySha256(
        swappedPolicy!,
      );
    await writeJson({
      projectRoot: fixture.projectRoot,
      repoPath: fixture.artifactPath,
      value: fixture.artifact,
    });

    const result = await evaluateNhm2ExperimentReadyTheoryClosureFilesystem({
      projectRoot: fixture.projectRoot,
      artifactPath: fixture.artifactPath,
      artifact: fixture.artifact,
      verifyGitObjects: false,
    });

    expect(result.candidateManifestValidated).toBe(false);
    expect(result.blockers).toContain(
      "candidate_numeric_policy_binding_mismatch:mechanical_support_control_margin:support_retention_overlap_lower95_gt_one",
    );
  });

  it("rejects an arbitrary hash for a required non-numeric check policy", async () => {
    const fixture = await buildConstructibleFixture();
    const source = fixture.artifact.evidence.find(
      (entry) => entry.evidenceId === "full_apparatus_source_tensor",
    );
    expect(source).toBeDefined();
    source!.checks.all_ten_components_computed.frozenPolicySha256 = sha256(
      "arbitrary-but-well-formed-non-numeric-policy",
    );
    await writeJson({
      projectRoot: fixture.projectRoot,
      repoPath: fixture.artifactPath,
      value: fixture.artifact,
    });

    const result = await evaluateNhm2ExperimentReadyTheoryClosureFilesystem({
      projectRoot: fixture.projectRoot,
      artifactPath: fixture.artifactPath,
      artifact: fixture.artifact,
      verifyGitObjects: false,
    });

    expect(result.candidateManifestValidated).toBe(false);
    expect(result.blockers).toContain(
      "candidate_non_numeric_check_policy_binding_mismatch:full_apparatus_source_tensor:all_ten_components_computed",
    );
  });

  it("cannot promote a fresh wrapper over a preexisting alpha 0.7 computed array", async () => {
    const fixture = await buildConstructibleFixture({
      wrapHistoricalAlpha07ComputedArray: true,
    });

    const result = await evaluateNhm2ExperimentReadyTheoryClosureFilesystem({
      projectRoot: fixture.projectRoot,
      artifactPath: fixture.artifactPath,
      artifact: fixture.artifact,
      verifyGitObjects: false,
    });

    expect(result).toMatchObject({
      status: "not_ready",
      gateStatus: "not_ready",
      filesystemVerified: false,
    });
    expect(
      result.blockers.some((blocker) =>
        blocker.includes(
          "evidence_nested_reference:full_apparatus_source_tensor:nested_reference:/sourceTensor/rawTotalTensorArray:historical_alpha_07_computed_reference_forbidden",
        ),
      ),
    ).toBe(true);
    expect(
      result.blockers.some((blocker) =>
        blocker.includes(
          "evidence_nested_reference:full_apparatus_source_tensor:nested_reference:/sourceTensor/rawTotalTensorArray:computed_reference_requires_owning_plan_output",
        ),
      ),
    ).toBe(true);
  });

  it("admits an independent primary-array reference only through the exact filesystem-verified primary receipt", async () => {
    const fixture = await buildConstructibleFixture({
      includeIndependentCrossRunProbe: true,
    });
    expect(fixture.primaryCrossRunProbePath).not.toBeNull();

    const result = await evaluateNhm2ExperimentReadyTheoryClosureFilesystem({
      projectRoot: fixture.projectRoot,
      artifactPath: fixture.artifactPath,
      artifact: fixture.artifact,
      verifyGitObjects: false,
    });

    expect(result.status).toBe("not_ready");
    expect(
      result.blockers.some(
        (blocker) =>
          blocker.includes("independent_numerical_replication") &&
          (blocker.includes("reference_scope_unbound") ||
            blocker.includes("evidence_internal_ref_unbound") ||
            blocker.includes(
              "prior_computed_reference_requires_verified_prior_run_output",
            )),
      ),
    ).toBe(false);
  });

  it("withholds prior-run authority when the primary receipt failed", async () => {
    const fixture = await buildConstructibleFixture({
      includeIndependentCrossRunProbe: true,
      failPrimaryReceipt: true,
    });

    const result = await evaluateNhm2ExperimentReadyTheoryClosureFilesystem({
      projectRoot: fixture.projectRoot,
      artifactPath: fixture.artifactPath,
      artifact: fixture.artifact,
      verifyGitObjects: false,
    });

    expect(result.status).toBe("not_ready");
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining("receipt_not_completed"),
        expect.stringContaining(
          "evidence_nested_reference:independent_numerical_replication:nested_reference:/comparison/fields/0/primaryRawOutput:reference_scope_unbound",
        ),
      ]),
    );
  });

  it("rejects post-receipt evidence-byte tampering", async () => {
    const fixture = await buildConstructibleFixture();
    await fs.appendFile(fixture.firstEvidenceAbsolutePath, " \n", "utf8");

    const result = await evaluateNhm2ExperimentReadyTheoryClosureFilesystem({
      projectRoot: fixture.projectRoot,
      artifactPath: fixture.artifactPath,
      artifact: fixture.artifact,
      verifyGitObjects: false,
    });

    expect(result.status).toBe("not_ready");
    expect(
      result.blockers.some((blocker) =>
        blocker.includes("runtime_artifact_sha256_mismatch"),
      ),
    ).toBe(true);
  });
});
