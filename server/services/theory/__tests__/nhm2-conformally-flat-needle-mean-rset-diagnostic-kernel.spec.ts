import { describe, expect, it } from "vitest";

import * as kernelModule from "../nhm2-conformally-flat-needle-mean-rset-diagnostic-kernel";
import {
  calculateNhm2ConformallyFlatNeedleMeanRsetDiagnostic,
  Nhm2ConformallyFlatNeedleMeanRsetDiagnosticKernelError,
} from "../nhm2-conformally-flat-needle-mean-rset-diagnostic-kernel";

const EXPECTED_ANOMALY_PIN =
  "23407c8531145652f7ffd7100612268570f3f67d9f3a1897bb5de07ba48563ce";
const EXPECTED_ANOMALY_SIZE_BYTES = 11125;
const MEAN_NORMALIZATION = 1 / (2880 * Math.PI * Math.PI);
const HBAR_C_J_M = (6.62607015e-34 * 299792458) / (2 * Math.PI);

const expectDeepFrozen = (value: unknown): void => {
  if (value == null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
};

const expectFiniteCanonicalNumbers = (value: unknown): void => {
  if (typeof value === "number") {
    expect(Number.isFinite(value)).toBe(true);
    expect(Object.is(value, -0)).toBe(false);
    return;
  }
  if (value == null || typeof value !== "object") return;
  for (const child of Object.values(value)) expectFiniteCanonicalNumbers(child);
};

const collectArrays = (
  value: unknown,
  output: unknown[][] = [],
): unknown[][] => {
  if (Array.isArray(value)) output.push(value);
  if (value != null && typeof value === "object") {
    for (const child of Object.values(value)) collectArrays(child, output);
  }
  return output;
};

const compactTrace = (
  omegaSquared: number,
  tensor: readonly number[],
): number => (-tensor[0] + tensor[4] + tensor[7] + tensor[9]) / omegaSquared;

describe("nhm2 conformally-flat needle mean RSET pointwise diagnostic kernel", () => {
  it("has a minimal runtime export surface and a true zero-argument API", () => {
    expect(Object.keys(kernelModule).sort()).toEqual([
      "NHM2_CONFORMALLY_FLAT_NEEDLE_MEAN_RSET_DIAGNOSTIC_KERNEL_SCHEMA_VERSION",
      "Nhm2ConformallyFlatNeedleMeanRsetDiagnosticKernelError",
      "calculateNhm2ConformallyFlatNeedleMeanRsetDiagnostic",
    ]);
    expect(calculateNhm2ConformallyFlatNeedleMeanRsetDiagnostic.length).toBe(0);
  });

  it("rejects hostile extra arguments with a typed no-partial-result failure", () => {
    const callWithArguments =
      calculateNhm2ConformallyFlatNeedleMeanRsetDiagnostic as unknown as (
        ...args: unknown[]
      ) => unknown;
    let caught: unknown;
    try {
      callWithArguments({ tolerance: Infinity }, "path", true);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(
      Nhm2ConformallyFlatNeedleMeanRsetDiagnosticKernelError,
    );
    expect(caught).toMatchObject({
      code: "unexpected_arguments",
      partialResult: null,
    });
  });

  it("exact-binds the blocked anomaly reduction without acquiring authority", () => {
    const result = calculateNhm2ConformallyFlatNeedleMeanRsetDiagnostic();
    expect(result.status).toBe("blocked_diagnostic_pointwise_algebra_only");
    expect(result.upstreamBinding).toMatchObject({
      canonicalSha256: EXPECTED_ANOMALY_PIN,
      canonicalSizeBytes: EXPECTED_ANOMALY_SIZE_BYTES,
      exactIdentityVerifiedAtModuleInitialization: true,
      bindingGrantsAuthority: false,
    });
  });

  it("evaluates exactly the three frozen pointwise fixtures", () => {
    const result = calculateNhm2ConformallyFlatNeedleMeanRsetDiagnostic();
    expect(
      result.pointwiseFixtures.map((fixture) => fixture.fixtureId),
    ).toEqual([
      "flat_constant_omega",
      "constant_curvature",
      "sympy_direct_off_axis_conformal",
    ]);
    expect(result.fixedCalculation.pointwiseFixtureCount).toBe(3);
  });

  it("returns identically zero algebra for flat constant Omega", () => {
    const flat =
      calculateNhm2ConformallyFlatNeedleMeanRsetDiagnostic()
        .pointwiseFixtures[0];
    expect(flat.input.omegaSquared).toBe(4);
    expect([
      ...flat.output.conformalAnomalyK,
      ...flat.output.H1,
      ...flat.output.meanRsetGeometric,
      ...flat.output.meanRsetSi,
    ]).toEqual(Array<number>(40).fill(0));
    expect(flat.output.traces).toEqual({
      conformalAnomalyK: 0,
      expectedConformalAnomalyK: 0,
      H1: 0,
      expectedH1: 0,
      meanRsetGeometric: 0,
      expectedMeanRsetGeometric: 0,
    });
  });

  it("matches the exact constant-curvature coefficient and sign", () => {
    const fixture =
      calculateNhm2ConformallyFlatNeedleMeanRsetDiagnostic()
        .pointwiseFixtures[1];
    const expectedK = [3, 0, 0, 0, -3, 0, 0, -3, 0, -3];
    expect(fixture.input.scalarCurvature).toBe(12);
    expect(fixture.output.conformalAnomalyK).toEqual(expectedK);
    expect(fixture.output.H1).toEqual(Array<number>(10).fill(0));
    fixture.output.meanRsetGeometric.forEach((value, index) => {
      expect(value).toBeCloseTo(expectedK[index] * MEAN_NORMALIZATION, 15);
    });
    expect(fixture.output.traces.meanRsetGeometric).toBeCloseTo(
      -1 / (240 * Math.PI * Math.PI),
      15,
    );
  });

  it("locks an arbitrary non-axis SymPy direct-metric derivative fixture", () => {
    const result = calculateNhm2ConformallyFlatNeedleMeanRsetDiagnostic();
    const fixture = result.pointwiseFixtures[2];
    expect(result.frozenSympyFixtureAudit).toMatchObject({
      generator: "SymPy_1.14_direct_metric_christoffel_ricci",
      metric: "g_AB=Omega^2*diag(-1,1,1,1)",
      point: { t: "0", x: "1/10", y: "1/20", z: "-1/30" },
      omegaSquared: "63001/40000",
      scalarCurvature: "-576000000/15813251",
      boxScalarCurvature: "-2724864000000000000/62764785704439251",
      generatedFromMetricViaChristoffels: true,
      arbitraryNonAxisPoint: true,
      liveSympyExecutionByKernel: false,
      frozenFixtureAgreementIsRuntimeIndependentLineage: false,
      grantsAuthority: false,
    });
    expect(fixture.input.ricciCovariant[5]).toBeCloseTo(1058800 / 189003, 14);
    expect(fixture.input.ricciCovariant[6]).toBeCloseTo(-230000 / 63001, 14);
    expect(fixture.input.ricciCovariant[8]).toBeCloseTo(-1552400 / 189003, 14);
    expect(fixture.input.covariantScalarHessian[5]).toBeCloseTo(
      -1088294400000000 / 996250626251,
      12,
    );
    expect(fixture.input.covariantScalarHessian[8]).toBeCloseTo(
      1167782400000000 / 996250626251,
      12,
    );
    expect(fixture.input.inputScalarContractionScaledResidual).toBeLessThan(
      2e-12,
    );
    expect(fixture.input.inputBoxContractionScaledResidual).toBeLessThan(2e-12);
  });

  it("establishes K, H1, and mean trace identities on every fixture", () => {
    const result = calculateNhm2ConformallyFlatNeedleMeanRsetDiagnostic();
    for (const fixture of result.pointwiseFixtures) {
      const { omegaSquared, boxScalarCurvature, scalarCurvature } =
        fixture.input;
      const { ricciSquared, conformalAnomalyK, H1, meanRsetGeometric } =
        fixture.output;
      const expectedKTrace = ricciSquared - scalarCurvature ** 2 / 3;
      const expectedH1Trace = -6 * boxScalarCurvature;
      const expectedMeanTrace =
        MEAN_NORMALIZATION *
        (boxScalarCurvature + ricciSquared - scalarCurvature ** 2 / 3);
      expect(compactTrace(omegaSquared, conformalAnomalyK)).toBeCloseTo(
        expectedKTrace,
        11,
      );
      expect(compactTrace(omegaSquared, H1)).toBeCloseTo(expectedH1Trace, 11);
      expect(compactTrace(omegaSquared, meanRsetGeometric)).toBeCloseTo(
        expectedMeanTrace,
        14,
      );
      expect(
        Object.values(fixture.output.identityResiduals).every(
          (residual) => residual <= result.algebraChecks.scaledResidualLimit,
        ),
      ).toBe(true);
    }
    expect(
      result.algebraChecks.maximumTraceIdentityScaledResidual,
    ).toBeLessThan(result.algebraChecks.scaledResidualLimit);
    expect(result.algebraChecks.wardIdentityProof).toBe(false);
  });

  it("applies T=(K-H1/6)/(2880*pi^2) componentwise", () => {
    const result = calculateNhm2ConformallyFlatNeedleMeanRsetDiagnostic();
    for (const fixture of result.pointwiseFixtures) {
      fixture.output.meanRsetGeometric.forEach((mean, index) => {
        const expected =
          MEAN_NORMALIZATION *
          (fixture.output.conformalAnomalyK[index] -
            fixture.output.H1[index] / 6);
        expect(mean).toBeCloseTo(expected, 14);
      });
    }
  });

  it("uses exact hbar*c metadata and SI restoration without changing signs", () => {
    const result = calculateNhm2ConformallyFlatNeedleMeanRsetDiagnostic();
    expect(result.formula).toMatchObject({
      siRestoration: "h*c/(2*pi)",
      exactHDecimal: "6.62607015e-34",
      exactCInteger: "299792458",
    });
    for (const fixture of result.pointwiseFixtures) {
      fixture.output.meanRsetSi.forEach((value, index) => {
        expect(value).toBeCloseTo(
          fixture.output.meanRsetGeometric[index] * HBAR_C_J_M,
          45,
        );
      });
    }
  });

  it("preserves structural positive zero for all static T0i components", () => {
    const result = calculateNhm2ConformallyFlatNeedleMeanRsetDiagnostic();
    for (const fixture of result.pointwiseFixtures) {
      for (const component of [1, 2, 3]) {
        expect(fixture.output.conformalAnomalyK[component]).toBe(0);
        expect(fixture.output.H1[component]).toBe(0);
        expect(fixture.output.meanRsetGeometric[component]).toBe(0);
        expect(Object.is(fixture.output.meanRsetGeometric[component], -0)).toBe(
          false,
        );
      }
    }
  });

  it("returns repeatable, freshly owned, deeply frozen pointwise results", () => {
    const first = calculateNhm2ConformallyFlatNeedleMeanRsetDiagnostic();
    const second = calculateNhm2ConformallyFlatNeedleMeanRsetDiagnostic();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.pointwiseFixtures).not.toBe(second.pointwiseFixtures);
    first.pointwiseFixtures.forEach((fixture, index) => {
      expect(fixture).not.toBe(second.pointwiseFixtures[index]);
      expect(fixture.output.meanRsetGeometric).not.toBe(
        second.pointwiseFixtures[index].output.meanRsetGeometric,
      );
    });
    const firstArrays = collectArrays(first);
    const secondArrays = collectArrays(second);
    expect(new Set(firstArrays).size).toBe(firstArrays.length);
    expect(new Set(secondArrays).size).toBe(secondArrays.length);
    expect(firstArrays.some((array) => secondArrays.includes(array))).toBe(
      false,
    );
    expectDeepFrozen(first);
    expectFiniteCanonicalNumbers(first);
  });

  it("has no smear, 64x10 array, refinement, U95, coverage, or receipts", () => {
    const result = calculateNhm2ConformallyFlatNeedleMeanRsetDiagnostic();
    expect(result).toMatchObject({
      full64x10MeanRset: null,
      sampleWeights: null,
      smearing: null,
      diagnosticRefinementRadius: null,
      absoluteUncertainty95: null,
      coverage: null,
      deterministicEnclosure: null,
      wardIdentityProof: null,
      runReceipt: null,
      executionReceipt: null,
      replayReceipt: null,
      certificate: null,
    });
    expect("arrays" in result).toBe(false);
  });

  it("closes every authority and claim lock", () => {
    const result = calculateNhm2ConformallyFlatNeedleMeanRsetDiagnostic();
    expect(
      Object.values(result.authority).every((value) => value === false),
    ).toBe(true);
    expect(
      Object.values(result.claimLocks).every((value) => value === false),
    ).toBe(true);
  });

  it("states the retained blockers and hard-cap disposition without overclaim", () => {
    const result = calculateNhm2ConformallyFlatNeedleMeanRsetDiagnostic();
    expect(result.blockers).toContain(
      "full_64x10_smearing_kernel_not_implemented",
    );
    expect(result.blockers).toContain(
      "fourth_order_conformal_geometry_not_retained_without_live_independent_crosscheck",
    );
    expect(result.blockers).toContain(
      "frozen_sympy_fixture_is_not_live_independent_runtime_agreement",
    );
    expect(result.fixedCalculation).toMatchObject({
      zeroArgumentApi: true,
      callerInputAccepted: false,
      pathInputAccepted: false,
      processInputAccepted: false,
      writerCapabilityPresent: false,
      toleranceOverrideAccepted: false,
      workOverrideAccepted: false,
      authorityOverrideAccepted: false,
      hardCapDisposition: "typed_abort_without_partial_result",
    });
    expect(result.algebraChecks).toMatchObject({
      diagnosticOnly: true,
      wardIdentityProof: false,
    });
    expect(result.claimLocks.diagnosticPass).toBe(false);
  });
});
