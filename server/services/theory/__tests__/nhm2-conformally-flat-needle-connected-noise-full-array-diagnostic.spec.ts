import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  Nhm2ConnectedNoiseFullArrayDiagnosticError,
  NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_FULL_ARRAY_DIAGNOSTIC_SCHEMA_VERSION,
  runNhm2ConformallyFlatNeedleConnectedNoiseFullArrayDiagnostic,
} from "../nhm2-conformally-flat-needle-connected-noise-full-array-diagnostic";
import { NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_SPECTRAL_MOMENT_MAP_WORKER_DESCRIPTOR } from "../nhm2-conformally-flat-needle-connected-noise-spectral-moment-map";

const RAW_ARRAY_BYTES = 3_276_800;
const GOLDEN = Object.freeze({
  central: "9289b8348ced09647719fe43f634b6ba76adbc357ce88d255bb96fe095e24d54",
  refinement_observation:
    "59b9c9e7f1d298d15afee9f762f339090275cae500a161b2c3f2ed7de36b56da",
  cutoff_observation:
    "a44995adf1a8d77f6c609fb13d8c17cc1479ad7490b890a0c6b61901fe23589a",
});

const valueAt = (
  bytes: Buffer,
  left: number,
  right: number,
  pair: number,
): number => bytes.readDoubleLE(((left * 64 + right) * 100 + pair) * 8);

