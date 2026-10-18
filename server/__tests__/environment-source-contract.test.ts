import { describe, expect, it } from "vitest";
import type { HelixActionRehearsalResult } from "@shared/helix-action-rehearsal";
import type { HelixEnvironmentStateSnapshot } from "@shared/helix-environment-state-snapshot";
import houseChestFood from "../../fixtures/environment-state/minecraft/house-chest-food.snapshot.json";
import rawNbtRejected from "../../fixtures/environment-state/minecraft/raw-nbt-rejected.snapshot.json";
import feasibleRehearsal from "../../fixtures/environment-rehearsal/retrieve-food.feasible.json";
import { auditEnvironmentSourceContract } from "../services/situation-room/environment-source-contract-validator";

describe("environment source contract validation", () => {
  it("accepts compact Minecraft plugin snapshots as generic environment state", () => {
    const audit = auditEnvironmentSourceContract({
      subject: houseChestFood as HelixEnvironmentStateSnapshot,
      now: "2026-05-19T18:30:05.000Z",
    });

    expect(audit.ok).toBe(true);
    expect(audit.issues).toEqual([]);
  });

  it("rejects raw NBT and raw payload snapshots before live line updates", () => {
    const audit = auditEnvironmentSourceContract({
      subject: rawNbtRejected as unknown as HelixEnvironmentStateSnapshot,
      now: "2026-05-19T18:32:00.000Z",
    });

    expect(audit.ok).toBe(false);
    expect(audit.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "raw_nbt_included" }),
        expect.objectContaining({ code: "raw_payload_included_not_false" }),
      ]),
    );
  });

  it("requires rehearsals to be non-executing artifacts", () => {
    const audit = auditEnvironmentSourceContract({
      subject: feasibleRehearsal as HelixActionRehearsalResult,
      now: "2026-05-19T18:30:05.000Z",
    });

    expect(audit.ok).toBe(true);
    expect((feasibleRehearsal as HelixActionRehearsalResult).side_effects_performed).toBe(false);
    expect((feasibleRehearsal as HelixActionRehearsalResult).assistant_answer).toBe(false);
  });
});
