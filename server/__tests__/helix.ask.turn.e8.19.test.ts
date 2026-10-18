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

describe("helix ask turn e8.19 pending resolution ownership", () => {
  it("resolves ambiguous doc typo follow-up 'doc' to concrete docs action", async () => {
    const app = createApp();
    const sessionId = "e819-ambiguous-doc";
    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "go to focs",
        mode: "read",
        sessionId,
      })
      .expect(200);

    const resolved = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "doc",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(resolved.body?.route_reason_code).toBe("dispatch:act");
    expect(resolved.body?.planner_contract?.selected_action?.panel_id).toBe("docs-viewer");
    expect(resolved.body?.planner_contract?.selected_action?.action_id).toBe("open");
    const trace = Array.isArray(resolved.body?.execution_trace)
      ? resolved.body.execution_trace
      : resolved.body?.execution_trace
        ? [resolved.body.execution_trace]
        : [];
    const workspaceStep = trace.find((step: { id?: string }) => step.id === "workspace_action");
    expect(workspaceStep?.status).toBe("completed");
    expect(workspaceStep?.action?.action_id).toBe("open");
  });

  it("keeps pending clarify ownership on unrelated complex actionable prompt until resolved/canceled", async () => {
    const app = createApp();
    const sessionId = "e819-intent-switch-abort";
    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "go to docs and notes",
        mode: "read",
        sessionId,
      })
      .expect(200);

    const switched = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "create a note called crossdoc figures and append to note: fig1=1, fig2=2",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(switched.body?.pending_transition_trace).not.toContain("pending_intent_switch_abort");
    if (switched.body?.route_reason_code === "dispatch:act") {
      expect(typeof switched.body?.planner_contract?.selected_action?.panel_id).toBe("string");
      expect(typeof switched.body?.planner_contract?.selected_action?.action_id).toBe("string");
    } else {
      expect(switched.body?.route_reason_code).toBe("clarify:missing_args");
      expect(switched.body?.pending_server_request?.kind).toBe("clarify");
    }
  });

  it("does not emit optimistic dispatch without action when pending clarify cannot resolve", async () => {
    const app = createApp();
    const sessionId = "e819-no-optimistic-proceed";
    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "go to docs and notes",
        mode: "read",
        sessionId,
      })
      .expect(200);

    const unresolved = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "proceed",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(unresolved.body?.route_reason_code).toBe("clarify:missing_args");
    expect(unresolved.body?.pending_server_request?.kind).toBe("clarify");
    expect(unresolved.body?.workspace_action ?? null).toBeNull();
  });

  it("keeps destructive confirm regression stable", async () => {
    const app = createApp();
    const sessionId = "e819-confirm-regression";
    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "delete note e819-note",
        mode: "read",
        sessionId,
      })
      .expect(200);

    const confirmed = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "yes",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(confirmed.body?.route_reason_code).toBe("dispatch:act");
    expect(confirmed.body?.workspace_action?.action_id).toBe("delete_note");
  });
});
