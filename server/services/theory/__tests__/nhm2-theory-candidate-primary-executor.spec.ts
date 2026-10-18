import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isTheoryRuntimeReceiptV1 } from "../../../../shared/contracts/theory-runtime-receipt.v1";
import { NHM2_ALPHA07_PACKAGE_DIRECTORY } from "../../../../shared/theory/nhm2-alpha07-historical-import-governance";
import { getTheoryRuntimeEntrypoint } from "../../../../shared/theory/runtime-entrypoints";
import {
  NHM2_EXPERIMENT_READY_THEORY_PACKAGER_SOURCE_PATHS,
  NHM2_EXPERIMENT_READY_THEORY_PRIMARY_BUNDLE_SOURCE_PATHS,
  prepareNhm2ExperimentReadyTheoryCandidate,
  type PreparedNhm2ExperimentReadyTheoryCandidate,
} from "../../../../tools/nhm2/prepare-experiment-ready-theory-candidate";
import { runNhm2LegacyGovernedPrimaryScaffoldForContractTest } from "../../../../tools/nhm2/run-experiment-ready-theory-primary";
import type {
  TheoryRuntimeCommandV1,
  TheoryRuntimeExecutionResult,
} from "../runtime-adapters";
import { writeTheoryRuntimePreSpawnSnapshotCommitment } from "../runtime-artifact-manifest";
import {
  createTheoryRuntimeRunRequestManifest,
  readTheoryRuntimeRunRequestStatus,
  updateTheoryRuntimeRunRequestStatus,
} from "../theory-runtime-run-request-manifest";
import { verifyTheoryRuntimeReceiptFilesystem } from "../theory-runtime-receipt-filesystem-verifier";
import {
  deriveNhm2PrimaryProducerSummaryStatus,
  executeNhm2TheoryCandidatePrimary,
  projectNhm2PrimaryNumericalStatus,
  verifyNhm2PrimaryRunOwnedReferenceClosure,
} from "../nhm2-theory-candidate-primary-executor";
import { NHM2_PRIMARY_OUTER_LAUNCH_HANDLER_ID } from "../runtime-jobs/nhm2-primary-runtime-dispatch";

const execFileAsync = promisify(execFile);
const sourceRepoRoot = path.resolve(process.cwd());
const frozenAt = "2026-07-18T16:00:00.000Z";
const dataCollectionOpensAt = "2026-07-20T16:00:00.000Z";

const primaryArtifactDispositions = (
  physics: "pass" | "blocked" | "fail",
  prediction: "ready" | "not_ready",
) => [
  { evidenceRole: "full_apparatus_source_tensor", disposition: physics },
  { evidenceRole: "semiclassical_state", disposition: physics },
  { evidenceRole: "covariant_conservation", disposition: physics },
  { evidenceRole: "continuous_observer_optimizer", disposition: physics },
  { evidenceRole: "worldline_qei", disposition: physics },
  {
    evidenceRole: "dynamic_backreaction_stability_causality",
    disposition: physics,
  },
  {
    evidenceRole: "finite_temperature_finite_geometry_maxwell_stress",
    disposition: physics,
  },
  { evidenceRole: "mechanical_support_control_margin", disposition: physics },
  { evidenceRole: "prediction_falsifier_freeze", disposition: prediction },
];

