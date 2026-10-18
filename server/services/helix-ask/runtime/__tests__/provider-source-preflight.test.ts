import { beforeEach, describe, expect, it } from "vitest";
import { buildAskTurnSolverTrace } from "../../ask-turn-solver";
import { buildLoopParityTrace } from "../../loop-parity-trace";
import {
  codexProvider,
  ensureCodexPreGatewayRouteAuthority,
} from "../../agent-providers/codex-provider";
import {
  createLiveAnswerEnvironment,
  resetLiveAnswerEnvironments,
} from "../../../situation-room/live-answer-environment-store";
import {
  ensureLiveSituationRunForEnvironment,
  resetLiveSituationRunsForTest,
} from "../../../situation-room/live-situation-run-store";
import {
  appendObservationJournalEntry,
  resetObservationJournalForTest,
} from "../../../situation-room/observation-journal-store";
import { maybeBuildHelixProviderProcedureMemoryPreflightTerminalPayload } from "../provider-source-preflight";

describe("provider source preflight", () => {
  beforeEach(() => {
    resetLiveAnswerEnvironments();
    resetLiveSituationRunsForTest();
    resetObservationJournalForTest();
  });

  it("terminalizes unavailable hard procedure memory before provider sampling", () => {
    const turnId = "ask:test:procedure-memory-provider-preflight";
    const result =
      maybeBuildHelixProviderProcedureMemoryPreflightTerminalPayload({
        turnId,
        body: {
          turn_id: turnId,
          sessionId: "thread:procedure-memory-provider-preflight",
          question: "What does procedure memory say about the last scene?",
          source_target_intent: {
            schema: "helix.ask_source_target_intent.v1",
            turn_id: turnId,
            thread_id: "thread:procedure-memory-provider-preflight",
            target_source: "procedure_memory",
            target_kind: "procedure_memory",
            strength: "hard",
          },
        },
      });

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      terminal_artifact_kind: "typed_failure",
      terminal_error_code: "procedure_memory_unavailable",
      final_answer_source: "typed_failure",
      source_target_intent: {
        target_source: "procedure_memory",
        strength: "hard",
      },
      typed_failure: {
        error_code: "procedure_memory_unavailable",
        missing_evidence: expect.arrayContaining([
          "active_situation_run",
          "procedure_memory",
        ]),
        next_required_action: "repair_procedure_memory",
      },
    });
    expect(String(result?.selected_final_answer)).toContain(
      "no_active_situation_run",
    );
    expect(result?.ask_turn_solver_trace).toMatchObject({
      first_broken_rail: "observation",
      terminal_artifact_kind: "typed_failure",
      terminal_error_code: "procedure_memory_unavailable",
    });
    expect(result?.canonical_goal_frame).toMatchObject({
      deterministic_preflight_terminal: true,
    });
    expect(result?.route_authority_audit).toMatchObject({
      selected_route: "procedure_memory_preflight",
      route_authority_ok: true,
      terminal_artifact_kind: "typed_failure",
    });

    const loopTrace = buildLoopParityTrace({
      turnId,
      promptText: "What does procedure memory say about the last scene?",
      selectedRoute: "procedure_memory_preflight",
      terminalArtifactKind: "typed_failure",
      finalAnswerSource: "typed_failure",
      payload: result!,
    });
    expect(loopTrace.short_circuit_risk_flags).not.toContain(
      "route_authority_missing",
    );
    expect(loopTrace.short_circuit_risk_flags).not.toContain(
      "terminal_selected_before_observation_finalizer",
    );

    const solverTrace = buildAskTurnSolverTrace({
      turnId,
      promptText: "What does procedure memory say about the last scene?",
      selectedRoute: "procedure_memory_preflight",
      terminalArtifactKind: "typed_failure",
      finalAnswerSource: "typed_failure",
      payload: result!,
      loopParityTrace: loopTrace,
    });
    expect(solverTrace.followup_reasoning_gate).toMatchObject({
      required: false,
      completed: true,
      reason: "deterministic_preflight_terminal",
    });
    expect(solverTrace.solver_risk_flags).not.toContain(
      "missing_followup_reasoning",
    );
  });

  it("preserves a missing-previous-epoch diagnosis and repair action", () => {
    const threadId = "thread:procedure-epoch-provider-preflight";
    const now = new Date().toISOString();
    const { environment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "ask:test:procedure-epoch-seed",
      objective: "Compare the current visual epoch with the previous epoch.",
      preset: "custom",
      source_ids: ["visual_source:provider-preflight"],
      now,
    });
    ensureLiveSituationRunForEnvironment({
      environment,
      advanceEpoch: false,
      now,
    });
    appendObservationJournalEntry({
      thread_id: threadId,
      observation_id: "observation:provider-preflight-current",
      kind: "model_perception_observation",
      modality: "visual_frame",
      source_id: "visual_source:provider-preflight",
      text: "The current workstation view is available.",
      evidence_refs: ["live_source_analysis_job:provider-preflight"],
      model_invoked: true,
      confidence: 0.8,
      created_at: now,
    });
    const turnId = "ask:test:procedure-epoch-provider-preflight";
    const result =
      maybeBuildHelixProviderProcedureMemoryPreflightTerminalPayload({
        turnId,
        body: {
          turn_id: turnId,
          sessionId: threadId,
          question:
            "What changed since the previous visual capture, and was the 10 second interval running?",
          source_target_intent: {
            schema: "helix.ask_source_target_intent.v1",
            turn_id: turnId,
            thread_id: threadId,
            target_source: "procedure_memory",
            target_kind: "situation_epoch",
            strength: "hard",
          },
        },
      });

    expect(result).toMatchObject({
      terminal_artifact_kind: "typed_failure",
      terminal_error_code: "procedure_epoch_previous_unavailable",
      typed_failure: {
        error_code: "procedure_epoch_previous_unavailable",
        blocking_reason: "previous_visual_observation_unavailable",
        next_required_action: "wait_for_scene_memory_index",
      },
      canonical_goal_frame: {
        goal_kind: "procedure_epoch_replay_question",
        required_terminal_kind: "procedure_epoch_replay",
      },
      route_authority_audit: {
        target_kind: "situation_epoch",
      },
    });
    expect(String(result?.selected_final_answer)).toContain(
      "wait_for_scene_memory_index",
    );
    expect(String(result?.selected_final_answer)).not.toContain(
      "no_active_situation_run",
    );
  });

  it("materializes the hard procedure-epoch source before provider preflight", () => {
    const turnId = "ask:test:procedure-epoch-authority-materialization";
    const body: Record<string, unknown> = {
      turn_id: turnId,
      sessionId: "thread:procedure-epoch-authority-materialization",
      question:
        "What changed since the previous visual capture, and was the 10 second interval running?",
    };

    ensureCodexPreGatewayRouteAuthority({
      body,
      turnId,
      selectedRoute: "/ask/turn",
    });

    expect(body.source_target_intent).toMatchObject({
      target_source: "procedure_memory",
      target_kind: "situation_epoch",
      strength: "hard",
    });
  });

  it("stops provider-direct Ask before model sampling when procedure memory is unavailable", async () => {
    const turnId = "ask:test:provider-direct-procedure-memory-preflight";
    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask",
      body: {
        turn_id: turnId,
        question: "What does procedure memory say about the last scene?",
        source_target_intent: {
          schema: "helix.ask_source_target_intent.v1",
          turn_id: turnId,
          thread_id: "thread:provider-direct-preflight",
          target_source: "procedure_memory",
          target_kind: "procedure_memory",
          strength: "hard",
        },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      runtime: "codex",
      response_type: "final_failure",
      final_status: "final_failure",
      terminal_artifact_kind: "typed_failure",
      terminal_error_code: "procedure_memory_unavailable",
      debug: {
        private_runtime_loop_entered: false,
      },
    });
  });

  it.each([
    "Do not inspect procedure memory; explain the phrase.",
    "Yesterday I asked about procedure memory.",
    "Later we may inspect procedure memory.",
    "The screen says 'inspect procedure memory'.",
  ])("does not terminalize non-authoritative procedure-memory text: %s", (question) => {
    expect(
      maybeBuildHelixProviderProcedureMemoryPreflightTerminalPayload({
        turnId: `ask:test:contextual:${question.length}`,
        body: { question },
      }),
    ).toBeNull();
  });
});
