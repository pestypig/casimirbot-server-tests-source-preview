import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_CLAIM_LOCKS,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_CONFIGURATION_SHA256,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_EXPECTED_ROUTE_ID,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_GEOMETRY,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_SAMPLE_POINTS,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_SEMANTIC_LIMITS,
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_SIZE_BYTES,
  hasValidNhm2SemiclassicalV2MetricDemandProducerReceiptIntegrity,
} from "../../../../shared/contracts/nhm2-semiclassical-v2-metric-demand-producer.v1";
import {
  Nhm2SemiclassicalV2MetricDemandProducerError,
  encodeNhm2SemiclassicalV2MetricDemandSamples,
  produceNhm2SemiclassicalV2MetricDemand,
  type Nhm2SemiclassicalV2MetricDemandEvaluatedSampleV1,
} from "../nhm2-semiclassical-v2-metric-demand-producer";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (root) => {
      const resolved = path.resolve(root);
      if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
        throw new Error(`refusing to remove non-temporary path: ${resolved}`);
      }
      await fs.rm(resolved, { recursive: true, force: true });
    }),
  );
});

const tempParent = async (): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nhm2-metric-demand-"));
  temporaryRoots.push(root);
  return root;
};

const validSamples = (): Nhm2SemiclassicalV2MetricDemandEvaluatedSampleV1[] =>
  NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_SAMPLE_POINTS.map((pointM, index) => ({
    pointM,
    routeId: NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_EXPECTED_ROUTE_ID,
    modelTermAdmission: "experimental_not_admitted",
    components: [index + 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  }));

const expectProducerCode = (
  action: () => unknown,
  code: Nhm2SemiclassicalV2MetricDemandProducerError["code"],
): void => {
  try {
    action();
    throw new Error("expected producer error");
  } catch (error) {
    expect(error).toBeInstanceOf(Nhm2SemiclassicalV2MetricDemandProducerError);
    expect((error as Nhm2SemiclassicalV2MetricDemandProducerError).code).toBe(code);
  }
};

describe("NHM2 semiclassical-v2 metric-demand producer", () => {
  it("freezes one exact 4x4x4 geometry-only sample lattice", () => {
    expect(NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_SAMPLE_POINTS).toHaveLength(64);
    expect(NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_SAMPLE_POINTS[0]).toEqual([
      -0.125, -0.125, -0.125,
    ]);
    expect(NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_SAMPLE_POINTS[1]).toEqual([
      -0.05, -0.125, -0.125,
    ]);
    expect(NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_SAMPLE_POINTS[63]).toEqual([
      0.125, 0.125, 0.125,
    ]);
    expect(NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_GEOMETRY).toMatchObject({
      shiftLapseProfileId: "stage1_centerline_alpha_0p995_v1",
      alphaCenterline: 0.995,
      bubbleRadiusM: 0.25,
      epsilonTilt: 1e-15,
      betaTiltVec: [0, -1, 0],
      shiftAmplitude: 0,
    });
    expect(NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_SEMANTIC_LIMITS).toMatchObject({
      lapseConsumedByPointKernel: false,
      lapseSensitivityEstablished: false,
      fullEinsteinTensorEstablished: false,
      coordinateCovariantTensorEstablished: false,
      zeroExpansionProjectionEstablished: false,
      modelTermAdmission: "experimental_not_admitted",
      sourceTensorUsed: false,
      declaredLeverTensorUsed: false,
    });
    expect(Object.values(NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_CLAIM_LOCKS)).toEqual(
      expect.arrayContaining([false]),
    );
    expect(
      Object.values(NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_CLAIM_LOCKS).every(
        (value) => value === false,
      ),
    ).toBe(true);
  });

  it("encodes exactly 640 little-endian float64 values", () => {
    const encoded = encodeNhm2SemiclassicalV2MetricDemandSamples(validSamples());
    expect(encoded.bytes).toHaveLength(NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_SIZE_BYTES);
    expect(encoded.bytes.readDoubleLE(0)).toBe(1);
    expect(encoded.bytes.readDoubleLE(8 * 9)).toBe(10);
    expect(encoded.bytes.readDoubleLE(8 * 10)).toBe(2);
    expect(encoded.routeIds).toHaveLength(64);
    expect(encoded.modelTermAdmissions).toEqual(
      Array(64).fill("experimental_not_admitted"),
    );
    expect(encoded.minimumObservedFrobeniusSI).toBeGreaterThan(1e-12);
  });

  it("fails closed on route fallback, reordered points, nonfinite values, and degeneracy", () => {
    const routeMixed = validSamples();
    routeMixed[7] = { ...routeMixed[7], routeId: "einstein_tensor_geometry_fd4_v1" };
    expectProducerCode(
      () => encodeNhm2SemiclassicalV2MetricDemandSamples(routeMixed),
      "metric_route_mismatch",
    );

    const admissionMixed = validSamples();
    admissionMixed[8] = {
      ...admissionMixed[8],
      modelTermAdmission: "admitted",
    };
    expectProducerCode(
      () => encodeNhm2SemiclassicalV2MetricDemandSamples(admissionMixed),
      "metric_route_mismatch",
    );

    const reordered = validSamples();
    reordered[0] = { ...reordered[0], pointM: reordered[1].pointM };
    expectProducerCode(
      () => encodeNhm2SemiclassicalV2MetricDemandSamples(reordered),
      "metric_component_invalid",
    );

    const nonfinite = validSamples();
    nonfinite[9] = {
      ...nonfinite[9],
      components: [Number.NaN, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    };
    expectProducerCode(
      () => encodeNhm2SemiclassicalV2MetricDemandSamples(nonfinite),
      "metric_component_invalid",
    );

    const degenerate = validSamples();
    degenerate[11] = { ...degenerate[11], components: Array(10).fill(0) };
    expectProducerCode(
      () => encodeNhm2SemiclassicalV2MetricDemandSamples(degenerate),
      "metric_demand_degenerate",
    );
  });

  it("exclusively writes, securely rereads, and integrity-binds one diagnostic file", async () => {
    const parent = await tempParent();
    const clockValues = [
      new Date("2026-08-10T15:00:00.000Z"),
      new Date("2026-08-10T15:00:01.000Z"),
    ];
    const result = await produceNhm2SemiclassicalV2MetricDemand({
      outputParentDirectory: parent,
      now: () => clockValues.shift()!,
    });
    const bytes = await fs.readFile(result.receipt.output.absolutePath);

    expect(bytes).toHaveLength(NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_SIZE_BYTES);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      result.receipt.output.sha256,
    );
    expect(result.receipt.configurationSha256).toBe(
      NHM2_SEMICLASSICAL_V2_METRIC_DEMAND_CONFIGURATION_SHA256,
    );
    expect(result.receipt.output).toMatchObject({
      prestate: "absent_observed_before_create",
      creation: "directory_and_file_created_exclusively",
      freshness: "new",
      secureReadbackVerified: true,
      exactFloat64RoundTripVerified: true,
      shape: [64, 10],
    });
    expect(result.receipt.execution).toMatchObject({
      startedAt: "2026-08-10T15:00:00.000Z",
      completedAt: "2026-08-10T15:00:01.000Z",
      gitSha: null,
      command: null,
      argv: null,
      implementationSourceSha256: null,
      evaluatorSourceSha256: null,
      runProvenanceState: "partial_server_observation",
    });
    expect(result.receipt.execution.provenanceBlockers).toEqual([
      "git_sha_not_observed",
      "service_command_not_bound",
      "implementation_source_hash_not_observed",
      "evaluator_source_hash_not_observed",
    ]);
    expect(result.receipt.provenance).toMatchObject({
      inputMode: "frozen_geometry_only",
      sourceTensorInputsAccepted: false,
      sourceTensorRead: false,
      declaredLeverTensorRead: false,
      quantumStateRead: false,
      routeFallbackObserved: false,
    });
    expect(result.receipt.provenance.routeIdBySample).toHaveLength(64);
    expect(result.receipt.provenance.modelTermAdmissionBySample).toEqual(
      Array(64).fill("experimental_not_admitted"),
    );
    expect(result.receipt.nondegeneracy.observedNondegenerateSampleCount).toBe(64);
    expect(result.receipt.nondegeneracy.minimumObservedFrobeniusSI).toBeGreaterThan(
      1e-12,
    );
    expect(
      hasValidNhm2SemiclassicalV2MetricDemandProducerReceiptIntegrity(
        result.receipt,
      ),
    ).toBe(true);
    expect(Object.isFrozen(result.receipt)).toBe(true);
    expect(Object.isFrozen(result.receipt.configuration.samplePointsM)).toBe(true);

    await expect(
      produceNhm2SemiclassicalV2MetricDemand({
        outputParentDirectory: parent,
      }),
    ).rejects.toMatchObject({ code: "output_directory_exists" });
  });

  it("detects receipt mutation even when a caller clones the immutable result", async () => {
    const parent = await tempParent();
    const clockValues = [
      new Date("2026-08-10T16:00:00.000Z"),
      new Date("2026-08-10T16:00:01.000Z"),
    ];
    const result = await produceNhm2SemiclassicalV2MetricDemand({
      outputParentDirectory: parent,
      now: () => clockValues.shift()!,
    });
    const forged = structuredClone(result.receipt);
    (forged as any).semanticLimits.lapseSensitivityEstablished = true;
    expect(
      hasValidNhm2SemiclassicalV2MetricDemandProducerReceiptIntegrity(forged),
    ).toBe(false);
  });
});