describe("NHM2 primary numerical summary semantics", () => {
  it("derives ready, not-ready, and falsified states without widening claim authority", () => {
    expect(
      deriveNhm2PrimaryProducerSummaryStatus(
        primaryArtifactDispositions("pass", "ready"),
      ),
    ).toBe("ready");
    expect(
      deriveNhm2PrimaryProducerSummaryStatus(
        primaryArtifactDispositions("blocked", "ready"),
      ),
    ).toBe("not_ready");
    expect(
      deriveNhm2PrimaryProducerSummaryStatus(
        primaryArtifactDispositions("pass", "not_ready"),
      ),
    ).toBe("not_ready");
    expect(
      deriveNhm2PrimaryProducerSummaryStatus(
        primaryArtifactDispositions("fail", "ready"),
      ),
    ).toBe("falsified");

    expect(
      projectNhm2PrimaryNumericalStatus({ status: "ready", blockers: [] }),
    ).toEqual({
      gate: "pass",
      primaryNumericalReady: true,
      primaryNumericalFalsified: false,
      missingSignals: [],
    });
    expect(
      projectNhm2PrimaryNumericalStatus({
        status: "not_ready",
        blockers: ["solver_output_missing"],
      }),
    ).toEqual({
      gate: "not_ready",
      primaryNumericalReady: false,
      primaryNumericalFalsified: false,
      missingSignals: [
        "primary_numerical_evidence_not_ready",
        "solver_output_missing",
      ],
    });
    expect(
      projectNhm2PrimaryNumericalStatus({
        status: "falsified",
        blockers: ["frozen_threshold_failed"],
      }),
    ).toEqual({
      gate: "fail",
      primaryNumericalReady: false,
      primaryNumericalFalsified: true,
      missingSignals: [
        "primary_numerical_evidence_falsified",
        "frozen_threshold_failed",
      ],
    });
    expect(() =>
      projectNhm2PrimaryNumericalStatus({
        status: "ready",
        blockers: ["stale_blocker"],
      }),
    ).toThrow(/ready.*cannot retain blockers/i);
  });

  it("closes supplementary run-owned arrays through hash-bearing nested references", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "n2e-ref-"));
    try {
      const outputDirectory = "run-output";
      const ledgerPath = `${outputDirectory}/ledgers/array-ledger.json`;
      const arrayPath = `${outputDirectory}/arrays/tensor.f64`;
      const arrayBytes = Buffer.from("fresh-run-array", "utf8");
      const ledgerBytes = Buffer.from(
        `${JSON.stringify({ array: { path: arrayPath, sha256: `sha256:${sha256(arrayBytes)}` } })}\n`,
        "utf8",
      );
      await fs.mkdir(path.resolve(projectRoot, outputDirectory), {
        recursive: true,
      });
      await fs.mkdir(path.dirname(path.resolve(projectRoot, ledgerPath)), {
        recursive: true,
      });
      await fs.mkdir(path.dirname(path.resolve(projectRoot, arrayPath)), {
        recursive: true,
      });
      await fs.writeFile(path.resolve(projectRoot, ledgerPath), ledgerBytes);
      await fs.writeFile(path.resolve(projectRoot, arrayPath), arrayBytes);

      const rootPaths = Array.from(
        { length: 9 },
        (_, index) => `${outputDirectory}/evidence/root-${index}.json`,
      );
      const rootEntries = [];
      for (const [index, rootPath] of rootPaths.entries()) {
        const bytes = Buffer.from(
          `${JSON.stringify(
            index === 0
              ? { ledger: { path: ledgerPath, sha256: sha256(ledgerBytes) } }
              : { root: index },
          )}\n`,
          "utf8",
        );
        await fs.mkdir(path.dirname(path.resolve(projectRoot, rootPath)), {
          recursive: true,
        });
        await fs.writeFile(path.resolve(projectRoot, rootPath), bytes);
        rootEntries.push({
          path: rootPath,
          sha256: sha256(bytes),
          sizeBytes: bytes.byteLength,
          modifiedAt: "2026-07-19T16:00:00.000Z",
          freshness: "new" as const,
        });
      }
      const entries = [
        ...rootEntries,
        {
          path: ledgerPath,
          sha256: sha256(ledgerBytes),
          sizeBytes: ledgerBytes.byteLength,
          modifiedAt: "2026-07-19T16:00:00.000Z",
          freshness: "new" as const,
        },
        {
          path: arrayPath,
          sha256: sha256(arrayBytes),
          sizeBytes: arrayBytes.byteLength,
          modifiedAt: "2026-07-19T16:00:00.000Z",
          freshness: "new" as const,
        },
      ];

      await expect(
        verifyNhm2PrimaryRunOwnedReferenceClosure({
          projectRoot,
          outputDirectory,
          rootPaths,
          entries,
        }),
      ).resolves.toMatchObject({
        rootCount: 9,
        supplementaryCount: 2,
        referencedPaths: expect.arrayContaining([ledgerPath, arrayPath]),
      });

      const orphanPath = `${outputDirectory}/arrays/orphan.f64`;
      const orphanBytes = Buffer.from("orphan", "utf8");
      await fs.writeFile(path.resolve(projectRoot, orphanPath), orphanBytes);
      await expect(
        verifyNhm2PrimaryRunOwnedReferenceClosure({
          projectRoot,
          outputDirectory,
          rootPaths,
          entries: [
            ...entries,
            {
              path: orphanPath,
              sha256: sha256(orphanBytes),
              sizeBytes: orphanBytes.byteLength,
              modifiedAt: "2026-07-19T16:00:00.000Z",
              freshness: "new",
            },
          ],
        }),
      ).rejects.toThrow(/unreferenced run-owned files.*orphan/i);

      const hardLinkSourcePath = path.resolve(
        projectRoot,
        "hard-link-source.f64",
      );
      const hardLinkPath = `${outputDirectory}/arrays/hard-link.f64`;
      const hardLinkBytes = Buffer.from("hard-link", "utf8");
      await fs.writeFile(hardLinkSourcePath, hardLinkBytes);
      await fs.link(
        hardLinkSourcePath,
        path.resolve(projectRoot, hardLinkPath),
      );
      const hardLinkRootBytes = Buffer.from(
        `${JSON.stringify({ array: { path: hardLinkPath, sha256: sha256(hardLinkBytes) } })}\n`,
        "utf8",
      );
      await fs.writeFile(
        path.resolve(projectRoot, rootPaths[0]),
        hardLinkRootBytes,
      );
      await expect(
        verifyNhm2PrimaryRunOwnedReferenceClosure({
          projectRoot,
          outputDirectory,
          rootPaths,
          entries: [
            ...rootEntries.map((entry) =>
              entry.path === rootPaths[0]
                ? {
                    ...entry,
                    sha256: sha256(hardLinkRootBytes),
                    sizeBytes: hardLinkRootBytes.byteLength,
                  }
                : entry,
            ),
            {
              path: hardLinkPath,
              sha256: sha256(hardLinkBytes),
              sizeBytes: hardLinkBytes.byteLength,
              modifiedAt: "2026-07-19T16:00:00.000Z",
              freshness: "new",
            },
          ],
        }),
      ).rejects.toThrow(/not a unique regular file.*hard-link/i);

      const invalidLedgerBytes = Buffer.from(
        `${JSON.stringify({
          array: {
            path: arrayPath,
            sha256: `sha256:sha256:${sha256(arrayBytes)}`,
          },
        })}\n`,
        "utf8",
      );
      const invalidRootBytes = Buffer.from(
        `${JSON.stringify({
          ledger: {
            path: ledgerPath,
            sha256: sha256(invalidLedgerBytes),
          },
        })}\n`,
        "utf8",
      );
      await fs.writeFile(
        path.resolve(projectRoot, ledgerPath),
        invalidLedgerBytes,
      );
      await fs.writeFile(
        path.resolve(projectRoot, rootPaths[0]),
        invalidRootBytes,
      );
      await expect(
        verifyNhm2PrimaryRunOwnedReferenceClosure({
          projectRoot,
          outputDirectory,
          rootPaths,
          entries: entries.map((entry) =>
            entry.path === ledgerPath
              ? {
                  ...entry,
                  sha256: sha256(invalidLedgerBytes),
                  sizeBytes: invalidLedgerBytes.byteLength,
                }
              : entry.path === rootPaths[0]
                ? {
                    ...entry,
                    sha256: sha256(invalidRootBytes),
                    sizeBytes: invalidRootBytes.byteLength,
                  }
                : entry,
          ),
        }),
      ).rejects.toThrow(/lacks an exact SHA-256.*tensor\.f64/i);
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true });
    }
  });
});

