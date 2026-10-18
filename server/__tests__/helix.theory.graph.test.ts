import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { helixTheoryRouter } from "../routes/helix/theory";

async function withTempRoot<T>(fn: (tempRoot: string) => Promise<T>): Promise<T> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "helix-theory-route-"));
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

describe("GET /api/helix/theory/graph", () => {
  it("returns a theory_badge_graph/v1 artifact", async () => {
    const app = express();
    app.use("/api/helix/theory", helixTheoryRouter);

    const response = await request(app).get("/api/helix/theory/graph").expect(200);

    expect(response.body.artifactId).toBe("theory_badge_graph");
    expect(response.body.schemaVersion).toBe("theory_badge_graph/v1");
    expect(response.body.badges).toEqual(expect.any(Array));
    expect(response.body.badges.length).toBeGreaterThan(0);
    expect(response.body.edges).toEqual(expect.any(Array));
    expect(response.body.edges.length).toBeGreaterThan(0);
    expect(response.body.summary.calculatorLoadableCount).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(response.body)).not.toMatch(
      /\b(validated propulsion|working warp drive|physical mechanism confirmed|QEI passed|proven warp)\b/i,
    );
  });

  it("returns artifact-backed compound theory runs when runtime artifacts exist", async () => {
    await withTempRoot(async (tempRoot) => {
      await writeJson(tempRoot, "artifacts/tokamak/tokamak-energy-field.json", {
        plasma: {
          B_T: 5.3,
          p_Pa: 211_487.315688,
          P_loss: 12_000_000,
          W_th: 4_800_000,
        },
        diagnostics: {
          syntheticDiagnostics: {
            status: "pass",
            channels: ["bolometry"],
          },
        },
        precursor: {
          score: 0.78,
          threshold: 0.65,
        },
        gates: {
          betaInRange: "pass",
        },
      });
      const app = express();
      app.use(express.json());
      app.use("/api/helix/theory", helixTheoryRouter);

      const response = await request(app)
        .post("/api/helix/theory/compound-run")
        .send({
          badgeIds: ["tokamak.runtime.synthetic_diagnostics"],
          projectRoot: tempRoot,
        })
        .expect(200);

      expect(response.body.kind).toBe("theory_compound_run");
      expect(response.body.artifact_v1.schemaVersion).toBe("theory_compound_run/v1");
      expect(JSON.stringify(response.body.artifact_v1)).toContain("tokamak.artifact_reader");
      expect(JSON.stringify(response.body.artifact_v1)).toContain("artifact_reader");
    });
  });
});
