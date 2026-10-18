import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAskTurnExplicitStagePlayOperationCueDetector } from "../services/helix-ask/live-source/stage-play-operation-intent";

const repoRoot = process.cwd();
const routeSource = readFileSync(join(repoRoot, "server/routes/agi.plan.ts"), "utf8");
const serviceSource = readFileSync(
  join(repoRoot, "server/services/helix-ask/live-source/stage-play-operation-intent.ts"),
  "utf8",
);

const detect = createAskTurnExplicitStagePlayOperationCueDetector({
  isStagePlayCheckpointRequestPrompt: (text) => /\bstage\s*play\s+checkpoint\b/i.test(text),
  isStagePlayJobPlanningPrompt: (text) => /\bstage\s*play\s+job\s+plan\b/i.test(text),
});

describe("Helix Ask Stage Play operation intent extraction boundary", () => {
  it("keeps explicit Stage Play operation cue implementation out of the route", () => {
    expect(routeSource).toContain("../services/helix-ask/live-source/stage-play-operation-intent");
    expect(routeSource).not.toMatch(/const\s+hasAskTurnExplicitStagePlayOperationCue\s*=\s*\(\s*transcript\s*:\s*string\s*\)\s*:\s*boolean\s*=>/);
    expect(routeSource).toMatch(/createAskTurnExplicitStagePlayOperationCueDetector\(\{/);
    expect(serviceSource).toMatch(/export\s+const\s+createAskTurnExplicitStagePlayOperationCueDetector\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
  });

  it("preserves explicit Stage Play operation cue detection", () => {
    expect(detect("stage play checkpoint for the current run")).toBe(true);
    expect(detect("stage play job plan for the next watch")).toBe(true);
    expect(detect("live_env.reflect_stage_play_context")).toBe(true);
    expect(detect("Reflect on the Stage Play badge graph.")).toBe(true);
    expect(detect("Use the live source mailbox once.")).toBe(false);
  });
});
