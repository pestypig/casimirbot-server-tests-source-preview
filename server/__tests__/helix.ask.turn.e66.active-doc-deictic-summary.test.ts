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

const parseSseEvents = (text: string): Array<{ event: string; data: any }> =>
  text
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!event || !data) return null;
      return { event, data: JSON.parse(data) };
    })
    .filter(Boolean) as Array<{ event: string; data: any }>;

const expectAuthoritativeDocSummarySurfaces = (body: any): void => {
  const summary = String(body?.selected_final_answer ?? "");
  const terminalEvent = Array.isArray(body?.turn_events)
    ? [...body.turn_events].reverse().find((event: any) => event?.type === "terminal_answer")
    : body?.current_turn_events?.terminal_answer;

  expect(summary).toBeTruthy();
  expect(body?.terminal_artifact_kind).toBe("doc_summary");
  expect(body?.final_answer_source).toBe("artifact_synthesis");
  expect(body?.terminal_error_code ?? null).toBeNull();
  expect(body?.terminal_answer_envelope?.terminal_text).toBe(summary);
  expect(body?.terminal_answer_authority?.server_authoritative).toBe(true);
  expect(body?.terminal_answer_authority?.terminal_text_preview).toBe(summary);
  expect(body?.terminal_presentation?.concise_text).toBe(summary);
  expect(body?.answer).toBe(summary);
  expect(body?.text).toBe(summary);
  expect(body?.finalAnswer).toBe(summary);
  expect(body?.content).toBe(summary);
  expect(terminalEvent?.text).toBe(summary);
  expect(body?.terminal_presentation_coverage_audit?.violations ?? []).toEqual([]);
  expect(summary).not.toContain("terminal_authority_missing");
};

const activePath =
  "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/warp-nhm2-observer-audit-2026-04-25.md";

