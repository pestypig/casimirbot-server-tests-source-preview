import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import {
  __helixAskTurnWorkspaceSnapshotTestApi,
  planRouter,
} from "../routes/agi.plan";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

const answerText = (body: any): string => String(body?.assistant_answer ?? body?.answer ?? body?.text ?? "");

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

describe("helix ask turn e10.28 ui regressions", () => {
  it("streams a terminal payload for model-only direct-answer turns after runtime completion", async () => {
    const app = createApp();
    const sessionId = `e1028-model-only-stream-${Date.now()}`;
    const question = "What is 2 plus 2? Answer in one short sentence.";

    const response = await request(app)
      .post("/api/agi/ask/turn/stream")
      .send({
        question,
        mode: "read",
        debug: true,
        sessionId,
        context_mode: "isolated",
        turn_input_items: [{ type: "text", source: "user", text: question }],
      })
      .expect(200);

    const events = parseSseEvents(response.text ?? "");
    const transcriptEvents = events.filter((event) => event.event === "turn_transcript_event");
    const finalPacket = events.findLast((event) => event.event === "turn_final")?.data;

    expect(transcriptEvents.some((event) => event.data?.source_event_type === "item_completed")).toBe(true);
    expect(finalPacket).toBeTruthy();
    expect(finalPacket?.client_server_terminal_match).toBe(true);
    expect(finalPacket?.terminal_answer_authority?.server_authoritative).toBe(true);
  }, 60_000);

  it("streams turn transcript events and a final ask turn payload", async () => {
    const app = createApp();
    const sessionId = `e1028-stream-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn/stream")
      .send({
        question: "what is this doc about?",
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

    expect(response.headers["content-type"]).toMatch(/text\/event-stream/);
    const text = response.text ?? "";
    const events = parseSseEvents(text);
    const transcriptEvents = events.filter((event) => event.event === "turn_transcript_event");
    const finalPacket = events.findLast((event) => event.event === "turn_final")?.data;
    expect(text).toContain("event: turn_transcript_event");
    expect(text).toContain("event: turn_final");
    expect(text).toContain("\"stream_used\":true");
    expect(text).toContain("\"stream_mode\":\"live_runtime\"");
    expect(text).toContain("\"stream_replay\":false");
    expect(text.indexOf("event: turn_transcript_event")).toBeLessThan(text.indexOf("event: turn_final"));
    expect(transcriptEvents.length).toBeGreaterThan(0);
    expect(finalPacket?.turn_id).toBeTruthy();
    expect(transcriptEvents.every((event) => event.data?.turn_id === finalPacket?.turn_id)).toBe(true);
    expect(transcriptEvents.some((event) => event.data?.event_source === "live")).toBe(true);
    expect(transcriptEvents.some((event) => event.data?.type === "public_commentary")).toBe(true);
    expect(finalPacket?.turn_transcript_live_event_count).toBeGreaterThan(0);
    expect(finalPacket?.turn_transcript_reconstructed_fallback_count).toEqual(expect.any(Number));
  });

  it("advertises a backend debug export ref for stream-final docs search failures", async () => {
    const app = createApp();
    const sessionId = `e1028-stream-debug-ref-${Date.now()}`;
    const question = "Search docs for Helix Ask console debug and tell me which document path you found.";

    const response = await request(app)
      .post("/api/agi/ask/turn/stream")
      .send({
        question,
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    const events = parseSseEvents(response.text ?? "");
    const finalPacket = events.findLast((event) => event.event === "turn_final")?.data;
    const debugEndpoint = finalPacket?.debug_export_ref?.endpoint;

    expect(finalPacket?.turn_id).toBeTruthy();
    expect(debugEndpoint).toBe(`/api/agi/ask/turn/${encodeURIComponent(String(finalPacket.turn_id))}/debug-export`);
    expect(finalPacket?.debug_export_payload_hash).toEqual(expect.any(String));
    expect(finalPacket?.debug?.debug_export_ref?.endpoint).toBe(debugEndpoint);

    const debugExport = await request(app)
      .get(debugEndpoint)
      .expect(200);

    expect(debugExport.body?.ok).toBe(true);
    expect(debugExport.body?.payload?.active_turn_id).toBe(finalPacket.turn_id);
    expect(debugExport.body?.payload?.active_prompt).toBe(question);
    expect(debugExport.body?.payload?.selected_final_answer).toBe(finalPacket.selected_final_answer);
    expect(debugExport.body?.payload?.agent_runtime_loop ?? null).not.toBeUndefined();
    expect(debugExport.body?.payload?.model_turn_fidelity_audit).toMatchObject({
      artifact_id: "model_turn_fidelity_audit",
      schema: "helix.model_turn_fidelity_audit.v1",
      turn_id: finalPacket.turn_id,
      llm_used: expect.any(Boolean),
      sampling_attempted: expect.any(Boolean),
      parity_status: expect.any(String),
      authority: {
        decision_source: expect.any(String),
        policy_override_used: expect.any(Boolean),
      },
      terminal: {
        terminal_blocked_before_reentry: expect.any(Boolean),
        final_used_observed_artifact: expect.any(Boolean),
        stale_fallback_rejected: expect.any(Boolean),
      },
    });
    expect(Array.isArray(debugExport.body?.payload?.model_turn_fidelity_audit?.model_visible_capabilities)).toBe(true);
  }, 60_000);

  it("terminalizes stream errors as a final typed-failure turn payload", async () => {
    const app = createApp();
    const sessionId = `e1028-stream-error-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn/stream")
      .send({
        question: "[[TEST_FORCE_STREAM_ERROR]] what does the UI do when the stream path throws?",
        mode: "read",
        sessionId,
        traceId: "ask:e1028-stream-error",
        turnId: "ask:e1028-stream-error",
      })
      .expect(200);

    const events = parseSseEvents(response.text ?? "");
    const eventNames = events.map((event) => event.event);
    const finalPacket = events.findLast((event) => event.event === "turn_final")?.data;

    expect(eventNames).toContain("turn_error");
    expect(eventNames).toContain("turn_final");
    expect(eventNames.indexOf("turn_error")).toBeLessThan(eventNames.lastIndexOf("turn_final"));
    expect(finalPacket?.ok).toBe(false);
    expect(finalPacket?.terminal_error_code).toBe("ask_turn_stream_failed");
    expect(finalPacket?.final_answer_source).toBe("typed_failure");
    expect(finalPacket?.terminal_artifact_kind).toBe("typed_failure");
    expect(finalPacket?.client_server_terminal_match).toBe(true);
    expect(finalPacket?.debug?.stream_error_terminalized).toBe(true);
    expect(String(finalPacket?.selected_final_answer ?? "")).toContain("Terminal: final_failure");
    const debugEndpoint = finalPacket?.debug_export_ref?.endpoint;
    expect(debugEndpoint).toBe(`/api/agi/ask/turn/${encodeURIComponent(String(finalPacket.turn_id))}/debug-export`);
    expect(finalPacket?.debug_export_payload_hash).toEqual(expect.any(String));
    expect(finalPacket?.debug?.debug_export_ref?.endpoint).toBe(debugEndpoint);

    const debugExport = await request(app)
      .get(debugEndpoint)
      .expect(200);

    expect(debugExport.body?.ok).toBe(true);
    expect(debugExport.body?.payload?.active_turn_id).toBe(finalPacket.turn_id);
    expect(debugExport.body?.payload?.resolved_turn_summary?.terminal_error_code).toBe("ask_turn_stream_failed");
    expect(debugExport.body?.payload?.model_turn_fidelity_audit).toMatchObject({
      artifact_id: "model_turn_fidelity_audit",
      schema: "helix.model_turn_fidelity_audit.v1",
      turn_id: finalPacket.turn_id,
      authority: {
        decision_source: "typed_failure",
      },
      parity_status: expect.any(String),
    });
  }, 60_000);

  it("maps conversational notes navigation variants to the notes panel", async () => {
    const app = createApp();
    const sessionId = `e1028-switch-notes-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "switch over to notes",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.workspace_action?.panel_id).toBe("workstation-notes");
    expect(response.body?.workspace_action?.action_id).toBe("open");
    expect(answerText(response.body)).toMatch(/Executed workstation-notes\.open|notes/i);
  });

  it("maps jump-over docs navigation to the docs viewer instead of reasoning fallback", async () => {
    const app = createApp();
    const sessionId = `e1028-jump-docs-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "jump over to the docs viewer",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.workspace_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.workspace_action?.action_id).toBe("open");
    expect(answerText(response.body)).toMatch(/Executed docs-viewer\.open|docs/i);
  });

  it("treats 'what is this doc about' as summarize/explain, not identity", async () => {
    const app = createApp();
    const sessionId = `e1028-doc-about-${Date.now()}`;
    const path = "/docs/research/example.md";

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what is this doc about?",
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

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.workspace_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.workspace_action?.action_id).toBe("summarize_doc");
    expect(response.body?.dispatch_policy).toBe("workspace_context_reasoning");
    expect(response.body?.planner_contract?.plan_items?.some((step: any) => step?.lane === "reasoning")).toBe(true);
    expect(response.body?.turn_transcript_source).toMatch(/runtime|reconstructed/);
    expect(response.body?.turn_transcript_events?.some((event: any) => event?.type === "plan")).toBe(true);
    expect(response.body?.turn_transcript_events?.some((event: any) => event?.type === "model_decision")).toBe(true);
    expect(response.body?.turn_transcript_events?.some((event: any) => event?.type === "tool_result")).toBe(true);
    expect(response.body?.turn_truth_table?.event_audit?.visible_event_count).toBe(
      response.body?.turn_transcript_events?.length,
    );
    expect(answerText(response.body)).not.toMatch(/^You are viewing:/i);
  });

  it("answers visible current-document phrasing from active workspace context", async () => {
    const app = createApp();
    const sessionId = `e1028-doc-showing-${Date.now()}`;
    const path = "/docs/research/example.md";

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "which document is on screen now?",
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

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.workspace_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.workspace_action?.action_id).toBe("identify_current_doc");
    expect(answerText(response.body)).toContain(path);
    expect(answerText(response.body)).not.toMatch(/active_doc_path|missing user input|before any action/i);
  });

  it("keeps clarify pending text as the terminal answer instead of stale workspace receipts", async () => {
    const app = createApp();
    const sessionId = `e1028-clarify-terminal-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "compare what this doc says about alpha centerline with my notes and tell me the difference",
        mode: "read",
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          activeDocPath: "/docs/research/example.md",
          hasDocContext: true,
          hasNoteContext: false,
        },
      })
      .expect(200);

    if (String(response.body?.route_reason_code ?? "").startsWith("clarify:")) {
      expect(response.body?.pending_server_request?.kind).toBe("clarify");
      expect(answerText(response.body)).toMatch(/note|evidence|missing|specify|need/i);
      expect(answerText(response.body)).not.toMatch(/^Opened document:/i);
    } else {
      expect(response.body?.route_reason_code).toBe("dispatch:act");
      expect(response.body?.dispatch_policy).toBe("workspace_context_reasoning");
    }
  });

  it("preserves prior active doc context when the current visible panel is notes", async () => {
    const app = createApp();
    const sessionId = `e1028-merged-workspace-context-${Date.now()}`;

    const openDocResponse = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open the latest NHM2 doc",
        mode: "read",
        sessionId,
      })
      .expect(200);
    const openedPath = openDocResponse.body?.workspace_action?.args?.path;
    expect(openedPath).toMatch(/docs\//);

    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "switch over to notes",
        mode: "read",
        sessionId,
      })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "compare this doc with my notes and tell me the difference",
        mode: "read",
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "workstation-notes",
          activeDocPath: null,
          hasDocContext: false,
          hasNoteContext: true,
        },
      })
      .expect(200);

    expect(response.body?.workspace_context_snapshot?.activeDocPath).toBe(openedPath);
    expect(response.body?.workspace_context_snapshot?.hasNoteContext).toBe(true);
    expect(response.body?.route_reason_code).not.toBe("clarify:missing_args");
    expect(answerText(response.body)).not.toMatch(/I need active_doc_path/i);
  });

  it("does not merge stale stored note bodies over a fresh empty notes panel snapshot", async () => {
    const sessionId = `e1028-empty-notes-authoritative-${Date.now()}`;
    const staleNoteBody =
      "A developed Common Core should help students form inner discipline and responsible self-direction.";

    const stored = __helixAskTurnWorkspaceSnapshotTestApi.normalizeIncomingAskTurnWorkspaceSnapshot({
      sessionId,
      snapshot: {
        sessionId,
        activePanel: "workstation-notes",
        activeDocPath: "/docs/research/example.md",
        hasDocContext: true,
        hasNoteContext: true,
        activeNoteId: "note:old-common-core",
        activeNoteTitle: "Old Common Core note",
        activeNoteBody: staleNoteBody,
        lastCreatedNoteId: "note:old-common-core",
        lastCreatedNoteTitle: "Old Common Core note",
        lastCreatedNoteBody: staleNoteBody,
        recentNotes: [{ id: "note:old-common-core", title: "Old Common Core note", body: staleNoteBody }],
      },
    });
    const incoming = __helixAskTurnWorkspaceSnapshotTestApi.normalizeIncomingAskTurnWorkspaceSnapshot({
      sessionId,
      snapshot: {
        sessionId,
        activePanel: "workstation-notes",
        activeDocPath: null,
        hasDocContext: false,
        hasNoteContext: true,
        activeNoteId: "note:manual:untitled-note",
        activeNoteTitle: "Untitled note",
        activeNoteBody: "",
        lastCreatedNoteId: "note:manual:untitled-note",
        lastCreatedNoteTitle: "Untitled note",
        lastCreatedNoteBody: "",
        recentNotes: [{ id: "note:manual:untitled-note", title: "Untitled note", body: "" }],
      },
    });
    const snapshot = __helixAskTurnWorkspaceSnapshotTestApi.mergeAskTurnWorkspaceSnapshots({
      incoming,
      stored,
    });

    const snapshotText = JSON.stringify(snapshot ?? {});
    expect(snapshot?.activeDocPath).toBe("/docs/research/example.md");
    expect(snapshot?.activeNoteTitle).toBe("Untitled note");
    expect(snapshot?.activeNoteBody ?? null).toBeNull();
    expect(snapshot?.lastCreatedNoteTitle).toBe("Untitled note");
    expect(snapshot?.lastCreatedNoteBody ?? null).toBeNull();
    expect(__helixAskTurnWorkspaceSnapshotTestApi.resolveAskTurnWorkspaceNoteTitle(snapshot)).toBe("Untitled note");
    expect(snapshotText).not.toContain("Common Core");
    expect(snapshotText).not.toContain("self-direction");

    const emptyIncoming = __helixAskTurnWorkspaceSnapshotTestApi.normalizeIncomingAskTurnWorkspaceSnapshot({
      sessionId,
      snapshot: {
        sessionId,
        activePanel: "workstation-notes",
        activeDocPath: null,
        hasDocContext: false,
        hasNoteContext: true,
        activeNoteId: null,
        activeNoteTitle: null,
        activeNoteBody: "",
        lastCreatedNoteId: null,
        lastCreatedNoteTitle: null,
        lastCreatedNoteBody: "",
        recentNotes: [],
      },
    });
    const emptySnapshot = __helixAskTurnWorkspaceSnapshotTestApi.mergeAskTurnWorkspaceSnapshots({
      incoming: emptyIncoming,
      stored,
    });
    const emptySnapshotText = JSON.stringify(emptySnapshot ?? {});
    expect(emptySnapshot?.activeDocPath).toBe("/docs/research/example.md");
    expect(emptySnapshot?.activeNoteTitle ?? null).toBeNull();
    expect(emptySnapshot?.lastCreatedNoteTitle ?? null).toBeNull();
    expect(__helixAskTurnWorkspaceSnapshotTestApi.resolveAskTurnWorkspaceNoteTitle(emptySnapshot)).toBeNull();
    expect(emptySnapshotText).not.toContain("Common Core");
    expect(emptySnapshotText).not.toContain("self-direction");
  });

  it("does not stop hybrid open-and-explain prompts at the open-doc receipt", async () => {
    const app = createApp();
    const sessionId = `e1028-open-explain-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open the latest NHM2 doc and explain what the main comparison is",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_context_reasoning");
    expect(response.body?.workspace_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.workspace_action?.action_id).toBe("open_latest_doc_by_topic");
    expect(response.body?.planner_contract?.plan_items?.some((step: any) => step?.lane === "reasoning")).toBe(true);
    expect(answerText(response.body)).toMatch(/^Explained /i);
    expect(answerText(response.body)).toMatch(/Key claim:/i);
    expect(answerText(response.body)).toMatch(/Main comparison:/i);
    expect(answerText(response.body)).not.toMatch(/^Opened latest /i);
  });
});
