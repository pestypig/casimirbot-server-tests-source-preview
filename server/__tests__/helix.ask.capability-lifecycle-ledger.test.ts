import { describe, expect, it } from "vitest";

import { buildCapabilityLifecycleLedger } from "../services/helix-ask/capability-lifecycle-ledger";
import { buildCapabilityPlan } from "../services/helix-ask/capability-planner";
import { buildCapabilityResultGate } from "../services/helix-ask/capability-result-gate";
import { createHelixTurnLifecycleRecorder } from "../services/helix-ask/runtime/turn-lifecycle";

const buildReenteredLifecycle = (input: {
  turnId: string;
  observationRef: string;
}) => {
  const recorder = createHelixTurnLifecycleRecorder({
    turnId: input.turnId,
    now: () => 100,
  });
  const started = recorder.append({
    kind: "turn.started",
    producer: "helix_adapter",
    status: "started",
  });
  const route = recorder.append({
    kind: "route.committed",
    producer: "helix_policy",
    status: "succeeded",
    causation_id: started.event_id,
    route_commit_id: `${input.turnId}:route`,
    capability_ids: ["workstation.panel_control"],
  });
  recorder.append({
    kind: "capability.admitted",
    producer: "helix_policy",
    status: "succeeded",
    causation_id: route.event_id,
    route_commit_id: `${input.turnId}:route`,
    capability_id: "workstation.panel_control",
  });
  const call = recorder.append({
    kind: "tool.call.started",
    producer: "codex_runtime",
    status: "started",
    route_commit_id: `${input.turnId}:route`,
    call_id: `${input.turnId}:call`,
    capability_id: "workstation.panel_control",
  });
  const completed = recorder.append({
    kind: "tool.call.completed",
    producer: "helix_adapter",
    status: "succeeded",
    causation_id: call.event_id,
    route_commit_id: `${input.turnId}:route`,
    call_id: `${input.turnId}:call`,
    capability_id: "workstation.panel_control",
    observation_refs: [input.observationRef],
  });
  recorder.append({
    kind: "observation.reentered",
    producer: "helix_adapter",
    status: "succeeded",
    causation_id: completed.event_id,
    route_commit_id: `${input.turnId}:route`,
    call_id: `${input.turnId}:call`,
    capability_id: "workstation.panel_control",
    observation_refs: [input.observationRef],
  });
  return recorder.snapshot();
};

const sourceTarget = (target_source: string, target_kind = target_source) => ({
  schema: "helix.ask_source_target_intent.v1",
  turn_id: "ask:lifecycle",
  thread_id: "helix-ask:test",
  target_source,
  target_kind,
  strength: "hard",
  explicit_cues: [],
  reasons: [],
  requested_outputs: [],
  suppressed_routes: [],
  precedence_reason: "test",
  must_enter_backend_ask: true,
  allow_client_shortcut: false,
  allow_no_tool_direct: false,
  confidence: 0.9,
  assistant_answer: false,
  raw_content_included: false,
});

const toolAdmission = (sourceTargetValue: string, admitted: string[]) => ({
  schema: "helix.tool_call_admission_decision.v1",
  turn_id: "ask:lifecycle",
  source_target: sourceTargetValue,
  required: admitted.length > 0,
  admitted_tool_families: admitted,
  forbidden_terminal_artifact_kinds: ["no_tool_direct", "model_only_concept"],
  forbidden_routes: [],
  reason: "test",
  assistant_answer: false,
  raw_content_included: false,
});

const canonicalGoal = (goal_kind: string, required_terminal_kind: string | null) => ({
  turn_id: "ask:lifecycle",
  goal_kind,
  answer_scope: "workspace_state",
  required_terminal_kind,
  allows_workspace_context: true,
  allows_prior_artifacts: false,
  corpus_anchors: [],
  numeric_tokens: [],
  concept_tokens: [],
  confidence: "high",
  classifier_reasons: ["test"],
});

