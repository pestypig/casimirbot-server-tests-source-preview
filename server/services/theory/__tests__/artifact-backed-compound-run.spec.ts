import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isTheoryCompoundRunV1 } from "../../../../shared/contracts/theory-compound-run.v1";
import { buildNhm2TheoryBadgeGraphV1 } from "../../../../shared/theory/nhm2-theory-badges";
import { buildArtifactBackedCompoundTheoryRun } from "../artifact-backed-compound-run";

async function withTempRoot<T>(fn: (tempRoot: string) => Promise<T>): Promise<T> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "artifact-backed-run-"));
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

function tokamakArtifact() {
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
    gates: {
      betaInRange: "pass",
    },
  };
}

describe("artifact-backed compound theory runs", () => {
  it("replaces static runtime context with artifact-backed receipt when evidence exists", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeJson(tempRoot, "artifacts/tokamak/tokamak-energy-field.json", tokamakArtifact());
      const graph = buildNhm2TheoryBadgeGraphV1();

      const run = await buildArtifactBackedCompoundTheoryRun({
        graph,
        badgeIds: ["tokamak.runtime.synthetic_diagnostics"],
        mode: "dependency_path",
        projectRoot: tempRoot,
      });

      expect(isTheoryCompoundRunV1(run)).toBe(true);
      const artifactBackedRow = run.rows.find((row) => row.badgeId === "tokamak.runtime.synthetic_diagnostics");
      expect(artifactBackedRow?.runtimeReceiptV1?.runtimeId).toBe("tokamak.artifact_reader");
      expect(artifactBackedRow?.status).toBe("computed");
      expect(artifactBackedRow?.runtimeMathTraceV1?.steps.some((step) => step.computedBy === "artifact_reader")).toBe(true);
      expect(artifactBackedRow?.runtimeMathTraceV1?.steps.some((step) => step.artifactRef)).toBe(true);
      expect(artifactBackedRow?.warnings.join(" ")).toMatch(/read-only tokamak artifact adapter/i);
    });
  });

  it("uses static reference trace when no artifact exists", async () => {
    await withTempRoot(async (tempRoot) => {
      const graph = buildNhm2TheoryBadgeGraphV1();

      const run = await buildArtifactBackedCompoundTheoryRun({
        graph,
        badgeIds: ["tokamak.runtime.synthetic_diagnostics"],
        mode: "dependency_path",
        projectRoot: tempRoot,
      });

      const staticRow = run.rows.find((row) => row.badgeId === "tokamak.runtime.synthetic_diagnostics");
      expect(staticRow?.runtimeReceiptV1).toBeNull();
      expect(staticRow?.runtimeMathTraceV1?.request.family).toBe("tokamak_runtime");
      expect(staticRow?.runtimeMathTraceV1?.steps.every((step) => step.computedBy === "static_reference_trace")).toBe(true);
      expect(staticRow?.warnings).toContain("Static reference trace only; no backend runtime executed.");
    });
  });

  it("preserves claim boundary notes on artifact-backed and static paths", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeJson(tempRoot, "artifacts/tokamak/tokamak-energy-field.json", tokamakArtifact());
      const graph = buildNhm2TheoryBadgeGraphV1();

      const artifactRun = await buildArtifactBackedCompoundTheoryRun({
        graph,
        badgeIds: ["tokamak.claim_boundary.diagnostic_proxy"],
        mode: "selected_badges",
        projectRoot: tempRoot,
      });
      const staticRun = await buildArtifactBackedCompoundTheoryRun({
        graph,
        badgeIds: ["tokamak.claim_boundary.diagnostic_proxy"],
        mode: "selected_badges",
        projectRoot: path.join(tempRoot, "empty"),
      });

      expect(artifactRun.rows.some((row) => row.claimBoundaryNotes.some((note) => /diagnostic-only/i.test(note)))).toBe(true);
      expect(staticRun.rows.some((row) => row.claimBoundaryNotes.some((note) => /promotion not allowed/i.test(note)))).toBe(true);
      expect(artifactRun.rows.every((row) => row.runtimeReceiptV1?.claimBoundary.promotionAllowed !== true)).toBe(true);
    });
  });
});
