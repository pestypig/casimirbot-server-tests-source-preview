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

describe("helix ask turn e8.17 confirm integrity + planner repair", () => {
  it("executes a concrete workspace action after destructive confirm yes", async () => {
    const app = createApp();
    const sessionId = "e817-confirm-concrete-action";
    await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "delete note trace delete", mode: "read", sessionId })
      .expect(200);

    const confirmed = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "yes", mode: "read", sessionId })
      .expect(200);

    const trace = Array.isArray(confirmed.body?.execution_trace)
      ? confirmed.body.execution_trace
      : confirmed.body?.execution_trace
        ? [confirmed.body.execution_trace]
        : [];
    const workspaceStep = trace.find((step: { id?: string }) => step.id === "workspace_action");
    expect(confirmed.body?.route_reason_code).toBe("dispatch:act");
    expect(workspaceStep?.status).toBe("completed");
    expect(workspaceStep?.action?.panel_id).toBe("workstation-notes");
    expect(workspaceStep?.action?.action_id).toBe("delete_note");
  });

  it("executes destructive confirm on explicit variant phrasing", async () => {
    const app = createApp();
    const sessionId = "e817-confirm-missing-action";
    await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "clear clipboard history", mode: "read", sessionId })
      .expect(200);

    const confirmed = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "yes clear it", mode: "read", sessionId })
      .expect(200);

    expect(confirmed.body?.route_reason_code).toBe("dispatch:act");
    const trace = Array.isArray(confirmed.body?.execution_trace)
      ? confirmed.body.execution_trace
      : confirmed.body?.execution_trace
        ? [confirmed.body.execution_trace]
        : [];
    const workspaceStep = trace.find((step: { id?: string }) => step.id === "workspace_action");
    expect(workspaceStep?.status).toBe("completed");
    expect(workspaceStep?.action?.panel_id).toBe("workstation-clipboard-history");
    expect(workspaceStep?.action?.action_id).toBe("clear_history");
  });

  it("does not expose workspace_action on clarify planner-repair turns", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "go to docs and notes", mode: "read", sessionId: "e817-clarify-no-action" })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("clarify:planner_repair_required");
    expect(response.body?.workspace_action ?? null).toBeNull();
  });

  it("maps rename note utterances to workstation-notes.rename_note", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "rename note alpha bug note to beta bug note",
        mode: "read",
        sessionId: "e817-rename-mapping",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.planner_contract?.selection_valid).toBe(true);
    expect(response.body?.planner_contract?.selected_action?.panel_id).toBe("workstation-notes");
    expect(response.body?.planner_contract?.selected_action?.action_id).toBe("rename_note");
    expect(response.body?.planner_contract?.selected_action?.args?.title).toBe("beta bug note");
  });

  it("routes latest-doc phrasing to workspace-first dispatch", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "ok pull up the latest nhm2 doc from today",
        mode: "read",
        sessionId: "e817-latest-doc",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.planner_contract?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.planner_contract?.selected_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.planner_contract?.selected_action?.action_id).toBe("open");
  });

  it("uses typo-aware clarify for go to focs instead of low-salience suppression", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "go to focs",
        mode: "read",
        sessionId: "e817-focs-typo",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("clarify:ambiguous_intent");
    expect(String(response.body?.text ?? "").toLowerCase()).toContain("did you mean");
  });
});
