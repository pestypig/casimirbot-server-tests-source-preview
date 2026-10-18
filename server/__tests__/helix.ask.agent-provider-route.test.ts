import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import {
  attachHelixProviderPreflightRouteContext,
  planRouter,
} from "../routes/agi.plan";
import { helixRuntimeGoalSessionStore } from "../services/helix-ask/agent-providers/goal-runtime-session";

const originalEnableCodexAgent = process.env.ENABLE_CODEX_AGENT;
const originalEnableFutureAgent = process.env.ENABLE_FUTURE_AGENT;
const originalCodexFakeStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
const originalCodexFakeStderr = process.env.CODEX_AGENT_FAKE_STDERR;
const originalCodexFakeExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;
const originalCodexFakeStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
const originalCodexFakeCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
const originalCodexBin = process.env.CODEX_BIN;

afterEach(() => {
  helixRuntimeGoalSessionStore.clear();
  if (originalEnableCodexAgent === undefined) {
    delete process.env.ENABLE_CODEX_AGENT;
  } else {
    process.env.ENABLE_CODEX_AGENT = originalEnableCodexAgent;
  }
  if (originalEnableFutureAgent === undefined) {
    delete process.env.ENABLE_FUTURE_AGENT;
  } else {
    process.env.ENABLE_FUTURE_AGENT = originalEnableFutureAgent;
  }
  if (originalCodexFakeStdout === undefined) {
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
  } else {
    process.env.CODEX_AGENT_FAKE_STDOUT = originalCodexFakeStdout;
  }
  if (originalCodexFakeStderr === undefined) {
    delete process.env.CODEX_AGENT_FAKE_STDERR;
  } else {
    process.env.CODEX_AGENT_FAKE_STDERR = originalCodexFakeStderr;
  }
  if (originalCodexFakeExitCode === undefined) {
    delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
  } else {
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = originalCodexFakeExitCode;
  }
  if (originalCodexFakeStdoutSequence === undefined) {
    delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
  } else {
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = originalCodexFakeStdoutSequence;
  }
  if (originalCodexFakeCallIndex === undefined) {
    delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
  } else {
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = originalCodexFakeCallIndex;
  }
  if (originalCodexBin === undefined) {
    delete process.env.CODEX_BIN;
  } else {
    process.env.CODEX_BIN = originalCodexBin;
  }
});

const createApp = () => {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/agi", planRouter);
  return app;
};

const parseSseEvents = (text: string): Array<{ event: string; data: Record<string, unknown> }> =>
  text
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const event = block
        .split(/\n/)
        .find((line) => line.startsWith("event:"))
        ?.slice("event:".length)
        .trim() ?? "";
      const dataText = block
        .split(/\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
        .join("\n");
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(dataText);
      } catch {
        data = {};
      }
      return { event, data };
    });

