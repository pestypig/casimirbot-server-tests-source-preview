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

describe("helix ask turn e8.24 input budget gate + chunk orchestrator", () => {
  it("chunks oversized prompts into reasoning_chunk steps with synthesis", async () => {
    const app = createApp();
    const oversized = `compare /docs/research/nhm2-full-solve-overview-v2-2026-04-23.md with note bridge notes and tell me differences. ${"evidence ".repeat(900)}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: oversized,
        mode: "read",
        sessionId: "e824-oversized",
      })
      .expect(200);

    expect(response.body?.input_budget_applied).toBe(true);
    expect(response.body?.input_chunk_strategy).toBe("deterministic_split");
    expect(Number(response.body?.input_chunk_count ?? 0)).toBeGreaterThan(0);
    const planItems = Array.isArray(response.body?.planner_contract?.plan_items)
      ? response.body.planner_contract.plan_items
      : [];
    const planIds = planItems.map((item: { id?: string }) => String(item.id ?? ""));
    expect(planIds.some((id: string) => id.startsWith("reasoning_chunk_"))).toBe(true);
    expect(planIds).toContain("reasoning_synthesis");
    expect(response.body?.turn_contract?.single_terminal_required).toBe(true);
  });

  it("does not apply chunk strategy for normal-sized prompts", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open up notes",
        mode: "read",
        sessionId: "e824-normal",
      })
      .expect(200);

    expect(response.body?.input_budget_applied).toBe(false);
    expect(response.body?.input_chunk_count).toBe(0);
    expect(response.body?.input_chunk_strategy).toBe("none");
    const planItems = Array.isArray(response.body?.planner_contract?.plan_items)
      ? response.body.planner_contract.plan_items
      : [];
    expect(planItems.length).toBe(1);
    expect(planItems[0]?.id).toBe("workspace_action");
  });

  it("keeps destructive confirm flow unchanged under gate", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "delete note nhm2 scratchpad",
        mode: "read",
        sessionId: "e824-confirm-regression",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("clarify:confirmation_required");
    expect(response.body?.pending_server_request?.kind).toBe("confirm");
    expect(response.body?.turn_contract?.single_terminal_required).toBe(true);
    expect(response.body?.input_budget_applied).toBe(false);
  });
});
