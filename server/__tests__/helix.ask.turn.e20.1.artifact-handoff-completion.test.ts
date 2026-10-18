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
  "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/warp-nhm2-cruise-envelope-preflight-latest.md";

const actions = (body: any): any[] => body?.action_envelope?.workstation_actions ?? [];
const traceActions = (body: any): any[] => (body?.execution_trace ?? []).map((step: any) => step?.action).filter(Boolean);
const answerText = (body: any): string => String(body?.assistant_answer ?? body?.answer ?? body?.text ?? "");

describe("helix ask turn artifact handoff completion", () => {
  it("passes a concrete doc summary artifact into append_to_note", async () => {
    const app = createApp();
    const sessionId = `artifact-summary-note-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "summarize the doc we are viewing into artifact handoff test",
        mode: "read",
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          activeDocPath: activePath,
          hasDocContext: true,
          hasNoteContext: true,
          activeNoteTitle: "artifact handoff test",
          lastCreatedNoteTitle: "artifact handoff test",
        },
      })
      .expect(200);

    const orderedActions = [...traceActions(response.body), ...actions(response.body)];
    const summarizeIndex = orderedActions.findIndex(
      (action: any) => action?.panel_id === "docs-viewer" && action?.action_id === "summarize_doc",
    );
    const appendIndex = orderedActions.findIndex(
      (action: any) => action?.panel_id === "workstation-notes" && action?.action_id === "append_to_note",
    );
    expect(summarizeIndex).toBeGreaterThanOrEqual(0);
    expect(appendIndex).toBeGreaterThan(summarizeIndex);

    const appendAction = orderedActions[appendIndex];
    const appendText = String(appendAction?.args?.text ?? "");
    expect(appendAction?.args?.title).toBe("artifact handoff test");
    expect(appendAction?.args?.text_kind).toBe("doc_summary");
    expect(appendText).toMatch(/Explained|Key claim|bounded NHM2|Summary unavailable/i);
    expect(appendText).not.toContain("{{doc_summary_text}}");
    expect(appendText).not.toMatch(/Summary unavailable because no document summary artifact was produced/i);
    expect(answerText(response.body)).toMatch(/artifact handoff test|Added summary|Summarized/i);
  });

  it("treats arbitrary existing note titles as summary sinks", async () => {
    const app = createApp();
    const sessionId = `artifact-summary-arbitrary-note-${Date.now()}`;
    const noteTitle = `artifact UI handoff ${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: `summarize the doc we are viewing into ${noteTitle}`,
        mode: "read",
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          activeDocPath: activePath,
          hasDocContext: true,
          hasNoteContext: true,
          activeNoteTitle: noteTitle,
          lastCreatedNoteTitle: noteTitle,
        },
      })
      .expect(200);

    const orderedActions = [...traceActions(response.body), ...actions(response.body)];
    const appendAction = orderedActions.find(
      (action: any) => action?.panel_id === "workstation-notes" && action?.action_id === "append_to_note",
    );
    expect(appendAction?.args?.title).toBe(noteTitle);
    expect(appendAction?.args?.text_kind).toBe("doc_summary");
    expect(String(appendAction?.args?.text ?? "")).not.toContain("{{doc_summary_text}}");
    expect(answerText(response.body)).not.toMatch(/stopped before required artifacts were satisfied/i);
  });

  it("passes concrete location artifact text into append_to_note", async () => {
    const app = createApp();
    const sessionId = `artifact-location-note-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "put the centerline alpha location into artifact handoff test",
        mode: "read",
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          activeDocPath: activePath,
          hasDocContext: true,
          hasNoteContext: true,
          activeNoteTitle: "artifact handoff test",
          lastCreatedNoteTitle: "artifact handoff test",
        },
      })
      .expect(200);

    const orderedActions = [...traceActions(response.body), ...actions(response.body)];
    const locateIndex = orderedActions.findIndex(
      (action: any) => action?.panel_id === "docs-viewer" && action?.action_id === "locate_in_doc",
    );
    const appendIndex = orderedActions.findIndex(
      (action: any) => action?.panel_id === "workstation-notes" && action?.action_id === "append_to_note",
    );
    expect(locateIndex).toBeGreaterThanOrEqual(0);
    expect(appendIndex).toBeGreaterThan(locateIndex);

    const appendAction = orderedActions[appendIndex];
    const appendText = String(appendAction?.args?.text ?? "");
    expect(appendAction?.args?.title).toBe("artifact handoff test");
    expect(appendAction?.args?.text_kind).toBe("doc_location_reminder");
    expect(appendText).toMatch(/centerline alpha|Locations:|L\d+|Reminder: Review/i);
    expect(appendText).not.toMatch(/has been determined and is ready to be saved/i);
    expect(appendText).not.toContain("{{doc_location_reminder_text}}");
    expect(answerText(response.body)).toMatch(/artifact handoff test|Locations:|Found the requested document location/i);
    expect(answerText(response.body)).not.toMatch(/could not produce a substantive final answer/i);
  }, 60000);

  it("keeps locate-to-note final answers substantive for arbitrary note titles", async () => {
    const app = createApp();
    const sessionId = `artifact-location-arbitrary-note-${Date.now()}`;
    const noteTitle = `artifact handoff browser ${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: `put the centerline alpha location into ${noteTitle}`,
        mode: "read",
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          activeDocPath: activePath,
          hasDocContext: true,
          hasNoteContext: true,
          activeNoteTitle: noteTitle,
          lastCreatedNoteTitle: noteTitle,
        },
      })
      .expect(200);

    const text = answerText(response.body);
    const orderedActions = [...traceActions(response.body), ...actions(response.body)];
    expect(
      orderedActions.some((action: any) => action?.panel_id === "docs-viewer" && action?.action_id === "locate_in_doc"),
    ).toBe(true);
    expect(
      orderedActions.some((action: any) => action?.panel_id === "workstation-notes" && action?.action_id === "append_to_note"),
    ).toBe(true);
    expect(text).toMatch(new RegExp(noteTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    expect(text).toMatch(/Found the requested document location|Locations:|L\d+/i);
    expect(text).not.toMatch(/could not produce a substantive final answer/i);
    expect(String(response.body?.final_status ?? "")).not.toBe("final_failure");
  }, 60000);
});



