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

const activeDocPath = "/docs/audits/research/warp-nhm2-solve-authority-audit-2026-04-02.md";

const workspaceSnapshot = (sessionId: string) => ({
  sessionId,
  activePanel: "docs-viewer",
  activeDocPath,
  hasDocContext: true,
  hasNoteContext: true,
  activeNoteTitle: "e32 temporal validation scratch",
  lastCreatedNoteTitle: "e32 temporal validation scratch",
});

const textOf = (body: any): string => String(body?.assistant_answer ?? body?.answer ?? body?.text ?? "");

const artifactOf = (body: any, kind: string): Record<string, unknown> | null => {
  const steps = Array.isArray(body?.step_results) ? body.step_results : [];
  for (const step of steps) {
    const artifact = step?.result_artifact && typeof step.result_artifact === "object" ? step.result_artifact : null;
    if (artifact?.kind === kind) return artifact;
  }
  return null;
};

describe("helix ask turn e32 temporal compare target validation", () => {
  it("does not answer yes/no from weak temporal target candidates", async () => {
    const app = createApp();
    const sessionId = `e32-weak-target-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "this was before the passing NHM2 solve right?",
        mode: "read",
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    const artifact = artifactOf(response.body, "temporal_context_comparison");
    expect(artifact).toBeTruthy();
    expect(["weak", "ambiguous", "none"]).toContain(artifact?.target_validation_status);
    expect(response.body?.final_status).toBe("pending_input");
    expect(response.body?.final_answer_source).toBe("request_user_input");
    expect(response.body?.pending_server_request?.required_fields).toContain("comparison_target_doc");
    expect(textOf(response.body)).not.toMatch(/^(Yes|No)\./);
    expect(textOf(response.body)).toMatch(/none strongly match|Which target/i);
    expect(response.body?.final_answer_source).not.toBe("legacy_fallback");
    expect(response.body?.terminal_error_code ?? null).not.toBe("retrieval_recovery_failed");
  }, 30000);

  it("keeps missing source context closed without a yes/no temporal answer", async () => {
    const app = createApp();
    const sessionId = `e32-missing-source-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "was this before the passing NHM2 solve?",
        mode: "read",
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          hasDocContext: false,
        },
      })
      .expect(200);

    const artifact = artifactOf(response.body, "temporal_context_comparison");
    expect(artifact).toBeTruthy();
    expect(artifact?.failure_reason).toBe("source_context_missing");
    expect(textOf(response.body)).not.toMatch(/^(Yes|No)\./);
    expect(textOf(response.body)).not.toMatch(/retrieval recovery did not complete/i);
    expect(response.body?.final_answer_source).not.toBe("legacy_fallback");
  }, 30000);
});

