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

describe("helix ask turn e8.20 subgoal composer", () => {
  it("builds workspace->reasoning chain for open docs then compare prompt", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open docs and then compare this doc with my notes and tell me differences",
        mode: "read",
        sessionId: "e820-open-compare",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    const planItems = Array.isArray(response.body?.planner_contract?.plan_items)
      ? response.body.planner_contract.plan_items
      : [];
    expect(planItems[0]?.lane).toBe("workspace");
    expect(planItems.some((item: { lane?: string; id?: string }) => item.lane === "reasoning")).toBe(true);
    expect(String(response.body?.text ?? "").length).toBeGreaterThan(0);
  });

  it("builds reasoning_extract -> workspace_append -> reasoning_followup for extract/append/compare prompt", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "from the current document, extract numeric claims and append them to note crossdoc stack, then compare with my notes and summarize differences",
        mode: "read",
        sessionId: "e820-extract-append-compare",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    const planItems = Array.isArray(response.body?.planner_contract?.plan_items)
      ? response.body.planner_contract.plan_items
      : [];
    expect(planItems[0]?.id).toBe("reasoning_extract");
    expect(planItems[1]?.id).toBe("workspace_action");
    expect(planItems[2]?.id).toBe("reasoning_followup");
    expect(String(response.body?.text ?? "").toLowerCase()).not.toContain("i need text");
  });

  it("keeps single-step workspace behavior unchanged", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open up notes",
        mode: "read",
        sessionId: "e820-single-step-regression",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.planner_contract?.selected_action?.panel_id).toBe("workstation-notes");
    expect(response.body?.planner_contract?.selected_action?.action_id).toBe("open");
  });
});
