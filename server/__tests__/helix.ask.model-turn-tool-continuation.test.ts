import { describe, expect, it } from "vitest";

import type { HelixModelTurnPacket } from "../services/helix-ask/model-turn-packet";
import { runHelixModelTurnToolContinuation } from "../services/helix-ask/model-turn-tool-continuation";

const packet: HelixModelTurnPacket = {
  schema: "helix.model_turn_packet.v1",
  turn_id: "turn-tool-1",
  prompt_text: "Calculate 12 * 9, then explain the arithmetic.",
  available_capabilities: [
    {
      capability_key: "scientific-calculator.solve_expression",
      requires_action: true,
      goal_fit: "primary",
    },
  ],
  artifact_refs: [],
  model_visible_artifacts: [],
  output_budget: {
    schema: "helix.final_answer_output_budget.v1",
    mode: "standard",
    max_tokens: 1800,
  },
  loop_policy: {
    max_model_steps: 2,
    allow_tools: true,
    require_model_authored_terminal: true,
    deterministic_fallback_terminal_allowed: false,
  },
  committed_ask_route: {
    schema: "helix.committed_ask_route.v1",
    turn_id: "turn-tool-1",
    route: { source_target: "calculator_stream" },
    canonical_goal: {
      goal_kind: "calculator_solve",
      required_terminal_kind: "final_answer_draft",
    },
    capability_policy: {
      allowed_tool_families: ["scientific_calculator"],
      suppressed_tool_families: [],
    },
  } as HelixModelTurnPacket["committed_ask_route"],
  assistant_answer: false,
  raw_content_included: false,
};

