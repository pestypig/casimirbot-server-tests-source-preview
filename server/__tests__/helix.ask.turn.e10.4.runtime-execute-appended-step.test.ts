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

describe("helix ask turn e10.4 runtime appended-step execution", () => {
  it("executes an appended clipboard context step and retries the originally blocked copy-to-note step", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "copy latest clipboard entry to note research",
        mode: "read",
        sessionId: `e104-clipboard-to-note-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.pending_server_request ?? null).toBeNull();
    expect(response.body?.turn_runtime?.appended_step_count).toBeGreaterThan(0);
    expect(response.body?.turn_runtime?.executed_appended_step_count).toBeGreaterThan(0);
    expect(response.body?.turn_runtime?.runtime_loop_iteration_count).toBeGreaterThanOrEqual(2);
    expect(response.body?.turn_runtime?.runtime_loop_stop_reason).toBe("final_answer");
    expect(response.body?.turn_runtime?.last_decision?.kind).toBe("final_answer");
    expect(response.body?.turn_runtime?.artifact_keys).toContain("clipboard_context");
    expect(response.body?.turn_runtime?.completed_subgoals).toContain("workspace_action");
    expect(response.body?.turn_runtime?.completed_subgoals).toEqual(
      expect.arrayContaining([expect.stringContaining("workspace_action_clipboard_context")]),
    );
  });

  it("keeps simple workspace turns as single-step terminals", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "open notes", mode: "read", sessionId: `e104-open-notes-${Date.now()}` })
      .expect(200);

    expect(response.body?.pending_server_request ?? null).toBeNull();
    expect(response.body?.turn_runtime?.appended_step_count).toBe(0);
    expect(response.body?.turn_runtime?.runtime_loop_iteration_count).toBe(0);
    expect(response.body?.turn_runtime?.last_decision?.kind).toBe("final_answer");
  });
});
