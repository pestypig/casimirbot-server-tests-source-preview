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

const actionsOf = (body: any): any[] =>
  (body?.execution_trace ?? []).map((step: any) => step?.action).filter(Boolean);

const validationArtifactOf = (body: any): any =>
  (body?.step_results ?? [])
    .map((step: any) => step?.result_artifact)
    .find((artifact: any) => artifact?.kind === "doc_candidate_validation") ??
  body?.doc_candidate_validation ??
  null;

describe("helix ask E29 doc candidate validation", () => {
  it("validates topic search candidates before opening a doc", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open a doc about NHM2 warp solve targets",
        mode: "read",
        sessionId: `e29-topic-validation-${Date.now()}`,
      })
      .expect(200);

    const actions = actionsOf(response.body);
    expect(actions.some((action) => action?.panel_id === "docs-viewer" && action?.action_id === "search_docs")).toBe(true);
    expect(
      actions.some((action) => action?.panel_id === "docs-viewer" && action?.action_id === "validate_doc_candidates"),
    ).toBe(true);
    const validation = validationArtifactOf(response.body);
    expect(validation).toBeTruthy();
    expect(validation?.requiredTerms).toEqual(expect.arrayContaining(["nhm2", "warp", "solve"]));
    expect(validation?.candidates?.length).toBeGreaterThan(0);
    if (response.body?.open_doc_goal_satisfied) {
      expect(response.body?.open_doc_selected_path).toBe(validation?.selected_path);
      const openedAction = actions.find(
        (action) => action?.panel_id === "docs-viewer" && action?.action_id === "open_doc_by_path",
      );
      expect(openedAction?.args?.path).toBe(validation?.selected_path);
      expect(openedAction?.args?.selection_reason).toBe("validated_topic_candidate");
      expect(response.body?.text).toMatch(/Selection: validated topic candidate\./i);
      expect(response.body?.text).not.toMatch(/top-ranked search result/i);
      expect(response.body?.doc_candidate_validation_selected_path).toBe(validation?.selected_path);
      expect(response.body?.doc_candidate_validation_selected_status).toBeTruthy();
      expect(response.body?.doc_candidate_validation_count).toBeGreaterThan(0);
    } else {
      expect(["open_doc_unresolved", "ambiguous_doc_candidates"]).toContain(response.body?.terminal_error_code);
    }
  }, 60000);

  it("does not let search_docs alone satisfy an open-doc request", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open a doc about zqxv nowhere antimatter oatmeal",
        mode: "read",
        sessionId: `e29-no-candidate-${Date.now()}`,
      })
      .expect(200);

    const actions = actionsOf(response.body);
    expect(actions.some((action) => action?.panel_id === "docs-viewer" && action?.action_id === "search_docs")).toBe(true);
    expect(
      actions.some((action) => action?.panel_id === "docs-viewer" && action?.action_id === "validate_doc_candidates"),
    ).toBe(true);
    expect(actions.some((action) => action?.panel_id === "docs-viewer" && action?.action_id === "open_doc_by_path")).toBe(false);
    expect(response.body?.open_doc_goal_satisfied).toBe(false);
    expect(response.body?.final_status).toBe("final_failure");
    expect(response.body?.terminal_error_code).toBe("open_doc_unresolved");
  }, 60000);

  it("routes title-like open prompts through doc candidate validation instead of reasoning recovery", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open up NHM2 Frontier Distance From 0p995",
        mode: "read",
        sessionId: `e29-title-open-${Date.now()}`,
      })
      .expect(200);

    const actions = actionsOf(response.body);
    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(actions.some((action) => action?.panel_id === "docs-viewer" && action?.action_id === "search_docs")).toBe(true);
    expect(
      actions.some((action) => action?.panel_id === "docs-viewer" && action?.action_id === "validate_doc_candidates"),
    ).toBe(true);
    expect(response.body?.text).not.toMatch(/retrieval recovery did not complete/i);
    expect(response.body?.open_doc_goal_satisfied || ["open_doc_unresolved", "ambiguous_doc_candidates"].includes(response.body?.terminal_error_code)).toBe(true);
  }, 60000);

  it("handles pull-up title variants as open-doc acquisition", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "pull up NHM2 frontier distance 0p995",
        mode: "read",
        sessionId: `e29-title-pull-up-${Date.now()}`,
      })
      .expect(200);

    const actions = actionsOf(response.body);
    expect(actions.some((action) => action?.panel_id === "docs-viewer" && action?.action_id === "search_docs")).toBe(true);
    expect(
      actions.some((action) => action?.panel_id === "docs-viewer" && action?.action_id === "validate_doc_candidates"),
    ).toBe(true);
    expect(response.body?.text).not.toMatch(/retrieval recovery did not complete/i);
  }, 60000);

  it("keeps simple docs panel navigation out of title-like doc search", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open docs",
        mode: "read",
        sessionId: `e29-open-docs-panel-${Date.now()}`,
      })
      .expect(200);

    const actions = actionsOf(response.body);
    expect(actions.some((action) => action?.panel_id === "docs-viewer" && action?.action_id === "open")).toBe(true);
    expect(actions.some((action) => action?.panel_id === "docs-viewer" && action?.action_id === "search_docs")).toBe(false);
    expect(actions.some((action) => action?.panel_id === "docs-viewer" && action?.action_id === "validate_doc_candidates")).toBe(false);
  }, 60000);
});
