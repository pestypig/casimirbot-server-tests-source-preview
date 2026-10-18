import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/runtime/runtime-repo-evidence-synthesis-text.ts");

describe("Helix Ask runtime repo evidence synthesis text extraction boundary", () => {
  it("keeps deterministic repo evidence synthesis text out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/runtime/runtime-repo-evidence-synthesis-text");
    expect(routeSource).not.toMatch(/const\s+clipDeterministicRepoSynthesisText\s*=/);
    expect(routeSource).not.toMatch(/const\s+titleCaseRepoConcept\s*=/);
    expect(routeSource).not.toMatch(/const\s+buildDeterministicRepoEvidenceSynthesisText\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+buildDeterministicRepoEvidenceSynthesisText\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });
});
