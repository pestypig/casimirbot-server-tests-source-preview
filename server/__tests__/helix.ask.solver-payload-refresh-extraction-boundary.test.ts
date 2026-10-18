import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/runtime/solver-payload-refresh.ts");

describe("Helix Ask solver payload refresh extraction boundary", () => {
  it("keeps solver payload refresh adapters out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/runtime/solver-payload-refresh");
    expect(routeSource).not.toMatch(/const\s+readCapabilityPlanPayload\s*=\s*\(payload:\s*Record<string,\s*unknown>\)/);
    expect(routeSource).not.toMatch(/const\s+collectCapabilityReenteredRefs\s*=\s*\(payload:\s*Record<string,\s*unknown>\)/);
    expect(routeSource).not.toMatch(/const\s+buildCapabilityAdapterRequestForPayload\s*=\s*\(args:\s*\{/);
    expect(routeSource).not.toMatch(/const\s+refreshCapabilityResultForPayload\s*=\s*\(args:\s*\{/);
    expect(routeSource).not.toMatch(/function\s+refreshSolverArtifactReentryAuditForPayload\s*\(args:\s*\{/);
    expect(routeSource).not.toMatch(/function\s+refreshSolverSubgoalLedgerForPayload\s*\(args:\s*\{/);
    expect(routeSource).not.toMatch(/function\s+refreshSolverRetryPoliciesForPayload\s*\(args:\s*\{/);
    expect(routeSource).not.toMatch(/function\s+refreshCapabilityLifecycleLedgerForPayload\s*\(args:\s*\{/);
    expect(serviceSource).toMatch(/export\s+const\s+readCapabilityPlanPayload\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+collectCapabilityReenteredRefs\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+buildCapabilityAdapterRequestForPayload\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+refreshCapabilityResultForPayload\s*=/);
    expect(serviceSource).toMatch(/export\s+function\s+refreshSolverArtifactReentryAuditForPayload/);
    expect(serviceSource).toMatch(/export\s+function\s+refreshSolverSubgoalLedgerForPayload/);
    expect(serviceSource).toMatch(/export\s+function\s+refreshSolverRetryPoliciesForPayload/);
    expect(serviceSource).toMatch(/export\s+function\s+refreshCapabilityLifecycleLedgerForPayload/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });
});
