import { describe, expect, it } from "vitest";
import { helixEnvironmentTimeSha256 } from "@shared/helix-environment-time";
import { helixEnvironmentTopologyGraphSchema, type HelixEnvironmentSpatialSnapshot } from "@shared/helix-environment-navigation";
import {
  buildMinecraftVoxelSnapshot, compileMinecraftVoxelTopology,
  type MinecraftVoxelFixtureInput, type MinecraftTopologyContext,
} from "../minecraft-voxel-topology";

// Frozen synthetic fixtures: explicitly observed blocked volume, then measured
// full-cube supports and empty body cells. Omitted cells NEVER default to air.
type Point = [number, number, number];
type Kind = MinecraftVoxelFixtureInput["cells"][number]["collision"];
const identity = {
  environment_id: "env:fixture", source_id: "source:fixture", subject_id: "subject:fixture",
  producer_epoch: "epoch:1", coordinate_frame_id: "frame:world", observation_revision: 4,
  authority_id: "authority:non_executable_fixture", authority_revision: 1,
};
const now = "2026-09-09T01:10:00.000Z";
function fixture() {
  const cells = new Map<string, { position: Point; collision: Kind }>();
  const set = (p: Point, c: Kind) => { cells.set(p.join("/"), { position: p, collision: c }); };
  for (let x = -4; x <= 4; x++) for (let y = -2; y <= 4; y++) for (let z = -4; z <= 4; z++) set([x, y, z], "blocked");
  const stand = (p: Point) => {
    set(p, "empty"); set([p[0], p[1] + 1, p[2]], "empty"); set([p[0], p[1] - 1, p[2]], "full_cube");
  };
  const input = (): MinecraftVoxelFixtureInput => ({
    snapshot_id: "snapshot:fixture", observation_ref: "evidence:synthetic:nav1d", identity,
    clocks: { environment: { kind: "simulation_step", sequence: 4, resolution_unit: "step", nominal_units_per_second: 20 },
      monotonic: { origin_id: "clock:fixture", elapsed_ms: 100 }, audit_at: now },
    captured_at: now, minimum: [-4, -2, -4], maximum: [4, 4, 4], cells: [...cells.values()],
  });
  const snapshot = () => buildMinecraftVoxelSnapshot(input());
  return { cells, set, stand, input, snapshot };
}
const context = (s: HelixEnvironmentSpatialSnapshot): MinecraftTopologyContext => ({
  expected_identity: identity, expected_snapshot_hash: s.snapshot_hash, now,
  maximum_age_ms: 1000, maximum_nodes: 1024, maximum_edges: 16_384,
});
const compile = (f: ReturnType<typeof fixture>) => { const s = f.snapshot(); return compileMinecraftVoxelTopology(s, context(s)); };
const nid = (p: Point) => `foothold:${p.join("/")}`;
function edge(f: ReturnType<typeof fixture>, from: Point, to: Point) {
  return compile(f).graph?.edges.find(e => e.from_node_id === nid(from) && e.to_node_id === nid(to));
}
const reseal = (s: HelixEnvironmentSpatialSnapshot) => {
  const { snapshot_hash: _hash, ...base } = s;
  return { ...base, snapshot_hash: helixEnvironmentTimeSha256(base) };
};

