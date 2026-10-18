import { describe, expect, it } from "vitest";

import {
  NHM2_CONFORMALLY_FLAT_NEEDLE_FIXED_BACKGROUND_CONTENT_REPLAY_CONNECTED_NOISE_NUMERICAL_REPRESENTATION_EXPECTED_SHA256,
  NHM2_CONFORMALLY_FLAT_NEEDLE_FIXED_BACKGROUND_CONTENT_REPLAY_CONNECTED_NOISE_NUMERICAL_REPRESENTATION_EXPECTED_SIZE_BYTES,
  NHM2_CONFORMALLY_FLAT_NEEDLE_FIXED_BACKGROUND_CONTENT_REPLAY_CONNECTED_NOISE_CONVENTION_EXPECTED_SHA256,
  NHM2_CONFORMALLY_FLAT_NEEDLE_FIXED_BACKGROUND_CONTENT_REPLAY_CONNECTED_NOISE_CONVENTION_EXPECTED_SIZE_BYTES,
  NHM2_CONFORMALLY_FLAT_NEEDLE_FIXED_BACKGROUND_CONTENT_REPLAY_ARRAY_ROLES,
  NHM2_CONFORMALLY_FLAT_NEEDLE_FIXED_BACKGROUND_CONTENT_REPLAY_AUTHORITY_BLOCKERS,
  NHM2_CONFORMALLY_FLAT_NEEDLE_FIXED_BACKGROUND_CONTENT_REPLAY_MEAN_RSET_RENORMALIZATION_CONVENTION_EXPECTED_SHA256,
  NHM2_CONFORMALLY_FLAT_NEEDLE_FIXED_BACKGROUND_CONTENT_REPLAY_MEAN_RSET_RENORMALIZATION_CONVENTION_EXPECTED_SIZE_BYTES,
  replayNhm2ConformallyFlatNeedleFixedBackgroundContent,
  type Nhm2ConformallyFlatNeedleFixedBackgroundContentReplayArrayRole,
  type Nhm2ConformallyFlatNeedleFixedBackgroundContentReplayInput,
} from "../nhm2-conformally-flat-needle-fixed-background-content-replay";

const SAMPLE_COUNT = 64;
const TENSOR_COMPONENT_COUNT = 10;
const COVARIANCE_DIMENSION = SAMPLE_COUNT * TENSOR_COMPONENT_COUNT;

const byteLengths = {
  fixed_background_mean_rset: 5_120,
  fixed_background_mean_rset_absolute_uncertainty95: 5_120,
  fixed_background_connected_noise_kernel: 3_276_800,
  fixed_background_connected_noise_absolute_uncertainty95: 3_276_800,
  fixed_background_sample_weights: 512,
} as const;

const fullBuffer = (sizeBytes: number): Buffer => Buffer.alloc(sizeBytes);

const setFloat64 = (bytes: Buffer, index: number, value: number): void => {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setFloat64(
    index * 8,
    value,
    true,
  );
};

const noiseOffset = (matrixRow: number, matrixColumn: number): number => {
  const leftPoint = Math.floor(matrixRow / TENSOR_COMPONENT_COUNT);
  const leftComponent = matrixRow % TENSOR_COMPONENT_COUNT;
  const rightPoint = Math.floor(matrixColumn / TENSOR_COMPONENT_COUNT);
  const rightComponent = matrixColumn % TENSOR_COMPONENT_COUNT;
  return (
    (leftPoint * SAMPLE_COUNT + rightPoint) * 100 +
    leftComponent * TENSOR_COMPONENT_COUNT +
    rightComponent
  );
};

