import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { runtimeGovernorRouter } from "../routes/runtime-governor";
import { runtimeMemoryGovernor } from "../services/runtime/runtime-memory-governor";

describe("runtime governor routes", () => {
  afterEach(() => {
    delete process.env.RUNTIME_MEMORY_STATUS_ENABLED;
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests();
  });

  it("returns sanitized runtime memory status", async () => {
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
      memoryReader: () => ({
        rss: 200 * 1024 * 1024,
        heapTotal: 120 * 1024 * 1024,
        heapUsed: 100 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 2 * 1024 * 1024,
      }),
      hostMemoryReader: () => ({
        freeMiB: 8000,
        totalMiB: 16000,
        freeRatio: 0.5,
      }),
    });
    const app = express();
    app.use("/api/runtime", runtimeGovernorRouter);

    const response = await request(app).get("/api/runtime/memory").expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      schema: "casimir.runtime_memory.v1",
      memory: {
        heapUsedMiB: 100,
        rssMiB: 200,
      },
      host: {
        freeMiB: 8000,
        totalMiB: 16000,
        freeRatio: 0.5,
      },
      pressureLevel: "normal",
      activeTasks: [],
      pausedTasks: [],
    });
    expect(JSON.stringify(response.body)).not.toMatch(/transcript|prompt|audio_url|api_key/i);
  });
});

