import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { NHM2_PRIMARY_RAW_OUTPUT_REQUIRED_INPUT_IDS } from "../../../../shared/contracts/nhm2-primary-raw-output-manifest.v1";
import { NHM2_EXPERIMENT_READY_THEORY_CLOSURE_EVIDENCE_CONTRACT_VERSIONS } from "../../../../shared/contracts/nhm2-experiment-ready-theory-closure.v1";
import type { Nhm2TheoryCandidatePlanAdmission } from "../nhm2-theory-candidate-plan-admission";
import type {
  TheoryRuntimeCommandV1,
  TheoryRuntimeExecutionResult,
} from "../runtime-adapters";

const mocks = vi.hoisted(() => ({
  verifyRaw: vi.fn(),
  compileRaw: vi.fn(),
}));

vi.mock("../nhm2-primary-raw-output-filesystem-verifier", async () => {
  const actual = await vi.importActual<
    typeof import("../nhm2-primary-raw-output-filesystem-verifier")
  >("../nhm2-primary-raw-output-filesystem-verifier");
  return {
    ...actual,
    verifyNhm2PrimaryRawOutputFilesystem: mocks.verifyRaw,
  };
});

vi.mock(
  "../nhm2-primary-raw-experiment-ready-evidence-compiler",
  async () => {
    const actual = await vi.importActual<
      typeof import("../nhm2-primary-raw-experiment-ready-evidence-compiler")
    >("../nhm2-primary-raw-experiment-ready-evidence-compiler");
    return {
      ...actual,
      compileNhm2PrimaryRawExperimentReadyEvidenceFromFilesystem:
        mocks.compileRaw,
    };
  },
);

import {
  NHM2_PRIMARY_RAW_EXPERIMENT_READY_EVIDENCE_COMPILER_CONTRACT_VERSION,
  NHM2_PRIMARY_RAW_EXPERIMENT_READY_EVIDENCE_IDS,
  type Nhm2PrimaryRawExperimentReadyEvidenceCompilation,
} from "../nhm2-primary-raw-experiment-ready-evidence-compiler";
import type { Nhm2PrimaryRawOutputFilesystemVerification } from "../nhm2-primary-raw-output-filesystem-verifier";
import {
  compileAndPublishNhm2PrimaryRawRun,
  NHM2_PRIMARY_RAW_OUTPUT_MANIFEST_FILENAME,
} from "../nhm2-primary-raw-run-publisher";

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const outputDirectory = "artifacts/nhm2-primary/raw-publisher-run";
const startedAt = "2026-07-20T12:00:00.000Z";
const completedAt = "2026-07-20T12:00:01.000Z";
const manifestSha256 = "a".repeat(64);
const rawContentClosureSha256 = "b".repeat(64);

type Fixture = {
  projectRoot: string;
  admission: Nhm2TheoryCandidatePlanAdmission;
  command: TheoryRuntimeCommandV1;
  execution: TheoryRuntimeExecutionResult;
};

const temporaryRoots: string[] = [];

afterEach(async () => {
  mocks.verifyRaw.mockReset();
  mocks.compileRaw.mockReset();
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root == null) continue;
    const relative = path.relative(os.tmpdir(), root);
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      !path.basename(root).startsWith("nhm2-raw-publisher-")
    ) {
      throw new Error(`refusing to remove unexpected test root: ${root}`);
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});

const writePinnedInput = async (
  projectRoot: string,
  repoPath: string,
  value: string,
): Promise<string> => {
  const absolute = path.resolve(projectRoot, ...repoPath.split("/"));
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  const bytes = Buffer.from(`${value}\n`, "utf8");
  await fs.writeFile(absolute, bytes);
  return sha256(bytes);
};