const buildInput = (
  reversedEntryKeys = false,
): Nhm2ConformallyFlatNeedleFixedBackgroundContentReplayInput => {
  const byRole = new Map<
    Nhm2ConformallyFlatNeedleFixedBackgroundContentReplayArrayRole,
    Buffer
  >();
  for (const role of NHM2_CONFORMALLY_FLAT_NEEDLE_FIXED_BACKGROUND_CONTENT_REPLAY_ARRAY_ROLES) {
    byRole.set(role, fullBuffer(byteLengths[role]));
  }
  const weights = byRole.get("fixed_background_sample_weights")!;
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    setFloat64(weights, index, 1 / SAMPLE_COUNT);
  }
  const noise = byRole.get("fixed_background_connected_noise_kernel")!;
  for (let index = 0; index < COVARIANCE_DIMENSION; index += 1) {
    setFloat64(noise, noiseOffset(index, index), 1);
  }

  return {
    arrays:
      NHM2_CONFORMALLY_FLAT_NEEDLE_FIXED_BACKGROUND_CONTENT_REPLAY_ARRAY_ROLES.map(
        (role) =>
          reversedEntryKeys
            ? ({ bytes: byRole.get(role)!, role } as {
                role: typeof role;
                bytes: Buffer;
              })
            : { role, bytes: byRole.get(role)! },
      ),
  };
};

const roleBytes = (
  input: Nhm2ConformallyFlatNeedleFixedBackgroundContentReplayInput,
  role: Nhm2ConformallyFlatNeedleFixedBackgroundContentReplayArrayRole,
): Buffer => input.arrays.find((entry) => entry.role === role)!.bytes;

