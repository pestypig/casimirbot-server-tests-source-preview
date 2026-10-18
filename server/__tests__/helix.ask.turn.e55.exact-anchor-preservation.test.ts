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

const stringify = (value: unknown): string => JSON.stringify(value ?? {});

describe("helix ask E55 exact-anchor preservation", () => {
  it("preserves snake-case observer audit anchors through retrieval planning", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "For the NHM2 observer audit, summarize the evidence behind likely_stop_territory.",
        mode: "read",
        debug: true,
        sessionId: `e55-snake-anchor-${Date.now()}`,
      })
      .expect(200);

    const exact = response.body?.exact_anchor_set;
    expect(exact?.must_preserve).toEqual(expect.arrayContaining(["likely_stop_territory"]));
    expect(response.body?.retrieval_required_signal?.required).toBe(true);
    expect(response.body?.final_answer_source).not.toBe("no_tool_direct");
    expect(response.body?.retrieval_query_integrity?.generated_queries?.join(" ")).not.toMatch(/\bthe requested topic\b/i);
    expect(stringify(response.body?.retrieval_query_integrity)).toMatch(/likely[_ ]stop[_ ]territory/i);
  }, 60000);

  it("preserves camel-case status anchors and blocks model-only routing", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "In the current NHM2 observer audit doc, what does observerTileDiminishingReturnStatus likely_stop_territory mean? Use the doc context.",
        mode: "read",
        debug: true,
        sessionId: `e55-camel-anchor-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs",
          activeDocPath:
            "/docs/audits/research/selected-family/nhm2-shift-lapse/current-lane-baseline-convergence.md",
        },
      })
      .expect(200);

    expect(response.body?.exact_anchor_set?.must_preserve).toEqual(
      expect.arrayContaining(["observerTileDiminishingReturnStatus", "likely_stop_territory"]),
    );
    expect(response.body?.canonical_goal_frame?.goal_kind).toMatch(/doc_scientific_concept|doc_evidence_location|typed_failure/);
    expect(response.body?.final_answer_source).not.toBe("no_tool_direct");
    expect(response.body?.route_reason_code).not.toBe("conversation:simple");
    expect(response.body?.retrieval_query_integrity?.generated_queries?.join(" ")).not.toMatch(/\bthe requested topic\b/i);
  }, 60000);
});
