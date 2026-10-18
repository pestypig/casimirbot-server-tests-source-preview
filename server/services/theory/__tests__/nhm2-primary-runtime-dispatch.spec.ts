import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { nhm2ExperimentReadyTheoryCandidateReceiptIdForRequest } from "../../../../shared/contracts/nhm2-experiment-ready-theory-candidate-manifest.v1";
import { buildTheoryRuntimeReceiptV1 } from "../../../../shared/contracts/theory-runtime-receipt.v1";
import { getTheoryRuntimeEntrypoint } from "../../../../shared/theory/runtime-entrypoints";
import {
  isTheoryRuntimeDedicatedExecutableId,
  isTheoryRuntimeExecutableId,
  THEORY_RUNTIME_WORKSTATION_GRAPH_ID,
} from "../../../../shared/theory/runtime-execution-policy";
import type { Nhm2TheoryCandidatePlanAdmission } from "../nhm2-theory-candidate-plan-admission";
import type { ExecuteNhm2TheoryCandidatePrimaryResult } from "../nhm2-theory-candidate-primary-executor";
import { runTheoryRuntimeJob } from "../runtime-jobs/runtime-job-runner";
import {
  readTheoryRuntimeJob,
  readTheoryRuntimeResult,
  startTheoryRuntimeJob,
} from "../runtime-jobs/runtime-job-service";
import {
  NHM2_PRIMARY_OUTER_LAUNCH_HANDLER_ID,
  NHM2_PRIMARY_RUNTIME_ID,
  type Nhm2PrimaryRuntimeDispatchDependencies,
} from "../runtime-jobs/nhm2-primary-runtime-dispatch";
import {
  createTheoryRuntimeRunRequestManifest,
  updateTheoryRuntimeRunRequestStatus,
} from "../theory-runtime-run-request-manifest";

const CANDIDATE_MANIFEST_PATH =
  "artifacts/research/full-solve/experiment-ready-theory-candidates/test/candidate-manifest.v1.json";
const REQUEST_ID = "nhm2-primary-dispatch-test-request-v1";
const RUN_ID = "nhm2-primary-dispatch-test-run-v1";
const RECEIPT_ID = nhm2ExperimentReadyTheoryCandidateReceiptIdForRequest(
  NHM2_PRIMARY_RUNTIME_ID,
  REQUEST_ID,
);
const entrypoint = getTheoryRuntimeEntrypoint(NHM2_PRIMARY_RUNTIME_ID)!;

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function admission(): Nhm2TheoryCandidatePlanAdmission {
  return {
    manifestPath: CANDIDATE_MANIFEST_PATH,
    manifestRawSha256: "a".repeat(64),
    plan: {
      planRole: "primary_numerical",
      runtimeId: NHM2_PRIMARY_RUNTIME_ID,
      requestId: REQUEST_ID,
      runId: RUN_ID,
      receiptId: RECEIPT_ID,
      expectedInvocation: {
        entrypoint: `npm run warp:full-solve:nhm2:theory-candidate:primary -- --candidate-manifest ${CANDIDATE_MANIFEST_PATH}`,
        command: "npm",
        args: [
          "run",
          "-s",
          "warp:full-solve:nhm2:theory-candidate:primary",
          "--",
          "--candidate-manifest",
          CANDIDATE_MANIFEST_PATH,
        ],
        cwd: ".",
        environment: [],
        outputDirectory: `artifacts/research/full-solve/experiment-ready-theory-candidates/test/runs/${RUN_ID}`,
      },
    },
  } as unknown as Nhm2TheoryCandidatePlanAdmission;
}

function startInput(projectRoot: string) {
  return {
    runtimeId: NHM2_PRIMARY_RUNTIME_ID,
    graphId: THEORY_RUNTIME_WORKSTATION_GRAPH_ID,
    badgeIds: [...entrypoint.ownedBadgeIds],
    args: { candidateManifestPath: CANDIDATE_MANIFEST_PATH },
    requestedScope: "full" as const,
    projectRoot,
  };
}

