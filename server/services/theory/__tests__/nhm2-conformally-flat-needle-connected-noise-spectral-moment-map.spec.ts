import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  canonicalNhm2ConformallyFlatNeedleConnectedNoiseSpectralMomentMapJson,
  evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralMomentMap,
  NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_SPECTRAL_MOMENT_MAP,
  NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_SPECTRAL_MOMENT_MAP_SCHEMA_VERSION,
  NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_SPECTRAL_MOMENT_MAP_SHA256,
  NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_SPECTRAL_MOMENT_MAP_SIZE_BYTES,
  NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_SPECTRAL_MOMENT_MAP_WORKER_DESCRIPTOR,
} from "../nhm2-conformally-flat-needle-connected-noise-spectral-moment-map";
import { evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralBlockDiagnostic } from "../nhm2-conformally-flat-needle-connected-noise-spectral-block-diagnostic";

const MAP = NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_SPECTRAL_MOMENT_MAP;
const DESCRIPTOR =
  NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_SPECTRAL_MOMENT_MAP_WORKER_DESCRIPTOR;

const powers = (
  momentum: readonly [number, number, number, number],
): number[] =>
  MAP.exactRationalMap.monomialOrder.map(({ exponents }) =>
    exponents.reduce<number>(
      (product, exponent, coordinate) =>
        product * momentum[coordinate] ** exponent,
      1,
    ),
  );

const input = (
  moments: readonly number[] = [1, ...Array.from({ length: 21 }, () => 0)],
  leftSampleOrdinal = 0,
  rightSampleOrdinal = 0,
) => ({
  evenMonomialValuesInFrozenOrder: moments,
  leftSampleOrdinal,
  rightSampleOrdinal,
});

type Rational = Readonly<{ numerator: bigint; denominator: bigint }>;

const gcd = (left: bigint, right: bigint): bigint => {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
};
const rational = (numerator: bigint, denominator = 1n): Rational => {
  if (denominator === 0n) throw new Error("zero denominator");
  const sign = denominator < 0n ? -1n : 1n;
  const common = gcd(numerator, denominator);
  return Object.freeze({
    numerator: (sign * numerator) / common,
    denominator: (sign * denominator) / common,
  });
};
const add = (left: Rational, right: Rational): Rational =>
  rational(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
const multiply = (left: Rational, right: Rational): Rational =>
  rational(
    left.numerator * right.numerator,
    left.denominator * right.denominator,
  );
const scale = (value: Rational, numerator: bigint, denominator = 1n) =>
  multiply(value, rational(numerator, denominator));
const negate = (value: Rational): Rational =>
  rational(-value.numerator, value.denominator);
const power = (value: Rational, exponent: number): Rational => {
  let result = rational(1n);
  for (let ordinal = 0; ordinal < exponent; ordinal += 1) {
    result = multiply(result, value);
  }
  return result;
};
const equalRational = (left: Rational, right: Rational): boolean =>
  left.numerator === right.numerator && left.denominator === right.denominator;

type RationalFourVector = readonly [Rational, Rational, Rational, Rational];
const directSixTimesS2Pi = (
  momentum: RationalFourVector,
  a: number,
  b: number,
  c: number,
  d: number,
): Rational => {
  const eta = [-1n, 1n, 1n, 1n] as const;
  const kLower: RationalFourVector = [
    negate(momentum[0]),
    momentum[1],
    momentum[2],
    momentum[3],
  ];
  let s = power(momentum[0], 2);
  for (let index = 1; index < 4; index += 1) {
    s = add(s, negate(power(momentum[index], 2)));
  }
  const B = (left: number, right: number): Rational =>
    add(
      left === right ? scale(s, eta[left]) : rational(0n),
      multiply(kLower[left], kLower[right]),
    );
  return add(
    add(
      scale(multiply(B(a, c), B(b, d)), 3n),
      scale(multiply(B(a, d), B(b, c)), 3n),
    ),
    scale(multiply(B(a, b), B(c, d)), -2n),
  );
};

const directParityProjectedSixTimesS2Pi = (
  momentum: RationalFourVector,
  a: number,
  b: number,
  c: number,
  d: number,
): Rational => {
  const inverted: RationalFourVector = [
    momentum[0],
    negate(momentum[1]),
    negate(momentum[2]),
    negate(momentum[3]),
  ];
  return scale(
    add(
      directSixTimesS2Pi(momentum, a, b, c, d),
      directSixTimesS2Pi(inverted, a, b, c, d),
    ),
    1n,
    2n,
  );
};

const mapSixTimesS2Pi = (
  momentum: RationalFourVector,
  pairOrdinal: number,
): Rational => {
  const row =
    MAP.exactRationalMap.numeratorRowsInFrozenComponentPairOrder[pairOrdinal];
  return row.reduce((sum, coefficient, monomialOrdinal) => {
    const exponents =
      MAP.exactRationalMap.monomialOrder[monomialOrdinal].exponents;
    const monomial = exponents.reduce(
      (product, exponent, coordinate) =>
        multiply(product, power(momentum[coordinate], exponent)),
      rational(1n),
    );
    return add(sum, scale(monomial, BigInt(coefficient)));
  }, rational(0n));
};

const componentIndices = [
  [0, 0],
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 1],
  [1, 2],
  [1, 3],
  [2, 2],
  [2, 3],
  [3, 3],
] as const;

