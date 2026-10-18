import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NHM2_ALPHA07_PACKAGE_DIRECTORY } from "../../../../shared/theory/nhm2-alpha07-historical-import-governance";
import {
  NHM2_EXPERIMENT_READY_THEORY_PACKAGER_SOURCE_PATHS,
  NHM2_EXPERIMENT_READY_THEORY_PRIMARY_BUNDLE_SOURCE_PATHS,
  prepareNhm2ExperimentReadyTheoryCandidate,
  type PreparedNhm2ExperimentReadyTheoryCandidate,
} from "../../../../tools/nhm2/prepare-experiment-ready-theory-candidate";
import { admitNhm2TheoryCandidatePlan } from "../nhm2-theory-candidate-plan-admission";

const execFileAsync = promisify(execFile);
const sourceRepoRoot = path.resolve(process.cwd());
const frozenAt = "2026-07-19T16:00:00.000Z";
const executionStartsAt = "2026-07-19T16:01:00.000Z";
const outputBase =
  "artifacts/research/full-solve/experiment-ready-theory-admission-spec";

let repoRoot = "";
let prepared: PreparedNhm2ExperimentReadyTheoryCandidate;

const copyRepoPath = async (repoPath: string): Promise<void> => {
  const source = path.resolve(sourceRepoRoot, ...repoPath.split("/"));
  const destination = path.resolve(repoRoot, ...repoPath.split("/"));
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const stat = await fs.stat(source);
  if (stat.isDirectory()) {
    await fs.cp(source, destination, { recursive: true });
  } else {
    await fs.copyFile(source, destination);
  }
};

const absolute = (repoPath: string): string =>
  path.resolve(repoRoot, ...repoPath.split("/"));

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

