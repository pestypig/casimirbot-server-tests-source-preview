import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { planRouter } from "../routes/agi.plan";

const activePath =
  "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/warp-nhm2-route-time-worldline-2026-04-27.md";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

const answerText = (body: any): string => String(body?.assistant_answer ?? body?.answer ?? body?.text ?? "");

const baseWorkspace = (sessionId: string, noteTitle = "format scratch") => ({
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

describe("helix ask E35 answer reference formatting", () => {
  it("formats locate-to-note answers with prose separated from document references", async () => {
    const app = createApp();
    const sessionId = `e35-locate-note-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "put that light crossing location into format scratch",
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId),
      })
      .expect(200);

    const answer = answerText(response.body);
    expect(answer).toMatch(/^Updated format scratch with the light crossing location\./);
    expect(answer).toMatch(/\nLocation:\n- .+?, L\d+(?:-L\d+)?\n\s+Path: \/docs\/.+?:L\d+(?:-L\d+)?/);
    expect(answer.split("\n")[0]).not.toContain("/docs/");
    expect(response.body?.job_ready_links?.some((link: any) => String(link?.label ?? "").startsWith("Open location"))).toBe(true);
  }, 60000);

  it("formats active document summaries with a separate active-doc reference block", async () => {
    const app = createApp();
    const sessionId = `e35-summary-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what is this doc about?",
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId),
      })
      .expect(200);

    const answer = answerText(response.body);
    expect(answer).toMatch(/^Summary:/);
    expect(answer).toContain("\nActive doc:\n- ");
    expect(answer).toContain(`Path: ${activePath}`);
    expect(answer).not.toMatch(/^Summary:[^\n]*\/docs\//);
  }, 60000);

  it("formats open-doc answers with document references instead of inline path prose", async () => {
    const app = createApp();
    const sessionId = `e35-open-doc-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: `open ${activePath}`,
        mode: "read",
        sessionId,
      })
      .expect(200);

    const answer = answerText(response.body);
    expect(answer).toContain("Opened document:");
    expect(answer).toContain("\nDocument:\n- ");
    expect(answer).toContain(`Path: ${activePath}`);
    expect(answer).not.toContain(`Opened document: ${activePath}`);
  }, 60000);
});
