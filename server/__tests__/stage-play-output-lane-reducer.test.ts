import { beforeEach, describe, expect, it } from "vitest";
import {
  buildStagePlayBadgeGraphV1,
  type StagePlayBadgeGraphV1,
  type StagePlayBadgeV1,
} from "../../shared/contracts/stage-play-badge-graph.v1";
import {
  buildStagePlayLiveAnswerLineValuesV1,
  buildStagePlayOutputLaneProjectionV1,
  checkpointOnlySkippedLineKeysForStagePlayProjection,
  CHECKPOINT_ONLY_LINE_KEYS,
  DETERMINISTIC_STAGE_PLAY_LINE_KEYS,
  reduceLiveAnswerEnvironmentFromStagePlayGraph,
  STAGE_PLAY_LIVE_ANSWER_LINE_SCHEMA,
} from "../services/stage-play/stage-play-output-lane-reducer";
import {
  createLiveAnswerEnvironment,
  resetLiveAnswerEnvironments,
} from "../services/situation-room/live-answer-environment-store";

const sourceWindow: StagePlayBadgeGraphV1["sourceWindow"] = {
  threadId: "thread:stage-output",
  roomId: "room:stage-output",
  worldId: null,
  environmentId: "live_answer:stage-output",
  fromTs: "2026-06-02T12:30:00.000Z",
  toTs: "2026-06-02T12:30:10.000Z",
  latestObservationRefs: ["live_source_observation:stage-output"],
  latestSourceDescriptorRefs: ["live_source_descriptor:minecraft"],
  latestSourceProducerRefs: ["live_source_producer:minecraft"],
  latestRawSessionBufferRefs: [],
  sources: [
    {
      sourceId: "source:minecraft",
      modality: "world_event",
      status: "active",
      contribution: "Minecraft world events feed Stage Play.",
      fidelityScore: 0.9,
      selectedForStagePlay: true,
      routeTo: "world_stage_play",
      cadenceMs: 1000,
      lastEventTs: "2026-06-02T12:30:10.000Z",
      missingReason: null,
      nextRequiredAction: null,
      evidenceRefs: ["live_source_descriptor:minecraft", "live_source_producer:minecraft"],
    },
  ],
  latestSnapshotRefs: ["environment_snapshot:stage-output"],
  latestDeltaOverlayRefs: ["world_delta_overlay:stage-output"],
  latestNavigationRefs: ["navigation_state:stage-output"],
  freshness: "fresh",
};

const badge = (overrides: Partial<StagePlayBadgeV1>): StagePlayBadgeV1 => ({
  id: overrides.id ?? "badge:default",
  title: overrides.title ?? "Default badge",
  plainMeaning: overrides.plainMeaning ?? "Compact stage fact.",
  whyItMatters: overrides.whyItMatters ?? "It bounds the stage.",
  kind: overrides.kind ?? "setting",
  status: overrides.status ?? "observed",
  subjects: overrides.subjects ?? ["player"],
  tags: overrides.tags ?? [],
  liveBindings: overrides.liveBindings ?? [],
  sourceRefs: overrides.sourceRefs ?? [
    { kind: "environment_state_snapshot", id: "environment_snapshot:stage-output" },
  ],
  evidenceRefs: overrides.evidenceRefs ?? ["environment_snapshot:stage-output"],
  confidence: overrides.confidence ?? 0.8,
  missingEvidence: overrides.missingEvidence ?? [],
  reasonCodes: overrides.reasonCodes ?? ["fixture"],
  dataTray: overrides.dataTray,
  checkpoint: overrides.checkpoint,
  output: overrides.output,
  intentModule: overrides.intentModule,
  admission: overrides.admission ?? "auto",
});

