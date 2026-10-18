import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/runtime/runtime-voice-side-effect-composer.ts");

describe("Helix Ask runtime voice side-effect composer extraction boundary", () => {
  it("keeps voice side-effect composer helpers out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/runtime/runtime-voice-side-effect-composer");
    expect(routeSource).toContain("createHelixRuntimeVoiceSideEffectComposer({");
    expect(routeSource).not.toMatch(/const\s+isCompoundInterimVoiceCalloutPromptText\s*=\s*\(prompt/);
    expect(routeSource).not.toMatch(/const\s+buildCompoundInterimVoiceCalloutFallbackText\s*=\s*\(args/);
    expect(routeSource).not.toMatch(/const\s+compoundInterimVoiceReceiptExplanationSatisfied\s*=\s*\(text/);
    expect(routeSource).not.toMatch(/const\s+readLatestAskTurnDirectAnswerTextForVoiceSideEffect\s*=\s*\(artifacts/);
    expect(serviceSource).toMatch(/export\s+const\s+createHelixRuntimeVoiceSideEffectComposer\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });
});
