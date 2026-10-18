import { describe, expect, it, beforeEach } from "vitest";
import privilegedClosed from "../../fixtures/environment-state/minecraft/privileged-closed-chest.snapshot.json";
import playerOpened from "../../fixtures/environment-state/minecraft/player-equivalent-open-chest.snapshot.json";
import { reduceEnvironmentStateSnapshot } from "../services/situation-room/environment-state-snapshot-reducer";
import { normalizeMinecraftPluginSnapshot } from "../services/situation-room/minecraft-plugin-snapshot-normalizer";
import { reduceEnvironmentAffordances } from "../services/situation-room/environment-affordance-reducer";
import { updateEnvironmentMemoryLedger, resetEnvironmentMemoryLedgersForTest } from "../services/situation-room/environment-memory-ledger";
import { buildPossibilityGraph } from "../services/situation-room/possibility-graph-builder";
import { rehearsePossibilityGraph } from "../services/situation-room/action-rehearsal-engine";
import { buildRecommendationGate } from "../services/situation-room/live-recommendation-gate-reducer";
import { resetEnvironmentProbeBrokerForTest } from "../services/situation-room/environment-probe-broker";

describe("environment sensor scope policy", () => {
  beforeEach(() => {
    resetEnvironmentMemoryLedgersForTest();
    resetEnvironmentProbeBrokerForTest();
  });

  it("phrases privileged chest scans as server sensor state and gates with a caveat", () => {
    const snapshot = normalizeMinecraftPluginSnapshot({ snapshot: privilegedClosed })!;
    const lines = reduceEnvironmentStateSnapshot(snapshot);
    const affordances = reduceEnvironmentAffordances(snapshot);
    const memory = updateEnvironmentMemoryLedger(snapshot);
    const graph = buildPossibilityGraph({
      objective: "prepare for mining",
      threadId: "helix-ask:test",
      environmentState: snapshot,
      affordanceContext: affordances,
      memoryLedger: memory,
      now: "2026-05-19T18:30:05.000Z",
    })!;
    const { result } = rehearsePossibilityGraph({ graph, environmentState: snapshot, now: "2026-05-19T18:30:05.000Z" });
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

    expect(snapshot.object_state?.nearby_containers?.[0].sensor_scope).toBe("privileged_server_state");
    expect(lines.resources).toMatch(/server sensor/i);
    expect(lines.resources).not.toMatch(/you previously observed/i);
    expect(gate.status).toBe("suggest_with_caveat");
  });

  it("allows player-opened chest contents to support player memory language", () => {
    const snapshot = normalizeMinecraftPluginSnapshot({ snapshot: playerOpened })!;
    const lines = reduceEnvironmentStateSnapshot(snapshot);

    expect(snapshot.object_state?.nearby_containers?.[0].sensor_scope).toBe("player_memory");
    expect(lines.resources).toMatch(/previously observed/i);
  });
});
