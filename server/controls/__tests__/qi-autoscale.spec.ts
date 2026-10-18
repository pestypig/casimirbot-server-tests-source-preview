import { describe, expect, it } from "vitest";
import { initQiAutoscaleState, stepQiAutoscale, type QiAutoscaleClampReason } from "../qi-autoscale.js";

describe("qi-autoscale step", () => {
  it("drives scale toward the target ratio with floor enforcement", () => {
    const clamps: QiAutoscaleClampReason[] = [];
    const next = stepQiAutoscale({
      enable: true,
      target: 0.9,
      minScale: 0.03,
      slewPerSec: 0.25,
      windowTol: 0.05,
      zetaRaw: 29.0,
      sumWindowDt: 1,
      rhoSource: "tile-telemetry",
      dt_s: 4, // let slew settle
      prev: initQiAutoscaleState(0.9, 0),
      clamps,
    });

    expect(next.engaged).toBe(true);
    expect(next.gating).toBe("active");
    expect(next.appliedScale).toBeCloseTo(0.031, 3);
    expect(clamps.some((c) => c.kind === "min_scale")).toBe(false);
  });

  it("relaxes toward unity when the source or window gating blocks engagement", () => {
    const first = stepQiAutoscale({
      enable: true,
      target: 0.9,
      minScale: 0.03,
      slewPerSec: 0.25,
      windowTol: 0.05,
      zetaRaw: 1.2,
      sumWindowDt: 1.2,
      rhoSource: "telemetry-offline",
      dt_s: 1,
      prev: initQiAutoscaleState(0.9, 0),
    });

    expect(first.engaged).toBe(false);
    expect(first.appliedScale).toBeGreaterThan(0.9);
    expect(first.gating).toContain("window_bad");
    expect(first.gating).toContain("source_mismatch");
  });

  it("records slew limiting when only partial wall-time is available", () => {
    const clamps: QiAutoscaleClampReason[] = [];
    const next = stepQiAutoscale({
      enable: true,
      target: 0.9,
      minScale: 0.03,
      slewPerSec: 0.25,
      windowTol: 0.05,
      zetaRaw: 10,
      sumWindowDt: 1,
      rhoSource: "tile-telemetry",
      dt_s: 0.5,
      prev: initQiAutoscaleState(0.9, 0),
      clamps,
    });

    expect(next.engaged).toBe(true);
    expect(next.appliedScale).toBeGreaterThan(next.proposedScale ?? 0);
    expect(clamps.some((c) => c.kind === "slew_limit")).toBe(true);
  });

  it("drives toward the target ratio linearly and recomputes guard inputs", () => {
    const clamps: QiAutoscaleClampReason[] = [];
    const next = stepQiAutoscale({
      enable: true,
      target: 0.9,
      minScale: 0.03,
      slewPerSec: 0.35,
      windowTol: 0.05,
      zetaRaw: 2.65,
      sumWindowDt: 1,
      rhoSource: "tile-telemetry",
      dt_s: 4, // allow full slew for a single tick
      prev: initQiAutoscaleState(0.9, 0),
      clamps,
    });

    expect(next.engaged).toBe(true);
    expect(next.gating).toBe("active");
    expect(next.proposedScale).toBeCloseTo(0.3396, 4);
    expect(next.appliedScale).toBeCloseTo(0.3396, 4);
    expect(clamps.length).toBe(0);
    expect(next.rawZeta).toBeCloseTo(2.65, 2);
  });
});
