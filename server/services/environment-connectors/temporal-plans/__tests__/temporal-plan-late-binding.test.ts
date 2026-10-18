import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  helixEnvironmentTemporalPlanSchema,
  type HelixEnvironmentAffordanceFrontier,
} from "@shared/helix-environment-time";
import { compileEnvironmentTimePlanToMinecraftFluidSequenceArtifact } from "../minecraft-environment-time-compiler";
import { bindTemporalPlanToFreshFrontier } from "../temporal-plan-late-binding";

const fixture = JSON.parse(readFileSync(
  "docs/evidence/eh-g8-nav-direct-mcp-execution-qualification-v1/2026-09-20-arena-v3-root-draft.json",
  "utf8",
));
const frontier = {
  identity: { ...fixture.identity, observation_revision: 42, affordance_revision: 7 },
  clocks: { audit_at: "2026-10-08T16:00:00.000Z" },
} as HelixEnvironmentAffordanceFrontier;
const residentClock = { tick_index: 20_000,
  monotonic: { origin_id: "minecraft_monotonic_clock:current", elapsed_ms: 1_000_000 } };

it("binds authored movement to the fresh frontier without accepting injected identity or clocks", () => {
  const plan = bindTemporalPlanToFreshFrontier({
    draft: fixture,
    frontier,
    residentClock,
    deadlineAfterMs: 5_000,
  });
  expect(helixEnvironmentTemporalPlanSchema.parse(plan)).toEqual(plan);
  expect(plan.identity).toEqual(frontier.identity);
  expect(plan.clocks.environment.sequence).toBe(20_000);
  expect(plan.clocks.monotonic).toEqual(residentClock.monotonic);
  expect(plan.clocks.audit_at).toBe(frontier.clocks.audit_at);
  expect(plan.monotonic_deadline_elapsed_ms).toBe(1_005_000);
  expect(plan.nodes).toEqual(fixture.nodes);
  expect(compileEnvironmentTimePlanToMinecraftFluidSequenceArtifact({ plan,
    mutation_scope: { world_mutation_allowed: false, max_block_mutations: 0,
      max_inventory_transfers: 0, allowed_block_ids: [], allowed_regions: [], combat_allowed: false },
    resource_bindings: { "resource:locomotion": "locomotion" },
  }).arguments.nodes.length).toBeGreaterThan(0);
});

it("replaces a prehashed draft's stale hash when binding a new frontier", () => {
  const first = bindTemporalPlanToFreshFrontier({ draft: fixture, frontier,
    residentClock, deadlineAfterMs: 5_000 });
  const nextFrontier = { ...frontier, identity: {
    ...frontier.identity, observation_revision: frontier.identity.observation_revision + 1,
  } };
  const rebound = bindTemporalPlanToFreshFrontier({ draft: first, frontier: nextFrontier,
    residentClock: { ...residentClock, tick_index: residentClock.tick_index + 1 },
    deadlineAfterMs: 5_000 });
  expect(helixEnvironmentTemporalPlanSchema.parse(rebound)).toEqual(rebound);
  expect(rebound.plan_hash).not.toBe(first.plan_hash);
  expect(rebound.identity).toEqual(nextFrontier.identity);
});

it("truncates a fractional native monotonic clock without inventing future time", () => {
  const plan = bindTemporalPlanToFreshFrontier({ draft: fixture, frontier,
    residentClock: { ...residentClock, monotonic: {
      origin_id: residentClock.monotonic.origin_id, elapsed_ms: 1_000_000.3043,
    } }, deadlineAfterMs: 5_000 });
  expect(plan.clocks.monotonic.elapsed_ms).toBe(1_000_000);
  expect(plan.monotonic_deadline_elapsed_ms).toBe(1_005_000);
  expect(helixEnvironmentTemporalPlanSchema.parse(plan)).toEqual(plan);
});

it.each([999, 15_001, Number.NaN])("rejects an invalid deadline %s", deadlineAfterMs => {
  expect(() => bindTemporalPlanToFreshFrontier({ draft: fixture, frontier,
    residentClock, deadlineAfterMs })).toThrow("temporal_plan_late_binding_clock_invalid");
});

it("rejects an invalid measured clock", () => {
  expect(() => bindTemporalPlanToFreshFrontier({ draft: fixture, frontier,
    residentClock: { ...residentClock, tick_index: -1 }, deadlineAfterMs: 5_000 }))
    .toThrow("temporal_plan_late_binding_clock_invalid");
});
