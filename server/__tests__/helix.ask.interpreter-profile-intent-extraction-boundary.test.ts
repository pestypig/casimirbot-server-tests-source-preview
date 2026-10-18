import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  hasAskTurnInterpreterProfileComparisonCue,
  hasAskTurnInterpreterProfileConfigCue,
  hasAskTurnInterpreterProfileManagementCue,
} from "../services/helix-ask/live-source/interpreter-profile-intent";

const repoRoot = process.cwd();
const routeSource = readFileSync(join(repoRoot, "server/routes/agi.plan.ts"), "utf8");
const serviceSource = readFileSync(
  join(repoRoot, "server/services/helix-ask/live-source/interpreter-profile-intent.ts"),
  "utf8",
);

describe("Helix Ask interpreter-profile intent extraction boundary", () => {
  it("keeps interpreter-profile cue implementation out of the route", () => {
    expect(routeSource).toContain("../services/helix-ask/live-source/interpreter-profile-intent");
    expect(routeSource).not.toMatch(/const\s+hasAskTurnInterpreterProfileConfigCue\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+hasAskTurnInterpreterProfileManagementCue\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+hasAskTurnInterpreterProfileComparisonCue\s*=\s*\(/);
    expect(serviceSource).toMatch(/export\s+const\s+hasAskTurnInterpreterProfileConfigCue\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+hasAskTurnInterpreterProfileManagementCue\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+hasAskTurnInterpreterProfileComparisonCue\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
  });

  it("preserves interpreter-profile cue detection", () => {
    expect(hasAskTurnInterpreterProfileConfigCue(
      "Create a Minecraft Survival Coach interpreter profile for this live source.",
    )).toBe(true);
    expect(hasAskTurnInterpreterProfileConfigCue(
      "Save this as an interpreter skill.",
    )).toBe(true);
    expect(hasAskTurnInterpreterProfileManagementCue(
      "Apply the Minecraft Survival Coach profile note.",
    )).toBe(true);
    expect(hasAskTurnInterpreterProfileComparisonCue(
      "Compare the mailbox observations against the active interpreter profile.",
    )).toBe(true);
    expect(hasAskTurnInterpreterProfileComparisonCue(
      "Why did you suppress this callout?",
    )).toBe(true);
  });
});
