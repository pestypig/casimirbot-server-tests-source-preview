import { describe, expect, it } from "vitest";
import {
  buildStagePlayBadgeGraphV1,
  buildStagePlayBadgeGraphSummaryV1,
  validateStagePlayBadgeGraphV1,
  type StagePlayBadgeGraphV1,
  type StagePlayBadgeV1,
} from "@shared/contracts/stage-play-badge-graph.v1";
import type { LiveAnswerEnvironment } from "@shared/helix-live-answer-environment";
import {
  reduceStagePlayAnswerSnapshot,
  type AskTurnDebugExport,
} from "../services/stage-play/stage-play-answer-snapshot-reducer";

const badge = (overrides: Partial<StagePlayBadgeV1>): StagePlayBadgeV1 => ({
  id: overrides.id ?? "observer.live_sources",
  title: overrides.title ?? "observer",
  plainMeaning: overrides.plainMeaning ?? "Fixture badge.",
  whyItMatters: overrides.whyItMatters ?? "Fixture badge for reducer tests.",
  kind: overrides.kind ?? "observer",
  status: overrides.status ?? "observed",
  subjects: overrides.subjects ?? [],
  tags: overrides.tags ?? ["fixture"],
  liveBindings: overrides.liveBindings ?? [],
  sourceRefs: overrides.sourceRefs ?? [{ kind: "synthetic_evidence", id: "fixture:evidence" }],
  evidenceRefs: overrides.evidenceRefs ?? ["fixture:evidence"],
  confidence: overrides.confidence ?? 0.8,
  missingEvidence: overrides.missingEvidence ?? [],
  reasonCodes: overrides.reasonCodes ?? ["fixture"],
  dataTray: overrides.dataTray,
  checkpoint: overrides.checkpoint,
  output: overrides.output,
  intentModule: overrides.intentModule,
  admission: overrides.admission ?? "auto",
});

const graphFixture = (): StagePlayBadgeGraphV1 =>
  buildStagePlayBadgeGraphV1({
    graphId: "stage_play_badge_graph:test-answer-snapshot",
    title: "Stage Play answer snapshot fixture",
    description: "Fixture graph for answer snapshot reducer tests.",
    generatedAt: "2026-06-03T12:00:00.000Z",
    sourceWindow: {
      threadId: "thread:stage-answer",
      roomId: "room:stage-answer",
      environmentId: "env:stage-answer",
      latestObservationRefs: ["live_source_observation:stage-answer"],
      latestSourceDescriptorRefs: ["live_source_descriptor:visual"],
      latestSourceProducerRefs: ["live_source_producer:visual"],
      latestRawSessionBufferRefs: [],
      latestSnapshotRefs: ["environment_snapshot:stage-answer"],
      latestDeltaOverlayRefs: [],
      latestNavigationRefs: [],
      freshness: "fresh",
      sources: [{
        sourceId: "source:visual",
        modality: "visual_frame",
        status: "active",
        contribution: "Visual tab frames.",
        fidelityScore: 0.82,
        selectedForStagePlay: true,
        routeTo: "narrative_stage_play",
        cadenceMs: 10000,
        lastEventTs: "2026-06-03T12:00:00.000Z",
        evidenceRefs: ["live_source_observation:stage-answer"],
      }],
    },
    badges: [
      badge({ id: "observer.live_sources", title: "observer", kind: "observer" }),
      badge({ id: "stage_interpretation.current", title: "stage interpretation", kind: "stage_interpretation" }),
      badge({ id: "procedural_binding.active", title: "active procedure", kind: "procedural_binding", status: "candidate" }),
    ],
    edges: [],
    recommendedActions: [],
  });

