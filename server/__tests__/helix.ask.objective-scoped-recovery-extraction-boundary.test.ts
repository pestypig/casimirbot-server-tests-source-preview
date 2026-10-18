import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildHelixAskObjectiveScopedRecoveryQueryVariants,
  buildHelixAskObjectiveScopedRecoveryEscalationHints,
  collectHelixAskObjectiveIdsWithoutScopedRetrievalPass,
  collectHelixAskObjectiveIdsWithoutScopedRetrievalPassRouteCompatible,
  collectHelixAskObjectiveScopedRetrievalRecoveryTargets,
  computeHelixAskObjectiveScopedRecoveryMaxAttempts,
  enforceHelixAskObjectiveScopedRetrievalRequirementForMiniAnswersRouteCompatible,
  expandHelixAskObjectiveScopedRecoveryTargets,
  scoreHelixAskObjectiveRecoveryVariantResult,
  shouldBypassHelixAskObjectiveScopedRetrievalAgentGate,
} from "../services/helix-ask/retrieval/objective-scoped-recovery";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(
  repoRoot,
  "server/services/helix-ask/retrieval/objective-scoped-recovery.ts",
);

describe("Helix Ask objective scoped recovery extraction boundary", () => {
  it("moves behavior-identical scoped recovery helpers out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain(
      "../services/helix-ask/retrieval/objective-scoped-recovery",
    );
    expect(routeSource).not.toMatch(
      /const\s+shouldBypassHelixAskObjectiveScopedRetrievalAgentGate\s*=/,
    );
    expect(routeSource).not.toMatch(
      /const\s+collectHelixAskObjectiveScopedRetrievalRecoveryTargets\s*=/,
    );
    expect(routeSource).not.toMatch(
      /const\s+computeHelixAskObjectiveScopedRecoveryMaxAttempts\s*=/,
    );
    expect(routeSource).not.toMatch(
      /const\s+buildHelixAskObjectiveScopedRecoveryEscalationHints\s*=/,
    );
    expect(routeSource).not.toMatch(
      /const\s+expandHelixAskObjectiveScopedRecoveryTargets\s*=/,
    );
    expect(routeSource).not.toMatch(
      /const\s+scoreHelixAskObjectiveRecoveryVariantResult\s*=/,
    );
    expect(routeSource).not.toMatch(
      /const\s+buildHelixAskObjectiveScopedRecoveryQueryVariants\s*=/,
    );
    expect(routeSource).not.toMatch(
      /const\s+collectHelixAskObjectiveIdsWithoutScopedRetrievalPass\s*=/,
    );
    expect(routeSource).not.toMatch(
      /const\s+enforceHelixAskObjectiveScopedRetrievalRequirementForMiniAnswers\s*=/,
    );

    expect(serviceSource).toMatch(
      /export\s+const\s+shouldBypassHelixAskObjectiveScopedRetrievalAgentGate\s*=/,
    );
    expect(serviceSource).toMatch(
      /export\s+const\s+collectHelixAskObjectiveScopedRetrievalRecoveryTargets\s*=/,
    );
    expect(serviceSource).toMatch(
      /export\s+const\s+computeHelixAskObjectiveScopedRecoveryMaxAttempts\s*=/,
    );
    expect(serviceSource).toMatch(
      /export\s+const\s+buildHelixAskObjectiveScopedRecoveryEscalationHints\s*=/,
    );
    expect(serviceSource).toMatch(
      /export\s+const\s+expandHelixAskObjectiveScopedRecoveryTargets\s*=/,
    );
    expect(serviceSource).toMatch(
      /export\s+const\s+scoreHelixAskObjectiveRecoveryVariantResult\s*=/,
    );
    expect(serviceSource).toMatch(
      /export\s+const\s+buildHelixAskObjectiveScopedRecoveryQueryVariants\s*=/,
    );
    expect(serviceSource).toMatch(
      /export\s+const\s+collectHelixAskObjectiveIdsWithoutScopedRetrievalPassRouteCompatible\s*=/,
    );
    expect(serviceSource).toMatch(
      /export\s+const\s+enforceHelixAskObjectiveScopedRetrievalRequirementForMiniAnswersRouteCompatible\s*=/,
    );
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves recovery agent gate bypass behavior", () => {
    expect(
      shouldBypassHelixAskObjectiveScopedRetrievalAgentGate({
        canAgentAct: false,
        objectiveAttempt: 0,
        objectiveHasPriorRetrievalPass: false,
      }),
    ).toBe(true);
    expect(
      shouldBypassHelixAskObjectiveScopedRetrievalAgentGate({
        canAgentAct: true,
        objectiveAttempt: 0,
        objectiveHasPriorRetrievalPass: false,
      }),
    ).toBe(false);
    expect(
      shouldBypassHelixAskObjectiveScopedRetrievalAgentGate({
        canAgentAct: false,
        objectiveAttempt: 1,
        objectiveHasPriorRetrievalPass: false,
      }),
    ).toBe(false);
    expect(
      shouldBypassHelixAskObjectiveScopedRetrievalAgentGate({
        canAgentAct: false,
        objectiveAttempt: 0,
        objectiveHasPriorRetrievalPass: true,
      }),
    ).toBe(false);
  });

  it("preserves scoped recovery target selection and expansion", () => {
    const states = [
      {
        objective_id: "covered",
        objective_label: "covered",
        required_slots: ["evidence"],
        matched_slots: ["evidence"],
        status: "complete" as const,
        attempt: 1,
      },
      {
        objective_id: "already-searched",
        objective_label: "already searched",
        required_slots: ["evidence"],
        matched_slots: [],
        status: "retrieving" as const,
        attempt: 1,
      },
      {
        objective_id: "missing",
        objective_label: "missing",
        required_slots: ["mechanism"],
        matched_slots: [],
        status: "retrieving" as const,
        attempt: 0,
      },
      {
        objective_id: "empty",
        objective_label: "empty",
        required_slots: [],
        matched_slots: [],
        status: "retrieving" as const,
        attempt: 0,
      },
    ];

    const targets = collectHelixAskObjectiveScopedRetrievalRecoveryTargets({
      states,
      retrievalQueries: [{ objective_id: "already-searched" }],
      maxObjectives: 4,
    });
    expect(targets.map((entry) => entry.objective_id)).toEqual(["missing"]);

    const expanded = expandHelixAskObjectiveScopedRecoveryTargets({
      targets,
      repeatCount: 3,
      maxPasses: 2,
    });
    expect(expanded.map((entry) => entry.objective_id)).toEqual(["missing", "missing"]);
  });

  it("preserves recovery attempt, escalation hint, and variant scoring rules", () => {
    expect(
      computeHelixAskObjectiveScopedRecoveryMaxAttempts({
        missingSlots: ["definition"],
        routingSalvageEligible: false,
      }),
    ).toBe(2);
    expect(
      computeHelixAskObjectiveScopedRecoveryMaxAttempts({
        missingSlots: ["code-path"],
        routingSalvageEligible: false,
      }),
    ).toBe(3);
    expect(
      computeHelixAskObjectiveScopedRecoveryMaxAttempts({
        missingSlots: ["definition"],
        routingSalvageEligible: true,
      }),
    ).toBe(3);

    expect(
      buildHelixAskObjectiveScopedRecoveryEscalationHints({
        objectiveLabel: "Casimir tile load bearing",
        missingSlots: ["mechanism", "code-path"],
        priorEvidenceRefs: ["docs/nhm2.md#tile"],
        maxHints: 5,
      }),
    ).toEqual([
      "Casimir tile load bearing",
      "mechanism",
      "how it works",
      "Casimir tile load bearing mechanism",
      "code path",
    ]);

    expect(
      scoreHelixAskObjectiveRecoveryVariantResult({
        files: ["a.ts", "b.ts"],
        queryHitCount: 3,
        topScore: 4,
        scoreGap: 5,
        topicMustIncludeOk: false,
      }),
    ).toBe(2195);
  });

  it("preserves route-compatible query variants and missing retrieval enforcement", () => {
    expect(
      buildHelixAskObjectiveScopedRecoveryQueryVariants({
        baseQuestion: "Base question",
        primaryQueries: ["Primary query"],
        objectiveLabel: "Tile load",
        missingSlots: ["mechanism"],
        maxQueries: 3,
        maxVariants: 4,
      }),
    ).toEqual([
      ["Primary query"],
      ["Base question", "Tile load", "Tile load mechanism"],
      ["Tile load", "Tile load mechanism", "how does Tile load work"],
    ]);

    const states = [
      {
        objective_id: "definition-only",
        objective_label: "Definition only",
        required_slots: ["definition"],
        matched_slots: [],
        status: "pending" as const,
        attempt: 0,
      },
      {
        objective_id: "mechanism",
        objective_label: "Mechanism",
        required_slots: ["mechanism"],
        matched_slots: [],
        status: "pending" as const,
        attempt: 0,
      },
    ];

    expect(
      collectHelixAskObjectiveIdsWithoutScopedRetrievalPass({
        states,
        retrievalQueries: [],
        maxObjectives: 4,
      }),
    ).toEqual(["mechanism"]);
    expect(
      collectHelixAskObjectiveIdsWithoutScopedRetrievalPassRouteCompatible({
        states,
        retrievalQueries: [],
        maxObjectives: 4,
      }),
    ).toEqual(["definition-only", "mechanism"]);

    expect(
      enforceHelixAskObjectiveScopedRetrievalRequirementForMiniAnswersRouteCompatible({
        states,
        retrievalQueries: [],
        maxObjectives: 1,
        miniAnswers: [
          {
            objective_id: "definition-only",
            objective_label: "Definition only",
            status: "covered" as const,
            matched_slots: [],
            missing_slots: [],
            evidence_refs: [],
            summary: "Definition covered.",
          },
        ],
      }),
    ).toMatchObject({
      missingObjectiveIds: ["definition-only"],
      miniAnswers: [
        {
          objective_id: "definition-only",
          status: "partial",
          missing_slots: ["definition"],
        },
      ],
    });
  });
});
