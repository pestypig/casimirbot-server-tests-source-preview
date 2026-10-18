import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { neuroRouter } from "../routes/neuro";

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/neuro", neuroRouter);
  return app;
};

describe("neuro feature bridge", () => {
  it("maps gamma sync into resonance and dispersion", async () => {
    const app = createApp();
    const timestamp = Date.parse("2025-01-01T00:00:00.000Z");
    const basePayload = {
      session_type: "lab",
      phase_dispersion: 0.5,
      artifact_flags: { gamma_artifact_pass: 1 },
      sample_count: 256,
      timestamp,
    };

    const low = await request(app)
      .post("/api/neuro/features")
      .send({ ...basePayload, session_id: "neuro-low", gamma_sync_z: 0.5 })
      .expect(200);

    const high = await request(app)
      .post("/api/neuro/features")
      .send({ ...basePayload, session_id: "neuro-high", gamma_sync_z: 5 })
      .expect(200);

    expect(high.body.gamma_sync_z).toBe(5);
    expect(high.body.resonance_score).toBeGreaterThan(low.body.resonance_score);
    expect(high.body.phase_dispersion).toBeLessThan(low.body.phase_dispersion);
  });

  it("passes through phase dispersion and artifact flags", async () => {
    const app = createApp();
    const timestamp = Date.parse("2025-01-01T00:00:00.000Z");
    const payload = {
      session_id: "neuro-artifact",
      session_type: "lab",
      phase_dispersion: 0.65,
      artifact_flags: { gamma_artifact_pass: 0 },
      sample_count: 128,
      timestamp,
    };

    const res = await request(app)
      .post("/api/neuro/features")
      .send(payload)
      .expect(200);

    expect(res.body.phase_dispersion).toBe(0.65);
    expect(res.body.artifact_flags?.gamma_artifact_pass).toBe(0);
  });
});