describe("NAV1-D frozen Minecraft topology fixtures (no native execution)", () => {
  it("flat: emits exactly two grounded nodes and reciprocal walk edges", () => {
    const f = fixture(); f.stand([0, 0, 0]); f.stand([1, 0, 0]);
    const result = compile(f), graph = result.graph!;
    expect(graph.nodes.map(n => n.node_id)).toEqual([nid([0, 0, 0]), nid([1, 0, 0])]);
    expect(graph.nodes.map(n => n.position)).toEqual([[0.5, 0, 0.5], [1.5, 0, 0.5]]);
    expect(graph.edges.map(e => [e.from_node_id, e.to_node_id, e.traversal_class])).toEqual([
      [nid([0, 0, 0]), nid([1, 0, 0]), "traversal:walk"],
      [nid([1, 0, 0]), nid([0, 0, 0]), "traversal:walk"],
    ]);
    expect(graph.edges.every(e => e.reversible)).toBe(true);
    expect(helixEnvironmentTopologyGraphSchema.parse(graph)).toEqual(graph);
    expect(result.execution_authority).toBe(false);
    expect(graph.adapter_strategy_authority).toBe(false);
    expect(graph.terminal_eligible).toBe(false);
    expect(result.transition_checks).toBe(32);
  });

  it("diagonal: requires both supported corner columns, including head clearance", () => {
    const f = fixture();
    for (const p of [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]] as Point[]) f.stand(p);
    expect(edge(f, [0, 0, 0], [1, 0, 1])?.traversal_class).toBe("traversal:diagonal");
    f.set([1, 1, 0], "blocked");
    expect(edge(f, [0, 0, 0], [1, 0, 1])).toBeUndefined();
    expect(edge(f, [0, 0, 0], [0, 0, 1])).toBeDefined();
    expect(edge(f, [0, 0, 1], [1, 0, 1])).toBeDefined();
  });

  it("ascent: includes one-block transition only with source jump headroom", () => {
    const f = fixture(); f.stand([0, 0, 0]); f.stand([1, 1, 0]);
    expect(edge(f, [0, 0, 0], [1, 1, 0])).toBeUndefined();
    f.set([0, 2, 0], "empty");
    expect(edge(f, [0, 0, 0], [1, 1, 0])?.traversal_class).toBe("traversal:ascend");
    f.set([1, 2, 0], "blocked");
    expect(edge(f, [0, 0, 0], [1, 1, 0])).toBeUndefined();
  });

  it("narrow cave: a two-cell column is allowed but a one-cell crawl is unsupported", () => {
    const f = fixture(); f.stand([0, 0, 0]); f.stand([0, 0, 1]);
    expect(edge(f, [0, 0, 0], [0, 0, 1])).toBeDefined();
    f.set([0, 1, 1], "blocked");
    expect(edge(f, [0, 0, 0], [0, 0, 1])).toBeUndefined();
    expect(compile(f).rejected).toContainEqual({ position: [0, 0, 1], reason: "blocked" });
  });

  it("descent: checks swept head clearance, not just the landing stance", () => {
    const f = fixture(); f.stand([0, 1, 0]); f.stand([1, 0, 0]);
    expect(compile(f).graph?.nodes).toHaveLength(2);
    expect(edge(f, [0, 1, 0], [1, 0, 0])).toBeUndefined();
    f.set([1, 2, 0], "empty");
    expect(edge(f, [0, 1, 0], [1, 0, 0])?.traversal_class).toBe("traversal:descend");
  });

  it("deep fall: does not connect a two-block drop", () => {
    const f = fixture(); f.stand([0, 2, 0]); f.stand([1, 0, 0]); f.set([1, 2, 0], "empty");
    expect(compile(f).graph?.nodes).toHaveLength(2);
    expect(compile(f).graph?.edges).toHaveLength(0);
  });

  it.each(["empty", "blocked", "unsupported", "unknown", "fluid", "hazard"] as Kind[])(
    "support: %s is never silently treated as a full-cube foothold", support => {
      const f = fixture(); f.stand([0, 0, 0]); f.set([0, -1, 0], support);
      expect(compile(f).graph?.nodes.some(n => n.node_id === nid([0, 0, 0])) ?? false).toBe(false);
    },
  );

  it.each(["hazard", "fluid"] as Kind[])("%s margin excludes the short corridor but preserves a dry detour", hazard => {
    const f = fixture();
    for (const p of [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0],
      [0, 0, 1], [0, 0, 2], [1, 0, 2], [2, 0, 2], [3, 0, 2]] as Point[]) f.stand(p);
    f.set([2, 0, -1], hazard);
    expect(edge(f, [0, 0, 0], [1, 0, 0])).toBeUndefined();
    for (const [a, b] of [[[0, 0, 0], [0, 0, 1]], [[0, 0, 1], [0, 0, 2]],
      [[0, 0, 2], [1, 0, 2]], [[1, 0, 2], [2, 0, 2]], [[2, 0, 2], [3, 0, 2]]] as [Point, Point][]) {
      expect(edge(f, a, b)).toBeDefined();
    }
  });

  it("missing coverage: removes unsafe nodes, retains an explicit reachable frontier", () => {
    const f = fixture(); f.stand([0, 0, 0]); f.stand([1, 0, 0]); f.cells.delete("2/0/0");
    expect(f.snapshot().coverage_state).toBe("partial_with_unknown_regions");
    expect(compile(f).graph?.nodes.map(n => n.node_id)).toEqual([nid([0, 0, 0])]);
    expect(compile(f).graph?.frontiers).toContainEqual(expect.objectContaining({ at_node_id: nid([0, 0, 0]), reason: "coverage_boundary" }));
    expect(compile(f).graph?.edges).toHaveLength(0);
  });

  it("unsupported adjacent shapes are unknown, not passable negative space", () => {
    const f = fixture(); f.stand([0, 0, 0]); f.set([1, 0, 0], "unsupported");
    expect(compile(f)).toMatchObject({ status: "no_supported_footholds", graph: null });
  });

  it("is invariant to input order and repeated invocation without mutating inputs", () => {
    const f = fixture(); f.stand([-1, 0, 0]); f.stand([0, 0, 0]);
    const input = f.input(), before = JSON.stringify(input);
    const a = buildMinecraftVoxelSnapshot(input);
    const b = buildMinecraftVoxelSnapshot({ ...input, cells: [...input.cells].reverse() });
    expect(a).toEqual(b);
    expect(compileMinecraftVoxelTopology(a, context(a))).toEqual(compileMinecraftVoxelTopology(b, context(b)));
    expect(JSON.stringify(input)).toBe(before);
  });

  it("changed terrain changes the graph hash and cannot reuse a previous snapshot pin", () => {
    const f = fixture(); f.stand([0, 0, 0]); f.stand([1, 0, 0]);
    const a = f.snapshot(), before = compile(f).graph!;
    f.set([1, 1, 0], "blocked");
    const b = f.snapshot();
    expect(compile(f).graph!.graph_hash).not.toBe(before.graph_hash);
    expect(() => compileMinecraftVoxelTopology(b, context(a))).toThrow("snapshot_mismatch");
  });
});

