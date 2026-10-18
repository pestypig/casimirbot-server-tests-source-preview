import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildHelixAskObjectivePlannerPrompt,
  buildHelixAskObjectiveRetrieveProposalPrompt,
  parseHelixAskObjectiveMiniCritique,
  parseHelixAskObjectiveMiniSynth,
  parseHelixAskObjectivePlannerPass,
  parseHelixAskObjectiveRetrieveProposal,
} from "../services/helix-ask/objectives/objective-llm-contracts";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(
  repoRoot,
  "server/services/helix-ask/objectives/objective-llm-contracts.ts",
);

describe("Helix Ask objective LLM contracts extraction boundary", () => {
  it("keeps objective LLM prompt and parser helpers out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/objectives/objective-llm-contracts");
    expect(routeSource).not.toMatch(/^const\s+buildHelixAskObjectivePlannerPrompt\s*=/m);
    expect(routeSource).not.toMatch(/^const\s+parseHelixAskObjectivePlannerPass\s*=/m);
    expect(routeSource).not.toMatch(/const\s+buildHelixAskObjectiveRetrieveProposalPrompt\s*=/);
    expect(routeSource).not.toMatch(/const\s+parseHelixAskObjectiveRetrieveProposal\s*=/);
    expect(routeSource).not.toMatch(/^const\s+parseHelixAskObjectiveMiniSynth\s*=/m);
    expect(routeSource).not.toMatch(/^const\s+parseHelixAskObjectiveMiniCritique\s*=/m);
    expect(routeSource).not.toMatch(/^const\s+collectHelixAskJsonParseCandidates\s*=/m);
    expect(routeSource).not.toMatch(/^const\s+normalizeHelixAskObjectiveSlotArray\s*=/m);
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixAskObjectivePlannerPrompt\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+parseHelixAskObjectivePlannerPass\s*=/);
    expect(serviceSource).toMatch(
      /export\s+const\s+buildHelixAskObjectiveRetrieveProposalPrompt\s*=/,
    );
    expect(serviceSource).toMatch(/export\s+const\s+parseHelixAskObjectiveRetrieveProposal\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+parseHelixAskObjectiveMiniSynth\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+parseHelixAskObjectiveMiniCritique\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves retrieve-proposal prompt rendering", () => {
    expect(
      buildHelixAskObjectiveRetrieveProposalPrompt({
        question: "What is the load bearing?",
        objectiveId: "load-bearing",
        objectiveLabel: "Load Bearing",
        requiredSlots: ["numeric-result", "doc-evidence"],
        missingSlots: ["numeric-result"],
        queryHints: ["newtons per tile", "lbs conversion"],
        responseLanguage: "en",
      }),
    ).toContain(
      [
        "You are Helix Ask objective retrieval planner.",
        "Return strict JSON only. No markdown. No commentary.",
        "Schema:",
        '{ "objective_id":"string","queries":["string"],"rationale":"string" }',
      ].join("\n"),
    );
  });

  it("preserves objective planner prompt rendering and parser normalization", () => {
    expect(
      buildHelixAskObjectivePlannerPrompt({
        question: "Explain NHM2 load bearing.",
        requiresRepoEvidence: true,
        intentDomain: "repo",
        outputFamily: "mechanism_process",
        maxObjectives: 4,
        maxRequiredSlots: 10,
        maxQueryHints: 16,
      }),
    ).toContain(
      [
        "You are Helix Ask objective planner.",
        "Return strict JSON only. No markdown. No commentary.",
        "Do not emit file paths, code symbols, citations, or final-answer prose.",
      ].join("\n"),
    );

    expect(
      parseHelixAskObjectivePlannerPass({
        raw: JSON.stringify({
          goal: "Explain docs/research/nhm2.md load bearing",
          objectives: [
            {
              label: "Find newtons per tile",
              required_slots: ["numeric result", "doc evidence"],
              query_hints: ["newtons per tile", "load bearing lbs"],
            },
          ],
          grounding_mode: "repo",
          output_family: "mechanism_process",
          sections: [
            {
              id: "numeric answer",
              title: "Numeric Answer",
              required: true,
              must_answer: ["Convert newtons to lbs"],
              required_slots: ["numeric result"],
              preferred_evidence: ["doc"],
              kind: "answer",
            },
          ],
          verbosity: "normal",
          required_slots: ["numeric result", "doc evidence"],
          query_hints: ["NHM2 Casimir tile newtons"],
          clarify_question: "Which tile variant?",
          risk_flags: ["multi objective"],
        }),
        maxObjectives: 4,
        maxRequiredSlots: 10,
        maxQueryHints: 16,
      }),
    ).toEqual({
      goal: "Explain load bearing",
      objectives: [
        {
          label: "Find newtons per tile",
          required_slots: ["numeric-result", "doc-evidence"],
          query_hints: ["newtons per tile", "load bearing lbs"],
        },
      ],
      grounding_mode: "repo",
      output_family: "mechanism_process",
      sections: [
        {
          id: "numeric_answer",
          title: "Numeric Answer",
          required: true,
          must_answer: ["Convert newtons to lbs"],
          required_slots: ["numeric-result"],
          preferred_evidence: ["doc"],
          kind: "answer",
        },
      ],
      verbosity: "normal",
      required_slots: ["numeric-result", "doc-evidence"],
      query_hints: ["NHM2 Casimir tile newtons"],
      clarify_question: "Which tile variant?",
      risk_flags: ["multi-objective"],
    });

    expect(
      parseHelixAskObjectivePlannerPass({
        raw: "not json",
        maxObjectives: 4,
        maxRequiredSlots: 10,
        maxQueryHints: 16,
      }),
    ).toBeNull();
  });

  it("preserves retrieve-proposal parsing from nested and action-shaped JSON", () => {
    expect(
      parseHelixAskObjectiveRetrieveProposal(
        JSON.stringify({
          data: {
            objective_id: "load-bearing",
            queries: ["newtons per tile"],
            actions: [{ q: "casimir tile load bearing lbs" }],
            rationale: "Need the numeric evidence.",
          },
        }),
      ),
    ).toEqual({
      objective_id: "load-bearing",
      queries: ["newtons per tile", "casimir tile load bearing lbs"],
      rationale: "Need the numeric evidence.",
    });

    expect(parseHelixAskObjectiveRetrieveProposal("not json")).toBeNull();
  });

  it("preserves mini-synth parsing from JSON and single-objective text fallback", () => {
    expect(
      parseHelixAskObjectiveMiniSynth(
        JSON.stringify({
          objectives: [
            {
              objective_id: "load-bearing",
              status: "complete",
              matched_slots: ["numeric result", "doc evidence"],
              missing_slots: ["unused"],
              summary: "Load bearing was grounded.",
              evidence_refs: ["docs/research/nhm2.md"],
            },
          ],
        }),
      ),
    ).toEqual({
      objectives: [
        {
          objective_id: "load-bearing",
          status: "covered",
          matched_slots: ["numeric-result", "doc-evidence"],
          missing_slots: [],
          summary: "Load bearing was grounded.",
          evidence_refs: ["docs/research/nhm2.md"],
          unknown_block: undefined,
        },
      ],
    });

    expect(
      parseHelixAskObjectiveMiniSynth("partial. Missing slots: doc evidence.", {
        objectiveHints: [
          {
            objective_id: "load-bearing",
            objective_label: "Load Bearing",
            required_slots: ["numeric-result", "doc-evidence"],
          },
        ],
      }),
    ).toMatchObject({
      objectives: [
        {
          objective_id: "load-bearing",
          status: "partial",
          matched_slots: ["numeric-result"],
          missing_slots: ["doc-evidence"],
        },
      ],
    });
  });

  it("preserves mini-critique parsing", () => {
    expect(
      parseHelixAskObjectiveMiniCritique(
        JSON.stringify({
          data: {
            objectives: [
              {
                objective_id: "load-bearing",
                status: "blocked",
                missing_slots: ["doc evidence"],
                reason: "No citation reached the target document.",
              },
            ],
          },
        }),
      ),
    ).toEqual({
      objectives: [
        {
          objective_id: "load-bearing",
          status: "blocked",
          missing_slots: ["doc-evidence"],
          reason: "No citation reached the target document.",
        },
      ],
    });

    expect(parseHelixAskObjectiveMiniCritique("no json")).toBeNull();
  });
});
