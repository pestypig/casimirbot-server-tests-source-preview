import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

const OLD_ENV = { ...process.env };

const createApp = async (): Promise<express.Express> => {
  vi.resetModules();
  const { planRouter } = await import("../routes/agi.plan");
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

afterEach(() => {
  process.env = { ...OLD_ENV };
  vi.resetModules();
});

const answerText = (body: any): string => String(body?.assistant_answer ?? body?.answer ?? body?.text ?? "");

describe("helix ask turn e12 observation-driven continuation", () => {
  it("lets a model-reviewed observation append and execute a workspace write step", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "1";
    process.env.HELIX_E11_MODEL_DECISION_MAX_APPENDED_STEPS = "1";
    process.env.HELIX_E11_MODEL_DECISION_TEST_RESPONSE = JSON.stringify({
      action: "continue",
      summary: "Save the located alpha centerline finding to the requested note.",
      next_capability: "workstation-notes.append_to_note",
      next_args: {
        title: "alpha notes",
        text: "Alpha centerline location captured from the active document.",
      },
      required_artifacts: ["note_update_receipt"],
    });
    const app = await createApp();
    const sessionId = `e12-continuation-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "summarize this document and save it to a note called alpha notes",
        mode: "read",
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          activeDocPath: "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/warp-nhm2-mission-time-comparison-latest.md",
          hasDocContext: true,
        },
      })
      .expect(200);

    const events = response.body?.turn_events ?? [];
    const runtime = response.body?.turn_runtime ?? {};
    expect(response.body?.model_decision_audits?.some((audit: any) => audit?.operational_step_appended === true)).toBe(true);
    expect(response.body?.execution_trace?.some((step: any) => step?.id?.startsWith("model_step_") && step?.action?.action_id === "append_to_note")).toBe(true);
    expect(response.body?.step_results?.some((step: any) => step?.step_id?.startsWith("model_step_") && step?.actual_artifacts?.includes("note_update_receipt"))).toBe(true);
    expect(runtime.required_artifacts).toContain("note_update_receipt");
    expect(runtime.satisfied_artifacts).toContain("note_update_receipt");
    expect(runtime.missing_required_artifacts ?? []).toHaveLength(0);
    expect(events.some((event: any) => event?.type === "plan_delta" && event?.step?.id?.startsWith("model_step_"))).toBe(true);
    expect(answerText(response.body)).toMatch(/alpha notes|Locations:/i);
  }, 20000);

  it("keeps fast current-doc identity as a single-step workspace answer", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    const app = await createApp();
    const sessionId = `e12-current-doc-${Date.now()}`;
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
    expect(response.body?.execution_trace?.filter((step: any) => step?.status === "completed")).toHaveLength(1);
    expect(answerText(response.body)).toContain(path);
    expect(answerText(response.body)).not.toMatch(/Completed reasoning for|Steps:/i);
    expect(response.body?.final_composer_source).toBe("active_doc_path");
    expect(response.body?.final_composer_consumed_artifacts).toContain("active_doc_path");
  });

  it("turns unsatisfied model-declared artifacts into a typed runtime failure", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "1";
    process.env.HELIX_E11_MODEL_DECISION_MAX_APPENDED_STEPS = "0";
    process.env.HELIX_E11_MODEL_DECISION_TEST_RESPONSE = JSON.stringify({
      action: "continue",
      summary: "A note receipt is still required but no tool may be appended.",
      next_capability: "workstation-notes.append_to_note",
      next_args: {
        title: "blocked note",
        text: "Blocked summary.",
      },
      required_artifacts: ["note_update_receipt"],
    });
    const app = await createApp();
    const sessionId = `e12-missing-artifact-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "summarize this doc and save it to blocked note",
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

    const runtime = response.body?.turn_runtime ?? {};
    expect(runtime.required_artifacts).toContain("note_update_receipt");
    expect(runtime.missing_required_artifacts).toContain("note_update_receipt");
    expect(runtime.terminal?.kind).toBe("final_failure");
    expect(runtime.terminal?.error_code).toBe("missing_required_artifacts");
    expect(response.body?.turn_events?.some((event: any) => event?.type === "terminal_answer" && event?.status === "final_failure")).toBe(true);
  }, 20000);

  it("repairs doc locate misses with variant search before finalizing", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    const app = await createApp();
    const sessionId = `e12-doc-locate-variant-${Date.now()}`;
    const path =
      "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/warp-nhm2-mission-time-comparison-latest.md";

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "where does this document mention mission time?",
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

    const runtime = response.body?.turn_runtime ?? {};
    const executionTrace = response.body?.execution_trace ?? [];
    const stepResults = response.body?.step_results ?? [];
    expect(executionTrace.some((step: any) => step?.action?.action_id === "locate_in_doc" && step?.action?.args?.locate_strategy === "variant")).toBe(true);
    expect(stepResults.some((step: any) => step?.actual_artifacts?.includes("doc_location_matches"))).toBe(true);
    expect(runtime.missing_required_artifacts ?? []).not.toContain("doc_location_matches");
    expect(runtime.terminal?.kind).not.toBe("final_failure");
    expect(answerText(response.body)).toMatch(/Locations:/i);
    expect(answerText(response.body)).toMatch(/mission/i);
    expect(answerText(response.body)).not.toMatch(/Completed reasoning for|Steps:/i);
    expect(response.body?.final_composer_source).toBe("doc_location_matches");
    expect(response.body?.final_composer_consumed_artifacts).toContain("doc_location_matches");
  }, 20000);

  it("runs compound doc locate to note write without premature artifact failure", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    const app = await createApp();
    const sessionId = `e12-locate-to-note-${Date.now()}`;
    const path =
      "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/warp-nhm2-mission-time-comparison-latest.md";

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "find where this doc talks about falsifier conditions, then add a short reminder about that to UI flow scratch",
        mode: "read",
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          activeDocPath: path,
          activeNoteTitle: "UI flow scratch",
          hasDocContext: true,
          hasNoteContext: true,
        },
      })
      .expect(200);

    const runtime = response.body?.turn_runtime ?? {};
    const executionTrace = response.body?.execution_trace ?? [];
    const stepResults = response.body?.step_results ?? [];
    const locateStep = executionTrace.find((step: any) => step?.action?.action_id === "locate_in_doc");
    const appendStep = executionTrace.find((step: any) => step?.action?.action_id === "append_to_note");
    const envelopeActions = response.body?.action_envelope?.workstation_actions ?? [];
    const envelopeAppendActions = envelopeActions.filter((action: any) => action?.panel_id === "workstation-notes" && action?.action_id === "append_to_note");
    expect(locateStep?.action?.args?.query).toBe("falsifier conditions");
    expect(appendStep?.action?.args?.title).toBe("UI flow scratch");
    expect(appendStep?.action?.args?.text).toMatch(/Falsifier Conditions/i);
    expect(appendStep?.action?.args?.text).toMatch(/L\d+/i);
    expect(appendStep?.action?.args?.text).not.toContain("{{");
    expect((appendStep?.action?.args?.text.match(/Reminder:/g) ?? [])).toHaveLength(1);
    expect(envelopeAppendActions).toHaveLength(1);
    expect((String(envelopeAppendActions[0]?.args?.text ?? "").match(/Reminder:/g) ?? [])).toHaveLength(1);
    expect(String(envelopeAppendActions[0]?.args?.text ?? "")).toMatch(/L\d+/i);
    expect(JSON.stringify(stepResults)).not.toContain("doc_location_reminder_text");
    expect(stepResults.some((step: any) => step?.actual_artifacts?.includes("doc_location_matches"))).toBe(true);
    expect(stepResults.some((step: any) => step?.actual_artifacts?.includes("note_update_receipt"))).toBe(true);
    expect(runtime.missing_required_artifacts ?? []).not.toContain("doc_location_matches");
    expect(runtime.missing_required_artifacts ?? []).not.toContain("note_update_receipt");
    expect(runtime.terminal?.kind).not.toBe("final_failure");
    expect(answerText(response.body)).toMatch(/reminder|UI flow scratch|note/i);
    expect(answerText(response.body)).not.toMatch(/Completed reasoning for|Steps:/i);
    expect(response.body?.final_composer_source).toBe("final_answer_draft");
    expect(response.body?.terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(response.body?.final_answer_source).not.toMatch(/note_.*receipt/);
    expect(response.body?.final_composer_consumed_artifacts).toEqual(
      expect.arrayContaining(["doc_location_matches", "note_update_receipt"]),
    );
  }, 20000);

  it("does not invent doc context when deictic doc summary lacks an active document", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    const app = await createApp();
    const sessionId = `e12-missing-doc-context-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what is this doc about?",
        mode: "read",
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          activeDocPath: null,
          hasDocContext: false,
        },
      })
      .expect(200);

    expect(answerText(response.body)).toMatch(/No active document is available/i);
    expect(answerText(response.body)).not.toMatch(/Explained|Key claim|Completed reasoning for|Steps:/i);
    expect(response.body?.final_composer_source).toBe("active_doc_path");
    expect(response.body?.final_composer_contract_pass).toBe(false);
    expect(response.body?.final_composer_fail_reason).toBe("missing_active_doc_path");
  }, 20000);

  it("canonicalizes model-selected locate aliases before required argument validation", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "1";
    process.env.HELIX_E11_MODEL_DECISION_MAX_APPENDED_STEPS = "1";
    process.env.HELIX_E11_MODEL_DECISION_TEST_RESPONSE = JSON.stringify({
      action: "continue",
      summary: "Retry locate with canonical args.",
      next_capability: "docs-viewer.locate_in_doc",
      next_args: {
        search_term: "falsifier conditions",
      },
      required_artifacts: [],
    });
    const app = await createApp();
    const sessionId = `e12-model-alias-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "where does this document mention mission time?",
        mode: "read",
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          activeDocPath:
            "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/warp-nhm2-mission-time-comparison-latest.md",
          hasDocContext: true,
        },
      })
      .expect(200);

    const audits = response.body?.model_decision_audits ?? [];
    const appendedLocate = response.body?.execution_trace?.find(
      (step: any) => step?.id?.startsWith("model_step_") && step?.action?.action_id === "locate_in_doc",
    );
    expect(audits.some((audit: any) => String(audit?.error_code ?? "").includes("missing_next_args:query"))).toBe(false);
    expect(appendedLocate?.action?.args?.query).toBe("falsifier conditions");
  }, 20000);
});
