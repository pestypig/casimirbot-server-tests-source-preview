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

describe("helix ask turn e10.3 runtime appended tool steps", () => {
  it("appends a clipboard capability step when a planned copy-to-note step is blocked by missing clipboard context", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "copy latest clipboard entry to note research",
        mode: "read",
        sessionId: `e103-clipboard-to-note-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.turn_runtime?.appended_step_count).toBeGreaterThan(0);
    expect(response.body?.turn_runtime?.appended_steps?.[0]?.step_id).toContain("workspace_action_clipboard_context");
    expect(response.body?.turn_runtime?.appended_steps?.[0]?.source).toBe("capability_registry");
    expect(["continue", "final_answer"]).toContain(response.body?.turn_runtime?.last_decision?.kind);
    expect(response.body?.turn_runtime?.artifact_keys).toContain("plan_delta");
  });
});