const createFixture = async (): Promise<Fixture> => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "nhm2-raw-publisher-"),
  );
  temporaryRoots.push(projectRoot);
  const paths = {
    candidateManifest: "inputs/candidate-manifest.json",
    selectedProfile: "inputs/selected-profile.json",
    chartDefinition: "inputs/chart-definition.json",
    atlas: "inputs/atlas.json",
    units: "inputs/units.json",
    normalization: "inputs/normalization.json",
    solver: "toolchain/solver.json",
    environment: "toolchain/environment.json",
    producerBundle: "toolchain/producer-bundle.mjs",
  } as const;
  const hashes = Object.fromEntries(
    await Promise.all(
      Object.entries(paths).map(async ([key, repoPath]) => [
        key,
        await writePinnedInput(projectRoot, repoPath, key),
      ]),
    ),
  ) as Record<keyof typeof paths, string>;
  await fs.mkdir(path.resolve(projectRoot, outputDirectory), {
    recursive: true,
  });
  await fs.writeFile(
    path.resolve(
      projectRoot,
      outputDirectory,
      NHM2_PRIMARY_RAW_OUTPUT_MANIFEST_FILENAME,
    ),
    "{}\n",
    "utf8",
  );

  const plan = {
    planRole: "primary_numerical",
    requestId: "request-primary-raw-publisher",
    runId: "run-primary-raw-publisher",
    runtimeId: "nhm2.experiment_ready.primary",
    receiptId: "receipt-primary-raw-publisher",
    sourceCommitSha: "c".repeat(40),
    solver: {
      solverId: "deterministic-test-solver",
      solverVersion: "1.0.0",
      implementationId: "deterministic-test-implementation",
      path: paths.solver,
      sha256: hashes.solver,
    },
    environmentLock: {
      environmentId: "deterministic-test-environment",
      path: paths.environment,
      sha256: hashes.environment,
    },
    deterministicSeedPolicy: {
      algorithm: "fixed_uint32",
      seed: 7,
    },
  };
  const evidenceOutputs = [
    ...NHM2_PRIMARY_RAW_EXPERIMENT_READY_EVIDENCE_IDS,
    "prediction_falsifier_freeze" as const,
  ].map((evidenceRole) => ({
    evidenceRole,
    outputPath: `${outputDirectory}/evidence/${evidenceRole}.json`,
    contractVersion:
      NHM2_EXPERIMENT_READY_THEORY_CLOSURE_EVIDENCE_CONTRACT_VERSIONS[
        evidenceRole
      ],
    requestId: plan.requestId,
    runId: plan.runId,
    receiptId: plan.receiptId,
    runtimeId: plan.runtimeId,
  }));
  const admission = {
    manifestPath: paths.candidateManifest,
    manifestRawSha256: hashes.candidateManifest,
    outputDirectory,
    manifest: {
      bindings: {
        candidate: { candidateId: "candidate-primary-raw-publisher" },
        profile: {
          selectedProfileId: "profile-primary-raw-publisher",
          path: paths.selectedProfile,
          sha256: hashes.selectedProfile,
        },
        chart: {
          chartId: "comoving_cartesian",
          path: paths.chartDefinition,
          sha256: hashes.chartDefinition,
        },
        atlas: { path: paths.atlas, sha256: hashes.atlas },
        units: { path: paths.units, sha256: hashes.units },
        normalization: {
          path: paths.normalization,
          sha256: hashes.normalization,
        },
      },
    },
    plan,
    evidenceOutputs,
    predictionFreeze: {
      contractVersion:
        NHM2_EXPERIMENT_READY_THEORY_CLOSURE_EVIDENCE_CONTRACT_VERSIONS.prediction_falsifier_freeze,
      readiness: {
        predictionFreezeReady: false,
        blockers: ["deterministic_test_prediction_not_ready"],
      },
    },
    primaryProducerBundle: {
      bundle: {
        path: paths.producerBundle,
        sha256: hashes.producerBundle,
      },
    },
  } as unknown as Nhm2TheoryCandidatePlanAdmission;
  return {
    projectRoot,
    admission,
    command: {
      command: "node",
      args: ["producer-bundle.mjs"],
      cwd: ".",
      npmScript: "nhm2:test-primary",
      timeoutMs: 5_000,
    },
    execution: {
      startedAt,
      completedAt,
      durationMs: 1_000,
      exitCode: 0,
      stdout: JSON.stringify({ status: "pass", physicalViability: true }),
      stderr: "",
      timedOut: false,
      error: null,
    },
  };
};

