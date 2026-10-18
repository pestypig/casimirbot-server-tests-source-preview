import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/runtime/runtime-composer-support-refs.ts");

describe("Helix Ask runtime composer support refs extraction boundary", () => {
  it("keeps runtime composer support-ref collectors out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/runtime/runtime-composer-support-refs");
    expect(routeSource).not.toMatch(/const\s+collectHelixRuntimeComposerScholarlyObservationRefs\s*=/);
    expect(routeSource).not.toMatch(/const\s+collectHelixRuntimeComposerScholarlySupportRefs\s*=/);
    expect(routeSource).not.toMatch(/const\s+collectHelixRuntimeComposerInternetSearchObservationRefs\s*=/);
    expect(routeSource).not.toMatch(/const\s+collectHelixRuntimeComposerInternetSearchSupportRefs\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+collectHelixRuntimeComposerScholarlyObservationRefs\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+collectHelixRuntimeComposerScholarlySupportRefs\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+collectHelixRuntimeComposerInternetSearchObservationRefs\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+collectHelixRuntimeComposerInternetSearchSupportRefs\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });
});
