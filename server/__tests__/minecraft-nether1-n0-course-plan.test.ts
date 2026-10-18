import { describe, expect, it } from "vitest";
import {
  buildNether1N0CoursePlan,
  nether1N0CoursePlanRequestSchema,
} from "../../scripts/helix-minecraft-nether1-n0-course-plan";

const request = {
  schema: "helix.minecraft.nether1_n0_course_plan_request.v1" as const,
  server_instance_id: "minecraft:test:n0",
  dimension_id: "minecraft:overworld",
  player_name: "FixturePlayer",
  origin: { x: 100, y: 65, z: -200 },
  world_snapshot_ref: `snapshot:${"a".repeat(64)}`,
  disposable_course_region_acknowledged: true as const,
};

describe("EH-MC-NETHER1 N0 controlled-course plan", () => {
  it("builds a deterministic setup-only plan with snapshot restoration", () => {
    const first = buildNether1N0CoursePlan(request);
    const second = buildNether1N0CoursePlan(request);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      fixture_id: "EH-MC-NETHER1-N0-controlled-course-v1",
      authority: {
        setup_plane: "world_authority_setup_only",
        course_plane: "player_embodiment_only",
        setup_receipts_acceptance_eligible: false,
        setup_authority_must_be_released_before_course: true,
      },
      restore: {
        mode: "server_world_snapshot",
        snapshot_ref: request.world_snapshot_ref,
        required_before_stages: ["N1", "N2", "N3", "N4"],
      },
      credentials_included: false,
      hidden_reasoning_included: false,
    });
    expect(first.plan_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.setup_commands).toContain("gamemode survival FixturePlayer");
    expect(first.setup_commands).toContain(
      "execute in minecraft:overworld run tp FixturePlayer 94 65 -200 -90 0",
    );
    expect(first.setup_commands.some((command) =>
      command.includes("minecraft:nether_portal")
    )).toBe(false);
    expect(first.setup_command_declarations).toHaveLength(
      first.setup_commands.length,
    );
    expect(first.setup_command_declarations.every((declaration) =>
      declaration.effect !== "read_only"
    )).toBe(true);
    expect(first.verification_command_declarations).toHaveLength(
      first.verification_commands.length,
    );
    expect(first.verification_command_declarations.every((declaration) =>
      declaration.category === "query" && declaration.effect === "read_only"
    )).toBe(true);
    expect(first.verification_commands.some((command) =>
      command.includes("unless block 100 66 -200 minecraft:nether_portal")
    )).toBe(true);
    const ignition = first.materialized_compositions.find(
      (composition) => composition.composition_id === "portal_ignition",
    ) as {
      preconditions: string[];
      sequence: {
        mutation_scope: { allowed_regions: Array<{ min: unknown; max: unknown }> };
        nodes: Array<{ node_id: string; action?: { positions?: unknown[] } }>;
      };
    };
    expect(ignition.preconditions).toContain(
      "a complete unlit obsidian frame surrounds cell 100,66,-200",
    );
    expect(ignition.sequence.mutation_scope.allowed_regions).toEqual([
      {
        min: { x: 100, y: 66, z: -200 },
        max: { x: 101, y: 68, z: -200 },
      },
    ]);
    expect(ignition.sequence.nodes.find((node) =>
      node.node_id === "ignite_frame"
    )?.action?.positions).toEqual([{ x: 100, y: 66, z: -200 }]);
    const furnace = first.materialized_compositions.find(
      (composition) => composition.composition_id === "furnace_smelting",
    ) as {
      sequence: {
        nodes: Array<{
          action?: { action_kind?: string; container_target?: string };
        }>;
      };
    };
    expect(
      furnace.sequence.nodes
        .map((node) => node.action)
        .filter((action) => action?.action_kind === "inventory_transfer")
        .map((action) => action?.container_target),
    ).toEqual([
      "looked_at_container",
      "looked_at_container",
      "looked_at_container",
    ]);
  });

  it("rejects selectors, missing snapshots, and unacknowledged regions", () => {
    expect(nether1N0CoursePlanRequestSchema.safeParse({
      ...request,
      player_name: "@a",
    }).success).toBe(false);
    expect(nether1N0CoursePlanRequestSchema.safeParse({
      ...request,
      world_snapshot_ref: "",
    }).success).toBe(false);
    expect(nether1N0CoursePlanRequestSchema.safeParse({
      ...request,
      disposable_course_region_acknowledged: false,
    }).success).toBe(false);
  });
});
