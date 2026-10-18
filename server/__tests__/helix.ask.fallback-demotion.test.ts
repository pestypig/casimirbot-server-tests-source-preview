import { describe, expect, it } from "vitest";

import {
  buildFallbackDemotedObservation,
  classifyDeterministicFallbackUse,
} from "../services/helix-ask/deterministic-fallback-policy";
import { enforceModelAuthoredTerminalInvariant } from "../services/helix-ask/model-authored-terminal-invariant";
import { applyHelixTerminalAuthoritySingleWriter } from "../services/helix-ask/terminal-authority-single-writer";

const richPrompt =
  'Can you relate to the theory concept badge ? "Yea but what exactly is a field anyways? Both electrons and photons are considered zero-dimensional point particles without physical volume, radius, or a hard surface. Since we are all made of these invisible building blocks we actually do not exist in the physical sense! dimension are mathematical representations of reality and that notation is also not real fields emerge from electron movement and this is known as a probability in a sphere"';

describe("Helix Ask deterministic fallback demotion", () => {
  it("demotes generic electron fallback to observation on compound concept prompts", () => {
    const policy = classifyDeterministicFallbackUse({
      promptText: richPrompt,
      fallbackId: "model_only_fallback.generic_electron",
      fallbackText: "An electron is a fundamental subatomic particle.",
      payload: {},
    });

    expect(policy.terminal_allowed).toBe(false);
    expect(policy.demote_to_observation).toBe(true);
    expect(policy.reason_codes).toEqual(expect.arrayContaining(["rich_model_only_concept_signal"]));
    expect(buildFallbackDemotedObservation(policy)).toMatchObject({
      schema: "helix.deterministic_fallback_observation.v1",
      kind: "deterministic_fallback_observation",
      reason: "fallback_demoted_requires_model_turn",
      terminal_allowed: false,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("allows simple electron definition fallback", () => {
    const policy = classifyDeterministicFallbackUse({
      promptText: "What is an electron?",
      fallbackId: "model_only_fallback.generic_electron",
      fallbackText: "An electron is a fundamental subatomic particle with a negative electric charge.",
      payload: {},
    });

    expect(policy.terminal_allowed).toBe(true);
    expect(policy.demote_to_observation).toBe(false);
  });

  it("demotes non-electron keyword fallbacks on compound prompts", () => {
    const policy = classifyDeterministicFallbackUse({
      promptText:
        "Can you explain proper time and coordinate time, and connect that to whether dimensions are physically real?",
      fallbackId: "model_only_fallback.proper_time_coordinate_time",
      fallbackText:
        "Proper time is the time measured by a clock moving along a particular worldline. Coordinate time is the time label assigned by a chosen reference frame.",
      payload: {},
    });

    expect(policy.terminal_allowed).toBe(false);
    expect(policy.demote_to_observation).toBe(true);
    expect(policy.reason_codes).toEqual(expect.arrayContaining(["compound_prompt_shape"]));
  });

  it("blocks final drafts cloned from nonterminal fallback text", () => {
    const fallbackText = "An electron is a fundamental subatomic particle.";
    const result = enforceModelAuthoredTerminalInvariant({
      turnId: "turn-1",
      payload: {
        active_prompt: richPrompt,
        terminal_artifact_kind: "model_synthesized_answer",
        selected_final_answer: fallbackText,
        final_answer_draft: {
          schema: "helix.final_answer_draft.v1",
          text: fallbackText,
          authority: "deterministic_receipt_fallback",
        },
      },
      artifactLedger: [
        {
          artifact_id: "direct-1",
          kind: "direct_answer_text",
          payload: {
            fallback_id: "model_only_fallback.generic_electron",
            text: fallbackText,
          },
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContain("final_draft_cloned_from_nonterminal_fallback");
    expect(result.repair_required).toBe(true);
  });

  it("does not select direct answer while solver continuation is pending", () => {
    const payload: Record<string, unknown> = {
      solver_continuation_observation: {
        schema: "helix.solver_continuation_observation.v1",
        required_next_step: "model_followup_reasoning",
      },
      solver_continuation_count: 1,
      selected_final_answer: "An electron is a fundamental subatomic particle.",
      terminal_artifact_kind: "direct_answer_text",
      final_answer_source: "model_direct_answer",
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId: "turn-2",
      payload,
      artifactLedger: [],
    });

    expect(result.selected_terminal_artifact_kind).not.toBe("direct_answer_text");
    expect(result.rejected_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "solver_continuation_pending",
        }),
      ]),
    );
  });

  it("keeps deterministic Stage Play receipt fallback nonterminal when checkpoint is pending", () => {
    const payload: Record<string, unknown> = {
      active_prompt: "Use Stage Play to reflect the active visual source.",
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
      selected_final_answer:
        "Stage Play tool receipt: live_env.reflect_stage_play_context; graph stage_play_badge_graph:test.",
      source_target_intent: {
        target_source: "live_environment",
      },
      route_product_contract: {
        source_target: "live_environment",
        allowed_terminal_artifact_kinds: ["model_synthesized_answer", "typed_failure"],
        forbidden_terminal_artifact_kinds: ["live_pipeline_receipt", "client_projection"],
      },
      agent_runtime_loop: {
        iterations: [
          {
            chosen_capability: "live_env.reflect_stage_play_context",
          },
        ],
      },
      agent_step_decision: {
        chosen_capability: "live_env.reflect_stage_play_context",
      },
      goal_satisfaction_evaluation: {
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
    };

    const result = applyHelixTerminalAuthoritySingleWriter({
      turnId: "turn-stage-play-receipt",
      payload,
      artifactLedger: [
        {
          artifact_id: "obs-1",
          kind: "agent_step_observation_packet",
          payload: {
            schema: "helix.agent_step_observation_packet.v1",
            status: "succeeded",
            tool_name: "live_env.reflect_stage_play_context",
            post_tool_model_step_required: true,
            terminal_eligible: false,
          },
        },
        {
          artifact_id: "draft-1",
          kind: "final_answer_draft",
          payload: {
            schema: "helix.final_answer_draft.v1",
            text:
              "Stage Play tool receipt: live_env.reflect_stage_play_context; graph stage_play_badge_graph:test.",
            authority: "deterministic_receipt_fallback",
          },
        },
      ],
    });

    expect(payload.final_answer_draft_selection).toMatchObject({
      blocked_reason: "deterministic_receipt_fallback_nonterminal",
    });
    expect(payload.route_terminal_materialization).toMatchObject({
      materialization_ok: false,
      materialization_blocked_reason: "deterministic_receipt_fallback_nonterminal",
    });
    expect(payload.terminal_artifact_kind).toBe("tool_receipt");
    expect(payload.terminal_artifact_kind).not.toBe("model_synthesized_answer");
    expect(payload.final_answer_source).toBe("deterministic_receipt_fallback");
    expect(payload.terminal_eligible).toBe(false);
    expect(payload.assistant_answer).toBe(false);
    expect(payload.answer).toContain("Stage Play reflected the active visual source and queued a checkpoint.");
    expect(payload.answer).toContain("No model-reviewed answer snapshot exists yet.");
    expect(payload.receipt_status_text).toContain("Stage Play reflected the active visual source and queued a checkpoint.");
    expect(payload.selected_final_answer).toBeUndefined();
    expect(payload.finalAnswer).toBeUndefined();
    expect(payload.terminal_answer_authority).toMatchObject({
      terminal_artifact_kind: "tool_receipt",
      final_answer_source: "deterministic_receipt_fallback",
      server_authoritative: false,
      terminal_eligible: false,
      assistant_answer: false,
    });
    expect(result.selected_terminal_artifact_kind).toBe("tool_receipt");
    expect(result.wroteVisibleFields).not.toContain("payload.selected_final_answer");
    expect(result.audit?.wroteVisibleFields).not.toContain("payload.selected_final_answer");
  });
});
