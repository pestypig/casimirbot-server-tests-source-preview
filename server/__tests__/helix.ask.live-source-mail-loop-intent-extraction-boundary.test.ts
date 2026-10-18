import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createAskTurnLiveSourceMailLoopIntentDetector,
  createAskTurnLiveSourceWatchJobSetupIntentDetector,
} from "../services/helix-ask/live-source/mail-loop-intent";

const repoRoot = process.cwd();
const routeSource = readFileSync(join(repoRoot, "server/routes/agi.plan.ts"), "utf8");
const serviceSource = readFileSync(
  join(repoRoot, "server/services/helix-ask/live-source/mail-loop-intent.ts"),
  "utf8",
);

const createLoopDetector = (overrides: Partial<Parameters<typeof createAskTurnLiveSourceMailLoopIntentDetector>[0]> = {}) =>
  createAskTurnLiveSourceMailLoopIntentDetector({
    isCompactUiMailboxWakePrompt: () => false,
    hasAskTurnExplicitMailToolCue: () => false,
    hasAskTurnExplicitStagePlayOperationCue: () => false,
    hasNegatedLiveSourceMailLoopIntent: () => false,
    hasContextualLiveSourceMailLoopIntent: () => false,
    hasExplicitAskTurnLiveSourceMailLoopCue: (text) => /\bmailbox\b/i.test(text),
    hasAskTurnLiveSourceMailInterpretationCue: () => false,
    hasAskTurnLiveSourceStandingWatchCue: () => false,
    isStagePlayJobPlanningPrompt: () => false,
    ...overrides,
  });

describe("Helix Ask live-source mail loop intent extraction boundary", () => {
  it("keeps mail-loop and watch-job setup implementation out of the route", () => {
    expect(routeSource).toContain("../services/helix-ask/live-source/mail-loop-intent");
    expect(routeSource).toMatch(/createAskTurnLiveSourceMailLoopIntentDetector\(\{/);
    expect(routeSource).toMatch(/createAskTurnLiveSourceWatchJobSetupIntentDetector\(\{/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnLiveSourceMailLoopIntent\s*=\s*\(\s*transcript\s*:\s*string\s*\)\s*:\s*boolean\s*=>/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnLiveSourceWatchJobSetupIntent\s*=\s*\(\s*transcript\s*:\s*string\s*\)\s*:\s*boolean\s*=>/);
    expect(serviceSource).toMatch(/export\s+const\s+createAskTurnLiveSourceMailLoopIntentDetector\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+createAskTurnLiveSourceWatchJobSetupIntentDetector\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
  });

  it("preserves mail-loop intent precedence through injected route callbacks", () => {
    expect(createLoopDetector({ isCompactUiMailboxWakePrompt: () => true })("plain prompt")).toBe(true);
    expect(createLoopDetector()("read the mailbox")).toBe(true);
    expect(createLoopDetector({ hasNegatedLiveSourceMailLoopIntent: () => true })("read the mailbox")).toBe(false);
    expect(createLoopDetector({ hasContextualLiveSourceMailLoopIntent: () => true })("read the mailbox")).toBe(false);
    expect(createLoopDetector({ isStagePlayJobPlanningPrompt: () => true })("watch the live source for changes")).toBe(false);
    expect(createLoopDetector()("watch the live source for changes")).toBe(true);
  });

  it("preserves watch-job setup gating", () => {
    const isWatchSetup = createAskTurnLiveSourceWatchJobSetupIntentDetector({
      isAskTurnLiveSourceMailLoopIntent: (text) => !/\bnot-mail\b/i.test(text),
      hasAskTurnLiveSourceStandingWatchCue: (text) => /\bstanding watch\b/i.test(text),
      hasAskTurnLiveSourceOneTimeMailReadCue: (text) => /\bone time\b/i.test(text),
    });

    expect(isWatchSetup("standing watch the live source")).toBe(true);
    expect(isWatchSetup("not-mail standing watch the live source")).toBe(false);
    expect(isWatchSetup("live_env.read_live_source_mail standing watch")).toBe(false);
    expect(isWatchSetup("one time only announce if the source changes")).toBe(false);
    expect(isWatchSetup("one time standing watch the live source")).toBe(true);
  });
});
