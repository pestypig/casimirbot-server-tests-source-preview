import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildHelixAskObjectiveUnknownBlock,
  isHelixAskGenericUnknownScaffold,
  sanitizeHelixAskObjectiveUnknownBlock,
} from "../services/helix-ask/contracts/turn-contract-objective-unknown";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-objective-unknown.ts");
const builderPath = join(repoRoot, "server/services/helix-ask/contracts/turn-contract-builder.ts");

describe("Helix Ask objective unknown-block extraction boundary", () => {
  it("keeps unknown-block helpers out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");
    const builderSource = readFileSync(builderPath, "utf8");

    expect(`${routeSource}\n${builderSource}`).toContain("turn-contract-objective-unknown");
    expect(routeSource).not.toMatch(/const\s+buildHelixAskObjectiveUnknownBlock\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+sanitizeHelixAskObjectiveUnknownBlock\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+isHelixAskGenericUnknownScaffold\s*=\s*\(/);
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixAskObjectiveUnknownBlock\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+sanitizeHelixAskObjectiveUnknownBlock\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isHelixAskGenericUnknownScaffold\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves fallback construction and generic scaffold sanitization", () => {
    const fallback = buildHelixAskObjectiveUnknownBlock({
      objectiveLabel: "Load Bearing",
      missingSlots: ["Force Value", "lbs conversion"],
      evidenceRefs: [],
      scopedRetrievalMissing: true,
    });

    expect(fallback).toEqual({
      unknown: "Required objective unresolved: Load Bearing.",
      why:
        "required objective unresolved because no objective-scoped retrieval pass was recorded and slots remain missing: force-value, lbs-conversion",
      what_i_checked: ['No objective-scoped retrieval pass was recorded for "Load Bearing".'],
      next_retrieval:
        'Run objective-scoped retrieval for "Load Bearing" and collect evidence for slots: force-value, lbs-conversion.',
    });

    expect(isHelixAskGenericUnknownScaffold("Sources: open-world best-effort")).toBe(true);
    expect(
      sanitizeHelixAskObjectiveUnknownBlock({
        objectiveLabel: "Load Bearing",
        missingSlots: ["force value"],
        evidenceRefs: ["docs/research/nhm2.md"],
        block: {
          unknown: 'For "Load Bearing", start with one concrete claim',
          why: "Sources: open-world best-effort",
          what_i_checked: ["Sources: open-world best-effort", "docs/research/nhm2.md"],
          next_retrieval: "core meaning of the concept in its domain context",
        },
      }),
    ).toEqual({
      unknown: "Required objective unresolved: Load Bearing.",
      why: "required objective unresolved; missing force-value",
      what_i_checked: ["docs/research/nhm2.md"],
      next_retrieval:
        'Run objective-scoped retrieval for "Load Bearing" and collect evidence for slots: force-value.',
    });
  });
});
