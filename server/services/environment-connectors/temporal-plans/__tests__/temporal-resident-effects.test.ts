import { describe, expect, it } from "vitest";
import { verifyTemporalResidentEffects, temporalResidentResultEffectsValid } from "../temporal-event-plan";

const sample = (patch: Record<string, unknown> = {}) => ({
  player_motion_performed: false, player_interaction_performed: false,
  inventory_mutation_performed: false, world_mutations_performed: 0,
  inventory_mutations_performed: 0, ...patch,
});
const fixture = () => {
  const history = [sample({ player_motion_performed: true, world_mutations_performed: 2, inventory_mutations_performed: 3 }),
    sample({ world_mutations_performed: 1, inventory_mutations_performed: 4 })];
  const current: Record<string, unknown> = { ...sample(), completed_sequence_measurements: history,
    resident_handoff_count: 2, resident_effect_totals: {
      player_motion_performed: true, player_interaction_performed: false,
      inventory_mutation_performed: true, world_mutations_performed: 3,
      inventory_mutations_performed: 7, world_mutation_performed: true, side_effects_performed: true,
    } };
  return { current, chain: [...history, current].map(measurements => ({ measurements })) };
};

describe("resident effect arithmetic over validated temporal chains", () => {
  it("requires final result flags to match recorded cumulative effects", () => {
    const { current } = fixture();
    const flags = { player_motion_performed: true, player_interaction_performed: false,
      inventory_mutation_performed: true, world_mutation_performed: true, side_effects_performed: true };
    expect(temporalResidentResultEffectsValid(current, flags)).toBe(true);
    for (const key of Object.keys(flags) as Array<keyof typeof flags>) {
      expect(temporalResidentResultEffectsValid(current, { ...flags, [key]: !flags[key] })).toBe(false);
    }
    expect(temporalResidentResultEffectsValid({ ...current, resident_handoff_count: 1 }, flags)).toBe(false);
    expect(temporalResidentResultEffectsValid({ ...current, completed_sequence_measurements: [null] }, flags)).toBe(false);
    expect(temporalResidentResultEffectsValid({ ...current, resident_effect_totals: {} }, flags)).toBe(false);
  });
  it("preserves earlier effects when the current plan is quiet without changing local measurements", () => {
    const { current, chain } = fixture();
    const before = JSON.stringify(chain);
    expect(() => verifyTemporalResidentEffects(current, chain)).not.toThrow();
    expect(JSON.stringify(chain)).toBe(before);
    expect(current.player_motion_performed).toBe(false);
  });
  it.each(["player_motion_performed", "player_interaction_performed", "inventory_mutation_performed",
    "world_mutation_performed", "side_effects_performed", "world_mutations_performed", "inventory_mutations_performed"])(
    "rejects falsified %s", key => {
      const { current, chain } = fixture();
      const totals = current.resident_effect_totals as Record<string, unknown>;
      totals[key] = typeof totals[key] === "boolean" ? !totals[key] : 99;
      expect(() => verifyTemporalResidentEffects(current, chain)).toThrow("totals_mismatch");
    });
  it.each([-1, 0.5, NaN, Infinity, "1", undefined, Number.MAX_SAFE_INTEGER + 1])("rejects invalid count %s", value => {
    const { current, chain } = fixture();
    chain[0].measurements.world_mutations_performed = value;
    expect(() => verifyTemporalResidentEffects(current, chain)).toThrow("measurement_invalid");
  });
  it("rejects overflow, missing boolean evidence, missing/extra totals, and wrong chain endpoint", () => {
    let f = fixture();
    f.chain[0].measurements.world_mutations_performed = Number.MAX_SAFE_INTEGER;
    expect(() => verifyTemporalResidentEffects(f.current, f.chain)).toThrow("total_overflow");
    f = fixture(); delete f.chain[0].measurements.player_motion_performed;
    expect(() => verifyTemporalResidentEffects(f.current, f.chain)).toThrow("measurement_invalid");
    f = fixture(); delete f.current.resident_effect_totals;
    expect(() => verifyTemporalResidentEffects(f.current, f.chain)).toThrow("totals_invalid");
    f = fixture(); (f.current.resident_effect_totals as Record<string, unknown>).execution_authority = true;
    expect(() => verifyTemporalResidentEffects(f.current, f.chain)).toThrow("totals_mismatch");
    f = fixture();
    expect(() => verifyTemporalResidentEffects(f.current, f.chain.slice(0, -1))).toThrow("totals_invalid");
  });
  it("leaves legacy finite measurements alone", () => {
    expect(() => verifyTemporalResidentEffects({}, [])).not.toThrow();
  });
});
