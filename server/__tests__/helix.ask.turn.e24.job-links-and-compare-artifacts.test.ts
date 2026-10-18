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

const activePath =
  "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/warp-nhm2-route-time-worldline-2026-04-25.md";
const noteTitle = "scrambled NHM2 compare scratch";
const noteBody = [
  `Source: ${activePath}`,
  "Summary: Existing note covers an NHM2 alpha-sweep route-time worldline result.",
  "Centerline alpha location: lines L17-L21.",
].join("\n");

const workspaceSnapshot = (overrides: Record<string, unknown> = {}) => ({
  activePanel: "docs-viewer",
  activeDocPath: activePath,
  activeNoteTitle: noteTitle,
  activeNoteBody: noteBody,
  lastCreatedNoteTitle: noteTitle,
  lastCreatedNoteBody: noteBody,
  recentNotes: [{ id: "note:scrambled-nhm2-compare-scratch", title: noteTitle, body: noteBody }],
  hasDocContext: true,
  hasNoteContext: true,
  ...overrides,
});

const answerText = (body: any): string => String(body?.assistant_answer ?? body?.answer ?? body?.text ?? "");
const trace = (body: any): any[] => body?.execution_trace ?? [];
const actions = (body: any): string[] =>
  trace(body)
    .map((step: any) => step?.action)
    .filter(Boolean)
    .map((action: any) => `${action.panel_id}.${action.action_id}`);
const jobLinks = (body: any): any[] => (Array.isArray(body?.job_ready_links) ? body.job_ready_links : []);
const resultArtifacts = (body: any): any[] =>
  (Array.isArray(body?.step_results) ? body.step_results : [])
    .map((step: any) => step?.result_artifact)
    .filter(Boolean);
const linkTypes = (body: any): string[] => jobLinks(body).map((link) => String(link?.type ?? ""));

describe("helix ask E24 job links and compare artifacts", () => {
  it("suppresses active doc links for simple no-tool turns", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "hello, are you awake?",
        mode: "read",
        sessionId: `e24-simple-${Date.now()}`,
        workspace_context_snapshot: workspaceSnapshot(),
      })
      .expect(200);

    expect(answerText(response.body)).toMatch(/Helix Ask is responding/i);
    expect(actions(response.body)).toEqual([]);
    expect(response.body?.final_answer_contract_family).toBe("simple");
    expect(jobLinks(response.body).some((link) => link?.id === "active-doc" || link?.type === "open_doc")).toBe(false);
    expect(response.body?.job_ready_links_suppressed).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "active-doc", reason: "no_current_turn_doc_artifact" })]),
    );
  }, 60000);

  it("exposes note link only for pure create-note turns", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "make a note called scrambled NHM2 compare scratch",
        mode: "read",
        sessionId: `e24-create-note-${Date.now()}`,
        workspace_context_snapshot: workspaceSnapshot({ activeNoteTitle: null, lastCreatedNoteTitle: null }),
      })
      .expect(200);

    expect(answerText(response.body)).toBe(`Created note: ${noteTitle}.`);
    expect(actions(response.body)).toContain("workstation-notes.create_note");
    expect(linkTypes(response.body)).toContain("open_note");
    expect(jobLinks(response.body).some((link) => link?.type === "open_doc")).toBe(false);
    expect(jobLinks(response.body).some((link) => String(link?.label ?? "").includes(noteTitle))).toBe(true);
  }, 60000);

  it("exposes doc link for doc-open turns", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open a doc about light crossing speed",
        mode: "read",
        sessionId: `e24-open-doc-${Date.now()}`,
        workspace_context_snapshot: workspaceSnapshot(),
      })
      .expect(200);

    expect(actions(response.body).some((action) => action.startsWith("docs-viewer."))).toBe(true);
    expect(linkTypes(response.body)).toContain("open_doc");
  }, 60000);

  it("emits typed doc-vs-note compare artifact and doc/note links", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "compare this document with scrambled NHM2 compare scratch and tell me the main differences",
        mode: "read",
        sessionId: `e24-compare-${Date.now()}`,
        workspace_context_snapshot: workspaceSnapshot(),
      })
      .expect(200);

    const compareArtifact = resultArtifacts(response.body).find((artifact) => artifact?.kind === "doc_vs_note_compare");
    expect(answerText(response.body)).toMatch(/Already in note:/i);
    expect(answerText(response.body)).toMatch(/Missing from note:/i);
    expect(answerText(response.body)).not.toMatch(/\b(?:may contain|could include|might have|use it as)\b/i);
    expect(compareArtifact).toBeTruthy();
    expect(compareArtifact?.doc_path).toBe(activePath);
    expect(compareArtifact?.note_title).toBe(noteTitle);
    expect(compareArtifact?.already_in_note?.length).toBeGreaterThan(0);
    expect(compareArtifact?.missing_from_note?.length).toBeGreaterThan(0);
    expect(compareArtifact?.note_body_available).toBe(true);
    expect(linkTypes(response.body)).toContain("open_doc");
    expect(linkTypes(response.body)).toContain("open_note");
  }, 60000);

  it("uses typed pending input instead of partial compare prose when note target is missing", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "compare this document with that note and tell me the main differences",
        mode: "read",
        sessionId: `e24-missing-note-${Date.now()}`,
        workspace_context_snapshot: workspaceSnapshot({
          activeNoteTitle: null,
          activeNoteBody: null,
          lastCreatedNoteTitle: null,
          lastCreatedNoteBody: null,
          recentNotes: [],
          hasNoteContext: false,
        }),
      })
      .expect(200);

    expect(response.body?.pending_server_request?.required_fields).toContain("note_title");
    expect(resultArtifacts(response.body).some((artifact) => artifact?.kind === "doc_vs_note_compare")).toBe(false);
    expect(answerText(response.body)).not.toMatch(/Key differences:|Compared .* against note|Already in note:/i);
    expect(answerText(response.body)).toMatch(/Which note should I compare/i);
  }, 60000);

  it("fails closed when a compare turn has a note title but no note content artifact", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "compare this document with scrambled NHM2 compare scratch and tell me the main differences",
        mode: "read",
        sessionId: `e24-missing-note-content-${Date.now()}`,
        workspace_context_snapshot: workspaceSnapshot({
          activeNoteBody: null,
          lastCreatedNoteBody: null,
          recentNotes: [{ id: "note:scrambled-nhm2-compare-scratch", title: noteTitle }],
        }),
      })
      .expect(200);

    expect(response.body?.final_composer_source).toBe("note_content_unavailable");
    expect(response.body?.final_composer_contract_pass).toBe(false);
    expect(answerText(response.body)).toMatch(/note content artifact is unavailable/i);
    expect(answerText(response.body)).not.toMatch(/Already in note:|Missing from note:/i);
  }, 60000);
});
