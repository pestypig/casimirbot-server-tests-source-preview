import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyHelixAskObjectiveCoverageSnapshot,
  buildHelixAskObjectiveLoopState,
  buildHelixAskObjectivePlainReasoningTrace,
  enforceHelixAskObjectiveEvidenceSufficiency,
  enforceHelixAskObjectiveUnknownBlocks,
  finalizeHelixAskObjectiveLoopState,
  isHelixAskObjectiveCoverageSatisfied,
  isHelixAskObjectiveTerminalStatus,
  scoreHelixAskObjectiveEvidenceSufficiency,
  summarizeHelixAskObjectiveLoopState,
  transitionHelixAskObjectiveState,
} from "../services/helix-ask/objectives/objective-loop-debug";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/objectives/objective-loop-debug.ts");

describe("Helix Ask objective loop debug extraction boundary", () => {
  it("keeps objective loop pure helpers out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/objectives/objective-loop-debug");
    expect(routeSource).not.toMatch(/const\s+isHelixAskObjectiveTerminalStatus\s*=/);
    expect(routeSource).not.toMatch(/const\s+isHelixAskObjectiveCoverageSatisfied\s*=/);
    expect(routeSource).not.toMatch(/const\s+enforceHelixAskObjectiveUnknownBlocks\s*=/);
    expect(routeSource).not.toMatch(/const\s+scoreHelixAskObjectiveEvidenceSufficiency\s*=/);
    expect(routeSource).not.toMatch(/const\s+enforceHelixAskObjectiveEvidenceSufficiency\s*=/);
    expect(routeSource).not.toMatch(/const\s+buildHelixAskObjectiveLoopState\s*=/);
    expect(routeSource).not.toMatch(/const\s+transitionHelixAskObjectiveState\s*=/);
    expect(routeSource).not.toMatch(/const\s+applyHelixAskObjectiveCoverageSnapshot\s*=/);
    expect(routeSource).not.toMatch(/const\s+summarizeHelixAskObjectiveLoopState\s*=/);
    expect(routeSource).not.toMatch(/const\s+buildHelixAskObjectivePlainReasoningTrace\s*=/);
    expect(routeSource).not.toMatch(/const\s+finalizeHelixAskObjectiveLoopState\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isHelixAskObjectiveTerminalStatus\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+isHelixAskObjectiveCoverageSatisfied\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+enforceHelixAskObjectiveUnknownBlocks\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+scoreHelixAskObjectiveEvidenceSufficiency\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+enforceHelixAskObjectiveEvidenceSufficiency\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixAskObjectiveLoopState\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+transitionHelixAskObjectiveState\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+applyHelixAskObjectiveCoverageSnapshot\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+summarizeHelixAskObjectiveLoopState\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+buildHelixAskObjectivePlainReasoningTrace\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+finalizeHelixAskObjectiveLoopState\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves objective terminal and coverage checks", () => {
    expect(isHelixAskObjectiveTerminalStatus("complete")).toBe(true);
    expect(isHelixAskObjectiveTerminalStatus("blocked")).toBe(true);
    expect(isHelixAskObjectiveTerminalStatus("retrieving")).toBe(false);
    expect(
      isHelixAskObjectiveCoverageSatisfied({
        objective_id: "obj_1",
        objective_label: "Evidence",
        required_slots: ["doc-evidence", "numeric-result"],
        matched_slots: ["doc-evidence"],
        status: "retrieving",
        attempt: 1,
      }),
    ).toBe(false);
  });

  it("preserves unknown-block and evidence-sufficiency enforcement", () => {
    const miniAnswer = {
      objective_id: "obj_1",
      objective_label: "Load Bearing",
      status: "covered" as const,
      matched_slots: ["doc-evidence"],
      missing_slots: [],
      evidence_refs: [],
      linked_evidence_refs: [],
      summary: "Load Bearing: covered.",
    };
    const state = {
      objective_id: "obj_1",
      objective_label: "Load Bearing",
      required_slots: ["doc-evidence", "numeric-result"],
      matched_slots: ["doc-evidence"],
      status: "synthesizing" as const,
      attempt: 1,
      retrieval_confidence: 0,
    };

    expect(
      enforceHelixAskObjectiveUnknownBlocks({
        miniAnswers: [{ ...miniAnswer, status: "partial", missing_slots: ["numeric-result"] }],
        maxObjectives: 2,
      }).missingObjectiveIds,
    ).toEqual(["obj_1"]);

    expect(scoreHelixAskObjectiveEvidenceSufficiency({ miniAnswer, state }).reason).toBe(
      "objective_zero_confidence_missing_evidence_linkage",
    );

    const enforced = enforceHelixAskObjectiveEvidenceSufficiency({
      miniAnswers: [miniAnswer],
      states: [state],
    });
    expect(enforced.miniAnswers[0]?.status).toBe("blocked");
    expect(enforced.terminalizationReasons.obj_1).toBe("objective_oes_below_block_threshold");
  });

  it("preserves objective loop state, summary, reasoning trace, and finalization helpers", () => {
    const states = buildHelixAskObjectiveLoopState(
      {
        required_slots: ["doc-evidence"],
        objectives: [
          {
            label: "Load Bearing",
            required_slots: ["numeric-result"],
          },
          {
            label: "Source Context",
            required_slots: [],
          },
        ],
      },
      {
        slugifySectionId: (value, fallback) =>
          value ? value.toLowerCase().replace(/\s+/g, "-") : fallback,
      },
    );

    expect(states).toEqual([
      {
        objective_id: "load-bearing",
        objective_label: "Load Bearing",
        required_slots: ["numeric-result"],
        matched_slots: [],
        status: "pending",
        attempt: 0,
      },
      {
        objective_id: "source-context",
        objective_label: "Source Context",
        required_slots: ["doc-evidence"],
        matched_slots: [],
        status: "pending",
        attempt: 0,
      },
    ]);

    const transition = transitionHelixAskObjectiveState({
      state: states[0]!,
      to: "retrieving",
      reason: "objective_scoped_retrieval",
      at: "2026-06-23T00:00:00.000Z",
    });
    expect(transition.state.attempt).toBe(1);
    expect(transition.transition?.reason).toBe("objective_scoped_retrieval");

    const transitionLog = [];
    const covered = applyHelixAskObjectiveCoverageSnapshot({
      states: [transition.state, states[1]!],
      coveredSlots: ["numeric-result"],
      retrievalConfidence: 0.75,
      transitionLog,
      at: "2026-06-23T00:00:01.000Z",
    });
    expect(covered[0]?.status).toBe("synthesizing");
    expect(covered[0]?.matched_slots).toEqual(["numeric-result"]);
    expect(covered[0]?.retrieval_confidence).toBe(0.75);
    expect(transitionLog).toHaveLength(1);

    expect(summarizeHelixAskObjectiveLoopState(covered)).toMatchObject({
      total: 2,
      completeCount: 0,
      blockedCount: 0,
      terminalCount: 0,
      unresolvedCount: 2,
      completionRate: 0,
    });

    const trace = buildHelixAskObjectivePlainReasoningTrace({
      miniAnswers: [
        {
          objective_id: "load-bearing",
          objective_label: "Load Bearing",
          status: "covered",
          matched_slots: ["numeric-result"],
          missing_slots: [],
          evidence_refs: ["doc:nhm2#tile"],
          linked_evidence_refs: [],
          summary: "Load Bearing: covered.",
        },
      ],
      states: covered,
      scores: [
        {
          objective_id: "load-bearing",
          score: 0.8,
          threshold: 0.7,
          pass: true,
          reason: "objective_supported",
        },
      ],
      transitions: transitionLog,
      stepTranscripts: [
        {
          objective_id: "load-bearing",
          attempt: 1,
          verb: "MINI_CRITIC",
          phase: "objective_loop",
          started_at: "2026-06-23T00:00:02.000Z",
          ended_at: "2026-06-23T00:00:03.000Z",
          decision: "accept",
          decision_reason: "evidence matches numeric result",
        },
      ],
      retrievalQueries: [{ objective_id: "load-bearing" }],
      terminalizationReasons: { "load-bearing": "objective_covered" },
      normalizeText: (value, maxChars) => value.trim().slice(0, maxChars),
    });
    expect(trace[0]?.plain_reasoning).toContain("All required slots covered.");
    expect(trace[0]?.used_telemetry.evidence_refs).toEqual(["doc:nhm2#tile"]);

    const finalized = finalizeHelixAskObjectiveLoopState({
      states: covered,
      validationPassed: true,
      transitionLog,
      at: "2026-06-23T00:00:04.000Z",
    });
    expect(finalized[0]?.status).toBe("complete");
    expect(finalized[1]?.status).toBe("blocked");
  });
});
