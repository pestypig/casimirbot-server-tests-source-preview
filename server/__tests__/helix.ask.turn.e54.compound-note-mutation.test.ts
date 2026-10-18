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

describe("helix ask E54 compound note mutation", () => {
  it("uses a current-turn note update receipt as evidence for a synthesized terminal answer", async () => {
    const app = createApp();
    const activePath =
      "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/envelope/warp-nhm2-envelope-perturbation-suite-2026-04-26.md";

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Create a workstation note called E54 scientist smoke test with a short summary of the current doc and its source path.",
        mode: "read",
        debug: true,
        sessionId: `e54-compound-note-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs",
          activeDocPath: activePath,
          docViewer: { currentPath: activePath },
        },
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.required_terminal_kind).not.toBe("note_update_receipt");
    expect(response.body?.terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(response.body?.final_answer_source).not.toMatch(/note_.*receipt/);
    expect(response.body?.terminal_consistency_check?.violations ?? []).not.toContain("terminal_consistency_violation");
    expect(response.body?.selected_final_answer ?? response.body?.text).toMatch(/E54 scientist smoke test/i);
    expect(JSON.stringify(response.body?.current_turn_artifact_ledger ?? [])).toContain("note_update_receipt");
  }, 90000);
});
