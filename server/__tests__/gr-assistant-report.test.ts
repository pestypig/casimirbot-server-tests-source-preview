import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const buildApp = async () => {
  const { getGrAssistantReport } = await import("../helix-core");
  const app = express();
  app.use(express.json());
  app.post("/api/helix/gr-assistant-report", getGrAssistantReport);
  return app;
};

const makeChannel = (value: number) => ({
  data: [value],
  min: value,
  max: value,
});

const mockFetch = vi.fn(async (url: string) => {
  if (url.includes("/physics/invariants")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ scalars: { kretschmann: 0.0 } }),
    } as any;
  }
  if (url.includes("/physics/check-vacuum")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ check_name: "check_vacuum", passed: true }),
    } as any;
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({ checks: [] }),
  } as any;
});

let originalFetch: typeof fetch | undefined;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  vi.stubGlobal("fetch", mockFetch);
  vi.resetModules();
});

afterEach(() => {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
  }
  vi.unstubAllGlobals();
  mockFetch.mockClear();
});

describe("gr-assistant-report route", () => {
  it("returns a report shape with checks, invariants, and gate certificate", async () => {
    const app = await buildApp();
    const brick = {
      dims: [1, 1, 1],
      bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
      voxelSize_m: [2, 2, 2],
      time_s: 0,
      dt_s: 1,
      channels: {
        alpha: makeChannel(1),
        beta_x: makeChannel(0),
        beta_y: makeChannel(0),
        beta_z: makeChannel(0),
        gamma_xx: makeChannel(1),
        gamma_yy: makeChannel(1),
        gamma_zz: makeChannel(1),
        H_constraint: makeChannel(0),
        M_constraint_x: makeChannel(0),
        M_constraint_y: makeChannel(0),
        M_constraint_z: makeChannel(0),
      },
      stats: {
        steps: 1,
        iterations: 1,
        tolerance: 1e-6,
        cfl: 0.1,
        H_rms: 0,
        M_rms: 0,
      },
    };
    const response = await request(app)
      .post("/api/helix/gr-assistant-report")
      .send({
        brick,
        run_artifacts: false,
        run_checks: true,
        run_invariants: true,
        useLiveSnapshot: false,
        vacuum_sample_points: [{ t: 0, x: 0, y: 0, z: 0 }],
      })
      .expect(200);

    expect(response.body?.kind).toBe("gr-assistant-report");
    expect(Array.isArray(response.body?.report?.checks)).toBe(true);
    expect(response.body?.report?.invariants).toBeTruthy();
    expect(response.body?.gate?.certificate?.certificateHash).toBeTruthy();
  });
});
