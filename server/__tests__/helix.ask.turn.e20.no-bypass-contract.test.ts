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

describe("helix ask turn e20 no-bypass contract", () => {
  it("uses the direct-answer planner contract for no-tool casual turns", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "hello is this working? Is this thing on?",
        mode: "read",
        sessionId: `e20-direct-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.dispatch_policy).toBe("direct_answer_only");
    expect(response.body?.planner_contract?.plan_items?.map((step: any) => step?.id)).toEqual([
      "planner_restate_goal",
      "assistant_direct_answer",
    ]);
    expect(response.body?.execution_trace?.map((step: any) => step?.status)).toEqual(["completed", "completed"]);
    expect(response.body?.step_results?.some((step: any) => step?.actual_artifacts?.includes("direct_answer_text"))).toBe(true);
  });

  it("uses shared workspace execution builders for active-doc identity turns", async () => {
    const app = createApp();
    const activeDocPath = "/docs/research/example.md";
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what doc am I looking at?",
        mode: "read",
        sessionId: `e20-doc-identity-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          activeDocPath,
          source: "doc_viewer_store",
          hasDocContext: true,
        },
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.planner_contract?.plan_items?.map((step: any) => step?.id)).toEqual(["workspace_action"]);
    expect(response.body?.execution_lifecycle?.map((event: any) => event?.event)).toEqual(["started", "completed"]);
    expect(response.body?.step_results?.some((step: any) => step?.actual_artifacts?.includes("active_doc_path"))).toBe(true);
  });

  it("uses request-user-input planner contract when doc identity lacks context", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what doc am I looking at?",
        mode: "read",
        sessionId: `e20-missing-doc-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("clarify:missing_args");
    expect(response.body?.pending_server_request?.required_fields).toContain("doc_reference");
    expect(response.body?.planner_contract?.dispatch_policy).toBe("needs_user_input");
    expect(response.body?.planner_contract?.plan_items?.map((step: any) => step?.id)).toEqual(["request_user_input"]);
    expect(response.body?.execution_trace?.map((step: any) => step?.status)).toEqual(["completed"]);
    expect(response.body?.step_results?.map((step: any) => step?.step_id)).toEqual(["request_user_input"]);
  });
});
