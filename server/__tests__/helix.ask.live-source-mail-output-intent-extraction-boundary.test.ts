import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createLiveSourceMailOutputIntentDetector } from "../services/helix-ask/live-source/mail-output-intent";

const repoRoot = process.cwd();
const routeSource = readFileSync(join(repoRoot, "server/routes/agi.plan.ts"), "utf8");
const serviceSource = readFileSync(
  join(repoRoot, "server/services/helix-ask/live-source/mail-output-intent.ts"),
  "utf8",
);

const detect = createLiveSourceMailOutputIntentDetector({
  hasNegatedLiveSourceMailLoopIntent: (text) => /\b(?:do\s+not|don't)\s+(?:read|check|process|use)\b/i.test(text),
  hasContextualLiveSourceMailLoopIntent: (text) => /\bexample\s+of\s+mailbox\b/i.test(text),
});

describe("Helix Ask live-source mail output intent extraction boundary", () => {
  it("keeps mail output intent implementation out of the route", () => {
    expect(routeSource).toContain("../services/helix-ask/live-source/mail-output-intent");
    expect(routeSource).not.toMatch(/const\s+detectLiveSourceMailOutputIntent\s*=\s*\(\s*transcript\s*:\s*string\s*\)/);
    expect(routeSource).toMatch(/createLiveSourceMailOutputIntentDetector\(\{/);
    expect(serviceSource).toMatch(/export\s+const\s+createLiveSourceMailOutputIntentDetector\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
  });

  it("preserves mail output intent classification shape", () => {
    expect(detect("Read the latest visual summary mail in one concise sentence.")).toMatchObject({
      wantsTextAnswer: true,
      wantsOneSentence: true,
      wantsVoiceCallout: false,
      wantsInterpretation: false,
    });
    expect(detect("Interpret the processed mail and say what changed.")).toMatchObject({
      wantsInterpretation: true,
      wantsTextAnswer: false,
    });
    expect(detect("Only notify me if something important changes in the visual update.")).toMatchObject({
      wantsImportanceOnly: true,
      wantsTextAnswer: false,
    });
    expect(detect("Do not read the latest mailbox aloud.")).toMatchObject({
      wantsVoiceCallout: false,
      wantsTextAnswer: false,
    });
  });
});
