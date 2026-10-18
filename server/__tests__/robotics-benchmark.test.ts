import { describe, expect, it, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { demonstrationRouter } from "../routes/agi.demonstration";
import { trainingTraceRouter } from "../routes/training-trace";
import { runPickPlaceBenchmark } from "../services/robotics-benchmark";

describe("robotics pick-and-place benchmark", () => {
  let app: express.Express;

  beforeAll(() => {
    process.env.TRAINING_TRACE_PERSIST = "0";
    app = express();
    app.use(express.json());
    app.use("/api/agi/demonstration", demonstrationRouter);
    app.use("/api/agi", trainingTraceRouter);
  });

  it("replays fixture deterministically with reproducible primitive path", () => {
    const report = runPickPlaceBenchmark();
    expect(report.reproducible).toBe(true);
    expect(report.primitivePath.length).toBeGreaterThan(0);
    expect(report.firstFail).toBeNull();
  });

  it("returns actionable firstFail when thresholds are too strict", () => {
    const baseline = runPickPlaceBenchmark();
    const strict = runPickPlaceBenchmark({
      demo: {
        demoId: "strict",
        traceId: baseline.traceId,
        seed: baseline.replaySeed,
        frames: [
          { ts: 1000, pose: [0, 0, 0], joints: [0, 0, 0], grip: 0 },
          { ts: 1200, pose: [0.08, 0, 0], joints: [0.12, 0.06, 0.02], grip: 0.1 },
          { ts: 1400, pose: [0.16, 0.02, 0], joints: [0.2, 0.1, 0.05], grip: 0.85 },
        ],
        limits: { maxJointAbs: 2.5, maxStepNorm: 1.5, maxJointDelta: 0.9 },
      },
      thresholds: {
        maxStepNormDelta: 0.01,
        maxJointDelta: 0.01,
      },
    });
    expect(strict.firstFail).not.toBeNull();
    expect(strict.firstFail?.id).toContain("benchmark.");
    expect(strict.deltas.length).toBe(2);
  });



  it("records benchmark trace with stable traceId", async () => {
    await request(app)
      .post("/api/agi/demonstration/benchmark/pick-place")
      .send({})
      .expect(200);

    const traces = await request(app)
      .get("/api/agi/training-trace?limit=20")
      .expect(200);

    const entry = (traces.body?.traces ?? []).find(
      (row: { traceId?: string }) => row.traceId === "benchmark:pick-place",
    );
    expect(entry).toBeTruthy();
  });

  it("exposes benchmark API", async () => {
    const response = await request(app)
      .post("/api/agi/demonstration/benchmark/pick-place")
      .send({})
      .expect(200);

    expect(response.body?.ok).toBe(true);
    expect(response.body?.report?.reproducible).toBe(true);
  });
});
