import { describe, expect, it } from "vitest";

import { __testHelixAskPolicyAdjacentDecisions } from "../routes/agi.plan";

type GoalKind =
  | "conversation"
  | "open_workspace"
  | "read_doc"
  | "summarize_doc"
  | "locate_in_doc"
  | "write_note"
  | "compare"
  | "panel_control"
  | "temporal_followup"
  | "capability_help"
  | "unknown";

const buildFrame = (args: {
  goalKind: GoalKind;
  raw?: string;
  evidence?: string[];
  workspaceRefs?: Array<Record<string, unknown>>;
  mutationTargets?: Array<Record<string, unknown>>;
  requestedOutputs?: Array<Record<string, unknown>>;
}) => ({
  user_goal: {
    raw: args.raw ?? args.goalKind,
    normalized: (args.raw ?? args.goalKind).toLowerCase(),
    goal_kind: args.goalKind,
    confidence: 0.7,
  },
  requested_outputs: args.requestedOutputs ?? [{ kind: "answer", required: true, evidence: [] }],
  workspace_refs: args.workspaceRefs ?? [],
  constraints: [],
  style_modifiers: [],
  mutation_targets: args.mutationTargets ?? [],
  evidence_requirements: (args.evidence ?? []).map((artifact) => ({
    artifact,
    required: true,
    reason: "fixture",
  })),
});

const buildRuntime = (overrides: Record<string, unknown> = {}) => ({
  turn_id: "ask:test",
  session_id: null,
  goal: "test goal",
  status: "running",
  max_steps: 4,
  plan_items: [],
  open_subgoals: [],
  completed_subgoals: [],
  failed_subgoals: [],
  artifact_store: {},
  required_artifacts: [],
  satisfied_artifacts: [],
  observations: [],
  pending_request: null,
  decisions: [],
  last_decision: null,
  appended_steps: [],
  executed_appended_step_count: 0,
  runtime_loop_iteration_count: 0,
  runtime_loop_stop_reason: null,
  capability_selection_trace: [],
  observe_then_decide_trace: [],
  terminal: { kind: null, text: null },
  ...overrides,
});

