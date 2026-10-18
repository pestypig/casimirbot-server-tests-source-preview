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
  activeNoteTitle: "e33 temporal continuation scratch",
  lastCreatedNoteTitle: "e33 temporal continuation scratch",
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

describe("helix ask turn e33 temporal retrieval continuation", () => {
  it("runs bounded variant searches before asking for an ambiguous temporal target", async () => {
    const app = createApp();
    const sessionId = `e33-continuation-${Date.now()}`;

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
    expect(stepIds.some((stepId) => stepId.startsWith("temporal_target_variant_search_"))).toBe(true);
    expect(stepIds).toContain("contextual_followup_validate_temporal_target");
    expect(stepIds).toContain("contextual_followup_compose_temporal_compare");

    const attempts = artifactOf(response.body, "temporal_target_resolution_attempts");
    expect(attempts).toBeTruthy();
    expect(Array.isArray(attempts?.attempted_queries)).toBe(true);
    expect((attempts?.attempted_queries as unknown[]).length).toBeGreaterThan(1);
    expect((attempts?.attempted_queries as unknown[]).map(String)).toContain("NHM2 solve passed");

    const comparison = artifactOf(response.body, "temporal_context_comparison");
    expect(comparison).toBeTruthy();
    expect(Array.isArray(comparison?.target_attempted_queries)).toBe(true);
    expect((comparison?.target_attempted_queries as unknown[]).length).toBeGreaterThan(1);

    if (comparison?.target_validation_status === "strong") {
      expect(response.body?.final_status).toBe("final_answer");
      expect(response.body?.final_answer_source).toBe("artifact_synthesis");
      expect(textOf(response.body)).toMatch(/2026-04-02/);
    } else {
      expect(response.body?.final_status).toBe("pending_input");
      expect(response.body?.final_answer_source).toBe("request_user_input");
      expect(response.body?.pending_server_request?.required_fields).toContain("comparison_target_doc");
      expect(textOf(response.body)).toMatch(/I tried:/);
      expect(textOf(response.body)).toMatch(/Which target should I compare against/i);
      expect(textOf(response.body)).not.toMatch(/^(Yes|No)\./);
    }
    expect(response.body?.terminal_error_code ?? null).not.toBe("retrieval_recovery_failed");
  }, 30000);

  it("does not run temporal target variants when source document context is missing", async () => {
    const app = createApp();
    const sessionId = `e33-missing-source-${Date.now()}`;

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

    const stepIds = stepIdsOf(response.body);
    expect(stepIds.some((stepId) => stepId.startsWith("temporal_target_variant_search_"))).toBe(false);
    const artifact = artifactOf(response.body, "temporal_context_comparison");
    expect(artifact).toBeTruthy();
    expect(artifact?.failure_reason).toBe("source_context_missing");
    expect(textOf(response.body)).toMatch(/active document context/i);
    expect(textOf(response.body)).not.toMatch(/^(Yes|No)\./);
    expect(response.body?.final_answer_source).not.toBe("legacy_fallback");
  }, 30000);

  it("does not let PASS FAIL snippets satisfy the passing target term", async () => {
    const app = createApp();
    const sessionId = `e33-pass-snippet-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "this was before the passing NHM2 solve right?",
        mode: "read",
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    const comparison = artifactOf(response.body, "temporal_context_comparison");
    expect(comparison).toBeTruthy();
    const compactNote = Array.isArray(comparison?.target_candidates)
      ? (comparison?.target_candidates as Array<Record<string, unknown>>).find((candidate) =>
          String(candidate.path ?? "").includes("needle-hull-mark2-compact-note-2026-03-22"),
        )
      : null;
    expect(compactNote).toBeTruthy();
    expect(compactNote?.validation_status).not.toBe("strong");
    expect(compactNote?.missing_terms).toContain("passing");
  }, 30000);
});
