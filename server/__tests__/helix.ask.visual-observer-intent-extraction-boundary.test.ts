import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hasAskTurnVisualObserverProfileCue } from "../services/helix-ask/live-source/visual-observer-intent";

const repoRoot = process.cwd();
const routeSource = readFileSync(join(repoRoot, "server/routes/agi.plan.ts"), "utf8");
const serviceSource = readFileSync(
  join(repoRoot, "server/services/helix-ask/live-source/visual-observer-intent.ts"),
  "utf8",
);

describe("Helix Ask visual-observer intent extraction boundary", () => {
  it("keeps visual-observer cue implementation out of the route", () => {
    expect(routeSource).toContain("../services/helix-ask/live-source/visual-observer-intent");
    expect(routeSource).not.toMatch(/const\s+hasAskTurnVisualObserverProfileCue\s*=\s*\(/);
    expect(serviceSource).toMatch(/export\s+const\s+hasAskTurnVisualObserverProfileCue\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
  });

  it("preserves visual-observer cue detection", () => {
    expect(hasAskTurnVisualObserverProfileCue("live_env.configure_visual_observer_profile")).toBe(true);
    expect(hasAskTurnVisualObserverProfileCue("Apply the visual observer shades to this source.")).toBe(true);
    expect(hasAskTurnVisualObserverProfileCue("Replay selected frames with the Minecraft gameplay observer.")).toBe(true);
    expect(hasAskTurnVisualObserverProfileCue(
      "Make the visual capture focus on HUD, hotbar, mobs, health, and hunger.",
    )).toBe(true);
    expect(hasAskTurnVisualObserverProfileCue("Summarize the current document.")).toBe(false);
  });
});
