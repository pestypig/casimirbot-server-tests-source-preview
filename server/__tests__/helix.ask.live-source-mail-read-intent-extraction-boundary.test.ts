import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hasAskTurnLiveSourceOneTimeMailReadCue } from "../services/helix-ask/live-source/mail-read-intent";

const repoRoot = process.cwd();
const routeSource = readFileSync(join(repoRoot, "server/routes/agi.plan.ts"), "utf8");
const serviceSource = readFileSync(
  join(repoRoot, "server/services/helix-ask/live-source/mail-read-intent.ts"),
  "utf8",
);

describe("Helix Ask live-source mail read intent extraction boundary", () => {
  it("keeps one-time mail read cue implementation out of the route", () => {
    expect(routeSource).toContain("../services/helix-ask/live-source/mail-read-intent");
    expect(routeSource).not.toMatch(/const\s+hasAskTurnLiveSourceOneTimeMailReadCue\s*=\s*\(/);
    expect(serviceSource).toMatch(/export\s+const\s+hasAskTurnLiveSourceOneTimeMailReadCue\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
  });

  it("preserves one-time mail read cue detection", () => {
    expect(hasAskTurnLiveSourceOneTimeMailReadCue("live_env.read_processed_live_source_mail")).toBe(true);
    expect(hasAskTurnLiveSourceOneTimeMailReadCue("Check the latest visual summary mail.")).toBe(true);
    expect(hasAskTurnLiveSourceOneTimeMailReadCue("Review the source update.")).toBe(true);
    expect(hasAskTurnLiveSourceOneTimeMailReadCue("The mailbox reports a new packet.")).toBe(true);
    expect(hasAskTurnLiveSourceOneTimeMailReadCue("Keep watching this source for changes.")).toBe(false);
  });
});
