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

const answerText = (body: any): string => String(body?.assistant_answer ?? body?.answer ?? body?.text ?? "");

describe("helix ask turn e10.22 retrieval-to-note composition", () => {
  it("decomposes docs lookup plus note sink into search, summarize, and append steps", async () => {
    const app = createApp();
    const sessionId = `e1022-retrieval-note-${Date.now()}`;

    await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "make a note called codex style file audit", mode: "read", sessionId })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "look in the docs for helix ask agent loop details and put the useful summary into codex style file audit",
        mode: "read",
        sessionId,
      })
      .expect(200);

    const planItems = response.body?.planner_contract?.plan_items ?? [];
    const actionLabels = planItems.map((step: any) =>
      step?.action ? `${step.action.panel_id}.${step.action.action_id}` : step?.id,
    );
    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_context_reasoning");
    expect(response.body?.pending_server_request ?? null).toBeNull();
    expect(actionLabels).toEqual(
      expect.arrayContaining([
        "docs-viewer.search_docs",
        expect.stringMatching(/reasoning_summarize_retrieval/),
        "workstation-notes.append_to_note",
      ]),
    );
    expect(response.body?.workspace_action?.panel_id).toBe("workstation-notes");
    expect(response.body?.workspace_action?.action_id).toBe("append_to_note");
    expect(response.body?.workspace_action?.args?.title).toBe("codex style file audit");
    expect(response.body?.workspace_action?.args?.text).toMatch(/Docs summary for "helix ask agent loop details"/i);
    expect(answerText(response.body)).toBe("Added summary to codex style file audit.");
  });

  it("bounds composed retrieval-to-note targets to the note title phrase", async () => {
    const app = createApp();
    const sessionId = `e1022-retrieval-note-title-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "look in the docs for helix ask terminal artifact source of truth and put a useful summary into transcript audit note",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_context_reasoning");
    expect(response.body?.workspace_action?.panel_id).toBe("workstation-notes");
    expect(response.body?.workspace_action?.action_id).toBe("append_to_note");
    expect(response.body?.workspace_action?.args?.title).toBe("transcript audit");
    expect(answerText(response.body)).toBe("Added summary to transcript audit.");
  });
});
