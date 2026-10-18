import { describe, expect, it } from "vitest";

import { buildCommittedAskRoute } from "../committed-ask-route";

describe("committed Ask route late capability proposals", () => {
  it("does not let a model-proposed capability rewrite a hard procedure-memory route", () => {
    const turnId = "ask:test:procedure-memory-late-proposal";
    const committed = buildCommittedAskRoute({
      turnId,
      promptText:
        "What changed since the previous visual capture, and was the 10 second interval running?",
      selectedRoute: "procedure_epoch_replay_question",
      payload: {
        source_target_intent: {
          schema: "helix.ask_source_target_intent.v1",
          turn_id: turnId,
          target_source: "procedure_memory",
          target_kind: "situation_epoch",
          strength: "hard",
          must_enter_backend_ask: true,
          allow_client_shortcut: false,
          allow_no_tool_direct: false,
        },
        canonical_goal_frame: {
          schema: "helix.canonical_goal_frame.v1",
          goal_kind: "unknown",
          required_terminal_kind: "unknown",
        },
        tool_call_admission_decision: {
          schema: "helix.tool_call_admission_decision.v1",
          source_target: "procedure_memory",
          admitted_tool_families: ["procedure_memory", "situation_run"],
          requested_capability: "repo-code.search_concept",
          admitted_capability: "repo-code.search_concept",
        },
        capability_plan: {
          schema: "helix.ask_capability_plan.v1",
          requested_capability: "procedure_memory",
          selected_capability: "retrieve_procedure_evidence",
          source_target: "procedure_memory",
          family: "procedure_memory",
        },
        tool_lifecycle_trace: {
          schema: "helix.tool_lifecycle_trace.v1",
          requested_capability: "repo-code.search_concept",
          admitted_capability: "repo-code.search_concept",
        },
        operational_capability_trace: {
          schema: "helix.operational_capability_trace.v1",
          model_proposed_capability: "repo-code.search_concept",
          policy_admitted_capability: "repo-code.search_concept",
        },
      },
    });

    expect(committed.route).toMatchObject({
      source_target: "procedure_memory",
      target_kind: "situation_epoch",
      strength: "hard",
    });
    expect(committed.canonical_goal).toMatchObject({
      goal_kind: "procedure_epoch_replay_question",
      required_terminal_kind: "procedure_epoch_replay",
    });
    expect(committed.terminal_product).toMatchObject({
      evidence_reentry_required: true,
      followup_reasoning_required: false,
      required_terminal_product: "procedure_epoch_replay",
    });
    expect(committed.capability_policy.required_capability_families).not.toContain(
      "repo_code",
    );
  });

  it("rebuilds an early incompatible route after hard source arbitration materializes", () => {
    const turnId = "ask:test:procedure-memory-stale-commit";
    const prompt =
      "What changed since the previous visual capture, and was the 10 second interval running?";
    const stale = buildCommittedAskRoute({
      turnId,
      promptText: prompt,
      selectedRoute: "procedure_epoch_replay_question",
      payload: {
        tool_call_admission_decision: {
          requested_capability: "repo-code.search_concept",
          admitted_capability: "repo-code.search_concept",
        },
      },
    });
    expect(stale.route.source_target).toBe("repo_code");

    const repaired = buildCommittedAskRoute({
      turnId,
      promptText: prompt,
      selectedRoute: "procedure_epoch_replay_question",
      payload: {
        committed_ask_route: stale,
        source_target_intent: {
          schema: "helix.ask_source_target_intent.v1",
          turn_id: turnId,
          target_source: "procedure_memory",
          target_kind: "situation_epoch",
          strength: "hard",
        },
        canonical_goal_frame: {
          schema: "helix.canonical_goal_frame.v1",
          goal_kind: "procedure_memory",
          required_terminal_kind: "procedure_epoch_replay",
        },
        tool_call_admission_decision: {
          source_target: "procedure_memory",
          admitted_tool_families: ["procedure_memory", "situation_run"],
          requested_capability: "repo-code.search_concept",
          admitted_capability: "repo-code.search_concept",
        },
        capability_plan: {
          selected_capability: "retrieve_procedure_evidence",
          source_target: "procedure_memory",
          family: "procedure_memory",
        },
      },
    });

    expect(repaired.route).toMatchObject({
      source_target: "procedure_memory",
      target_kind: "situation_epoch",
      strength: "hard",
    });
    expect(repaired.canonical_goal).toMatchObject({
      goal_kind: "procedure_epoch_replay_question",
      required_terminal_kind: "procedure_epoch_replay",
    });
    expect(repaired.terminal_product.followup_reasoning_required).toBe(false);
    expect(repaired.capability_policy.required_capability_families).not.toContain(
      "repo_code",
    );
  });
});