const verifiedRaw = (
  fixture: Fixture,
): Extract<Nhm2PrimaryRawOutputFilesystemVerification, { verified: true }> =>
  ({
    verified: true,
    violations: [],
    runRootRealPath: path.resolve(fixture.projectRoot, outputDirectory),
    manifestPath: path.resolve(
      fixture.projectRoot,
      outputDirectory,
      NHM2_PRIMARY_RAW_OUTPUT_MANIFEST_FILENAME,
    ),
    manifestSha256,
    manifest: {
      identity: {
        candidateId: fixture.admission.manifest.bindings.candidate.candidateId,
      },
      execution: {
        runId: fixture.admission.plan.runId,
        startedAt,
        completedAt,
        durationMs: 1_000,
      },
    },
    files: [],
  }) as unknown as Extract<
    Nhm2PrimaryRawOutputFilesystemVerification,
    { verified: true }
  >;

const closedClaimBoundary = () => ({
  diagnosticReplayOnly: true as const,
  experimentReadyTheoryClosureClaimAllowed: false as const,
  theoryClosureEstablished: false as const,
  physicalViabilityEstablished: false as const,
  transportEstablished: false as const,
  propulsionEstablished: false as const,
  routeEtaEstablished: false as const,
  certifiedSpeedEstablished: false as const,
  empiricalValidationEstablished: false as const,
  empiricalReceiptsRequired: true as const,
});

const blockedCompilation = (
  fixture: Fixture,
): Nhm2PrimaryRawExperimentReadyEvidenceCompilation => {
  const evidence = Object.fromEntries(
    NHM2_PRIMARY_RAW_EXPERIMENT_READY_EVIDENCE_IDS.map((evidenceRole) => [
      evidenceRole,
      {
        status: "blocked",
        ready: false,
        artifact: {
          contractVersion:
            NHM2_EXPERIMENT_READY_THEORY_CLOSURE_EVIDENCE_CONTRACT_VERSIONS[
              evidenceRole
            ],
          status: "blocked",
        },
        replayMetrics: {},
        rawFileBindings: [],
        blockers: [`deterministic_test_blocker:${evidenceRole}`],
        failures: [],
      },
    ]),
  );
  return {
    contractVersion:
      NHM2_PRIMARY_RAW_EXPERIMENT_READY_EVIDENCE_COMPILER_CONTRACT_VERSION,
    status: "blocked",
    acceptedInput: true,
    source: {
      candidateId: fixture.admission.manifest.bindings.candidate.candidateId,
      runId: fixture.admission.plan.runId,
      manifestSha256,
      rawContentClosureSha256,
    },
    replayIntegrity: {
      grProvidedSha256: "d".repeat(64),
      grRecomputedSha256: "d".repeat(64),
      grExactMatch: true,
      materialDynamicsProvidedSha256: "e".repeat(64),
      materialDynamicsRecomputedSha256: "e".repeat(64),
      materialDynamicsExactMatch: true,
    },
    evidence,
    blockers: ["deterministic_test_blocker"],
    failures: [],
    unresolvedKernelBlockers: ["deterministic_test_blocker"],
    claimBoundary: closedClaimBoundary(),
  } as unknown as Nhm2PrimaryRawExperimentReadyEvidenceCompilation;
};

