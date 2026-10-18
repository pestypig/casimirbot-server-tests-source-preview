import { describe, expect, it } from "vitest";

import {
  replayNhm2SemiclassicalV2Content,
  type Nhm2SemiclassicalV2ContentReplayInput,
  type Nhm2SemiclassicalV2ContentReplayPolicy,
} from "../nhm2-semiclassical-v2-content-replay";

const SAMPLE_COUNT = 64;
const TENSOR_COMPONENT_COUNT = 10;
const TENSOR_MULTIPLICITIES = [1, 2, 2, 2, 1, 2, 2, 1, 2, 1] as const;
const CONSTRAINT_COMPONENT_COUNT = 4;
const ALGEBRA_TOLERANCE = 2 ** -18;
const BASE_RESIDUAL = 2 ** -22;
const METRIC_ERROR_COMPONENT_BOUND = 1e-12;
const METRIC_ERROR_FROBENIUS = Math.hypot(
  ...TENSOR_MULTIPLICITIES.map(
    (multiplicity) => METRIC_ERROR_COMPONENT_BOUND * Math.sqrt(multiplicity),
  ),
);

const hash = (digit: string): string => digit.repeat(64);

const buildPolicy = (
  overrides: Partial<Nhm2SemiclassicalV2ContentReplayPolicy> = {},
): Nhm2SemiclassicalV2ContentReplayPolicy =>
  Object.freeze({
    policyId: "nhm2.server_owned.semiclassical_v2.diagnostic_replay/v2",
    candidateId: "nhm2-semiclassical-nondegenerate-001",
    geometrySha256: hash("1"),
    quantumStateSha256: hash("2"),
    chartId: "frozen-cartesian-chart-v1",
    chartSha256: hash("3"),
    normalizationId: "frozen-smeared-rset-frobenius-v1",
    normalizationSha256: hash("4"),
    sourceTensorProvenance: "state_derived_not_declared_lever" as const,
    declaredLeverTensorUsed: false as const,
    manifestDeclaresFrozenBeforeExecution: true as const,
    sampleCount: SAMPLE_COUNT,
    regulatorLevelCount: 3,
    noisePsdToleranceSI: 1e-12,
    noiseExchangeToleranceSI: 1e-12,
    fluctuationRatioTolerance: 0.02,
    meanNormalizationFloorSI: 1e-12,
    meanMetricDemandRelativeUpper95Tolerance: 0.1,
    maximumMetricDemandRelativeErrorBound: 0.01,
    metricDemandDerivationStatus:
      "metric_demand_derivation_executor_provenance_unverified" as const,
    metricDemandIntervalTraceStatus:
      "interval_trace_not_server_replayed" as const,
    minimumMetricDemandFrobeniusSI: 0.1,
    requiredMetricDemandSampleFraction: 1,
    smearingWeightNormalizationTolerance: 1e-14,
    bracketResidualTolerance: ALGEBRA_TOLERANCE,
    antisymmetryResidualTolerance: ALGEBRA_TOLERANCE,
    jacobiResidualTolerance: ALGEBRA_TOLERANCE,
    regulatorFinalResidualTolerance: ALGEBRA_TOLERANCE,
    producerResidualConsistencyTolerance: 0,
    regulatorMonotonicityTolerance: 0,
    minimumRegulatorConvergenceOrder: 1.9,
    ...overrides,
  });

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

const bracket = () => {
  const length = SAMPLE_COUNT * CONSTRAINT_COMPONENT_COUNT;
  const classicalTarget = new Float64Array(length);
  classicalTarget.fill(1);
  const computed = Float64Array.from(classicalTarget);
  computed[0] += BASE_RESIDUAL;
  const producerResidual = Float64Array.from(
    computed,
    (value: number, index: number) => value - classicalTarget[index],
  );
  return {
    computed,
    classicalTarget,
    producerResidual,
    absoluteUncertainty95: new Float64Array(length),
  };
};

