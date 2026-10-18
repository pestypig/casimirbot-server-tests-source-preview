import { beforeEach, describe, expect, it } from "vitest";
import playerOpened from "../../fixtures/environment-state/minecraft/player-equivalent-open-chest.snapshot.json";
import { normalizeMinecraftPluginSnapshot } from "../services/situation-room/minecraft-plugin-snapshot-normalizer";
import {
  listKnownEnvironmentContainers,
  resetEnvironmentMemoryLedgersForTest,
  updateEnvironmentMemoryLedger,
} from "../services/situation-room/environment-memory-ledger";

describe("environment memory ledger", () => {
  beforeEach(() => {
    resetEnvironmentMemoryLedgersForTest();
  });

  it("preserves verified container contents when a later sighting only sees the container", () => {
    const opened = normalizeMinecraftPluginSnapshot({ snapshot: playerOpened })!;
    const openedContainer = opened.object_state!.nearby_containers![0]!;
    const first = updateEnvironmentMemoryLedger(opened);
    const closed = normalizeMinecraftPluginSnapshot({
      snapshot: {
        ...playerOpened,
        snapshot_id: "snapshot:minecraft:closed-later",
        ts: "2026-05-19T18:35:00.000Z",
        object_state: {
          ...(playerOpened.object_state ?? {}),
          nearby_containers: [{
            container_ref: openedContainer.container_ref,
            container_type: openedContainer.container_type,
            position: openedContainer.position,
            contents_known: false,
            contents_summary: [],
            contents_hash: null,
            sensor_scope: "sensor_observable",
          }],
        },
      },
    })!;
    const second = updateEnvironmentMemoryLedger(closed);
    const remembered = listKnownEnvironmentContainers(opened.room_id)[0]!;

    expect(first.known_containers[0]?.memory_status).toBe("contents_known");
    expect(second.known_containers).toHaveLength(1);
    expect(remembered.contents_known).toBe(true);
    expect(remembered.contents_summary?.[0]?.item_type).toMatch(/porkchop|food/i);
    expect(remembered.contents_last_verified_at).toBe("2026-05-19T18:29:55.000Z");
    expect(remembered.last_seen_at).toBe("2026-05-19T18:35:00.000Z");
    expect(remembered.instruction_authority).toBe("none");
    expect(remembered.ask_context_policy).toBe("evidence_only");
    expect(remembered.raw_content_included).toBe(false);
  });
});
