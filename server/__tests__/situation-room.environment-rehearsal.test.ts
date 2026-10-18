import { beforeEach, describe, expect, it } from "vitest";
import {
  createLiveAnswerEnvironment,
  resetLiveAnswerEnvironments,
} from "../services/situation-room/live-answer-environment-store";
import {
  normalizeEnvironmentStateSnapshot,
  resetEnvironmentStateSnapshotWindowsForTest,
} from "../services/situation-room/environment-state-snapshot-window";
import { reduceLiveAnswerEnvironmentFromEnvironmentStateSnapshot } from "../services/situation-room/live-environment-state-line-reducer";
import { buildPossibilityGraph } from "../services/situation-room/possibility-graph-builder";
import { reduceEnvironmentAffordances } from "../services/situation-room/environment-affordance-reducer";
import { rehearsePossibilityGraph } from "../services/situation-room/action-rehearsal-engine";
import { resetEnvironmentMemoryLedgersForTest, updateEnvironmentMemoryLedger } from "../services/situation-room/environment-memory-ledger";

const snapshotFixture = (overrides: Record<string, unknown> = {}) =>
  normalizeEnvironmentStateSnapshot({
    snapshot: {
      schema: "helix.environment_state_snapshot.v1",
      snapshot_id: "snapshot:minecraft:food-mining",
      domain: "minecraft",
      domain_adapter: "minecraft.paper_plugin.v1",
      room_id: "room:minecraft",
      world_id: "minecraft:server",
      source_id: "source:minecraft-paper-plugin",
      actor_id: "minecraft:player:DatDamPig",
      actor_label: "DatDamPig",
      ts: "2026-05-19T18:30:00.000Z",
      actor_state: { health: 18, food_level: 5, saturation: 1, mode: "survival" },
      inventory_state: {
        selected_item: { item_type: "minecraft:iron_pickaxe", count: 1 },
        carried_items: [{ item_type: "minecraft:torch", count: 12 }],
        inventory_hash: "inventory:v1",
      },
      object_state: {
        nearby_containers: [{
          container_ref: "container:house_chest",
          container_type: "minecraft:chest",
          contents_known: true,
          contents_summary: [{ item_type: "minecraft:cooked_porkchop", count: 6 }],
          contents_hash: "chest:v1",
          last_verified_at: "2026-05-19T18:29:00.000Z",
        }],
        hazards: [],
      },
      focus: {
        target_kind: "block",
        target_type: "minecraft:chest",
        reachable: true,
        line_of_sight: true,
        distance: 3,
      },
      section_hashes: { actor_state: "actor:v1", inventory_state: "inventory:v1" },
      changed_sections: ["actor_state", "inventory_state"],
      domain_specific: {
        minecraft: {
          raw_nbt_included: false,
          nbt_component_keys_seen: ["minecraft:food"],
        },
      },
      evidence_refs: ["minecraft:snapshot:server_tick:123456"],
      deterministic: true,
      model_invoked: false,
      assistant_answer: false,
      raw_payload_included: false,
      context_policy: "compact_context_pack_only",
      ...overrides,
    },
  });

describe("environment state possibility rehearsal", () => {
  beforeEach(() => {
    resetLiveAnswerEnvironments();
    resetEnvironmentStateSnapshotWindowsForTest();
    resetEnvironmentMemoryLedgersForTest();
  });

  it("keeps Minecraft state as generic environment_state and excludes raw payloads", () => {
    const snapshot = snapshotFixture();
    expect(snapshot?.schema).toBe("helix.environment_state_snapshot.v1");
    expect(snapshot?.domain).toBe("minecraft");
    expect(snapshot?.raw_payload_included).toBe(false);
    expect(snapshot?.assistant_answer).toBe(false);
    expect(snapshot?.domain_specific?.minecraft?.raw_nbt_included).toBe(false);
  });

  it("generates a possibility graph without recommending before rehearsal", () => {
    const snapshot = snapshotFixture();
    expect(snapshot).toBeTruthy();
    const affordances = reduceEnvironmentAffordances(snapshot!);
    const memory = updateEnvironmentMemoryLedger(snapshot!);
    const graph = buildPossibilityGraph({
      objective: "prepare for mining",
      threadId: "helix-ask:test",
      environmentState: snapshot!,
      affordanceContext: affordances,
      memoryLedger: memory,
      now: "2026-05-19T18:30:00.000Z",
    });
    expect(graph?.graph_status).toBe("rehearsal_ready");
    expect(graph?.assistant_answer).toBe(false);
    expect(graph?.nodes.map((node) => node.kind)).toContain("inventory_action");
  });

  it("gates the live recommendation through read-only rehearsal", () => {
    const snapshot = snapshotFixture();
    const { environment } = createLiveAnswerEnvironment({
      thread_id: "helix-ask:test",
      created_turn_id: "turn:environment",
      objective: "prepare for mining",
      room_id: "room:minecraft",
      source_ids: ["source:minecraft-paper-plugin"],
      preset: "environment_run_monitor",
      now: "2026-05-19T18:30:00.000Z",
    });
    const update = reduceLiveAnswerEnvironmentFromEnvironmentStateSnapshot({
      environment,
      snapshot: snapshot!,
      threadId: "helix-ask:test",
      now: "2026-05-19T18:30:00.000Z",
    });
    expect(update?.possibility_graph?.assistant_answer).toBe(false);
    expect(update?.rehearsal_result?.feasibility).toBe("feasible");
    expect(update?.rehearsal_result?.recommendation_gate).toBe("safe_to_suggest");
    expect(update?.rehearsal_result?.side_effects_performed).toBe(false);
    expect(update?.environment.lines.find((line) => line.key === "recommendation")?.value).toMatch(/porkchop/i);
  });

  it("blocks stale container certainty with a caveated rehearsal gate", () => {
    const snapshot = snapshotFixture({
      object_state: {
        nearby_containers: [{
          container_ref: "container:house_chest",
          container_type: "minecraft:chest",
          contents_known: true,
          contents_summary: [{ item_type: "minecraft:cooked_porkchop", count: 6 }],
          contents_hash: "chest:v1",
          last_verified_at: "2026-05-19T17:30:00.000Z",
        }],
      },
    });
    const affordances = reduceEnvironmentAffordances(snapshot!);
    const graph = buildPossibilityGraph({
      objective: "prepare for mining",
      threadId: "helix-ask:test",
      environmentState: snapshot!,
      affordanceContext: affordances,
      memoryLedger: updateEnvironmentMemoryLedger(snapshot!),
      now: "2026-05-19T18:30:00.000Z",
    });
    const rehearsal = rehearsePossibilityGraph({
      graph: graph!,
      environmentState: snapshot!,
      now: "2026-05-19T18:30:00.000Z",
    });
    expect(rehearsal.result.feasibility).toBe("partial");
    expect(rehearsal.result.recommendation_gate).toBe("suggest_with_caveat");
    expect(rehearsal.result.side_effects_performed).toBe(false);
  });
});

