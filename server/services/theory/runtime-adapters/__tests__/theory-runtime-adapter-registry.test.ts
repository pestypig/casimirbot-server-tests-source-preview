import { beforeEach, describe, expect, it } from "vitest";
import {
  clearTheoryRuntimeAdapterRegistryForTests,
  findTheoryRuntimeAdaptersForBadge,
  findTheoryRuntimeAdaptersForLane,
  getTheoryRuntimeAdapter,
  listTheoryRuntimeAdapters,
  registerTheoryRuntimeAdapter,
  type TheoryRuntimeAdapter,
} from "../theory-runtime-adapter-registry";

function adapter(overrides: Partial<TheoryRuntimeAdapter> = {}): TheoryRuntimeAdapter {
  const runtimeId = overrides.runtimeId ?? "test.runtime";
  return {
    runtimeId,
    family: overrides.family ?? "generic_runtime",
    laneId: overrides.laneId ?? "test_lane",
    capabilities: overrides.capabilities ?? ["static_reference"],
    supportedBadgeIds: overrides.supportedBadgeIds ?? ["test.badge"],
    canHandle:
      overrides.canHandle ??
      ((input) =>
        input.runtimeId === runtimeId ||
        input.laneId === (overrides.laneId ?? "test_lane") ||
        Boolean(input.badgeIds?.some((badgeId) => (overrides.supportedBadgeIds ?? ["test.badge"]).includes(badgeId)))),
    buildReferenceTrace: overrides.buildReferenceTrace,
    readArtifacts: overrides.readArtifacts,
    runQuick: overrides.runQuick,
    createManifest: overrides.createManifest,
  };
}

describe("theory runtime adapter registry", () => {
  beforeEach(() => {
    clearTheoryRuntimeAdapterRegistryForTests();
  });

  it("rejects duplicate runtimeId registrations", () => {
    const first = adapter({ runtimeId: "duplicate.runtime" });
    const second = adapter({ runtimeId: "duplicate.runtime" });

    registerTheoryRuntimeAdapter(first);

    expect(() => registerTheoryRuntimeAdapter(second)).toThrow(/already registered/i);
    expect(getTheoryRuntimeAdapter("duplicate.runtime")).toBe(first);
  });

  it("finds adapters by supported badge", () => {
    const solar = adapter({
      runtimeId: "solar.pipeline",
      laneId: "solar_surface_spectrum",
      supportedBadgeIds: ["solar.spectrum.photon_energy", "solar.spectrum.doppler_shift"],
    });
    const casimir = adapter({
      runtimeId: "casimir.verify",
      laneId: "casimir_cavity_modes",
      supportedBadgeIds: ["casimir.cavity.parallel_plate_energy_density"],
    });

    registerTheoryRuntimeAdapter(solar);
    registerTheoryRuntimeAdapter(casimir);

    expect(findTheoryRuntimeAdaptersForBadge("solar.spectrum.photon_energy")).toEqual([solar]);
  });

  it("finds adapters by lane", () => {
    const warp = adapter({
      runtimeId: "warp.full_solve.campaign",
      laneId: "warp_gr_nhm2",
      supportedBadgeIds: ["nhm2.claim_boundary.diagnostic_only"],
    });
    const qei = adapter({
      runtimeId: "physics.validate",
      laneId: "qei_stress_energy",
      supportedBadgeIds: ["nhm2.qei.sampling_window"],
    });

    registerTheoryRuntimeAdapter(warp);
    registerTheoryRuntimeAdapter(qei);

    expect(findTheoryRuntimeAdaptersForLane("warp_gr_nhm2")).toEqual([warp]);
  });

  it("returns empty lists for missing badge or lane adapters", () => {
    registerTheoryRuntimeAdapter(adapter({ runtimeId: "known.runtime" }));

    expect(findTheoryRuntimeAdaptersForBadge("missing.badge")).toEqual([]);
    expect(findTheoryRuntimeAdaptersForLane("missing_lane")).toEqual([]);
  });

  it("lists registered adapters without executing commands", () => {
    const staticOnly = adapter({
      runtimeId: "static.reference",
      capabilities: ["static_reference", "artifact_reader"],
    });

    registerTheoryRuntimeAdapter(staticOnly);

    expect(listTheoryRuntimeAdapters()).toEqual([staticOnly]);
    expect(staticOnly.capabilities).toContain("static_reference");
  });
});
