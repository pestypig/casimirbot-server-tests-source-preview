import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hasAskTurnLiveSourceStandingWatchCue } from "../services/helix-ask/live-source/mail-watch-intent";

const repoRoot = process.cwd();
const routeSource = readFileSync(join(repoRoot, "server/routes/agi.plan.ts"), "utf8");
const serviceSource = readFileSync(
  join(repoRoot, "server/services/helix-ask/live-source/mail-watch-intent.ts"),
  "utf8",
);

describe("Helix Ask live-source mail watch intent extraction boundary", () => {
  it("keeps standing watch cue implementation out of the route", () => {
    expect(routeSource).toContain("../services/helix-ask/live-source/mail-watch-intent");
    expect(routeSource).not.toMatch(/const\s+hasAskTurnLiveSourceStandingWatchCue\s*=\s*\(/);
    expect(serviceSource).toMatch(/export\s+const\s+hasAskTurnLiveSourceStandingWatchCue\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
  });

  it("preserves standing watch cue detection", () => {
    expect(hasAskTurnLiveSourceStandingWatchCue(
      "Watch the new mail summary and tell me what changed.",
    )).toBe(true);
    expect(hasAskTurnLiveSourceStandingWatchCue(
      "Whenever the visual summary comes in, report it.",
    )).toBe(true);
    expect(hasAskTurnLiveSourceStandingWatchCue(
      "Keep an eye on the visual source.",
    )).toBe(true);
    expect(hasAskTurnLiveSourceStandingWatchCue(
      "Watch the Minecraft video predictor contract.",
    )).toBe(true);
    expect(hasAskTurnLiveSourceStandingWatchCue("Read the latest mailbox once.")).toBe(false);
  });
});
