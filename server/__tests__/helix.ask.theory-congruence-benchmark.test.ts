import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { HelixAskDepth } from "../../shared/helix-theory-congruence-trace";
import { selectTheoryDepth } from "../services/helix-ask/theory-congruence/depth-policy";

type PromptCase = {
  id: string;
  prompt: string;
  min_depth: HelixAskDepth;
};

const DEPTH_SCORE: Record<HelixAskDepth, number> = {
  direct: 0,
  source_grounded: 1,
  congruence_trace: 2,
  audit_deep: 3,
};

function loadPromptCases(): PromptCase[] {
  const file = path.resolve(process.cwd(), "bench/helix-ask-theory-congruence-prompts.jsonl");
  return fs.readFileSync(file, "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line) as PromptCase);
}

describe("Helix Ask theory congruence prompt battery", () => {
  it("selects at least the minimum requested theory depth for fixture prompts", () => {
    for (const entry of loadPromptCases()) {
      const selected = selectTheoryDepth({ prompt: entry.prompt });
      expect(
        DEPTH_SCORE[selected.depth],
        `${entry.id} selected ${selected.depth}, expected at least ${entry.min_depth}`,
      ).toBeGreaterThanOrEqual(DEPTH_SCORE[entry.min_depth]);
    }
  });
});
