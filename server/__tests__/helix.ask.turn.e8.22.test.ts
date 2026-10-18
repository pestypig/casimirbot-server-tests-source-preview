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

describe("helix ask turn e8.22 multi-intent expansion + hybrid final text", () => {
  it("expands create+copy+compare chain into ordered workspace->workspace->reasoning plan", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "create note called bridge notes, copy latest clipboard entry to that note, then compare with current doc",
        mode: "read",
        sessionId: "e822-chain-plan",
      })
      .expect(200);

    const planItems = Array.isArray(response.body?.planner_contract?.plan_items)
      ? response.body.planner_contract.plan_items
      : [];
    expect(planItems[0]?.id).toBe("workspace_action");
    expect(planItems[0]?.action?.action_id).toBe("create_note");
    expect(planItems[1]?.id).toBe("workspace_action_copy_receipt");
    expect(planItems[1]?.action?.action_id).toBe("copy_receipt_to_note");
    expect(planItems[2]?.id).toBe("reasoning_followup");

    const executionTrace = Array.isArray(response.body?.execution_trace) ? response.body.execution_trace : [];
    expect(executionTrace[0]?.status).toBe("completed");
    expect(executionTrace[1]?.status).toBe("completed");
    expect(executionTrace[2]?.status).toBe("completed");
  });

  it("uses non-template hybrid final text for docs then explain", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open docs and then explain key claim from the current paper in plain language",
        mode: "read",
        sessionId: "e822-hybrid-text",
      })
      .expect(200);

    expect(response.body?.turn_contract?.lane).toBe("reasoning");
    const text = String(response.body?.text ?? "");
    expect(text.length).toBeGreaterThan(30);
    expect(text).not.toContain("Reasoning follow-up completed for");
    expect(text.toLowerCase()).toContain("reasoning");
  });

  it("keeps simple workspace prompt as single-step workspace action", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open up notes",
        mode: "read",
        sessionId: "e822-workspace-regression",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    const planItems = Array.isArray(response.body?.planner_contract?.plan_items)
      ? response.body.planner_contract.plan_items
      : [];
    expect(planItems.length).toBe(1);
    expect(planItems[0]?.id).toBe("workspace_action");
    expect(response.body?.planner_contract?.selected_action?.panel_id).toBe("workstation-notes");
    expect(response.body?.planner_contract?.selected_action?.action_id).toBe("open");
  });
});
