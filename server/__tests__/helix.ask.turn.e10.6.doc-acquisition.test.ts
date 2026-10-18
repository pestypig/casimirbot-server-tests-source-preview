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

describe("helix ask turn e10.6 doc acquisition", () => {
  it("maps latest topic doc requests to a concrete docs acquisition action", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "open the latest NHM2 doc", mode: "read", sessionId: `e106-latest-${Date.now()}` })
      .expect(200);

    expect(response.body?.workspace_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.workspace_action?.action_id).toBe("open_latest_doc_by_topic");
    expect(response.body?.workspace_action?.args?.topic).toMatch(/nhm2/i);
    expect(response.body?.workspace_action?.args?.path).toMatch(/^\/docs\/.*\.md$/);
    expect(response.body?.text).toMatch(/Opened (?:document|latest .*document): \/docs\/.*\.md/i);
    expect(response.body?.open_doc_goal_satisfied).toBe(true);
    expect(response.body?.open_doc_terminal_contract_pass).toBe(true);
    expect(response.body?.open_doc_selected_path).toMatch(/^\/docs\/.*\.md$/);
    expect(response.body?.text).not.toBe("Opened Docs & Papers.");
  });

  it("maps explicit docs paths to open_doc_by_path", async () => {
    const app = createApp();
    const path = "docs/audits/research/warp-needle-hull-mark2-compact-note-paper-outline-latest.md";
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: `open ${path}`, mode: "read", sessionId: `e106-path-${Date.now()}` })
      .expect(200);

    expect(response.body?.workspace_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.workspace_action?.action_id).toBe("open_doc_by_path");
    expect(response.body?.workspace_action?.args?.path).toBe(path);
    expect(response.body?.text).toContain(path);
    expect(response.body?.text).not.toBe("Opened Docs & Papers.");
  });

  it("treats docs workspace display wording as docs navigation", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "show me the docs workspace", mode: "read", sessionId: `e106-docs-workspace-${Date.now()}` })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.workspace_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.workspace_action?.action_id).toBe("open");
    expect(response.body?.planner_contract?.dispatch_policy).toBe("workspace_only");
  });

  it("continues topic-qualified open-a-doc prompts from docs search to opening the selected result", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open a doc about NHM2 warp profiles",
        mode: "read",
        sessionId: `e106-topic-open-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.workspace_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.workspace_action?.action_id).toBe("search_docs");
    expect(response.body?.workspace_action?.args?.query).toMatch(/NHM2/i);
    expect(response.body?.workspace_action?.args?.query).toMatch(/warp profiles/i);
    expect(response.body?.text).toMatch(/Opened document:/i);
    expect(response.body?.text).not.toBe("Opened Docs & Papers.");
    const actions = (response.body?.execution_trace ?? []).map((step: any) => step?.action).filter(Boolean);
    expect(actions.some((action: any) => action?.panel_id === "docs-viewer" && action?.action_id === "search_docs")).toBe(true);
    expect(actions.some((action: any) => action?.panel_id === "docs-viewer" && action?.action_id === "open_doc_by_path")).toBe(true);
    expect(response.body?.open_doc_goal_satisfied).toBe(true);
    expect(response.body?.open_doc_terminal_contract_pass).toBe(true);
    expect(response.body?.open_doc_selected_path).toMatch(/^\/docs\/.*\.md$/);
  });

  it("treats versus inside a requested doc topic as acquisition, not note comparison", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Okay, can you find me a doc about NHM2 shift versus lapse decomposition",
        mode: "read",
        sessionId: `e106-versus-topic-${Date.now()}`,
      })
      .expect(200);

    const actions = (response.body?.execution_trace ?? []).map((step: any) => step?.action).filter(Boolean);
    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).not.toBe("needs_user_input");
    expect(response.body?.pending_server_request).toBeFalsy();
    expect(response.body?.workspace_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.workspace_action?.action_id).toBe("search_docs");
    expect(response.body?.workspace_action?.args?.query).toMatch(/shift/i);
    expect(response.body?.workspace_action?.args?.query).toMatch(/lapse/i);
    expect(response.body?.universal_goal_frame?.user_goal?.goal_kind).not.toBe("compare");
    expect(
      (response.body?.universal_goal_frame?.requested_outputs ?? []).some((output: any) => output?.kind === "doc_open"),
    ).toBe(true);
    expect(response.body?.universal_goal_frame?.compound_argument_partition?.operation).toBe("open_doc");
    expect(response.body?.planner_contract?.selection_missing_required_args ?? []).not.toContain("note_title");
    expect(actions.some((action: any) => action?.panel_id === "docs-viewer" && action?.action_id === "search_docs")).toBe(true);
    expect(actions.some((action: any) => action?.panel_id === "docs-viewer" && action?.action_id === "open_doc_by_path")).toBe(true);
    expect(response.body?.text).toMatch(/(?:Opened document:|Explained \/docs\/.*shift-vs-lapse-decomposition.*\.md)/i);
    expect(response.body?.text).not.toMatch(/note named "shift"|Which note should I compare/i);
    expect(response.body?.open_doc_goal_satisfied).toBe(true);
  });

  it("preserves read-aloud intent through topic-doc acquisition continuation", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open a doc about NHM2 shift versus lapse decomposition and then read it aloud",
        mode: "read",
        sessionId: `e106-versus-topic-read-${Date.now()}`,
      })
      .expect(200);

    const actions = (response.body?.execution_trace ?? []).map((step: any) => step?.action).filter(Boolean);
    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.pending_server_request).toBeFalsy();
    expect(actions.some((action: any) => action?.panel_id === "docs-viewer" && action?.action_id === "search_docs")).toBe(true);
    expect(actions.some((action: any) => action?.panel_id === "docs-viewer" && action?.action_id === "open_doc_and_read")).toBe(true);
    expect(response.body?.open_doc_goal_satisfied).toBe(true);
    expect(response.body?.text).toMatch(/(?:Opened document:|Explained \/docs\/.*shift-vs-lapse-decomposition.*\.md)/i);
  });

  it("opens a topical light-crossing document instead of stopping at search results", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open a doc about the light crossing speed",
        mode: "read",
        sessionId: `e106-light-crossing-open-${Date.now()}`,
      })
      .expect(200);

    const actions = (response.body?.execution_trace ?? []).map((step: any) => step?.action).filter(Boolean);
    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.workspace_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.workspace_action?.action_id).toBe("search_docs");
    expect(actions.some((action: any) => action?.panel_id === "docs-viewer" && action?.action_id === "search_docs")).toBe(true);
    expect(actions.some((action: any) => action?.panel_id === "docs-viewer" && action?.action_id === "open_doc_by_path")).toBe(true);
    expect(response.body?.text).toMatch(/Opened document: \/docs\/.*\.md/i);
    expect(response.body?.text).not.toMatch(/^Search results:/i);
    expect(response.body?.workspace_context_snapshot?.activeDocPath).toMatch(/^\/docs\/.*\.md$/);
    expect(response.body?.open_doc_goal_satisfied).toBe(true);
    expect(response.body?.open_doc_terminal_contract_pass).toBe(true);
  });

  it("resolves open-newest-result phrasing through search-to-open continuation", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open the newest light crossing speed result",
        mode: "read",
        sessionId: `e106-light-crossing-result-${Date.now()}`,
      })
      .expect(200);

    const actions = (response.body?.execution_trace ?? []).map((step: any) => step?.action).filter(Boolean);
    const openAction = actions.find(
      (action: any) => action?.panel_id === "docs-viewer" && action?.action_id === "open_doc_by_path",
    );
    expect(actions.some((action: any) => action?.panel_id === "docs-viewer" && action?.action_id === "search_docs")).toBe(true);
    expect(openAction).toBeTruthy();
    expect(openAction?.args?.selection_reason).toBe("newest");
    expect(response.body?.text).toMatch(/Opened document: \/docs\/.*\.md/i);
    expect(response.body?.text).toMatch(/Selection: newest matching search result/i);
    expect(response.body?.open_doc_goal_satisfied).toBe(true);
    expect(response.body?.open_doc_selection_reason).toBe("newest");
  });

  it("retains acquired doc context for follow-up identity turns", async () => {
    const app = createApp();
    const sessionId = `e106-followup-${Date.now()}`;
    const openResponse = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "open the latest NHM2 doc", mode: "read", sessionId })
      .expect(200);
    const openedPath = openResponse.body?.workspace_action?.args?.path;

    const identityResponse = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "what doc are we on?", mode: "read", sessionId })
      .expect(200);

    expect(identityResponse.body?.text).toContain(openedPath);
  });

  it("maps recent topic doc wording to latest-doc acquisition", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "pull up a recent NHM2 mission time document",
        mode: "read",
        sessionId: `e106-recent-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.workspace_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.workspace_action?.action_id).toBe("open_latest_doc_by_topic");
    expect(response.body?.workspace_action?.args?.topic).toMatch(/nhm2|mission/i);
    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.workspace_context_snapshot?.activeDocPath).toMatch(/mission-time-comparison.*\.md$/);
    expect(response.body?.workspace_context_snapshot?.preservationReason).toBe("updated_by_context_mutating_action");
  });

  it("maps go-to latest topic-qualified doc prompts without clarifying", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Go to the latest NHM2 doc about expected clocking targets for the mission.",
        mode: "read",
        sessionId: `e106-topic-qualified-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.pending_server_request).toBeFalsy();
    expect(response.body?.workspace_action?.panel_id).toBe("docs-viewer");
    expect(["open_latest_doc_by_topic", "search_docs"]).toContain(response.body?.workspace_action?.action_id);
    const args = response.body?.workspace_action?.args ?? {};
    const topicOrQuery = String(args.topic ?? args.query ?? "");
    expect(topicOrQuery).toMatch(/NHM2/i);
    expect(topicOrQuery).toMatch(/clocking/i);
    expect(topicOrQuery).toMatch(/mission/i);
    const actions = (response.body?.execution_trace ?? []).map((step: any) => step?.action).filter(Boolean);
    expect(actions.some((action: any) => action?.panel_id === "docs-viewer" && action?.action_id === "search_docs")).toBe(true);
    expect(
      actions.some((action: any) => action?.panel_id === "docs-viewer" && action?.action_id === "open_doc_by_path") ||
        actions.some((action: any) => action?.panel_id === "docs-viewer" && action?.action_id === "open_latest_doc_by_topic"),
    ).toBe(true);
    expect(response.body?.open_doc_goal_satisfied).toBe(true);
    expect(response.body?.open_doc_terminal_contract_pass).toBe(true);
    expect(response.body?.text).not.toBe("Completed turn.");
    expect(response.body?.assistant_answer).not.toBe("Completed turn.");
    expect(response.body?.turn_runtime?.terminal?.text).not.toBe("Completed turn.");
    expect(response.body?.turn_truth_table?.terminal?.text).toBe(response.body?.text);
    expect(response.body?.turn_truth_table?.event_audit?.terminal_mismatch).toBe(false);
    expect(response.body?.text).toMatch(/Opened (?:document|latest .*document):/i);
    expect(response.body?.latest_result_artifact?.text).toBe(response.body?.text);
  });

  it("preserves active doc context across non-mutating doc search turns", async () => {
    const app = createApp();
    const activePath =
      "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/warp-nhm2-mission-time-comparison-latest.md";
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Go to the latest NHM2 doc about expected clocking targets for the mission.",
        mode: "read",
        sessionId: `e106-search-preserve-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          activeDocPath: activePath,
          source: "doc_viewer_store",
          docContextSource: "doc_viewer_store",
          hasDocContext: true,
        },
      })
      .expect(200);

    expect(response.body?.workspace_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.workspace_action?.action_id).toBe("search_docs");
    expect(response.body?.workspace_context_snapshot?.activeDocPath).toMatch(/^\/docs\/.*\.md$/);
    expect(response.body?.workspace_context_snapshot?.activeDocPath).not.toBe(activePath);
    expect(["doc_viewer_store", "workstation_action"]).toContain(response.body?.workspace_context_snapshot?.source);
    expect(response.body?.workspace_context_snapshot?.preservationReason).toBe("updated_by_context_mutating_action");
    expect(response.body?.open_doc_goal_satisfied).toBe(true);
    expect(response.body?.job_ready_links?.some((link: any) => link?.panel_id === "docs-viewer")).toBe(true);
    expect(response.body?.job_ready_links?.every((link: any) => link?.panel_id !== "electron-orbital")).toBe(true);
    const identifyStep = (response.body?.step_results ?? []).find(
      (step: any) => step?.artifact?.action_id === "identify_current_doc",
    );
    if (identifyStep) {
      expect(identifyStep.contract_pass).toBe(true);
      expect(identifyStep.contract_fail_reason).toBeNull();
      expect(identifyStep.actual_artifacts).toContain("active_doc_path");
    }
    expect(response.body?.turn_truth_table?.event_audit?.terminal_mismatch).toBe(false);
  });

  it("falls back to docs search for unresolved topic-qualified latest-doc prompts", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Go to the latest NHM2 doc about zzzquartz nonexistent mission clocking target.",
        mode: "read",
        sessionId: `e106-topic-search-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.pending_server_request).toBeFalsy();
    expect(response.body?.workspace_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.workspace_action?.action_id).toBe("search_docs");
    expect(response.body?.workspace_action?.args?.query).toMatch(/NHM2/i);
    expect(response.body?.workspace_action?.args?.query).toMatch(/zzzquartz/i);
  });

  it("lets obvious new workspace goals supersede stale clarify pending state", async () => {
    const app = createApp();
    const sessionId = `e106-pending-supersede-${Date.now()}`;
    const pendingResponse = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "copy the answer about centerline alpha into that note",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(pendingResponse.body?.route_reason_code).toBe("clarify:missing_args");
    expect(pendingResponse.body?.pending_server_request).toBeTruthy();

    const supersedeResponse = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "go to docs",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(supersedeResponse.body?.route_reason_code).toBe("dispatch:act");
    expect(supersedeResponse.body?.workspace_action?.panel_id).toBe("docs-viewer");
    expect(supersedeResponse.body?.workspace_action?.action_id).toBe("open");
    expect(supersedeResponse.body?.pending_resolution_reason).toBe("pending_superseded_by_new_user_goal");
    expect(supersedeResponse.body?.pending_intercepted_turn).toBe(false);
  });

  it("does not let stale clarify pending state capture unrelated conversation", async () => {
    const app = createApp();
    const sessionId = `e106-pending-conversation-clear-${Date.now()}`;
    const pendingResponse = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "create a note",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(pendingResponse.body?.route_reason_code).toBe("clarify:missing_args");
    expect(pendingResponse.body?.pending_server_request).toBeTruthy();

    const conversationResponse = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "hello after that",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(conversationResponse.body?.route_reason_code).not.toBe("clarify:missing_args");
    expect(conversationResponse.body?.dispatch_policy).toBe("conversation_only");
    expect(conversationResponse.body?.turn_runtime?.terminal?.kind).toBe("final_answer");
    expect(conversationResponse.body?.pending_resolution_reason).toBe("pending_cleared_for_unrelated_conversation");
    expect(conversationResponse.body?.pending_intercepted_turn).toBe(false);
  });

  it("resolves a create-note pending title from a bare follow-up", async () => {
    const app = createApp();
    const sessionId = `e106-create-note-title-${Date.now()}`;
    const pendingResponse = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "create a note",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(pendingResponse.body?.route_reason_code).toBe("clarify:missing_args");
    expect(pendingResponse.body?.pending_server_request?.required_fields ?? []).toContain("title");

    const resolvedResponse = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "quick NHM2 test note",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(resolvedResponse.body?.route_reason_code).toBe("dispatch:act");
    expect(resolvedResponse.body?.workspace_action?.panel_id).toBe("workstation-notes");
    expect(resolvedResponse.body?.workspace_action?.action_id).toBe("create_note");
    expect(resolvedResponse.body?.workspace_action?.args?.title).toBe("quick NHM2 test note");
    expect(resolvedResponse.body?.pending_server_request).toBeFalsy();
    expect(resolvedResponse.body?.pending_resolution_applied).toBe(true);
  });

  it("lets doc identity questions supersede stale clarify pending state", async () => {
    const app = createApp();
    const sessionId = `e106-pending-doc-identity-${Date.now()}`;
    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "create a note",
        mode: "read",
        sessionId,
      })
      .expect(200);

    const identityResponse = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what paper am I viewing?",
        mode: "read",
        sessionId,
        workspace_context_snapshot: {
          hasDocContext: true,
          activeDocPath: "/docs/research/example.md",
        },
      })
      .expect(200);

    expect(identityResponse.body?.route_reason_code).toBe("dispatch:act");
    expect(identityResponse.body?.workspace_action?.panel_id).toBe("docs-viewer");
    expect(identityResponse.body?.workspace_action?.action_id).toBe("identify_current_doc");
    expect(identityResponse.body?.pending_resolution_reason).toBe("pending_superseded_by_new_user_goal");
    expect(identityResponse.body?.pending_intercepted_turn).toBe(false);
  });

  it("preserves doc viewer source for active document identity turns", async () => {
    const app = createApp();
    const path = "/docs/research/example.md";
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what paper am I viewing?",
        mode: "read",
        sessionId: `e106-doc-source-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          hasDocContext: true,
          activeDocPath: path,
          source: "doc_viewer_store",
          docContextSource: "doc_viewer_store",
        },
      })
      .expect(200);

    expect(response.body?.text).toContain(path);
    expect(response.body?.workspace_context_snapshot?.activeDocPath).toBe(path);
    expect(response.body?.workspace_context_snapshot?.source).toBe("doc_viewer_store");
    expect(response.body?.workspace_context_snapshot?.docContextSource).toBe("doc_viewer_store");
    expect(response.body?.workspace_context_snapshot?.docContextValid).toBe(true);
  });

  it("marks claimed doc context invalid when active document path is missing", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what paper am I viewing?",
        mode: "read",
        sessionId: `e106-doc-invalid-context-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          hasDocContext: true,
          activeDocPath: null,
          source: "doc_viewer_store",
        },
      })
      .expect(200);

    expect(response.body?.workspace_context_snapshot?.activeDocPath).toBeNull();
    expect(response.body?.workspace_context_snapshot?.docContextValid).toBe(false);
    expect(response.body?.workspace_context_snapshot?.docContextFailureReason).toBe(
      "has_doc_context_without_active_doc_path",
    );
  });

  it("does not satisfy doc-about prompts with document identity only", async () => {
    const app = createApp();
    const activePath =
      "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/warp-nhm2-mission-time-comparison-latest.md";
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what is this doc about?",
        mode: "read",
        sessionId: `e106-doc-about-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          hasDocContext: true,
          activeDocPath: activePath,
          activeNoteTitle: "quick NHM2 test note",
          lastCreatedNoteTitle: "quick NHM2 test note",
        },
      })
      .expect(200);

    expect(response.body?.workspace_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.workspace_action?.action_id).toBe("summarize_doc");
    expect(response.body?.text).toMatch(/Explained|Key claim|summary_unavailable/i);
    expect(response.body?.text).not.toBe(`You are currently on: ${activePath}`);
    expect(response.body?.text).not.toBe(`You are viewing: ${activePath}`);
  });

  it("resolves deictic note targets to the last active note title", async () => {
    const app = createApp();
    const sessionId = `e106-that-note-${Date.now()}`;
    const activePath = "/docs/research/example.md";
    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "create a note called quick NHM2 test note",
        mode: "read",
        sessionId,
      })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "copy the current document path to that note",
        mode: "read",
        sessionId,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          hasDocContext: true,
          activeDocPath: activePath,
        },
      })
      .expect(200);

    expect(response.body?.workspace_action?.panel_id).toBe("workstation-notes");
    expect(response.body?.workspace_action?.action_id).toBe("append_to_note");
    expect(response.body?.workspace_action?.args?.title).toBe("quick NHM2 test note");
    expect(response.body?.workspace_action?.args?.title).not.toBe("that");
    expect(response.body?.workspace_action?.args?.text).toBe(activePath);
    expect(response.body?.text).toMatch(/quick NHM2 test note/i);
    expect(response.body?.text).not.toMatch(/Updated that/i);
    expect(
      response.body?.job_ready_links?.some((link: any) => /quick NHM2 test note/i.test(String(link?.label ?? ""))),
    ).toBe(true);
    expect(response.body?.job_ready_links?.every((link: any) => !/\bthat\b/i.test(String(link?.label ?? "")))).toBe(true);
  });

  it("requests note target input instead of finalizing unresolved deictic note targets", async () => {
    const app = createApp();
    const activePath = "/docs/research/example.md";
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "copy the current document path to that note",
        mode: "read",
        sessionId: `e106-that-note-missing-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          hasDocContext: true,
          activeDocPath: activePath,
        },
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("clarify:missing_args");
    expect(response.body?.dispatch_policy).toBe("needs_user_input");
    expect(response.body?.planner_contract?.selection_missing_required_args).toContain("note_title");
    expect(response.body?.workspace_action).toBeNull();
    expect(response.body?.text).not.toMatch(/Updated that/i);
    expect(response.body?.job_ready_links?.every((link: any) => !/\bthat\b/i.test(String(link?.label ?? "")))).toBe(true);
  });

  it("composes document location lookup into a named note update", async () => {
    const app = createApp();
    const activePath =
      "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/warp-nhm2-mission-time-comparison-latest.md";
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "put the centerline alpha location into quick NHM2 test note",
        mode: "read",
        sessionId: `e106-location-note-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          hasDocContext: true,
          activeDocPath: activePath,
        },
      })
      .expect(200);

    const actions = (response.body?.execution_trace ?? []).map((step: any) => step?.action).filter(Boolean);
    expect(actions.some((action: any) => action?.panel_id === "docs-viewer" && action?.action_id === "locate_in_doc")).toBe(true);
    expect(actions.some((action: any) => action?.panel_id === "workstation-notes" && action?.action_id === "append_to_note")).toBe(true);
    expect(response.body?.text).toMatch(/Found the requested document location|Locations:/i);
    expect(response.body?.text).toMatch(/quick NHM2 test note/i);
    expect(response.body?.text).not.toMatch(/could not map that workspace command/i);
  });

  it("composes document location lookup into a deictic active note update", async () => {
    const app = createApp();
    const activePath =
      "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/warp-nhm2-mission-time-comparison-latest.md";
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "put the centerline alpha location into that note",
        mode: "read",
        sessionId: `e106-location-deictic-note-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          hasDocContext: true,
          activeDocPath: activePath,
          hasNoteContext: true,
          activeNoteTitle: "quick NHM2 test note",
          lastCreatedNoteTitle: "quick NHM2 test note",
        },
      })
      .expect(200);

    const actions = (response.body?.execution_trace ?? []).map((step: any) => step?.action).filter(Boolean);
    expect(response.body?.route_reason_code).not.toBe("clarify:missing_args");
    expect(response.body?.dispatch_policy).not.toBe("needs_user_input");
    expect(actions.some((action: any) => action?.panel_id === "docs-viewer" && action?.action_id === "locate_in_doc")).toBe(true);
    expect(actions.some((action: any) => action?.panel_id === "workstation-notes" && action?.action_id === "append_to_note")).toBe(true);
    expect(response.body?.text).toMatch(/quick NHM2 test note/i);
    expect(response.body?.text).toMatch(/Locations:|Found the requested document location/i);
    expect(response.body?.text).not.toMatch(/What result should I save/i);
    expect(response.body?.job_ready_links?.every((link: any) => !/\bthat\b/i.test(String(link?.label ?? "")))).toBe(true);
    const noteLinks = (response.body?.job_ready_links ?? []).filter(
      (link: any) => link?.panel_id === "workstation-notes" && link?.action_id === "set_active_note",
    );
    expect(noteLinks).toHaveLength(1);
    expect(noteLinks[0]?.label).toBe("Open note: quick NHM2 test note");
    expect(noteLinks[0]?.label).not.toMatch(/Centerline Alpha Location/i);
    expect(noteLinks[0]?.source_artifact_kind).toBe("note_update_receipt");
    expect(noteLinks[0]?.source_action_id).toBe("append_to_note");
  });
});

