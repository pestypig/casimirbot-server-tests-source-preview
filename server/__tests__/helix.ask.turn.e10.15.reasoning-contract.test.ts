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

describe("helix ask turn e10.15 reasoning output contracts", () => {
  it("answers current document identity with file type", async () => {
    const app = createApp();
    const sessionId = `e1015-doc-type-${Date.now()}`;
    const open = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "open the latest NHM2 doc", mode: "read", sessionId })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "what document are we on and what kind of file is it?", mode: "read", sessionId })
      .expect(200);

    const text = answerText(response.body);
    expect(response.body?.quality_contract_intent_family).toBe("doc_identity_plus_type");
    expect(response.body?.quality_contract_pass).toBe(true);
    expect(text).toContain(open.body?.workspace_action?.args?.path);
    expect(text).toMatch(/file type/i);
    expect(text).toMatch(/markdown|\.md/i);
    expect(text).not.toMatch(/Completed reasoning for|Tool selected:/i);
  });

  it("repairs summarize-claims prompts into the requested number of claims", async () => {
    const app = createApp();
    const sessionId = `e1015-claims-${Date.now()}`;
    await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "open the latest NHM2 doc", mode: "read", sessionId })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "summarize this doc into three claims I could use later", mode: "read", sessionId })
      .expect(200);

    const text = answerText(response.body);
    expect(response.body?.quality_contract_intent_family).toBe("summarize_claims");
    expect(response.body?.quality_contract_pass).toBe(true);
    expect(text).toMatch(/claims:/i);
    expect(text.match(/(?:^|\n)\s*\d+\.\s+\S+/g) ?? []).toHaveLength(3);
    expect(text).not.toMatch(/Completed reasoning for|Tool selected:/i);
  });

  it("does not finalize compare doc-to-note prompts as needs-retrieval when workspace artifacts exist", async () => {
    const app = createApp();
    const sessionId = `e1015-compare-${Date.now()}`;
    await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "open the latest NHM2 doc", mode: "read", sessionId })
      .expect(200);
    await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "create note called ui append retest final", mode: "read", sessionId })
      .expect(200);
    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "append centerline alpha baseline note to note ui append retest final",
        mode: "read",
        sessionId,
      })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "compare this document with my note ui append retest final and tell me the differences",
        mode: "read",
        sessionId,
      })
      .expect(200);

    const text = answerText(response.body);
    expect(response.body?.quality_contract_intent_family).toBe("compare");
    expect(response.body?.quality_contract_pass).toBe(true);
    expect(response.body?.needs_retrieval).toBe(false);
    expect(text).toMatch(/key differences:/i);
    expect(text).not.toMatch(/I need retrieval before finalizing/i);
  });
});
