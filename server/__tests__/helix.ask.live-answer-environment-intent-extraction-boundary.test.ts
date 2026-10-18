import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isAskTurnLiveAnswerEnvironmentStateIntent } from "../services/helix-ask/live-answer-environment-intent";

const repoRoot = process.cwd();
const routeSource = readFileSync(join(repoRoot, "server/routes/agi.plan.ts"), "utf8");
const serviceSource = readFileSync(
  join(repoRoot, "server/services/helix-ask/live-answer-environment-intent.ts"),
  "utf8",
);

describe("Helix Ask live-answer environment intent extraction boundary", () => {
  it("keeps the live-answer state predicate out of the route", () => {
    expect(routeSource).toContain("../services/helix-ask/live-answer-environment-intent");
    expect(routeSource).not.toMatch(/const\s+isAskTurnLiveAnswerEnvironmentStateIntent\s*=\s*\(/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnLiveAnswerEnvironmentStateIntent\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
  });

  it("preserves live-answer state intent detection", () => {
    expect(isAskTurnLiveAnswerEnvironmentStateIntent(
      "Using the active live answer environment, what is the latest result?",
    )).toBe(true);
    expect(isAskTurnLiveAnswerEnvironmentStateIntent(
      "Did the calculator live source cross threshold 10?",
    )).toBe(true);
    expect(isAskTurnLiveAnswerEnvironmentStateIntent(
      "Create a live answer card for this topic.",
    )).toBe(false);
    expect(isAskTurnLiveAnswerEnvironmentStateIntent(
      "What is the latest result?",
    )).toBe(false);
  });
});
