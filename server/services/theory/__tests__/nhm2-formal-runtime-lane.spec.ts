import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  NHM2_EXPERIMENT_READY_THEORY_CANDIDATE_MANIFEST_EXECUTION_PLAN_ROLES,
  NHM2_EXPERIMENT_READY_THEORY_CANDIDATE_MANIFEST_REQUIRED_EVIDENCE_ROLES,
  NHM2_EXPERIMENT_READY_THEORY_CANDIDATE_NUMERIC_POLICY_SET_ARTIFACT_ID,
  NHM2_EXPERIMENT_READY_THEORY_CANDIDATE_NUMERIC_POLICY_SET_CONTRACT_VERSION,
  NHM2_EXPERIMENT_READY_THEORY_CANDIDATE_PREDICTION_FREEZE_CONTRACT_VERSION,
  buildNhm2ExperimentReadyTheoryCandidateManifest,
  buildNhm2ExperimentReadyTheoryCandidateNumericPolicySetArtifact,
  nhm2ExperimentReadyTheoryCandidateReceiptIdForRequest,
  nhm2ExperimentReadyTheoryFormalInvocation,
  type Nhm2ExperimentReadyTheoryCandidateBindingsV1,
  type Nhm2ExperimentReadyTheoryCandidateEvidenceRole,
  type Nhm2ExperimentReadyTheoryCandidateExecutionPlanRole,
  type Nhm2ExperimentReadyTheoryCandidateExecutionPlanV1,
} from "../../../../shared/contracts/nhm2-experiment-ready-theory-candidate-manifest.v1";
import { NHM2_EXPERIMENT_READY_THEORY_CLOSURE_EVIDENCE_CONTRACT_VERSIONS } from "../../../../shared/contracts/nhm2-experiment-ready-theory-closure.v1";
import {
  NHM2_FORMAL_PRODUCER_BUNDLE_ARTIFACT_ID,
  NHM2_FORMAL_PRODUCER_BUNDLE_BUILD_ARTIFACT_ID,
  NHM2_FORMAL_PRODUCER_BUNDLE_BUILD_CONTRACT_VERSION,
  NHM2_FORMAL_PRODUCER_BUNDLE_SCHEMA_VERSION,
} from "../../../../shared/contracts/nhm2-formal-producer-bundle.v1";
import { buildNhm2FormalOuterObservationEvidence } from "../nhm2-formal-outer-observation-evidence-adapter";
import {
  NHM2_FORMAL_KERNEL_AXIOM_TRANSCRIPT_MARKER,
  NHM2_FORMAL_KERNEL_REQUIRED_THEOREM_NAME,
  NHM2_FORMAL_KERNEL_THEOREM_TRANSCRIPT_MARKER,
  computeNhm2FormalKernelLedgerSha256,
  type Nhm2FormalKernelExecutionObservationV1,
  type Nhm2FormalKernelLedgerKind,
} from "../nhm2-formal-kernel-executor";
import {
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_EXECUTION_ARTIFACT_ID,
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_EXECUTION_CONTRACT_VERSION,
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_OUTER_FILENAME,
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_ARTIFACT_ID,
  NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_CONTRACT_VERSION,
  type Nhm2ExperimentReadyTheoryFormalClaimBoundaryV1,
  type Nhm2ExperimentReadyTheoryFormalExecutionArtifactV1,
  type Nhm2ExperimentReadyTheoryFormalRunSpecV1,
} from "../../../../tools/nhm2/run-experiment-ready-theory-formal";
import type { Nhm2FormalApprovedToolchainVerificationV1 } from "../nhm2-formal-approved-toolchain-policy-verifier";
import type { Nhm2FormalProducerBundleAdmissionV1 } from "../nhm2-formal-producer-bundle-admission";
import {
  NHM2_FORMAL_RUNTIME_ID,
  admitNhm2FormalRuntimePlan,
  type Nhm2FormalRuntimePlanAdmissionV1,
  type Nhm2FormalRuntimeSourceStateV1,
} from "../nhm2-formal-runtime-plan-admission";
import {
  NHM2_FORMAL_RUNTIME_OUTPUT_PATHS,
  executeNhm2FormalRuntime,
  resolveNhm2FormalRuntimeWorktreeStatus,
  type Nhm2FormalRuntimeWorktreeStatusV1,
} from "../nhm2-formal-runtime-executor";
import { verifyTheoryRuntimeReceiptFilesystem } from "../theory-runtime-receipt-filesystem-verifier";

const roots: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

const pretty = (value: unknown): Buffer =>
  Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");

const compact = (value: unknown): Buffer =>
  Buffer.from(JSON.stringify(value), "utf8");

type Written = {
  path: string;
  absolutePath: string;
  sha256: string;
  sizeBytes: number;
};

const writePretty = async (
  root: string,
  repoPath: string,
  value: unknown,
): Promise<Written> => {
  const absolutePath = path.resolve(root, repoPath);
  const bytes = pretty(value);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, bytes);
  return {
    path: repoPath,
    absolutePath,
    sha256: sha256(bytes),
    sizeBytes: bytes.byteLength,
  };
};

const writeBytes = async (
  root: string,
  repoPath: string,
  bytes: Buffer,
): Promise<Written> => {
  const absolutePath = path.resolve(root, repoPath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, bytes);
  return {
    path: repoPath,
    absolutePath,
    sha256: sha256(bytes),
    sizeBytes: bytes.byteLength,
  };
};

const planRoleForEvidence = (
  role: Nhm2ExperimentReadyTheoryCandidateEvidenceRole,
): Nhm2ExperimentReadyTheoryCandidateExecutionPlanRole => {
  if (role === "formal_manifest_certificate") return "formal_kernel";
  if (role === "independent_numerical_replication") {
    return "independent_numerical";
  }
  return "primary_numerical";
};

