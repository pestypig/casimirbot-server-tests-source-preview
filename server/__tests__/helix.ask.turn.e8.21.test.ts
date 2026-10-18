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

describe("helix ask turn e8.21 retrieval executor semantics", () => {
  it("returns typed retrieval failure metadata for compare prompt with missing refs", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "compare this doc with my notes and tell me differences",
        mode: "read",
        sessionId: "e821-missing-evidence",
      })
      .expect(200);

    expect(response.body?.needs_retrieval).toBe(true);
    expect(response.body?.retrieval_attempted).toBe(true);
    expect(response.body?.retrieval_refs_count).toBe(0);
    expect(response.body?.retrieval_fail_reason).toContain("evidence_refs_missing");
    expect(Array.isArray(response.body?.retrieval_missing_fields)).toBe(true);
    expect(String(response.body?.retrieval_clarify ?? "").length).toBeGreaterThan(0);
    const planIds = (response.body?.planner_contract?.plan_items ?? []).map(
      (step: { id?: string }) => step.id,
    );
    expect(planIds).toContain("reasoning_retrieval");
  });

  it("skips retrieval failure metadata when explicit doc path evidence is present", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "compare /docs/research/nhm2-full-solve-overview-v2-2026-04-23.md with my notes and summarize differences",
        mode: "read",
        sessionId: "e821-has-evidence",
      })
      .expect(200);

    expect(response.body?.needs_retrieval).toBe(false);
    expect(response.body?.retrieval_attempted).toBe(false);
    expect(response.body?.retrieval_fail_reason).toBeNull();
    expect((response.body?.evidence_refs ?? []).length).toBeGreaterThan(0);
  });
});
