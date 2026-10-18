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

describe("helix ask E62 intent precedence", () => {
  it("keeps workspace help out of retrieval", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "What can you help me do in this workspace if I am trying to work through the NHM2 papers and keep notes?",
        mode: "read",
        debug: true,
        sessionId: `e62-workspace-help-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("workspace_help");
    expect(response.body?.intent_arbitration?.selected?.kind).toBe("workspace_help");
    expect(response.body?.retrieval_required_signal?.required).toBe(false);
    expect(response.body?.final_answer_source).toBe("no_tool_direct");
    expect(String(response.body?.selected_final_answer ?? "")).toMatch(/docs/i);
    expect(String(response.body?.selected_final_answer ?? "")).toMatch(/notes/i);
    expect(String(response.body?.selected_final_answer ?? "")).toMatch(/source paths/i);
  }, 90000);

  it("does not let calculator inside a note title hijack note mutation", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Create a workstation note called NHM2 calculator scratch with a short summary of the last equation attempt.",
        mode: "read",
        debug: true,
        sessionId: `e62-note-precedence-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.intent_arbitration?.selected?.kind).toBe("note_mutation");
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("note_mutation");
    expect(response.body?.terminal_error_code).not.toBe("equation_source_unavailable");
    expect(response.body?.intent_arbitration?.rejected ?? []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidate: expect.objectContaining({ kind: "doc_equation_location" }),
        }),
      ]),
    );
  }, 90000);

  it("does not let calculator inside a named note target hijack compare", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Compare current NHM2 doc against my NHM2 calculator scratch note.",
        mode: "read",
        debug: true,
        sessionId: `e62-compare-precedence-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.intent_arbitration?.selected?.kind).toBe("doc_vs_note_compare");
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_vs_note_compare");
    expect(response.body?.terminal_error_code).not.toBe("equation_source_unavailable");
    expect(response.body?.pending_server_request ? response.body?.final_status : response.body?.final_status).not.toBe("pending_input");
  }, 90000);
});
