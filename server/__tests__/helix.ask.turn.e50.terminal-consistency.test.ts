import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { planRouter } from "../routes/agi.plan";
import { arbitrateAskSourceTarget } from "../services/helix-ask/ask-source-target-arbitrator";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

const answerText = (body: any): string =>
  String(body?.selected_final_answer ?? body?.assistant_answer ?? body?.answer ?? body?.text ?? "");

const artifactKinds = (body: any): string[] =>
  Array.isArray(body?.current_turn_artifact_ledger)
    ? body.current_turn_artifact_ledger.map((artifact: any) => String(artifact?.kind ?? "")).filter(Boolean)
    : [];

describe("helix ask E50 terminal consistency", () => {
  it("keeps a conceptual model-only question out of active document terminal state", async () => {
    const app = createApp();
    const activePath = "/docs/research/nhm2-frontier-distance-report.md";
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Can you explain proper time vs coordinate time in simple terms?",
        mode: "read",
        debug: true,
        sessionId: `e50-model-only-active-doc-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs",
          activeDocPath: activePath,
          docViewer: { currentPath: activePath },
        },
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("model_only_concept");
    expect(response.body?.canonical_goal_frame?.answer_scope).toBe("model_only");
    expect(response.body?.canonical_goal_frame?.required_terminal_kind).toBe("direct_answer_text");
    expect(response.body?.tool_choice_arbitration?.answer_scope).toBe("model_only");
    expect(response.body?.terminal_artifact_kind).not.toBe("doc_summary");
    expect(answerText(response.body)).not.toMatch(/Explained\s+\/docs|Compared\s+\/|\/docs\//i);
    expect(response.body?.rejected_terminal_candidates ?? []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "active_doc_path",
          rejection_reason: "ambient_workspace_context",
        }),
      ]),
    );
  }, 60000);

  it("records direct answer text in the current-turn ledger for no-tool concept turns", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Background question: in GR, what is extrinsic curvature in simple terms?",
        mode: "read",
        debug: true,
        sessionId: `e50-no-tool-ledger-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("model_only_concept");
    expect(response.body?.satisfaction_report?.terminal_kind).toBe(response.body?.final_status);
    expect(response.body?.terminal_consistency_check?.consistent).toBe(true);
    if (response.body?.terminal_artifact_kind === "typed_failure") {
      expect(artifactKinds(response.body)).toContain("typed_failure");
      expect(["model_only_answer_unavailable", "provider_terminal_candidate_missing"]).toContain(response.body?.terminal_error_code);
    } else {
      expect(artifactKinds(response.body)).toContain("direct_answer_text");
      expect(response.body?.terminal_artifact_kind).toBe("direct_answer_text");
    }
  }, 60000);

  it("routes explicit no-tool plain chat through model-only terminal authority without retrieval leakage", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Answer normally with no tools: what is 2+2?",
        mode: "read",
        debug: true,
        sessionId: `e50-release-plain-chat-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("model_only_concept");
    expect(response.body?.route_evidence_authority?.terminal_product_allowed).toBe(true);
    if (response.body?.ok === true) {
      expect(response.body?.terminal_artifact_kind).toBe("direct_answer_text");
      expect(response.body?.final_answer_source).toBe("model_direct_answer");
      expect(response.body?.response_type).toBe("final_answer");
      expect(response.body?.final_status).toBe("final_answer");
      expect(response.body?.terminal_error_code ?? null).toBeNull();
      expect(answerText(response.body)).toMatch(/\b4\b|four/i);
    } else {
      expect(response.body?.terminal_artifact_kind).toBe("typed_failure");
      expect(response.body?.final_answer_source).toBe("typed_failure");
      expect(response.body?.terminal_error_code).toBe("provider_terminal_candidate_missing");
      expect(response.body?.satisfaction_report?.missing_reason).toBe("provider_terminal_candidate_missing");
    }
    expect(answerText(response.body)).not.toMatch(/retrieval|grounded evidence|scholarly paper content|tavily/i);
  }, 60000);

  it("keeps quoted and negated tool-name explanations out of search routing", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "Explain the literal phrase `internet-search.search_web` as a software tool name. Do not browse, search, retrieve web evidence, or call tools.",
        mode: "read",
        debug: true,
        sessionId: `e50-quoted-tool-name-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("model_only_concept");
    expect(response.body?.route_evidence_authority?.terminal_product_allowed).toBe(true);
    expect(response.body?.route_evidence_authority?.allowed_terminal_artifact_kinds).toContain("direct_answer_text");
    expect(response.body?.route_evidence_authority?.admitted_tools ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability_id: expect.stringMatching(/internet-search\.search_web|internet_search/i),
        }),
      ]),
    );
    if (response.body?.ok === true) {
      expect(response.body?.terminal_artifact_kind).toBe("direct_answer_text");
      expect(response.body?.final_answer_source).toBe("model_direct_answer");
    } else {
      expect(response.body?.terminal_artifact_kind).toBe("typed_failure");
      expect(response.body?.terminal_error_code).toBe("provider_terminal_candidate_missing");
    }
    expect(answerText(response.body)).not.toMatch(/tavily|retrieval|grounded evidence|scholarly paper content/i);
  }, 60000);

  it("answers general concept questions directly despite ambient active-doc context", async () => {
    const app = createApp();
    const activePath = "/docs/research/nhm2-current-status-whitepaper.md";
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Can you tell me what an electron is?",
        mode: "read",
        debug: true,
        sessionId: `e50-electron-model-only-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          activeDocPath: activePath,
          docContextPath: activePath,
          hasDocContext: true,
          docContextValid: true,
        },
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("model_only_concept");
    expect(response.body?.terminal_artifact_kind).toBe("direct_answer_text");
    expect(response.body?.final_answer_source).toBe("model_direct_answer");
    expect(answerText(response.body)).toMatch(/\belectron\b/i);
    expect(answerText(response.body)).not.toMatch(/Completed reasoning turn|active doc|\/docs\//i);
  }, 60000);

  it("keeps deterministic model-only fallback answers on the solver-trace spine", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Without using workspace, are calculator receipts observations or terminal authority?",
        mode: "read",
        debug: true,
        sessionId: `e50-deterministic-fallback-trace-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.terminal_artifact_kind).toBe("direct_answer_text");
    expect(response.body?.final_answer_source).toBe("model_direct_answer");
    expect(response.body?.route_reason_code).toBe("model_only_concept / model_direct_answer");
    expect(response.body?.route_authority_audit?.route_authority_ok).toBe(true);
    expect(response.body?.poison_audit?.ok).toBe(true);
    expect(response.body?.ask_turn_solver_trace?.completed_solver_path).toBe(true);
    expect(response.body?.ask_turn_solver_trace?.evidence_reentry_gate).toMatchObject({
      required: false,
      completed: true,
      violation_codes: [],
    });
    expect(response.body?.ask_turn_solver_trace?.solver_short_circuit_flags).toEqual([]);
    expect(response.body?.current_turn_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "terminal_answer",
          text: response.body?.selected_final_answer,
          terminal_artifact_kind: "direct_answer_text",
          final_answer_source: "model_direct_answer",
        }),
      ]),
    );

    const debugRef = response.body?.debug_export_ref?.endpoint;
    expect(debugRef).toMatch(/\/api\/agi\/ask\/turn\/.+\/debug-export/);
    const debugExport = await request(app).get(debugRef).expect(200);
    expect(debugExport.body?.payload?.ask_turn_solver_trace?.completed_solver_path).toBe(true);
    expect(debugExport.body?.payload?.poison_audit?.ok).toBe(true);
  }, 60000);

  it("keeps conceptual no-numeric physics prompts out of the calculator route", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "Explain why kinetic energy depends on velocity squared instead of velocity directly. I want a conceptual explanation connected to work, force over distance, and what changes when speed doubles. Do not calculate a specific numeric case unless it helps the explanation.",
        mode: "read",
        debug: true,
        sessionId: `e50-conceptual-ke-no-calculator-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "scientific-calculator",
          hasDocContext: false,
        },
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("model_only_concept");
    expect(response.body?.route_reason_code).not.toMatch(/calculator_solve/);
    if (response.body?.terminal_artifact_kind === "typed_failure") {
      expect(response.body?.terminal_error_code).toBe("model_only_answer_unavailable");
    } else {
      expect(response.body?.terminal_artifact_kind).toBe("direct_answer_text");
      expect(response.body?.final_answer_source).toBe("model_direct_answer");
      expect(response.body?.terminal_error_code ?? null).toBeNull();
    }
    expect(response.body?.selected_final_answer).not.toMatch(/ask_turn_invariant_violation|Completed reasoning turn/i);
    expect(response.body?.workstation_tool_plan?.intent).not.toBe("calculator_solve");
  }, 60000);

  it("keeps abstract underspecified calculator-judgment prompts out of visual situation routing", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "I am trying to estimate the kinetic energy of a 1500 kg car at highway speed for a safety comparison. I did not give you an exact speed. Decide whether the calculator is useful here, but do not invent a speed silently. If the problem is underspecified, say what value you need before producing a numeric result.",
        mode: "read",
        debug: true,
        sessionId: `e50-underspecified-ke-no-visual-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "scientific-calculator",
          hasDocContext: false,
        },
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("model_only_concept");
    expect(response.body?.route_reason_code).not.toMatch(/situation_context_question|calculator_solve/);
    expect(response.body?.terminal_error_code).not.toBe("prompt_requirement_coverage_incomplete");
    expect(String(response.body?.selected_final_answer ?? "")).not.toMatch(/SituationRun|current screen|ask_turn_invariant_violation/i);
    expect(response.body?.workstation_tool_plan?.intent).not.toBe("calculator_solve");
    if (response.body?.terminal_artifact_kind === "pending_server_request") {
      expect(String(response.body?.selected_final_answer ?? "")).toMatch(/speed/i);
      expect(response.body?.final_status).toBe("pending_input");
    } else {
      expect(String(response.body?.selected_final_answer ?? "")).toMatch(/speed|value|underspecified|need/i);
      expect(response.body?.terminal_artifact_kind).not.toBe("typed_failure");
    }
  }, 60000);

  it("keeps ambient visual context available as a tool without forcing it into model-only answers", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Can you tell me what an electron is?",
        mode: "read",
        debug: true,
        sessionId: `e50-electron-ambient-visual-${Date.now()}`,
        workspace_context_snapshot: {
          sessionId: "e50-electron-ambient-visual",
          activePanel: "scientific-calculator",
          activeDocPath: null,
          hasDocContext: false,
          hasNoteContext: false,
          hasClipboardContext: false,
          lastWorkspaceAction: null,
          lastUpdatedAtMs: Date.now(),
          visual_context_capability: {
            schema: "helix.visual_context_capability.v1",
            source_id: "src:visual-test",
            status: "active",
            evidence_available: true,
            latest_evidence_ref: "visual:test-frame",
            requires_agent_step_selection: true,
            promotion_policy: "available_tool_not_forced_context",
            assistant_answer: false,
            raw_content_included: false,
          },
          attached_visual_evidence: {
            evidence: {
              evidence_id: "visual:test-frame",
              frame_id: "frame:test",
              summary: "a scientific calculator panel showing x+9=0",
            },
          },
        },
      })
      .expect(200);

    const visualCapability = response.body?.available_capabilities?.capabilities?.find(
      (capability: any) => capability?.capability_key === "situation-room.describe_visual_capture",
    );
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("model_only_concept");
    expect(response.body?.agent_step_decision?.chosen_capability).toBe("model.direct_answer");
    expect(response.body?.terminal_artifact_kind).toBe("direct_answer_text");
    expect(response.body?.final_answer_source).toBe("model_direct_answer");
    expect(response.body?.visual_evidence_refs ?? []).toEqual([]);
    expect(response.body?.artifact_promotion_audit?.blocked_artifact_promotions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifact_kind: "visual_frame_evidence",
          reason: expect.stringMatching(/normal_ask_cannot_promote_visual_artifact/),
        }),
      ]),
    );
    expect(visualCapability).toEqual(
      expect.objectContaining({
        capability_key: "situation-room.describe_visual_capture",
        availability: "available",
        tool_context_ref: "visual:test-frame",
      }),
    );
    expect(answerText(response.body)).toMatch(/\belectron\b/i);
    expect(answerText(response.body)).not.toMatch(/calculator panel|x\+9|attached image/i);
  }, 60000);

  it("fails visual screen prompts cleanly when capture permission is denied", async () => {
    const app = createApp();
    const sessionId = `e50-visual-permission-denied-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "What is visible on my screen right now?",
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
          hasNoteContext: false,
          hasClipboardContext: false,
          lastWorkspaceAction: null,
          lastUpdatedAtMs: Date.now(),
          visual_context_capability: {
            schema: "helix.visual_context_capability.v1",
            source_id: "src:visual-denied",
            label: "Visual screen capture",
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

    const visualCapability = response.body?.available_capabilities?.capabilities?.find(
      (capability: any) => capability?.capability_key === "situation-room.describe_visual_capture",
    );
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("visual_capture_describe");
    expect(response.body?.source_target_intent?.target_source).toBe("visual_capture");
    expect(response.body?.terminal_artifact_kind).toBe("typed_failure");
    expect(response.body?.terminal_error_code).toBe("visual_capture_permission_denied");
    expect(response.body?.visual_capture_coverage).toMatchObject({
      schema: "helix.visual_capture_coverage.v1",
      goal_kind: "visual_capture_describe",
      coverage: "complete",
      next_decision: "allow_terminal",
    });
    expect(response.body?.goal_satisfaction_evaluation?.satisfaction).toBe("not_satisfied");
    expect(response.body?.goal_satisfaction_evaluation?.next_decision).toBe("fail_closed");
    expect(artifactKinds(response.body)).toEqual(expect.arrayContaining(["visual_context_capability", "typed_failure", "goal_satisfaction_evaluation"]));
    expect(visualCapability).toEqual(
      expect.objectContaining({
        capability_key: "situation-room.describe_visual_capture",
        availability: "permission_denied",
        tool_context_ref: "src:visual-denied",
      }),
    );
    expect(answerText(response.body)).toMatch(/visual capture permission is denied/i);
    expect(answerText(response.body)).not.toMatch(/^Active doc:|\/docs\//i);
    expect(response.body?.terminal_error_code).not.toBe("poison_clean_but_authority_failed");
    expect(response.body?.terminal_error_code).not.toBe("solver_path_incomplete_before_terminal");
  }, 60000);

  it("honors explicit no-workspace constraints before workstation source targeting", async () => {
    const app = createApp();
    const activePath = "/docs/research/nhm2-current-status-whitepaper.md";
    const sourceTarget = arbitrateAskSourceTarget({
      turnId: "e50-source-target",
      threadId: "e50-source-target-thread",
      promptText: "Without using the workspace, explain the difference between proper time and coordinate time.",
    });
    expect(sourceTarget).toMatchObject({
      target_source: "model_only",
      target_kind: "general_background",
      allow_no_tool_direct: true,
      precedence_reason: "explicit_model_only_target",
    });

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Without using the workspace, explain the difference between proper time and coordinate time.",
        mode: "read",
        debug: true,
        sessionId: `e50-without-workspace-model-only-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          activeDocPath: activePath,
          docContextPath: activePath,
          hasDocContext: true,
          docContextValid: true,
        },
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("model_only_concept");
    expect(response.body?.canonical_goal_frame?.answer_scope).toBe("model_only");
    expect(response.body?.terminal_artifact_kind).toBe("direct_answer_text");
    expect(response.body?.final_answer_source).toBe("model_direct_answer");
    expect(answerText(response.body)).toMatch(/proper time/i);
    expect(answerText(response.body)).toMatch(/coordinate time/i);
    expect(answerText(response.body)).not.toMatch(/workspace command|active doc|\/docs\//i);
  }, 60000);

  it("keeps general Doppler explanations model-only despite ambient document context", async () => {
    const app = createApp();
    const activePath = "/docs/research/nhm2-current-status-whitepaper.md";
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Can you explain the Doppler effect in simple terms?",
        mode: "read",
        debug: true,
        sessionId: `e50-doppler-model-only-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          activeDocPath: activePath,
          docContextPath: activePath,
          hasDocContext: true,
          docContextValid: true,
        },
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("model_only_concept");
    expect(response.body?.terminal_artifact_kind).toBe("direct_answer_text");
    expect(response.body?.final_answer_source).toBe("model_direct_answer");
    expect(answerText(response.body)).toMatch(/Doppler effect/i);
    expect(answerText(response.body)).not.toMatch(/Explained\s+\/docs|active doc|\/docs\//i);
  }, 60000);

  it("does not allow doc_summary to satisfy an NHM2 alpha 0p995 numeric request", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Find the best doc about NHM2 alpha 0p995 frontier distance and tell me the key numeric result.",
        mode: "read",
        debug: true,
        sessionId: `e50-numeric-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_scientific_numeric");
    expect(response.body?.canonical_goal_frame?.required_terminal_kind).toBe("doc_numeric_answer");
    expect(response.body?.terminal_artifact_kind).not.toBe("doc_summary");
    expect(["doc_numeric_answer", "typed_failure", null]).toContain(response.body?.terminal_artifact_kind ?? null);
    if (response.body?.terminal_artifact_kind === "typed_failure") {
      expect(response.body?.terminal_error_code).toMatch(/numeric_result_unavailable|terminal_consistency_violation|authoritative_terminal_missing|capability_lifecycle_incomplete/);
    }
  }, 90000);

  it("classifies NHM2 alpha 0p7000 plain-language prompts as scientific concept turns", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "In normal words, what does alpha 0p7000 mean for the NHM2 warp profile?",
        mode: "read",
        debug: true,
        sessionId: `e50-concept-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_scientific_concept");
    expect(response.body?.canonical_goal_frame?.required_terminal_kind).toBe("doc_concept_explanation");
    expect(response.body?.tool_choice_arbitration?.answer_scope).not.toBe("model_only");
    expect(response.body?.terminal_artifact_kind).not.toBe("doc_summary");
    expect(["doc_concept_explanation", "typed_failure", null]).toContain(response.body?.terminal_artifact_kind ?? null);
  }, 90000);
});
