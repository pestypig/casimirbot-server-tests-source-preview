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

describe("helix ask turn e8.7 evidence-gated reasoning finalization", () => {
  it("emits reasoning_retrieval when compare prompt has no evidence refs", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "compare this doc with my notes and tell me differences",
        mode: "read",
        sessionId: "e87-needs-retrieval",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.turn_contract?.lane).toBe("reasoning");
    expect(response.body?.needs_retrieval).toBe(true);
    expect(Array.isArray(response.body?.evidence_refs)).toBe(true);
    expect((response.body?.evidence_refs ?? []).length).toBe(0);
    expect(response.body?.retrieval_attempted).toBe(true);
    expect(response.body?.retrieval_fail_reason).toContain("evidence_refs_missing");
    const planIds = (response.body?.planner_contract?.plan_items ?? []).map(
      (step: { id?: string }) => step.id,
    );
    expect(planIds).toContain("reasoning_retrieval");
    expect(String(response.body?.text ?? "").toLowerCase()).toContain("needs retrieval");
  });

  it("does not emit needs_retrieval when compare prompt includes explicit doc path evidence", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "compare /docs/research/nhm2-full-solve-overview-v2-2026-04-23.md with my notes and summarize differences",
        mode: "read",
        sessionId: "e87-has-evidence",
      })
      .expect(200);

    expect(response.body?.needs_retrieval).toBe(false);
    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.planner_contract?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.planner_contract?.selected_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.planner_contract?.selected_action?.action_id).toBe("summarize_doc");
    expect(Array.isArray(response.body?.evidence_refs)).toBe(true);
    expect((response.body?.evidence_refs ?? []).length).toBeGreaterThan(0);
    expect((response.body?.evidence_refs ?? [])[0]).toContain(".md");
  });
});
