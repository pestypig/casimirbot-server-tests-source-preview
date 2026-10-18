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

describe("helix ask turn e8.25 bounded note arg parsing", () => {
  it("keeps create/copy note targets bounded in chained compare prompts", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "create note called bridge notes, copy latest clipboard entry to that note, then compare with /docs/research/nhm2-full-solve-overview-v2-2026-04-23.md",
        mode: "read",
        sessionId: "e825-bounded-create-copy-compare",
      })
      .expect(200);

    const planItems = Array.isArray(response.body?.planner_contract?.plan_items)
      ? response.body.planner_contract.plan_items
      : [];
    expect(planItems[0]?.action?.action_id).toBe("create_note");
    expect(planItems[0]?.action?.args?.title).toBe("bridge notes");
    expect(planItems[1]?.action?.action_id).toBe("copy_receipt_to_note");
    expect(planItems[1]?.action?.args?.note_title).toBe("bridge notes");
    expect(String(planItems[0]?.action?.args?.title ?? "").toLowerCase()).not.toContain("then compare");
    expect(String(planItems[1]?.action?.args?.note_title ?? "").toLowerCase()).not.toContain("then compare");

    const evidenceRefs = Array.isArray(response.body?.evidence_refs) ? response.body.evidence_refs : [];
    expect(evidenceRefs.some((ref: string) => ref === "note_title:bridge notes")).toBe(true);
    expect(evidenceRefs.some((ref: string) => String(ref).toLowerCase().includes("then compare"))).toBe(false);
  });

  it("preserves note titles containing the word 'and' for create_note", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "create a note called research and development notes",
        mode: "read",
        sessionId: "e825-and-title",
      })
      .expect(200);

    expect(response.body?.planner_contract?.selected_action?.action_id).toBe("create_note");
    expect(response.body?.planner_contract?.selected_action?.args?.title).toBe("research and development notes");
    const planItems = Array.isArray(response.body?.planner_contract?.plan_items)
      ? response.body.planner_contract.plan_items
      : [];
    const executionTrace = Array.isArray(response.body?.execution_trace) ? response.body.execution_trace : [];
    expect(planItems.map((item: { id?: string }) => String(item.id ?? ""))).toEqual(["workspace_action"]);
    expect(executionTrace.map((step: { id?: string; status?: string }) => `${step.id}:${step.status}`)).toEqual([
      "workspace_action:completed",
    ]);
  });
});
