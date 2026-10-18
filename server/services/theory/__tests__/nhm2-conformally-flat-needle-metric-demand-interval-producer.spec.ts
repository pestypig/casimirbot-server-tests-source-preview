import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_ARRAY_SIZE_BYTES,
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_CENTRAL_FILE_NAME,
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_CLAIM_LOCKS,
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_CONFIGURATION,
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_CONFIGURATION_SHA256,
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_DERIVATION_RECEIPT_FILE_NAME,
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_ERROR_FILE_NAME,
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_INPUT_BINDINGS,
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_INTERVAL_RUN_ARTIFACT_ID,
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_INTERVAL_RUN_CONTRACT_VERSION,
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_INTERVAL_TRACE_ARTIFACT_ID,
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_INTERVAL_TRACE_CONTRACT_VERSION,
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_RUN_AUTHORITY_BLOCKERS,
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_TRACE_FILE_NAME,
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_V1_FAILURE_OBSERVATION,
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_V1_FAILURE_OBSERVATION_SHA256,
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_V2_FIRST_TERMINAL_PARTIAL_OBSERVATION,
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_V2_FIRST_TERMINAL_PARTIAL_OBSERVATION_SHA256,
  canonicalNhm2ConformallyFlatNeedleMetricDemandJson,
  computeNhm2ConformallyFlatNeedleMetricDemandRunReceiptSha256,
  hasValidNhm2ConformallyFlatNeedleMetricDemandRunReceiptIntegrity,
  sha256Nhm2ConformallyFlatNeedleMetricDemandBytes,
  type Nhm2ConformallyFlatNeedleMetricDemandIntervalRunReceiptV1,
  type Nhm2ConformallyFlatNeedleMetricDemandIntervalTraceV1,
} from "../../../../shared/contracts/nhm2-conformally-flat-needle-metric-demand-interval-producer.v1";
import {
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_DERIVATION_RECEIPT_ARTIFACT_ID,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_DERIVATION_RECEIPT_CONTRACT_VERSION,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_ERROR_ALGORITHM_ID,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_ERROR_COVERAGE,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_ERROR_ENCLOSURE_METHOD,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_FORMULA_ID,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_RECEIPT_CLAIM_LOCKS,
} from "../../../../shared/contracts/nhm2-semiclassical-v2-scientific-candidate-manifest.v1";
import { NHM2_SEMICLASSICAL_TENSOR_COMPONENTS } from "../../../../shared/contracts/nhm2-semiclassical-state-realizability.v1";
import {
  Nhm2ConformallyFlatNeedleMetricDemandIntervalProducerError,
  produceNhm2ConformallyFlatNeedleMetricDemandIntervals,
} from "../nhm2-conformally-flat-needle-metric-demand-interval-producer";

const TERMINAL_DIRECTORY = path.resolve(
  process.cwd(),
  "artifacts",
  "nhm2-conformal-demand-308c6e2e3e9eaa94a59cc77b",
);

const sha = (label: string): string =>
  createHash("sha256").update(label, "utf8").digest("hex");
const canonicalBytes = (value: unknown): Buffer =>
  Buffer.from(
    canonicalNhm2ConformallyFlatNeedleMetricDemandJson(value),
    "utf8",
  );
const filesystemIdentity = () => ({
  dev: "1",
  ino: "2",
  sizeBytes: "1",
  mtimeNs: "3",
  ctimeNs: "4",
});

