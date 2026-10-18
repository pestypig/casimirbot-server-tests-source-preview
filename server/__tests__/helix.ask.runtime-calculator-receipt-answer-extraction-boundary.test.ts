import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/runtime/runtime-calculator-receipt-answer.ts");

describe("Helix Ask runtime calculator receipt answer extraction boundary", () => {
  it("keeps calculator receipt answer synthesis and sanitization out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/runtime/runtime-calculator-receipt-answer");
    expect(routeSource).toContain("createHelixRuntimeCalculatorReceiptAnswer({");
    expect(routeSource).not.toMatch(/const\s+synthesizeCalculatorReceiptAnswer\s*=\s*\(args/);
    expect(routeSource).not.toMatch(/const\s+parseHelixCalculatorAnswerNumber\s*=\s*\(value/);
    expect(routeSource).not.toMatch(/const\s+sanitizeHelixCalculatorAnswerAgainstReceiptResults\s*=\s*\(args/);
    expect(serviceSource).toMatch(/export\s+const\s+createHelixRuntimeCalculatorReceiptAnswer\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });
});
