import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isTheoryRuntimeMathTraceV1 } from "../../../../../shared/contracts/theory-runtime-math-trace.v1";
import { isTheoryRuntimeReceiptV1 } from "../../../../../shared/contracts/theory-runtime-receipt.v1";
import {
  readStarSimArtifacts,
  starSimRuntimeAdapter,
} from "../starsim-runtime-adapter";

async function withTempRoot<T>(fn: (tempRoot: string) => Promise<T>): Promise<T> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "starsim-adapter-"));
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

function artifactFixture(overrides: Record<string, unknown> = {}) {
  return {
    M: 1.989e30,
    R: 6.957e8,
    L: 1,
    dominantFusionChannel: "pp_chain",
    fusionMargin: 0.42,
    opacityProvenance: "OPAL opacity table fixture",
    opticalDepthConvention: "Rosseland mean",
    opticalDepthStatus: "pass",
    solarReference: {
      status: "pass",
      anchor: "solar analog",
    },
    mesaRepro: {
      status: "pass",
      mesaResidualRms: 0.02,
      mesaResidualMax: 0.05,
    },
    ...overrides,
  };
}

describe("StarSim runtime adapter", () => {
  it("maps an artifact fixture to a valid reduced-order receipt", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeJson(tempRoot, "artifacts/starsim/starsim-benchmark.json", artifactFixture());

      const receipt = await readStarSimArtifacts({ projectRoot: tempRoot });

      expect(isTheoryRuntimeReceiptV1(receipt)).toBe(true);
      expect(receipt.status).toBe("completed");
      expect(receipt.outputs.gates.reduced_order_prior).toBe("pass");
      expect(receipt.outputs.gates.opacity_provenance_present).toBe("pass");
      expect(receipt.outputs.gates.solar_reference_present).toBe("pass");
      expect(receipt.outputs.gates.mesa_repro_available).toBe("pass");
      expect(receipt.outputs.gates.fusion_stage_gate).toBe("pass");
      expect(receipt.outputs.gates.claim_boundary_stage1).toBe("pass");
      expect(receipt.outputs.scalars.dominantFusionChannel).toBe("pp_chain");
      expect(receipt.claimBoundary.maximumTier).toBe("reduced_order");
      expect(receipt.claimBoundary.promotionAllowed).toBe(false);
    });
  });

  it("adds a blocked gate when opacity provenance is missing", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeJson(tempRoot, "artifacts/starsim/no-opacity.json", {
        ...artifactFixture(),
        opacityProvenance: undefined,
      });

      const receipt = await readStarSimArtifacts({ projectRoot: tempRoot });

      expect(receipt.status).toBe("blocked");
      expect(receipt.outputs.gates.opacity_provenance_present).toBe("not_ready");
      expect(receipt.outputs.missingSignals).toContain("opacity_provenance_missing");
      expect(receipt.outputs.warnings).toContain("Opacity provenance is missing.");
      expect(receipt.claimBoundary.promotionAllowed).toBe(false);
    });
  });

  it("generates scalar cuts for observable proxies", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeJson(tempRoot, "artifacts/starsim/scalars.json", artifactFixture());

      const receipt = await readStarSimArtifacts({ projectRoot: tempRoot });

      expect(typeof receipt.outputs.scalars.T_eff).toBe("number");
      expect(typeof receipt.outputs.scalars.g_surface).toBe("number");
      expect(typeof receipt.outputs.scalars.rho_mean).toBe("number");
      expect(typeof receipt.outputs.scalars.compactness).toBe("number");
      expect(receipt.outputs.scalars.fusionMargin).toBe(0.42);
      expect(receipt.args.scalarCuts).toEqual(
        expect.arrayContaining([
          "T_eff = T_sun*(L/R^2)^(1/4)",
          "g_surface = G*M/R^2",
          "rho_mean = 3*M/(4*pi*R^3)",
          "compactness = G*M/(R*c^2)",
          "fusion margin if present",
        ]),
      );
    });
  });

  it("derives solar-restoration scalar cuts from deep-mixing artifacts", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeJson(
        tempRoot,
        "artifacts/starsim/solar-restoration-deep-mixing.json",
        artifactFixture({
          deepMixing: {
            epsilon: 0.01,
            Mdot_burn_sun: 6.0e11,
            r_tach: 4.8699e8,
            rho_tach: 200,
            f_area: 0.1,
            X_e: 0.7,
            X_c: 0.34,
            M_c: 3.5e29,
            alpha: 0.01,
            M_env_H: 1.1e30,
            dlnL_limit: 1e-3,
            dlnL_abs: 0,
            dlnTc_limit: 1e-3,
            dlnTc_abs: 0,
            h0: 0.002,
            beta: 6,
            deficit: 0,
            T: 1,
          },
        }),
      );

      const receipt = await readStarSimArtifacts({
        projectRoot: tempRoot,
        badgeIds: ["starsim.restoration.tachocline_downflow_setpoint"],
      });

      expect(receipt.status).toBe("completed");
      expect(receipt.outputs.gates.solar_restoration_branch).toBe("pass");
      expect(receipt.outputs.gates.solar_restoration_planning_boundary).toBe("pass");
      expect(receipt.outputs.scalars.Mdot_mix).toBeCloseTo(6.0e9);
      expect(receipt.outputs.scalars.v_r).toBeCloseTo(1.008e-10, 12);
      expect(receipt.outputs.scalars.v_r_mm_yr).toBeCloseTo(3.18, 1);
      expect(receipt.outputs.scalars.Delta_t_Myr).toBeCloseTo(581, 0);
      expect(receipt.outputs.scalars.luminosity_margin).toBe(1e-3);
      expect(receipt.outputs.scalars.core_temp_margin).toBe(1e-3);
      expect(receipt.outputs.scalars.P).toBeCloseTo(0.001998, 6);
      expect(receipt.outputs.warnings).toContain(
        "Solar restoration rows are planning/forecast context only and do not establish feasible stellar intervention.",
      );
      expect(receipt.claimBoundary.promotionAllowed).toBe(false);
    });
  });

  it("keeps the reduced-order claim boundary visible", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeJson(tempRoot, "artifacts/starsim/boundary.json", artifactFixture());

      const receipt = await readStarSimArtifacts({ projectRoot: tempRoot });

      expect(receipt.outputs.warnings).toContain(
        "StarSim Stage 1 is a reduced-order astrophysical prior, not a full stellar-evolution solve.",
      );
      expect(receipt.claimBoundary.promotionBlockedBy).toContain("stage1_reduced_order_prior_only");
      expect(JSON.stringify(receipt)).not.toMatch(/full stellar-evolution claim|direct ER=EPR evidence|CL4 support/i);
    });
  });

  it("returns not_run when no StarSim artifacts exist", async () => {
    await withTempRoot(async (tempRoot) => {
      const receipt = await readStarSimArtifacts({ projectRoot: tempRoot });

      expect(receipt.status).toBe("not_run");
      expect(receipt.outputs.missingSignals).toContain("reduced_order_prior_missing");
      expect(receipt.claimBoundary.promotionAllowed).toBe(false);
    });
  });

  it("returns failed for invalid JSON artifacts", async () => {
    await withTempRoot(async (tempRoot) => {
      const target = path.join(tempRoot, "artifacts/starsim/bad.json");
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, "{ bad", "utf8");

      const receipt = await readStarSimArtifacts({ projectRoot: tempRoot });

      expect(receipt.status).toBe("failed");
      expect(receipt.outputs.missingSignals).toContain("artifact_parse_failed");
      expect(receipt.claimBoundary.promotionAllowed).toBe(false);
    });
  });

  it("exposes static reference trace support", () => {
    expect(starSimRuntimeAdapter.runtimeId).toBe("starsim.artifact_reader");
    expect(starSimRuntimeAdapter.laneId).toBe("stellar_evolution");
    expect(starSimRuntimeAdapter.capabilities).toEqual(["static_reference", "artifact_reader"]);

    const trace = starSimRuntimeAdapter.buildReferenceTrace?.({
      graphId: "nhm2-theory-badge-graph",
      badgeIds: ["starsim.observable.surface_temperature_proxy"],
    });

    expect(isTheoryRuntimeMathTraceV1(trace)).toBe(true);
    expect(JSON.stringify(trace)).toContain("Static reference trace only; no backend runtime executed.");
    expect(JSON.stringify(trace)).toContain("Mdot_mix = epsilon*Mdot_burn_sun");
  });
});
