import { describe, expect, it } from "vitest";
import { stepTsAutoscale } from "../ts-autoscale.js";

describe("ts-autoscale", () => {
  it("idles when TS already meets target", () => {
    const result = stepTsAutoscale({
      enable: true,
      targetTS: 100,
      slewPerSec: 0.25,
      floor_ns: 20,
      windowTol: 0.05,
      TS_ratio: 110,
      tauPulse_ns: 30,
      dt_s: 1,
      prevBurst_ns: 30,
    });

    expect(result.engaged).toBe(false);
    expect(result.gating).toContain("ts_safe");
    expect(result.appliedBurst_ns).toBe(30);
  });

  it("treats near-target TS as safe to avoid oscillating engagement", () => {
    const result = stepTsAutoscale({
      enable: true,
      targetTS: 120,
      slewPerSec: 0.25,
      floor_ns: 20,
      windowTol: 0.05,
      TS_ratio: 119.9, // within jitter window
      tauPulse_ns: 28,
      dt_s: 1,
      prevBurst_ns: 28,
    });

    expect(result.engaged).toBe(false);
    expect(result.gating).toContain("ts_safe");
  });

  it("slew-limits toward a shorter burst when TS is below target", () => {
    const result = stepTsAutoscale({
      enable: true,
      targetTS: 100,
      slewPerSec: 0.25,
      floor_ns: 20,
      windowTol: 0.05,
      TS_ratio: 50,
      tauPulse_ns: 60,
      dt_s: 4, // enough wall-time to settle at the requested burst
      prevBurst_ns: 60,
    });

    expect(result.engaged).toBe(true);
    expect(result.appliedBurst_ns).toBeCloseTo(30, 1); // 60 ns * (50/100)
    expect(result.proposedBurst_ns).toBeCloseTo(30, 1);
  });

  it("guards against timing mismatch before engaging", () => {
    const result = stepTsAutoscale({
      enable: true,
      targetTS: 100,
      slewPerSec: 0.25,
      floor_ns: 20,
      windowTol: 0.05,
      TS_ratio: 50,
      tauPulse_ns: 50,
      dt_s: 1,
      prevBurst_ns: 100, // >5% mismatch against tauPulse_ns
    });

    expect(result.engaged).toBe(false);
    expect(result.gating).toContain("window_bad");
    expect(result.appliedBurst_ns).toBe(100);
  });

  it("shrinks monotonically until TS meets target and then idles", () => {
    const tauLC_ns = 1_000_000; // 1 ms light-crossing
    const targetTS = 120;
    let prevBurst = 10_000; // 10 µs
    const targetBurst = tauLC_ns / targetTS;
    const applied: number[] = [];
    const gating: string[] = [];

    for (let i = 0; i < 8; i++) {
      const tsRatio = tauLC_ns / prevBurst;
      const next = stepTsAutoscale({
        enable: true,
        targetTS,
        slewPerSec: 0.25,
        floor_ns: 20,
        windowTol: 0.05,
        TS_ratio: tsRatio,
        tauPulse_ns: prevBurst,
        dt_s: 2,
        prevBurst_ns: prevBurst,
      });
      applied.push(next.appliedBurst_ns);
      gating.push(next.gating);
      if (gating.length > 1) {
        expect(applied[applied.length - 1]).toBeLessThanOrEqual(applied[applied.length - 2]);
      }
      prevBurst = next.appliedBurst_ns;
      if (next.gating.includes("ts_safe")) break;
    }

    expect(gating.some((g) => g === "active")).toBe(true);
    expect(gating[gating.length - 1]).toContain("ts_safe");
    expect(prevBurst).toBeLessThanOrEqual(targetBurst * 1.01);
  });
});
