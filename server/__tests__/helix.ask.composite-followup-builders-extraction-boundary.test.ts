import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/composite-followup-helpers.ts");

describe("Helix Ask composite followup builders extraction boundary", () => {
  it("keeps composite handoff decision and audit builders out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/composite-followup-helpers");
    expect(routeSource).toContain("buildAskTurnCompositeHandoffDecision");
    expect(routeSource).toContain("buildAskTurnCompositeFollowupAudit");
    expect(routeSource).not.toMatch(/const\s+buildAskTurnCompositeHandoffDecision\s*=\s*\(args:\s*\{/);
    expect(routeSource).not.toMatch(/const\s+buildAskTurnCompositeFollowupAudit\s*=\s*\(args:\s*\{/);
    expect(routeSource).not.toContain("workspace_action_not_note_content");
    expect(routeSource).not.toContain("failed_subgoal_not_used_as_success");

    expect(serviceSource).toMatch(/export\s+const\s+buildAskTurnCompositeHandoffDecision\s*=\s*\(args:\s*\{/);
    expect(serviceSource).toMatch(/export\s+const\s+buildAskTurnCompositeFollowupAudit\s*=\s*\(args:\s*\{/);
    expect(serviceSource).toContain("workspace_action_not_note_content");
    expect(serviceSource).toContain("failed_subgoal_not_used_as_success");
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });
});
