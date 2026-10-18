import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  hasAskTurnMicroReasonerDraftCue,
  hasAskTurnMicroReasonerPromptRouterCue,
  hasAskTurnMicroReasonerPresetCue,
  hasContextualAskTurnMicroReasonerCue,
  hasExecutableAskTurnMicroReasonerPresetCue,
  selectAskTurnMicroReasonerCapability,
} from "../services/helix-ask/live-source/micro-reasoner-intent";

const repoRoot = process.cwd();
const routeSource = readFileSync(join(repoRoot, "server/routes/agi.plan.ts"), "utf8");
const serviceSource = readFileSync(
  join(repoRoot, "server/services/helix-ask/live-source/micro-reasoner-intent.ts"),
  "utf8",
);

describe("Helix Ask micro-reasoner intent extraction boundary", () => {
  it("keeps micro-reasoner prompt cue implementation out of the route", () => {
    expect(routeSource).toContain("../services/helix-ask/live-source/micro-reasoner-intent");
    expect(routeSource).not.toMatch(/const\s+hasAskTurnMicroReasonerPresetCue\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+hasContextualAskTurnMicroReasonerCue\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+hasExecutableAskTurnMicroReasonerPresetCue\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+hasAskTurnMicroReasonerPromptRouterCue\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+hasAskTurnMicroReasonerDraftCue\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+selectAskTurnMicroReasonerCapability\s*=\s*\(/);
    expect(serviceSource).toMatch(/export\s+const\s+hasAskTurnMicroReasonerPresetCue\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+selectAskTurnMicroReasonerCapability\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
  });

  it("preserves executable and contextual micro-reasoner cue behavior", () => {
    const executable = "List the micro-reasoner presets for this live source.";
    const contextual = "In the future, query the micro-reasoner presets, but for now explain what that means.";

    expect(hasAskTurnMicroReasonerPresetCue(executable)).toBe(true);
    expect(hasContextualAskTurnMicroReasonerCue(contextual)).toBe(true);
    expect(hasExecutableAskTurnMicroReasonerPresetCue(executable)).toBe(true);
    expect(hasExecutableAskTurnMicroReasonerPresetCue(contextual)).toBe(false);
    expect(hasAskTurnMicroReasonerPromptRouterCue("Route this visual summary through the microdeck prompt router.")).toBe(true);
    expect(hasAskTurnMicroReasonerDraftCue("Draft a micro-reasoner preset for Minecraft hazards.")).toBe(true);
  });

  it("preserves micro-reasoner capability selection precedence", () => {
    expect(selectAskTurnMicroReasonerCapability("Draft a micro-reasoner preset for this source.")).toBe(
      "live_env.draft_micro_reasoner_preset",
    );
    expect(selectAskTurnMicroReasonerCapability("Route this observation through the microdeck prompt router.")).toBe(
      "live_env.route_micro_reasoner_prompt",
    );
    expect(selectAskTurnMicroReasonerCapability("Apply the selected micro-reasoner preset.")).toBe(
      "live_env.apply_micro_reasoner_preset",
    );
    expect(selectAskTurnMicroReasonerCapability("Create a custom micro-reasoner prompt.")).toBe(
      "live_env.create_micro_reasoner_preset",
    );
    expect(selectAskTurnMicroReasonerCapability("live_env.query_micro_reasoner_prompts")).toBe(
      "live_env.query_micro_reasoner_prompts",
    );
    expect(selectAskTurnMicroReasonerCapability("List the micro-reasoner presets.")).toBe(
      "live_env.query_micro_reasoner_presets",
    );
  });
});