describe("NAV1-D evidence identity, input and work bounds", () => {
  it.each(Object.keys(identity) as (keyof typeof identity)[])("rejects mismatched %s", field => {
    const s = fixture().snapshot(), ctx = context(s);
    (ctx.expected_identity as Record<string, unknown>) = { ...identity, [field]: typeof identity[field] === "number" ? 99 : "other:identity" };
    expect(() => compileMinecraftVoxelTopology(s, ctx)).toThrow("identity_mismatch");
  });
  it.each(["2026-09-09T01:10:01.001Z", "2026-09-09T01:09:59.999Z"])("rejects stale/future snapshot at %s", at => {
    const s = fixture().snapshot();
    expect(() => compileMinecraftVoxelTopology(s, { ...context(s), now: at })).toThrow("stale_or_future_snapshot");
  });
  it("accepts exact age limit and rejects tampered content", () => {
    const s = fixture().snapshot();
    expect(() => compileMinecraftVoxelTopology(s, { ...context(s), now: "2026-09-09T01:10:01.000Z" })).not.toThrow();
    expect(() => compileMinecraftVoxelTopology({ ...s, captured_at: "2026-09-09T01:09:59.000Z" }, context(s))).toThrow();
  });
  it("rejects duplicate, out-of-bounds and oversized voxel inputs", () => {
    const input = fixture().input();
    expect(() => buildMinecraftVoxelSnapshot({ ...input, cells: [...input.cells, input.cells[0]] })).toThrow("duplicate_cell");
    expect(() => buildMinecraftVoxelSnapshot({ ...input, cells: [{ position: [10, 0, 0], collision: "empty" }] })).toThrow("cell_outside_bounds");
    expect(() => buildMinecraftVoxelSnapshot({ ...input, maximum: [1000, 1000, 1000] })).toThrow("volume_budget_exceeded");
    expect(() => buildMinecraftVoxelSnapshot({ ...input, cells: Array(4097).fill(input.cells[0]) })).toThrow();
    expect(() => buildMinecraftVoxelSnapshot({ ...input, minimum: [5, 0, 0] })).toThrow("invalid_bounds");
  });
  it("rejects false complete coverage even when the neutral hash is recomputed", () => {
    const f = fixture(); f.cells.delete("0/0/0");
    const s = reseal({ ...f.snapshot(), coverage_state: "complete_within_bounds", unknown_region_ids: [] });
    expect(() => compileMinecraftVoxelTopology(s, context(s))).toThrow("false_complete_coverage");
  });
  it("does not accept a generic SOLID/native frontier label as collision evidence", () => {
    const s = fixture().snapshot(); s.features[0].geometry.collision = "SOLID";
    const sealed = reseal(s);
    expect(() => compileMinecraftVoxelTopology(sealed, context(sealed))).toThrow();
  });
  it("rejects unknown profiles, dynamic cells and contradictory hazard annotations", () => {
    const s = fixture().snapshot();
    for (const changed of [
      { ...s, adapter_profile: { profile_id: "minecraft:native" } },
      { ...s, features: s.features.map((f, i) => i === 0 ? { ...f, dynamic: true } : f) },
      { ...s, features: s.features.map((f, i) => i === 0 ? { ...f, hazard_ids: ["hazard:hidden"] } : f) },
      { ...s, features: s.features.map((f, i) => i === 0 ? { ...f, traversability: "blocked" as const } : f) },
      { ...s, features: s.features.map((f, i) => i === 0 ? { ...f, feature_id: "cell:elsewhere" } : f) },
    ]) {
      const sealed = reseal(changed);
      expect(() => compileMinecraftVoxelTopology(sealed, context(sealed))).toThrow();
    }
  });
  it("fails the whole compilation on node/edge budget exhaustion", () => {
    const f = fixture(); f.stand([0, 0, 0]); f.stand([1, 0, 0]);
    const s = f.snapshot();
    expect(() => compileMinecraftVoxelTopology(s, { ...context(s), maximum_nodes: 1 })).toThrow("node_budget_exceeded");
    expect(() => compileMinecraftVoxelTopology(s, { ...context(s), maximum_edges: 0 })).toThrow("edge_budget_exceeded");
  });
  it("allows no caller-authored execution flag or malformed budget", () => {
    const s = fixture().snapshot();
    expect(() => compileMinecraftVoxelTopology(s, { ...context(s), execution_authority: true } as never)).toThrow();
    expect(() => compileMinecraftVoxelTopology(s, { ...context(s), maximum_nodes: Infinity })).toThrow();
    expect(() => compileMinecraftVoxelTopology(s, { ...context(s), maximum_age_ms: NaN })).toThrow();
  });
  it("handles the maximum bounded volume and rejects oversized evidence before compilation", () => {
    const input = fixture().input();
    const cells: MinecraftVoxelFixtureInput["cells"] = [];
    for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) {
      cells.push({ position: [x, y, z], collision: "blocked" });
    }
    const s = buildMinecraftVoxelSnapshot({ ...input, minimum: [0, 0, 0], maximum: [15, 15, 15], cells });
    expect(compileMinecraftVoxelTopology(s, context(s))).toMatchObject({ cell_count: 4096, transition_checks: 0, graph: null });
    expect(() => compileMinecraftVoxelTopology({ padding: "x".repeat(2 * 1024 * 1024) }, context(s))).toThrow("evidence_budget_exceeded");
  });
  it("dense floor: has exact bounded topology and explicit outer frontiers", () => {
    const input = fixture().input();
    const cells: MinecraftVoxelFixtureInput["cells"] = [];
    for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) for (let z = 0; z < 16; z++) {
      cells.push({ position: [x, y, z], collision: y === 0 ? "full_cube" : y <= 2 ? "empty" : "blocked" });
    }
    const s = buildMinecraftVoxelSnapshot({ ...input, minimum: [0, 0, 0], maximum: [15, 3, 15], cells });
    const r = compileMinecraftVoxelTopology(s, context(s));
    expect(r.graph?.nodes).toHaveLength(196);
    expect(r.graph?.edges).toHaveLength(1404);
    expect(r.graph?.frontiers).toHaveLength(52);
    expect(r.transition_checks).toBe(196 * 16);
  });
});
