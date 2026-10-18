import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isTheoryRuntimeMathTraceV1 } from "../../../../../shared/contracts/theory-runtime-math-trace.v1";
import { isTheoryRuntimeReceiptV1 } from "../../../../../shared/contracts/theory-runtime-receipt.v1";
import {
  QEI_STRESS_ENERGY_ARTIFACT_ROOTS,
  qeiStressEnergyAdapter,
  readQeiStressEnergyArtifacts,
} from "../qei-stress-energy-adapter";

async function withTempRoot<T>(fn: (tempRoot: string) => Promise<T>): Promise<T> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "qei-stress-adapter-"));
  try {
    return await fn(tempRoot);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function writeArtifact(tempRoot: string, name: string, content: unknown): Promise<void> {
  const root = path.join(tempRoot, QEI_STRESS_ENERGY_ARTIFACT_ROOTS[2]);
  await fs.mkdir(root, { recursive: true });
  const raw = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  await fs.writeFile(path.join(root, name), raw, "utf8");
}

function completeQeiArtifact(overrides: Record<string, unknown> = {}) {
  return {
    qei_bound: 10,
    qei_sample: 6,
    marginRatio: 0.6,
    rhoMetric: -0.2,
    rhoProxy: -0.18,
    tauSelected: 0.25,
    tauWindow: 0.5,
    sampler: "gaussian",
    fieldType: "scalar",
    qeiStateClass: "Hadamard",
    renormalizationScheme: "point_splitting",
    samplingNormalization: "unit_integral",
    operatorMapping: "stress_energy_projection",
    worldlineClass: "timelike",
    semanticComparable: true,
    bridgeReady: true,
    uncertaintyDecisionClass: "diagnostic",
    curvatureApplicability: "pass",
    gateStatus: {
      timelikeWorldline: "pass",
      hadamardState: "pass",
      pointSplitting: "pass",
      unitIntegralSampling: "pass",
      operatorMapping: "pass",
      semanticBridge: "pass",
      curvatureApplicability: "pass",
      qeiMargin: "pass",
    },
    ...overrides,
  };
}

describe("QEI / Stress-Energy adapter", () => {
  it("returns a valid not_run receipt when no artifact exists", async () => {
    await withTempRoot(async (tempRoot) => {
      const receipt = await readQeiStressEnergyArtifacts({ projectRoot: tempRoot });

      expect(isTheoryRuntimeReceiptV1(receipt)).toBe(true);
      expect(receipt.status).toBe("not_run");
      expect(receipt.claimBoundary.promotionAllowed).toBe(false);
      expect(receipt.outputs.warnings).toContain("No QEI/Stress-Energy artifacts were found.");
    });
  });

  it("returns a failed receipt for invalid JSON", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeArtifact(tempRoot, "bad.json", "{ bad");

      const receipt = await readQeiStressEnergyArtifacts({ projectRoot: tempRoot });

      expect(isTheoryRuntimeReceiptV1(receipt)).toBe(true);
      expect(receipt.status).toBe("failed");
      expect(receipt.outputs.missingSignals).toContain("artifact_parse_failed");
      expect(receipt.claimBoundary.promotionAllowed).toBe(false);
    });
  });

  it("blocks missing QEI semantics with not_ready gates", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeArtifact(tempRoot, "missing-semantics.json", {
        qei_bound: 10,
        qei_sample: 6,
      });

      const receipt = await readQeiStressEnergyArtifacts({ projectRoot: tempRoot });

      expect(receipt.status).toBe("blocked");
      expect(receipt.outputs.gates.qei_margin).toBe("pass");
      expect(receipt.outputs.missingSignals).toEqual(
        expect.arrayContaining([
          "timelike_worldline_missing",
          "operator_mapping_missing",
          "semantic_bridge_missing",
        ]),
      );
      expect(receipt.claimBoundary.promotionAllowed).toBe(false);
    });
  });

  it("extracts scalar fields and scalar cuts from a complete artifact", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeArtifact(tempRoot, "complete-qei.json", completeQeiArtifact());

      const receipt = await qeiStressEnergyAdapter.readArtifacts?.({
        projectRoot: tempRoot,
        graphId: "nhm2-theory-badge-graph",
      });

      expect(receipt?.status).toBe("completed");
      expect(receipt?.outputs.scalars.qei_bound).toBe(10);
      expect(receipt?.outputs.scalars.qei_sample).toBe(6);
      expect(receipt?.outputs.scalars.qei_margin).toBe(4);
      expect(receipt?.outputs.scalars.tau_margin).toBe(0.25);
      expect(receipt?.outputs.gates.timelike_worldline).toBe("pass");
      expect(receipt?.claimBoundary.promotionAllowed).toBe(false);
    });
  });

  it("keeps failing gates visible without emitting promotion claims", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeArtifact(
        tempRoot,
        "qei-fail.json",
        completeQeiArtifact({
          gateStatus: {
            timelikeWorldline: "pass",
            hadamardState: "pass",
            pointSplitting: "pass",
            unitIntegralSampling: "pass",
            operatorMapping: "fail",
            semanticBridge: "pass",
            curvatureApplicability: "pass",
            qeiMargin: "pass",
          },
        }),
      );

      const receipt = await readQeiStressEnergyArtifacts({ projectRoot: tempRoot });

      expect(receipt.status).toBe("completed");
      expect(receipt.outputs.gates.operator_mapping).toBe("fail");
      expect(receipt.claimBoundary.promotionAllowed).toBe(false);
      expect(receipt.claimBoundary.promotionBlockedBy).toContain("operator_mapping_failed");
      expect(JSON.stringify(receipt)).not.toMatch(/QEI passed|validated propulsion|physical mechanism confirmed/i);
    });
  });

  it("matches the expected lane, runtime, badges, and static trace", () => {
    expect(qeiStressEnergyAdapter.runtimeId).toBe("qei_stress_energy.artifact_reader");
    expect(qeiStressEnergyAdapter.laneId).toBe("qei_stress_energy");
    expect(qeiStressEnergyAdapter.capabilities).toEqual(["static_reference", "artifact_reader"]);
    expect(qeiStressEnergyAdapter.supportedBadgeIds).toEqual(
      expect.arrayContaining([
        "physics.fields.stress_energy_tensor",
        "nhm2.qei.sampling_window",
        "nhm2.qei.worldline_dossier",
        "nhm2.energy_condition.diagnostic_gate",
      ]),
    );

    const trace = qeiStressEnergyAdapter.buildReferenceTrace?.({
      graphId: "nhm2-theory-badge-graph",
      badgeIds: ["nhm2.qei.sampling_window"],
    });

    expect(isTheoryRuntimeMathTraceV1(trace)).toBe(true);
    expect(JSON.stringify(trace)).toContain("Static reference trace only; no backend runtime executed.");
  });
});