const syntheticValidReceipt = () => {
  const sourceSha256 = sha("source");
  const lockSha256 = sha("lock");
  const executableSha256 = sha("executable");
  const centralSha256 =
    NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_V2_FIRST_TERMINAL_PARTIAL_OBSERVATION
      .outputs[0].sha256;
  const errorSha256 =
    NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_V2_FIRST_TERMINAL_PARTIAL_OBSERVATION
      .outputs[1].sha256;
  const traceSha256 =
    NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_V2_FIRST_TERMINAL_PARTIAL_OBSERVATION
      .outputs[2].sha256;
  const derivationUnsigned = {
    artifactId:
      NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_DERIVATION_RECEIPT_ARTIFACT_ID,
    contractVersion:
      NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_DERIVATION_RECEIPT_CONTRACT_VERSION,
    candidateId: "nhm2.conformally_flat_needle_scalar_reference.candidate/v1",
    inputBindings: {
      ...NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_INPUT_BINDINGS,
    },
    derivation: {
      formulaId: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_FORMULA_ID,
      algorithmId: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_ERROR_ALGORITHM_ID,
      enclosureMethod:
        NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_ERROR_ENCLOSURE_METHOD,
      coverage: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_ERROR_COVERAGE,
      relativeEnclosureTarget: 0.01 as const,
      boundScope:
        "deterministic_numerical_error_only_physical_constant_uncertainty_excluded" as const,
      zeroBoundDisposition:
        "strictly_positive_componentwise_bounds_required_pending_exact_zero_derivation_replay" as const,
      constants: {
        speedOfLightMetersPerSecond: 299792458 as const,
        newtonianGravitationalConstantSI: 6.6743e-11 as const,
        newtonianGravitationalConstantStandardUncertaintySI: 1.5e-15 as const,
        einsteinCouplingConvention: "T_hat_ab=(c^4/(8*pi*G))*G_hat_ab" as const,
      },
      intervalTraceSha256: traceSha256,
    },
    implementation: {
      sourceSha256,
      dependencyLockSha256: lockSha256,
      toolchainArtifactSha256: executableSha256,
      executableSha256,
    },
    execution: {
      authority: "executor_observed" as const,
      gitCommitSha: "a".repeat(40),
      command: process.execPath,
      argv: [],
      startedAt: "2026-08-10T00:00:00.000Z",
      completedAt: "2026-08-10T00:00:01.000Z",
      durationMs: 1000,
      exitCode: 0 as const,
    },
    outputs: {
      centralTensor: {
        inputId: "metric_demand_tensor" as const,
        sha256: centralSha256,
        sizeBytes: 5120 as const,
        freshness: "created_or_modified_during_execution" as const,
      },
      deterministicAbsoluteErrorBound: {
        inputId: "metric_demand_absolute_error_bound" as const,
        sha256: errorSha256,
        sizeBytes: 5120 as const,
        unit: "J/m^3" as const,
        shape: [64, 10] as [64, 10],
        componentOrder: [...NHM2_SEMICLASSICAL_TENSOR_COMPONENTS],
        freshness: "created_or_modified_during_execution" as const,
      },
      intervalTrace: {
        sha256: traceSha256,
        sizeBytes: 382907,
        freshness: "created_or_modified_during_execution" as const,
      },
    },
    verificationStatus:
      "metric_demand_derivation_executor_provenance_unverified" as const,
    claimLocks: { ...NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_RECEIPT_CLAIM_LOCKS },
    integrity: {
      hashAlgorithm: "sha256" as const,
      canonicalization: "utf8_lexicographic_object_keys_json_v1" as const,
    },
  };
  const derivationReceipt = {
    ...derivationUnsigned,
    integrity: {
      ...derivationUnsigned.integrity,
      receiptSha256: sha256Nhm2ConformallyFlatNeedleMetricDemandBytes(
        canonicalNhm2ConformallyFlatNeedleMetricDemandJson(derivationUnsigned),
      ),
    },
  };
  const derivationBytes = canonicalBytes(derivationReceipt);
  const outputDirectory = path.resolve(
    "artifacts",
    "synthetic-v2-reproduction",
  );
  const outputRows = [
    {
      role: "metric_demand_tensor" as const,
      relativePath:
        NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_CENTRAL_FILE_NAME,
      sha256: centralSha256,
      sizeBytes: 5120,
    },
    {
      role: "metric_demand_absolute_error_bound" as const,
      relativePath: NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_ERROR_FILE_NAME,
      sha256: errorSha256,
      sizeBytes: 5120,
    },
    {
      role: "metric_demand_interval_trace" as const,
      relativePath: NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_TRACE_FILE_NAME,
      sha256: traceSha256,
      sizeBytes: 382907,
    },
    {
      role: "metric_demand_derivation_receipt" as const,
      relativePath:
        NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_DERIVATION_RECEIPT_FILE_NAME,
      sha256: sha256Nhm2ConformallyFlatNeedleMetricDemandBytes(derivationBytes),
      sizeBytes: derivationBytes.byteLength,
    },
  ];
  const unsigned = {
    artifactId:
      NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_INTERVAL_RUN_ARTIFACT_ID,
    contractVersion:
      NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_INTERVAL_RUN_CONTRACT_VERSION,
    authority: "server_executor_observation_diagnostic_only" as const,
    status: "outputs_exclusively_created_and_securely_reread" as const,
    runMode: "receipt_capture_reproduction_of_terminal_v2_failure" as const,
    configurationSha256:
      NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_CONFIGURATION_SHA256,
    executionObservation: {
      invocationId: sha("invocation"),
      repositoryRoot: process.cwd(),
      gitCommitSha: "a".repeat(40),
      gitWorktreeState: "dirty" as const,
      command: process.execPath,
      argv: [],
      startedAt: "2026-08-10T00:00:00.000Z",
      completedAt: "2026-08-10T00:00:02.000Z",
      durationMs: 2000,
      exitCode: 0 as const,
      implementationSourceSha256: sourceSha256,
      dependencyLockSha256: lockSha256,
      toolchainArtifactSha256: executableSha256,
      executableSha256,
      observationLimit:
        "host_process_observed_in_process_operation_not_independent_replay" as const,
      implementationHashesStableAcrossCalculation: true as const,
    },
    outputDirectory: {
      absolutePath: outputDirectory,
      prestate: "absent_observed_before_exclusive_create" as const,
      creation: "directory_created_exclusively" as const,
      freshness: "new" as const,
    },
    outputs: outputRows.map((row) => ({
      ...row,
      absolutePath: path.join(outputDirectory, row.relativePath),
      freshness: "created_new_during_execution" as const,
      prestate: "absent_observed_before_exclusive_create" as const,
      secureReadbackVerified: true as const,
      filesystemIdentity: filesystemIdentity(),
    })),
    priorTerminalObservation: {
      authority: "unauthenticated_partial_terminal_output_observation" as const,
      outputDirectoryAbsolutePath: TERMINAL_DIRECTORY,
      configurationSha256:
        NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_CONFIGURATION_SHA256,
      implementationSourceSha256: null,
      executorReceiptPresent: false as const,
      numericalGate: "frozen_enclosure_target_failed_without_retuning" as const,
      maximumRelativeFrobeniusEnclosure: 0.12854082269732725 as const,
      frozenRelativeEnclosureTarget: 0.01 as const,
      outputs:
        NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_V2_FIRST_TERMINAL_PARTIAL_OBSERVATION.outputs.map(
          (row) => ({
            ...row,
            absolutePath: path.join(TERMINAL_DIRECTORY, row.relativePath),
            freshness:
              "preexisting_terminal_partial_securely_reread_for_reproduction" as const,
            filesystemIdentity: filesystemIdentity(),
          }),
        ),
    },
    bitwiseReproduction: {
      centralTensorSha256Identical: true as const,
      deterministicErrorBoundSha256Identical: true as const,
      intervalTraceSha256Identical: true as const,
      allThreeOutputsBitwiseIdentical: true as const,
    },
    resourceObservation: {
      requestedNodeHeapCeilingMegabytes: 2304 as const,
      nodeHeapCeilingProcessArgumentObserved: true as const,
      observedNodeHeapLimitBytes: 2_400_000_000,
      callerDeclaredExternalWallTimeCeilingMs: 600000 as const,
      externalWallTimeEnforcement:
        "caller_wrapper_declared_not_in_process_verified" as const,
      traceMaximumBytes: 8388608 as const,
      traceSizeBytes: 382907,
      processPeakRssBytes: 1_000_000,
      peakRssObservationScope:
        "host_process_lifetime_not_run_exclusive" as const,
      resourceEnvelopeIndependentlyVerified: false as const,
    },
    derivationReceipt,
    candidateInputAdmissible: false as const,
    scientificCandidateDisposition:
      "numerical_enclosure_protocol_failure_not_scientific_candidate_failure" as const,
    frozenEnclosureGate:
      "frozen_enclosure_target_failed_without_retuning" as const,
    intervalTraceVerificationStatus:
      "producer_self_check_only_not_server_replayed" as const,
    authorityBlockers: [
      ...NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_RUN_AUTHORITY_BLOCKERS,
    ],
    claimLocks: { ...NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_CLAIM_LOCKS },
    integrity: {
      hashAlgorithm: "sha256" as const,
      canonicalization: "utf8_lexicographic_object_keys_json_v1" as const,
    },
  };
  return {
    ...unsigned,
    integrity: {
      ...unsigned.integrity,
      receiptSha256:
        computeNhm2ConformallyFlatNeedleMetricDemandRunReceiptSha256(unsigned),
    },
  } as Nhm2ConformallyFlatNeedleMetricDemandIntervalRunReceiptV1;
};

