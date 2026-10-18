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

const readGoalSatisfaction = (body: Record<string, any>) => body?.goal_satisfaction_evaluation ?? null;

const activePath =
  "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/warp-nhm2-mission-time-comparison-latest.md";

describe("helix ask E65 active document and open receipt terminals", () => {
  it("answers active document identity from workspace state", async () => {
    const app = createApp();
    const sessionId = `e65-active-doc-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "What paper am I viewing?",
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

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("active_doc_identity");
    expect(response.body?.terminal_artifact_kind).toBe("active_doc_identity");
    expect(readGoalSatisfaction(response.body)?.terminal_contract).toEqual(
      expect.objectContaining({
        goal_kind: "active_doc_identity",
        required_terminal_kinds: ["active_doc_identity"],
        required_evidence: ["active_doc_path"],
        forbidden_terminal_kinds: expect.arrayContaining(["workspace_action_receipt", "situation_context_pack"]),
      }),
    );
    expect(String(response.body?.selected_final_answer ?? "")).toContain(activePath);
    expect(response.body?.canonical_goal_frame?.goal_kind).not.toBe("model_only_concept");
  }, 90000);

  it("lets docs source nouns outrank generic right-now visual deictics", async () => {
    const app = createApp();
    const sessionId = `e65-docs-right-now-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "OK, what docs are we looking at right now?",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          activeDocPath: activePath,
          docContextPath: activePath,
          hasDocContext: true,
          docContextValid: true,
        },
      })
      .expect(200);

    expect(response.body?.source_target_intent?.target_source).toBe("active_doc");
    expect(response.body?.source_target_intent?.precedence_reason).toBe("deictic_docs_identity_source_target");
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("active_doc_identity");
    expect(response.body?.terminal_artifact_kind).toBe("active_doc_identity");
    expect(response.body?.deictic_reference?.reference_type ?? "unknown").not.toBe("current_screen");
    expect(response.body?.procedure_evidence_retrieval_plan?.source_targets ?? []).not.toEqual(["visual_capture"]);
    expect(String(response.body?.selected_final_answer ?? "")).toContain(activePath);
    expect(String(response.body?.selected_final_answer ?? "")).not.toMatch(/active visual SituationRun/i);
  }, 90000);

  it("binds generic right-now deictics to the active docs viewer before visual fallback", async () => {
    const app = createApp();
    const sessionId = `e65-generic-active-doc-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "that Are we looking at right now?",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          activeDocPath: activePath,
          docContextPath: activePath,
          hasDocContext: true,
          docContextValid: true,
        },
      })
      .expect(200);

    expect(response.body?.active_workspace_source_resolution?.schema).toBe(
      "helix.active_workspace_source_resolution.v1",
    );
    expect(response.body?.active_workspace_source_resolution?.resolved_source_target).toBe("active_doc");
    expect(response.body?.active_workspace_source_resolution?.reason).toBe("generic_deictic_bound_to_active_docs");
    expect(response.body?.source_target_intent?.target_source).toBe("active_doc");
    expect(response.body?.terminal_artifact_kind).toBe("active_doc_identity");
    expect(String(response.body?.selected_final_answer ?? "")).toContain(activePath);
    expect(String(response.body?.selected_final_answer ?? "")).not.toMatch(/active visual SituationRun/i);
  }, 90000);

  it("routes current dock/doc location prompts to active doc search", async () => {
    const app = createApp();
    const sessionId = `e65-current-dock-location-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Find where lapse shift is found in the current dock.",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          activeDocPath: activePath,
          docContextPath: activePath,
          hasDocContext: true,
          docContextValid: true,
        },
      })
      .expect(200);

    expect(response.body?.active_workspace_source_resolution?.resolved_source_target).toBe("docs_viewer");
    expect(response.body?.active_workspace_source_resolution?.reason).toBe("active_doc_location_prompt");
    expect(response.body?.source_target_intent?.target_source).toBe("docs_viewer");
    expect(response.body?.terminal_artifact_kind).toBe("doc_location_result");
    expect(readGoalSatisfaction(response.body)?.terminal_contract).toEqual(
      expect.objectContaining({
        goal_kind: "doc_evidence_location",
        required_terminal_kinds: ["doc_location_result"],
        required_evidence: ["line_backed_locations"],
        forbidden_terminal_kinds: expect.arrayContaining(["model_only_concept", "direct_answer_text"]),
      }),
    );
    expect(response.body?.doc_location_result?.doc_path).toBe(activePath);
    expect(response.body?.doc_location_result?.locate_query).toBe("lapse shift");
    expect(response.body?.doc_location_coverage).toMatchObject({
      schema: "helix.doc_location_coverage.v1",
      goal_kind: "doc_evidence_location",
      coverage: "complete",
      next_decision: "allow_terminal",
    });
    expect(response.body?.doc_location_coverage?.required_items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "line_backed_locations_or_typed_no_match",
          satisfied: true,
        }),
      ]),
    );
    expect(response.body?.doc_location_result?.assistant_answer).toBe(false);
    expect(response.body?.doc_location_result?.raw_content_included).toBe(false);
    expect(String(response.body?.selected_final_answer ?? "")).toMatch(/^(Locations:|No locations found)/i);
    expect(String(response.body?.selected_final_answer ?? "")).not.toMatch(/Completed reasoning|model_only|no_tool_direct/i);
  }, 90000);

  it("fails missing docs identity as missing doc context, not missing visual context", async () => {
    const app = createApp();
    const sessionId = `e65-docs-right-now-missing-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "OK, what docs are we looking at right now?",
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

    expect(response.body?.source_target_intent?.target_source).toBe("active_doc");
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("active_doc_identity");
    expect(response.body?.terminal_artifact_kind).toBe("typed_failure");
    expect(String(response.body?.selected_final_answer ?? "")).toMatch(/active.*document|active_doc|doc/i);
    expect(String(response.body?.selected_final_answer ?? "")).not.toMatch(/active visual SituationRun/i);
  }, 90000);

  it("keeps best-doc open requests on doc_open_receipt instead of locations", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Find and open the best NHM2 document about alpha 0p7000 mission time comparison.",
        mode: "read",
        debug: true,
        sessionId: `e65-open-best-${Date.now()}`,
      })
      .expect(200);

    expect(["doc_open_best", "latest_doc_navigation"]).toContain(response.body?.canonical_goal_frame?.goal_kind);
    expect(response.body?.terminal_artifact_kind).toBe("doc_open_receipt");
    expect(String(response.body?.selected_final_answer ?? "")).not.toMatch(/^Locations:/i);
    expect(String(response.body?.selected_final_answer ?? "")).toMatch(/Path:/i);
  }, 90000);

  it("does not treat polite 'for me' wording as a document search target", async () => {
    const app = createApp();
    const sessionId = `e65-open-docs-for-me-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Okay, open docs for me.",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          activeDocPath: "/docs/research/nhm2-current-status-whitepaper.md",
          docContextPath: "/docs/research/nhm2-current-status-whitepaper.md",
          hasDocContext: true,
          docContextValid: true,
        },
      })
      .expect(200);

    expect(response.body?.terminal_artifact_kind).toBe("workspace_action_receipt");
    expect(response.body?.solver_controller_decision?.decision).toBe("allow_terminal");
    expect(JSON.stringify(response.body)).not.toContain('"query":"me"');
    expect(String(response.body?.selected_final_answer ?? "")).toBe("Opening panel: Docs & Papers.");
  }, 90000);

  it("treats NH-M2 white-paper-from-docs wording as document acquisition, not panel open", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open up the NH-M2. White paper from the docks.",
        mode: "read",
        debug: true,
        sessionId: `e65-nhm2-whitepaper-docs-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_open_best");
    expect(response.body?.canonical_goal_frame?.required_terminal_kind).toBe("doc_open_receipt");
    expect(response.body?.terminal_artifact_kind).toBe("doc_open_receipt");
    expect(response.body?.terminal_error_code ?? null).not.toBe("terminal_consistency_violation");
    expect(response.body?.solver_controller_decision?.decision).toBe("allow_terminal");
    expect(response.body?.final_route_reconciliation?.ok).toBe(true);
    expect(response.body?.terminal_answer_authority?.route).toBe("doc_open_best");
    expect(response.body?.poison_audit?.ok).toBe(true);
    expect(response.body?.execution_trace?.some((step: any) => step?.action?.action_id === "open_doc_by_path")).toBe(true);
    expect(String(response.body?.selected_final_answer ?? "")).toMatch(/Path:/i);
  }, 90000);

  it("lets mandatory NHM2 white-paper wording override active-doc identity", async () => {
    const app = createApp();
    const sessionId = `e65-have-to-open-nhm2-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "You have to Open up a NHM2 white paper from the docks.",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          activeDocPath: "/docs/research/nhm2-deeper-reformulation-decision-memo-2026-03-31.md",
          docContextPath: "/docs/research/nhm2-deeper-reformulation-decision-memo-2026-03-31.md",
          hasDocContext: true,
          docContextValid: true,
        },
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_open_best");
    expect(response.body?.source_target_intent?.target_source).toBe("docs_viewer");
    expect(response.body?.terminal_artifact_kind).toBe("doc_open_receipt");
    expect(response.body?.terminal_error_code ?? null).not.toBe("capability_lifecycle_incomplete");
    expect(response.body?.solver_controller_decision?.decision).toBe("allow_terminal");
    expect(response.body?.initial_available_capabilities?.recommended_capability_key).toBe("docs-viewer.search_docs");
    expect(response.body?.initial_agent_step_decision).toMatchObject({
      authority: "agent_step_decision",
      chosen_capability: "docs-viewer.search_docs",
      decision: "execute",
    });
    expect(response.body?.initial_agent_step_decision?.rejected_capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capability_key: "docs-viewer.identify_current_doc" }),
      ]),
    );
    expect(response.body?.agent_step_authority_check).toMatchObject({
      expected_capability: "docs-viewer.search_docs",
      planned_capability: "docs-viewer.search_docs",
      consistent: true,
      enforcement: "authoritative",
    });
    expect(String(response.body?.selected_final_answer ?? "")).toMatch(/Opened document:|Path:/i);
    expect(String(response.body?.selected_final_answer ?? "")).not.toMatch(/^Active doc:/i);
  }, 90000);

  it("treats short go-to NHM2 white-paper wording as document open, not evidence-location search", async () => {
    const app = createApp();
    const sessionId = `e65-go-to-nhm2-whitepaper-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Go to an NHM2 white paper.",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_open_best");
    expect(response.body?.canonical_goal_frame?.required_terminal_kind).toBe("doc_open_receipt");
    expect(response.body?.terminal_artifact_kind).toBe("doc_open_receipt");
    expect(response.body?.terminal_error_code ?? null).not.toBe("terminal_boundary_ineligible");
    expect(response.body?.terminal_answer_authority).toMatchObject({
      schema: "helix.turn_terminal_authority.v1",
      server_authoritative: true,
      terminal_artifact_kind: "doc_open_receipt",
    });
    expect(response.body?.goal_satisfaction_evaluation?.satisfaction).toBe("satisfied");
    expect(response.body?.solver_controller_decision?.decision).toBe("allow_terminal");
    expect(response.body?.ask_turn_solver_trace).toBeTruthy();
    expect(response.body?.agent_runtime_loop).toBeTruthy();
    expect(response.body?.agent_step_decision).toBeTruthy();
    expect(String(response.body?.selected_final_answer ?? "")).toMatch(/Opened document:|Path:/i);
    expect(String(response.body?.selected_final_answer ?? "")).toMatch(/nhm2/i);
    expect(String(response.body?.selected_final_answer ?? "")).toMatch(/whitepaper|white paper/i);
    expect(String(response.body?.selected_final_answer ?? "")).not.toMatch(/goal_satisfaction_not_terminal|source\/capability answer before the agent runtime loop/i);
  }, 90000);

  it("keeps top-level ask UI path synchronized for short go-to NHM2 white-paper wording", async () => {
    const app = createApp();
    const sessionId = `e65-ui-go-to-nhm2-whitepaper-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask")
      .send({
        question: "Go to an NHM2 white paper.",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_open_best");
    expect(response.body?.canonical_goal_frame?.required_terminal_kind).toBe("doc_open_receipt");
    expect(response.body?.terminal_artifact_kind).toBe("doc_open_receipt");
    expect(response.body?.terminal_error_code ?? null).toBeNull();
    expect(response.body?.terminal_answer_authority).toMatchObject({
      schema: "helix.turn_terminal_authority.v1",
      server_authoritative: true,
      terminal_artifact_kind: "doc_open_receipt",
    });
    expect(String(response.body?.selected_final_answer ?? "")).toMatch(/Opened document:|Path:/i);
    expect(String(response.body?.selected_final_answer ?? "")).toMatch(/nhm2/i);
    expect(String(response.body?.selected_final_answer ?? "")).toMatch(/whitepaper|white paper/i);
    expect(String(response.body?.selected_final_answer ?? "")).not.toMatch(/terminal_authority_missing|agent_runtime_loop_missing|source\/capability answer before the agent runtime loop/i);
  }, 90000);

  it("opens the named NHM2 deeper reformulation decision memo instead of the ambient active doc", async () => {
    const app = createApp();
    const sessionId = `e65-open-deeper-reformulation-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open the NHM2 deeper reformulation memo from docs.",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          activeDocPath: "/docs/research/nhm2-current-status-whitepaper.md",
          docContextPath: "/docs/research/nhm2-current-status-whitepaper.md",
          hasDocContext: true,
          docContextValid: true,
        },
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_open_best");
    expect(response.body?.terminal_artifact_kind).toBe("doc_open_receipt");
    expect(response.body?.open_doc_selected_path).toMatch(/\/docs\/research\/nhm2-deeper-reformulation-decision-memo-2026-0[34]-\d{2}\.md$/);
    expect(String(response.body?.selected_final_answer ?? "")).toContain("nhm2-deeper-reformulation-decision-memo");
    expect(String(response.body?.selected_final_answer ?? "")).not.toContain("nhm2-current-status-whitepaper.md");
    expect(String(response.body?.terminal_presentation?.concise_text ?? "")).toContain("nhm2-deeper-reformulation-decision-memo");
    expect(String(response.body?.terminal_presentation?.concise_text ?? "")).not.toMatch(/^Locations:/i);
    expect(JSON.stringify(response.body?.current_turn_events ?? [])).not.toContain("workspace_action_locate_variant");
    expect(JSON.stringify(response.body?.current_turn_events ?? [])).not.toContain("workspace_action_summarize_opened_search_result");
  }, 90000);

  it("lets mandatory NHM2 white-paper wording override scientific location routing", async () => {
    const app = createApp();
    const sessionId = `e65-have-to-open-nhm2-no-doc-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "You have to Open up a NHM2 white paper from the docks.",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "live-answer-environment",
          hasDocContext: false,
          docContextValid: false,
        },
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_open_best");
    expect(response.body?.canonical_goal_frame?.required_terminal_kind).toBe("doc_open_receipt");
    expect(response.body?.canonical_goal_frame?.classifier_reasons ?? []).toContain("scientific_anchor_suppressed_for_open_command");
    expect(response.body?.terminal_artifact_kind).toBe("doc_open_receipt");
    expect(response.body?.route_reason_code).toMatch(/doc_open_best/);
    expect(response.body?.terminal_error_code ?? null).not.toBe("pending_request_missing");
  }, 90000);
});
