import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_ARRAY_SIZE_BYTES,
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_AUTHORITY_BLOCKERS,
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_CANDIDATE_ID,
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_CENTRAL_FILE_NAME,
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_CLAIM_LOCKS,
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_CONFIGURATION_SHA256,
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_DERIVATION_RECEIPT_FILE_NAME,
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_ERROR_FILE_NAME,
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_INPUT_BINDINGS,
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_INTERVAL_RUN_ARTIFACT_ID,
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_INTERVAL_RUN_CONTRACT_VERSION,
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_RUN_AUTHORITY_BLOCKERS,
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_TRACE_FILE_NAME,
  canonicalNhm2ConformallyFlatNeedleMetricDemandJson,
  computeNhm2ConformallyFlatNeedleMetricDemandRunReceiptSha256,
} from "../../../../shared/contracts/nhm2-conformally-flat-needle-metric-demand-interval-producer.v1";
import {
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_DERIVATION_VERIFICATION_BLOCKERS,
  NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_DERIVATION_VERIFICATION_CLAIM_LOCKS,
  computeNhm2ConformallyFlatNeedleMetricDemandDerivationVerificationSha256,
  hasValidNhm2ConformallyFlatNeedleMetricDemandDerivationVerificationIntegrity,
} from "../../../../shared/contracts/nhm2-conformally-flat-needle-metric-demand-derivation-verification.v1";
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
  Nhm2ConformallyFlatNeedleMetricDemandDerivationVerifierError,
  replayNhm2ConformallyFlatNeedleOutwardSquaredFrobeniusGate,
  replayNhm2ConformallyFlatNeedleMetricDemandStructuralTrace,
  verifyNhm2ConformallyFlatNeedleMetricDemandDerivation,
} from "../nhm2-conformally-flat-needle-metric-demand-derivation-verifier";
import { bridgeNhm2ConformallyFlatNeedleMetricDemandDerivationVerification } from "../nhm2-semiclassical-v2-metric-demand-derivation-replay-bridge";

const sha = (label: string): string =>
  createHash("sha256").update(label, "utf8").digest("hex");
const canonicalBytes = (value: unknown): Buffer =>
  Buffer.from(
    canonicalNhm2ConformallyFlatNeedleMetricDemandJson(value),
    "utf8",
  );
const bytesSha = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
const TERMINAL_V2_PARTIAL_DIRECTORY = path.resolve(
  process.cwd(),
  "artifacts",
  "nhm2-conformal-demand-308c6e2e3e9eaa94a59cc77b",
);

const outwardUp = (value: number): number =>
  value === 0
    ? Number.MIN_VALUE
    : value + Math.max(Number.MIN_VALUE, Math.abs(value) * 2 ** -52);

const float64Bytes = (values: readonly number[]): Buffer => {
  const bytes = Buffer.alloc(values.length * 8);
  values.forEach((value, index) => bytes.writeDoubleLE(value, index * 8));
  return bytes;
};

type Fixture = {
  trace: any;
  centralValues: number[];
  errorValues: number[];
  centralBytes: Buffer;
  errorBytes: Buffer;
  traceBytes: Buffer;
  receipt: any;
  receiptBytes: Buffer;
  observation: {
    implementationSourceSha256: string;
    dependencyLockSha256: string;
    toolchainArtifactSha256: string;
    executableSha256: string;
  };
};

