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
const verifiedNoteTitle = "E25 verified note";
const verifiedNoteBody = [
  `Source: ${activePath}`,
  "Summary: Verified note captures the NHM2 centerline alpha route-time document.",
  "Centerline alpha location: L17-L21.",
].join("\n");

const workspaceSnapshot = (overrides: Record<string, unknown> = {}) => ({
  activePanel: "docs-viewer",
  activeDocPath: activePath,
  activeNoteId: "note:e25-verified-note",
  activeNoteTitle: verifiedNoteTitle,
  activeNoteBody: verifiedNoteBody,
  lastCreatedNoteId: "note:e25-verified-note",
  lastCreatedNoteTitle: verifiedNoteTitle,
  lastCreatedNoteBody: verifiedNoteBody,
  recentNotes: [{ id: "note:e25-verified-note", title: verifiedNoteTitle, body: verifiedNoteBody }],
  hasDocContext: true,
  hasNoteContext: true,
  ...overrides,
});

const answerText = (body: any): string => String(body?.assistant_answer ?? body?.answer ?? body?.text ?? "");
const jobLinks = (body: any): any[] => (Array.isArray(body?.job_ready_links) ? body.job_ready_links : []);
const resultArtifacts = (body: any): any[] =>
  (Array.isArray(body?.step_results) ? body.step_results : [])
    .map((step: any) => step?.result_artifact)
    .filter(Boolean);

const linkLabels = (body: any): string[] => jobLinks(body).map((link) => String(link?.label ?? ""));
const linkTypes = (body: any): string[] => jobLinks(body).map((link) => String(link?.type ?? ""));

describe("helix ask E25 note target verification", () => {
  it("gates a named missing note compare to typed pending input", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "compare this document with a note called definitely missing E25 note and tell me the main differences",
        mode: "read",
        sessionId: `e25-missing-note-${Date.now()}`,
        workspace_context_snapshot: workspaceSnapshot(),
      })
      .expect(200);

    expect(response.body?.pending_server_request?.required_fields).toContain("note_title");
    expect(answerText(response.body)).toMatch(/could not find a note named "definitely missing E25 note"|Which note should I compare/i);
    expect(answerText(response.body)).not.toMatch(/Key differences:|Compared .* against note|Already in note:/i);
    expect(resultArtifacts(response.body).some((artifact) => artifact?.kind === "doc_vs_note_compare")).toBe(false);
    expect(jobLinks(response.body).some((link) => link?.type === "open_note")).toBe(false);
  }, 60000);

  it("compares against an existing named note and emits verified note artifact", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "compare this document with a note called E25 verified note and tell me the main differences",
        mode: "read",
        sessionId: `e25-existing-note-${Date.now()}`,
        workspace_context_snapshot: workspaceSnapshot(),
      })
      .expect(200);

    const artifacts = resultArtifacts(response.body);
    const compareArtifact = artifacts.find((artifact) => artifact?.kind === "doc_vs_note_compare");
    expect(response.body?.pending_server_request).toBeFalsy();
    expect(compareArtifact).toBeTruthy();
    expect(compareArtifact?.note_title).toBe(verifiedNoteTitle);
    expect(compareArtifact?.note_target_verified).toBe(true);
    expect(artifacts.some((artifact) => artifact?.kind === "note_target_verified" && artifact?.note_title === verifiedNoteTitle)).toBe(true);
    expect(answerText(response.body)).toMatch(/Already in note:/i);
    expect(answerText(response.body)).toMatch(/Missing from note:/i);
    expect(answerText(response.body)).not.toMatch(/\b(?:may contain|could include|might have|use it as)\b/i);
    expect(linkLabels(response.body)).toContain("Open compared doc");
    expect(linkLabels(response.body)).toContain(`Open note: ${verifiedNoteTitle}`);
  }, 60000);

  it("still resolves deictic note targets to the active note", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "compare this document with that note and tell me the main differences",
        mode: "read",
        sessionId: `e25-that-note-${Date.now()}`,
        workspace_context_snapshot: workspaceSnapshot(),
      })
      .expect(200);

    const compareArtifact = resultArtifacts(response.body).find((artifact) => artifact?.kind === "doc_vs_note_compare");
    expect(response.body?.pending_server_request).toBeFalsy();
    expect(compareArtifact?.note_title).toBe(verifiedNoteTitle);
    expect(answerText(response.body)).toMatch(/Already in note:/i);
    expect(answerText(response.body)).toMatch(/Missing from note:/i);
    expect(answerText(response.body)).not.toMatch(/\b(?:may contain|could include|might have|use it as)\b/i);
    expect(linkTypes(response.body)).toContain("open_note");
  }, 60000);

  it("strips trailing task suffix from explicit note title before pending", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "compare this document with a note called definitely missing E25 note and tell me the main differences",
        mode: "read",
        sessionId: `e25-title-cleanup-${Date.now()}`,
        workspace_context_snapshot: workspaceSnapshot(),
      })
      .expect(200);

    expect(answerText(response.body)).toContain("definitely missing E25 note");
    expect(answerText(response.body)).not.toContain("definitely missing E25 note and tell me the main differences");
  }, 60000);
});
