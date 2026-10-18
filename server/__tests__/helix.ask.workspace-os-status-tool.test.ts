import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  HELIX_WORKSPACE_OS_STATUS_SCHEMA,
  buildHelixWorkspaceOsAuthority,
  summarizeHelixWorkspaceOsCapabilities,
  withHelixWorkspaceOsAuthority,
  type HelixWorkspaceOsStatus,
} from "@shared/helix-workspace-os-status";
import { arbitrateAskSourceTarget } from "../services/helix-ask/ask-source-target-arbitrator";
import { buildCapabilityPlan } from "../services/helix-ask/capability-planner";
import { buildRouteProductContract } from "../services/helix-ask/route-product-contract";
import { buildToolCallAdmissionDecision } from "../services/helix-ask/tool-call-admission";
import { buildHelixToolSurfacePacket } from "../services/helix-ask/tool-router/helix-tool-surface-builder";
import {
  HELIX_WORKSPACE_OS_STATUS_CAPABILITY,
} from "../services/helix-ask/workspace-os-status-intent";
import {
  HELIX_WORKSPACE_OS_STATUS_OBSERVATION_SCHEMA,
  buildWorkspaceOsStatusObservation,
} from "../services/helix-ask/workspace-os-status-tool";
import { planRouter } from "../routes/agi.plan";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/agi", planRouter);
  return app;
};

const readRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const readArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const readString = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

const artifactKind = (artifact: Record<string, unknown>): string | null =>
  readString(artifact.artifact_kind) ?? readString(artifact.kind);

const artifactPayload = (artifact: Record<string, unknown>): Record<string, unknown> =>
  readRecord(artifact.payload) ?? {};

const canonicalGoalFrame = {
  turn_id: "ask:workspace-os",
  goal_kind: "workspace_status_diagnostic",
  answer_scope: "workspace_state",
  required_terminal_kind: "model_synthesized_answer",
  allows_workspace_context: true,
  allows_prior_artifacts: false,
  corpus_anchors: [],
  numeric_tokens: [],
  concept_tokens: ["workspace_os_status"],
  confidence: "high",
  classifier_reasons: ["workspace_os_status_intent"],
};

