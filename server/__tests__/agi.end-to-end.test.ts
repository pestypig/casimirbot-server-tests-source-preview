import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import path from "node:path";

type AdapterRouterModule = typeof import("../routes/agi.adapter");
type TrainingTraceRouterModule = typeof import("../routes/training-trace");
type TrainingTraceStoreModule = typeof import(
  "../services/observability/training-trace-store"
);

let app: express.Express;
let resetStore: (() => void) | undefined;

const loadModules = async (): Promise<{
  adapter: AdapterRouterModule;
  training: TrainingTraceRouterModule;
  store: TrainingTraceStoreModule;
}> => {
  process.env.TRAINING_TRACE_PERSIST = "0";
  process.env.CASIMIR_AUTO_TELEMETRY = "0";
  process.env.ENABLE_AGI_AUTH = "0";
  process.env.AGI_TENANT_REQUIRED = "0";
  process.env.TRAINING_TRACE_AUDIT_PATH = path.resolve(
    process.cwd(),
    ".cal",
    `agi-e2e-trace-${process.pid}.jsonl`,
  );
  await vi.resetModules();
  const adapter = await import("../routes/agi.adapter");
  const training = await import("../routes/training-trace");
  const store = await import("../services/observability/training-trace-store");
  return { adapter, training, store };
};

beforeAll(async () => {
  const { adapter, training, store } = await loadModules();
  resetStore = store.__resetTrainingTraceStore;
  app = express();
  app.use(express.json());
  app.use("/api/agi/adapter", adapter.adapterRouter);
  app.use("/api/agi", training.trainingTraceRouter);
});

beforeEach(() => {
  resetStore?.();
});

describe("agi end-to-end", () => {
  it("runs adapter -> training-trace list -> export", async () => {
    const traceId = "e2e:run-1";
    const response = await request(app)
      .post("/api/agi/adapter/run")
      .send({
        traceId,
        mode: "constraint-pack",
        pack: {
          id: "repo-convergence",
          telemetry: {
            build: { status: "pass", durationMs: 120000 },
            tests: { failed: 0, total: 10 },
            schema: { contracts: true },
            deps: { coherence: true },
            timeToGreenMs: 300000,
            lint: { status: true },
            typecheck: { status: true },
          },
        },
      })
      .expect(200);

    expect(response.body?.verdict).toBe("PASS");
    expect(response.body?.pass).toBe(true);

    const list = await request(app)
      .get("/api/agi/training-trace?limit=10")
      .expect(200);

    const traces = list.body?.traces ?? [];
    expect(
      traces.some(
        (trace: { traceId?: string }) => trace.traceId === traceId,
      ),
    ).toBe(true);

    const exportResponse = await request(app)
      .get("/api/agi/training-trace/export")
      .expect(200);

    expect(typeof exportResponse.text).toBe("string");
    expect(exportResponse.text).toContain(traceId);
  });
});