describe("Helix capability lifecycle ledger", () => {
  it("requires every actual workstation action to have an admitted capability plan", () => {
    const ledger = buildCapabilityLifecycleLedger({
      turnId: "ask:no-plan",
      terminalArtifactKind: "workspace_action_receipt",
      payload: {
        current_turn_artifact_ledger: [
          {
            artifact_id: "ask:no-plan:workspace_action_receipt",
            kind: "workspace_action_receipt",
            payload: {
              kind: "workspace_action_receipt",
              status: "completed",
              action_id: "docs-viewer.open",
            },
          },
        ],
      },
    });

    expect(ledger.failure_codes).toEqual(expect.arrayContaining(["capability_dispatched_without_admission"]));
    expect(ledger.stages.find((stage) => stage.stage === "planned")).toMatchObject({
      status: "failed",
      reason: "action_observed_without_capability_plan",
    });
  });

  it("requires every admitted capability plan to dispatch before a result can be missing", () => {
    const plan = buildCapabilityPlan({
      turnId: "ask:missing-result",
      promptText: "Click Start.",
      sourceTargetIntent: sourceTarget("workstation_panel"),
      toolCallAdmissionDecision: toolAdmission("workstation_panel", []),
      canonicalGoalFrame: canonicalGoal("panel_control", "workspace_action_receipt"),
    });
    const ledger = buildCapabilityLifecycleLedger({
      turnId: "ask:missing-result",
      terminalArtifactKind: "workspace_action_receipt",
      payload: {
        capability_plan: plan,
      },
    });

    expect(ledger.failure_codes).toEqual(expect.arrayContaining([
      "capability_admitted_not_dispatched",
      "capability_result_missing",
    ]));
    expect(ledger.stages.find((stage) => stage.stage === "dispatched")).toMatchObject({
      status: "failed",
      reason: "capability_admitted_not_dispatched",
    });
    expect(ledger.stages.find((stage) => stage.stage === "result_observed")).toMatchObject({
      status: "failed",
    });
  });

  it("does not count blocked mutating capability as observed or validated", () => {
    const plan = {
      schema: "helix.capability_plan.v1",
      turn_id: "ask:not-run",
      capability_family: "workstation_action",
      requested_action: "click_or_activate_control",
      mutating: true,
      operator_command_required: true,
      operator_command_present: false,
      source_target: "workstation_panel",
      goal_kind: "panel_control",
      required_terminal_kind: "workspace_action_receipt",
      admission_status: "needs_user_confirmation",
      rejection_reason: "mutating_capability_requires_operator_command",
      assistant_answer: false,
      raw_content_included: false,
    };
    const ledger = buildCapabilityLifecycleLedger({
      turnId: "ask:not-run",
      terminalArtifactKind: "typed_failure",
      payload: {
        capability_plan: plan,
      },
    });

    expect(ledger.failure_codes).toContain("capability_result_missing");
    expect(ledger.failure_codes).not.toContain("capability_admitted_not_dispatched");
    expect(ledger.failure_codes).toEqual(expect.arrayContaining(["mutating_capability_without_operator_command"]));
    expect(ledger.stages.find((stage) => stage.stage === "result_observed")).toMatchObject({
      status: "failed",
      reason: "capability_result_missing",
    });
    expect(ledger.stages.find((stage) => stage.stage === "result_validated")).toMatchObject({
      status: "skipped",
    });
  });

  it("does not count preflight or presentation refs as a completed mutating capability result", () => {
    const plan = buildCapabilityPlan({
      turnId: "ask:synthetic-refs",
      promptText: "Create a goal to refactor the goal-session UI and work until tests pass.",
      sourceTargetIntent: sourceTarget("unknown", "unknown"),
      toolCallAdmissionDecision: toolAdmission("unknown", []),
      canonicalGoalFrame: canonicalGoal("model_only_concept", "direct_answer_text"),
    });
    const result = buildCapabilityResultGate({
      plan,
      terminalArtifactKind: "typed_failure",
      explicitEvidenceRefs: [
        "ask:synthetic-refs:ask_turn_preflight_context:abc",
        "ask:synthetic-refs:terminal_presentation:def",
        "ask:synthetic-refs:receipt_presentation_snapshot:def",
      ],
      reenteredRefs: [
        "ask:synthetic-refs:terminal_presentation:def",
      ],
    });
    const ledger = buildCapabilityLifecycleLedger({
      turnId: "ask:synthetic-refs",
      terminalArtifactKind: "typed_failure",
      payload: {
        capability_plan: plan,
        capability_result: result,
      },
    });

    expect(plan).toMatchObject({
      requested_action: "live_env.start_agent_goal_session",
      admission_status: "needs_evidence",
    });
    expect(result).toMatchObject({
      status: "not_run",
      evidence_refs: [],
      reentered_solver: false,
    });
    expect(ledger.failure_codes).toEqual(expect.arrayContaining([
      "capability_admitted_not_dispatched",
      "capability_result_missing",
    ]));
    expect(ledger.stages.find((stage) => stage.stage === "result_observed")).toMatchObject({
      status: "failed",
    });
  });

  it("requires terminal receipts to match canonical required terminal kind", () => {
    const plan = buildCapabilityPlan({
      turnId: "ask:summary-not-open",
      promptText: "Open the NH-M2 white paper from docs.",
      sourceTargetIntent: sourceTarget("docs_viewer"),
      toolCallAdmissionDecision: toolAdmission("docs_viewer", ["docs_viewer"]),
      canonicalGoalFrame: canonicalGoal("doc_summary", "doc_summary"),
    });
    const result = buildCapabilityResultGate({
      plan,
      terminalArtifactKind: "doc_open_receipt",
      terminalArtifactId: "ask:summary-not-open:doc_open_receipt",
      currentTurnArtifacts: [
        {
          artifact_id: "ask:summary-not-open:doc_open_receipt",
          kind: "doc_open_receipt",
          payload: {
            kind: "doc_open_receipt",
            receipt_id: "ask:summary-not-open:doc_open_receipt",
            status: "completed",
          },
        },
      ],
      reenteredRefs: ["ask:summary-not-open:doc_open_receipt"],
    });
    const ledger = buildCapabilityLifecycleLedger({
      turnId: "ask:summary-not-open",
      terminalArtifactKind: "doc_open_receipt",
      payload: {
        capability_plan: plan,
        capability_result: result,
        canonical_goal_frame: canonicalGoal("doc_summary", "doc_summary"),
        current_turn_artifact_ledger: [
          {
            artifact_id: "ask:summary-not-open:doc_open_receipt",
            kind: "doc_open_receipt",
            payload: {
              kind: "doc_open_receipt",
              receipt_id: "ask:summary-not-open:doc_open_receipt",
              status: "completed",
            },
          },
        ],
      },
    });

    expect(ledger.failure_codes).toEqual(expect.arrayContaining(["capability_receipt_terminal_without_goal"]));
    expect(ledger.stages.find((stage) => stage.stage === "terminal_considered")).toMatchObject({
      status: "failed",
    });
  });

  it("flags capability results that were observed but not validated", () => {
    const plan = buildCapabilityPlan({
      turnId: "ask:unvalidated",
      promptText: "Search docs for NH-M2.",
      sourceTargetIntent: sourceTarget("docs_viewer"),
      toolCallAdmissionDecision: toolAdmission("docs_viewer", ["docs_viewer"]),
      canonicalGoalFrame: canonicalGoal("doc_lookup", "doc_search_result"),
    });
    const ledger = buildCapabilityLifecycleLedger({
      turnId: "ask:unvalidated",
      terminalArtifactKind: "typed_failure",
      payload: {
        capability_plan: plan,
        capability_result: {
          schema: "helix.capability_result.v1",
          turn_id: "ask:unvalidated",
          capability_plan_id: "capability-plan:unvalidated",
          status: "failed",
          receipt_refs: [],
          evidence_refs: [],
          selected_for_answer: false,
          reentered_solver: true,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    });

    expect(ledger.failure_codes).toEqual(expect.arrayContaining(["capability_result_unvalidated"]));
    expect(ledger.stages.find((stage) => stage.stage === "result_validated")).toMatchObject({
      status: "failed",
    });
  });

  it("flags capability results that did not re-enter the solver", () => {
    const plan = buildCapabilityPlan({
      turnId: "ask:not-reentered",
      promptText: "Open the NH-M2 white paper from docs.",
      sourceTargetIntent: sourceTarget("docs_viewer"),
      toolCallAdmissionDecision: toolAdmission("docs_viewer", ["docs_viewer"]),
      canonicalGoalFrame: canonicalGoal("doc_open", "doc_open_receipt"),
    });
    const ledger = buildCapabilityLifecycleLedger({
      turnId: "ask:not-reentered",
      terminalArtifactKind: "doc_open_receipt",
      payload: {
        capability_plan: plan,
        capability_result: {
          schema: "helix.capability_result.v1",
          turn_id: "ask:not-reentered",
          capability_plan_id: "capability-plan:not-reentered",
          status: "succeeded",
          receipt_refs: ["ask:not-reentered:doc_open_receipt"],
          evidence_refs: [],
          selected_for_answer: true,
          reentered_solver: false,
          assistant_answer: false,
          raw_content_included: false,
        },
        canonical_goal_frame: canonicalGoal("doc_open", "doc_open_receipt"),
      },
    });

    expect(ledger.failure_codes).toEqual(expect.arrayContaining(["capability_result_not_reentered"]));
    expect(ledger.stages.find((stage) => stage.stage === "reentered_solver")).toMatchObject({
      status: "failed",
    });
  });

  it("passes the full lifecycle for an admitted and reentered workstation receipt", () => {
    const plan = buildCapabilityPlan({
      turnId: "ask:click",
      promptText: "Click Start and report whether the click was accepted.",
      sourceTargetIntent: sourceTarget("workstation_panel"),
      toolCallAdmissionDecision: toolAdmission("workstation_panel", []),
      canonicalGoalFrame: canonicalGoal("panel_control", "workspace_action_receipt"),
    });
    const receipt = {
      artifact_id: "ask:click:workspace_action_receipt",
      kind: "workspace_action_receipt",
      payload: {
        kind: "workspace_action_receipt",
        receipt_id: "ask:click:workspace_action_receipt",
        status: "completed",
        accepted: true,
      },
    };
    const result = buildCapabilityResultGate({
      plan,
      terminalArtifactKind: "workspace_action_receipt",
      terminalArtifactId: "ask:click:workspace_action_receipt",
      currentTurnArtifacts: [receipt],
      reenteredRefs: ["ask:click:workspace_action_receipt"],
    });
    const ledger = buildCapabilityLifecycleLedger({
      turnId: "ask:click",
      terminalArtifactKind: "workspace_action_receipt",
      payload: {
        capability_plan: plan,
        capability_result: result,
        canonical_goal_frame: canonicalGoal("panel_control", "workspace_action_receipt"),
        current_turn_artifact_ledger: [receipt],
        turn_lifecycle: buildReenteredLifecycle({
          turnId: "ask:click",
          observationRef: "ask:click:workspace_action_receipt",
        }),
      },
    });

    expect(ledger.ok).toBe(true);
    expect(ledger.failure_codes).toEqual([]);
    expect(ledger.stages.map((stage) => stage.stage)).toEqual([
      "planned",
      "admitted",
      "dispatched",
      "adapter_acknowledged",
      "result_observed",
      "result_validated",
      "reentered_solver",
      "terminal_considered",
    ]);
  });
});
