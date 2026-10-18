import { describe, expect, it } from "vitest";
import type { SituationSemanticEvent } from "@shared/helix-situation-semantics";
import { buildSituationMicroNarration } from "../services/situation-room/situation-micro-narrator";

const semanticEvent: SituationSemanticEvent = {
  schema: "helix.situation_semantic_event.v1",
  semantic_event_id: "semantic:wood",
  source_signal_id: "signal:wood",
  room_id: "room:minecraft",
  graph_id: null,
  world_id: "minecraft:minehut",
  actor_id: "player:datdampig",
  event_type: "item_acquired",
  subject: "DatDamPig",
  verb: "gathered",
  object: "oak log",
  tags: ["resource_gathering", "goal_progress"],
  goal_clues: ["gather_wood"],
  risk_clues: [],
  narrative_template: "{subject} gathered {object}.",
  evidence_refs: ["mc:item:oak_log"],
  ts: "2026-05-06T10:00:00.000Z",
};

describe("situation micro narrator", () => {
  it("renders deterministic third-person narration with prediction metadata", () => {
    const receipt = buildSituationMicroNarration({
      roomId: "room:minecraft",
      semanticEvents: [semanticEvent],
      ts: semanticEvent.ts,
    });

    expect(receipt).toMatchObject({
      schema: "helix.situation_narration_receipt.v1",
      mode: "deterministic_template",
      perspective: "third_person",
      text: "DatDamPig gathered oak log.",
      inferred_intent: "wood/tool/building goal",
      memory_policy: "session_keep",
    });
    expect(receipt?.prediction).toContain("craft basic tools");
  });
});