const resealFixture = (fixture: Fixture): void => {
  fixture.centralBytes = float64Bytes(fixture.centralValues);
  fixture.errorBytes = float64Bytes(fixture.errorValues);
  fixture.traceBytes = canonicalBytes(fixture.trace);
  const centralSha256 = bytesSha(fixture.centralBytes);
  const errorSha256 = bytesSha(fixture.errorBytes);
  const traceSha256 = bytesSha(fixture.traceBytes);
  const derivationUnsigned = {
    artifactId:
      NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_DERIVATION_RECEIPT_ARTIFACT_ID,
    contractVersion:
      NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_DERIVATION_RECEIPT_CONTRACT_VERSION,
    candidateId: NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_CANDIDATE_ID,
    inputBindings: NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_INPUT_BINDINGS,
    derivation: {
      formulaId: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_FORMULA_ID,
      algorithmId: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_ERROR_ALGORITHM_ID,
      enclosureMethod:
        NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_ERROR_ENCLOSURE_METHOD,
      coverage: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_ERROR_COVERAGE,
      relativeEnclosureTarget: 0.01,
      boundScope:
        "deterministic_numerical_error_only_physical_constant_uncertainty_excluded",
      zeroBoundDisposition:
        "strictly_positive_componentwise_bounds_required_pending_exact_zero_derivation_replay",
      constants: {
        speedOfLightMetersPerSecond: 299792458,
        newtonianGravitationalConstantSI: 6.6743e-11,
        newtonianGravitationalConstantStandardUncertaintySI: 1.5e-15,
        einsteinCouplingConvention: "T_hat_ab=(c^4/(8*pi*G))*G_hat_ab",
      },
      intervalTraceSha256: traceSha256,
    },
    implementation: {
      sourceSha256: sha("producer-source"),
      dependencyLockSha256: sha("producer-lock"),
      toolchainArtifactSha256: sha("producer-toolchain"),
      executableSha256: sha("producer-executable"),
    },
    execution: {
      authority: "executor_observed",
      gitCommitSha: "a".repeat(40),
      command: process.execPath,
      argv: ["server/metric-demand-producer.ts"],
      startedAt: "2026-08-10T12:00:00.000Z",
      completedAt: "2026-08-10T12:00:01.000Z",
      durationMs: 1000,
      exitCode: 0,
    },
    outputs: {
      centralTensor: {
        inputId: "metric_demand_tensor",
        sha256: centralSha256,
        sizeBytes: 5120,
        freshness: "created_or_modified_during_execution",
      },
      deterministicAbsoluteErrorBound: {
        inputId: "metric_demand_absolute_error_bound",
        sha256: errorSha256,
        sizeBytes: 5120,
        unit: "J/m^3",
        shape: [64, 10],
        componentOrder: [...NHM2_SEMICLASSICAL_TENSOR_COMPONENTS],
        freshness: "created_or_modified_during_execution",
      },
      intervalTrace: {
        sha256: traceSha256,
        sizeBytes: fixture.traceBytes.byteLength,
        freshness: "created_or_modified_during_execution",
      },
    },
    verificationStatus:
      "metric_demand_derivation_executor_provenance_unverified",
    claimLocks: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_RECEIPT_CLAIM_LOCKS,
    integrity: {
      hashAlgorithm: "sha256",
      canonicalization: "utf8_lexicographic_object_keys_json_v1",
    },
  };
  const derivationReceipt = {
    ...derivationUnsigned,
    integrity: {
      ...derivationUnsigned.integrity,
      receiptSha256: bytesSha(canonicalBytes(derivationUnsigned)),
    },
  };
  const derivationBytes = canonicalBytes(derivationReceipt);
  const repositoryRoot = path.resolve(
    process.cwd(),
    ".nhm2-fixture-repository",
  );
  const outputDirectory = path.resolve(process.cwd(), ".nhm2-fixture-output");
  const files = [
    {
      role: "metric_demand_tensor",
      relativePath:
        NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_CENTRAL_FILE_NAME,
      bytes: fixture.centralBytes,
    },
    {
      role: "metric_demand_absolute_error_bound",
      relativePath: NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_ERROR_FILE_NAME,
      bytes: fixture.errorBytes,
    },
    {
      role: "metric_demand_interval_trace",
      relativePath: NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_TRACE_FILE_NAME,
      bytes: fixture.traceBytes,
    },
    {
      role: "metric_demand_derivation_receipt",
      relativePath:
        NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_DERIVATION_RECEIPT_FILE_NAME,
      bytes: derivationBytes,
    },
  ];
  const unsignedReceipt = {
    artifactId:
      NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_INTERVAL_RUN_ARTIFACT_ID,
    contractVersion:
      NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_INTERVAL_RUN_CONTRACT_VERSION,
    authority: "server_executor_observation_diagnostic_only",
    status: "outputs_exclusively_created_and_securely_reread",
    runMode: "receipt_capture_reproduction_of_terminal_v2_failure",
    configurationSha256:
      NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_CONFIGURATION_SHA256,
    executionObservation: {
      invocationId: sha("producer-invocation"),
      repositoryRoot,
      gitCommitSha: derivationReceipt.execution.gitCommitSha,
      gitWorktreeState: "clean",
      command: derivationReceipt.execution.command,
      argv: [...derivationReceipt.execution.argv],
      startedAt: derivationReceipt.execution.startedAt,
      completedAt: "2026-08-10T12:00:02.000Z",
      durationMs: 2000,
      exitCode: 0,
      implementationSourceSha256: derivationReceipt.implementation.sourceSha256,
      dependencyLockSha256:
        derivationReceipt.implementation.dependencyLockSha256,
      toolchainArtifactSha256:
        derivationReceipt.implementation.toolchainArtifactSha256,
      executableSha256: derivationReceipt.implementation.executableSha256,
      observationLimit:
        "host_process_observed_in_process_operation_not_independent_replay",
      implementationHashesStableAcrossCalculation: true,
    },
    outputDirectory: {
      absolutePath: outputDirectory,
      prestate: "absent_observed_before_exclusive_create",
      creation: "directory_created_exclusively",
      freshness: "new",
    },
    outputs: files.map((file, index) => ({
      role: file.role,
      relativePath: file.relativePath,
      absolutePath: path.join(outputDirectory, file.relativePath),
      sha256: bytesSha(file.bytes),
      sizeBytes: file.bytes.byteLength,
      freshness: "created_new_during_execution",
      prestate: "absent_observed_before_exclusive_create",
      secureReadbackVerified: true,
      filesystemIdentity: {
        dev: "1",
        ino: String(index + 1),
        sizeBytes: String(file.bytes.byteLength),
        mtimeNs: String(10_000 + index),
        ctimeNs: String(20_000 + index),
      },
    })),
    priorTerminalObservation: {
      authority: "unauthenticated_partial_terminal_output_observation",
      outputDirectoryAbsolutePath: path.resolve(TERMINAL_V2_PARTIAL_DIRECTORY),
      configurationSha256:
        NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_CONFIGURATION_SHA256,
      implementationSourceSha256: null,
      executorReceiptPresent: false,
      numericalGate: "frozen_enclosure_target_failed_without_retuning",
      maximumRelativeFrobeniusEnclosure: 0.12854082269732725,
      frozenRelativeEnclosureTarget: 0.01,
      outputs: files.slice(0, 3).map((file, index) => ({
        role: file.role,
        relativePath: file.relativePath,
        absolutePath: path.resolve(
          TERMINAL_V2_PARTIAL_DIRECTORY,
          file.relativePath,
        ),
        sha256: bytesSha(file.bytes),
        sizeBytes: file.bytes.byteLength,
        freshness:
          "preexisting_terminal_partial_securely_reread_for_reproduction",
        filesystemIdentity: {
          dev: "1",
          ino: String(100 + index),
          sizeBytes: String(file.bytes.byteLength),
          mtimeNs: String(30_000 + index),
          ctimeNs: String(40_000 + index),
        },
      })),
    },
    bitwiseReproduction: {
      centralTensorSha256Identical: true,
      deterministicErrorBoundSha256Identical: true,
      intervalTraceSha256Identical: true,
      allThreeOutputsBitwiseIdentical: true,
    },
    resourceObservation: {
      requestedNodeHeapCeilingMegabytes: 2304,
      nodeHeapCeilingProcessArgumentObserved: true,
      observedNodeHeapLimitBytes: 2_400_000_000,
      callerDeclaredExternalWallTimeCeilingMs: 600000,
      externalWallTimeEnforcement:
        "caller_wrapper_declared_not_in_process_verified",
      traceMaximumBytes: 8_388_608,
      traceSizeBytes: fixture.traceBytes.byteLength,
      processPeakRssBytes: 1_000_000,
      peakRssObservationScope: "host_process_lifetime_not_run_exclusive",
      resourceEnvelopeIndependentlyVerified: false,
    },
    derivationReceipt,
    candidateInputAdmissible: false,
    scientificCandidateDisposition:
      "numerical_enclosure_protocol_failure_not_scientific_candidate_failure",
    frozenEnclosureGate: "frozen_enclosure_target_failed_without_retuning",
    intervalTraceVerificationStatus:
      "producer_self_check_only_not_server_replayed",
    authorityBlockers:
      NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_RUN_AUTHORITY_BLOCKERS,
    claimLocks: NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_CLAIM_LOCKS,
    integrity: {
      hashAlgorithm: "sha256",
      canonicalization: "utf8_lexicographic_object_keys_json_v1",
    },
  } as any;
  fixture.receipt = {
    ...unsignedReceipt,
    integrity: {
      ...unsignedReceipt.integrity,
      receiptSha256:
        computeNhm2ConformallyFlatNeedleMetricDemandRunReceiptSha256(
          unsignedReceipt,
        ),
    },
  };
  fixture.receiptBytes = canonicalBytes(fixture.receipt);
};

