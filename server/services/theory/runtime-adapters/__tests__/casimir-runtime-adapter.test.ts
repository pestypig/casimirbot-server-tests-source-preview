import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isTheoryRuntimeMathTraceV1 } from "../../../../../shared/contracts/theory-runtime-math-trace.v1";
import { isTheoryRuntimeReceiptV1 } from "../../../../../shared/contracts/theory-runtime-receipt.v1";
import {
  casimirRuntimeAdapter,
  readCasimirArtifacts,
} from "../casimir-runtime-adapter";

async function withTempRoot<T>(fn: (tempRoot: string) => Promise<T>): Promise<T> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "casimir-adapter-"));
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

async function writeJsonl(tempRoot: string, relativePath: string, rows: unknown[]): Promise<void> {
  const target = path.join(tempRoot, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    gap: 1e-9,
    E_area: -0.043,
    P_casimir: -0.129,
    E_tile: -1.2e-4,
    U_static: -2.5e-3,
    d_burst: 0.12,
    d_cycle: 0.12,
    N_concurrent: 2,
    N_sector: 80,
    gammaGeo: 4,
    Q_L: 1200,
    E_out: 8.99e-9,
    f_n: 1.5e10,
    materialModel: {
      status: "pass",
      material: "gold",
      conductivity: 4.1e7,
    },
    finiteTemperature: {
      status: "pass",
      temperatureK: 300,
    },
    telemetry: {
      freshness: "fresh",
    },
    ...overrides,
  };
}

describe("Casimir runtime adapter", () => {
  it("reads artifact fixtures into a valid diagnostic receipt", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeJson(tempRoot, "artifacts/casimir/casimir-summary.json", fixture());

      const receipt = await readCasimirArtifacts({ projectRoot: tempRoot });

      expect(isTheoryRuntimeReceiptV1(receipt)).toBe(true);
      expect(receipt.status).toBe("completed");
      expect(receipt.outputs.gates.artifact_present).toBe("pass");
      expect(receipt.outputs.gates.material_context_present).toBe("pass");
      expect(receipt.outputs.gates.finite_temperature_context_present).toBe("pass");
      expect(receipt.outputs.gates.nhm2_bridge_diagnostic_only).toBe("pass");
      expect(receipt.outputs.scalars.E_out).toBe(8.99e-9);
      expect(receipt.claimBoundary.promotionAllowed).toBe(false);
      expect(receipt.claimBoundary.maximumTier).toBe("diagnostic");
    });
  });

  it("adds a warning when material context is missing", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeJson(tempRoot, "artifacts/casimir/no-material.json", {
        E_out: 1,
        finiteTemperature: { temperatureK: 300 },
      });

      const receipt = await readCasimirArtifacts({ projectRoot: tempRoot });

      expect(receipt.status).toBe("completed");
      expect(receipt.outputs.gates.material_context_present).toBe("not_ready");
      expect(receipt.outputs.warnings).toContain("Material context is missing.");
      expect(receipt.claimBoundary.promotionAllowed).toBe(false);
    });
  });

  it("marks stale telemetry as stale with warning", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeJson(tempRoot, "artifacts/casimir/stale-telemetry.json", {
        E_out: 1,
        materialModel: { material: "gold" },
        finiteTemperature: { temperatureK: 300 },
        telemetry: { freshness: "stale" },
      });

      const receipt = await readCasimirArtifacts({ projectRoot: tempRoot });

      expect(receipt.status).toBe("stale");
      expect(receipt.outputs.gates.telemetry_fresh).toBe("fail");
      expect(receipt.outputs.warnings).toContain("Telemetry is stale.");
    });
  });

  it("parses training trace JSONL artifacts when present", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeJsonl(tempRoot, "artifacts/training-trace.jsonl", [
        {
          event: "casimir.verify",
          E_out: 2,
          materialContext: "gold",
          finiteTemperatureContext: "300K",
          telemetryFresh: true,
        },
      ]);

      const receipt = await readCasimirArtifacts({ projectRoot: tempRoot });

      expect(receipt.status).toBe("completed");
      expect(receipt.outputs.artifacts).toContain("artifacts/training-trace.jsonl");
      expect(receipt.outputs.scalars.E_out).toBe(2);
    });
  });

  it("generates scalar cuts from available energy fields", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeJson(tempRoot, "artifacts/casimir/scalars.json", fixture());

      const receipt = await readCasimirArtifacts({ projectRoot: tempRoot });

      expect(typeof receipt.outputs.scalars.M_proxy).toBe("number");
      expect(typeof receipt.outputs.scalars.f_mass_equiv).toBe("number");
      expect(typeof receipt.outputs.scalars.E_n).toBe("number");
      expect(receipt.outputs.scalars.d_eff).toBeCloseTo(0.00036);
      expect(receipt.args.scalarCuts).toEqual(
        expect.arrayContaining([
          "d_eff = d_burst*d_cycle*(N_concurrent/N_sector)",
          "M_proxy = E_out/c^2",
          "f_mass_equiv = M_proxy*c^2/h",
          "f_n = n*c/(2*L)",
          "E_n = h*f_n",
        ]),
      );
    });
  });

  it("keeps the NHM2 bridge diagnostic only and avoids overclaiming text", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeJson(tempRoot, "artifacts/casimir/diagnostic.json", fixture());

      const receipt = await readCasimirArtifacts({ projectRoot: tempRoot });

      expect(receipt.outputs.gates.nhm2_bridge_diagnostic_only).toBe("pass");
      expect(receipt.claimBoundary.promotionAllowed).toBe(false);
      expect(JSON.stringify(receipt)).not.toMatch(/validated propulsion|physical mechanism confirmed|proves propulsion/i);
    });
  });

  it("exposes static reference and quick runtime capabilities without running quick runtime in tests", () => {
    expect(casimirRuntimeAdapter.runtimeId).toBe("casimir.artifact_reader");
    expect(casimirRuntimeAdapter.laneId).toBe("casimir_cavity_modes");
    expect(casimirRuntimeAdapter.capabilities).toEqual([
      "static_reference",
      "artifact_reader",
      "quick_runtime",
    ]);
    expect(casimirRuntimeAdapter.supportedBadgeIds).toEqual(
      expect.arrayContaining([
        "casimir.tile.duty_budget",
        "casimir.material_receipts",
        "casimir.material.lifshitz_receipt",
        "casimir.geometry.beyond_pfa_validity",
      ]),
    );
    expect(casimirRuntimeAdapter.runQuick).toBeDefined();

    const trace = casimirRuntimeAdapter.buildReferenceTrace?.({
      graphId: "nhm2-theory-badge-graph",
      badgeIds: ["casimir.cavity.output_energy_proxy"],
    });

    expect(isTheoryRuntimeMathTraceV1(trace)).toBe(true);
    expect(JSON.stringify(trace)).toContain("Static reference trace only; no backend runtime executed.");
  });
});
