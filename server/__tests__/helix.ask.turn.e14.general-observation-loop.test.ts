import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

const OLD_ENV = { ...process.env };

const createApp = async (): Promise<express.Express> => {
  vi.resetModules();
  const { planRouter } = await import("../routes/agi.plan");
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

afterEach(() => {
  process.env = { ...OLD_ENV };
  vi.resetModules();
});

const answerText = (body: any): string => String(body?.assistant_answer ?? body?.answer ?? body?.text ?? "");

describe("helix ask turn e14 general observation loop", () => {
  it("accepts the E14 decision schema and appends the model-selected capability step", async () => {
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "1";
    process.env.HELIX_E11_MODEL_DECISION_MAX_APPENDED_STEPS = "1";
    process.env.HELIX_E11_MODEL_DECISION_TEST_RESPONSE = JSON.stringify({
      decision: "continue_with_tool",
      summary: "Save the observed document summary to the requested note.",
      next_capability: "workstation-notes.append_to_note",
      next_args: {
        title: "alpha notes",
        text: "Alpha summary captured from the active document.",
      },
      required_artifacts: ["note_update_receipt"],
    });
    const app = await createApp();
    const sessionId = `e14-model-schema-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "summarize this document and save it to a note called alpha notes",
        mode: "read",
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          activeDocPath: "/docs/research/example.md",
          hasDocContext: true,
        },
      })
      .expect(200);

    const audits = response.body?.model_decision_audits ?? [];
    const runtime = response.body?.turn_runtime ?? {};
    expect(audits.some((audit: any) => audit?.decision_source === "model" && audit?.action === "continue")).toBe(true);
    expect(audits.some((audit: any) => Array.isArray(audit?.satisfied_artifacts))).toBe(true);
    expect(audits.some((audit: any) => Array.isArray(audit?.missing_artifacts))).toBe(true);
    expect(response.body?.execution_trace?.some((step: any) => step?.id?.startsWith("model_step_") && step?.action?.action_id === "append_to_note")).toBe(true);
    expect(runtime.required_artifacts).toContain("note_update_receipt");
    expect(runtime.satisfied_artifacts).toContain("note_update_receipt");
    expect(answerText(response.body)).not.toMatch(/The turn stopped before required artifacts were satisfied/i);
  }, 20000);

  it("treats unsatisfied E14 model-declared artifacts as a typed failure instead of a successful final", async () => {
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "1";
    process.env.HELIX_E11_MODEL_DECISION_MAX_APPENDED_STEPS = "0";
    process.env.HELIX_E11_MODEL_DECISION_TEST_RESPONSE = JSON.stringify({
      decision: "continue_with_tool",
      summary: "A note update is still required.",
      next_capability: "workstation-notes.append_to_note",
      next_args: {
        title: "blocked note",
        text: "Blocked summary.",
      },
      required_artifacts: ["note_update_receipt"],
    });
    const app = await createApp();
    const sessionId = `e14-missing-artifact-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "summarize this document and save it to a note called blocked note",
        mode: "read",
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          activeDocPath: "/docs/research/example.md",
          hasDocContext: true,
        },
      })
      .expect(200);

    const runtime = response.body?.turn_runtime ?? {};
    expect(runtime.required_artifacts).toContain("note_update_receipt");
    expect(runtime.missing_required_artifacts).toContain("note_update_receipt");
    expect(runtime.terminal?.kind).toBe("final_failure");
    expect(runtime.terminal?.error_code).toBe("missing_required_artifacts");
    expect(answerText(response.body)).not.toMatch(/^Completed the planned tool steps\.?$/i);
  }, 20000);

  it("keeps deterministic observation continuation working when the E14 model hook is disabled", async () => {
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "0";
    const app = await createApp();
    const sessionId = `e14-deterministic-${Date.now()}`;
    const path =
      "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/warp-nhm2-mission-time-comparison-latest.md";

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "where does this document mention mission time?",
        mode: "read",
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          activeDocPath: path,
          hasDocContext: true,
        },
      })
      .expect(200);

    expect(response.body?.model_decision_llm_used).toBe(false);
    expect(response.body?.execution_trace?.some((step: any) => step?.action?.action_id === "locate_in_doc")).toBe(true);
    expect(answerText(response.body)).toMatch(/Locations:/i);
    expect(answerText(response.body)).not.toMatch(/Completed reasoning for|Steps:/i);
  }, 20000);
});
