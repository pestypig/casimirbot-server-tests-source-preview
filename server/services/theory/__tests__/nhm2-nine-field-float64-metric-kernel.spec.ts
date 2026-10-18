import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { NHM2_INDEPENDENT_FIELD_ARRAY_MANIFEST_REQUIRED_FIELDS } from "../../../../shared/contracts/nhm2-independent-field-array-manifest.v1";
import {
  NHM2_NINE_FIELD_FLOAT64_METRIC_KERNEL_POLICY,
  NHM2_NINE_FIELD_FLOAT64_METRIC_KERNEL_TECHNICAL_ZERO_SCALE,
  computeNhm2NineFieldFloat64Metrics,
  type Nhm2NineFieldFloat64MetricKernelInputV1,
} from "../nhm2-nine-field-float64-metric-kernel";

type ValueFactory = (
  fieldIndex: number,
  rowIndex: number,
  componentIndex: number,
) => number;

const sha256 = (value: Buffer | string): string =>
  createHash("sha256").update(value).digest("hex");

const float64Buffer = (
  rows: number,
  components: number,
  fieldIndex: number,
  value: ValueFactory,
): Buffer => {
  const buffer = Buffer.alloc(rows * components * 8);
  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    for (
      let componentIndex = 0;
      componentIndex < components;
      componentIndex += 1
    ) {
      const elementIndex = rowIndex * components + componentIndex;
      buffer.writeDoubleLE(
        value(fieldIndex, rowIndex, componentIndex),
        elementIndex * 8,
      );
    }
  }
  return buffer;
};

const buildInput = (
  primaryValue: ValueFactory = () => 100,
  independentValue: ValueFactory = primaryValue,
): Nhm2NineFieldFloat64MetricKernelInputV1 => ({
  policy: NHM2_NINE_FIELD_FLOAT64_METRIC_KERNEL_POLICY,
  fields: NHM2_NINE_FIELD_FLOAT64_METRIC_KERNEL_POLICY.fields.map(
    (field, fieldIndex) => {
      const rows = field.minimumRows;
      const components = field.componentOrder.length;
      const primary = float64Buffer(rows, components, fieldIndex, primaryValue);
      const independent = float64Buffer(
        rows,
        components,
        fieldIndex,
        independentValue,
      );
      const orderedRowsSha256 = sha256(
        `nhm2-nine-field-ordered-rows/v1\n${field.fieldId}`,
      );
      return {
        fieldId: field.fieldId,
        componentOrder: [...field.componentOrder],
        componentUnits: [...field.componentUnits],
        primarySha256: sha256(primary),
        independentSha256: sha256(independent),
        primaryOrderedRowsSha256: orderedRowsSha256,
        independentOrderedRowsSha256: orderedRowsSha256,
        dtype: "float64" as const,
        encoding: "raw_ieee754" as const,
        endianness: "little" as const,
        shape: [rows, components] as [number, number],
        storageOrder: "row-major" as const,
        primary,
        independent,
      };
    },
  ),
});

const writeValue = (
  input: Nhm2NineFieldFloat64MetricKernelInputV1,
  fieldIndex: number,
  rowIndex: number,
  componentIndex: number,
  side: "primary" | "independent",
  value: number,
): void => {
  const field = input.fields[fieldIndex];
  const byteOffset =
    (rowIndex * field.shape[1] + componentIndex) *
    Float64Array.BYTES_PER_ELEMENT;
  field[side].writeDoubleLE(value, byteOffset);
  field[`${side}Sha256`] = sha256(field[side]);
};

const expectNotReady = (input: unknown, blockerFragment: string): void => {
  const result = computeNhm2NineFieldFloat64Metrics(input);
  expect(result.status).toBe("not_ready");
  expect(result.calculationOnly).toBe(true);
  expect(result.claimAuthority).toBe(false);
  expect(result.fields).toEqual([]);
  expect(result.overallMaximumRelativeLInf).toBeNull();
  expect(result.blockers.some((entry) => entry.includes(blockerFragment))).toBe(
    true,
  );
  expect(
    Object.values(result.claimLocks).every((value) => value === false),
  ).toBe(true);
};

const containsNegativeZero = (value: unknown): boolean => {
  if (typeof value === "number") return Object.is(value, -0);
  if (Array.isArray(value)) return value.some(containsNegativeZero);
  if (value != null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(
      containsNegativeZero,
    );
  }
  return false;
};