const expectDeepFrozen = (root: unknown): void => {
  const stack: unknown[] = [root];
  const seen = new Set<object>();
  while (stack.length > 0) {
    const value = stack.pop();
    if (value == null || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    expect(Object.isFrozen(value)).toBe(true);
    for (const nested of Object.values(value)) stack.push(nested);
  }
};

describe("NHM2 connected-noise exact spectral moment map", () => {
  it("is a deeply frozen, stable, hash-pinned JSON worker descriptor", () => {
    const serialized =
      canonicalNhm2ConformallyFlatNeedleConnectedNoiseSpectralMomentMapJson();

    expect(Buffer.byteLength(serialized, "utf8")).toBe(
      NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_SPECTRAL_MOMENT_MAP_SIZE_BYTES,
    );
    expect(createHash("sha256").update(serialized).digest("hex")).toBe(
      NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_SPECTRAL_MOMENT_MAP_SHA256,
    );
    expect(JSON.parse(serialized)).toEqual(DESCRIPTOR);
    expectDeepFrozen(DESCRIPTOR);
    expectDeepFrozen(MAP);
    expect(DESCRIPTOR.scatter.targetShape).toEqual([64, 64, 100]);
    expect(DESCRIPTOR.scatter.targetElementCount).toBe(409_600);
  });

  it("freezes the 10-component, 22-monomial, exact integer-over-six map", () => {
    expect(MAP.schemaVersion).toBe(
      NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_SPECTRAL_MOMENT_MAP_SCHEMA_VERSION,
    );
    expect(MAP.tensorConvention.componentOrder).toEqual([
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
    expect(MAP.exactRationalMap.commonDenominator).toBe(6);
    expect(
      MAP.exactRationalMap.combinedSpectralDensityDenominatorApartFromPi,
    ).toBe(2880);
    expect(MAP.exactRationalMap.monomialOrder).toHaveLength(22);
    expect(
      MAP.exactRationalMap.numeratorRowsInFrozenComponentPairOrder,
    ).toHaveLength(100);
    for (const row of MAP.exactRationalMap
      .numeratorRowsInFrozenComponentPairOrder) {
      expect(row).toHaveLength(22);
      expect(row.every(Number.isSafeInteger)).toBe(true);
    }
    expect(MAP.exactRationalMap.coefficientDerivationArithmetic).toContain(
      "no_fitting",
    );
  });

  it("distinguishes the 42 integrated parity zeros from the nonzero pointwise tensor", () => {
    const parity = MAP.parityReduction;

    expect(parity.pointwiseQuarticMonomialCountBeforeProjection).toBe(35);
    expect(parity.pointwiseIdenticallyZeroComponentPairCount).toBe(0);
    expect(parity.parityProjectedZeroPairOrdinals).toHaveLength(42);
    expect(parity.parityAdmittedOrderedPairCount).toBe(58);
    expect(parity.parityAdmittedUpperPairOrdinals).toHaveLength(34);
    expect(parity.oddPairsArePointwiseZero).toBe(false);
    expect(
      parity.oddPairsHaveExactlyZeroFullConeIntegralUnderFrozenSymmetry,
    ).toBe(true);
    for (const ordinal of parity.parityProjectedZeroPairOrdinals) {
      expect(
        MAP.exactRationalMap.numeratorRowsInFrozenComponentPairOrder[ordinal],
      ).toEqual(Array.from({ length: 22 }, () => 0));
    }
  });

  it("reproduces all 100 parity-projected tensor entries exactly at rational microfixtures", () => {
    const fixtures: RationalFourVector[] = [
      [rational(2n), rational(0n), rational(0n), rational(0n)],
      [rational(3n, 2n), rational(1n, 2n), rational(-1n, 3n), rational(1n, 4n)],
      [rational(5n, 2n), rational(3n, 4n), rational(1n, 5n), rational(-2n, 7n)],
    ];

    for (const momentum of fixtures) {
      for (let pairOrdinal = 0; pairOrdinal < 100; pairOrdinal += 1) {
        const left = Math.floor(pairOrdinal / 10);
        const right = pairOrdinal % 10;
        const [a, b] = componentIndices[left];
        const [c, d] = componentIndices[right];
        const direct = directParityProjectedSixTimesS2Pi(momentum, a, b, c, d);
        const mapped = mapSixTimesS2Pi(momentum, pairOrdinal);
        expect(
          equalRational(mapped, direct),
          `fixture pair ${pairOrdinal}: ${mapped.numerator}/${mapped.denominator} != ${direct.numerator}/${direct.denominator}`,
        ).toBe(true);
      }
    }
  });

  it("matches the even spatial projection of the existing single-K spectral block at generic finite points", () => {
    const fixtures = [
      [3, 0.25, -0.5, 0.75],
      [4, -0.75, 0.5, 0.25],
    ] as const;

    for (const momentum of fixtures) {
      const inverted = [
        momentum[0],
        -momentum[1],
        -momentum[2],
        -momentum[3],
      ] as const;
      const mapped =
        evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralMomentMap(
          input(powers(momentum)),
        ).positiveFrequencySpectralDensity.valuesInFrozenComponentPairOrder;
      const forward =
        evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralBlockDiagnostic({
          leftSampleOrdinal: 0,
          rightSampleOrdinal: 0,
          fourMomentumMInverse: momentum,
        }).positiveFrequencySpectralDensity.valuesInFrozenComponentPairOrder;
      const reflected =
        evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralBlockDiagnostic({
          leftSampleOrdinal: 0,
          rightSampleOrdinal: 0,
          fourMomentumMInverse: inverted,
        }).positiveFrequencySpectralDensity.valuesInFrozenComponentPairOrder;

      for (let pairOrdinal = 0; pairOrdinal < 100; pairOrdinal += 1) {
        const expected = (forward[pairOrdinal] + reflected[pairOrdinal]) / 2;
        const tolerance = Math.max(1e-14, Math.abs(expected) * 2e-14);
        expect(Math.abs(mapped[pairOrdinal] - expected)).toBeLessThanOrEqual(
          tolerance,
        );
      }
    }
  });

  it("reproduces the center-of-momentum exact coefficient microfixture", () => {
    const rows = MAP.exactRationalMap.numeratorRowsInFrozenComponentPairOrder;
    const result =
      evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralMomentMap(
        input(powers([2, 0, 0, 0])),
      );
    const rho =
      result.positiveFrequencySpectralDensity.valuesInFrozenComponentPairOrder;

    expect(rows[4 * 10 + 4][0]).toBe(4);
    expect(rows[4 * 10 + 7][0]).toBe(-2);
    expect(rows[5 * 10 + 5][0]).toBe(3);
    expect(rho[4 * 10 + 4]).toBeCloseTo(1 / (45 * Math.PI), 15);
    expect(rho[4 * 10 + 7]).toBeCloseTo(-1 / (90 * Math.PI), 15);
    expect(rho[5 * 10 + 5]).toBeCloseTo(1 / (60 * Math.PI), 15);
  });

  it("freezes exchange symmetry, independent reflection signatures, and Y/Z exchange", () => {
    const rows = MAP.exactRationalMap.numeratorRowsInFrozenComponentPairOrder;
    const exchange = MAP.tensorConvention.exchangeComponentPairOrdinals;
    const reflections =
      MAP.parityReduction.componentPairReflectionSignaturesXYZ;
    const yzPairs = MAP.yzExchange.componentPairOrdinals;
    const yzMonomials = MAP.yzExchange.monomialOrdinals;

    for (let pairOrdinal = 0; pairOrdinal < 100; pairOrdinal += 1) {
      expect(rows[exchange[pairOrdinal]]).toEqual(rows[pairOrdinal]);
      for (
        let monomialOrdinal = 0;
        monomialOrdinal < 22;
        monomialOrdinal += 1
      ) {
        const coefficient = rows[pairOrdinal][monomialOrdinal];
        expect(rows[yzPairs[pairOrdinal]][yzMonomials[monomialOrdinal]]).toBe(
          coefficient,
        );
        if (coefficient === 0) continue;
        const exponents =
          MAP.exactRationalMap.monomialOrder[monomialOrdinal].exponents;
        for (let axis = 0; axis < 3; axis += 1) {
          expect(exponents[axis + 1] % 2 === 0 ? 1 : -1).toBe(
            reflections[pairOrdinal][axis],
          );
        }
      }
    }
    expect(MAP.yzExchange.componentOrdinals).toEqual([
      0, 1, 3, 2, 4, 6, 5, 9, 8, 7,
    ]);
  });

  it("returns bounded scatter indices for [64,64,100] and the transposed pair", () => {
    const result =
      evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralMomentMap(
        input(powers([2, 0, 0, 0]), 2, 61),
      );
    const scatter = result.scatterPlan;

    expect(scatter.leftRightBlockStart).toBe((2 * 64 + 61) * 100);
    expect(scatter.rightLeftBlockStart).toBe((61 * 64 + 2) * 100);
    expect(scatter.leftRightFlatIndices).toHaveLength(100);
    expect(scatter.rightLeftPairExchangeFlatIndices).toHaveLength(100);
    expect(scatter.leftRightFlatIndices[12]).toBe(
      scatter.leftRightBlockStart + 12,
    );
    expect(scatter.rightLeftPairExchangeFlatIndices[12]).toBe(
      scatter.rightLeftBlockStart + 21,
    );
    expect(
      scatter.leftRightFlatIndices.every(
        (index) => index >= 0 && index < 409_600,
      ),
    ).toBe(true);
    expect(
      scatter.rightLeftPairExchangeFlatIndices.every(
        (index) => index >= 0 && index < 409_600,
      ),
    ).toBe(true);
    expect(scatter.valuesWrittenByThisFunction).toBe(false);
    expect(scatter.fullTargetAllocatedByThisFunction).toBe(false);
  });

  it("keeps every execution, replay, lamp, ADM, and physical authority false", () => {
    const result =
      evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralMomentMap(input());

    expect(MAP.status).toBe(
      "exact_rational_parity_projected_map_diagnostic_only",
    );
    expect(MAP.diagnosticOnly).toBe(true);
    expect(Object.values(MAP.authority).every((value) => value === false)).toBe(
      true,
    );
    expect(
      Object.values(MAP.claimLocks).every((value) => value === false),
    ).toBe(true);
    expect(
      Object.values(result.authority).every((value) => value === false),
    ).toBe(true);
    expect(
      Object.values(result.claimLocks).every((value) => value === false),
    ).toBe(true);
    expect(result.deterministicEnclosure).toBeNull();
    expect(result.absoluteUncertainty95).toBeNull();
    expect(result.mayFeedFixedBackgroundRun).toBe(false);
    expect(result.executionAdmissible).toBe(false);
    expect(MAP.implementationBoundary.declaredLeverTensorAccepted).toBe(false);
    expectDeepFrozen(result);
  });

  it.each([
    null,
    [],
    {},
    input(Array.from({ length: 21 }, () => 0)),
    input(Array.from({ length: 23 }, () => 0)),
    input([Number.NaN, ...Array.from({ length: 21 }, () => 0)]),
    input([-0, ...Array.from({ length: 21 }, () => 0)]),
    {
      evenMonomialValuesInFrozenOrder: undefined,
      leftSampleOrdinal: 0,
      rightSampleOrdinal: 0,
    },
    input(undefined as unknown as number[], -1, 0),
    input(undefined as unknown as number[], 0, 64),
    { ...input(), outputPath: "forbidden.bin" },
    { ...input(), authorityOverride: true },
    { ...input(), declaredLeverTensor: Array.from({ length: 100 }, () => 1) },
  ])(
    "rejects malformed, nonfinite, extra, or override input %#",
    (candidate) => {
      expect(() =>
        evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralMomentMap(
          candidate,
        ),
      ).toThrow();
    },
  );

  it("rejects proxies and accessors without executing traps or getters", () => {
    let reads = 0;
    const rootAccessor = Object.defineProperty(
      { leftSampleOrdinal: 0, rightSampleOrdinal: 0 },
      "evenMonomialValuesInFrozenOrder",
      {
        enumerable: true,
        get() {
          reads += 1;
          return Array.from({ length: 22 }, () => 0);
        },
      },
    );
    const rootProxy = new Proxy(input(), {
      ownKeys() {
        reads += 1;
        return [];
      },
    });
    const momentProxy = new Proxy(
      Array.from({ length: 22 }, () => 0),
      {
        ownKeys() {
          reads += 1;
          return [];
        },
      },
    );
    const momentAccessor = Array.from({ length: 22 }, () => 0);
    Object.defineProperty(momentAccessor, "11", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return 0;
      },
    });

    expect(() =>
      evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralMomentMap(
        rootAccessor,
      ),
    ).toThrow("accessor_or_hidden_property_forbidden");
    expect(() =>
      evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralMomentMap(
        rootProxy,
      ),
    ).toThrow("proxy_forbidden");
    expect(() =>
      evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralMomentMap(
        input(momentProxy),
      ),
    ).toThrow("proxy_forbidden");
    expect(() =>
      evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralMomentMap(
        input(momentAccessor),
      ),
    ).toThrow("accessor_sparse_or_hidden_array_entry");
    expect(reads).toBe(0);
  });

  it("rejects symbol, hidden, forbidden, and non-plain root data", () => {
    const withSymbol = input() as ReturnType<typeof input> & {
      [key: symbol]: number;
    };
    withSymbol[Symbol("forbidden")] = 1;
    const withHidden = input();
    Object.defineProperty(withHidden, "hidden", {
      enumerable: false,
      value: 1,
    });
    const withForbidden = {
      constructor: "forbidden",
      leftSampleOrdinal: 0,
      rightSampleOrdinal: 0,
    };
    const nullPrototype = Object.assign(Object.create(null), input());

    for (const candidate of [
      withSymbol,
      withHidden,
      withForbidden,
      nullPrototype,
    ]) {
      expect(() =>
        evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralMomentMap(
          candidate,
        ),
      ).toThrow();
    }
  });

  it("rejects roughly 20k-deep and 20k-wide hostile extras without traversal or stack failure", () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let depth = 0; depth < 20_000; depth += 1) deep = { next: deep };
    let nestedTrapCalls = 0;
    const trappedDeep = new Proxy(deep, {
      ownKeys() {
        nestedTrapCalls += 1;
        throw new Error("must not traverse nested hostile graph");
      },
    });
    const deepCandidate = { ...input(), extra: trappedDeep };

    let deepThrown: unknown;
    try {
      evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralMomentMap(
        deepCandidate,
      );
    } catch (error) {
      deepThrown = error;
    }
    expect(deepThrown).toBeInstanceOf(TypeError);
    expect(deepThrown).not.toBeInstanceOf(RangeError);
    expect((deepThrown as Error).message).toContain(
      "root_own_key_limit_exceeded",
    );
    expect(nestedTrapCalls).toBe(0);

    let fieldReads = 0;
    const wide = Object.create(Object.prototype) as Record<string, unknown>;
    Object.defineProperty(wide, "evenMonomialValuesInFrozenOrder", {
      enumerable: true,
      get() {
        fieldReads += 1;
        return Array.from({ length: 22 }, () => 0);
      },
    });
    wide.leftSampleOrdinal = 0;
    wide.rightSampleOrdinal = 0;
    for (let index = 0; index < 20_000; index += 1) {
      wide[`extra_${index}`] = index;
    }
    expect(() =>
      evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralMomentMap(wide),
    ).toThrow("root_own_key_limit_exceeded");
    expect(fieldReads).toBe(0);
  });

  it("rejects wide, sparse, accessor, symbol, and side-property moment arrays", () => {
    const wide = Array.from({ length: 20_000 }, () => 0);
    const sparse = Array.from({ length: 22 }, () => 0);
    delete sparse[10];
    const withSide = Array.from({ length: 22 }, () => 0) as number[] & {
      side?: number;
    };
    withSide.side = 1;
    const withSymbol = Array.from({ length: 22 }, () => 0) as number[] & {
      [key: symbol]: number;
    };
    withSymbol[Symbol("forbidden")] = 1;

    for (const candidate of [wide, sparse, withSide, withSymbol]) {
      expect(() =>
        evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralMomentMap(
          input(candidate),
        ),
      ).toThrow();
    }
  });

  it("aborts on nonfinite derived application values and canonicalizes zero", () => {
    const huge = Array.from({ length: 22 }, () => Number.MAX_VALUE);
    expect(() =>
      evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralMomentMap(
        input(huge),
      ),
    ).toThrow("nonfinite_derived_value");

    const zero =
      evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralMomentMap(
        input(Array.from({ length: 22 }, () => 0)),
      );
    const numericValues = [
      ...zero.parityProjectedS2Pi.valuesInFrozenComponentPairOrder,
      ...zero.positiveFrequencySpectralDensity.valuesInFrozenComponentPairOrder,
    ];
    expect(numericValues.every((value) => value === 0)).toBe(true);
    expect(numericValues.some((value) => Object.is(value, -0))).toBe(false);
  });

  it("is byte deterministic and exports no full-array writer, receipt, lever, or authority override", async () => {
    const first =
      evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralMomentMap(
        input(powers([3, 0.25, -0.5, 0.75]), 19, 23),
      );
    const second =
      evaluateNhm2ConformallyFlatNeedleConnectedNoiseSpectralMomentMap(
        input(powers([3, 0.25, -0.5, 0.75]), 19, 23),
      );
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));

    const module =
      await import("../nhm2-conformally-flat-needle-connected-noise-spectral-moment-map");
    const exportNames = Object.keys(module);
    expect(
      exportNames.some((name) =>
        /(fullArray|writer|receipt|lever|authorityOverride|toleranceOverride|workOverride)/i.test(
          name,
        ),
      ),
    ).toBe(false);
  });
});