const invocationEnvironment = (input: {
  bindings: Nhm2ExperimentReadyTheoryCandidateBindingsV1;
  candidateId: string;
  outputDirectory: string;
  requestId: string;
  runId: string;
  receiptId: string;
  runtimeId: string;
}) => [
  {
    name: "NHM2_ATLAS_SHA256",
    valueKind: "literal" as const,
    value: input.bindings.atlas.sha256,
  },
  {
    name: "NHM2_CANDIDATE_ID",
    valueKind: "literal" as const,
    value: input.candidateId,
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
  { name: "NHM2_RUN_ID", valueKind: "literal" as const, value: input.runId },
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
    value: input.runtimeId,
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

const sourceState: Nhm2FormalRuntimeSourceStateV1 = {
  head: "c".repeat(40),
  treeSha256: "d".repeat(40),
  fullClean: true,
  trackedClean: true,
};

const worktreeStatus = (
  records: string[] = [],
): Nhm2FormalRuntimeWorktreeStatusV1 => {
  const raw = Buffer.concat(
    records.map((record) => Buffer.from(`${record}\0`, "utf8")),
  );
  return {
    algorithm: "git_status_porcelain_v1_z_untracked_all_sha256/v1",
    rawSha256: sha256(raw),
    records: [...records],
    clean: records.length === 0,
  };
};

const resolveCleanWorktreeStatus =
  async (): Promise<Nhm2FormalRuntimeWorktreeStatusV1> => worktreeStatus();

const FORMAL_CLAIM_BOUNDARY: Nhm2ExperimentReadyTheoryFormalClaimBoundaryV1 = {
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
};

const verification = (
  runSpec: Nhm2ExperimentReadyTheoryFormalRunSpecV1,
): Nhm2FormalApprovedToolchainVerificationV1 =>
  ({
    status: "pass_approved_diagnostic_toolchain_match",
    policyId: "lean-4.31.0-server-fixture-v1",
    policySemanticSha256: "1".repeat(64),
    target: {},
    releases: {},
    formalProjectToolchainFile: {},
    toolchainLedger: {
      rootIndependent: true,
      aggregateSha256: runSpec.executor.ledgers.toolchain.ledgerSha256,
      entryCount: runSpec.executor.ledgers.toolchain.entries.length,
      aggregateBytes: runSpec.executor.ledgers.toolchain.entries.reduce(
        (total, entry) => total + entry.sizeBytes,
        0,
      ),
    },
    executables: {},
    approvedEnvironmentAllowlist: [],
    authorityBasis: {},
    blockers: [],
    claimBoundary: {},
  }) as unknown as Nhm2FormalApprovedToolchainVerificationV1;

type Fixture = {
  root: string;
  candidatePath: string;
  candidateAbsolutePath: string;
  bundleAdmission: Nhm2FormalProducerBundleAdmissionV1;
};

async function fixture(
  options: {
    substitutePrimaryBundle?: boolean;
    nonCanonicalCandidate?: boolean;
    requestIdentityMismatch?: boolean;
  } = {},
): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nhm2-formal-lane-"));
  roots.push(root);
  const candidateRoot = "candidate";
  const manifestId = "nhm2-formal-lane-manifest-001";
  const candidateId = "nhm2-formal-lane-candidate-001";
  const candidatePath = `${candidateRoot}/candidate-manifest.v1.json`;
  await fs.mkdir(path.join(root, candidateRoot, "runs"), { recursive: true });
  await fs.mkdir(path.join(root, candidateRoot, "formal-preseal"), {
    recursive: true,
  });

  const fakeBundle = await writeBytes(
    root,
    `${candidateRoot}/bundle/formal-producer.mjs`,
    Buffer.from("formal-bundle", "utf8"),
  );
  const fakeBuild = await writePretty(
    root,
    `${candidateRoot}/bundle/formal-build.json`,
    { formal: "build" },
  );
  const fakeSource = await writeBytes(
    root,
    `${candidateRoot}/bundle/source.ts`,
    Buffer.from("export {};", "utf8"),
  );
  const fakeNode = await writeBytes(
    root,
    `${candidateRoot}/host/node.exe`,
    Buffer.from("node-runtime", "utf8"),
  );
  const formalBundleArtifactId = options.substitutePrimaryBundle
    ? "nhm2.primary_theory_candidate_producer_bundle"
    : NHM2_FORMAL_PRODUCER_BUNDLE_ARTIFACT_ID;
  const formalBuildArtifactId = options.substitutePrimaryBundle
    ? "nhm2.primary_theory_candidate_producer_bundle_build"
    : NHM2_FORMAL_PRODUCER_BUNDLE_BUILD_ARTIFACT_ID;
  const bundleRef = {
    artifactId: formalBundleArtifactId,
    path: fakeBundle.path,
    schemaVersion: NHM2_FORMAL_PRODUCER_BUNDLE_SCHEMA_VERSION,
    sha256: fakeBundle.sha256,
    sizeBytes: fakeBundle.sizeBytes,
  };
  const buildRef = {
    artifactId: formalBuildArtifactId,
    path: fakeBuild.path,
    schemaVersion: NHM2_FORMAL_PRODUCER_BUNDLE_BUILD_CONTRACT_VERSION,
    sha256: fakeBuild.sha256,
  };

  const descriptorSpecs = [
    [
      "candidate-definition",
      "nhm2.candidate_definition",
      "nhm2_candidate_definition/v1",
      {
        candidateId,
        formalProducerBundle: { bundleRef, buildMetadataRef: buildRef },
      },
    ],
    [
      "profile",
      "nhm2.profile",
      "nhm2_profile/v1",
      { selectedProfileId: "profile-001" },
    ],
    ["chart", "nhm2.chart", "nhm2_chart/v1", { chartId: "chart-001" }],
    ["atlas", "nhm2.atlas", "nhm2_atlas/v1", { atlasId: "atlas-001" }],
    ["units", "nhm2.units", "nhm2_units/v1", { unitsId: "units-001" }],
    [
      "normalization",
      "nhm2.normalization",
      "nhm2_normalization/v1",
      { normalizationId: "normalization-001" },
    ],
  ] as const;
  const descriptors = new Map<string, Written>();
  for (const [name, artifactId, contractVersion, fields] of descriptorSpecs) {
    descriptors.set(
      name,
      await writePretty(root, `${candidateRoot}/inputs/${name}.json`, {
        artifactId,
        contractVersion,
        ...fields,
      }),
    );
  }
  const descriptor = (name: string) => descriptors.get(name)!;
  const bindings: Nhm2ExperimentReadyTheoryCandidateBindingsV1 = {
    candidate: {
      artifactId: "nhm2.candidate_definition",
      contractVersion: "nhm2_candidate_definition/v1",
      path: descriptor("candidate-definition").path,
      sha256: descriptor("candidate-definition").sha256,
      candidateId,
    },
    profile: {
      artifactId: "nhm2.profile",
      contractVersion: "nhm2_profile/v1",
      path: descriptor("profile").path,
      sha256: descriptor("profile").sha256,
      selectedProfileId: "profile-001",
    },
    chart: {
      artifactId: "nhm2.chart",
      contractVersion: "nhm2_chart/v1",
      path: descriptor("chart").path,
      sha256: descriptor("chart").sha256,
      chartId: "chart-001",
    },
    atlas: {
      artifactId: "nhm2.atlas",
      contractVersion: "nhm2_atlas/v1",
      path: descriptor("atlas").path,
      sha256: descriptor("atlas").sha256,
      atlasId: "atlas-001",
    },
    units: {
      artifactId: "nhm2.units",
      contractVersion: "nhm2_units/v1",
      path: descriptor("units").path,
      sha256: descriptor("units").sha256,
      unitsId: "units-001",
    },
    normalization: {
      artifactId: "nhm2.normalization",
      contractVersion: "nhm2_normalization/v1",
      path: descriptor("normalization").path,
      sha256: descriptor("normalization").sha256,
      normalizationId: "normalization-001",
    },
  };
  const plans: Nhm2ExperimentReadyTheoryCandidateExecutionPlanV1[] = [];
  for (const [
    index,
    planRole,
  ] of NHM2_EXPERIMENT_READY_THEORY_CANDIDATE_MANIFEST_EXECUTION_PLAN_ROLES.entries()) {
    const roleToken = planRole.replace(/_/g, "-");
    const runtimeId =
      planRole === "formal_kernel"
        ? NHM2_FORMAL_RUNTIME_ID
        : `nhm2.experiment_ready_theory.${planRole}`;
    const requestId =
      planRole === "formal_kernel"
        ? options.requestIdentityMismatch
          ? "caller-selected-request"
          : `${manifestId}-formal-kernel-request-v1`
        : `${manifestId}-${roleToken}-request-v1`;
    const runId =
      planRole === "formal_kernel"
        ? `${manifestId}-formal-kernel-run-v1`
        : `${manifestId}-${roleToken}-run-v1`;
    const receiptId = nhm2ExperimentReadyTheoryCandidateReceiptIdForRequest(
      runtimeId,
      requestId,
    );
    const outputDirectory = `${candidateRoot}/runs/${runId}`;
    let solver: Nhm2ExperimentReadyTheoryCandidateExecutionPlanV1["solver"];
    let environmentLock: Nhm2ExperimentReadyTheoryCandidateExecutionPlanV1["environmentLock"];
    if (planRole === "formal_kernel") {
      const solverId = "formal-solver";
      const solverVersion = "source-c";
      const implementationId = "formal-implementation-v1";
      const solverWritten = await writePretty(
        root,
        `${candidateRoot}/inputs/formal-solver.json`,
        {
          artifactId: "nhm2.formal_solver",
          contractVersion: "nhm2_formal_solver/v1",
          planRole,
          solverId,
          solverVersion,
          implementationId,
          sourceCommitSha: sourceState.head,
          bundleRef,
          bundleBuildMetadataRef: buildRef,
        },
      );
      const environmentId = "formal-environment-001";
      const environmentWritten = await writePretty(
        root,
        `${candidateRoot}/inputs/formal-environment.json`,
        {
          artifactId: "nhm2.formal_environment",
          contractVersion: "nhm2_formal_environment/v1",
          planRole,
          environmentId,
          sourceCommitSha: sourceState.head,
        },
      );
      solver = {
        artifactId: "nhm2.formal_solver",
        contractVersion: "nhm2_formal_solver/v1",
        path: solverWritten.path,
        sha256: solverWritten.sha256,
        solverId,
        solverVersion,
        implementationId,
      };
      environmentLock = {
        artifactId: "nhm2.formal_environment",
        contractVersion: "nhm2_formal_environment/v1",
        path: environmentWritten.path,
        sha256: environmentWritten.sha256,
        environmentId,
      };
    } else {
      solver = {
        artifactId: `nhm2.${planRole}_solver`,
        contractVersion: `nhm2_${planRole}_solver/v1`,
        path: `${candidateRoot}/unused/${planRole}-solver.json`,
        sha256: String(index + 3).repeat(64),
        solverId: `${planRole}-solver`,
        solverVersion: "1",
        implementationId: `${planRole}-implementation`,
      };
      environmentLock = {
        artifactId: `nhm2.${planRole}_environment`,
        contractVersion: `nhm2_${planRole}_environment/v1`,
        path: `${candidateRoot}/unused/${planRole}-environment.json`,
        sha256: String(index + 6).repeat(64),
        environmentId: `${planRole}-environment`,
      };
    }
    const formalInvocation =
      planRole === "formal_kernel"
        ? nhm2ExperimentReadyTheoryFormalInvocation({
            candidateManifestPath: candidatePath,
            outputDirectory,
            runId,
          })
        : null;
    plans.push({
      planRole,
      requestId,
      runId,
      receiptId,
      runtimeId,
      sourceCommitSha:
        planRole === "formal_kernel"
          ? sourceState.head
          : String(index + 1).repeat(40),
      deterministicSeedPolicy: `seed-${planRole}`,
      solver,
      environmentLock,
      expectedInvocation: {
        entrypoint: formalInvocation?.entrypoint ?? `unused-${planRole}`,
        command: formalInvocation?.command ?? "node",
        args: formalInvocation?.args ?? ["unused"],
        cwd: formalInvocation?.cwd ?? ".",
        environment: invocationEnvironment({
          bindings,
          candidateId,
          outputDirectory,
          requestId,
          runId,
          receiptId,
          runtimeId,
        }),
        outputDirectory,
      },
    });
  }
  const policyArtifact =
    buildNhm2ExperimentReadyTheoryCandidateNumericPolicySetArtifact(
      "nhm2-formal-lane-policy-001",
    );
  const policyWritten = await writePretty(
    root,
    `${candidateRoot}/inputs/numeric-policy.json`,
    policyArtifact,
  );
  const manifest = buildNhm2ExperimentReadyTheoryCandidateManifest({
    generatedAt: "2026-07-18T09:59:00.000Z",
    frozenAt: "2026-07-18T10:00:00.000Z",
    manifestId,
    bindings,
    executionPlans: plans,
    expectedEvidenceOutputs:
      NHM2_EXPERIMENT_READY_THEORY_CANDIDATE_MANIFEST_REQUIRED_EVIDENCE_ROLES.map(
        (evidenceRole) => {
          const plan = plans.find(
            (entry) => entry.planRole === planRoleForEvidence(evidenceRole),
          )!;
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
        },
      ),
    predictionFreezeCommitment: {
      contractVersion:
        NHM2_EXPERIMENT_READY_THEORY_CANDIDATE_PREDICTION_FREEZE_CONTRACT_VERSION,
      semanticSha256: "e".repeat(64),
      frozenAt: "2026-07-18T09:58:00.000Z",
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
      policyId: "supersession-v1",
      policyPath: `${candidateRoot}/inputs/supersession.json`,
      policyContractVersion: "nhm2_supersession/v1",
      policySha256: "f".repeat(64),
      originalManifestImmutable: true,
      inPlaceMutationForbidden: true,
      supersedingManifestRequiresNewManifestId: true,
      supersedingManifestRequiresPredecessorSha256: true,
      predecessorManifestId: null,
      predecessorManifestSha256: null,
    },
  });
  expect(manifest.readiness.status).toBe("pre_run_manifest_ready");
  const candidateBytes = options.nonCanonicalCandidate
    ? compact(manifest)
    : pretty(manifest);
  const candidateAbsolutePath = path.resolve(root, candidatePath);
  await fs.writeFile(candidateAbsolutePath, candidateBytes);

  const bundleAdmission = {
    bundle: {
      path: fakeBundle.path,
      absolutePath: fakeBundle.absolutePath,
      sha256: fakeBundle.sha256,
      sizeBytes: fakeBundle.sizeBytes,
    },
    buildMetadata: {
      path: fakeBuild.path,
      sha256: fakeBuild.sha256,
      sizeBytes: fakeBuild.sizeBytes,
      value: {},
    },
    sourceFiles: [
      {
        path: fakeSource.path,
        absolutePath: fakeSource.absolutePath,
        sha256: fakeSource.sha256,
        sizeBytes: fakeSource.sizeBytes,
      },
    ],
    hostNodeRuntime: {
      executablePath: fakeNode.absolutePath,
      sha256: fakeNode.sha256,
      sizeBytes: fakeNode.sizeBytes,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      hostSpecificDiagnosticRuntimeClosure: true,
      operatingSystemHermeticityAsserted: false,
      nodeRuntimeReproducibilityAsserted: false,
    },
    claimBoundary: {
      standaloneFormalProducerReproduced: true,
      formalLogicReplayEstablished: false,
      numericalPhysicsValidated: false,
      theoryClosureEstablished: false,
      empiricalValidationEstablished: false,
      physicalViabilityEstablished: false,
      transportEstablished: false,
      propulsionEstablished: false,
      routeEtaEstablished: false,
      speedAuthorityEstablished: false,
    },
  } as unknown as Nhm2FormalProducerBundleAdmissionV1;
  return { root, candidatePath, candidateAbsolutePath, bundleAdmission };
}

async function admit(
  value: Fixture,
  options: { policyMismatch?: boolean } = {},
): Promise<Nhm2FormalRuntimePlanAdmissionV1> {
  return admitNhm2FormalRuntimePlan(
    { candidateManifestPath: value.candidatePath },
    {
      projectRoot: value.root,
      now: () => new Date("2026-07-19T12:00:00.000Z"),
      resolveSourceState: async () => sourceState,
      resolveServerPolicy: async () => ({
        approvedPolicy: { fixture: true },
        trustedFormalProjectRoot: path.join(value.root, "server-formal"),
        trustedToolchainRoot: path.join(value.root, "server-toolchain"),
        trustedLeanExecutablePath: path.join(
          value.root,
          "server-toolchain",
          "lean",
        ),
        trustedLakeExecutablePath: path.join(
          value.root,
          "server-toolchain",
          "lake",
        ),
      }),
      verifyProducerBundle: async () => value.bundleAdmission,
      preseal: async (input) => {
        const candidate = JSON.parse(
          await fs.readFile(value.candidateAbsolutePath, "utf8"),
        ) as {
          manifestId: string;
          frozenAt: string;
          bindings: { candidate: { candidateId: string } };
          executionPlans: Nhm2ExperimentReadyTheoryCandidateExecutionPlanV1[];
        };
        const plan = candidate.executionPlans.find(
          (entry) => entry.planRole === "formal_kernel",
        )!;
        const stagingRoot = path.resolve(value.root, input.stagingRoot);
        const sourceRoot = path.join(stagingRoot, "formal-source");
        const toolchainRoot = path.join(stagingRoot, "lean-toolchain");
        const inputRoot = path.join(stagingRoot, "candidate-input");
        const sourceFile = await writeBytes(
          value.root,
          portable(value.root, path.join(sourceRoot, "driver.lean")),
          Buffer.from("theorem fixture : True := by trivial", "utf8"),
        );
        const leanFile = await writeBytes(
          value.root,
          portable(value.root, path.join(toolchainRoot, "lean")),
          Buffer.from("lean", "utf8"),
        );
        const lakeFile = await writeBytes(
          value.root,
          portable(value.root, path.join(toolchainRoot, "lake")),
          Buffer.from("lake", "utf8"),
        );
        const inputFile = await writeBytes(
          value.root,
          portable(value.root, path.join(inputRoot, "candidate.sha")),
          Buffer.from("input", "utf8"),
        );
        const ledger = (
          kind: "source" | "toolchain" | "input",
          rootPath: string,
          files: Written[],
        ) => {
          const entries = files
            .map((file) => ({
              relativePath: path.basename(file.absolutePath),
              sha256: file.sha256,
              sizeBytes: file.sizeBytes,
            }))
            .sort((left, right) =>
              left.relativePath.localeCompare(right.relativePath),
            );
          return {
            kind,
            rootPath,
            entries,
            ledgerSha256: computeNhm2FormalKernelLedgerSha256({
              kind,
              entries,
            }),
          };
        };
        const sourceLedger = ledger("source", sourceRoot, [sourceFile]);
        const toolchainLedger = ledger("toolchain", toolchainRoot, [
          lakeFile,
          leanFile,
        ]);
        const inputLedger = ledger("input", inputRoot, [inputFile]);
        const candidateBytes = await fs.readFile(value.candidateAbsolutePath);
        const runSpec = {
          artifactId: NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_ARTIFACT_ID,
          contractVersion:
            NHM2_EXPERIMENT_READY_THEORY_FORMAL_RUN_SPEC_CONTRACT_VERSION,
          generatedAt: "2026-07-19T12:00:00.000Z",
          sealedAt: "2026-07-19T12:00:00.000Z",
          identity: {
            candidateId: candidate.bindings.candidate.candidateId,
            candidateManifestId: candidate.manifestId,
            candidateManifestSha256: sha256(candidateBytes),
            candidateFrozenAt: candidate.frozenAt,
            requestId: plan.requestId,
            runId: plan.runId,
            receiptId: plan.receiptId,
            runtimeId: plan.runtimeId,
            sourceCommitSha: plan.sourceCommitSha,
          },
          planBinding: plan,
          theoremName: NHM2_FORMAL_KERNEL_REQUIRED_THEOREM_NAME,
          formalSourceBindings: {
            authority: "server_owned_formal_project",
            projectRoot: sourceRoot,
            entries: [
              {
                sourceRole: "replay_driver",
                path: sourceFile.absolutePath,
                sha256: sourceFile.sha256,
                sizeBytes: sourceFile.sizeBytes,
              },
            ],
          },
          toolchainBindings: {
            authority: "sealed_lean_toolchain",
            toolchainRoot,
            entries: [
              {
                toolchainRole: "lake_executable",
                path: lakeFile.absolutePath,
                sha256: lakeFile.sha256,
                sizeBytes: lakeFile.sizeBytes,
              },
              {
                toolchainRole: "lean_executable",
                path: leanFile.absolutePath,
                sha256: leanFile.sha256,
                sizeBytes: leanFile.sizeBytes,
              },
            ],
          },
          executor: {
            theoremName: NHM2_FORMAL_KERNEL_REQUIRED_THEOREM_NAME,
            executableRole: "lean",
            executables: {
              lean: {
                absolutePath: leanFile.absolutePath,
                sha256: leanFile.sha256,
                sizeBytes: leanFile.sizeBytes,
              },
              lake: {
                absolutePath: lakeFile.absolutePath,
                sha256: lakeFile.sha256,
                sizeBytes: lakeFile.sizeBytes,
              },
            },
            ledgers: {
              source: sourceLedger,
              toolchain: toolchainLedger,
              input: inputLedger,
            },
            outputRoot: path.resolve(
              value.root,
              plan.expectedInvocation.outputDirectory,
            ),
            replayWorkdirs: [
              path.resolve(
                value.root,
                plan.expectedInvocation.outputDirectory,
                "replay-one",
              ),
              path.resolve(
                value.root,
                plan.expectedInvocation.outputDirectory,
                "replay-two",
              ),
            ],
            environmentAllowlist: [],
            environment: {},
            executableArguments: [sourceFile.absolutePath, "-o", "proof.olean"],
            expectedOutputPaths: ["proof.olean"],
            timeoutMs: 30_000,
            maxCapturedOutputBytes: 1024 * 1024,
          },
          outerArtifactPath: `${plan.expectedInvocation.outputDirectory}/${NHM2_EXPERIMENT_READY_THEORY_FORMAL_OUTER_FILENAME}`,
          claimBoundary: FORMAL_CLAIM_BOUNDARY,
        } as unknown as Nhm2ExperimentReadyTheoryFormalRunSpecV1;
        const specBytes = compact(runSpec);
        const specPath = path.resolve(
          value.root,
          input.stagingRoot,
          "formal-run-spec.v1.json",
        );
        await fs.writeFile(specPath, specBytes);
        return {
          formalRunSpecPath: portable(value.root, specPath),
          formalRunSpecSha256: sha256(specBytes),
          formalRunSpecSizeBytes: specBytes.byteLength,
          stagingRoot: input.stagingRoot,
          sourceLedger,
          toolchainLedger,
          inputLedger,
          runSpec,
          claimBoundary: FORMAL_CLAIM_BOUNDARY,
        };
      },
      verifyApprovedToolchain: ({ formalRunSpec }) => {
        if (options.policyMismatch) throw new Error("policy mismatch");
        return verification(
          formalRunSpec as Nhm2ExperimentReadyTheoryFormalRunSpecV1,
        );
      },
    },
  );
}

const portable = (root: string, absolutePath: string): string =>
  path.relative(root, absolutePath).split(path.sep).join("/");

async function writeSuccessfulOutputs(input: {
  admission: Nhm2FormalRuntimePlanAdmissionV1;
  evidenceStatus?: "pass" | "fail";
  malformedEvidence?: boolean;
  omitPath?: string;
  extra?: boolean;
  stale?: boolean;
}): Promise<void> {
  const outputRoot = path.resolve(
    input.admission.workspaceRoot,
    input.admission.outputDirectory,
  );
  await fs.mkdir(path.join(outputRoot, "replay-one"), { recursive: true });
  await fs.mkdir(path.join(outputRoot, "replay-two"), { recursive: true });
  await fs.mkdir(path.join(outputRoot, "evidence"), { recursive: true });
  const proofs = new Map<string, Written>();
  for (const relativePath of [
    "replay-one/proof.olean",
    "replay-two/proof.olean",
  ]) {
    if (input.omitPath === relativePath) continue;
    proofs.set(
      relativePath,
      await writeBytes(
        input.admission.workspaceRoot,
        `${input.admission.outputDirectory}/${relativePath}`,
        Buffer.from("byte-identical-cold-replay-proof", "utf8"),
      ),
    );
  }
  if (proofs.size === 2) {
    const spec = input.admission.preseal.runSpec;
    const replayEntries = [
      "replay-one/proof.olean",
      "replay-two/proof.olean",
    ].map((relativePath) => {
      const proof = proofs.get(relativePath)!;
      return {
        path: relativePath,
        sha256: proof.sha256,
        sizeBytes: proof.sizeBytes,
      };
    });
    const outputInventorySha256 = (
      entries: Array<{
        relativePath: string;
        sha256: string;
        sizeBytes: number;
      }>,
    ) =>
      sha256(
        JSON.stringify({
          domain: "nhm2_formal_kernel_output_inventory/v1",
          entries: entries.map(
            ({ relativePath, sha256: digest, sizeBytes }) => ({
              relativePath,
              sha256: digest,
              sizeBytes,
            }),
          ),
        }),
      );
    const ledgerObservation = (kind: Nhm2FormalKernelLedgerKind) => ({
      kind,
      observedAt: new Date().toISOString(),
      ledgerSha256: spec.executor.ledgers[kind].ledgerSha256,
      entryCount: spec.executor.ledgers[kind].entries.length,
      entries: structuredClone(spec.executor.ledgers[kind].entries),
    });
    const transcript = `${NHM2_FORMAL_KERNEL_THEOREM_TRANSCRIPT_MARKER}\n${NHM2_FORMAL_KERNEL_AXIOM_TRANSCRIPT_MARKER}\n`;
    const transcriptSha256 = sha256(Buffer.from(transcript, "utf8"));
    const emptySha256 = sha256(Buffer.alloc(0));
    const timeline = Date.now();
    const makeReplay = (index: 1 | 2) => {
      const relativePath = `replay-${index === 1 ? "one" : "two"}/proof.olean`;
      const proof = proofs.get(relativePath)!;
      const modifiedAt = new Date(
        awaitableStatCache.get(relativePath) ?? timeline,
      ).toISOString();
      const output = {
        relativePath: "proof.olean",
        sha256: proof.sha256,
        sizeBytes: proof.sizeBytes,
        modifiedAt,
        freshness: "new" as const,
      };
      const startedAt = modifiedAt;
      const completedAt = modifiedAt;
      return {
        replayIndex: index,
        executableRole: "lean" as const,
        process: {
          executableRole: "lean" as const,
          command: spec.executor.executables.lean.absolutePath,
          args: [...spec.executor.executableArguments],
          cwd: spec.executor.replayWorkdirs[index - 1],
          environment: { ...spec.executor.environment },
          startedAt,
          completedAt,
          durationMs: Date.parse(completedAt) - Date.parse(startedAt),
          exitCode: 0,
          signal: null,
          stdout: transcript,
          stderr: "",
          stdoutSha256: transcriptSha256,
          stderrSha256: emptySha256,
          stdoutBytes: Buffer.byteLength(transcript, "utf8"),
          stderrBytes: 0,
          timedOut: false,
          outputLimitExceeded: false,
          spawnError: null,
        },
        transcript: {
          theoremMarker: NHM2_FORMAL_KERNEL_THEOREM_TRANSCRIPT_MARKER,
          axiomMarker: NHM2_FORMAL_KERNEL_AXIOM_TRANSCRIPT_MARKER,
        },
        outputInventorySha256: outputInventorySha256([output]),
        outputs: [output],
        postRunLedgers: {
          source: ledgerObservation("source"),
          toolchain: ledgerObservation("toolchain"),
          input: ledgerObservation("input"),
        },
      };
    };
    const awaitableStatCache = new Map<string, number>();
    for (const [relativePath, proof] of proofs) {
      awaitableStatCache.set(
        relativePath,
        (await fs.lstat(proof.absolutePath)).mtimeMs,
      );
    }
    const observation: Nhm2FormalKernelExecutionObservationV1 = {
      artifactId: "nhm2.formal_kernel_execution_observation",
      contractVersion: "nhm2_formal_kernel_execution_observation/v1",
      generatedAt: new Date(timeline).toISOString(),
      status: "pass",
      theoremName: NHM2_FORMAL_KERNEL_REQUIRED_THEOREM_NAME,
      executableRole: "lean",
      executables: structuredClone(spec.executor.executables),
      preRunLedgers: {
        source: ledgerObservation("source"),
        toolchain: ledgerObservation("toolchain"),
        input: ledgerObservation("input"),
      },
      replays: [makeReplay(1), makeReplay(2)],
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
    if (input.evidenceStatus === "fail") {
      (
        observation.replayAgreement as unknown as {
          outputInventoriesExact: boolean;
        }
      ).outputInventoriesExact = false;
    }
    const inventorySha256 = sha256(
      `nhm2_formal_outer_inventory/v1\0${JSON.stringify(
        replayEntries.map((entry) => [
          entry.path,
          entry.sha256,
          entry.sizeBytes,
        ]),
      )}`,
    );
    const outer: Nhm2ExperimentReadyTheoryFormalExecutionArtifactV1 = {
      artifactId: NHM2_EXPERIMENT_READY_THEORY_FORMAL_EXECUTION_ARTIFACT_ID,
      contractVersion:
        NHM2_EXPERIMENT_READY_THEORY_FORMAL_EXECUTION_CONTRACT_VERSION,
      generatedAt: observation.generatedAt,
      identity: input.admission.preseal.runSpec.identity,
      inputs: {
        candidateManifest: {
          path: input.admission.manifestPath,
          sha256: input.admission.manifestRawSha256,
          sizeBytes: input.admission.manifestSizeBytes,
        },
        formalRunSpec: {
          path: input.admission.formalRunSpecPath,
          sha256: input.admission.preseal.formalRunSpecSha256,
          sizeBytes: input.admission.preseal.formalRunSpecSizeBytes,
        },
      },
      planRole: "formal_kernel",
      theoremName: NHM2_FORMAL_KERNEL_REQUIRED_THEOREM_NAME,
      replayOutputInventory: {
        algorithm: "sha256_canonical_tuple_list/v1",
        entries: replayEntries,
        inventorySha256,
      },
      executionObservation: observation,
      claimBoundary: FORMAL_CLAIM_BOUNDARY,
    };
    if (input.omitPath !== NHM2_EXPERIMENT_READY_THEORY_FORMAL_OUTER_FILENAME) {
      await writeBytes(
        input.admission.workspaceRoot,
        `${input.admission.outputDirectory}/${NHM2_EXPERIMENT_READY_THEORY_FORMAL_OUTER_FILENAME}`,
        compact(outer),
      );
    }
    const evidence = buildNhm2FormalOuterObservationEvidence({
      executionArtifact: outer,
      executionObservation: observation,
      trustedContext: {
        candidate: {
          candidateId: input.admission.manifest.bindings.candidate.candidateId,
          candidateManifestId: input.admission.manifest.manifestId,
          candidateManifestPath: input.admission.manifestPath,
          candidateManifestSha256: input.admission.manifestRawSha256,
          candidateManifestSizeBytes: input.admission.manifestSizeBytes,
          candidateFrozenAt: input.admission.manifest.frozenAt,
          claimBoundary: input.admission.manifest.claimBoundary,
        },
        formalPlan: input.admission.plan,
        formalRunSpec: {
          path: input.admission.formalRunSpecPath,
          sha256: input.admission.preseal.formalRunSpecSha256,
          sizeBytes: input.admission.preseal.formalRunSpecSizeBytes,
          value: spec,
        },
      },
    });
    if (input.evidenceStatus !== "fail") {
      if (evidence.blockers.length > 0) {
        throw new Error(
          `fixture evidence blockers: ${JSON.stringify(evidence.blockers)}`,
        );
      }
    }
    if (input.omitPath !== "evidence/formal_manifest_certificate.json") {
      await writeBytes(
        input.admission.workspaceRoot,
        `${input.admission.outputDirectory}/evidence/formal_manifest_certificate.json`,
        compact(input.malformedEvidence ? { malformed: true } : evidence),
      );
    }
  }
  if (input.extra) {
    await fs.writeFile(path.join(outputRoot, "extra.bin"), "extra", "utf8");
  }
  if (input.stale) {
    const stale = new Date("2020-01-01T00:00:00.000Z");
    for (const relativePath of NHM2_FORMAL_RUNTIME_OUTPUT_PATHS) {
      await fs.utimes(path.join(outputRoot, relativePath), stale, stale);
    }
  }
}

const successfulSpawn =
  (
    admission: Nhm2FormalRuntimePlanAdmissionV1,
    options: Parameters<typeof writeSuccessfulOutputs>[0] extends infer T
      ? Omit<T & object, "admission">
      : never = {},
  ) =>
  async () => {
    const startedAt = new Date().toISOString();
    await writeSuccessfulOutputs({ admission, ...options });
    const completedAt = new Date().toISOString();
    return {
      startedAt,
      completedAt,
      durationMs: Date.parse(completedAt) - Date.parse(startedAt),
      exitCode: 0,
      stdout: "formal complete",
      stderr: "",
      timedOut: false,
      error: null,
    };
  };

describe("NHM2 dedicated formal runtime admission", () => {
  it("fails typed not_configured before accepting any caller-selected roots", async () => {
    await expect(
      admitNhm2FormalRuntimePlan({ candidateManifestPath: "candidate.json" }),
    ).rejects.toMatchObject({
      name: "Nhm2FormalRuntimeAdmissionError",
      code: "not_configured",
    });
  });

  it("rejects caller root/spec/output injection fields", async () => {
    await expect(
      admitNhm2FormalRuntimePlan(
        {
          candidateManifestPath: "candidate.json",
          trustedToolchainRoot: "caller-root",
        } as never,
        { resolveServerPolicy: async () => ({}) as never },
      ),
    ).rejects.toMatchObject({ code: "launch_input_schema_invalid" });
  });

  it("admits the exact formal bundle, v2 evidence, preseal, and server policy commitment", async () => {
    const value = await fixture();
    const admission = await admit(value);
    expect(admission.approvedToolchain).toMatchObject({
      resolutionAuthority: "server_resolved",
      policyId: "lean-4.31.0-server-fixture-v1",
      policySemanticSha256: "1".repeat(64),
      toolchainLedger: {
        aggregateSha256:
          admission.preseal.runSpec.executor.ledgers.toolchain.ledgerSha256,
        entryCount: 2,
        aggregateBytes: 8,
      },
    });
    expect(admission.expectedEvidence.contractVersion).toBe(
      "nhm2_formal_manifest_certificate/v2",
    );
    expect(admission.formalRunSpecPath).toContain("formal-preseal");
  });

  it("requires pretty-2-space-newline candidate bytes", async () => {
    const value = await fixture({ nonCanonicalCandidate: true });
    await expect(admit(value)).rejects.toMatchObject({
      code: "json_not_canonical",
    });
  });

  it("rejects a primary producer bundle substituted into the formal lane", async () => {
    const value = await fixture({ substitutePrimaryBundle: true });
    await expect(admit(value)).rejects.toMatchObject({
      code: "formal_bundle_identity_invalid",
    });
  });

  it("rejects non-server-computed request identity and policy mismatch", async () => {
    const requestMismatch = await fixture({ requestIdentityMismatch: true });
    await expect(admit(requestMismatch)).rejects.toMatchObject({
      code: "formal_request_identity_invalid",
    });
    const policyMismatch = await fixture();
    await expect(
      admit(policyMismatch, { policyMismatch: true }),
    ).rejects.toMatchObject({ code: "approved_toolchain_policy_mismatch" });
  });
});

describe("NHM2 dedicated formal runtime executor", () => {
  it("digests actual NUL-delimited all-untracked Git porcelain bytes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nhm2-git-status-"));
    roots.push(root);
    await execFileAsync("git", ["init", "--quiet"], {
      cwd: root,
      windowsHide: true,
    });
    const clean = await resolveNhm2FormalRuntimeWorktreeStatus(root);
    expect(clean).toEqual(worktreeStatus());

    await fs.writeFile(path.join(root, "untracked.txt"), "bound\n", "utf8");
    const observed = await resolveNhm2FormalRuntimeWorktreeStatus(root);
    expect(observed).toEqual(worktreeStatus(["?? untracked.txt"]));
  });

  it("persists a successful exact-four receipt outside the run directory with every promotion authority false", async () => {
    const value = await fixture();
    const admission = await admit(value);
    const result = await executeNhm2FormalRuntime(
      { candidateManifestPath: value.candidatePath },
      {
        projectRoot: value.root,
        admit: async () => admission,
        resolveSourceState: async () => sourceState,
        resolveWorktreeStatus: resolveCleanWorktreeStatus,
        spawnExecutor: successfulSpawn(admission),
      },
    );
    expect(
      result.receiptV1.status,
      JSON.stringify({
        warnings: result.receiptV1.outputs.warnings,
        executionError: result.execution.error,
      }),
    ).toBe("completed");
    expect(result.receiptV1.outputs.artifacts).toHaveLength(4);
    expect(result.receiptV1.outputs.artifactManifest).toMatchObject({
      boundToExecution: true,
      gitSha: sourceState.head,
      requestId: admission.plan.requestId,
      runtimeId: admission.plan.runtimeId,
      outputDirectory: admission.outputDirectory,
      entries: expect.arrayContaining([
        expect.objectContaining({ freshness: "new" }),
      ]),
      freshnessProof: expect.objectContaining({
        beforeEntries: [],
      }),
    });
    expect(result.receiptV1.outputs.artifactManifest?.entries).toHaveLength(4);
    const filesystem = await verifyTheoryRuntimeReceiptFilesystem({
      projectRoot: value.root,
      receipt: result.receiptV1,
    });
    expect(filesystem).toMatchObject({
      ok: true,
      blockers: [],
      freshnessProofVerified: true,
    });
    expect(filesystem.files).toHaveLength(4);
    expect(result.receiptV1.outputs.gates.formal_v2_evidence).toBe("pass");
    expect(result.receiptV1.args).toMatchObject({
      serverPolicyResolution: "server_resolved",
      approvedPolicyId: "lean-4.31.0-server-fixture-v1",
      approvedPolicySemanticSha256: "1".repeat(64),
      approvedToolchainLedgerSha256:
        admission.preseal.runSpec.executor.ledgers.toolchain.ledgerSha256,
      approvedToolchainLedgerEntryCount: 2,
      approvedToolchainLedgerAggregateBytes: 8,
      candidateId: admission.manifest.bindings.candidate.candidateId,
      selectedProfileId: admission.manifest.bindings.profile.selectedProfileId,
      chartId: admission.manifest.bindings.chart.chartId,
      atlasSha256: admission.manifest.bindings.atlas.sha256,
      unitsSha256: admission.manifest.bindings.units.sha256,
      normalizationSha256: admission.manifest.bindings.normalization.sha256,
      worktreeStatusAlgorithm:
        "git_status_porcelain_v1_z_untracked_all_sha256/v1",
      baselinePorcelainSha256: sha256(Buffer.alloc(0)),
      baselinePorcelainRecordsJson: "[]",
      preSpawnPorcelainSha256: sha256(Buffer.alloc(0)),
      preSpawnAuthorizedUntrackedPathsJson: "[]",
      finalizedPorcelainSha256: sha256(Buffer.alloc(0)),
      finalizedAuthorizedUntrackedPathsJson: "[]",
    });
    expect(result.receiptV1.outputs.scalars).toMatchObject({
      numericalPhysicsValidated: false,
      theoryClosureEstablished: false,
      empiricalValidationEstablished: false,
      physicalViabilityEstablished: false,
      transportEstablished: false,
      propulsionEstablished: false,
      routeEtaEstablished: false,
      speedAuthorityEstablished: false,
      baselineWorktreeClean: true,
      authorizedWorktreeDeltaVerified: true,
    });
    expect(
      path.relative(
        path.resolve(value.root, admission.outputDirectory),
        path.resolve(value.root, result.receiptArtifact.path),
      ),
    ).toMatch(/^\.\./);
  });

  it("does not infer a clean worktree from trackedClean when porcelain has a baseline delta", async () => {
    const value = await fixture();
    const admission = await admit(value);

    await expect(
      executeNhm2FormalRuntime(
        { candidateManifestPath: value.candidatePath },
        {
          projectRoot: value.root,
          admit: async () => admission,
          resolveSourceState: async () => sourceState,
          resolveWorktreeStatus: async () =>
            worktreeStatus(["?? adversarial-untracked.txt"]),
          spawnExecutor: async () => {
            throw new Error("must not spawn from a dirty baseline");
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "worktree_baseline_not_clean",
    });
  });

  it("rejects a staged or tracked porcelain delta introduced before spawn", async () => {
    const value = await fixture();
    const admission = await admit(value);
    let statusCall = 0;

    await expect(
      executeNhm2FormalRuntime(
        { candidateManifestPath: value.candidatePath },
        {
          projectRoot: value.root,
          admit: async () => admission,
          resolveSourceState: async () => sourceState,
          resolveWorktreeStatus: async () => {
            statusCall += 1;
            return statusCall === 1
              ? worktreeStatus()
              : worktreeStatus(["M  shared/adversarial.ts"]);
          },
          spawnExecutor: async () => {
            throw new Error("must not spawn with an unauthorized delta");
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "worktree_delta_unauthorized",
    });
  });

  it("terminalizes a transient final porcelain delta instead of retaining clean provenance", async () => {
    const value = await fixture();
    const admission = await admit(value);
    let statusCall = 0;
    const result = await executeNhm2FormalRuntime(
      { candidateManifestPath: value.candidatePath },
      {
        projectRoot: value.root,
        admit: async () => admission,
        resolveSourceState: async () => sourceState,
        resolveWorktreeStatus: async () => {
          statusCall += 1;
          return statusCall < 3
            ? worktreeStatus()
            : worktreeStatus(["?? adversarial-final.txt"]);
        },
        spawnExecutor: successfulSpawn(admission),
      },
    );

    expect(result.receiptV1.status).toBe("failed");
    expect(result.receiptV1.provenance.gitSha).toBeNull();
    expect(result.receiptV1.outputs.gates.runtime_execution_provenance).toBe(
      "not_ready",
    );
    expect(result.receiptV1.args.finalizedPorcelainSha256).toBe(
      worktreeStatus(["?? adversarial-final.txt"]).rawSha256,
    );
    expect(result.receiptV1.args.finalizedAuthorizedUntrackedPathsJson).toBe(
      "[]",
    );
  });

  it.each([
    ["missing", { omitPath: "replay-two/proof.olean" }],
    ["extra", { extra: true }],
    ["stale", { stale: true }],
    ["malformed evidence", { malformedEvidence: true }],
    ["fail evidence", { evidenceStatus: "fail" as const }],
  ])(
    "terminalizes %s output as failed/not_ready",
    async (_label, outputOptions) => {
      const value = await fixture();
      const admission = await admit(value);
      const result = await executeNhm2FormalRuntime(
        { candidateManifestPath: value.candidatePath },
        {
          projectRoot: value.root,
          admit: async () => admission,
          resolveSourceState: async () => sourceState,
          resolveWorktreeStatus: resolveCleanWorktreeStatus,
          spawnExecutor: successfulSpawn(admission, outputOptions),
        },
      );
      expect(result.receiptV1.status).toBe("failed");
      expect(result.receiptV1.outputs.gates.formal_v2_evidence).toBe(
        "not_ready",
      );
      expect(result.receiptV1.outputs.gates.physical_viability).toBe(
        "not_ready",
      );
      expect(Object.values(result.receiptV1.outputs.gates)).not.toContain(
        "fail",
      );
    },
  );

  it("maps a child nonzero exit to failed/not_ready, never falsification", async () => {
    const value = await fixture();
    const admission = await admit(value);
    const result = await executeNhm2FormalRuntime(
      { candidateManifestPath: value.candidatePath },
      {
        projectRoot: value.root,
        admit: async () => admission,
        resolveSourceState: async () => sourceState,
        resolveWorktreeStatus: resolveCleanWorktreeStatus,
        spawnExecutor: async () => ({
          startedAt: new Date(Date.now() - 10).toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 10,
          exitCode: 9,
          stdout: "",
          stderr: "Lean failed",
          timedOut: false,
          error: null,
        }),
      },
    );
    expect(result.receiptV1.status).toBe("failed");
    expect(result.receiptV1.outputs.missingSignals).toContain(
      "formal_child_nonzero",
    );
    expect(Object.values(result.receiptV1.outputs.gates)).not.toContain("fail");
  });

  it("detects admitted-input mutation and prevents a double launch", async () => {
    const value = await fixture();
    const admission = await admit(value);
    const first = await executeNhm2FormalRuntime(
      { candidateManifestPath: value.candidatePath },
      {
        projectRoot: value.root,
        admit: async () => admission,
        resolveSourceState: async () => sourceState,
        resolveWorktreeStatus: resolveCleanWorktreeStatus,
        spawnExecutor: async () => {
          await fs.appendFile(value.candidateAbsolutePath, " ", "utf8");
          return {
            startedAt: new Date(Date.now() - 10).toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: 10,
            exitCode: 0,
            stdout: "",
            stderr: "",
            timedOut: false,
            error: null,
          };
        },
      },
    );
    expect(first.receiptV1.status).toBe("failed");
    expect(first.receiptV1.outputs.gates.formal_runtime_completion).toBe(
      "not_ready",
    );
    await expect(
      executeNhm2FormalRuntime(
        { candidateManifestPath: value.candidatePath },
        {
          projectRoot: value.root,
          admit: async () => admission,
          resolveSourceState: async () => sourceState,
          resolveWorktreeStatus: resolveCleanWorktreeStatus,
          spawnExecutor: async () => {
            throw new Error("must not spawn twice");
          },
        },
      ),
    ).rejects.toMatchObject({
      name: "Nhm2FormalRuntimeExecutorError",
      code: "request_already_launched",
    });
  });
});
