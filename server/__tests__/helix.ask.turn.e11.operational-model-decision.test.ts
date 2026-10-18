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

describe("helix ask turn e11 operational model decisions", () => {
  it("turns a valid model continue decision into an executed appended capability step", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "1";
    process.env.HELIX_E11_MODEL_DECISION_MAX_APPENDED_STEPS = "1";
    process.env.HELIX_E11_MODEL_DECISION_TEST_RESPONSE = JSON.stringify({
      action: "continue",
      summary: "Append the document summary to the requested note.",
      next_capability: "workstation-notes.append_to_note",
      next_args: { title: "NHM2 summary", text: "Summary captured from the active document." },
      required_artifacts: ["note_update_receipt"],
    });
    const app = await createApp();
    const sessionId = `e11-operational-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "summarize this doc and put the result in a note called NHM2 summary",
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

    const events = response.body?.turn_events ?? [];
    const audits = response.body?.model_decision_audits ?? [];
    expect(audits.some((audit: any) => audit?.operational_step_appended === true)).toBe(true);
    expect(audits.some((audit: any) => audit?.next_capability === "workstation-notes.append_to_note")).toBe(true);
    expect(response.body?.execution_trace?.some((step: any) => step?.id?.startsWith("model_step_") && step?.action?.action_id === "append_to_note")).toBe(true);
    expect(response.body?.step_results?.some((step: any) => step?.step_id?.startsWith("model_step_") && step?.actual_artifacts?.includes("note_update_receipt"))).toBe(true);
    expect(events.some((event: any) => event?.type === "plan_delta" && event?.step?.id?.startsWith("model_step_"))).toBe(true);
    expect(events.some((event: any) => event?.type === "tool_result" && event?.step_id?.startsWith("model_step_"))).toBe(true);
    expect(String(response.body?.assistant_answer ?? response.body?.text ?? "")).toMatch(/added (?:summary|the result) to NHM2 summary/i);
  }, 15000);

  it("rejects invalid model-selected capabilities without executing them", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "1";
    process.env.HELIX_E11_MODEL_DECISION_MAX_APPENDED_STEPS = "1";
    process.env.HELIX_E11_MODEL_DECISION_TEST_RESPONSE = JSON.stringify({
      action: "continue",
      summary: "Try a fake tool.",
      next_capability: "fake.tool",
      next_args: {},
    });
    const app = await createApp();
    const sessionId = `e11-invalid-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "summarize this doc and keep going if needed",
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
    expect(audits.some((audit: any) => audit?.error_code === "invalid_next_capability")).toBe(true);
    expect(response.body?.execution_trace?.some((step: any) => String(step?.id ?? "").includes("fake"))).toBe(false);
  }, 15000);
});

