import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  adaptHelixAskFallbackSectionsForGrounding,
  createHelixAskAnswerObligation,
  inferHelixAskAnswerPlanSectionEvidenceKinds,
  normalizeHelixAskAnswerFormatEvidenceKinds,
  normalizeHelixAskAnswerObligationLabel,
  type HelixAskAnswerPlanSectionLike,
} from "../services/helix-ask/obligations";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/obligations.ts");

const section = (
  entry: Partial<HelixAskAnswerPlanSectionLike> & Pick<HelixAskAnswerPlanSectionLike, "id" | "title">,
): HelixAskAnswerPlanSectionLike => ({
  id: entry.id,
  title: entry.title,
  required: entry.required ?? true,
  must_answer: entry.must_answer,
  required_slots: entry.required_slots,
  preferred_evidence: entry.preferred_evidence,
  kind: entry.kind,
  objective_label: entry.objective_label,
});

describe("Helix Ask obligations extraction boundary", () => {
  it("keeps fallback section grounding adaptation out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/obligations");
    expect(routeSource).not.toMatch(/const\s+adaptHelixAskFallbackSectionsForGrounding\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+adaptHelixAskFallbackSectionsForGrounding\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("keeps obligation label and factory helpers out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("normalizeHelixAskAnswerObligationLabel");
    expect(routeSource).not.toMatch(/const\s+normalizeHelixAskAnswerObligationLabel\s*=/);
    expect(routeSource).not.toMatch(/const\s+mapHelixAskSectionKindToObligationKind\s*=/);
    expect(routeSource).not.toMatch(/const\s+inferHelixAskAnswerObligationKind\s*=/);
    expect(routeSource).not.toMatch(/const\s+createHelixAskAnswerObligation\s*=/);
    expect(routeSource).not.toMatch(/const\s+doesHelixAskPlannerSectionCoverObjective\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+normalizeHelixAskAnswerObligationLabel\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+createHelixAskAnswerObligation\s*=/);
  });

  it("keeps answer-format evidence helpers out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("normalizeHelixAskAnswerFormatEvidenceKinds");
    expect(routeSource).toContain("inferHelixAskAnswerPlanSectionEvidenceKinds");
    expect(routeSource).not.toMatch(/const\s+normalizeHelixAskAnswerFormatSectionKind\s*=/);
    expect(routeSource).not.toMatch(/const\s+normalizeHelixAskAnswerFormatEvidenceKinds\s*=/);
    expect(routeSource).not.toMatch(/const\s+inferHelixAskAnswerPlanSectionEvidenceKinds\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+normalizeHelixAskAnswerFormatSectionKind\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+normalizeHelixAskAnswerFormatEvidenceKinds\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+inferHelixAskAnswerPlanSectionEvidenceKinds\s*=/);
  });

  it("preserves service-owned obligation label normalization and factory output", () => {
    expect(normalizeHelixAskAnswerObligationLabel("Plan for repo evidence?", "fallback")).toBe(
      "repo evidence",
    );

    expect(
      createHelixAskAnswerObligation({
        id: "implementation",
        label: "Show the repo path",
        family: "implementation_code_path",
        required: true,
        requiredSlots: ["code_path", "runtime"],
        sectionKind: "repo",
        sectionTitle: "Implementation",
      }),
    ).toEqual({
      id: "implementation",
      label: "Show the repo path",
      kind: "implementation",
      required: true,
      required_slots: ["code-path", "runtime"],
      preferred_evidence: ["code", "doc", "runtime"],
      objective_label: null,
      section_title: "Implementation",
    });
  });

  it("preserves service-owned evidence normalization and section evidence inference", () => {
    expect(normalizeHelixAskAnswerFormatEvidenceKinds(["doc", "runtime", "doc"], ["code"])).toEqual([
      "doc",
      "runtime",
    ]);
    expect(normalizeHelixAskAnswerFormatEvidenceKinds(["unknown"], ["code"])).toEqual(["code"]);
    expect(
      inferHelixAskAnswerPlanSectionEvidenceKinds({
        kind: "mechanism",
        requiredSlots: ["code_path"],
      }),
    ).toEqual(["doc", "code"]);
  });

  it("preserves pass-through behavior for non-comparison families", () => {
    const sections = [section({ id: "answer", title: "Answer", required_slots: ["direct"] })];

    const adapted = adaptHelixAskFallbackSectionsForGrounding({
      family: "general_overview",
      requiresRepoEvidence: false,
      requiredSlots: ["direct"],
      sections,
    });

    expect(adapted).toBe(sections);
  });

  it("preserves comparison differences slot filtering without repo evidence", () => {
    const adapted = adaptHelixAskFallbackSectionsForGrounding({
      family: "comparison_tradeoff",
      requiresRepoEvidence: false,
      sections: [
        section({
          id: "differences",
          title: "Differences",
          required_slots: ["mechanism", "code_path"],
        }),
      ],
    });

    expect(adapted).toEqual([
      {
        id: "differences",
        title: "Differences",
        required: true,
        must_answer: undefined,
        required_slots: ["mechanism"],
        preferred_evidence: undefined,
        kind: undefined,
        objective_label: undefined,
      },
    ]);
  });

  it("preserves comparison code-path slots when repo evidence is required", () => {
    const adapted = adaptHelixAskFallbackSectionsForGrounding({
      family: "comparison_tradeoff",
      requiresRepoEvidence: true,
      sections: [
        section({
          id: "differences",
          title: "Differences",
          required_slots: ["mechanism", "code_path"],
        }),
      ],
    });

    expect(adapted[0]?.required_slots).toEqual(["mechanism", "code-path"]);
  });

  it("preserves required-slot matching for choice and risk sections", () => {
    const adapted = adaptHelixAskFallbackSectionsForGrounding({
      family: "comparison_tradeoff",
      requiresRepoEvidence: false,
      requiredSlots: ["decision", "risk"],
      sections: [
        section({ id: "choice", title: "Choice" }),
        section({ id: "risks", title: "Risks" }),
      ],
    });

    expect(adapted.map((entry) => entry.required_slots)).toEqual([["decision"], ["risk"]]);
  });
});