describe("Helix Ask Workspace OS status tool", () => {
  it("treats a natural workstation-health question as the same diagnostic contract", () => {
    const promptText = "How is the workstation doing right now?";
    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId: "ask:workspace-os:natural-health",
      threadId: "helix-ask:test",
      promptText,
    });

    expect(sourceTargetIntent).toMatchObject({
      target_source: "workspace_diagnostic",
      target_kind: "workspace_diagnostic",
      strength: "hard",
      precedence_reason: "workspace_os_status_source_target",
    });
    expect(sourceTargetIntent.explicit_cues).toContain("natural_workspace_health_question");
  });

  it("gives a natural current-workstation-status read precedence over repository evidence", () => {
    const promptText = "What is the current workstation status?";
    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId: "ask:workspace-os:natural",
      threadId: "helix-ask:test",
      promptText,
    });

    expect(sourceTargetIntent).toMatchObject({
      target_source: "workspace_diagnostic",
      target_kind: "workspace_diagnostic",
      strength: "hard",
      precedence_reason: "workspace_os_status_source_target",
    });
    expect(buildToolCallAdmissionDecision({
      turnId: "ask:workspace-os:natural",
      sourceTargetIntent,
      promptText,
    })).toMatchObject({
      admitted_tool_families: ["workspace_diagnostic"],
      required: true,
    });
  });

  it("routes status and capability-health prompts to a diagnostic-only tool path", () => {
    const promptText =
      "Check the Workspace OS status: are browser tab capture, clipboard write, source bindings, and runtime memory healthy?";
    const sourceTargetIntent = arbitrateAskSourceTarget({
      turnId: "ask:workspace-os",
      threadId: "helix-ask:test",
      promptText,
    });

    expect(sourceTargetIntent).toMatchObject({
      target_source: "workspace_diagnostic",
      target_kind: "workspace_diagnostic",
      strength: "hard",
      allow_no_tool_direct: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(sourceTargetIntent.requested_outputs).toContain("workspace_os_status");

    const routeContract = buildRouteProductContract({
      turnId: "ask:workspace-os",
      threadId: "helix-ask:test",
      sourceTargetIntent,
      promptText,
    });
    expect(routeContract.source_target).toBe("workspace_diagnostic");
    expect(routeContract.allowed_terminal_artifact_kinds).toContain("model_synthesized_answer");
    expect(routeContract.forbidden_terminal_artifact_kinds).toContain("workspace_action_receipt");
    expect(routeContract.side_artifact_kinds_allowed).toContain("workspace_os_status_observation");

    const admission = buildToolCallAdmissionDecision({
      turnId: "ask:workspace-os",
      sourceTargetIntent,
      routeProductContract: routeContract,
      promptText,
    });
    expect(admission).toMatchObject({
      source_target: "workspace_diagnostic",
      required: true,
      admitted_tool_families: ["workspace_diagnostic"],
      reason: "workspace_diagnostic_requires_workspace_os_status_tool_path",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(admission.forbidden_terminal_artifact_kinds).toContain("workspace_action_receipt");

    const plan = buildCapabilityPlan({
      turnId: "ask:workspace-os",
      promptText,
      sourceTargetIntent,
      routeProductContract: routeContract,
      toolCallAdmissionDecision: admission,
      canonicalGoalFrame,
    });
    expect(plan).toMatchObject({
      capability_family: "workspace_diagnostic",
      requested_action: HELIX_WORKSPACE_OS_STATUS_CAPABILITY,
      mutating: false,
      operator_command_required: false,
      admission_status: "needs_evidence",
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("exposes workspace_os.status in the model-visible tool surface as non-terminal and non-mutating", () => {
    const packet = buildHelixToolSurfacePacket({
      turnId: "ask:workspace-os",
      prompt: "Which workspace capabilities are blocked or unknown in the Workspace OS status plane?",
      maxEntries: 8,
    });
    const entry = packet.entries.find((candidate) => candidate.capability_key === HELIX_WORKSPACE_OS_STATUS_CAPABILITY);

    expect(entry).toBeTruthy();
    expect(entry).toMatchObject({
      panel_id: "workspace-os",
      action: "status",
      runtime_shape: "run_panel_action",
      execution_target: "server_only",
      mutating: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(entry?.expected_observation_schema).toBe(HELIX_WORKSPACE_OS_STATUS_OBSERVATION_SCHEMA);
    expect(entry?.safety_tags).toEqual(expect.arrayContaining(["diagnostic_only", "no_raw_content", "non_terminal"]));
  });

  it("builds a sanitized non-terminal Workspace OS observation", () => {
    const capabilities = [
      withHelixWorkspaceOsAuthority({
        capability_id: "clipboard.write",
        surface: "clipboard",
        mode: "read_write",
        status: "unknown",
        label: "Clipboard write",
        missing_reason: "no_client_capability_signal_registered",
        fallbacks: ["workstation.dynamic_actions"],
        evidence_refs: [],
        receipt_refs: [],
      }),
      withHelixWorkspaceOsAuthority({
        capability_id: "runtime.memory",
        surface: "runtime_memory",
        mode: "diagnostic",
        status: "available",
        label: "Runtime memory governor",
        evidence_refs: ["helix.runtime_memory_governor.snapshot.v1"],
        receipt_refs: [],
      }),
    ] as const;
    const status: HelixWorkspaceOsStatus = {
      schema_version: HELIX_WORKSPACE_OS_STATUS_SCHEMA,
      generated_at: "2026-06-05T12:00:00.000Z",
      thread_id: "helix-ask:test",
      room_id: null,
      capabilities: [...capabilities],
      runtime: {
        memory_pressure: "normal",
        active_task_count: 0,
        queued_task_count: 0,
        paused_background_task_count: 0,
        rejected_task_count: 0,
      },
      summary: summarizeHelixWorkspaceOsCapabilities(capabilities),
      authority: buildHelixWorkspaceOsAuthority(),
    };

    const observation = buildWorkspaceOsStatusObservation({ status });

    expect(observation).toMatchObject({
      schema: HELIX_WORKSPACE_OS_STATUS_OBSERVATION_SCHEMA,
      capability_key: HELIX_WORKSPACE_OS_STATUS_CAPABILITY,
      status_schema_version: HELIX_WORKSPACE_OS_STATUS_SCHEMA,
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(observation.authority).toMatchObject({
      assistant_answer: false,
      raw_content_included: false,
      terminal_eligible: false,
    });
    expect(observation.noteworthy_capabilities).toContainEqual(expect.objectContaining({
      capability_id: "clipboard.write",
      status: "unknown",
      authority: expect.objectContaining({
        assistant_answer: false,
        raw_content_included: false,
        terminal_eligible: false,
      }),
    }));
  });

  it("forces the zero-argument workspace_os.status runtime call before model-selected live tools", async () => {
    const app = createApp();
    const previousAgentStepLlm = process.env.HELIX_AGENT_STEP_DECISION_LLM;
    const previousAgentStepFixture = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
    const previousAgentStepFixtureIndex = process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
    const previousFinalAnswerFixture = process.env.HELIX_RUNTIME_FINAL_ANSWER_TEST_RESPONSE;
    process.env.HELIX_AGENT_STEP_DECISION_LLM = "1";
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = JSON.stringify({
      next_step: "next_action",
      chosen_capability: "live_env.query_event_log",
      reason: "Bad fixture: live event logs are not equivalent to Workspace OS status.",
      args: { limit: 1 },
      expected_artifacts: ["live_environment_tool_observation"],
      commentary: null,
      confidence: 0.99,
    });
    process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = "0";
    process.env.HELIX_RUNTIME_FINAL_ANSWER_TEST_RESPONSE =
      "Workspace OS status was synthesized from the diagnostic observation.";

    try {
      const ask = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          sessionId: "helix-ask:workspace-os-force-test",
          question:
            "Use the Workspace OS status tool to report browser binding, clipboard health, source binding, and runtime memory. Do not execute workspace actions.",
          mode: "read",
          debug: true,
        })
        .expect(200);
      const turnId = readString(ask.body.turn_id) ?? readString(ask.body.turnId);
      expect(turnId).toBeTruthy();

      const debug = await request(app)
        .get(`/api/agi/ask/turn/${encodeURIComponent(String(turnId))}/debug-export`)
        .expect(200);
      const payload = readRecord(debug.body.payload) ?? readRecord(debug.body) ?? {};
      const loop = readRecord(payload.agent_runtime_loop) ?? {};
      const ledger = readArray(payload.current_turn_artifact_ledger).map(readRecord).filter(Boolean) as Record<string, unknown>[];
      const runtimeToolCalls = ledger
        .filter((artifact) => artifactKind(artifact) === "runtime_tool_call")
        .map(artifactPayload);

      expect(readString(readRecord(payload.source_target_intent)?.target_source)).toBe("workspace_diagnostic");
      expect(readString(readRecord(payload.capability_plan)?.requested_action)).toBe(HELIX_WORKSPACE_OS_STATUS_CAPABILITY);
      expect(loop.executed_tool_call_count).toBe(1);
      expect(runtimeToolCalls.map((call) => readString(call.capability_key))).toEqual([
        HELIX_WORKSPACE_OS_STATUS_CAPABILITY,
      ]);
      expect(runtimeToolCalls[0]?.args).toEqual({});
      expect(runtimeToolCalls.map((call) => readString(call.capability_key))).not.toContain("live_env.query_event_log");
      expect(ledger.some((artifact) => artifactKind(artifact) === "workspace_os_status_observation")).toBe(true);
      expect(ledger.some((artifact) => artifactKind(artifact) === "live_environment_tool_observation")).toBe(false);
      expect(readString(payload.terminal_artifact_kind) ?? readString(ask.body.terminal_artifact_kind)).toBe(
        "model_synthesized_answer",
      );
      const audit = ledger.find((artifact) => artifactKind(artifact) === "runtime_authority_audit");
      expect(artifactPayload(audit ?? {}).ok).toBe(true);
    } finally {
      if (previousAgentStepLlm === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_LLM;
      else process.env.HELIX_AGENT_STEP_DECISION_LLM = previousAgentStepLlm;
      if (previousAgentStepFixture === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE = previousAgentStepFixture;
      if (previousAgentStepFixtureIndex === undefined) delete process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX;
      else process.env.HELIX_AGENT_STEP_DECISION_TEST_RESPONSE_INDEX = previousAgentStepFixtureIndex;
      if (previousFinalAnswerFixture === undefined) delete process.env.HELIX_RUNTIME_FINAL_ANSWER_TEST_RESPONSE;
      else process.env.HELIX_RUNTIME_FINAL_ANSWER_TEST_RESPONSE = previousFinalAnswerFixture;
    }
  }, 20000);
});
