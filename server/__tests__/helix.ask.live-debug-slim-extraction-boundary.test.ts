import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/debug/live-debug-slim.ts");

describe("Helix Ask live debug slim extraction boundary", () => {
  it("keeps live debug slim implementation out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/debug/live-debug-slim");
    expect(routeSource).toMatch(/const\s+buildHelixAskLiveDebugSlim\s*=\s*createHelixAskLiveDebugSlimBuilder\(\{/);
    expect(routeSource).not.toMatch(/const\s+HELIX_ASK_LIVE_DEBUG_ARRAY_LIMIT\s*=\s*8/);
    expect(routeSource).not.toMatch(/const\s+HELIX_ASK_LIVE_DEBUG_OMIT_FIELDS\s*=\s*new\s+Set/);
    expect(routeSource).not.toMatch(/const\s+summarizeHelixAskDebugValue\s*=\s*\(value:\s*unknown\)/);
    expect(routeSource).not.toMatch(/const\s+countHelixAskJsonBytes\s*=\s*\(value:\s*unknown\)/);
    expect(serviceSource).toMatch(/export\s+const\s+createHelixAskLiveDebugSlimBuilder\s*=/);
    expect(serviceSource).toContain("HELIX_ASK_LIVE_DEBUG_ARRAY_LIMIT");
    expect(serviceSource).toContain("HELIX_ASK_LIVE_DEBUG_OMIT_FIELDS");
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });
});
