import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { helixEnvironmentConstrainedJsonSchema } from "@shared/helix-environment-connector";
import { normalizeMinecraftNavigationCollisionObservation as normalize, navigationCollisionFailureReasons } from "../minecraft-navigation-collision-observation";
import { minecraftNavigationCollisionSchema } from "../minecraft-navigation-collision-schema";
import { validateEnvironmentConnectorSchemaValue } from "../../conformance";

const replay = () => JSON.parse(readFileSync("docs/evidence/eh-g8-environment-spatial-navigation-v1/nav1c-selected-player-capture-fixture.json", "utf8"));
const context = { requested: true, expected_subject_native_id: "00000000-0000-4000-8000-000000000001" };
const observation = (): Record<string, any> => ({
  snapshot_schema: "helix.minecraft_perception_snapshot.v1", dimension: "minecraft:overworld",
  observation_revision: 100, game_tick: 100, actor: { position: { x: 0, y: 0, z: 0 } },
  navigation_collision: { status: "captured", replay: replay() },
});
it("admits bounded native capture as observation evidence without adding authority", () => {
  const r = observation(); normalize(r, context);
  expect(r.navigation_collision.replay.cells).toHaveLength(125);
  expect(r).not.toHaveProperty("execution_authority");
  expect(helixEnvironmentConstrainedJsonSchema.safeParse(minecraftNavigationCollisionSchema).success).toBe(true);
  expect(validateEnvironmentConnectorSchemaValue(minecraftNavigationCollisionSchema, r.navigation_collision)).toEqual([]);
});
it("leaves the existing unrequested read byte-for-byte unchanged", () => {
  const r = observation(); delete r.navigation_collision;
  const before = JSON.stringify(r); normalize(r, { ...context, requested: false });
  expect(JSON.stringify(r)).toBe(before);
});
it("reports old sensors explicitly without inventing terrain", () => {
  const r = observation(); delete r.navigation_collision; normalize(r, context);
  expect(r.navigation_collision).toEqual({ status: "unavailable", reason: "sensor_extension_unavailable" });
});
it("does not invent a successful snapshot for a failed base probe", () => {
  const r = { result_summary: "selected player unavailable" }; normalize(r, context);
  expect(r).not.toHaveProperty("navigation_collision");
});
it.each(navigationCollisionFailureReasons)("preserves typed unavailable: %s", reason => {
  const r = observation(); r.navigation_collision = { status: "unavailable", reason }; normalize(r, context);
  expect(r.navigation_collision).toEqual({ status: "unavailable", reason });
  expect(validateEnvironmentConnectorSchemaValue(minecraftNavigationCollisionSchema, r.navigation_collision)).toEqual([]);
});
it.each([
  "subject", "missing_subject", "dimension", "tick_start", "tick_end", "revision", "bounds", "origin",
  "missing_cell", "duplicate", "outside", "poisoned_facts", "extra_field", "oversized", "unexpected", "unavailable_with_replay",
])("rejects %s without turning it into safe terrain", scenario => {
  const r = observation(), c = { ...context }, p = r.navigation_collision.replay;
  switch (scenario) {
    case "subject": c.expected_subject_native_id = "00000000-0000-4000-8000-000000000002"; break;
    case "missing_subject": c.expected_subject_native_id = ""; break;
    case "dimension": p.dimension = "minecraft:the_nether"; break;
    case "tick_start": p.tick_start++; break;
    case "tick_end": p.tick_end++; break;
    case "revision": r.observation_revision++; break;
    case "bounds": p.maximum[0]++; break;
    case "origin": r.actor.position.x = 100; break;
    case "missing_cell": p.cells.pop(); break;
    case "duplicate": p.cells[1] = p.cells[0]; break;
    case "outside": p.cells[0].position[0] = -50; break;
    case "poisoned_facts": p.cells[0].facts.collision = "empty"; break;
    case "extra_field": p.command = "/tp"; break;
    case "oversized": p.padding = "x".repeat(65536); break;
    case "unexpected": c.requested = false; break;
    case "unavailable_with_replay": r.navigation_collision.status = "unavailable"; r.navigation_collision.reason = "wrong_thread"; break;
  }
  expect(() => normalize(r, c)).toThrow();
});
it("retains unknown cells explicitly", () => {
  const r = observation(); r.navigation_collision.replay.cells[0].facts = {
    loaded: false, collision_empty: false, collision_full_cube: false, air: false,
    reviewed_support: false, hazard: false, fluid: false, collision: "unknown",
  };
  normalize(r, context); expect(r.navigation_collision.replay.cells[0].facts.collision).toBe("unknown");
});
