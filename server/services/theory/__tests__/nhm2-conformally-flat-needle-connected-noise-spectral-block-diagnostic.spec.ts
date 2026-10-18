import { beforeAll, describe, expect, it } from "vitest";

import {
  evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralBlockDiagnostic,
  NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_SPECTRAL_BLOCK_DIAGNOSTIC_SCHEMA_VERSION,
  type Nhm2ConformallyFlatNeedleConnectedNoiseSpectralBlockDiagnosticResult,
} from "../nhm2-conformally-flat-needle-connected-noise-spectral-block-diagnostic";

const input = (
  leftSampleOrdinal = 0,
  rightSampleOrdinal = 0,
  fourMomentumMInverse: readonly [number, number, number, number] = [
    2, 0, 0, 0,
  ],
) => ({ leftSampleOrdinal, rightSampleOrdinal, fourMomentumMInverse });

const evaluate = (
  leftSampleOrdinal = 0,
  rightSampleOrdinal = 0,
  fourMomentumMInverse: readonly [number, number, number, number] = [
    2, 0, 0, 0,
  ],
) =>
  evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralBlockDiagnostic(
    input(leftSampleOrdinal, rightSampleOrdinal, fourMomentumMInverse),
  );

let centerOfMomentum: Nhm2ConformallyFlatNeedleConnectedNoiseSpectralBlockDiagnosticResult;

beforeAll(() => {
  centerOfMomentum = evaluate();
});

