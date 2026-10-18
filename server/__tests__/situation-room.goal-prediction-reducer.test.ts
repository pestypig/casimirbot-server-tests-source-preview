import { describe, expect, it } from "vitest";
import type { SituationNarrationReceipt } from "@shared/helix-situation-narration";
import type { SituationSemanticEvent } from "@shared/helix-situation-semantics";
import { reduceGoalPredictions } from "../services/situation-room/goal-prediction-reducer";

describe("goal prediction reducer", () => {
  it("creates evidence-linked wood/tool predictions", () => {
    const semantic: SituationSemanticEvent = {
      schema: "helix.situation_semantic_event.v1",
      semantic_event_id: "semantic:wood",
      source_signal_id: "signal:wood",
      room_id: "room:minecraft",
      event_type: "item_acquired",
      actor_id: "player:datdampig",
      verb: "gathered",
      tags: ["resource_gathering", "goal_progress"],
      goal_clues: ["gather_wood"],
      risk_clues: [],
      narrative_template: "{subject} gathered {object}.",
      evidence_refs: ["mc:item:oak_log"],
      ts: "2026-05-06T10:00:00.000Z",
    };
    const narration: SituationNarrationReceipt = {
      schema: "helix.situation_narration_receipt.v1",
      narration_id: "narration:wood",
      room_id: "room:minecraft",
      source_signal_ids: ["signal:wood"],
      semantic_event_ids: ["semantic:wood"],
      mode: "deterministic_template",
      text: "DatDamPig gathered oak log.",
      perspective: "third_person",
      memory_policy: "session_keep",
      evidence_refs: ["mc:item:oak_log"],
      ts: "2026-05-06T10:00:00.000Z",
    };

    const predictions = reduceGoalPredictions({
      roomId: "room:minecraft",
      semanticEvents: [semantic],
      narration,
    });

    expect(predictions[0]).toMatchObject({
      schema: "helix.situation_prediction.v1",
      predicted_goal: "building shelter or basic tools",
      predicted_next_action: "craft planks, sticks, or early tools",
      evidence_refs: ["mc:item:oak_log"],
      derived_from_narration_ids: ["narration:wood"],
    });
  });
});
