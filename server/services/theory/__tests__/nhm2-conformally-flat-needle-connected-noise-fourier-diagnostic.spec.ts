import { describe, expect, it } from "vitest";

import {
  evaluateNhm2ConformallyFlatNeedleConnectedNoiseFourierDiagnostic,
  NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_FOURIER_DIAGNOSTIC_SCHEMA_VERSION,
} from "../nhm2-conformally-flat-needle-connected-noise-fourier-diagnostic";

const input = (
  sampleOrdinal = 0,
  fourMomentumMInverse: readonly [number, number, number, number] = [
    31, 17, -23, 29,
  ],
) => ({ sampleOrdinal, fourMomentumMInverse });

const evaluate = (
  sampleOrdinal = 0,
  fourMomentumMInverse: readonly [number, number, number, number] = [
    31, 17, -23, 29,
  ],
) =>
  evaluateNhm2ConformallyFlatNeedleConnectedNoiseFourierDiagnostic(
    input(sampleOrdinal, fourMomentumMInverse),
  );

describe("NHM2 connected-noise Fourier binary64 diagnostic", () => {
  it("returns an exactly pinned, blocked, non-enclosed diagnostic boundary", () => {
    const result = evaluate();

    expect(result.schemaVersion).toBe(
      NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_FOURIER_DIAGNOSTIC_SCHEMA_VERSION,
    );
    expect(result.status).toBe("diagnostic_binary64_not_enclosed");
    expect(result.upstreamBinding).toMatchObject({
      canonicalSha256:
        "e05e74621a1616fd7d37150f71e98632005938d42f285e30a83e760a5f1d6faf",
      canonicalSizeBytes: 12107,
      exactIdentityVerifiedAtModuleInitialization: true,
      semanticSubstitutionAllowed: false,
    });
    expect(result.deterministicEnclosure).toBeNull();
    expect(result.absoluteUncertainty95).toBeNull();
    expect(result.mayFeedFixedBackgroundRun).toBe(false);
    expect(result.executionAdmissible).toBe(false);
    expect(Object.values(result.authority)).toEqual(
      expect.arrayContaining([false]),
    );
    expect(
      Object.values(result.authority).every((value) => value === false),
    ).toBe(true);
    expect(
      Object.values(result.claimLocks).every((value) => value === false),
    ).toBe(true);
    expect(result.refinementObservations.interpretation).toContain(
      "not_an_error_bound_or_enclosure",
    );
  });

  it("evaluates Q as real and even with the declared conjugation identity", () => {
    const positive = evaluate(0, [137, 0, 0, 0]);
    const negative = evaluate(0, [-137, 0, 0, 0]);

    expect(negative.oneDimensionalTransform.values[0]).toBe(
      positive.oneDimensionalTransform.values[0],
    );
    expect(positive.oneDimensionalTransform.realForRealArguments).toBe(true);
    expect(positive.oneDimensionalTransform.evenForRealArguments).toBe(true);
    expect(positive.smearingFourierTransform.imaginary).toBe(0);
    expect(negative.smearingFourierTransform.imaginary).toBe(0);
  });

  it("obeys full sign reversal conjugation", () => {
    const momentum = [11, -19, 31, 47] as const;
    const positive = evaluate(37, momentum);
    const negative = evaluate(
      37,
      momentum.map((value) => -value) as [number, number, number, number],
    );

    expect(negative.smearingFourierTransform.real).toBeCloseTo(
      positive.smearingFourierTransform.real,
      15,
    );
    expect(negative.smearingFourierTransform.imaginary).toBeCloseTo(
      -positive.smearingFourierTransform.imaginary,
      15,
    );
    expect(negative.smearingFourierTransform.amplitude).toBe(
      positive.smearingFourierTransform.amplitude,
    );
  });

  it("applies the declared center translation phase", () => {
    const momentum = [0, 7, 0, 0] as const;
    const left = evaluate(0, momentum);
    const right = evaluate(3, momentum);
    const phaseDelta =
      right.smearingFourierTransform.centerPhaseArgumentRadians -
      left.smearingFourierTransform.centerPhaseArgumentRadians;
    const rotatedReal =
      left.smearingFourierTransform.real * Math.cos(phaseDelta) +
      left.smearingFourierTransform.imaginary * Math.sin(phaseDelta);
    const rotatedImaginary =
      left.smearingFourierTransform.imaginary * Math.cos(phaseDelta) -
      left.smearingFourierTransform.real * Math.sin(phaseDelta);

    expect(right.spatialCurvedNormalization.C_pPerM4).toBe(
      left.spatialCurvedNormalization.C_pPerM4,
    );
    expect(right.smearingFourierTransform.real).toBeCloseTo(rotatedReal, 14);
    expect(right.smearingFourierTransform.imaginary).toBeCloseTo(
      rotatedImaginary,
      14,
    );
  });

  it("preserves independent sample-reflection and Y/Z exchange normalization symmetries", () => {
    // p=0 maps (-x,-y,-z); p=63 maps (+x,+y,+z).
    const reflected = [evaluate(0), evaluate(63)];
    // p=18 maps (x=-.05,y=-.2,z=-.2), while p=33 exchanges Y/Z.
    const yzExchange = [evaluate(18), evaluate(33)];

    expect(reflected[1].spatialCurvedNormalization).toEqual(
      reflected[0].spatialCurvedNormalization,
    );
    expect(yzExchange[1].spatialCurvedNormalization).toEqual(
      yzExchange[0].spatialCurvedNormalization,
    );
  });

  it("keeps zero mode non-unit and inside the frozen analytic inclusive bound", () => {
    const result = evaluate(21, [0, 0, 0, 0]);

    expect(result.zeroMode.value).toBeLessThan(1);
    expect(result.zeroMode.value).toBeGreaterThanOrEqual(
      result.zeroMode.analyticInclusiveLowerBound,
    );
    expect(result.zeroMode.value).toBeLessThanOrEqual(
      result.zeroMode.analyticInclusiveUpperBound,
    );
    expect(result.zeroMode.assertedEqualToOne).toBe(false);
    expect(result.smearingFourierTransform.real).toBe(result.zeroMode.value);
    expect(result.smearingFourierTransform.imaginary).toBe(0);
  });

  it("is byte-for-byte deterministic for repeated evaluation", () => {
    const first = evaluate(42, [101, -103, 107, -109]);
    const second = evaluate(42, [101, -103, 107, -109]);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(second.work.functionEvaluations).toBeLessThanOrEqual(
      second.work.maximumFunctionEvaluations,
    );
  });

  it("rounds the raw 513 oscillatory request to fine 516 and even coarse 258", () => {
    const result = evaluate(0, [25_150, 0, 0, 0]);
    const dimensionlessArgument = result.oneDimensionalTransform.arguments[0];

    expect(Math.ceil((32 * dimensionlessArgument) / Math.PI)).toBe(513);
    expect(result.oneDimensionalTransform.fineSubintervals[0]).toBe(516);
    expect(result.oneDimensionalTransform.coarseSubintervals[0]).toBe(258);
    expect(
      result.oneDimensionalTransform.fineSubintervals.every(
        (count) => count % 4 === 0,
      ),
    ).toBe(true);
    expect(
      result.oneDimensionalTransform.coarseSubintervals.every(
        (count) => count % 2 === 0,
      ),
    ).toBe(true);
  });

  it("canonicalizes derived subnormal underflow to positive zero throughout the result tree", () => {
    const smallest = Number.MIN_VALUE;
    const result = evaluate(63, [-smallest, -smallest, -smallest, -smallest]);
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

    expect(result.input.fourMomentumMInverse).toEqual([
      -smallest,
      -smallest,
      -smallest,
      -smallest,
    ]);
    expect(
      result.oneDimensionalTransform.arguments.every(
        (value) => value === 0 && !Object.is(value, -0),
      ),
    ).toBe(true);
    expect(result.smearingFourierTransform.centerPhaseArgumentRadians).toBe(0);
    expect(
      Object.is(result.smearingFourierTransform.centerPhaseArgumentRadians, -0),
    ).toBe(false);
    expect(numericLeaves.every((value) => Number.isFinite(value))).toBe(true);
    expect(numericLeaves.some((value) => Object.is(value, -0))).toBe(false);
  });

  it.each([
    null,
    [],
    {},
    { sampleOrdinal: 0, fourMomentumMInverse: [0, 0, 0] },
    { sampleOrdinal: -1, fourMomentumMInverse: [0, 0, 0, 0] },
    { sampleOrdinal: 64, fourMomentumMInverse: [0, 0, 0, 0] },
    { sampleOrdinal: 0.5, fourMomentumMInverse: [0, 0, 0, 0] },
    { sampleOrdinal: 0, fourMomentumMInverse: [0, 0, 0, Number.NaN] },
    { sampleOrdinal: 0, fourMomentumMInverse: [0, 0, 0, -0] },
    {
      sampleOrdinal: 0,
      fourMomentumMInverse: [0, 0, 0, 0],
      outputPath: "forbidden.bin",
    },
    {
      sampleOrdinal: 0,
      fourMomentumMInverse: [0, 0, 0, 0],
      authorityOverride: true,
    },
  ])("rejects malformed, nonfinite, or extra input %#", (candidate) => {
    expect(() =>
      evaluateNhm2ConformallyFlatNeedleConnectedNoiseFourierDiagnostic(
        candidate,
      ),
    ).toThrow();
  });

  it("rejects proxies and accessors without executing traps", () => {
    let reads = 0;
    const accessor = Object.defineProperty(
      { sampleOrdinal: 0 },
      "fourMomentumMInverse",
      {
        enumerable: true,
        get() {
          reads += 1;
          return [0, 0, 0, 0];
        },
      },
    );
    const proxy = new Proxy(input(), {
      ownKeys() {
        reads += 1;
        return [];
      },
    });

    expect(() =>
      evaluateNhm2ConformallyFlatNeedleConnectedNoiseFourierDiagnostic(
        accessor,
      ),
    ).toThrow("accessor_or_hidden_property_forbidden");
    expect(() =>
      evaluateNhm2ConformallyFlatNeedleConnectedNoiseFourierDiagnostic(proxy),
    ).toThrow("proxy_forbidden");
    expect(reads).toBe(0);
  });

  it("rejects forbidden keys without invoking a nested getter", () => {
    let reads = 0;
    const candidate = Object.create(Object.prototype);
    Object.defineProperty(candidate, "sampleOrdinal", {
      enumerable: true,
      value: 0,
    });
    Object.defineProperty(candidate, "fourMomentumMInverse", {
      enumerable: true,
      get() {
        reads += 1;
        return [0, 0, 0, 0];
      },
    });
    Object.defineProperty(candidate, "constructor", {
      enumerable: true,
      value: "forbidden",
    });

    expect(() =>
      evaluateNhm2ConformallyFlatNeedleConnectedNoiseFourierDiagnostic(
        candidate,
      ),
    ).toThrow("forbidden_data_key");
    expect(reads).toBe(0);
  });

  it("aborts before quadrature when the fixed oscillatory work cap is exceeded", () => {
    expect(() => evaluate(0, [1e9, 0, 0, 0])).toThrow(
      "nhm2_connected_noise_fourier_diagnostic_hard_work_cap_exceeded",
    );
  });

  it("exports no writer, path, lever, metric-demand, tolerance, or authority override", async () => {
    const module =
      await import("../nhm2-conformally-flat-needle-connected-noise-fourier-diagnostic");
    const exportNames = Object.keys(module);

    expect(exportNames).toEqual([
      "NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_FOURIER_DIAGNOSTIC_SCHEMA_VERSION",
      "evaluateNhm2ConformallyFlatNeedleConnectedNoiseFourierDiagnostic",
    ]);
    expect(
      exportNames.some((name) =>
        /(writer|outputPath|lever|metricDemand|tolerance|authorityOverride)/i.test(
          name,
        ),
      ),
    ).toBe(false);
  });
});
