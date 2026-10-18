import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/contracts/intent-contract-hash.ts");

describe("Helix Ask intent-contract hash extraction boundary", () => {
  it("keeps intent-contract hash formatting out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/contracts/intent-contract-hash");
    expect(routeSource).not.toMatch(/const\s+hashHelixAskIntentContract\s*=\s*\(/);
    expect(serviceSource).toMatch(/export\s+const\s+hashHelixAskIntentContract\s*=/);
    expect(serviceSource).toContain("sha256Hex");
    expect(serviceSource).toContain("stableJsonStringify");
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });
});
