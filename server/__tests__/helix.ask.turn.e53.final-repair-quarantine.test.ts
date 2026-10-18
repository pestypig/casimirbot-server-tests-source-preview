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

describe("helix ask E53 final repair quarantine", () => {
  it("does not repair direct-answer turns with ambient active-doc previews", async () => {
    const app = createApp();
    const activePath =
      "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/envelope/warp-nhm2-envelope-perturbation-suite-2026-04-26.md";

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Background only: explain why alpha less than 1 shortens proper time.",
        mode: "read",
        debug: true,
        sessionId: `e53-repair-quarantine-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs",
          activeDocPath: activePath,
          docViewer: { currentPath: activePath },
        },
      })
      .expect(200);

    const answer = String(response.body?.selected_final_answer ?? response.body?.text ?? "");
    expect(response.body?.retrieval_required_signal?.required).toBe(false);
    expect(response.body?.dispatch_policy).toBe("direct_answer_only");
    expect(["direct_answer_text", "typed_failure"]).toContain(response.body?.terminal_artifact_kind);
    expect(["no_tool_direct", "typed_failure"]).toContain(response.body?.final_answer_source);
    expect(response.body?.selected_final_answer).toBe(response.body?.text);
    expect(answer).not.toMatch(/^Explained\s+\//i);
    expect(answer).not.toContain("Key claim:");
    expect(JSON.stringify(response.body?.rejected_final_answer_repairs ?? [])).toContain(
      "ambient_workspace_context_for_direct_answer_turn",
    );
  }, 60000);
});
