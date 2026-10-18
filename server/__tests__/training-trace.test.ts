import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import path from "node:path";

type TrainingTraceRouterModule = typeof import("../routes/training-trace");
type TrainingTraceStoreModule = typeof import("../services/observability/training-trace-store");

let app: express.Express;
let resetStore: (() => void) | undefined;

const loadModules = async (): Promise<{
  routes: TrainingTraceRouterModule;
  store: TrainingTraceStoreModule;
}> => {
  process.env.TRAINING_TRACE_PERSIST = "0";
  process.env.TRAINING_TRACE_AUDIT_PATH = path.resolve(
    process.cwd(),
    ".cal",
    `training-trace-test-${process.pid}.jsonl`,
  );
  await vi.resetModules();
  const routes = await import("../routes/training-trace");
  const store = await import("../services/observability/training-trace-store");
  return { routes, store };
};

beforeAll(async () => {
  const { routes, store } = await loadModules();
  resetStore = store.__resetTrainingTraceStore;
  app = express();
  app.use(express.json());
  app.use("/api/agi", routes.trainingTraceRouter);
});

beforeEach(() => {
  resetStore?.();
});

describe("training-trace API", () => {
  it("ingests and retrieves traces", async () => {
    const payload = {
      traceId: "warp-viability:demo",
      pass: false,
      deltas: [
        { key: "gamma_VdB", from: 1, to: 1.5, delta: 0.5, change: "changed" },
      ],
      signal: { kind: "warp-viability", proxy: false },
      firstFail: {
        id: "FordRomanQI",
        severity: "HARD",
        status: "fail",
        value: -3e-6,
        limit: "-1e-6",
      },
      certificate: { status: "INADMISSIBLE", certificateHash: null },
      notes: ["status=INADMISSIBLE"],
    };
    const create = await request(app)
      .post("/api/agi/training-trace")
      .send(payload)
      .expect(200);
    const id = create.body?.trace?.id;
    expect(id).toBeTruthy();

    const list = await request(app)
      .get("/api/agi/training-trace?limit=10")
      .expect(200);
    expect(Array.isArray(list.body?.traces)).toBe(true);
    expect(list.body.traces.length).toBeGreaterThan(0);

    const fetched = await request(app)
      .get(`/api/agi/training-trace/${id}`)
      .expect(200);
    expect(fetched.body?.trace?.id).toBe(id);
    expect(fetched.body?.trace?.signal?.kind).toBe("warp-viability");
    expect(fetched.body?.trace?.eventRefs?.length).toBeGreaterThan(0);
  });



  it("accepts movement episode payloads with optimism/entropy metrics", async () => {
    const payload = {
      traceId: "movement-episode:demo",
      pass: true,
      deltas: [],
      payload: {
        kind: "movement_episode",
        data: {
          episodeId: "episode-1",
          primitivePath: ["approach", "grasp", "place"],
          provenanceClass: "robotics.demonstration",
          sensorChannelCoverage: ["camera.rgb", "force.torque"],
          certificateRefs: ["cert-hash-1", "cert-id-1"],
          metrics: { optimism: 0.81, entropy: 0.12 },
          events: [
            { phase: "sense", ts: new Date().toISOString() },
            { phase: "premeditate", ts: new Date().toISOString(), candidateId: "cand-a" },
            { phase: "act", ts: new Date().toISOString(), controllerRef: "pid-v1" },
            { phase: "compare", ts: new Date().toISOString(), predictedDelta: 0.03, actualDelta: 0.05 },
          ],
        },
      },
    };

    const create = await request(app)
      .post("/api/agi/training-trace")
      .send(payload)
      .expect(200);

    expect(create.body?.trace?.payload?.kind).toBe("movement_episode");
    expect(create.body?.trace?.payload?.data?.metrics?.optimism).toBe(0.81);
    expect(create.body?.trace?.payload?.data?.metrics?.entropy).toBe(0.12);

    const exported = await request(app)
      .get("/api/agi/training-trace/export")
      .expect(200);
    const lines = (exported.text ?? "").trim().split("\n").filter(Boolean);
    const parsed = lines.map((line) => JSON.parse(line));
    const movement = parsed.find((entry) => entry.payload?.kind === "movement_episode");
    expect(movement?.payload?.data?.metrics?.optimism).toBe(0.81);
    expect(movement?.payload?.data?.metrics?.entropy).toBe(0.12);
    expect(movement?.payload?.data?.provenanceClass).toBe("robotics.demonstration");
    expect(movement?.payload?.data?.sensorChannelCoverage).toEqual(["camera.rgb", "force.torque"]);
    expect(movement?.payload?.data?.certificateRefs).toEqual(["cert-hash-1", "cert-id-1"]);
  });


  it("exports traces in deterministic sequence order", async () => {
    await request(app).post("/api/agi/training-trace").send({ pass: true, deltas: [], traceId: "trace-b" }).expect(200);
    await request(app).post("/api/agi/training-trace").send({ pass: true, deltas: [], traceId: "trace-c" }).expect(200);
    await request(app).post("/api/agi/training-trace").send({ pass: true, deltas: [], traceId: "trace-d" }).expect(200);

    const res = await request(app)
      .get("/api/agi/training-trace/export")
      .expect(200);
    const rows = (res.text ?? "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    const seq = rows.map((entry) => Number(entry.seq));
    const sorted = seq.slice().sort((a, b) => a - b);
    expect(seq).toEqual(sorted);
  });

  it("exports JSONL", async () => {
    await request(app)
      .post("/api/agi/training-trace")
      .send({ pass: true, deltas: [] })
      .expect(200);

    const res = await request(app)
      .get("/api/agi/training-trace/export")
      .expect(200);
    const body = typeof res.text === "string" ? res.text.trim() : "";
    const line = body.split("\n").filter(Boolean)[0];
    expect(line).toBeTruthy();
    const parsed = JSON.parse(line);
    expect(parsed.kind).toBe("training-trace");
  });
});