const makeFixture = (): Fixture => {
  const centralBytes = readFileSync(
    path.join(
      TERMINAL_V2_PARTIAL_DIRECTORY,
      NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_CENTRAL_FILE_NAME,
    ),
  );
  const errorBytes = readFileSync(
    path.join(
      TERMINAL_V2_PARTIAL_DIRECTORY,
      NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_ERROR_FILE_NAME,
    ),
  );
  const traceBytes = readFileSync(
    path.join(
      TERMINAL_V2_PARTIAL_DIRECTORY,
      NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_TRACE_FILE_NAME,
    ),
  );
  const centralValues = Array.from({ length: 640 }, (_, index) =>
    centralBytes.readDoubleLE(index * 8),
  );
  const errorValues = Array.from({ length: 640 }, (_, index) =>
    errorBytes.readDoubleLE(index * 8),
  );
  const trace = JSON.parse(traceBytes.toString("utf8"));
  const fixture: Fixture = {
    trace,
    centralValues,
    errorValues,
    centralBytes,
    errorBytes,
    traceBytes,
    receipt: null,
    receiptBytes: Buffer.alloc(0),
    observation: {
      implementationSourceSha256: sha("structural-replayer-source"),
      dependencyLockSha256: sha("structural-replayer-lock"),
      toolchainArtifactSha256: sha("structural-replayer-toolchain"),
      executableSha256: sha("structural-replayer-executable"),
    },
  };
  resealFixture(fixture);
  fixture.receipt.frozenEnclosureGate = trace.summary.frozenGateDisposition;
  const { receiptSha256: _old, ...integrity } = fixture.receipt.integrity;
  fixture.receipt.integrity = {
    ...integrity,
    receiptSha256: computeNhm2ConformallyFlatNeedleMetricDemandRunReceiptSha256(
      {
        ...fixture.receipt,
        integrity,
      },
    ),
  };
  fixture.receiptBytes = canonicalBytes(fixture.receipt);
  return fixture;
};

