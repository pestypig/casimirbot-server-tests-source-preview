import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { __testHelixRuntimeInterimVoiceCalloutFallback, planRouter } from "../routes/agi.plan";
import { appendConversationHistoryEvent } from "../services/helix-ask/conversation-history";
import { resetInterimVoiceCalloutsForTest } from "../services/helix-ask/interim-voice-callout-store";
import { runtimeMemoryGovernor } from "../services/runtime/runtime-memory-governor";
import { createLiveAnswerEnvironment } from "../services/situation-room/live-answer-environment-store";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

const findAction = (body: Record<string, any>, panelId: string, actionId = "open") => {
  const actions = body?.action_envelope?.workstation_actions ?? [];
  return Array.isArray(actions)
    ? actions.find((action: any) => action?.panel_id === panelId && action?.action_id === actionId)
    : null;
};

const actionsOf = (body: Record<string, any>) => {
  const actions = body?.action_envelope?.workstation_actions ?? [];
  return Array.isArray(actions) ? actions : [];
};

const readGoalSatisfaction = (body: Record<string, any>) => body?.goal_satisfaction_evaluation ?? null;

const readStreamFinal = (text: string): Record<string, any> => {
  const blocks = text.split(/\n\n+/);
  const finalBlock = blocks.find((block) => /^event:\s*turn_final/m.test(block));
  expect(finalBlock).toBeTruthy();
  const dataLine = finalBlock
    ?.split(/\n/)
    .find((line) => line.startsWith("data:"));
  expect(dataLine).toBeTruthy();
  return JSON.parse(String(dataLine).replace(/^data:\s*/, ""));
};

const parseStreamEvents = (text: string): Array<{ event: string; data: any }> =>
  text
    .split(/\n\n+/)
    .map((block) => {
      const event = block
        .split(/\n/)
        .find((line) => line.startsWith("event:"))
        ?.replace(/^event:\s*/, "")
        .trim();
      const dataLines = block
        .split(/\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.replace(/^data:\s*/, ""));
      if (!event || dataLines.length === 0) return null;
      return { event, data: JSON.parse(dataLines.join("\n")) };
    })
    .filter((entry): entry is { event: string; data: any } => Boolean(entry));

