import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isCompactUiMailboxWakePrompt } from "../services/helix-ask/live-source/mail-wake-intent";

const repoRoot = process.cwd();
const routeSource = readFileSync(join(repoRoot, "server/routes/agi.plan.ts"), "utf8");
const serviceSource = readFileSync(
  join(repoRoot, "server/services/helix-ask/live-source/mail-wake-intent.ts"),
  "utf8",
);

describe("Helix Ask live-source mail wake intent extraction boundary", () => {
  it("keeps compact mailbox wake implementation out of the route", () => {
    expect(routeSource).toContain("../services/helix-ask/live-source/mail-wake-intent");
    expect(routeSource).not.toMatch(/const\s+isCompactUiMailboxWakePrompt\s*=\s*\(/);
    expect(serviceSource).toMatch(/export\s+const\s+isCompactUiMailboxWakePrompt\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
  });

  it("preserves compact mailbox wake detection", () => {
    expect(isCompactUiMailboxWakePrompt([
      "Continuing live-source watch job compact Ask handoff.",
      "Wake request: stage_play_live_source_mail_wake:abc",
      "Processed packet: stage_play_processed_mail_packet:def",
      "Phase requirement: live_env.record_live_source_mail_decision",
    ].join("\n"))).toBe(true);

    expect(isCompactUiMailboxWakePrompt([
      "UI bridge reason: Helix Ask wake",
      "Wake request: stage_play_live_source_mail_wake:abc",
      "Processed packet: stage_play_processed_mail_packet:def",
      "live_env.record_live_source_mail_decision then live_env.request_interim_voice_callout",
    ].join("\n"))).toBe(true);

    expect(isCompactUiMailboxWakePrompt([
      "Review the latest Stage Play live-source mailbox finding.",
      "Micro-reasoner recommendation: request voice callout",
      "structured mailbox route metadata",
    ].join("\n"))).toBe(true);

    expect(isCompactUiMailboxWakePrompt("read the live source mailbox")).toBe(false);
    expect(isCompactUiMailboxWakePrompt("stage_play_processed_mail_packet:def")).toBe(false);
  });
});
