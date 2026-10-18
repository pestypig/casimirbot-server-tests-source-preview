import { describe, expect, it } from "vitest";
import { buildDirectDiagnosticEnvelope } from "../../scripts/helix-minecraft-player-stage-diagnostic";

describe("Minecraft direct diagnostic staging", () => {
  it("preserves a finite integer duration for combat_guard envelopes", () => {
    const envelope = buildDirectDiagnosticEnvelope({
      requestId: "c1-combat-guard-regression",
      maxDurationMs: 45_000,
      action: {
        action_kind: "combat_guard",
        hostile_entity_type_ids: ["minecraft:skeleton"],
        max_acquisition_distance: 24,
        require_line_of_sight: true,
        minimum_attack_cooldown: 0.9,
        max_attack_pulses: 48,
        max_target_switches: 4,
        target_commit_ticks: 10,
        retreat_start_distance: 2.5,
        retreat_stop_distance: 4,
        retreat_when_hostile_count_at_least: 2,
        approach_policy: "local_reroute_bounded",
        max_approach_ticks: 500,
        cover_policy: "lateral_bounded",
        max_cover_ticks: 160,
        projectile_response: "shield_or_sidestep",
        projectile_evasion_horizon_ticks: 8,
        max_evasion_ticks: 240,
        shield_hand: "off_hand",
        max_shield_hold_ticks: 240,
        max_duration_ms: 45_000,
        stop_below_health: 12,
        friendly_fire: false,
      },
    });

    expect(envelope.max_duration_ticks).toBe(900);
    expect(Number.isFinite(envelope.max_duration_ticks)).toBe(true);
    expect(Number.isInteger(envelope.max_duration_ticks)).toBe(true);
  });
});
