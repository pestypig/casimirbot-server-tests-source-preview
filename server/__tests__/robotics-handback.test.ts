import { beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { demonstrationRouter } from "../routes/agi.demonstration";
import { trainingTraceRouter } from "../routes/training-trace";
import { buildRoboticsHandbackBundle } from "../services/robotics-handback";

describe("robotics handback bundle", () => {
  let app: express.Express;

  beforeAll(() => {
    process.env.TRAINING_TRACE_PERSIST = "0";
    app = express();
    app.use(express.json());
    app.use("/api/agi/demonstration", demonstrationRouter);
    app.use("/api/agi", trainingTraceRouter);
  });

  it("builds a bundle with benchmark and risk metadata", () => {
    const bundle = buildRoboticsHandbackBundle();
    expect(bundle.benchmark.benchmarkId).toContain("pick-and-place");
    expect(bundle.openRisks.length).toBeGreaterThan(0);
    expect(bundle.nextRung.length).toBeGreaterThan(0);
    expect(bundle.runbookRef).toBe("docs/robotics-threshold-tuning-runbook.md");
    expect(bundle.replayLinkage.movementEpisodeCount).toBeGreaterThanOrEqual(0);
    expect(bundle.replayLinkage.replaySummaryCount).toBeGreaterThanOrEqual(0);
  });

  it("exposes handback summary endpoint", async () => {
    await request(app)
      .post("/api/agi/demonstration/benchmark/pick-place")
      .send({})
      .expect(200);

    const response = await request(app)
      .get("/api/agi/demonstration/handback/summary")
      .expect(200);

    expect(response.body?.ok).toBe(true);
    expect(response.body?.bundle?.benchmark?.traceId).toBe("benchmark:pick-place");
    expect(Array.isArray(response.body?.bundle?.openRisks)).toBe(true);
    expect(response.body?.bundle?.runbookRef).toBe("docs/robotics-threshold-tuning-runbook.md");
    expect(response.body?.bundle?.replayLinkage).toBeTruthy();
  });
});
