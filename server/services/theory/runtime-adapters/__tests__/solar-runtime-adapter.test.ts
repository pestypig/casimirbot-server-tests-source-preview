import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isTheoryRuntimeMathTraceV1 } from "../../../../../shared/contracts/theory-runtime-math-trace.v1";
import { isTheoryRuntimeReceiptV1 } from "../../../../../shared/contracts/theory-runtime-receipt.v1";
import {
  readSolarArtifacts,
  solarRuntimeAdapter,
} from "../solar-runtime-adapter";

async function withTempRoot<T>(fn: (tempRoot: string) => Promise<T>): Promise<T> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "solar-adapter-"));
  try {
    return await fn(tempRoot);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function writeJson(tempRoot: string, relativePath: string, content: unknown): Promise<void> {
  const target = path.join(tempRoot, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(content, null, 2), "utf8");
}

function manifestFixture(overrides: Record<string, unknown> = {}) {
  return {
    lambda: 656.28e-9,
    lambda0: 656.28e-9,
    lambda_obs: 656.35e-9,
    T: 5772,
    R: 6.957e8,
    P_flare: 2e21,
    duration: 10,
    blackbodyFit: {
      effectiveTemperatureK: 5772,
      residualRms: 0.04,
    },
    calibration: {
      status: "calibrated",
      wavelengthSolution: "v1",
    },
    bandpass: {
      filterBand: "H-alpha",
      spectralWindow: "656nm",
    },
    lineIdentification: {
      line: "H-alpha",
      restLine: 656.28e-9,
    },
    ...overrides,
  };
}

describe("Solar runtime adapter", () => {
  it("parses a manifest fixture into a valid observation proxy receipt", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeJson(tempRoot, "artifacts/solar/solar-manifest.json", manifestFixture());

      const receipt = await readSolarArtifacts({ projectRoot: tempRoot });

      expect(isTheoryRuntimeReceiptV1(receipt)).toBe(true);
      expect(receipt.status).toBe("completed");
      expect(receipt.outputs.gates.observation_artifact_present).toBe("pass");
      expect(receipt.outputs.gates.calibration_present).toBe("pass");
      expect(receipt.outputs.gates.bandpass_present).toBe("pass");
      expect(receipt.outputs.gates.line_identification_present).toBe("pass");
      expect(receipt.outputs.gates.model_proxy_boundary).toBe("pass");
      expect(receipt.outputs.scalars.lambda).toBe(656.28e-9);
      expect(receipt.claimBoundary.promotionAllowed).toBe(false);
    });
  });

  it("blocks interpretation when calibration is missing", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeJson(tempRoot, "artifacts/solar/no-calibration.json", {
        lambda: 656.28e-9,
        lambda0: 656.28e-9,
        lambda_obs: 656.35e-9,
        bandpass: { filterBand: "H-alpha" },
        lineIdentification: { line: "H-alpha" },
      });

      const receipt = await readSolarArtifacts({ projectRoot: tempRoot });

      expect(receipt.status).toBe("blocked");
      expect(receipt.outputs.gates.calibration_present).toBe("not_ready");
      expect(receipt.outputs.missingSignals).toContain("calibration_missing");
      expect(receipt.outputs.warnings).toContain("Calibration context is missing.");
      expect(receipt.claimBoundary.promotionAllowed).toBe(false);
    });
  });

  it("generates scalar cuts for photon, Doppler, blackbody, and flare rows", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeJson(tempRoot, "artifacts/solar/solar-spectrum.json", manifestFixture());

      const receipt = await readSolarArtifacts({ projectRoot: tempRoot });

      expect(typeof receipt.outputs.scalars.E).toBe("number");
      expect(typeof receipt.outputs.scalars.f).toBe("number");
      expect(typeof receipt.outputs.scalars.v).toBe("number");
      expect(typeof receipt.outputs.scalars.lambda_max).toBe("number");
      expect(typeof receipt.outputs.scalars.L).toBe("number");
      expect(receipt.outputs.scalars.E_flare).toBe(2e22);
      expect(receipt.args.scalarCuts).toEqual(
        expect.arrayContaining([
          "E = h*c/lambda",
          "f = c/lambda",
          "v = c*(lambda_obs - lambda0)/lambda0",
          "lambda_max = b/T",
          "L = 4*pi*R^2*sigma*T^4",
          "E_flare = P_flare*duration",
        ]),
      );
    });
  });

  it("does not execute backend commands in artifact_reader mode", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeJson(tempRoot, "artifacts/solar/solar-manifest.json", manifestFixture());

      const receipt = await solarRuntimeAdapter.readArtifacts?.({ projectRoot: tempRoot });

      expect(receipt?.command).toBeNull();
      expect(receipt?.outputs.warnings).toContain(
        "Read-only Solar Spectrum artifact adapter; no backend runtime executed.",
      );
    });
  });

  it("returns not_run when no solar artifacts exist", async () => {
    await withTempRoot(async (tempRoot) => {
      const receipt = await readSolarArtifacts({ projectRoot: tempRoot });

      expect(receipt.status).toBe("not_run");
      expect(receipt.outputs.missingSignals).toContain("observation_artifact_missing");
      expect(receipt.claimBoundary.promotionAllowed).toBe(false);
    });
  });

  it("exposes static reference and optional quick runtime capabilities", () => {
    expect(solarRuntimeAdapter.runtimeId).toBe("solar_spectrum.artifact_reader");
    expect(solarRuntimeAdapter.laneId).toBe("solar_surface_spectrum");
    expect(solarRuntimeAdapter.capabilities).toEqual([
      "static_reference",
      "artifact_reader",
      "quick_runtime",
    ]);
    expect(solarRuntimeAdapter.runQuick).toBeDefined();

    const trace = solarRuntimeAdapter.buildReferenceTrace?.({
      graphId: "nhm2-theory-badge-graph",
      badgeIds: ["solar.spectrum.photon_energy"],
    });

    expect(isTheoryRuntimeMathTraceV1(trace)).toBe(true);
    expect(JSON.stringify(trace)).toContain("Static reference trace only; no backend runtime executed.");
  });
});
