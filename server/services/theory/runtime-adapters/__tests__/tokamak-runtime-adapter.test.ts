import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isTheoryRuntimeMathTraceV1 } from "../../../../../shared/contracts/theory-runtime-math-trace.v1";
import { isTheoryRuntimeReceiptV1 } from "../../../../../shared/contracts/theory-runtime-receipt.v1";
import {
  readTokamakArtifacts,
  tokamakRuntimeAdapter,
} from "../tokamak-runtime-adapter";

async function withTempRoot<T>(fn: (tempRoot: string) => Promise<T>): Promise<T> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tokamak-adapter-"));
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
    plasma: {
      B_T: 5.3,
      n_m3: 1.1e20,
      T_eV: 12000,
      p_Pa: 211_487.315688,
      P_loss: 12_000_000,
      W_th: 4_800_000,
    },
    diagnostics: {
      syntheticDiagnostics: {
        status: "pass",
        channels: ["bolometry", "interferometry", "probe"],
      },
    },
    precursor: {
      score: 0.78,
      threshold: 0.65,
    },
    flux: {
      core_count: 42,
      edge_count: 28,
      total_count: 100,
    },
    gates: {
      betaInRange: "pass",
    },
    ...overrides,
  };
}

describe("Tokamak runtime adapter", () => {
  it("parses a tokamak artifact fixture into a valid diagnostic receipt", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeJson(tempRoot, "artifacts/tokamak/tokamak-energy-field.json", artifactFixture());

      const receipt = await readTokamakArtifacts({ projectRoot: tempRoot });

      expect(isTheoryRuntimeReceiptV1(receipt)).toBe(true);
      expect(receipt.status).toBe("completed");
      expect(receipt.outputs.gates.diagnostic_artifact_present).toBe("pass");
      expect(receipt.outputs.gates.beta_in_range).toBe("pass");
      expect(receipt.outputs.gates.precursor_margin_gate).toBe("pass");
      expect(receipt.outputs.gates.synthetic_diagnostics_present).toBe("pass");
      expect(receipt.outputs.gates.claim_boundary_diagnostic_proxy).toBe("pass");
      expect(typeof receipt.outputs.scalars.p_B).toBe("number");
      expect(typeof receipt.outputs.scalars.beta).toBe("number");
      expect(receipt.outputs.scalars.tau_E).toBeCloseTo(0.4);
      expect(receipt.outputs.scalars.precursor_margin).toBeCloseTo(0.13);
      expect(receipt.claimBoundary.maximumTier).toBe("diagnostic");
      expect(receipt.claimBoundary.promotionAllowed).toBe(false);
    });
  });

  it("marks missing synthetic diagnostics as not_ready", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeJson(tempRoot, "artifacts/tokamak/tokamak-summary.json", {
        ...artifactFixture(),
        diagnostics: undefined,
      });

      const receipt = await readTokamakArtifacts({ projectRoot: tempRoot });

      expect(receipt.status).toBe("blocked");
      expect(receipt.outputs.gates.synthetic_diagnostics_present).toBe("not_ready");
      expect(receipt.outputs.missingSignals).toContain("synthetic_diagnostics_missing");
      expect(receipt.outputs.warnings).toContain("Synthetic diagnostics artifact is missing.");
      expect(receipt.claimBoundary.promotionAllowed).toBe(false);
    });
  });

  it("generates scalar cuts for pressure, beta, confinement, precursor, and flux helpers", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeJson(tempRoot, "artifacts/tokamak/scalars.json", artifactFixture());

      const receipt = await readTokamakArtifacts({ projectRoot: tempRoot });

      expect(typeof receipt.outputs.scalars.p_B).toBe("number");
      expect(typeof receipt.outputs.scalars.p_Pa).toBe("number");
      expect(typeof receipt.outputs.scalars.beta).toBe("number");
      expect(receipt.outputs.scalars.P_net).toBeUndefined();
      expect(receipt.outputs.scalars.tau_E).toBeCloseTo(0.4);
      expect(receipt.outputs.scalars.core_fraction).toBeCloseTo(0.42);
      expect(receipt.outputs.scalars.edge_fraction).toBeCloseTo(0.28);
      expect(receipt.args.scalarCuts).toEqual(
        expect.arrayContaining([
          "p_B = B_T^2/(2*mu0)",
          "beta = p_Pa/p_B",
          "tau_E = W_th/P_loss",
          "precursor_margin = score - threshold",
        ]),
      );
    });
  });

  it("keeps diagnostic claim boundary visible", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeJson(tempRoot, "artifacts/tokamak/boundary.json", artifactFixture());

      const receipt = await readTokamakArtifacts({ projectRoot: tempRoot });

      expect(receipt.outputs.warnings).toContain(
        "Tokamak rows are diagnostic/proxy helpers, not operational/control claims.",
      );
      expect(receipt.claimBoundary.promotionBlockedBy).toEqual(
        expect.arrayContaining(["diagnostic_proxy_only", "no_operational_control_claim"]),
      );
      expect(JSON.stringify(receipt)).not.toMatch(
        /operationally validated|control authority established|validated stability/i,
      );
    });
  });

  it("returns not_run when no tokamak artifacts exist", async () => {
    await withTempRoot(async (tempRoot) => {
      const receipt = await readTokamakArtifacts({ projectRoot: tempRoot });

      expect(receipt.status).toBe("not_run");
      expect(receipt.outputs.missingSignals).toContain("diagnostic_artifact_missing");
      expect(receipt.claimBoundary.promotionAllowed).toBe(false);
    });
  });

  it("returns failed for invalid JSON artifacts", async () => {
    await withTempRoot(async (tempRoot) => {
      const target = path.join(tempRoot, "artifacts/tokamak/bad.json");
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, "{ bad", "utf8");

      const receipt = await readTokamakArtifacts({ projectRoot: tempRoot });

      expect(receipt.status).toBe("failed");
      expect(receipt.outputs.missingSignals).toContain("artifact_parse_failed");
      expect(receipt.claimBoundary.promotionAllowed).toBe(false);
    });
  });

  it("exposes static reference trace support", () => {
    expect(tokamakRuntimeAdapter.runtimeId).toBe("tokamak.artifact_reader");
    expect(tokamakRuntimeAdapter.laneId).toBe("tokamak_plasma");
    expect(tokamakRuntimeAdapter.capabilities).toEqual(["static_reference", "artifact_reader"]);

    const trace = tokamakRuntimeAdapter.buildReferenceTrace?.({
      graphId: "nhm2-theory-badge-graph",
      badgeIds: ["tokamak.plasma.beta_proxy"],
    });

    expect(isTheoryRuntimeMathTraceV1(trace)).toBe(true);
    expect(JSON.stringify(trace)).toContain("Static reference trace only; no backend runtime executed.");
  });
});
