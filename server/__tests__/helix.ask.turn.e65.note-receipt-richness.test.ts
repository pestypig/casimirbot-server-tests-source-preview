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

describe("helix ask E65 note receipt richness", () => {
  it("includes inserted content/provenance in note update receipts", async () => {
    const app = createApp();
    const activePath =
      "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/warp-nhm2-mission-time-comparison-latest.md";
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Create a workstation note called Helix workflow audit scratch with a short summary of the current doc and its source path.",
        mode: "read",
        debug: true,
        sessionId: `e65-note-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          activeDocPath: activePath,
          hasDocContext: true,
        },
      })
      .expect(200);

    expect(response.body?.terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(response.body?.final_answer_source).not.toMatch(/note_.*receipt/);
    expect(String(response.body?.selected_final_answer ?? "")).toMatch(/Updated|Created/i);
    expect(String(response.body?.selected_final_answer ?? "")).toMatch(/Source path:|Inserted:/i);
    const receipt = (response.body?.current_turn_artifact_ledger ?? []).find((artifact: any) => artifact?.kind === "note_update_receipt");
    expect(receipt?.payload?.inserted_blocks).toBeTruthy();
  }, 90000);
});