type BufferPosition = "first" | "middle" | "last";
type BufferSide = "primary" | "independent";
const NON_FINITE_VALUES: ReadonlyArray<readonly [string, number]> = [
  ["NaN", Number.NaN],
  ["positive infinity", Number.POSITIVE_INFINITY],
  ["negative infinity", Number.NEGATIVE_INFINITY],
];
const NON_FINITE_CASES: Array<
  readonly [string, number, BufferPosition, BufferSide]
> = NON_FINITE_VALUES.flatMap(([label, value]) =>
  (["first", "middle", "last"] as const).flatMap((position) =>
    (["primary", "independent"] as const).map(
      (side) => [label, value, position, side] as const,
    ),
  ),
);

describe("NHM2 nine-field float64 metric kernel", () => {
  it("replays all nine identical little-endian row-major arrays as a calculation-only pass", () => {
    const input = buildInput(
      (fieldIndex, rowIndex, componentIndex) =>
        1 + fieldIndex + rowIndex / 100 + componentIndex / 10,
    );

    const result = computeNhm2NineFieldFloat64Metrics(input);

    expect(result.status).toBe("pass");
    expect(result.fields).toHaveLength(9);
    expect(result.overallMaximumRelativeLInf).toBe(0);
    expect(result.overallArgmax).toMatchObject({
      fieldIndex: 0,
      rowIndex: 0,
      componentIndex: 0,
      primaryValue: 1,
      independentValue: 1,
    });
    expect(result.calculationOnly).toBe(true);
    expect(result.claimAuthority).toBe(false);
    expect(result.blockers).toEqual([]);
    expect(
      Object.values(result.claimLocks).every((value) => value === false),
    ).toBe(true);
    for (const [fieldIndex, field] of result.fields.entries()) {
      expect(field.inputBindings).toEqual({
        primarySha256: input.fields[fieldIndex].primarySha256,
        independentSha256: input.fields[fieldIndex].independentSha256,
        primaryOrderedRowsSha256:
          input.fields[fieldIndex].primaryOrderedRowsSha256,
        independentOrderedRowsSha256:
          input.fields[fieldIndex].independentOrderedRowsSha256,
        bufferHashesRecomputedAndMatched: true,
        orderedRowsHashesMatch: true,
        sharedArrayBufferBacked: false,
      });
      expect(
        field.components.every(
          (component) => component.ratioOverflowed === false,
        ),
      ).toBe(true);
    }
  });

  it("keeps the startup policy aligned to every independent field binding", () => {
    expect(NHM2_NINE_FIELD_FLOAT64_METRIC_KERNEL_POLICY.fields).toHaveLength(9);
    for (const [
      fieldIndex,
      field,
    ] of NHM2_NINE_FIELD_FLOAT64_METRIC_KERNEL_POLICY.fields.entries()) {
      const independent =
        NHM2_INDEPENDENT_FIELD_ARRAY_MANIFEST_REQUIRED_FIELDS[fieldIndex];
      expect(field).toMatchObject({
        fieldIndex,
        fieldId: independent.fieldId,
        componentOrder: independent.componentOrder,
        componentUnits: independent.componentUnits,
        minimumRows: independent.minimumSampleCount,
      });
      expect(field.components).toEqual(
        independent.componentOrder.map((componentId, componentIndex) => ({
          componentIndex,
          componentId,
          unit: independent.componentUnits[componentIndex],
          authoritativeZeroScale: Number.MIN_VALUE,
        })),
      );
    }
  });

  it("passes exactly at the frozen 0.1 tolerance and fails robustly above it", () => {
    const atTolerance = buildInput();
    writeValue(atTolerance, 0, 5, 2, "independent", 110);
    const atResult = computeNhm2NineFieldFloat64Metrics(atTolerance);
    expect(atResult.status).toBe("pass");
    expect(atResult.overallMaximumRelativeLInf).toBe(0.1);
    expect(atResult.overallArgmax).toMatchObject({
      fieldIndex: 0,
      rowIndex: 5,
      componentIndex: 2,
      primaryValue: 100,
      independentValue: 110,
    });

    const overTolerance = buildInput();
    writeValue(overTolerance, 0, 5, 2, "independent", 111);
    const overResult = computeNhm2NineFieldFloat64Metrics(overTolerance);
    expect(overResult.status).toBe("fail");
    expect(overResult.overallMaximumRelativeLInf).toBe(0.11);
  });

  it("uses an L-infinity outlier instead of an average", () => {
    const input = buildInput();
    writeValue(input, 0, input.fields[0].shape[0] - 1, 9, "independent", 200);

    const result = computeNhm2NineFieldFloat64Metrics(input);

    expect(result.status).toBe("fail");
    expect(result.fields[0].components[9].relativeLInf).toBe(1);
    expect(result.fields[0].components[9].maxAbsDifference).toBe(100);
  });

  it("computes denominators componentwise so mixed units cannot mask a discrepancy", () => {
    const input = buildInput(() => 1);
    const mechanicalFieldIndex = 7;
    const rows = input.fields[mechanicalFieldIndex].shape[0];
    for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
      writeValue(input, mechanicalFieldIndex, rowIndex, 1, "primary", 1e12);
      writeValue(input, mechanicalFieldIndex, rowIndex, 1, "independent", 1e12);
    }
    writeValue(input, mechanicalFieldIndex, 3, 0, "independent", 1.2);

    const result = computeNhm2NineFieldFloat64Metrics(input);
    const mechanical = result.fields[mechanicalFieldIndex];

    expect(result.status).toBe("fail");
    expect(mechanical.components[0]).toMatchObject({
      unit: "m",
      primaryMaxAbs: 1,
      independentMaxAbs: 1.2,
      denominator: 1,
      relativeLInf: expect.closeTo(0.2, 12),
    });
    expect(mechanical.components[1]).toMatchObject({
      unit: "Pa",
      primaryMaxAbs: 1e12,
      denominator: 1e12,
      relativeLInf: 0,
    });
  });

  it("uses only Number.MIN_VALUE for an all-zero primary component", () => {
    const identicalZeros = buildInput(() => 0);
    const identicalResult = computeNhm2NineFieldFloat64Metrics(identicalZeros);
    expect(identicalResult.status).toBe("pass");
    expect(identicalResult.fields[0].components[0].denominator).toBe(
      Number.MIN_VALUE,
    );
    expect(identicalResult.fields[0].components[0].relativeLInf).toBe(0);

    const nonzeroIndependent = buildInput(() => 0);
    writeValue(nonzeroIndependent, 0, 0, 0, "independent", Number.MIN_VALUE);
    const nonzeroResult =
      computeNhm2NineFieldFloat64Metrics(nonzeroIndependent);
    expect(nonzeroResult.status).toBe("fail");
    expect(nonzeroResult.fields[0].components[0]).toMatchObject({
      authoritativeZeroScale: Number.MIN_VALUE,
      denominator: Number.MIN_VALUE,
      maxAbsDifference: Number.MIN_VALUE,
      relativeLInf: 1,
      ratioOverflowed: false,
    });

    const ordinaryFiniteMismatch = buildInput(() => 0);
    writeValue(ordinaryFiniteMismatch, 0, 0, 0, "independent", 1);
    const ordinaryResult = computeNhm2NineFieldFloat64Metrics(
      ordinaryFiniteMismatch,
    );
    expect(ordinaryResult.status).toBe("fail");
    expect(ordinaryResult.blockers).toEqual([]);
    expect(ordinaryResult.fields).toHaveLength(9);
    expect(ordinaryResult.fields[0].components[0]).toMatchObject({
      denominator: Number.MIN_VALUE,
      maxAbsDifference: 1,
      relativeLInf: Number.MAX_VALUE,
      ratioOverflowed: true,
    });
  });

  it("canonicalizes every emitted negative zero to positive zero", () => {
    const input = buildInput(
      () => -0,
      () => -0,
    );

    const result = computeNhm2NineFieldFloat64Metrics(input);

    expect(result.status).toBe("pass");
    expect(containsNegativeZero(result)).toBe(false);
    expect(result.fields[0].components[0].argmax).toMatchObject({
      primaryValue: 0,
      independentValue: 0,
    });
    expect(
      Object.is(result.fields[0].components[0].argmax.primaryValue, -0),
    ).toBe(false);
  });

  it("exports a deeply frozen server policy and rejects a producer-cloned huge floor", () => {
    expect(NHM2_NINE_FIELD_FLOAT64_METRIC_KERNEL_TECHNICAL_ZERO_SCALE).toBe(
      Number.MIN_VALUE,
    );
    expect(NHM2_NINE_FIELD_FLOAT64_METRIC_KERNEL_POLICY.tolerance).toBe(0.1);
    expect(Object.isFrozen(NHM2_NINE_FIELD_FLOAT64_METRIC_KERNEL_POLICY)).toBe(
      true,
    );
    expect(
      Object.isFrozen(
        NHM2_NINE_FIELD_FLOAT64_METRIC_KERNEL_POLICY.fields[0].components[0],
      ),
    ).toBe(true);
    expect(
      NHM2_NINE_FIELD_FLOAT64_METRIC_KERNEL_POLICY.fields.every((field) =>
        field.components.every(
          (component) => component.authoritativeZeroScale === Number.MIN_VALUE,
        ),
      ),
    ).toBe(true);
    expect(() => {
      const component = NHM2_NINE_FIELD_FLOAT64_METRIC_KERNEL_POLICY.fields[0]
        .components[0] as unknown as { authoritativeZeroScale: number };
      component.authoritativeZeroScale = Number.MAX_VALUE;
    }).toThrow(TypeError);

    const clonedPolicy = structuredClone(
      NHM2_NINE_FIELD_FLOAT64_METRIC_KERNEL_POLICY,
    ) as unknown as {
      fields: Array<{
        components: Array<{ authoritativeZeroScale: number }>;
      }>;
    };
    clonedPolicy.fields[0].components[0].authoritativeZeroScale =
      Number.MAX_VALUE;
    const untrusted = buildInput() as unknown as {
      policy: unknown;
      fields: unknown[];
    };
    untrusted.policy = clonedPolicy;

    expectNotReady(untrusted, "server_owned_immutable_exact_policy_required");
  });

  it.each([
    ["dtype", "float32", "float64_dtype_required"],
    ["encoding", "base64", "raw_ieee754_encoding_required"],
    ["endianness", "big", "little_endian_required"],
    ["storageOrder", "column-major", "row_major_storage_required"],
  ])("rejects wrong %s metadata", (key, value, blocker) => {
    const input = buildInput();
    const field = input.fields[0] as unknown as Record<string, unknown>;
    field[key] = value;
    expectNotReady(input, blocker);
  });

  it("rejects wrong component order and component units", () => {
    const wrongOrder = buildInput();
    wrongOrder.fields[0].componentOrder.reverse();
    expectNotReady(wrongOrder, "component_order_invalid");

    const wrongUnits = buildInput();
    wrongUnits.fields[7].componentUnits[0] = "Pa";
    expectNotReady(wrongUnits, "component_units_invalid");
  });

  it("rejects invalid shapes, minimum rows, and exact byte-length mismatches", () => {
    const wrongColumns = buildInput();
    wrongColumns.fields[0].shape[1] -= 1;
    expectNotReady(wrongColumns, "shape_or_minimum_rows_invalid");

    const tooFewRows = buildInput();
    tooFewRows.fields[0].shape[0] =
      NHM2_NINE_FIELD_FLOAT64_METRIC_KERNEL_POLICY.fields[0].minimumRows - 1;
    expectNotReady(tooFewRows, "shape_or_minimum_rows_invalid");

    const wrongPrimaryBytes = buildInput();
    wrongPrimaryBytes.fields[0].primary =
      wrongPrimaryBytes.fields[0].primary.subarray(0, -8);
    expectNotReady(wrongPrimaryBytes, "primary_byte_length_mismatch");

    const wrongIndependentBytes = buildInput();
    wrongIndependentBytes.fields[0].independent = Buffer.concat([
      wrongIndependentBytes.fields[0].independent,
      Buffer.alloc(8),
    ]);
    expectNotReady(wrongIndependentBytes, "independent_byte_length_mismatch");
  });

  it.each(["primary", "independent"] as const)(
    "recomputes and rejects a mismatched %s Buffer SHA-256 binding",
    (side) => {
      const input = buildInput();
      input.fields[0][`${side}Sha256`] = "0".repeat(64);
      expectNotReady(input, `${side}_buffer_sha256_mismatch`);
    },
  );

  it("requires exact lowercase SHA-256 bindings and equal ordered-row hashes", () => {
    const invalidBufferHash = buildInput();
    invalidBufferHash.fields[0].primarySha256 = "A".repeat(64);
    expectNotReady(invalidBufferHash, "primary_sha256_invalid");

    const invalidOrderedRowsHash = buildInput();
    invalidOrderedRowsHash.fields[0].primaryOrderedRowsSha256 = "short";
    expectNotReady(
      invalidOrderedRowsHash,
      "primary_ordered_rows_sha256_invalid",
    );

    const mismatchedRows = buildInput();
    mismatchedRows.fields[0].independentOrderedRowsSha256 = sha256(
      "different-ordered-rows",
    );
    expectNotReady(mismatchedRows, "ordered_rows_sha256_mismatch");
  });

  it.each(["primary", "independent"] as const)(
    "rejects a %s Buffer backed by SharedArrayBuffer even with a matching hash",
    (side) => {
      const input = buildInput();
      const original = input.fields[0][side];
      const shared = Buffer.from(new SharedArrayBuffer(original.length));
      original.copy(shared);
      input.fields[0][side] = shared;
      input.fields[0][`${side}Sha256`] = sha256(shared);

      expectNotReady(input, `${side}_shared_array_buffer_forbidden`);
    },
  );

  it("requires exact root and field key sets", () => {
    const extraRoot = buildInput() as unknown as Record<string, unknown>;
    extraRoot.producerFloor = 1e100;
    expectNotReady(extraRoot, "metric_kernel_root_shape_invalid");

    const extraField = buildInput();
    const field = extraField.fields[0] as unknown as Record<string, unknown>;
    field.declaredPass = true;
    expectNotReady(extraField, "exact_field_shape_invalid");

    const missingBinding = buildInput();
    delete (missingBinding.fields[0] as unknown as Record<string, unknown>)
      .primaryOrderedRowsSha256;
    expectNotReady(missingBinding, "exact_field_shape_invalid");
  });

  it("requires exactly nine unique fields in frozen order", () => {
    const eight = buildInput();
    eight.fields.pop();
    expectNotReady(eight, "exact_nine_field_inventory_required");

    const ten = buildInput();
    ten.fields.push(ten.fields[0]);
    expectNotReady(ten, "exact_nine_field_inventory_required");

    const reordered = buildInput();
    [reordered.fields[0], reordered.fields[1]] = [
      reordered.fields[1],
      reordered.fields[0],
    ];
    expectNotReady(reordered, "field_id_or_order_invalid");

    const duplicate = buildInput();
    duplicate.fields[1] = duplicate.fields[0];
    expectNotReady(duplicate, "field_id_or_order_invalid");
  });

  it.each(NON_FINITE_CASES)(
    "rejects %s (%s) at the %s element of the %s buffer",
    (_label, value, position, side) => {
      const input = buildInput();
      const field = input.fields[0];
      const elementCount = field.shape[0] * field.shape[1];
      const elementIndex =
        position === "first"
          ? 0
          : position === "last"
            ? elementCount - 1
            : Math.floor(elementCount / 2);
      const rowIndex = Math.floor(elementIndex / field.shape[1]);
      const componentIndex = elementIndex % field.shape[1];
      writeValue(input, 0, rowIndex, componentIndex, side, value);

      expectNotReady(input, `${side}_non_finite`);
    },
  );

  it("rejects finite operands whose subtraction overflows", () => {
    const input = buildInput();
    writeValue(input, 0, 1, 0, "primary", -Number.MAX_VALUE);
    writeValue(input, 0, 1, 0, "independent", Number.MAX_VALUE);
    expectNotReady(input, "non_finite_subtraction");
  });

  it("represents a finite ratio overflow as a saturated numeric failure", () => {
    const input = buildInput(() => 0);
    writeValue(input, 0, 1, 0, "independent", Number.MAX_VALUE);
    const result = computeNhm2NineFieldFloat64Metrics(input);

    expect(result.status).toBe("fail");
    expect(result.blockers).toEqual([]);
    expect(result.fields[0].components[0]).toMatchObject({
      maxAbsDifference: Number.MAX_VALUE,
      denominator: Number.MIN_VALUE,
      relativeLInf: Number.MAX_VALUE,
      ratioOverflowed: true,
    });
  });

  it("selects the lowest row then component order for field argmax ties", () => {
    const input = buildInput();
    writeValue(input, 0, 5, 1, "independent", 120);
    writeValue(input, 0, 2, 7, "independent", 120);
    writeValue(input, 0, 2, 3, "independent", 120);
    writeValue(input, 0, 9, 3, "independent", 120);

    const result = computeNhm2NineFieldFloat64Metrics(input);

    expect(result.status).toBe("fail");
    expect(result.fields[0].argmax).toMatchObject({
      rowIndex: 2,
      componentIndex: 3,
      primaryValue: 100,
      independentValue: 120,
    });
    expect(result.fields[0].components[3].argmax.rowIndex).toBe(2);
  });

  it("uses frozen field order before row and component for overall exact ties", () => {
    const input = buildInput();
    writeValue(input, 0, 10, 4, "independent", 120);
    writeValue(input, 1, 0, 0, "independent", 120);

    const result = computeNhm2NineFieldFloat64Metrics(input);

    expect(result.overallArgmax).toMatchObject({
      fieldIndex: 0,
      rowIndex: 10,
      componentIndex: 4,
    });
  });
});
