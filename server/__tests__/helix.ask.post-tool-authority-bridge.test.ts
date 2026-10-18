import { describe, expect, it } from "vitest";

import { evaluateCalculatorToolAnswerSupport } from "../services/helix-ask/calculator-tool-answer-support";
import { applyPostToolAuthorityBridgeRepair, buildPostToolAuthorityBridge } from "../services/helix-ask/post-tool-authority-bridge";
import { evaluateVisibleAnswerPolicyFaithfulnessGate } from "../services/helix-ask/visible-answer-policy-faithfulness-gate";
import { getHelixCausalTurnTimeline } from "../services/helix-ask/causal-turn-timeline";

const turnId = "ask:test-post-tool-authority";

describe("Helix Ask post-tool authority bridge", () => {
  it("preserves capability-help route-product identity after a catalog-backed answer draft", () => {
    const capabilityTurnId = `${turnId}:capability-help`;
    const answerText = "The research-paper workflow checks accessible full text before choosing whether visual parsing is needed.";
    const payload: Record<string, unknown> = {
      turn_id: capabilityTurnId,
      active_prompt: "How does the research-paper tool decide which papers it can parse?",
      canonical_goal_frame: {
        goal_kind: "capability_help",
        required_terminal_kind: "capability_help_summary",
      },
      route_product_contract: {
        source_target: "runtime_evidence",
        allowed_terminal_artifact_kinds: ["capability_help_summary", "typed_failure"],
        forbidden_terminal_artifact_kinds: ["model_synthesized_answer"],
      },
      agent_step_decision: { chosen_capability: "model.direct_answer" },
      terminal_artifact_kind: "capability_help_summary",
      final_answer_source: "capability_help_summary",
      selected_final_answer: answerText,
      capability_help_summary: {
        schema: "helix.capability_help_summary.v1",
        answer_text: answerText,
        text: answerText,
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: `${capabilityTurnId}:capability_registry`,
          kind: "capability_registry",
          source_scope: "current_turn",
          payload: { schema: "helix.capability_registry.v1" },
        },
        {
          artifact_id: `${capabilityTurnId}:final_answer_draft`,
          kind: "final_answer_draft",
          source_scope: "current_turn",
          payload: { schema: "helix.final_answer_draft.v1", text: answerText },
        },
      ],
    };

    const bridge = applyPostToolAuthorityBridgeRepair({ turnId: capabilityTurnId, payload });

    expect(bridge).toMatchObject({
      route_family: "capability_catalog",
      required_terminal_kind: "capability_help_summary",
      terminal_repair_action: "none",
      observation_support_status: "supports_answer",
    });
    expect(payload).toMatchObject({
      terminal_artifact_kind: "capability_help_summary",
      final_answer_source: "capability_help_summary",
      selected_final_answer: answerText,
    });
  });

  it("lets calculator result plus final draft support a synthesized terminal answer", () => {
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      active_prompt: "Open the scientific calculator, solve 2*(3+4), and explain the steps.",
      terminal_artifact_kind: "model_synthesized_answer",
      terminal_error_code: "terminal_boundary_ineligible",
      canonical_goal_frame: { goal_kind: "calculator_solve" },
      agent_step_decision: { chosen_capability: "scientific-calculator.solve_expression" },
      goal_satisfaction_evaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        satisfaction: "unsatisfied",
        next_decision: "fail_closed",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: `${turnId}:calculator_result`,
          kind: "calculator_receipt",
          source_scope: "current_turn",
          payload: {
            schema: "helix.calculator_receipt.v1",
            expression: "2*(3+4)",
            result: "14",
          },
        },
        {
          artifact_id: `${turnId}:final_answer_draft`,
          kind: "final_answer_draft",
          source_scope: "current_turn",
          payload: {
            schema: "helix.final_answer_draft.v1",
            text: "First add 3+4 to get 7, then multiply 2*7 to get the result 14.",
          },
        },
      ],
    };

    const support = evaluateCalculatorToolAnswerSupport({ turnId, payload });
    expect(support.supports_goal).toBe(true);

    const bridge = applyPostToolAuthorityBridgeRepair({ turnId, payload });
    expect(bridge.observation_support_status).toBe("supports_answer");
    expect(payload.terminal_error_code).toBeUndefined();
    expect(payload.terminal_artifact_kind).toBe("model_synthesized_answer");
    expect((payload.goal_satisfaction_evaluation as Record<string, unknown>).satisfaction).toBe("satisfied");
  });

  it("materializes voice confirmation as request_user_input instead of generic failure", () => {
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      active_prompt: "Have Dottie read that out loud.",
      terminal_artifact_kind: "typed_failure",
      terminal_error_code: "terminal_boundary_ineligible",
      canonical_goal_frame: { goal_kind: "situation_context_question" },
      goal_satisfaction_evaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        satisfaction: "unsatisfied",
        next_decision: "fail_closed",
      },
      current_turn_artifact_ledger: [],
    };

    const bridge = applyPostToolAuthorityBridgeRepair({ turnId, payload });
    expect(bridge.route_family).toBe("voice_delivery");
    expect(payload.terminal_artifact_kind).toBe("request_user_input");
    expect(payload.final_status).toBe("pending_input");
    expect(payload.response_type).toBe("pending_input");
    expect(payload.assistant_answer).toBe(false);
    expect(payload.selected_final_answer).toBeUndefined();
    expect(payload.answer).toBeUndefined();
    expect(payload.text).toBeUndefined();
    expect(payload.pending_server_request).toMatchObject({
      prompt: expect.stringMatching(/confirmation before speaking/i),
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(payload.request_user_input_preview).toMatchObject({
      prompt: expect.stringMatching(/confirmation before speaking/i),
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(payload.terminal_error_code).toBeUndefined();
  });

  it("materializes status-only interim voice callout status as synthesized answer from visible selected text", () => {
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      active_prompt: "Did the interim voice callout get accepted for playback?",
      selected_final_answer:
        "The interim voice callout was requested, but playback was blocked by capacity. The receipt is evidence-only.",
      answer:
        "The interim voice callout was requested, but playback was blocked by capacity. The receipt is evidence-only.",
      text:
        "The interim voice callout was requested, but playback was blocked by capacity. The receipt is evidence-only.",
      terminal_artifact_kind: "direct_answer_text",
      final_answer_source: "model_direct_answer",
      terminal_error_code: "terminal_boundary_ineligible",
      canonical_goal_frame: { goal_kind: "live_environment_review", required_terminal_kind: "model_synthesized_answer" },
      agent_step_decision: { chosen_capability: "live_env.request_interim_voice_callout" },
      goal_satisfaction_evaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        satisfaction: "partially_satisfied",
        next_decision: "fail_closed",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: `${turnId}:interim_voice`,
          kind: "live_environment_tool_observation",
          source_scope: "current_turn",
          payload: {
            schema: "helix.live_environment_tool_observation.v1",
            tool_name: "live_env.request_interim_voice_callout",
            observation: {
              schema: "helix.interim_voice_callout_tool_result.v1",
              receipt: {
                status: "blocked_capacity",
                assistant_answer: false,
                raw_content_included: false,
              },
            },
          },
        },
      ],
    };

    const bridge = applyPostToolAuthorityBridgeRepair({ turnId, payload });
    expect(bridge.reason).toBe("interim_voice_callout_receipt_supports_status_answer");
    expect(bridge.observation_support_status).toBe("supports_answer");
    expect(payload.terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(payload.final_answer_source).toBe("final_answer_draft");
    expect(payload.terminal_error_code).toBeUndefined();
    expect((payload.goal_satisfaction_evaluation as Record<string, unknown>).satisfaction).toBe("satisfied");
  });

  it("does not let an interim voice receipt alone satisfy compound explanation prompts", () => {
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      active_prompt:
        "Use the live environment tool path and take a few steps before the final answer. Check the active turn context, make one interim voice callout, and then explain what evidence-only voice tool receipts mean.",
      selected_final_answer:
        "The interim voice callout was accepted for client playback handoff; browser playback confirmation is still pending.",
      answer:
        "The interim voice callout was accepted for client playback handoff; browser playback confirmation is still pending.",
      text:
        "The interim voice callout was accepted for client playback handoff; browser playback confirmation is still pending.",
      terminal_artifact_kind: "direct_answer_text",
      final_answer_source: "model_direct_answer",
      terminal_error_code: "terminal_boundary_ineligible",
      canonical_goal_frame: { goal_kind: "live_environment_review", required_terminal_kind: "model_synthesized_answer" },
      agent_step_decision: { chosen_capability: "live_env.request_interim_voice_callout" },
      goal_satisfaction_evaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        satisfaction: "partially_satisfied",
        next_decision: "fail_closed",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: `${turnId}:interim_voice`,
          kind: "live_environment_tool_observation",
          source_scope: "current_turn",
          payload: {
            schema: "helix.live_environment_tool_observation.v1",
            tool_name: "live_env.request_interim_voice_callout",
            observation: {
              schema: "helix.interim_voice_callout_tool_result.v1",
              receipt: {
                status: "awaiting_client_playback",
                assistant_answer: false,
                raw_content_included: false,
              },
            },
          },
        },
      ],
    };

    const bridge = buildPostToolAuthorityBridge({ turnId, payload });
    expect(bridge.reason).toBe("interim_voice_callout_receipt_only_covers_callout_subgoal");
    expect(bridge.observation_support_status).toBe("not_enough_information");
    expect(bridge.pending_requirements.map((requirement) => requirement.code)).toContain("missing_post_tool_answer_draft");
  });

  it("repairs live-source mailbox completion from packet, decision, and voice receipt instead of stale doc fallback", () => {
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      active_prompt: "Read the processed live-source mailbox and handle any urgent callout.",
      selected_final_answer: "The turn stopped before required artifacts were satisfied: doc_summary.",
      answer: "The turn stopped before required artifacts were satisfied: doc_summary.",
      text: "The turn stopped before required artifacts were satisfied: doc_summary.",
      terminal_artifact_kind: "typed_failure",
      terminal_error_code: "terminal_boundary_ineligible",
      canonical_goal_frame: { goal_kind: "live_source_processed_mail_interpretation" },
      source_target_intent: { target_source: "live_source_mailbox" },
      phase_controller_trajectory: {
        current_phase: "terminal_checkpoint",
        canonical_goal: "processed_mail_voice_decision",
        mandatory_next_tool: null,
      },
      goal_satisfaction_evaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        satisfaction: "partially_satisfied",
        next_decision: "fail_closed",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: `${turnId}:packet`,
          kind: "live_environment_tool_observation",
          source_scope: "current_turn",
          payload: {
            schema: "helix.live_environment_tool_observation.v1",
            tool_name: "live_env.read_processed_live_source_mail",
            observation: {
              packets: [{
                packetId: "stage_play_processed_mail_packet:synthetic-urgent",
                observedFacts: ["Synthetic source shows a high-salience hazard cue."],
                changedFacts: ["The source moved from stable to hazardous state."],
                riskCues: ["fire", "damage"],
                recommendedNext: "request_voice_callout",
                salience: {
                  level: "urgent",
                  voiceCandidate: true,
                },
              }],
            },
          },
        },
        {
          artifact_id: `${turnId}:decision`,
          kind: "live_environment_tool_observation",
          source_scope: "current_turn",
          payload: {
            schema: "helix.live_environment_tool_observation.v1",
            tool_name: "live_env.record_live_source_mail_decision",
            observation: {
              artifactId: "stage_play_live_source_mail_decision",
              schemaVersion: "stage_play_live_source_mail_decision/v1",
              decision: "request_voice_callout",
              rationalePreview: "Processed mail packet salience urgent recommends request_voice_callout.",
              voiceCalloutDraft: {
                text: "risk/voice criteria matched: fire, damage",
                voiceEligible: true,
                requiresConfirmation: false,
              },
              voicePolicy: {
                reason: "minecraft_fire_or_damage_cue,minecraft_visible_danger_cue",
              },
              requestedTool: {
                toolName: "live_env.request_interim_voice_callout",
              },
            },
          },
        },
        {
          artifact_id: `${turnId}:voice`,
          kind: "live_environment_tool_observation",
          source_scope: "current_turn",
          payload: {
            schema: "helix.live_environment_tool_observation.v1",
            tool_name: "live_env.request_interim_voice_callout",
            observation: {
              schema: "helix.interim_voice_callout_tool_result.v1",
              receipt: {
                status: "awaiting_client_playback",
                assistant_answer: false,
                raw_content_included: false,
              },
            },
          },
        },
      ],
    };

    const bridge = applyPostToolAuthorityBridgeRepair({ turnId, payload });
    expect(bridge.route_family).toBe("live_source_mailbox");
    expect(bridge.reason).toBe("live_source_mailbox_receipts_support_synthesized_answer");
    expect(bridge.observation_support_status).toBe("supports_answer");
    expect(payload.terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(String(payload.selected_final_answer)).toMatch(/live-source mailbox route completed/i);
    expect(String(payload.selected_final_answer)).toMatch(/request_voice_callout/i);
    expect(String(payload.selected_final_answer)).toMatch(/fire, damage/i);
    expect(String(payload.selected_final_answer)).toMatch(/awaiting_client_playback/i);
    expect(String(payload.selected_final_answer)).not.toMatch(/doc_summary/i);
    expect(payload.post_tool_authority_bridge).toMatchObject({
      route_family: "live_source_mailbox",
      observation_support_status: "supports_answer",
    });
    expect(payload.terminal_authority_single_writer).toMatchObject({
      selectedArtifactKind: "model_synthesized_answer",
      selected_terminal_artifact_kind: "model_synthesized_answer",
      source: "final_answer_draft",
      audit: {
        selectedArtifactKind: "model_synthesized_answer",
        wroteVisibleFields: expect.arrayContaining([
          "payload.text",
          "payload.answer",
          "payload.selected_final_answer",
          "terminal_presentation.concise_text",
        ]),
      },
    });
    expect(payload.terminal_error_code).toBeUndefined();
    expect((payload.goal_satisfaction_evaluation as Record<string, unknown>).satisfaction).toBe("satisfied");
  });

  it("repairs live-source mailbox reflection completion from the causal reflection artifact without requiring a voice receipt", () => {
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      active_prompt:
        "Explain why the final answer feels disconnected from the processed mail loop and MicroDeck causality.",
      selected_final_answer: "Terminal failed before causal reflection could answer.",
      answer: "Terminal failed before causal reflection could answer.",
      text: "Terminal failed before causal reflection could answer.",
      terminal_artifact_kind: "typed_failure",
      terminal_error_code: "terminal_boundary_ineligible",
      canonical_goal_frame: { goal_kind: "live_source_processed_mail_interpretation" },
      source_target_intent: { target_source: "live_source_mailbox" },
      phase_controller_trajectory: {
        current_phase: "terminal_checkpoint",
        canonical_goal: "processed_mail_interpretation",
        mandatory_next_tool: null,
      },
      agent_step_decision: { chosen_capability: "live_env.reflect_live_source_mail_loop" },
      goal_satisfaction_evaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        satisfaction: "partially_satisfied",
        next_decision: "fail_closed",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: `${turnId}:mail-loop-reflection`,
          kind: "live_environment_tool_observation",
          source_scope: "current_turn",
          payload: {
            schema: "helix.live_environment_tool_observation.v1",
            tool_name: "live_env.reflect_live_source_mail_loop",
            observation: {
              artifactId: "stage_play_live_source_mail_loop_reflection",
              schemaVersion: "stage_play_live_source_mail_loop_reflection/v1",
              reflectionId: "stage_play_live_source_mail_loop_reflection:test",
              inspectionWindow: {
                mailIds: ["stage_play_live_source_mail:test"],
                processedPacketRefs: ["stage_play_processed_mail_packet:test"],
                microReasonerRunRefs: ["stage_play_micro_reasoner_run:test"],
                currentStateRef: "stage_play_live_source_current_state:test",
                loopHealthRef: "stage_play_live_source_loop_health:test",
                stagePlayGraphRef: "stage_play_badge_graph:test",
                liveAnswerProjectionRefs: ["stage_play_output_lane_projection:test"],
                decisionRefs: [],
                voiceReceiptRefs: [],
              },
              causalGraph: [
                {
                  fromRef: "stage_play_live_source_mail:test",
                  toRef: "stage_play_processed_mail_packet:test",
                  relation: "processed_into_packet",
                  note: "Mail was processed into packet evidence.",
                },
                {
                  fromRef: "stage_play_processed_mail_packet:test",
                  toRef: "stage_play_micro_reasoner_run:test",
                  relation: "reasoned_by_microdeck",
                  note: "The MicroDeck run interpreted the packet.",
                },
              ],
              stageSummaries: {
                processedMail: ["stage_play_processed_mail_packet:test: observed hazard changed"],
                microDeck: ["decision_selector: completed; selected record_interpretation"],
                terminalReadiness: ["Reflection has processed packet, MicroDeck, current-state, loop-health, and Stage Play graph refs for model re-entry."],
              },
              whatEnteredAnswerContext: [
                "processed packet stage_play_processed_mail_packet:test: observed hazard changed",
                "MicroDeck decision_selector run stage_play_micro_reasoner_run:test: selected record_interpretation",
              ],
              whatDidNotEnterAnswerContext: [],
              missingEvidence: [],
              limitations: ["The badge graph remains evidence-only."],
              whatAskCanSafelySay: ["The final answer must synthesize from the reflection artifact, not from the badge graph alone."],
              nextUsefulTool: null,
              evidenceRefs: [
                "stage_play_processed_mail_packet:test",
                "stage_play_micro_reasoner_run:test",
                "stage_play_badge_graph:test",
              ],
              assistant_answer: false,
              terminal_eligible: false,
              raw_content_included: false,
              context_role: "tool_evidence",
              ask_context_policy: "evidence_only",
            },
          },
        },
      ],
    };

    const bridge = applyPostToolAuthorityBridgeRepair({ turnId, payload });
    expect(bridge.route_family).toBe("live_source_mailbox");
    expect(bridge.reason).toBe("live_source_mail_loop_reflection_supports_synthesized_answer");
    expect(bridge.observation_support_status).toBe("supports_answer");
    expect(payload.terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(String(payload.selected_final_answer)).toMatch(/live-source mail-loop reflection inspected 1 mail item/i);
    expect(String(payload.selected_final_answer)).toMatch(/MicroDeck run/i);
    expect(String(payload.selected_final_answer)).toMatch(/Stage Play graph evidence was included/i);
    expect(String(payload.selected_final_answer)).not.toMatch(/voice receipt/i);
    expect(payload.terminal_error_code).toBeUndefined();
    expect((payload.goal_satisfaction_evaluation as Record<string, unknown>).satisfaction).toBe("satisfied");
  });

  it("keeps mailbox route precedence over generic voice delivery when a completed mailbox voice receipt exists", () => {
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      active_prompt: "Read the processed Minecraft mailbox and handle the urgent voice callout.",
      selected_final_answer:
        "The interim voice callout was accepted for client playback handoff; browser playback confirmation is still pending.",
      answer:
        "The interim voice callout was accepted for client playback handoff; browser playback confirmation is still pending.",
      text:
        "The interim voice callout was accepted for client playback handoff; browser playback confirmation is still pending.",
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        concise_text: "The interim voice callout was accepted for client playback handoff; browser playback confirmation is still pending.",
      },
      terminal_artifact_kind: "direct_answer_text",
      final_answer_source: "model_direct_answer",
      source_target_intent: { target_source: "live_source_mailbox" },
      evidence_target_arbitration: { selected_target_source: "live_source_mailbox" },
      canonical_goal_frame: { goal_kind: "live_environment_review", required_terminal_kind: "model_synthesized_answer" },
      phase_controller_trajectory: {
        current_phase: "terminal_checkpoint",
        canonical_goal: "processed_mail_voice_decision",
        mandatory_next_tool: null,
      },
      agent_step_decision: { chosen_capability: "live_env.request_interim_voice_callout" },
      goal_satisfaction_evaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: `${turnId}:packet`,
          kind: "live_environment_tool_observation",
          source_scope: "current_turn",
          payload: {
            schema: "helix.live_environment_tool_observation.v1",
            tool_name: "live_env.read_processed_live_source_mail",
            observation: {
              packets: [{
                packetId: "stage_play_processed_mail_packet:real-shape",
                changedFacts: ["Synthetic player entered a high-risk state."],
                riskCues: ["fire", "damage"],
                recommendedNext: "request_voice_callout",
                salience: { level: "urgent", voiceCandidate: true },
              }],
            },
          },
        },
        {
          artifact_id: `${turnId}:decision`,
          kind: "live_environment_tool_observation",
          source_scope: "current_turn",
          payload: {
            schema: "helix.live_environment_tool_observation.v1",
            tool_name: "live_env.record_live_source_mail_decision",
            observation: {
              artifactId: "stage_play_live_source_mail_decision",
              decision: "request_voice_callout",
              voiceCalloutDraft: { text: "risk/voice criteria matched: fire, damage" },
            },
          },
        },
        {
          artifact_id: `${turnId}:voice`,
          kind: "live_environment_tool_observation",
          source_scope: "current_turn",
          payload: {
            schema: "helix.live_environment_tool_observation.v1",
            tool_name: "live_env.request_interim_voice_callout",
            observation: {
              schema: "helix.interim_voice_callout_tool_result.v1",
              receipt: { status: "awaiting_client_playback", assistant_answer: false, raw_content_included: false },
            },
          },
        },
      ],
    };

    const bridge = applyPostToolAuthorityBridgeRepair({ turnId, payload });
    expect(bridge.route_family).toBe("live_source_mailbox");
    expect(bridge.reason).toBe("live_source_mailbox_receipts_support_synthesized_answer");
    expect(String(payload.selected_final_answer)).toMatch(/read processed mailbox packets/i);
    expect(String(payload.selected_final_answer)).toMatch(/recorded decision was request_voice_callout/i);
    expect(String(payload.selected_final_answer)).not.toBe("The interim voice callout was accepted for client playback handoff; browser playback confirmation is still pending.");
    expect(payload.terminal_presentation).toMatchObject({
      terminal_artifact_kind: "model_synthesized_answer",
      concise_text: expect.stringMatching(/live-source mailbox route completed/i),
    });
  });

  it("catches visible policy inversion about receipts and final answers", () => {
    const gate = evaluateVisibleAnswerPolicyFaithfulnessGate({
      turnId,
      text: "Receipts are observations. Final answers must be derived from the observations.",
      payload: { terminal_artifact_kind: "repo_code_evidence_answer" },
    });
    expect(gate.ok).toBe(false);
    expect(gate.violations).toContain("receipt_promoted_to_authority");
  });

  it("orders tool observations before post-tool answer artifacts in the causal timeline", () => {
    const payload: Record<string, unknown> = {
      turn_id: turnId,
      active_prompt: "Open the docs viewer.",
      terminal_artifact_kind: "model_synthesized_answer",
      selected_final_answer: "The docs viewer has been successfully opened.",
      canonical_goal_frame: { goal_kind: "docs_panel_open" },
      source_target_intent: { target_source: "workstation_panel" },
      agent_step_decision: { chosen_capability: "docs-viewer.open", next_step: "use_capability" },
      goal_satisfaction_evaluation: {
        schema: "helix.goal_satisfaction_evaluation.v1",
        satisfaction: "satisfied",
        next_decision: "allow_terminal",
      },
      current_turn_artifact_ledger: [
        {
          artifact_id: `${turnId}:obs`,
          kind: "agent_step_observation_packet",
          source_scope: "current_turn",
          payload: { schema: "helix.agent_step_observation_packet.v1" },
        },
        {
          artifact_id: `${turnId}:draft`,
          kind: "final_answer_draft",
          source_scope: "current_turn",
          payload: { schema: "helix.final_answer_draft.v1", text: "The docs viewer has been successfully opened." },
        },
      ],
    };
    const timeline = getHelixCausalTurnTimeline(payload);
    const observationIndex = timeline.events.findIndex((event) => event.stage === "tool_observation_created");
    const answerIndex = timeline.events.findIndex((event) => event.stage === "model_answer_artifact_created");
    expect(observationIndex).toBeGreaterThanOrEqual(0);
    expect(answerIndex).toBeGreaterThan(observationIndex);
  });
});
