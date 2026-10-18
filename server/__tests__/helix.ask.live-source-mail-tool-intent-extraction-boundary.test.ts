import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hasAskTurnExplicitMailToolCue } from "../services/helix-ask/live-source/mail-tool-intent";

const repoRoot = process.cwd();
const routeSource = readFileSync(join(repoRoot, "server/routes/agi.plan.ts"), "utf8");
const serviceSource = readFileSync(
  join(repoRoot, "server/services/helix-ask/live-source/mail-tool-intent.ts"),
  "utf8",
);

describe("Helix Ask live-source mail tool intent extraction boundary", () => {
  it("keeps explicit mail tool cue implementation out of the route", () => {
    expect(routeSource).toContain("../services/helix-ask/live-source/mail-tool-intent");
    expect(routeSource).not.toMatch(/const\s+hasAskTurnExplicitMailToolCue\s*=\s*\(/);
    expect(serviceSource).toMatch(/export\s+const\s+hasAskTurnExplicitMailToolCue\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
  });

  it("preserves explicit mail tool cue detection", () => {
    expect(hasAskTurnExplicitMailToolCue("live_env.read_live_source_mail")).toBe(true);
    expect(hasAskTurnExplicitMailToolCue("live_env.record_live_source_mail_decision")).toBe(true);
    expect(hasAskTurnExplicitMailToolCue("Open the live source mailbox.")).toBe(true);
    expect(hasAskTurnExplicitMailToolCue("Use the micro-reasoner prompt router.")).toBe(true);
    expect(hasAskTurnExplicitMailToolCue("Check the latest visual summary mail.")).toBe(true);
    expect(hasAskTurnExplicitMailToolCue("Summarize this document.")).toBe(false);
  });
});