const buildInput = (): Nhm2SemiclassicalV2ContentReplayInput => {
  const covarianceDimension = SAMPLE_COUNT * TENSOR_COMPONENT_COUNT;
  const noiseKernel = new Float64Array(
    SAMPLE_COUNT * SAMPLE_COUNT * TENSOR_COMPONENT_COUNT ** 2,
  );
  for (let index = 0; index < covarianceDimension; index += 1) {
    noiseKernel[noiseOffset(index, index)] = 1 + index / 1_000;
  }

  const meanStressTensor = new Float64Array(
    SAMPLE_COUNT * TENSOR_COMPONENT_COUNT,
  );
  for (let point = 0; point < SAMPLE_COUNT; point += 1) {
    meanStressTensor[point * TENSOR_COMPONENT_COUNT] = 100;
    meanStressTensor[point * TENSOR_COMPONENT_COUNT + 4] = 10;
    meanStressTensor[point * TENSOR_COMPONENT_COUNT + 7] = 10;
    meanStressTensor[point * TENSOR_COMPONENT_COUNT + 9] = 10;
  }
  const metricDemandRset = new Float64Array(
    SAMPLE_COUNT * TENSOR_COMPONENT_COUNT,
  );
  for (let point = 0; point < SAMPLE_COUNT; point += 1) {
    metricDemandRset[point * TENSOR_COMPONENT_COUNT] = 100;
    metricDemandRset[point * TENSOR_COMPONENT_COUNT + 4] = 10;
    metricDemandRset[point * TENSOR_COMPONENT_COUNT + 7] = 10;
    metricDemandRset[point * TENSOR_COMPONENT_COUNT + 9] = 10;
  }
  const metricDemandAbsoluteErrorBound = new Float64Array(
    SAMPLE_COUNT * TENSOR_COMPONENT_COUNT,
  );
  metricDemandAbsoluteErrorBound.fill(METRIC_ERROR_COMPONENT_BOUND);

  const meanSmearingWeights = new Float64Array(SAMPLE_COUNT);
  meanSmearingWeights.fill(1 / SAMPLE_COUNT);
  const constraintLength = SAMPLE_COUNT * CONSTRAINT_COMPONENT_COUNT;
  const antisymmetryForward = new Float64Array(constraintLength);
  antisymmetryForward[0] = BASE_RESIDUAL;
  const antisymmetryReverse = new Float64Array(constraintLength);
  const antisymmetryProducerResidual = Float64Array.from(
    antisymmetryForward,
    (value: number, index: number) => value + antisymmetryReverse[index],
  );
  const jacobiFirst = new Float64Array(constraintLength);
  const jacobiSecond = new Float64Array(constraintLength);
  const jacobiThird = new Float64Array(constraintLength);
  jacobiFirst[0] = BASE_RESIDUAL / 4;
  jacobiSecond[0] = BASE_RESIDUAL / 4;
  jacobiThird[0] = BASE_RESIDUAL / 2;
  const jacobiProducerResidual = Float64Array.from(
    jacobiFirst,
    (value: number, index: number) =>
      value + jacobiSecond[index] + jacobiThird[index],
  );

  return {
    policy: buildPolicy(),
    arrays: {
      noiseKernel,
      noiseAbsoluteUncertainty95: new Float64Array(noiseKernel.length),
      meanStressTensor,
      meanStressAbsoluteUncertainty95: new Float64Array(
        meanStressTensor.length,
      ),
      metricDemandRset,
      metricDemandAbsoluteErrorBound,
      meanSmearingWeights,
      brackets: {
        H_H: bracket(),
        H_Hi: bracket(),
        Hi_Hj: bracket(),
      },
      antisymmetry: {
        forward: antisymmetryForward,
        reverse: antisymmetryReverse,
        producerResidual: antisymmetryProducerResidual,
        absoluteUncertainty95: new Float64Array(constraintLength),
      },
      jacobi: {
        first: jacobiFirst,
        second: jacobiSecond,
        third: jacobiThird,
        producerResidual: jacobiProducerResidual,
        absoluteUncertainty95: new Float64Array(constraintLength),
      },
      regulator: {
        levels: [
          {
            scale: 0.25,
            residual: Object.assign(new Float64Array(constraintLength), {
              0: 16 * BASE_RESIDUAL,
            }),
            absoluteUncertainty95: new Float64Array(constraintLength),
          },
          {
            scale: 0.125,
            residual: Object.assign(new Float64Array(constraintLength), {
              0: 4 * BASE_RESIDUAL,
            }),
            absoluteUncertainty95: new Float64Array(constraintLength),
          },
          {
            scale: 0.0625,
            residual: Object.assign(new Float64Array(constraintLength), {
              0: BASE_RESIDUAL,
            }),
            absoluteUncertainty95: new Float64Array(constraintLength),
          },
        ],
      },
    },
  };
};

const mutable = (
  input: Nhm2SemiclassicalV2ContentReplayInput,
): {
  policy: Nhm2SemiclassicalV2ContentReplayPolicy;
  arrays: {
    noiseKernel: Float64Array;
    noiseAbsoluteUncertainty95: Float64Array;
    meanStressTensor: Float64Array;
    meanStressAbsoluteUncertainty95: Float64Array;
    metricDemandRset: Float64Array;
    metricDemandAbsoluteErrorBound: Float64Array;
    meanSmearingWeights: Float64Array;
    brackets: Record<string, ReturnType<typeof bracket>>;
    antisymmetry: {
      forward: Float64Array;
      reverse: Float64Array;
      producerResidual: Float64Array;
      absoluteUncertainty95: Float64Array;
    };
    jacobi: {
      first: Float64Array;
      second: Float64Array;
      third: Float64Array;
      producerResidual: Float64Array;
      absoluteUncertainty95: Float64Array;
    };
    regulator: {
      levels: Array<{
        scale: number;
        residual: Float64Array;
        absoluteUncertainty95: Float64Array;
      }>;
    };
  };
} => input as never;

const expectLocked = (
  result: ReturnType<typeof replayNhm2SemiclassicalV2Content>,
) => {
  expect(
    Object.values(result.claimLocks).every((value: boolean) => value === false),
  ).toBe(true);
};