const graphFixture = (extraBadges: StagePlayBadgeV1[] = []): StagePlayBadgeGraphV1 =>
  buildStagePlayBadgeGraphV1({
    graphId: "stage_play_badge_graph:stage-output",
    title: "Move safely through a hostile area",
    description: "Compact Stage Play fixture.",
    sourceWindow,
    badges: [
      badge({ id: "setting.overworld", title: "overworld", kind: "setting" }),
      badge({
        id: "actor.player",
        title: "player",
        kind: "actor",
        liveBindings: [
          {
            bindingKind: "actor_pose",
            sourceRefIds: ["environment_snapshot:stage-output"],
            freshness: "fresh",
            confidence: 0.82,
            compactValue: "health=4",
          },
        ],
      }),
      badge({ id: "resource.cobblestone.available", title: "cobblestone available", kind: "resource" }),
      badge({ id: "prop.gateway_block.visible", title: "gateway block visible", kind: "prop" }),
      badge({ id: "affordance.place_block", title: "place block", kind: "affordance", status: "available" }),
      badge({ id: "hazard.low_health", title: "low health", kind: "hazard", status: "observed" }),
      badge({ id: "blocked.engage_close_range", title: "close-range engagement blocked", kind: "blocked_affordance", status: "blocked" }),
      badge({ id: "binding.defensive_retreat_barrier", title: "defensive retreat barrier", kind: "procedural_binding", status: "candidate" }),
      badge({
        id: "missing.threat_distance",
        title: "threat distance missing",
        kind: "missing_evidence",
        status: "missing_evidence",
        missingEvidence: ["exact hostile distance"],
      }),
      badge({ id: "check.observe_threat", title: "observe threat distance", kind: "recommended_check", status: "candidate" }),
      ...extraBadges,
    ],
    edges: [
      {
        id: "edge:risk-blocks",
        from: "hazard.low_health",
        to: "blocked.engage_close_range",
        relation: "blocks",
        label: "low health blocks close range",
        evidenceRefs: ["environment_snapshot:stage-output"],
        reasonCodes: ["fixture"],
      },
      {
        id: "edge:binding-produces",
        from: "affordance.place_block",
        to: "binding.defensive_retreat_barrier",
        relation: "produces",
        label: "place block can compose a barrier",
        evidenceRefs: ["environment_snapshot:stage-output"],
        reasonCodes: ["fixture"],
      },
    ],
    recommendedActions: [
      {
        id: "stage-action:observe-threat",
        label: "Observe threat distance before moving.",
        actionType: "observe_more",
        admission: "auto",
        agentExecutable: false,
        reasonCodes: ["missing_distance"],
        evidenceRefs: ["environment_snapshot:stage-output"],
        missingEvidence: [],
      },
      {
        id: "stage-action:ask-distance",
        label: "Ask user to confirm hostile distance.",
        actionType: "ask_user",
        admission: "ask_user",
        agentExecutable: false,
        reasonCodes: ["missing_distance"],
        evidenceRefs: ["environment_snapshot:stage-output"],
        missingEvidence: ["exact hostile distance"],
      },
      {
        id: "stage-action:engage-close-range",
        label: "Blocked: close-range engagement.",
        actionType: "blocked_move_notice",
        admission: "blocked",
        agentExecutable: false,
        reasonCodes: ["low_health_constraint"],
        evidenceRefs: ["environment_snapshot:stage-output"],
        missingEvidence: [],
      },
    ],
  });

const reviewedOutputBadges = (includeVoicePolicy = false): StagePlayBadgeV1[] => [
  badge({
    id: "helix_ask.checkpoint.latest",
    title: "Helix Ask checkpoint",
    kind: "ask_checkpoint",
    status: "observed",
    confidence: 0.9,
    reasonCodes: ["completed_solver_path"],
    evidenceRefs: ["ask:turn:stage-output", "ask_turn_solver_trace:stage-output"],
    checkpoint: {
      askTurnId: "ask:turn:stage-output",
      solverTraceRef: "ask_turn_solver_trace:stage-output",
      terminalArtifactKind: "model_synthesized_answer",
      finalAnswerSource: "final_answer_draft",
      modelReviewed: true,
    },
  }),
  badge({
    id: "answer_snapshot.latest",
    title: "answer snapshot",
    kind: "answer_snapshot",
    status: "observed",
    confidence: 0.86,
    evidenceRefs: ["ask:turn:stage-output"],
    output: {
      lineKey: "recommendation",
      text: "Use the barrier retreat plan only after checking exact hostile distance.",
      state: "model_reviewed",
      voiceEligible: false,
    },
  }),
  badge({
    id: "voice_output.current",
    title: "voice output",
    kind: "voice_output",
    status: "observed",
    tags: includeVoicePolicy ? ["voice_policy"] : [],
    reasonCodes: includeVoicePolicy ? ["explicit_voice_policy"] : ["model_reviewed_output"],
    confidence: 0.8,
    evidenceRefs: includeVoicePolicy
      ? ["ask:turn:stage-output", "answer_snapshot.latest"]
      : ["ask:turn:stage-output"],
    output: {
      lineKey: "voice_output",
      text: "Check hostile distance before using the barrier retreat plan.",
      state: "model_reviewed",
      voiceEligible: true,
    },
  }),
];

