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

const selectedText = (body: any): string => String(body?.selected_final_answer ?? body?.text ?? "");

describe("helix ask E54 target-bound evidence", () => {
  it("does not satisfy an exact 0p7000 evidence request with a different nearby alpha token", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "Where in the current NHM2 doc does it mention stage1_centerline_alpha_0p7000_v1? Give me the source path and nearby fields.",
        mode: "read",
        debug: true,
        sessionId: `e54-target-bound-0p7000-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs",
          activeDocPath:
            "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/envelope/warp-nhm2-envelope-perturbation-suite-2026-04-26.md",
        },
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_evidence_location");
    expect(["doc_evidence_location", "doc_location_matches", "typed_failure"]).toContain(
      response.body?.terminal_artifact_kind,
    );
    if (response.body?.terminal_artifact_kind !== "typed_failure") {
      expect(selectedText(response.body)).toContain("stage1_centerline_alpha_0p7000_v1");
      expect(selectedText(response.body)).not.toMatch(/Matched:\s*stage1_centerline_alpha_0p995_v1/i);
    } else {
      expect(response.body?.terminal_error_code ?? selectedText(response.body)).toMatch(
        /doc_evidence_location_unavailable|required_exact_token_missing/i,
      );
    }
  }, 90000);

  it("does not let search-result text satisfy Expected Target Table location requests", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Find where the Expected Target Table mentions alpha 0p995 and give me the source path and nearby fields.",
        mode: "read",
        debug: true,
        sessionId: `e54-expected-target-table-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_evidence_location");
    const answer = selectedText(response.body);
    expect(answer).not.toMatch(/^Search results:/i);
    if (/no current-turn location artifact proved the requested target/i.test(answer)) {
      expect(answer).toMatch(/no current-turn location artifact proved the requested target/i);
    } else if (response.body?.terminal_artifact_kind !== "typed_failure") {
      expect(answer).toMatch(/^Locations:/i);
      expect(answer).toMatch(/Path:/i);
      expect(answer).toMatch(/Snippet:/i);
      expect(answer).toMatch(/0p995|0\.995/i);
    } else {
      expect(answer).toMatch(/no current-turn location artifact proved the requested target|could not/i);
    }
  }, 90000);
});
