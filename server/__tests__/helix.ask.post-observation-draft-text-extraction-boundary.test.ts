import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/receipt-framing-suppression.ts");

describe("Helix Ask post-observation draft text extraction boundary", () => {
  it("keeps post-observation draft cleanup out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/receipt-framing-suppression");
    expect(routeSource).not.toMatch(/const\s+cleanHelixPostObservationDraftText\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+cleanHelixPostObservationDraftText\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });
});
