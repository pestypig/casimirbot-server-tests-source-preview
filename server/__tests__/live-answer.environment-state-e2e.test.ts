import { beforeEach, describe, expect, it } from "vitest";
import houseChestFood from "../../fixtures/environment-state/minecraft/house-chest-food.snapshot.json";
import rawNbtRejected from "../../fixtures/environment-state/minecraft/raw-nbt-rejected.snapshot.json";
import {
  createLiveAnswerEnvironment,
  resetLiveAnswerEnvironments,
} from "../services/situation-room/live-answer-environment-store";
import {
  ingestEnvironmentStateSnapshot,
  normalizeEnvironmentStateSnapshot,
  resetEnvironmentStateSnapshotWindowsForTest,
} from "../services/situation-room/environment-state-snapshot-window";
import { resetEnvironmentMemoryLedgersForTest } from "../services/situation-room/environment-memory-ledger";
import { reduceLiveAnswerEnvironmentFromEnvironmentStateSnapshot } from "../services/situation-room/live-environment-state-line-reducer";

const line = (environment: { lines: Array<{ key: string; value: string }> }, key: string): string =>
  environment.lines.find((entry) => entry.key === key)?.value ?? "";

describe("live answer environment state e2e", () => {
  beforeEach(() => {
    resetLiveAnswerEnvironments();
    resetEnvironmentStateSnapshotWindowsForTest();
    resetEnvironmentMemoryLedgersForTest();
  });

  it("updates possibilities from a graph but waits for rehearsal before recommending", () => {
    const snapshot = normalizeEnvironmentStateSnapshot({ snapshot: houseChestFood });
    const { environment } = createLiveAnswerEnvironment({
      thread_id: "helix-ask:test",
      created_turn_id: "turn:environment",
      objective: "prepare for mining",
      room_id: "room:minecraft",
      source_ids: ["source:minecraft-paper-plugin"],
      preset: "environment_run_monitor",
      now: "2026-05-19T18:30:05.000Z",
    });

    const update = reduceLiveAnswerEnvironmentFromEnvironmentStateSnapshot({
      environment,
      snapshot: snapshot!,
      threadId: "helix-ask:test",
      autoRehearse: false,
      now: "2026-05-19T18:30:05.000Z",
    });

    expect(update?.recommendation_gate.status).toBe("awaiting_rehearsal");
    expect(line(update!.environment, "possibilities")).toMatch(/retrieve|porkchop|candidate/i);
    expect(line(update!.environment, "rehearsal")).toMatch(/not rehearsed/i);
    expect(line(update!.environment, "recommendation")).not.toMatch(/take cooked porkchop/i);
  });

  it("lets feasible rehearsal update the recommendation line", () => {
    const snapshot = normalizeEnvironmentStateSnapshot({ snapshot: houseChestFood });
    const { environment } = createLiveAnswerEnvironment({
      thread_id: "helix-ask:test",
      created_turn_id: "turn:environment",
      objective: "prepare for mining",
      room_id: "room:minecraft",
      source_ids: ["source:minecraft-paper-plugin"],
      preset: "environment_run_monitor",
      now: "2026-05-19T18:30:05.000Z",
    });

    const update = reduceLiveAnswerEnvironmentFromEnvironmentStateSnapshot({
      environment,
      snapshot: snapshot!,
      threadId: "helix-ask:test",
      now: "2026-05-19T18:30:05.000Z",
    });

    expect(update?.rehearsal_result?.side_effects_performed).toBe(false);
    expect(update?.recommendation_gate.status).toBe("safe_to_suggest");
    expect(line(update!.environment, "recommendation")).toMatch(/porkchop/i);
  });

  it("quarantines raw NBT snapshots from live deltas", () => {
    const { environment } = createLiveAnswerEnvironment({
      thread_id: "helix-ask:test",
      created_turn_id: "turn:environment",
      objective: "prepare for mining",
      room_id: "room:minecraft",
      source_ids: ["source:minecraft-paper-plugin"],
      preset: "environment_run_monitor",
      now: "2026-05-19T18:32:00.000Z",
    });

    const update = reduceLiveAnswerEnvironmentFromEnvironmentStateSnapshot({
      environment,
      snapshot: rawNbtRejected as never,
      threadId: "helix-ask:test",
      now: "2026-05-19T18:32:00.000Z",
    });

    expect(update).toBeNull();
  });

  it("suppresses redundant snapshots when section hashes did not change", () => {
    const first = normalizeEnvironmentStateSnapshot({ snapshot: houseChestFood });
    const duplicate = {
      ...first!,
      snapshot_id: "snapshot:minecraft:house-chest-food:duplicate",
      ts: "2026-05-19T18:30:10.000Z",
      changed_sections: [],
    };
    ingestEnvironmentStateSnapshot(first!);
    ingestEnvironmentStateSnapshot(duplicate);
    const { environment } = createLiveAnswerEnvironment({
      thread_id: "helix-ask:test",
      created_turn_id: "turn:environment",
      objective: "prepare for mining",
      room_id: "room:minecraft",
      source_ids: ["source:minecraft-paper-plugin"],
      preset: "environment_run_monitor",
      now: "2026-05-19T18:30:10.000Z",
    });

    const update = reduceLiveAnswerEnvironmentFromEnvironmentStateSnapshot({
      environment,
      snapshot: duplicate,
      threadId: "helix-ask:test",
      now: "2026-05-19T18:30:10.000Z",
    });

    expect(update).toBeNull();
  });
});
