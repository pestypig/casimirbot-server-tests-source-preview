import { describe, expect, it } from "vitest";
import {
  classifyGuardianCollisionPredictionEvidence,
  countGuardianValidatorOnlyDiagnosticDetours,
} from
  "../../scripts/helix-minecraft-guardian-evidence.mjs";

describe("Minecraft guardian collision evidence", () => {
  it("accepts an explicit satisfied collision condition", () => {
    expect(
      classifyGuardianCollisionPredictionEvidence({
        condition_observations: [{
          condition_kind: "predicted_collision_within",
          satisfied: true,
        }],
        placement_predictions: [],
      }),
    ).toEqual(expect.objectContaining({
      observed: true,
      condition_observed: true,
      binding_verified: false,
    }));
  });

  it("accepts a verified action-time predicted-collision binding", () => {
    expect(
      classifyGuardianCollisionPredictionEvidence({
        condition_observations: [{
          condition_kind: "vertical_velocity_at_most",
          satisfied: true,
        }],
        placement_prediction_count: 1,
        placement_action_success_count: 1,
        placement_mutation_success_count: 1,
        placement_predictions: [{
          position_binding_kind: "predicted_collision_cell",
          applicable: true,
          predicted_reachable: true,
          first_collision_tick: 6,
          support_candidate_count: 1,
          target_position: { x: -79, y: 81, z: -39 },
        }],
      }),
    ).toEqual(expect.objectContaining({
      observed: true,
      condition_observed: false,
      binding_verified: true,
    }));
  });

  it("rejects an inapplicable or unreachable forecast", () => {
    expect(
      classifyGuardianCollisionPredictionEvidence({
        condition_observations: [],
        placement_prediction_count: 1,
        placement_action_success_count: 1,
        placement_mutation_success_count: 1,
        placement_predictions: [{
          position_binding_kind: "predicted_collision_cell",
          applicable: true,
          predicted_reachable: false,
          first_collision_tick: 6,
          support_candidate_count: 0,
          target_position: { x: -79, y: 81, z: -39 },
        }],
      }),
    ).toEqual(expect.objectContaining({
      observed: false,
      condition_observed: false,
      binding_verified: false,
    }));
  });

  it("counts world reads only while a validator-only guardian repair is pending", () => {
    expect(
      countGuardianValidatorOnlyDiagnosticDetours([
        {
          capability_id: "com.casimirbot.minecraft.actor.status.read",
          outcome: "succeeded",
        },
        {
          capability_id: "com.casimirbot.minecraft.player.guardian.execute",
          outcome: "precondition_failed",
          summary:
            "The concurrent Minecraft guardian program failed its trusted contract: lane resources missing.",
        },
        {
          capability_id: "com.casimirbot.minecraft.inventory.check",
          outcome: "succeeded",
        },
        {
          capability_id: "com.casimirbot.minecraft.player.guardian.execute",
          outcome: "failed",
          summary: "A required reactive lane failed or was canceled.",
        },
        {
          capability_id: "com.casimirbot.minecraft.spatial_region.inspect",
          outcome: "succeeded",
        },
      ]),
    ).toBe(1);
  });
});
