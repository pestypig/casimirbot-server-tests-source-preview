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

describe("helix ask turn e19.4 simple conversation terminal contract", () => {
  it("answers mixed greeting and status checks as a direct simple conversation terminal", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "hello is this working? Is this thing on?",
        mode: "read",
        sessionId: `e194-mixed-status-${Date.now()}`,
      })
      .expect(200);

    const text = answerText(response.body);
    expect(response.body?.route_reason_code).toBe("conversation:simple");
    expect(response.body?.dispatch_policy).toBe("direct_answer_only");
    expect(response.body?.final_status).toBe("final_answer");
    expect(response.body?.pending_server_request).toBeNull();
    expect(response.body?.planner_contract?.dispatch_policy).toBe("direct_answer_only");
    expect(response.body?.planner_contract?.plan_items?.map((step: any) => step?.id)).toEqual([
      "planner_restate_goal",
      "assistant_direct_answer",
    ]);
    expect(response.body?.execution_trace?.map((step: any) => step?.status)).toEqual(["completed", "completed"]);
    expect(response.body?.step_results?.some((step: any) => step?.step_id === "assistant_direct_answer")).toBe(true);
    expect(
      response.body?.step_results?.some((step: any) =>
        step?.step_id === "assistant_direct_answer" && step?.actual_artifacts?.includes("direct_answer_text"),
      ),
    ).toBe(true);
    expect(response.body?.turn_events?.some((event: any) => event?.type === "plan_delta")).toBe(true);
    expect(text).toMatch(/Helix Ask is responding/i);
    expect(text).not.toMatch(/substantive final answer/i);
    expect(JSON.stringify(response.body)).not.toMatch(/final_answer_contract_failed/);
    expect(JSON.stringify(response.body)).not.toMatch(/reasoning_attempt/i);
    expect(response.body?.turn_truth_table?.terminal?.kind).toBe("final_answer");
  });

  it("preserves direct status check behavior", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "is this working?",
        mode: "read",
        sessionId: `e194-status-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("conversation:simple");
    expect(response.body?.dispatch_policy).toBe("direct_answer_only");
    expect(response.body?.planner_contract?.plan_items?.map((step: any) => step?.id)).toContain("assistant_direct_answer");
    expect(answerText(response.body)).toMatch(/Helix Ask is responding/i);
  });

  it("preserves greeting-only behavior", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "hello",
        mode: "read",
        sessionId: `e194-hello-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("conversation:simple");
    expect(response.body?.dispatch_policy).toBe("direct_answer_only");
    expect(response.body?.planner_contract?.plan_items?.map((step: any) => step?.id)).toContain("assistant_direct_answer");
    expect(answerText(response.body)).toMatch(/Hello\. What would you like to work on\?/i);
  });

  it("does not capture workspace navigation as simple conversation", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "go to docs",
        mode: "read",
        sessionId: `e194-go-docs-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.workspace_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.workspace_action?.action_id).toBe("open");
  });
});
