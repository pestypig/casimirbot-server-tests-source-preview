import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { planRouter } from "../routes/agi.plan";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

describe("helix ask turn e9 general turn loop", () => {
  const originalE9 = process.env.HELIX_E9_GENERAL_TURN_LOOP;

  beforeEach(() => {
    process.env.HELIX_E9_GENERAL_TURN_LOOP = "1";
  });

  afterEach(() => {
    if (originalE9 === undefined) {
      delete process.env.HELIX_E9_GENERAL_TURN_LOOP;
    } else {
      process.env.HELIX_E9_GENERAL_TURN_LOOP = originalE9;
    }
  });

  it("keeps greeting turns as conversation terminals with planner-first metadata", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "hello", mode: "read", sessionId: "e9-hello" })
      .expect(200);

    expect(response.body?.turn_loop?.mode).toBe("general_v1");
    expect(response.body?.turn_loop?.planner_first).toBe(true);
    expect(response.body?.turn_contract?.terminal_kind).toBe("conversation");
    expect(String(response.body?.text ?? "").trim().length).toBeGreaterThan(0);
  });

  it("keeps workspace-only turns in dispatch:act", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "open notes", mode: "read", sessionId: "e9-open-notes" })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.workspace_action?.panel_id).toBe("workstation-notes");
    expect(response.body?.workspace_action?.action_id).toBe("open");
    expect(response.body?.turn_contract?.terminal_kind).toBe("conversation");
  });

  it("keeps hybrid compare turns reasoning-terminal with non-empty final text", async () => {
    const app = createApp();
    const sessionId = "e9-hybrid-compare";

    await request(app).post("/api/agi/ask/turn").send({ question: "open docs", mode: "read", sessionId }).expect(200);
    await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "create note called e9 compare note", mode: "read", sessionId })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "compare this doc with note e9 compare note and tell me differences", mode: "read", sessionId })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_context_reasoning");
    expect(response.body?.turn_contract?.terminal_kind).toBe("reasoning");
    expect(String(response.body?.text ?? "").trim().length).toBeGreaterThan(0);
  });
});
