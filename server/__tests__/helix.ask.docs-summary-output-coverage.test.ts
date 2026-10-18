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

const docPath = "/docs/research/nhm2-current-status-whitepaper.md";
const architectureDocPath = "/docs/architecture/paper-ingestion-paperrun-contract-v1.md";

const workspaceSnapshot = (sessionId: string) => ({
  sessionId,
  activePanel: "docs-viewer",
  activeDocPath: docPath,
  hasDocContext: true,
  hasNoteContext: false,
});

const visibleBulletCount = (text: string): number =>
  text.split(/\r?\n/).filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+\S/.test(line)).length;

describe("Helix Ask docs summary output coverage", () => {
  it("searches and summarizes a naturally named document before answering", async () => {
    const app = createApp();
    const sessionId = `docs-summary-natural-named-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: 'Ok we have a doc called "Helix Ask Codex Loop Discipline" what this abot?',
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          hasDocContext: false,
          hasNoteContext: false,
        },
      })
      .expect(200);

    const iterations = response.body?.agent_runtime_loop?.iterations ?? [];
    const answerText = String(response.body?.selected_final_answer ?? response.body?.answer ?? response.body?.text ?? "");
    const failureDebug = JSON.stringify({
      selected_final_answer: response.body?.selected_final_answer,
      terminal_artifact_kind: response.body?.terminal_artifact_kind,
      terminal_error_code: response.body?.terminal_error_code,
      final_answer_source: response.body?.final_answer_source,
      source_target_intent: response.body?.source_target_intent,
      canonical_goal_frame: response.body?.canonical_goal_frame,
      agent_runtime_loop: response.body?.agent_runtime_loop,
      satisfaction_report: response.body?.satisfaction_report,
      doc_open_coverage: response.body?.doc_open_coverage,
      doc_location_coverage: response.body?.doc_location_coverage,
      retrieval_required_signal: response.body?.retrieval_required_signal,
      capability_itinerary: response.body?.capability_itinerary ?? response.body?.debug?.capability_itinerary,
      capability_itinerary_execution_state:
        response.body?.capability_itinerary_execution_state ?? response.body?.debug?.capability_itinerary_execution_state,
      tool_call_admission_decision:
        response.body?.tool_call_admission_decision ?? response.body?.debug?.tool_call_admission_decision,
      goal_satisfaction_evaluation: response.body?.goal_satisfaction_evaluation,
      current_turn_goal_satisfaction: response.body?.current_turn_goal_satisfaction,
      runtime_authority_audit: response.body?.runtime_authority_audit,
      route_authority_audit: response.body?.route_authority_audit,
      solver_controller_decision: response.body?.solver_controller_decision,
    }, null, 2);
    expect(response.body?.source_target_intent).toMatchObject({
      target_source: "docs_viewer",
      strength: "hard",
      allow_no_tool_direct: false,
    });
    expect(response.body?.canonical_goal_frame).toMatchObject({
      goal_kind: "doc_summary",
      required_terminal_kind: "doc_summary",
    });
    expect(response.body?.tool_call_admission_decision?.admitted_tool_families).toContain("docs_viewer");
    expect(response.body?.tool_call_admission_decision?.admitted_tool_families).not.toContain("model_only");
    expect(iterations.some((iteration: any) => iteration?.chosen_capability === "docs-viewer.search_docs")).toBe(true);
    expect(
      iterations.some(
        (iteration: any) =>
          iteration?.chosen_capability === "docs-viewer.summarize_doc" &&
          Array.isArray(iteration?.observed_artifact_refs) &&
          iteration.observed_artifact_refs.length > 0,
      ),
    ).toBe(true);
    expect(response.body?.terminal_artifact_kind, failureDebug).toBe("doc_summary");
    expect(response.body?.terminal_artifact_kind).not.toBe("typed_failure");
    expect(response.body?.solver_controller_decision?.decision).toBe("allow_terminal");
    expect(response.body?.route_authority_audit?.route_authority_ok).toBe(true);
    expect(answerText).toMatch(/Helix Ask|Codex|loop|discipline/i);
    expect(answerText).not.toMatch(/Capability proposal\s*:/i);
  }, 60000);

  it("covers requested summary bullet count and path before allowing terminal success", async () => {
    const app = createApp();
    const sessionId = `docs-summary-covered-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: `Summarize ${docPath} from docs in 5 bullets. Include the path.`,
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: workspaceSnapshot(sessionId),
      })
      .expect(200);

    const answerText = String(response.body?.selected_final_answer ?? response.body?.answer ?? response.body?.text ?? "");
    const coverage = response.body?.prompt_requirement_coverage;
    const failureDebug = JSON.stringify({
      text: response.body?.text,
      terminal_error_code: response.body?.terminal_error_code,
      route_reason_code: response.body?.route_reason_code,
      canonical_goal_frame: response.body?.canonical_goal_frame,
      source_target_intent: response.body?.source_target_intent,
      capability_plan: response.body?.capability_plan,
      initial_agent_step_decision: response.body?.initial_agent_step_decision,
      agent_step_decision: response.body?.agent_step_decision,
      agent_runtime_loop: response.body?.agent_runtime_loop,
      goal_satisfaction_evaluation: response.body?.goal_satisfaction_evaluation,
      runtime_authority_audit: response.body?.runtime_authority_audit,
    });
    expect(response.body?.terminal_artifact_kind, failureDebug).not.toBe("typed_failure");
    expect(response.body?.solver_controller_decision?.decision).toBe("allow_terminal");
    expect(response.body?.route_authority_audit?.route_authority_ok).toBe(true);
    expect(answerText).toContain(docPath);
    expect(visibleBulletCount(answerText)).toBeGreaterThanOrEqual(5);
    expect(
      response.body?.agent_runtime_loop?.iterations?.some(
        (iteration: any) =>
          iteration?.chosen_capability === "docs-viewer.summarize_doc" &&
          ["executed_tool_result", "preobserved_tool_result"].includes(iteration?.observation_role) &&
          Array.isArray(iteration?.observed_artifact_refs) &&
          iteration.observed_artifact_refs.some((ref: unknown) => String(ref).includes(":doc_summary:")),
      ),
    ).toBe(true);
    expect(coverage?.coverage).toBe("complete");
    expect(response.body?.doc_retrieval_coverage?.coverage).toBe("complete");
    expect(response.body?.doc_retrieval_coverage?.requested_scope).toBe("full_doc");
    expect(coverage?.requirements?.some((entry: any) => entry?.id === "doc_summary_min_5_bullets" && entry?.satisfied === true)).toBe(true);
    expect(coverage?.requirements?.some((entry: any) => entry?.id === "doc_summary_path_included" && entry?.satisfied === true)).toBe(true);
    expect(
      response.body?.job_ready_links?.some((link: any) => link?.label === "Open cited doc" && link?.args?.path === docPath),
    ).toBe(true);
    expect(
      response.body?.job_ready_links?.some((link: any) => /^Open result \d+$/i.test(String(link?.label ?? ""))),
    ).toBe(false);
    expect(
      response.body?.job_ready_links?.some((link: any) => link?.label === "Open current doc" && link?.args?.path === docPath),
    ).toBe(false);
    expect(response.body?.debug?.doc_summary_terminal_promotion).toBeUndefined();
    if (response.body?.debug?.doc_summary_observation_candidate) {
      expect(response.body.debug.doc_summary_observation_candidate.terminal_authority).not.toBe(true);
    }
  }, 60000);

  it("searches docs before summarizing when no exact or active document is supplied", async () => {
    const app = createApp();
    const sessionId = `docs-summary-search-then-read-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Summarize docs about NHM2 current status in 4 bullets. Include the path.",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          activeDocPath: docPath,
          hasDocContext: true,
          hasNoteContext: false,
        },
      })
      .expect(200);

    const answerText = String(response.body?.selected_final_answer ?? response.body?.answer ?? response.body?.text ?? "");
    const iterations = response.body?.agent_runtime_loop?.iterations ?? [];
    const plannerItems = response.body?.planner_contract?.plan_items ?? [];
    const naturalPathFailureDebug = JSON.stringify({
      text: response.body?.text,
      terminal_error_code: response.body?.terminal_error_code,
      route_reason_code: response.body?.route_reason_code,
      canonical_goal_frame: response.body?.canonical_goal_frame,
      source_target_intent: response.body?.source_target_intent,
      capability_plan: response.body?.capability_plan,
      initial_agent_step_decision: response.body?.initial_agent_step_decision,
      agent_step_decision: response.body?.agent_step_decision,
      agent_runtime_loop: response.body?.agent_runtime_loop,
      goal_satisfaction_evaluation: response.body?.goal_satisfaction_evaluation,
      runtime_authority_audit: response.body?.runtime_authority_audit,
    });
    expect(response.body?.terminal_artifact_kind, naturalPathFailureDebug).not.toBe("typed_failure");
    expect(response.body?.final_status).toBe("final_answer");
    expect(response.body?.solver_controller_decision?.decision).toBe("allow_terminal");
    expect(response.body?.route_authority_audit?.route_authority_ok).toBe(true);
    expect(iterations.some((iteration: any) => iteration?.chosen_capability === "docs-viewer.search_docs")).toBe(true);
    expect(response.body?.initial_agent_step_decision?.chosen_capability).toBe("docs-viewer.search_docs");
    expect(
      iterations.some(
        (iteration: any) =>
          iteration?.chosen_capability === "docs-viewer.summarize_doc" &&
          Array.isArray(iteration?.observed_artifact_refs) &&
          iteration.observed_artifact_refs.some((ref: unknown) => String(ref).includes(":doc_summary:")),
      ),
    ).toBe(true);
    expect(answerText).toMatch(/\/docs\//);
    expect(visibleBulletCount(answerText)).toBeGreaterThanOrEqual(4);
    expect(
      plannerItems.some((item: any) => String(item?.id ?? "").includes("reasoning_followup_opened_doc_answer")),
    ).toBe(false);
    expect(response.body?.satisfaction_report?.missing_artifacts ?? []).not.toContain("doc_concept_explanation");
    expect(response.body?.agent_loop_budget?.missing_requirement_ids ?? []).not.toContain("doc_concept_explanation");
    expect(response.body?.prompt_requirement_coverage?.coverage).toBe("complete");
    expect(response.body?.doc_retrieval_coverage?.coverage).toBe("complete");
    expect(response.body?.doc_retrieval_coverage?.requested_scope).toBe("broad_topic");
    expect(
      response.body?.doc_retrieval_coverage?.requirements?.some(
        (entry: any) => entry?.id === "doc_search_results_observed" && entry?.satisfied === true,
      ),
    ).toBe(true);
    const docLinks = (response.body?.job_ready_links ?? []).filter((link: any) => link?.panel_id === "docs-viewer");
    const docLinkPaths = docLinks.map((link: any) => String(link?.args?.path ?? link?.path ?? ""));
    expect(docLinks.some((link: any) => link?.label === "Open cited doc")).toBe(true);
    expect(docLinks.some((link: any) => /^Open result \d+$/i.test(String(link?.label ?? "")))).toBe(false);
    expect(
      response.body?.job_ready_links_suppressed?.some(
        (entry: any) => entry?.reason === "candidate_result_retired_after_cited_doc_selected",
      ),
    ).toBe(true);
    expect(new Set(docLinkPaths).size).toBe(docLinkPaths.length);
    expect(response.body?.debug?.doc_summary_terminal_promotion).toBeUndefined();
    if (response.body?.debug?.doc_summary_observation_candidate) {
      expect(response.body.debug.doc_summary_observation_candidate.terminal_authority).not.toBe(true);
    }
  }, 60000);

  it("does not let open-best receipts satisfy docs search-open-summary prompts", async () => {
    const app = createApp();
    const sessionId = `docs-open-summary-terminal-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Search docs for Helix Ask console debug, open the best matching doc, and summarize what it says about debug exports.",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          hasDocContext: true,
          hasNoteContext: false,
        },
      })
      .expect(200);

    const iterations = response.body?.agent_runtime_loop?.iterations ?? [];
    const answerText = String(response.body?.selected_final_answer ?? response.body?.answer ?? response.body?.text ?? "");
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_summary");
    expect(response.body?.canonical_goal_frame?.required_terminal_kind).toBe("doc_summary");
    expect(response.body?.terminal_artifact_kind).toBe("doc_summary");
    expect(response.body?.terminal_artifact_kind).not.toBe("doc_open_receipt");
    expect(response.body?.final_answer_source).not.toBe("doc_open_receipt");
    expect(response.body?.final_status).toBe("final_answer");
    expect(response.body?.solver_controller_decision?.decision).toBe("allow_terminal");
    expect(response.body?.route_authority_audit?.route_authority_ok).toBe(true);
    expect(response.body?.ask_turn_solver_trace?.completed_solver_path).toBe(true);
    expect(response.body?.ask_turn_solver_trace?.evidence_reentry_gate?.completed).toBe(true);
    expect(response.body?.ask_turn_solver_trace?.solver_risk_flags ?? []).not.toContain("tool_result_terminal_without_reasoning");
    expect(response.body?.tool_call_admission_decision?.source_target).toBe("docs_viewer");
    expect(response.body?.tool_call_admission_decision?.admitted_tool_families).toContain("docs_viewer");
    expect(iterations.some((iteration: any) => iteration?.chosen_capability === "docs-viewer.search_docs")).toBe(true);
    expect(
      iterations.some(
        (iteration: any) =>
          iteration?.chosen_capability === "docs-viewer.summarize_doc" &&
          Array.isArray(iteration?.observed_artifact_refs) &&
          iteration.observed_artifact_refs.some((ref: unknown) => String(ref).includes(":doc_summary:")),
      ),
    ).toBe(true);
    expect(answerText).toMatch(/debug|export|\/docs\//i);
    expect(
      response.body?.job_ready_links?.some((link: any) => link?.label === "Open cited doc" && /\/docs\//.test(String(link?.args?.path ?? ""))),
    ).toBe(true);
    expect(
      response.body?.job_ready_links?.some((link: any) => /^Open result \d+$/i.test(String(link?.label ?? ""))),
    ).toBe(false);
    expect(
      response.body?.job_ready_links_suppressed?.some(
        (entry: any) => entry?.reason === "candidate_result_retired_after_cited_doc_selected",
      ),
    ).toBe(true);
  }, 60000);

  it("reconciles natural exact-path docs summaries from dispatch into docs terminal authority", async () => {
    const app = createApp();
    const sessionId = `docs-summary-natural-path-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: `summarize ${architectureDocPath} from docs in 4 bullets include the path`,
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          activeDocPath: architectureDocPath,
          hasDocContext: true,
          hasNoteContext: false,
        },
      })
      .expect(200);

    const answerText = String(response.body?.selected_final_answer ?? response.body?.answer ?? response.body?.text ?? "");
    expect(response.body?.terminal_artifact_kind).not.toBe("typed_failure");
    expect(response.body?.solver_controller_decision?.decision).toBe("allow_terminal");
    expect(response.body?.route_authority_audit?.route_authority_ok).toBe(true);
    expect(response.body?.route_product_contract?.source_target).toBe("docs_viewer");
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("doc_summary");
    expect(
      response.body?.agent_runtime_loop?.iterations?.some(
        (iteration: any) =>
          iteration?.chosen_capability === "docs-viewer.summarize_doc" &&
          Array.isArray(iteration?.observed_artifact_refs) &&
          iteration.observed_artifact_refs.some((ref: unknown) => String(ref).includes(":doc_summary:")),
      ),
    ).toBe(true);
    expect(answerText).toContain(architectureDocPath);
    expect(visibleBulletCount(answerText)).toBeGreaterThanOrEqual(4);
  }, 60000);

  it("admits broad natural docs-topic summaries to docs search instead of model-only reasoning", async () => {
    const app = createApp();
    const sessionId = `docs-summary-natural-topic-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "summarize docs about paper ingestion contracts in 4 bullets include paths",
        mode: "read",
        debug: true,
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          hasDocContext: true,
          hasNoteContext: false,
        },
      })
      .expect(200);

    const iterations = response.body?.agent_runtime_loop?.iterations ?? [];
    const answerText = String(response.body?.selected_final_answer ?? response.body?.answer ?? response.body?.text ?? "");
    expect(response.body?.terminal_artifact_kind).not.toBe("typed_failure");
    expect(response.body?.route_product_contract?.source_target).toBe("docs_viewer");
    expect(response.body?.tool_call_admission_decision?.source_target).toBe("docs_viewer");
    expect(response.body?.tool_call_admission_decision?.admitted_tool_families).toContain("docs_viewer");
    expect(response.body?.tool_call_admission_decision?.admitted_tool_families).not.toContain("model_only");
    expect(iterations.some((iteration: any) => iteration?.chosen_capability === "docs-viewer.search_docs")).toBe(true);
    expect(
      iterations.some(
        (iteration: any) =>
          iteration?.chosen_capability === "docs-viewer.summarize_doc" &&
          Array.isArray(iteration?.observed_artifact_refs) &&
          iteration.observed_artifact_refs.some((ref: unknown) => String(ref).includes(":doc_summary:")),
      ),
    ).toBe(true);
    expect(response.body?.solver_controller_decision?.decision).toBe("allow_terminal");
    expect(response.body?.route_authority_audit?.route_authority_ok).toBe(true);
    expect(answerText).toMatch(/\/docs\//);
  }, 60000);
});