describe("NHM2 connected-noise full-array diagnostic", () => {
  it("exposes a strict zero-argument boundary and rejects extras before execution", async () => {
    expect(
      runNhm2ConformallyFlatNeedleConnectedNoiseFullArrayDiagnostic,
    ).toHaveLength(0);
    const unsafe =
      runNhm2ConformallyFlatNeedleConnectedNoiseFullArrayDiagnostic as unknown as (
        ...args: unknown[]
      ) => Promise<unknown>;
    for (const candidate of [
      1,
      {},
      { work: 1 },
      { tolerance: 1e-6 },
      { outputPath: "forbidden.bin" },
      { declaredLeverTensor: [] },
      { metricOverride: {} },
      { authorityOverride: true },
    ]) {
      await expect(unsafe(candidate)).rejects.toMatchObject({
        name: "Nhm2ConnectedNoiseFullArrayDiagnosticError",
        code: "public_api_accepts_no_input",
      });
    }
  });

  it("executes the frozen 2^18 plan twice and emits deterministic full raw arrays", async () => {
    const first =
      await runNhm2ConformallyFlatNeedleConnectedNoiseFullArrayDiagnostic();
    const second =
      await runNhm2ConformallyFlatNeedleConnectedNoiseFullArrayDiagnostic();

    expect(first.schemaVersion).toBe(
      NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_FULL_ARRAY_DIAGNOSTIC_SCHEMA_VERSION,
    );
    expect(first.status).toBe(
      "diagnostic_full_shape_central_and_observations_produced_not_enclosed",
    );
    expect(first.repositoryCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(first.process).toMatchObject({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stderrBytes: 0,
    });
    expect(first.process.args).toHaveLength(1);
    expect(first.process.durationNanoseconds).toBeGreaterThan(0);
    expect(first.process.stdoutBytes).toBeGreaterThan(9_830_408);
    expect(first.process.stdoutBytes).toBeLessThanOrEqual(9_830_408 + 65_536);
    expect(first.workerMetadata.numericalObservations).toMatchObject({
      arithmetic: "ieee754_binary64",
      sobol: "contract_owned_unscrambled_uint32_gray_code_recurrence",
      coarsePointCount: 131_072,
      finePointCount: 262_144,
      primaryUpperCutoffDimensionless: 128,
      comparisonUpperCutoffDimensionless: 256,
    });
    for (const source of Object.values(first.sources)) {
      expect(source.absolutePath).toMatch(/^[A-Za-z]:\\|^\//);
      expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(source.sizeBytes).toBeGreaterThan(0);
    }
    expect(first.sources.worker.sha256).toBe(
      "99e8735030e8e177e2340b1b808d44635763c755c7fcb7b7e2c62a9b5de072e5",
    );
    expect(first.sources.worker.sizeBytes).toBe(38_389);
    const runtime = first.workerMetadata.runtime as Record<string, unknown>;
    expect(runtime).toMatchObject({
      implementation: "CPython",
      pythonVersion: "3.13.7",
      numpyVersion: "2.2.6",
      scipyVersion: "1.16.1",
      peakResidentBytesObserved: expect.any(Number),
      maximumResidentBytes: 268_435_456,
    });
    expect(runtime.peakResidentBytesObserved as number).toBeLessThanOrEqual(
      268_435_456,
    );

    expect(first.outputs.map(({ id }) => id)).toEqual([
      "central",
      "refinement_observation",
      "cutoff_observation",
    ]);
    for (let ordinal = 0; ordinal < first.outputs.length; ordinal += 1) {
      const observed = first.outputs[ordinal];
      const repeated = second.outputs[ordinal];
      expect(observed.shape).toEqual([64, 64, 100]);
      expect(observed.elementRepresentation).toBe(
        "ieee754_binary64_little_endian",
      );
      expect(observed.sizeBytes).toBe(RAW_ARRAY_BYTES);
      expect(observed.rawBytes).toHaveLength(RAW_ARRAY_BYTES);
      expect(observed.freshness).toBe("new_process_stdout_bytes");
      expect(createHash("sha256").update(observed.rawBytes).digest("hex")).toBe(
        observed.sha256,
      );
      expect(observed.sha256).toBe(GOLDEN[observed.id]);
      expect(repeated.sha256).toBe(observed.sha256);
      expect(repeated.rawBytes.equals(observed.rawBytes)).toBe(true);
    }
  }, 60_000);

  it("independently checks canonical f64 values, parity zeros, and pair symmetry", async () => {
    const result =
      await runNhm2ConformallyFlatNeedleConnectedNoiseFullArrayDiagnostic();
    const central = result.outputs[0].rawBytes;
    for (let offset = 0; offset < central.byteLength; offset += 8) {
      const value = central.readDoubleLE(offset);
      expect(Number.isFinite(value)).toBe(true);
      expect(Object.is(value, -0)).toBe(false);
    }
    for (let left = 0; left < 64; left += 1) {
      for (let right = 0; right < 64; right += 1) {
        for (const pair of NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_SPECTRAL_MOMENT_MAP_WORKER_DESCRIPTOR.parityProjectedZeroPairOrdinals) {
          expect(valueAt(central, left, right, pair)).toBe(0);
        }
        for (let pair = 0; pair < 100; pair += 1) {
          const exchanged =
            NHM2_CONFORMALLY_FLAT_NEEDLE_CONNECTED_NOISE_SPECTRAL_MOMENT_MAP_WORKER_DESCRIPTOR
              .exchangeComponentPairOrdinals[pair];
          expect(valueAt(central, left, right, pair)).toBe(
            valueAt(central, right, left, exchanged),
          );
        }
      }
    }
  }, 30_000);

  it("keeps uncertainty, run feed, lamps, constraints, and physical claims locked", async () => {
    const result =
      await runNhm2ConformallyFlatNeedleConnectedNoiseFullArrayDiagnostic();
    expect(result.diagnosticOnly).toBe(true);
    expect(result.deterministicEnclosure).toBeNull();
    expect(result.simultaneousAbsoluteUncertainty95).toBeNull();
    expect(result.tailEnclosure).toBeNull();
    expect(result.mayFeedFixedBackgroundRun).toBe(false);
    expect(
      Object.values(result.authority).every((value) => value === false),
    ).toBe(true);
    expect(
      Object.values(result.claimLocks).every((value) => value === false),
    ).toBe(true);
    expect(result.outputs[0].status).toBe(
      "diagnostic_binary64_truncated_not_enclosed",
    );
    expect(result.outputs[1].status).toBe(
      "diagnostic_binary64_refinement_observation_not_an_error_bound",
    );
    expect(result.outputs[2].status).toBe(
      "diagnostic_binary64_cutoff_observation_not_a_tail_enclosure",
    );
  }, 30_000);

  it("uses a typed diagnostic error without an authority-bearing result", () => {
    const failure = new Nhm2ConnectedNoiseFullArrayDiagnosticError("fixture");
    expect(failure).toBeInstanceOf(Error);
    expect(failure.name).toBe("Nhm2ConnectedNoiseFullArrayDiagnosticError");
    expect(failure.code).toBe("fixture");
  });
});
