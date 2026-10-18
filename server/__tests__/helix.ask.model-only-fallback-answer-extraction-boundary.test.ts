import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildAskTurnModelOnlyFallbackAnswer,
  renderAskTurnModelOnlyFallbackAnswer,
} from "../services/helix-ask/model-only-fallback-answer";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/model-only-fallback-answer.ts");

describe("Helix Ask model-only fallback answer extraction boundary", () => {
  it("keeps model-only fallback answer rendering out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/model-only-fallback-answer");
    expect(routeSource).not.toMatch(/const\s+renderAskTurnModelOnlyFallbackAnswer\s*=/);
    expect(routeSource).not.toMatch(/const\s+buildAskTurnModelOnlyFallbackAnswer\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+renderAskTurnModelOnlyFallbackAnswer\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+buildAskTurnModelOnlyFallbackAnswer\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves deterministic fallback answer text", () => {
    expect(renderAskTurnModelOnlyFallbackAnswer("model_only_fallback.underspecified_kinetic_energy")).toContain("requires the car's speed");
    expect(renderAskTurnModelOnlyFallbackAnswer("model_only_fallback.electron_proton_comparison")).toContain("1836 times");
    expect(renderAskTurnModelOnlyFallbackAnswer("model_only_fallback.receipts_observations_terminal_authority")).toContain("Terminal authority must select");
    expect(renderAskTurnModelOnlyFallbackAnswer("model_only_fallback.unknown")).toBeNull();
  });

  it("preserves admitted deterministic fallback answer eligibility", () => {
    expect(buildAskTurnModelOnlyFallbackAnswer("What is an electron?")).toContain("negative electric charge");
    expect(buildAskTurnModelOnlyFallbackAnswer("Compare electron and proton charge and mass.")).toBeNull();
  });
});
