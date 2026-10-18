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

const expectRetrievalForced = (body: any): void => {
  expect(body?.retrieval_required_signal?.required).toBe(true);
  expect(body?.retrieval_required_signal?.strength).toBe("hard");
  expect(body?.route_reason_code).not.toBe("conversation:simple");
  expect(body?.dispatch_policy).not.toBe("direct_answer_only");
  expect(body?.planner_contract?.dispatch_policy).not.toBe("direct_answer_only");
  expect(body?.planner_contract?.plan_items?.some((step: any) => step?.id === "model_only_reasoning")).not.toBe(true);
  expect(body?.execution_trace?.some((step: any) => step?.action?.action_id === "search_docs")).toBe(true);
};

describe("helix ask E53 retrieval-forcing bridge", () => {
  it("forces latest-doc navigation phrases out of model-only routing", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "get me to the latest doc on the NHM2 alpha line trip time graph",
        mode: "read",
        debug: true,
        sessionId: `e53-latest-doc-${Date.now()}`,
      })
      .expect(200);

    expectRetrievalForced(response.body);
    expect(response.body?.retrieval_required_signal?.requested_outputs).toEqual(
      expect.arrayContaining(["latest_doc", "open_document"]),
    );
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("latest_doc_navigation");
    expect(response.body?.canonical_goal_frame?.required_terminal_kind).toBe("doc_open_receipt");
    expect(response.body?.execution_trace?.some((step: any) => step?.action?.action_id === "open_doc_by_path")).toBe(true);
    expect(response.body?.final_answer_source).not.toBe("no_tool_direct");
  }, 90000);

  it("forces where-in-docs scientific evidence questions into retrieval", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "Where in the NHM2 docs is stage1_centerline_alpha_0p995_v1 used as the selected-family reference case? Give the document path and nearby fields.",
        mode: "read",
        debug: true,
        sessionId: `e53-evidence-location-${Date.now()}`,
      })
      .expect(200);

    expectRetrievalForced(response.body);
    expect(response.body?.retrieval_required_signal?.requested_outputs).toEqual(
      expect.arrayContaining(["evidence_location"]),
    );
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_evidence_location");
    expect(response.body?.execution_trace?.some((step: any) => step?.action?.action_id === "locate_in_doc")).toBe(true);
    expect(response.body?.terminal_artifact_kind).not.toBe("direct_answer_text");
    expect(response.body?.final_answer_source).not.toBe("no_tool_direct");
  }, 90000);

  it("forces best-matching audit numeric questions into scientific numeric routing", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "Using the best matching NHM2 audit doc, what numeric solverClampHeadroom and wallSafetyMargin are reported for the 96^3 reference brick?",
        mode: "read",
        debug: true,
        sessionId: `e53-numeric-${Date.now()}`,
      })
      .expect(200);

    expectRetrievalForced(response.body);
    expect(response.body?.retrieval_required_signal?.requested_outputs).toEqual(
      expect.arrayContaining(["numeric_value"]),
    );
    expect(response.body?.retrieval_required_signal?.anchors?.variables).toEqual(
      expect.arrayContaining(["solverClampHeadroom", "wallSafetyMargin"]),
    );
    expect(response.body?.retrieval_required_signal?.anchors?.dimensions).toEqual(expect.arrayContaining(["96^3"]));
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_scientific_numeric");
    expect(response.body?.canonical_goal_frame?.required_terminal_kind).toBe("doc_numeric_answer");
    expect(response.body?.terminal_artifact_kind).not.toBe("direct_answer_text");
    expect(response.body?.final_answer_source).not.toBe("no_tool_direct");
  }, 90000);

  it("keeps explicit background-only prompts on the direct model path", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Background only: what is a quantum inequality in semiclassical gravity?",
        mode: "read",
        debug: true,
        sessionId: `e53-background-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.retrieval_required_signal?.required).toBe(false);
    expect(response.body?.route_reason_code).toBe("conversation:simple");
    expect(response.body?.dispatch_policy).toBe("direct_answer_only");
    expect(["direct_answer_text", "typed_failure"]).toContain(response.body?.terminal_artifact_kind);
    expect(response.body?.execution_trace?.some((step: any) => step?.action?.action_id === "search_docs")).not.toBe(true);
  }, 60000);
});
