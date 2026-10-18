import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/debug/live-debug-mode.ts");

describe("Helix Ask live debug mode extraction boundary", () => {
  it("keeps live debug mode parsing out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/debug/live-debug-mode");
    expect(routeSource).not.toMatch(/type\s+HelixAskLiveDebugMode\s*=/);
    expect(routeSource).not.toMatch(/const\s+readHelixAskLiveDebugMode\s*=/);
    expect(routeSource).not.toContain("HELIX_ASK_LIVE_DEBUG_MODE.trim().toLowerCase()");
    expect(serviceSource).toMatch(/export\s+type\s+HelixAskLiveDebugMode\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+readHelixAskLiveDebugMode\s*=/);
    expect(serviceSource).toContain("HELIX_ASK_LIVE_DEBUG_MODE");
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });
});
