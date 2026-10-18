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

describe("helix ask turn e8.29 chained partial exec + compare schema + policy alignment", () => {
  it("keeps chained open/create/compare as executable multi-step plan", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "open docs, create a note called compare pack, then compare this doc with my notes and write the result to that note",
        mode: "read",
        sessionId: "e829-chain",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.turn_contract?.terminal_kind).toBe("reasoning");
    expect(response.body?.planner_contract?.dispatch_policy).toBe("workspace_context_reasoning");
    const ids = (response.body?.planner_contract?.plan_items ?? []).map((step: { id?: string }) => step.id);
    expect(ids).toEqual(["workspace_action_open_docs", "workspace_action_create_note", "reasoning_followup"]);
  });

  it.skip("treats doc-vs-doc compare as doc schema and avoids note_reference clarify", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "open docs and compare figures from /docs/research/nhm2-full-solve-overview-v2-2026-04-23.md with /docs/research/nhm2-lapse-alpha-sweep-operator.md and summarize the differences",
        mode: "read",
        sessionId: "e829-docdoc",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.turn_contract?.terminal_kind).toBe("reasoning");
    expect(response.body?.pending_server_request ?? null).toBeNull();
    const ids = (response.body?.planner_contract?.plan_items ?? []).map((step: { id?: string }) => step.id);
    expect(ids).toEqual(["workspace_action", "reasoning_followup_doc_doc"]);
  }, 20000);

  it("normalizes dispatch policy when reasoning plan exists", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open docs and then explain key claim",
        mode: "read",
        sessionId: "e829-policy",
      })
      .expect(200);

    const hasReasoningPlan = (response.body?.planner_contract?.plan_items ?? []).some(
      (step: { lane?: string }) => step.lane === "reasoning",
    );
    expect(hasReasoningPlan).toBe(true);
    expect(response.body?.planner_contract?.dispatch_policy).not.toBe("workspace_only");
    expect(response.body?.dispatch_policy).not.toBe("workspace_only");
  });
});