let repoRoot = "";
let successfulCandidate: PreparedNhm2ExperimentReadyTheoryCandidate;
let failingCandidate: PreparedNhm2ExperimentReadyTheoryCandidate;
let malformedEvidenceCandidate: PreparedNhm2ExperimentReadyTheoryCandidate;
let mutatedInputCandidate: PreparedNhm2ExperimentReadyTheoryCandidate;
let reusedRequestCandidate: PreparedNhm2ExperimentReadyTheoryCandidate;
let orphanCommitmentCandidate: PreparedNhm2ExperimentReadyTheoryCandidate;

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

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const primaryPlan = (prepared: PreparedNhm2ExperimentReadyTheoryCandidate) => {
  const plan = prepared.manifest.executionPlans.find(
    (entry) => entry.planRole === "primary_numerical",
  );
  if (plan == null) throw new Error("Prepared candidate has no primary plan.");
  return plan;
};

const invokeCallablePrimaryProducer = async (
  prepared: PreparedNhm2ExperimentReadyTheoryCandidate,
  command: TheoryRuntimeCommandV1,
): Promise<TheoryRuntimeExecutionResult> => {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const manifestIndex = command.args.lastIndexOf("--candidate-manifest");
  expect(manifestIndex).toBeGreaterThanOrEqual(0);
  expect(command.args[manifestIndex + 1]).toBe(prepared.manifestPath);
  expect(command.env).toBeDefined();
  const summary = await runNhm2LegacyGovernedPrimaryScaffoldForContractTest({
    workspaceRoot: repoRoot,
    manifestPath: prepared.manifestPath,
    environment: command.env,
  });
  const completedAt = new Date().toISOString();
  return {
    startedAt,
    completedAt,
    durationMs: Date.parse(completedAt) - Date.parse(startedAt),
    exitCode: 0,
    stdout: `${JSON.stringify(summary, null, 2)}\n`,
    stderr: "",
    timedOut: false,
    error: null,
  };
};

