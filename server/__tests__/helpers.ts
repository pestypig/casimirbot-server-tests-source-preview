import express from "express";
import request from "supertest";
import type { ConsoleTelemetryBundle } from "@shared/desktop";
import type { TResonanceSelectionSnapshot } from "@shared/essence-persona";
import { planRouter } from "../routes/agi.plan";
import { getLatticeVersion as readLatticeVersion } from "../services/code-lattice/loader";

process.env.DATABASE_URL = process.env.DATABASE_URL ?? "pg-mem://agi-plan-seal-tests";
process.env.ENABLE_ESSENCE = process.env.ENABLE_ESSENCE ?? "1";

type PlanRequestBody = {
  goal: string;
  desktopId?: string;
  personaId?: string;
  searchQuery?: string;
  topK?: number;
  summaryFocus?: string;
};

type PlanResponse = {
  traceId: string;
  resonance_selection?: TResonanceSelectionSnapshot | null;
  lattice_version?: number | string | null;
};

type ExecuteResponse = {
  resonance_selection?: TResonanceSelectionSnapshot | null;
  lattice_version?: number | string | null;
};

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

const app = createApp();

export async function pushTelemetry(
  desktopId: string,
  bundle: Pick<ConsoleTelemetryBundle, "panels"> & Partial<ConsoleTelemetryBundle>,
): Promise<void> {
  const payload: ConsoleTelemetryBundle = {
    desktopId,
    capturedAt: bundle.capturedAt ?? new Date().toISOString(),
    panels: bundle.panels,
  };
  await request(app).post("/api/agi/console/telemetry").send(payload).expect(204);
}

export async function plan(body: PlanRequestBody): Promise<PlanResponse> {
  const response = await request(app).post("/api/agi/plan").send(body).expect(200);
  return response.body as PlanResponse;
}

export async function execute(traceId: string): Promise<ExecuteResponse> {
  const response = await request(app).post("/api/agi/execute").send({ traceId }).expect(200);
  return response.body as ExecuteResponse;
}

export const getLatticeVersion = readLatticeVersion;