describe("Helix Ask policy-adjacent decision characterization", () => {
  it("keeps current capability-selection result structure stable for representative goals", () => {
    const cases = [
      {
        id: "conversation",
        frame: buildFrame({ goalKind: "conversation", raw: "do not open the calculator, just explain the words" }),
        expected: {
          capability_id: null,
          expected_observation_kind: "direct_answer",
          ambiguity: "none",
        },
      },
      {
        id: "summarize_doc_active",
        frame: buildFrame({
          goalKind: "summarize_doc",
          workspaceRefs: [{ kind: "active_doc", value: "docs/example.md", source: "context", confidence: 0.8 }],
          evidence: ["doc_summary"],
        }),
        expected: {
          capability_id: "docs-viewer.summarize_doc",
          expected_observation_kind: "doc_summary",
          ambiguity: "none",
        },
      },
      {
        id: "locate_doc_missing_active_doc",
        frame: buildFrame({ goalKind: "locate_in_doc", evidence: ["doc_location_matches"] }),
        expected: {
          capability_id: "docs-viewer.locate_in_doc",
          expected_observation_kind: "doc_location_matches",
          ambiguity: "missing_args",
        },
      },
      {
        id: "write_note_explicit_target",
        frame: buildFrame({
          goalKind: "write_note",
          mutationTargets: [{ kind: "note", value: "Lab Note", resolution: "explicit", confidence: 0.9 }],
          evidence: ["note_update_receipt"],
        }),
        expected: {
          capability_id: "workstation-notes.append_to_note",
          expected_observation_kind: "note_update_receipt",
          ambiguity: "none",
        },
      },
    ];

    for (const testCase of cases) {
      const result = __testHelixAskPolicyAdjacentDecisions.buildAskTurnCapabilitySelectionResult({
        frame: testCase.frame as any,
      });
      expect(result).toMatchObject({
        capability_id: testCase.expected.capability_id,
        expected_observation: { kind: testCase.expected.expected_observation_kind },
        ambiguity: { status: testCase.expected.ambiguity },
      });
      expect(result).toHaveProperty("required_artifacts");
      expect(result).toHaveProperty("confidence");
      expect(result).toHaveProperty("source");
    }
  });

  it("preserves selected action fallback for panel control without making contextual conversation executable", () => {
    const contextual = __testHelixAskPolicyAdjacentDecisions.buildAskTurnCapabilitySelectionResult({
      frame: buildFrame({
        goalKind: "conversation",
        raw: "I have not opened the calculator yet; do not run it.",
      }) as any,
    });
    expect(contextual.capability_id).toBeNull();

    const panel = __testHelixAskPolicyAdjacentDecisions.buildAskTurnCapabilitySelectionResult({
      frame: buildFrame({ goalKind: "panel_control", raw: "focus the requested panel" }) as any,
      selectedAction: {
        panel_id: "scientific-calculator",
        action_id: "open",
        args: { focus: true },
      },
    });
    expect(panel).toMatchObject({
      capability_id: "scientific-calculator.open",
      expected_observation: { kind: "workspace_action_receipt" },
      ambiguity: { status: "none" },
    });
  });

  it("keeps current observation-decision precedence stable", () => {
    const goalFrame = buildFrame({ goalKind: "locate_in_doc", raw: "locate this in the doc" }) as any;
    const completedStep = {
      id: "done",
      lane: "workspace",
      title: "Done",
      status: "completed",
      required_artifacts: ["doc_location_matches"],
    };
    const nextStep = {
      id: "calc",
      lane: "workspace",
      title: "Run calculator",
      status: "planned",
      action: { panel_id: "scientific-calculator", action_id: "solve_expression", args: { expression: "2+2" } },
      required_artifacts: ["calculator_receipt"],
    };

    const pending = __testHelixAskPolicyAdjacentDecisions.buildAskTurnObservationDecision({
      runtime: buildRuntime({ pending_request: { required_fields: ["path"] } }) as any,
      goalFrame,
      capabilitySelection: null,
      completedStep,
      stepResults: [],
    });
    expect(pending).toMatchObject({
      decision: "request_user_input",
      reason: "pending_request_active",
      terminal_allowed: false,
    });

    const missingWithNext = __testHelixAskPolicyAdjacentDecisions.buildAskTurnObservationDecision({
      runtime: buildRuntime({ required_artifacts: ["calculator_receipt"] }) as any,
      goalFrame,
      capabilitySelection: null,
      completedStep,
      stepResults: [],
      nextPlannedStep: nextStep,
    });
    expect(missingWithNext).toMatchObject({
      decision: "continue",
      next_capability: { capability_id: "scientific-calculator.solve_expression" },
      terminal_allowed: false,
    });

    const failed = __testHelixAskPolicyAdjacentDecisions.buildAskTurnObservationDecision({
      runtime: buildRuntime({ failed_subgoals: ["docs"] }) as any,
      goalFrame,
      capabilitySelection: null,
      completedStep: { ...completedStep, status: "failed", reason: "tool_failed" } as any,
      stepResults: [],
    });
    expect(failed).toMatchObject({
      decision: "typed_failure",
      reason: "tool_failed",
      terminal_allowed: false,
    });
  });

  it("keeps observation existence distinct from missing required artifact satisfaction", () => {
    const goalFrame = buildFrame({ goalKind: "locate_in_doc", raw: "locate this in the doc" }) as any;

    const unrelatedObservation = __testHelixAskPolicyAdjacentDecisions.buildAskTurnObservationDecision({
      runtime: buildRuntime({
        required_artifacts: ["doc_location_matches"],
        artifact_store: { doc_search_results: { kind: "doc_search_results" } },
      }) as any,
      goalFrame,
      capabilitySelection: null,
      completedStep: null,
      stepResults: [],
    });
    expect(unrelatedObservation).toMatchObject({
      decision: "request_user_input",
      missing_artifacts: ["doc_location_matches"],
      terminal_allowed: false,
    });

    const satisfied = __testHelixAskPolicyAdjacentDecisions.buildAskTurnObservationDecision({
      runtime: buildRuntime({
        required_artifacts: ["doc_location_matches"],
        artifact_store: { doc_location_matches: { kind: "doc_location_matches" } },
        satisfied_artifacts: ["doc_location_matches"],
      }) as any,
      goalFrame,
      capabilitySelection: null,
      completedStep: null,
      stepResults: [],
    });
    expect(satisfied).toMatchObject({
      decision: "finalize",
      missing_artifacts: [],
      terminal_allowed: true,
    });
  });
});
