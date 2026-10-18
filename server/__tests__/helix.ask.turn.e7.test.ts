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

describe("helix ask turn e7 canary contract", () => {
  it("emits planner contract and single terminal metadata on normal conversation turns", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "hello",
        mode: "read",
        sessionId: "e8-normal-turn",
      })
      .expect(200);

    expect(typeof response.body?.text).toBe("string");
    expect(String(response.body?.text ?? "").trim().length).toBeGreaterThan(0);
    expect(response.body?.turn_contract?.single_terminal_required).toBe(true);
    expect(response.body?.planner_contract?.single_terminal_required).toBe(true);
    expect(String(response.body?.planner_contract?.restate ?? "").trim().length).toBeGreaterThan(0);
  });

  it("prefers workspace dispatch for explicit panel commands", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open up notes",
        mode: "read",
        sessionId: "e7-workspace-dispatch",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch?.dispatch_hint).toBe(true);
    expect(response.body?.turn_contract?.lane).toBe("conversation");
    expect(response.body?.turn_contract?.single_terminal_required).toBe(true);
    expect(response.body?.planner_contract?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.pending_server_request ?? null).toBeNull();
  });

  it("locks workspace policy for navigation phrasing like go to docs", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "go to docs",
        mode: "read",
        sessionId: "e8-go-to-docs",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch?.dispatch_hint).toBe(true);
    expect(response.body?.planner_contract?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.planner_contract?.selection_valid).toBe(true);
    expect(response.body?.planner_contract?.selected_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.planner_contract?.selected_action?.action_id).toBe("open");
    expect(response.body?.planner_contract?.action_candidates_count).toBeGreaterThan(0);
    expect(response.body?.turn_contract?.single_terminal_required).toBe(true);
    expect(String(response.body?.text ?? "").toLowerCase()).toContain("workspace action");
  });

  it("repairs workspace navigation phrase to a capability-grounded panel action", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open history panel",
        mode: "read",
        sessionId: "e82-invalid-candidate",
      })
      .expect(200);

    expect(response.body?.planner_contract?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.planner_contract?.selection_valid).toBe(true);
    expect(response.body?.planner_contract?.selected_action?.panel_id).toBe("workstation-clipboard-history");
    expect(response.body?.planner_contract?.selected_action?.action_id).toBe("open");
    expect(response.body?.planner_contract?.planner_repair_attempted).toBe(true);
  });

  it("requests missing required args instead of executing workspace action", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open document",
        mode: "read",
        sessionId: "e82-missing-arg",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("clarify:missing_args");
    expect(response.body?.pending_server_request?.kind).toBe("clarify");
    expect(response.body?.planner_contract?.selection_valid).toBe(false);
    expect(response.body?.planner_contract?.selection_fail_reason).toBe("missing_required_args");
    expect(response.body?.planner_contract?.selection_missing_required_args).toContain("path");
  });

  it("resolves destructive confirmation with yes on the same session", async () => {
    const app = createApp();
    const first = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "delete note test-e7",
        mode: "read",
        sessionId: "e7-confirm-roundtrip",
      })
      .expect(200);

    expect(first.body?.route_reason_code).toBe("clarify:confirmation_required");
    expect(first.body?.pending_server_request?.kind).toBe("confirm");
    expect(first.body?.planner_contract?.dispatch_policy).toBe("needs_user_input");
    expect(first.body?.turn_contract?.single_terminal_required).toBe(true);

    const second = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "yes",
        mode: "read",
        sessionId: "e7-confirm-roundtrip",
      })
      .expect(200);

    expect(second.body?.route_reason_code).toBe("dispatch:act");
    expect(second.body?.dispatch?.dispatch_hint).toBe(true);
    expect(String(second.body?.text ?? "").toLowerCase()).toContain("confirmed");
    expect(second.body?.planner_contract?.dispatch_policy).toBe("workspace_only");
    expect(second.body?.pending_server_request ?? null).toBeNull();
  });

  it("keeps confirmation pending when follow-up is not yes/no", async () => {
    const app = createApp();
    await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "delete note test-e7-pending",
        mode: "read",
        sessionId: "e7-confirm-still-pending",
      })
      .expect(200);

    const followup = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "maybe later",
        mode: "read",
        sessionId: "e7-confirm-still-pending",
      })
      .expect(200);

    expect(followup.body?.route_reason_code).toBe("clarify:confirmation_required");
    expect(followup.body?.pending_server_request?.kind).toBe("confirm");
    expect(String(followup.body?.text ?? "").toLowerCase()).toContain("please confirm");
  });

  it("maps create note phrasing to workstation-notes.create_note", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "create a note called NHM2 summary",
        mode: "read",
        sessionId: "e7-create-note",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.planner_contract?.selected_action?.panel_id).toBe("workstation-notes");
    expect(response.body?.planner_contract?.selected_action?.action_id).toBe("create_note");
    expect(response.body?.planner_contract?.selected_action?.args?.title).toBe("NHM2 summary");
    expect(String(response.body?.text ?? "").toLowerCase()).toContain("workspace action");
  });

  it("maps copy latest clipboard entry to note phrasing", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "copy latest clipboard entry to note NHM2 summary",
        mode: "read",
        sessionId: "e7-copy-latest-clipboard-to-note",
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.planner_contract?.selected_action?.panel_id).toBe("workstation-clipboard-history");
    expect(response.body?.planner_contract?.selected_action?.action_id).toBe("copy_receipt_to_note");
    expect(response.body?.planner_contract?.selected_action?.args?.note_title).toBe("NHM2 summary");
    expect(String(response.body?.text ?? "").toLowerCase()).toContain("workspace action");
  });

  it("uses hybrid compare planning for doc-vs-notes prompts", async () => {
      const app = createApp();
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question: "compare this doc with my notes and tell me differences",
        mode: "read",
        sessionId: "e7-hybrid-compare-doc-notes",
      })
      .expect(200);

      expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.planner_contract?.selected_action?.panel_id).toBe("docs-viewer");
    expect(response.body?.planner_contract?.selected_action?.action_id).toBe("summarize_doc");
    expect(response.body?.planner_contract?.plan_items?.[0]?.lane).toBe("workspace");
    expect(response.body?.planner_contract?.plan_items?.[1]?.lane).toBe("reasoning");
    expect(response.body?.turn_contract?.lane).toBe("reasoning");
    expect(response.body?.needs_retrieval).toBe(true);
    expect(Array.isArray(response.body?.execution_trace)).toBe(true);
    const hasNeedsRetrievalTrace = (response.body?.execution_trace ?? []).some(
      (step: { id?: string }) => step?.id === "needs_retrieval",
    );
    expect(hasNeedsRetrievalTrace).toBe(true);
    expect(String(response.body?.text ?? "").toLowerCase()).toContain("needs retrieval");
  });
});
