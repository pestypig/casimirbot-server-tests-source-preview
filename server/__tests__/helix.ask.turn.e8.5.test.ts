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

describe("helix ask turn e8.5 terminal contract", () => {
  it("returns final_answer with non-empty text for normal greeting", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "hello",
        mode: "read",
        sessionId: "e85-greeting",
      })
      .expect(200);

    expect(response.body?.final_status).toBe("final_answer");
    expect(response.body?.terminal_contract_version).toBe("v1");
    expect(String(response.body?.text ?? "").trim().length).toBeGreaterThan(0);
    expect(response.body?.turn_contract?.single_terminal_required).toBe(true);
  });

  it("applies deterministic fallback when terminal output is forced empty in test mode", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "[[TEST_FORCE_EMPTY_TERMINAL]] hello",
        mode: "read",
        sessionId: "e85-force-empty",
      })
      .expect(200);

    expect(response.body?.final_status).toBe("final_answer");
    expect(response.body?.fallback_applied).toBe(true);
    expect(String(response.body?.text ?? "").trim().length).toBeGreaterThan(0);
  });

  it("guards against double terminal emission attempts", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "[[TEST_PREEMIT_TERMINAL]] hello",
        mode: "read",
        sessionId: "e85-double-terminal",
      })
      .expect(500);

    expect(response.body?.final_status).toBe("final_failure");
    expect(response.body?.terminal_error_code).toBe("double_terminal_emit");
  });

  it("clarify terminal still returns single final_answer with prompt text", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open document",
        mode: "read",
        sessionId: "e85-clarify",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("clarify:missing_args");
    expect(response.body?.final_status).toBe("final_answer");
    expect(String(response.body?.text ?? "").toLowerCase()).toContain("need");
    expect(response.body?.turn_contract?.single_terminal_required).toBe(true);
  });
});