describe("conformally-flat needle fixed-background content replay", () => {
  it("snapshots and replays the exact five diagnostic arrays but remains blocked", () => {
    const input = buildInput();
    const result = replayNhm2ConformallyFlatNeedleFixedBackgroundContent(input);

    expect(result.status).toBe("blocked");
    expect(result.diagnosticReplayState).toBe("replayed_inconclusive");
    expect(result.serverCalculationImplementation).toBe(true);
    expect(result.inputSnapshot.captured).toBe(true);
    expect(result.inputSnapshot.arrays.map((entry) => entry.role)).toEqual(
      NHM2_CONFORMALLY_FLAT_NEEDLE_FIXED_BACKGROUND_CONTENT_REPLAY_ARRAY_ROLES,
    );
    expect(result.diagnostics.inputContent).toEqual({
      rawArrayCount: 5,
      float64ValueCount: 820_544,
      allValuesFinite: true,
      negativeZeroAbsent: true,
      absoluteUncertaintiesNonnegative: true,
      exactFrozenWeightsVerified: true,
    });
    expect(result.diagnostics.mean?.smearingWeightSum).toBe(1);
    expect(result.diagnostics.noise).toMatchObject({
      covarianceDimension: 640,
      exchangeIntervalsConsistent: true,
      gershgorinUsedAsPsdPassAuthority: false,
      fullCholeskyAttempted: false,
      fullCholeskyDisposition: "not_attempted_work_policy_unfrozen",
      psdDisposition: "numerically_inconclusive",
      frozenPsdTolerancePresent: false,
      establishesConstraintClosure: false,
    });
    expect(result.issues).toEqual([
      {
        code: "noise_psd_numerically_inconclusive",
        disposition: "diagnostic_inconclusive",
        role: null,
        elementIndex: null,
      },
    ]);
    expect(
      result.authority.blockers.slice(
        0,
        NHM2_CONFORMALLY_FLAT_NEEDLE_FIXED_BACKGROUND_CONTENT_REPLAY_AUTHORITY_BLOCKERS.length,
      ),
    ).toEqual(
      NHM2_CONFORMALLY_FLAT_NEEDLE_FIXED_BACKGROUND_CONTENT_REPLAY_AUTHORITY_BLOCKERS,
    );
    expect(result.authority).toMatchObject({
      status: "blocked",
      firstBlocker: "connected_noise_distribution_execution_freeze_incomplete",
      capabilityIssued: false,
      issuerPresent: false,
      replayReceiptAuthority: false,
    });
    expect(
      NHM2_CONFORMALLY_FLAT_NEEDLE_FIXED_BACKGROUND_CONTENT_REPLAY_AUTHORITY_BLOCKERS,
    ).toEqual([
      "connected_noise_distribution_execution_freeze_incomplete",
      "mean_rset_renormalization_execution_freeze_incomplete",
      "connected_noise_numerical_representation_required_mean_convention_binding_absent",
      "connected_noise_numerical_representation_execution_freeze_incomplete",
      "primary_and_independent_derivation_algorithms_absent",
      "runtime_execution_evidence_absent",
      "independent_pair_agreement_absent",
    ]);
    expect(
      result.contractBindings.connectedNoiseDistributionConvention,
    ).toEqual({
      sha256:
        NHM2_CONFORMALLY_FLAT_NEEDLE_FIXED_BACKGROUND_CONTENT_REPLAY_CONNECTED_NOISE_CONVENTION_EXPECTED_SHA256,
      sizeBytes:
        NHM2_CONFORMALLY_FLAT_NEEDLE_FIXED_BACKGROUND_CONTENT_REPLAY_CONNECTED_NOISE_CONVENTION_EXPECTED_SIZE_BYTES,
      semanticBaselineOnly: true,
      executionAdmissible: false,
    });
    expect(result.contractBindings.meanRsetRenormalizationConvention).toEqual({
      sha256:
        NHM2_CONFORMALLY_FLAT_NEEDLE_FIXED_BACKGROUND_CONTENT_REPLAY_MEAN_RSET_RENORMALIZATION_CONVENTION_EXPECTED_SHA256,
      sizeBytes:
        NHM2_CONFORMALLY_FLAT_NEEDLE_FIXED_BACKGROUND_CONTENT_REPLAY_MEAN_RSET_RENORMALIZATION_CONVENTION_EXPECTED_SIZE_BYTES,
      semanticConventionOnly: true,
      semanticConventionFrozen: true,
      executionAdmissible: false,
      authorityGranted: false,
    });
    expect(
      result.contractBindings.connectedNoiseNumericalRepresentation,
    ).toEqual({
      sha256:
        NHM2_CONFORMALLY_FLAT_NEEDLE_FIXED_BACKGROUND_CONTENT_REPLAY_CONNECTED_NOISE_NUMERICAL_REPRESENTATION_EXPECTED_SHA256,
      sizeBytes:
        NHM2_CONFORMALLY_FLAT_NEEDLE_FIXED_BACKGROUND_CONTENT_REPLAY_CONNECTED_NOISE_NUMERICAL_REPRESENTATION_EXPECTED_SIZE_BYTES,
      designOverlayOnly: true,
      requiredMeanConventionBindingAvailable: false,
      executionAdmissible: false,
      authorityGranted: false,
    });
    expect(result.contractBindings.bindingsGrantAuthority).toBe(false);
    expect(
      Object.values(result.claimLocks).every((lock) => lock === false),
    ).toBe(true);
    expect(result.constraintBoundary).toEqual({
      constraintArrayRolesAccepted: false,
      constraintBracketRolesAccepted: false,
      normalizedConstraintBracketRolesAccepted: false,
      wardDiagnosticIsConstraintClosure: false,
    });
    expect(result.diagnostics.ward).toEqual({
      status: "not_replayed_no_derivative_or_connection_outputs",
      diagnosticOnly: true,
      inputRolePresent: false,
      establishesFullAdmConstraintClosure: false,
    });
  });

  it("accepts exact plain entry objects regardless of key insertion order", () => {
    const result = replayNhm2ConformallyFlatNeedleFixedBackgroundContent(
      buildInput(true),
    );
    expect(result.inputSnapshot.captured).toBe(true);
    expect(result.firstFailure).toBe("noise_psd_numerically_inconclusive");
  });

  it("copies caller bytes before replay and never retains their buffers", () => {
    const input = buildInput();
    const result = replayNhm2ConformallyFlatNeedleFixedBackgroundContent(input);
    const before = result.inputSnapshot.arrays.map((entry) => entry.sha256);
    roleBytes(input, "fixed_background_mean_rset").fill(0xff);

    expect(result.inputSnapshot.callerBuffersRetained).toBe(false);
    expect(result.inputSnapshot.arrays.map((entry) => entry.sha256)).toEqual(
      before,
    );
    expect(result.diagnostics.mean?.smearedTensorComponentsSI).toEqual(
      new Array(10).fill(0),
    );
  });

  it("rejects an exact-shape partial Buffer view before copying", () => {
    const input = buildInput();
    const original = roleBytes(input, "fixed_background_mean_rset");
    const enclosing = Buffer.alloc(original.length + 16);
    original.copy(enclosing, 8);
    const partial = enclosing.subarray(8, 8 + original.length);
    const arrays = input.arrays.map((entry) =>
      entry.role === "fixed_background_mean_rset"
        ? { ...entry, bytes: partial }
        : entry,
    );
    const result = replayNhm2ConformallyFlatNeedleFixedBackgroundContent({
      arrays,
    });

    expect(result.diagnosticReplayState).toBe("input_rejected");
    expect(result.firstFailure).toBe("raw_bytes_not_full_owned_buffer");
  });

  it("rejects SharedArrayBuffer-backed bytes", () => {
    const input = buildInput();
    const shared = Buffer.from(new SharedArrayBuffer(5_120));
    const arrays = input.arrays.map((entry) =>
      entry.role === "fixed_background_mean_rset"
        ? { ...entry, bytes: shared }
        : entry,
    );
    const result = replayNhm2ConformallyFlatNeedleFixedBackgroundContent({
      arrays,
    });

    expect(result.firstFailure).toBe("raw_bytes_shared_array_buffer_forbidden");
  });

  it("uses intrinsic typed-array state and never invokes hostile Buffer shadow accessors", () => {
    const input = buildInput();
    const shared = Buffer.from(new SharedArrayBuffer(5_120));
    const decoy = new ArrayBuffer(5_120);
    let getterReads = 0;
    Object.defineProperties(shared, {
      buffer: {
        configurable: true,
        get: () => {
          getterReads += 1;
          return decoy;
        },
      },
      byteOffset: {
        configurable: true,
        get: () => {
          getterReads += 1;
          return 0;
        },
      },
      byteLength: {
        configurable: true,
        get: () => {
          getterReads += 1;
          return 5_120;
        },
      },
    });
    const arrays = input.arrays.map((entry) =>
      entry.role === "fixed_background_mean_rset"
        ? { ...entry, bytes: shared }
        : entry,
    );
    const result = replayNhm2ConformallyFlatNeedleFixedBackgroundContent({
      arrays,
    });

    expect(getterReads).toBe(0);
    expect(result.firstFailure).toBe("raw_bytes_shared_array_buffer_forbidden");
    expect(result.inputSnapshot.buffersUniqueNonsharedAndFull).toBe(false);
  });

  it("uses the intrinsic ArrayBuffer length instead of a hostile backing-store shadow", () => {
    const input = buildInput();
    const bytes = roleBytes(input, "fixed_background_mean_rset");
    Object.defineProperty(bytes.buffer, "byteLength", {
      configurable: true,
      value: 1,
    });

    const result = replayNhm2ConformallyFlatNeedleFixedBackgroundContent(input);

    expect(result.inputSnapshot.captured).toBe(true);
    expect(result.diagnosticReplayState).toBe("replayed_inconclusive");
    expect(result.firstFailure).toBe("noise_psd_numerically_inconclusive");
  });

  it("rejects aliased buffers and exact-role size drift", () => {
    const aliased = buildInput();
    const sharedMeanBuffer = roleBytes(aliased, "fixed_background_mean_rset");
    const aliasedArrays = aliased.arrays.map((entry) =>
      entry.role === "fixed_background_mean_rset_absolute_uncertainty95"
        ? { ...entry, bytes: sharedMeanBuffer }
        : entry,
    );
    expect(
      replayNhm2ConformallyFlatNeedleFixedBackgroundContent({
        arrays: aliasedArrays,
      }).firstFailure,
    ).toBe("raw_bytes_alias_forbidden");

    const wrongSize = buildInput();
    const wrongSizeArrays = wrongSize.arrays.map((entry) =>
      entry.role === "fixed_background_sample_weights"
        ? { ...entry, bytes: fullBuffer(504) }
        : entry,
    );
    expect(
      replayNhm2ConformallyFlatNeedleFixedBackgroundContent({
        arrays: wrongSizeArrays,
      }).firstFailure,
    ).toBe("raw_bytes_size_invalid");
  });

  it("rejects array-entry accessors without invoking them", () => {
    const input = buildInput();
    let reads = 0;
    const hostile = {
      role: "fixed_background_mean_rset" as const,
      get bytes(): Buffer {
        reads += 1;
        return input.arrays[0].bytes;
      },
    };
    const arrays = [hostile, ...input.arrays.slice(1)];
    const result = replayNhm2ConformallyFlatNeedleFixedBackgroundContent({
      arrays,
    });

    expect(reads).toBe(0);
    expect(result.firstFailure).toBe("array_entry_accessor_forbidden");
  });

  it.each(["__proto__", "constructor"] as const)(
    "rejects an own enumerable root %s key without invoking its accessor",
    (hostileKey) => {
      const input = buildInput();
      let accessorReads = 0;
      Object.defineProperty(input, hostileKey, {
        configurable: true,
        enumerable: true,
        get: () => {
          accessorReads += 1;
          throw new Error("hostile_root_accessor_invoked");
        },
      });

      const result =
        replayNhm2ConformallyFlatNeedleFixedBackgroundContent(input);

      expect(accessorReads).toBe(0);
      expect(result.diagnosticReplayState).toBe("input_rejected");
      expect(result.firstFailure).toBe("input_keys_invalid");
      expect(result.contractBindings).toMatchObject({
        meanRsetRenormalizationConvention: {
          semanticConventionOnly: true,
          executionAdmissible: false,
          authorityGranted: false,
        },
        connectedNoiseNumericalRepresentation: {
          designOverlayOnly: true,
          requiredMeanConventionBindingAvailable: false,
          executionAdmissible: false,
          authorityGranted: false,
        },
        bindingsGrantAuthority: false,
      });
    },
  );

  it.each(["__proto__", "constructor"] as const)(
    "rejects an own enumerable array-entry %s key without invoking its accessor",
    (hostileKey) => {
      const input = buildInput();
      let accessorReads = 0;
      Object.defineProperty(input.arrays[0], hostileKey, {
        configurable: true,
        enumerable: true,
        get: () => {
          accessorReads += 1;
          throw new Error("hostile_array_entry_accessor_invoked");
        },
      });

      const result =
        replayNhm2ConformallyFlatNeedleFixedBackgroundContent(input);

      expect(accessorReads).toBe(0);
      expect(result.diagnosticReplayState).toBe("input_rejected");
      expect(result.firstFailure).toBe("array_entry_keys_invalid");
    },
  );

  it("rejects constraint-shaped roles instead of replaying them", () => {
    const input = buildInput();
    const arrays = input.arrays.map((entry, index) =>
      index === 0 ? { ...entry, role: "normalized_constraint_bracket" } : entry,
    );
    const result = replayNhm2ConformallyFlatNeedleFixedBackgroundContent({
      arrays,
    });

    expect(result.firstFailure).toBe("constraint_array_role_forbidden");
    expect(result.constraintBoundary.constraintBracketRolesAccepted).toBe(
      false,
    );

    const leverArrays = input.arrays.map((entry, index) =>
      index === 0 ? { ...entry, role: "declared_lever_tensor" } : entry,
    );
    const leverResult = replayNhm2ConformallyFlatNeedleFixedBackgroundContent({
      arrays: leverArrays,
    });
    expect(leverResult.firstFailure).toBe(
      "declared_lever_tensor_role_forbidden",
    );
    expect(
      leverResult.sourceBoundary.declaredLeverTensorRoleDetectedBeforeRejection,
    ).toBe(true);
    expect(leverResult.sourceBoundary.declaredLeverTensorAccepted).toBe(false);
    expect(leverResult.sourceBoundary.declaredLeverTensorUsed).toBe(false);

    const earlyByteFailureThenLaterLever = input.arrays.map((entry, index) => {
      if (index === 0) return { ...entry, bytes: Buffer.alloc(8) };
      if (index === 4) return { ...entry, role: "declared_lever_tensor" };
      return entry;
    });
    const earlyFailureResult =
      replayNhm2ConformallyFlatNeedleFixedBackgroundContent({
        arrays: earlyByteFailureThenLaterLever,
      });
    expect(earlyFailureResult.firstFailure).toBe("raw_bytes_size_invalid");
    expect(
      earlyFailureResult.sourceBoundary
        .declaredLeverTensorRoleDetectedBeforeRejection,
    ).toBe(false);
    expect(earlyFailureResult.sourceBoundary.declaredLeverTensorAccepted).toBe(
      false,
    );
    expect(earlyFailureResult.sourceBoundary.declaredLeverTensorUsed).toBe(
      false,
    );
  });

  it("rejects non-finite and negative-zero f64le payloads", () => {
    const nonfinite = buildInput();
    setFloat64(
      roleBytes(nonfinite, "fixed_background_mean_rset"),
      0,
      Number.NaN,
    );
    const nonfiniteResult =
      replayNhm2ConformallyFlatNeedleFixedBackgroundContent(nonfinite);
    expect(nonfiniteResult).toMatchObject({
      firstFailure: "raw_array_nonfinite",
    });
    expect(nonfiniteResult.issues[0]).toMatchObject({
      role: "fixed_background_mean_rset",
      elementIndex: 0,
    });

    const negativeZero = buildInput();
    setFloat64(roleBytes(negativeZero, "fixed_background_mean_rset"), 1, -0);
    const negativeZeroResult =
      replayNhm2ConformallyFlatNeedleFixedBackgroundContent(negativeZero);
    expect(negativeZeroResult.firstFailure).toBe("raw_array_negative_zero");
  });

  it("rejects negative uncertainty and enforces all sixty-four exact 1/64 weights", () => {
    const negative = buildInput();
    setFloat64(
      roleBytes(
        negative,
        "fixed_background_connected_noise_absolute_uncertainty95",
      ),
      7,
      -1,
    );
    expect(
      replayNhm2ConformallyFlatNeedleFixedBackgroundContent(negative)
        .firstFailure,
    ).toBe("absolute_uncertainty_negative");

    const weights = buildInput();
    setFloat64(
      roleBytes(weights, "fixed_background_sample_weights"),
      0,
      1 / 64 + Number.EPSILON,
    );
    setFloat64(
      roleBytes(weights, "fixed_background_sample_weights"),
      1,
      1 / 64 - Number.EPSILON,
    );
    const result =
      replayNhm2ConformallyFlatNeedleFixedBackgroundContent(weights);
    expect(result.firstFailure).toBe(
      "sample_weights_not_exact_frozen_normalization",
    );
    expect(result.issues[0].elementIndex).toBe(0);
  });

  it("detects exchange interval failure and an explicit negative PSD witness", () => {
    const input = buildInput();
    const noise = roleBytes(input, "fixed_background_connected_noise_kernel");
    setFloat64(noise, noiseOffset(0, 1), 2);
    setFloat64(noise, noiseOffset(1, 0), 0);
    setFloat64(noise, noiseOffset(0, 0), -1);
    const result = replayNhm2ConformallyFlatNeedleFixedBackgroundContent(input);

    expect(result.diagnosticReplayState).toBe("replayed_with_detected_failure");
    expect(result.diagnostics.noise).toMatchObject({
      exchangeIntervalsConsistent: false,
      exchangeMaximumIntervalExcessSI: 2,
      psdDisposition: "negative_witness",
      fullCholeskyAttempted: false,
      negativeWitness: {
        kind: "diagonal_basis",
        indices: [0],
        normalizedComponents: [1],
        robustToReportedUncertainty95: true,
      },
    });
    expect(result.diagnostics.noise?.negativeWitness?.upper95SI).toBeLessThan(
      0,
    );
    expect(result.issues.map((entry) => entry.code)).toEqual([
      "noise_exchange_intervals_inconsistent",
      "noise_psd_negative_witness",
    ]);
    expect(result.claimLocks.semiclassicalStressNoiseLamp).toBe(false);
    expect(result.claimLocks.constraintClosureLamp).toBe(false);
    expect(result.claimLocks.physicalViability).toBe(false);
  });

  it("does not call a central negative mode a failure when its reported U95 envelope reaches PSD", () => {
    const input = buildInput();
    const noise = roleBytes(input, "fixed_background_connected_noise_kernel");
    const uncertainty = roleBytes(
      input,
      "fixed_background_connected_noise_absolute_uncertainty95",
    );
    setFloat64(noise, noiseOffset(0, 0), -1);
    setFloat64(uncertainty, noiseOffset(0, 0), 2);

    const result = replayNhm2ConformallyFlatNeedleFixedBackgroundContent(input);

    expect(result.diagnosticReplayState).toBe("replayed_inconclusive");
    expect(result.diagnostics.noise).toMatchObject({
      psdDisposition: "numerically_inconclusive",
      negativeWitness: null,
      frozenPsdTolerancePresent: false,
    });
    expect(result.issues.map((entry) => entry.code)).toEqual([
      "noise_psd_numerically_inconclusive",
    ]);
  });
});
