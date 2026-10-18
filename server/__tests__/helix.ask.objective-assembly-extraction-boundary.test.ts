import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildDeterministicHelixAskObjectiveAssembly,
  isHelixAskWeakObjectiveAssemblyDraft,
} from "../services/helix-ask/objectives/objective-assembly";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/objectives/objective-assembly.ts");

describe("Helix Ask objective assembly extraction boundary", () => {
  it("keeps objective assembly helpers out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/objectives/objective-assembly");
    expect(routeSource).not.toMatch(/const\s+buildDeterministicHelixAskObjectiveAssembly\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+isHelixAskWeakObjectiveAssemblyDraft\s*=\s*\(/);
    expect(serviceSource).toMatch(/export\s+const\s+buildDeterministicHelixAskObjectiveAssembly\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isHelixAskWeakObjectiveAssemblyDraft\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves deterministic objective assembly fail-closed rendering", () => {
    expect(
      buildDeterministicHelixAskObjectiveAssembly({
        question: "What do electrons and the solar system have in common?",
        currentAnswer: "",
        blockedReason: "objective_assembly_unresolved_requires_unknown_blocks",
        missingScopedRetrievalObjectiveIds: ["obj_1"],
        miniAnswers: [
          {
            objective_id: "obj_1",
            objective_label: "Common Dynamics",
            status: "partial",
            matched_slots: ["concept"],
            missing_slots: ["mechanism"],
            evidence_refs: ["docs/base.md"],
            linked_evidence_refs: ["docs/base.md"],
            summary: "Common Dynamics: partially covered.",
          },
        ],
      }),
    ).toContain("Assembly blocked: required objective gate failed-closed.");
  });

  it("preserves weak objective assembly draft detection", () => {
    expect(isHelixAskWeakObjectiveAssemblyDraft("")).toBe(true);
    expect(isHelixAskWeakObjectiveAssemblyDraft("Objective: Load bearing")).toBe(true);
    expect(
      isHelixAskWeakObjectiveAssemblyDraft(
        "The available evidence supports a concrete answer with cited context and enough explanatory detail.",
      ),
    ).toBe(false);
  });
});