describe("NHM2 conformal midpoint-Hessian interval producer", () => {
  it("freezes distinct v1 failure and v2 terminal-partial lineages", () => {
    expect(
      NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_CONFIGURATION_SHA256,
    ).toBe("a18e3d1bb95b83bceb56a5a61cc2d5c030c70cc5eefccf150c1b9dd96ddaeaa7");
    expect(
      NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_V1_FAILURE_OBSERVATION_SHA256,
    ).toBe("401bea3a6420358edc134be7e1a199f534ccb91d66b6abeb53c4699916d20007");
    expect(
      NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_V2_FIRST_TERMINAL_PARTIAL_OBSERVATION_SHA256,
    ).toBe("ba7d5bd2d7b02777a415c03154a36756c5020a14f20e05987404697f0468169a");
    expect(
      NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_V1_FAILURE_OBSERVATION.observedMaximumFrobeniusEnclosureRatio,
    ).toBe(0.5489588496881855);
    expect(
      NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_CONFIGURATION.integrationAlgorithmId,
    ).toContain("midpoint");
    expect(
      NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_V1_FAILURE_OBSERVATION
        .configuration.integrationMethod,
    ).toContain("darboux");
  });

  it("replays the immutable terminal trace and arrays without granting authority", async () => {
    const [centralBytes, errorBytes, traceBytes] = await Promise.all([
      fs.readFile(
        path.join(
          TERMINAL_DIRECTORY,
          NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_CENTRAL_FILE_NAME,
        ),
      ),
      fs.readFile(
        path.join(
          TERMINAL_DIRECTORY,
          NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_ERROR_FILE_NAME,
        ),
      ),
      fs.readFile(
        path.join(
          TERMINAL_DIRECTORY,
          NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_TRACE_FILE_NAME,
        ),
      ),
    ]);
    const frozen =
      NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_V2_FIRST_TERMINAL_PARTIAL_OBSERVATION.outputs;
    expect(centralBytes.byteLength).toBe(
      NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_ARRAY_SIZE_BYTES,
    );
    expect(errorBytes.byteLength).toBe(
      NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_ARRAY_SIZE_BYTES,
    );
    expect(createHash("sha256").update(centralBytes).digest("hex")).toBe(
      frozen[0].sha256,
    );
    expect(createHash("sha256").update(errorBytes).digest("hex")).toBe(
      frozen[1].sha256,
    );
    expect(createHash("sha256").update(traceBytes).digest("hex")).toBe(
      frozen[2].sha256,
    );
    const traceText = traceBytes.toString("utf8");
    const trace = JSON.parse(
      traceText,
    ) as Nhm2ConformallyFlatNeedleMetricDemandIntervalTraceV1;
    expect(canonicalNhm2ConformallyFlatNeedleMetricDemandJson(trace)).toBe(
      traceText,
    );
    expect(trace.artifactId).toBe(
      NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_INTERVAL_TRACE_ARTIFACT_ID,
    );
    expect(trace.contractVersion).toBe(
      NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_INTERVAL_TRACE_CONTRACT_VERSION,
    );
    expect(trace.samples).toHaveLength(64);
    expect(trace.summary.maximumRelativeFrobeniusEnclosure).toBe(
      0.12854082269732725,
    );
    expect(trace.summary.targetMetAtEverySample).toBe(false);
    expect(trace.summary.strictlyPositiveComponentErrorBoundCount).toBe(640);
    expect(
      Object.values(trace.claimLocks).every((value) => value === false),
    ).toBe(true);
    expect(
      trace.arithmeticEvidence.hardTargetUsesOutwardSquaredComparison,
    ).toBe(true);
    expect(trace.arithmeticEvidence.producerSelfCheckIsNotServerProof).toBe(
      true,
    );
    const central = new Float64Array(640);
    const errors = new Float64Array(640);
    for (let index = 0; index < 640; index += 1) {
      central[index] = centralBytes.readDoubleLE(index * 8);
      errors[index] = errorBytes.readDoubleLE(index * 8);
      expect(Number.isFinite(central[index])).toBe(true);
      expect(errors[index]).toBeGreaterThan(0);
    }
    for (let sample = 0; sample < 64; sample += 1) {
      expect(central[sample * 10 + 1]).toBe(0);
      expect(central[sample * 10 + 2]).toBe(0);
      expect(central[sample * 10 + 3]).toBe(0);
      trace.samples[sample].selectedComponentIntervalsSI.forEach(
        ([lower, upper], component) => {
          const value = central[sample * 10 + component];
          expect(lower).toBeLessThanOrEqual(value);
          expect(value).toBeLessThanOrEqual(upper);
        },
      );
    }
  });

  it("accepts only the exact diagnostic reproduction receipt surface", () => {
    const receipt = syntheticValidReceipt();
    expect(
      hasValidNhm2ConformallyFlatNeedleMetricDemandRunReceiptIntegrity(receipt),
    ).toBe(true);
    const emptyClaims = structuredClone(receipt) as any;
    emptyClaims.derivationReceipt.claimLocks = {};
    expect(
      hasValidNhm2ConformallyFlatNeedleMetricDemandRunReceiptIntegrity(
        emptyClaims,
      ),
    ).toBe(false);
    const wrongOrder = structuredClone(receipt) as any;
    [wrongOrder.outputs[0], wrongOrder.outputs[1]] = [
      wrongOrder.outputs[1],
      wrongOrder.outputs[0],
    ];
    expect(
      hasValidNhm2ConformallyFlatNeedleMetricDemandRunReceiptIntegrity(
        wrongOrder,
      ),
    ).toBe(false);
    const getter = structuredClone(receipt) as any;
    Object.defineProperty(getter.executionObservation, "durationMs", {
      enumerable: true,
      get: () => 2000,
    });
    expect(
      hasValidNhm2ConformallyFlatNeedleMetricDemandRunReceiptIntegrity(getter),
    ).toBe(false);
    const symbol = structuredClone(receipt) as any;
    symbol[Symbol("malleable")] = true;
    expect(
      hasValidNhm2ConformallyFlatNeedleMetricDemandRunReceiptIntegrity(symbol),
    ).toBe(false);
  });

  it("rejects a bad prior inventory before deriving or creating a run child", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "nhm2-interval-preflight-"),
    );
    const parent = path.join(root, "outputs");
    const prior = path.join(root, "prior");
    await fs.mkdir(parent);
    await fs.mkdir(prior);
    await Promise.all([
      fs.writeFile(
        path.join(
          prior,
          NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_CENTRAL_FILE_NAME,
        ),
        Buffer.alloc(8),
      ),
      fs.writeFile(
        path.join(
          prior,
          NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_ERROR_FILE_NAME,
        ),
        Buffer.alloc(8),
      ),
      fs.writeFile(
        path.join(
          prior,
          NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_TRACE_FILE_NAME,
        ),
        Buffer.from("{}"),
      ),
    ]);
    const heapArgument = "--max-old-space-size=2304";
    const insertedHeapArgument = !process.execArgv.includes(heapArgument);
    if (insertedHeapArgument) process.execArgv.push(heapArgument);
    try {
      await expect(
        produceNhm2ConformallyFlatNeedleMetricDemandIntervals({
          outputParentDirectory: parent,
          repositoryRoot: process.cwd(),
          priorTerminalObservationDirectory: prior,
          externalWallTimeCeilingMs: 600000,
          invocationNonce: () => new Uint8Array(32),
        }),
      ).rejects.toMatchObject<
        Partial<Nhm2ConformallyFlatNeedleMetricDemandIntervalProducerError>
      >({ code: "prior_terminal_observation_invalid" });
      expect(await fs.readdir(parent)).toEqual([]);
    } finally {
      if (insertedHeapArgument) {
        process.execArgv.splice(process.execArgv.indexOf(heapArgument), 1);
      }
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
