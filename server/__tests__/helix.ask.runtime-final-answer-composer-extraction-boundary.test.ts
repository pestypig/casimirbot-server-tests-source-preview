import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/runtime-final-answer-composer.ts");

describe("Helix Ask runtime final-answer composer extraction boundary", () => {
  it("keeps the final-answer composer implementation out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/runtime-final-answer-composer");
    expect(routeSource).not.toMatch(/const\s+applyHelixRuntimeFinalAnswerComposerToPayload\s*=\s*async/);
    expect(serviceSource).toMatch(/const\s+applyHelixRuntimeFinalAnswerComposerToPayload\s*=\s*async/);
    expect(serviceSource).toMatch(/export\s+const\s+createHelixRuntimeFinalAnswerComposer\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });
});
