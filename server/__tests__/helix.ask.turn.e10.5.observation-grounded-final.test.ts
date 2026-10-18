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

describe("helix ask turn e10.5 observation-grounded finals", () => {
  it("surfaces docs identity observation instead of generic workstation success text", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "what doc are we on?", mode: "read", sessionId: `e105-doc-identity-${Date.now()}` })
      .expect(200);

    expect(response.body?.text).toMatch(/No active (?:doc|document)/i);
    expect(response.body?.text).not.toBe("Executed workstation action.");
    expect(response.body?.final_status).toBe("final_answer");
  });

  it("keeps ordinary workspace opens as successful action terminals", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "open notes", mode: "read", sessionId: `e105-open-notes-${Date.now()}` })
      .expect(200);

    expect(response.body?.ok).toBe(true);
    expect(response.body?.text).toMatch(/workstation-notes\.open|Workstation Notes/i);
  });
});
