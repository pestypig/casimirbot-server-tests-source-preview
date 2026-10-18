import { describe, expect, it } from "vitest";
import type { HelixActionRehearsalResult } from "@shared/helix-action-rehearsal";
import houseChestFood from "../../fixtures/environment-state/minecraft/house-chest-food.snapshot.json";
import blockedRehearsal from "../../fixtures/environment-rehearsal/retrieve-food.blocked.json";
import {
  normalizeEnvironmentStateSnapshot,
} from "../services/situation-room/environment-state-snapshot-window";
import { reduceEnvironmentAffordances } from "../services/situation-room/environment-affordance-reducer";
import { updateEnvironmentMemoryLedger } from "../services/situation-room/environment-memory-ledger";
import { buildPossibilityGraph } from "../services/situation-room/possibility-graph-builder";
import { rehearsePossibilityGraph } from "../services/situation-room/action-rehearsal-engine";
import {
  buildRecommendationGate,
  lineValuesFromRecommendationGate,
} from "../services/situation-room/live-recommendation-gate-reducer";

const buildFoodGraph = () => {
  const snapshot = normalizeEnvironmentStateSnapshot({ snapshot: houseChestFood });
  const affordances = reduceEnvironmentAffordances(snapshot!);
  const memory = updateEnvironmentMemoryLedger(snapshot!);
  const graph = buildPossibilityGraph({
    objective: "prepare for mining",
    threadId: "helix-ask:test",
    environmentState: snapshot!,
    affordanceContext: affordances,
    memoryLedger: memory,
    now: "2026-05-19T18:30:05.000Z",
  });
  return { snapshot: snapshot!, affordances, graph: graph! };
};

describe("environment recommendation gate", () => {
  it("does not let a possibility graph update the recommendation line by itself", () => {
    const { snapshot, affordances, graph } = buildFoodGraph();
    const gate = buildRecommendationGate({
      environment: null,
      snapshot,
      affordanceContext: affordances,
      graph,
      rehearsal: null,
      objective: "prepare for mining",
      threadId: "helix-ask:test",
      now: "2026-05-19T18:30:05.000Z",
    });
    const lines = lineValuesFromRecommendationGate({ gate, graph, rehearsal: null, affordanceContext: affordances });

    expect(gate.status).toBe("awaiting_rehearsal");
    expect(lines.possibilities.value).toMatch(/candidate/i);
    expect(lines.rehearsal.value).toMatch(/not rehearsed/i);
    expect(lines.recommendation).toBeUndefined();
  });

  it("allows a recommendation only after feasible read-only rehearsal", () => {
    const { snapshot, affordances, graph } = buildFoodGraph();
    const { result } = rehearsePossibilityGraph({
      graph,
      environmentState: snapshot,
      now: "2026-05-19T18:30:05.000Z",
    });
    const gate = buildRecommendationGate({
      environment: null,
      snapshot,
      affordanceContext: affordances,
      graph,
      rehearsal: result,
      objective: "prepare for mining",
      threadId: "helix-ask:test",
      now: "2026-05-19T18:30:05.000Z",
    });
    const lines = lineValuesFromRecommendationGate({ gate, graph, rehearsal: result, affordanceContext: affordances });

    expect(result.side_effects_performed).toBe(false);
    expect(gate.status).toBe("safe_to_suggest");
    expect(lines.recommendation.value).toMatch(/porkchop/i);
  });

  it("suppresses action text when rehearsal blocks the graph", () => {
    const { snapshot, affordances, graph } = buildFoodGraph();
    const gate = buildRecommendationGate({
      environment: null,
      snapshot,
      affordanceContext: affordances,
      graph,
      rehearsal: blockedRehearsal as HelixActionRehearsalResult,
      objective: "prepare for mining",
      threadId: "helix-ask:test",
      now: "2026-05-19T18:30:05.000Z",
    });
    const lines = lineValuesFromRecommendationGate({
      gate,
      graph,
      rehearsal: blockedRehearsal as HelixActionRehearsalResult,
      affordanceContext: affordances,
    });

    expect(gate.status).toBe("blocked");
    expect(lines.recommendation).toBeUndefined();
    expect(lines.unknowns.value).toMatch(/blocked|not verified/i);
  });
});