describe("NHM2 theory-candidate plan admission", () => {
  beforeAll(async () => {
    repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nhm2-admission-spec-"));
    await Promise.all([
      copyRepoPath(".gitignore"),
      copyRepoPath(NHM2_ALPHA07_PACKAGE_DIRECTORY),
      copyRepoPath(
        "artifacts/research/full-solve/profile-search/nhm2-profile-campaign-frontier-latest.json",
      ),
      copyRepoPath("package.json"),
      copyRepoPath("package-lock.json"),
      copyRepoPath("tools/nhm2/build-regional-full-tensor-residual.ts"),
      copyRepoPath("tools/nhm2/emit-lean-campaign-certificate.ts"),
      ...Array.from(
        new Set([
          ...NHM2_EXPERIMENT_READY_THEORY_PACKAGER_SOURCE_PATHS,
          ...NHM2_EXPERIMENT_READY_THEORY_PRIMARY_BUNDLE_SOURCE_PATHS,
        ]),
      ).map(copyRepoPath),
    ]);
    await execFileAsync("git", ["init"], { cwd: repoRoot });
    await execFileAsync("git", ["config", "core.autocrlf", "false"], {
      cwd: repoRoot,
    });
    await execFileAsync("git", ["config", "user.name", "NHM2 Admission Spec"], {
      cwd: repoRoot,
    });
    await execFileAsync(
      "git",
      ["config", "user.email", "nhm2-admission@example.invalid"],
      { cwd: repoRoot },
    );
    await execFileAsync("git", ["add", "--all"], { cwd: repoRoot });
    await execFileAsync(
      "git",
      ["commit", "--no-gpg-sign", "-m", "admission fixture"],
      { cwd: repoRoot },
    );
    prepared = await prepareNhm2ExperimentReadyTheoryCandidate({
      repoRoot,
      outputBaseDirectory: outputBase,
      manifestId: `nhm2-admission-${randomBytes(6).toString("hex")}`,
      frozenAt,
      dataCollectionOpensAt: "2026-07-20T16:00:00.000Z",
    });
  }, 60_000);

  afterAll(async () => {
    const relative = path.relative(os.tmpdir(), repoRoot);
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      !path.basename(repoRoot).startsWith("nhm2-admission-spec-")
    ) {
      throw new Error(
        `refusing to remove unexpected spec repository: ${repoRoot}`,
      );
    }
    await fs.rm(repoRoot, { recursive: true, force: true });
  });

  it("admits only the exact primary plan and resolves the manifest hash before spawn", async () => {
    const admission = await admitNhm2TheoryCandidatePlan({
      projectRoot: repoRoot,
      candidateManifestPath: prepared.manifestPath,
      planRole: "primary_numerical",
      executionStartsAt,
    });

    expect(admission.plan.runtimeId).toBe(
      "nhm2.experiment_ready_theory.primary",
    );
    expect(admission.evidenceOutputs).toHaveLength(9);
    expect(admission.resolvedEnvironment.NHM2_CANDIDATE_MANIFEST_SHA256).toBe(
      prepared.manifestRawSha256,
    );
    expect(admission.predictionFreeze.readiness.predictionFreezeReady).toBe(
      true,
    );
    expect(admission.predictionFreeze.semanticSha256).toBe(
      prepared.manifest.predictionFreezeCommitment.semanticSha256,
    );
    expect(admission.sourceTreeClean).toBe(true);
    expect(admission.pinnedInputs.length).toBeGreaterThan(20);
    expect(admission.primaryProducerBundle).toMatchObject({
      bundle: {
        path: prepared.primaryProducerBundlePath,
        sha256:
          prepared.candidateDefinition.primaryProducerBundle.bundleRef.sha256,
        sizeBytes:
          prepared.candidateDefinition.primaryProducerBundle.bundleRef
            .sizeBytes,
      },
      buildMetadata: {
        path: prepared.primaryProducerBundleBuildMetadataPath,
        bundledSourceClosureComplete: true,
        runtimeNodeModulesRequired: false,
      },
      hostNodeRuntime: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        hostSpecificDiagnosticRuntimeClosure: true,
        operatingSystemHermeticityAsserted: false,
        nodeRuntimeReproducibilityAsserted: false,
      },
    });
    expect(admission.primaryProducerBundle.bundle.absolutePath).toBe(
      absolute(prepared.primaryProducerBundlePath),
    );
    expect(
      admission.primaryProducerBundle.buildMetadata.externalNodeBuiltins.every(
        (entry) => entry.startsWith("node:"),
      ),
    ).toBe(true);
    expect(
      admission.pinnedInputs.some(
        (entry) =>
          entry.path === "tools/nhm2/run-experiment-ready-theory-primary.ts",
      ),
    ).toBe(true);
  });

  it("keeps frozen independent and formal plans closed until their producers are registered", async () => {
    await expect(
      admitNhm2TheoryCandidatePlan({
        projectRoot: repoRoot,
        candidateManifestPath: prepared.manifestPath,
        planRole: "independent_numerical",
        executionStartsAt,
      }),
    ).rejects.toThrow(/no matching registered runtime entrypoint/);
    await expect(
      admitNhm2TheoryCandidatePlan({
        projectRoot: repoRoot,
        candidateManifestPath: prepared.manifestPath,
        planRole: "formal_kernel",
        executionStartsAt,
      }),
    ).rejects.toThrow(/no matching registered runtime entrypoint/);
  });

  it("rejects an invocation that differs from the server-owned command", async () => {
    const manifestFile = absolute(prepared.manifestPath);
    const original = await fs.readFile(manifestFile, "utf8");
    const tampered = JSON.parse(original) as typeof prepared.manifest;
    const primary = tampered.executionPlans.find(
      (entry) => entry.planRole === "primary_numerical",
    );
    if (primary == null) throw new Error("primary fixture plan missing");
    primary.expectedInvocation.entrypoint = "npm run untrusted:runtime";
    await fs.writeFile(
      manifestFile,
      `${JSON.stringify(tampered, null, 2)}\n`,
      "utf8",
    );
    try {
      await expect(
        admitNhm2TheoryCandidatePlan({
          projectRoot: repoRoot,
          candidateManifestPath: prepared.manifestPath,
          planRole: "primary_numerical",
          executionStartsAt,
        }),
      ).rejects.toThrow(/server-owned runtime contract/);
    } finally {
      await fs.writeFile(manifestFile, original, "utf8");
    }
  });

  it("rejects self-consistent descriptors that redirect executable or dependency provenance", async () => {
    const manifestFile = absolute(prepared.manifestPath);
    const originalManifest = await fs.readFile(manifestFile, "utf8");
    const manifest = JSON.parse(originalManifest) as typeof prepared.manifest;
    const primary = manifest.executionPlans.find(
      (entry) => entry.planRole === "primary_numerical",
    );
    if (primary == null) throw new Error("primary fixture plan missing");

    const solverFile = absolute(primary.solver.path);
    const originalSolver = await fs.readFile(solverFile, "utf8");
    const solverDescriptor = JSON.parse(originalSolver) as {
      sourceRef: { path: string };
    };
    solverDescriptor.sourceRef.path = "tools/nhm2/untrusted-primary.ts";
    const redirectedSolver = `${JSON.stringify(solverDescriptor, null, 2)}\n`;
    primary.solver.sha256 = sha256(redirectedSolver);
    await fs.writeFile(solverFile, redirectedSolver, "utf8");
    await fs.writeFile(
      manifestFile,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    try {
      await expect(
        admitNhm2TheoryCandidatePlan({
          projectRoot: repoRoot,
          candidateManifestPath: prepared.manifestPath,
          planRole: "primary_numerical",
          executionStartsAt,
        }),
      ).rejects.toThrow(/does not bind the server-owned executable source/);
    } finally {
      await fs.writeFile(solverFile, originalSolver, "utf8");
      await fs.writeFile(manifestFile, originalManifest, "utf8");
    }

    const environmentManifest = JSON.parse(
      originalManifest,
    ) as typeof prepared.manifest;
    const environmentPrimary = environmentManifest.executionPlans.find(
      (entry) => entry.planRole === "primary_numerical",
    );
    if (environmentPrimary == null)
      throw new Error("primary fixture plan missing");
    const environmentFile = absolute(environmentPrimary.environmentLock.path);
    const originalEnvironment = await fs.readFile(environmentFile, "utf8");
    const environmentDescriptor = JSON.parse(originalEnvironment) as {
      dependencyLockRef: { path: string };
    };
    environmentDescriptor.dependencyLockRef.path = "untrusted-lock.json";
    const redirectedEnvironment = `${JSON.stringify(environmentDescriptor, null, 2)}\n`;
    environmentPrimary.environmentLock.sha256 = sha256(redirectedEnvironment);
    await fs.writeFile(environmentFile, redirectedEnvironment, "utf8");
    await fs.writeFile(
      manifestFile,
      `${JSON.stringify(environmentManifest, null, 2)}\n`,
      "utf8",
    );
    try {
      await expect(
        admitNhm2TheoryCandidatePlan({
          projectRoot: repoRoot,
          candidateManifestPath: prepared.manifestPath,
          planRole: "primary_numerical",
          executionStartsAt,
        }),
      ).rejects.toThrow(/does not bind the server-owned dependency lock/);
    } finally {
      await fs.writeFile(environmentFile, originalEnvironment, "utf8");
      await fs.writeFile(manifestFile, originalManifest, "utf8");
    }
  });

  it("rejects pinned-input tampering and a dirty source tree", async () => {
    const descriptorFile = absolute(prepared.candidateDefinitionPath);
    const originalDescriptor = await fs.readFile(descriptorFile, "utf8");
    await fs.writeFile(descriptorFile, `${originalDescriptor} `, "utf8");
    try {
      await expect(
        admitNhm2TheoryCandidatePlan({
          projectRoot: repoRoot,
          candidateManifestPath: prepared.manifestPath,
          planRole: "primary_numerical",
          executionStartsAt,
        }),
      ).rejects.toThrow(/candidate definition SHA-256 mismatch/);
    } finally {
      await fs.writeFile(descriptorFile, originalDescriptor, "utf8");
    }

    const bundleFile = absolute(prepared.primaryProducerBundlePath);
    const originalBundle = await fs.readFile(bundleFile);
    await fs.writeFile(
      bundleFile,
      Buffer.concat([originalBundle, Buffer.from("\n// tampered\n")]),
    );
    try {
      await expect(
        admitNhm2TheoryCandidatePlan({
          projectRoot: repoRoot,
          candidateManifestPath: prepared.manifestPath,
          planRole: "primary_numerical",
          executionStartsAt,
        }),
      ).rejects.toThrow(/standalone bundle SHA-256 mismatch/);
    } finally {
      await fs.writeFile(bundleFile, originalBundle);
    }

    const dirtyPath = path.join(repoRoot, "untracked-source.txt");
    await fs.writeFile(dirtyPath, "dirty\n", "utf8");
    try {
      await expect(
        admitNhm2TheoryCandidatePlan({
          projectRoot: repoRoot,
          candidateManifestPath: prepared.manifestPath,
          planRole: "primary_numerical",
          executionStartsAt,
        }),
      ).rejects.toThrow(/clean source tree/);
    } finally {
      await fs.unlink(dirtyPath);
    }
  });

  it("rejects a nonempty preallocated output directory", async () => {
    const primary = prepared.manifest.executionPlans.find(
      (entry) => entry.planRole === "primary_numerical",
    );
    if (primary == null) throw new Error("primary fixture plan missing");
    const outputDirectory = absolute(
      primary.expectedInvocation.outputDirectory,
    );
    await fs.mkdir(outputDirectory, { recursive: true });
    await fs.writeFile(
      path.join(outputDirectory, "preexisting.json"),
      "{}\n",
      "utf8",
    );
    try {
      await expect(
        admitNhm2TheoryCandidatePlan({
          projectRoot: repoRoot,
          candidateManifestPath: prepared.manifestPath,
          planRole: "primary_numerical",
          executionStartsAt,
        }),
      ).rejects.toThrow(/must be empty before spawn/);
    } finally {
      await fs.rm(outputDirectory, { recursive: true, force: true });
    }
  });
});