describe("NHM2 connected-noise bounded spectral-block diagnostic", () => {
  it("returns an exactly pinned, blocked diagnostic with every authority and claim lock false", () => {
    expect(centerOfMomentum.schemaVersion).toBe(
      NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_SPECTRAL_BLOCK_DIAGNOSTIC_SCHEMA_VERSION,
    );
    expect(centerOfMomentum.status).toBe(
      "blocked_binary64_strict_future_cone_spectral_block_diagnostic_only",
    );
    expect(centerOfMomentum.diagnosticOnly).toBe(true);
    expect(centerOfMomentum.upstreamBindings.twoParticleSymbol).toMatchObject({
      canonicalSha256:
        "5ce5b293559b42b26a1c71dff782aebe5b4daf88ddfcdec131101a3fc4fee57a",
      canonicalSizeBytes: 18025,
      exactIdentityVerifiedAtModuleInitialization: true,
      semanticSubstitutionAllowed: false,
    });
    expect(centerOfMomentum.upstreamBindings.fourierDiagnostic).toEqual({
      schemaVersion:
        "nhm2_conformally_flat_needle_connected_noise_fourier_diagnostic/v1",
      exactSchemaVerifiedAtModuleInitialization: true,
      implementationSourceBytesPinned: false,
      semanticSubstitutionAllowed: false,
    });
    expect(
      centerOfMomentum.upstreamBindings.smearingFourierViaEveryComposedResult,
    ).toEqual({
      canonicalSha256:
        "e05e74621a1616fd7d37150f71e98632005938d42f285e30a83e760a5f1d6faf",
      canonicalSizeBytes: 12107,
      everyResultExactIdentityVerified: true,
      semanticSubstitutionAllowed: false,
    });
    expect(centerOfMomentum.mayFeedFixedBackgroundRun).toBe(false);
    expect(centerOfMomentum.executionAdmissible).toBe(false);
    expect(
      Object.values(centerOfMomentum.authority).every(
        (value) => value === false,
      ),
    ).toBe(true);
    expect(
      Object.values(centerOfMomentum.claimLocks).every(
        (value) => value === false,
      ),
    ).toBe(true);
  });

  it("uses the frozen 10-component order and left-outer/right-inner 100-entry flattening", () => {
    expect(centerOfMomentum.tensorConvention.componentOrder).toEqual([
      "T00",
      "T01",
      "T02",
      "T03",
      "T11",
      "T12",
      "T13",
      "T22",
      "T23",
      "T33",
    ]);
    expect(centerOfMomentum.tensorConvention.componentPairFlattening).toBe(
      "left_component_outer_right_component_inner_row_major",
    );
    expect(
      centerOfMomentum.positiveFrequencySpectralDensity
        .valuesInFrozenComponentPairOrder,
    ).toHaveLength(100);
    expect(
      centerOfMomentum.spectralBlock.valuesInFrozenComponentPairOrder,
    ).toHaveLength(100);
    expect(
      centerOfMomentum.tensorConvention.frobeniusSqrt2OffDiagonalWeightApplied,
    ).toBe(false);
  });

  it("reproduces the center-of-momentum rho+ microfixture", () => {
    const rho =
      centerOfMomentum.positiveFrequencySpectralDensity
        .valuesInFrozenComponentPairOrder;

    // T11 is component 4, T12 is component 5, and T22 is component 7.
    expect(rho[4 * 10 + 4]).toBeCloseTo(1 / (45 * Math.PI), 15);
    expect(rho[4 * 10 + 7]).toBeCloseTo(-1 / (90 * Math.PI), 15);
    expect(rho[5 * 10 + 5]).toBeCloseTo(1 / (60 * Math.PI), 15);
    expect(rho[7 * 10 + 4]).toBe(rho[4 * 10 + 7]);
  });

  it("lowers K, computes positive s, and evaluates only the division-free polynomial", () => {
    expect(centerOfMomentum.support).toMatchObject({
      domain: "strict_future_timelike_only",
      strictFutureTimelikeInputAdmitted: true,
      boundaryOrExteriorEvaluationAdmitted: false,
      covariantKLowerMInverse: [-2, 0, 0, 0],
      sMInverseSquared: 4,
      futureAndTimelikeStepFactorsOnAdmittedDomain: 1,
    });
    expect(centerOfMomentum.boundarySafePolynomial).toMatchObject({
      divisionBySUsed: false,
      fullTensorTransientlyEvaluated: true,
      fullTensorStoredInResult: false,
    });
    expect(centerOfMomentum.work.polynomialTensorEvaluations).toBe(256);
    expect(centerOfMomentum.work.maximumPolynomialTensorEvaluations).toBe(256);
  });

  it("observes tensor symmetries while leaving identity certification blocked", () => {
    const observations = centerOfMomentum.binary64IdentityObservations;

    expect(observations.minorLeftSymmetryMaxAbsResidualMInverse4).toBe(0);
    expect(observations.minorRightSymmetryMaxAbsResidualMInverse4).toBe(0);
    expect(observations.pairExchangeSymmetryMaxAbsResidualMInverse4).toBe(0);
    expect(observations.leftTransversalityMaxAbsResidualMInverse5).toBe(0);
    expect(observations.rightTransversalityMaxAbsResidualMInverse5).toBe(0);
    expect(
      observations.leftTraceMaxAbsResidualMInverse4,
    ).toBeGreaterThanOrEqual(0);
    expect(
      observations.rightTraceMaxAbsResidualMInverse4,
    ).toBeGreaterThanOrEqual(0);
    expect(observations.deterministicTolerance).toBeNull();
    expect(observations.deterministicEnclosure).toBeNull();
    expect(observations.certifiedIdentityPass).toBe(false);
    expect(observations.interpretation).toContain(
      "not_enclosures_or_certificates",
    );
  });

  it("applies the exact symbolic SI and inverse-Fourier factor to every entry", () => {
    const rho =
      centerOfMomentum.positiveFrequencySpectralDensity
        .valuesInFrozenComponentPairOrder;
    const block =
      centerOfMomentum.spectralBlock.valuesInFrozenComponentPairOrder;
    const multiplier =
      centerOfMomentum.siAndInverseFourierRestoration
        .combinedMultiplierJouleSquaredMetersSquaredBinary64;
    const overlap =
      centerOfMomentum.smearingOverlap.realConjugateFourierProduct;

    expect(
      centerOfMomentum.siAndInverseFourierRestoration.exactSymbolicMultiplier,
    ).toBe("(hbar*c)^2/(2*pi)^4");
    expect(
      centerOfMomentum.siAndInverseFourierRestoration
        .symbolicIdentityFrozenExactly,
    ).toBe(true);
    expect(
      centerOfMomentum.siAndInverseFourierRestoration.numericalEvaluation,
    ).toBe("ieee754_binary64_not_enclosed");
    for (const index of [0, 44, 47, 55, 99]) {
      expect(block[index]).toBe(multiplier * overlap * rho[index]);
    }
    expect(
      centerOfMomentum.spectralBlock.thisSingleKBlockIsAnIntegratedCovariance,
    ).toBe(false);
  });

  it("calls the composed Fourier diagnostic once for p=q and verifies its blocked smearing identity", () => {
    expect(centerOfMomentum.fourierDiagnostics.callCount).toBe(1);
    expect(centerOfMomentum.fourierDiagnostics.rightReusedLeftEvaluation).toBe(
      true,
    );
    expect(centerOfMomentum.fourierDiagnostics.right).toEqual(
      centerOfMomentum.fourierDiagnostics.left,
    );
    expect(centerOfMomentum.fourierDiagnostics.left).toMatchObject({
      schemaVersion:
        "nhm2_conformally_flat_needle_connected_noise_fourier_diagnostic/v1",
      status: "diagnostic_binary64_not_enclosed",
      deterministicEnclosure: null,
      absoluteUncertainty95: null,
      executionAdmissible: false,
      allAuthorityAndClaimLocksVerifiedFalse: true,
      exactSmearingBinding: {
        canonicalSha256:
          "e05e74621a1616fd7d37150f71e98632005938d42f285e30a83e760a5f1d6faf",
        canonicalSizeBytes: 12107,
        semanticSubstitutionAllowed: false,
      },
    });
    expect(centerOfMomentum.work.fourierDiagnosticCalls).toBe(1);
    expect(
      centerOfMomentum.work.inheritedFunctionEvaluations,
    ).toBeLessThanOrEqual(80_000);
  });

  it("calls the composed Fourier diagnostic twice for p!=q and respects every hard work cap", () => {
    const result = evaluate(0, 63);

    expect(result.fourierDiagnostics.callCount).toBe(2);
    expect(result.fourierDiagnostics.rightReusedLeftEvaluation).toBe(false);
    expect(result.fourierDiagnostics.left.sampleOrdinal).toBe(0);
    expect(result.fourierDiagnostics.right.sampleOrdinal).toBe(63);
    expect(result.work.maximumFourierDiagnosticCalls).toBe(2);
    expect(result.work.fourierDiagnosticCalls).toBe(2);
    expect(result.work.maximumInheritedFunctionEvaluations).toBe(160_000);
    expect(result.work.inheritedFunctionEvaluations).toBeLessThanOrEqual(
      result.work.maximumInheritedFunctionEvaluations,
    );
    expect(result.work.storedSpectralEntries).toBe(100);
    expect(result.work.storedBlockEntries).toBe(100);
    expect(result.work.inputWorkOverrideAccepted).toBe(false);
    expect(result.work.hardCapDisposition).toBe("abort_without_result");
  });

  it("is symmetric under exchanging the left and right sample ordinals", () => {
    const leftRight = evaluate(2, 61, [3, 0.25, -0.5, 0.75]);
    const rightLeft = evaluate(61, 2, [3, 0.25, -0.5, 0.75]);

    expect(rightLeft.smearingOverlap.realConjugateFourierProduct).toBe(
      leftRight.smearingOverlap.realConjugateFourierProduct,
    );
    expect(
      rightLeft.smearingOverlap.imaginaryConjugateFourierProductObserved,
    ).toBe(-leftRight.smearingOverlap.imaginaryConjugateFourierProductObserved);
    expect(rightLeft.spectralBlock.valuesInFrozenComponentPairOrder).toEqual(
      leftRight.spectralBlock.valuesInFrozenComponentPairOrder,
    );
  });

  it.each([
    [[0, 0, 0, 0]],
    [[-1, 0, 0, 0]],
    [[1, 1, 0, 0]],
    [[1, 2, 0, 0]],
  ] as const)("rejects non-future or non-strict-timelike K=%j", (momentum) => {
    expect(() => evaluate(0, 0, momentum)).toThrow();
  });

  it.each([
    null,
    [],
    {},
    {
      leftSampleOrdinal: 0,
      rightSampleOrdinal: 0,
      fourMomentumMInverse: [2, 0, 0],
    },
    input(-1, 0),
    input(0, 64),
    input(0.5, 0),
    input(0, 0, [2, 0, 0, Number.NaN]),
    input(0, 0, [2, 0, 0, -0]),
    { ...input(), outputPath: "forbidden.bin" },
    { ...input(), authorityOverride: true },
    { ...input(), workOverride: { maximumFunctionEvaluations: 1 } },
  ])(
    "rejects malformed, nonfinite, negative-zero, or extra input %#",
    (candidate) => {
      expect(() =>
        evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralBlockDiagnostic(
          candidate,
        ),
      ).toThrow();
    },
  );

  it("rejects proxies and accessors without executing traps", () => {
    let reads = 0;
    const accessor = Object.defineProperty(
      { leftSampleOrdinal: 0, rightSampleOrdinal: 0 },
      "fourMomentumMInverse",
      {
        enumerable: true,
        get() {
          reads += 1;
          return [2, 0, 0, 0];
        },
      },
    );
    const proxy = new Proxy(input(), {
      ownKeys() {
        reads += 1;
        return [];
      },
    });
    const momentumProxy = new Proxy([2, 0, 0, 0], {
      ownKeys() {
        reads += 1;
        return ["0", "1", "2", "3", "length"];
      },
    });
    const momentumAccessor = [2, 0, 0, 0];
    Object.defineProperty(momentumAccessor, "2", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return 0;
      },
    });

    expect(() =>
      evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralBlockDiagnostic(
        accessor,
      ),
    ).toThrow("accessor_or_hidden_property_forbidden");
    expect(() =>
      evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralBlockDiagnostic(
        proxy,
      ),
    ).toThrow("proxy_forbidden");
    expect(() =>
      evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralBlockDiagnostic(
        input(
          0,
          0,
          momentumProxy as unknown as [number, number, number, number],
        ),
      ),
    ).toThrow("proxy_forbidden");
    expect(() =>
      evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralBlockDiagnostic(
        input(
          0,
          0,
          momentumAccessor as unknown as [number, number, number, number],
        ),
      ),
    ).toThrow("accessor_sparse_or_hidden_array_entry");
    expect(reads).toBe(0);
  });

  it("rejects a roughly 20k-deep extra graph before traversing it", () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let depth = 0; depth < 20_000; depth += 1) {
      deep = { next: deep };
    }
    let nestedTrapCalls = 0;
    const trappedDeep = new Proxy(deep, {
      ownKeys() {
        nestedTrapCalls += 1;
        throw new Error("nested graph must not be traversed");
      },
    });
    const candidate = { ...input(), extra: trappedDeep };

    let thrown: unknown;
    try {
      evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralBlockDiagnostic(
        candidate,
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TypeError);
    expect(thrown).not.toBeInstanceOf(RangeError);
    expect((thrown as Error).message).toBe(
      "nhm2_connected_noise_spectral_block_diagnostic_input_unsafe:root_own_key_limit_exceeded:/",
    );
    expect(nestedTrapCalls).toBe(0);
  });

  it("rejects a 20k-key root before inspecting any field values", () => {
    let fieldReads = 0;
    const candidate = Object.create(Object.prototype) as Record<
      string,
      unknown
    >;
    Object.defineProperty(candidate, "leftSampleOrdinal", {
      enumerable: true,
      get() {
        fieldReads += 1;
        return 0;
      },
    });
    candidate.rightSampleOrdinal = 0;
    candidate.fourMomentumMInverse = [2, 0, 0, 0];
    for (let index = 0; index < 20_000; index += 1) {
      candidate[`extra_${index}`] = index;
    }

    let thrown: unknown;
    try {
      evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralBlockDiagnostic(
        candidate,
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TypeError);
    expect(thrown).not.toBeInstanceOf(RangeError);
    expect((thrown as Error).message).toBe(
      "nhm2_connected_noise_spectral_block_diagnostic_input_unsafe:root_own_key_limit_exceeded:/",
    );
    expect(fieldReads).toBe(0);
  });

  it("rejects symbol, hidden, forbidden, sparse, and array-side data", () => {
    const withSymbol = input() as ReturnType<typeof input> & {
      [key: symbol]: number;
    };
    withSymbol[Symbol("forbidden")] = 1;

    const withHidden = input();
    Object.defineProperty(withHidden, "hidden", {
      enumerable: false,
      value: 1,
    });

    const withForbidden = input();
    Object.defineProperty(withForbidden, "constructor", {
      enumerable: true,
      value: "forbidden",
    });

    const arraySide = [2, 0, 0, 0] as number[] & { side?: number };
    arraySide.side = 1;
    const sparse = [2, , 0, 0];

    for (const candidate of [
      withSymbol,
      withHidden,
      withForbidden,
      input(0, 0, arraySide as [number, number, number, number]),
      input(0, 0, sparse as [number, number, number, number]),
    ]) {
      expect(() =>
        evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralBlockDiagnostic(
          candidate,
        ),
      ).toThrow();
    }
  });

  it("rejects nonfinite derived invariants and inherits the Fourier hard-work abort", () => {
    expect(() => evaluate(0, 0, [1e200, 0, 0, 0])).toThrow(
      "nonfinite_derived_value:energy_squared",
    );
    expect(() => evaluate(0, 0, [1e9, 0, 0, 0])).toThrow(
      "nhm2_connected_noise_fourier_diagnostic_hard_work_cap_exceeded",
    );
  });

  it("canonicalizes all derived underflow to positive zero and keeps every numeric leaf finite", () => {
    const result = evaluate(63, 63, [1, Number.MIN_VALUE, 0, 0]);
    const numericLeaves: number[] = [];
    const visit = (value: unknown): void => {
      if (typeof value === "number") {
        numericLeaves.push(value);
        return;
      }
      if (value == null || typeof value !== "object") return;
      for (const nested of Object.values(value)) visit(nested);
    };
    visit(result);

    expect(
      result.positiveFrequencySpectralDensity.valuesInFrozenComponentPairOrder.filter(
        (value) => value === 0,
      ).length,
    ).toBeGreaterThan(0);
    expect(numericLeaves.every((value) => Number.isFinite(value))).toBe(true);
    expect(numericLeaves.some((value) => Object.is(value, -0))).toBe(false);
  });

  it("keeps full arrays, uncertainty products, enclosures, and receipts absent", () => {
    expect(Object.values(centerOfMomentum.unavailableOutputs)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(centerOfMomentum.implementationBoundary).toEqual({
      fullArrayBuilderPresent: false,
      rawOutputWriterPresent: false,
      outputPath: null,
      receiptBuilderPresent: false,
      declaredLeverTensorAccepted: false,
      metricDemandAccepted: false,
      toleranceOverrideAccepted: false,
      workOverrideAccepted: false,
      authorityOverrideAccepted: false,
    });
  });

  it("is byte-for-byte deterministic for repeated input", () => {
    const first = evaluate(19, 23, [4, 1, -0.5, 0.25]);
    const second = evaluate(19, 23, [4, 1, -0.5, 0.25]);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("exports no full-array builder, writer, receipt, lever, tolerance, work, or authority override", async () => {
    const module =
      await import("../nhm2-conformally-flat-needle-connected-noise-spectral-block-diagnostic");
    const exportNames = Object.keys(module);

    expect(exportNames).toEqual([
      "NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_SPECTRAL_BLOCK_DIAGNOSTIC_SCHEMA_VERSION",
      "evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralBlockDiagnostic",
    ]);
    expect(
      exportNames.some((name) =>
        /(array|writer|receipt|lever|tolerance|work|authorityOverride)/i.test(
          name,
        ),
      ),
    ).toBe(false);
  });
});
