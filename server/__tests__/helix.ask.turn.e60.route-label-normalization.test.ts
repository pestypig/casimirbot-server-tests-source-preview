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

describe("helix ask E60 route label normalization", () => {
  it("summarizes equation typed failures from the resolved terminal state", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Find me an NHM2 document with equations for the scientific calculator.",
        mode: "read",
        debug: true,
        sessionId: `e60-equation-route-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_equation_location");
    expect(response.body?.response_type).toBe("final_failure");
    expect(response.body?.terminal_error_code).toBe("equation_source_unavailable");
    expect(response.body?.pending_server_request).toBeFalsy();

    expect(response.body?.resolved_turn_summary).toMatchObject({
      final_status: "final_failure",
      terminal_error_code: "equation_source_unavailable",
      pending_server_request_present: false,
      resolved_route_label: "doc_equation_location / typed_failure:equation_source_unavailable",
    });
    expect(response.body?.turn_truth_table?.resolved_route_label).toBe(
      "doc_equation_location / typed_failure:equation_source_unavailable",
    );
    expect(response.body?.turn_truth_table?.resolved_turn_summary?.final_status).toBe("final_failure");
    expect(response.body?.turn_truth_table?.resolved_turn_summary?.pending_server_request_present).toBe(false);

    const staleCandidates = response.body?.route_history_debug?.rejected_route_candidates ?? [];
    expect(Array.isArray(staleCandidates)).toBe(true);
    for (const candidate of staleCandidates) {
      expect(candidate?.rejected_reason).toMatch(/overridden_by_final_failure|overridden_by_final_answer/);
    }
  }, 90000);
});