describe("helix ask E52 panel control terminal contract", () => {
  it("satisfies explicit docs-viewer panel opens with a workspace action receipt", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open panel docs-viewer",
        mode: "read",
        debug: true,
        sessionId: `e52-docs-panel-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("panel_control");
    expect(response.body?.canonical_goal_frame?.answer_scope).toBe("current_turn_panel");
    expect(response.body?.canonical_goal_frame?.required_terminal_kind).toBe("workspace_action_receipt");
    expect(findAction(response.body, "docs-viewer")).toBeTruthy();
    expect(response.body?.terminal_artifact_kind).toBe("workspace_action_receipt");
    expect(response.body?.terminal_artifact_subkind).toBe("panel_action_receipt");
    expect(response.body?.terminal_consistency_check?.consistent).toBe(true);
    expect(response.body?.capability_plan).toMatchObject({
      schema: "helix.capability_plan.v1",
      required_terminal_kind: "workspace_action_receipt",
    });
    expect(response.body?.capability_adapter_request).toMatchObject({
      schema: "helix.capability_adapter_request.v1",
    });
    expect(response.body?.capability_adapter_result).toMatchObject({
      schema: "helix.capability_adapter_result.v1",
      status: "succeeded",
      selected_for_answer: true,
      reentered_solver: true,
    });
    expect(response.body?.capability_lifecycle_ledger).toMatchObject({
      schema: "helix.capability_lifecycle_ledger.v1",
      ok: true,
    });
    expect(response.body?.solver_controller_decision).toMatchObject({
      decision: "allow_terminal",
      blocking_reasons: [],
    });
    expect(response.body?.terminal_error_code).not.toBe("terminal_consistency_violation");
    expect(String(response.body?.selected_final_answer ?? "")).toMatch(/Opening panel: Docs & Papers\./);
  }, 60000);

  it("keeps compound docs-viewer open prompts on the panel-action rail", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open the docs viewer, then explain whether opening the viewer is a receipt or a final answer.",
        mode: "read",
        debug: true,
        sessionId: `e52-docs-panel-compound-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("panel_control");
    expect(response.body?.available_capabilities?.recommended_capability_key).toBe("docs-viewer.open");
    expect(response.body?.agent_step_decision?.chosen_capability).toBe("docs-viewer.open");
    expect(findAction(response.body, "docs-viewer", "open")).toBeTruthy();
    expect(response.body?.terminal_artifact_kind).toBe("workspace_action_receipt");
    expect(response.body?.terminal_error_code).not.toBe("observation_missing");
    expect(response.body?.selected_final_answer).toBe("Opening panel: Docs & Papers.");
  }, 60000);

  it("satisfies explicit workstation-notes panel opens with a workspace action receipt", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open panel workstation-notes",
        mode: "read",
        debug: true,
        sessionId: `e52-notes-panel-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("panel_control");
    expect(findAction(response.body, "workstation-notes")).toBeTruthy();
    expect(response.body?.terminal_artifact_kind).toBe("workspace_action_receipt");
    expect(response.body?.terminal_consistency_check?.consistent).toBe(true);
    expect(String(response.body?.selected_final_answer ?? "")).toMatch(/Opening panel: Workstation Notes\./);
  }, 60000);

  it("routes natural notes wording as panel control, not a note mutation", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open workstation notes",
        mode: "read",
        debug: true,
        sessionId: `e52-workstation-notes-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("panel_control");
    expect(findAction(response.body, "workstation-notes")).toBeTruthy();
    expect(response.body?.terminal_artifact_kind).toBe("workspace_action_receipt");
    expect(response.body?.terminal_artifact_kind).not.toBe("note_update_receipt");
  }, 60000);

  it("routes notes-panel wording to panel control instead of active-doc identity", async () => {
    const app = createApp();
    const sessionId = `e52-notes-panel-natural-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open the notes panel.",
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

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("panel_control");
    expect(findAction(response.body, "workstation-notes")).toBeTruthy();
    expect(response.body?.terminal_artifact_kind).toBe("workspace_action_receipt");
    expect(response.body?.solver_controller_decision?.decision).toBe("allow_terminal");
    expect(String(response.body?.selected_final_answer ?? "")).toBe("Opening panel: Workstation Notes.");
    expect(String(response.body?.selected_final_answer ?? "")).not.toMatch(/^Active doc:/i);
  }, 60000);

  it("routes open-panels status questions to process graph instead of active-doc identity", async () => {
    const app = createApp();
    const sessionId = `e52-open-panels-status-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "What panels are open right now?",
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

    expect(response.body?.source_target_intent?.target_source).toBe("process_graph");
    expect(response.body?.terminal_artifact_kind).toBe("process_graph_overview");
    expect(response.body?.final_answer_source).toBe("process_graph_overview");
    expect(String(response.body?.selected_final_answer ?? "")).not.toMatch(/^Active doc:/i);
  }, 60000);

  it("routes Docs & Papers wording to panel control without an active doc", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open docs and papers",
        mode: "read",
        debug: true,
        sessionId: `e52-docs-papers-no-context-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("panel_control");
    expect(findAction(response.body, "docs-viewer")).toBeTruthy();
    expect(response.body?.terminal_artifact_kind).toBe("workspace_action_receipt");
    expect(String(response.body?.selected_final_answer ?? "")).not.toMatch(/Opened document/i);
  }, 60000);

  it("routes polite docs-panel wording to panel control instead of active-doc identity", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Okay, can you open up the Docs panel?",
        mode: "read",
        debug: true,
        sessionId: `e52-open-docs-panel-polite-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "live-answer-environment",
          activeDocPath: "/docs/research/nhm2-current-status-whitepaper.md",
          docContextValid: true,
        },
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("panel_control");
    expect(response.body?.canonical_goal_frame?.required_terminal_kind).toBe("workspace_action_receipt");
    expect(findAction(response.body, "docs-viewer", "open")).toBeTruthy();
    expect(response.body?.terminal_artifact_kind).toBe("workspace_action_receipt");
    expect(readGoalSatisfaction(response.body)?.canonical_goal_kind).toBe("panel_control");
    expect(readGoalSatisfaction(response.body)?.terminal_contract).toEqual(
      expect.objectContaining({
        goal_kind: "docs_panel_open",
        required_terminal_kinds: ["workspace_action_receipt"],
        required_actions: ["docs-viewer.open"],
        forbidden_terminal_kinds: expect.arrayContaining(["active_doc_identity", "doc_open_receipt", "doc_summary"]),
      }),
    );
    expect(readGoalSatisfaction(response.body)?.required_actions?.[0]).toEqual(
      expect.objectContaining({
        action_key: "docs-viewer.open",
        required: true,
        satisfied: true,
      }),
    );
    expect(readGoalSatisfaction(response.body)?.satisfaction).toBe("satisfied");
    expect(readGoalSatisfaction(response.body)?.next_decision).toBe("allow_terminal");
    expect(String(response.body?.selected_final_answer ?? "")).toBe("Opening panel: Docs & Papers.");
    expect(String(response.body?.selected_final_answer ?? "")).not.toMatch(/currently on|Opened document/i);
  }, 60000);

  it("routes article-qualified docs-panel wording to panel control", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open up a docs panel.",
        mode: "read",
        debug: true,
        sessionId: `e52-open-a-docs-panel-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          activeDocPath: "/docs/research/nhm2-current-status-whitepaper.md",
          docContextValid: true,
        },
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("panel_control");
    expect(response.body?.canonical_goal_frame?.required_terminal_kind).toBe("workspace_action_receipt");
    expect(findAction(response.body, "docs-viewer", "open")).toBeTruthy();
    expect(response.body?.terminal_artifact_kind).toBe("workspace_action_receipt");
    expect(readGoalSatisfaction(response.body)?.terminal_contract?.goal_kind).toBe("docs_panel_open");
    expect(readGoalSatisfaction(response.body)?.satisfaction).toBe("satisfied");
    expect(response.body?.solver_controller_decision?.decision).toBe("allow_terminal");
    expect(response.body?.available_capabilities?.schema).toBe("helix.available_capabilities.v1");
    expect(response.body?.available_capabilities?.recommended_capability_key).toBe("docs-viewer.open");
    expect(response.body?.agent_step_decision?.chosen_capability).toBe("docs-viewer.open");
    expect(response.body?.initial_agent_step_decision?.authority).toBe("agent_step_decision");
    expect(response.body?.initial_agent_step_decision?.chosen_capability).toBe("docs-viewer.open");
    expect(response.body?.initial_agent_step_decision?.action).toMatchObject({
      panel_id: "docs-viewer",
      action_id: "open",
    });
    expect(response.body?.agent_step_authority_check).toMatchObject({
      expected_capability: "docs-viewer.open",
      planned_capability: "docs-viewer.open",
      consistent: true,
      enforcement: "authoritative",
    });
    expect(response.body?.observation_review?.does_it_satisfy_goal).toBe(true);
    expect(String(response.body?.selected_final_answer ?? "")).toBe("Opening panel: Docs & Papers.");
    expect(String(response.body?.selected_final_answer ?? "")).not.toMatch(/terminal resolver|Opened document|currently on/i);
  }, 60000);

  it("routes corrective docs-panel follow-ups to panel control", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Okay, you didn't open up the docs, you just told me which one I was last on. Can you open up the docs?",
        mode: "read",
        debug: true,
        sessionId: `e52-open-docs-panel-correction-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "live-answer-environment",
          activeDocPath: "/docs/research/nhm2-current-status-whitepaper.md",
          docContextValid: true,
        },
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("panel_control");
    expect(findAction(response.body, "docs-viewer", "open")).toBeTruthy();
    expect(response.body?.terminal_artifact_kind).toBe("workspace_action_receipt");
    expect(readGoalSatisfaction(response.body)?.terminal_contract?.goal_kind).toBe("docs_panel_open");
    expect(readGoalSatisfaction(response.body)?.required_actions?.[0]).toEqual(
      expect.objectContaining({
        action_key: "docs-viewer.open",
        required: true,
        satisfied: true,
      }),
    );
    expect(readGoalSatisfaction(response.body)?.required_evidence?.[0]).toEqual(
      expect.objectContaining({
        kind: "workspace_action_receipt",
        required: true,
        satisfied: true,
      }),
    );
    expect(readGoalSatisfaction(response.body)?.next_decision).toBe("allow_terminal");
    expect(String(response.body?.selected_final_answer ?? "")).not.toMatch(/currently on|Opened document/i);
  }, 60000);

  it("treats open docs for me as a docs panel action, not a document query for me", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Okay, open the docs for me.",
        mode: "read",
        debug: true,
        sessionId: `e52-open-docs-for-me-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "live-answer-environment",
          activeDocPath: "/docs/research/nhm2-current-status-whitepaper.md",
          docContextValid: true,
        },
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("panel_control");
    expect(findAction(response.body, "docs-viewer", "open")).toBeTruthy();
    expect(response.body?.terminal_artifact_kind).toBe("workspace_action_receipt");
    expect(response.body?.doc_open_coverage).toMatchObject({
      schema: "helix.doc_open_coverage.v1",
      goal_kind: "docs_panel_open",
      coverage: "complete",
      next_decision: "allow_terminal",
    });
    expect(response.body?.current_turn_artifact_ledger?.some((artifact: any) =>
      artifact.kind === "doc_open_coverage" &&
      artifact.payload?.coverage === "complete"
    )).toBe(true);
    expect(readGoalSatisfaction(response.body)?.terminal_contract).toEqual(
      expect.objectContaining({
        goal_kind: "docs_panel_open",
        forbidden_terminal_kinds: expect.arrayContaining(["active_doc_identity", "doc_open_receipt"]),
      }),
    );
    expect(readGoalSatisfaction(response.body)?.satisfaction).toBe("satisfied");
    expect(String(response.body?.selected_final_answer ?? "")).toBe("Opening panel: Docs & Papers.");
    expect(String(response.body?.selected_final_answer ?? "")).not.toMatch(/\"me\"|confidently identify a document/i);
  }, 60000);

  it("keeps stream debug terminal aligned with the panel receipt", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn/stream")
      .set("Accept", "text/event-stream")
      .send({
        question: "open docs and papers",
        mode: "act",
        debug: true,
        sessionId: `e52-docs-papers-stream-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          activeDocPath: "/docs/research/nhm2-follow-up-patch-runbook.md",
          docViewer: { currentPath: "/docs/research/nhm2-follow-up-patch-runbook.md" },
        },
      })
      .expect(200);
    const body = readStreamFinal(response.text);

    expect(body?.final_status).toBe("final_answer");
    expect(body?.terminal_error_code).toBeUndefined();
    expect(body?.terminal_artifact_kind).toBe("workspace_action_receipt");
    expect(body?.terminal_consistency_check?.consistent).toBe(true);
    expect(body?.debug?.turn_truth_table?.terminal?.kind).toBe("final_answer");
    expect(body?.debug?.turn_truth_table?.terminal?.text).toBe("Opening panel: Docs & Papers.");
    expect(body?.debug?.capability_adapter_request?.schema).toBe("helix.capability_adapter_request.v1");
    expect(body?.debug?.capability_adapter_result).toMatchObject({
      schema: "helix.capability_adapter_result.v1",
      status: "succeeded",
      selected_for_answer: true,
      reentered_solver: true,
    });
    expect(body?.debug?.capability_lifecycle_ledger).toMatchObject({
      schema: "helix.capability_lifecycle_ledger.v1",
      ok: true,
    });
    expect(body?.debug?.solver_controller_decision?.decision).toBe("allow_terminal");
    expect(body?.turn_runtime?.missing_required_artifacts ?? []).not.toContain("workspace_action_receipt");
    expect(String(body?.selected_final_answer ?? "")).toBe("Opening panel: Docs & Papers.");
  }, 60000);

  it("does not let active doc context hijack Docs & Papers panel opens", async () => {
    const app = createApp();
    const activePath = "/docs/research/nhm2-follow-up-patch-runbook.md";
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open docs and papers",
        mode: "read",
        debug: true,
        sessionId: `e52-docs-papers-active-doc-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          activeDocPath: activePath,
          docViewer: { currentPath: activePath },
        },
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("panel_control");
    expect(findAction(response.body, "docs-viewer", "open")).toBeTruthy();
    expect(findAction(response.body, "docs-viewer", "verify_active_doc")).toBeFalsy();
    expect(response.body?.terminal_artifact_kind).toBe("workspace_action_receipt");
    expect(String(response.body?.selected_final_answer ?? "")).not.toMatch(/Opened document|NHM2 Follow-Up Patch Runbook/i);
    expect(response.body?.terminal_consistency_check?.consistent).toBe(true);
  }, 60000);

  it("routes tab-switch wording to panel control instead of conversation", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "switch to the Docs & Papers tab",
        mode: "read",
        debug: true,
        sessionId: `e52-docs-papers-tab-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.final_answer_source).not.toBe("no_tool_direct");
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("panel_control");
    expect(findAction(response.body, "docs-viewer")).toBeTruthy();
  }, 60000);

  it("routes open-up calculator wording to panel control", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Can you open up the scientific calculator panel?",
        mode: "read",
        debug: true,
        sessionId: `e52-open-up-calculator-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("panel_control");
    expect(response.body?.canonical_goal_frame?.required_terminal_kind).toBe("workspace_action_receipt");
    expect(findAction(response.body, "scientific-calculator")).toBeTruthy();
    expect(response.body?.terminal_artifact_kind).toBe("workspace_action_receipt");
    expect(response.body?.terminal_error_code ?? null).toBeNull();
    expect(response.body?.terminal_consistency_check?.consistent).toBe(true);
    expect(response.body?.poison_audit?.ok).toBe(true);
    expect(String(response.body?.selected_final_answer ?? "")).toMatch(/Opening panel: Scientific Calculator\./);
  }, 60000);

  it("routes calculator solve requests to the scientific calculator action", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "solve x^2-4=0 in the scientific calculator",
        mode: "read",
        debug: true,
        sessionId: `e52-calculator-solve-${Date.now()}`,
      })
      .expect(200);

    const action = findAction(response.body, "scientific-calculator", "solve_expression");
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("calculator_solve");
    expect(response.body?.canonical_goal_frame?.required_terminal_kind).toBe("workstation_tool_evaluation");
    expect(action).toBeTruthy();
    expect(action?.args?.latex).toBe("x^2-4=0");
    expect(response.body?.available_capabilities?.manifest_role).toBe("model_visible_tool_menu");
    expect(response.body?.available_capabilities?.tool_manifest_version).toBe("helix.ask.capability_manifest.v1");
    expect(response.body?.available_capabilities?.model_visible_capability_keys).toEqual(
      expect.arrayContaining([
        "scientific-calculator.solve_expression",
        "scientific-calculator.open",
        "docs-viewer.search_docs",
        "workstation-notes.create",
        "workstation-notes.create_note",
        "live-source.status",
      ]),
    );
    expect(response.body?.available_capabilities?.recommended_capability_key).toBe("scientific-calculator.solve_expression");
    expect(response.body?.agent_step_decision?.decision_role).toBe("agent_step_sampling_pass");
    expect(response.body?.agent_step_decision?.sampling).toMatchObject({
      mode: "deterministic_policy_fallback",
      llm_used: false,
    });
    expect(response.body?.agent_step_decision?.next_step).toBe("answer");
    expect(response.body?.initial_agent_step_decision?.next_step).toBe("next_action");
    expect(response.body?.agent_step_decision?.candidate_capabilities).toContain("scientific-calculator.solve_expression");
    expect(response.body?.agent_step_decision?.expected_artifacts).toEqual(
      expect.arrayContaining(["calculator_receipt", "workstation_tool_evaluation"]),
    );
    expect(response.body?.terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(response.body?.ask_turn_solver_trace?.completed_solver_path).toBe(true);
  }, 60000);

  it("does not turn underdetermined mixed-number triangle prompts into calculator tool calls", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "if the longest side of a triangle is 9 1/8 inches long, how long are the other 2 sides? Can you write the equation and solve?",
        mode: "read",
        debug: true,
        sessionId: `e52-calculator-underdetermined-triangle-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).not.toBe("calculator_solve");
    expect(response.body?.canonical_goal_frame?.classifier_reasons).toEqual(
      expect.arrayContaining(["underspecified_calculator_prompt"]),
    );
    expect(String(response.body?.selected_final_answer ?? "")).toContain("triangle type");
    expect(String(response.body?.selected_final_answer ?? "")).toContain("side ratio");
    expect(String(response.body?.selected_final_answer ?? "")).not.toContain("What numeric value should I use");
    expect(response.body?.pending_server_request?.required_fields).toEqual(
      expect.arrayContaining(["triangle_type", "angle", "another_side", "side_ratio"]),
    );
    expect(findAction(response.body, "scientific-calculator", "solve_expression")).toBeFalsy();
    const runtimeCapabilities =
      response.body?.agent_runtime_loop?.iterations?.map((iteration: any) => iteration.chosen_capability) ?? [];
    expect(runtimeCapabilities).not.toContain("scientific-calculator.solve_expression");
  }, 60000);

  it("does not turn spoken same-unit longest-side triangle prompts into calculator tool calls", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "If the longest side of a triangle is 9 inches and 1/8 inches, what are the other two sides of the triangle? How long is that? And make an equation for that and solve it with the calculator",
        mode: "read",
        debug: true,
        sessionId: `e52-calculator-underdetermined-spoken-triangle-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).not.toBe("calculator_solve");
    expect(response.body?.canonical_goal_frame?.classifier_reasons).toEqual(
      expect.arrayContaining(["underspecified_calculator_prompt"]),
    );
    expect(String(response.body?.selected_final_answer ?? "")).toContain("triangle type");
    expect(String(response.body?.selected_final_answer ?? "")).toContain("side ratio");
    expect(response.body?.pending_server_request?.required_fields).toEqual(
      expect.arrayContaining(["triangle_type", "angle", "another_side", "side_ratio"]),
    );
    expect(findAction(response.body, "scientific-calculator", "solve_expression")).toBeFalsy();
    const runtimeCapabilities =
      response.body?.agent_runtime_loop?.iterations?.map((iteration: any) => iteration.chosen_capability) ?? [];
    expect(runtimeCapabilities).not.toContain("scientific-calculator.solve_expression");
  }, 60000);

  it("binds equal-side follow-up text to the pending triangle frame before simple conversation routing", async () => {
    const app = createApp();
    const sessionId = `e52-calculator-triangle-carryover-${Date.now()}`;
    const first = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "If the longest side of a triangle is 9 inches and 1/8 inches, what are the other two sides of the triangle? How long is that? And make an equation for that and solve it with the calculator",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    expect(first.body?.pending_server_request?.unresolved_task_frame).toMatchObject({
      kind: "math_geometry_triangle",
      status: "missing_slots",
      known_slots: {
        longest_side: {
          expression: "73/8",
          unit: "in",
        },
      },
    });

    const second = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "The other two sides are equal in length.",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    expect(second.body?.route_reason_code).toBe("pending_task_frame / request_user_input");
    expect(second.body?.final_answer_source).toBe("pending_server_request");
    expect(second.body?.conversation_memory_selector?.allowed_use).toBe("pending_request_resolution");
    expect(second.body?.pending_task_frame_resolution).toMatchObject({
      matched: true,
      action: "request_user_input",
      updated_frame: {
        kind: "math_geometry_triangle",
        known_slots: {
          equal_other_sides: true,
          longest_side: {
            expression: "73/8",
            unit: "in",
          },
        },
      },
    });
    expect(String(second.body?.selected_final_answer ?? "")).toContain("equal-side constraint");
    expect(String(second.body?.selected_final_answer ?? "")).not.toMatch(/classified as an isosceles triangle/i);
    expect(second.body?.resolved_turn_summary?.resolved_route_label).toBe("pending_task_frame / request_user_input");
  }, 60000);

  it("accumulates triangle follow-up slots across turns before routing the compiled calculator expression", async () => {
    const app = createApp();
    const sessionId = `e52-calculator-triangle-chain-carryover-${Date.now()}`;
    const first = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "If the longest side of a triangle is 9 inches and 1/8 inches, what are the other two sides of the triangle? How long is that? And make an equation for that and solve it with the calculator",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    expect(first.body?.pending_server_request?.unresolved_task_frame).toMatchObject({
      kind: "math_geometry_triangle",
      status: "missing_slots",
      known_slots: {
        longest_side: {
          expression: "73/8",
          unit: "in",
        },
      },
    });

    const second = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "The other two sides are equal in length.",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    expect(second.body?.pending_task_frame_resolution).toMatchObject({
      matched: true,
      action: "request_user_input",
      updated_frame: {
        known_slots: {
          equal_other_sides: true,
          longest_side: {
            expression: "73/8",
            unit: "in",
          },
        },
      },
    });

    const third = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "The length from the middle of the triangle to the point of the other sides is 3/4 inches, now what is the length of the other two sides?",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    expect(third.body?.route_reason_code).toBe("dispatch:act");
    expect(String(third.body?.raw_user_prompt ?? "")).not.toContain("Pending task frame carryover");
    expect(findAction(third.body, "scientific-calculator", "solve_expression")).toMatchObject({
      args: {
        expression: "(((73/8)/2)^2+(3/4)^2)^(1/2)",
      },
    });
    expect(String(third.body?.selected_final_answer ?? "")).toContain("4.62373293455");
    expect(String(third.body?.selected_final_answer ?? "")).not.toMatch(/need more information|more details/i);
  }, 60000);

  it("persists streamed pending triangle frames so follow-up slot fills cannot route as simple chat", async () => {
    const app = createApp();
    const sessionId = `e52-calculator-triangle-stream-carryover-${Date.now()}`;
    const firstResponse = await request(app)
      .post("/api/agi/ask/turn/stream")
      .set("Accept", "text/event-stream")
      .send({
        question:
          "If the longest side of a triangle is 9 inches and 1/8 inches, what are the other two sides of the triangle? How long is that? And make an equation for that and solve it with the calculator",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);
    const first = readStreamFinal(firstResponse.text);

    expect(first?.pending_server_request?.unresolved_task_frame).toMatchObject({
      kind: "math_geometry_triangle",
      status: "missing_slots",
      known_slots: {
        longest_side: {
          expression: "73/8",
          unit: "in",
        },
      },
    });

    const secondResponse = await request(app)
      .post("/api/agi/ask/turn/stream")
      .set("Accept", "text/event-stream")
      .send({
        question: "The other two sides are equal in length.",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);
    const second = readStreamFinal(secondResponse.text);

    expect(second?.route_reason_code).toBe("pending_task_frame / request_user_input");
    expect(second?.final_answer_source).toBe("pending_server_request");
    expect(second?.conversation_memory_selector?.allowed_use).toBe("pending_request_resolution");
    expect(second?.pending_task_frame_resolution).toMatchObject({
      matched: true,
      action: "request_user_input",
      updated_frame: {
        kind: "math_geometry_triangle",
        known_slots: {
          equal_other_sides: true,
          longest_side: {
            expression: "73/8",
            unit: "in",
          },
        },
      },
    });
    expect(String(second?.selected_final_answer ?? "")).toContain("equal-side constraint");
    expect(String(second?.selected_final_answer ?? "")).not.toMatch(/classified as an isosceles triangle/i);
  }, 60000);

  it("does not let keyed planning solve exact-triangle prompts with only a longest side", async () => {
    const previousFlag = process.env.HELIX_AGENT_STEP_DECISION_LLM;
    const previousPlannerResponse = process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE;
    process.env.HELIX_AGENT_STEP_DECISION_LLM = "1";
    process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE = JSON.stringify({
      subgoals: [
        {
          id: "convert_longest_side",
          label: "Convert longest side to meters",
          expression: "(73/8)*0.0254",
          expected_quantity: "length",
          expected_unit: "m",
          equation: "inches_to_meters",
        },
      ],
    });

    try {
      const app = createApp();
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question: "Solve the exact triangle if the longest side is 9 1/8 in.",
          mode: "read",
          debug: true,
          sessionId: `e52-calculator-exact-triangle-underdetermined-${Date.now()}`,
        })
        .expect(200);

      expect(response.body?.canonical_goal_frame?.goal_kind).not.toBe("calculator_solve");
      expect(response.body?.canonical_goal_frame?.classifier_reasons).toEqual(
        expect.arrayContaining(["underspecified_calculator_prompt"]),
      );
      expect(String(response.body?.selected_final_answer ?? "")).toContain("triangle type");
      expect(String(response.body?.selected_final_answer ?? "")).not.toContain("What numeric value should I use");
      expect(findAction(response.body, "scientific-calculator", "solve_expression")).toBeFalsy();
      const runtimeCapabilities =
        response.body?.agent_runtime_loop?.iterations?.map((iteration: any) => iteration.chosen_capability) ?? [];
      expect(runtimeCapabilities).not.toContain("scientific-calculator.solve_expression");
    } finally {
      if (previousFlag === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_LLM;
      else process.env.HELIX_AGENT_STEP_DECISION_LLM = previousFlag;
      if (previousPlannerResponse === undefined) delete process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE;
      else process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE = previousPlannerResponse;
    }
  }, 60000);

  it("routes plain mixed-number inch-to-meter conversion through calculator receipts", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Convert 9 1/8 inches to meters.",
        mode: "read",
        debug: true,
        sessionId: `e52-calculator-unit-conversion-${Date.now()}`,
      })
      .expect(200);

    const receipts = response.body?.calculator_subgoal_receipts ?? [];
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      subgoal_id: "unit_conversion_length",
      expression_box_input: "(73/8)*0.0254",
      result_text: "0.231775",
      result_unit: "m",
    });
    expect(findAction(response.body, "scientific-calculator", "solve_expression")).toBeTruthy();
    expect(response.body?.calculator_candidate_hints?.problem_interpretation).toMatchObject({
      prompt_kind: "unit_conversion",
      safe_to_calculate: true,
    });
    expect(response.body?.calculator_planner_result).toMatchObject({
      authority: "deterministic_unit_conversion_compiler",
      accepted_plan_kind: "deterministic_unit_conversion_compiler",
      deterministic_unit_conversion_subgoal_count: 1,
    });
    expect(response.body?.terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(String(response.body?.selected_final_answer ?? "")).toContain("0.231775 m");
  }, 60000);

  it("does not let keyed calculator planning convert same-unit triangle geometry from inches to meters", async () => {
    const previousFlag = process.env.HELIX_AGENT_STEP_DECISION_LLM;
    const previousPlannerResponse = process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE;
    const previousFinalAnswer = process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE;
    const previousAgentResponse = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
    const previousAgentIndex = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
    process.env.HELIX_AGENT_STEP_DECISION_LLM = "1";
    process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE = JSON.stringify({
      subgoals: [
        {
          id: "leg_length",
          label: "Compute each leg of the isosceles right triangle",
          expression: "sqrt((73/8)^2/2)",
          expected_quantity: "length",
          expected_unit: "m",
          equation: "leg = hypotenuse / sqrt(2)",
          variables: [
            { symbol: "c", value: "73/8", unit: "m", meaning: "hypotenuse" },
          ],
        },
      ],
    });
    process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE =
      "Each leg is sqrt((73/8)^2/2) = 6.45234937833 in.";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = JSON.stringify([
      {
        next_step: "next_action",
        chosen_capability: "scientific-calculator.solve_expression",
        reason: "Compute the same-unit triangle leg length.",
        args: { latex: "sqrt((73/8)^2/2)", compound_subgoal_id: "leg_length" },
        expected_artifacts: ["calculator_receipt", "calculator_subgoal_receipt", "calculator_plan_coverage"],
        confidence: 0.95,
      },
      {
        next_step: "answer",
        chosen_capability: null,
        reason: "The calculator receipt covers the constrained geometry result.",
        args: {},
        expected_artifacts: ["workstation_tool_evaluation"],
        confidence: 0.96,
      },
    ]);
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = "0";

    try {
      const app = createApp();
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question:
            "Use the scientific calculator to solve an isosceles right triangle where the longest side is 9 1/8 inches. How long is each leg?",
          mode: "read",
          debug: true,
          sessionId: `e52-calculator-isosceles-right-inch-unit-${Date.now()}`,
        })
        .expect(200);

      const receipts = response.body?.calculator_subgoal_receipts ?? [];
      expect(receipts).toHaveLength(1);
      expect(receipts[0]).toMatchObject({
        subgoal_id: "leg_length",
        expression_box_input: "sqrt((73/8)^2/2)",
        result_unit: "in",
      });
      expect(receipts[0]?.calculator_setup).toMatchObject({
        result_unit: "in",
      });
      expect(response.body?.calculator_plan_coverage).toMatchObject({
        coverage: "complete",
        missing_requirement_ids: [],
      });
      expect(String(response.body?.selected_final_answer ?? "")).toContain("6.45234937833 in");
      expect(String(response.body?.selected_final_answer ?? "")).not.toContain("6.45234937833 m");
    } finally {
      if (previousFlag === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_LLM;
      else process.env.HELIX_AGENT_STEP_DECISION_LLM = previousFlag;
      if (previousPlannerResponse === undefined) delete process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE;
      else process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE = previousPlannerResponse;
      if (previousFinalAnswer === undefined) delete process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE;
      else process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE = previousFinalAnswer;
      if (previousAgentResponse === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = previousAgentResponse;
      if (previousAgentIndex === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = previousAgentIndex;
    }
  }, 60000);

  it("does not let calculator diagnostic prose become a calculator tool call", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Calculator panel showed stale/failed expression state even though backend receipts succeeded.",
        mode: "read",
        debug: true,
        sessionId: `e52-calculator-diagnostic-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("debug_diagnosis");
    expect(response.body?.canonical_goal_frame?.required_terminal_kind).toBe("debug_evidence_diagnosis");
    expect(findAction(response.body, "scientific-calculator", "solve_expression")).toBeFalsy();
    expect(response.body?.available_capabilities?.recommended_capability_key).not.toBe(
      "scientific-calculator.solve_expression",
    );
    expect(response.body?.available_capabilities?.recommended_capability_key).toBe("debug.inspect_current_turn");
    const runtimeCapabilities = response.body?.agent_runtime_loop?.iterations?.map((iteration: any) => iteration.chosen_capability) ?? [];
    expect(runtimeCapabilities).not.toContain("scientific-calculator.solve_expression");
    expect(response.body?.terminal_artifact_kind).not.toBe("workstation_tool_evaluation");
    expect(response.body?.terminal_artifact_kind).toBe("typed_failure");
    expect(response.body?.terminal_error_code).toBe("debug_evidence_missing");
    expect(response.body?.terminal_error_code).not.toBe("terminal_consistency_violation");
  }, 60000);

  it("keeps explicit current debug export requests on the debug evidence lane", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Inspect the current Helix Ask console debug export for this turn and tell me what it says.",
        mode: "read",
        debug: true,
        sessionId: `e52-current-debug-export-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("debug_diagnosis");
    expect(response.body?.canonical_goal_frame?.required_terminal_kind).toBe("debug_evidence_diagnosis");
    expect(response.body?.debug_evidence_requirement_source).toBe("explicit_current_runtime_debug");
    expect(response.body?.debug_evidence_requirement_suppressed).toBe(false);
    expect(response.body?.terminal_artifact_kind).toBe("typed_failure");
    expect(response.body?.terminal_error_code).toBe("debug_evidence_missing");
  }, 60000);

  it("exposes every workstation panel tool in the model-visible capability manifest", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Solve x^2-4=0 in the scientific calculator.",
        mode: "read",
        debug: true,
        sessionId: `e52-capability-manifest-complete-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "scientific-calculator",
          visual_context_capability: {
            schema: "helix.visual_context_capability.v1",
            source_id: "src:visual-denied",
            status: "error",
            error: "Permission denied",
            evidence_available: false,
            latest_evidence_ref: null,
            requires_agent_step_selection: true,
            promotion_policy: "available_tool_not_forced_context",
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      })
      .expect(200);

    const manifest = response.body?.available_capabilities;
    const keys = manifest?.model_visible_capability_keys ?? [];
    const capabilities = manifest?.capabilities ?? [];
    const byKey = new Map(capabilities.map((capability: any) => [capability?.capability_key, capability]));
    const requiredKeys = [
      "docs-viewer.open",
      "docs-viewer.search_docs",
      "docs-viewer.open_doc_by_path",
      "docs-viewer.locate_in_doc",
      "scientific-calculator.open",
      "scientific-calculator.solve_expression",
      "scientific-calculator.start_equation_live_source",
      "workstation-notes.open",
      "workstation-notes.create",
      "workstation-notes.append",
      "situation-room.describe_visual_capture",
      "live-source.status",
      "live-source.set_rate",
    ];

    expect(manifest?.schema).toBe("helix.available_capabilities.v1");
    expect(manifest?.manifest_role).toBe("model_visible_tool_menu");
    expect(keys).toEqual(expect.arrayContaining(requiredKeys));
    for (const key of requiredKeys) {
      const capability = byKey.get(key) as any;
      expect(capability, key).toBeTruthy();
      expect(String(capability?.model_visible_description ?? ""), key).toContain(capability?.label);
      expect(capability?.model_visible_input_schema, key).toEqual(expect.objectContaining({ type: "object" }));
      expect(String(capability?.reason ?? ""), key).not.toHaveLength(0);
    }
    expect(byKey.get("situation-room.describe_visual_capture")).toEqual(
      expect.objectContaining({
        goal_fit: "possible",
      }),
    );
    expect(byKey.get("live-source.set_rate")).toEqual(
      expect.objectContaining({
        goal_fit: "forbidden",
      }),
    );
    expect(response.body?.terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(response.body?.terminal_error_code ?? null).toBeNull();
  }, 60000);

  it("can promote the initial agent-step decision through the model-visible capability manifest", async () => {
    const previousFlag = process.env.HELIX_AGENT_STEP_DECISION_LLM;
    const previousResponse = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
    process.env.HELIX_AGENT_STEP_DECISION_LLM = "1";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = JSON.stringify({
      next_step: "next_action",
      chosen_capability: "scientific-calculator.solve_expression",
      reason: "The prompt asks for a calculator solve, so the calculator tool is the best next action.",
      args: { latex: "x^2-4=0" },
      expected_artifacts: ["calculator_receipt", "workstation_tool_evaluation"],
      commentary: {
        turn_purpose: "Use the calculator as the numeric subgoal tool before answering.",
        why_this_capability: "The prompt explicitly asks for scientific calculator work.",
        expected_artifacts: "calculator_receipt and workstation_tool_evaluation",
        what_would_make_this_done: "The calculator evaluation satisfies the goal contract.",
        observation_summary: "No observation before the first tool call.",
        next_step_reason: "Call the calculator next.",
      },
      confidence: 0.93,
    });
    try {
      const app = createApp();
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question: "A photon has frequency 6e14 Hz. Use the scientific calculator to find its wavelength and photon energy in joules and eV, then explain the result.",
          mode: "read",
          debug: true,
          sessionId: `e52-agent-step-llm-${Date.now()}`,
        })
        .expect(200);

      expect(response.body?.initial_agent_step_decision).toMatchObject({
        schema: "helix.agent_step_decision.v1",
        decision_role: "agent_step_sampling_pass",
        next_step: "next_action",
        chosen_capability: "scientific-calculator.solve_expression",
      });
      expect(response.body?.agent_runtime_loop?.iterations?.some((iteration: any) =>
        iteration.chosen_capability === "scientific-calculator.solve_expression" &&
        iteration.decision_source === "llm" &&
        iteration.llm_used === true
      )).toBe(true);
      expect(response.body?.available_capabilities?.manifest_role).toBe("model_visible_tool_menu");
      expect(["workstation_tool_evaluation", "typed_failure"]).toContain(response.body?.terminal_artifact_kind);
    } finally {
      if (previousFlag === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_LLM;
      else process.env.HELIX_AGENT_STEP_DECISION_LLM = previousFlag;
      if (previousResponse === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = previousResponse;
    }
  }, 60000);

  it("records a post-observation agent-step loop for panel-control turns", async () => {
    const previousFlag = process.env.HELIX_AGENT_STEP_DECISION_LLM;
    const previousResponse = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
    process.env.HELIX_AGENT_STEP_DECISION_LLM = "1";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = JSON.stringify({
      next_step: "next_action",
      chosen_capability: "docs-viewer.open",
      reason: "The user asked to open the Docs panel.",
      args: {},
      expected_artifacts: ["workspace_action_receipt"],
      commentary: {
        turn_purpose: "Open the Docs panel.",
        why_this_capability: "docs-viewer.open is the matching workstation action.",
        expected_artifacts: "workspace_action_receipt",
        what_would_make_this_done: "A completed docs-viewer.open receipt.",
        observation_summary: "No observation before the first tool call.",
        next_step_reason: "Call the Docs panel open action.",
      },
      confidence: 0.94,
    });
    try {
      const app = createApp();
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question: "Open up a docs panel.",
          mode: "read",
          debug: true,
          sessionId: `e52-agent-step-loop-${Date.now()}`,
        })
        .expect(200);

      expect(response.body?.agent_runtime_loop?.iterations?.[0]).toMatchObject({
        next_step: "next_action",
        chosen_capability: "docs-viewer.open",
        decision_authority: "llm",
        llm_used: true,
        executed_action_key: "docs-viewer.open",
      });
      expect(response.body?.agent_step_decision).toMatchObject({
        schema: "helix.agent_step_decision.v1",
        next_step: "answer",
      });
      expect(response.body?.agent_step_loop).toMatchObject({
        schema: "helix.agent_step_loop.v1",
      });
      expect(response.body?.agent_step_commentary).toMatchObject({
        schema: "helix.agent_step_commentary.v1",
        raw_content_included: false,
      });
      expect(response.body?.observation_review).toMatchObject({
        schema: "helix.observation_review.v1",
        observed_artifact_kind: "workspace_action_receipt",
        next_action: "final",
      });
    } finally {
      if (previousFlag === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_LLM;
      else process.env.HELIX_AGENT_STEP_DECISION_LLM = previousFlag;
      if (previousResponse === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = previousResponse;
    }
  }, 60000);

  it("records the generic agent runtime loop for document acquisition turns", async () => {
    const previousFlag = process.env.HELIX_AGENT_STEP_DECISION_LLM;
    const previousResponse = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
    const previousResponseIndex = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
    const previousObservationReview = process.env.HELIX_OBSERVATION_REVIEW_TEST_RESPONSE;
    const previousObservationReviewIndex = process.env.HELIX_OBSERVATION_REVIEW_TEST_RESPONSE_INDEX;
    process.env.HELIX_AGENT_STEP_DECISION_LLM = "1";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = "0";
    process.env.HELIX_OBSERVATION_REVIEW_TEST_RESPONSE_INDEX = "0";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = JSON.stringify([
      {
        next_step: "next_action",
        chosen_capability: "docs-viewer.search_docs",
        reason: "Search Docs for the requested NHM2 white paper first.",
        args: { query: "NHM2 white paper", limit: 5 },
        expected_artifacts: ["doc_search_results", "doc_candidate_validation"],
        commentary: {
          turn_purpose: "Find the requested NHM2 document before opening it.",
          why_this_capability: "The document path is not yet selected.",
          expected_artifacts: "doc_search_results",
          what_would_make_this_done: "A validated path can be opened.",
          observation_summary: "No observations yet.",
          next_step_reason: "Search first.",
        },
        confidence: 0.94,
      },
      {
        next_step: "next_action",
        chosen_capability: "docs-viewer.validate_doc_candidates",
        reason: "Validate the NHM2 candidate before opening the document.",
        args: {
          query: "NHM2 white paper",
          selected_path: "/docs/research/nhm2-current-status-whitepaper.md",
        },
        expected_artifacts: ["doc_candidate_validation"],
        commentary: {
          turn_purpose: "Validate the selected NHM2 document candidate.",
          why_this_capability: "Opening should use a validated selected path.",
          expected_artifacts: "doc_candidate_validation",
          what_would_make_this_done: "A selected path is validated.",
          observation_summary: "Search results are present.",
          next_step_reason: "Validate candidates before opening.",
        },
        confidence: 0.95,
      },
      {
        next_step: "next_action",
        chosen_capability: "docs-viewer.open_doc_by_path",
        reason: "The search observation is enough to open the known NHM2 whitepaper path.",
        args: { path: "/docs/research/nhm2-current-status-whitepaper.md" },
        expected_artifacts: ["doc_open_receipt"],
        commentary: {
          turn_purpose: "Open the validated NHM2 document.",
          why_this_capability: "The path is now known from the document search observation.",
          expected_artifacts: "doc_open_receipt",
          what_would_make_this_done: "A completed document-open receipt.",
          observation_summary: "Search results are present.",
          next_step_reason: "Open the selected path.",
        },
        confidence: 0.95,
      },
      {
        next_step: "answer",
        chosen_capability: null,
        reason: "The document-open receipt satisfies the goal.",
        args: {},
        expected_artifacts: ["doc_open_receipt"],
        commentary: {
          turn_purpose: "Finish after opening the requested document.",
          why_this_capability: "No further tool call is needed.",
          expected_artifacts: "doc_open_receipt",
          what_would_make_this_done: "The receipt is already present.",
          observation_summary: "The document was opened.",
          next_step_reason: "Answer now.",
        },
        confidence: 0.97,
      },
    ]);
    process.env.HELIX_OBSERVATION_REVIEW_TEST_RESPONSE = JSON.stringify([
      {
        next_step: "repair",
        reason: "The tool call failed validation because the query argument was missing, so the next step should repair the call.",
        confidence: 0.95,
      },
      {
        next_step: "continue",
        reason: "The repaired search produced search evidence, but the document still needs to be opened.",
        confidence: 0.91,
      },
      {
        next_step: "answer",
        reason: "The open-doc receipt now satisfies the document-open goal.",
        confidence: 0.96,
      },
    ]);
    try {
      const app = createApp();
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question: "Open the NHM2 white paper from docs.",
          mode: "read",
          debug: true,
          sessionId: `e52-agent-runtime-loop-${Date.now()}`,
        })
        .expect(200);

      expect(response.body?.initial_agent_step_decision?.sampling).toMatchObject({
        mode: "deterministic_policy_fallback",
        llm_used: false,
      });
      expect(response.body?.agent_runtime_loop).toMatchObject({
        schema: "helix.agent_runtime_loop.v1",
        runtime_role: "generic_next_action_observe_loop",
      });
      expect(response.body?.agent_runtime_loop?.iterations?.[0]).toMatchObject({
        decision_source: "llm",
        decision_authority: "llm",
        llm_used: true,
      });
      expect(response.body?.agent_loop_budget).toMatchObject({
        schema: "helix.agent_loop_budget.v1",
        profile: "doc_search_open",
        max_tool_calls: 3,
        max_llm_decisions: 7,
        exhausted: false,
      });
      expect(response.body?.agent_loop_budget?.consumed_tool_calls).toBeGreaterThanOrEqual(0);
      expect(response.body?.agent_runtime_loop_admission).toMatchObject({
        schema: "helix.agent_runtime_loop_admission.v1",
        admitted: true,
      });
      expect(response.body?.agent_runtime_loop?.iterations?.length).toBeGreaterThanOrEqual(1);
      expect(response.body?.agent_runtime_loop?.iterations?.every((iteration: any) =>
        iteration.decision_source === "llm" || iteration.decision_source === "deterministic_policy_fallback"
      )).toBe(true);
      expect(response.body?.agent_runtime_loop?.iterations?.every((iteration: any) =>
        iteration.decision_authority === "llm" || iteration.decision_authority === "deterministic_policy_fallback"
      )).toBe(true);
      expect(response.body?.agent_runtime_loop?.iterations?.some((iteration: any) => iteration.decision_source === "llm")).toBe(true);
      expect(["terminal_satisfied", "answered"]).toContain(response.body?.agent_runtime_loop?.stop_reason);
      expect(response.body?.agent_runtime_loop?.stop_reason).not.toBe("all_subgoals_observed");
      expect(response.body?.agent_runtime_loop?.iterations?.every((iteration: any) =>
        iteration.stop_reason !== "all_subgoals_observed"
      )).toBe(true);
      expect(response.body?.runtime_authority_audit).toMatchObject({
        schema: "helix.runtime_authority_audit.v1",
        runtime_intent_packet_ref: expect.stringContaining(":runtime_intent_packet"),
        capability_turn: true,
        runtime_loop_present: true,
        ok: true,
        all_subgoals_observed_terminal_authority: false,
      });
      expect(response.body?.runtime_authority_audit?.decision_authorities).toContain("llm");
      expect(response.body?.runtime_authority_audit?.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            check: "runtime_loop_present_for_source_or_capability_turn",
            passed: true,
          }),
          expect.objectContaining({
            check: "no_terminal_without_runtime_loop_for_source_turn",
            passed: true,
          }),
          expect.objectContaining({
            check: "runtime_loop_records_decision_authority",
            passed: true,
          }),
        ]),
      );
      expect(response.body?.runtime_intent_packet).toMatchObject({
        schema: "helix.runtime_intent_packet.v1",
        completion_authority: "agent_runtime_loop_and_goal_satisfaction",
        terminal_contract: expect.objectContaining({
          goal_kind: "doc_open_best",
          required_terminal_kinds: ["doc_open_receipt"],
        }),
        hints: expect.arrayContaining([
          expect.objectContaining({ authority: "hint_only" }),
        ]),
      });
      expect(response.body?.observation_review).toMatchObject({
        schema: "helix.observation_review.v1",
        supports_goal: true,
        runtime_next_action: "final",
        next_action: "final",
      });
      expect(response.body?.observation_review?.observation_refs?.length).toBeGreaterThan(0);
      expect(response.body?.terminal_artifact_kind).toBe("doc_open_receipt");
      expect(response.body?.doc_open_coverage).toMatchObject({
        schema: "helix.doc_open_coverage.v1",
        goal_kind: "doc_open_best",
        coverage: "complete",
      });
      expect(response.body?.doc_open_coverage?.required_items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "validated_doc_path", satisfied: true }),
          expect.objectContaining({ id: "doc_open_receipt", satisfied: true }),
        ]),
      );
      expect(response.body?.goal_satisfaction_evaluation?.satisfaction).toBe("satisfied");
      expect((response.body?.runtime_goal_satisfaction_observations ?? []).some((observation: any) =>
        observation.schema === "helix.runtime_goal_satisfaction_observation.v1" &&
        observation.satisfaction === "satisfied" &&
        observation.next_decision === "allow_terminal"
      )).toBe(true);
    } finally {
      if (previousFlag === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_LLM;
      else process.env.HELIX_AGENT_STEP_DECISION_LLM = previousFlag;
      if (previousResponse === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = previousResponse;
      if (previousResponseIndex === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = previousResponseIndex;
    }
  }, 60000);

  it("records invalid model-selected tool args as observations and allows repair", async () => {
    const previousFlag = process.env.HELIX_AGENT_STEP_DECISION_LLM;
    const previousResponse = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
    const previousResponseIndex = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
    const previousObservationReview = process.env.HELIX_OBSERVATION_REVIEW_TEST_RESPONSE;
    const previousObservationReviewIndex = process.env.HELIX_OBSERVATION_REVIEW_TEST_RESPONSE_INDEX;
    process.env.HELIX_AGENT_STEP_DECISION_LLM = "1";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = "0";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = JSON.stringify([
      {
        next_step: "next_action",
        chosen_capability: "docs-viewer.search_docs",
        reason: "The initial pre-runtime decision is intentionally invalid and should not be used as terminal authority.",
        args: {},
        expected_artifacts: ["doc_search_results"],
        confidence: 0.7,
      },
      {
        next_step: "next_action",
        chosen_capability: "docs-viewer.search_docs",
        reason: "The runtime decision is intentionally invalid and should become an observation.",
        args: {},
        expected_artifacts: ["doc_search_results"],
        confidence: 0.7,
      },
      {
        next_step: "repair",
        chosen_capability: "docs-viewer.search_docs",
        reason: "Repair the invalid tool call by providing the missing query.",
        args: { query: "NHM2 white paper", limit: 5 },
        expected_artifacts: ["doc_search_results", "doc_candidate_validation"],
        confidence: 0.92,
      },
      {
        next_step: "next_action",
        chosen_capability: "docs-viewer.open_doc_by_path",
        reason: "Open the selected NHM2 whitepaper path.",
        args: { path: "/docs/research/nhm2-current-status-whitepaper.md" },
        expected_artifacts: ["doc_open_receipt"],
        confidence: 0.95,
      },
      {
        next_step: "answer",
        chosen_capability: null,
        reason: "The document-open receipt satisfies the user goal.",
        args: {},
        expected_artifacts: ["doc_open_receipt"],
        confidence: 0.97,
      },
    ]);
    try {
      const app = createApp();
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question: "Open the qwerty-nhm2-missing paper from docs.",
          mode: "read",
          debug: true,
          sessionId: `e52-runtime-tool-repair-${Date.now()}`,
        })
        .expect(200);

      const ledger = response.body?.current_turn_artifact_ledger ?? [];
      expect(ledger).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "runtime_tool_call_validation",
            payload: expect.objectContaining({
              capability_key: "docs-viewer.search_docs",
              valid: false,
              errors: expect.arrayContaining(["missing_required_arg:query"]),
            }),
          }),
          expect.objectContaining({
            kind: "runtime_tool_observation",
            payload: expect.objectContaining({
              capability_key: "docs-viewer.search_docs",
              status: "invalid_args",
              repairable: true,
            }),
          }),
          expect.objectContaining({
            kind: "runtime_tool_call_validation",
            payload: expect.objectContaining({
              capability_key: "docs-viewer.search_docs",
              valid: true,
            }),
          }),
        ]),
      );
      expect(response.body?.agent_runtime_loop?.iterations?.some((iteration: any) =>
        iteration.observation_role === "invalid_tool_call_observation" &&
        iteration.produced_artifacts.includes("runtime_tool_observation")
      )).toBe(true);
      expect(response.body?.agent_runtime_loop?.iterations?.some((iteration: any) =>
        iteration.next_step === "repair" &&
        iteration.chosen_capability === "docs-viewer.search_docs"
      )).toBe(true);
      expect(response.body?.post_tool_observation_reviews?.map((review: any) => review.next_step)).toEqual(
        expect.arrayContaining(["repair", "answer"]),
      );
      expect(ledger.some((artifact: any) =>
        artifact.kind === "post_tool_observation_review" &&
        artifact.payload?.last_action?.capability_key === "docs-viewer.search_docs" &&
        artifact.payload?.next_step === "repair"
      )).toBe(true);
      expect(ledger.some((artifact: any) =>
        artifact.kind === "runtime_goal_satisfaction_observation" &&
        artifact.payload?.trigger === "invalid_tool_call_observation" &&
        artifact.payload?.satisfaction === "not_satisfied" &&
        artifact.payload?.missing_requirement_ids?.length > 0
      )).toBe(true);
      expect(response.body?.agent_runtime_loop?.iterations?.some((iteration: any) =>
        iteration.satisfaction_observation_ref &&
        iteration.missing_requirement_ids?.length > 0
      )).toBe(true);
      expect(response.body?.agent_runtime_loop?.iterations?.length).toBeGreaterThanOrEqual(2);
    } finally {
      if (previousFlag === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_LLM;
      else process.env.HELIX_AGENT_STEP_DECISION_LLM = previousFlag;
      if (previousResponse === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = previousResponse;
      if (previousResponseIndex === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = previousResponseIndex;
      if (previousObservationReview === undefined) delete process.env.HELIX_OBSERVATION_REVIEW_TEST_RESPONSE;
      else process.env.HELIX_OBSERVATION_REVIEW_TEST_RESPONSE = previousObservationReview;
      if (previousObservationReviewIndex === undefined) delete process.env.HELIX_OBSERVATION_REVIEW_TEST_RESPONSE_INDEX;
      else process.env.HELIX_OBSERVATION_REVIEW_TEST_RESPONSE_INDEX = previousObservationReviewIndex;
    }
  }, 60000);

  it("keeps hard docs open workflow inside docs tools and repairs repeated docs steps", async () => {
    const previousFlag = process.env.HELIX_AGENT_STEP_DECISION_LLM;
    const previousResponse = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
    const previousResponseIndex = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
    const previousObservationReview = process.env.HELIX_OBSERVATION_REVIEW_TEST_RESPONSE;
    const previousObservationReviewIndex = process.env.HELIX_OBSERVATION_REVIEW_TEST_RESPONSE_INDEX;
    process.env.HELIX_AGENT_STEP_DECISION_LLM = "1";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = "0";
    delete process.env.HELIX_OBSERVATION_REVIEW_TEST_RESPONSE;
    delete process.env.HELIX_OBSERVATION_REVIEW_TEST_RESPONSE_INDEX;
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = JSON.stringify([
      {
        next_step: "next_action",
        chosen_capability: "docs-viewer.search_docs",
        reason: "Search docs for the requested console debug document path.",
        args: { query: "Helix Ask console debug", limit: 5 },
        expected_artifacts: ["doc_search_results"],
        confidence: 0.92,
      },
      {
        next_step: "next_action",
        chosen_capability: "repo-code.search_concept",
        reason: "Incorrectly try repo search even though the hard source target is local docs.",
        args: { query: "Helix Ask console debug" },
        expected_artifacts: ["repo_code_evidence_observation"],
        confidence: 0.7,
      },
      {
        next_step: "next_action",
        chosen_capability: "docs-viewer.validate_doc_candidates",
        reason: "Incorrectly repeat validation after the selected candidate already exists.",
        args: {
          query: "Helix Ask console debug",
          selected_path: "/docs/architecture/helix-ask-reasoning-theater-spec.v1.md",
          path: "/docs/architecture/helix-ask-reasoning-theater-spec.v1.md",
        },
        expected_artifacts: ["doc_candidate_validation"],
        confidence: 0.94,
      },
      {
        next_step: "answer",
        chosen_capability: null,
        reason: "The doc_open_receipt satisfies the document path request.",
        args: {},
        expected_artifacts: ["doc_open_receipt"],
        confidence: 0.97,
      },
    ]);
    try {
      const app = createApp();
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question: "Search docs for Helix Ask console debug and tell me which document path you found.",
          mode: "read",
          debug: true,
          sessionId: `e52-doc-search-repeat-${Date.now()}`,
        })
        .expect(200);

      const actions = actionsOf(response.body);
      expect(actions.filter((action) => action?.panel_id === "docs-viewer" && action?.action_id === "search_docs")).toHaveLength(1);
      expect(actions.filter((action) => action?.panel_id === "docs-viewer" && action?.action_id === "validate_doc_candidates")).toHaveLength(1);
      expect(actions.filter((action) => action?.panel_id === "docs-viewer" && action?.action_id === "open_doc_by_path")).toHaveLength(1);
      const artifactLedger = response.body?.current_turn_artifact_ledger ?? [];
      const artifactLedgerKinds = artifactLedger.map((artifact: any) => artifact?.kind);
      expect(artifactLedgerKinds).not.toContain("repo_code_evidence_observation");
      expect(
        artifactLedger.some(
          (artifact: any) =>
            artifact?.kind === "runtime_tool_call" &&
            artifact?.payload?.capability_key === "repo-code.search_concept",
        ),
      ).toBe(false);
      expect(response.body?.terminal_artifact_kind).toBe("doc_open_receipt");
      expect(response.body?.final_answer_source).toBe("doc_open_receipt");
      expect(response.body?.line_tool_request_count).toBe(3);
      expect(response.body?.line_tool_evaluation_count).toBe(3);
      expect(response.body?.debug?.line_tool_request_count).toBe(3);
      expect(response.body?.debug?.line_tool_evaluation_count).toBe(3);
      expect(String(response.body?.selected_final_answer ?? response.body?.answer ?? "")).toContain(
        "/docs/architecture/helix-ask-reasoning-theater-spec.v1.md",
      );
      expect(String(response.body?.terminal_presentation?.concise_text ?? "")).toContain(
        "/docs/architecture/helix-ask-reasoning-theater-spec.v1.md",
      );
      expect(String(response.body?.selected_final_answer ?? response.body?.answer ?? "")).not.toMatch(/workspace_step_failed|Failed to execute/i);
      expect(response.body?.capability_lifecycle_ledger?.failure_codes ?? []).not.toContain("capability_receipt_terminal_without_goal");
      expect(response.body?.goal_satisfaction_evaluation?.satisfaction).toBe("satisfied");
      expect(response.body?.route_authority_audit?.route_authority_ok).toBe(true);
      expect(response.body?.ask_turn_solver_trace?.route_authority_ok).toBe(true);
      expect(response.body?.ask_turn_solver_trace?.completed_solver_path).toBe(true);
      expect(response.body?.ask_turn_solver_trace?.evidence_reentry_gate?.completed).toBe(true);
      expect(response.body?.ask_turn_solver_trace?.solver_risk_flags ?? []).not.toContain("missing_followup_reasoning");
      const debugExportRef = response.body?.debug_export_ref?.endpoint;
      expect(debugExportRef).toBeTruthy();
      const debugExport = await request(app).get(debugExportRef).expect(200);
      expect(debugExport.body?.payload?.route_authority_audit?.route_authority_ok).toBe(true);
      expect(debugExport.body?.payload?.loop_parity_trace?.route_authority_ok).toBe(true);
      expect(debugExport.body?.payload?.loop_parity_trace?.unexpected_tool_calls).toEqual([]);
      expect(debugExport.body?.payload?.loop_parity_trace?.short_circuit_risk_flags ?? []).not.toContain("tool_called_without_admission");
      expect(debugExport.body?.payload?.loop_parity_trace?.actual_tool_calls?.map((call: any) => call.tool_id)).toEqual([
        "docs-viewer.search_docs",
        "docs-viewer.validate_doc_candidates",
        "docs-viewer.open_doc_by_path",
      ]);
      expect(debugExport.body?.payload?.loop_parity_trace?.tool_results_returned_to_turn).toBe(true);
      expect(debugExport.body?.payload?.loop_parity_trace?.observations_created).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ source_kind: "doc_search_results" }),
          expect.objectContaining({ source_kind: "doc_candidate_validation" }),
          expect.objectContaining({ source_kind: "doc_open_receipt" }),
        ]),
      );
      expect(debugExport.body?.payload?.model_turn_fidelity_audit).toMatchObject({
        artifact_id: "model_turn_fidelity_audit",
        schema: "helix.model_turn_fidelity_audit.v1",
        model_visible_tool_families: expect.arrayContaining(["docs_viewer"]),
        terminal: expect.objectContaining({
          final_used_observed_artifact: true,
        }),
        parity_status: "safe_policy_repair",
      });
      expect(debugExport.body?.payload?.ask_turn_solver_trace?.route_authority_ok).toBe(true);
      expect(debugExport.body?.payload?.ask_turn_solver_trace?.completed_solver_path).toBe(true);
      expect(response.body?.goal_satisfaction_evaluation?.required_actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ action_key: "docs-viewer.search_docs", satisfied: true }),
          expect.objectContaining({ action_key: "docs-viewer.validate_doc_candidates", satisfied: true }),
          expect.objectContaining({ action_key: "docs-viewer.open_doc_by_path", satisfied: true }),
        ]),
      );
      expect((response.body?.agent_runtime_loop?.iterations ?? []).some((iteration: any) =>
        iteration.chosen_capability === "docs-viewer.validate_doc_candidates" &&
        iteration.decision_source === "deterministic_policy_fallback"
      )).toBe(true);
      expect((response.body?.agent_runtime_loop?.iterations ?? []).some((iteration: any) =>
        iteration.chosen_capability === "docs-viewer.open_doc_by_path" &&
        iteration.decision_source === "deterministic_policy_fallback"
      )).toBe(true);
      expect(response.body?.agent_runtime_loop?.stop_reason).not.toBe("budget_exhausted");
    } finally {
      if (previousFlag === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_LLM;
      else process.env.HELIX_AGENT_STEP_DECISION_LLM = previousFlag;
      if (previousResponse === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = previousResponse;
      if (previousResponseIndex === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = previousResponseIndex;
      if (previousObservationReview === undefined) delete process.env.HELIX_OBSERVATION_REVIEW_TEST_RESPONSE;
      else process.env.HELIX_OBSERVATION_REVIEW_TEST_RESPONSE = previousObservationReview;
      if (previousObservationReviewIndex === undefined) delete process.env.HELIX_OBSERVATION_REVIEW_TEST_RESPONSE_INDEX;
      else process.env.HELIX_OBSERVATION_REVIEW_TEST_RESPONSE_INDEX = previousObservationReviewIndex;
    }
  }, 60000);

  it("keeps scoped docs summary inside docs tools and downgrades parity after rejected repo-code", async () => {
    const app = createApp();
    const previousFlag = process.env.HELIX_AGENT_STEP_DECISION_LLM;
    const previousResponse = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
    const previousResponseIndex = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;

    process.env.HELIX_AGENT_STEP_DECISION_LLM = "1";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = "0";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = JSON.stringify([
      {
        next_step: "next_action",
        chosen_capability: "repo-code.search_concept",
        reason: "Incorrectly try repo search even though the hard source target is docs summary.",
        args: { query: "Helix Ask Codex parity model turn fidelity audit remaining parity gap" },
        expected_artifacts: ["repo_code_evidence_observation"],
        confidence: 0.7,
      },
      {
        next_step: "next_action",
        chosen_capability: "docs-viewer.search_docs",
        reason: "Search docs for the named audit document.",
        args: { query: "Helix Ask Codex parity model turn fidelity audit", limit: 5 },
        expected_artifacts: ["doc_search_results"],
        confidence: 0.93,
      },
      {
        next_step: "next_action",
        chosen_capability: "docs-viewer.summarize_doc",
        reason: "Summarize the selected audit document around the remaining parity gap.",
        args: {
          path: "/docs/audits/research/helix-ask-codex-parity-model-turn-fidelity-audit-2026-06-12.md",
          query: "remaining parity gap",
        },
        expected_artifacts: ["doc_summary"],
        confidence: 0.94,
      },
      {
        next_step: "answer",
        chosen_capability: null,
        reason: "The scoped docs summary now satisfies the requested three-bullet parity-gap answer.",
        args: {},
        expected_artifacts: ["doc_summary"],
        confidence: 0.98,
      },
    ]);

    try {
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question: "Open the Helix Ask Codex parity model turn fidelity audit doc and summarize the remaining parity gap in three bullets.",
          mode: "read",
          debug: true,
          sessionId: `e52-doc-summary-scope-repair-${Date.now()}`,
        })
        .expect(200);

      const finalText = String(response.body?.selected_final_answer ?? response.body?.answer ?? "");
      expect(finalText).toContain("remaining gap");
      expect(finalText).toContain("model-visible");
      expect(finalText).toContain("Policy repairs");
      expect(finalText).toContain("Terminal answers");
      expect((finalText.match(/^\s*-/gm) ?? [])).toHaveLength(3);
      expect(finalText).not.toContain("Section anchor:");
      expect(response.body?.terminal_artifact_kind).toBe("doc_summary");
      expect(response.body?.goal_satisfaction_evaluation?.satisfaction).toBe("satisfied");

      const debugExportRef = response.body?.debug_export_ref?.endpoint;
      expect(debugExportRef).toBeTruthy();
      const debugExport = await request(app).get(debugExportRef).expect(200);
      const loopTrace = debugExport.body?.payload?.loop_parity_trace;
      expect(loopTrace?.actual_tool_calls?.map((call: any) => call.tool_id)).toEqual([
        "docs-viewer.search_docs",
        "docs-viewer.validate_doc_candidates",
        "docs-viewer.open_doc_by_path",
        "docs-viewer.summarize_doc",
      ]);
      expect(loopTrace?.rejected_tool_calls?.map((call: any) => call.tool_id) ?? []).not.toContain("docs-viewer.search_docs");
      expect(loopTrace?.unexpected_tool_calls).toEqual([]);
      expect(loopTrace?.short_circuit_risk_flags ?? []).not.toContain("tool_called_without_admission");
      expect(["repaired_not_model_driven", "safe_policy_repair"]).toContain(
        debugExport.body?.payload?.model_turn_fidelity_audit?.parity_status,
      );
      expect(debugExport.body?.payload?.model_turn_fidelity_audit?.parity_status).not.toBe("model_driven_parity");
      expect(debugExport.body?.payload?.model_turn_fidelity_audit?.authority?.policy_override_used).toBe(true);
    } finally {
      if (previousFlag === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_LLM;
      else process.env.HELIX_AGENT_STEP_DECISION_LLM = previousFlag;
      if (previousResponse === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = previousResponse;
      if (previousResponseIndex === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = previousResponseIndex;
    }
  }, 60000);

  it("preserves docs-only source admission when repo-code and internet are negated", async () => {
    const app = createApp();
    const previousFlag = process.env.HELIX_AGENT_STEP_DECISION_LLM;
    const previousResponse = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
    const previousResponseIndex = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;

    process.env.HELIX_AGENT_STEP_DECISION_LLM = "1";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = "0";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = JSON.stringify([
      {
        next_step: "answer",
        chosen_capability: "model.direct_answer",
        reason: "Incorrectly answer directly despite the docs-only source contract.",
        args: {},
        expected_artifacts: ["direct_answer_text"],
        confidence: 0.86,
      },
      {
        next_step: "next_action",
        chosen_capability: "docs-viewer.search_docs",
        reason: "Search docs for the named audit document after direct answer is blocked.",
        args: { query: "Helix Ask Codex parity model turn fidelity audit", limit: 5 },
        expected_artifacts: ["doc_search_results"],
        confidence: 0.94,
      },
      {
        next_step: "next_action",
        chosen_capability: "docs-viewer.search_docs",
        reason: "Incorrectly repeat docs search after doc_search_results already selected candidate documents.",
        args: { query: "Helix Ask Codex parity model turn fidelity audit", limit: 5 },
        expected_artifacts: ["doc_search_results"],
        confidence: 0.9,
      },
      {
        next_step: "next_action",
        chosen_capability: "docs-viewer.search_docs",
        reason: "Incorrectly repeat docs search after candidate validation should lead to opening the selected path.",
        args: { query: "Helix Ask Codex parity model turn fidelity audit", limit: 5 },
        expected_artifacts: ["doc_search_results"],
        confidence: 0.88,
      },
      {
        next_step: "next_action",
        chosen_capability: "docs-viewer.search_docs",
        reason: "Incorrectly repeat docs search after the document was opened and summary is still missing.",
        args: { query: "Helix Ask Codex parity model turn fidelity audit", limit: 5 },
        expected_artifacts: ["doc_search_results"],
        confidence: 0.86,
      },
      {
        next_step: "answer",
        chosen_capability: null,
        reason: "The docs summary satisfies the docs-only three-bullet answer.",
        args: {},
        expected_artifacts: ["doc_summary"],
        confidence: 0.98,
      },
    ]);

    try {
      const question =
        "Open the Helix Ask Codex parity model turn fidelity audit doc. Do not use repo-code or internet search. Use docs only, and summarize the remaining parity gap in three bullets with the document path.";
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question,
          mode: "read",
          debug: true,
          sessionId: `e52-docs-only-negated-other-tools-${Date.now()}`,
        })
        .expect(200);

      expect(response.body?.source_target_intent?.target_source).toBe("docs_viewer");
      expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_summary");
      expect(response.body?.tool_call_admission_decision).toMatchObject({
        source_target: "docs_viewer",
        required: true,
        admitted_tool_families: ["docs_viewer"],
        forbidden_tool_families: expect.arrayContaining(["repo_code", "internet_search"]),
      });
      expect(response.body?.policy_admitted_capability).not.toBe("model.direct_answer");
      expect(response.body?.executed_capability).not.toBe("model.direct_answer");
      expect(response.body?.line_tool_request_count).toBeGreaterThan(0);
      expect(response.body?.line_tool_evaluation_count).toBeGreaterThan(0);
      expect(response.body?.terminal_artifact_kind).toBe("doc_summary");
      expect(response.body?.goal_satisfaction_evaluation?.required_evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "doc_summary", satisfied: true }),
        ]),
      );

      const finalText = String(response.body?.selected_final_answer ?? response.body?.answer ?? "");
      expect(finalText).toContain("remaining gap");
      expect(finalText).toContain("/docs/audits/research/helix-ask-codex-parity-model-turn-fidelity-audit-2026-06-12.md");
      expect(finalText).not.toContain("/docs/audits/research/helix-ask-dottie");

      const debugExportRef = response.body?.debug_export_ref?.endpoint;
      expect(debugExportRef).toBeTruthy();
      const debugExport = await request(app).get(debugExportRef).expect(200);
      const payload = debugExport.body?.payload;
      expect(payload?.tool_call_admission_decision?.source_target).toBe("docs_viewer");
      expect(payload?.tool_call_admission_decision?.admitted_tool_families).toEqual(["docs_viewer"]);
      expect(payload?.tool_call_admission_decision?.forbidden_tool_families).toEqual(
        expect.arrayContaining(["repo_code", "internet_search"]),
      );
      expect(payload?.loop_parity_trace?.actual_tool_calls?.map((call: any) => call.tool_id)).toEqual([
        "docs-viewer.search_docs",
        "docs-viewer.validate_doc_candidates",
        "docs-viewer.open_doc_by_path",
        "docs-viewer.summarize_doc",
      ]);
      expect(payload?.loop_parity_trace?.observations_created).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ source_kind: "doc_search_results" }),
          expect.objectContaining({ source_kind: "doc_candidate_validation" }),
          expect.objectContaining({ source_kind: "doc_open_receipt" }),
          expect.objectContaining({ source_kind: "active_doc_path" }),
        ]),
      );
      expect((payload?.current_turn_artifact_ledger ?? []).map((artifact: any) => artifact?.kind)).toContain("doc_summary");
      expect(payload?.loop_parity_trace?.unexpected_tool_calls).toEqual([]);
      expect(payload?.loop_parity_trace?.short_circuit_risk_flags ?? []).not.toContain("tool_called_without_admission");
      expect(payload?.model_turn_fidelity_audit?.model_visible_tool_families).toEqual(
        expect.arrayContaining(["docs_viewer"]),
      );
      expect(payload?.model_turn_fidelity_audit?.authority?.policy_override_used).toBe(true);
      expect(payload?.model_turn_fidelity_audit?.parity_status).not.toBe("model_driven_parity");
      expect((payload?.agent_runtime_loop?.iterations ?? []).some((iteration: any) =>
        iteration.chosen_capability === "docs-viewer.validate_doc_candidates" &&
        iteration.decision_source === "deterministic_policy_fallback"
      )).toBe(true);
      expect((payload?.agent_runtime_loop?.iterations ?? []).some((iteration: any) =>
        iteration.chosen_capability === "docs-viewer.open_doc_by_path" &&
        iteration.decision_source === "deterministic_policy_fallback"
      )).toBe(true);
      expect((payload?.agent_runtime_loop?.iterations ?? []).some((iteration: any) =>
        iteration.chosen_capability === "docs-viewer.summarize_doc" &&
        iteration.decision_source === "deterministic_policy_fallback"
      )).toBe(true);
    } finally {
      if (previousFlag === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_LLM;
      else process.env.HELIX_AGENT_STEP_DECISION_LLM = previousFlag;
      if (previousResponse === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = previousResponse;
      if (previousResponseIndex === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = previousResponseIndex;
    }
  }, 60000);

  it("lets a model-followed docs summary continuation complete without policy repair", async () => {
    const app = createApp();
    const previousFlag = process.env.HELIX_AGENT_STEP_DECISION_LLM;
    const previousResponse = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
    const previousResponseIndex = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;

    process.env.HELIX_AGENT_STEP_DECISION_LLM = "1";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = "0";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = JSON.stringify([
      {
        next_step: "next_action",
        chosen_capability: "docs-viewer.search_docs",
        reason: "No doc_search_results exist yet, so search docs for the named audit document.",
        args: { query: "Helix Ask Codex parity model turn fidelity audit", limit: 5 },
        expected_artifacts: ["doc_search_results"],
        commentary: {
          turn_purpose: "Open and summarize the requested audit doc from local docs only.",
          why_this_capability: "The docs workflow starts with local docs search.",
          expected_artifacts: "doc_search_results",
          what_would_make_this_done: "A doc_summary artifact exists and terminal authority accepts it.",
          observation_summary: "No docs observation exists yet.",
          next_step_reason: "Search first.",
        },
        confidence: 0.95,
      },
      {
        next_step: "next_action",
        chosen_capability: "docs-viewer.validate_doc_candidates",
        reason: "doc_search_results exist; the docs continuation contract requires candidate validation next.",
        args: { query: "Helix Ask Codex parity model turn fidelity audit", limit: 8 },
        expected_artifacts: ["doc_candidate_validation"],
        commentary: {
          turn_purpose: "Validate the best matching local docs candidate.",
          why_this_capability: "The required next docs capability is validate_doc_candidates.",
          expected_artifacts: "doc_candidate_validation",
          what_would_make_this_done: "A selected candidate path is validated.",
          observation_summary: "doc_search_results are present.",
          next_step_reason: "Advance, do not repeat search.",
        },
        confidence: 0.96,
      },
      {
        next_step: "next_action",
        chosen_capability: "docs-viewer.open_doc_by_path",
        reason: "doc_candidate_validation selected a path; the next required capability is open_doc_by_path.",
        args: {
          path: "/docs/audits/research/helix-ask-codex-parity-model-turn-fidelity-audit-2026-06-12.md",
          query: "Helix Ask Codex parity model turn fidelity audit",
        },
        expected_artifacts: ["active_doc_path", "doc_open_receipt"],
        commentary: {
          turn_purpose: "Open the validated document.",
          why_this_capability: "The selected path must become active docs evidence.",
          expected_artifacts: "active_doc_path, doc_open_receipt",
          what_would_make_this_done: "The requested path is open.",
          observation_summary: "doc_candidate_validation is present.",
          next_step_reason: "Open the validated path.",
        },
        confidence: 0.96,
      },
      {
        next_step: "next_action",
        chosen_capability: "docs-viewer.summarize_doc",
        reason: "active_doc_path exists; the next required capability is summarize_doc.",
        args: {
          path: "/docs/audits/research/helix-ask-codex-parity-model-turn-fidelity-audit-2026-06-12.md",
          query: "remaining parity gap",
        },
        expected_artifacts: ["doc_summary"],
        commentary: {
          turn_purpose: "Summarize the opened document around the requested focus.",
          why_this_capability: "The open doc must produce a doc_summary artifact before terminal answer.",
          expected_artifacts: "doc_summary",
          what_would_make_this_done: "A scoped doc_summary exists.",
          observation_summary: "active_doc_path is present.",
          next_step_reason: "Summarize now.",
        },
        confidence: 0.97,
      },
      {
        next_step: "answer",
        chosen_capability: null,
        reason: "The doc_summary artifact satisfies the requested three-bullet parity-gap answer.",
        args: {},
        expected_artifacts: ["doc_summary"],
        commentary: {
          turn_purpose: "Answer from the doc_summary artifact.",
          why_this_capability: "No more tool call is needed.",
          expected_artifacts: "doc_summary",
          what_would_make_this_done: "Terminal authority accepts the doc_summary-backed final answer.",
          observation_summary: "doc_summary is present.",
          next_step_reason: "Answer from observed docs evidence.",
        },
        confidence: 0.98,
      },
    ]);

    try {
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question:
            "Open the Helix Ask Codex parity model turn fidelity audit doc. Use docs only. Do not use repo-code or internet search. After each document observation, choose the next required docs-viewer capability until you can answer from a doc summary artifact. Summarize the remaining parity gap in three bullets and include the document path.",
          mode: "read",
          debug: true,
          sessionId: `e52-doc-summary-model-driven-continuation-${Date.now()}`,
        })
        .expect(200);

      expect(response.body?.terminal_error_code ?? null).toBeNull();
      expect(response.body?.terminal_artifact_kind).toBe("doc_summary");
      expect(response.body?.goal_satisfaction_evaluation?.satisfaction).toBe("satisfied");
      expect(actionsOf(response.body).map((action) => `${action?.panel_id}.${action?.action_id}`)).toEqual([
        "docs-viewer.search_docs",
        "docs-viewer.validate_doc_candidates",
        "docs-viewer.open_doc_by_path",
        "docs-viewer.summarize_doc",
      ]);
      expect(response.body?.agent_runtime_loop?.iterations?.filter((iteration: any) =>
        String(iteration.chosen_capability ?? "").startsWith("docs-viewer.")
      ).every((iteration: any) => iteration.decision_source === "llm")).toBe(true);

      const debugExportRef = response.body?.debug_export_ref?.endpoint;
      expect(debugExportRef).toBeTruthy();
      const debugExport = await request(app).get(debugExportRef).expect(200);
      const payload = debugExport.body?.payload;
      expect(payload?.docs_continuation_contract).toMatchObject({
        schema: "helix.docs_continuation_contract.v1",
      });
      expect(payload?.loop_parity_trace?.actual_tool_calls?.map((call: any) => call.tool_id)).toEqual([
        "docs-viewer.search_docs",
        "docs-viewer.validate_doc_candidates",
        "docs-viewer.open_doc_by_path",
        "docs-viewer.summarize_doc",
      ]);
      expect(payload?.model_turn_fidelity_audit?.authority?.policy_override_used).toBe(false);
      expect(["model_driven_parity", "model_driven_docs_continuation"]).toContain(
        payload?.model_turn_fidelity_audit?.parity_status,
      );
    } finally {
      if (previousFlag === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_LLM;
      else process.env.HELIX_AGENT_STEP_DECISION_LLM = previousFlag;
      if (previousResponse === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = previousResponse;
      if (previousResponseIndex === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = previousResponseIndex;
    }
  }, 60000);

  it("treats debug export evidence as a docs topic after doc_summary terminal readiness", async () => {
    const app = createApp();
    const previousFlag = process.env.HELIX_AGENT_STEP_DECISION_LLM;
    const previousResponse = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
    const previousResponseIndex = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
    process.env.HELIX_AGENT_STEP_DECISION_LLM = "1";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = "0";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = JSON.stringify([
      {
        next_step: "next_action",
        chosen_capability: "docs-viewer.search_docs",
        reason: "Search docs for the best matching Helix Ask console debug document.",
        args: { query: "Helix Ask console debug export evidence" },
        expected_artifacts: ["doc_search_results"],
        confidence: 0.95,
      },
      {
        next_step: "next_action",
        chosen_capability: "docs-viewer.validate_doc_candidates",
        reason: "Validate the best matching document candidate.",
        args: {
          query: "Helix Ask console debug export evidence",
          selected_path: "/docs/audits/research/helix-ask-codex-parity-model-turn-fidelity-audit-2026-06-12.md",
        },
        expected_artifacts: ["doc_candidate_validation", "active_doc_path"],
        confidence: 0.95,
      },
      {
        next_step: "next_action",
        chosen_capability: "docs-viewer.open_doc_by_path",
        reason: "Open the validated document before summarizing.",
        args: {
          path: "/docs/audits/research/helix-ask-codex-parity-model-turn-fidelity-audit-2026-06-12.md",
        },
        expected_artifacts: ["doc_open_receipt", "active_doc_path"],
        confidence: 0.96,
      },
      {
        next_step: "next_action",
        chosen_capability: "docs-viewer.summarize_doc",
        reason: "Summarize what the document says about debug export evidence.",
        args: {
          path: "/docs/audits/research/helix-ask-codex-parity-model-turn-fidelity-audit-2026-06-12.md",
          query: "debug export evidence",
        },
        expected_artifacts: ["doc_summary"],
        confidence: 0.97,
      },
      {
        next_step: "next_action",
        chosen_capability: "docs-viewer.search_docs",
        reason: "This repeated post-summary search should not run once doc_summary is terminal-ready.",
        args: { query: "debug evidence" },
        expected_artifacts: ["doc_search_results"],
        confidence: 0.2,
      },
    ]);

    try {
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question:
            "Search docs for Helix Ask console debug, open the best matching document, and summarize what it says about debug export evidence. Tell me the document path you used.",
          mode: "read",
          debug: true,
          sessionId: `e52-doc-summary-debug-topic-${Date.now()}`,
        })
        .expect(200);

      expect(response.body?.terminal_error_code ?? null).toBeNull();
      expect(response.body?.terminal_artifact_kind).toBe("doc_summary");
      expect(response.body?.final_answer_source).not.toBe("typed_failure");
      expect(response.body?.debug_evidence_requirement_source).toBe("docs_topic_phrase");
      expect(response.body?.debug_evidence_requirement_suppressed).toBe(true);
      expect(response.body?.debug_evidence_requirement_suppression_reason).toBe(
        "debug_evidence_phrase_is_docs_topic_after_doc_summary_terminal_ready",
      );
      expect(response.body?.docs_continuation_contract).toMatchObject({
        current_docs_phase: "terminal_ready",
      });
      expect(response.body?.goal_satisfaction_evaluation?.satisfaction).toBe("satisfied");
      const runtimeCapabilities = response.body?.agent_runtime_loop?.iterations
        ?.map((iteration: any) => iteration.chosen_capability)
        ?.filter((capability: string | null) => capability?.startsWith("docs-viewer.")) ?? [];
      expect(runtimeCapabilities).toEqual([
        "docs-viewer.search_docs",
        "docs-viewer.validate_doc_candidates",
        "docs-viewer.open_doc_by_path",
        "docs-viewer.summarize_doc",
      ]);
      expect(String(response.body?.selected_final_answer ?? "")).toContain(
        "/docs/audits/research/helix-ask-codex-parity-model-turn-fidelity-audit-2026-06-12.md",
      );

      const debugExportRef = response.body?.debug_export_ref?.endpoint;
      expect(debugExportRef).toBeTruthy();
      const debugExport = await request(app).get(debugExportRef).expect(200);
      const payload = debugExport.body?.payload;
      expect(payload?.debug_evidence_requirement_source).toBe("docs_topic_phrase");
      expect(payload?.debug_evidence_requirement_suppressed).toBe(true);
      expect(payload?.debug_evidence_requirement_policy).toMatchObject({
        schema: "helix.debug_evidence_requirement_policy.v1",
        requirement_source: "docs_topic_phrase",
        suppressed: true,
        docs_terminal_ready: true,
      });
    } finally {
      if (previousFlag === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_LLM;
      else process.env.HELIX_AGENT_STEP_DECISION_LLM = previousFlag;
      if (previousResponse === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = previousResponse;
      if (previousResponseIndex === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = previousResponseIndex;
    }
  }, 60000);

  it("keeps calculator prose args inside the runtime repair loop", async () => {
    const app = createApp();
    const previousFlag = process.env.HELIX_AGENT_STEP_DECISION_LLM;
    const previousResponse = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
    const previousResponseIndex = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
    const previousComposerResponse = process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE;
    process.env.HELIX_AGENT_STEP_DECISION_LLM = "1";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = "0";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = JSON.stringify([
      {
        next_step: "next_action",
        chosen_capability: "scientific-calculator.solve_expression",
        reason: "The initial pre-runtime decision is intentionally prose-shaped and should not become terminal authority.",
        args: { latex: "calculate acceleration, force, and kinetic energy for the sled" },
        expected_artifacts: ["calculator_receipt"],
        confidence: 0.7,
      },
      {
        next_step: "next_action",
        chosen_capability: "scientific-calculator.solve_expression",
        reason: "The runtime decision is intentionally invalid and should become a repairable observation.",
        args: { latex: "calculate acceleration, force, and kinetic energy for the sled" },
        expected_artifacts: ["calculator_receipt", "calculator_subgoal_receipt", "calculator_plan_coverage"],
        confidence: 0.7,
      },
      {
        next_step: "repair",
        chosen_capability: "scientific-calculator.solve_expression",
        reason: "Repair the invalid calculator call with the acceleration expression.",
        args: { latex: "(15-3)/6", compound_subgoal_id: "acceleration" },
        expected_artifacts: ["calculator_receipt", "calculator_subgoal_receipt", "calculator_plan_coverage"],
        confidence: 0.95,
      },
      {
        next_step: "next_action",
        chosen_capability: "scientific-calculator.solve_expression",
        reason: "Use the repaired acceleration result with the given mass to compute force.",
        args: { latex: "4*2", compound_subgoal_id: "force" },
        expected_artifacts: ["calculator_receipt", "calculator_subgoal_receipt", "calculator_plan_coverage"],
        confidence: 0.95,
      },
      {
        next_step: "next_action",
        chosen_capability: "scientific-calculator.solve_expression",
        reason: "Compute the requested kinetic-energy change from the given speeds.",
        args: { latex: "0.5*4*(15^2-3^2)", compound_subgoal_id: "change_kinetic_energy" },
        expected_artifacts: ["calculator_receipt", "calculator_subgoal_receipt", "calculator_plan_coverage"],
        confidence: 0.95,
      },
      {
        next_step: "answer",
        chosen_capability: null,
        reason: "The calculator receipts satisfy the requested acceleration, force, and kinetic-energy calculations.",
        args: {},
        expected_artifacts: ["workstation_tool_evaluation"],
        confidence: 0.98,
      },
    ]);
    process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE =
      "Acceleration: (15-3)/6 = 2 m/s^2. Net force: 4*2 = 8 N. Change in kinetic energy: 0.5*4*(15^2-3^2) = 432 J.";

    try {
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question:
            "A 4 kg sled accelerates from 3 m/s to 15 m/s in 6 seconds. Use the scientific calculator to compute acceleration, net force, and the change in kinetic energy, then answer only from those calculator receipts.",
          mode: "read",
          debug: true,
          sessionId: `e52-calculator-prose-arg-repair-${Date.now()}`,
        })
        .expect(200);

      const ledger = response.body?.current_turn_artifact_ledger ?? [];
      expect(ledger).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "runtime_tool_call_validation",
            payload: expect.objectContaining({
              capability_key: "scientific-calculator.solve_expression",
              valid: false,
              errors: expect.arrayContaining(["invalid_arg:latex_is_prose"]),
            }),
          }),
          expect.objectContaining({
            kind: "runtime_tool_observation",
            payload: expect.objectContaining({
              capability_key: "scientific-calculator.solve_expression",
              status: "invalid_args",
              repairable: true,
            }),
          }),
          expect.objectContaining({
            kind: "runtime_tool_call_validation",
            payload: expect.objectContaining({
              capability_key: "scientific-calculator.solve_expression",
              valid: true,
            }),
          }),
        ]),
      );
      expect(response.body?.agent_runtime_loop?.iterations?.some((iteration: any) =>
        iteration.observation_role === "invalid_tool_call_observation" &&
        iteration.chosen_capability === "scientific-calculator.solve_expression" &&
        iteration.produced_artifacts.includes("runtime_tool_observation")
      )).toBe(true);
      expect(response.body?.agent_runtime_loop?.iterations?.some((iteration: any) =>
        iteration.next_step === "repair" &&
        iteration.chosen_capability === "scientific-calculator.solve_expression" &&
        iteration.decision_source === "llm"
      )).toBe(true);
      expect(response.body?.calculator_subgoal_receipts?.some((receipt: any) =>
        receipt.subgoal_id === "acceleration" &&
        receipt.expression_box_input === "(15-3)/6" &&
        receipt.result_box_output === "2"
      )).toBe(true);
      expect(String(response.body?.selected_final_answer ?? "")).toContain("2 m/s^2");
      expect(String(response.body?.selected_final_answer ?? "")).toContain("8 N");
      expect(String(response.body?.selected_final_answer ?? "")).toContain("432 J");
      expect(String(response.body?.selected_final_answer ?? "")).not.toContain("requires a calculator expression, not prose");
    } finally {
      if (previousFlag === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_LLM;
      else process.env.HELIX_AGENT_STEP_DECISION_LLM = previousFlag;
      if (previousResponse === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = previousResponse;
      if (previousResponseIndex === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = previousResponseIndex;
      if (previousComposerResponse === undefined) delete process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE;
      else process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE = previousComposerResponse;
    }
  }, 60000);

  it("uses calculator output as a subgoal before answering compound photon prompts", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Explain photon energy using E=hf and calculate it for f=5e14 Hz.",
        mode: "read",
        debug: true,
        sessionId: `e52-calculator-compound-${Date.now()}`,
      })
      .expect(200);

    const action = findAction(response.body, "scientific-calculator", "solve_expression");
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("calculator_solve");
    expect(action).toBeTruthy();
    expect(action?.args?.latex).toBe("6.62607015e-34*5e14");
    expect(response.body?.terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(response.body?.route_reason_code).toBe("calculator_solve");
    expect(["calculator_stream", "live_pipeline"]).toContain(response.body?.source_target_intent?.target_source);
    expect(response.body?.terminal_answer_authority?.route).toBe("calculator_solve");
    expect(response.body?.poison_audit?.ok).toBe(true);
    expect(response.body?.tool_observation_continuation).toMatchObject({
      schema: "helix.tool_observation_continuation.v1",
      expression: "6.62607015e-34*5e14",
      result: "3.313035e-19",
      continuation_required: true,
    });
    expect(response.body?.reasoning_continuation_result).toMatchObject({
      schema: "helix.reasoning_continuation_result.v1",
      final_answer_kind: "calculator_grounded_explanation",
    });
    expect(response.body?.current_turn_artifact_ledger?.some((artifact: any) =>
      artifact.kind === "tool_observation_continuation" &&
      artifact.payload?.expression === "6.62607015e-34*5e14"
    )).toBe(true);
    expect(response.body?.current_turn_artifact_ledger?.some((artifact: any) =>
      artifact.kind === "reasoning_continuation_result" &&
      artifact.payload?.final_answer_kind === "calculator_grounded_explanation"
    )).toBe(true);
    expect(String(response.body?.selected_final_answer ?? "")).toContain("A photon is a single quantum of electromagnetic radiation.");
    expect(String(response.body?.selected_final_answer ?? "")).toContain("Result: E = 3.313035e-19 J");
  }, 60000);

  it("routes multi-step calculator prompts through the compound chain on /ask/turn", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "A photon has frequency 6e14 Hz. Use the scientific calculator to find its wavelength and photon energy in joules and eV, then explain the result.",
        mode: "read",
        debug: true,
        sessionId: `e52-calculator-compound-chain-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("calculator_solve / calculator_compound_chain");
    expect(["workstation_tool_evaluation", "model_synthesized_answer"]).toContain(response.body?.terminal_artifact_kind);
    expect(String(response.body?.final_answer_source ?? "")).toMatch(/workstation_tool_evaluation|final_answer_draft|model_turn|model_synthesized_answer/);
    expect(response.body?.calculator_compound_plan?.subgoals?.map((subgoal: any) => subgoal.id)).toEqual([
      "wavelength",
      "photon_energy_j",
      "photon_energy_ev",
    ]);
    expect(response.body?.calculator_result_validations?.every((validation: any) => validation.satisfied)).toBe(true);
    expect(response.body?.agent_calculator_subgoal_plan).toMatchObject({
      schema: "helix.agent_calculator_subgoal_plan.v1",
      authority: "agent_step_decision",
      seed_plan_role: "hint_only_non_authoritative",
      rejected_deterministic_authority: true,
    });
    expect(response.body?.agent_calculator_subgoal_plan?.subgoals?.map((subgoal: any) => subgoal.id)).toEqual([
      "wavelength",
      "photon_energy_j",
      "photon_energy_ev",
    ]);
    expect(response.body?.calculator_loop_integrity).toMatchObject({
      schema: "helix.calculator_loop_integrity.v1",
      ok: true,
      violations: [],
    });
    expect(response.body?.calculator_loop_integrity?.receipt_decision_links?.map((link: any) => link.subgoal_id)).toEqual([
      "wavelength",
      "photon_energy_j",
      "photon_energy_ev",
    ]);
    expect(response.body?.calculator_loop_integrity?.receipt_decision_links?.every((link: any) => Boolean(link.decision_ref))).toBe(true);
    expect(response.body?.runtime_continuation_hints?.length).toBeGreaterThanOrEqual(3);
    expect(response.body?.runtime_continuation_hints?.every((hint: any) =>
      hint.schema === "helix.runtime_continuation_hint.v1" &&
      hint.source === "calculator_compound_chain" &&
      hint.authority === "hint_only_agent_must_decide" &&
      hint.migrated_to_agent_runtime_loop === true
    )).toBe(true);
    expect(response.body?.agent_runtime_loop_admission).toMatchObject({
      schema: "helix.agent_runtime_loop_admission.v1",
      admitted: true,
      reason: "runtime_continuation_hints_require_agent_step_decision",
    });
    expect(["record_only", "execute_or_record"]).toContain(response.body?.agent_runtime_loop_admission?.mode);
    expect(response.body?.agent_runtime_loop).toMatchObject({
      schema: "helix.agent_runtime_loop.v1",
      stop_reason: "terminal_satisfied",
    });
    const executedCalculatorIterations = response.body?.agent_runtime_loop?.iterations?.filter((iteration: any) =>
      iteration.observation_role === "executed_tool_result" &&
      iteration.chosen_capability === "scientific-calculator.solve_expression"
    ) ?? [];
    expect(executedCalculatorIterations.length).toBeGreaterThanOrEqual(3);
    expect(executedCalculatorIterations.filter((iteration: any) =>
      iteration.produced_artifacts.includes("calculator_receipt")
    ).length).toBeGreaterThanOrEqual(3);
    expect(executedCalculatorIterations.filter((iteration: any) =>
      iteration.produced_artifacts.includes("calculator_receipt")
    ).every((iteration: any) =>
      Array.isArray(iteration.observed_artifact_refs) &&
      iteration.observed_artifact_refs.length > 0
    )).toBe(true);
    expect(response.body?.agent_runtime_loop?.iterations?.every((iteration: any) =>
      iteration.decision_source === "llm" || iteration.decision_source === "deterministic_policy_fallback"
    )).toBe(true);
    expect(response.body?.agent_runtime_loop?.iterations?.every((iteration: any) =>
      iteration.decision_authority === "llm" || iteration.decision_authority === "deterministic_policy_fallback"
    )).toBe(true);
    expect(response.body?.runtime_authority_audit).toMatchObject({
      schema: "helix.runtime_authority_audit.v1",
      runtime_intent_packet_ref: expect.stringContaining(":runtime_intent_packet"),
      capability_turn: true,
      runtime_loop_present: true,
      all_subgoals_observed_terminal_authority: false,
      ok: true,
    });
    expect(response.body?.runtime_authority_audit?.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: "runtime_loop_present_for_source_or_capability_turn",
          passed: true,
        }),
        expect.objectContaining({
          check: "no_terminal_without_runtime_loop_for_capability_turn",
          passed: true,
        }),
        expect.objectContaining({
          check: "runtime_loop_records_decision_authority",
          passed: true,
        }),
      ]),
    );
    expect(response.body?.runtime_intent_packet).toMatchObject({
      schema: "helix.runtime_intent_packet.v1",
      completion_authority: "agent_runtime_loop_and_goal_satisfaction",
      terminal_contract: expect.objectContaining({
        goal_kind: "calculator_solve",
        required_terminal_kinds: ["workstation_tool_evaluation"],
      }),
    });
    expect(response.body?.runtime_intent_packet?.hints?.every((hint: any) => hint.authority === "hint_only")).toBe(true);
    expect(response.body?.observation_review).toMatchObject({
      schema: "helix.observation_review.v1",
      supports_goal: true,
      runtime_next_action: "final",
    });
    expect(response.body?.runtime_authority_audit?.legacy_hint_count).toBeGreaterThanOrEqual(3);
    expect(response.body?.runtime_authority_audit?.migrated_hint_count).toBe(response.body?.runtime_authority_audit?.legacy_hint_count);
    expect(response.body?.runtime_authority_audit?.accepted_hint_refs?.length).toBe(response.body?.runtime_authority_audit?.legacy_hint_count);
    expect(response.body?.runtime_authority_audit?.rejected_hints).toEqual([]);
    expect(response.body?.runtime_continuation_hints?.every((hint: any) =>
      hint.accepted_by_agent_step_decision === true &&
      typeof hint.accepted_decision_ref === "string" &&
      hint.rejection_reason === null
    )).toBe(true);
    expect(readGoalSatisfaction(response.body)?.satisfaction).toBe("satisfied");
    expect(response.body?.available_capabilities?.manifest_role).toBe("model_visible_tool_menu");
    expect(response.body?.available_capabilities?.model_visible_capability_keys).toEqual(
      expect.arrayContaining([
        "scientific-calculator.solve_expression",
        "docs-viewer.open",
        "workstation-notes.open",
        "situation-room.describe_visual_capture",
        "live-source.set_rate",
      ]),
    );
    expect(response.body?.initial_agent_step_decision).toMatchObject({
      schema: "helix.agent_step_decision.v1",
      decision_role: "agent_step_sampling_pass",
      chosen_capability: "scientific-calculator.solve_expression",
      next_step: "next_action",
    });
    expect(response.body?.agent_step_decision).toMatchObject({
      schema: "helix.agent_step_decision.v1",
      decision_role: "agent_step_sampling_pass",
      chosen_capability: "scientific-calculator.solve_expression",
      next_step: "answer",
    });
    expect(response.body?.agent_step_decision?.current_observations?.length).toBeGreaterThan(0);
    expect(response.body?.calculator_agent_subgoal_decisions?.length).toBeGreaterThanOrEqual(2);
    expect(response.body?.agent_step_loop?.final_state).toBe("answered");
    expect(response.body?.agent_step_loop?.steps?.map((step: any) => step.step_id)).toEqual(
      expect.arrayContaining(["subgoal_wavelength", "subgoal_photon_energy_j"]),
    );
    expect(response.body?.agent_step_loop?.steps?.filter((step: any) => step.next_step === "next_action").every((step: any) =>
      step.next_step === "next_action" &&
      step.chosen_capability === "scientific-calculator.solve_expression"
    )).toBe(true);
    expect(response.body?.observation_review).toMatchObject({
      schema: "helix.observation_review.v1",
      does_it_satisfy_goal: true,
      next_action: "final",
    });
    expect(String(response.body?.selected_final_answer ?? "")).toContain("Wavelength:");
    expect(String(response.body?.selected_final_answer ?? "")).toContain("Photon energy:");
  }, 60000);

  it("routes uncertainty relation prompts through calculator compound receipts instead of prose latex retries", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "Use the calculator panel to help answer this. Model a simple quantum wave packet with uncertainty relation dx dp >= hbar/2. Let dx = 2.0e-10 m. Calculate the minimum dp, then estimate minimum kinetic energy p^2/(2*m_e) in joules and eV. Explain the equations conceptually.",
        mode: "read",
        debug: true,
        sessionId: `e52-calculator-uncertainty-chain-${Date.now()}`,
      })
      .expect(200);

    const validations = response.body?.current_turn_artifact_ledger?.filter((artifact: any) =>
      artifact.kind === "runtime_tool_call_validation"
    ) ?? [];

    expect(response.body?.route_reason_code).toBe("calculator_solve / calculator_compound_chain");
    expect(["workstation_tool_evaluation", "model_synthesized_answer"]).toContain(response.body?.terminal_artifact_kind);
    expect(String(response.body?.final_answer_source ?? "")).toMatch(/workstation_tool_evaluation|final_answer_draft|model_turn|model_synthesized_answer/);
    expect(response.body?.calculator_compound_plan?.subgoals?.map((subgoal: any) => subgoal.id)).toEqual([
      "minimum_momentum_uncertainty",
      "minimum_kinetic_energy_j",
      "minimum_kinetic_energy_ev",
    ]);
    expect(response.body?.calculator_result_validations?.every((validation: any) => validation.satisfied)).toBe(true);
    expect(validations.some((validation: any) =>
      validation.payload?.errors?.includes("invalid_arg:latex_is_prose")
    )).toBe(false);
    expect(readGoalSatisfaction(response.body)?.satisfaction).toBe("satisfied");
    expect(String(response.body?.selected_final_answer ?? "")).toMatch(/Minimum momentum uncertainty|minimum momentum uncertainty/i);
    expect(String(response.body?.selected_final_answer ?? "")).toMatch(/Minimum kinetic energy|kinetic energy/i);
    expect(String(response.body?.selected_final_answer ?? "")).toContain("Delta x Delta p >= hbar/2");
  }, 60000);

  it("lets explicit calculator follow-ups outrank prior-answer memory recall while preserving context", async () => {
    const app = createApp();
    const sessionId = `e52-calculator-memory-followup-${Date.now()}`;
    appendConversationHistoryEvent({
      route: "/api/agi/ask/turn",
      event_type: "ask_completed",
      turn_id: `${sessionId}:seed`,
      session_id: sessionId,
      user_text:
        "Can you explain conceptually why quantum fields, particle localization, and the uncertainty principle are connected?",
      assistant_text:
        "Quantum fields are spread-through-space systems; localized particles can be modeled as wave packets, and uncertainty links localization to momentum spread.",
      classifier_result: {
        mode: "read",
        confidence: 0.99,
        dispatch_hint: false,
        clarify_needed: false,
        reason: "seed prior conceptual answer for follow-up calculator routing",
        source: "test_seed",
      },
      route_reason: "conversation:simple",
      brief_status: "ready",
      final_gate_outcome: "final_answer",
    });

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "Now show the math for this using the calculator panel. Use the context from the previous answer: take a wave packet localized to dx = 2.0e-10 m, use dx dp >= hbar/2 to calculate minimum dp, then use p^2/(2*m_e) to estimate the electron kinetic energy in J and eV. Show the equations, calculator expressions, numeric results, and connect the math back to the concept.",
        mode: "read",
        debug: true,
        sessionId,
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("calculator_solve / calculator_compound_chain");
    expect(response.body?.route_reason_code).not.toBe("conversation_memory_recall");
    expect(response.body?.conversation_memory_packet?.latest_answer_summary).toContain("Quantum fields");
    expect(response.body?.calculator_compound_plan?.subgoals?.map((subgoal: any) => subgoal.id)).toEqual([
      "minimum_momentum_uncertainty",
      "minimum_kinetic_energy_j",
      "minimum_kinetic_energy_ev",
    ]);
    expect(response.body?.calculator_result_validations?.every((validation: any) => validation.satisfied)).toBe(true);
    expect(response.body?.terminal_artifact_kind).not.toBe("typed_failure");
    expect(String(response.body?.selected_final_answer ?? "")).not.toMatch(/solver_path_incomplete_before_terminal/i);
    expect(String(response.body?.selected_final_answer ?? "")).toMatch(/Delta x Delta p >= hbar\/2|minimum momentum uncertainty/i);
  }, 60000);

  it("uses the generic calculator planner for broader force prompts", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "A 1200 kg car accelerates at 3 m/s^2. Use the scientific calculator to compute the force.",
        mode: "read",
        debug: true,
        sessionId: `e52-calculator-generic-force-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(response.body?.calculator_candidate_hints).toMatchObject({
      schema: "helix.calculator_candidate_hints.v1",
      authority: "hint_only",
    });
    expect(response.body?.calculator_planner_result?.authority).toBe("deterministic_generic_fallback");
    expect(response.body?.calculator_compound_plan?.subgoals?.map((subgoal: any) => subgoal.id)).toEqual(["force"]);
    expect(response.body?.calculator_compound_plan?.subgoals?.[0]).toMatchObject({
      expression: "1200*3",
      expected_quantity: "force",
      expected_unit: "N",
    });
    expect(response.body?.calculator_result_validations?.every((validation: any) => validation.satisfied)).toBe(true);
    expect(response.body?.calculator_loop_integrity?.ok).toBe(true);
    expect(String(response.body?.selected_final_answer ?? "")).toContain("3600 N");
  }, 60000);

  it("derives acceleration from rest-to-final-speed prompts before force and kinetic energy", async () => {
    const app = createApp();
    const previousComposerResponse = process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE;
    process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE =
      "The calculations give acceleration = 3 m/s^2, force = 9 N, and final kinetic energy = 216 J. The results show that the requested values follow directly from the given mass, final speed, and time, without inventing extra measurements.";
    let response: any;
    try {
      response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question:
            "A 3 kg cart starts from rest and reaches 12 m/s in 4 seconds. Use the scientific calculator as a tool to compute acceleration, force, and final kinetic energy. Then explain how the calculator results support the answer without inventing extra measurements.",
          mode: "read",
          debug: true,
          sessionId: `e52-calculator-rest-kinematics-${Date.now()}`,
        })
        .expect(200);
    } finally {
      if (previousComposerResponse === undefined) {
        delete process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE;
      } else {
        process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE = previousComposerResponse;
      }
    }

    expect(response.body?.terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(response.body?.terminal_error_code ?? null).toBeNull();
    expect(response.body?.calculator_plan_coverage).toMatchObject({
      schema: "helix.calculator_plan_coverage.v1",
      coverage: "complete",
      missing_requirement_ids: [],
    });
    expect(response.body?.calculator_compound_plan?.subgoals?.map((subgoal: any) => subgoal.id)).toEqual([
      "acceleration",
      "force",
      "final_kinetic_energy",
    ]);
    expect(response.body?.calculator_compound_plan?.subgoals?.map((subgoal: any) => subgoal.expression)).toEqual([
      "12/4",
      "3*3",
      "0.5*3*12^2",
    ]);
    expect(response.body?.calculator_subgoal_receipts?.map((receipt: any) => receipt.result_text)).toEqual([
      "3",
      "9",
      "216",
    ]);
    expect(response.body?.calculator_result_validations?.every((validation: any) => validation.satisfied)).toBe(true);
    expect(response.body?.calculator_loop_integrity?.ok).toBe(true);
    expect(String(response.body?.selected_final_answer ?? "")).toContain("3 m/s^2");
    expect(String(response.body?.selected_final_answer ?? "")).toContain("9 N");
    expect(String(response.body?.selected_final_answer ?? "")).toContain("216 J");
    expect(String(response.body?.selected_final_answer ?? "")).not.toMatch(/interpretation of these results is missing/i);
  }, 60000);

  it("derives speed-change acceleration and kinetic-energy change from from-to velocity prompts", async () => {
    const app = createApp();
    const previousComposerResponse = process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE;
    process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE =
      "The calculator results give acceleration = 2 m/s^2, net force = 8 N, and change in kinetic energy = 432 J. These results use only the given mass, initial speed, final speed, and elapsed time.";
    let response: any;
    try {
      response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question:
            "A 4 kg sled accelerates from 3 m/s to 15 m/s in 6 seconds. Use the scientific calculator to compute acceleration, net force, and the change in kinetic energy, then explain what each result means without adding extra measurements.",
          mode: "read",
          debug: true,
          sessionId: `e52-calculator-speed-change-kinematics-${Date.now()}`,
        })
        .expect(200);
    } finally {
      if (previousComposerResponse === undefined) {
        delete process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE;
      } else {
        process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE = previousComposerResponse;
      }
    }

    expect(response.body?.terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(response.body?.terminal_error_code ?? null).toBeNull();
    expect(response.body?.calculator_plan_coverage).toMatchObject({
      schema: "helix.calculator_plan_coverage.v1",
      coverage: "complete",
      missing_requirement_ids: [],
    });
    expect(response.body?.calculator_compound_plan?.subgoals?.map((subgoal: any) => subgoal.id)).toEqual([
      "acceleration",
      "force",
      "change_kinetic_energy",
    ]);
    expect(response.body?.calculator_compound_plan?.subgoals?.map((subgoal: any) => subgoal.expression)).toEqual([
      "(15-3)/6",
      "4*2",
      "0.5*4*(15^2-3^2)",
    ]);
    expect(response.body?.calculator_subgoal_receipts?.map((receipt: any) => receipt.result_text)).toEqual([
      "2",
      "8",
      "432",
    ]);
    expect(response.body?.calculator_subgoal_receipts?.every((receipt: any) =>
      receipt.authorized_by_agent_step_decision === true &&
      typeof receipt.prior_agent_step_decision_ref === "string" &&
      receipt.prior_agent_step_decision_ref.includes(":agent_step_decision:"),
    )).toBe(true);
    expect(response.body?.agent_calculator_subgoal_plan?.subgoals?.map((subgoal: any) => subgoal.id)).toEqual([
      "acceleration",
      "force",
      "change_kinetic_energy",
    ]);
    expect(response.body?.agent_calculator_subgoal_plan?.subgoals?.every((subgoal: any) =>
      typeof subgoal.decision_ref === "string" && subgoal.decision_ref.includes(":agent_step_decision:"),
    )).toBe(true);
    const ledger = response.body?.current_turn_artifact_ledger ?? [];
    const authorizingDecisionIndices = ledger
      .map((artifact: any, index: number) => ({ artifact, index }))
      .filter(({ artifact }: any) =>
        artifact.kind === "agent_step_decision" &&
        artifact.payload?.action_authorization?.authorizes_tool_execution === true,
      )
      .map(({ index }: any) => index);
    const receiptIndices = ledger
      .map((artifact: any, index: number) => ({ artifact, index }))
      .filter(({ artifact }: any) =>
      artifact.kind === "calculator_subgoal_receipt" ||
      artifact.kind === "calculator_receipt" ||
      artifact.kind === "calculator_subgoal_receipts"
      )
      .map(({ index }: any) => index);
    expect(receiptIndices.length).toBeGreaterThanOrEqual(3);
    expect(authorizingDecisionIndices.length).toBeGreaterThanOrEqual(1);
    expect(authorizingDecisionIndices[0]).toBeLessThan(receiptIndices[0]);
    expect(response.body?.initial_agent_step_decision?.agent_step_prompt).toMatchObject({
      runtime_intent_packet_ref: expect.stringContaining(":runtime_intent_packet"),
      terminal_contract_ref: expect.stringContaining(":calculator_goal_terminal_contract"),
      coverage_state_ref: expect.stringContaining(":calculator_plan_coverage"),
      budget_state_ref: expect.stringContaining(":agent_loop_budget"),
      allowed_outputs: ["next_action", "answer", "ask_user", "repair", "fail_closed"],
    });
    expect(response.body?.initial_agent_step_decision?.model_prompt_summary).toMatchObject({
      canonical_goal_kind: "calculator_solve",
      available_capability_count: expect.any(Number),
      current_observation_count: expect.any(Number),
    });
    expect(response.body?.initial_agent_step_decision?.rejected_capabilities?.length).toBeGreaterThan(0);
    expect(response.body?.calculator_result_validations?.every((validation: any) => validation.satisfied)).toBe(true);
    expect(response.body?.calculator_loop_integrity?.ok).toBe(true);
    expect(String(response.body?.selected_final_answer ?? "")).toContain("2 m/s^2");
    expect(String(response.body?.selected_final_answer ?? "")).toContain("8 N");
    expect(String(response.body?.selected_final_answer ?? "")).toContain("432 J");
  }, 60000);

  it("uses model-selected calculator calls for acceleration, force, and kinetic-energy subgoals", async () => {
    const app = createApp();
    const previousFlag = process.env.HELIX_AGENT_STEP_DECISION_LLM;
    const previousResponse = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
    const previousResponseIndex = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
    const previousComposerResponse = process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE;
    process.env.HELIX_AGENT_STEP_DECISION_LLM = "1";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = "0";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = JSON.stringify([
      {
        next_step: "next_action",
        chosen_capability: "scientific-calculator.solve_expression",
        reason: "First compute the requested acceleration from the velocity change and elapsed time.",
        args: { latex: "(15-3)/6", compound_subgoal_id: "acceleration" },
        expected_artifacts: ["calculator_receipt", "calculator_subgoal_receipt", "calculator_plan_coverage"],
        confidence: 0.97,
      },
      {
        next_step: "next_action",
        chosen_capability: "scientific-calculator.solve_expression",
        reason: "Use the acceleration result with the given mass to compute net force.",
        args: { latex: "4*2", compound_subgoal_id: "force" },
        expected_artifacts: ["calculator_receipt", "calculator_subgoal_receipt", "calculator_plan_coverage"],
        confidence: 0.97,
      },
      {
        next_step: "next_action",
        chosen_capability: "scientific-calculator.solve_expression",
        reason: "Use the initial and final speeds to compute the requested kinetic-energy change.",
        args: { latex: "0.5*4*(15^2-3^2)", compound_subgoal_id: "change_kinetic_energy" },
        expected_artifacts: ["calculator_receipt", "calculator_subgoal_receipt", "calculator_plan_coverage"],
        confidence: 0.97,
      },
      {
        next_step: "answer",
        chosen_capability: null,
        reason: "The calculator receipts now cover acceleration, net force, and kinetic-energy change.",
        args: {},
        expected_artifacts: ["workstation_tool_evaluation"],
        confidence: 0.98,
      },
    ]);
    process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE =
      "Acceleration: (15-3)/6 = 2 m/s^2. Net force: 4*2 = 8 N. Change in kinetic energy: 0.5*4*(15^2-3^2) = 432 J.";

    try {
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question:
            "A 4 kg sled accelerates from 3 m/s to 15 m/s in 6 seconds. Use the scientific calculator to compute acceleration, net force, and the change in kinetic energy, then answer only from those calculator receipts.",
          mode: "read",
          debug: true,
          sessionId: `e52-calculator-model-selected-kinematics-${Date.now()}`,
        })
        .expect(200);

      const runtimeIterations = response.body?.agent_runtime_loop?.iterations ?? [];
      const calculatorIterations = runtimeIterations.filter((iteration: any) =>
        iteration.observation_role === "executed_tool_result" &&
        iteration.chosen_capability === "scientific-calculator.solve_expression" &&
        Array.isArray(iteration.produced_artifacts) &&
        iteration.produced_artifacts.includes("calculator_subgoal_receipt"),
      );
      expect(calculatorIterations).toHaveLength(3);
      expect(calculatorIterations.map((iteration: any) => iteration.decision_source)).toEqual(["llm", "llm", "llm"]);
      expect(calculatorIterations.map((iteration: any) => iteration.decision_authority)).toEqual(["llm", "llm", "llm"]);
      expect(calculatorIterations.every((iteration: any) =>
        iteration.llm_used === true &&
        Array.isArray(iteration.observed_artifact_refs) &&
        iteration.observed_artifact_refs.length > 0 &&
        iteration.produced_artifacts.includes("calculator_subgoal_receipt"),
      )).toBe(true);
      const answerIteration = [...runtimeIterations].reverse().find((iteration: any) => iteration.next_step === "answer");
      expect(answerIteration).toMatchObject({
        next_step: "answer",
        chosen_capability: null,
        decision_source: "llm",
      });

      const receipts = response.body?.calculator_subgoal_receipts ?? [];
      expect(receipts.map((receipt: any) => receipt.subgoal_id)).toEqual([
        "acceleration",
        "force",
        "change_kinetic_energy",
      ]);
      expect(receipts.map((receipt: any) => receipt.expression_box_input)).toEqual([
        "(15-3)/6",
        "4*2",
        "0.5*4*(15^2-3^2)",
      ]);
      expect(receipts.map((receipt: any) => receipt.result_box_output)).toEqual(["2", "8", "432"]);
      expect(receipts.every((receipt: any) =>
        receipt.authorized_by_agent_step_decision === true &&
        receipt.runtime_tool_call_authority === "agent_step_decision" &&
        typeof receipt.prior_agent_step_decision_ref === "string" &&
        receipt.prior_agent_step_decision_ref.includes(":agent_step_decision:"),
      )).toBe(true);

      expect(response.body?.calculator_plan_coverage).toMatchObject({
        coverage: "complete",
        missing_requirement_ids: [],
      });
      expect(response.body?.agent_loop_budget).toMatchObject({
        consumed_llm_decisions: 4,
        consumed_observation_reviews: expect.any(Number),
        non_counted_validation_steps: expect.any(Number),
      });
      expect(response.body?.agent_loop_budget?.consumed_observation_reviews).toBeGreaterThanOrEqual(3);
      expect(response.body?.budget).toMatchObject({
        used_model_decisions: 4,
        used_observation_reviews: expect.any(Number),
        non_counted_validation_steps: expect.any(Number),
      });
      expect(response.body?.terminal_artifact_kind).toBe("workstation_tool_evaluation");
      expect(response.body?.final_answer_source).toBe("workstation_tool_evaluation");
      expect(response.body?.runtime_final_answer_composer).toMatchObject({
        schema: "helix.runtime_final_answer_composer.v1",
        answer_decision_ref: answerIteration.decision_ref,
        final_answer_generated_after_model_answer_decision: true,
      });
      expect(response.body?.final_answer_draft).toMatchObject({
        schema: "helix.final_answer_draft.v1",
        composer_trigger_decision_ref: answerIteration.decision_ref,
        composer_trigger_iteration: answerIteration.iteration,
      });
      const composerTurnId = response.body?.final_answer_draft?.turn_id;
      expect(response.body?.final_answer_draft?.composer_input_refs).toEqual(
        expect.arrayContaining([
          answerIteration.decision_ref,
          `${composerTurnId}:agent_runtime_loop`,
          `${composerTurnId}:goal_satisfaction_evaluation`,
        ]),
      );
      expect(response.body?.calculator_final_answer_draft?.receipt_refs).toEqual(
        expect.arrayContaining(receipts.map((receipt: any) => receipt.receipt_id)),
      );
      expect(String(response.body?.selected_final_answer ?? "")).toContain("2 m/s^2");
      expect(String(response.body?.selected_final_answer ?? "")).toContain("8 N");
      expect(String(response.body?.selected_final_answer ?? "")).toContain("432 J");
    } finally {
      if (previousFlag === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_LLM;
      else process.env.HELIX_AGENT_STEP_DECISION_LLM = previousFlag;
      if (previousResponse === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = previousResponse;
      if (previousResponseIndex === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = previousResponseIndex;
      if (previousComposerResponse === undefined) delete process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE;
      else process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE = previousComposerResponse;
    }
  }, 60000);

  it("reports explicit goal-aware budget exhaustion with missing calculator requirements", async () => {
    const app = createApp();
    const previousFlag = process.env.HELIX_AGENT_STEP_DECISION_LLM;
    const previousResponse = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
    const previousResponseIndex = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
    const previousMaxToolCalls = process.env.HELIX_AGENT_RUNTIME_LOOP_MAX_TOOL_CALLS;
    process.env.HELIX_AGENT_STEP_DECISION_LLM = "1";
    process.env.HELIX_AGENT_RUNTIME_LOOP_MAX_TOOL_CALLS = "1";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = "0";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = JSON.stringify([
      {
        next_step: "next_action",
        chosen_capability: "scientific-calculator.solve_expression",
        reason: "Compute acceleration first.",
        args: { latex: "(15-3)/6", compound_subgoal_id: "acceleration" },
        expected_artifacts: ["calculator_receipt", "calculator_subgoal_receipt", "calculator_plan_coverage"],
        confidence: 0.97,
      },
      {
        next_step: "next_action",
        chosen_capability: "scientific-calculator.solve_expression",
        reason: "Compute force next, but the runtime budget should stop before executing this second tool call.",
        args: { latex: "4*2", compound_subgoal_id: "force" },
        expected_artifacts: ["calculator_receipt", "calculator_subgoal_receipt", "calculator_plan_coverage"],
        confidence: 0.97,
      },
    ]);

    try {
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question:
            "A 4 kg sled accelerates from 3 m/s to 15 m/s in 6 seconds. Use the scientific calculator to compute acceleration, net force, and the change in kinetic energy.",
          mode: "read",
          debug: true,
          sessionId: `e52-calculator-budget-exhaustion-${Date.now()}`,
        })
        .expect(200);

      expect(response.body?.terminal_artifact_kind).toBe("typed_failure");
      expect(response.body?.terminal_error_code).toBe("agent_loop_budget_exhausted");
      expect(response.body?.agent_runtime_loop).toMatchObject({
        stop_reason: "budget_exhausted",
        budget_exhaustion_reason: "max_tool_calls",
        max_tool_calls: 1,
        executed_tool_call_count: 1,
      });
      expect(response.body?.budget).toMatchObject({
        schema: "helix.agent_loop_budget_debug.v1",
        max_tool_calls: 1,
        used_tool_calls: 1,
        remaining: expect.objectContaining({ tool_calls: 0 }),
        exhausted: true,
        exhaustion_reason: "max_tool_calls",
      });
      expect(response.body?.agent_loop_budget).toMatchObject({
        max_tool_calls: 1,
        used_tool_calls: 1,
        remaining: expect.objectContaining({ tool_calls: 0 }),
        exhausted: true,
      });
      expect(response.body?.budget?.missing_requirement_ids?.length).toBeGreaterThan(0);
      expect(String(response.body?.selected_final_answer ?? "")).toMatch(/budget/i);
      expect(String(response.body?.selected_final_answer ?? "")).toMatch(/Missing requirements/i);
    } finally {
      if (previousFlag === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_LLM;
      else process.env.HELIX_AGENT_STEP_DECISION_LLM = previousFlag;
      if (previousResponse === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = previousResponse;
      if (previousResponseIndex === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = previousResponseIndex;
      if (previousMaxToolCalls === undefined) delete process.env.HELIX_AGENT_RUNTIME_LOOP_MAX_TOOL_CALLS;
      else process.env.HELIX_AGENT_RUNTIME_LOOP_MAX_TOOL_CALLS = previousMaxToolCalls;
    }
  }, 60000);

  it("allows the model to ask for missing arguments before budget exhaustion", async () => {
    const app = createApp();
    const previousFlag = process.env.HELIX_AGENT_STEP_DECISION_LLM;
    const previousResponse = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
    const previousResponseIndex = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
    const previousMaxToolCalls = process.env.HELIX_AGENT_RUNTIME_LOOP_MAX_TOOL_CALLS;
    process.env.HELIX_AGENT_STEP_DECISION_LLM = "1";
    process.env.HELIX_AGENT_RUNTIME_LOOP_MAX_TOOL_CALLS = "1";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = "0";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = JSON.stringify([
      {
        next_step: "ask_user",
        chosen_capability: null,
        reason: "The user asked to open a document but did not identify which document.",
        args: {},
        expected_artifacts: ["request_user_input"],
        confidence: 0.95,
      },
    ]);

    try {
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question: "Open a paper from docs, but I forgot which one.",
          mode: "read",
          debug: true,
          sessionId: `e52-runtime-ask-user-before-budget-${Date.now()}`,
        })
        .expect(200);

      expect(response.body?.agent_runtime_loop).toMatchObject({
        stop_reason: "ask_user",
        executed_tool_call_count: 0,
      });
      expect(response.body?.pending_server_request ?? response.body?.pending_request).toBeTruthy();
      expect(response.body?.budget).toMatchObject({
        max_tool_calls: 1,
        used_tool_calls: 0,
        remaining: expect.objectContaining({ tool_calls: 1 }),
        exhausted: false,
        exhaustion_reason: "none",
      });
      expect(response.body?.terminal_error_code).not.toBe("agent_loop_budget_exhausted");
    } finally {
      if (previousFlag === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_LLM;
      else process.env.HELIX_AGENT_STEP_DECISION_LLM = previousFlag;
      if (previousResponse === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = previousResponse;
      if (previousResponseIndex === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = previousResponseIndex;
      if (previousMaxToolCalls === undefined) delete process.env.HELIX_AGENT_RUNTIME_LOOP_MAX_TOOL_CALLS;
      else process.env.HELIX_AGENT_RUNTIME_LOOP_MAX_TOOL_CALLS = previousMaxToolCalls;
    }
  }, 60000);

  it("uses the generic calculator planner for pendulum period prompts", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "A pendulum is 2 m long. Use the scientific calculator to estimate its small-angle period.",
        mode: "read",
        debug: true,
        sessionId: `e52-calculator-generic-pendulum-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(response.body?.calculator_planner_result?.authority).toBe("deterministic_generic_fallback");
    expect(response.body?.calculator_compound_plan?.subgoals?.map((subgoal: any) => subgoal.id)).toEqual(["pendulum_period"]);
    expect(response.body?.calculator_compound_plan?.subgoals?.[0]).toMatchObject({
      expected_quantity: "time",
      expected_unit: "s",
    });
    expect(String(response.body?.calculator_compound_plan?.subgoals?.[0]?.expression ?? "")).toContain("sqrt(2/9.80665)");
    expect(response.body?.calculator_result_validations?.every((validation: any) => validation.satisfied)).toBe(true);
    expect(response.body?.calculator_loop_integrity?.ok).toBe(true);
    expect(String(response.body?.selected_final_answer ?? "")).toContain("2.837");
  }, 60000);

  it("keeps calculator planner result in debug artifacts and carries de Broglie momentum units", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "A particle has de Broglie wavelength 0.25 nm. Use the scientific calculator to compute its momentum.",
        mode: "read",
        debug: true,
        sessionId: `e52-calculator-debroglie-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(response.body?.calculator_planner_result).toMatchObject({
      schema: "helix.calculator_planner_result.v1",
    });
    expect(response.body?.current_turn_artifact_ledger?.some((artifact: any) =>
      artifact.kind === "calculator_planner_result" &&
      artifact.payload?.schema === "helix.calculator_planner_result.v1"
    )).toBe(true);
    expect(response.body?.calculator_compound_plan?.subgoals?.[0]).toMatchObject({
      id: "de_broglie_momentum",
      expected_quantity: "momentum",
      expected_unit: "kg*m/s",
    });
    expect(response.body?.calculator_subgoal_receipts?.[0]).toMatchObject({
      result_unit: "kg*m/s",
      result_quantity: "momentum",
    });
    expect(response.body?.calculator_subgoal_receipts?.[0]?.calculator_setup).toMatchObject({
      result_dimension_signature: "L M T^-1",
    });
    expect(String(response.body?.selected_final_answer ?? "")).toContain("kg*m/s");
  }, 60000);

  it("accepts model-authored calculator planner subgoals as the calculator authority", async () => {
    const previousFlag = process.env.HELIX_AGENT_STEP_DECISION_LLM;
    const previousAgentResponse = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
    const previousAgentIndex = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
    const previousCalculatorResponse = process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE;
    process.env.HELIX_AGENT_STEP_DECISION_LLM = "1";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = "0";
    process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE = JSON.stringify({
      subgoals: [
        {
          id: "gravitational_potential_energy",
          label: "Compute gravitational potential energy",
          expression: "5*9.80665*10",
          expected_quantity: "energy",
          expected_unit: "J",
          equation: "U = m g h",
          assumptions: ["Use standard gravity."],
          variables: [
            { symbol: "m", value: "5", unit: "kg", meaning: "mass" },
            { symbol: "g", value: "9.80665", unit: null, meaning: "standard gravity numeric value" },
            { symbol: "h", value: "10", unit: "m", meaning: "height" },
          ],
        },
      ],
    });
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = JSON.stringify([
      {
        next_step: "next_action",
        chosen_capability: "scientific-calculator.solve_expression",
        reason: "The model-authored calculator plan has one required numeric subgoal.",
        args: { latex: "5*9.80665*10", compound_subgoal_id: "gravitational_potential_energy" },
        expected_artifacts: ["calculator_receipt", "workstation_tool_evaluation"],
        commentary: {
          turn_purpose: "Compute the requested gravitational potential energy.",
          why_this_capability: "The calculator can evaluate the numeric expression.",
          expected_artifacts: "calculator receipt",
          what_would_make_this_done: "A validated numeric energy result.",
          observation_summary: "No calculator observation yet.",
          next_step_reason: "Run the calculator subgoal.",
        },
        confidence: 0.95,
      },
      {
        next_step: "answer",
        chosen_capability: null,
        reason: "The calculator receipt satisfies the requested numeric result.",
        args: {},
        expected_artifacts: ["workstation_tool_evaluation"],
        commentary: {
          turn_purpose: "Answer from the calculator receipt.",
          why_this_capability: "No more tool call is needed.",
          expected_artifacts: "workstation evaluation",
          what_would_make_this_done: "The receipt-backed result is present.",
          observation_summary: "The calculator result is available.",
          next_step_reason: "Answer now.",
        },
        confidence: 0.96,
      },
    ]);
    try {
      const app = createApp();
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question: "A 5 kg mass is lifted 10 m. Use the scientific calculator to compute gravitational potential energy.",
          mode: "read",
          debug: true,
          sessionId: `e52-calculator-model-planner-${Date.now()}`,
        })
        .expect(200);

      expect(response.body?.calculator_planner_result?.authority).toBe("model_authored_calculator_planner");
      expect(response.body?.current_turn_artifact_ledger?.some((artifact: any) =>
        artifact.kind === "calculator_planner_result" &&
        artifact.payload?.authority === "model_authored_calculator_planner"
      )).toBe(true);
      expect(response.body?.calculator_compound_plan?.subgoals?.[0]).toMatchObject({
        id: "gravitational_potential_energy",
        expression: "5*9.80665*10",
        expected_quantity: "energy",
        expected_unit: "J",
      });
      expect(response.body?.agent_calculator_subgoal_plan?.model_authored).toBe(true);
      expect(response.body?.calculator_loop_integrity?.violations).toEqual([]);
      expect(response.body?.calculator_loop_integrity?.violations).toEqual([]);
      expect(response.body?.calculator_loop_integrity?.ok).toBe(true);
      expect(String(response.body?.selected_final_answer ?? "")).toContain("490.3325 J");
    } finally {
      if (previousFlag === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_LLM;
      else process.env.HELIX_AGENT_STEP_DECISION_LLM = previousFlag;
      if (previousAgentResponse === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = previousAgentResponse;
      if (previousAgentIndex === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = previousAgentIndex;
      if (previousCalculatorResponse === undefined) delete process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE;
      else process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE = previousCalculatorResponse;
    }
  }, 60000);

  it("does not mark long calculator prompts satisfied when planner fallback under-covers requirements", async () => {
    const previousFlag = process.env.HELIX_AGENT_STEP_DECISION_LLM;
    const previousAgentResponse = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
    const previousAgentIndex = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
    const previousCalculatorResponse = process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE;
    const previousRepairResponse = process.env.HELIX_CALCULATOR_PLANNER_REPAIR_TEST_RESPONSE;
    process.env.HELIX_AGENT_STEP_DECISION_LLM = "1";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = "0";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = JSON.stringify([
      {
        next_step: "next_action",
        chosen_capability: "scientific-calculator.solve_expression",
        reason: "Execute the repaired calculator subgoal.",
        args: { latex: "0.5*0.5*12^2", compound_subgoal_id: "initial_kinetic_energy" },
        expected_artifacts: ["calculator_receipt", "workstation_tool_evaluation"],
        confidence: 0.95,
      },
      {
        next_step: "answer",
        chosen_capability: null,
        reason: "Stop after the observed repaired subgoal; coverage will decide whether this is sufficient.",
        args: {},
        expected_artifacts: ["workstation_tool_evaluation"],
        confidence: 0.9,
      },
    ]);
    process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE = "not valid json";
    process.env.HELIX_CALCULATOR_PLANNER_REPAIR_TEST_RESPONSE = JSON.stringify({
      subgoals: [
        {
          id: "initial_kinetic_energy",
          label: "Compute initial kinetic energy only",
          expression: "0.5*0.5*12^2",
          expected_quantity: "energy",
          expected_unit: "J",
          equation: "KE = 1/2 m v^2",
        },
      ],
    });
    try {
      const app = createApp();
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question: "Use the scientific calculator as a workstation tool and answer every part. A 0.50 kg cart rolls at 12 m/s on a level track, then climbs a ramp. First compute its initial kinetic energy. Second compute the maximum height it could reach if all kinetic energy became gravitational potential energy using g = 9.80665 m/s^2. Third compute the speed it would have after reaching a height of 3.0 m, assuming no drag and no rolling losses. Fourth compare the initial kinetic energy to the remaining kinetic energy at 3.0 m. In the final answer, show the formulas, the calculator expressions, the numeric results with units, and a short interpretation of what the energy conversion means.",
          mode: "read",
          debug: true,
          sessionId: `e52-calculator-long-undercovered-${Date.now()}`,
        })
        .expect(200);

      expect(response.body?.calculator_planner_result?.authority).toBe("model_repaired_calculator_planner");
      expect(response.body?.calculator_planner_repair_result).toMatchObject({
        schema: "helix.calculator_planner_repair_result.v1",
        attempted: true,
        repaired: true,
      });
      expect(response.body?.calculator_plan_coverage?.coverage).not.toBe("complete");
      expect(response.body?.calculator_plan_coverage?.missing_requirement_ids).toEqual(
        expect.arrayContaining(["maximum_height", "speed_after_height", "energy_comparison"]),
      );
      expect(response.body?.goal_satisfaction_evaluation?.satisfaction).toBe("not_satisfied");
      expect(response.body?.final_status).toBe("final_failure");
      expect(response.body?.current_turn_artifact_ledger?.some((artifact: any) =>
        artifact.kind === "typed_failure" &&
        artifact.payload?.error_code === "calculator_requirement_coverage_incomplete"
      )).toBe(true);
    } finally {
      if (previousFlag === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_LLM;
      else process.env.HELIX_AGENT_STEP_DECISION_LLM = previousFlag;
      if (previousAgentResponse === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = previousAgentResponse;
      if (previousAgentIndex === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = previousAgentIndex;
      if (previousCalculatorResponse === undefined) delete process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE;
      else process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE = previousCalculatorResponse;
      if (previousRepairResponse === undefined) delete process.env.HELIX_CALCULATOR_PLANNER_REPAIR_TEST_RESPONSE;
      else process.env.HELIX_CALCULATOR_PLANNER_REPAIR_TEST_RESPONSE = previousRepairResponse;
    }
  }, 60000);

  it("uses receipt coverage and a post-observation composer for long calculator prompts", async () => {
    const previousFlag = process.env.HELIX_AGENT_STEP_DECISION_LLM;
    const previousAgentResponse = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
    const previousAgentIndex = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
    const previousCalculatorResponse = process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE;
    const previousRepairResponse = process.env.HELIX_CALCULATOR_PLANNER_REPAIR_TEST_RESPONSE;
    const previousFinalAnswer = process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE;
    process.env.HELIX_AGENT_STEP_DECISION_LLM = "1";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = "0";
    process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE = "not valid json";
    process.env.HELIX_CALCULATOR_PLANNER_REPAIR_TEST_RESPONSE = JSON.stringify({
      subgoals: [
        {
          id: "initial_kinetic_energy",
          label: "Compute initial kinetic energy",
          expression: "0.5*0.5*12^2",
          expected_quantity: "energy",
          expected_unit: "J",
          equation: "KE = 1/2 m v^2",
        },
        {
          id: "maximum_height",
          label: "Compute maximum height from initial kinetic energy",
          expression: "36/(0.5*9.80665)",
          expected_quantity: "length",
          expected_unit: "m",
          equation: "h = KE / (m g)",
        },
        {
          id: "remaining_kinetic_energy",
          label: "Compute remaining kinetic energy at 3 m",
          expression: "36-(0.5*9.80665*3)",
          expected_quantity: "energy",
          expected_unit: "J",
          equation: "KE_remaining = KE_initial - m g h",
        },
        {
          id: "speed_after_height",
          label: "Compute speed at 3 m from remaining kinetic energy",
          expression: "sqrt(2*21.290025/0.5)",
          expected_quantity: "speed",
          expected_unit: "m/s",
          equation: "v = sqrt(2 KE_remaining / m)",
        },
        {
          id: "energy_comparison",
          label: "Compare remaining kinetic energy to initial kinetic energy",
          expression: "21.290025/36",
          expected_quantity: "dimensionless",
          expected_unit: null,
          equation: "ratio = KE_remaining / KE_initial",
        },
      ],
  });

    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = JSON.stringify([
      {
        next_step: "next_action",
        chosen_capability: "scientific-calculator.solve_expression",
        reason: "Compute the first requested numeric subgoal.",
        args: { latex: "0.5*0.5*12^2", compound_subgoal_id: "initial_kinetic_energy" },
        expected_artifacts: ["calculator_receipt", "workstation_tool_evaluation"],
        confidence: 0.95,
      },
      {
        next_step: "next_action",
        chosen_capability: "scientific-calculator.solve_expression",
        reason: "Compute the next requested numeric subgoal.",
        args: { latex: "36/(0.5*9.80665)", compound_subgoal_id: "maximum_height" },
        expected_artifacts: ["calculator_receipt", "workstation_tool_evaluation"],
        confidence: 0.95,
      },
      {
        next_step: "next_action",
        chosen_capability: "scientific-calculator.solve_expression",
        reason: "Compute the remaining kinetic energy subgoal.",
        args: { latex: "36-(0.5*9.80665*3)", compound_subgoal_id: "remaining_kinetic_energy" },
        expected_artifacts: ["calculator_receipt", "workstation_tool_evaluation"],
        confidence: 0.95,
      },
      {
        next_step: "next_action",
        chosen_capability: "scientific-calculator.solve_expression",
        reason: "Compute the speed subgoal.",
        args: { latex: "sqrt(2*21.290025/0.5)", compound_subgoal_id: "speed_after_height" },
        expected_artifacts: ["calculator_receipt", "workstation_tool_evaluation"],
        confidence: 0.95,
      },
      {
        next_step: "next_action",
        chosen_capability: "scientific-calculator.solve_expression",
        reason: "Compute the comparison subgoal.",
        args: { latex: "21.290025/36", compound_subgoal_id: "energy_comparison" },
        expected_artifacts: ["calculator_receipt", "workstation_tool_evaluation"],
        confidence: 0.95,
      },
      {
        next_step: "answer",
        chosen_capability: null,
        reason: "The final decision should answer after coverage is complete.",
        args: {},
        expected_artifacts: ["workstation_tool_evaluation"],
        confidence: 0.96,
      },
    ]);
    process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE = [
      "Initial kinetic energy: Formula KE = 1/2 m v^2. Calculator expression 0.5*0.5*12^2. Result: 36 J.",
      "Maximum height: Formula h = KE / (m g). Calculator expression 36/(0.5*9.80665). Result: 7.34195673344 m.",
      "Remaining kinetic energy at 3.0 m: Formula KE_remaining = KE_initial - m g h. Calculator expression 36-(0.5*9.80665*3). Result: 21.290025 J.",
      "Speed at 3.0 m: Formula v = sqrt(2 KE_remaining / m). Calculator expression sqrt(2*21.290025/0.5). Result: 9.22822301421 m/s.",
      "Energy comparison: Calculator expression 21.290025/36. Result: 0.591389583333, so about 59.1% of the initial kinetic energy remains.",
      "Interpretation: the cart trades kinetic energy for gravitational potential energy as it climbs; at 3.0 m it has less kinetic energy and therefore a lower speed.",
    ].join("\n");
    try {
      const app = createApp();
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question: "Use the scientific calculator as a workstation tool and answer every part. A 0.50 kg cart rolls at 12 m/s on a level track, then climbs a ramp. First compute its initial kinetic energy. Second compute the maximum height it could reach if all kinetic energy became gravitational potential energy using g = 9.80665 m/s^2. Third compute the speed it would have after reaching a height of 3.0 m, assuming no drag and no rolling losses. Fourth compare the initial kinetic energy to the remaining kinetic energy at 3.0 m. In the final answer, show the formulas, the calculator expressions, the numeric results with units, and a short interpretation of what the energy conversion means.",
          mode: "read",
          debug: true,
          sessionId: `e52-calculator-long-covered-${Date.now()}`,
        })
        .expect(200);

      expect(response.body?.calculator_planner_result?.authority).toBe("model_repaired_calculator_planner");
      expect(response.body?.calculator_planner_repair_result).toMatchObject({
        schema: "helix.calculator_planner_repair_result.v1",
        attempted: true,
        repaired: true,
        proposed_subgoal_count: 5,
      });
      expect(response.body?.calculator_problem_requirements?.requirements?.map((requirement: any) => requirement.id)).toEqual(
        expect.arrayContaining(["initial_kinetic_energy", "maximum_height", "speed_after_height", "energy_comparison"]),
      );
      expect(response.body?.calculator_plan_coverage).toMatchObject({
        schema: "helix.calculator_plan_coverage.v1",
        coverage: "complete",
        missing_requirement_ids: [],
      });
      expect(response.body?.agent_loop_budget).toMatchObject({
        schema: "helix.agent_loop_budget.v1",
        profile: "calculator_compound",
        max_tool_calls: 8,
        exhausted: false,
      });
      expect(response.body?.agent_loop_budget?.consumed_tool_calls).toBeGreaterThanOrEqual(1);
      expect(response.body?.final_answer_draft).toMatchObject({
        schema: "helix.final_answer_draft.v1",
        authority: "llm_post_observation_composer",
        composer_scope: "source_tool_backed",
        unsupported_claim_guard: {
          source_targeted: true,
          policy: "selected_artifacts_only",
        },
      });
      expect(response.body?.calculator_final_answer_draft).toMatchObject({
        schema: "helix.calculator_final_answer_draft.v1",
        authority: "llm_post_observation_composer",
        composer_schema: "helix.final_answer_draft.v1",
      });
      expect(response.body?.calculator_loop_integrity?.ok).toBe(true);
      expect(response.body?.goal_satisfaction_evaluation?.satisfaction).toBe("satisfied");
      expect(response.body?.final_status).toBe("final_answer");
      expect(String(response.body?.selected_final_answer ?? "")).toContain("Initial kinetic energy");
      expect(String(response.body?.selected_final_answer ?? "")).toContain("Maximum height");
      expect(String(response.body?.selected_final_answer ?? "")).toContain("9.22822301421 m/s");
      expect(String(response.body?.selected_final_answer ?? "")).toContain("Interpretation");
    } finally {
      if (previousFlag === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_LLM;
      else process.env.HELIX_AGENT_STEP_DECISION_LLM = previousFlag;
      if (previousAgentResponse === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = previousAgentResponse;
      if (previousAgentIndex === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = previousAgentIndex;
      if (previousCalculatorResponse === undefined) delete process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE;
      else process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE = previousCalculatorResponse;
      if (previousRepairResponse === undefined) delete process.env.HELIX_CALCULATOR_PLANNER_REPAIR_TEST_RESPONSE;
      else process.env.HELIX_CALCULATOR_PLANNER_REPAIR_TEST_RESPONSE = previousRepairResponse;
      if (previousFinalAnswer === undefined) delete process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE;
      else process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE = previousFinalAnswer;
    }
  }, 60000);

  it("does not treat input speed as a requested speed-after-height output", async () => {
    const previousFlag = process.env.HELIX_AGENT_STEP_DECISION_LLM;
    const previousPlannerResponse = process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE;
    const previousFinalAnswer = process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE;
    const previousAgentResponse = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
    const previousAgentIndex = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
    process.env.HELIX_AGENT_STEP_DECISION_LLM = "1";
    process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE = JSON.stringify({
      subgoals: [
        {
          id: "compute_initial_kinetic_energy",
          label: "Compute initial kinetic energy",
          expression: "0.5*2*15^2",
          expected_quantity: "energy",
          expected_unit: "J",
          equation: "KE = 0.5*m*v^2",
          variables: [
            { symbol: "m", value: "2", unit: "kg", meaning: "mass" },
            { symbol: "v", value: "15", unit: "m/s", meaning: "speed" },
          ],
        },
        {
          id: "compute_maximum_height",
          label: "Compute maximum height",
          expression: "0.5*2*15^2/(2*9.80665)",
          expected_quantity: "length",
          expected_unit: "m",
          equation: "h = KE/(m*g)",
          depends_on: ["compute_initial_kinetic_energy"],
          variables: [
            { symbol: "m", value: "2", unit: "kg", meaning: "mass" },
            { symbol: "g", value: "9.80665", unit: "m/s^2", meaning: "gravity" },
          ],
        },
      ],
    });
    process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE = [
      "Initial kinetic energy: 225 J.",
      "Maximum height: 11.471807396001692729 m.",
    ].join("\n");
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = JSON.stringify([
      {
        next_step: "next_action",
        chosen_capability: "scientific-calculator.solve_expression",
        reason: "Compute kinetic energy.",
        args: { latex: "0.5*2*15^2", compound_subgoal_id: "compute_initial_kinetic_energy" },
      },
      {
        next_step: "next_action",
        chosen_capability: "scientific-calculator.solve_expression",
        reason: "Compute maximum height from the energy conversion.",
        args: { latex: "0.5*2*15^2/(2*9.80665)", compound_subgoal_id: "compute_maximum_height" },
      },
      {
        next_step: "answer",
        chosen_capability: "scientific-calculator.solve_expression",
        reason: "Both requested calculator results are receipt-backed.",
      },
    ]);
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = "0";

    try {
      const app = createApp();
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question:
            "Use the scientific calculator to compute kinetic energy for mass 2 kg and speed 15 m per s then compute maximum height with g 9.80665.",
          mode: "read",
          debug: true,
          sessionId: `e52-calculator-input-speed-${Date.now()}`,
        })
        .expect(200);

      const requirementIds = response.body?.calculator_problem_requirements?.requirements?.map((requirement: any) => requirement.id) ?? [];
      expect(requirementIds).toEqual(expect.arrayContaining(["initial_kinetic_energy", "maximum_height"]));
      expect(requirementIds).not.toContain("speed_after_height");
      expect(response.body?.calculator_plan_coverage).toMatchObject({
        coverage: "complete",
        missing_requirement_ids: [],
      });
      expect(response.body?.goal_satisfaction_evaluation?.satisfaction).toBe("satisfied");
      expect(response.body?.final_answer_source).toBe("workstation_tool_evaluation");
    } finally {
      if (previousFlag === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_LLM;
      else process.env.HELIX_AGENT_STEP_DECISION_LLM = previousFlag;
      if (previousPlannerResponse === undefined) delete process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE;
      else process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE = previousPlannerResponse;
      if (previousFinalAnswer === undefined) delete process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE;
      else process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE = previousFinalAnswer;
      if (previousAgentResponse === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = previousAgentResponse;
      if (previousAgentIndex === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = previousAgentIndex;
    }
  }, 60000);

  it("allows rounded calculator final answers when numbers are receipt-backed", async () => {
    const previousFlag = process.env.HELIX_AGENT_STEP_DECISION_LLM;
    const previousPlannerResponse = process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE;
    const previousFinalAnswer = process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE;
    const previousAgentResponse = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
    const previousAgentIndex = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
    process.env.HELIX_AGENT_STEP_DECISION_LLM = "1";
    process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE = JSON.stringify({
      subgoals: [
        {
          id: "compute_kinetic_energy",
          label: "Compute kinetic energy",
          expression: "0.5*0.2*18^2",
          expected_quantity: "energy",
          expected_unit: "J",
          equation: "KE = 0.5*m*v^2",
          variables: [
            { symbol: "m", value: "0.2", unit: "kg", meaning: "mass" },
            { symbol: "v", value: "18", unit: "m/s", meaning: "speed" },
          ],
        },
        {
          id: "compute_max_height",
          label: "Compute max height",
          expression: "0.5*0.2*18^2/(0.2*9.80665)",
          expected_quantity: "length",
          expected_unit: "m",
          equation: "h = KE/(m*g)",
          depends_on: ["compute_kinetic_energy"],
          variables: [
            { symbol: "m", value: "0.2", unit: "kg", meaning: "mass" },
            { symbol: "g", value: "9.80665", unit: "m/s^2", meaning: "gravity" },
          ],
        },
      ],
    });
    process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE = [
      "Formula: KE = 0.5*m*v^2. Calculator expression: 0.5*0.2*18^2. Kinetic energy result: 32.4 J.",
      "Formula: h = KE/(m*g). Calculator expression: 0.5*0.2*18^2/(0.2*9.80665). Maximum height result: 16.52 m.",
      "Units: J for kinetic energy and m for height.",
    ].join("\n");
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = JSON.stringify([
      {
        next_step: "next_action",
        chosen_capability: "scientific-calculator.solve_expression",
        reason: "Compute the kinetic-energy subgoal with the calculator.",
        args: { latex: "0.5*0.2*18^2", compound_subgoal_id: "compute_kinetic_energy" },
      },
      {
        next_step: "next_action",
        chosen_capability: "scientific-calculator.solve_expression",
        reason: "Compute the maximum-height subgoal with the calculator.",
        args: { latex: "0.5*0.2*18^2/(0.2*9.80665)", compound_subgoal_id: "compute_max_height" },
      },
      {
        next_step: "answer",
        chosen_capability: "scientific-calculator.solve_expression",
        reason: "All calculator receipts are observed and the final answer can be composed.",
      },
    ]);
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = "0";

    try {
      const app = createApp();
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question:
            "Use scientific calculator. A 0.20 kg ball moves at 18 m/s. Compute kinetic energy and max height if all kinetic energy becomes mgh. Show formulas expressions results units.",
          mode: "read",
          debug: true,
          sessionId: `e52-calculator-rounded-${Date.now()}`,
        })
        .expect(200);

      expect(response.body?.calculator_loop_integrity?.violations).toEqual([]);
      expect(response.body?.calculator_loop_integrity?.ok).toBe(true);
      expect(response.body?.final_answer_source).toBe("workstation_tool_evaluation");
      expect(response.body?.selected_final_answer ?? response.body?.answer).toContain("16.52 m");
    } finally {
      if (previousFlag === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_LLM;
      else process.env.HELIX_AGENT_STEP_DECISION_LLM = previousFlag;
      if (previousPlannerResponse === undefined) delete process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE;
      else process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE = previousPlannerResponse;
      if (previousFinalAnswer === undefined) delete process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE;
      else process.env.HELIX_CALCULATOR_FINAL_ANSWER_TEST_RESPONSE = previousFinalAnswer;
      if (previousAgentResponse === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = previousAgentResponse;
      if (previousAgentIndex === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = previousAgentIndex;
    }
  }, 60000);

  it("routes calculator live-source prompts through the workstation tool loop", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Start the calculator as a live source for 3*x+9=0 and explain the first tick.",
        mode: "read",
        debug: true,
        sessionId: `e52-calculator-live-source-${Date.now()}`,
      })
      .expect(200);

    const action = findAction(response.body, "scientific-calculator", "start_equation_live_source");
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("calculator_live_source");
    expect(response.body?.canonical_goal_frame?.required_terminal_kind).toBe("workstation_tool_evaluation");
    expect(action).toBeTruthy();
    expect(action?.args?.latex).toBe("3*x+9=0");
    expect(action?.args?.equation).toBe("3*x+9=0");
    expect(["calculator_live_source", "dispatch:observe"]).toContain(response.body?.route_reason_code);
    expect(["workstation_tool_evaluation", "typed_failure"]).toContain(response.body?.final_answer_source);
    expect(["workstation_tool_evaluation", "typed_failure"]).toContain(response.body?.terminal_artifact_kind);
    expect(["calculator_stream", "live_pipeline"]).toContain(response.body?.source_target_intent?.target_source);
    expect(["satisfied", "not_satisfied"]).toContain(readGoalSatisfaction(response.body)?.satisfaction);
    expect(String(response.body?.selected_final_answer ?? "")).not.toMatch(/live answer environment|capability_lifecycle_incomplete/i);
  }, 60000);

  it("keeps note creation in the workstation tool loop even when note body mentions reasoning policy", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "Create a workstation note titled Tool Loop Test with body Calculator tools should inform the answer without hijacking general reasoning.",
        mode: "read",
        debug: true,
        sessionId: `e52-note-tool-loop-${Date.now()}`,
      })
      .expect(200);

    const action = findAction(response.body, "workstation-notes", "create_note");
    expect(action).toBeTruthy();
    expect(action?.args?.title).toBe("Tool Loop Test");
    expect(response.body?.available_capabilities?.recommended_capability_key).toBe("workstation-notes.create_note");
    expect(response.body?.agent_step_decision?.candidate_capabilities).toContain("workstation-notes.create_note");
    expect(response.body?.agent_step_decision?.chosen_capability).toBe("workstation-notes.create_note");
    expect(response.body?.final_answer_source).not.toBe("typed_failure");
    expect(response.body?.terminal_error_code ?? null).toBeNull();
    expect(response.body?.terminal_artifact_kind).toBe("note_update_receipt");
    expect(response.body?.notes_mutation_coverage).toMatchObject({
      schema: "helix.notes_mutation_coverage.v1",
      goal_kind: "note_mutation",
      coverage: "complete",
      next_decision: "allow_terminal",
    });
    expect(response.body?.poison_audit?.ok).toBe(true);
    expect(response.body?.poison_audit?.violations ?? []).toEqual([]);
  }, 60000);

  it("admits explicit narrator debug probe commands as governed workstation actions", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          'Run workstation action panel_id=narrator action_id=narrator.debug_auto_speak_probe with args text="Narrator debug probe from Helix Ask" trace_id="narrator:ask-probe".',
        mode: "read",
        debug: true,
        sessionId: `e52-narrator-probe-${Date.now()}`,
      })
      .expect(200);

    const action = findAction(response.body, "narrator", "narrator.debug_auto_speak_probe");
    expect(action).toBeTruthy();
    expect(action?.args).toMatchObject({
      text: "Narrator debug probe from Helix Ask",
      trace_id: "narrator:ask-probe",
      source: "helix_ask",
    });
    expect(response.body?.canonical_goal_frame).toMatchObject({
      goal_kind: "panel_control",
      required_terminal_kind: "workstation_tool_evaluation",
    });
    expect(response.body?.available_capabilities?.recommended_capability_key).toBe(
      "narrator.narrator.debug_auto_speak_probe",
    );
    expect(response.body?.action_envelope?.schema).toBe("helix.ask.action_envelope.v1");
    expect(actionsOf(response.body).map((entry) => `${entry.panel_id}.${entry.action_id}`)).toEqual(
      expect.arrayContaining(["narrator.open", "narrator.narrator.debug_auto_speak_probe"]),
    );
    expect(response.body?.final_answer_source).not.toBe("typed_failure");
    expect(response.body?.terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(response.body?.goal_satisfaction_evaluation).toMatchObject({
      satisfaction: "satisfied",
      canonical_goal_kind: "panel_control",
      required_terminal_kind: "workstation_tool_evaluation",
    });
  }, 60000);

  it("admits explicit Auntie Dottie observer commands as Situation Room workstation actions", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: [
          "Operator command: run panel action situation-room-pipelines.observer.attach",
          "target_run_id run:ask:dottie-ui-smoke observer_profile auntie_dottie voice_mode text_only max_chars 120.",
          "Then run panel action situation-room-pipelines.voice_delivery.propose_from_trace",
          "source_event_id agent_commentary:orientation source text: I am checking the public commentary path.",
          "Then run panel action situation-room-pipelines.observer.query for target_run_id run:ask:dottie-ui-smoke.",
        ].join(" "),
        mode: "read",
        debug: true,
        sessionId: `e52-dottie-observer-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("panel_control");
    expect(response.body?.canonical_goal_frame?.required_terminal_kind).toBe("workstation_tool_evaluation");
    expect(response.body?.canonical_goal_frame?.classifier_reasons).toContain("workstation_tool_plan:dottie_observer");
    expect(findAction(response.body, "situation-room-pipelines", "observer.attach")).toBeTruthy();
    expect(findAction(response.body, "situation-room-pipelines", "voice_delivery.propose_from_trace")).toBeTruthy();
    expect(findAction(response.body, "situation-room-pipelines", "observer.query")).toBeTruthy();
    expect(response.body?.available_capabilities?.model_visible_capability_keys).toEqual(expect.arrayContaining([
      "situation-room-pipelines.observer.attach",
      "situation-room-pipelines.observer.query",
      "situation-room-pipelines.voice_delivery.propose_from_trace",
    ]));
    expect(response.body?.available_capabilities?.recommended_capability_key).not.toBe("docs-viewer.open");
    expect(response.body?.agent_step_decision?.candidate_capabilities ?? []).not.toContain("docs-viewer.open");
    expect(response.body?.agent_step_decision?.chosen_capability).not.toBe("docs-viewer.open");
    expect(response.body?.terminal_error_code ?? null).not.toBe("open_doc_unresolved");
    expect(response.body?.final_answer_source).not.toBe("typed_failure");
    expect(response.body?.terminal_artifact_kind).not.toBe("typed_failure");
    expect(response.body?.goal_satisfaction_evaluation).toMatchObject({
      satisfaction: "satisfied",
      next_decision: "allow_terminal",
      canonical_goal_kind: "panel_control",
      required_terminal_kind: "workstation_tool_evaluation",
    });
    expect(String(response.body?.selected_final_answer ?? response.body?.answer ?? "")).not.toMatch(/temporal comparison/i);
  }, 60000);

  it("routes explicit interim voice callout requests to the live-env voice tool instead of docs or debug", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: [
          "With the voice lane active, use the interim voice callout tool to queue a short provisional callout saying",
          "\"I am checking this now\", then continue the normal Helix Ask answer.",
          "In the final answer, say whether the callout receipt was evidence-only.",
        ].join(" "),
        mode: "read",
        debug: true,
        sessionId: `e52-interim-voice-callout-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("live_environment_review");
    expect(response.body?.canonical_goal_frame?.classifier_reasons ?? []).toContain("voice_output_tool_arbitration");
    expect(response.body?.available_capabilities?.recommended_capability_key).toBe("live_env.request_interim_voice_callout");
    expect(response.body?.available_capabilities?.model_visible_capability_keys).toContain("live_env.request_interim_voice_callout");
    expect(response.body?.agent_step_decision?.candidate_capabilities ?? []).toContain("live_env.request_interim_voice_callout");
    expect(response.body?.agent_step_decision?.chosen_capability).not.toBe("docs-viewer.open");
    expect(response.body?.available_capabilities?.recommended_capability_key).not.toBe("docs-viewer.open");
  }, 60000);

  it("routes natural voice-lane say commands to the live-env voice tool", async () => {
    const app = createApp();
    for (const { question, expectedText, reasonCode } of [
      {
        question: 'Use the voice lane to say "checking now", then give me three practical rules for when Helix Ask should speak during reasoning.',
        expectedText: "checking now",
        reasonCode: "quoted_callout_text",
      },
      {
        question: 'Say "I will check the boundary" out loud, then explain why a playback receipt can support an answer but cannot authorize one.',
        expectedText: "I will check the boundary",
        reasonCode: "quoted_callout_text",
      },
      {
        question: "Use the voice lane to say browser voice ok then explain voice receipts are evidence only.",
        expectedText: "browser voice ok",
        reasonCode: "unquoted_callout_text",
      },
      {
        question: "Say browser boundary ok out loud, then explain why a playback receipt can support an answer but cannot authorize one.",
        expectedText: "browser boundary ok",
        reasonCode: "unquoted_callout_text",
      },
    ]) {
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question,
          mode: "read",
          debug: true,
          sessionId: `e52-natural-voice-callout-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        })
        .expect(200);

      expect(response.body?.canonical_goal_frame?.goal_kind).toBe("live_environment_review");
      expect(response.body?.canonical_goal_frame?.classifier_reasons ?? []).toContain("voice_output_tool_arbitration");
      expect(response.body?.canonical_goal_frame?.classifier_reasons ?? []).toContain("voice_output_interim_callout_intent");
      expect(response.body?.canonical_goal_frame?.classifier_reasons ?? []).toContain(reasonCode);
      expect(response.body?.available_capabilities?.recommended_capability_key).toBe("live_env.request_interim_voice_callout");
      expect(response.body?.available_capabilities?.model_visible_capability_keys).toContain("live_env.request_interim_voice_callout");
      expect(response.body?.agent_step_decision?.candidate_capabilities ?? []).toContain("live_env.request_interim_voice_callout");
      expect(response.body?.available_capabilities?.recommended_capability_key).not.toBe("repo-code.search_concept");
      const ledger = Array.isArray(response.body?.current_turn_artifact_ledger)
        ? response.body.current_turn_artifact_ledger
        : [];
      const runtimeVoiceCall = ledger.find((artifact: any) =>
        artifact?.kind === "runtime_tool_call" &&
        artifact?.payload?.capability_key === "live_env.request_interim_voice_callout"
      );
      const voiceObservation = ledger.find((artifact: any) =>
        artifact?.kind === "live_environment_tool_observation" &&
        artifact?.payload?.tool_name === "live_env.request_interim_voice_callout"
      );
      const voiceReceipt = voiceObservation?.payload?.observation?.receipt;
      expect(runtimeVoiceCall).toBeTruthy();
      expect(runtimeVoiceCall?.payload?.args?.text).toBe(expectedText);
      expect(voiceObservation).toBeTruthy();
      expect(voiceObservation?.payload?.assistant_answer).toBe(false);
      expect(voiceObservation?.payload?.observation?.assistant_answer).toBe(false);
      expect(voiceObservation?.payload?.observation?.terminal_eligible).toBe(false);
      expect(voiceReceipt?.assistant_answer).toBe(false);
      expect(voiceReceipt?.terminal_eligible).toBe(false);
      expect(response.body?.final_answer_source).toBe("final_answer_draft");
      expect(response.body?.terminal_artifact_kind).toBe("model_synthesized_answer");
      expect(response.body?.terminal_error_code ?? null).not.toBe("terminal_consistency_violation");
      expect(response.body?.final_answer_draft?.llm_error_code ?? null).not.toBe("interim_voice_callout_status_observed");
      const finalAnswer = String(response.body?.selected_final_answer ?? response.body?.answer ?? "");
      expect(finalAnswer).toMatch(/evidence-only|receipt|voice|speak|reasoning|authority|observation/i);
    }
  }, 60000);

  it("keeps voice-lane callouts as side effects while answering the separate content goal", async () => {
    const previousRuntimeFinalAnswer = process.env.HELIX_RUNTIME_FINAL_ANSWER_TEST_RESPONSE;
    process.env.HELIX_RUNTIME_FINAL_ANSWER_TEST_RESPONSE = [
      "Resistance is steady opposition to current in a DC or low-frequency circuit and it dissipates energy as heat.",
      "Impedance is the broader AC quantity: it includes resistance plus frequency-dependent reactance from capacitance and inductance, so it affects both magnitude and phase.",
      "Superconductivity is different again because below its critical conditions a material can carry current with effectively zero DC resistance, though practical circuits still have limits from magnetic fields, current density, geometry, and AC losses.",
    ].join(" ");
    const app = createApp();
    try {
      for (const { question, expectedText } of [
        {
          question:
            "Use the voice lane to say checking the comparison then explain the difference between resistance impedance and superconductivity in practical circuit terms. The final answer should focus on the circuit concepts.",
          expectedText: "checking the comparison",
        },
        {
          question:
            "Use the voice lane to say checking now. Do not make the final answer about the voice tool. Explain impedance in practical circuit terms.",
          expectedText: "checking now",
        },
      ]) {
        const response = await request(app)
          .post("/api/agi/ask/turn")
          .send({
            question,
            mode: "read",
            debug: true,
            sessionId: `e52-voice-side-effect-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          })
          .expect(200);

        expect(response.body?.canonical_goal_frame?.goal_kind).toBe("live_environment_review");
        expect(response.body?.canonical_goal_frame?.classifier_reasons ?? []).toEqual(expect.arrayContaining([
          "voice_output_tool_arbitration",
          "voice_output_interim_callout_intent",
          "compound_voice_side_effect",
          "content_goal_preserved",
        ]));
        const ledger = Array.isArray(response.body?.current_turn_artifact_ledger)
          ? response.body.current_turn_artifact_ledger
          : [];
        const runtimeVoiceCall = ledger.find((artifact: any) =>
          artifact?.kind === "runtime_tool_call" &&
          artifact?.payload?.capability_key === "live_env.request_interim_voice_callout"
        );
        const voiceObservation = ledger.find((artifact: any) =>
          artifact?.kind === "live_environment_tool_observation" &&
          artifact?.payload?.tool_name === "live_env.request_interim_voice_callout"
        );
        expect(runtimeVoiceCall).toBeTruthy();
        expect(runtimeVoiceCall?.payload?.args?.text).toBe(expectedText);
        expect(voiceObservation?.payload?.assistant_answer).toBe(false);
        expect(voiceObservation?.payload?.observation?.terminal_eligible).toBe(false);
        expect(response.body?.final_answer_source).toBe("final_answer_draft");
        expect(response.body?.terminal_artifact_kind).toBe("model_synthesized_answer");
        expect(response.body?.final_answer_draft?.llm_error_code ?? null).toBeNull();
        const finalAnswer = String(response.body?.selected_final_answer ?? response.body?.answer ?? "");
        expect(finalAnswer).toMatch(/resistance|impedance|superconductivity|circuit/i);
        expect(finalAnswer).not.toMatch(/^The interim voice callout\b/i);
        expect(finalAnswer).not.toMatch(/accepted for client playback handoff/i);
      }
    } finally {
      if (previousRuntimeFinalAnswer === undefined) delete process.env.HELIX_RUNTIME_FINAL_ANSWER_TEST_RESPONSE;
      else process.env.HELIX_RUNTIME_FINAL_ANSWER_TEST_RESPONSE = previousRuntimeFinalAnswer;
    }
  }, 60000);

  it("streams interim voice callout handoff before the final answer", async () => {
    const previousRuntimeFinalAnswer = process.env.HELIX_RUNTIME_FINAL_ANSWER_TEST_RESPONSE;
    process.env.HELIX_RUNTIME_FINAL_ANSWER_TEST_RESPONSE =
      "Energy-mass equivalence means mass and energy are interchangeable through E=mc^2, which matters practically in nuclear reactions, particle creation, and binding energy.";
    const app = createApp();
    try {
      const response = await request(app)
        .post("/api/agi/ask/turn/stream")
        .send({
          question:
            "Use the voice lane to say checking energy mass equivalence then tell me about energy mass equivalence in practical physics terms. The final answer should focus on the physics.",
          mode: "read",
          debug: true,
          sessionId: `e52-voice-stream-handoff-${Date.now()}`,
        })
        .expect(200);

      const events = parseStreamEvents(response.text);
      const handoffIndex = events.findIndex((event) => event.event === "interim_voice_callout_handoff");
      const finalIndex = events.findIndex((event) => event.event === "turn_final");
      expect(handoffIndex).toBeGreaterThanOrEqual(0);
      expect(finalIndex).toBeGreaterThanOrEqual(0);
      expect(handoffIndex).toBeLessThan(finalIndex);
      const handoff = events[handoffIndex]?.data;
      expect(handoff).toMatchObject({
        schema: "helix.interim_voice_callout_stream_handoff.v1",
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      });
      expect(handoff?.artifact?.kind).toBe("live_environment_tool_observation");
      expect(handoff?.artifact?.payload?.tool_name).toBe("live_env.request_interim_voice_callout");
      expect(["awaiting_client_playback", "queued_for_retry"]).toContain(handoff?.artifact?.payload?.observation?.receipt?.status);
      expect(handoff?.artifact?.payload?.observation?.request?.text).toBe("checking energy mass equivalence");
      const final = events[finalIndex]?.data;
      expect(String(final?.selected_final_answer ?? final?.answer ?? "")).toMatch(/mass|energy|E=mc/i);
      expect(String(final?.selected_final_answer ?? final?.answer ?? "")).not.toMatch(/^The interim voice callout\b/i);
    } finally {
      if (previousRuntimeFinalAnswer === undefined) delete process.env.HELIX_RUNTIME_FINAL_ANSWER_TEST_RESPONSE;
      else process.env.HELIX_RUNTIME_FINAL_ANSWER_TEST_RESPONSE = previousRuntimeFinalAnswer;
    }
  }, 60000);

  it("recognizes speak and read-aloud variants as direct interim voice commands", async () => {
    const app = createApp();
    for (const question of [
      'With the voice lane active, speak "I am checking the live-source voice boundary" through the voice lane.',
      'With the voice lane active, read "the live-source callout is policy-gated" aloud.',
    ]) {
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question,
          mode: "read",
          debug: true,
          sessionId: `e52-natural-voice-variant-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        })
        .expect(200);

      expect(response.body?.canonical_goal_frame?.goal_kind).toBe("live_environment_review");
      expect(response.body?.canonical_goal_frame?.classifier_reasons ?? []).toContain("voice_output_tool_arbitration");
      expect(response.body?.canonical_goal_frame?.classifier_reasons ?? []).toContain("voice_output_interim_callout_intent");
      expect(response.body?.available_capabilities?.recommended_capability_key).toBe("live_env.request_interim_voice_callout");
      const ledger = Array.isArray(response.body?.current_turn_artifact_ledger)
        ? response.body.current_turn_artifact_ledger
        : [];
      const runtimeVoiceCall = ledger.find((artifact: any) =>
        artifact?.kind === "runtime_tool_call" &&
        artifact?.payload?.capability_key === "live_env.request_interim_voice_callout"
      );
      const voiceObservation = ledger.find((artifact: any) =>
        artifact?.kind === "live_environment_tool_observation" &&
        artifact?.payload?.tool_name === "live_env.request_interim_voice_callout"
      );
      expect(runtimeVoiceCall).toBeTruthy();
      expect(voiceObservation).toBeTruthy();
      expect(voiceObservation?.payload?.assistant_answer).toBe(false);
      expect(voiceObservation?.payload?.observation?.assistant_answer).toBe(false);
      expect(voiceObservation?.payload?.observation?.terminal_eligible).toBe(false);
    }
  }, 60000);

  it("builds blocked interim voice capacity as a final observed status fallback", () => {
    const text = __testHelixRuntimeInterimVoiceCalloutFallback.buildHelixRuntimeInterimVoiceCalloutFallbackText([
      {
        artifact_id: "turn:voice:live_environment_tool_observation:1",
        kind: "live_environment_tool_observation",
        payload: {
          tool_name: "live_env.request_interim_voice_callout",
          observation: {
            schema: "helix.interim_voice_callout_tool_result.v1",
            request: {
              text: "I am checking this now",
            },
            receipt: {
              status: "blocked_capacity",
              assistant_answer: false,
              terminal_eligible: false,
            },
            assistant_answer: false,
            terminal_eligible: false,
            post_tool_model_step_required: true,
          },
          assistant_answer: false,
          raw_content_included: false,
        },
      } as any,
    ]);

    expect(text).toMatch(/blocked by capacity/i);
    expect(text).toMatch(/"I am checking this now"/);
    expect(text).toMatch(/evidence-only/i);
    expect(text).not.toMatch(/should I speak|need your confirmation|speak it now/i);
  });

  it("reports retry-queued interim voice capacity as final status instead of confirmation", async () => {
    const previousRuntimeMaxHeap = process.env.RUNTIME_MEMORY_MAX_HEAP_USED_MB;
    const previousRuntimeMaxRss = process.env.RUNTIME_MEMORY_MAX_RSS_MB;
    const previousAgentStepLlm = process.env.HELIX_AGENT_STEP_DECISION_LLM;
    const previousAgentStepResponse = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
    const previousAgentStepResponseIndex = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
    const previousRuntimeFinalAnswer = process.env.HELIX_RUNTIME_FINAL_ANSWER_TEST_RESPONSE;
    resetInterimVoiceCalloutsForTest();
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests();
    process.env.RUNTIME_MEMORY_MAX_HEAP_USED_MB = "999999";
    process.env.RUNTIME_MEMORY_MAX_RSS_MB = "999999";
    process.env.HELIX_AGENT_STEP_DECISION_LLM = "1";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = "0";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = JSON.stringify([
      {
        next_step: "next_action",
        chosen_capability: "live_env.request_interim_voice_callout",
        reason: "The user explicitly asked for a provisional voice callout while the voice lane is active.",
        args: {
          kind: "immediate_ack",
          text: "I am checking this now",
          urgency: "normal",
          reason: "Acknowledge the live voice request without replacing the final answer.",
        },
        expected_artifacts: [
          "live_environment_tool_observation",
          "helix_interim_voice_callout_receipt",
        ],
        confidence: 0.96,
      },
    ]);
    process.env.HELIX_RUNTIME_FINAL_ANSWER_TEST_RESPONSE = [
      '- The interim voice callout "I am checking this now" was successfully queued for client playback handoff, indicating that the system is processing the request.',
      "- Evidence-only voice tool receipts document the actions taken by the voice tool, such as the acceptance of callouts or any playback issues, without providing a definitive outcome or replacing the final answer.",
    ].join("\n");
    const occupiedTts = runtimeMemoryGovernor.admitRuntimeTask({
      taskClass: "voice_tts",
      source: "test.e52.interim_voice_capacity_occupied",
    });
    expect(occupiedTts.admitted).toBe(true);

    try {
      const sessionId = `e52-interim-voice-capacity-${Date.now()}`;
      createLiveAnswerEnvironment({
        thread_id: sessionId,
        created_turn_id: "turn:e52-interim-voice-capacity-seed",
        objective: "Exercise interim voice callout receipt handling.",
        preset: "mission_control",
        room_id: "room:e52-interim-voice-capacity",
        source_ids: ["source:e52-interim-voice-capacity"],
      });
      const app = createApp();
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question: [
            "With the voice lane active, use the interim voice callout tool to queue a short provisional callout saying",
            "\"I am checking this now\", then continue the normal Helix Ask answer.",
            "In the final answer, explain in two bullets what evidence-only voice tool receipts mean.",
          ].join(" "),
          mode: "read",
          debug: true,
          sessionId,
        })
        .expect(200);

      const finalAnswer = String(response.body?.selected_final_answer ?? response.body?.answer ?? "");
      expect(response.body?.final_answer_source).not.toBe("request_user_input");
      expect(response.body?.terminal_artifact_kind).not.toBe("request_user_input");
      expect(response.body?.goal_satisfaction_evaluation).toMatchObject({
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      });
      expect(finalAnswer).toMatch(/queued for retry/i);
      expect(finalAnswer).toMatch(/evidence-only/i);
      expect(finalAnswer).toMatch(/^- Evidence-only voice tool receipts record/m);
      expect(finalAnswer).toMatch(/^- They can support the final answer/m);
      expect(response.body?.final_answer_draft?.llm_error_code).toBe(
        "post_observation_composer_undercovered_compound_interim_voice_goal",
      );
      expect(finalAnswer).not.toMatch(/should I speak|need your confirmation|speak it now/i);
    } finally {
      occupiedTts.lease?.release("completed");
      if (previousRuntimeMaxHeap === undefined) delete process.env.RUNTIME_MEMORY_MAX_HEAP_USED_MB;
      else process.env.RUNTIME_MEMORY_MAX_HEAP_USED_MB = previousRuntimeMaxHeap;
      if (previousRuntimeMaxRss === undefined) delete process.env.RUNTIME_MEMORY_MAX_RSS_MB;
      else process.env.RUNTIME_MEMORY_MAX_RSS_MB = previousRuntimeMaxRss;
      if (previousAgentStepLlm === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_LLM;
      else process.env.HELIX_AGENT_STEP_DECISION_LLM = previousAgentStepLlm;
      if (previousAgentStepResponse === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = previousAgentStepResponse;
      if (previousAgentStepResponseIndex === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = previousAgentStepResponseIndex;
      if (previousRuntimeFinalAnswer === undefined) delete process.env.HELIX_RUNTIME_FINAL_ANSWER_TEST_RESPONSE;
      else process.env.HELIX_RUNTIME_FINAL_ANSWER_TEST_RESPONSE = previousRuntimeFinalAnswer;
      resetInterimVoiceCalloutsForTest();
      runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests();
    }
  }, 60000);

  it("keeps contextual interim voice tool policy mentions non-executable", async () => {
    const app = createApp();
    for (const question of [
      "What does the phrase \"use the interim voice callout tool\" mean in the previous debug, and what is the policy?",
      "Do not speak. Just explain when a voice callout would be appropriate during a long tool-using answer.",
      "Earlier we tested a voice callout saying \"I am checking this now\". Explain what happened, but do not make a new voice callout.",
      "Do not use the voice lane to say browser voice ok; explain why that would normally be a voice command.",
      "Do not use the voice lane to say checking now then explain impedance in practical circuit terms.",
      "Earlier we said browser voice ok out loud. Explain what happened without making a new callout.",
      "Write the sentence: use the voice lane to say browser voice ok.",
    ]) {
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question,
          mode: "read",
          debug: true,
          sessionId: `e52-interim-voice-policy-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        })
        .expect(200);

      expect(response.body?.canonical_goal_frame?.classifier_reasons ?? []).not.toContain("voice_output_tool_arbitration");
      expect(response.body?.available_capabilities?.recommended_capability_key).not.toBe("live_env.request_interim_voice_callout");
      expect(response.body?.agent_step_decision?.chosen_capability).not.toBe("live_env.request_interim_voice_callout");
      expect(findAction(response.body, "docs-viewer")).toBeFalsy();
    }
  }, 60000);

  it("keeps contextual Dottie run analysis out of workstation action routing", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "What can you infer from this Dottie run and what should the next patches be?",
        mode: "read",
        debug: true,
        sessionId: `e52-dottie-context-${Date.now()}`,
      })
      .expect(200);

    expect(findAction(response.body, "situation-room-pipelines", "observer.attach")).toBeFalsy();
    expect(findAction(response.body, "situation-room-pipelines", "voice_delivery.propose_from_trace")).toBeFalsy();
    expect(response.body?.canonical_goal_frame?.classifier_reasons ?? []).not.toContain("workstation_tool_plan:dottie_observer");
  }, 60000);

  it("does not steal real document acquisition prompts", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "open a doc about NHM2 alpha 0p995",
        mode: "read",
        debug: true,
        sessionId: `e52-doc-open-conflict-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).not.toBe("panel_control");
    expect(response.body?.canonical_goal_frame?.answer_scope).not.toBe("current_turn_panel");
    expect(response.body?.terminal_artifact_subkind).not.toBe("panel_action_receipt");
  }, 60000);
});