const verify = (fixture: Fixture) =>
  verifyNhm2ConformallyFlatNeedleMetricDemandDerivation({
    producerRunReceiptBytes: fixture.receiptBytes,
    centralTensorBytes: fixture.centralBytes,
    absoluteErrorBoundBytes: fixture.errorBytes,
    intervalTraceBytes: fixture.traceBytes,
    structuralReplayerImplementationObservation: fixture.observation,
  });

const structurallyReplay = (fixture: Fixture) =>
  replayNhm2ConformallyFlatNeedleMetricDemandStructuralTrace({
    centralTensorBytes: fixture.centralBytes,
    absoluteErrorBoundBytes: fixture.errorBytes,
    intervalTraceBytes: fixture.traceBytes,
  });

const expectCode = (
  callback: () => unknown,
  code: Nhm2ConformallyFlatNeedleMetricDemandDerivationVerifierError["code"],
): void => {
  try {
    callback();
    throw new Error("expected verifier rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(
      Nhm2ConformallyFlatNeedleMetricDemandDerivationVerifierError,
    );
    expect(
      (error as Nhm2ConformallyFlatNeedleMetricDemandDerivationVerifierError)
        .code,
    ).toBe(code);
  }
};

describe.sequential(
  "NHM2 conformally-flat metric-demand outer derivation verifier",
  () => {
    it("emits an integrity-valid but structurally blocked artifact without promoting the producer", () => {
      // Models the frozen v2 terminal enclosure-failure disposition.
      // Structural consistency is inspectable, but the 1% gate is not met.
      const fixture = makeFixture();
      const artifact = verify(fixture);
      const bridge =
        bridgeNhm2ConformallyFlatNeedleMetricDemandDerivationVerification({
          verificationArtifact: artifact,
          centralTensorBytes: fixture.centralBytes,
          absoluteErrorBoundBytes: fixture.errorBytes,
          intervalTraceBytes: fixture.traceBytes,
        });

      expect(artifact.status).toBe(
        "blocked_structural_replay_only_candidate_input_inadmissible",
      );
      expect(artifact.authority).toBe("diagnostic_structural_binding_only");
      expect(artifact.authorityBlockers).toEqual(
        NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_DERIVATION_VERIFICATION_BLOCKERS,
      );
      expect(artifact.authorityBlockers).toContain(
        "outer_execution_driver_source_not_hash_bound",
      );
      expect(artifact.authorityBlockers).toContain(
        "structural_replayer_runtime_provenance_not_independently_authenticated",
      );
      expect(artifact.independentReplay).toMatchObject({
        engineStatus: "not_implemented",
        transcendentalPrimitivesRecomputed: false,
        cellwiseIntegrandsRecomputed: false,
        intervalEnclosuresIndependentlyEstablished: false,
        selfAuthoredStatusCanClearAuthority: false,
      });
      expect(artifact.producerBinding.candidateInputAdmissible).toBe(false);
      expect(artifact.resourceEnvelope).toEqual({
        producerObservation: fixture.receipt.resourceObservation,
        traceBytesBoundedByVerifier: true,
        producerExecutionModel: "in_process_synchronous_derivation",
        independentlyVerifiedWallTimeCap: false,
        independentlyVerifiedHeapCap: false,
        independentlyVerifiedRssCap: false,
        resourceSafetyAuthority: false,
      });
      expect(artifact.structuralReplay).toMatchObject({
        producerReportedTargetMetAtEverySample: false,
        reportedFrozenEnclosureGate:
          "frozen_enclosure_target_failed_without_retuning",
        maximumReportedRelativeFrobeniusEnclosure: 0.12854082269732725,
        minimumReportedDenominatorLowerBound: 0.8965265656068966,
        candidateInputAdmissible: false,
      });
      expect(artifact.terminalFailureReproduction).toMatchObject({
        runMode: "receipt_capture_reproduction_of_terminal_v2_failure",
        priorObservationAuthorityNotPromoted: true,
        candidateInputAdmissible: false,
        bitwiseReproduction: {
          allThreeOutputsBitwiseIdentical: true,
        },
      });
      expect(Object.values(artifact.claimLocks).every((value) => !value)).toBe(
        true,
      );
      expect(artifact.claimLocks.outerExecutionDriverSourceBound).toBe(false);
      expect(artifact.claimLocks).toEqual(
        NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_DERIVATION_VERIFICATION_CLAIM_LOCKS,
      );
      expect(
        hasValidNhm2ConformallyFlatNeedleMetricDemandDerivationVerificationIntegrity(
          artifact,
        ),
      ).toBe(true);
      expect(Object.isFrozen(artifact)).toBe(true);
      expect(bridge).toMatchObject({
        status: "blocked",
        authority: "diagnostic_binding_bridge_only",
        capability: null,
        structuralBinding: {
          verificationArtifactIntegrityValid: true,
          centralTensorBytesExact: true,
          absoluteErrorBoundBytesExact: true,
          intervalTraceBytesExact: true,
          reportedTraceRelationsServerReplayed: true,
        },
        independentDerivation: {
          complete: false,
          transcendentalPrimitivesRecomputed: false,
          cellwiseIntegrandsRecomputed: false,
          intervalEnclosuresIndependentlyEstablished: false,
        },
      });
      expect(bridge.blockers).toContain(
        "independent_transcendental_derivation_not_implemented",
      );
      expect(bridge.blockers).toContain(
        "opaque_content_replay_capability_not_issued",
      );
      expect(Object.values(bridge.claimLocks).every((value) => !value)).toBe(
        true,
      );
    });

    it("fails closed across the outward-squared one-percent boundary", () => {
      const central = [100, 0, 0, 0, 4, 2, 1, 3, 2, 5];
      const justBelow =
        replayNhm2ConformallyFlatNeedleOutwardSquaredFrobeniusGate(
          central,
          Array.from({ length: 10 }, () => outwardUp(0.25)),
        );
      const justAbove =
        replayNhm2ConformallyFlatNeedleOutwardSquaredFrobeniusGate(
          central,
          Array.from({ length: 10 }, () => outwardUp(129 / 512)),
        );

      expect(justBelow.displayedRatioUpper).toBeLessThan(0.01);
      expect(justBelow.passed).toBe(true);
      expect(justAbove.displayedRatioUpper).toBeGreaterThan(0.01);
      expect(justAbove.passed).toBe(false);
    });

    it("rejects a producer receipt whose bytes are valid JSON but noncanonical", () => {
      const fixture = makeFixture();
      fixture.receiptBytes = Buffer.from(
        `${fixture.receiptBytes.toString("utf8")}\n`,
        "utf8",
      );
      expectCode(() => verify(fixture), "producer_receipt_noncanonical");
    });

    it("rejects dirty-worktree provenance even when the producer reseals it", () => {
      const fixture = makeFixture();
      fixture.receipt.executionObservation.gitWorktreeState = "dirty";
      const { receiptSha256: _old, ...integrity } = fixture.receipt.integrity;
      fixture.receipt.integrity = {
        ...integrity,
        receiptSha256:
          computeNhm2ConformallyFlatNeedleMetricDemandRunReceiptSha256({
            ...fixture.receipt,
            integrity,
          }),
      };
      fixture.receiptBytes = canonicalBytes(fixture.receipt);
      expectCode(() => verify(fixture), "producer_provenance_invalid");
    });

    it("rejects one changed central float64 byte instead of trusting self-authored hashes", () => {
      const fixture = makeFixture();
      fixture.centralBytes[0] ^= 1;
      expectCode(() => verify(fixture), "derivation_receipt_integrity_invalid");
    });

    it("rejects a noncanonical trace before inspecting its claims", () => {
      const fixture = makeFixture();
      fixture.traceBytes = Buffer.from(
        `${fixture.traceBytes.toString("utf8")} `,
        "utf8",
      );
      expectCode(() => verify(fixture), "derivation_receipt_integrity_invalid");
    });

    it("rejects a zero denominator in isolated structural replay", () => {
      const fixture = makeFixture();
      fixture.trace.samples[9].levels[1].denominatorIntegral[0] = 0;
      fixture.trace.summary.minimumDenominatorLowerBound = 0;
      fixture.traceBytes = canonicalBytes(fixture.trace);
      expectCode(
        () => structurallyReplay(fixture),
        "interval_trace_coverage_invalid",
      );
    });

    it("rejects a cumulative-intersection coverage gap", () => {
      const fixture = makeFixture();
      fixture.trace.samples[2].levels[1].componentDemandIntervalsSI[4] = [
        200, 201,
      ];
      fixture.trace.samples[2].levels[1].cumulativeIntersectionIntervalsSI[4] =
        [200, 201];
      fixture.traceBytes = canonicalBytes(fixture.trace);
      expectCode(
        () => structurallyReplay(fixture),
        "interval_trace_enclosure_invalid",
      );
    });

    it("rejects a missing sample even if the summary remains producer-green", () => {
      const fixture = makeFixture();
      fixture.trace.samples.pop();
      fixture.traceBytes = canonicalBytes(fixture.trace);
      expectCode(
        () => structurallyReplay(fixture),
        "interval_trace_coverage_invalid",
      );
    });

    it("rejects a false trace summary after exact trace re-binding", () => {
      const fixture = makeFixture();
      fixture.trace.summary.maximumRelativeFrobeniusEnclosure /= 2;
      fixture.traceBytes = canonicalBytes(fixture.trace);
      expectCode(
        () => structurallyReplay(fixture),
        "interval_trace_summary_invalid",
      );
    });

    it("rejects a self-authored authority bit even when every enclosing object is resealed", () => {
      const fixture = makeFixture();
      fixture.trace.claimLocks = {
        ...fixture.trace.claimLocks,
        diagnosticPass: true,
      };
      fixture.traceBytes = canonicalBytes(fixture.trace);
      expectCode(
        () => structurallyReplay(fixture),
        "interval_trace_semantics_invalid",
      );
    });

    it("rejects an extra top-level authority claim even after verification-artifact resealing", () => {
      const rogue: any = structuredClone(verify(makeFixture()));
      rogue.physicalViability = true;
      const { artifactSha256: _old, ...integrity } = rogue.integrity;
      rogue.integrity = {
        ...integrity,
        artifactSha256:
          computeNhm2ConformallyFlatNeedleMetricDemandDerivationVerificationSha256(
            { ...rogue, integrity },
          ),
      };
      expect(
        hasValidNhm2ConformallyFlatNeedleMetricDemandDerivationVerificationIntegrity(
          rogue,
        ),
      ).toBe(false);
    });

    it("rejects a nested physical-authority claim after verification-artifact resealing", () => {
      const rogue: any = structuredClone(verify(makeFixture()));
      rogue.structuralReplay.physicalViability = true;
      const { artifactSha256: _old, ...integrity } = rogue.integrity;
      rogue.integrity = {
        ...integrity,
        artifactSha256:
          computeNhm2ConformallyFlatNeedleMetricDemandDerivationVerificationSha256(
            { ...rogue, integrity },
          ),
      };
      expect(
        hasValidNhm2ConformallyFlatNeedleMetricDemandDerivationVerificationIntegrity(
          rogue,
        ),
      ).toBe(false);
    });

    it("rejects a resealed claim that the observed resource envelope was independently verified", () => {
      const rogue: any = structuredClone(verify(makeFixture()));
      rogue.resourceEnvelope.producerObservation.resourceEnvelopeIndependentlyVerified = true;
      const { artifactSha256: _old, ...integrity } = rogue.integrity;
      rogue.integrity = {
        ...integrity,
        artifactSha256:
          computeNhm2ConformallyFlatNeedleMetricDemandDerivationVerificationSha256(
            { ...rogue, integrity },
          ),
      };
      expect(
        hasValidNhm2ConformallyFlatNeedleMetricDemandDerivationVerificationIntegrity(
          rogue,
        ),
      ).toBe(false);
    });

    it("rejects a claimed bitwise reproduction whose prior hash differs", () => {
      const fixture = makeFixture();
      fixture.receipt.priorTerminalObservation.outputs[0].sha256 = sha(
        "different-prior-central",
      );
      const { receiptSha256: _old, ...integrity } = fixture.receipt.integrity;
      fixture.receipt.integrity = {
        ...integrity,
        receiptSha256:
          computeNhm2ConformallyFlatNeedleMetricDemandRunReceiptSha256({
            ...fixture.receipt,
            integrity,
          }),
      };
      fixture.receiptBytes = canonicalBytes(fixture.receipt);
      expectCode(() => verify(fixture), "producer_receipt_integrity_invalid");
    });

    it("rejects an altered frozen formula in isolated structural replay", () => {
      const fixture = makeFixture();
      fixture.trace.derivation.conformalEinsteinTensorFormula =
        "producer_declared_alternative_formula";
      fixture.traceBytes = canonicalBytes(fixture.trace);
      expectCode(
        () => structurallyReplay(fixture),
        "interval_trace_semantics_invalid",
      );
    });

    it("rejects v1 Darboux lineage labels masquerading as the frozen v2 run", () => {
      const fixture = makeFixture();
      fixture.receipt.contractVersion =
        "nhm2_conformally_flat_needle_metric_demand_interval_run/v1";
      const { receiptSha256: _old, ...integrity } = fixture.receipt.integrity;
      fixture.receipt.integrity = {
        ...integrity,
        receiptSha256:
          computeNhm2ConformallyFlatNeedleMetricDemandRunReceiptSha256({
            ...fixture.receipt,
            integrity,
          }),
      };
      fixture.receiptBytes = canonicalBytes(fixture.receipt);
      expectCode(() => verify(fixture), "producer_receipt_integrity_invalid");
    });

    it("rejects a Darboux algorithm relabel inside canonical v2 trace bytes", () => {
      const fixture = makeFixture();
      fixture.trace.configuration = {
        ...fixture.trace.configuration,
        integrationAlgorithmId: "cellwise_natural_interval_darboux_sums/v1",
      };
      fixture.traceBytes = canonicalBytes(fixture.trace);
      expectCode(
        () => structurallyReplay(fixture),
        "interval_trace_semantics_invalid",
      );
    });

    it("rejects exclusive-output prestate drift before structural replay", () => {
      const fixture = makeFixture();
      fixture.receipt.outputs[0].prestate = "preexisting";
      const { receiptSha256: _old, ...integrity } = fixture.receipt.integrity;
      fixture.receipt.integrity = {
        ...integrity,
        receiptSha256:
          computeNhm2ConformallyFlatNeedleMetricDemandRunReceiptSha256({
            ...fixture.receipt,
            integrity,
          }),
      };
      fixture.receiptBytes = canonicalBytes(fixture.receipt);
      expectCode(() => verify(fixture), "producer_receipt_integrity_invalid");
    });

    it("rejects a structural replayer source hash that aliases the producer", () => {
      const fixture = makeFixture();
      fixture.observation.implementationSourceSha256 =
        fixture.receipt.executionObservation.implementationSourceSha256;
      expectCode(() => verify(fixture), "verification_input_invalid");
    });

    it("rejects hidden and symbol-bearing request surfaces", () => {
      const fixture = makeFixture();
      const request: any = {
        producerRunReceiptBytes: fixture.receiptBytes,
        centralTensorBytes: fixture.centralBytes,
        absoluteErrorBoundBytes: fixture.errorBytes,
        intervalTraceBytes: fixture.traceBytes,
        structuralReplayerImplementationObservation: fixture.observation,
      };
      Object.defineProperty(request, "hidden", {
        value: true,
        enumerable: false,
      });
      request[Symbol("authority")] = true;
      expectCode(
        () => verifyNhm2ConformallyFlatNeedleMetricDemandDerivation(request),
        "verification_input_invalid",
      );
    });

    it("keeps the fixed 64x10 byte contract explicit", () => {
      expect(NHM2_CONFORMALLY_FLAT_NEEDLE_METRIC_DEMAND_ARRAY_SIZE_BYTES).toBe(
        5120,
      );
      const fixture = makeFixture();
      expect(fixture.centralBytes).toHaveLength(5120);
      expect(fixture.errorBytes).toHaveLength(5120);
    });
  },
);
