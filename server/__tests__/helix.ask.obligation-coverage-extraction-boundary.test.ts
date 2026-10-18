import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildHelixAskTurnContractObligationCoverage,
  selectHelixAskObligationEvidenceRefs,
  type HelixAskEvidencePackObligationCoverage,
} from "../services/helix-ask/obligation-coverage";
import type { HelixAskAnswerObligation } from "../services/helix-ask/obligations";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/obligation-coverage.ts");

const obligation = (entry: Partial<HelixAskAnswerObligation>): HelixAskAnswerObligation => ({
  id: entry.id ?? "mechanism",
  label: entry.label ?? "Explain mechanism",
  kind: entry.kind ?? "mechanism",
  required: entry.required ?? true,
  required_slots: entry.required_slots ?? ["doc_evidence"],
  preferred_evidence: entry.preferred_evidence ?? ["doc", "code"],
  objective_label: entry.objective_label ?? null,
  section_title: entry.section_title ?? null,
});

describe("Helix Ask obligation coverage extraction boundary", () => {
  it("keeps obligation evidence-ref selection out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/obligation-coverage");
    expect(routeSource).not.toMatch(/const\s+selectHelixAskObligationEvidenceRefs\s*=\s*\(/);
    expect(serviceSource).toMatch(/export\s+const\s+selectHelixAskObligationEvidenceRefs\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixAskTurnContractObligationCoverage\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves preferred evidence ordering and caps", () => {
    const refs = selectHelixAskObligationEvidenceRefs({
      obligation: obligation({ preferred_evidence: ["code", "doc"] }),
      allowedCitations: [
        "docs/overview.md",
        "server/routes/agi.plan.ts",
        "client/src/App.tsx",
        "docs/details.md",
      ],
      precedencePaths: ["client/src/App.tsx"],
      prioritizeCitations: (citations) => citations,
    });

    expect(refs.codeRefs).toEqual(["client/src/App.tsx", "server/routes/agi.plan.ts"]);
    expect(refs.docRefs).toEqual(["docs/overview.md", "docs/details.md"]);
    expect(refs.evidenceRefs.slice(0, 4)).toEqual([
      "client/src/App.tsx",
      "server/routes/agi.plan.ts",
      "docs/overview.md",
      "docs/details.md",
    ]);
  });

  it("preserves obligation coverage status calculation", () => {
    const coverage = buildHelixAskTurnContractObligationCoverage({
      obligations: [
        obligation({
          id: "doc",
          required_slots: ["doc_evidence"],
          preferred_evidence: ["doc"],
        }),
      ],
      coveredSlots: ["doc_evidence"],
      allowedCitations: ["docs/overview.md"],
      prioritizeCitations: (citations) => citations,
    });

    expect(coverage).toEqual<HelixAskEvidencePackObligationCoverage[]>([
      {
        obligation_id: "doc",
        label: "Explain mechanism",
        kind: "mechanism",
        status: "covered",
        matched_slots: ["doc-evidence"],
        missing_slots: [],
        evidence_refs: ["docs/overview.md"],
        doc_refs: ["docs/overview.md"],
        code_refs: [],
      },
    ]);
  });
});
