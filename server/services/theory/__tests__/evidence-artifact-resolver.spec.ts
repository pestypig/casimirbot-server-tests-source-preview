import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isTheoryRuntimeReceiptV1 } from "../../../../shared/contracts/theory-runtime-receipt.v1";
import { resolveEvidenceArtifacts } from "../evidence-artifact-resolver";

let tempRoot: string;

async function writeFixture(relativePath: string, contents: string): Promise<void> {
  const absolutePath = path.join(tempRoot, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, contents, "utf8");
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "theory-evidence-"));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("resolveEvidenceArtifacts", () => {
  it("finds and parses evidence artifacts", async () => {
    await writeFixture("artifacts/research/full-solve/run.json", JSON.stringify({
      gates: {
        source_closure: "pass",
      },
      verdict: "pass",
    }));

    const result = await resolveEvidenceArtifacts({
      runtimeId: "test.runtime",
      graphId: "test.graph",
      badgeIds: ["test.badge"],
      outputArtifactGlobs: ["artifacts/research/full-solve/**/*.json"],
      projectRoot: tempRoot,
      generatedAt: "2026-05-29T00:00:00.000Z",
    });

    expect(result.artifactsFound.map((artifact) => artifact.path)).toContain("artifacts/research/full-solve/run.json");
    expect(result.receiptV1.status).toBe("completed");
    expect(result.receiptV1.outputs.gates.source_closure).toBe("pass");
    expect(isTheoryRuntimeReceiptV1(result.receiptV1)).toBe(true);
  });

  it("returns not_run when artifacts are missing", async () => {
    const result = await resolveEvidenceArtifacts({
      runtimeId: "test.runtime",
      graphId: "test.graph",
      badgeIds: ["test.badge"],
      outputArtifactGlobs: ["artifacts/research/full-solve/**/*.json"],
      projectRoot: tempRoot,
      generatedAt: "2026-05-29T00:00:00.000Z",
    });

    expect(result.artifactsFound).toHaveLength(0);
    expect(result.artifactsMissing).toContain("artifacts/research/full-solve/**/*.json");
    expect(result.receiptV1.status).toBe("not_run");
    expect(result.receiptV1.outputs.warnings.join(" ")).toMatch(/not_run/);
  });

  it("fails closed for invalid JSON artifacts", async () => {
    await writeFixture("AUDIT_TREE.json", "{not-json");

    const result = await resolveEvidenceArtifacts({
      runtimeId: "test.audit",
      graphId: "test.graph",
      badgeIds: ["test.badge"],
      outputArtifactGlobs: ["AUDIT_TREE.json"],
      projectRoot: tempRoot,
      generatedAt: "2026-05-29T00:00:00.000Z",
    });

    expect(result.receiptV1.status).toBe("failed");
    expect(result.artifactsFound[0]?.parseError).toBeTruthy();
    expect(result.receiptV1.outputs.warnings.join(" ")).toMatch(/JSON parse failed/);
  });

  it("marks artifacts stale when freshness metadata says stale", async () => {
    await writeFixture("manifest.json", JSON.stringify({
      freshness: {
        status: "stale",
      },
    }));

    const result = await resolveEvidenceArtifacts({
      runtimeId: "solar.manifest",
      graphId: "test.graph",
      badgeIds: ["solar.runtime.spectrum_analysis"],
      outputArtifactGlobs: ["manifest.json"],
      projectRoot: tempRoot,
      generatedAt: "2026-05-29T00:00:00.000Z",
    });

    expect(result.stale).toBe(true);
    expect(result.receiptV1.status).toBe("stale");
  });

  it("fails closed on missing certificates for NHM2/warp evidence", async () => {
    await writeFixture("artifacts/research/full-solve/run.json", JSON.stringify({
      gates: {
        source_closure: "pass",
      },
    }));

    const result = await resolveEvidenceArtifacts({
      runtimeId: "warp.full_solve.campaign",
      graphId: "test.graph",
      badgeIds: ["nhm2.closure.source_residual"],
      outputArtifactGlobs: ["artifacts/research/full-solve/**/*.json"],
      projectRoot: tempRoot,
      generatedAt: "2026-05-29T00:00:00.000Z",
    });

    expect(result.receiptV1.status).toBe("completed");
    expect(result.receiptV1.claimBoundary.promotionAllowed).toBe(false);
    expect(result.receiptV1.claimBoundary.promotionBlockedBy).toContain("missing_certificate");
    expect(result.receiptV1.outputs.gates.certificate_integrity).toBe("not_ready");
  });
});
