import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/surface/reasoning-theater-state.ts");

describe("Helix Ask reasoning theater payload debug extraction boundary", () => {
  it("keeps payload debug trace coercion and fallback assembly out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/surface/reasoning-theater-state");
    expect(routeSource).toContain("attachHelixAskReasoningTheaterStateToPayloadDebug");
    expect(routeSource).not.toMatch(/const\s+coerceHelixAskReasoningTheaterTraceEvents\s*=/);
    expect(routeSource).not.toMatch(/const\s+buildHelixAskReasoningTheaterFallbackTraceEvents\s*=/);
    expect(routeSource).not.toMatch(/const\s+attachHelixAskReasoningTheaterStateToPayloadDebug\s*=/);

    expect(serviceSource).toMatch(/export\s+const\s+coerceHelixAskReasoningTheaterTraceEvents\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixAskReasoningTheaterFallbackTraceEvents\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+attachHelixAskReasoningTheaterStateToPayloadDebug\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });
});