function dependencies(input: {
  gate?: Deferred;
  running?: Deferred;
  failBeforeSpawn?: boolean;
  mutatePublishedObject?: boolean;
  mutateReceipt?: (
    receipt: ReturnType<typeof buildTheoryRuntimeReceiptV1>,
  ) => void;
  admissionSpy?: Nhm2PrimaryRuntimeDispatchDependencies["admitPlan"];
}): Nhm2PrimaryRuntimeDispatchDependencies {
  const admitted = admission();
  const admitPlan = input.admissionSpy ?? vi.fn(async () => admitted);
  return {
    admitPlan: admitPlan as unknown as NonNullable<
      Nhm2PrimaryRuntimeDispatchDependencies["admitPlan"]
    >,
    executePrimary: async (executeInput, options) => {
      const requestManifest = await createTheoryRuntimeRunRequestManifest({
        projectRoot: executeInput.projectRoot,
        runtimeId: NHM2_PRIMARY_RUNTIME_ID,
        graphId: THEORY_RUNTIME_WORKSTATION_GRAPH_ID,
        badgeIds: [...entrypoint.ownedBadgeIds],
        args: { candidateManifestPath: CANDIDATE_MANIFEST_PATH },
        requestedScope: "full",
        status: "queued",
        requestId: REQUEST_ID,
      });
      await options?.launchOwnership?.onRequestCreated(requestManifest);
      if (input.mutatePublishedObject) {
        requestManifest.request.requestId = "mutated-after-publication";
        requestManifest.request.status = "cancelled";
      }
      await updateTheoryRuntimeRunRequestStatus({
        projectRoot: executeInput.projectRoot,
        requestId: REQUEST_ID,
        status: "running",
        heartbeat: {
          stage: "running",
          message: "Dedicated primary producer has not yet returned.",
          progress: null,
        },
      });
      input.running?.resolve();
      if (input.failBeforeSpawn) {
        throw new Error("fixture pre-spawn launcher binding failure");
      }
      await input.gate?.promise;

      const startedAt = "2026-07-19T18:00:00.000Z";
      const completedAt = "2026-07-19T18:00:01.000Z";
      const innerProducerEntrypoint =
        admitted.plan.expectedInvocation.entrypoint;
      const receipt = buildTheoryRuntimeReceiptV1({
        generatedAt: completedAt,
        receiptId: RECEIPT_ID,
        runtimeId: NHM2_PRIMARY_RUNTIME_ID,
        graphId: THEORY_RUNTIME_WORKSTATION_GRAPH_ID,
        badgeIds: [...entrypoint.ownedBadgeIds],
        command: innerProducerEntrypoint,
        args: {
          adapter: "nhm2_theory_candidate_primary_executor",
          outerLaunchHandler: NHM2_PRIMARY_OUTER_LAUNCH_HANDLER_ID,
          innerProducerEntrypoint,
          requestId: REQUEST_ID,
          runId: RUN_ID,
        },
        status: "completed",
        outputs: {
          artifacts: [],
          scalars: {
            expectedEvidenceCount: 9,
            primaryEvidenceRootCount: 9,
            supplementaryRunOwnedArtifactCount: 1,
            totalRunOwnedArtifactCount: 10,
            freshEvidenceCount: 10,
            predictionFreezeReady: false,
            hermeticDependencyTreeAttested: true,
            runtimeNodeModulesRequired: false,
            hostSpecificDiagnosticRuntimeClosure: true,
            operatingSystemHermeticityAsserted: false,
            nodeRuntimeReproducibilityAsserted: false,
            inheritedProcessEnvironment: false,
            primaryNumericalEvidenceReady: false,
            primaryNumericalEvidenceFalsified: false,
            primaryComparisonProjectionAssessmentPublished: true,
            primaryComparisonProjectionReady: false,
            experimentReadyTheoryClosureClaimAllowed: false,
            physicalViabilityClaimAllowed: false,
            transportClaimAllowed: false,
            propulsionClaimAllowed: false,
            routeEtaClaimAllowed: false,
            speedAuthorityClaimAllowed: false,
          },
          units: {},
          gates: {
            runtime_execution: "pass",
            runtime_execution_provenance: "pass",
            runtime_artifact_freshness: "pass",
            run_owned_nested_reference_closure: "pass",
            primary_evidence_inventory: "pass",
            primary_numerical_evidence: "not_ready",
            primary_comparison_projection: "not_ready",
            experiment_ready_theory_closure: "not_ready",
            prediction_falsifier_freeze: "not_ready",
          },
          missingSignals: [
            "experiment_ready_theory_closure_not_ready",
            "primary_comparison_projection_not_ready",
          ],
          warnings: [
            "Fresh diagnostic evidence does not establish physical viability.",
          ],
        },
        provenance: {
          gitSha: "b".repeat(40),
          startedAt,
          completedAt,
          durationMs: 1_000,
        },
        execution: {
          command: "npm",
          args: [...admitted.plan.expectedInvocation.args],
          cwd: ".",
          environment: {},
          outputDirectory: admitted.plan.expectedInvocation.outputDirectory,
          outputDirectoryBound: true,
          exitCode: 0,
          stdout: "{}",
          stderr: "",
          timedOut: false,
          error: null,
        },
        claimBoundary: {
          currentTier: "diagnostic",
          maximumTier: "reduced_order",
          promotionAllowed: false,
          promotionBlockedBy: [
            "experiment_ready_theory_closure_not_ready",
            "primary_comparison_projection_not_ready",
            "empirical_receipts_required_for_physical_promotion",
          ],
        },
      });
      input.mutateReceipt?.(receipt);
      return {
        requestId: REQUEST_ID,
        runtimeId: NHM2_PRIMARY_RUNTIME_ID,
        requestManifestPath: requestManifest.manifestPath,
        command: {
          command: process.execPath,
          args: [],
          cwd: executeInput.projectRoot ?? process.cwd(),
          npmScript: "warp:full-solve:nhm2:theory-candidate:primary",
          timeoutMs: 1_000,
        },
        execution: {
          startedAt,
          completedAt,
          durationMs: 1_000,
          exitCode: 0,
          stdout: "{}",
          stderr: "",
          timedOut: false,
          error: null,
        },
        receiptV1: receipt,
        receiptArtifact: {
          artifactId: "theory_runtime_persisted_receipt",
          schemaVersion: "theory_runtime_persisted_receipt/v1",
          requestId: REQUEST_ID,
          receiptId: RECEIPT_ID,
          path: "fixture-is-not-used.json",
          sha256: "c".repeat(64),
          sizeBytes: 1,
          writtenAt: completedAt,
        },
      } satisfies ExecuteNhm2TheoryCandidatePrimaryResult;
    },
  };
}

