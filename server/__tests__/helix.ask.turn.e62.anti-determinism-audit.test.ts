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

describe("helix ask E62 anti-deterministic poison audit", () => {
  it("preserves equation contracts while preventing higher-priority intent hijacks", async () => {
    const app = createApp();
    const cases = [
      {
        question: "Somewhere in the NHM2 material, is there a paper or report with a tau or alpha relation I can plug numbers into?",
        expectedIntent: "doc_equation_location",
        expectedGoal: "doc_equation_location",
      },
      {
        question: "Create a workstation note called NHM2 calculator scratch with the equation attempt summary.",
        expectedIntent: "note_mutation",
        expectedGoal: "note_mutation",
      },
      {
        question: "What can you help me do in this workspace?",
        expectedIntent: "workspace_help",
        expectedGoal: "workspace_help",
      },
    ];

    for (const [index, entry] of cases.entries()) {
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question: entry.question,
          mode: "read",
          debug: true,
          sessionId: `e62-anti-poison-${Date.now()}-${index}`,
        })
        .expect(200);

      expect(response.body?.intent_arbitration?.selected?.kind).toBe(entry.expectedIntent);
      expect(response.body?.canonical_goal_frame?.goal_kind).toBe(entry.expectedGoal);
      expect(response.body?.selected_final_answer).toBeTruthy();
      if (entry.expectedGoal !== "doc_equation_location") {
        expect(response.body?.terminal_error_code).not.toBe("equation_source_unavailable");
      }
    }
  }, 180000);
});
