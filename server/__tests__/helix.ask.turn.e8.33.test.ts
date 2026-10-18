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

describe("helix ask turn e8.33 final-answer quality for hybrid reasoning", () => {
  it("avoids generic request-scope template for explain flow", async () => {
    const app = createApp();
    const sessionId = "e833-explain";
    await request(app).post("/api/agi/ask/turn").send({ question: "open docs", mode: "read", sessionId }).expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "open docs and then explain key claim", mode: "read", sessionId })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_context_reasoning");
    const text = String(response.body?.text ?? "");
    expect(text.toLowerCase()).not.toContain("request scope:");
    expect(text.toLowerCase()).not.toContain("i ran a reasoning follow-up");
    expect(text.toLowerCase()).toContain("explained");
  });

  it("avoids generic request-scope template for compare flow", async () => {
    const app = createApp();
    const sessionId = "e833-compare";
    await request(app).post("/api/agi/ask/turn").send({ question: "open docs", mode: "read", sessionId }).expect(200);
    await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "create note called nhm2 scratch", mode: "read", sessionId })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "compare this doc with note nhm2 scratch and tell me differences", mode: "read", sessionId })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_context_reasoning");
    const text = String(response.body?.text ?? "");
    expect(text.toLowerCase()).not.toContain("request scope:");
    expect(text.toLowerCase()).not.toContain("i ran a compare-oriented reasoning pass");
    expect(text.toLowerCase()).toContain("compared");
  });
});