const evidenceInventory = async (fixture: Fixture): Promise<string[]> => {
  const evidenceDirectory = path.resolve(
    fixture.projectRoot,
    outputDirectory,
    "evidence",
  );
  try {
    return (await fs.readdir(evidenceDirectory)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
};

describe("server-owned NHM2 primary raw-run publisher", () => {
  it.each([
    ["missing fixed manifest", { code: "filesystem_missing_file" }],
    ["tampered raw hash", { code: "file_sha256_mismatch" }],
    [
      "tampered child interval",
      { code: "trusted_binding_mismatch", field: "executionInterval" },
    ],
    [
      "caller-authored pass field",
      { code: "record_schema_fields_mismatch", field: "status" },
    ],
  ])(
    "fails closed before compilation or publication for %s",
    async (_label, violation) => {
      const fixture = await createFixture();
      mocks.verifyRaw.mockResolvedValue({
        verified: false,
        violations: [violation],
        runRootRealPath: path.resolve(fixture.projectRoot, outputDirectory),
        manifestPath: null,
        manifestSha256: null,
        manifest: null,
        files: [],
      });

      await expect(
        compileAndPublishNhm2PrimaryRawRun(fixture),
      ).rejects.toThrow(/primary raw filesystem verification failed/i);
      expect(mocks.compileRaw).not.toHaveBeenCalled();
      expect(await evidenceInventory(fixture)).toEqual([]);
    },
  );

  it.each([
    [
      "compiler replay source hash",
      (compilation: Nhm2PrimaryRawExperimentReadyEvidenceCompilation) => {
        compilation.source.manifestSha256 = "f".repeat(64);
      },
      /source does not match/i,
    ],
    [
      "canonical contract version",
      (compilation: Nhm2PrimaryRawExperimentReadyEvidenceCompilation) => {
        compilation.evidence.full_apparatus_source_tensor.artifact = {
          ...compilation.evidence.full_apparatus_source_tensor.artifact,
          contractVersion: "legacy_child_contract/v0",
        } as never;
      },
      /contract version is not the admitted canonical version/i,
    ],
    [
      "replayed disposition",
      (compilation: Nhm2PrimaryRawExperimentReadyEvidenceCompilation) => {
        compilation.evidence.full_apparatus_source_tensor.artifact = {
          ...compilation.evidence.full_apparatus_source_tensor.artifact,
          status: "pass",
        } as never;
      },
      /status is inconsistent/i,
    ],
  ])(
    "preflights %s before creating any governed root",
    async (_label, mutate, expected) => {
      const fixture = await createFixture();
      const compilation = blockedCompilation(fixture);
      mutate(compilation);
      mocks.verifyRaw.mockResolvedValue(verifiedRaw(fixture));
      mocks.compileRaw.mockResolvedValue(compilation);

      await expect(
        compileAndPublishNhm2PrimaryRawRun(fixture),
      ).rejects.toThrow(expected);
      expect(await evidenceInventory(fixture)).toEqual([]);
    },
  );

  it("does not overwrite or legitimize a legacy child-authored governed root", async () => {
    const fixture = await createFixture();
    const legacyPath = path.resolve(
      fixture.projectRoot,
      outputDirectory,
      "evidence",
      "full_apparatus_source_tensor.json",
    );
    await fs.mkdir(path.dirname(legacyPath), { recursive: true });
    const legacyBytes = Buffer.from(
      '{"status":"pass","physicalViability":true}\n',
      "utf8",
    );
    await fs.writeFile(legacyPath, legacyBytes);
    mocks.verifyRaw.mockResolvedValue(verifiedRaw(fixture));
    mocks.compileRaw.mockResolvedValue(blockedCompilation(fixture));

    await expect(
      compileAndPublishNhm2PrimaryRawRun(fixture),
    ).rejects.toThrow(/server-governed evidence root already exists/i);
    expect(await fs.readFile(legacyPath)).toEqual(legacyBytes);
    expect(await evidenceInventory(fixture)).toEqual([
      "full_apparatus_source_tensor.json",
    ]);
  });

  it("exclusively publishes exactly nine canonical roots after verified replay and ignores stdout pass claims", async () => {
    const fixture = await createFixture();
    mocks.verifyRaw.mockResolvedValue(verifiedRaw(fixture));
    mocks.compileRaw.mockResolvedValue(blockedCompilation(fixture));

    const publication = await compileAndPublishNhm2PrimaryRawRun(fixture);

    expect(publication.status).toBe("not_ready");
    expect(publication.artifacts).toHaveLength(9);
    expect(publication.artifacts.map((entry) => entry.evidenceRole).sort()).toEqual(
      [
        ...NHM2_PRIMARY_RAW_EXPERIMENT_READY_EVIDENCE_IDS,
        "prediction_falsifier_freeze",
      ].sort(),
    );
    expect(
      publication.artifacts
        .filter(
          (entry) => entry.evidenceRole !== "prediction_falsifier_freeze",
        )
        .every((entry) => entry.disposition === "blocked"),
    ).toBe(true);
    expect(
      publication.artifacts.find(
        (entry) => entry.evidenceRole === "prediction_falsifier_freeze",
      )?.disposition,
    ).toBe("not_ready");
    expect(await evidenceInventory(fixture)).toEqual(
      publication.artifacts
        .map((entry) => `${entry.evidenceRole}.json`)
        .sort(),
    );
    for (const artifact of publication.artifacts) {
      const bytes = await fs.readFile(
        path.resolve(fixture.projectRoot, artifact.outputPath),
      );
      expect(artifact.sha256).toBe(sha256(bytes));
      expect(artifact.contractVersion).toBe(
        NHM2_EXPERIMENT_READY_THEORY_CLOSURE_EVIDENCE_CONTRACT_VERSIONS[
          artifact.evidenceRole
        ],
      );
    }
  });
});
