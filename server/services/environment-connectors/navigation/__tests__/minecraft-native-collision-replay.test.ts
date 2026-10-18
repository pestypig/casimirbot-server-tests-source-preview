import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { normalizeMinecraftNativeCollisionReplay } from "../minecraft-native-collision-replay";
import { compileMinecraftVoxelTopology, type MinecraftVoxelFixtureInput } from "../minecraft-voxel-topology";

const fixturePath = "docs/evidence/eh-g8-environment-spatial-navigation-v1/nav1m-native-stone-air-replay.json";
const replay = () => JSON.parse(readFileSync(fixturePath, "utf8"));
const snapshot: Omit<MinecraftVoxelFixtureInput, "cells" | "minimum" | "maximum"> = {
  snapshot_id: "snapshot:native_fixture", observation_ref: "evidence:native_blockstate_fixture",
  identity: { environment_id: "env:fixture", source_id: "source:fixture", subject_id: "subject:fixture",
    producer_epoch: "epoch:fixture", coordinate_frame_id: "frame:fixture", observation_revision: 1,
    authority_id: "authority:non_executable_fixture", authority_revision: 1 },
  clocks: { environment: { kind: "simulation_step", sequence: 100, resolution_unit: "minecraft_world_tick", nominal_units_per_second: 20 },
    monotonic: { origin_id: "clock:fixture", elapsed_ms: 1000 }, audit_at: "2026-09-09T01:20:00Z" },
  captured_at: "2026-09-09T01:20:00Z",
};
const envelope = () => ({ expected_dimension: "minecraft:overworld",
  expected_subject_native_id: "00000000-0000-4000-8000-000000000001", expected_tick: 100, snapshot: structuredClone(snapshot) });
it("replays real native block-state measurement into exactly nine nodes and forty edges", () => {
  const s = normalizeMinecraftNativeCollisionReplay(replay(), envelope());
  expect(s.features).toHaveLength(100);
  expect(s.coverage_state).toBe("complete_within_bounds");
  const r = compileMinecraftVoxelTopology(s, { expected_identity: s.identity, expected_snapshot_hash: s.snapshot_hash,
    now: snapshot.captured_at, maximum_age_ms: 1000, maximum_nodes: 100, maximum_edges: 1000 });
  expect(r.graph?.nodes).toHaveLength(9);
  expect(r.graph?.edges).toHaveLength(40);
  expect(r.graph?.frontiers).toHaveLength(8);
  expect(r.execution_authority).toBe(false);
});
it("is stable under reordered native cells", () => {
  const r = replay(), copy = structuredClone(r); copy.cells.reverse();
  expect(normalizeMinecraftNativeCollisionReplay(copy, envelope())).toEqual(normalizeMinecraftNativeCollisionReplay(r, envelope()));
});
it("consumes the bounded capture collector output through the unchanged replay bridge", () => {
  const raw = JSON.parse(readFileSync("docs/evidence/eh-g8-environment-spatial-navigation-v1/nav1c-selected-player-capture-fixture.json", "utf8"));
  const s = normalizeMinecraftNativeCollisionReplay(raw, envelope());
  expect(s.features).toHaveLength(125);
  const r = compileMinecraftVoxelTopology(s, { expected_identity: s.identity, expected_snapshot_hash: s.snapshot_hash,
    now: snapshot.captured_at, maximum_age_ms: 1000, maximum_nodes: 100, maximum_edges: 1000 });
  expect(r.graph?.nodes).toHaveLength(9);
  expect(r.graph?.edges).toHaveLength(40);
  expect(r.graph?.frontiers).toHaveLength(8);
  expect(r.execution_authority).toBe(false);
});
it.each(["dimension", "subject_native_id"])("rejects a different %s", field => {
  const r = replay(); r[field] = field === "dimension" ? "minecraft:the_nether" : "00000000-0000-4000-8000-000000000002";
  expect(() => normalizeMinecraftNativeCollisionReplay(r, envelope())).toThrow("native_capture_identity_mismatch");
});
it.each(["tick_start", "tick_end"])("rejects a mismatched %s", field => {
  const r = replay(); r[field]++;
  expect(() => normalizeMinecraftNativeCollisionReplay(r, envelope())).toThrow("native_capture_clock_mismatch");
});
it("rejects an inconsistent observation clock even with a matching replay tick", () => {
  const e = envelope(); e.snapshot.clocks.environment.sequence++;
  expect(() => normalizeMinecraftNativeCollisionReplay(replay(), e)).toThrow("native_capture_clock_mismatch");
});
it.each(["collision", "collision_empty", "loaded"])("rejects poisoned native %s facts", field => {
  const r = replay(), f = r.cells.find((c: any) => c.facts.collision === "full_cube").facts;
  f[field] = field === "collision" ? "empty" : field === "loaded" ? false : true;
  expect(() => normalizeMinecraftNativeCollisionReplay(r, envelope())).toThrow("native_collision_facts_inconsistent");
});
it("preserves unloaded and unsupported geometry rather than mapping it to air", () => {
  const r = replay();
  r.cells[0].facts = { loaded: false, collision_empty: false, collision_full_cube: false, air: false,
    reviewed_support: false, hazard: false, fluid: false, collision: "unknown" };
  r.cells[1].facts = { ...r.cells[0].facts, loaded: true, collision: "unsupported" };
  const s = normalizeMinecraftNativeCollisionReplay(r, envelope());
  expect(s.coverage_state).toBe("partial_with_unknown_regions");
  expect(s.features.filter(f => f.traversability === "unknown")).toHaveLength(2);
});
it("rejects missing facts, unversioned captures and extra execution instructions", () => {
  for (const mutate of [(r: any) => { delete r.cells[0].facts.air; },
    (r: any) => { r.schema = "old"; }, (r: any) => { r.execute = true; }]) {
    const r = replay(); mutate(r);
    expect(() => normalizeMinecraftNativeCollisionReplay(r, envelope())).toThrow();
  }
});
