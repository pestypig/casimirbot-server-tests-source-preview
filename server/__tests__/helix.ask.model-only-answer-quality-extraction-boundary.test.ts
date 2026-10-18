import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  isAskTurnModelOnlyWorkspaceLeak,
  isAskTurnNonSubstantiveDirectAnswer,
} from "../services/helix-ask/model-only-answer-quality";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/model-only-answer-quality.ts");

describe("Helix Ask model-only answer quality extraction boundary", () => {
  it("keeps model-only answer quality predicates out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/model-only-answer-quality");
    expect(routeSource).not.toMatch(/const\s+isAskTurnModelOnlyWorkspaceLeak\s*=/);
    expect(routeSource).not.toMatch(/const\s+isAskTurnNonSubstantiveDirectAnswer\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnModelOnlyWorkspaceLeak\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnNonSubstantiveDirectAnswer\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves model-only workspace leak detection", () => {
    expect(isAskTurnModelOnlyWorkspaceLeak("Explained /docs/research/foo.md")).toBe(true);
    expect(isAskTurnModelOnlyWorkspaceLeak("Active doc: /docs/research/foo.md")).toBe(true);
    expect(isAskTurnModelOnlyWorkspaceLeak("Momentum is mass times velocity.")).toBe(false);
  });

  it("preserves non-substantive direct-answer detection", () => {
    expect(isAskTurnNonSubstantiveDirectAnswer("")).toBe(true);
    expect(isAskTurnNonSubstantiveDirectAnswer("I could not produce a terminal answer for this turn.")).toBe(true);
    expect(isAskTurnNonSubstantiveDirectAnswer("Completed reasoning turn.")).toBe(true);
    expect(isAskTurnNonSubstantiveDirectAnswer("Momentum is conserved when net external impulse is zero.")).toBe(false);
  });
});
