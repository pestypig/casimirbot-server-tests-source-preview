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

describe("helix ask turn e10.8 result artifact transfer", () => {
  it("uses the latest meaningful result artifact when appending that into a named note", async () => {
    const app = createApp();
    const sessionId = `e108-note-${Date.now()}`;
    const openResponse = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "open the latest NHM2 doc", mode: "read", sessionId })
      .expect(200);
    const openedPath = openResponse.body?.workspace_action?.args?.path;

    const identityResponse = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "what exact doc did you open?", mode: "read", sessionId })
      .expect(200);
    expect(identityResponse.body?.latest_result_artifact?.text).toContain(openedPath);

    await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "start a note named mission timing scratchpad", mode: "read", sessionId })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "put that into the mission timing scratchpad note", mode: "read", sessionId })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.workspace_action?.panel_id).toBe("workstation-notes");
    expect(response.body?.workspace_action?.action_id).toBe("append_to_note");
    expect(response.body?.workspace_action?.args?.title).toBe("mission timing scratchpad");
    expect(response.body?.workspace_action?.args?.text).toContain(openedPath);
    expect(response.body?.planner_contract?.selected_action?.action_id).toBe("append_to_note");
    const appendStep = response.body?.step_results?.find(
      (step: { artifact?: { action_id?: string } }) => step.artifact?.action_id === "append_to_note",
    );
    expect(appendStep?.contract_pass).toBe(true);
    expect(appendStep?.actual_artifacts).toContain("note_update_receipt");
  });

  it("uses the latest meaningful result artifact when copying the result to clipboard", async () => {
    const app = createApp();
    const sessionId = `e108-clipboard-${Date.now()}`;
    await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "open the latest NHM2 doc", mode: "read", sessionId })
      .expect(200);
    const identityResponse = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "which document did you open?", mode: "read", sessionId })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "copy the result to clipboard", mode: "read", sessionId })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.workspace_action?.panel_id).toBe("workstation-clipboard-history");
    expect(response.body?.workspace_action?.action_id).toBe("write_clipboard");
    expect(response.body?.workspace_action?.args?.text).toBe(identityResponse.body?.latest_result_artifact?.text);
  });

  it("requests missing artifact input instead of routing artifact-transfer prompts to reasoning", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "put that into the mission timing scratchpad note",
        mode: "read",
        sessionId: `e108-missing-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.route_reason_code).toMatch(/^clarify:/);
    expect(response.body?.dispatch_policy).toBe("needs_user_input");
    expect(response.body?.workspace_action?.action_id).not.toBe("append_to_note");
    expect(response.body?.planner_contract?.selection_fail_reason).toBe("missing_required_args");
  });
});
