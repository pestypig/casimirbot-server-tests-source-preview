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

const activeDocPath = "/docs/research/nhm2-frontier-distance-report.md";

const workspaceSnapshot = (sessionId: string) => ({
  sessionId,
  activePanel: "docs-viewer",
  activeDocPath,
  hasDocContext: true,
  hasNoteContext: true,
  activeNoteTitle: "agent loop scratch test",
  lastCreatedNoteTitle: "agent loop scratch test",
});

const textOf = (body: any): string => String(body?.assistant_answer ?? body?.answer ?? body?.text ?? "");

describe("helix ask turn e29.3 no-tool and pending artifact UX", () => {
  it("treats explicit no-workspace-action conversation as a direct terminal turn", async () => {
    const app = createApp();
    const sessionId = `e293-no-tool-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "hello, can you respond without doing workspace actions?",
        mode: "read",
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    const planIds = response.body?.planner_contract?.plan_items?.map((step: any) => step?.id) ?? [];
    const stepIds = response.body?.step_results?.map((step: any) => step?.step_id) ?? [];
    const allStepIds = [...planIds, ...stepIds].join(" ");

    expect(response.body?.route_reason_code).toBe("conversation:simple");
    expect(response.body?.dispatch_policy).toBe("direct_answer_only");
    expect(response.body?.workspace_action).toBeNull();
    expect(planIds).toEqual(["planner_restate_goal", "assistant_direct_answer"]);
    expect(allStepIds).not.toMatch(/reasoning_pass|workspace_action/i);
    expect(response.body?.step_results?.some((step: any) => step?.actual_artifacts?.includes("direct_answer_text"))).toBe(true);
    expect(response.body?.final_status).toBe("final_answer");
    expect(textOf(response.body)).toMatch(/answer directly/i);
  });

  it("keeps artifact-gated note mutation pending when doc location artifact is missing", async () => {
    const app = createApp();
    const sessionId = `e293-pending-location-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "put the light crossing location into that note",
        mode: "read",
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("clarify:missing_args");
    expect(response.body?.final_status).toBe("pending_input");
    expect(response.body?.pending_server_request?.kind).toBe("clarify");
    expect(response.body?.pending_server_request?.pending_scope).toBe("artifact_gate");
    expect(response.body?.pending_server_request?.required_fields).toContain("doc_location_matches");
    expect(response.body?.pending_server_request?.resolution_options).toEqual([
      "resolve_with_next_message",
      "cancel_pending",
      "start_new_turn",
    ]);
    expect(textOf(response.body)).toMatch(/doc_location_matches/i);
    expect(textOf(response.body)).toMatch(/cancel pending|start a new turn/i);
    expect(
      (response.body?.execution_trace ?? []).some(
        (step: any) => step?.action?.panel_id === "workstation-notes" && step?.action?.action_id === "append_to_note" && step?.status === "completed",
      ),
    ).toBe(false);
  });

  it("keeps artifact-gated pending active before an unrelated executable follow-up", async () => {
    const app = createApp();
    const sessionId = `e293-pending-unrelated-${Date.now()}`;

    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "put the light crossing location into that note",
        mode: "read",
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    const unrelated = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what is this doc about?",
        mode: "read",
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    expect(unrelated.body?.route_reason_code).toBe("clarify:missing_args");
    expect(unrelated.body?.final_status).toBe("pending_input");
    expect(unrelated.body?.pending_server_request?.kind).toBe("clarify");
    expect(unrelated.body?.pending_server_request?.pending_scope).toBe("artifact_gate");
    expect(unrelated.body?.pending_transition_trace).toContain("turn_transition_pending_abort");
    expect(unrelated.body?.pending_transition_trace).toContain("pending_clarify_unresolved");
    expect(unrelated.body?.pending_status_before).toBe("pending");
  });

  it("cancels an artifact-gated pending request explicitly", async () => {
    const app = createApp();
    const sessionId = `e293-pending-cancel-${Date.now()}`;

    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "put the light crossing location into that note",
        mode: "read",
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    const canceled = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "cancel",
        mode: "read",
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    expect(canceled.body?.route_reason_code).toBe("suppressed:low_salience");
    expect(canceled.body?.pending_server_request ?? null).toBeNull();
    expect(canceled.body?.pending_transition_trace).toContain("pending_clarify_canceled");
    expect(textOf(canceled.body)).toMatch(/canceled/i);
  });

  it("routes a simple greeting after pending cancel through the no-tool terminal path", async () => {
    const app = createApp();
    const sessionId = `e295-post-cancel-greeting-${Date.now()}`;

    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "put the light crossing location into that note",
        mode: "read",
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    const canceled = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "cancel",
        mode: "read",
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);
    expect(canceled.body?.pending_status_after).toBe("canceled");

    const greeting = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "hello, still working after cancel?",
        mode: "read",
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    const planIds = greeting.body?.planner_contract?.plan_items?.map((step: any) => step?.id) ?? [];
    const allStepIds = [
      ...planIds,
      ...(greeting.body?.step_results?.map((step: any) => step?.step_id) ?? []),
    ].join(" ");

    expect(greeting.body?.route_reason_code).toBe("conversation:simple");
    expect(greeting.body?.dispatch_policy).toBe("direct_answer_only");
    expect(greeting.body?.final_status).toBe("final_answer");
    expect(greeting.body?.pending_server_request ?? null).toBeNull();
    expect(greeting.body?.workspace_action ?? null).toBeNull();
    expect(planIds).toEqual(["planner_restate_goal", "assistant_direct_answer"]);
    expect(allStepIds).not.toMatch(/reasoning_pass|retrieval_recovery_failed|workspace_action/i);
    expect(textOf(greeting)).not.toMatch(/retrieval recovery|current document|summarize/i);
    expect(textOf(greeting)).toMatch(/responding|what would you like/i);
  });

  it("still allows a real doc prompt after pending cancel", async () => {
    const app = createApp();
    const sessionId = `e295-post-cancel-doc-${Date.now()}`;

    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "put the light crossing location into that note",
        mode: "read",
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "cancel",
        mode: "read",
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    const docPrompt = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what is this doc about?",
        mode: "read",
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    expect(docPrompt.body?.pending_server_request ?? null).toBeNull();
    expect(docPrompt.body?.route_reason_code).not.toBe("conversation:simple");
    expect(docPrompt.body?.dispatch_policy).not.toBe("direct_answer_only");
    expect(docPrompt.body?.final_status).toBe("final_answer");
    expect(textOf(docPrompt)).not.toMatch(/^You are currently on:/i);
    expect(textOf(docPrompt)).toMatch(/doc|report|frontier|summary|about|key/i);
  });
});
