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

describe("helix ask turn e10.7 unified planner intake", () => {
  it("maps make-note phrasing to the create_note capability without legacy reasoning", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "make a note called beta centerline checks",
        mode: "read",
        sessionId: `e107-make-note-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.workspace_action?.panel_id).toBe("workstation-notes");
    expect(response.body?.workspace_action?.action_id).toBe("create_note");
    expect(response.body?.workspace_action?.args?.title).toBe("beta centerline checks");
    expect(response.body?.planner_contract?.selection_valid).toBe(true);
    expect(response.body?.planner_contract?.selected_action?.action_id).toBe("create_note");
  });

  it("maps quoted make-note phrasing to a create_note body", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: 'make a note for me "qwerty"',
        mode: "read",
        sessionId: `e107-make-note-body-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.workspace_action?.panel_id).toBe("workstation-notes");
    expect(response.body?.workspace_action?.action_id).toBe("create_note");
    expect(response.body?.workspace_action?.args).toEqual({ body: "qwerty" });
    expect(response.body?.planner_contract?.selected_action?.args).toEqual({ body: "qwerty" });
  });

  it("maps exact-opened-doc wording to identify_current_doc instead of opening docs", async () => {
    const app = createApp();
    const sessionId = `e107-doc-identity-${Date.now()}`;
    const openResponse = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "open the latest NHM2 doc", mode: "read", sessionId })
      .expect(200);
    const openedPath = openResponse.body?.workspace_action?.args?.path;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "what exact doc did you open?", mode: "read", sessionId })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.workspace_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.workspace_action?.action_id).toBe("identify_current_doc");
    expect(response.body?.text).toContain(openedPath);
    expect(response.body?.text).not.toMatch(/^Executed docs-viewer\.open\./);
  });

  it("maps document identity variants to identify_current_doc", async () => {
    const app = createApp();
    const sessionId = `e107-doc-identity-variants-${Date.now()}`;
    await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "open the latest NHM2 doc", mode: "read", sessionId })
      .expect(200);

    for (const question of [
      "which document did you open?",
      "what document is this?",
      "what doc is this?",
      "what paper is active now?",
    ]) {
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({ question, mode: "read", sessionId })
        .expect(200);

      expect(response.body?.route_reason_code).toBe("dispatch:act");
      expect(response.body?.dispatch_policy).toBe("workspace_only");
      expect(response.body?.workspace_action?.action_id).toBe("identify_current_doc");
    }
  });
});
