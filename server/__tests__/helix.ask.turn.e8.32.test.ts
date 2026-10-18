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

describe("helix ask turn e8.32 context-grounded terminals + pending supersession", () => {
  it("answers doc identity query from attached workspace context", async () => {
    const app = createApp();
    const sessionId = "e832-doc-identity";
    await request(app).post("/api/agi/ask/turn").send({ question: "open docs", mode: "read", sessionId }).expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "what doc are we on?", mode: "read", sessionId })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:observe");
    expect(String(response.body?.text ?? "").toLowerCase()).toContain("currently on");
    expect(String(response.body?.text ?? "").toLowerCase()).not.toContain("request scope");
  });

  it("returns typed clarify when doc identity is requested without context", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "what doc are we on?", mode: "read", sessionId: "e832-no-doc-context" })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("clarify:missing_args");
    expect(response.body?.pending_request?.kind).toBe("clarify");
    expect(response.body?.pending_request?.required_fields).toEqual(["doc_reference"]);
  });

  it("forces clarify on contradictory workspace command", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "open docs but do not open docs", mode: "read", sessionId: "e832-contradiction" })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("clarify:ambiguous_intent");
    expect(response.body?.pending_request?.kind).toBe("clarify");
  });

  it("supersedes pending clarify when a new explicit intent arrives", async () => {
    const app = createApp();
    const sessionId = "e832-supersede";
    await request(app).post("/api/agi/ask/turn").send({ question: "append this to note", mode: "read", sessionId }).expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "open docs", mode: "read", sessionId })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.planner_contract?.selected_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.planner_contract?.selected_action?.action_id).toBe("open");
  });

  it("maps grab newest nhm2 paper to workspace docs open action", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "grab newest nhm2 paper", mode: "read", sessionId: "e832-grab-newest" })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.planner_contract?.selected_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.planner_contract?.selected_action?.action_id).toBe("open");
  });

  it("does not emit dispatch:act route on clarify pending output", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "explain this paper but run isolated", mode: "read", sessionId: "e832-route-consistency" })
      .expect(200);

    expect(response.body?.dispatch_policy).toBe("needs_user_input");
    expect(String(response.body?.route_reason_code ?? "")).not.toBe("dispatch:act");
    expect(response.body?.turn_contract?.terminal_kind).toBe("clarify");
  });
});