describe("NHM2 semiclassical-v2 server-owned content replay", () => {
  it("rejects the superseded v1 approved-policy identity", () => {
    const input = mutable(buildInput());
    input.policy = Object.freeze({
      ...buildPolicy(),
      policyId: "nhm2.server_owned.semiclassical_v2.diagnostic_replay/v1",
    }) as unknown as Nhm2SemiclassicalV2ContentReplayPolicy;

    const result = replayNhm2SemiclassicalV2Content(input);

    expect(result.status).toBe("blocked");
    expect(result.blockers).toContain("policy_identity_invalid");
    expect(result.metrics.inputContent).toBeNull();
    expectLocked(result);
  });
  it("passes a nondegenerate N=64 diagonal covariance fixture without granting claims", () => {
    const result = replayNhm2SemiclassicalV2Content(buildInput());

    expect(result.status).toBe("blocked");
    expect(result.blockers).toEqual([
      "metric_demand_derivation_executor_provenance_unverified",
      "interval_trace_not_server_replayed",
    ]);
    expect(result.metrics.noise).toMatchObject({
      sampleCount: 64,
      covarianceDimension: 640,
      exchangeResidualUpper95SI: 0,
      covarianceTolerancePositiveSemidefiniteCertified: true,
      psdCertificationDisposition: "tolerance_certified",
      psdDiagonalShiftSI: 0.5e-12,
      psdResidualAllowanceSI: 0.5e-12,
      factorizationRoundoffModel: "ieee754_gamma_n_absolute_bound",
      maximumGershgorinRadiusUpper95SI: 0,
    });
    expect(result.metrics.noise?.maximumEigenvalueUpper95SI).toBeCloseTo(
      3.276 / SAMPLE_COUNT,
      15,
    );
    expect(result.metrics.noise?.minimumShiftedCholeskyPivotSI).toBeCloseTo(
      1 / SAMPLE_COUNT + 0.5e-12,
      15,
    );
    expect(
      result.metrics.noise?.factorizationResidualInfinityNormUpperSI,
    ).toBeLessThanOrEqual(0.5e-12);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.inputBindings)).toBe(true);
    expect(Object.isFrozen(result.metrics)).toBe(true);
    expect(Object.isFrozen(result.metrics.noise)).toBe(true);
    expect(
      Reflect.set(result.inputBindings, "preexecutionFreezeVerified", true),
    ).toBe(false);
    expect(result.metrics.mean?.smearedTensorComponentsSI).toEqual([
      100, 0, 0, 0, 10, 0, 0, 10, 0, 10,
    ]);
    expect(result.metrics.mean?.symmetricTensorFrobeniusSI).toBeCloseTo(
      Math.sqrt(10_300),
      12,
    );
    expect(result.metrics.mean?.fluctuationToMeanRatioUpper95).toBeLessThan(
      0.02,
    );
    expect(result.metrics.metricDemand).toEqual({
      minimumPointwiseSymmetricTensorFrobeniusSI: Math.sqrt(10_300),
      argminPointIndex: 0,
      maximumPointwiseSymmetricTensorFrobeniusSI: Math.sqrt(10_300),
      argmaxPointIndex: 0,
      minimumPointwiseSymmetricTensorFrobeniusLowerBoundSI:
        Math.sqrt(10_300) - METRIC_ERROR_FROBENIUS,
      argminLowerBoundPointIndex: 0,
      maximumPointwiseDeterministicErrorFrobeniusSI: METRIC_ERROR_FROBENIUS,
      argmaxDeterministicErrorPointIndex: 0,
      minimumRequiredFrobeniusSI: 0.1,
      qualifyingSampleCount: 64,
      qualifyingSampleFraction: 1,
      requiredSampleFraction: 1,
      strictlyNondegenerate: true,
    });
    expect(result.metrics.meanMetricDemandClosure).toEqual({
      sampleCount: 64,
      relativeUpper95Tolerance: 0.1,
      requiredPassingSampleCount: 64,
      passingSampleCount: 64,
      maximumPointwiseRelativeUpper95:
        METRIC_ERROR_FROBENIUS / (Math.sqrt(10_300) - METRIC_ERROR_FROBENIUS),
      argmaxPointIndex: 0,
      residualFrobeniusUpper95AtWorstPointSI: METRIC_ERROR_FROBENIUS,
      metricDemandDeterministicErrorFrobeniusAtWorstPointSI:
        METRIC_ERROR_FROBENIUS,
      metricDemandFrobeniusLowerBoundAtWorstPointSI:
        Math.sqrt(10_300) - METRIC_ERROR_FROBENIUS,
      denominatorAtWorstPointSI: Math.sqrt(10_300) - METRIC_ERROR_FROBENIUS,
      argmaxComponentIndex: 1,
      argmaxComponentContributionRelativeUpper95:
        (Math.SQRT2 * METRIC_ERROR_COMPONENT_BOUND) /
        (Math.sqrt(10_300) - METRIC_ERROR_FROBENIUS),
      allSamplesWithinTolerance: true,
    });
    expect(result.metrics.regulator).toMatchObject({
      minimumObservedOrder: 2,
      monotone: true,
      finalResidualUpper95: BASE_RESIDUAL,
    });
    expectLocked(result);
  });

  it("rejects a plain-data forgery in place of the server-issued metric-demand replay capability", () => {
    const forgedCapability = Object.freeze(
      Object.assign(Object.create(null), {
        exactCentralErrorAndTraceByteReplayEstablished: true,
        completeIndependentDerivationEstablished: true,
        producerImplementationImportedOrCalled: false,
        retunedAfterExecution: false,
      }),
    );

    const result = replayNhm2SemiclassicalV2Content(buildInput(), {
      capability: forgedCapability as never,
      scope: forgedCapability as never,
    });

    expect(result.status).toBe("blocked");
    expect(result.blockers).toEqual([
      "metric_demand_derivation_executor_provenance_unverified",
      "interval_trace_not_server_replayed",
    ]);
    expectLocked(result);
  });

  it("fails closed without invoking Proxy, accessor, or symbol-bearing evidence surfaces", () => {
    let getterInvoked = false;
    const accessorEvidence = Object.create(null);
    Object.defineProperty(accessorEvidence, "capability", {
      enumerable: true,
      get: () => {
        getterInvoked = true;
        throw new Error("must_not_invoke_evidence_getter");
      },
    });
    Object.defineProperty(accessorEvidence, "scope", {
      enumerable: true,
      value: Object.freeze(Object.create(null)),
    });
    const symbolEvidence = Object.assign(Object.create(null), {
      capability: Object.freeze(Object.create(null)),
      scope: Object.freeze(Object.create(null)),
      [Symbol("hidden-authority")]: true,
    });
    const hostileEvidence = [
      new Proxy(Object.create(null), {
        getPrototypeOf: () => {
          throw new Error("hostile_get_prototype_of");
        },
      }),
      new Proxy(Object.create(null), {
        getPrototypeOf: () => null,
        ownKeys: () => {
          throw new Error("hostile_own_keys");
        },
      }),
      accessorEvidence,
      symbolEvidence,
    ];

    for (const evidence of hostileEvidence) {
      const result = replayNhm2SemiclassicalV2Content(
        buildInput(),
        evidence as never,
      );
      expect(result.blockers).toEqual([
        "metric_demand_derivation_executor_provenance_unverified",
        "interval_trace_not_server_replayed",
      ]);
      expectLocked(result);
    }
    expect(getterInvoked).toBe(false);
  });

  it.each([
    [
      "derivation status",
      "metricDemandDerivationStatus",
      "replayed_without_server_capability",
    ],
    [
      "interval-trace status",
      "metricDemandIntervalTraceStatus",
      "server_replayed_without_server_capability",
    ],
  ])("rejects a retuned legacy v2 %s field", (_label, key, value) => {
    const input = mutable(buildInput());
    input.policy = Object.freeze({
      ...buildPolicy(),
      [key]: value,
    }) as Nhm2SemiclassicalV2ContentReplayPolicy;

    const result = replayNhm2SemiclassicalV2Content(input);

    expect(result.status).toBe("blocked");
    expect(result.blockers).toContain("policy_tolerance_invalid");
    expectLocked(result);
  });

  it("fails a zero-mean zero-noise witness against nonzero metric demand", () => {
    const input = mutable(buildInput());
    input.arrays.meanStressTensor.fill(0);
    input.arrays.noiseKernel.fill(0);

    const result = replayNhm2SemiclassicalV2Content(input);

    expect(result.status).toBe("blocked");
    expect(result.blockers).toContain(
      "mean_metric_demand_closure_exceeds_tolerance",
    );
    expect(result.blockers).not.toContain(
      "fluctuation_ratio_exceeds_tolerance",
    );
    expect(result.metrics.meanMetricDemandClosure).toMatchObject({
      requiredPassingSampleCount: 64,
      passingSampleCount: 0,
      maximumPointwiseRelativeUpper95: expect.any(Number),
      allSamplesWithinTolerance: false,
    });
    expectLocked(result);
  });

  it("fails when mean uncertainty alone exceeds the pointwise closure tolerance", () => {
    const input = mutable(buildInput());
    input.arrays.meanStressAbsoluteUncertainty95[0] = 11;

    const result = replayNhm2SemiclassicalV2Content(input);

    expect(result.status).toBe("blocked");
    expect(result.blockers).toContain(
      "mean_metric_demand_closure_exceeds_tolerance",
    );
    expect(result.metrics.meanMetricDemandClosure).toMatchObject({
      requiredPassingSampleCount: 64,
      passingSampleCount: 63,
      maximumPointwiseRelativeUpper95:
        Math.hypot(
          ...TENSOR_MULTIPLICITIES.map(
            (multiplicity, index) =>
              (index === 0
                ? 11 + METRIC_ERROR_COMPONENT_BOUND
                : METRIC_ERROR_COMPONENT_BOUND) * Math.sqrt(multiplicity),
          ),
        ) /
        (Math.sqrt(10_300) - METRIC_ERROR_FROBENIUS),
      argmaxPointIndex: 0,
      argmaxComponentIndex: 0,
      allSamplesWithinTolerance: false,
    });
    expectLocked(result);
  });

  it("fails closed when the covariance has a negative diagonal mode", () => {
    const input = mutable(buildInput());
    input.arrays.noiseKernel[noiseOffset(0, 0)] = -1;

    const result = replayNhm2SemiclassicalV2Content(input);

    expect(result.status).toBe("blocked");
    expect(result.blockers).toContain("noise_psd_negative_witness");
    expect(result.metrics.noise?.negativeWitnessRayleighQuotientSI).toBe(
      -1 / SAMPLE_COUNT,
    );
    expectLocked(result);
  });

  it("rejects a coherent negative mode even when every entry is within the PSD tolerance", () => {
    const input = mutable(buildInput());
    const covarianceDimension = SAMPLE_COUNT * TENSOR_COMPONENT_COUNT;
    const weightedEntry = -0.5e-12;
    input.arrays.noiseKernel.fill(0);
    for (let row = 0; row < covarianceDimension; row += 1) {
      const rowScale = Math.sqrt(
        (1 / SAMPLE_COUNT) *
          TENSOR_MULTIPLICITIES[row % TENSOR_COMPONENT_COUNT],
      );
      for (let column = 0; column < covarianceDimension; column += 1) {
        const columnScale = Math.sqrt(
          (1 / SAMPLE_COUNT) *
            TENSOR_MULTIPLICITIES[column % TENSOR_COMPONENT_COUNT],
        );
        input.arrays.noiseKernel[noiseOffset(row, column)] =
          weightedEntry / (rowScale * columnScale);
      }
    }

    const result = replayNhm2SemiclassicalV2Content(input);

    expect(result.status).toBe("blocked");
    expect(result.blockers).toContain("noise_psd_negative_witness");
    expect(result.metrics.noise).toMatchObject({
      psdCertificationDisposition: "negative_witness",
      covarianceTolerancePositiveSemidefiniteCertified: false,
    });
    expect(result.metrics.noise?.negativeWitnessRayleighQuotientSI).toBeCloseTo(
      weightedEntry * covarianceDimension,
      20,
    );
    expectLocked(result);
  });

  it("uses precomputed diagonal basis factors so subnormal weights cannot hide a negative star mode", () => {
    const input = mutable(buildInput());
    input.arrays.meanSmearingWeights.fill(0);
    input.arrays.meanSmearingWeights[0] = 0.5;
    input.arrays.meanSmearingWeights[1] = 0.5;
    input.arrays.meanSmearingWeights[63] = Number.MIN_VALUE;
    input.arrays.noiseKernel.fill(0);

    const special = 63 * TENSOR_COMPONENT_COUNT + 9;
    const normalMultiplicityTwoComponents = [1, 2, 3, 5, 6, 8] as const;
    const normalIndices = [0, 1].flatMap((point) =>
      normalMultiplicityTwoComponents.map(
        (component) => point * TENSOR_COMPONENT_COUNT + component,
      ),
    );
    const targetWeightedCoupling = 4e-13;
    const specialBasisFactor = Math.sqrt(Number.MIN_VALUE);
    const rawCoupling = targetWeightedCoupling / specialBasisFactor;
    for (const normal of normalIndices) {
      input.arrays.noiseKernel[noiseOffset(special, normal)] = rawCoupling;
      input.arrays.noiseKernel[noiseOffset(normal, special)] = rawCoupling;
    }

    const result = replayNhm2SemiclassicalV2Content(input);

    expect(result.status).toBe("blocked");
    expect(result.blockers).toContain("noise_psd_negative_witness");
    expect(result.metrics.noise).toMatchObject({
      psdCertificationDisposition: "negative_witness",
      covarianceTolerancePositiveSemidefiniteCertified: false,
    });
    expect(
      result.metrics.noise?.negativeWitnessRayleighQuotientSI,
    ).toBeLessThan(-input.policy.noisePsdToleranceSI);
    expectLocked(result);
  });

  it("certifies a correlated PSD block that is not diagonally dominant", () => {
    const input = mutable(buildInput());
    for (const matrixIndex of [0, 1, 2]) {
      input.arrays.noiseKernel[noiseOffset(matrixIndex, matrixIndex)] = 1;
    }
    for (const [left, right] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ] as const) {
      input.arrays.noiseKernel[noiseOffset(left, right)] = 0.75;
      input.arrays.noiseKernel[noiseOffset(right, left)] = 0.75;
    }

    const result = replayNhm2SemiclassicalV2Content(input);

    expect(result.status).toBe("blocked");
    expect(result.metrics.noise).toMatchObject({
      psdCertificationDisposition: "tolerance_certified",
      covarianceTolerancePositiveSemidefiniteCertified: true,
    });
    expect(
      result.metrics.noise?.factorizationResidualInfinityNormUpperSI,
    ).toBeLessThanOrEqual(result.metrics.noise?.psdResidualAllowanceSI ?? 0);
    expect(
      result.metrics.noise?.maximumGershgorinRadiusUpper95SI,
    ).toBeGreaterThan(1 / SAMPLE_COUNT);
    expectLocked(result);
  });

  it("blocks a shifted zero-pivot coupling that is inside the allowed spectral tolerance", () => {
    const input = mutable(buildInput());
    const tolerance = input.policy.noisePsdToleranceSI;
    const scale0 = 1 / SAMPLE_COUNT;
    const scale1 = 2 / SAMPLE_COUNT;
    const pairScale = Math.sqrt(scale0 * scale1);
    input.arrays.noiseKernel[noiseOffset(0, 0)] = (-0.5 * tolerance) / scale0;
    input.arrays.noiseKernel[noiseOffset(1, 1)] = (-0.5 * tolerance) / scale1;
    input.arrays.noiseKernel[noiseOffset(0, 1)] =
      (0.25 * tolerance) / pairScale;
    input.arrays.noiseKernel[noiseOffset(1, 0)] =
      (0.25 * tolerance) / pairScale;

    const result = replayNhm2SemiclassicalV2Content(input);

    expect(result.status).toBe("blocked");
    expect(result.blockers).toContain("noise_psd_numerically_inconclusive");
    expect(result.blockers).not.toContain("noise_psd_negative_witness");
    expect(result.metrics.noise).toMatchObject({
      psdCertificationDisposition: "numerically_inconclusive",
      covarianceTolerancePositiveSemidefiniteCertified: false,
    });
    expect(
      result.metrics.noise?.maximumZeroPivotCouplingResidualSI,
    ).toBeGreaterThan(0);
    expectLocked(result);
  });

  it("fails an exact-zero metric-demand screen as degenerate", () => {
    const input = mutable(buildInput());
    input.arrays.metricDemandRset.fill(0);

    const result = replayNhm2SemiclassicalV2Content(input);

    expect(result.status).toBe("blocked");
    expect(result.blockers).toContain("metric_demand_degenerate");
    expect(result.metrics.metricDemand).toEqual({
      minimumPointwiseSymmetricTensorFrobeniusSI: 0,
      argminPointIndex: 0,
      maximumPointwiseSymmetricTensorFrobeniusSI: 0,
      argmaxPointIndex: 0,
      minimumPointwiseSymmetricTensorFrobeniusLowerBoundSI: 0,
      argminLowerBoundPointIndex: 0,
      maximumPointwiseDeterministicErrorFrobeniusSI: METRIC_ERROR_FROBENIUS,
      argmaxDeterministicErrorPointIndex: 0,
      minimumRequiredFrobeniusSI: 0.1,
      qualifyingSampleCount: 0,
      qualifyingSampleFraction: 0,
      requiredSampleFraction: 1,
      strictlyNondegenerate: false,
    });
    expectLocked(result);

    const atFloor = mutable(buildInput());
    atFloor.arrays.metricDemandRset.fill(0);
    atFloor.arrays.metricDemandRset[0] =
      atFloor.policy.minimumMetricDemandFrobeniusSI;
    const atFloorResult = replayNhm2SemiclassicalV2Content(atFloor);
    expect(atFloorResult.status).toBe("blocked");
    expect(atFloorResult.blockers).toContain("metric_demand_degenerate");

    const onePointSpike = mutable(buildInput());
    onePointSpike.arrays.metricDemandRset.fill(0);
    onePointSpike.arrays.metricDemandRset[0] = 100;
    const onePointSpikeResult = replayNhm2SemiclassicalV2Content(onePointSpike);
    expect(onePointSpikeResult.status).toBe("blocked");
    expect(onePointSpikeResult.metrics.metricDemand).toMatchObject({
      qualifyingSampleCount: 1,
      qualifyingSampleFraction: 1 / SAMPLE_COUNT,
      requiredSampleFraction: 1,
      strictlyNondegenerate: false,
    });
  });

  it("blocks both sparse-positive and single-zero demand-error arrays pending componentwise zero proofs", () => {
    const sparsePositive = mutable(buildInput());
    sparsePositive.arrays.metricDemandAbsoluteErrorBound.fill(0);
    sparsePositive.arrays.metricDemandAbsoluteErrorBound[0] = Number.MIN_VALUE;
    const sparsePositiveResult =
      replayNhm2SemiclassicalV2Content(sparsePositive);
    expect(sparsePositiveResult.status).toBe("blocked");
    expect(sparsePositiveResult.blockers).toContain(
      "metric_demand_error_bound_unjustified_zero",
    );
    expect(sparsePositiveResult.metrics.metricDemand).toBeNull();

    const singleZero = mutable(buildInput());
    singleZero.arrays.metricDemandAbsoluteErrorBound.fill(Number.MIN_VALUE);
    singleZero.arrays.metricDemandAbsoluteErrorBound[0] = 0;
    const singleZeroResult = replayNhm2SemiclassicalV2Content(singleZero);
    expect(singleZeroResult.status).toBe("blocked");
    expect(singleZeroResult.blockers).toContain(
      "metric_demand_error_bound_unjustified_zero",
    );
    expectLocked(sparsePositiveResult);
    expectLocked(singleZeroResult);
  });

  it("uses the deterministic demand error in the nondegeneracy lower bound", () => {
    const input = mutable(buildInput());
    input.arrays.metricDemandRset.fill(0);
    input.arrays.metricDemandAbsoluteErrorBound.fill(1e-16);
    for (let point = 0; point < SAMPLE_COUNT; point += 1) {
      input.arrays.metricDemandRset[point * TENSOR_COMPONENT_COUNT] = 0.101;
      input.arrays.metricDemandAbsoluteErrorBound[
        point * TENSOR_COMPONENT_COUNT
      ] = 0.002;
    }

    const result = replayNhm2SemiclassicalV2Content(input);

    expect(result.status).toBe("blocked");
    expect(result.blockers).toContain("metric_demand_degenerate");
    expect(
      result.metrics.metricDemand
        ?.minimumPointwiseSymmetricTensorFrobeniusLowerBoundSI,
    ).toBeLessThan(0.1);
    expect(result.metrics.metricDemand?.qualifyingSampleCount).toBe(0);
    expectLocked(result);
  });

  it("enforces the frozen one-percent demand enclosure and includes it in closure", () => {
    const withinClosureButOverEnclosure = mutable(buildInput());
    withinClosureButOverEnclosure.arrays.metricDemandAbsoluteErrorBound.fill(2);
    const enclosureResult = replayNhm2SemiclassicalV2Content(
      withinClosureButOverEnclosure,
    );
    expect(enclosureResult.status).toBe("blocked");
    expect(enclosureResult.blockers).toContain(
      "metric_demand_error_bound_exceeds_frozen_relative_target",
    );
    expect(enclosureResult.metrics.meanMetricDemandClosure).toMatchObject({
      allSamplesWithinTolerance: true,
    });
    expect(
      enclosureResult.metrics.meanMetricDemandClosure
        ?.metricDemandDeterministicErrorFrobeniusAtWorstPointSI,
    ).toBeCloseTo(8, 14);

    const overClosure = mutable(buildInput());
    overClosure.arrays.metricDemandAbsoluteErrorBound.fill(3);
    const closureResult = replayNhm2SemiclassicalV2Content(overClosure);
    expect(closureResult.status).toBe("blocked");
    expect(closureResult.blockers).toContain(
      "metric_demand_error_bound_exceeds_frozen_relative_target",
    );
    expect(closureResult.blockers).toContain(
      "mean_metric_demand_closure_exceeds_tolerance",
    );
    expect(closureResult.metrics.meanMetricDemandClosure).toMatchObject({
      passingSampleCount: 0,
      allSamplesWithinTolerance: false,
    });
    expect(
      closureResult.metrics.meanMetricDemandClosure
        ?.metricDemandDeterministicErrorFrobeniusAtWorstPointSI,
    ).toBeCloseTo(12, 14);
    expectLocked(enclosureResult);
    expectLocked(closureResult);
  });

  it("blocks negative and non-finite deterministic demand-error bytes", () => {
    const negative = mutable(buildInput());
    negative.arrays.metricDemandAbsoluteErrorBound[0] = -1;
    const negativeResult = replayNhm2SemiclassicalV2Content(negative);
    expect(negativeResult.status).toBe("blocked");
    expect(negativeResult.blockers).toContain("absolute_uncertainty_negative");

    const nonfinite = mutable(buildInput());
    nonfinite.arrays.metricDemandAbsoluteErrorBound[0] = Number.NaN;
    const nonfiniteResult = replayNhm2SemiclassicalV2Content(nonfinite);
    expect(nonfiniteResult.status).toBe("blocked");
    expect(nonfiniteResult.blockers).toContain("array_nonfinite");
    expectLocked(negativeResult);
    expectLocked(nonfiniteResult);
  });

  it("propagates raw noise uncertainty through the smeared eigenvalue upper bound", () => {
    const input = mutable(buildInput());
    const lastOffDiagonalComponentIndex =
      SAMPLE_COUNT * TENSOR_COMPONENT_COUNT - 2;
    input.arrays.noiseAbsoluteUncertainty95[
      noiseOffset(lastOffDiagonalComponentIndex, lastOffDiagonalComponentIndex)
    ] = 0.1;

    const result = replayNhm2SemiclassicalV2Content(input);

    expect(result.status).toBe("blocked");
    expect(result.metrics.noise?.exchangeResidualUpper95SI).toBe(0);
    expect(result.metrics.noise?.maximumEigenvalueUpper95SI).toBeCloseTo(
      3.476 / SAMPLE_COUNT,
      15,
    );
    expect(result.metrics.mean?.fluctuationAmplitudeUpper95SI).toBeCloseTo(
      Math.sqrt(3.476 / SAMPLE_COUNT),
      15,
    );
    expectLocked(result);
  });

  it("detects point/component exchange-symmetry tampering", () => {
    const input = mutable(buildInput());
    input.arrays.noiseKernel[noiseOffset(0, 1)] = 1e-4;

    const result = replayNhm2SemiclassicalV2Content(input);

    expect(result.status).toBe("blocked");
    expect(result.blockers).toContain(
      "noise_exchange_symmetry_exceeds_tolerance",
    );
    expect(result.metrics.noise?.exchangeResidualUpper95SI).toBe(1e-4);
    expectLocked(result);
  });

  it("does not let a zero smearing weight hide raw exchange asymmetry", () => {
    const input = mutable(buildInput());
    input.arrays.meanSmearingWeights[0] = 0;
    input.arrays.meanSmearingWeights[1] = 2 / SAMPLE_COUNT;
    input.arrays.noiseKernel[noiseOffset(0, 1)] = 1e-4;

    const result = replayNhm2SemiclassicalV2Content(input);

    expect(result.status).toBe("blocked");
    expect(result.blockers).toContain(
      "noise_exchange_symmetry_exceeds_tolerance",
    );
    expect(result.metrics.noise).toMatchObject({
      exchangeResidualUpper95SI: 1e-4,
      exchangeSymmetryBasis: "raw_bilocal_component_pair_storage",
      psdCertificationDisposition: "tolerance_certified",
    });
    expectLocked(result);
  });

  it("detects a forged producer bracket residual", () => {
    const input = mutable(buildInput());
    input.arrays.brackets.H_H.producerResidual[0] += 2 ** -20;

    const result = replayNhm2SemiclassicalV2Content(input);

    expect(result.status).toBe("blocked");
    expect(result.blockers).toContain("bracket_H_H_producer_residual_mismatch");
    expect(result.metrics.brackets.H_H?.producerResidualMismatchLInf).toBe(
      2 ** -20,
    );
    expectLocked(result);
  });

  it.each(["antisymmetry", "jacobi"] as const)(
    "recomputes and rejects a %s identity violation even when the producer residual agrees",
    (identity: "antisymmetry" | "jacobi") => {
      const input = mutable(buildInput());
      if (identity === "antisymmetry") {
        input.arrays.antisymmetry.forward[0] = 0.1;
        input.arrays.antisymmetry.reverse[0] = 0;
        input.arrays.antisymmetry.producerResidual[0] = 0.1;
      } else {
        input.arrays.jacobi.first[0] = 0.025;
        input.arrays.jacobi.second[0] = 0.025;
        input.arrays.jacobi.third[0] = 0.05;
        input.arrays.jacobi.producerResidual[0] = 0.1;
      }

      const result = replayNhm2SemiclassicalV2Content(input);

      expect(result.status).toBe("blocked");
      expect(result.blockers).toContain(
        `${identity}_residual_upper95_exceeds_tolerance`,
      );
      expect(result.metrics[identity]?.residualLInf).toBeCloseTo(0.1, 15);
      expectLocked(result);
    },
  );

  it("fails a monotone but insufficient regulator convergence order", () => {
    const input = mutable(buildInput());
    input.arrays.regulator.levels[0].residual[0] = 4 * BASE_RESIDUAL;
    input.arrays.regulator.levels[1].residual[0] = 3 * BASE_RESIDUAL;
    input.arrays.regulator.levels[2].residual[0] = 2 * BASE_RESIDUAL;

    const result = replayNhm2SemiclassicalV2Content(input);

    expect(result.status).toBe("blocked");
    expect(result.blockers).toContain(
      "regulator_convergence_order_below_minimum",
    );
    expect(result.metrics.regulator?.monotone).toBe(true);
    expect(result.metrics.regulator?.finalResidualUpper95).toBeLessThan(
      ALGEBRA_TOLERANCE,
    );
    expectLocked(result);
  });

  it("passes at an exact frozen tolerance edge and fails without retuning above it", () => {
    const atEdge = mutable(buildInput());
    atEdge.arrays.brackets.H_H.computed[0] = 1 + ALGEBRA_TOLERANCE;
    atEdge.arrays.brackets.H_H.producerResidual[0] = ALGEBRA_TOLERANCE;
    const atEdgeResult = replayNhm2SemiclassicalV2Content(atEdge);
    expect(atEdgeResult.status).toBe("blocked");
    expect(atEdgeResult.metrics.brackets.H_H?.residualUpper95).toBe(
      ALGEBRA_TOLERANCE,
    );

    const above = mutable(buildInput());
    above.arrays.brackets.H_H.computed[0] = 1 + 2 * ALGEBRA_TOLERANCE;
    above.arrays.brackets.H_H.producerResidual[0] = 2 * ALGEBRA_TOLERANCE;
    const aboveResult = replayNhm2SemiclassicalV2Content(above);
    expect(aboveResult.status).toBe("blocked");
    expect(aboveResult.blockers).toContain(
      "bracket_H_H_residual_upper95_exceeds_tolerance",
    );
    expect(aboveResult.inputBindings.policyId).toBe(
      atEdgeResult.inputBindings.policyId,
    );
    expect(aboveResult.inputBindings).toMatchObject({
      manifestDeclaresFrozenBeforeExecution: true,
      preexecutionFreezeVerified: false,
    });
    expectLocked(aboveResult);
  });

  it("keeps bracket and identity tolerances independently frozen", () => {
    const input = mutable(buildInput());
    input.policy = buildPolicy({
      bracketResidualTolerance: BASE_RESIDUAL / 2,
      antisymmetryResidualTolerance: 2 * BASE_RESIDUAL,
      jacobiResidualTolerance: 2 * BASE_RESIDUAL,
    });

    const result = replayNhm2SemiclassicalV2Content(input);

    expect(result.status).toBe("blocked");
    expect(result.blockers).toContain(
      "bracket_H_H_residual_upper95_exceeds_tolerance",
    );
    expect(result.blockers).not.toContain(
      "antisymmetry_residual_upper95_exceeds_tolerance",
    );
    expect(result.blockers).not.toContain(
      "jacobi_residual_upper95_exceeds_tolerance",
    );
    expect(result.metrics.brackets.H_H?.tolerance).toBe(BASE_RESIDUAL / 2);
    expect(result.metrics.antisymmetry?.tolerance).toBe(2 * BASE_RESIDUAL);
    expect(result.metrics.jacobi?.tolerance).toBe(2 * BASE_RESIDUAL);
    expectLocked(result);
  });

  it("blocks sample counts outside the governed N=64 envelope and a zero PSD tolerance", () => {
    const oversized = mutable(buildInput());
    oversized.policy = buildPolicy({ sampleCount: 65 });
    expect(replayNhm2SemiclassicalV2Content(oversized).blockers).toContain(
      "policy_sample_count_invalid",
    );

    const zeroPsdTolerance = mutable(buildInput());
    zeroPsdTolerance.policy = buildPolicy({ noisePsdToleranceSI: 0 });
    expect(
      replayNhm2SemiclassicalV2Content(zeroPsdTolerance).blockers,
    ).toContain("policy_tolerance_invalid");

    const retunedDemandEnclosure = mutable(buildInput());
    retunedDemandEnclosure.policy = buildPolicy({
      maximumMetricDemandRelativeErrorBound: 0.02,
    });
    expect(
      replayNhm2SemiclassicalV2Content(retunedDemandEnclosure).blockers,
    ).toContain("policy_tolerance_invalid");
  });

  it("uses pointwise residual-plus-uncertainty maxima for brackets and regulator levels", () => {
    const input = mutable(buildInput());
    input.policy = buildPolicy({
      bracketResidualTolerance: 2,
      regulatorFinalResidualTolerance: 0.3,
    });
    const bracket = input.arrays.brackets.H_H;
    bracket.computed.set(bracket.classicalTarget);
    bracket.computed[0] += 1;
    bracket.producerResidual.fill(0);
    bracket.producerResidual[0] = 1;
    bracket.absoluteUncertainty95.fill(0);
    bracket.absoluteUncertainty95[1] = 2;

    const regulatorResiduals = [4, 1, 0.25] as const;
    const regulatorUncertainties = [3, 0.75, 0.1875] as const;
    for (let level = 0; level < 3; level += 1) {
      input.arrays.regulator.levels[level].residual.fill(0);
      input.arrays.regulator.levels[level].absoluteUncertainty95.fill(0);
      input.arrays.regulator.levels[level].residual[0] =
        regulatorResiduals[level];
      input.arrays.regulator.levels[level].absoluteUncertainty95[1] =
        regulatorUncertainties[level];
    }

    const result = replayNhm2SemiclassicalV2Content(input);

    expect(result.status).toBe("blocked");
    expect(result.metrics.brackets.H_H).toMatchObject({
      residualLInf: 1,
      absoluteUncertainty95: 2,
      residualUpper95: 2,
    });
    expect(result.metrics.regulator).toMatchObject({
      residualUpper95ByLevel: [4, 1, 0.25],
      observedOrders: [2, 2],
      finalResidualUpper95: 0.25,
    });
    expectLocked(result);
  });

  it("blocks non-finite bytes before numerical authority", () => {
    const input = mutable(buildInput());
    input.arrays.noiseKernel[0] = Number.NaN;

    const result = replayNhm2SemiclassicalV2Content(input);

    expect(result.status).toBe("blocked");
    expect(result.blockers).toContain("array_nonfinite");
    expect(result.metrics.noise).toBeNull();
    expectLocked(result);
  });

  it("blocks negative or malformed mean-stress uncertainty bytes", () => {
    const negative = mutable(buildInput());
    negative.arrays.meanStressAbsoluteUncertainty95[0] = -1;
    const negativeResult = replayNhm2SemiclassicalV2Content(negative);
    expect(negativeResult.status).toBe("blocked");
    expect(negativeResult.blockers).toContain("absolute_uncertainty_negative");

    const nonfinite = mutable(buildInput());
    nonfinite.arrays.meanStressAbsoluteUncertainty95[0] = Number.NaN;
    const nonfiniteResult = replayNhm2SemiclassicalV2Content(nonfinite);
    expect(nonfiniteResult.status).toBe("blocked");
    expect(nonfiniteResult.blockers).toContain("array_nonfinite");

    const wrongShape = mutable(buildInput());
    wrongShape.arrays.meanStressAbsoluteUncertainty95 = new Float64Array(1);
    expect(replayNhm2SemiclassicalV2Content(wrongShape).blockers).toContain(
      "mean_stress_uncertainty_shape_invalid",
    );
  });

  it("blocks wrong array shapes, aliased buffers, and target echoes", () => {
    const wrongShape = mutable(buildInput());
    wrongShape.arrays.meanStressTensor = new Float64Array(1);
    expect(replayNhm2SemiclassicalV2Content(wrongShape).blockers).toContain(
      "mean_stress_tensor_shape_invalid",
    );

    const aliased = mutable(buildInput());
    aliased.arrays.antisymmetry.reverse = aliased.arrays.antisymmetry.forward;
    expect(replayNhm2SemiclassicalV2Content(aliased).blockers).toContain(
      "array_shared_buffer_forbidden",
    );

    const targetEcho = mutable(buildInput());
    targetEcho.arrays.brackets.H_H.classicalTarget = Float64Array.from(
      targetEcho.arrays.brackets.H_H.computed,
    );
    targetEcho.arrays.brackets.H_H.producerResidual.fill(0);
    const targetEchoResult = replayNhm2SemiclassicalV2Content(targetEcho);
    expect(targetEchoResult.status).toBe("blocked");
    expect(targetEchoResult.blockers).toContain("bracket_H_H_target_echo");
    expectLocked(targetEchoResult);
  });
});
