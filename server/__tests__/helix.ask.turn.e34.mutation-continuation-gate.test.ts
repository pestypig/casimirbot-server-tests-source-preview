import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

const activePath =
  "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/warp-nhm2-route-time-worldline-2026-04-27.md";

const createApp = async (): Promise<express.Express> => {
  const { planRouter } = await import("../routes/agi.plan");
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

const answerText = (body: any): string => String(body?.assistant_answer ?? body?.answer ?? body?.text ?? "");
const stepArtifacts = (body: any): any[] =>
  (Array.isArray(body?.step_results) ? body.step_results : [])
    .map((step: any) => step?.result_artifact ?? step?.artifact)
    .filter(Boolean);
const executedActions = (body: any): any[] =>
  Array.isArray(body?.execution_trace) ? body.execution_trace.map((step: any) => step?.action).filter(Boolean) : [];
const jobReadyLabels = (body: any): string[] =>
  (Array.isArray(body?.job_ready_links) ? body.job_ready_links : []).map((link: any) => String(link?.label ?? ""));

const baseWorkspace = (sessionId: string, noteTitle: string) => ({
  sessionId,
  activePanel: "docs-viewer",
  activeDocPath: activePath,
  hasDocContext: true,
  hasNoteContext: true,
  activeNoteId: `note:${noteTitle.replace(/\s+/g, "-")}`,
  activeNoteTitle: noteTitle,
  lastCreatedNoteId: `note:${noteTitle.replace(/\s+/g, "-")}`,
  lastCreatedNoteTitle: noteTitle,
  recentNotes: [{ id: `note:${noteTitle.replace(/\s+/g, "-")}`, title: noteTitle }],
});

describe("helix ask E34 mutation continuation gate", () => {
  afterEach(() => {
    delete process.env.HELIX_E11_MODEL_DECISION_LLM;
    delete process.env.HELIX_E14_OBSERVATION_MODEL_DECISION;
    delete process.env.HELIX_E11_MODEL_DECISION_TEST_RESPONSE;
    vi.resetModules();
  });

  it("does not let model continuation create an extra note after locate-to-note update is satisfied", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "1";
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "1";
    process.env.HELIX_E11_MODEL_DECISION_TEST_RESPONSE = JSON.stringify({
      decision: "continue_with_tool",
      summary: "Create a separate location note.",
      next_capability: "workstation-notes.create_note",
      next_args: { title: "Light Crossing Location" },
      required_artifacts: [],
    });
    vi.resetModules();

    const app = await createApp();
    const sessionId = `e34-mutation-gate-${Date.now()}`;
    const noteTitle = "mixed audit scratch";

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "put that light crossing location into mixed audit scratch",
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId, noteTitle),
      })
      .expect(200);

    expect(answerText(response.body)).toMatch(/^Updated mixed audit scratch with the light crossing location\./);
    expect(answerText(response.body)).toMatch(/Location:\n- .+?, L\d+(?:-L\d+)?\n\s+Path: \/docs\/.+?:L\d+(?:-L\d+)?/i);
    expect(response.body?.final_composer_source).toBe("final_answer_draft");
    expect(response.body?.terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(response.body?.final_answer_source).not.toMatch(/note_.*receipt/);
    expect(response.body?.turn_runtime?.runtime_loop_stop_reason).toBe("terminal_artifact_satisfied");
    expect(stepArtifacts(response.body).some((artifact) => artifact?.kind === "doc_location_matches")).toBe(true);
    expect(stepArtifacts(response.body).some((artifact) => artifact?.kind === "note_update_receipt" && artifact?.title === noteTitle)).toBe(true);
    expect(stepArtifacts(response.body).some((artifact) => artifact?.kind === "note_create_receipt")).toBe(false);
    expect(executedActions(response.body).some((action) => action?.panel_id === "workstation-notes" && action?.action_id === "create_note")).toBe(false);
    expect(JSON.stringify(response.body)).not.toMatch(/Light Crossing Location/);
    expect(jobReadyLabels(response.body)).toContain("Open note: mixed audit scratch");
    expect(jobReadyLabels(response.body)).not.toContain("Open note: Light Crossing Location");
    expect(response.body?.invariant_violations ?? []).toEqual([]);
  }, 60000);

  it("still allows explicit note creation", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "0";
    vi.resetModules();

    const app = await createApp();
    const sessionId = `e34-create-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "create a note called Light Crossing Location",
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId, "mixed audit scratch"),
      })
      .expect(200);

    expect(answerText(response.body)).toMatch(/^Created workstation note "Light Crossing Location"\./);
    expect(stepArtifacts(response.body).some((artifact) => artifact?.kind === "note_update_receipt" && artifact?.title === "Light Crossing Location")).toBe(true);
    expect(jobReadyLabels(response.body)).toContain("Open note: Light Crossing Location");
  }, 60000);
});
