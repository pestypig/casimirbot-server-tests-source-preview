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

describe("helix ask turn e19.3 recovery terminal contract", () => {
  it("turns retrieval recovery timeout into a typed final failure", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "I am looking at this paper; give me the practical takeaway in one note-sized paragraph. [[TEST_FORCE_RECOVERY_TIMEOUT]]",
        mode: "read",
        sessionId: `e193-recovery-timeout-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          activeDocPath:
            "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/warp-nhm2-cruise-envelope-preflight-latest.md",
          source: "doc_viewer_store",
          hasDocContext: true,
        },
      })
      .expect(200);

    expect(response.body?.ok).toBe(false);
    expect(response.body?.final_status).toBe("final_failure");
    expect(response.body?.response_type).toBe("final_failure");
    expect(response.body?.terminal_error_code).toBe("retrieval_recovery_failed");
    expect(response.body?.text).toMatch(/retrieval recovery did not complete/i);
    expect(response.body?.pending_server_request).toBeNull();
    expect(response.body?.turn_truth_table?.terminal?.kind).toBe("final_failure");
    expect(response.body?.turn_truth_table?.terminal?.text).toBe(response.body?.text);
    expect(response.body?.turn_truth_table?.event_audit?.terminal_mismatch).toBe(false);
    expect(response.body?.execution_trace?.some((step: any) => step?.id === "retrieval_recovery_failed")).toBe(true);
    expect(response.body?.execution_trace?.every((step: any) => step?.status !== "started")).toBe(true);
    expect(response.body?.execution_lifecycle?.some((event: any) => event?.event === "failed")).toBe(true);
    expect(response.body?.turn_events?.filter((event: any) => event?.type === "terminal_answer")).toHaveLength(1);
    expect(response.body?.turn_events?.filter((event: any) => event?.type === "turn_completed")).toHaveLength(1);
  });
});
