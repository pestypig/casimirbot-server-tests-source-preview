import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/runtime/runtime-composer-coverage.ts");

describe("Helix Ask runtime composer coverage extraction boundary", () => {
  it("keeps runtime composer coverage predicates out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/runtime/runtime-composer-coverage");
    expect(routeSource).toContain("isHelixRuntimeComposerCoverageComplete(args.calculatorCoverage)");
    expect(routeSource).not.toMatch(/const\s+isHelixCoverageComplete\s*=\s*\(coverage:\s*unknown\)/);
    expect(serviceSource).toMatch(/export\s+const\s+isHelixRuntimeComposerCoverageComplete\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });
});
