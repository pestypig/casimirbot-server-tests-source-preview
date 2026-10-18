import { describe, expect, it } from "vitest";

import {
  buildCapabilityBindingMismatchObservation,
  evaluateTerminalBoundaryEligibility,
  goalSatisfactionAllowsTerminal,
  hasAgentRuntimeLoopDecisionChain,
  hasDirectAnswerDraft,
  hasPostObservationModelDecision,
  hasRuntimeToolCallForSelectedCapability,
  hasSelectedCapabilityObservation,
  isModelDirectAnswerTurn,
  isSourceCapabilityDiagnosticTurn,
} from "../services/helix-ask/runtime-authority-contract";
import { buildPostToolAuthorityBridge } from "../services/helix-ask/post-tool-authority-bridge";
import { buildRouteProductContract } from "../services/helix-ask/route-product-contract";
import { createHelixTurnLifecycleRecorder } from "../services/helix-ask/runtime/turn-lifecycle";
import { resolveToolFamilyContract } from "../services/helix-ask/tool-family-contract";

describe("helix ask runtime authority contract", () => {
  it("retains capability-catalog observation authority after the model selects the answer step", () => {
    const payload = {
      canonical_goal_frame: {
        goal_kind: "capability_help",
        required_terminal_kind: "capability_help_summary",
      },
      route_product_contract: {
        allowed_terminal_artifact_kinds: ["capability_help_summary", "typed_failure"],
      },
      terminal_artifact_kind: "capability_help_summary",
      final_answer_source: "capability_help_summary",
      capability_plan: {
        selected_capability: "helix_ask.inspect_capability_catalog",
      },
      tool_turn_chain_audit: {
        selected_capability: "helix_ask.inspect_capability_catalog",
        executed_capability: "helix_ask.inspect_capability_catalog",
      },
      agent_step_decision: {
        chosen_capability: "model.direct_answer",
        next_step: "answer",
        decision_timing: "post_observation",
        decision_authority: "llm",
      },
      agent_runtime_loop: {
        executed_tool_call_count: 0,
        iterations: [{
          chosen_capability: "model.direct_answer",
          next_step: "answer",
          decision_timing: "post_observation",
          decision_authority: "llm",
          observation_role: "model_answer_draft",
        }],
      },
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "ask:test:capability_registry",
          kind: "capability_registry",
          payload: { schema: "helix.capability_registry.v1" },
        },
        {
          artifact_id: "ask:test:capability_help_summary",
          kind: "capability_help_summary",
          payload: {
            schema: "helix.capability_help_summary.v1",
            text: "Capability help is grounded in the current runtime catalog.",
          },
        },
      ],
    };

    expect(hasSelectedCapabilityObservation(payload)).toBe(true);
    expect(evaluateTerminalBoundaryEligibility(payload)).toMatchObject({
      eligible: true,
      severity: "pass",
      checks: {
        selected_capability_observation: true,
        post_observation_model_decision: true,
        goal_satisfaction_allows_terminal: true,
      },
      blocking_reasons: [],
    });
  });

  it("requires model-only direct answers to include a model answer step and answer draft", () => {
    const report = evaluateTerminalBoundaryEligibility({
      canonical_goal_frame: { goal_kind: "model_only_concept" },
      terminal_artifact_kind: "direct_answer_text",
      final_answer_source: "model_direct_answer",
    });

    expect(report.source_capability_diagnostic_turn).toBe(true);
    expect(report.requires_runtime_loop).toBe(false);
    expect(report.eligible).toBe(false);
    expect(report.blocking_reasons).toEqual(
      expect.arrayContaining([
        "agent_step_decision_missing",
        "direct_answer_text_missing",
        "post_observation_model_decision_missing",
      ]),
    );
  });

  it("allows model-only direct answers from a terminal-review model decision and answer artifact without a tool loop", () => {
    const payload = {
      canonical_goal_frame: { goal_kind: "model_only_concept" },
      terminal_artifact_kind: "direct_answer_text",
      final_answer_source: "model_direct_answer",
      goal_satisfaction_evaluation: {
        canonical_goal_kind: "model_only_concept",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      agent_step_decision: {
        decision_timing: "terminal_review",
        sampling: { mode: "llm" },
        model_decision: {
          next_step: "answer",
          chosen_capability: "model.direct_answer",
        },
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "direct-answer-1",
          kind: "direct_answer_text",
          payload: {
            schema: "helix.direct_answer_text.v1",
            text: "Electrons are negatively charged and much lighter than protons.",
          },
        },
      ],
    };

    const report = evaluateTerminalBoundaryEligibility(payload);
    expect(report.eligible).toBe(true);
    expect(report.requires_runtime_loop).toBe(false);
    expect(report.blocking_reasons).toEqual([]);
  });

  it("allows model-only direct answers after the loop records a model answer draft", () => {
    const payload = {
      canonical_goal_frame: { goal_kind: "model_only_concept" },
      terminal_artifact_kind: "direct_answer_text",
      final_answer_source: "model_direct_answer",
      goal_satisfaction_evaluation: {
        canonical_goal_kind: "model_only_concept",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "agent-step-answer",
            decision_authority: "llm",
            next_step: "answer",
            chosen_capability: "model.direct_answer",
            observation_role: "model_answer_draft",
            observed_artifact_refs: ["direct-answer-1"],
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "direct-answer-1",
          kind: "direct_answer_text",
          payload: {
            schema: "helix.direct_answer_text.v1",
            text: "An electron is a negatively charged elementary particle.",
          },
        },
      ],
    };

    expect(isSourceCapabilityDiagnosticTurn(payload)).toBe(false);
    expect(hasAgentRuntimeLoopDecisionChain(payload)).toBe(true);
    expect(hasDirectAnswerDraft(payload)).toBe(true);
    expect(hasPostObservationModelDecision(payload)).toBe(true);
    expect(goalSatisfactionAllowsTerminal(payload)).toBe(true);

    const report = evaluateTerminalBoundaryEligibility(payload);
    expect(report.eligible).toBe(true);
    expect(report.severity).toBe("pass");
    expect(report.blocking_reasons).toEqual([]);
  });

  it("allows capability help terminal satisfaction from registry-backed summary artifacts", () => {
    const payload = {
      canonical_goal_frame: {
        goal_kind: "capability_help",
        required_terminal_kind: "capability_help_summary",
      },
      terminal_artifact_kind: "capability_help_summary",
      final_answer_source: "capability_help_summary",
      goal_satisfaction_evaluation: {
        canonical_goal_kind: "capability_help",
        satisfaction: "pending",
        next_decision: "continue",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "obs:capability-registry",
          kind: "capability_registry",
          payload: {
            kind: "capability_registry",
          },
        },
        {
          artifact_id: "obs:capability-help-summary",
          kind: "capability_help_summary",
          payload: {
            kind: "capability_help_summary",
            text: "The runtime capability catalog is available.",
          },
        },
      ],
    };

    expect(goalSatisfactionAllowsTerminal(payload)).toBe(true);
  });

  it("blocks source/capability terminals that skip the runtime loop", () => {
    const report = evaluateTerminalBoundaryEligibility({
      canonical_goal_frame: { goal_kind: "docs_panel_open" },
      terminal_artifact_kind: "workspace_action_receipt",
      final_answer_source: "artifact_synthesis",
      goal_satisfaction_evaluation: {
        canonical_goal_kind: "docs_panel_open",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
    });

    expect(report.source_capability_diagnostic_turn).toBe(true);
    expect(report.requires_runtime_loop).toBe(true);
    expect(report.eligible).toBe(false);
    expect(report.severity).toBe("p0");
    expect(report.blocking_reasons).toEqual(
      expect.arrayContaining([
        "agent_runtime_loop_missing",
        "agent_step_decision_missing",
        "selected_capability_observation_missing",
        "post_observation_model_decision_missing",
      ]),
    );
  });

  it("allows source/capability terminals after model decision, observation, post-observation review, and goal satisfaction", () => {
    const payload = {
      canonical_goal_frame: { goal_kind: "docs_panel_open" },
      terminal_artifact_kind: "workspace_action_receipt",
      final_answer_source: "artifact_synthesis",
      goal_satisfaction_evaluation: {
        canonical_goal_kind: "docs_panel_open",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "agent-step-1",
            decision_authority: "llm",
            decision_timing: "post_observation",
            chosen_capability: "docs-viewer.open",
            tool_observation: {
              status: "completed",
              artifact_refs: ["receipt-1"],
            },
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "receipt-1",
          kind: "workspace_action_receipt",
          payload: {
            kind: "workspace_action_receipt",
            panel_id: "docs-viewer",
            action_id: "open",
          },
        },
      ],
    };

    expect(isSourceCapabilityDiagnosticTurn(payload)).toBe(true);
    expect(hasAgentRuntimeLoopDecisionChain(payload)).toBe(true);
    expect(hasSelectedCapabilityObservation(payload)).toBe(true);
    expect(hasPostObservationModelDecision(payload)).toBe(true);
    expect(goalSatisfactionAllowsTerminal(payload)).toBe(true);

    const report = evaluateTerminalBoundaryEligibility(payload);
    expect(report.eligible).toBe(true);
    expect(report.severity).toBe("pass");
    expect(report.blocking_reasons).toEqual([]);
  });

  it("treats doc_summary artifacts as docs capability observations", () => {
    const payload = {
      canonical_goal_frame: { goal_kind: "active_doc_summary", required_terminal_kind: "doc_summary" },
      terminal_artifact_kind: "doc_summary",
      final_answer_source: "artifact_synthesis",
      goal_satisfaction_evaluation: {
        canonical_goal_kind: "active_doc_summary",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "agent-step-doc-summary",
            decision_authority: "llm",
            decision_timing: "post_observation",
            chosen_capability: "docs-viewer.summarize_doc",
            artifact_refs: ["doc-summary-1"],
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "doc-summary-1",
          kind: "doc_summary",
          payload: {
            kind: "doc_summary",
            path: "/docs/research/example.md",
            text: "This document summarizes the current status and caveats.",
          },
        },
      ],
    };

    expect(isSourceCapabilityDiagnosticTurn(payload)).toBe(true);
    expect(hasSelectedCapabilityObservation(payload)).toBe(true);

    const report = evaluateTerminalBoundaryEligibility(payload);
    expect(report.eligible).toBe(true);
    expect(report.blocking_reasons).not.toContain("selected_capability_observation_missing");
  });

  it("treats MicroDeck preset query results as the selected live_env query observation", () => {
    const payload = {
      canonical_goal_frame: { goal_kind: "live_environment_review", required_terminal_kind: "model_synthesized_answer" },
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      source_target_intent: {
        target_source: "live_source_mailbox",
        target_kind: "live_source",
      },
      goal_satisfaction_evaluation: {
        canonical_goal_kind: "live_environment_review",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "agent-step-microdeck-query",
            decision_authority: "llm",
            decision_timing: "post_observation",
            next_step: "answer",
            chosen_capability: "live_env.query_micro_reasoner_presets",
            executed_action_key: "live_env.query_micro_reasoner_presets",
            tool_observation: {
              schema: "helix.live_environment_tool_observation.v1",
              observation_id: "live_env_tool_observation:microdeck-query",
              tool_name: "live_env.query_micro_reasoner_presets",
              ok: true,
              summary: "Found 4 MicroDeck preset(s) and 13 prompt(s).",
              observation: {
                schema: "stage_play_micro_reasoner_prompt_preset_query_result/v1",
                presets: [],
                prompts: [],
                assistant_answer: false,
                terminal_eligible: false,
                raw_content_included: false,
                context_role: "tool_evidence",
              },
              assistant_answer: false,
              raw_content_included: false,
            },
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "runtime-tool-call-microdeck-query",
          kind: "runtime_tool_call",
          payload: {
            schema: "helix.runtime_tool_call.v1",
            call_id: "runtime-call-microdeck-query",
            capability_key: "live_env.query_micro_reasoner_presets",
            args: {},
          },
        },
      ],
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        server_authoritative: true,
        terminal_artifact_kind: "model_synthesized_answer",
        final_answer_source: "final_answer_draft",
      },
    };

    expect(isSourceCapabilityDiagnosticTurn(payload)).toBe(true);
    expect(hasRuntimeToolCallForSelectedCapability(payload, "live_env.query_micro_reasoner_presets")).toBe(true);
    expect(hasSelectedCapabilityObservation(payload)).toBe(true);

    const report = evaluateTerminalBoundaryEligibility(payload);
    expect(report.eligible).toBe(true);
    expect(report.checks).toMatchObject({
      runtime_tool_call: true,
      microdeck_selected_capability: true,
      selected_capability_observation: true,
      post_observation_model_decision: true,
      goal_satisfaction_allows_terminal: true,
    });
    expect(report.blocking_reasons).not.toContain("selected_capability_observation_missing");
  });

  it("treats MicroDeck preset drafts as the selected read-only setup observation", () => {
    const payload = {
      canonical_goal_frame: { goal_kind: "live_environment_review", required_terminal_kind: "model_synthesized_answer" },
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      source_target_intent: {
        target_source: "live_source_mailbox",
        target_kind: "live_source",
      },
      goal_satisfaction_evaluation: {
        canonical_goal_kind: "live_environment_review",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "agent-step-microdeck-draft",
            decision_authority: "llm",
            decision_timing: "post_observation",
            next_step: "answer",
            chosen_capability: "live_env.draft_micro_reasoner_preset",
            executed_action_key: "live_env.draft_micro_reasoner_preset",
            tool_observation: {
              schema: "helix.live_environment_tool_observation.v1",
              observation_id: "live_env_tool_observation:microdeck-draft",
              tool_name: "live_env.draft_micro_reasoner_preset",
              ok: true,
              summary: "Drafted MicroDeck preset from Generic Live Source Deck.",
              observation: {
                schema: "stage_play_micro_reasoner_prompt_preset_draft/v1",
                artifactId: "stage_play_micro_reasoner_prompt_preset_draft",
                draftId: "stage_play_micro_reasoner_prompt_preset_draft:test",
                confirmationRequired: true,
                createToolCall: {
                  toolName: "live_env.create_micro_reasoner_preset",
                  args: {},
                },
                assistant_answer: false,
                terminal_eligible: false,
                raw_content_included: false,
                context_role: "micro_reasoner_evidence",
              },
              assistant_answer: false,
              raw_content_included: false,
            },
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "runtime-tool-call-microdeck-draft",
          kind: "runtime_tool_call",
          payload: {
            schema: "helix.runtime_tool_call.v1",
            call_id: "runtime-call-microdeck-draft",
            capability_key: "live_env.draft_micro_reasoner_preset",
            args: {},
          },
        },
      ],
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        server_authoritative: true,
        terminal_artifact_kind: "model_synthesized_answer",
        final_answer_source: "final_answer_draft",
      },
    };

    expect(isSourceCapabilityDiagnosticTurn(payload)).toBe(true);
    expect(hasRuntimeToolCallForSelectedCapability(payload, "live_env.draft_micro_reasoner_preset")).toBe(true);
    expect(hasSelectedCapabilityObservation(payload)).toBe(true);

    const report = evaluateTerminalBoundaryEligibility(payload);
    expect(report.eligible).toBe(true);
    expect(report.checks).toMatchObject({
      runtime_tool_call: true,
      microdeck_selected_capability: true,
      selected_capability_observation: true,
      post_observation_model_decision: true,
      goal_satisfaction_allows_terminal: true,
    });
  });

  it("fails closed for MicroDeck draft summaries when the draft observation is missing", () => {
    const payload = {
      canonical_goal_frame: { goal_kind: "live_environment_review", required_terminal_kind: "model_synthesized_answer" },
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      source_target_intent: {
        target_source: "live_source_mailbox",
        target_kind: "live_source",
      },
      goal_satisfaction_evaluation: {
        canonical_goal_kind: "live_environment_review",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "agent-step-microdeck-draft",
            decision_authority: "llm",
            decision_timing: "post_observation",
            next_step: "answer",
            chosen_capability: "live_env.draft_micro_reasoner_preset",
            executed_action_key: "live_env.draft_micro_reasoner_preset",
            observed_artifact_refs: [],
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "runtime-tool-call-microdeck-draft",
          kind: "runtime_tool_call",
          payload: {
            schema: "helix.runtime_tool_call.v1",
            call_id: "runtime-call-microdeck-draft",
            capability_key: "live_env.draft_micro_reasoner_preset",
            args: {},
          },
        },
      ],
    };

    expect(hasRuntimeToolCallForSelectedCapability(payload, "live_env.draft_micro_reasoner_preset")).toBe(true);
    expect(hasSelectedCapabilityObservation(payload)).toBe(false);

    const report = evaluateTerminalBoundaryEligibility(payload);
    expect(report.eligible).toBe(false);
    expect(report.checks.runtime_tool_call).toBe(true);
    expect(report.checks.microdeck_selected_capability).toBe(true);
    expect(report.checks.selected_capability_observation).toBe(false);
    expect(report.blocking_reasons).toContain("selected_capability_observation_missing");
  });

  it("blocks MicroDeck summaries when an observation appears without a runtime tool call", () => {
    const payload = {
      canonical_goal_frame: { goal_kind: "live_environment_review", required_terminal_kind: "model_synthesized_answer" },
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      source_target_intent: {
        target_source: "live_source_mailbox",
        target_kind: "live_source",
      },
      goal_satisfaction_evaluation: {
        canonical_goal_kind: "live_environment_review",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "agent-step-microdeck-query",
            decision_authority: "llm",
            decision_timing: "post_observation",
            next_step: "answer",
            chosen_capability: "live_env.query_micro_reasoner_presets",
            tool_observation: {
              schema: "helix.live_environment_tool_observation.v1",
              observation_id: "live_env_tool_observation:microdeck-query",
              tool_name: "live_env.query_micro_reasoner_presets",
              ok: true,
              observation: {
                schema: "stage_play_micro_reasoner_prompt_preset_query_result/v1",
                assistant_answer: false,
                terminal_eligible: false,
                raw_content_included: false,
              },
              assistant_answer: false,
              raw_content_included: false,
            },
          },
        ],
      },
      current_turn_artifact_ledger: [],
    };

    expect(hasSelectedCapabilityObservation(payload)).toBe(true);
    expect(hasRuntimeToolCallForSelectedCapability(payload, "live_env.query_micro_reasoner_presets")).toBe(false);

    const report = evaluateTerminalBoundaryEligibility(payload);
    expect(report.eligible).toBe(false);
    expect(report.checks.runtime_tool_call).toBe(false);
    expect(report.blocking_reasons).toContain("runtime_tool_call_missing");
  });

  it("fails closed for MicroDeck terminal summaries when the query observation is missing", () => {
    const payload = {
      canonical_goal_frame: { goal_kind: "live_environment_review", required_terminal_kind: "model_synthesized_answer" },
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      source_target_intent: {
        target_source: "live_source_mailbox",
        target_kind: "live_source",
      },
      goal_satisfaction_evaluation: {
        canonical_goal_kind: "live_environment_review",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "agent-step-microdeck-query",
            decision_authority: "llm",
            decision_timing: "post_observation",
            next_step: "answer",
            chosen_capability: "live_env.query_micro_reasoner_presets",
            executed_action_key: "live_env.query_micro_reasoner_presets",
            observed_artifact_refs: [],
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "runtime-tool-call-microdeck-query",
          kind: "runtime_tool_call",
          payload: {
            schema: "helix.runtime_tool_call.v1",
            call_id: "runtime-call-microdeck-query",
            capability_key: "live_env.query_micro_reasoner_presets",
            args: {},
          },
        },
      ],
    };

    expect(hasRuntimeToolCallForSelectedCapability(payload, "live_env.query_micro_reasoner_presets")).toBe(true);
    expect(hasSelectedCapabilityObservation(payload)).toBe(false);

    const report = evaluateTerminalBoundaryEligibility(payload);
    expect(report.eligible).toBe(false);
    expect(report.checks.runtime_tool_call).toBe(true);
    expect(report.checks.microdeck_selected_capability).toBe(true);
    expect(report.checks.selected_capability_observation).toBe(false);
    expect(report.blocking_reasons).toContain("selected_capability_observation_missing");
  });

  it("blocks MicroDeck summaries until a post-observation answer decision exists", () => {
    const payload = {
      canonical_goal_frame: { goal_kind: "live_environment_review", required_terminal_kind: "model_synthesized_answer" },
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      source_target_intent: {
        target_source: "live_source_mailbox",
        target_kind: "live_source",
      },
      goal_satisfaction_evaluation: {
        canonical_goal_kind: "live_environment_review",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "agent-step-microdeck-query",
            decision_authority: "llm",
            decision_timing: "pre_observation",
            next_step: "next_action",
            chosen_capability: "live_env.query_micro_reasoner_presets",
            executed_action_key: "live_env.query_micro_reasoner_presets",
            tool_observation: {
              schema: "helix.live_environment_tool_observation.v1",
              observation_id: "live_env_tool_observation:microdeck-query",
              tool_name: "live_env.query_micro_reasoner_presets",
              ok: true,
              observation: {
                schema: "stage_play_micro_reasoner_prompt_preset_query_result/v1",
                assistant_answer: false,
                terminal_eligible: false,
                raw_content_included: false,
              },
              assistant_answer: false,
              raw_content_included: false,
            },
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "runtime-tool-call-microdeck-query",
          kind: "runtime_tool_call",
          payload: {
            schema: "helix.runtime_tool_call.v1",
            call_id: "runtime-call-microdeck-query",
            capability_key: "live_env.query_micro_reasoner_presets",
            args: {},
          },
        },
      ],
    };

    const report = evaluateTerminalBoundaryEligibility(payload);
    expect(report.checks.runtime_tool_call).toBe(true);
    expect(report.checks.selected_capability_observation).toBe(true);
    expect(report.checks.post_observation_model_decision).toBe(false);
    expect(report.eligible).toBe(false);
    expect(report.blocking_reasons).toContain("post_observation_model_decision_missing");
  });

  it("contracts MicroDeck query prompts as observation-backed model summaries", () => {
    const contract = buildRouteProductContract({
      turnId: "turn-microdeck-contract",
      promptText: "Inspect the active MicroDeck prompts for the visual live source.",
      sourceTargetIntent: {
        target_source: "live_source_mailbox",
        target_kind: "live_source",
      },
    });
    const toolContract = resolveToolFamilyContract({
      toolName: "live_env.query_micro_reasoner_presets",
    });

    expect(contract).toMatchObject({
      schema: "helix.route_product_contract.v1",
      source_target: "live_source_mailbox",
      precedence_reason: "microdeck_query_requires_tool_observation_then_model_synthesis",
    });
    expect(contract.allowed_terminal_artifact_kinds).toContain("model_synthesized_answer");
    expect(contract.allowed_terminal_artifact_kinds).not.toContain("live_environment_tool_observation");
    expect(contract.allowed_terminal_artifact_kinds).not.toContain("direct_answer_text");
    expect(contract.side_artifact_kinds_allowed).toContain("stage_play_micro_reasoner_prompt_preset_query_result");
    expect(toolContract).toMatchObject({
      toolName: "live_env.query_micro_reasoner_presets",
      authority: "evidence_only",
      mutating: false,
      requiredObservationKinds: ["stage_play_micro_reasoner_prompt_preset_query_result"],
      allowedTerminalKinds: ["model_synthesized_answer"],
      requiredReentry: true,
      requiresGoalSatisfaction: true,
    });
  });

  it("contracts MicroDeck draft prompts as observation-backed model summaries", () => {
    const contract = buildRouteProductContract({
      turnId: "turn-microdeck-draft-contract",
      promptText: "Draft a MicroDeck preset for a visual automation scenario using the closest base preset.",
      sourceTargetIntent: {
        target_source: "live_source_mailbox",
        target_kind: "live_source",
      },
    });
    const toolContract = resolveToolFamilyContract({
      toolName: "live_env.draft_micro_reasoner_preset",
    });

    expect(contract).toMatchObject({
      schema: "helix.route_product_contract.v1",
      source_target: "live_source_mailbox",
      precedence_reason: "microdeck_draft_requires_tool_observation_then_model_synthesis",
    });
    expect(contract.allowed_terminal_artifact_kinds).toContain("model_synthesized_answer");
    expect(contract.allowed_terminal_artifact_kinds).not.toContain("live_environment_tool_observation");
    expect(contract.side_artifact_kinds_allowed).toContain("stage_play_micro_reasoner_prompt_preset_draft");
    expect(toolContract).toMatchObject({
      toolName: "live_env.draft_micro_reasoner_preset",
      authority: "evidence_only",
      mutating: false,
      requiredObservationKinds: ["stage_play_micro_reasoner_prompt_preset_draft"],
      allowedTerminalKinds: ["model_synthesized_answer"],
      requiredReentry: true,
      requiresGoalSatisfaction: true,
    });
  });

  it("does not let a MicroDeck preset query result satisfy a different live_env selected capability", () => {
    const payload = {
      canonical_goal_frame: { goal_kind: "live_environment_review", required_terminal_kind: "model_synthesized_answer" },
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      source_target_intent: {
        target_source: "live_source_mailbox",
        target_kind: "live_source",
      },
      goal_satisfaction_evaluation: {
        canonical_goal_kind: "live_environment_review",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "agent-step-stale-mail-read",
            decision_authority: "llm",
            decision_timing: "post_observation",
            next_step: "answer",
            chosen_capability: "live_env.read_processed_live_source_mail",
            tool_observation: {
              schema: "helix.live_environment_tool_observation.v1",
              observation_id: "live_env_tool_observation:microdeck-query",
              tool_name: "live_env.query_micro_reasoner_presets",
              ok: true,
              summary: "Found 4 MicroDeck preset(s) and 13 prompt(s).",
              observation: {
                schema: "stage_play_micro_reasoner_prompt_preset_query_result/v1",
                presets: [],
                prompts: [],
                assistant_answer: false,
                terminal_eligible: false,
                raw_content_included: false,
                context_role: "tool_evidence",
              },
              assistant_answer: false,
              raw_content_included: false,
            },
          },
        ],
      },
      current_turn_artifact_ledger: [],
    };

    expect(hasSelectedCapabilityObservation(payload)).toBe(false);

    const report = evaluateTerminalBoundaryEligibility(payload);
    expect(report.blocking_reasons).toContain("selected_capability_observation_missing");
  });

  it("accepts agent step loop capability observations recorded after the selected action step", () => {
    const payload = {
      canonical_goal_frame: { goal_kind: "doc_evidence_location", required_terminal_kind: "doc_location_result" },
      terminal_artifact_kind: "doc_location_matches",
      final_answer_source: "model_direct_answer",
      goal_satisfaction_evaluation: {
        canonical_goal_kind: "doc_evidence_location",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "agent-step-answer",
            decision_authority: "llm",
            decision_timing: "terminal_review",
            next_step: "answer",
            chosen_capability: "model.direct_answer",
            observation_role: "terminal_decision",
          },
        ],
      },
      final_answer_draft: {
        text: "Locations:\n- /docs/research/example.md:12 - Assumptions are listed here.",
      },
      agent_step_loop: {
        steps: [
          {
            step_id: "initial",
            decision_ref: "agent-step-locate",
            next_step: "next_action",
            chosen_capability: "docs-viewer.locate_in_doc",
            observation_refs: [],
            sampling_mode: "llm",
          },
          {
            step_id: "post_observation",
            decision_ref: "agent-step-answer",
            next_step: "answer",
            chosen_capability: null,
            observation_refs: ["doc-location-1"],
            sampling_mode: "llm",
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "doc-location-1",
          kind: "doc_location_matches",
          payload: {
            kind: "doc_location_matches",
            path: "/docs/research/example.md",
            matches: [{ path: "/docs/research/example.md", line_start: 12, line_end: 12, text: "Assumptions are listed here." }],
          },
        },
      ],
    };

    expect(hasSelectedCapabilityObservation(payload)).toBe(true);

    const report = evaluateTerminalBoundaryEligibility(payload);
    expect(report.eligible).toBe(true);
    expect(report.blocking_reasons).not.toContain("selected_capability_observation_missing");
  });

  it("does not let an unrelated current-turn artifact satisfy the selected capability observation", () => {
    const payload = {
      canonical_goal_frame: { goal_kind: "calculator_solve", required_terminal_kind: "calculator_receipt" },
      terminal_artifact_kind: "calculator_receipt",
      final_answer_source: "artifact_synthesis",
      goal_satisfaction_evaluation: {
        canonical_goal_kind: "calculator_solve",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "agent-step-calculator",
            decision_authority: "llm",
            decision_timing: "post_observation",
            chosen_capability: "scientific-calculator.solve_expression",
            observed_artifact_refs: ["doc-summary-1"],
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "doc-summary-1",
          kind: "doc_summary",
          payload: {
            kind: "doc_summary",
            path: "/docs/research/example.md",
            text: "This is not a calculator receipt.",
          },
        },
      ],
    };

    expect(hasSelectedCapabilityObservation(payload)).toBe(false);

    const report = evaluateTerminalBoundaryEligibility(payload);
    expect(report.eligible).toBe(false);
    expect(report.blocking_reasons).toContain("selected_capability_observation_missing");
  });

  it("does not let a completed tool observation satisfy the wrong selected capability by ref presence alone", () => {
    const payload = {
      canonical_goal_frame: { goal_kind: "calculator_solve", required_terminal_kind: "calculator_receipt" },
      terminal_artifact_kind: "calculator_receipt",
      final_answer_source: "artifact_synthesis",
      goal_satisfaction_evaluation: {
        canonical_goal_kind: "calculator_solve",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "agent-step-calculator",
            decision_authority: "llm",
            decision_timing: "post_observation",
            chosen_capability: "scientific-calculator.solve_expression",
            tool_observation: {
              status: "completed",
              artifact_refs: ["doc-summary-1"],
            },
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "doc-summary-1",
          kind: "doc_summary",
          payload: {
            kind: "doc_summary",
            decision_ref: "agent-step-calculator",
            path: "/docs/research/example.md",
            text: "This artifact is linked to the decision but is still the wrong tool family.",
          },
        },
      ],
    };

    expect(hasSelectedCapabilityObservation(payload)).toBe(false);

    const report = evaluateTerminalBoundaryEligibility(payload);
    expect(report.eligible).toBe(false);
    expect(report.blocking_reasons).toContain("selected_capability_observation_missing");
  });

  it("treats Dottie observer receipts as observations for selected Situation Room observer capabilities", () => {
    const payload = {
      canonical_goal_frame: { goal_kind: "panel_control", required_terminal_kind: "workstation_tool_evaluation" },
      terminal_artifact_kind: "workstation_tool_evaluation",
      final_answer_source: "workstation_tool_evaluation",
      goal_satisfaction_evaluation: {
        canonical_goal_kind: "panel_control",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "agent-step-dottie-attach",
            decision_authority: "llm",
            decision_timing: "post_observation",
            chosen_capability: "situation-room-pipelines.observer.attach",
            observed_artifact_refs: ["dottie-attach-1"],
          },
          {
            decision_id: "agent-step-dottie-voice",
            decision_authority: "llm",
            decision_timing: "post_observation",
            chosen_capability: "situation-room-pipelines.voice_delivery.propose_from_trace",
            observed_artifact_refs: ["dottie-voice-1"],
          },
          {
            decision_id: "agent-step-dottie-query",
            decision_authority: "llm",
            decision_timing: "terminal_review",
            chosen_capability: "situation-room-pipelines.observer.query",
            observed_artifact_refs: ["dottie-query-1"],
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "dottie-attach-1",
          kind: "dottie_observer_subscription_receipt",
          decision_ref: "agent-step-dottie-attach",
          payload: {
            schema: "helix.dottie_observer_subscription.v1",
            panel_id: "situation-room-pipelines",
            action_id: "observer.attach",
            target_run_id: "run:ask:dottie-ui-smoke",
          },
        },
        {
          artifact_id: "dottie-voice-1",
          kind: "dottie_voice_receipt",
          decision_ref: "agent-step-dottie-voice",
          payload: {
            schema: "helix.dottie_voice_receipt.v1",
            panel_id: "situation-room-pipelines",
            action_id: "voice_delivery.propose_from_trace",
            source_event_id: "agent_commentary:orientation",
          },
        },
        {
          artifact_id: "dottie-query-1",
          kind: "dottie_observer_query_receipt",
          decision_ref: "agent-step-dottie-query",
          payload: {
            panel_id: "situation-room-pipelines",
            action_id: "observer.query",
            observer_count: 1,
          },
        },
      ],
    };

    expect(isSourceCapabilityDiagnosticTurn(payload)).toBe(true);
    expect(hasSelectedCapabilityObservation(payload)).toBe(true);

    const report = evaluateTerminalBoundaryEligibility(payload);
    expect(report.eligible).toBe(true);
    expect(report.blocking_reasons).not.toContain("selected_capability_observation_missing");
  });

  it("does not let Dottie receipts satisfy a stale docs capability selection", () => {
    const payload = {
      canonical_goal_frame: { goal_kind: "panel_control", required_terminal_kind: "workstation_tool_evaluation" },
      terminal_artifact_kind: "workstation_tool_evaluation",
      final_answer_source: "workstation_tool_evaluation",
      goal_satisfaction_evaluation: {
        canonical_goal_kind: "panel_control",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "agent-step-stale-docs",
            decision_authority: "llm",
            decision_timing: "post_observation",
            chosen_capability: "docs-viewer.open",
            observed_artifact_refs: ["dottie-attach-1"],
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "dottie-attach-1",
          kind: "dottie_observer_subscription_receipt",
          decision_ref: "agent-step-stale-docs",
          payload: {
            schema: "helix.dottie_observer_subscription.v1",
            panel_id: "situation-room-pipelines",
            action_id: "observer.attach",
            target_run_id: "run:ask:dottie-ui-smoke",
          },
        },
      ],
    };

    expect(hasSelectedCapabilityObservation(payload)).toBe(false);

    const report = evaluateTerminalBoundaryEligibility(payload);
    expect(report.eligible).toBe(false);
    expect(report.blocking_reasons).toContain("selected_capability_observation_missing");
  });

  it("reconciles current-turn Dottie receipts for selected Dottie capability even when iteration refs are missing", () => {
    const payload = {
      canonical_goal_frame: { goal_kind: "panel_control", required_terminal_kind: "workstation_tool_evaluation" },
      terminal_artifact_kind: "workstation_tool_evaluation",
      final_answer_source: "workstation_tool_evaluation",
      goal_satisfaction_evaluation: {
        canonical_goal_kind: "panel_control",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "agent-step-dottie-attach",
            decision_authority: "llm",
            decision_timing: "post_observation",
            chosen_capability: "situation-room-pipelines.observer.attach",
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "dottie-attach-1",
          kind: "dottie_observer_subscription_receipt",
          source_scope: "current_turn",
          payload: {
            schema: "helix.dottie_observer_subscription.v1",
            panel_id: "situation-room-pipelines",
            action_id: "observer.attach",
            target_run_id: "run:ask:dottie-ui-smoke",
          },
        },
        {
          artifact_id: "dottie-eval-1",
          kind: "workstation_tool_evaluation",
          source_scope: "current_turn",
          payload: {
            schema: "helix.workstation_tool_evaluation.v1",
            tool_key: "situation-room-pipelines.observer.attach",
            supports_goal: true,
            summary: "Dottie observer attach/query/voice receipts completed.",
          },
        },
      ],
    };

    expect(hasSelectedCapabilityObservation(payload)).toBe(true);

    const report = evaluateTerminalBoundaryEligibility(payload);
    expect(report.eligible).toBe(true);
    expect(report.blocking_reasons).not.toContain("selected_capability_observation_missing");
  });

  it("does not reconcile unlinked Dottie receipts for stale docs capability", () => {
    const payload = {
      canonical_goal_frame: { goal_kind: "panel_control", required_terminal_kind: "workstation_tool_evaluation" },
      terminal_artifact_kind: "workstation_tool_evaluation",
      final_answer_source: "workstation_tool_evaluation",
      goal_satisfaction_evaluation: {
        canonical_goal_kind: "panel_control",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "agent-step-stale-docs",
            decision_authority: "llm",
            decision_timing: "post_observation",
            chosen_capability: "docs-viewer.open",
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "dottie-attach-1",
          kind: "dottie_observer_subscription_receipt",
          source_scope: "current_turn",
          payload: {
            schema: "helix.dottie_observer_subscription.v1",
            panel_id: "situation-room-pipelines",
            action_id: "observer.attach",
          },
        },
      ],
    };

    expect(hasSelectedCapabilityObservation(payload)).toBe(false);

    const report = evaluateTerminalBoundaryEligibility(payload);
    expect(report.eligible).toBe(false);
    expect(report.blocking_reasons).toContain("selected_capability_observation_missing");
  });

  it.each([
    ["docs-viewer.open_doc_by_path", "dottie_voice_receipt"],
    ["scientific-calculator.solve_with_steps", "dottie_observer_query_receipt"],
    ["situation-room-pipelines.open", "dottie_observer_subscription_receipt"],
  ])("does not let %s consume unrelated Dottie artifact %s", (chosenCapability, artifactKind) => {
    const payload = {
      canonical_goal_frame: { goal_kind: "panel_control", required_terminal_kind: "workstation_tool_evaluation" },
      terminal_artifact_kind: "workstation_tool_evaluation",
      final_answer_source: "workstation_tool_evaluation",
      goal_satisfaction_evaluation: {
        canonical_goal_kind: "panel_control",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "agent-step-stale-tool",
            decision_authority: "llm",
            decision_timing: "post_observation",
            chosen_capability: chosenCapability,
            observed_artifact_refs: ["dottie-artifact-1"],
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "dottie-artifact-1",
          kind: artifactKind,
          decision_ref: "agent-step-stale-tool",
          source_scope: "current_turn",
          payload: {
            schema: `helix.${artifactKind}.v1`,
            panel_id: "situation-room-pipelines",
            action_id: artifactKind === "dottie_voice_receipt" ? "voice_delivery.propose_from_trace" : "observer.query",
          },
        },
      ],
    };

    expect(hasSelectedCapabilityObservation(payload)).toBe(false);
  });

  it("builds a repair observation when selected capability and observed artifact family diverge", () => {
    const payload = {
      canonical_goal_frame: { goal_kind: "panel_control", required_terminal_kind: "workstation_tool_evaluation" },
      terminal_artifact_kind: "workstation_tool_evaluation",
      final_answer_source: "workstation_tool_evaluation",
      goal_satisfaction_evaluation: {
        canonical_goal_kind: "panel_control",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "agent-step-stale-docs",
            decision_authority: "llm",
            decision_timing: "post_observation",
            chosen_capability: "docs-viewer.open",
            observed_artifact_refs: ["dottie-attach-1"],
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "dottie-attach-1",
          kind: "dottie_observer_subscription_receipt",
          decision_ref: "agent-step-stale-docs",
          payload: {
            schema: "helix.dottie_observer_subscription.v1",
            panel_id: "situation-room-pipelines",
            action_id: "observer.attach",
            target_run_id: "run:ask:dottie-ui-smoke",
          },
        },
      ],
    };

    const observation = buildCapabilityBindingMismatchObservation(payload);

    expect(observation).toMatchObject({
      schema: "helix.capability_binding_mismatch_observation.v1",
      selected_capability: "docs-viewer.open",
      observed_artifact_refs: ["dottie-attach-1"],
      observed_artifact_kinds: ["dottie_observer_subscription_receipt"],
      suggested_capability: "situation-room-pipelines.observer.attach",
      suggested_repair: "rebind_selected_capability_to_observed_tool_plan",
    });
  });

  it("exposes model-direct selection as a mismatch when docs observations exist", () => {
    const payload = {
      canonical_goal_frame: { goal_kind: "doc_summary", required_terminal_kind: "doc_summary" },
      terminal_artifact_kind: "doc_summary",
      final_answer_source: "doc_summary",
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "agent-step-model-direct",
            decision_authority: "llm",
            decision_timing: "post_observation",
            chosen_capability: "model.direct_answer",
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "doc-summary-1",
          kind: "doc_summary",
          source_scope: "current_turn",
          payload: {
            schema: "helix.doc_summary.v1",
            path: "/docs/research/nhm2-current-status-whitepaper.md",
          },
        },
      ],
    };

    const observation = buildCapabilityBindingMismatchObservation(payload);

    expect(observation).toMatchObject({
      schema: "helix.capability_binding_mismatch_observation.v1",
      selected_capability: "model.direct_answer",
      observed_artifact_refs: ["doc-summary-1"],
      observed_artifact_kinds: ["doc_summary"],
      suggested_capability: "docs-viewer.summarize_doc",
      suggested_repair: "rebind_model_direct_answer_to_observed_tool_family",
    });
  });

  it("does not flag a clean model-direct answer draft as a tool binding mismatch", () => {
    const payload = {
      canonical_goal_frame: { goal_kind: "model_only_concept", required_terminal_kind: "direct_answer_text" },
      terminal_artifact_kind: "direct_answer_text",
      final_answer_source: "model_direct_answer",
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "agent-step-model-direct",
            decision_authority: "llm",
            decision_timing: "terminal_review",
            chosen_capability: "model.direct_answer",
            observed_artifact_refs: ["direct-answer-1"],
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "direct-answer-1",
          kind: "direct_answer_text",
          source_scope: "current_turn",
          payload: {
            schema: "helix.direct_answer_text.v1",
            text: "An electron is a negatively charged elementary particle.",
          },
        },
      ],
    };

    expect(buildCapabilityBindingMismatchObservation(payload)).toBeNull();
  });

  it("matches Stage Play reflections to the Stage Play Ask capability without treating the graph as a post-tool answer", () => {
    const payload = {
      turn_id: "turn-stage-play-1",
      canonical_goal_frame: { goal_kind: "live_environment_review", required_terminal_kind: "model_synthesized_answer" },
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      goal_satisfaction_evaluation: {
        canonical_goal_kind: "live_environment_review",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "agent-step-stage-play",
            decision_authority: "llm",
            decision_timing: "tool_selection",
            chosen_capability: "helix_ask.reflect_stage_play_context",
            observed_artifact_refs: ["stage-play-observation-1"],
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "stage-play-observation-1",
          kind: "live_environment_tool_observation",
          source_scope: "current_turn",
          payload: {
            schema: "helix.live_environment_tool_observation.v1",
            tool_name: "live_env.reflect_stage_play_context",
            observation: {
              artifactId: "stage_play_badge_graph",
              schemaVersion: "stage_play_badge_graph/v1",
              badges: [],
              recommendedActions: [],
            },
          },
        },
      ],
    };

    expect(hasSelectedCapabilityObservation(payload)).toBe(true);
    expect(hasPostObservationModelDecision(payload)).toBe(false);

    const bridge = buildPostToolAuthorityBridge({ turnId: "turn-stage-play-1", payload });
    expect(bridge.tool_observation_refs).toEqual(["stage-play-observation-1"]);
    expect(bridge.answer_draft_refs).toEqual([]);
    expect(bridge.observation_support_status).toBe("not_enough_information");

    const report = evaluateTerminalBoundaryEligibility(payload);
    expect(report.checks.selected_capability_observation).toBe(true);
    expect(report.checks.post_observation_model_decision).toBe(false);
    expect(report.eligible).toBe(false);
    expect(report.blocking_reasons).toContain("post_observation_model_decision_missing");
  });

  it("allows Stage Play terminal answers only after observation re-entry and model review", () => {
    const payload = {
      turn_id: "turn-stage-play-reviewed",
      canonical_goal_frame: { goal_kind: "live_environment_review", required_terminal_kind: "model_synthesized_answer" },
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      goal_satisfaction_evaluation: {
        canonical_goal_kind: "live_environment_review",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      agent_step_decision: {
        decision_id: "agent-step-stage-play-terminal-review",
        decision_authority: "llm",
        decision_timing: "terminal_review",
        next_step: "answer",
        chosen_capability: "model.direct_answer",
        model_decision: {
          next_step: "answer",
          chosen_capability: "model.direct_answer",
        },
      },
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "agent-step-stage-play-tool",
            decision_authority: "llm",
            decision_timing: "tool_selection",
            chosen_capability: "helix_ask.reflect_stage_play_context",
            observed_artifact_refs: ["stage-play-observation-1"],
          },
          {
            decision_id: "agent-step-stage-play-answer",
            decision_authority: "llm",
            decision_timing: "post_observation",
            next_step: "answer",
            chosen_capability: "model.direct_answer",
            observation_role: "model_answer_draft",
            observed_artifact_refs: ["stage-play-observation-1", "final-answer-1"],
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "stage-play-observation-1",
          kind: "live_environment_tool_observation",
          source_scope: "current_turn",
          payload: {
            schema: "helix.live_environment_tool_observation.v1",
            tool_name: "live_env.reflect_stage_play_context",
            observation: {
              schema: "stage_play_reflection_result/v1",
              graph: { artifactId: "stage_play_badge_graph", schemaVersion: "stage_play_badge_graph/v1" },
              outputLaneProjection: { artifactId: "stage_play_output_lane_projection" },
              liveAnswerProjection: {
                attempted: true,
                projected: true,
                changedLineKeys: ["risk", "possibilities", "unknowns", "next_check"],
                skippedLineKeys: [],
                reason: "projected",
              },
              assistant_answer: false,
              raw_content_included: false,
              context_role: "tool_evidence",
              ask_context_policy: "evidence_only",
            },
          },
        },
        {
          artifact_id: "final-answer-1",
          kind: "final_answer_draft",
          source_scope: "current_turn",
          payload: {
            schema: "helix.final_answer_draft.v1",
            text: "Stage Play reflected the source and projected Live Interpretation lanes; audio evidence is still missing.",
          },
        },
      ],
    };

    const report = evaluateTerminalBoundaryEligibility(payload);
    expect(report.checks.agent_runtime_loop).toBe(true);
    expect(report.checks.agent_step_decision).toBe(true);
    expect(report.checks.selected_capability_observation).toBe(true);
    expect(report.checks.post_observation_model_decision).toBe(true);
    expect(report.eligible).toBe(true);
    expect(report.blocking_reasons).toEqual([]);
  });

  it("blocks Stage Play graph or projection receipts from becoming final authority", () => {
    const payload = {
      turn_id: "turn-stage-play-receipt-terminal",
      canonical_goal_frame: { goal_kind: "live_environment_review", required_terminal_kind: "model_synthesized_answer" },
      terminal_artifact_kind: "live_environment_tool_observation",
      final_answer_source: "live_environment_tool_observation",
      goal_satisfaction_evaluation: {
        canonical_goal_kind: "live_environment_review",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      agent_step_decision: {
        decision_id: "agent-step-stage-play-terminal-review",
        decision_authority: "llm",
        decision_timing: "terminal_review",
        next_step: "answer",
        chosen_capability: "model.direct_answer",
      },
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "agent-step-stage-play-tool",
            decision_authority: "llm",
            decision_timing: "tool_selection",
            chosen_capability: "helix_ask.reflect_stage_play_context",
            observed_artifact_refs: ["stage-play-observation-1"],
          },
          {
            decision_id: "agent-step-stage-play-answer",
            decision_authority: "llm",
            decision_timing: "post_observation",
            next_step: "answer",
            chosen_capability: "model.direct_answer",
            observation_role: "model_answer_draft",
            observed_artifact_refs: ["stage-play-observation-1"],
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "stage-play-observation-1",
          kind: "live_environment_tool_observation",
          source_scope: "current_turn",
          payload: {
            schema: "helix.live_environment_tool_observation.v1",
            tool_name: "live_env.reflect_stage_play_context",
            observation: {
              schema: "stage_play_reflection_result/v1",
              graph: { artifactId: "stage_play_badge_graph", schemaVersion: "stage_play_badge_graph/v1" },
              outputLaneProjection: { artifactId: "stage_play_output_lane_projection" },
              liveAnswerProjection: {
                attempted: true,
                projected: true,
                changedLineKeys: ["risk"],
                skippedLineKeys: [],
                reason: "projected",
              },
              assistant_answer: false,
              raw_content_included: false,
              context_role: "tool_evidence",
              ask_context_policy: "evidence_only",
            },
          },
        },
      ],
    };

    const report = evaluateTerminalBoundaryEligibility(payload);
    expect(report.checks.agent_runtime_loop).toBe(true);
    expect(report.checks.agent_step_decision).toBe(true);
    expect(report.checks.selected_capability_observation).toBe(true);
    expect(report.checks.post_observation_model_decision).toBe(true);
    expect(report.eligible).toBe(false);
    expect(report.blocking_reasons).toContain("stage_play_receipt_terminal_without_model_review");
  });

  it("blocks Stage Play checkpoint request receipts from becoming final authority", () => {
    const payload = {
      turn_id: "turn-stage-play-checkpoint-receipt-terminal",
      canonical_goal_frame: { goal_kind: "live_environment_review", required_terminal_kind: "model_synthesized_answer" },
      terminal_artifact_kind: "live_environment_tool_observation",
      final_answer_source: "live_environment_tool_observation",
      goal_satisfaction_evaluation: {
        canonical_goal_kind: "live_environment_review",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      agent_step_decision: {
        decision_id: "agent-step-stage-play-checkpoint-terminal-review",
        decision_authority: "llm",
        decision_timing: "terminal_review",
        next_step: "answer",
        chosen_capability: "model.direct_answer",
      },
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "agent-step-stage-play-checkpoint-tool",
            decision_authority: "llm",
            decision_timing: "tool_selection",
            chosen_capability: "live_env.request_stage_play_checkpoint",
            observed_artifact_refs: ["stage-play-checkpoint-observation-1"],
          },
          {
            decision_id: "agent-step-stage-play-checkpoint-answer",
            decision_authority: "llm",
            decision_timing: "post_observation",
            next_step: "answer",
            chosen_capability: "model.direct_answer",
            observation_role: "model_answer_draft",
            observed_artifact_refs: ["stage-play-checkpoint-observation-1"],
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "stage-play-checkpoint-observation-1",
          kind: "live_environment_tool_observation",
          source_scope: "current_turn",
          payload: {
            schema: "helix.live_environment_tool_observation.v1",
            tool_name: "live_env.request_stage_play_checkpoint",
            observation: {
              schema: "stage_play_checkpoint_request_result/v1",
              checkpointRequest: {
                artifactId: "stage_play_checkpoint_request",
                schemaVersion: "stage_play_checkpoint_request/v1",
                checkpointRequestId: "stage_play_checkpoint_request:test",
                jobId: "stage_play_job:test",
                graphId: "stage_play_badge_graph:test",
                status: "queued",
                assistant_answer: false,
                context_role: "tool_evidence",
              },
              queueState: {
                schema: "stage_play_checkpoint_queue/v1",
                requests: [],
                assistant_answer: false,
                context_role: "tool_evidence",
              },
              readyToRun: true,
              reason: "queued",
              assistant_answer: false,
              context_role: "tool_evidence",
            },
          },
        },
      ],
    };

    const bridge = buildPostToolAuthorityBridge({ turnId: "turn-stage-play-checkpoint-receipt-terminal", payload });
    expect(bridge.tool_observation_refs).toEqual(["stage-play-checkpoint-observation-1"]);
    expect(bridge.observation_support_status).toBe("not_enough_information");

    const report = evaluateTerminalBoundaryEligibility(payload);
    expect(report.checks.selected_capability_observation).toBe(true);
    expect(report.checks.post_observation_model_decision).toBe(true);
    expect(report.eligible).toBe(false);
    expect(report.blocking_reasons).toContain("stage_play_receipt_terminal_without_model_review");
  });

  it("suggests the Stage Play capability when a selected capability observes a Stage Play graph", () => {
    const observation = buildCapabilityBindingMismatchObservation({
      canonical_goal_frame: { goal_kind: "live_environment_review", required_terminal_kind: "model_synthesized_answer" },
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      agent_runtime_loop: {
        iterations: [
          {
            decision_id: "agent-step-stage-play-mismatch",
            decision_authority: "llm",
            decision_timing: "tool_selection",
            chosen_capability: "helix_ask.reflect_ideology_context",
            observed_artifact_refs: ["stage-play-observation-1"],
          },
        ],
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: "stage-play-observation-1",
          kind: "live_environment_tool_observation",
          source_scope: "current_turn",
          payload: {
            schema: "helix.live_environment_tool_observation.v1",
            tool_name: "live_env.reflect_stage_play_context",
            observation: {
              artifactId: "stage_play_badge_graph",
              schemaVersion: "stage_play_badge_graph/v1",
            },
          },
        },
      ],
    });

    expect(observation).toMatchObject({
      schema: "helix.capability_binding_mismatch_observation.v1",
      selected_capability: "helix_ask.reflect_ideology_context",
      observed_artifact_refs: ["stage-play-observation-1"],
      observed_artifact_kinds: ["live_environment_tool_observation"],
      suggested_capability: "helix_ask.reflect_stage_play_context",
      suggested_repair: "rebind_selected_capability_to_observed_tool_plan",
    });
  });

  it("allows clean typed failures for source/capability turns without minting a successful terminal", () => {
    const report = evaluateTerminalBoundaryEligibility({
      canonical_goal_frame: { goal_kind: "debug_diagnosis" },
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "debug_evidence_missing",
    });

    expect(report.source_capability_diagnostic_turn).toBe(true);
    expect(report.requires_runtime_loop).toBe(false);
    expect(report.checks.typed_failure_clean).toBe(true);
    expect(report.eligible).toBe(true);
  });

  it("allows live pipeline control receipts when route authority and disclosure keep them observation-only", () => {
    const payload = {
      canonical_goal_frame: {
        goal_kind: "live_pipeline_control",
        required_terminal_kind: "live_pipeline_receipt",
      },
      source_target_intent: {
        target_source: "live_pipeline",
        target_kind: "live_pipeline",
        allow_no_tool_direct: false,
        allow_client_shortcut: false,
      },
      route_product_contract: {
        source_target: "live_pipeline",
        allowed_terminal_artifact_kinds: ["live_pipeline_receipt", "typed_failure"],
        forbidden_terminal_artifact_kinds: ["situation_context_pack"],
      },
      terminal_artifact_selection_guard: {
        allowed: true,
        terminal_artifact_kind: "live_pipeline_receipt",
      },
      product_authority_guard: {
        allowed: true,
      },
      tool_call_admission_decision: {
        source_target: "live_pipeline",
        required: true,
        admitted_tool_families: ["live_pipeline"],
      },
      live_pipeline_turn_receipt: {
        schema: "helix.live_pipeline_turn_receipt.v1",
        actions: ["situation-room.pipeline.inspect", "situation-room.live-source.set_rate"],
        assistant_answer: false,
        raw_content_included: false,
      },
      tool_trace_disclosure: {
        schema: "helix.ask_tool_trace_disclosure.v1",
        items: [
          {
            tool: "situation-room.live-source.set_rate",
            role: "state_mutation",
            authority: "mutation_receipt",
            summary: "Changed the live source cadence policy.",
          },
        ],
        assistant_answer: false,
        terminal_eligible: false,
      },
      terminal_artifact_kind: "live_pipeline_receipt",
      final_answer_source: "live_pipeline_receipt",
    };

    expect(goalSatisfactionAllowsTerminal(payload)).toBe(true);

    const report = evaluateTerminalBoundaryEligibility(payload);
    expect(report.source_capability_diagnostic_turn).toBe(true);
    expect(report.requires_runtime_loop).toBe(false);
    expect(report.eligible).toBe(true);
    expect(report.blocking_reasons).toEqual([]);
  });

  it("does not allow live pipeline receipts when the route contract forbids receipt terminals", () => {
    const report = evaluateTerminalBoundaryEligibility({
      canonical_goal_frame: {
        goal_kind: "live_pipeline_control",
        required_terminal_kind: "live_pipeline_receipt",
      },
      source_target_intent: {
        target_source: "live_pipeline",
        target_kind: "live_pipeline",
        allow_no_tool_direct: false,
        allow_client_shortcut: false,
      },
      route_product_contract: {
        source_target: "live_pipeline",
        allowed_terminal_artifact_kinds: ["typed_failure"],
        forbidden_terminal_artifact_kinds: ["live_pipeline_receipt"],
      },
      terminal_artifact_selection_guard: {
        allowed: false,
        terminal_artifact_kind: "live_pipeline_receipt",
      },
      tool_call_admission_decision: {
        source_target: "live_pipeline",
        required: true,
        admitted_tool_families: ["live_pipeline"],
      },
      live_pipeline_turn_receipt: {
        schema: "helix.live_pipeline_turn_receipt.v1",
        assistant_answer: false,
        raw_content_included: false,
      },
      tool_trace_disclosure: {
        schema: "helix.ask_tool_trace_disclosure.v1",
        items: [{ tool: "situation-room.pipeline.inspect" }],
        assistant_answer: false,
        terminal_eligible: false,
      },
      terminal_artifact_kind: "live_pipeline_receipt",
      final_answer_source: "live_pipeline_receipt",
    });

    expect(report.requires_runtime_loop).toBe(true);
    expect(report.eligible).toBe(false);
    expect(report.blocking_reasons).toEqual(
      expect.arrayContaining([
        "goal_satisfaction_not_terminal",
        "agent_runtime_loop_missing",
        "selected_capability_observation_missing",
      ]),
    );
  });

  it("accepts a materialized compound provider product backed by the authorized Codex bridge", () => {
    const turnId = "turn-provider-compound-authority";
    const report = evaluateTerminalBoundaryEligibility({
      turn_id: turnId,
      canonical_goal_frame: {
        turn_id: turnId,
        goal_kind: "calculator_solve",
        required_terminal_kind: "workstation_tool_evaluation",
      },
      route_product_contract: {
        required_terminal_artifact_kind: "compound_evidence_synthesis_answer",
        allowed_terminal_artifact_kinds: [
          "compound_evidence_synthesis_answer",
          "workstation_tool_evaluation",
          "typed_failure",
        ],
      },
      terminal_artifact_kind: "compound_evidence_synthesis_answer",
      final_answer_source: "compound_evidence_synthesis_answer",
      selected_final_answer: "Theory reflection and calculator result.",
      provider_terminal_authority_bridge: {
        schema: "helix.provider_terminal_authority_bridge.v1",
        turn_id: turnId,
        solver_completed: true,
        goal_satisfaction_compatible: true,
        terminal_authority_granted: true,
        final_visible_answer_authorized: true,
        normalized_observations_ready: true,
        all_observations_succeeded: true,
        successful_gateway_observation_refs: [
          `${turnId}:calculator-observation`,
          `${turnId}:theory-observation`,
        ],
        successful_capability_lane_observation_refs: [`${turnId}:theory-observation`],
      },
      provider_route_product_materialization: {
        schema: "helix.provider_route_product_materialization.v1",
        turn_id: turnId,
        status: "materialized",
        materialized_terminal_artifact_kind: "compound_evidence_synthesis_answer",
        materialized_terminal_artifact_ref: `${turnId}:compound-answer`,
      },
      provider_route_product_quality_gate: {
        schema: "helix.final_answer_draft_quality_gate.v1",
        turn_id: turnId,
        ok: true,
        violations: [],
      },
    });

    expect(report.source_capability_diagnostic_turn).toBe(true);
    expect(report.checks).toMatchObject({
      agent_runtime_loop: true,
      agent_step_decision: true,
      selected_capability_observation: true,
      post_observation_model_decision: true,
      goal_satisfaction_allows_terminal: true,
    });
    expect(report.eligible).toBe(true);
    expect(report.blocking_reasons).toEqual([]);
  });

  it("accepts a fully supported current-turn compound environment draft without requiring a legacy agent loop projection", () => {
    const turnId = "turn-compound-environment-ledger-authority";
    const inspectRef = `${turnId}:live-environment:inspect`;
    const commandRef = `${turnId}:live-environment:command`;
    const draftRef = `${turnId}:final-answer-draft`;
    const report = evaluateTerminalBoundaryEligibility({
      turn_id: turnId,
      source_target_intent: {
        target_source: "live_environment",
        target_kind: "live_environment",
        strength: "hard",
      },
      canonical_goal_frame: {
        turn_id: turnId,
        goal_kind: "compound_evidence_synthesis",
        required_terminal_kind: "compound_evidence_synthesis_answer",
      },
      route_product_contract: {
        required_terminal_artifact_kind:
          "compound_evidence_synthesis_answer",
        allowed_terminal_artifact_kinds: [
          "compound_evidence_synthesis_answer",
          "typed_failure",
        ],
      },
      terminal_artifact_kind: "compound_evidence_synthesis_answer",
      final_answer_source: "final_answer_draft",
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      compound_subgoal_ledger: [
        {
          subgoal_id: `${turnId}:subgoal:inspect`,
          selected_capability:
            "com.casimirbot.minecraft.spatial_region.inspect",
          executed_capability:
            "com.casimirbot.minecraft.spatial_region.inspect",
          observation_ref: inspectRef,
          satisfaction: "satisfied",
          rail_status: "complete",
        },
        {
          subgoal_id: `${turnId}:subgoal:command`,
          selected_capability: "com.casimirbot.minecraft.command",
          executed_capability: "com.casimirbot.minecraft.command",
          observation_ref: commandRef,
          satisfaction: "satisfied",
          rail_status: "complete",
        },
      ],
      current_turn_artifact_ledger: [
        {
          artifact_id: inspectRef,
          kind: "live_environment_observation",
          source_scope: "current_turn",
          capability_key:
            "com.casimirbot.minecraft.spatial_region.inspect",
          payload: {
            schema: "helix.live_environment_observation.v1",
            status: "succeeded",
          },
        },
        {
          artifact_id: commandRef,
          kind: "live_environment_observation",
          source_scope: "current_turn",
          capability_key: "com.casimirbot.minecraft.command",
          payload: {
            schema: "helix.live_environment_observation.v1",
            status: "succeeded",
          },
        },
        {
          artifact_id: draftRef,
          kind: "final_answer_draft",
          source_scope: "current_turn",
          payload: {
            schema: "helix.final_answer_draft.v1",
            text: "The wall was built and verified from current-turn observations.",
            support_refs: [inspectRef, commandRef],
          },
        },
      ],
    });

    expect(report.checks).toMatchObject({
      agent_runtime_loop: true,
      agent_step_decision: true,
      selected_capability_observation: true,
      post_observation_model_decision: true,
      goal_satisfaction_allows_terminal: true,
    });
    expect(report.eligible).toBe(true);
    expect(report.blocking_reasons).toEqual([]);
  });

  it("accepts a compact ledger projection when the full supported compound draft is top-level", () => {
    const turnId = "turn-compound-environment-compact-ledger-authority";
    const inspectRef = `${turnId}:live-environment:inspect`;
    const commandRef = `${turnId}:live-environment:command`;
    const draftRef = `${turnId}:final-answer-draft`;
    const answerText =
      "The fireplace was changed, verified, restored, and verified again.";
    const report = evaluateTerminalBoundaryEligibility({
      turn_id: turnId,
      source_target_intent: {
        target_source: "live_environment",
        target_kind: "live_environment",
        strength: "hard",
      },
      canonical_goal_frame: {
        turn_id: turnId,
        goal_kind: "live_environment",
        required_terminal_kind: "model_synthesized_answer",
        allowed_terminal_artifact_kinds: ["model_synthesized_answer"],
      },
      terminal_artifact_kind: "compound_evidence_synthesis_answer",
      final_answer_source: "final_answer_draft",
      compound_subgoal_ledger: [
        {
          subgoal_id: `${turnId}:subgoal:inspect`,
          selected_capability:
            "com.casimirbot.minecraft.spatial_region.inspect",
          executed_capability:
            "com.casimirbot.minecraft.spatial_region.inspect",
          observation_ref: inspectRef,
          satisfaction: "satisfied",
          rail_status: "complete",
        },
        {
          subgoal_id: `${turnId}:subgoal:command`,
          selected_capability: "com.casimirbot.minecraft.command",
          executed_capability: "com.casimirbot.minecraft.command",
          observation_ref: commandRef,
          satisfaction: "satisfied",
          rail_status: "complete",
        },
      ],
      final_answer_draft: {
        schema: "helix.final_answer_draft.v1",
        artifact_id: draftRef,
        text: answerText,
        support_refs: [inspectRef, commandRef],
      },
      ledger_backed_compound_final_answer_draft: {
        schema: "helix.ledger_backed_compound_final_answer_draft.v1",
        turn_id: turnId,
        final_answer_draft_ref: draftRef,
        support_refs: [inspectRef, commandRef],
        subgoal_observation_refs: [inspectRef, commandRef],
        terminal_artifact_kind: "compound_evidence_synthesis_answer",
        reason: "compound_subgoals_satisfied_without_final_answer_draft",
        assistant_answer: false,
        raw_content_included: false,
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: inspectRef,
          kind: "live_environment_observation",
          source_scope: "current_turn",
        },
        {
          artifact_id: commandRef,
          kind: "live_environment_observation",
          source_scope: "current_turn",
        },
        {
          artifact_id: draftRef,
          kind: "final_answer_draft",
          source_scope: "current_turn",
          payload_schema: "helix.final_answer_draft.v1",
          text_preview: answerText,
        },
      ],
    });

    expect(report.checks).toMatchObject({
      agent_runtime_loop: true,
      agent_step_decision: true,
      selected_capability_observation: true,
      post_observation_model_decision: true,
      goal_satisfaction_allows_terminal: true,
    });
    expect(report.eligible).toBe(true);
    expect(report.blocking_reasons).toEqual([]);
  });

  it("rejects a compound environment draft that omits one required subgoal observation ref", () => {
    const turnId = "turn-compound-environment-missing-support";
    const inspectRef = `${turnId}:live-environment:inspect`;
    const commandRef = `${turnId}:live-environment:command`;
    const report = evaluateTerminalBoundaryEligibility({
      turn_id: turnId,
      source_target_intent: {
        target_source: "live_environment",
        target_kind: "live_environment",
        strength: "hard",
      },
      canonical_goal_frame: {
        turn_id: turnId,
        goal_kind: "compound_evidence_synthesis",
        required_terminal_kind: "compound_evidence_synthesis_answer",
      },
      route_product_contract: {
        required_terminal_artifact_kind:
          "compound_evidence_synthesis_answer",
        allowed_terminal_artifact_kinds: [
          "compound_evidence_synthesis_answer",
          "typed_failure",
        ],
      },
      terminal_artifact_kind: "compound_evidence_synthesis_answer",
      final_answer_source: "final_answer_draft",
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      compound_subgoal_ledger: [
        {
          subgoal_id: `${turnId}:subgoal:inspect`,
          selected_capability:
            "com.casimirbot.minecraft.spatial_region.inspect",
          executed_capability:
            "com.casimirbot.minecraft.spatial_region.inspect",
          observation_ref: inspectRef,
          satisfaction: "satisfied",
          rail_status: "complete",
        },
        {
          subgoal_id: `${turnId}:subgoal:command`,
          selected_capability: "com.casimirbot.minecraft.command",
          executed_capability: "com.casimirbot.minecraft.command",
          observation_ref: commandRef,
          satisfaction: "satisfied",
          rail_status: "complete",
        },
      ],
      current_turn_artifact_ledger: [
        {
          artifact_id: inspectRef,
          kind: "live_environment_observation",
          source_scope: "current_turn",
        },
        {
          artifact_id: commandRef,
          kind: "live_environment_observation",
          source_scope: "current_turn",
        },
        {
          artifact_id: `${turnId}:final-answer-draft`,
          kind: "final_answer_draft",
          source_scope: "current_turn",
          payload: {
            schema: "helix.final_answer_draft.v1",
            text: "The wall was built.",
            support_refs: [inspectRef],
          },
        },
      ],
    });

    expect(report.eligible).toBe(false);
    expect(report.blocking_reasons).toEqual(
      expect.arrayContaining([
        "agent_runtime_loop_missing",
        "selected_capability_observation_missing",
      ]),
    );
  });

  it("accepts an authorized model-only provider product without observation refs", () => {
    const turnId = "turn-provider-model-only-authority";
    const report = evaluateTerminalBoundaryEligibility({
      turn_id: turnId,
      canonical_goal_frame: {
        turn_id: turnId,
        goal_kind: "model_only_concept",
        required_terminal_kind: "direct_answer_text",
      },
      route_product_contract: {
        source_target: "model_only",
        required_terminal_kind: "direct_answer_text",
        allowed_terminal_artifact_kinds: ["direct_answer_text", "typed_failure"],
      },
      terminal_artifact_kind: "direct_answer_text",
      final_answer_source: "direct_answer_text",
      selected_final_answer: "A hypothesis is testable; a theory is a broad evidence-backed explanation.",
      direct_answer_text: {
        schema: "helix.direct_answer_text.v1",
        text: "A hypothesis is testable; a theory is a broad evidence-backed explanation.",
      },
      provider_terminal_authority_bridge: {
        schema: "helix.provider_terminal_authority_bridge.v1",
        turn_id: turnId,
        solver_completed: true,
        goal_satisfaction_compatible: true,
        terminal_authority_granted: true,
        final_visible_answer_authorized: true,
        normalized_observations_ready: true,
        all_observations_succeeded: true,
        model_only_direct_answer_allowed: true,
        evidence_reentry_required: false,
        successful_gateway_observation_refs: [],
        successful_capability_lane_observation_refs: [],
      },
      provider_route_product_materialization: {
        schema: "helix.provider_route_product_materialization.v1",
        turn_id: turnId,
        status: "materialized",
        materialized_terminal_artifact_kind: "direct_answer_text",
        materialized_terminal_artifact_ref: `${turnId}:direct-answer`,
        selected_observation_refs: [],
      },
      provider_route_product_quality_gate: {
        schema: "helix.final_answer_draft_quality_gate.v1",
        turn_id: turnId,
        ok: true,
        violations: [],
      },
    });

    expect(report.checks).toMatchObject({
      agent_runtime_loop: true,
      agent_step_decision: true,
      post_observation_model_decision: true,
      goal_satisfaction_allows_terminal: true,
    });
    expect(report.blocking_reasons).toEqual([]);
    expect(report.eligible).toBe(true);
  });

  it.each(["user", "developer"] as const)(
    "accepts a current-turn Docs provider product for %s accounts despite a stale Realtime model-only hint",
    (accountType) => {
      const turnId = `turn-realtime-docs-route-product-${accountType}`;
      const observationRef = `${turnId}:workstation_gateway:docs.search:1`;
      const candidateRef = `${turnId}:agent_provider_terminal_candidate:codex:nhm2`;
      const routeProductRef = `${candidateRef}:route_product:model_synthesized_answer`;
      const payload = {
        turn_id: turnId,
        account_policy: {
          account_type: accountType,
          allowed_workstation_capabilities: accountType === "developer" ? ["*"] : ["docs.search"],
        },
        source_target_intent: {
          target_source: "model_only",
          target_kind: "general_background",
          strength: "soft",
        },
        committed_ask_route: {
          schema: "helix.committed_ask_route.v1",
          turn_id: turnId,
          route: {
            selected_route: "/ask/turn/stream",
            source_target: "docs_viewer",
            target_kind: "docs_viewer",
            strength: "hard",
          },
          capability_policy: {
            allowed_tool_families: ["docs_viewer"],
            required_capability_families: ["docs_viewer"],
          },
          canonical_goal: {
            goal_kind: "docs",
            required_terminal_kind: "model_synthesized_answer",
            allowed_terminal_artifact_kinds: ["model_synthesized_answer", "typed_failure"],
            forbidden_terminal_artifact_kinds: [],
          },
        },
        canonical_goal_frame: {
          turn_id: turnId,
          goal_kind: "agent_provider_gateway_turn",
          requested_capability: "docs.search",
          required_terminal_kind: "model_synthesized_answer",
        },
        route_product_contract: {
          source_target: "docs_viewer",
          required_terminal_kind: "model_synthesized_answer",
          allowed_terminal_artifact_kinds: ["model_synthesized_answer", "typed_failure"],
        },
        terminal_artifact_kind: "model_synthesized_answer",
        final_answer_source: "final_answer_draft",
        selected_final_answer: "I found the NHM2 research documents and summarized their current model.",
        provider_terminal_authority_bridge: {
          schema: "helix.provider_terminal_authority_bridge.v1",
          turn_id: turnId,
          provider_terminal_candidate_ref: candidateRef,
          solver_completed: true,
          goal_satisfaction_compatible: true,
          terminal_authority_granted: true,
          final_visible_answer_authorized: true,
          normalized_observations_ready: true,
          all_observations_succeeded: true,
          successful_gateway_observation_refs: [observationRef],
          successful_capability_lane_observation_refs: [],
        },
        provider_route_product_materialization: {
          schema: "helix.provider_route_product_materialization.v1",
          turn_id: turnId,
          status: "materialized",
          provider_terminal_candidate_ref: candidateRef,
          materialized_terminal_artifact_kind: "model_synthesized_answer",
          materialized_terminal_artifact_ref: routeProductRef,
          selected_observation_refs: [observationRef],
        },
        provider_route_product_quality_gate: {
          schema: "helix.final_answer_draft_quality_gate.v1",
          turn_id: turnId,
          ok: true,
          violations: [],
        },
        current_turn_artifact_ledger: [
          {
            artifact_id: observationRef,
            kind: "provider_gateway_observation_packet",
            payload: {
              schema: "helix.agent_step_observation_packet.v1",
              turn_id: turnId,
              capability_key: "docs.search",
              status: "succeeded",
            },
          },
          {
            artifact_id: routeProductRef,
            kind: "model_synthesized_answer",
            payload: {
              schema: "helix.provider_route_product.v1",
              artifact_id: routeProductRef,
              turn_id: turnId,
              kind: "model_synthesized_answer",
              provider_terminal_candidate_ref: candidateRef,
              answer_text: "I found the NHM2 research documents and summarized their current model.",
              support_refs: [observationRef],
              terminal_eligible: true,
            },
          },
        ],
      };

      expect(isModelDirectAnswerTurn(payload)).toBe(false);
      expect(isSourceCapabilityDiagnosticTurn(payload)).toBe(true);
      const missingProviderProof = structuredClone(payload) as Record<string, unknown>;
      delete missingProviderProof.provider_terminal_authority_bridge;
      delete missingProviderProof.provider_route_product_materialization;
      delete missingProviderProof.provider_route_product_quality_gate;
      const blockedReport = evaluateTerminalBoundaryEligibility(missingProviderProof);
      expect(blockedReport.eligible).toBe(false);
      expect(blockedReport.blocking_reasons).toEqual(expect.arrayContaining([
        "agent_runtime_loop_missing",
        "selected_capability_observation_missing",
        "post_observation_model_decision_missing",
      ]));
      const report = evaluateTerminalBoundaryEligibility(payload);
      expect(report.checks).toMatchObject({
        agent_runtime_loop: true,
        agent_step_decision: true,
        selected_capability_observation: true,
        post_observation_model_decision: true,
        goal_satisfaction_allows_terminal: true,
      });
      expect(report.eligible).toBe(true);
      expect(report.blocking_reasons).toEqual([]);
    },
  );

  it("accepts a directly authorized provider candidate after current-turn evidence re-entry despite a stale model-only envelope", () => {
    const turnId = "turn-provider-candidate-authority";
    const observationRef = `${turnId}:workstation_gateway:repo.search:1`;
    const candidateRef = `${turnId}:agent_provider_terminal_candidate:codex:repo`;
    const candidate = {
      schema: "helix.agent_provider_terminal_candidate.v1",
      turn_id: turnId,
      candidate_id: candidateRef,
      candidate_text_preview: "The terminal authority implementation is in server/services/helix-ask/terminal-authority-single-writer.ts.",
      grounded_in_observation_refs: [observationRef],
      provider_reasoning_completed: true,
      terminal_eligible: false,
    };
    const report = evaluateTerminalBoundaryEligibility({
      turn_id: turnId,
      committed_ask_route: {
        schema: "helix.committed_ask_route.v1",
        turn_id: turnId,
        route: {
          selected_route: "/ask/turn",
          source_target: "repo_code",
          target_kind: "repo_code",
          strength: "hard",
        },
        capability_policy: {
          allowed_tool_families: ["repo_code"],
        },
        canonical_goal: {
          goal_kind: "model_only_concept",
          required_terminal_kind: "direct_answer_text",
          allowed_terminal_artifact_kinds: [
            "direct_answer_text",
            "agent_provider_terminal_candidate",
          ],
          forbidden_terminal_artifact_kinds: [],
        },
      },
      canonical_goal_frame: {
        turn_id: turnId,
        source: "codex_provider_workstation_gateway_projection",
        goal_kind: "agent_provider_gateway_turn",
        requested_capability: "repo.search",
        required_terminal_kind: "agent_provider_terminal_candidate",
      },
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      final_answer_source: "agent_provider_terminal_candidate",
      selected_final_answer: candidate.candidate_text_preview,
      debug: {
        provider_terminal_candidate: candidate,
        provider_reasoning_reentry: {
          schema: "helix.provider_reasoning_reentry.v1",
          turn_id: turnId,
          status: "completed",
          evidence_reentered: true,
          solver_completed: true,
          goal_satisfaction_compatible: true,
        },
        provider_terminal_authority_bridge: {
          schema: "helix.provider_terminal_authority_bridge.v1",
          turn_id: turnId,
          terminal_authority_status: "authorized_by_helix_provider_candidate_bridge",
          provider_terminal_candidate_ref: candidateRef,
          provider_terminal_candidate: candidate,
          evidence_reentry_required: true,
          normalized_observations_ready: true,
          all_gateway_calls_succeeded: true,
          all_capability_lane_observations_succeeded: true,
          all_observations_succeeded: true,
          solver_completed: true,
          goal_satisfaction_compatible: true,
          terminal_authority_granted: true,
          final_visible_answer_authorized: true,
          successful_gateway_observation_refs: [observationRef],
          terminal_answer_authority: {
            turn_id: turnId,
            terminal_kind: "answer",
            terminal_artifact_kind: "agent_provider_terminal_candidate",
            final_answer_source: "agent_provider_terminal_candidate",
            terminal_item_id: candidateRef,
            server_authoritative: true,
          },
          terminal_presentation: {
            turn_id: turnId,
            final_answer_source: "agent_provider_terminal_candidate",
            terminal_authority_ref: candidateRef,
            selected_observation_refs: [observationRef],
          },
        },
      },
    });

    expect(report.checks).toMatchObject({
      agent_runtime_loop: true,
      agent_step_decision: true,
      selected_capability_observation: true,
      post_observation_model_decision: true,
      goal_satisfaction_allows_terminal: true,
    });
    expect(report.blocking_reasons).toEqual([]);
    expect(report.eligible).toBe(true);
  });

  it("accepts the single-writer provider runtime authority handoff without reconstructing another loop", () => {
    const turnId = "turn-provider-single-writer-authority";
    const candidateRef = `${turnId}:agent_provider_terminal_candidate:codex:repo`;
    const observationRef = `${turnId}:workstation_gateway:repo.search:1`;
    const report = evaluateTerminalBoundaryEligibility({
      turn_id: turnId,
      source_target_intent: {
        target_source: "repo_code",
        strength: "hard",
      },
      canonical_goal_frame: {
        turn_id: turnId,
        goal_kind: "agent_provider_gateway_turn",
        requested_capability: "repo.search",
        required_terminal_kind: "agent_provider_terminal_candidate",
      },
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      final_answer_source: "agent_provider_terminal_candidate",
      selected_final_answer: "The terminal authority implementation is in terminal-authority-single-writer.ts.",
      provider_terminal_runtime_authority: {
        schema: "helix.provider_terminal_runtime_authority.v1",
        turn_id: turnId,
        provider_terminal_candidate_ref: candidateRef,
        selected_observation_refs: [observationRef],
        evidence_reentered: true,
        solver_completed: true,
        goal_satisfaction_compatible: true,
        server_authoritative: true,
      },
    });

    expect(report.checks).toMatchObject({
      agent_runtime_loop: true,
      agent_step_decision: true,
      selected_capability_observation: true,
      post_observation_model_decision: true,
      goal_satisfaction_allows_terminal: true,
    });
    expect(report.blocking_reasons).toEqual([]);
    expect(report.eligible).toBe(true);
  });

  it("blocks typed failures that do not carry a failure code", () => {
    const report = evaluateTerminalBoundaryEligibility({
      canonical_goal_frame: { goal_kind: "visual_capture_describe" },
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
    });

    expect(report.source_capability_diagnostic_turn).toBe(true);
    expect(report.eligible).toBe(false);
    expect(report.severity).toBe("p1");
    expect(report.blocking_reasons).toContain("goal_satisfaction_not_terminal");
    expect(report.blocking_reasons).toContain("typed_failure_missing_code");
  });

  it("recognizes a verified provider runtime cycle before terminal arbitration emits its terminal event", () => {
    const turnId = "ask:runtime-authority:pre-terminal-provider-cycle";
    const capabilityId = "com.casimirbot.minecraft.nearby_entities.list";
    const observationRef = `${turnId}:workstation_gateway:${capabilityId}:1`;
    const recorder = createHelixTurnLifecycleRecorder({
      turnId,
      scope: "codex_native_provider_cycle",
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
      route_commit_id: "route:pre-terminal",
      capability_ids: [capabilityId],
    });
    const admitted = recorder.append({
      kind: "capability.admitted",
      producer: "helix_policy",
      status: "succeeded",
      causation_id: route.event_id,
      route_commit_id: "route:pre-terminal",
      capability_id: capabilityId,
    });
    const call = recorder.append({
      kind: "tool.call.started",
      producer: "codex_runtime",
      status: "started",
      causation_id: admitted.event_id,
      route_commit_id: "route:pre-terminal",
      call_id: "call:pre-terminal",
      capability_id: capabilityId,
    });
    const completed = recorder.append({
      kind: "tool.call.completed",
      producer: "helix_adapter",
      status: "succeeded",
      causation_id: call.event_id,
      route_commit_id: "route:pre-terminal",
      call_id: "call:pre-terminal",
      capability_id: capabilityId,
      observation_refs: [observationRef],
    });
    const reentered = recorder.append({
      kind: "observation.reentered",
      producer: "helix_adapter",
      status: "succeeded",
      causation_id: completed.event_id,
      route_commit_id: "route:pre-terminal",
      call_id: "call:pre-terminal",
      capability_id: capabilityId,
      observation_refs: [observationRef],
    });
    const message = recorder.append({
      kind: "agent.message.completed",
      producer: "codex_runtime",
      status: "succeeded",
      causation_id: reentered.event_id,
      message_sha256: "hash:pre-terminal",
    });
    recorder.append({
      kind: "runtime.turn.completed",
      producer: "codex_runtime",
      status: "succeeded",
      causation_id: message.event_id,
    });

    const report = evaluateTerminalBoundaryEligibility({
      turn_id: turnId,
      source_target_intent: {
        target_source: "live_environment",
        target_kind: "live_environment",
        strength: "hard",
      },
      canonical_goal_frame: {
        turn_id: turnId,
        goal_kind: "environment_state_read",
        required_terminal_kind: "model_synthesized_answer",
      },
      native_provider_turn_lifecycle: recorder.snapshot(),
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "model_synthesized_answer",
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      current_turn_artifact_ledger: [{
        artifact_id: observationRef,
        kind: "live_environment_observation",
        capability_key: capabilityId,
        payload: {
          schema: "helix.live_environment_observation.v1",
          capability_key: capabilityId,
        },
      }],
    });

    expect(report.runtime_lifecycle).toMatchObject({
      integrity_verified: true,
      provider_cycle_completed: true,
      authority_source: "verified_runtime_event_log",
      supported_capability_ids: [capabilityId],
      supported_observation_refs: [observationRef],
    });
    expect(report.checks).toMatchObject({
      agent_runtime_loop: true,
      agent_step_decision: true,
      selected_capability_observation: true,
      post_observation_model_decision: true,
      goal_satisfaction_allows_terminal: true,
    });
    expect(report.blocking_reasons).toEqual([]);
    expect(report.eligible).toBe(true);
  });

  it("accepts a committed scholarly answer after verified observation re-entry despite a stale preflight goal frame", () => {
    const turnId = "ask:runtime-authority:scholarly-answer";
    const observationRef = `${turnId}:workstation_gateway:scholarly-research.lookup_papers:1`;
    const recorder = createHelixTurnLifecycleRecorder({
      turnId,
      scope: "codex_native_provider_cycle",
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
      route_commit_id: "route:scholarly",
      capability_ids: ["scholarly-research.lookup_papers"],
    });
    const admitted = recorder.append({
      kind: "capability.admitted",
      producer: "helix_policy",
      status: "succeeded",
      causation_id: route.event_id,
      route_commit_id: "route:scholarly",
      capability_id: "scholarly-research.lookup_papers",
    });
    const call = recorder.append({
      kind: "tool.call.started",
      producer: "codex_runtime",
      status: "started",
      causation_id: admitted.event_id,
      route_commit_id: "route:scholarly",
      call_id: "call:scholarly",
      capability_id: "scholarly-research.lookup_papers",
    });
    const completed = recorder.append({
      kind: "tool.call.completed",
      producer: "helix_adapter",
      status: "succeeded",
      causation_id: call.event_id,
      route_commit_id: "route:scholarly",
      call_id: "call:scholarly",
      capability_id: "scholarly-research.lookup_papers",
      observation_refs: [observationRef],
    });
    const reentered = recorder.append({
      kind: "observation.reentered",
      producer: "helix_adapter",
      status: "succeeded",
      causation_id: completed.event_id,
      route_commit_id: "route:scholarly",
      call_id: "call:scholarly",
      capability_id: "scholarly-research.lookup_papers",
      observation_refs: [observationRef],
    });
    const message = recorder.append({
      kind: "agent.message.completed",
      producer: "codex_runtime",
      status: "succeeded",
      causation_id: reentered.event_id,
      native_item_id: "agent-message:scholarly",
      message_sha256: "hash:scholarly",
    });
    const runtime = recorder.append({
      kind: "runtime.turn.completed",
      producer: "codex_runtime",
      status: "succeeded",
      causation_id: message.event_id,
      native_turn_id: "native-turn:scholarly",
    });
    const eligibility = recorder.append({
      kind: "terminal.eligibility.checked",
      producer: "helix_policy",
      status: "succeeded",
      causation_id: runtime.event_id,
      terminal_kind: "scholarly_research_answer",
      terminal_eligible: true,
    });
    recorder.append({
      kind: "turn.completed",
      producer: "helix_adapter",
      status: "succeeded",
      causation_id: eligibility.event_id,
      terminal_kind: "scholarly_research_answer",
      terminal_eligible: true,
    });

    const payload = {
      turn_id: turnId,
      canonical_goal_frame: {
        turn_id: turnId,
        goal_kind: "model_only_concept",
        required_terminal_kind: "direct_answer_text",
      },
      ask_turn_solver_trace: {
        committed_ask_route: {
          schema: "helix.committed_ask_route.v1",
          turn_id: turnId,
          route: {
            selected_route: "/ask/turn/stream",
            source_target: "scholarly_research",
            target_kind: "scholarly_research",
            strength: "hard",
          },
          canonical_goal: {
            goal_kind: "scholarly_research",
            required_terminal_kind: "scholarly_research_answer",
            allowed_terminal_artifact_kinds: ["scholarly_research_answer", "typed_failure"],
            forbidden_terminal_artifact_kinds: ["direct_answer_text"],
          },
          capability_policy: {
            allowed_tool_families: ["scholarly_research"],
          },
        },
      },
      native_provider_turn_lifecycle: recorder.snapshot(),
      terminal_artifact_kind: "scholarly_research_answer",
      final_answer_source: "scholarly_research_answer",
      selected_final_answer: "Magnetar observations support ultra-strong magnetic-field models.",
      terminal_answer_authority: {
        turn_id: turnId,
        terminal_kind: "answer",
        terminal_artifact_kind: "scholarly_research_answer",
        final_answer_source: "scholarly_research_answer",
        server_authoritative: true,
      },
      terminal_presentation: {
        turn_id: turnId,
        terminal_artifact_kind: "scholarly_research_answer",
        final_answer_source: "scholarly_research_answer",
        concise_text: "Magnetar observations support ultra-strong magnetic-field models.",
        selected_observation_refs: [observationRef],
      },
      current_turn_artifact_ledger: [{
        artifact_id: observationRef,
        kind: "scholarly_research_observation",
        payload: {
          schema: "helix.scholarly_research_observation.v1",
          capability_key: "scholarly-research.lookup_papers",
        },
      }],
    };

    const report = evaluateTerminalBoundaryEligibility(payload);
    expect(report.checks).toMatchObject({
      agent_runtime_loop: true,
      selected_capability_observation: true,
      post_observation_model_decision: true,
      goal_satisfaction_allows_terminal: true,
    });
    expect(report.blocking_reasons).toEqual([]);
    expect(report.eligible).toBe(true);
  });

  it("accepts a current-turn scholarly provider bridge when the native lifecycle projection is unavailable", () => {
    const turnId = "ask:runtime-authority:scholarly-provider-bridge";
    const observationRef = `${turnId}:scholarly_research_observation:1`;
    const candidateRef = `${turnId}:provider_terminal_candidate:1`;
    const text = "A relevant magnetar citation was found and summarized from the scholarly observation.";
    const payload = {
      canonical_goal_frame: {
        turn_id: turnId,
        goal_kind: "model_only_concept",
        required_terminal_kind: "direct_answer_text",
      },
      ask_turn_solver_trace: {
        committed_ask_route: {
          schema: "helix.committed_ask_route.v1",
          turn_id: turnId,
          route: {
            selected_route: "/ask/turn/stream",
            source_target: "scholarly_research",
            target_kind: "scholarly_research",
            strength: "hard",
          },
          canonical_goal: {
            goal_kind: "scholarly_research",
            required_terminal_kind: "scholarly_research_answer",
            allowed_terminal_artifact_kinds: ["scholarly_research_answer", "typed_failure"],
            forbidden_terminal_artifact_kinds: ["direct_answer_text"],
          },
          capability_policy: {
            allowed_tool_families: ["scholarly_research"],
          },
        },
      },
      terminal_artifact_kind: "scholarly_research_answer",
      final_answer_source: "scholarly_research_answer",
      selected_final_answer: text,
      terminal_answer_authority: {
        turn_id: turnId,
        terminal_kind: "answer",
        terminal_artifact_kind: "scholarly_research_answer",
        final_answer_source: "scholarly_research_answer",
        server_authoritative: true,
      },
      terminal_presentation: {
        turn_id: turnId,
        concise_text: text,
        selected_observation_refs: [observationRef],
      },
      provider_reasoning_reentry: {
        schema: "helix.provider_reasoning_reentry.v1",
        turn_id: turnId,
        status: "completed",
        evidence_reentered: true,
        solver_completed: true,
        goal_satisfaction_compatible: true,
        normalized_observation_refs: [observationRef],
      },
      provider_terminal_authority_bridge: {
        schema: "helix.provider_terminal_authority_bridge.v1",
        turn_id: turnId,
        terminal_authority_status: "authorized_by_helix_provider_candidate_bridge",
        provider_terminal_candidate_ref: candidateRef,
        solver_completed: true,
        goal_satisfaction_compatible: true,
        terminal_authority_granted: true,
        final_visible_answer_authorized: true,
        normalized_observations_ready: true,
        all_observations_succeeded: true,
        all_gateway_calls_succeeded: true,
        all_capability_lane_observations_succeeded: true,
        successful_gateway_observation_refs: [observationRef],
        successful_capability_lane_observation_refs: [],
        terminal_answer_authority: {
          turn_id: turnId,
          terminal_kind: "answer",
          terminal_artifact_kind: "agent_provider_terminal_candidate",
          final_answer_source: "agent_provider_terminal_candidate",
          terminal_item_id: candidateRef,
          server_authoritative: true,
        },
        terminal_presentation: {
          turn_id: turnId,
          final_answer_source: "agent_provider_terminal_candidate",
          terminal_authority_ref: candidateRef,
        },
      },
    };

    const report = evaluateTerminalBoundaryEligibility(payload);
    expect(report.runtime_lifecycle.authority_source).toBe("legacy_projection_only");
    expect(report.checks).toMatchObject({
      agent_runtime_loop: true,
      selected_capability_observation: true,
      post_observation_model_decision: true,
      goal_satisfaction_allows_terminal: true,
    });
    expect(report.blocking_reasons).toEqual([]);
    expect(report.eligible).toBe(true);
  });

  it("does not demand a direct-answer draft after a verified provider route product supersedes stale model-only intent", () => {
    const turnId = "ask:runtime-authority:provider-product-overrides-stale-model-only";
    const observationRef = `${turnId}:scholarly_research_observation:1`;
    const text = "The provider completed the scholarly lookup and returned a grounded magnetar citation.";
    const payload = {
      turn_id: turnId,
      canonical_goal_frame: {
        turn_id: turnId,
        goal_kind: "model_only_concept",
        required_terminal_kind: "direct_answer_text",
      },
      terminal_artifact_kind: "scholarly_research_answer",
      final_answer_source: "scholarly_research_answer",
      selected_final_answer: text,
      provider_terminal_authority_bridge: {
        schema: "helix.provider_terminal_authority_bridge.v1",
        turn_id: turnId,
        solver_completed: true,
        goal_satisfaction_compatible: true,
        terminal_authority_granted: true,
        final_visible_answer_authorized: true,
        normalized_observations_ready: true,
        all_observations_succeeded: true,
        successful_gateway_observation_refs: [observationRef],
      },
      provider_route_product_materialization: {
        schema: "helix.provider_route_product_materialization.v1",
        turn_id: turnId,
        materialized_terminal_artifact_kind: "scholarly_research_answer",
        status: "materialized",
      },
      provider_route_product_quality_gate: {
        schema: "helix.final_answer_draft_quality_gate.v1",
        ok: true,
      },
    };

    const report = evaluateTerminalBoundaryEligibility(payload);
    expect(report.provider_bridge_runtime_authority.eligible).toBe(true);
    expect(report.checks.goal_satisfaction_allows_terminal).toBe(true);
    expect(report.blocking_reasons).toEqual([]);
    expect(report.eligible).toBe(true);
  });
});
