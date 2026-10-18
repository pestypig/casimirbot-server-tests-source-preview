import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { demonstrationRouter } from "../routes/agi.demonstration";
import { retargetDemonstrationToPrimitiveDag } from "../services/demonstration-retargeting";

let app: express.Express;

beforeAll(() => {
  process.env.TRAINING_TRACE_PERSIST = "0";
  app = express();
  app.use(express.json());
  app.use("/api/agi/demonstration", demonstrationRouter);
});

describe("demonstration retargeting", () => {
  it("segments demonstration into primitives and DAG", () => {
    const result = retargetDemonstrationToPrimitiveDag({
      demoId: "demo-1",
      frames: [
        { ts: 1000, pose: [0, 0, 0], joints: [0, 0, 0], grip: 0 },
        { ts: 1200, pose: [0.05, 0, 0], joints: [0.1, 0.05, 0], grip: 0.1 },
        { ts: 2200, pose: [0.6, 0.2, 0], joints: [0.3, 0.2, 0.1], grip: 0.8 },
        { ts: 2400, pose: [0.65, 0.2, 0], joints: [0.32, 0.22, 0.12], grip: 0.2 },
      ],
      limits: {
        maxJointAbs: 2,
        maxStepNorm: 2,
        maxJointDelta: 1,
      },
    });

    expect(result.primitives.length).toBeGreaterThan(0);
    expect(result.dag.nodes.length).toBe(result.primitives.length);
    expect(result.kinematicValidity.ok).toBe(true);
  });

  it("exposes retarget endpoint", async () => {
    const res = await request(app)
      .post("/api/agi/demonstration/retarget")
      .send({
        demo: {
          demoId: "demo-api-1",
          traceId: "phase4:demo-api-1",
          frames: [
            { ts: 1000, pose: [0, 0, 0], joints: [0, 0, 0], grip: 0 },
            { ts: 1400, pose: [0.1, 0, 0], joints: [0.1, 0, 0], grip: 0.3 },
            { ts: 1800, pose: [0.2, 0.1, 0], joints: [0.2, 0.1, 0], grip: 0.8 },
          ],
        },
      })
      .expect(200);

    expect(res.body?.ok).toBe(true);
    expect(res.body?.result?.traceId).toBe("phase4:demo-api-1");
    expect(Array.isArray(res.body?.result?.primitives)).toBe(true);
    expect(Array.isArray(res.body?.result?.dag?.nodes)).toBe(true);
  });
});
