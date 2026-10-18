import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isAskTurnPriorEvidenceHandoffIntent } from "../services/helix-ask/evidence-handoff-intent";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/evidence-handoff-intent.ts");

describe("Helix Ask evidence handoff intent extraction boundary", () => {
  it("keeps prior-evidence handoff prompt detection out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/evidence-handoff-intent");
    expect(routeSource).not.toMatch(/const\s+isAskTurnPriorEvidenceHandoffIntent\s*=\s*\(transcript/);
    expect(serviceSource).toMatch(/export\s+const\s+isAskTurnPriorEvidenceHandoffIntent\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves prior-evidence handoff prompt behavior", () => {
    expect(isAskTurnPriorEvidenceHandoffIntent("Add the evidence location you just found to my note.")).toBe(true);
    expect(isAskTurnPriorEvidenceHandoffIntent("Copy that source snippet into the scratch note.")).toBe(true);
    expect(isAskTurnPriorEvidenceHandoffIntent("Find evidence for the NHM2 whitepaper.")).toBe(false);
  });
});
