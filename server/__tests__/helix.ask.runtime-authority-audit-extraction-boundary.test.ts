import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/runtime/runtime-authority-audit.ts");

describe("Helix Ask runtime authority audit extraction boundary", () => {
  it("keeps the runtime-authority audit implementation out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/runtime/runtime-authority-audit");
    expect(routeSource).not.toMatch(/const\s+buildHelixRuntimeAuthorityAudit\s*=/);
    expect(routeSource).not.toMatch(/const\s+appendHelixRuntimeAuthorityAuditToPayload\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixRuntimeAuthorityAudit\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+appendHelixRuntimeAuthorityAuditToPayload\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
  });
});