describe("server-owned NHM2 theory-candidate primary executor", () => {
  beforeAll(async () => {
    repoRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "nhm2-packager-spec-primary-executor-"),
    );
    await Promise.all([
      copyRepoPath(".gitignore"),
      copyRepoPath("package.json"),
      copyRepoPath("package-lock.json"),
      copyRepoPath(NHM2_ALPHA07_PACKAGE_DIRECTORY),
      copyRepoPath(
        "artifacts/research/full-solve/profile-search/nhm2-profile-campaign-frontier-latest.json",
      ),
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
    await execFileAsync("git", ["config", "core.longpaths", "true"], {
      cwd: repoRoot,
    });
    await execFileAsync("git", ["config", "user.name", "NHM2 Executor Spec"], {
      cwd: repoRoot,
    });
    await execFileAsync(
      "git",
      ["config", "user.email", "nhm2-executor@example.invalid"],
      { cwd: repoRoot },
    );
    await execFileAsync("git", ["add", "--all"], { cwd: repoRoot });
    await execFileAsync(
      "git",
      ["commit", "--no-gpg-sign", "-m", "executor fixture"],
      { cwd: repoRoot },
    );
    const suffix = randomBytes(6).toString("hex");
    successfulCandidate = await prepareNhm2ExperimentReadyTheoryCandidate(
      {
        repoRoot,
        manifestId: `nhm2-primary-executor-success-${suffix}`,
        frozenAt,
        dataCollectionOpensAt,
      },
      { testOnlyPublishUnexecutableDraft: true },
    );
    failingCandidate = await prepareNhm2ExperimentReadyTheoryCandidate(
      {
        repoRoot,
        manifestId: `nhm2-primary-executor-failure-${suffix}`,
        frozenAt,
        dataCollectionOpensAt,
      },
      { testOnlyPublishUnexecutableDraft: true },
    );
    malformedEvidenceCandidate =
      await prepareNhm2ExperimentReadyTheoryCandidate(
        {
          repoRoot,
          manifestId: `nhm2-primary-executor-malformed-evidence-${suffix}`,
          frozenAt,
          dataCollectionOpensAt,
        },
        { testOnlyPublishUnexecutableDraft: true },
      );
    mutatedInputCandidate = await prepareNhm2ExperimentReadyTheoryCandidate(
      {
        repoRoot,
        manifestId: `nhm2-primary-executor-mutated-input-${suffix}`,
        frozenAt,
        dataCollectionOpensAt,
      },
      { testOnlyPublishUnexecutableDraft: true },
    );
    reusedRequestCandidate = await prepareNhm2ExperimentReadyTheoryCandidate(
      {
        repoRoot,
        manifestId: `nhm2-primary-executor-reused-request-${suffix}`,
        frozenAt,
        dataCollectionOpensAt,
      },
      { testOnlyPublishUnexecutableDraft: true },
    );
    orphanCommitmentCandidate = await prepareNhm2ExperimentReadyTheoryCandidate(
      {
        repoRoot,
        manifestId: `nhm2-primary-executor-orphan-commitment-${suffix}`,
        frozenAt,
        dataCollectionOpensAt,
      },
      { testOnlyPublishUnexecutableDraft: true },
    );
  }, 300_000);

  afterAll(async () => {
    const relative = path.relative(os.tmpdir(), repoRoot);
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      !path
        .basename(repoRoot)
        .startsWith("nhm2-packager-spec-primary-executor-")
    ) {
      throw new Error(
        `refusing to remove unexpected spec repository: ${repoRoot}`,
      );
    }
    await fs.rm(repoRoot, { recursive: true, force: true });
  });

  it("fails the production child before publishing artifacts while the raw solver suite is missing", async () => {
    const plan = primaryPlan(successfulCandidate);
    let publishedRequestId: string | null = null;
    const result = await executeNhm2TheoryCandidatePrimary(
      {
        projectRoot: repoRoot,
        candidateManifestPath: successfulCandidate.manifestPath,
        execute: true,
      },
      {
        launchOwnership: {
          handlerId: NHM2_PRIMARY_OUTER_LAUNCH_HANDLER_ID,
          onRequestCreated: ({ request }) => {
            expect(request.status).toBe("queued");
            expect(request.requestId).toBe(plan.requestId);
            publishedRequestId = request.requestId;
          },
        },
      },
    );

    expect(publishedRequestId).toBe(plan.requestId);
    expect(result.requestId).toBe(plan.requestId);
    expect(result.runtimeId).toBe(plan.runtimeId);
    expect(result.receiptV1.receiptId).toBe(plan.receiptId);
    expect(result.receiptV1.status).toBe("failed");
    expect(result.receiptV1.outputs.missingSignals).toContain(
      "runtime_execution_failed",
    );
    expect(result.receiptV1.outputs.warnings).toContain(
      "No claim promotion is allowed from a failed primary execution receipt.",
    );
    expect(result.receiptV1.command).toBe(plan.expectedInvocation.command);
    expect(isTheoryRuntimeReceiptV1(result.receiptV1)).toBe(true);
    expect(result.receiptV1.claimBoundary).toMatchObject({
      currentTier: "diagnostic",
      maximumTier: "reduced_order",
      promotionAllowed: false,
    });
    expect(result.receiptV1.outputs.gates).toMatchObject({
      runtime_execution: "fail",
      runtime_execution_provenance: "pass",
      runtime_artifact_freshness: "not_ready",
      run_owned_nested_reference_closure: "not_ready",
      primary_evidence_inventory: "not_ready",
      primary_numerical_evidence: "not_ready",
      primary_comparison_projection: "not_ready",
      experiment_ready_theory_closure: "not_ready",
      prediction_falsifier_freeze: "not_ready",
    });
    expect(result.receiptV1.outputs.missingSignals).not.toContain(
      "runtime_environment_dependency_tree_unattested",
    );
    expect(result.receiptV1.outputs.scalars).toMatchObject({
      hermeticDependencyTreeAttested: true,
      runtimeNodeModulesRequired: false,
      primaryEvidenceRootCount: 0,
      supplementaryRunOwnedArtifactCount: 0,
      totalRunOwnedArtifactCount: 0,
      hostSpecificDiagnosticRuntimeClosure: true,
      operatingSystemHermeticityAsserted: false,
      nodeRuntimeReproducibilityAsserted: false,
      predictionFreezeReady: false,
      primaryNumericalEvidenceReady: false,
      primaryNumericalEvidenceFalsified: false,
      primaryComparisonProjectionAssessmentPublished: false,
      primaryComparisonProjectionReady: false,
      experimentReadyTheoryClosureClaimAllowed: false,
      physicalViabilityClaimAllowed: false,
      transportClaimAllowed: false,
      propulsionClaimAllowed: false,
      routeEtaClaimAllowed: false,
      speedAuthorityClaimAllowed: false,
    });
    expect(result.receiptV1.outputs.artifactManifest?.entries).toEqual([]);

    expect(result.receiptV1.execution).toMatchObject({
      command: plan.expectedInvocation.command,
      args: plan.expectedInvocation.args,
      cwd: plan.expectedInvocation.cwd,
      outputDirectory: plan.expectedInvocation.outputDirectory,
      outputDirectoryBound: true,
      exitCode: 1,
    });
    expect(result.receiptV1.execution?.environment).toEqual(
      commandEnvironment(successfulCandidate),
    );
    expect(result.receiptV1.args).toMatchObject({
      requestId: plan.requestId,
      runId: plan.runId,
      receiptId: plan.receiptId,
      candidateManifestPath: successfulCandidate.manifestPath,
      candidateManifestSha256: successfulCandidate.manifestRawSha256,
      candidateManifestRawSha256: successfulCandidate.manifestRawSha256,
      candidateId: successfulCandidate.manifest.bindings.candidate.candidateId,
      candidateSha256: successfulCandidate.manifest.bindings.candidate.sha256,
      selectedProfileId:
        successfulCandidate.manifest.bindings.profile.selectedProfileId,
      profileSha256: successfulCandidate.manifest.bindings.profile.sha256,
      chartId: successfulCandidate.manifest.bindings.chart.chartId,
      chartSha256: successfulCandidate.manifest.bindings.chart.sha256,
      atlasId: successfulCandidate.manifest.bindings.atlas.atlasId,
      atlasSha256: successfulCandidate.manifest.bindings.atlas.sha256,
      unitsId: successfulCandidate.manifest.bindings.units.unitsId,
      unitsSha256: successfulCandidate.manifest.bindings.units.sha256,
      normalizationId:
        successfulCandidate.manifest.bindings.normalization.normalizationId,
      normalizationSha256:
        successfulCandidate.manifest.bindings.normalization.sha256,
      entrypointCommand: plan.expectedInvocation.entrypoint,
      actualLauncherCommand: result.command.command,
      actualLauncherArgsJson: JSON.stringify(result.command.args),
      outerLaunchHandler: NHM2_PRIMARY_OUTER_LAUNCH_HANDLER_ID,
      innerProducerEntrypoint: plan.expectedInvocation.entrypoint,
    });
    expect(result.command.env).toEqual(commandEnvironment(successfulCandidate));
    expect(result.command.command).toBe(await fs.realpath(process.execPath));
    expect(result.command.args).toEqual([
      path.resolve(repoRoot, successfulCandidate.primaryProducerBundlePath),
      "--candidate-manifest",
      successfulCandidate.manifestPath,
    ]);
    expect(
      result.command.args.some((argument) =>
        argument.replace(/\\/g, "/").includes("node_modules/tsx"),
      ),
    ).toBe(false);
    expect(result.command.inheritProcessEnv).toBe(false);
    expect(result.command.launcherBindings?.map((entry) => entry.role)).toEqual(
      ["node_runtime", "standalone_bundle"],
    );
    expect(
      result.command.launcherBindings?.every(
        (entry) => typeof entry.sizeBytes === "number" && entry.sizeBytes > 0,
      ),
    ).toBe(true);
    expect(result.command.env).not.toHaveProperty("NODE_OPTIONS");

    const filesystem = await verifyTheoryRuntimeReceiptFilesystem({
      projectRoot: repoRoot,
      receipt: result.receiptV1,
    });
    expect(filesystem).toMatchObject({
      ok: true,
      blockers: [],
      freshnessProofVerified: true,
    });
    expect(filesystem.files).toHaveLength(0);

    const receiptBytes = await fs.readFile(
      path.resolve(repoRoot, result.receiptArtifact.path),
    );
    expect(sha256(receiptBytes)).toBe(result.receiptArtifact.sha256);
    expect(JSON.parse(receiptBytes.toString("utf8"))).toEqual(result.receiptV1);

    const request = await readTheoryRuntimeRunRequestStatus({
      projectRoot: repoRoot,
      requestId: plan.requestId,
    });
    expect(request).toMatchObject({
      requestId: plan.requestId,
      runtimeId: plan.runtimeId,
      status: "failed",
      requestedScope: "full",
      args: { candidateManifestPath: successfulCandidate.manifestPath },
      heartbeat: { stage: "failed", progress: 1 },
      claimBoundary: { promotionAllowed: false },
    });
  }, 60_000);

  it("persists a failed non-promoting receipt and terminal request for a nonzero process", async () => {
    const plan = primaryPlan(failingCandidate);
    const result = await executeNhm2TheoryCandidatePrimary(
      {
        projectRoot: repoRoot,
        candidateManifestPath: failingCandidate.manifestPath,
        execute: true,
      },
      {
        spawnExecutor: async (): Promise<TheoryRuntimeExecutionResult> => {
          const startedAt = new Date().toISOString();
          const completedAt = new Date().toISOString();
          return {
            startedAt,
            completedAt,
            durationMs: Date.parse(completedAt) - Date.parse(startedAt),
            exitCode: 17,
            stdout: "",
            stderr: "deliberate producer failure",
            timedOut: false,
            error: "Runtime command exited with 17.",
          };
        },
      },
    );

    expect(result.receiptV1.status).toBe("failed");
    expect(result.receiptV1.receiptId).toBe(plan.receiptId);
    expect(result.receiptV1.claimBoundary.promotionAllowed).toBe(false);
    expect(result.receiptV1.outputs.missingSignals).toContain(
      "runtime_execution_failed",
    );
    expect(result.receiptV1.outputs.artifactManifest?.entries).toEqual([]);
    expect(result.receiptArtifact.receiptId).toBe(plan.receiptId);
    expect(result.receiptV1.execution).toMatchObject({
      command: plan.expectedInvocation.command,
      args: plan.expectedInvocation.args,
      environment: commandEnvironment(failingCandidate),
      exitCode: 17,
    });

    const request = await readTheoryRuntimeRunRequestStatus({
      projectRoot: repoRoot,
      requestId: plan.requestId,
    });
    expect(request?.status).toBe("failed");
    expect(request?.heartbeat).toMatchObject({ stage: "failed", progress: 1 });
  }, 60_000);

  it("rejects legacy governed wrappers before treating their contents as raw solver evidence", async () => {
    const plan = primaryPlan(malformedEvidenceCandidate);
    const result = await executeNhm2TheoryCandidatePrimary(
      {
        projectRoot: repoRoot,
        candidateManifestPath: malformedEvidenceCandidate.manifestPath,
        execute: true,
      },
      {
        spawnExecutor: (command) =>
          invokeCallablePrimaryProducer(malformedEvidenceCandidate, command),
      },
    );

    expect(result.receiptV1.status).toBe("failed");
    expect(result.receiptV1.outputs.missingSignals).toContain(
      "runtime_receipt_finalization_failed",
    );
    expect(result.receiptV1.outputs.warnings).toContain(
      "primary_raw_package_missing",
    );
    expect(result.receiptV1.claimBoundary.promotionAllowed).toBe(false);
    expect(
      (
        await readTheoryRuntimeRunRequestStatus({
          projectRoot: repoRoot,
          requestId: plan.requestId,
        })
      )?.status,
    ).toBe("failed");
  }, 60_000);

  it("fails provenance when an admitted ignored input changes during execution", async () => {
    const result = await executeNhm2TheoryCandidatePrimary(
      {
        projectRoot: repoRoot,
        candidateManifestPath: mutatedInputCandidate.manifestPath,
        execute: true,
      },
      {
        spawnExecutor: async (command) => {
          const execution = await invokeCallablePrimaryProducer(
            mutatedInputCandidate,
            command,
          );
          await fs.appendFile(
            path.resolve(
              repoRoot,
              mutatedInputCandidate.candidateDefinitionPath,
            ),
            " ",
            "utf8",
          );
          return execution;
        },
      },
    );

    expect(result.receiptV1.status).toBe("failed");
    expect(result.receiptV1.outputs.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/post_spawn admitted input hash changed/i),
      ]),
    );
    expect(result.receiptV1.outputs.missingSignals).toContain(
      "runtime_receipt_finalization_failed",
    );
  }, 60_000);

  it("does not overwrite an existing deterministic request or spawn a second attempt", async () => {
    const plan = primaryPlan(reusedRequestCandidate);
    const entrypoint = getTheoryRuntimeEntrypoint(plan.runtimeId);
    if (entrypoint == null)
      throw new Error("Primary runtime is not registered.");
    const created = await createTheoryRuntimeRunRequestManifest({
      runtimeId: plan.runtimeId,
      graphId: "nhm2-theory-badge-graph",
      badgeIds: [...entrypoint.ownedBadgeIds],
      args: { candidateManifestPath: reusedRequestCandidate.manifestPath },
      requestedScope: "full",
      status: "created",
      requestId: plan.requestId,
      projectRoot: repoRoot,
      generatedAt: "2026-07-19T16:30:00.000Z",
    });
    await updateTheoryRuntimeRunRequestStatus({
      requestId: plan.requestId,
      projectRoot: repoRoot,
      status: "failed",
      updatedAt: "2026-07-19T16:31:00.000Z",
      heartbeat: {
        stage: "failed",
        message: "Original attempt is terminal.",
        progress: 1,
      },
    });
    const original = await fs.readFile(created.manifestPath);
    let spawned = false;

    await expect(
      executeNhm2TheoryCandidatePrimary(
        {
          projectRoot: repoRoot,
          candidateManifestPath: reusedRequestCandidate.manifestPath,
          execute: true,
        },
        {
          spawnExecutor: async () => {
            spawned = true;
            throw new Error("must not spawn");
          },
        },
      ),
    ).rejects.toThrow(/already exists.*single-use/i);

    expect(spawned).toBe(false);
    expect(await fs.readFile(created.manifestPath)).toEqual(original);
    expect(
      (
        await readTheoryRuntimeRunRequestStatus({
          projectRoot: repoRoot,
          requestId: plan.requestId,
        })
      )?.status,
    ).toBe("failed");
  }, 60_000);

  it("treats an orphan pre-spawn commitment as a used attempt without creating a request", async () => {
    const plan = primaryPlan(orphanCommitmentCandidate);
    await writeTheoryRuntimePreSpawnSnapshotCommitment({
      projectRoot: repoRoot,
      requestId: plan.requestId,
      runtimeId: plan.runtimeId,
      outputDirectory: path.resolve(
        repoRoot,
        plan.expectedInvocation.outputDirectory,
      ),
      beforeCapturedAt: "2026-07-19T16:30:00.000Z",
      gitSha: null,
      sourceTreeSha256: null,
      worktreeClean: true,
      before: new Map(),
    });
    let spawned = false;

    await expect(
      executeNhm2TheoryCandidatePrimary(
        {
          projectRoot: repoRoot,
          candidateManifestPath: orphanCommitmentCandidate.manifestPath,
          execute: true,
        },
        {
          spawnExecutor: async () => {
            spawned = true;
            throw new Error("must not spawn");
          },
        },
      ),
    ).rejects.toMatchObject({ code: "EEXIST" });

    expect(spawned).toBe(false);
    expect(
      await readTheoryRuntimeRunRequestStatus({
        projectRoot: repoRoot,
        requestId: plan.requestId,
      }),
    ).toBeNull();
  }, 60_000);
});

function commandEnvironment(
  prepared: PreparedNhm2ExperimentReadyTheoryCandidate,
): Record<string, string> {
  const plan = primaryPlan(prepared);
  return Object.fromEntries(
    plan.expectedInvocation.environment.map((entry) => [
      entry.name,
      entry.valueKind === "candidate_manifest_raw_sha256"
        ? prepared.manifestRawSha256
        : (entry.value ?? ""),
    ]),
  );
}
