import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OLD_ENV = { ...process.env };

const createApp = async (): Promise<express.Express> => {
  vi.resetModules();
  const { planRouter } = await import("../routes/agi.plan");
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

beforeEach(() => {
  // This suite repeatedly reloads the large Ask route to exercise env-sensitive branches.
  // Keep the production memory governor from mistaking test-module accumulation for runtime pressure.
  process.env.RUNTIME_MEMORY_MAX_HEAP_USED_MB = "999999";
  process.env.RUNTIME_MEMORY_MAX_RSS_MB = "999999";
});

afterEach(() => {
  process.env = { ...OLD_ENV };
  vi.resetModules();
});

const activePath =
  "/docs/audits/research/selected-family/nhm2-shift-lapse/alpha-sweep/stage1_centerline_alpha_0p7000_v1/warp-nhm2-mission-time-comparison-latest.md";

const baseWorkspace = (sessionId: string) => ({
  sessionId,
  activePanel: "docs-viewer",
  activeDocPath: activePath,
  hasDocContext: true,
  hasNoteContext: true,
  activeNoteTitle: "quick NHM2 test note",
  lastCreatedNoteTitle: "quick NHM2 test note",
});

const CODEX_PARITY_CLASSES = [
  "complete",
  "tool_surface_missing",
  "explicit_capability_demoted",
  "tool_admission_rejected",
  "selected_not_executed",
  "observation_missing",
  "observation_not_reentered",
  "goal_contract_mismatch",
  "terminal_product_not_allowed",
  "terminal_authority_mismatch",
  "visible_projection_mismatch",
  "debug_mirror_stale",
  "provider_config_missing",
];

const expectNullableStringField = (record: Record<string, unknown>, key: string): void => {
  expect(record).toHaveProperty(key);
  const value = record[key];
  expect(value === null || typeof value === "string").toBe(true);
};

const expectCodexParityRailTableForResponse = (body: any): void => {
  const railTable = body?.codex_parity_agent_spine_rail_table;
  expect(railTable && typeof railTable === "object" && !Array.isArray(railTable)).toBe(true);
  const record = railTable as Record<string, unknown>;
  expect(record).toMatchObject({
    schema: "helix.codex_parity_agent_spine_rail_table.v1",
    turn_id: body?.turn_id,
    assistant_answer: false,
    raw_content_included: false,
  });
  expectNullableStringField(record, "prompt");
  expect(Array.isArray(record.visible_tool_surface)).toBe(true);
  for (const key of [
    "requested_capability",
    "selected_capability",
    "admitted_capability",
    "executed_capability",
    "observation_kind",
    "observation_ref",
    "goal_satisfaction",
    "required_terminal_kind",
    "selected_terminal_kind",
    "visible_terminal_kind",
    "first_broken_rail",
    "repair_target",
    "rail_failure_code",
  ]) {
    expectNullableStringField(record, key);
  }
  expect(["reentered", "not_reentered", "no_observation"]).toContain(record.reentry_status);
  expect(["complete", "broken", "fail_closed"]).toContain(record.rail_status);
  expect(CODEX_PARITY_CLASSES).toContain(record.codex_parity_class);
  if (record.codex_parity_class === "complete" || record.rail_status === "complete") {
    expect(record.first_broken_rail).toBeNull();
    expect(record.rail_failure_code).toBeNull();
  } else {
    expect(typeof record.first_broken_rail).toBe("string");
    expect(String(record.first_broken_rail).length).toBeGreaterThan(0);
  }
};

const answerText = (body: any): string => {
  expectCodexParityRailTableForResponse(body);
  return String(body?.assistant_answer ?? body?.answer ?? body?.text ?? "");
};

describe("helix ask turn e17 general step controller", () => {
  it("answers simple status checks directly without reasoning or workspace refs", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "1";
    const app = await createApp();
    const sessionId = `e17-simple-status-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Is this working ?",
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId),
      })
      .expect(200);

    const text = answerText(response.body);
    expect(text).toMatch(/responding/i);
    expect(text).not.toMatch(/Reasoning completed|Grounded refs|reasoning_pass/i);
    expect(text).not.toContain(activePath);
    expect(text).not.toMatch(/quick NHM2 test note/i);
    expect(response.body?.route_reason_code).toBe("conversation:simple");
    expect(response.body?.dispatch_policy).toBe("direct_answer_only");
    expect(response.body?.workspace_action).toBeNull();
    expect(response.body?.planner_contract?.dispatch_policy).toBe("direct_answer_only");
    expect(response.body?.planner_contract?.plan_items?.map((step: any) => step?.id)).toEqual([
      "planner_restate_goal",
      "assistant_direct_answer",
    ]);
    expect(response.body?.execution_trace?.map((step: any) => step?.status)).toEqual(["completed", "completed"]);
    expect(response.body?.step_results?.some((step: any) => step?.actual_artifacts?.includes("direct_answer_text"))).toBe(true);
    expect(response.body?.turn_contract?.terminal_kind).toBe("conversation");
    expect(response.body?.final_answer_contract_family).toBe("simple");
    expect(response.body?.final_answer_contract_pass).toBe(true);
    expect(response.body?.turn_truth_table?.terminal?.contract?.family).toBe("simple");
    expect(response.body?.agent_loop_audit?.final_answer_contract?.pass).toBe(true);
  }, 120000);

  it("answers greetings directly without reasoning or workspace refs", async () => {
    const app = await createApp();
    const sessionId = `e17-simple-greeting-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "hello",
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId),
      })
      .expect(200);

    const text = answerText(response.body);
    expect(text).toMatch(/hello|work on/i);
    expect(text).not.toMatch(/Reasoning completed|Grounded refs|reasoning_pass/i);
    expect(text).not.toContain(activePath);
    expect(response.body?.route_reason_code).toBe("conversation:simple");
    expect(response.body?.dispatch_policy).toBe("direct_answer_only");
    expect(response.body?.planner_contract?.plan_items?.map((step: any) => step?.id)).toContain("assistant_direct_answer");
    expect(response.body?.final_answer_contract_family).toBe("simple");
    expect(response.body?.final_answer_contract_pass).toBe(true);
  }, 120000);

  it("answers Helix Ask capability help with a concrete capability summary", async () => {
    const app = await createApp();
    const sessionId = `e17-capability-help-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what can i do with helix ask?",
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId),
      })
      .expect(200);

    const text = answerText(response.body);
    expect(text).toMatch(/Helix Ask can help/i);
    expect(text).toMatch(/\bDocs\b/i);
    expect(text).toMatch(/\bNotes\b/i);
    expect(text).toMatch(/\bClipboard\b/i);
    expect(text).toMatch(/Information reflection/i);
    expect(text).toMatch(/Utility/i);
    expect(text).toMatch(/calculator/i);
    expect(text).toMatch(/live-source mail/i);
    expect(text).toMatch(/voice-lane callout/i);
    expect(text).toMatch(/Legacy\/retired/i);
    expect(text).toMatch(/Dottie should be treated as preset\/context/i);
    expect(text).toMatch(/\bReasoning\b/i);
    expect(text).not.toMatch(/could not produce a substantive final answer/i);
    expect(response.body?.dispatch_policy).toBe("conversation_only");
    expect(response.body?.workspace_action).toBeNull();
    expect(response.body?.planner_contract?.plan_items?.map((step: any) => step?.id)).toEqual([
      "capability_registry_inspect",
      "workspace_context_snapshot_inspect",
      "final_answer_compose_capability_help",
    ]);
    const catalogStep = response.body?.step_results?.find((step: any) => step?.step_id === "capability_registry_inspect");
    expect(catalogStep?.actual_artifacts).toEqual(expect.arrayContaining(["capability_registry"]));
    expect(catalogStep?.result_artifact).toMatchObject({
      kind: "capability_registry",
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(catalogStep?.result_artifact?.capability_catalog_observation).toMatchObject({
      capability_key: "helix_ask.inspect_capability_catalog",
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(catalogStep?.result_artifact?.capability_catalog_observation?.information_reflection).toEqual(expect.arrayContaining([
      expect.stringContaining("repo-code.search_concept"),
      expect.stringContaining("workspace_os.status"),
    ]));
    expect(catalogStep?.result_artifact?.capability_catalog_observation?.utility).toEqual(expect.arrayContaining([
      expect.stringContaining("live_env.request_interim_voice_callout"),
    ]));
    expect(catalogStep?.result_artifact?.capability_catalog_observation?.retired_or_legacy).toEqual(expect.arrayContaining([
      "situation-room-pipelines.dottie.manifest",
      "situation-room-pipelines.voice_delivery.propose_from_trace",
    ]));
    expect(response.body?.step_results?.some((step: any) => step?.actual_artifacts?.includes("capability_help_summary"))).toBe(true);
    expect(response.body?.final_answer_contract_family).toBe("capability_help");
    expect(response.body?.final_answer_contract_pass).toBe(true);
    expect(response.body?.terminal_artifact_kind).toBe("capability_help_summary");
    expect(response.body?.route_product_contract?.allowed_terminal_artifact_kinds).toContain("capability_help_summary");
    expect(response.body?.solver_controller_decision?.decision).toBe("allow_terminal");
  }, 120000);

  it("routes Helix Ask tool availability wording through the capability catalog", async () => {
    const app = await createApp();
    const sessionId = `e17-capability-tools-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "What tools are available for the helix ask to use?",
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId),
      })
      .expect(200);

    const text = answerText(response.body);
    expect(text).toMatch(/Helix Ask can help/i);
    expect(text).toMatch(/Information reflection/i);
    expect(text).toMatch(/Utility/i);
    expect(text).toMatch(/calculator/i);
    expect(text).not.toMatch(/natural language processing and machine learning algorithms/i);
    expect(response.body?.dispatch_policy).toBe("conversation_only");
    expect(response.body?.planner_contract?.plan_items?.map((step: any) => step?.id)).toEqual([
      "capability_registry_inspect",
      "workspace_context_snapshot_inspect",
      "final_answer_compose_capability_help",
    ]);
    expect(response.body?.step_results?.some((step: any) => step?.actual_artifacts?.includes("capability_registry"))).toBe(true);
    expect(response.body?.step_results?.some((step: any) => step?.actual_artifacts?.includes("capability_help_summary"))).toBe(true);
    expect(response.body?.tool_call_admission_decision).toMatchObject({
      source_target: "runtime_evidence",
      admitted_tool_families: expect.arrayContaining(["capability_catalog", "runtime_evidence"]),
      reason: "capability_catalog_prompt_requires_runtime_catalog_observation+explicit_capability_contract_required",
    });
    expect(response.body?.canonical_goal_frame).toMatchObject({
      required_terminal_kind: "capability_help_summary",
      classifier_reasons: expect.arrayContaining(["capability_help_catalog_request", "capability_catalog_precedence"]),
    });
    expect(response.body?.initial_available_capabilities).toMatchObject({
      recommended_capability_key: "helix_ask.inspect_capability_catalog",
    });
    expect(response.body?.capability_plan).toMatchObject({
      capability_family: "capability_catalog",
      requested_action: "helix_ask.inspect_capability_catalog",
      selected_capability: "helix_ask.inspect_capability_catalog",
      source_target: "runtime_evidence",
      goal_kind: "capability_help",
      required_terminal_kind: "capability_help_summary",
    });
    expect(response.body?.codex_parity_agent_spine_rail_table).toMatchObject({
      selected_capability: "helix_ask.inspect_capability_catalog",
      executed_capability: "helix_ask.inspect_capability_catalog",
      observation_kind: "capability_registry",
      required_terminal_kind: "capability_help_summary",
      selected_terminal_kind: "capability_help_summary",
      visible_terminal_kind: "capability_help_summary",
      first_broken_rail: null,
      codex_parity_class: "complete",
      rail_status: "complete",
    });
    expect(response.body?.final_answer_contract_family).toBe("capability_help");
    expect(response.body?.final_answer_contract_pass).toBe(true);
    expect(response.body?.terminal_artifact_kind).toBe("capability_help_summary");
    expect(response.body?.route_product_contract?.allowed_terminal_artifact_kinds).toContain("capability_help_summary");
    expect(response.body?.solver_controller_decision?.decision).toBe("allow_terminal");
  }, 120000);

  it("answers scholarly parseability and Image Lens workflow questions through capability help", async () => {
    const app = await createApp();
    const sessionId = `e17-capability-scholarly-workflow-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "Does your research-paper tool let you choose papers it can parse, or do you first check which papers are openable and then use Image Lens? Answer only from your capability contract. Do not retrieve a paper or call a tool.",
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId),
      })
      .expect(200);

    const text = answerText(response.body);
    expect(text).toContain("scholarly-research.lookup_papers");
    expect(text).toContain("scholarly-research.fetch_full_text");
    expect(text).toContain("does not assume every candidate is parseable");
    expect(text).toContain("Image Lens");
    expect(text).toContain("should not become answer evidence");
    expect(text.length).toBeGreaterThan(240);
    expect(response.body?.dispatch_policy).toBe("conversation_only");
    expect(response.body?.workspace_action).toBeNull();
    expect(response.body?.terminal_artifact_kind).toBe("capability_help_summary");
    expect(response.body?.final_answer_source).toBe("capability_help_summary");
    expect(response.body?.terminal_presentation?.concise_text).toBe(text);
    expect(response.body?.typed_failure).toBeUndefined();
    expect(response.body?.final_answer_contract_pass).toBe(true);
    expect(response.body?.solver_controller_decision?.decision).toBe("allow_terminal");
    expect(response.body?.compound_capability_contract?.required_capabilities ?? ["helix_ask.inspect_capability_catalog"])
      .toEqual(["helix_ask.inspect_capability_catalog"]);
    expect(response.body?.compound_subgoal_rail_statuses ?? []).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ requested_capability: "image_lens.inspect" }),
    ]));
    expect(response.body?.agent_runtime_loop?.executed_tool_call_count ?? 0).toBe(0);
    expect(response.body?.agent_runtime_loop?.iterations ?? []).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ chosen_capability: "live_env.read_processed_live_source_mail" }),
    ]));
    expect(response.body?.current_turn_artifact_ledger ?? []).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "runtime_tool_call" }),
    ]));
    expect(response.body?.codex_parity_agent_spine_rail_table).toMatchObject({
      first_broken_rail: null,
      codex_parity_class: "complete",
      rail_status: "complete",
    });
  }, 90_000);

  it("preserves active document identity routing", async () => {
    const app = await createApp();
    const sessionId = `e17-doc-identity-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what paper am I viewing?",
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId),
      })
      .expect(200);

    expect(answerText(response.body)).toContain(activePath);
    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(
      response.body?.job_ready_links?.some((link: any) => link?.label === "Open current doc" && link?.args?.path === activePath),
    ).toBe(true);
    expect(response.body?.final_answer_contract_family).toBe("identity");
    expect(response.body?.final_answer_contract_pass).toBe(true);
  }, 120000);

  it("preserves active document summary routing", async () => {
    const app = await createApp();
    const sessionId = `e17-doc-summary-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "what is this doc about?",
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId),
      })
      .expect(200);

    const text = answerText(response.body);
    expect(text).toMatch(/Explained|Key claim|summary|artifact/i);
    expect(text).not.toBe(`You are currently on: ${activePath}`);
    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.final_answer_contract_family).toBe("summary");
    expect(response.body?.final_answer_contract_pass).toBe(true);
    expect(response.body?.turn_truth_table?.terminal?.contract?.family).toBe("summary");
    expect(response.body?.turn_truth_table?.terminal?.contract?.pass).toBe(true);
    expect(response.body?.agent_loop_audit?.final_answer_contract_family).toBe("summary");
    expect(response.body?.agent_loop_audit?.final_answer_contract_pass).toBe(true);
  }, 20000);

  it("rejects meta-only final answers for substantive prompts", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    const app = await createApp();
    const sessionId = `e17-meta-final-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Is this working ? [[TEST_FORCE_META_TERMINAL]]",
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId),
      })
      .expect(200);

    const text = answerText(response.body);
    expect(text).not.toMatch(/Completed reasoning for|Steps:\s*reasoning_pass/i);
    expect(response.body?.final_answer_contract_pass).toBe(true);
    expect(response.body?.final_answer_contract_repair_attempted).toBe(true);
    expect(response.body?.final_answer_contract_repair_applied).toBe(true);
    expect(response.body?.final_status).toBe("final_answer");
  }, 120000);

  it("suppresses duplicate model note mutation after note_update_receipt is already satisfied", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "1";
    process.env.HELIX_E11_MODEL_DECISION_MAX_APPENDED_STEPS = "1";
    process.env.HELIX_E11_MODEL_DECISION_TEST_RESPONSE = JSON.stringify({
      action: "continue",
      summary: "Try to create an extra note for the same located result.",
      next_capability: "workstation-notes.append_to_note",
      next_args: {
        title: "Centerline Alpha Location",
        text: "The centerline alpha location is found in the document summary lines.",
      },
      required_artifacts: ["note_update_receipt"],
    });
    const app = await createApp();
    const sessionId = `e17-duplicate-note-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "put the centerline alpha location into that note",
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId),
      })
      .expect(200);

    const modelAppendSteps = (response.body?.execution_trace ?? []).filter(
      (step: any) => step?.id?.startsWith("model_step_") && step?.action?.action_id === "append_to_note",
    );
    const noteLinks = (response.body?.job_ready_links ?? []).filter(
      (link: any) => link?.panel_id === "workstation-notes" && link?.action_id === "set_active_note",
    );
    expect(modelAppendSteps).toHaveLength(0);
    expect(noteLinks).toHaveLength(1);
    expect(noteLinks[0]?.label).toBe("Open note: quick NHM2 test note");
    expect(noteLinks[0]?.label).not.toMatch(/Centerline Alpha Location/i);
    expect(response.body?.general_controller_enabled).toBe(true);
    expect(response.body?.general_controller_decisions?.some((entry: any) => entry?.decision === "finalize")).toBe(true);
    expect(
      response.body?.general_controller_decisions?.some(
        (entry: any) => entry?.rejected_duplicate_mutation === true || /duplicate|already_satisfied/i.test(String(entry?.error_code ?? entry?.reason ?? "")),
      ) ||
        response.body?.note_location_existing_receipt_reconciled === true ||
        response.body?.note_location_route_reentry_repaired === true,
    ).toBe(true);
    expect(answerText(response.body)).toMatch(/quick NHM2 test note/i);
  }, 120000);

  it("requests user input when a deictic note target cannot be resolved", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    const app = await createApp();
    const sessionId = `e17-missing-note-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "put the centerline alpha location into that note",
        mode: "read",
        sessionId,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          activeDocPath: activePath,
          hasDocContext: true,
          hasNoteContext: false,
        },
      })
      .expect(200);

    expect(response.body?.pending_server_request?.kind).toBe("clarify");
    expect(response.body?.pending_server_request?.required_fields ?? []).toContain("note_title");
    expect(response.body?.workspace_action).toBeNull();
    expect(response.body?.general_controller_enabled).toBe(true);
    expect(response.body?.general_controller_final_decision).toBe("request_user_input");
    expectCodexParityRailTableForResponse(response.body);
  }, 45000);

  it("finalizes when required artifacts are satisfied for locate-to-note", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    const app = await createApp();
    const sessionId = `e17-finalize-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "find where centerline alpha is mentioned and put it in that note",
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId),
      })
      .expect(200);

    expect(response.body?.step_results?.some((step: any) => step?.actual_artifacts?.includes("doc_location_matches"))).toBe(true);
    expect(response.body?.step_results?.some((step: any) => step?.actual_artifacts?.includes("note_update_receipt"))).toBe(true);
    expect(response.body?.turn_runtime?.missing_required_artifacts ?? []).not.toContain("note_update_receipt");
    expect(response.body?.general_controller_enabled).toBe(true);
    expect(response.body?.general_controller_final_decision).toBe("finalize");
    expect(answerText(response.body)).toMatch(/quick NHM2 test note|Locations:/i);
    expect(response.body?.final_answer_contract_pass).toBe(true);
    expect(response.body?.turn_truth_table?.terminal?.contract?.pass).toBe(true);
  }, 120000);

  it("uses a real doc_summary artifact when summarizing the active doc into the active note", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "1";
    process.env.HELIX_E11_MODEL_DECISION_MAX_APPENDED_STEPS = "1";
    process.env.HELIX_E11_MODEL_DECISION_TEST_RESPONSE = JSON.stringify({
      action: "continue",
      summary: "Append the requested document summary to the note.",
      next_capability: "workstation-notes.append_to_note",
      next_args: {
        title: "quick NHM2 test note",
        text: "Summarize the key points from the document.",
      },
      required_artifacts: ["note_update_receipt"],
    });
    const app = await createApp();
    const sessionId = `e17-summary-note-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "okay summarize in this note about the doc",
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId),
      })
      .expect(200);

    const noteReceipt = (response.body?.step_results ?? [])
      .map((step: any) => step?.result_artifact)
      .find((artifact: any) => artifact?.kind === "note_update_receipt");

    expect(response.body?.step_results?.some((step: any) => step?.actual_artifacts?.includes("doc_summary"))).toBe(true);
    expect(noteReceipt?.title).toBe("quick NHM2 test note");
    expect(noteReceipt?.text_kind).toBe("doc_summary");
    expect(String(noteReceipt?.text ?? "")).toMatch(/Explained|Key claim/i);
    expect(String(noteReceipt?.text ?? "")).not.toBe("Summarize the key points from the document.");
    expect(
      (response.body?.execution_trace ?? []).filter(
        (step: any) => step?.id?.startsWith("model_step_") && step?.action?.action_id === "append_to_note",
      ),
    ).toHaveLength(0);
    expect(answerText(response.body)).toMatch(/quick NHM2 test note|summary/i);
    expect(response.body?.final_answer_contract_pass).toBe(true);
  }, 20000);

  it("marks contradicted no-location model commentary as superseded when a later tool finds locations", async () => {
    const app = await createApp();
    const sessionId = `e17-superseded-${Date.now()}`;

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "where does this document mention centerline alpha?",
        mode: "read",
        sessionId,
        workspace_context_snapshot: baseWorkspace(sessionId),
        debug: true,
      })
      .expect(200);

    const events = response.body?.turn_transcript_events ?? [];
    const superseded = events.find(
      (event: any) =>
        event?.type === "model_decision" &&
        event?.status === "superseded" &&
        /No mentions|not found|could not find|could not locate/i.test(String(event?.text ?? "")),
    );
    expect(response.body?.step_results?.some((step: any) => step?.actual_artifacts?.includes("doc_location_matches"))).toBe(true);
    if (superseded) {
      expect(superseded?.superseded_by_step_id).toBeTruthy();
      expect(String(superseded?.superseded_reason ?? "")).toMatch(/doc_location_matches/i);
    }
    expect(answerText(response.body)).toMatch(/Locations:/i);
    expect(answerText(response.body)).not.toMatch(/No mentions/i);
  }, 120000);
});
