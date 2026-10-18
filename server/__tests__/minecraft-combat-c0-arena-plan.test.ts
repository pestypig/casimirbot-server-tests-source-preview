import { describe, expect, it } from "vitest";
import {
  buildCombatC0ArenaPlan,
  combatC0ArenaPlanRequestSchema,
} from "../../scripts/helix-minecraft-combat-c0-arena-plan";

const request = {
  schema: "helix.minecraft_combat_arena_plan_request.v1" as const,
  server_instance_id: "minecraft:test:combat-c0",
  player_name: "FixturePlayer",
  origin: { x: 100, y: 64, z: -200 },
  world_snapshot_ref: `snapshot:${"b".repeat(64)}`,
  disposable_arena_region_acknowledged: true as const,
};

describe("EH-MC combat C0 zombie arena plan", () => {
  it("builds a deterministic setup-only plan with one exact hostile fixture", () => {
    const first = buildCombatC0ArenaPlan(request);
    const second = buildCombatC0ArenaPlan(request);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      arena_id: "EH-MC-C0-zombie-baseline-ring",
      tier: "C0",
      authority: {
        setup_plane: "world_authority_setup_only",
        measurement_plane: "player_embodiment_only",
        setup_receipts_acceptance_eligible: false,
        world_authority_must_be_released_before_measurement: true,
      },
      admitted_target: {
        fixture_label: "primary_zombie",
        entity_type_id: "minecraft:zombie",
        classification: "hostile",
        runtime_target_ref_required: true,
        implicit_nearest_attack_forbidden: true,
      },
      credentials_included: false,
      hidden_reasoning_included: false,
    });
    expect(first.arena_manifest_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.plan_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.setup_commands.filter((command) =>
      command.includes("summon minecraft:zombie")
    )).toHaveLength(1);
    expect(first.setup_commands.join(" ")).toContain("IsBaby:0b");
    expect(first.setup_commands.join(" ")).toContain("ArmorItems:[{},{},{},{}]");
    expect(first.setup_commands).toContain("gamemode survival FixturePlayer");
    expect(first.setup_commands).toContain("gamerule doMobSpawning false");
    expect(first.setup_command_declarations.every((declaration) =>
      declaration.effect !== "read_only"
    )).toBe(true);
    expect(first.verification_command_declarations.every((declaration) =>
      declaration.category === "query" && declaration.effect === "read_only"
    )).toBe(true);
    expect(first.restore).toEqual({
      mode: "server_world_snapshot",
      snapshot_ref: request.world_snapshot_ref,
      required_after_trial: true,
    });
  });

  it("rejects selectors, missing snapshot identity, and unacknowledged regions", () => {
    expect(combatC0ArenaPlanRequestSchema.safeParse({
      ...request,
      player_name: "@a",
    }).success).toBe(false);
    expect(combatC0ArenaPlanRequestSchema.safeParse({
      ...request,
      world_snapshot_ref: "",
    }).success).toBe(false);
    expect(combatC0ArenaPlanRequestSchema.safeParse({
      ...request,
      disposable_arena_region_acknowledged: false,
    }).success).toBe(false);
  });
});
