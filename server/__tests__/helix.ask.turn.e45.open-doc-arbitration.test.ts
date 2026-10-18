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

const answerText = (body: any): string =>
  String(body?.selected_final_answer ?? body?.assistant_answer ?? body?.answer ?? body?.text ?? "");

const searchQueriesOf = (body: any): string[] =>
  actionsOf(body)
    .filter((action) => action?.panel_id === "docs-viewer" && action?.action_id === "search_docs")
    .map((action) => String(action?.args?.query ?? ""))
    .filter(Boolean);

const assertRecentDocAcquisition = (body: any): void => {
  expect(body?.route_reason_code).toBe("dispatch:act");
  expect(body?.dispatch?.reason).toBe("dispatch:act");
  expect(body?.universal_goal_frame?.user_goal?.goal_kind).toBe("open_workspace");
  expect(body?.capability_selection_result?.capability_id).toBe("docs-viewer.search_docs");
  expect(actionsOf(body).some((action) => action?.panel_id === "docs-viewer" && action?.action_id === "search_docs")).toBe(true);
  expect(actionsOf(body).some((action) => action?.panel_id === "docs-viewer" && action?.action_id === "locate_in_doc")).toBe(false);
  expect(body?.terminal_error_code).not.toBe("retrieval_recovery_failed");
  expect(answerText(body)).not.toMatch(/active_doc_path|doc_location_matches|No active document/i);
};

describe("helix ask E45 open-doc vs locate arbitration", () => {
  it.each([
    {
      prompt: "pull up the newest paper that talks about warp profiles reducing travel time",
      expectedTerms: ["warp", "profiles", "travel", "time"],
    },
    {
      prompt: "find me the freshest doc on profiles for making the trip shorter with warp",
      expectedTerms: ["profiles", "trip", "shorter", "warp"],
    },
    {
      prompt: "open the newest warp travel-time profile writeup",
      expectedTerms: ["warp", "travel-time", "profile"],
    },
  ])("treats lay recent-doc request as document acquisition: $prompt", async ({ prompt, expectedTerms }) => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: prompt,
        mode: "read",
        debug: true,
        sessionId: `e45-open-doc-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      })
      .expect(200);

    assertRecentDocAcquisition(response.body);
    const queries = searchQueriesOf(response.body).join(" ").toLowerCase();
    for (const term of expectedTerms) {
      expect(queries).toContain(term.toLowerCase());
    }
    expect(queries).not.toMatch(/\b(?:that talks|talks about)\b/i);
  }, 60000);

  it("does not duplicate the opened document block for successful latest-doc answers", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "show the latest thing about route-time savings in warp profile docs",
        mode: "read",
        debug: true,
        sessionId: `e45-open-doc-dedupe-${Date.now()}`,
      })
      .expect(200);

    assertRecentDocAcquisition(response.body);
    const answer = answerText(response.body);
    if (response.body?.open_doc_goal_satisfied) {
      expect((answer.match(/^Document:/gm) ?? []).length).toBeLessThanOrEqual(1);
      expect(answer).not.toMatch(/Opened latest document:[\s\S]*Opened latest verified/i);
    }
  }, 60000);

  it("stops the turn after a successful open-doc acquisition instead of appending identify-current-doc model steps", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open the newest warp travel-time profile writeup",
        mode: "read",
        debug: true,
        sessionId: `e45-open-doc-stop-${Date.now()}`,
      })
      .expect(200);

    assertRecentDocAcquisition(response.body);
    expect(response.body?.open_doc_goal_satisfied).toBe(true);
    expect(response.body?.terminal_mismatch).not.toBe(true);

    const executionTrace = Array.isArray(response.body?.execution_trace) ? response.body.execution_trace : [];
    expect(
      executionTrace.some((step: any) => String(step?.id ?? "").startsWith("model_step_")),
    ).toBe(false);
    expect(
      actionsOf(response.body).some(
        (action) => action?.panel_id === "docs-viewer" && action?.action_id === "identify_current_doc",
      ),
    ).toBe(false);
    const audits = Array.isArray(response.body?.model_decision_audits) ? response.body.model_decision_audits : [];
    expect(audits.some((audit: any) => audit?.operational_step_appended === true)).toBe(false);
  }, 60000);
});
