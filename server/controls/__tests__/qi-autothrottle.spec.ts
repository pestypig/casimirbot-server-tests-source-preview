import { describe, expect, it } from "vitest";
import {
  applyQiAutothrottleStep,
  applyScaleToGatePulses,
  applyScaleToPumpCommand,
  computeScaleFromZetaRaw,
  initQiAutothrottle,
} from "../qi-autothrottle.js";

describe("qi-autothrottle controller", () => {
  it("computes target scale and smooths toward it", () => {
    const state = { ...initQiAutothrottle(), enabled: true };
    const scale = computeScaleFromZetaRaw(2.65, state.target);
    expect(scale).toBeCloseTo(0.3396, 4);

    const next = applyQiAutothrottleStep(state, 2.65, 1_000);
    expect(next.scale).toBeCloseTo(0.8349, 4);
    expect(next.lastUpdateMs).toBe(1_000);
    expect(next.reason).toContain("zetaRaw=2.650");
  });

  it("respects deadband around the target", () => {
    const state = { ...initQiAutothrottle(), enabled: true, scale: 0.4, lastUpdateMs: 5000 };
    const next = applyQiAutothrottleStep(state, 0.92, 6000);
    expect(next).toBe(state);
  });

  it("honors cooldown before reapplying control", () => {
    const state = { ...initQiAutothrottle(), enabled: true, scale: 0.5, lastUpdateMs: 1000 };
    const next = applyQiAutothrottleStep(state, 1.8, 1500);
    expect(next).toBe(state);
  });

  it("clamps scale at the configured minimum for large zetaRaw", () => {
    const state = { ...initQiAutothrottle(), enabled: true };
    const scale = computeScaleFromZetaRaw(1_000, state.target);
    expect(scale).toBeCloseTo(0.02, 5);
  });
});

describe("qi-autothrottle scaling helpers", () => {
  it("scales pump tone depths", () => {
    const cmd = {
      tones: [
        { omega_hz: 1, depth: 2, phase_deg: 0 },
        { omega_hz: 2, depth: 4, phase_deg: 90 },
      ],
      rho0: 1,
      issuedAt_ms: 0,
    };
    const scaled = applyScaleToPumpCommand(cmd, 0.25);
    expect(scaled?.tones[0].depth).toBeCloseTo(0.5, 3);
    expect(scaled?.tones[1].depth).toBeCloseTo(1, 3);
    expect(cmd.tones[0].depth).toBe(2);
  });

  it("clamps depths and scales stroke amplitude when present", () => {
    const cmd = {
      tones: [{ omega_hz: 1, depth: 5, phase_deg: 0 }],
      rho0: 0,
      issuedAt_ms: 0,
      strokeAmplitudePm: 100,
    };
    const scaled = applyScaleToPumpCommand(cmd as any, 0.5);
    expect(scaled?.tones[0].depth).toBeCloseTo(1, 6); // clamped
    expect((scaled as any).strokeAmplitudePm).toBeCloseTo(50, 6);
  });

  it("scales gate pulse amplitudes and nested tones", () => {
    const pulses = [
      { rho: 10, tones: [{ omega_hz: 1, depth: 2, phase_deg: 0 }] },
      { rho: 5, tones: [{ omega_hz: 2, depth: 1, phase_deg: 45 }] },
    ];
    const scaled = applyScaleToGatePulses(pulses as any, 0.5);
    expect(scaled?.[0].rho).toBeCloseTo(5, 3);
    expect(scaled?.[0].tones?.[0].depth).toBeCloseTo(1, 3);
    expect(pulses[0].rho).toBe(10);
  });
});
