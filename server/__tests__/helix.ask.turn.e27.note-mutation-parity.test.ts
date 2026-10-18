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
  "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/attempts/attempt-002/warp-nhm2-warp-worldline-proof-2026-04-27.md";

const answerText = (body: any): string => String(body?.assistant_answer ?? body?.answer ?? body?.text ?? "");
const stepArtifacts = (body: any): any[] =>
  (Array.isArray(body?.step_results) ? body.step_results : [])
    .map((step: any) => step?.result_artifact)
    .filter(Boolean);
const actions = (body: any): any[] => [
  ...(Array.isArray(body?.execution_trace) ? body.execution_trace.map((step: any) => step?.action).filter(Boolean) : []),
  ...(Array.isArray(body?.action_envelope?.workstation_actions) ? body.action_envelope.workstation_actions : []),
];
const parseSseEvents = (text: string): Array<{ event: string; data: any }> =>
  text
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() ?? "message";
      const dataRaw = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      let data: any = dataRaw;
      try {
        data = JSON.parse(dataRaw);
      } catch {
        // Keep raw text for malformed SSE blocks.
      }
      return { event, data };
    });

const baseWorkspace = (sessionId: string, noteTitle?: string) => ({
  sessionId,
  activePanel: "docs-viewer",
  activeDocPath: activePath,
  hasDocContext: true,
  hasNoteContext: Boolean(noteTitle),
  activeNoteId: noteTitle ? `note:${noteTitle.replace(/\s+/g, "-")}` : undefined,
  activeNoteTitle: noteTitle,
  lastCreatedNoteId: noteTitle ? `note:${noteTitle.replace(/\s+/g, "-")}` : undefined,
  lastCreatedNoteTitle: noteTitle,
  recentNotes: noteTitle ? [{ id: `note:${noteTitle.replace(/\s+/g, "-")}`, title: noteTitle }] : [],
});

