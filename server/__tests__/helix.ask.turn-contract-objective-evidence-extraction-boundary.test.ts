import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  inferHelixAskObjectiveSlotHitsFromEvidence,
  normalizeHelixAskObjectiveLabelKey,
} from "../services/helix-ask/contracts/turn-contract-objective-evidence";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-objective-evidence.ts");
const builderPath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-builder.ts");

describe("Helix Ask turn-contract objective evidence extraction boundary", () => {
  it("keeps objective evidence matching out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");
    const builderSource = readFileSync(builderPath, "utf8");

    expect(`${routeSource}\n${builderSource}`).toContain("turn-contract-objective-evidence");
    expect(routeSource).not.toMatch(/const\s+normalizeHelixAskObjectiveLabelKey\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+inferHelixAskObjectiveSlotHitsFromEvidence\s*=\s*\(/);
    expect(serviceSource).toMatch(/export\s+const\s+normalizeHelixAskObjectiveLabelKey\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+inferHelixAskObjectiveSlotHitsFromEvidence\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves objective label keys and evidence slot-hit inference", () => {
    expect(normalizeHelixAskObjectiveLabelKey("  Compare: Voice / Translation! ")).toBe(
      "compare voice translation",
    );
    expect(
      inferHelixAskObjectiveSlotHitsFromEvidence(
        [
          "voice-lane",
          "transcription-translation",
          "mechanism",
          "repo-mapping",
          "difference",
          "custom-signal",
        ],
        "Voice lane",
        [
          "server/routes/voice/callout.ts",
          "docs/translation-pipeline.md describes the mechanism and custom signal",
        ],
      ),
    ).toEqual([
      "voice-lane",
      "transcription-translation",
      "mechanism",
      "repo-mapping",
      "custom-signal",
    ]);
  });
});
