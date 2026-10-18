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
  activeNoteTitle: "e31 contextual scratch",
  lastCreatedNoteTitle: "e31 contextual scratch",
});

const textOf = (body: any): string => String(body?.assistant_answer ?? body?.answer ?? body?.text ?? "");

const stepIdsOf = (body: any): string[] =>
  Array.isArray(body?.step_results) ? body.step_results.map((step: any) => String(step?.step_id ?? "")) : [];

const artifactOf = (body: any, kind: string): Record<string, unknown> | null => {
  const steps = Array.isArray(body?.step_results) ? body.step_results : [];
  for (const step of steps) {
    const artifact = step?.result_artifact && typeof step.result_artifact === "object" ? step.result_artifact : null;
    if (artifact?.kind === kind) return artifact;
  }
  return null;
};

describe("helix ask turn e31 contextual temporal follow-up compare", () => {
  it("binds this/that to the active doc and emits a temporal comparison artifact", async () => {
    const app = createApp();
    const sessionId = `e31-contextual-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "this was before the passing NHM2 solve right?",
        mode: "read",
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    const stepIds = stepIdsOf(response.body);
    expect(stepIds).toContain("contextual_followup_bind_source");
    expect(stepIds).toContain("contextual_followup_resolve_target");
    expect(stepIds).toContain("contextual_followup_compose_temporal_compare");
    expect(response.body?.final_answer_source).toBe("request_user_input");
    expect(response.body?.final_answer_source).not.toBe("legacy_fallback");
    expect(response.body?.terminal_error_code ?? null).not.toBe("retrieval_recovery_failed");
    expect(textOf(response.body)).not.toMatch(/retrieval recovery did not complete/i);
    expect(textOf(response.body)).not.toMatch(/^(Yes|No)\./);
    expect(response.body?.final_status).toBe("pending_input");
    expect(response.body?.pending_server_request?.required_fields).toContain("comparison_target_doc");

    const artifact = artifactOf(response.body, "temporal_context_comparison");
    expect(artifact).toBeTruthy();
    expect(artifact?.source_doc_path).toBe(activeDocPath);
    expect(artifact?.source_date).toBe("2026-04-02");
    expect(artifact?.target_query).toBe("passing NHM2 solve");
    expect(["weak", "ambiguous", "none"]).toContain(artifact?.target_validation_status);
  }, 30000);

  it("fails contextually instead of routing into generic retrieval timeout when no active doc exists", async () => {
    const app = createApp();
    const sessionId = `e31-missing-context-${Date.now()}`;

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
    expect(textOf(response.body)).toMatch(/active document context/i);
    expect(textOf(response.body)).not.toMatch(/retrieval recovery did not complete/i);
    expect(response.body?.final_answer_source).not.toBe("legacy_fallback");
  }, 30000);
});

