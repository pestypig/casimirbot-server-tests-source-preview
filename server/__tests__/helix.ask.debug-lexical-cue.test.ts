import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { planRouter } from "../routes/agi.plan";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

const chosenCapabilities = (payload: Record<string, any>): string[] => {
  const iterations = payload?.agent_runtime_loop?.iterations;
  if (!Array.isArray(iterations)) return [];
  return iterations.map((entry: any) => String(entry?.decision?.chosen_capability ?? "")).filter(Boolean);
};

describe("Helix Ask debug lexical cue routing", () => {
  it("keeps a casual debug check prompt on the model-only path instead of debug diagnosis", async () => {
    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        question: "Helix console debug check: answer in one short sentence and include whether this is a new Helix Ask turn.",
        mode: "read",
        debug: true,
        sessionId: `debug-lexical-cue-${Date.now()}`,
      })
      .expect(200);

    const body = response.body;
    expect(body?.canonical_goal_frame?.goal_kind).toBe("model_only_concept");
    expect(body?.canonical_goal_frame?.goal_kind).not.toBe("debug_diagnosis");
    expect(body?.terminal_error_code).not.toBe("agent_loop_budget_exhausted");
    expect(chosenCapabilities(body)).not.toContain("debug.inspect_current_turn");
    expect(chosenCapabilities(body)).not.toContain("repo-code.search_concept");
  }, 60000);
});
