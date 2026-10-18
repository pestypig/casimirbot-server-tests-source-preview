import { describe, expect, it } from "vitest";
import { validateStagePlayPredictionHypothesisV1 } from "../../shared/contracts/stage-play-prediction.v1";
import { validateStagePlayPredictionValidationV1 } from "../../shared/contracts/stage-play-prediction-validation.v1";
import {
  buildNarrativeCompactObservationFromText,
  buildNarrativeStagePlayGraph,
} from "../services/stage-play/narrative-stage-play-adapter";
import { buildStagePlayPredictionHypothesisFromGraph } from "../services/stage-play/stage-play-prediction-reducer";
import { validateStagePlayPredictionAgainstObservation } from "../services/stage-play/stage-play-prediction-validator";

describe("Stage Play prediction reducer and validator", () => {
  it("predicts constrained move class and validates it against a later compact window", () => {
    const sourceObservation = buildNarrativeCompactObservationFromText({
      observationId: "stage_play_compact_observation:lotgh-source",
      sourceIds: ["source:browser-tab-audio"],
      fromTs: "2026-06-02T13:00:00.000Z",
      toTs: "2026-06-02T13:00:10.000Z",
      text: [
        "On the bridge, the commander orders the fleet to hold fire and delay.",
        "An advisor warns of betrayal and says they need time and leverage.",
        "They cannot attack yet and must confirm intel.",
      ].join(" "),
      evidenceRefs: ["stage_play_raw_session_buffer_entry:audio-1"],
    });
    const graph = buildNarrativeStagePlayGraph({ observation: sourceObservation });
    const prediction = buildStagePlayPredictionHypothesisFromGraph({
      graph,
      horizonKind: "next_scene_beat",
    });

    expect(validateStagePlayPredictionHypothesisV1(prediction)).toEqual([]);
    expect(prediction.predictedMoveClass).toBe("delay");
    expect(prediction.supportingBadgeIds).toEqual(expect.arrayContaining(["binding.controlled_stalling"]));
    expect(prediction.blockedMoveIds).toEqual(expect.arrayContaining(["blocked.cannot_attack_yet"]));
    expect(prediction.scoreableSignals).toEqual(expect.arrayContaining([
      "move_class:delay",
      "actor:actor.commander",
      "blocked_move:blocked.cannot_attack_yet",
    ]));
    expect(prediction.assistant_answer).toBe(false);

    const laterObservation = buildNarrativeCompactObservationFromText({
      observationId: "stage_play_compact_observation:lotgh-later",
      sourceIds: ["source:browser-tab-audio"],
      fromTs: "2026-06-02T13:00:10.000Z",
      toTs: "2026-06-02T13:00:20.000Z",
      text: [
        "The commander continues to delay and asks the advisor to confirm the intelligence.",
        "They hold fire because they still cannot attack yet.",
      ].join(" "),
      evidenceRefs: ["stage_play_raw_session_buffer_entry:audio-2"],
    });
    const validation = validateStagePlayPredictionAgainstObservation({
      prediction,
      observation: laterObservation,
    });

    expect(validateStagePlayPredictionValidationV1(validation)).toEqual([]);
    expect(validation.outcome).toBe("confirmed");
    expect(validation.matchedSignals).toEqual(expect.arrayContaining([
      "move_class:delay",
      "actor:actor.commander",
      "blocked_move:blocked.cannot_attack_yet",
    ]));
    expect(validation.contradictedSignals).toEqual([]);
    expect(validation.confidenceDelta).toBeGreaterThan(0);
    expect(validation.assistant_answer).toBe(false);
  });

  it("scores a contradictory later move as missed", () => {
    const sourceObservation = buildNarrativeCompactObservationFromText({
      observationId: "stage_play_compact_observation:lotgh-source-missed",
      sourceIds: ["source:browser-tab-audio"],
      fromTs: "2026-06-02T14:00:00.000Z",
      toTs: "2026-06-02T14:00:10.000Z",
      text: "The commander needs time and leverage, delays conflict, and cannot attack yet.",
      evidenceRefs: ["stage_play_raw_session_buffer_entry:audio-3"],
    });
    const graph = buildNarrativeStagePlayGraph({ observation: sourceObservation });
    const prediction = buildStagePlayPredictionHypothesisFromGraph({ graph });
    const laterObservation = buildNarrativeCompactObservationFromText({
      observationId: "stage_play_compact_observation:lotgh-later-missed",
      sourceIds: ["source:browser-tab-audio"],
      fromTs: "2026-06-02T14:00:10.000Z",
      toTs: "2026-06-02T14:00:20.000Z",
      text: "The commander orders an immediate attack and the fleet opens fire.",
      evidenceRefs: ["stage_play_raw_session_buffer_entry:audio-4"],
    });
    const validation = validateStagePlayPredictionAgainstObservation({ prediction, observation: laterObservation });

    expect(validation.outcome).toBe("missed");
    expect(validation.contradictedSignals).toEqual(expect.arrayContaining([
      "move_class:attack",
      "blocked_move:blocked.cannot_attack_yet",
    ]));
    expect(validation.confidenceDelta).toBeLessThan(0);
  });
});
