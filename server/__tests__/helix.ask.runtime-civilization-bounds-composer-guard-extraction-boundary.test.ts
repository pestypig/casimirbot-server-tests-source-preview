import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/runtime/runtime-civilization-bounds-composer-guard.ts");

describe("Helix Ask runtime civilization-bounds composer guard extraction boundary", () => {
  it("keeps civilization-bounds composer contradiction guard out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/runtime/runtime-civilization-bounds-composer-guard");
    expect(routeSource).not.toMatch(/const\s+civilizationBoundsComposerContradictsReceipts\s*=\s*\(args/);
    expect(serviceSource).toMatch(/export\s+const\s+civilizationBoundsComposerContradictsReceipts\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });
});
