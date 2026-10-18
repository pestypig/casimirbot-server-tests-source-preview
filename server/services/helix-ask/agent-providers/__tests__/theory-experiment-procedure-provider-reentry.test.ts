import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  resetAccountSessionStore,
  signInLocalAccountSession,
} from "../../../helix-account/account-session-store";
import { codexProvider } from "../codex-provider";

const originalFakeStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
const originalFakeStdoutSequence = process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
const originalFakeCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
const originalFakeExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;

const restoreEnv = (): void => {
  if (originalFakeStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
  else process.env.CODEX_AGENT_FAKE_STDOUT = originalFakeStdout;
  if (originalFakeStdoutSequence === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE;
  else process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = originalFakeStdoutSequence;
  if (originalFakeCallIndex === undefined) delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
  else process.env.CODEX_AGENT_FAKE_CALL_INDEX = originalFakeCallIndex;
  if (originalFakeExitCode === undefined) delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
  else process.env.CODEX_AGENT_FAKE_EXIT_CODE = originalFakeExitCode;
};

describe("theory experiment procedure provider lifecycle", () => {
  beforeEach(async () => {
    await resetAccountSessionStore();
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
  });

  afterEach(() => {
    restoreEnv();
  });

  it("re-enters the seven-stage observation before Codex authors a bounded answer", async () => {
    const accountReceipt = await signInLocalAccountSession({
      profile_id: "profile:theory-procedure-provider",
      account_type: "developer",
    });
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        [
          "HELIX_CAPABILITY_LANE_REQUEST_JSON:",
          JSON.stringify({
            capability: "theory-experiment-procedure.prepare",
            prompt: "Compare the Stage 3 evidence-map theory from first principles.",
            operation: "compare",
            target: "Stage 3 evidence map",
            selected_badge_ids: ["study.casimir_dp.evidence_map_stage3"],
            lanyon_requested: true,
            lanyon_case_id: "advection_diffusion_full_1d",
            assistant_answer: false,
            terminal_eligible: false,
          }),
        ].join(" "),
        "The seven-stage procedure is prepared, not executed. Dependency order and scale checkpoints are separate, and the observation still requires semantic, boundary-condition, formal, numerical, and empirical closure before any scientific claim can be promoted.",
      ],
    });

    const body: Record<string, unknown> = {
      turn_id: "ask:test:theory-procedure-provider-reentry",
      thread_id: "thread:test:theory-procedure-provider-reentry",
      agent_runtime: "codex",
      question:
        "Use the theory experiment procedure to compare the Stage 3 evidence-map badge with the registered one-dimensional Lanyon advection-diffusion case. Prepare only; explain the missing closure after the tool observation re-enters.",
    };
    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body,
      headers: {
        cookie: `helix_session=${accountReceipt.session?.session_id ?? ""}`,
      },
    });

    const debug = result.debug as Record<string, any>;
    const gatewayResult = (debug.workstation_gateway_call_results ?? [])
      .find((entry: Record<string, unknown>) =>
        entry.capability_id === "theory-experiment-procedure.prepare"
      );
    expect(gatewayResult).toMatchObject({
      ok: true,
      capability_id: "theory-experiment-procedure.prepare",
      observation: {
        schema: "casimir.theory_experiment_procedure.observation.v1",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        procedure: {
          stages: expect.any(Array),
          authority: {
            preparesProcedureOnly: true,
            executesTools: false,
            terminalEligible: false,
          },
        },
      },
    });
    expect(gatewayResult.observation.procedure.stages).toHaveLength(7);
    expect(debug.provider_observation_normalization_failures ?? []).not.toContain(
      "provider_observation_normalization_missing:theory-experiment-procedure.prepare",
    );
    expect(debug.current_turn_artifact_ledger).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "theory_experiment_procedure_observation",
        payload_schema: "casimir.theory_experiment_procedure.observation.v1",
        capability_key: "theory-experiment-procedure.prepare",
        terminal_eligible: false,
        assistant_answer: false,
      }),
    ]));
    expect(body.capability_itinerary).toMatchObject({
      schema: "helix.capability_itinerary.v1",
      source: "codex_provider_pre_gateway_exact_admission",
      terminal_success_criteria: {
        required_capabilities: ["theory-experiment-procedure.prepare"],
      },
      compound_capability_contract: {
        subgoals: [
          expect.objectContaining({
            requested_capability: "theory-experiment-procedure.prepare",
            required_observation_kinds: [
              "theory_experiment_procedure_observation",
            ],
          }),
        ],
      },
    });
    expect(result.capability_itinerary).toEqual(body.capability_itinerary);
    expect(debug.capability_itinerary).toEqual(body.capability_itinerary);
    expect(debug.provider_terminal_authority_bridge).toMatchObject({
      schema: "helix.provider_terminal_authority_bridge.v1",
      evidence_reentry_required: true,
      normalized_observations_ready: true,
      all_gateway_calls_succeeded: true,
      all_observations_succeeded: true,
      solver_completed: true,
      goal_satisfaction_compatible: true,
      terminal_authority_granted: true,
      final_visible_answer_authorized: true,
    });
    expect(
      debug.provider_terminal_authority_bridge.normalized_observation_refs,
    ).toEqual(expect.arrayContaining([
      expect.stringContaining(
        "codex_normalized:theory_experiment_procedure_observation",
      ),
    ]));
    expect(body.capability_itinerary).toMatchObject({
      compound_capability_contract: {
        subgoals: [
          expect.objectContaining({
            args_hint: expect.objectContaining({
              selected_badge_ids: [
                expect.stringContaining(
                  "bind from current-turn registered Theory Badge selection",
                ),
              ],
            }),
          }),
        ],
      },
      execution_state: {
        complete: true,
        missing_required_capabilities: [],
        compound_subgoal_ledger: [
          expect.objectContaining({
            executed_capability: "theory-experiment-procedure.prepare",
            args_source: "contract_hint_reconciled_with_observation",
            selected_args: expect.objectContaining({
              selected_badge_ids: [
                "study.casimir_dp.evidence_map_stage3",
              ],
            }),
            satisfaction: "satisfied",
          }),
        ],
      },
    });
    expect(debug.terminal_answer_authority).toMatchObject({
      terminal_artifact_kind: "model_synthesized_answer",
      server_authoritative: true,
      terminal_eligible: true,
      single_writer_synchronized: true,
    });
    expect(debug.terminal_presentation).toMatchObject({
      terminal_artifact_kind: "model_synthesized_answer",
      selected_observation_refs: expect.arrayContaining([
        expect.stringContaining(
          "codex_normalized:theory_experiment_procedure_observation",
        ),
      ]),
    });
    expect(result).toMatchObject({
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
    });
    expect(result.text).toContain("prepared, not executed");
    expect(result.turn_transcript_events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source_event_type: "tool_observation",
        capability_id: "theory-experiment-procedure.prepare",
        assistant_answer: false,
      }),
      expect.objectContaining({
        source_event_type: "model_reentry",
      }),
    ]));
  });

  it.each([
    "Do not call theory-experiment-procedure.prepare; just explain what the label means.",
    "Later we may call theory-experiment-procedure.prepare after review.",
    "The screen says \"theory-experiment-procedure.prepare\" is available.",
    "Yesterday the agent called theory-experiment-procedure.prepare.",
    "The architecture discussion uses theory-experiment-procedure.prepare as an example of a non-terminal evidence tool; explain that boundary.",
    "Explain which scientific requirements are still missing from the comparison; my notes also mention theory-experiment-procedure.prepare as a possible later step.",
  ])("does not execute for contextual or negated text: %s", async (question) => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "No procedure tool was requested or executed in this turn.";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: `ask:test:theory-procedure-non-admission:${question.length}`,
        agent_runtime: "codex",
        question,
      },
      headers: {},
    });

    expect(
      (result.debug as Record<string, any>).workstation_gateway_call_results ?? [],
    ).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability_id: "theory-experiment-procedure.prepare",
        ok: true,
      }),
    ]));
  });
});
