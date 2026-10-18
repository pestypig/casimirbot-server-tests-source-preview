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

describe("helix ask turn e8.23 evidence-backed reasoning finals", () => {
  it("returns evidence_backed final for explicit doc compare prompt", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "compare /docs/research/nhm2-full-solve-overview-v2-2026-04-23.md with my notes and summarize differences",
        mode: "read",
        sessionId: "e823-evidence-backed",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.turn_contract?.lane).toBe("reasoning");
    expect(response.body?.needs_retrieval).toBe(false);
    expect(response.body?.final_answer_style).toBe("evidence_backed");
    expect(Array.isArray(response.body?.evidence_used_refs)).toBe(true);
    expect((response.body?.evidence_used_refs ?? []).length).toBeGreaterThan(0);
    expect(response.body?.evidence_used_count).toBeGreaterThan(0);
  });

  it("creates typed retrieval pending request when evidence is missing", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "compare this doc with my notes and tell me differences",
        mode: "read",
        sessionId: "e823-retrieval-clarify",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("clarify:missing_args");
    expect(response.body?.turn_contract?.terminal_kind).toBe("clarify");
    expect(response.body?.pending_server_request?.kind).toBe("clarify");
    expect(response.body?.pending_server_request?.pending_scope).toBe("artifact_gate");
    expect(Array.isArray(response.body?.pending_server_request?.required_fields)).toBe(true);
    expect((response.body?.pending_server_request?.required_fields ?? []).length).toBeGreaterThan(0);
    expect(response.body?.needs_retrieval).toBe(true);
    expect(response.body?.final_answer_style).toBe("fallback_summary");
    expect(String(response.body?.retrieval_fail_reason ?? "")).toContain("evidence_refs_missing");
    expect(String(response.body?.text ?? "").toLowerCase()).toContain("needs retrieval");
  });

  it("preserves e8.22 multi-step chain with a single reasoning terminal", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "create note called bridge notes, copy latest clipboard entry to that note, then compare with current doc",
        mode: "read",
        sessionId: "e823-chain-regression",
      })
      .expect(200);

    const planItems = Array.isArray(response.body?.planner_contract?.plan_items)
      ? response.body.planner_contract.plan_items
      : [];
    const executionTrace = Array.isArray(response.body?.execution_trace) ? response.body.execution_trace : [];
    expect(planItems.map((item: { id?: string }) => item.id)).toEqual([
      "workspace_action",
      "workspace_action_copy_receipt",
      "reasoning_followup",
    ]);
    expect(executionTrace.map((step: { status?: string }) => step.status)).toEqual([
      "completed",
      "completed",
      "completed",
    ]);
    expect(response.body?.turn_contract?.lane).toBe("reasoning");
    expect(String(response.body?.text ?? "").length).toBeGreaterThan(20);
  });
});