describe("helix ask E66 active document deictic summary", () => {
  it("summarizes the active document instead of refusing as no-tool", async () => {
    const app = createApp();
    const sessionId = `e66-active-doc-summary-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what is this doc about?",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          activeDocPath: activePath,
          hasDocContext: true,
        },
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("active_doc_summary");
    expect(response.body?.terminal_artifact_kind).toBe("doc_summary");
    expect(response.body?.final_answer_source).toBe("artifact_synthesis");
    expect(String(response.body?.selected_final_answer ?? "")).toContain(activePath);
    expect(String(response.body?.selected_final_answer ?? "")).not.toMatch(/cannot access or summarize specific documents/i);
    expect(response.body?.resolved_turn_summary?.resolved_route_label).toBe("active_doc_summary / artifact_synthesis");
    expect(response.body?.resolved_turn_summary?.final_answer_source).toBe("artifact_synthesis");
    expect(response.body?.available_capabilities?.schema).toBe("helix.available_capabilities.v1");
    expect(response.body?.available_capabilities?.recommended_capability_key).toBe("docs-viewer.summarize_doc");
    expect(response.body?.agent_step_decision?.chosen_capability).toBe("docs-viewer.summarize_doc");
    expect(response.body?.initial_agent_step_decision).toMatchObject({
      authority: "agent_step_decision",
      chosen_capability: "docs-viewer.summarize_doc",
    });
    expect(response.body?.agent_step_authority_check).toMatchObject({
      expected_capability: "docs-viewer.summarize_doc",
      planned_capability: "docs-viewer.summarize_doc",
      consistent: true,
      enforcement: "authoritative",
    });
    expect(response.body?.observation_review?.does_it_satisfy_goal).toBe(true);
  }, 90000);

  it("summarizes descriptor-qualified current documents", async () => {
    const app = createApp();
    const sessionId = `e66-current-nhm2-doc-summary-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Summarize the current NHM2 document in three bullets",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          activeDocPath: activePath,
          hasDocContext: true,
        },
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("active_doc_summary");
    expect(response.body?.terminal_artifact_kind).toBe("doc_summary");
    expect(response.body?.terminal_error_code ?? null).toBeNull();
    expect(String(response.body?.selected_final_answer ?? "")).toContain(activePath);
  }, 90000);

  it("treats UI-rewritten current-doc summary prompts as active-doc summary, not repo-code evidence", async () => {
    const app = createApp();
    const sessionId = `e66-ui-rewrite-doc-summary-${Date.now()}`;
    const currentStatusPath = "/docs/research/nhm2-current-status-whitepaper.md";

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: [
          "Summarize this document from the current docs viewer context. Start with one sentence on what this document is for, then key findings and caveats.",
          `Document path: ${currentStatusPath}`,
        ].join("\n"),
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          activeDocPath: currentStatusPath,
          docContextPath: currentStatusPath,
          hasDocContext: true,
          docContextValid: true,
        },
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("active_doc_summary");
    expect(response.body?.terminal_artifact_kind).toBe("doc_summary");
    expect(response.body?.terminal_error_code ?? null).toBeNull();
    expect(String(response.body?.selected_final_answer ?? "")).toContain(currentStatusPath);
    expect(String(response.body?.route_reason_code ?? "")).not.toMatch(/repo_code/i);
  }, 90000);

  it("uses an explicit document path in UI-rewritten summary prompts when workspace active doc is missing", async () => {
    const app = createApp();
    const sessionId = `e66-ui-rewrite-explicit-path-${Date.now()}`;
    const deeperPath = "/docs/research/nhm2-deeper-reformulation-decision-memo-2026-04-02.md";

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: [
          "Summarize this document from the current docs viewer context. Start with one sentence on what this document is for, then key findings and caveats.",
          `Document path: ${deeperPath}`,
          'Locate query: "NHM2 deeper reformulation decision memo"',
        ].join("\n"),
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          hasDocContext: false,
          docContextValid: false,
        },
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("active_doc_summary");
    expect(response.body?.terminal_artifact_kind).toBe("doc_summary");
    expect(response.body?.terminal_error_code ?? null).toBeNull();
    expect(String(response.body?.selected_final_answer ?? "")).toContain(deeperPath);
    expect(response.body?.active_doc_summary_intent?.reasons ?? []).toContain("explicit_doc_path_available");
  }, 90000);

  it("keeps exact /docs path summary prompts in the docs summary lane", async () => {
    const app = createApp();
    const sessionId = `e66-exact-doc-path-summary-${Date.now()}`;
    const currentStatusPath = "/docs/research/nhm2-current-status-whitepaper.md";

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: `Summarize ${currentStatusPath} from docs. Cover lapse shift and source closure. Return the path.`,
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          hasDocContext: false,
          docContextValid: false,
        },
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_summary");
    expect(response.body?.terminal_artifact_kind).toBe("doc_summary");
    expect(response.body?.terminal_error_code ?? null).toBeNull();
    expect(String(response.body?.selected_final_answer ?? "")).toContain(currentStatusPath);
    expect(String(response.body?.route_reason_code ?? "")).not.toMatch(/repo_code/i);
    expect(response.body?.available_capabilities?.recommended_capability_key).toBe("docs-viewer.summarize_doc");
    expect(response.body?.agent_step_decision?.chosen_capability).toBe("docs-viewer.summarize_doc");
  }, 90000);

  it("materializes the exact docs-viewer open-and-summarize prompt into authoritative terminal surfaces", async () => {
    const app = createApp();
    const sessionId = `e66-docs-flow-summary-${Date.now()}`;
    const question =
      "Use the Docs Viewer to open docs/helix-ask-flow.md, then summarize the document in three bullets for someone debugging Ask routing.";

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question,
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          hasDocContext: false,
          docContextValid: false,
        },
      })
      .expect(200);

    expect(response.body?.available_capabilities?.recommended_capability_key).toBe("docs-viewer.summarize_doc");
    expect(response.body?.agent_step_decision?.chosen_capability).toBe("docs-viewer.summarize_doc");
    expect(response.body?.goal_satisfaction_evaluation?.satisfaction).toBe("satisfied");
    expect(response.body?.goal_satisfaction_evaluation?.next_decision).toBe("allow_terminal");
    expectAuthoritativeDocSummarySurfaces(response.body);
    expect(String(response.body?.selected_final_answer ?? "")).toContain("docs/helix-ask-flow.md");
  }, 90000);

  it("streams the exact docs-viewer open-and-summarize prompt with doc_summary authority mirrors", async () => {
    const app = createApp();
    const sessionId = `e66-docs-flow-summary-stream-${Date.now()}`;
    const question =
      "Use the Docs Viewer to open docs/helix-ask-flow.md, then summarize the document in three bullets for someone debugging Ask routing.";

    const response = await request(app)
      .post("/api/agi/ask/turn/stream")
      .send({
        question,
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          hasDocContext: false,
          docContextValid: false,
        },
      })
      .expect(200);

    const events = parseSseEvents(response.text ?? "");
    const finalPacket = events.findLast((event) => event.event === "turn_final")?.data;
    const terminalEvent = events.findLast((event) => event.event === "turn_transcript_event" && event.data?.source_event_type === "terminal_answer")?.data;

    expect(finalPacket).toBeTruthy();
    expect(finalPacket?.available_capabilities?.recommended_capability_key).toBe("docs-viewer.summarize_doc");
    expect(finalPacket?.agent_step_decision?.chosen_capability).toBe("docs-viewer.summarize_doc");
    expectAuthoritativeDocSummarySurfaces(finalPacket);
    expect(terminalEvent?.text).toBe(finalPacket?.selected_final_answer);
    expect(finalPacket?.client_server_terminal_match).toBe(true);
  }, 90000);

  it("fails cleanly when a deictic doc summary has no active document", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what is this doc about?",
        mode: "read",
        debug: true,
        sessionId: `e66-active-doc-missing-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          hasDocContext: false,
        },
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("active_doc_summary");
    expect(response.body?.terminal_artifact_kind).toBe("typed_failure");
    expect(response.body?.terminal_error_code).toBe("active_doc_summary_unavailable");
    expect(response.body?.resolved_turn_summary?.resolved_route_label).toBe(
      "active_doc_summary / typed_failure:active_doc_summary_unavailable",
    );
  }, 90000);

  it("does not let background-only doc-summary concepts use the workspace", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Background only: what is a document summary?",
        mode: "read",
        debug: true,
        sessionId: `e66-background-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          activeDocPath: activePath,
          hasDocContext: true,
        },
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("model_only_concept");
    expect(response.body?.final_answer_source).not.toBe("artifact_synthesis");
    expect(response.body?.terminal_artifact_kind).not.toBe("doc_summary");
    expect(response.body?.available_capabilities?.recommended_capability_key).toBe("model.direct_answer");
    expect(response.body?.agent_step_decision?.chosen_capability).toBe("model.direct_answer");
  }, 90000);
});