const liveAnswerEnvironmentFixture = (): LiveAnswerEnvironment => ({
  schema: "helix.live_answer_environment.v1",
  environment_id: "live_answer_environment:stage-answer",
  thread_id: "thread:stage-answer",
  created_turn_id: "ask:turn:stage-answer",
  objective: "Explain the current Stage Play checkpoint.",
  preset: "custom",
  room_id: "room:stage-answer",
  source_ids: ["source:visual"],
  graph_id: "stage_play_badge_graph:test-answer-snapshot",
  status: "active",
  mode: "text_only",
  line_schema: [],
  lines: [],
  subgoals: [],
  latest_summary: "",
  evidence_refs: ["live_answer_environment:stage-answer"],
  created_at: "2026-06-03T12:00:00.000Z",
  updated_at: "2026-06-03T12:00:00.000Z",
  context_policy: "compact_context_pack_only",
  raw_logs_included: false,
  raw_transcript_included: false,
  raw_audio_included: false,
  deterministic_content_role: "observation_not_assistant_answer",
  context_role: "observation_not_assistant_answer",
  terminal_eligible: false,
  post_tool_model_step_required: true,
  assistant_answer: false,
  raw_content_included: false,
});

const completedDebugExport = (overrides: Partial<AskTurnDebugExport> = {}): AskTurnDebugExport => ({
  schema: "helix.ask.debug_export.v1",
  active_turn_id: "ask:turn:stage-answer",
  backend_turn_id: "ask:turn:stage-answer",
  selected_final_answer: "The safe interpretation is to keep observing the source and avoid treating the projection as final guidance.",
  final_answer_source: "final_answer_draft",
  terminal_artifact_kind: "model_synthesized_answer",
  ask_turn_solver_trace: {
    schema: "helix.ask_turn_solver_trace.v1",
    trace_id: "ask-turn-solver:stage-answer",
    turn_id: "ask:turn:stage-answer",
    completed_solver_path: true,
    final_arbitration: {
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
    },
  },
  terminal_answer_authority: {
    terminal_artifact_kind: "model_synthesized_answer",
    final_answer_source: "final_answer_draft",
  },
  current_turn_artifact_ledger: [{
    kind: "live_environment_tool_observation",
    artifact_id: "ask:turn:stage-answer:live_environment_tool_observation:1",
    payload: {
      schema: "helix.live_environment_tool_observation.v1",
      observation_id: "live_environment_tool_observation:stage-answer",
    },
  }],
  ...overrides,
});