describe("helix ask E27 note mutation parity", () => {
  it("keeps note create, summary append, and locate append terminal answers artifact-backed", async () => {
    const app = createApp();
    const sessionId = `e27-note-flow-${Date.now()}`;
    const noteTitle = "agent loop scratch note";

    const create = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: `create a note called ${noteTitle}`,
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId),
      })
      .expect(200);
    expect(answerText(create.body)).toMatch(new RegExp(`^(Created note: ${noteTitle}|Created workstation note "${noteTitle}")\\.`));
    expect(create.body?.final_composer_source).toBe("final_answer_draft");
    expect(create.body?.terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(create.body?.final_answer_source).not.toMatch(/note_.*receipt/);
    expect(stepArtifacts(create.body).some((artifact) => artifact?.kind === "note_update_receipt" && artifact?.title === noteTitle)).toBe(true);
    expect(answerText(create.body)).not.toMatch(/could not produce a substantive final answer/i);

    const summary = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what is this doc about?",
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId, noteTitle),
      })
      .expect(200);
    expect(answerText(summary.body)).not.toMatch(/could not produce a substantive final answer|could not produce a terminal answer/i);

    const appendSummary = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "add that summary to the note",
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId, noteTitle),
      })
      .expect(200);

    expect(answerText(appendSummary.body)).toMatch(new RegExp(`^Updated ${noteTitle} with the document summary\\.`));
    expect(appendSummary.body?.final_composer_source).toBe("final_answer_draft");
    expect(appendSummary.body?.terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(appendSummary.body?.final_answer_source).not.toMatch(/note_.*receipt/);
    expect(stepArtifacts(appendSummary.body).some((artifact) => artifact?.kind === "note_update_receipt" && artifact?.title === noteTitle)).toBe(true);
    expect(actions(appendSummary.body).some((action) => action?.panel_id === "workstation-notes" && action?.action_id === "append_to_note")).toBe(true);
    expect(answerText(appendSummary.body)).not.toMatch(/could not produce a substantive final answer/i);

    const locateAppend = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "put that centerline alpha location into the note",
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId, noteTitle),
      })
      .expect(200);

    expect(answerText(locateAppend.body)).toMatch(new RegExp(`^Updated ${noteTitle} with the centerline alpha location\\.`));
    expect(answerText(locateAppend.body)).toMatch(/Location:\s*\n- .+?, L\d+(?:-L\d+)?\n\s+Path: \/docs\/.+?:L\d+(?:-L\d+)?/i);
    expect(locateAppend.body?.final_composer_source).toBe("final_answer_draft");
    expect(locateAppend.body?.terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(locateAppend.body?.final_answer_source).not.toMatch(/note_.*receipt/);
    expect(stepArtifacts(locateAppend.body).some((artifact) => artifact?.kind === "doc_location_matches")).toBe(true);
    expect(stepArtifacts(locateAppend.body).some((artifact) => artifact?.kind === "note_update_receipt" && artifact?.title === noteTitle)).toBe(true);
    expect(answerText(locateAppend.body)).not.toMatch(/could not produce a substantive final answer|Reminder: Review/i);
  }, 60000);

  it("does not mutate a deictic note target when no active or last-created note exists", async () => {
    const app = createApp();
    const sessionId = `e27-note-missing-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "add that summary to the note",
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId),
      })
      .expect(200);
    expect(response.body?.pending_server_request?.required_fields).toContain("note_title");
    expect(actions(response.body).some((action) => action?.panel_id === "workstation-notes" && action?.action_id === "append_to_note")).toBe(false);
    expect(stepArtifacts(response.body).some((artifact) => artifact?.kind === "note_update_receipt")).toBe(false);
    expect(answerText(response.body)).toMatch(/Which note|name.*note|target note/i);
  }, 60000);

  it("keeps streaming terminal artifacts aligned with note update receipts", async () => {
    const app = createApp();
    const sessionId = `e27-note-stream-${Date.now()}`;
    const noteTitle = "ui e27 stream scratch";

    const response = await request(app)
      .post("/api/agi/ask/turn/stream")
      .send({
        question: "put that centerline alpha location into the note",
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId, noteTitle),
      })
      .expect(200);

    const events = parseSseEvents(response.text);
    const finalPacket = events.findLast((event) => event.event === "turn_final")?.data;
    expect(finalPacket).toBeTruthy();
    const finalText = answerText(finalPacket);
    expect(finalText).toMatch(new RegExp(`^Updated ${noteTitle} with the centerline alpha location\\.`));
    expect(finalText).toMatch(/Location:\s*\n- .+?, L\d+(?:-L\d+)?\n\s+Path: \/docs\/.+?:L\d+(?:-L\d+)?/i);
    expect(finalText).not.toMatch(/^Reminder:\s*Review/i);
    expect(finalPacket?.terminal_artifact?.text).toBe(finalText);
    expect(finalPacket?.latest_result_artifact?.text).toBe(finalText);
    expect(finalPacket?.turn_contract?.terminal_text).toBe(finalText);
    expect(finalPacket?.turn_runtime?.terminal?.text).toBe(finalText);
    const transcriptFinals = Array.isArray(finalPacket?.turn_transcript_events)
      ? finalPacket.turn_transcript_events.filter((event: any) => event?.type === "final_answer")
      : [];
    expect(transcriptFinals.length).toBeGreaterThan(0);
    expect(transcriptFinals.at(-1)?.text).toBe(finalText);
    const stepIds = Array.isArray(finalPacket?.execution_trace)
      ? finalPacket.execution_trace.map((step: any) => step?.id).filter(Boolean)
      : [];
    expect(stepIds).toContain("workspace_action_locate_exact");
    expect(stepIds).toContain("workspace_action_locate_variant");
    expect(stepIds).toContain("workspace_action_append_location_reminder");
    const noMatchTranscriptEvents = Array.isArray(finalPacket?.turn_transcript_events)
      ? finalPacket.turn_transcript_events.filter((event: any) => /no matches?|not found|could not locate/i.test(String(event?.text ?? "")))
      : [];
    expect(noMatchTranscriptEvents.every((event: any) => event?.status === "superseded")).toBe(true);
  }, 60000);
});



