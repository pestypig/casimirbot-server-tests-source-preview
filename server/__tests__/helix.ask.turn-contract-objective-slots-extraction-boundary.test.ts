import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { inferHelixAskObjectiveSlotsFromObligationCoverage } from "../services/helix-ask/contracts/turn-contract-objective-slots";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-objective-slots.ts");
const builderPath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-builder.ts");

const coverage = (entry: Partial<Parameters<typeof inferHelixAskObjectiveSlotsFromObligationCoverage>[0][number]>) => ({
  obligation_id: "obligation",
  label: "Obligation",
  kind: "direct_answer",
  status: "covered" as const,
  matched_slots: [],
  missing_slots: [],
  evidence_refs: [],
  doc_refs: [],
  code_refs: [],
  ...entry,
});

describe("Helix Ask turn-contract objective-slot inference extraction boundary", () => {
  it("keeps objective-slot inference out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");
    const builderSource = readFileSync(builderPath, "utf8");

    expect(`${routeSource}\n${builderSource}`).toContain("turn-contract-objective-slots");
    expect(routeSource).not.toMatch(/const\s+inferHelixAskObjectiveSlotsFromObligationCoverage\s*=\s*\(/);
    expect(serviceSource).toMatch(/export\s+const\s+inferHelixAskObjectiveSlotsFromObligationCoverage\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves inferred slots from obligation coverage refs and kinds", () => {
    expect(
      inferHelixAskObjectiveSlotsFromObligationCoverage([
        coverage({ doc_refs: ["docs/research/example.md"] }),
        coverage({ code_refs: ["server/routes/voice/callout.ts"] }),
        coverage({ kind: "roadmap", evidence_refs: ["client/src/translation-panel.tsx"] }),
      ]),
    ).toEqual([
      "repo-mapping",
      "implementation-touchpoints",
      "code-path",
      "next-steps",
      "voice-lane",
      "transcription-translation",
      "definition",
    ]);
  });
});
