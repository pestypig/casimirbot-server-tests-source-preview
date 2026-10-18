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

describe("helix ask turn e8.15 top-level response envelope parity", () => {
  it("surfaces route/lane/policy/action fields for workspace turns", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open up notes",
        mode: "read",
        sessionId: "e815-workspace",
      })
      .expect(200);

    expect(response.body?.route).toBe("dispatch:act");
    expect(response.body?.lane).toBe("conversation");
    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.workspace_action?.panel_id).toBe("workstation-notes");
    expect(response.body?.workspace_action?.action_id).toBe("open");
    expect(response.body?.response_type).toBe("final_answer");
  });

  it("surfaces route/lane/policy/action fields for hybrid workspace+reasoning turns", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "copy this abstract to a notepad and explain it in plain language",
        mode: "read",
        sessionId: "e815-hybrid",
      })
      .expect(200);

    expect(response.body?.route).toBe("dispatch:act");
    expect(response.body?.lane).toBe("reasoning");
    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.workspace_action?.panel_id).toBe("workstation-clipboard-history");
    expect(response.body?.workspace_action?.action_id).toBe("copy_selection_to_note");
    expect(response.body?.response_type).toBe("final_answer");
  });
});
