import { describe, expect, it } from "vitest";

// @ts-expect-error This acceptance helper is intentionally a plain ESM script.
import { collectMinecraftCapabilityObservations } from "../../scripts/helix-minecraft-live-probe-observations.mjs";

describe("Minecraft live-probe observation collection", () => {
  it("recognizes a re-enterable governed command observation", () => {
    expect(
      collectMinecraftCapabilityObservations([
        {
          observation: {
            schema: "helix.environment_command.observation.v1",
            command_request_ref: "command_request:test",
            outcome: "succeeded",
            summary: "Summoned new Bat",
            evidence_ref: "environment_command_evidence:test",
            eligible_for_current_turn_reentry: true,
          },
        },
      ]),
    ).toEqual([
      {
        capability_id: "com.casimirbot.minecraft.command",
        outcome: "succeeded",
        summary: "Summoned new Bat",
        evidence_ref: "environment_command_evidence:test",
        eligible_for_current_turn_reentry: true,
      },
    ]);
  });

  it("retains a declared player-action capability identity", () => {
    expect(
      collectMinecraftCapabilityObservations([
        {
          schema: "helix.environment_action.observation.v1",
          capability_id: "com.casimirbot.minecraft.player.camera.track",
          action_request_ref: "action_request:test",
          outcome: "succeeded",
          summary: "Tracking complete",
          evidence_ref: "environment_action_evidence:test",
          eligible_for_current_turn_reentry: true,
        },
      ]),
    ).toEqual([
      {
        capability_id: "com.casimirbot.minecraft.player.camera.track",
        outcome: "succeeded",
        summary: "Tracking complete",
        evidence_ref: "environment_action_evidence:test",
        eligible_for_current_turn_reentry: true,
      },
    ]);
  });
});