describe("Helix Ask agent provider route metadata", () => {
  it("preflights a natural continuation against the valid active document", () => {
    const turnId = "ask:test:active-doc-natural-followup";
    const result = attachHelixProviderPreflightRouteContext({
      turnId,
      body: {
        turn_id: turnId,
        sessionId: "thread:active-doc-natural-followup",
        question: "What is the main idea?",
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          activeDocPath: "docs/research/nhm2-current-status-whitepaper.md",
          hasDocContext: true,
        },
      },
    });

    expect(result.active_workspace_source_resolution).toMatchObject({
      resolved_source_target: "active_doc",
      reason: "active_doc_evidence_followup",
      active_doc_path: "docs/research/nhm2-current-status-whitepaper.md",
    });
    expect(result.source_target_intent).toMatchObject({
      target_source: "active_doc",
      target_kind: "active_doc",
      strength: "hard",
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
      precedence_reason: "active_doc_evidence_followup_source_target",
    });
    expect(result.canonical_goal_frame).toBeUndefined();
  });

  it("preflights an affirmative theory procedure as grounded synthesis instead of model-only chat", () => {
    const turnId = "ask:test:theory-procedure-preflight";
    const prompt =
      "Prepare a theory experiment procedure for badge study.casimir_dp.evidence_map_stage3, but configure Lanyon for an unregistered two-dimensional adaptive-mesh advection-diffusion case. Do not improvise support or run code; give the exact typed limitation and missing requirements.";
    const affirmative = attachHelixProviderPreflightRouteContext({
      turnId,
      body: { turn_id: turnId, question: prompt },
    });
    const canonicalGoal = affirmative.canonical_goal_frame as Record<string, unknown>;

    expect(canonicalGoal).toMatchObject({
      schema: "helix.canonical_goal_frame.v1",
      turn_id: turnId,
      goal_kind: "theory_context_reflection",
      answer_scope: "current_turn_action",
      requested_capability: "theory-experiment-procedure.prepare",
      required_terminal_kind: "model_synthesized_answer",
      allows_workspace_context: true,
      allows_prior_artifacts: false,
      classifier_reasons: expect.arrayContaining([
        "provider_preflight_explicit_capability_contract",
        "affirmative_theory_experiment_procedure",
      ]),
    });
    expect(canonicalGoal.goal_kind).not.toBe("model_only_concept");
    expect(canonicalGoal.required_terminal_kind).not.toBe("direct_answer_text");

    const deferred = attachHelixProviderPreflightRouteContext({
      turnId: `${turnId}:future`,
      body: {
        turn_id: `${turnId}:future`,
        question:
          "Later we may prepare the theory experiment procedure for Lanyon after review; explain the idea now.",
      },
    });
    expect(deferred.canonical_goal_frame).toMatchObject({
      goal_kind: "model_only_concept",
      answer_scope: "model_only",
      required_terminal_kind: "direct_answer_text",
    });
  });

  it("defers a hard visual source request to the solver instead of stamping it model-only", () => {
    const turnId = "ask:test:visual-source-preflight";
    const result = attachHelixProviderPreflightRouteContext({
      turnId,
      body: {
        turn_id: turnId,
        sessionId: "thread:visual-source-preflight",
        question: "What is happening right now in the visual screen capture?",
      },
    });

    expect(result.source_target_intent).toMatchObject({
      target_source: "visual_capture",
      target_kind: "visual_capture",
      strength: "hard",
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
    });
    expect(result.canonical_goal_frame).toMatchObject({
      goal_kind: "visual_capture_describe",
      answer_scope: "workspace_state",
      requested_capability: "situation-room.describe_visual_capture",
      required_terminal_kind: "model_synthesized_answer",
      classifier_reasons: expect.arrayContaining([
        "visual_capture_describe_contract_intent",
        "provider_visual_source_requires_runtime_observation_reentry",
      ]),
    });
    expect(result.route_product_contract).toMatchObject({
      source_target: "visual_capture",
      required_terminal_kind: "model_synthesized_answer",
      evidence_reentry_required: true,
      followup_reasoning_required: true,
    });
  });

  it.each([
    "Do not inspect the visual screen capture; explain that phrase normally without tools.",
    "Yesterday I asked you to inspect the visual screen capture; explain why that request was useful without tools.",
    "Later we may inspect the visual screen capture; explain the idea now without tools.",
    "The screen says 'inspect the visual screen capture'; explain the quoted text without tools.",
  ])("keeps contextual visual language model-only during provider preflight: %s", (question) => {
    const turnId = `ask:test:visual-context:${question.length}`;
    const result = attachHelixProviderPreflightRouteContext({
      turnId,
      body: { turn_id: turnId, question },
    });

    expect(result.canonical_goal_frame).toMatchObject({
      goal_kind: "model_only_concept",
      answer_scope: "model_only",
      required_terminal_kind: "direct_answer_text",
    });
  });

  it("binds workstation capability questions to current runtime catalog evidence during provider preflight", () => {
    const turnId = "ask:test:provider-capability-help-preflight";
    const result = attachHelixProviderPreflightRouteContext({
      turnId,
      body: {
        turn_id: turnId,
        question:
          "What can this workstation do with a scientific document I have open? Keep it short.",
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          active_doc_path: "docs/research/example.md",
        },
      },
    });

    expect(result.source_target_intent).toMatchObject({
      target_source: "capability_catalog",
      target_kind: "capability_catalog_runtime",
      selected_capability: "helix_ask.inspect_capability_catalog",
      strength: "hard",
    });
    expect(result.canonical_goal_frame).toMatchObject({
      goal_kind: "capability_help",
      requested_capability: "helix_ask.inspect_capability_catalog",
      required_terminal_kind: "capability_help_summary",
    });
    expect(result.route_product_contract).toMatchObject({
      source_target: "capability_catalog",
      required_terminal_kind: "capability_help_summary",
      evidence_reentry_required: true,
      followup_reasoning_required: true,
    });
    expect(result.tool_call_admission_decision).toMatchObject({
      required: true,
      admitted_tool_families: expect.arrayContaining([
        "capability_catalog",
        "runtime_evidence",
      ]),
    });
    expect(result.committed_ask_route).toMatchObject({
      route: {
        source_target: "capability_catalog",
        target_kind: "capability_catalog",
        strength: "hard",
      },
      canonical_goal: {
        goal_kind: "capability_help",
        required_terminal_kind: "capability_help_summary",
      },
      capability_policy: {
        allowed_tool_families: ["capability_catalog"],
        required_capability_families: ["capability_catalog"],
      },
      terminal_product: {
        evidence_reentry_required: true,
        followup_reasoning_required: true,
        required_terminal_product: "capability_help_summary",
      },
    });
  });

  it("rejects the Helix-native runtime for a guest account", async () => {
    const priorBypass = process.env.HELIX_ASK_TEST_RUNTIME_POLICY_BYPASS;
    process.env.HELIX_ASK_TEST_RUNTIME_POLICY_BYPASS = "0";
    try {
      const response = await request(createApp())
        .post("/api/agi/ask/turn")
        .send({
          agent_runtime: "helix",
          turn_id: "ask:test:guest-helix-runtime-policy",
          question: "Hello",
        })
        .expect(403);

      expect(response.body).toMatchObject({
        ok: false,
        error: "runtime_agent_locked_by_account_policy",
        terminal_error_code: "runtime_agent_locked_by_account_policy",
        blocked_reason: "runtime_agent_outside_account_policy",
        agent_runtime: "helix",
        selected_agent_provider: "helix",
        response_type: "typed_failure",
        final_status: "final_failure",
        account_policy: {
          account_type: "user",
          allowed_runtime_agents: ["codex"],
        },
      });
    } finally {
      if (priorBypass === undefined) {
        delete process.env.HELIX_ASK_TEST_RUNTIME_POLICY_BYPASS;
      } else {
        process.env.HELIX_ASK_TEST_RUNTIME_POLICY_BYPASS = priorBypass;
      }
    }
  });

  it("rejects the Helix-native stream runtime for a guest account", async () => {
    const priorBypass = process.env.HELIX_ASK_TEST_RUNTIME_POLICY_BYPASS;
    process.env.HELIX_ASK_TEST_RUNTIME_POLICY_BYPASS = "0";
    try {
      const response = await request(createApp())
        .post("/api/agi/ask/turn/stream")
        .send({
          agent_runtime: "helix",
          turn_id: "ask:test:guest-helix-stream-runtime-policy",
          question: "Hello",
        })
        .expect(200);
      const finalEvent = parseSseEvents(response.text).find((entry) => entry.event === "turn_final");

      expect(finalEvent?.data).toMatchObject({
        ok: false,
        error: "runtime_agent_locked_by_account_policy",
        terminal_error_code: "runtime_agent_locked_by_account_policy",
        blocked_reason: "runtime_agent_outside_account_policy",
        agent_runtime: "helix",
        selected_agent_provider: "helix",
        response_type: "typed_failure",
        final_status: "final_failure",
        account_policy: {
          account_type: "user",
          allowed_runtime_agents: ["codex"],
        },
      });
    } finally {
      if (priorBypass === undefined) {
        delete process.env.HELIX_ASK_TEST_RUNTIME_POLICY_BYPASS;
      } else {
        process.env.HELIX_ASK_TEST_RUNTIME_POLICY_BYPASS = priorBypass;
      }
    }
  });

  it("carries named Image Lens receipt terminal authority through the stream final payload", async () => {
    process.env.ENABLE_CODEX_AGENT = "1";
    const turnId = "ask:test:named-image-lens-receipt-stream-terminal";
    const response = await request(createApp())
      .post("/api/agi/ask/turn/stream")
      .send({
        agent_runtime: "codex",
        turn_id: turnId,
        question:
          "Do not rerender, refetch, or run another crop. Use only the latest Image Lens observation receipt named equation_47. Return exactly: source ID; page number; bbox; capture mode; label-match status; exact-block promotion status and reasons.",
        route_metadata: {
          source: "hard_backend_entrypoint_policy",
          source_target_intent: {
            target_source: "scientific_image_evidence",
            target_kind: "scientific_image_named_receipt",
            must_enter_backend_ask: true,
            allow_client_shortcut: false,
            allow_no_tool_direct: false,
            requested_outputs: ["image_lens_named_receipt_evaluation", "typed_failure"],
          },
        },
        debug: true,
      })
      .expect(200);
    const finalEvent = parseSseEvents(response.text).find((entry) => entry.event === "turn_final");

    expect(finalEvent?.data).toMatchObject({
      turn_id: turnId,
      final_answer_source: "image_lens_named_receipt_evaluation",
      terminal_artifact_kind: "image_lens_named_receipt_evaluation",
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        server_authoritative: true,
        final_answer_source: "image_lens_named_receipt_evaluation",
        terminal_artifact_kind: "image_lens_named_receipt_evaluation",
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        final_answer_source: "image_lens_named_receipt_evaluation",
        terminal_artifact_kind: "image_lens_named_receipt_evaluation",
      },
      route_evidence_authority: {
        schema: "helix.route_evidence_authority.v1",
        allowed_terminal_artifact_kinds: expect.arrayContaining([
          "image_lens_named_receipt_evaluation",
          "typed_failure",
        ]),
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        required_terminal_kind: "image_lens_named_receipt_evaluation",
      },
    });
    expect(String(finalEvent?.data.selected_final_answer)).toContain(
      "named_observation_receipt_not_found_in_current_turn_context",
    );
  }, 60_000);

  it("promotes Codex launch failures into the visible response debug envelope", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "helix-codex-route-unspawnable-"));
    const candidate = path.join(tempDir, process.platform === "win32" ? "codex.exe" : "codex");
    fs.writeFileSync(candidate, "not a real executable");
    process.env.ENABLE_CODEX_AGENT = "1";
    process.env.CODEX_BIN = candidate;

    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        agent_runtime: "codex",
        turn_id: "ask:test:codex-provider-launch-failure-debug",
        question: "Codex launch failure debug smoke test.",
      })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: false,
      runtime: "codex",
      agent_runtime: "codex",
      response_type: "final_failure",
      final_status: "final_failure",
      answer: "Codex runtime is enabled but the resolved Codex CLI binary could not be spawned.",
      fail_reason: "codex_binary_not_spawnable",
      codex_bin: candidate,
      codex_runtime_status: {
        launchable: false,
        reason: "codex_binary_not_spawnable",
        resolved_bin: candidate,
      },
      debug: {
        agent_runtime: "codex",
        fail_reason: "codex_binary_not_spawnable",
        codex_bin: candidate,
        codex_runtime_status: {
          launchable: false,
          reason: "codex_binary_not_spawnable",
          resolved_bin: candidate,
        },
      },
    });
    expect(response.body.debug_export_ref).toMatchObject({
      endpoint: "/api/agi/ask/turn/ask%3Atest%3Acodex-provider-launch-failure-debug/debug-export",
      turn_id: "ask:test:codex-provider-launch-failure-debug",
    });

    const debugExport = await request(app)
      .get("/api/agi/ask/turn/ask%3Atest%3Acodex-provider-launch-failure-debug/debug-export")
      .expect(200);
    expect(debugExport.body).toMatchObject({
      ok: true,
      payload: {
        active_turn_id: "ask:test:codex-provider-launch-failure-debug",
        agent_runtime: "codex",
        fail_reason: "codex_binary_not_spawnable",
        codex_bin: candidate,
        codex_runtime_status: {
          launchable: false,
          reason: "codex_binary_not_spawnable",
          resolved_bin: candidate,
        },
      },
    });
  });

  it("returns Helix Native gateway observations without promoting them to terminal answers", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        agent_runtime: "helix",
        turn_id: "ask:test:helix-provider-gateway-route",
        workstation_gateway_call: {
          capability_id: "scientific-calculator.solve_expression",
          arguments: {
            expression: "6 * 7",
          },
        },
      })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: false,
      turn_id: "ask:test:helix-provider-gateway-route",
      runtime: "helix",
      response_type: "workstation_gateway_observation",
      final_status: "requires_provider_reasoning_reentry",
      agent_runtime: "helix",
      agent_runtime_selection_trace: {
        schema: "helix.agent_runtime_selection_trace.v1",
        route: "/ask/turn",
        requested_runtime: "helix",
        selected_runtime: "helix",
        fallback_used: false,
        workstation_gateway: {
          manifest_version: "read-observe-act.v1",
          shell_enabled: false,
          file_mutation_enabled: false,
          code_mutation_enabled: false,
        },
      },
      selected_agent_provider: {
        id: "helix",
        permission_profile: {
          id: "helix-native",
        },
      },
      workstation_gateway_manifest_version: "read-observe-act.v1",
      workstation_gateway_reentry_status: "pending_helix_solver_reentry",
      terminal_authority_status: "not_authorized_observation_only",
      workstation_gateway_call_results: [
        {
          ok: true,
          agent_runtime: "helix",
          capability_id: "scientific-calculator.solve_expression",
          gateway_admission: {
            selected_agent_provider: "helix",
            permission_profile: "read",
            admission_status: "admitted",
          },
          observation_packet: {
            status: "succeeded",
            terminal_eligible: false,
            post_tool_model_step_required: true,
            assistant_answer: false,
            raw_content_included: false,
          },
          observation: {
            schema: "helix.calculator_solve_observation.v1",
            result: "42",
          },
        },
      ],
      provider_reasoning_reentry: {
        schema: "helix.provider_reasoning_reentry.v1",
        status: "pending_helix_solver_reentry",
        provider_terminal_candidate_present: false,
        post_tool_model_step_required: true,
        evidence_reentered: false,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      terminal_authority_candidate_review: {
        schema: "helix.provider_terminal_authority_candidate_review.v1",
        terminal_authority_status: "not_authorized_observation_only",
        terminal_authority_granted: false,
        final_visible_answer_authorized: false,
        blockers: ["provider_reasoning_reentry_required"],
      },
      provider_terminal_candidate: null,
      terminal_answer_authority: null,
      terminal_presentation: null,
      final_answer_source: null,
      terminal_artifact_kind: null,
      provider_gateway_debug_summary: {
        schema: "helix.provider_gateway_debug_summary.v1",
        turn_id: "ask:test:helix-provider-gateway-route",
        route: "/ask/turn",
        prompt: null,
        selected_provider: "helix",
        fallback_used: false,
        capability_manifest_version: "read-observe-act.v1",
        requested_capabilities: ["scientific-calculator.solve_expression"],
        admitted_capabilities: ["scientific-calculator.solve_expression"],
        blocked_capabilities: [],
        executed_capabilities: ["scientific-calculator.solve_expression"],
        evidence_reentry_status: "pending_helix_solver_reentry",
        terminal_candidate_present: false,
        terminal_authority_result: "not_authorized_observation_only",
        terminal_authority_granted: false,
        final_visible_answer_authorized: false,
        final_answer_source: null,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      debug: {
        turn_id: "ask:test:helix-provider-gateway-route",
        agent_runtime: "helix",
        workstation_gateway_manifest_version: "read-observe-act.v1",
        terminal_authority_status: "not_authorized_observation_only",
        terminal_answer_authority: null,
      },
    });
    expect(response.body.workstation_gateway_capability_ids).toContain("scientific-calculator.solve_expression");
    expect(response.body.debug_export_ref).toMatchObject({
      endpoint: "/api/agi/ask/turn/ask%3Atest%3Ahelix-provider-gateway-route/debug-export",
      turn_id: "ask:test:helix-provider-gateway-route",
    });
    const debugExport = await request(app)
      .get("/api/agi/ask/turn/ask%3Atest%3Ahelix-provider-gateway-route/debug-export")
      .expect(200);
    expect(debugExport.body).toMatchObject({
      ok: true,
      payload: {
        active_turn_id: "ask:test:helix-provider-gateway-route",
        response_type: "workstation_gateway_observation",
        final_status: "requires_provider_reasoning_reentry",
        terminal_authority_status: "not_authorized_observation_only",
        workstation_gateway_reentry_status: "pending_helix_solver_reentry",
        workstation_gateway_observation_packets: [
          {
            status: "succeeded",
            terminal_eligible: false,
            post_tool_model_step_required: true,
            assistant_answer: false,
            raw_content_included: false,
          },
        ],
        provider_reasoning_reentry: {
          schema: "helix.provider_reasoning_reentry.v1",
          status: "pending_helix_solver_reentry",
        },
        terminal_authority_candidate_review: {
          schema: "helix.provider_terminal_authority_candidate_review.v1",
          terminal_authority_granted: false,
        },
        provider_gateway_debug_summary: {
          schema: "helix.provider_gateway_debug_summary.v1",
          selected_provider: "helix",
          requested_capabilities: ["scientific-calculator.solve_expression"],
          admitted_capabilities: ["scientific-calculator.solve_expression"],
          executed_capabilities: ["scientific-calculator.solve_expression"],
          terminal_authority_result: "not_authorized_observation_only",
          final_answer_source: null,
        },
      },
    });
  });

  it("emits Helix Native gateway observations in stream final events without terminal authority", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn/stream")
      .send({
        agent_runtime: "helix",
        turn_id: "ask:test:helix-provider-gateway-stream",
        question: "Use the gateway observation.",
        workstation_gateway_call: {
          capability_id: "scientific-calculator.solve_expression",
          arguments: {
            expression: "9 * 9",
          },
        },
      })
      .expect(200);
    const finalEvent = parseSseEvents(response.text).find((entry) => entry.event === "turn_final");

    expect(finalEvent?.data).toMatchObject({
      ok: false,
      turn_id: "ask:test:helix-provider-gateway-stream",
      runtime: "helix",
      response_type: "workstation_gateway_observation",
      final_status: "requires_provider_reasoning_reentry",
      agent_runtime: "helix",
      agent_runtime_selection_trace: {
        schema: "helix.agent_runtime_selection_trace.v1",
        route: "/ask/turn/stream",
        selected_runtime: "helix",
      },
      workstation_gateway_manifest_version: "read-observe-act.v1",
      workstation_gateway_reentry_status: "pending_helix_solver_reentry",
      terminal_authority_status: "not_authorized_observation_only",
      workstation_gateway_call_results: [
        {
          ok: true,
          agent_runtime: "helix",
          capability_id: "scientific-calculator.solve_expression",
          observation_packet: {
            status: "succeeded",
            terminal_eligible: false,
            post_tool_model_step_required: true,
            assistant_answer: false,
            raw_content_included: false,
          },
          observation: {
            schema: "helix.calculator_solve_observation.v1",
            result: "81",
          },
        },
      ],
      terminal_authority_candidate_review: {
        schema: "helix.provider_terminal_authority_candidate_review.v1",
        terminal_authority_granted: false,
        final_visible_answer_authorized: false,
        blockers: ["provider_reasoning_reentry_required"],
      },
      provider_gateway_debug_summary: {
        schema: "helix.provider_gateway_debug_summary.v1",
        turn_id: "ask:test:helix-provider-gateway-stream",
        route: "/ask/turn/stream",
        prompt: "Use the gateway observation.",
        selected_provider: "helix",
        requested_capabilities: ["scientific-calculator.solve_expression"],
        admitted_capabilities: ["scientific-calculator.solve_expression"],
        executed_capabilities: ["scientific-calculator.solve_expression"],
        evidence_reentry_status: "pending_helix_solver_reentry",
        terminal_authority_result: "not_authorized_observation_only",
        final_answer_source: null,
      },
      terminal_answer_authority: null,
      terminal_presentation: null,
      final_answer_source: null,
      terminal_artifact_kind: null,
      debug: {
        turn_id: "ask:test:helix-provider-gateway-stream",
        agent_runtime: "helix",
        terminal_authority_status: "not_authorized_observation_only",
        terminal_answer_authority: null,
      },
    });
    expect(finalEvent?.data.debug_export_ref).toMatchObject({
      endpoint: "/api/agi/ask/turn/ask%3Atest%3Ahelix-provider-gateway-stream/debug-export",
      turn_id: "ask:test:helix-provider-gateway-stream",
    });
    const debugExport = await request(app)
      .get("/api/agi/ask/turn/ask%3Atest%3Ahelix-provider-gateway-stream/debug-export")
      .expect(200);
    expect(debugExport.body).toMatchObject({
      ok: true,
      payload: {
        active_turn_id: "ask:test:helix-provider-gateway-stream",
        response_type: "workstation_gateway_observation",
        final_status: "requires_provider_reasoning_reentry",
        terminal_authority_status: "not_authorized_observation_only",
        workstation_gateway_reentry_status: "pending_helix_solver_reentry",
        workstation_gateway_observation_packets: [
          {
            status: "succeeded",
            terminal_eligible: false,
            post_tool_model_step_required: true,
            assistant_answer: false,
            raw_content_included: false,
          },
        ],
        provider_reasoning_reentry: {
          schema: "helix.provider_reasoning_reentry.v1",
          status: "pending_helix_solver_reentry",
        },
        terminal_authority_candidate_review: {
          schema: "helix.provider_terminal_authority_candidate_review.v1",
          terminal_authority_granted: false,
        },
        provider_gateway_debug_summary: {
          schema: "helix.provider_gateway_debug_summary.v1",
          selected_provider: "helix",
          prompt: "Use the gateway observation.",
          requested_capabilities: ["scientific-calculator.solve_expression"],
          admitted_capabilities: ["scientific-calculator.solve_expression"],
          executed_capabilities: ["scientific-calculator.solve_expression"],
          terminal_authority_result: "not_authorized_observation_only",
          final_answer_source: null,
        },
      },
    });
  });

  it("does not route plain Helix stream prompts into planner-derived provider gateway observations", async () => {
    const response = await request(createApp())
      .post("/api/agi/ask/turn/stream")
      .send({
        turn_id: "ask:test:plain-helix-stream-no-provider-gateway",
        question: "Open the NHM-2 white paper from the docs.",
        mode: "read",
        debug: true,
      })
      .expect(200);
    const finalEvent = parseSseEvents(response.text).find((entry) => entry.event === "turn_final");

    expect(finalEvent?.data).toBeTruthy();
    expect(finalEvent?.data.agent_runtime).not.toBe("helix");
    expect(finalEvent?.data.response_type).not.toBe("workstation_gateway_observation");
    expect(finalEvent?.data.final_status).not.toBe("requires_provider_reasoning_reentry");
    expect(finalEvent?.data.workstation_gateway_call_results).toBeUndefined();
    expect(finalEvent?.data.route_authority_audit).toBeTruthy();
    expect(finalEvent?.data.ask_turn_solver_trace).toBeTruthy();
    expect(finalEvent?.data.goal_satisfaction_evaluation).toBeTruthy();
    expect(finalEvent?.data.solver_controller_decision).toBeTruthy();
  }, 60_000);

  it("keeps Codex stream capability questions on the Helix-owned capability-help route", async () => {
    const response = await request(createApp())
      .post("/api/agi/ask/turn/stream")
      .send({
        agent_runtime: "codex",
        turn_id: "ask:test:codex-stream-capability-help-precedence",
        question:
          "Does your research-paper tool select papers it can parse, or does it first check which papers are openable and then use Image Lens when visual extraction is needed?",
        mode: "read",
        debug: true,
      })
      .expect(200);
    const finalEvent = parseSseEvents(response.text).find((entry) => entry.event === "turn_final");

    expect(finalEvent?.data).toMatchObject({
      terminal_artifact_kind: "capability_help_summary",
      final_answer_source: "capability_help_summary",
      final_answer_contract_family: "capability_help",
      final_answer_contract_pass: true,
    });
    expect(String(finalEvent?.data.selected_final_answer ?? finalEvent?.data.answer ?? ""))
      .toContain("scholarly-research.lookup_papers");
    expect(finalEvent?.data.solver_controller_decision).toMatchObject({ decision: "allow_terminal" });
  }, 60_000);

  it("keeps Codex non-stream capability questions on the Helix-owned capability-help route", async () => {
    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        agent_runtime: "codex",
        turn_id: "ask:test:codex-capability-help-precedence",
        question:
          "Does your research-paper tool select papers it can parse, or does it first check which papers are openable and then use Image Lens when visual extraction is needed?",
        mode: "read",
        debug: true,
      })
      .expect(200);

    expect(response.body).toMatchObject({
      terminal_artifact_kind: "capability_help_summary",
      final_answer_source: "capability_help_summary",
      final_answer_contract_family: "capability_help",
      final_answer_contract_pass: true,
    });
    expect(String(response.body.selected_final_answer ?? response.body.answer ?? ""))
      .toContain("scholarly-research.lookup_papers");
    expect(response.body.solver_controller_decision).toMatchObject({ decision: "allow_terminal" });
  }, 60_000);

  it("routes selected Helix Native calculator prompts through planner-derived gateway observations", async () => {
    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        agent_runtime: "helix",
        turn_id: "ask:test:helix-provider-planner-gateway-route",
        question: "Use the scientific calculator to evaluate 6 * 7 and explain the result.",
      })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      response_type: "final_answer",
      final_status: "final_answer",
      final_answer_source: "workstation_tool_evaluation",
      terminal_artifact_kind: "workstation_tool_evaluation",
      terminal_answer_authority: {
        server_authoritative: true,
        final_answer_source: "workstation_tool_evaluation",
        terminal_artifact_kind: "workstation_tool_evaluation",
      },
    });
    expect(response.body.selected_final_answer).toContain("Result: 42");
  });

  it("routes selected Codex calculator prompts through the same planner-derived gateway before provider text", async () => {
    process.env.ENABLE_CODEX_AGENT = "1";
    process.env.CODEX_AGENT_FAKE_STDOUT = "The planner-derived calculator observation reports 42.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        agent_runtime: "codex",
        thread_id: "thread:test:codex-provider-planner-gateway-route",
        turn_id: "ask:test:codex-provider-planner-gateway-route",
        question: "Use the scientific calculator to evaluate 6 * 7 and explain the result.",
      })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      runtime: "codex",
      agent_runtime: "codex",
      text: "The planner-derived calculator observation reports 42.",
      workstation_gateway_reentry_status: "completed",
      terminal_authority_status: "authorized_by_terminal_authority_single_writer",
      provider_reasoning_reentry: { status: "completed", evidence_reentered: true },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        final_answer_source: "workstation_tool_evaluation",
        terminal_artifact_kind: "workstation_tool_evaluation",
        server_authoritative: true,
      },
    });
    expect(response.body.workstation_gateway_call_results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability_id: "scientific-calculator.solve_expression",
        observation: expect.objectContaining({ result: "42" }),
      }),
    ]));
  });

  it("routes selected Helix Native structured repo admission through repo.search gateway observations", async () => {
    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        agent_runtime: "helix",
        turn_id: "ask:test:helix-provider-structured-repo-gateway-route",
        question: "Where is workspace_os.status implemented?",
        source_target_intent: {
          schema: "helix.ask_source_target_intent.v1",
          source_target: "repo_code",
          target_source: "repo_code",
          selected_capability: "repo-code.search_concept",
          args: {
            query: "workspace_os.status",
            paths: ["server/services/helix-ask"],
          },
        },
      })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      response_type: "final_answer",
      final_answer_source: "repo_code_evidence_answer",
      terminal_artifact_kind: "repo_code_evidence_answer",
      repo_code_evidence_observation: {
        schema: "helix.repo_code_evidence_observation.v1",
        concept: "workspace_os.status",
        selected_paths: expect.arrayContaining([
          expect.stringMatching(/^server\/services\/helix-ask\//),
        ]),
        assistant_answer: false,
        raw_content_included: false,
      },
      terminal_answer_authority: {
        server_authoritative: true,
        final_answer_source: "repo_code_evidence_answer",
        terminal_artifact_kind: "repo_code_evidence_answer",
      },
    });
    expect(response.body.repo_code_evidence_observation.match_count).toBeGreaterThan(0);
    expect(response.body.repo_code_evidence_observation.selected_paths).toEqual(
      expect.arrayContaining([expect.stringMatching(/^server\/services\/helix-ask\//)]),
    );
    expect(response.body.selected_final_answer).not.toContain("Workspace OS status completed");
  });

  it("routes selected Codex structured docs admission through docs.search before provider text", async () => {
    process.env.ENABLE_CODEX_AGENT = "1";
    process.env.CODEX_AGENT_FAKE_STDOUT = "The structured docs observation found Helix Ask evidence.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        agent_runtime: "codex",
        thread_id: "thread:test:codex-provider-structured-docs-gateway-route",
        turn_id: "ask:test:codex-provider-structured-docs-gateway-route",
        question: "Locate the Helix Ask rule in docs.",
        route_metadata: {
          schema: "helix.ask.route_metadata.v1",
          source_target: "docs_viewer",
          source_target_intent: {
            schema: "helix.ask_source_target_intent.v1",
            source_target: "docs_viewer",
            target_source: "docs_viewer",
            mandatory_next_tool: {
              tool_name: "docs-viewer.locate_in_doc",
              selected_capability: "docs-viewer.locate_in_doc",
              args: {
                query: "Helix Ask",
                paths: ["docs"],
              },
            },
          },
        },
      })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      runtime: "codex",
      agent_runtime: "codex",
      text: "The structured docs observation found Helix Ask evidence.",
      workstation_gateway_call_results: [
        {
          ok: true,
          agent_runtime: "codex",
          capability_id: "docs.search",
          gateway_admission: {
            selected_agent_provider: "codex",
            permission_profile: "read",
            admission_status: "admitted",
            source_target_intent: {
              source: "helix_structured_source_target_admission",
              selected_capability: "docs-viewer.locate_in_doc",
            },
          },
          observation: {
            schema: "helix.docs_search_observation.v1",
            query: "Helix Ask",
            terminal_eligible: false,
            assistant_answer: false,
            raw_content_included: false,
          },
          observation_packet: {
            terminal_eligible: false,
            post_tool_model_step_required: true,
            assistant_answer: false,
            raw_content_included: false,
          },
        },
      ],
      provider_reasoning_reentry: {
        status: "completed",
        evidence_reentered: true,
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        final_answer_source: "final_answer_draft",
        terminal_artifact_kind: "model_synthesized_answer",
        server_authoritative: true,
      },
    });
  }, 60_000);

  it("returns provider and gateway debug metadata for selected Codex failures", async () => {
    process.env.ENABLE_CODEX_AGENT = "1";
    process.env.CODEX_AGENT_FAKE_STDOUT = "";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "1";

    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        agent_runtime: "codex",
        turn_id: "ask:test:codex-provider-route",
        workstation_gateway_call: {
          capability_id: "scientific-calculator.solve_expression",
          arguments: {
            expression: "3 * 9",
          },
        },
      })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      runtime: "codex",
      agent_runtime: "codex",
      text: "27",
      final_answer_source: "workstation_tool_evaluation",
      terminal_artifact_kind: "workstation_tool_evaluation",
      workstation_gateway_manifest_version: "read-observe-act.v1",
      terminal_answer_authority: {
        server_authoritative: true,
        final_answer_source: "workstation_tool_evaluation",
        terminal_artifact_kind: "workstation_tool_evaluation",
      },
      provider_gateway_debug_summary: {
        schema: "helix.provider_gateway_debug_summary.v1",
        selected_provider: "codex",
        capability_manifest_version: "read-observe-act.v1",
        terminal_authority_result: "authorized_by_terminal_authority_single_writer",
        final_answer_source: "workstation_tool_evaluation",
      },
    });
    expect(response.body.workstation_gateway_call_results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability_id: "scientific-calculator.solve_expression",
        observation: expect.objectContaining({ result: "27" }),
      }),
    ]));
    expect(response.body.workstation_gateway_capability_ids).toContain("workspace_os.status");
    expect(response.body.workstation_gateway_capability_ids).toContain("docs.search");
  });

  it("routes enabled future providers through the same Ask gateway contract", async () => {
    process.env.ENABLE_FUTURE_AGENT = "1";

    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        agent_runtime: "future",
        turn_id: "ask:test:future-provider-route",
        workstation_gateway_call: {
          capability_id: "scientific-calculator.solve_expression",
          arguments: {
            expression: "8 * 8",
          },
        },
      })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: false,
      turn_id: "ask:test:future-provider-route",
      runtime: "future",
      response_type: "workstation_gateway_observation",
      final_status: "requires_provider_reasoning_reentry",
      agent_runtime: "future",
      agent_runtime_selection_trace: {
        schema: "helix.agent_runtime_selection_trace.v1",
        route: "/ask/turn",
        requested_runtime: "future",
        selected_runtime: "future",
        fallback_used: false,
        workstation_gateway: {
          manifest_version: "read-observe-act.v1",
          shell_enabled: false,
          file_mutation_enabled: false,
          code_mutation_enabled: false,
        },
      },
      selected_agent_provider: {
        id: "future",
        label: "Future Agent Wrapper",
        permission_profile: {
          id: "read-observe",
          allows: {
            read: true,
            write: false,
            shell: false,
            codeMutation: false,
          },
        },
      },
      workstation_gateway_manifest_version: "read-observe-act.v1",
      workstation_gateway_reentry_status: "pending_helix_solver_reentry",
      terminal_authority_status: "not_authorized_observation_only",
      workstation_gateway_call_results: [
        {
          ok: true,
          agent_runtime: "future",
          capability_id: "scientific-calculator.solve_expression",
          gateway_admission: {
            selected_agent_provider: "future",
            permission_profile: "read",
            admission_status: "admitted",
          },
          observation_packet: {
            status: "succeeded",
            terminal_eligible: false,
            post_tool_model_step_required: true,
            assistant_answer: false,
            raw_content_included: false,
          },
          observation: {
            schema: "helix.calculator_solve_observation.v1",
            result: "64",
          },
        },
      ],
      provider_reasoning_reentry: {
        status: "pending_helix_solver_reentry",
        provider_terminal_candidate_present: false,
        post_tool_model_step_required: true,
        evidence_reentered: false,
      },
      terminal_authority_candidate_review: {
        terminal_authority_status: "not_authorized_observation_only",
        terminal_authority_granted: false,
        final_visible_answer_authorized: false,
        blockers: ["provider_reasoning_reentry_required"],
      },
      provider_terminal_candidate: null,
      terminal_answer_authority: null,
      final_answer_source: null,
      terminal_artifact_kind: null,
      provider_gateway_debug_summary: {
        schema: "helix.provider_gateway_debug_summary.v1",
        turn_id: "ask:test:future-provider-route",
        route: "/ask/turn",
        prompt: null,
        selected_provider: "future",
        fallback_used: false,
        capability_manifest_version: "read-observe-act.v1",
        requested_capabilities: ["scientific-calculator.solve_expression"],
        admitted_capabilities: ["scientific-calculator.solve_expression"],
        blocked_capabilities: [],
        executed_capabilities: ["scientific-calculator.solve_expression"],
        evidence_reentry_status: "pending_helix_solver_reentry",
        terminal_candidate_present: false,
        terminal_authority_result: "not_authorized_observation_only",
        terminal_authority_granted: false,
        final_visible_answer_authorized: false,
        final_answer_source: null,
      },
      debug: {
        turn_id: "ask:test:future-provider-route",
        agent_runtime: "future",
        workstation_gateway_manifest_version: "read-observe-act.v1",
        terminal_authority_status: "not_authorized_observation_only",
        terminal_answer_authority: null,
      },
    });
    expect(response.body.workstation_gateway_capability_ids).toContain("workspace_os.status");
    expect(response.body.workstation_gateway_capability_ids).toContain("docs.search");
    expect(response.body.debug_export_ref).toMatchObject({
      endpoint: "/api/agi/ask/turn/ask%3Atest%3Afuture-provider-route/debug-export",
      turn_id: "ask:test:future-provider-route",
    });
    const debugExport = await request(createApp())
      .get("/api/agi/ask/turn/ask%3Atest%3Afuture-provider-route/debug-export")
      .expect(200);
    expect(debugExport.body).toMatchObject({
      ok: true,
      payload: {
        provider_gateway_debug_summary: {
          schema: "helix.provider_gateway_debug_summary.v1",
          selected_provider: "future",
          requested_capabilities: ["scientific-calculator.solve_expression"],
          admitted_capabilities: ["scientific-calculator.solve_expression"],
          executed_capabilities: ["scientific-calculator.solve_expression"],
          evidence_reentry_status: "pending_helix_solver_reentry",
          terminal_authority_result: "not_authorized_observation_only",
          final_answer_source: null,
        },
      },
    });
  });

  it("emits provider and gateway debug metadata in stream final events", async () => {
    process.env.ENABLE_CODEX_AGENT = "1";
    process.env.CODEX_AGENT_FAKE_STDOUT = "";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "1";

    const response = await request(createApp())
      .post("/api/agi/ask/turn/stream")
      .send({
        agent_runtime: "codex",
        turn_id: "ask:test:codex-provider-stream",
        question: "",
        workstation_gateway_call: {
          capability_id: "scientific-calculator.solve_expression",
          arguments: {
            expression: "4 * 11",
          },
        },
      })
      .expect(200);
    const finalEvent = parseSseEvents(response.text).find((entry) => entry.event === "turn_final");

    expect(finalEvent?.data).toMatchObject({
      ok: true,
      runtime: "codex",
      agent_runtime: "codex",
      agent_runtime_selection_trace: {
        schema: "helix.agent_runtime_selection_trace.v1",
        route: "/ask/turn/stream",
        selected_runtime: "codex",
        workstation_gateway: {
          manifest_version: "read-observe-act.v1",
          shell_enabled: false,
          file_mutation_enabled: false,
          code_mutation_enabled: false,
        },
      },
      workstation_gateway_manifest_version: "read-observe-act.v1",
      workstation_gateway_call_results: expect.arrayContaining([
        expect.objectContaining({
          capability_id: "scientific-calculator.open_panel",
        }),
        expect.objectContaining({
          capability_id: "scientific-calculator.focus_panel",
        }),
        expect.objectContaining({
          capability_id: "scientific-calculator.solve_expression",
          observation: expect.objectContaining({ result: "44" }),
        }),
      ]),
      provider_gateway_debug_summary: {
        schema: "helix.provider_gateway_debug_summary.v1",
        turn_id: "ask:test:codex-provider-stream",
        route: "/ask/turn/stream",
        prompt: null,
        selected_provider: "codex",
        requested_capabilities: [
          "scientific-calculator.solve_expression",
          "scientific-calculator.open_panel",
          "scientific-calculator.focus_panel",
          "scientific-calculator.show_gateway_solve",
        ],
        admitted_capabilities: [
          "scientific-calculator.solve_expression",
          "scientific-calculator.open_panel",
          "scientific-calculator.focus_panel",
          "scientific-calculator.show_gateway_solve",
        ],
        executed_capabilities: [
          "scientific-calculator.solve_expression",
          "scientific-calculator.open_panel",
          "scientific-calculator.focus_panel",
          "scientific-calculator.show_gateway_solve",
        ],
        evidence_reentry_status: "not_run_text_mode_adapter",
        terminal_authority_result: "authorized_by_terminal_authority_single_writer",
        final_answer_source: "workstation_tool_evaluation",
      },
      debug: {
        agent_runtime: "codex",
        agent_runtime_selection_trace: {
          schema: "helix.agent_runtime_selection_trace.v1",
          selected_runtime: "codex",
        },
        workstation_gateway_manifest_version: "read-observe-act.v1",
        workstation_gateway_call_results: expect.arrayContaining([
          expect.objectContaining({
            ok: true,
            capability_id: "scientific-calculator.open_panel",
          }),
          expect.objectContaining({
            ok: true,
            capability_id: "scientific-calculator.focus_panel",
          }),
          expect.objectContaining({
            ok: true,
            capability_id: "scientific-calculator.solve_expression",
          }),
        ]),
        provider_gateway_debug_summary: {
          schema: "helix.provider_gateway_debug_summary.v1",
          selected_provider: "codex",
          requested_capabilities: [
            "scientific-calculator.solve_expression",
            "scientific-calculator.open_panel",
            "scientific-calculator.focus_panel",
            "scientific-calculator.show_gateway_solve",
          ],
          admitted_capabilities: [
            "scientific-calculator.solve_expression",
            "scientific-calculator.open_panel",
            "scientific-calculator.focus_panel",
            "scientific-calculator.show_gateway_solve",
          ],
          executed_capabilities: [
            "scientific-calculator.solve_expression",
            "scientific-calculator.open_panel",
            "scientific-calculator.focus_panel",
            "scientific-calculator.show_gateway_solve",
          ],
          terminal_authority_result: "authorized_by_terminal_authority_single_writer",
          final_answer_source: "workstation_tool_evaluation",
        },
      },
    });
  });

  it("preserves grounded provider calculator reasoning under workstation evaluation authority", async () => {
    process.env.ENABLE_CODEX_AGENT = "1";
    process.env.CODEX_AGENT_FAKE_STDOUT = "The calculator observation reports 21.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        agent_runtime: "codex",
        thread_id: "thread:test:codex-provider-candidate-route",
        turn_id: "ask:test:codex-provider-candidate-route",
        question: "Use the calculator observation.",
        workstation_gateway_call: {
          capability_id: "scientific-calculator.solve_expression",
          arguments: {
            expression: "3 * 7",
          },
        },
      })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      runtime: "codex",
      agent_runtime: "codex",
      text: "The calculator observation reports 21.",
      workstation_gateway_reentry_status: "completed",
      terminal_authority_status: "authorized_by_terminal_authority_single_writer",
      final_answer_source: "workstation_tool_evaluation",
      terminal_artifact_kind: "workstation_tool_evaluation",
      provider_terminal_candidate: {
        schema: "helix.agent_provider_terminal_candidate.v1",
        turn_id: "ask:test:codex-provider-candidate-route",
        agent_runtime: "codex",
        selected_agent_provider: "codex",
        source: "agent_provider_text_mode_adapter",
        candidate_text_preview: "The calculator observation reports 21.",
        grounded_in_observation_refs: expect.arrayContaining([
          expect.stringContaining("scientific-calculator.solve_expression"),
        ]),
        evidence_reentry_required: true,
        provider_reasoning_completed: true,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      provider_reasoning_reentry: {
        schema: "helix.provider_reasoning_reentry.v1",
        status: "completed",
        provider_terminal_candidate_present: true,
        evidence_reentered: true,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      terminal_authority_candidate_review: {
        schema: "helix.provider_terminal_authority_candidate_review.v1",
        terminal_authority_status: "authorized_by_helix_provider_candidate_bridge",
        terminal_authority_granted: true,
        final_visible_answer_authorized: true,
        blockers: [],
      },
      provider_terminal_authority_bridge: {
        schema: "helix.provider_terminal_authority_bridge.v1",
        route_authority_status: "provider_gateway_read_observe_contract_satisfied",
        terminal_authority_status: "authorized_by_helix_provider_candidate_bridge",
        terminal_authority_granted: true,
        final_visible_answer_authorized: true,
        final_answer_source: "agent_provider_terminal_candidate",
        terminal_artifact_kind: "agent_provider_terminal_candidate",
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        thread_id: "thread:test:codex-provider-candidate-route",
        turn_id: "ask:test:codex-provider-candidate-route",
        route: "/ask",
        terminal_kind: "tool_evaluation",
        final_answer_source: "workstation_tool_evaluation",
        terminal_artifact_kind: "workstation_tool_evaluation",
        server_authoritative: true,
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        concise_text: "The calculator observation reports 21.",
        final_answer_source: "workstation_tool_evaluation",
        terminal_artifact_kind: "workstation_tool_evaluation",
      },
      provider_gateway_debug_summary: {
        schema: "helix.provider_gateway_debug_summary.v1",
        turn_id: "ask:test:codex-provider-candidate-route",
        route: "/ask/turn",
        prompt: "Use the calculator observation.",
        selected_provider: "codex",
        fallback_used: false,
        capability_manifest_version: "read-observe-act.v1",
        requested_capabilities: [
          "scientific-calculator.solve_expression",
          "scientific-calculator.open_panel",
          "scientific-calculator.focus_panel",
          "scientific-calculator.show_gateway_solve",
        ],
        admitted_capabilities: [
          "scientific-calculator.solve_expression",
          "scientific-calculator.open_panel",
          "scientific-calculator.focus_panel",
          "scientific-calculator.show_gateway_solve",
        ],
        blocked_capabilities: [],
        executed_capabilities: [
          "scientific-calculator.solve_expression",
          "scientific-calculator.open_panel",
          "scientific-calculator.focus_panel",
          "scientific-calculator.show_gateway_solve",
        ],
        evidence_reentry_status: "completed",
        terminal_candidate_present: true,
        route_authority_result: "provider_gateway_read_observe_contract_satisfied",
        terminal_authority_result: "authorized_by_terminal_authority_single_writer",
        terminal_authority_granted: true,
        final_visible_answer_authorized: true,
        final_answer_source: "workstation_tool_evaluation",
        terminal_artifact_kind: "workstation_tool_evaluation",
      },
      debug: {
        provider_reasoning_reentry: {
          schema: "helix.provider_reasoning_reentry.v1",
          status: "completed",
        },
        terminal_authority_candidate_review: {
          schema: "helix.provider_terminal_authority_candidate_review.v1",
          terminal_authority_status: "authorized_by_helix_provider_candidate_bridge",
        },
        terminal_answer_authority: {
          schema: "helix.turn_terminal_authority.v1",
          server_authoritative: true,
        },
      },
    });
    expect(response.body.provider_terminal_candidate.candidate_id).toContain(
      "ask:test:codex-provider-candidate-route:agent_provider_terminal_candidate:codex:",
    );
    expect(response.body.debug_export_ref).toMatchObject({
      endpoint: "/api/agi/ask/turn/ask%3Atest%3Acodex-provider-candidate-route/debug-export",
      turn_id: "ask:test:codex-provider-candidate-route",
    });
    const debugExport = await request(app)
      .get("/api/agi/ask/turn/ask%3Atest%3Acodex-provider-candidate-route/debug-export")
      .expect(200);
    expect(debugExport.body).toMatchObject({
      ok: true,
      payload: {
        active_turn_id: "ask:test:codex-provider-candidate-route",
        agent_runtime: "codex",
        response_type: "final_answer",
        final_status: "final_answer",
        final_answer_source: "workstation_tool_evaluation",
        terminal_artifact_kind: "workstation_tool_evaluation",
        workstation_gateway_manifest_version: "read-observe-act.v1",
        workstation_gateway_reentry_status: "completed",
        terminal_authority_status: "authorized_by_terminal_authority_single_writer",
        workstation_gateway_call_results: expect.arrayContaining([
          expect.objectContaining({
            capability_id: "scientific-calculator.open_panel",
          }),
          expect.objectContaining({
            capability_id: "scientific-calculator.focus_panel",
          }),
          expect.objectContaining({
            capability_id: "scientific-calculator.solve_expression",
          }),
        ]),
        workstation_gateway_observation_packets: expect.arrayContaining([
          expect.objectContaining({
            capability_key: "scientific-calculator.open_panel",
          }),
          expect.objectContaining({
            capability_key: "scientific-calculator.focus_panel",
          }),
          expect.objectContaining({
            capability_key: "scientific-calculator.solve_expression",
          }),
        ]),
        provider_reasoning_reentry: {
          schema: "helix.provider_reasoning_reentry.v1",
          status: "completed",
          evidence_reentered: true,
        },
        terminal_authority_candidate_review: {
          schema: "helix.provider_terminal_authority_candidate_review.v1",
          terminal_authority_status: "authorized_by_helix_provider_candidate_bridge",
          terminal_authority_granted: true,
        },
        provider_terminal_authority_bridge: {
          schema: "helix.provider_terminal_authority_bridge.v1",
          terminal_authority_granted: true,
        },
        terminal_answer_authority: {
          schema: "helix.turn_terminal_authority.v1",
          final_answer_source: "workstation_tool_evaluation",
          terminal_artifact_kind: "workstation_tool_evaluation",
          server_authoritative: true,
        },
        provider_gateway_debug_summary: {
          schema: "helix.provider_gateway_debug_summary.v1",
          selected_provider: "codex",
          prompt: "Use the calculator observation.",
          requested_capabilities: [
            "scientific-calculator.solve_expression",
            "scientific-calculator.open_panel",
            "scientific-calculator.focus_panel",
            "scientific-calculator.show_gateway_solve",
          ],
          admitted_capabilities: [
            "scientific-calculator.solve_expression",
            "scientific-calculator.open_panel",
            "scientific-calculator.focus_panel",
            "scientific-calculator.show_gateway_solve",
          ],
          executed_capabilities: [
            "scientific-calculator.solve_expression",
            "scientific-calculator.open_panel",
            "scientific-calculator.focus_panel",
            "scientific-calculator.show_gateway_solve",
          ],
          route_authority_result: "provider_gateway_read_observe_contract_satisfied",
          terminal_authority_result: "authorized_by_terminal_authority_single_writer",
          final_answer_source: "workstation_tool_evaluation",
        },
      },
    });
  });

  it("emits provider candidate records while stream single-writer selects calculator evidence", async () => {
    process.env.ENABLE_CODEX_AGENT = "1";
    process.env.CODEX_AGENT_FAKE_STDOUT = "The streamed calculator observation reports 64.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn/stream")
      .send({
        agent_runtime: "codex",
        thread_id: "thread:test:codex-provider-candidate-stream",
        turn_id: "ask:test:codex-provider-candidate-stream",
        question: "Use the calculator observation.",
        workstation_gateway_call: {
          capability_id: "scientific-calculator.solve_expression",
          arguments: {
            expression: "8 * 8",
          },
        },
      })
      .expect(200);
    const finalEvent = parseSseEvents(response.text).find((entry) => entry.event === "turn_final");

    expect(finalEvent?.data).toMatchObject({
      ok: true,
      runtime: "codex",
      agent_runtime: "codex",
      text: "The streamed calculator observation reports 64.",
      workstation_gateway_reentry_status: "completed",
      terminal_authority_status: "authorized_by_terminal_authority_single_writer",
      final_answer_source: "workstation_tool_evaluation",
      terminal_artifact_kind: "workstation_tool_evaluation",
      terminal_authority_candidate_review: {
        schema: "helix.provider_terminal_authority_candidate_review.v1",
        terminal_authority_status: "authorized_by_helix_provider_candidate_bridge",
        terminal_authority_granted: true,
        final_visible_answer_authorized: true,
        blockers: [],
      },
      provider_terminal_authority_bridge: {
        schema: "helix.provider_terminal_authority_bridge.v1",
        route_authority_status: "provider_gateway_read_observe_contract_satisfied",
        terminal_authority_status: "authorized_by_helix_provider_candidate_bridge",
        terminal_authority_granted: true,
        final_visible_answer_authorized: true,
        final_answer_source: "agent_provider_terminal_candidate",
        terminal_artifact_kind: "agent_provider_terminal_candidate",
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        thread_id: "thread:test:codex-provider-candidate-stream",
        turn_id: "ask:test:codex-provider-candidate-stream",
        route: "/ask",
        terminal_kind: "tool_evaluation",
        final_answer_source: "workstation_tool_evaluation",
        terminal_artifact_kind: "workstation_tool_evaluation",
        server_authoritative: true,
      },
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        concise_text: "The streamed calculator observation reports 64.",
        final_answer_source: "workstation_tool_evaluation",
        terminal_artifact_kind: "workstation_tool_evaluation",
      },
      provider_gateway_debug_summary: {
        schema: "helix.provider_gateway_debug_summary.v1",
        turn_id: "ask:test:codex-provider-candidate-stream",
        route: "/ask/turn/stream",
        prompt: "Use the calculator observation.",
        selected_provider: "codex",
        requested_capabilities: [
          "scientific-calculator.solve_expression",
          "scientific-calculator.open_panel",
          "scientific-calculator.focus_panel",
          "scientific-calculator.show_gateway_solve",
        ],
        admitted_capabilities: [
          "scientific-calculator.solve_expression",
          "scientific-calculator.open_panel",
          "scientific-calculator.focus_panel",
          "scientific-calculator.show_gateway_solve",
        ],
        executed_capabilities: [
          "scientific-calculator.solve_expression",
          "scientific-calculator.open_panel",
          "scientific-calculator.focus_panel",
          "scientific-calculator.show_gateway_solve",
        ],
        evidence_reentry_status: "completed",
        route_authority_result: "provider_gateway_read_observe_contract_satisfied",
        terminal_authority_result: "authorized_by_terminal_authority_single_writer",
        final_answer_source: "workstation_tool_evaluation",
      },
      debug: {
        terminal_answer_authority: {
          schema: "helix.turn_terminal_authority.v1",
          route: "/ask",
          server_authoritative: true,
        },
        terminal_presentation: {
          schema: "helix.terminal_presentation.v1",
          concise_text: "64",
        },
        provider_gateway_debug_summary: {
          schema: "helix.provider_gateway_debug_summary.v1",
          selected_provider: "codex",
          prompt: "Use the calculator observation.",
          requested_capabilities: [
            "scientific-calculator.solve_expression",
            "scientific-calculator.open_panel",
            "scientific-calculator.focus_panel",
            "scientific-calculator.show_gateway_solve",
          ],
          admitted_capabilities: [
            "scientific-calculator.solve_expression",
            "scientific-calculator.open_panel",
            "scientific-calculator.focus_panel",
            "scientific-calculator.show_gateway_solve",
          ],
          executed_capabilities: [
            "scientific-calculator.solve_expression",
            "scientific-calculator.open_panel",
            "scientific-calculator.focus_panel",
            "scientific-calculator.show_gateway_solve",
          ],
          route_authority_result: "provider_gateway_read_observe_contract_satisfied",
          terminal_authority_result: "authorized_by_terminal_authority_single_writer",
          final_answer_source: "workstation_tool_evaluation",
        },
      },
    });
    expect(finalEvent?.data.provider_terminal_candidate).toMatchObject({
      schema: "helix.agent_provider_terminal_candidate.v1",
      source: "agent_provider_text_mode_adapter",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(finalEvent?.data.debug_export_ref).toMatchObject({
      endpoint: "/api/agi/ask/turn/ask%3Atest%3Acodex-provider-candidate-stream/debug-export",
      turn_id: "ask:test:codex-provider-candidate-stream",
    });
    const debugExport = await request(app)
      .get("/api/agi/ask/turn/ask%3Atest%3Acodex-provider-candidate-stream/debug-export")
      .expect(200);
    expect(debugExport.body).toMatchObject({
      ok: true,
      payload: {
        active_turn_id: "ask:test:codex-provider-candidate-stream",
        agent_runtime: "codex",
        response_type: "final_answer",
        final_status: "final_answer",
        final_answer_source: "workstation_tool_evaluation",
        terminal_artifact_kind: "workstation_tool_evaluation",
        workstation_gateway_manifest_version: "read-observe-act.v1",
        workstation_gateway_reentry_status: "completed",
        terminal_authority_status: "authorized_by_terminal_authority_single_writer",
        provider_reasoning_reentry: {
          schema: "helix.provider_reasoning_reentry.v1",
          status: "completed",
          evidence_reentered: true,
        },
        terminal_authority_candidate_review: {
          schema: "helix.provider_terminal_authority_candidate_review.v1",
          terminal_authority_status: "authorized_by_helix_provider_candidate_bridge",
          terminal_authority_granted: true,
        },
        provider_terminal_authority_bridge: {
          schema: "helix.provider_terminal_authority_bridge.v1",
          terminal_authority_granted: true,
        },
        terminal_answer_authority: {
          schema: "helix.turn_terminal_authority.v1",
          route: "/ask",
          server_authoritative: true,
        },
        provider_gateway_debug_summary: {
          schema: "helix.provider_gateway_debug_summary.v1",
          selected_provider: "codex",
          prompt: "Use the calculator observation.",
          requested_capabilities: [
            "scientific-calculator.solve_expression",
            "scientific-calculator.open_panel",
            "scientific-calculator.focus_panel",
            "scientific-calculator.show_gateway_solve",
          ],
          admitted_capabilities: [
            "scientific-calculator.solve_expression",
            "scientific-calculator.open_panel",
            "scientific-calculator.focus_panel",
            "scientific-calculator.show_gateway_solve",
          ],
          executed_capabilities: [
            "scientific-calculator.solve_expression",
            "scientific-calculator.open_panel",
            "scientific-calculator.focus_panel",
            "scientific-calculator.show_gateway_solve",
          ],
          route_authority_result: "provider_gateway_read_observe_contract_satisfied",
          terminal_authority_result: "authorized_by_terminal_authority_single_writer",
          final_answer_source: "workstation_tool_evaluation",
        },
      },
    });
  });

  it("streams runtime /goal wake progress with transcript and debug proof for Codex", async () => {
    process.env.ENABLE_CODEX_AGENT = "1";
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        "Visible progress: the document says civilization labels are provisional evidence states.",
        "Visible progress: the document says civilization labels are provisional evidence states.",
        "Visible progress: the document says civilization labels are provisional evidence states.",
        "Visible progress: the document says civilization labels are provisional evidence states.",
        "Visible progress: the document says civilization labels are provisional evidence states.",
        "Visible progress: the document says civilization labels are provisional evidence states.",
      ],
    });
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const app = createApp();
    const start = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        agent_runtime: "codex",
        turn_id: "ask:test:codex-runtime-goal-stream-start",
        question: "/goal Keep a cumulative summary of the visible document section.",
      })
      .expect(200);
    const goalId = start.body.runtime_goal_session.goal_id;

    const response = await request(app)
      .post("/api/agi/ask/turn/stream")
      .send({
        agent_runtime: "codex",
        turn_id: "ask:test:codex-runtime-goal-stream-wake",
        question: "/goal wake",
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          active_doc_path: "docs/audits/research/civilization-bounds-nation-procedural-network-fit-2026-06-17.md",
          active_doc_visible_translation_context: {
            schema: "helix.ask.active_doc_visible_translation_context.v1",
            doc_path: "docs/audits/research/civilization-bounds-nation-procedural-network-fit-2026-06-17.md",
            source_id: "document_markdown:docs/audits/research/civilization-bounds-nation-procedural-network-fit-2026-06-17.md",
            source_hash: "fnv1a32:stream-visible",
            chunks: [
              {
                visible_text: "The document treats civilization labels as provisional evidence states.",
                chunk_id: "visible-stream-1",
              },
            ],
          },
        },
      })
      .expect(200);

    const events = parseSseEvents(response.text);
    const transcriptEvents = events.filter((entry) => entry.event === "turn_transcript_event");
    const finalEvent = events.find((entry) => entry.event === "turn_final");

    expect(transcriptEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({
            role: "system",
            type: "runtime_goal_command",
            lane: "runtime_goal",
          }),
        }),
        expect.objectContaining({
          data: expect.objectContaining({
            role: "tool",
            lane: "runtime_goal",
            source_event_type: "runtime_goal_debug",
          }),
        }),
        expect.objectContaining({
          data: expect.objectContaining({
            role: "agent",
            type: "terminal_answer",
            lane: "terminal_authority",
          }),
        }),
      ]),
    );
    expect(finalEvent?.data).toMatchObject({
      ok: true,
      final_answer_source: "runtime_goal_command",
      terminal_artifact_kind: "runtime_goal_command_result",
      runtime_goal_command: {
        command: "wake",
        goal_id: goalId,
      },
      runtime_goal_session: {
        goal_id: goalId,
        runtime_agent_provider: "codex",
        terminal_authority_status: "authorized",
      },
      runtime_goal_job_brief: {
        user_goal_text: "Keep a cumulative summary of the visible document section.",
      },
      runtime_goal_wake_plan: {
        requested_observation_or_lane: "docs-viewer.read_visible_surface",
        expected_terminal_product: "job_progress_report",
      },
      runtime_goal_progress_summary: {
        current_summary: "Visible progress: the document says civilization labels are provisional evidence states.",
        terminal_authority_status: "authorized",
      },
      runtime_goal_debug_summary: {
        schema: "helix.runtime_goal.debug_copy_summary.v1",
        runtime_agent_provider: "codex",
        observed_source_doc_path: "docs/audits/research/civilization-bounds-nation-procedural-network-fit-2026-06-17.md",
        requested_observation_or_lane: "docs-viewer.read_visible_surface",
        terminal_authority_status: "authorized",
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        route: "/ask/turn/stream",
        server_authoritative: true,
      },
    });
    expect(String(finalEvent?.data.selected_final_answer)).toContain(
      "Goal: Keep a cumulative summary of the visible document section.",
    );
    expect(String(finalEvent?.data.selected_final_answer)).toContain(
      "Observed source: docs/audits/research/civilization-bounds-nation-procedural-network-fit-2026-06-17.md",
    );
    expect(String(finalEvent?.data.selected_final_answer)).toContain("Evidence used: docs-viewer.read_visible_surface");
    expect(String(finalEvent?.data.selected_final_answer)).toContain(
      "Visible progress: the document says civilization labels are provisional evidence states.",
    );
    expect(finalEvent?.data.debug_export).toMatchObject({
      runtime_goal_debug_summary: finalEvent.data.runtime_goal_debug_summary,
      terminal_answer_authority: {
        server_authoritative: true,
      },
    });
    const debugExport = await request(app)
      .get("/api/agi/ask/turn/ask%3Atest%3Acodex-runtime-goal-stream-wake/debug-export")
      .expect(200);
    expect(debugExport.body).toMatchObject({
      ok: true,
      payload: {
        active_turn_id: "ask:test:codex-runtime-goal-stream-wake",
        final_answer_source: "runtime_goal_command",
        terminal_artifact_kind: "runtime_goal_command_result",
        runtime_goal_command: {
          command: "wake",
          goal_id: goalId,
        },
        runtime_goal_session: {
          goal_id: goalId,
          runtime_agent_provider: "codex",
          terminal_authority_status: "authorized",
        },
        runtime_goal_debug_summary: finalEvent?.data.runtime_goal_debug_summary,
        runtime_goal_wake_plan: {
          requested_observation_or_lane: "docs-viewer.read_visible_surface",
          expected_terminal_product: "job_progress_report",
        },
        runtime_goal_progress_summary: {
          current_summary: "Visible progress: the document says civilization labels are provisional evidence states.",
          terminal_authority_status: "authorized",
        },
        terminal_answer_authority: {
          route: "/ask/turn/stream",
          server_authoritative: true,
        },
      },
    });
    expect(debugExport.body.payload.runtime_goal_debug_export.debug_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: "tool_or_lane_requested" }),
        expect.objectContaining({ stage: "tool_or_lane_admitted" }),
        expect.objectContaining({ stage: "evidence_reentered" }),
        expect.objectContaining({ stage: "terminal_authority_evaluated" }),
      ]),
    );
  }, 15_000);

  it("streams runtime /goal wake progress with transcript and debug proof for Helix Native", async () => {
    const app = createApp();
    const start = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        agent_runtime: "helix",
        turn_id: "ask:test:helix-runtime-goal-stream-start",
        question: "/goal Keep a Helix-native summary of the visible document section.",
      })
      .expect(200);
    const goalId = start.body.runtime_goal_session.goal_id;

    const response = await request(app)
      .post("/api/agi/ask/turn/stream")
      .send({
        agent_runtime: "helix",
        turn_id: "ask:test:helix-runtime-goal-stream-wake",
        question: "/goal wake",
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          active_doc_path: "docs/audits/research/civilization-bounds-nation-procedural-network-fit-2026-06-17.md",
          active_doc_visible_translation_context: {
            schema: "helix.ask.active_doc_visible_translation_context.v1",
            doc_path: "docs/audits/research/civilization-bounds-nation-procedural-network-fit-2026-06-17.md",
            source_id: "document_markdown:docs/audits/research/civilization-bounds-nation-procedural-network-fit-2026-06-17.md",
            source_hash: "fnv1a32:stream-visible-helix",
            chunks: [
              {
                visible_text: "Helix should report visible document evidence through the runtime goal progress chain.",
                chunk_id: "visible-stream-helix-1",
              },
            ],
          },
        },
      })
      .expect(200);

    const events = parseSseEvents(response.text);
    const transcriptEvents = events.filter((entry) => entry.event === "turn_transcript_event");
    const finalEvent = events.find((entry) => entry.event === "turn_final");

    expect(transcriptEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({
            role: "system",
            type: "runtime_goal_command",
            lane: "runtime_goal",
          }),
        }),
        expect.objectContaining({
          data: expect.objectContaining({
            role: "tool",
            lane: "runtime_goal",
            source_event_type: "runtime_goal_debug",
          }),
        }),
        expect.objectContaining({
          data: expect.objectContaining({
            role: "agent",
            type: "terminal_answer",
            lane: "terminal_authority",
          }),
        }),
      ]),
    );
    expect(finalEvent?.data).toMatchObject({
      ok: true,
      final_answer_source: "runtime_goal_command",
      terminal_artifact_kind: "runtime_goal_command_result",
      runtime_goal_command: {
        command: "wake",
        goal_id: goalId,
      },
      runtime_goal_session: {
        goal_id: goalId,
        runtime_agent_provider: "helix",
        terminal_authority_status: "authorized",
      },
      runtime_goal_job_brief: {
        user_goal_text: "Keep a Helix-native summary of the visible document section.",
      },
      runtime_goal_wake_plan: {
        requested_observation_or_lane: "docs-viewer.read_visible_surface",
        expected_terminal_product: "job_progress_report",
      },
      runtime_goal_debug_summary: {
        schema: "helix.runtime_goal.debug_copy_summary.v1",
        runtime_agent_provider: "helix",
        observed_source_doc_path: "docs/audits/research/civilization-bounds-nation-procedural-network-fit-2026-06-17.md",
        requested_observation_or_lane: "docs-viewer.read_visible_surface",
        terminal_authority_status: "authorized",
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        route: "/ask/turn/stream",
        server_authoritative: true,
      },
    });
    expect(String(finalEvent?.data.selected_final_answer)).toContain(
      "Goal: Keep a Helix-native summary of the visible document section.",
    );
    expect(String(finalEvent?.data.selected_final_answer)).toContain(
      "Observed source: docs/audits/research/civilization-bounds-nation-procedural-network-fit-2026-06-17.md",
    );
    expect(String(finalEvent?.data.selected_final_answer)).toContain("Evidence used: docs-viewer.read_visible_surface");
    expect(String(finalEvent?.data.runtime_goal_progress_summary?.current_summary ?? "")).toContain(
      "Helix goal evidence re-entry completed for docs-viewer.read_visible_surface.",
    );
    expect(String(finalEvent?.data.runtime_goal_progress_summary?.current_summary ?? "")).toContain(
      "Objective: Keep a Helix-native summary of the visible document section.",
    );

    const debugExport = await request(app)
      .get("/api/agi/ask/turn/ask%3Atest%3Ahelix-runtime-goal-stream-wake/debug-export")
      .expect(200);
    expect(debugExport.body).toMatchObject({
      ok: true,
      payload: {
        active_turn_id: "ask:test:helix-runtime-goal-stream-wake",
        final_answer_source: "runtime_goal_command",
        terminal_artifact_kind: "runtime_goal_command_result",
        runtime_goal_command: {
          command: "wake",
          goal_id: goalId,
        },
        runtime_goal_session: {
          goal_id: goalId,
          runtime_agent_provider: "helix",
          terminal_authority_status: "authorized",
        },
        runtime_goal_debug_summary: finalEvent?.data.runtime_goal_debug_summary,
        terminal_answer_authority: {
          route: "/ask/turn/stream",
          server_authoritative: true,
        },
      },
    });
    expect(debugExport.body.payload.runtime_goal_debug_export.debug_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: "tool_or_lane_requested" }),
        expect.objectContaining({ stage: "tool_or_lane_admitted" }),
        expect.objectContaining({ stage: "evidence_reentered" }),
        expect.objectContaining({ stage: "terminal_authority_evaluated" }),
      ]),
    );
  }, 15_000);
});
