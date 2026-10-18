import { describe, expect, it } from "vitest";

import { __testHelixDebugProjection } from "../routes/agi.plan";

describe("Helix Ask debug projection", () => {
  it("projects MicroDeck runtime capability over stale docs planner fields", () => {
    const payload: Record<string, unknown> = {
      selected_capability: "docs-viewer.search_docs",
      agent_step_decision: {
        chosen_capability: "docs-viewer.search_docs",
        selected_tool: "docs-viewer.search_docs",
      },
      capability_plan: {
        selected_capability: "docs-viewer.search_docs",
        selected_capability_key: "docs-viewer.search_docs",
      },
      tool_call_admission_decision: {
        selected_capability: "docs-viewer.search_docs",
        admitted_tool: "docs-viewer.search_docs",
      },
      current_turn_artifact_ledger: [
        {
          kind: "runtime_tool_call",
          payload: {
            capability_key: "live_env.query_micro_reasoner_presets",
            args: { include_presets: true },
          },
        },
        {
          kind: "live_environment_tool_observation",
          payload: {
            tool_name: "live_env.query_micro_reasoner_presets",
            observation: {
              schema: "stage_play_micro_reasoner_prompt_preset_query_result/v1",
              preset_id: "visual_capture_default",
            },
          },
        },
      ],
      agent_runtime_loop: {
        iterations: [
          {
            chosen_capability: "docs-viewer.search_docs",
            executed_action_key: "live_env.query_micro_reasoner_presets",
            observation_role: "tool_observation",
            tool_observation: {
              tool_name: "live_env.query_micro_reasoner_presets",
              observation: {
                schema: "stage_play_micro_reasoner_prompt_preset_query_result/v1",
              },
            },
          },
        ],
      },
    };

    expect(__testHelixDebugProjection.readMailboxWakeSelectedCapabilityForDebug(payload)).toBe(
      "live_env.query_micro_reasoner_presets",
    );

    const transaction = __testHelixDebugProjection.buildStagePlayWakeTransactionDebug({
      activeTurnId: "ask:microdeck-projection",
      payload,
      routeMetadata: {
        invocationKind: "stage_play_mail_wake",
        wakeRequestId: "stage_play_live_source_mail_wake:microdeck-projection",
      } as any,
      stagePlayMailboxDebug: {
        route: "live_source_mailbox",
        route_selected: "live_source_mailbox",
      },
    });

    expect(transaction).toMatchObject({
      schema: "stage_play_wake_transaction_debug/v1",
      selectedCapability: "live_env.query_micro_reasoner_presets",
    });
    expect(transaction?.selectedCapability).not.toBe("docs-viewer.search_docs");
  });

  it("uses terminal-authority-selected MicroDeck capability when runtime artifacts are absent", () => {
    const payload: Record<string, unknown> = {
      selected_capability: "docs-viewer.search_docs",
      capability_plan: {
        selected_capability: "docs-viewer.search_docs",
      },
      terminal_authority_single_writer: {
        selected_capability: "live_env.query_micro_reasoner_presets",
      },
    };

    expect(__testHelixDebugProjection.readMailboxWakeSelectedCapabilityForDebug(payload)).toBe(
      "live_env.query_micro_reasoner_presets",
    );
  });

  it("runs terminal single-writer for completed compound rails without a preexisting draft", () => {
    const compoundContract = {
      schema: "helix.compound_capability_contract.v1",
      requires_all_subgoals: true,
      subgoals: [
        {
          subgoal_id: "docs",
          requested_capability: "docs-viewer.locate_in_doc",
          runtime_capability: "docs-viewer.locate_in_doc",
          mandatory: true,
        },
        {
          subgoal_id: "calculator",
          requested_capability: "scientific-calculator.solve_expression",
          runtime_capability: "scientific-calculator.solve_expression",
          mandatory: true,
        },
      ],
    };
    const compoundRows = [
      {
        subgoal_id: "docs",
        requested_capability: "docs-viewer.locate_in_doc",
        selected_capability: "docs-viewer.locate_in_doc",
        executed_capability: "docs-viewer.locate_in_doc",
        observation_kind: "doc_location_matches",
        observation_ref: "ask:test:doc_location_matches:1",
        satisfaction: "satisfied",
        rail_status: "complete",
      },
      {
        subgoal_id: "calculator",
        requested_capability: "scientific-calculator.solve_expression",
        selected_capability: "scientific-calculator.solve_expression",
        executed_capability: "scientific-calculator.solve_expression",
        observation_kind: "calculator_receipt",
        observation_ref: "ask:test:calculator_receipt:1",
        satisfaction: "satisfied",
        rail_status: "complete",
      },
    ];
    const payload: Record<string, unknown> = {
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "pending_request_missing",
      debug: {},
      compound_capability_contract: compoundContract,
      capability_itinerary: {
        schema: "helix.capability_itinerary.v1",
        compound_capability_contract: compoundContract,
        terminal_success_criteria: {
          requires_post_observation_synthesis: true,
        },
      },
      capability_itinerary_execution_state: {
        schema: "helix.capability_itinerary_execution_state.v1",
        applies: true,
        complete: true,
        compound_subgoal_ledger: compoundRows,
      },
      compound_subgoal_rail_statuses: compoundRows,
    };
    const artifacts = [
      {
        turn_id: "ask:test",
        artifact_id: "ask:test:doc_location_matches:1",
        producer_item_id: "docs-viewer.locate_in_doc",
        kind: "doc_location_matches",
        payload: {
          artifact_id: "ask:test:doc_location_matches:1",
          kind: "doc_location_matches",
          text: "Located the terminal-authority discussion.",
        },
      },
      {
        turn_id: "ask:test",
        artifact_id: "ask:test:calculator_receipt:1",
        producer_item_id: "scientific-calculator.solve_expression",
        kind: "calculator_receipt",
        payload: {
          artifact_id: "ask:test:calculator_receipt:1",
          kind: "calculator_receipt",
          expression: "2 + 2",
          result: 4,
        },
      },
    ];

    expect(__testHelixDebugProjection.shouldApplyTerminalSingleWriterForPayload(payload, artifacts as any)).toBe(true);
    expect((payload.compound_capability_synthesis_readiness as Record<string, unknown>).complete).toBe(true);
    expect((payload.completed_compound_terminal_single_writer_bridge as Record<string, unknown>)).toMatchObject({
      applies: true,
      reason: "completed_compound_subgoals_require_terminal_single_writer",
      synthesis_terminal_kind: "doc_evidence_synthesis_answer",
    });
    expect(((payload.debug as Record<string, unknown>).completed_compound_terminal_single_writer_bridge as Record<string, unknown>).applies).toBe(true);
  });
});