const reviewedOutputBadgesWithHelixCheckpoint = (): StagePlayBadgeV1[] =>
  reviewedOutputBadges(false).map((entry) =>
    entry.id === "helix_ask.checkpoint.latest"
      ? {
          ...entry,
          kind: "helix_ask_checkpoint",
        }
      : entry
  );

beforeEach(() => {
  resetLiveAnswerEnvironments();
});

describe("stage-play output lane reducer", () => {
  it("keeps debug basis in the situation panel line schema", () => {
    expect(STAGE_PLAY_LIVE_ANSWER_LINE_SCHEMA.find((line) =>
      line.key === "debug_basis"
    )?.visibility).toBe("situation_panel");
  });

  it("declares deterministic and checkpoint-only lane boundaries", () => {
    expect(DETERMINISTIC_STAGE_PLAY_LINE_KEYS).toEqual([
      "situation",
      "actor_state",
      "resources",
      "affordances",
      "risk",
      "possibilities",
      "rehearsal",
      "unknowns",
      "next_check",
      "debug_basis",
    ]);
    expect(CHECKPOINT_ONLY_LINE_KEYS).toEqual([
      "recommendation",
      "answer_snapshot",
      "voice_output",
      "final_answer",
    ]);
    expect(checkpointOnlySkippedLineKeysForStagePlayProjection(
      buildStagePlayOutputLaneProjectionV1({ graph: graphFixture() }),
    )).toEqual(expect.arrayContaining([
      "recommendation",
      "answer_snapshot",
    ]));
  });

  it("projects graph state into evidence-only output lanes", () => {
    const graph = graphFixture();
    const projection = buildStagePlayOutputLaneProjectionV1({ graph });
    const laneByKey = Object.fromEntries(projection.lanes.map((lane) => [lane.lineKey, lane]));

    expect(projection).toMatchObject({
      artifactId: "stage_play_output_lane_projection",
      schemaVersion: "stage_play_output_lane_projection/v1",
      graphId: graph.graphId,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
      post_tool_model_step_required: true,
    });
    expect(laneByKey.risk).toMatchObject({
      laneId: "feedback",
      status: "blocked",
      admission: "auto",
      assistant_answer: false,
    });
    expect(laneByKey.risk.supportingBadgeIds).toEqual(expect.arrayContaining([
      "hazard.low_health",
      "blocked.engage_close_range",
    ]));
    expect(laneByKey.possibilities.text).toContain("defensive retreat barrier");
    expect(laneByKey.unknowns).toMatchObject({
      status: "missing_evidence",
      admission: "ask_user",
    });
    expect(laneByKey.next_check.supportingActionIds).toContain("stage-action:observe-threat");
    expect(laneByKey.recommendation).toMatchObject({
      status: "missing_evidence",
      admission: "blocked",
      lineUpdateAllowed: false,
      modelReviewRequired: true,
      assistant_answer: false,
    });
    expect(laneByKey.answer_snapshot).toMatchObject({
      status: "missing_evidence",
      admission: "blocked",
      lineUpdateAllowed: false,
      modelReviewRequired: true,
      assistant_answer: false,
    });
    expect(laneByKey.voice_output).toMatchObject({
      status: "missing_evidence",
      admission: "blocked",
      lineUpdateAllowed: false,
      modelReviewRequired: true,
      assistant_answer: false,
    });
    for (const key of ["situation", "actor_state", "resources", "affordances", "rehearsal", "debug_basis"]) {
      expect(laneByKey[key].lineUpdateAllowed).toBe(false);
    }
    for (const key of ["risk", "possibilities", "unknowns", "next_check"]) {
      expect(laneByKey[key].lineUpdateAllowed).toBe(true);
    }
    for (const lane of projection.lanes) {
      expect(Number.isFinite(lane.confidence)).toBe(true);
      expect(lane.confidence).toBeGreaterThanOrEqual(0);
      expect(lane.confidence).toBeLessThanOrEqual(1);
      expect(lane.assistant_answer).toBe(false);
    }
  });

  it("builds Live Interpretation line values without writing checkpoint-only outputs", () => {
    const projection = buildStagePlayOutputLaneProjectionV1({ graph: graphFixture() });
    const lineValues = buildStagePlayLiveAnswerLineValuesV1(projection);

    expect(lineValues.recommendation).toBeUndefined();
    expect(lineValues.answer_snapshot).toBeUndefined();
    expect(lineValues.voice_output).toBeUndefined();
    expect(lineValues.situation).toBeUndefined();
    expect(lineValues.actor_state).toBeUndefined();
    expect(lineValues.resources).toBeUndefined();
    expect(lineValues.affordances).toBeUndefined();
    expect(lineValues.rehearsal).toBeUndefined();
    expect(lineValues.debug_basis).toBeUndefined();
    expect(lineValues.risk?.value).toContain("close-range engagement blocked");
    expect(lineValues.possibilities?.value).toContain("defensive retreat barrier");
    expect(lineValues.unknowns?.value).toContain("exact hostile distance");
    expect(lineValues.next_check?.value).toContain("Observe threat distance");
    for (const value of Object.values(lineValues)) {
      expect(value.source).toBe("deterministic_reducer");
      expect(value.model_invoked).toBe(false);
      expect(value.deterministic).toBe(true);
    }
  });

  it("does not project checkpoint recommendation or answer snapshot from deterministic interpretation", () => {
    const projection = buildStagePlayOutputLaneProjectionV1({
      graph: graphFixture(reviewedOutputBadges(false)),
    });
    const lineValues = buildStagePlayLiveAnswerLineValuesV1(projection);
    const laneByKey = Object.fromEntries(projection.lanes.map((lane) => [lane.lineKey, lane]));

    expect(laneByKey.recommendation.text).toBe(
      "Use the barrier retreat plan only after checking exact hostile distance.",
    );
    expect(laneByKey.answer_snapshot.text).toBe(
      "Use the barrier retreat plan only after checking exact hostile distance.",
    );
    expect(laneByKey.recommendation).toMatchObject({
      label: "Checkpoint Recommendation",
      lineUpdateAllowed: false,
      modelReviewRequired: true,
    });
    expect(laneByKey.answer_snapshot).toMatchObject({
      label: "Answer Snapshot",
      lineUpdateAllowed: false,
      modelReviewRequired: true,
    });
    expect(lineValues.recommendation).toBeUndefined();
    expect(lineValues.answer_snapshot).toBeUndefined();
    expect(lineValues.voice_output).toBeUndefined();
  });

  it("accepts canonical helix_ask_checkpoint badges as the reviewed checkpoint boundary", () => {
    const projection = buildStagePlayOutputLaneProjectionV1({
      graph: graphFixture(reviewedOutputBadgesWithHelixCheckpoint()),
    });
    const laneByKey = Object.fromEntries(projection.lanes.map((lane) => [lane.lineKey, lane]));

    expect(laneByKey.recommendation).toMatchObject({
      status: "ready",
      admission: "auto",
      text: "Use the barrier retreat plan only after checking exact hostile distance.",
      modelReviewRequired: true,
    });
    expect(laneByKey.answer_snapshot).toMatchObject({
      status: "ready",
      admission: "auto",
      text: "Use the barrier retreat plan only after checking exact hostile distance.",
      modelReviewRequired: true,
    });
    expect(buildStagePlayLiveAnswerLineValuesV1(projection).answer_snapshot).toBeUndefined();
  });

  it("marks reviewed output lanes stale when the source window is stale", () => {
    const projection = buildStagePlayOutputLaneProjectionV1({
      graph: {
        ...graphFixture(reviewedOutputBadgesWithHelixCheckpoint()),
        sourceWindow: {
          ...sourceWindow,
          freshness: "stale",
        },
      },
    });
    const laneByKey = Object.fromEntries(projection.lanes.map((lane) => [lane.lineKey, lane]));

    expect(laneByKey.recommendation).toMatchObject({
      status: "stale",
      admission: "blocked",
      modelReviewRequired: true,
    });
    expect(laneByKey.answer_snapshot).toMatchObject({
      status: "stale",
      admission: "blocked",
      modelReviewRequired: true,
    });
  });

  it("does not project voice output through deterministic interpretation lanes", () => {
    const noPolicyProjection = buildStagePlayOutputLaneProjectionV1({
      graph: graphFixture(reviewedOutputBadges(false)),
    });
    const policyProjection = buildStagePlayOutputLaneProjectionV1({
      graph: graphFixture(reviewedOutputBadges(true)),
    });
    const policyVoiceLane = policyProjection.lanes.find((lane) => lane.lineKey === "voice_output");

    expect(buildStagePlayLiveAnswerLineValuesV1(noPolicyProjection).voice_output).toBeUndefined();
    expect(policyVoiceLane).toMatchObject({
      status: "ready",
      lineUpdateAllowed: false,
      modelReviewRequired: true,
    });
    expect(policyVoiceLane?.text).toBe("Check hostile distance before using the barrier retreat plan.");
    expect(buildStagePlayLiveAnswerLineValuesV1(policyProjection).voice_output).toBeUndefined();
  });

  it("does not write voice output when policy exists but answer snapshot citation is missing", () => {
    const uncitedVoiceBadges = reviewedOutputBadges(true).map((entry) =>
      entry.id === "voice_output.current"
        ? { ...entry, evidenceRefs: ["ask:turn:stage-output"] }
        : entry
    );
    const projection = buildStagePlayOutputLaneProjectionV1({
      graph: graphFixture(uncitedVoiceBadges),
    });

    expect(buildStagePlayLiveAnswerLineValuesV1(projection).voice_output).toBeUndefined();
  });

  it("updates active Live Interpretation lines while preserving checkpoint-only recommendation authority", () => {
    const { environment } = createLiveAnswerEnvironment({
      thread_id: "thread:stage-output",
      created_turn_id: "turn:stage-output",
      objective: "Move safely through a hostile area",
      room_id: "room:stage-output",
      preset: "minecraft_run_monitor",
      now: "2026-06-02T12:30:00.000Z",
    });
    const initialRecommendation = environment.lines_by_key?.recommendation?.value;
    const reduction = reduceLiveAnswerEnvironmentFromStagePlayGraph({
      environment,
      graph: graphFixture(),
      now: "2026-06-02T12:30:11.000Z",
    });

    expect(reduction).not.toBeNull();
    expect(reduction?.delta.reason).toBe("line_reasoning_update");
    expect(reduction?.delta.changed_line_keys).toEqual(expect.arrayContaining([
      "risk",
      "possibilities",
      "unknowns",
      "next_check",
    ]));
    expect(reduction?.delta.changed_line_keys).not.toContain("recommendation");
    expect(reduction?.environment.lines_by_key?.risk?.value).toContain("close-range engagement blocked");
    expect(reduction?.environment.lines_by_key?.possibilities?.value).toContain("defensive retreat barrier");
    expect(reduction?.environment.lines_by_key?.recommendation?.value).toBe(initialRecommendation);
    expect(reduction?.environment.assistant_answer).toBe(false);
    expect(reduction?.environment.post_tool_model_step_required).toBe(true);
  });
});
