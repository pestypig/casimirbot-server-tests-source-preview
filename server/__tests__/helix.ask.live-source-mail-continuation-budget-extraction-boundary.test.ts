import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createMailLoopContinuationBudgetGoalDetector,
  createMailLoopContinuationBudgetReader,
  DEFAULT_MAIL_LOOP_CONTINUATION_BUDGET,
} from "../services/helix-ask/live-source/mail-continuation-budget";

const repoRoot = process.cwd();
const routeSource = readFileSync(join(repoRoot, "server/routes/agi.plan.ts"), "utf8");
const serviceSource = readFileSync(
  join(repoRoot, "server/services/helix-ask/live-source/mail-continuation-budget.ts"),
  "utf8",
);

describe("Helix Ask live-source mail continuation budget extraction boundary", () => {
  it("keeps continuation budget implementation out of the route", () => {
    expect(routeSource).toContain("../services/helix-ask/live-source/mail-continuation-budget");
    expect(routeSource).toMatch(/createMailLoopContinuationBudgetReader\(\{/);
    expect(routeSource).toMatch(/createMailLoopContinuationBudgetGoalDetector\(\{/);
    expect(routeSource).not.toMatch(/const\s+DEFAULT_MAIL_LOOP_CONTINUATION_BUDGET\s*:/);
    expect(routeSource).not.toMatch(/const\s+isMailLoopContinuationBudgetGoal\s*=\s*\(/);
    expect(serviceSource).toMatch(/export\s+const\s+DEFAULT_MAIL_LOOP_CONTINUATION_BUDGET\s*:/);
    expect(serviceSource).toMatch(/export\s+const\s+createMailLoopContinuationBudgetReader\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+createMailLoopContinuationBudgetGoalDetector\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
  });

  it("preserves continuation budget env keys, fallbacks, and caps", () => {
    const calls: Array<{ name: string; fallback: number; maxCap: number }> = [];
    const readBudget = createMailLoopContinuationBudgetReader({
      readHelixAgentLoopBudgetEnvInt: (name, fallback, maxCap) => {
        calls.push({ name, fallback, maxCap });
        return fallback + 1;
      },
    });

    expect(readBudget()).toEqual({
      maxExtraToolCallsAfterProgress: 4,
      maxContinuationWakesPerCycle: 2,
      maxNoProgressRepeats: 1,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(calls).toEqual([
      {
        name: "HELIX_MAIL_LOOP_MAX_EXTRA_TOOL_CALLS_AFTER_PROGRESS",
        fallback: DEFAULT_MAIL_LOOP_CONTINUATION_BUDGET.maxExtraToolCallsAfterProgress,
        maxCap: 8,
      },
      {
        name: "HELIX_MAIL_LOOP_MAX_CONTINUATION_WAKES_PER_CYCLE",
        fallback: DEFAULT_MAIL_LOOP_CONTINUATION_BUDGET.maxContinuationWakesPerCycle,
        maxCap: 4,
      },
      {
        name: "HELIX_MAIL_LOOP_MAX_NO_PROGRESS_REPEATS",
        fallback: DEFAULT_MAIL_LOOP_CONTINUATION_BUDGET.maxNoProgressRepeats,
        maxCap: 3,
      },
    ]);
  });

  it("preserves continuation budget goal detection", () => {
    const detect = createMailLoopContinuationBudgetGoalDetector({
      isAskTurnLiveSourceMailLoopIntent: (text) => /\bmailbox\b/i.test(text),
    });

    expect(detect({ goal_kind: "live_source_processed_mail_interpretation" }, "plain")).toBe(true);
    expect(detect({ goal_kind: "live_environment_review" }, "read the mailbox")).toBe(true);
    expect(detect({ goal_kind: "live_environment_review" }, "plain")).toBe(false);
    expect(detect({ goal_kind: "calculator_solve" }, "read the mailbox")).toBe(false);
  });
});
