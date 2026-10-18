import { describe, expect, it } from "vitest";

import { parseResidentDecisionLog } from "../../scripts/helix-minecraft-resident-decision-capture";

describe("Minecraft resident decision capture", () => {
  it("extracts only complete resident-decision JSON records", () => {
    const first = {
      schema: "helix.minecraft.resident_decision.v1",
      observation_revision: 41,
      proposal: "swim_up",
      reason_code: "submerged_air_low",
    };
    const second = {
      schema: "helix.minecraft.resident_decision.v1",
      observation_revision: 48,
      proposal: "swim_up",
      reason_code: "breathing_restored_surface_hold",
    };
    const log = [
      "[12:00:00] unrelated",
      `[12:00:01] HELIX_MINECRAFT_RESIDENT_DECISION ${JSON.stringify(first)}`,
      "[12:00:02] HELIX_MINECRAFT_RESIDENT_DECISION {truncated",
      `[12:00:03] HELIX_MINECRAFT_RESIDENT_DECISION ${JSON.stringify(second)}`,
    ].join("\n");

    expect(parseResidentDecisionLog(log)).toEqual([first, second]);
  });
});
