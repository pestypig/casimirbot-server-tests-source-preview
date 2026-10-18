import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { classifyAskTurnModelOnlyFallbackId } from "../services/helix-ask/model-only-fallback-classifier";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/model-only-fallback-classifier.ts");

describe("Helix Ask model-only fallback classifier extraction boundary", () => {
  it("keeps model-only fallback id classification out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/model-only-fallback-classifier");
    expect(routeSource).not.toMatch(/const\s+classifyAskTurnModelOnlyFallbackId\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+classifyAskTurnModelOnlyFallbackId\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves deterministic fallback id classification", () => {
    expect(classifyAskTurnModelOnlyFallbackId("Explain kinetic energy but do not invent speed.")).toBe("model_only_fallback.underspecified_kinetic_energy");
    expect(classifyAskTurnModelOnlyFallbackId("Compare electron and proton charge and mass.")).toBe("model_only_fallback.electron_proton_comparison");
    expect(classifyAskTurnModelOnlyFallbackId("What is an electron?")).toBe("model_only_fallback.generic_electron");
    expect(classifyAskTurnModelOnlyFallbackId("Explain proper time versus coordinate time.")).toBe("model_only_fallback.proper_time_coordinate_time");
    expect(classifyAskTurnModelOnlyFallbackId("Why are calculator receipts observations for terminal authority?")).toBe("model_only_fallback.receipts_observations_terminal_authority");
    expect(classifyAskTurnModelOnlyFallbackId("Open the active document.")).toBeNull();
  });
});
