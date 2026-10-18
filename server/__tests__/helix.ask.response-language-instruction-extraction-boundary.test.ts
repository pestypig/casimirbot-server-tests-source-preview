import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/language-contract.ts");

describe("Helix Ask response language instruction extraction boundary", () => {
  it("keeps response language instruction construction in the language contract service", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("buildHelixResponseLanguageInstruction");
    expect(routeSource).toContain("../services/helix-ask/language-contract");
    expect(routeSource).not.toMatch(/const\s+buildHelixResponseLanguageInstruction\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixResponseLanguageInstruction\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });
});