describe("Stage Play answer snapshot reducer", () => {
  it("creates answer and live output badges from a completed model-authored Ask checkpoint", () => {
    const graph = graphFixture();
    const result = reduceStagePlayAnswerSnapshot({
      graph,
      askTurnDebug: completedDebugExport(),
      liveAnswerEnvironment: liveAnswerEnvironmentFixture(),
      generatedAt: "2026-06-03T12:00:10.000Z",
    });

    expect(result.checkpointBadge).toMatchObject({
      id: "helix_ask.checkpoint.latest",
      kind: "ask_checkpoint",
      status: "observed",
      checkpoint: {
        askTurnId: "ask:turn:stage-answer",
        solverTraceRef: "ask-turn-solver:stage-answer",
        terminalArtifactKind: "model_synthesized_answer",
        finalAnswerSource: "final_answer_draft",
        modelReviewed: true,
      },
    });
    expect(result.answerSnapshotBadge).toMatchObject({
      id: "answer_snapshot.latest",
      kind: "answer_snapshot",
      status: "observed",
      output: {
        lineKey: "answer_snapshot",
        state: "model_reviewed",
        voiceEligible: false,
      },
    });
    expect(result.answerSnapshotBadge?.output?.text).toContain("keep observing the source");
    expect(result.liveOutputBadge).toMatchObject({
      id: "live_output.current",
      kind: "live_output",
      status: "observed",
      output: {
        lineKey: "live_output",
        state: "model_reviewed",
      },
    });
    expect(result.voiceOutputBadge).toBeNull();
    expect(result.missingCheckBadge).toBeNull();
    expect(result.edges.map((edge) => `${edge.from}->${edge.to}`)).toEqual(expect.arrayContaining([
      "procedural_binding.active->helix_ask.checkpoint.latest",
      "helix_ask.checkpoint.latest->answer_snapshot.latest",
      "answer_snapshot.latest->live_output.current",
    ]));
    expect(result.checkpointBadge.evidenceRefs).toEqual(expect.arrayContaining([
      graph.graphId,
      "ask:turn:stage-answer",
      "ask-turn-solver:stage-answer",
      "ask:turn:stage-answer:live_environment_tool_observation:1",
      "live_answer_environment:stage-answer",
    ]));

    const mergedGraph = {
      ...graph,
      badges: [...graph.badges, ...result.badges],
      edges: [...graph.edges, ...result.edges],
      summary: buildStagePlayBadgeGraphSummaryV1(
        [...graph.badges, ...result.badges],
        [...graph.edges, ...result.edges],
      ),
    };
    expect(validateStagePlayBadgeGraphV1(mergedGraph)).toEqual([]);
  });

  it("creates policy-gated voice output only from a reviewed answer snapshot", () => {
    const graph = graphFixture();
    const result = reduceStagePlayAnswerSnapshot({
      graph,
      askTurnDebug: completedDebugExport(),
      liveAnswerEnvironment: liveAnswerEnvironmentFixture(),
      generatedAt: "2026-06-03T12:00:10.000Z",
      voicePolicy: {
        voiceEligible: true,
        evidenceRefs: ["voice_policy:stage-answer"],
        reasonCodes: ["explicit_voice_policy_allowed"],
      },
    });

    expect(result.voiceOutputBadge).toMatchObject({
      id: "voice_output.current",
      kind: "voice_output",
      status: "observed",
      tags: expect.arrayContaining(["voice_policy"]),
      reasonCodes: expect.arrayContaining(["explicit_voice_policy", "voice_cites_answer_snapshot"]),
      evidenceRefs: expect.arrayContaining(["answer_snapshot.latest", "voice_policy:stage-answer"]),
      output: {
        lineKey: "voice_output",
        state: "model_reviewed",
        voiceEligible: true,
        text: expect.stringContaining("keep observing the source"),
      },
    });
    expect(result.edges.map((edge) => `${edge.from}->${edge.to}`)).toContain(
      "answer_snapshot.latest->voice_output.current",
    );

    const mergedGraph = {
      ...graph,
      badges: [...graph.badges, ...result.badges],
      edges: [...graph.edges, ...result.edges],
      summary: buildStagePlayBadgeGraphSummaryV1(
        [...graph.badges, ...result.badges],
        [...graph.edges, ...result.edges],
      ),
    };
    expect(validateStagePlayBadgeGraphV1(mergedGraph)).toEqual([]);
  });

  it("creates a missing-check badge when the solver path is incomplete", () => {
    const result = reduceStagePlayAnswerSnapshot({
      graph: graphFixture(),
      askTurnDebug: completedDebugExport({
        ask_turn_solver_trace: {
          schema: "helix.ask_turn_solver_trace.v1",
          trace_id: "ask-turn-solver:stage-answer",
          turn_id: "ask:turn:stage-answer",
          completed_solver_path: false,
          final_arbitration: {
            terminal_artifact_kind: "model_synthesized_answer",
            final_answer_source: "final_answer_draft",
          },
        },
      }),
    });

    expect(result.checkpointBadge.status).toBe("missing_evidence");
    expect(result.checkpointBadge.checkpoint?.modelReviewed).toBe(false);
    expect(result.answerSnapshotBadge).toBeNull();
    expect(result.liveOutputBadge).toBeNull();
    expect(result.voiceOutputBadge).toBeNull();
    expect(result.missingCheckBadge).toMatchObject({
      id: "answer_snapshot.missing_check",
      kind: "missing_evidence",
      status: "missing_evidence",
      reasonCodes: expect.arrayContaining(["solver_path_missing"]),
    });
    expect(result.edges.map((edge) => edge.relation)).toContain("needs_check");
  });

  it("does not create an answer snapshot when checkpoint freshness fails", () => {
    const result = reduceStagePlayAnswerSnapshot({
      graph: graphFixture(),
      askTurnDebug: completedDebugExport(),
      liveAnswerEnvironment: {
        ...liveAnswerEnvironmentFixture(),
        graph_id: "stage_play_badge_graph:older-source-window",
      },
      generatedAt: "2026-06-03T12:00:10.000Z",
    });

    expect(result.checkpointBadge).toMatchObject({
      status: "missing_evidence",
      checkpoint: expect.objectContaining({
        modelReviewed: false,
      }),
      reasonCodes: expect.arrayContaining(["checkpoint_freshness_graph_id_mismatch"]),
      dataTray: expect.objectContaining({
        summary: "No current model-reviewed checkpoint.",
      }),
    });
    expect(result.answerSnapshotBadge).toBeNull();
    expect(result.liveOutputBadge).toBeNull();
    expect(result.missingCheckBadge).toMatchObject({
      reasonCodes: expect.arrayContaining(["checkpoint_freshness_graph_id_mismatch"]),
      dataTray: expect.objectContaining({
        summary: "No current model-reviewed checkpoint.",
      }),
    });
  });

  it("does not create an answer snapshot from a completed receipt terminal artifact", () => {
    const result = reduceStagePlayAnswerSnapshot({
      graph: graphFixture(),
      askTurnDebug: completedDebugExport({
        terminal_artifact_kind: "live_pipeline_receipt",
        final_answer_source: "live_pipeline_receipt",
        ask_turn_solver_trace: {
          schema: "helix.ask_turn_solver_trace.v1",
          trace_id: "ask-turn-solver:stage-answer",
          turn_id: "ask:turn:stage-answer",
          completed_solver_path: true,
          final_arbitration: {
            terminal_artifact_kind: "live_pipeline_receipt",
            final_answer_source: "live_pipeline_receipt",
          },
        },
      }),
    });

    expect(result.checkpointBadge.checkpoint).toMatchObject({
      terminalArtifactKind: "live_pipeline_receipt",
      finalAnswerSource: "live_pipeline_receipt",
      modelReviewed: false,
    });
    expect(result.answerSnapshotBadge).toBeNull();
    expect(result.liveOutputBadge).toBeNull();
    expect(result.missingCheckBadge?.reasonCodes).toEqual(expect.arrayContaining([
      "solver_path_completed",
      "model_authored_terminal_missing",
    ]));
  });

  it("does not create an answer snapshot from deterministic Stage Play receipt fallback text", () => {
    const result = reduceStagePlayAnswerSnapshot({
      graph: graphFixture(),
      askTurnDebug: completedDebugExport({
        selected_final_answer:
          "Stage Play tool receipt: live_env.reflect_stage_play_context; graph stage_play_badge_graph:test; visual source status: active.",
      }),
      liveAnswerEnvironment: liveAnswerEnvironmentFixture(),
      generatedAt: "2026-06-03T12:00:10.000Z",
    });

    expect(result.checkpointBadge.checkpoint).toMatchObject({
      terminalArtifactKind: "model_synthesized_answer",
      finalAnswerSource: "final_answer_draft",
      modelReviewed: false,
    });
    expect(result.answerSnapshotBadge).toBeNull();
    expect(result.liveOutputBadge).toBeNull();
    expect(result.missingCheckBadge?.missingEvidence).toEqual(expect.arrayContaining([
      "Deterministic Stage Play receipt fallback is not an answer snapshot.",
    ]));
    expect(result.missingCheckBadge?.reasonCodes).toEqual(expect.arrayContaining([
      "receipt_fallback_text_rejected",
      "answer_text_missing",
    ]));
  });
});
