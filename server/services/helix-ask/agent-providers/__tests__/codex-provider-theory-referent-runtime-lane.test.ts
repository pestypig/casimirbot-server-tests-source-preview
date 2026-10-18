import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { codexProvider } from "../codex-provider";

const CAPABILITY = "helix_ask.reflect_theory_context" as const;
const FAKE_ENV_KEYS = [
  "CODEX_AGENT_FAKE_STDOUT",
  "CODEX_AGENT_FAKE_STDOUT_SEQUENCE",
  "CODEX_AGENT_FAKE_CALL_INDEX",
  "CODEX_AGENT_FAKE_EXIT_CODE",
  "CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH",
] as const;

const originalFakeEnv = new Map(
  FAKE_ENV_KEYS.map((key) => [key, process.env[key]] as const),
);

afterEach(() => {
  for (const key of FAKE_ENV_KEYS) {
    const previous = originalFakeEnv.get(key);
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

describe("Codex provider runtime theory referent lane", () => {
  it("retries a fabricated direct graph answer and forces a long direct subject through observation re-entry", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "helix-codex-theory-direct-lane-"));
    const capturePromptPath = path.join(tempDir, "prompt.txt");
    const question =
      "Reflect the idea that deterministic microscopic laws can produce probabilistic macroscopic observations when information is lost through coarse-graining with the Theory Badge Graph.";
    const semanticTopic =
      "Deterministic microscopic laws producing probabilistic macroscopic observations through coarse-graining and information loss.";
    const inventedDirectAnswer =
      "Deterministic Microscopic Laws -> Coarse-Graining -> Probabilistic Observations.";
    const finalReflection = [
      "Exact matches: none.",
      "Likely matches and graph probability are bounded by the re-entered Theory Badge Graph observation; out-of-graph mass remains explicit.",
    ].join(" ");

    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        inventedDirectAnswer,
        `HELIX_CAPABILITY_LANE_REQUEST_JSON: ${JSON.stringify({
          capability: CAPABILITY,
          prompt: semanticTopic,
          conversation_context: question,
          build_explanation_plan: true,
        })}`,
        finalReflection,
      ],
    });
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = capturePromptPath;

    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-theory-long-direct-runtime-lane",
          question,
        },
      });
      const debug = result.debug as Record<string, any>;
      const retryPrompt = fs.readFileSync(path.join(tempDir, "prompt.2.txt"), "utf8");
      const reentryPrompt = fs.readFileSync(path.join(tempDir, "prompt.3.txt"), "utf8");

      expect(result).toMatchObject({
        ok: true,
        answer: finalReflection,
        final_answer_source: "theory_context_reflection_answer",
        terminal_artifact_kind: "theory_context_reflection_answer",
      });
      expect(result.answer).not.toContain(inventedDirectAnswer);
      expect(debug.runtime_lane_request_retry).toMatchObject({
        status: "runtime_provider_emitted_lane_request",
        reason: "initial_provider_response_skipped_required_one_shot_lane_request",
        prior_response_preview: inventedDirectAnswer,
      });
      expect(debug.runtime_lane_request_loop).toMatchObject({
        status: "lane_observation_reentered",
        candidate: {
          capability: CAPABILITY,
          prompt: semanticTopic,
        },
      });
      expect(debug.capability_lane_call_results).toEqual(expect.arrayContaining([
        expect.objectContaining({
          ok: true,
          capability: CAPABILITY,
          delegated_capability_id: CAPABILITY,
          reentry_required: true,
          terminal_eligible: false,
        }),
      ]));
      expect(retryPrompt).toContain(`compact JSON for ${CAPABILITY}`);
      expect(reentryPrompt).toContain("Helix executed the runtime-requested capability lane call");
      expect(reentryPrompt).toContain("helix.theory_context_reflection_observation.v1");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 20_000);

  it("lets the runtime bind a prior assistant answer, re-enter the theory observation, and author the final reflection", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "helix-codex-theory-referent-lane-"));
    const capturePromptPath = path.join(tempDir, "prompt.txt");
    const priorAnswer = [
      "Deterministic microscopic laws can produce probabilistic macroscopic observations when coarse-graining groups many microstates into one macrostate.",
      "Chaos can amplify unknown initial detail, while Shannon entropy measures information missing from the retained description rather than proving fundamental randomness.",
    ].join(" ");
    const resolvedSourceRef = "chat.final_answer.previous:reply-determinism-probability";
    const resolvedTextHash = crypto.createHash("sha256").update(priorAnswer).digest("hex").slice(0, 16);
    const semanticTopic =
      "Deterministic microscopic laws producing probabilistic macroscopic observations through coarse-graining and unavailable information.";
    const finalReflection = [
      "The graph treats determinism as the fine-scale dynamics and probability as an effective description induced by coarse-graining and unavailable information.",
      "Shannon entropy quantifies uncertainty in the retained description, but does not by itself establish fundamental randomness.",
    ].join(" ");
    const runtimeLaneCall = {
      capability: CAPABILITY,
      prompt: semanticTopic,
      conversation_context: "Reflect this with the Theory Badge Graph.",
      build_explanation_plan: true,
      resolved_referent_text: priorAnswer,
      resolved_source_ref: resolvedSourceRef,
      resolved_text_hash: resolvedTextHash,
      semantic_prompt_source: "chat_history",
    };

    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        `HELIX_CAPABILITY_LANE_REQUEST_JSON: ${JSON.stringify(runtimeLaneCall)}`,
        finalReflection,
      ],
    });
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    process.env.CODEX_AGENT_FAKE_CAPTURE_PROMPT_PATH = capturePromptPath;

    try {
      const result = await codexProvider.runTurn({
        runtime: "codex",
        route: "/ask/turn",
        body: {
          turn_id: "turn-codex-theory-referent-runtime-lane",
          question: "Reflect this with the Theory Badge Graph.",
          workspace_context_snapshot: {
            chat_referent_context_source_summary: {
              schema: "helix.ask.chat_referent_context_source_summary.v1",
              source_count: 1,
              total_reply_count: 2,
              readable_reply_count: 2,
              retained_candidate_count: 1,
              selected_source_name: "visible_ask_transcript",
              context_present: true,
            },
            chat_referent_context: {
              schema: "helix.ask.chat_referent_context.v1",
              previous_assistant_final_answer: {
                role: "assistant",
                reply_id: "reply-determinism-probability",
                source_ref: resolvedSourceRef,
                text: priorAnswer,
                text_hash: resolvedTextHash,
              },
            },
          },
        },
      });
      const debug = result.debug as Record<string, any>;
      const initialPrompt = fs.readFileSync(capturePromptPath, "utf8");
      const reentryPrompt = fs.readFileSync(path.join(tempDir, "prompt.2.txt"), "utf8");

      expect(result).toMatchObject({
        ok: true,
        runtime: "codex",
        response_type: "final_answer",
        final_status: "completed",
        answer: finalReflection,
        final_answer_source: "theory_context_reflection_answer",
        terminal_artifact_kind: "theory_context_reflection_answer",
      });
      expect(debug.conversational_referent_resolution).toMatchObject({
        schema: "helix.ask.conversational_referent_resolution.v1",
        referent_detected: true,
        referent_phrase: "deictic_previous_assistant_answer",
        source_kind: "chat_history",
        resolved_source_ref: resolvedSourceRef,
        resolved_text_hash: resolvedTextHash,
        resolution_confidence: "high",
      });
      expect(debug.chat_referent_context_presence).toMatchObject({
        present: true,
        previous_assistant_final_answer_present: true,
        previous_assistant_final_answer_ref: resolvedSourceRef,
        previous_assistant_final_answer_hash: resolvedTextHash,
      });
      expect(debug.runtime_lane_request_loop).toMatchObject({
        status: "lane_observation_reentered",
        requested_by_runtime_provider: true,
        synthesized_by_helix_policy: false,
        candidate: {
          capability: CAPABILITY,
          prompt: semanticTopic,
          resolved_source_ref: resolvedSourceRef,
          resolved_text_hash: resolvedTextHash,
        },
      });
      expect(debug.capability_lane_call_results).toEqual(expect.arrayContaining([
        expect.objectContaining({
          ok: true,
          capability: CAPABILITY,
          delegated_capability_id: CAPABILITY,
          delegation_status: "gateway_executed",
          resolved_source_ref: resolvedSourceRef,
          resolved_text_hash: resolvedTextHash,
          semantic_prompt_source: "chat_history",
          semantic_prompt_argument_source: "helix_resolved_referent",
          runtime_prompt_differed_from_bound_semantic_prompt: true,
          reentry_required: true,
          terminal_eligible: false,
          assistant_answer: false,
          observation: expect.objectContaining({
            capability_key: CAPABILITY,
            status: "succeeded",
            prompt: priorAnswer,
          }),
        }),
      ]));
      expect(debug.capability_lane_observation_packets).toEqual(expect.arrayContaining([
        expect.objectContaining({
          capability_key: CAPABILITY,
          status: "succeeded",
          terminal_eligible: false,
          post_tool_model_step_required: true,
          assistant_answer: false,
        }),
      ]));
      expect(debug.capability_lane_turn_timeline).toEqual(expect.arrayContaining([
        expect.objectContaining({
          stage: "lane_requested",
          capability_id: CAPABILITY,
          lane_requested: true,
        }),
        expect.objectContaining({
          stage: "lane_reentered",
          capability_id: CAPABILITY,
          observation_reentered: true,
        }),
      ]));
      expect(debug.provider_reasoning_reentry).toMatchObject({
        status: "completed",
        capability_lane_observation_packet_count: 1,
        evidence_reentered: true,
      });
      expect(debug.workstation_gateway_call_results).toEqual(expect.arrayContaining([
        expect.objectContaining({
          ok: true,
          capability_id: CAPABILITY,
        }),
      ]));
      expect(debug.normalized_provider_observation_artifacts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: "helix_theory_context_reflection_tool_receipt",
          capability_key: CAPABILITY,
          status: "succeeded",
        }),
      ]));
      expect(debug.terminal_answer_authority).toMatchObject({
        final_answer_source: "theory_context_reflection_answer",
        terminal_artifact_kind: "theory_context_reflection_answer",
        authority_origin: "theory_context_reflection_answer",
      });
      expect(debug.theory_reflection_receipt_answer).toMatchObject({
        answer_text: finalReflection,
        synthesis_source: "runtime_provider_after_theory_observation_reentry",
      });

      expect(initialPrompt).toContain(`request ${CAPABILITY}`);
      expect(initialPrompt).toContain(priorAnswer);
      expect(initialPrompt).toContain(resolvedSourceRef);
      expect(initialPrompt).toContain(resolvedTextHash);
      expect(reentryPrompt).toContain("Helix executed the runtime-requested capability lane call");
      expect(reentryPrompt).toContain(CAPABILITY);
      expect(reentryPrompt).toContain("helix.theory_context_reflection_observation.v1");
      expect(reentryPrompt).toContain(semanticTopic);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 20_000);

  it("uses the Helix-bound superconductivity referent when the runtime omits referent fields", async () => {
    const priorAnswer = [
      "Electron-phonon attraction supports Cooper pairing, a BCS gap, collective phase coherence, zero DC resistance, and the Meissner response.",
      "Temperature, current density, and magnetic field impose superconducting critical-surface limits through Tc, Jc, and Bc.",
    ].join(" ");
    const resolvedSourceRef = "chat.final_answer.previous:reply-superconductivity";
    const resolvedTextHash = crypto.createHash("sha256").update(priorAnswer).digest("hex").slice(0, 16);
    const finalReflection =
      "The re-entered graph observation locates the superconducting critical surface while keeping the microscopic mechanism claim bounded.";

    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        `HELIX_CAPABILITY_LANE_REQUEST_JSON: ${JSON.stringify({
          capability: CAPABILITY,
          prompt: "A generic superconductivity reflection supplied by the runtime.",
          conversation_context: "can you reflect this in theory badge graph?",
          build_explanation_plan: true,
        })}`,
        finalReflection,
      ],
    });
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "turn-codex-theory-helix-bound-superconductivity",
        question: "can you reflect this in theory badge graph?",
        workspace_context_snapshot: {
          chat_referent_context: {
            schema: "helix.ask.chat_referent_context.v1",
            previous_assistant_final_answer: {
              role: "assistant",
              reply_id: "reply-superconductivity",
              source_ref: resolvedSourceRef,
              text: priorAnswer,
              text_hash: resolvedTextHash,
            },
          },
        },
      },
    });
    const debug = result.debug as Record<string, any>;

    expect(result).toMatchObject({
      ok: true,
      answer: finalReflection,
      final_answer_source: "theory_context_reflection_answer",
      terminal_artifact_kind: "theory_context_reflection_answer",
    });
    expect(debug.conversational_referent_resolution).toMatchObject({
      referent_detected: true,
      resolved_source_ref: resolvedSourceRef,
      resolved_text_hash: resolvedTextHash,
      resolution_confidence: "high",
    });
    expect(debug.capability_lane_call_results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ok: true,
        capability: CAPABILITY,
        resolved_source_ref: resolvedSourceRef,
        resolved_text_hash: resolvedTextHash,
        semantic_prompt_source: "chat_history",
        semantic_prompt_argument_source: "helix_resolved_referent",
        runtime_prompt_differed_from_bound_semantic_prompt: true,
        observation: expect.objectContaining({
          prompt: priorAnswer,
          exact_badge_ids: expect.arrayContaining([
            "low_temp.superconductivity.zero_dc_resistance_bounds",
          ]),
        }),
      }),
    ]));
  }, 20_000);

  it("asks for the missing theory referent without fabricating a graph call", async () => {
    delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "Which preceding idea should I reflect with the Theory Badge Graph? Please restate the subject.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "turn-codex-theory-referent-missing",
        question: "Reflect this with the Theory Badge Graph.",
      },
    });
    const debug = result.debug as Record<string, any>;

    expect(result).toMatchObject({
      ok: false,
      response_type: "final_failure",
      terminal_artifact_kind: "typed_failure",
      terminal_error_code: "referent_resolution_required",
    });
    expect(result.answer).toContain("Which preceding idea");
    expect(debug.conversational_referent_resolution).toMatchObject({
      schema: "helix.ask.conversational_referent_resolution.v1",
      referent_detected: true,
      referent_phrase: "deictic_previous_assistant_answer",
      resolution_confidence: "blocked",
      resolution_block_reason: "referent_resolution_required:missing_previous_assistant_final_answer",
    });
    expect(debug.runtime_lane_request_retry).toBeNull();
    expect(debug.runtime_lane_request_loop).toBeNull();
    expect(debug.workstation_gateway_call_results).toEqual([]);
    expect(debug.capability_lane_call_results).toEqual([]);
  }, 20_000);

  it("replaces a model guess with a bounded clarification when the theory referent is missing", async () => {
    delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "The prior idea definitely maps to deterministic chaos and entropy.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "turn-codex-theory-referent-missing-guess",
        question: "Reflect this with the Theory Badge Graph.",
      },
    });
    const debug = result.debug as Record<string, any>;

    expect(result).toMatchObject({
      ok: false,
      response_type: "final_failure",
      terminal_artifact_kind: "typed_failure",
      terminal_error_code: "referent_resolution_required",
    });
    expect(result.answer).toContain("cannot resolve what “this” refers to");
    expect(result.answer).toContain("Please restate the idea");
    expect(result.answer).not.toContain("definitely maps");
    expect(debug.workstation_gateway_call_results).toEqual([]);
    expect(debug.capability_lane_call_results).toEqual([]);
  }, 20_000);

  it("does not reflect a prior failed theory response when no substantive antecedent remains", async () => {
    delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
    delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "The previous text probably maps to proxy-model and stabilized-trace badges.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "turn-codex-theory-referent-failure-only",
        question: "Reflect this with the Theory Badge Graph.",
        workspace_context_snapshot: {
          chat_referent_context: {
            schema: "helix.ask.chat_referent_context.v1",
            previous_assistant_final_answer: {
              role: "assistant",
              reply_id: "failed-theory-reflection",
              source_ref: "chat.final_answer.previous:failed-theory-reflection",
              text: "The Theory Badge Graph could not resolve this and found no exact or likely badge matches.",
            },
          },
        },
      },
    });
    const debug = result.debug as Record<string, any>;

    expect(result).toMatchObject({
      ok: false,
      response_type: "final_failure",
      terminal_artifact_kind: "typed_failure",
      terminal_error_code: "referent_resolution_required",
    });
    expect(result.answer).toContain("Please restate the idea");
    expect(result.answer).not.toContain("proxy-model");
    expect(debug.conversational_referent_resolution).toMatchObject({
      resolution_confidence: "blocked",
      resolution_block_reason: "referent_resolution_required:no_substantive_previous_assistant_final_answer",
      selection_policy: "blocked_non_substantive_history",
    });
    expect(debug.workstation_gateway_call_results).toEqual([]);
    expect(debug.capability_lane_call_results).toEqual([]);
  }, 20_000);
});