describe("Helix Ask model turn tool continuation", () => {
  it("re-enters the model after a requested tool call and materializes the assistant message as final draft", async () => {
    const calls: string[] = [];
    const result = await runHelixModelTurnToolContinuation({
      packet,
      payload: {},
      testResponseOverrides: [
        {
          status: "tool_call_requested",
          requested_tool_call: {
            capability_id: "scientific-calculator.solve_expression",
            args: { expression: "12 * 9" },
            reason: "Arithmetic should be observed before answering.",
          },
        },
        {
          status: "assistant_message",
          text: "12 * 9 is 108. The multiplication means twelve groups of nine.",
        },
      ],
      executeCapability: async (toolCall) => {
        calls.push(toolCall.capability_id);
        return {
          status: "succeeded",
          summary: "Calculator observed expression 12 * 9 = 108.",
          value: 108,
        };
      },
    });

    expect(calls).toEqual(["scientific-calculator.solve_expression"]);
    expect(result.status).toBe("continued_to_assistant_message");
    expect(result.packets).toHaveLength(2);
    expect(result.model_turn_results.map((entry) => entry.status)).toEqual([
      "tool_call_requested",
      "assistant_message",
    ]);
    expect(result.observation_artifacts[0]).toMatchObject({
      kind: "model_turn_tool_observation",
      payload: {
        schema: "helix.model_turn_tool_observation.v1",
        capability_id: "scientific-calculator.solve_expression",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
      },
    });
    expect(result.packets[1].artifact_refs).toEqual([
      "turn-tool-1:model_turn_tool_observation:1:scientific_calculator_solve_expression",
    ]);
    expect(result.packets[1].model_visible_artifacts[0]).toMatchObject({
      kind: "model_turn_tool_observation",
      summary: "Calculator observed expression 12 * 9 = 108.",
    });
    expect(result.payload.final_answer_draft).toMatchObject({
      schema: "helix.final_answer_draft.v1",
      source: "model_turn",
      authority: "model_turn_assistant_message",
      text: "12 * 9 is 108. The multiplication means twelve groups of nine.",
      output_budget: {
        schema: "helix.final_answer_output_budget.v1",
      },
    });
  });

  it("keeps tool observations non-terminal when follow-up model turn fails", async () => {
    const result = await runHelixModelTurnToolContinuation({
      packet: {
        ...packet,
        committed_ask_route: {
          schema: "helix.committed_ask_route.v1",
          turn_id: "turn-tool-1",
          route: { source_target: "repo_code" },
          canonical_goal: {
            goal_kind: "repo_evidence_question",
            required_terminal_kind: "final_answer_draft",
          },
          capability_policy: {
            allowed_tool_families: ["repo_code"],
            suppressed_tool_families: [],
          },
        } as HelixModelTurnPacket["committed_ask_route"],
      },
      payload: {},
      testResponseOverrides: [
        {
          status: "tool_call_requested",
          requested_tool_call: {
            capability_id: "repo-code.search_concept",
            args: { query: "field theory" },
          },
        },
        {
          status: "typed_failure",
          text: "The model follow-up step was unavailable.",
        },
      ],
      executeCapability: () => ({
        status: "succeeded",
        summary: "Repo search returned candidate files.",
        refs: ["server/routes/agi.plan.ts"],
      }),
    });

    expect(result.status).toBe("continued_to_typed_failure");
    expect(result.payload.final_answer_draft).toBeUndefined();
    expect(result.observation_artifacts[0].payload.terminal_eligible).toBe(false);
    expect(result.observation_artifacts[0].payload.post_tool_model_step_required).toBe(true);
  });

  it("blocks a runtime-authored docs request outside a committed Theory-only route", async () => {
    const executed: string[] = [];
    const theoryPacket = {
      ...packet,
      turn_id: "turn-theory-route-filter",
      prompt_text:
        "Reflect local adaptation through the Theory Badge Graph. Do not use web or paper evidence yet.",
      committed_ask_route: {
        schema: "helix.committed_ask_route.v1",
        turn_id: "turn-theory-route-filter",
        commit_id: "committed-route:theory-filter",
        prompt_hash: "test",
        committed_at_stage: "post_prompt_source_arbitration",
        prompt_intent: {
          primary_intent_kind: "general_reasoning",
          secondary_intent_kinds: [],
          interpretation_ref: "prompt_interpretation",
          arbitration_ref: "intent_arbitration",
        },
        route: {
          selected_route: "/ask",
          source_target: "theory_locator",
          target_kind: "theory_locator",
          strength: "hard",
          source_identity: null,
          route_reason: "explicit_capability_contract",
          stale_metadata_policy: "ignore_unless_matches_commit",
        },
        canonical_goal: {
          goal_kind: "theory_locator",
          required_terminal_kind: "theory_context_reflection_answer",
          allowed_terminal_artifact_kinds: ["theory_context_reflection_answer"],
          forbidden_terminal_artifact_kinds: ["tool_receipt"],
        },
        capability_policy: {
          allowed_tool_families: ["workstation_tool_gateway", "theory_locator"],
          suppressed_tool_families: [],
          required_capability_families: ["theory_locator"],
          mutating_families_allowed: false,
        },
        suppression: {
          contextual_tool_mentions: [],
          negative_constraints: [],
          suppressed_families: [],
          firewall_required: true,
        },
        terminal_product: {
          terminal_authority_required: true,
          evidence_reentry_required: true,
          followup_reasoning_required: true,
          required_terminal_product: "theory_context_reflection_answer",
        },
        transitions: [],
        compatibility: {
          source_goal_capability_terminal_compatible: true,
          stale_metadata_ignored: false,
          shortcut_firewall_applied: false,
          violations: [],
        },
        assistant_answer: false,
        raw_content_included: false,
      },
    } satisfies HelixModelTurnPacket;

    const result = await runHelixModelTurnToolContinuation({
      packet: theoryPacket,
      payload: {},
      testResponseOverrides: [{
        status: "tool_call_requested",
        requested_tool_call: {
          capability_id: "docs.search",
          args: { query: "nhm2 current status whitepaper" },
        },
      }],
      executeCapability: async (toolCall) => {
        executed.push(toolCall.capability_id);
        return { status: "succeeded" };
      },
    });

    expect(executed).toEqual([]);
    expect(result.status).toBe("tool_continuation_blocked");
    expect(result.payload.committed_route_tool_admission).toMatchObject({
      capability_id: "docs.search",
      inferred_family: "docs_viewer",
      allowed: false,
      reason: "selected_capability_not_allowed_by_committed_route",
    });
  });
});