async function waitForTerminal(projectRoot: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const snapshot = await readTheoryRuntimeJob({
      projectRoot,
      requestId: REQUEST_ID,
    });
    if (
      snapshot &&
      ["completed", "failed", "timeout", "cancelled"].includes(
        snapshot.request.status,
      )
    ) {
      return snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("fixture runtime did not terminalize");
}

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nhm2-primary-dispatch-"));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("NHM2 primary production dispatch", () => {
  it("uses server-owned admission and the executor-owned deterministic request", async () => {
    const gate = deferred();
    const running = deferred();
    const admissionSpy = vi.fn(async () => admission());
    const snapshot = await startTheoryRuntimeJob(startInput(tempRoot), {
      primaryDependencies: dependencies({ gate, running, admissionSpy }),
    });
    await running.promise;

    expect(snapshot.jobId).toBe(REQUEST_ID);
    expect(snapshot.request.status).toBe("queued");
    expect(admissionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateManifestPath: CANDIDATE_MANIFEST_PATH,
        planRole: "primary_numerical",
        requireCleanSourceTree: true,
      }),
    );

    gate.resolve();
    await waitForTerminal(tempRoot);
  });

  it("isolates the published request identity from callback-side mutation", async () => {
    const gate = deferred();
    const snapshot = await startTheoryRuntimeJob(startInput(tempRoot), {
      primaryDependencies: dependencies({
        gate,
        mutatePublishedObject: true,
      }),
    });

    expect(snapshot.jobId).toBe(REQUEST_ID);
    expect(snapshot.request.requestId).toBe(REQUEST_ID);
    expect(snapshot.request.status).toBe("queued");
    gate.resolve();
    await waitForTerminal(tempRoot);
  });

  it("keeps a concurrent GET poll from interrupting an active dedicated run", async () => {
    const gate = deferred();
    const running = deferred();
    await startTheoryRuntimeJob(startInput(tempRoot), {
      primaryDependencies: dependencies({ gate, running }),
    });
    await running.promise;

    const polled = await readTheoryRuntimeJob({
      projectRoot: tempRoot,
      requestId: REQUEST_ID,
    });
    expect(polled?.request.status).toBe("running");
    expect(polled?.result.available).toBe(false);

    gate.resolve();
    await waitForTerminal(tempRoot);
  });

  it("projects the completed immutable receipt through generic result retrieval", async () => {
    const gate = deferred();
    await startTheoryRuntimeJob(startInput(tempRoot), {
      primaryDependencies: dependencies({ gate }),
    });
    gate.resolve();
    const terminal = await waitForTerminal(tempRoot);
    const receipt = await readTheoryRuntimeResult({
      projectRoot: tempRoot,
      requestId: REQUEST_ID,
    });

    expect(terminal.request.status).toBe("completed");
    expect(terminal.result).toMatchObject({
      available: true,
      receiptId: RECEIPT_ID,
    });
    expect(receipt?.receiptId).toBe(RECEIPT_ID);
    expect(receipt?.args.outerLaunchHandler).toBe(
      NHM2_PRIMARY_OUTER_LAUNCH_HANDLER_ID,
    );
    expect(receipt?.command).toBe(receipt?.args.innerProducerEntrypoint);
    expect(receipt?.execution?.command).toBe("npm");
    expect(receipt?.outputs.missingSignals).not.toContain(
      "runtime_environment_dependency_tree_unattested",
    );
    expect(receipt?.outputs.missingSignals).toContain(
      "primary_comparison_projection_not_ready",
    );
    expect(receipt?.outputs.missingSignals).toContain(
      "experiment_ready_theory_closure_not_ready",
    );
    expect(receipt?.outputs.gates.primary_comparison_projection).toBe(
      "not_ready",
    );
    expect(receipt?.outputs.scalars).toMatchObject({
      primaryComparisonProjectionReady: false,
      experimentReadyTheoryClosureClaimAllowed: false,
      physicalViabilityClaimAllowed: false,
      transportClaimAllowed: false,
      propulsionClaimAllowed: false,
      routeEtaClaimAllowed: false,
      speedAuthorityClaimAllowed: false,
    });
    expect(
      await fs
        .access(
          path.join(
            tempRoot,
            "artifacts/theory-runtime-requests",
            `${REQUEST_ID}.receipt.json`,
          ),
        )
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
  });

  it("terminalizes a post-request pre-spawn failure with a dedicated receipt", async () => {
    await startTheoryRuntimeJob(startInput(tempRoot), {
      primaryDependencies: dependencies({ failBeforeSpawn: true }),
    });
    const terminal = await waitForTerminal(tempRoot);
    const receipt = await readTheoryRuntimeResult({
      projectRoot: tempRoot,
      requestId: REQUEST_ID,
    });

    expect(terminal.request.status).toBe("failed");
    expect(receipt?.status).toBe("failed");
    expect(receipt?.args.producerSpawnStatus).toBe("not_proven");
    expect(receipt?.outputs.warnings.join(" ")).toMatch(
      /pre-spawn launcher binding failure/i,
    );
    expect(receipt?.claimBoundary.promotionAllowed).toBe(false);
    expect(receipt?.outputs.gates.primary_comparison_projection).toBe(
      "not_ready",
    );
    expect(receipt?.outputs.scalars).toMatchObject({
      primaryComparisonProjectionReady: false,
      physicalViabilityClaimAllowed: false,
      transportClaimAllowed: false,
      propulsionClaimAllowed: false,
      routeEtaClaimAllowed: false,
      speedAuthorityClaimAllowed: false,
    });
  });

  it.each([
    [
      "projection gate",
      (receipt: ReturnType<typeof buildTheoryRuntimeReceiptV1>) => {
        receipt.outputs.gates.primary_comparison_projection = "pass";
      },
    ],
    [
      "closure gate",
      (receipt: ReturnType<typeof buildTheoryRuntimeReceiptV1>) => {
        receipt.outputs.gates.experiment_ready_theory_closure = "pass";
      },
    ],
    [
      "certified current tier",
      (receipt: ReturnType<typeof buildTheoryRuntimeReceiptV1>) => {
        receipt.claimBoundary.currentTier = "certified";
      },
    ],
    [
      "certified maximum tier",
      (receipt: ReturnType<typeof buildTheoryRuntimeReceiptV1>) => {
        receipt.claimBoundary.maximumTier = "certified";
      },
    ],
    [
      "arbitrary empirical-validation scalar",
      (receipt: ReturnType<typeof buildTheoryRuntimeReceiptV1>) => {
        receipt.outputs.scalars.empiricalValidationEstablished = true;
      },
    ],
    [
      "arbitrary pass gate",
      (receipt: ReturnType<typeof buildTheoryRuntimeReceiptV1>) => {
        receipt.outputs.gates.empirical_validation = "pass";
      },
    ],
    [
      "projection readiness scalar",
      (receipt: ReturnType<typeof buildTheoryRuntimeReceiptV1>) => {
        receipt.outputs.scalars.primaryComparisonProjectionReady = true;
      },
    ],
    ...[
      "experimentReadyTheoryClosureClaimAllowed",
      "physicalViabilityClaimAllowed",
      "transportClaimAllowed",
      "propulsionClaimAllowed",
      "routeEtaClaimAllowed",
      "speedAuthorityClaimAllowed",
    ].map(
      (claim) =>
        [
          claim,
          (receipt: ReturnType<typeof buildTheoryRuntimeReceiptV1>) => {
            receipt.outputs.scalars[claim] = true;
          },
        ] as const,
    ),
  ])(
    "rejects an executor receipt that widens its %s",
    async (_label, mutateReceipt) => {
      const gate = deferred();
      await startTheoryRuntimeJob(startInput(tempRoot), {
        primaryDependencies: dependencies({ gate, mutateReceipt }),
      });
      gate.resolve();
      const terminal = await waitForTerminal(tempRoot);
      const receipt = await readTheoryRuntimeResult({
        projectRoot: tempRoot,
        requestId: REQUEST_ID,
      });

      expect(terminal.request.status).toBe("failed");
      expect(receipt?.status).toBe("failed");
      expect(receipt?.outputs.gates.primary_comparison_projection).toBe(
        "not_ready",
      );
      expect(receipt?.outputs.scalars.physicalViabilityClaimAllowed).toBe(
        false,
      );
    },
  );

  it("terminalizes an executor-owned request even when failure precedes publication", async () => {
    const admitted = admission();
    const primaryDependencies: Nhm2PrimaryRuntimeDispatchDependencies = {
      admitPlan: vi.fn(async () => admitted) as unknown as NonNullable<
        Nhm2PrimaryRuntimeDispatchDependencies["admitPlan"]
      >,
      executePrimary: async (executeInput) => {
        await createTheoryRuntimeRunRequestManifest({
          projectRoot: executeInput.projectRoot,
          runtimeId: NHM2_PRIMARY_RUNTIME_ID,
          graphId: THEORY_RUNTIME_WORKSTATION_GRAPH_ID,
          badgeIds: [...entrypoint.ownedBadgeIds],
          args: { candidateManifestPath: CANDIDATE_MANIFEST_PATH },
          requestedScope: "full",
          status: "queued",
          requestId: REQUEST_ID,
        });
        throw new Error("fixture failed before request publication callback");
      },
    };

    await expect(
      startTheoryRuntimeJob(startInput(tempRoot), { primaryDependencies }),
    ).rejects.toThrow(/before request publication callback/i);
    const request = await readTheoryRuntimeJob({
      projectRoot: tempRoot,
      requestId: REQUEST_ID,
    });
    const receipt = await readTheoryRuntimeResult({
      projectRoot: tempRoot,
      requestId: REQUEST_ID,
    });

    expect(request?.request.status).toBe("failed");
    expect(receipt?.status).toBe("failed");
  });

  it("rejects a duplicate attempt while the deterministic launch is owned", async () => {
    const gate = deferred();
    const sharedDependencies = dependencies({ gate });
    await startTheoryRuntimeJob(startInput(tempRoot), {
      primaryDependencies: sharedDependencies,
    });

    await expect(
      startTheoryRuntimeJob(startInput(tempRoot), {
        primaryDependencies: sharedDependencies,
      }),
    ).rejects.toThrow(/already has a server-owned execution attempt/i);

    gate.resolve();
    await waitForTerminal(tempRoot);
  });

  it("keeps both generic execution allowlists and the legacy job runner closed", async () => {
    const gate = deferred();
    await startTheoryRuntimeJob(startInput(tempRoot), {
      primaryDependencies: dependencies({ gate }),
    });

    expect(isTheoryRuntimeExecutableId(NHM2_PRIMARY_RUNTIME_ID)).toBe(false);
    expect(isTheoryRuntimeDedicatedExecutableId(NHM2_PRIMARY_RUNTIME_ID)).toBe(
      true,
    );
    await expect(
      runTheoryRuntimeJob({
        projectRoot: tempRoot,
        requestId: REQUEST_ID,
      }),
    ).rejects.toThrow(/not allowlisted for execution/i);

    gate.resolve();
    await waitForTerminal(tempRoot);
  });

  it("closes a restarted running request as interrupted instead of resuming it", async () => {
    await createTheoryRuntimeRunRequestManifest({
      projectRoot: tempRoot,
      runtimeId: NHM2_PRIMARY_RUNTIME_ID,
      graphId: THEORY_RUNTIME_WORKSTATION_GRAPH_ID,
      badgeIds: [...entrypoint.ownedBadgeIds],
      args: { candidateManifestPath: CANDIDATE_MANIFEST_PATH },
      requestedScope: "full",
      status: "running",
      requestId: REQUEST_ID,
    });

    const recovered = await readTheoryRuntimeJob({
      projectRoot: tempRoot,
      requestId: REQUEST_ID,
    });
    const receipt = await readTheoryRuntimeResult({
      projectRoot: tempRoot,
      requestId: REQUEST_ID,
    });

    expect(recovered?.request.status).toBe("failed");
    expect(receipt?.status).toBe("failed");
    expect(receipt?.outputs.warnings.join(" ")).toMatch(
      /no longer owns the dedicated primary process/i,
    );
    expect(receipt?.args.producerSpawnStatus).toBe("not_proven");
  });
});
