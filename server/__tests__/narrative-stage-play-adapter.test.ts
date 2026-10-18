import { describe, expect, it } from "vitest";
import { validateStagePlayBadgeGraphV1 } from "../../shared/contracts/stage-play-badge-graph.v1";
import { validateStagePlayCompactObservationV1 } from "../../shared/contracts/stage-play-compact-observation.v1";
import {
  buildNarrativeCompactObservationFromText,
  buildNarrativeStagePlayGraph,
} from "../services/stage-play/narrative-stage-play-adapter";

describe("Narrative Stage Play adapter", () => {
  it("maps compact narrative media observations into badges and procedural bindings", () => {
    const observation = buildNarrativeCompactObservationFromText({
      observationId: "stage_play_compact_observation:lotgh-window-1",
      sourceIds: ["source:browser-tab-audio"],
      fromTs: "2026-06-02T13:00:00.000Z",
      toTs: "2026-06-02T13:00:10.000Z",
      windowId: "window:lotgh:1",
      text: [
        "On the bridge, the commander orders the fleet to hold fire and delay.",
        "An advisor warns of betrayal, they need time and leverage, and cannot attack yet.",
        "The commander wants to preserve the fleet and confirm intel before acting.",
      ].join(" "),
      evidenceRefs: ["stage_play_raw_session_buffer_entry:audio-1"],
    });
    const graph = buildNarrativeStagePlayGraph({ observation });
    const badgeIds = graph.badges.map((badge) => badge.id);

    expect(validateStagePlayCompactObservationV1(observation)).toEqual([]);
    expect(validateStagePlayBadgeGraphV1(graph)).toEqual([]);
    expect(badgeIds).toEqual(expect.arrayContaining([
      "observer.live_sources",
      "interpreter.narrative_stage_play",
      "setting.bridge",
      "actor.commander",
      "actor.advisor",
      "resource.fleet",
      "resource.orders",
      "resource.leverage",
      "resource.intel",
      "resource.time",
      "hazard.betrayal",
      "affordance.delay",
      "affordance.attack",
      "affordance.confirm",
      "blocked.cannot_attack_yet",
      "goal.preserve_fleet",
      "intent.preserve_fleet",
      "intent.delay_conflict",
      "intent.observe_opponent",
      "binding.controlled_stalling",
    ]));
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "observer.live_sources", to: "interpreter.narrative_stage_play", relation: "feeds" }),
      expect.objectContaining({ from: "interpreter.narrative_stage_play", to: "setting.bridge", relation: "interprets" }),
      expect.objectContaining({ from: "hazard.betrayal", to: "blocked.cannot_attack_yet", relation: "blocks" }),
      expect.objectContaining({ from: "affordance.delay", to: "binding.controlled_stalling", relation: "composes_with" }),
    ]));
    expect(graph.recommendedActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "stage-action:score-next-scene-beat",
        admission: "auto",
        agentExecutable: false,
      }),
      expect.objectContaining({
        id: "stage-action:explain-blocked-narrative-move",
        admission: "auto",
        agentExecutable: false,
      }),
    ]));
    expect(graph.sourceWindow.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: "source:browser-tab-audio",
        routeTo: "narrative_stage_play",
        selectedForStagePlay: true,
      }),
    ]));
    expect(graph.authority).toMatchObject({
      assistant_answer: false,
      raw_content_included: false,
      raw_payload_included: false,
      terminal_eligible: false,
      agent_executable: false,
    });
    expect(JSON.stringify(graph)).not.toMatch(/full transcript|raw[_ -]?logs|agent[_ -]?executable\s*[:=]\s*true/i);
  });
});
