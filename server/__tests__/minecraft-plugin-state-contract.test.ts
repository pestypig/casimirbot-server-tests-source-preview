import { describe, expect, it } from "vitest";
import houseChestFood from "../../fixtures/environment-state/minecraft/house-chest-food.snapshot.json";
import rawNbtRejected from "../../fixtures/environment-state/minecraft/raw-nbt-rejected.snapshot.json";
import {
  extractEnvironmentStateSnapshotFromWorldEvent,
} from "../services/situation-room/environment-state-snapshot-window";
import { auditEnvironmentSourceContract } from "../services/situation-room/environment-source-contract-validator";
import type { HelixWorldEvent } from "@shared/helix-world-event";

const eventFrom = (snapshot: unknown): HelixWorldEvent => ({
  schema: "helix.world_event.v1",
  event_type: "environment_state_snapshot",
  world_id: "minecraft:server",
  room_id: "room:minecraft",
  source_id: "source:minecraft-paper-plugin",
  actor_id: "minecraft:player:DatDamPig",
  actor_label: "DatDamPig",
  ts: "2026-05-19T18:30:05.000Z",
  meta: {
    snapshot_schema: "helix.environment_state_snapshot.v1",
    domain: "minecraft",
    domain_adapter: "minecraft.paper_plugin.v1",
    snapshot,
  },
  evidence_refs: ["minecraft:snapshot:server_tick:123461"],
});

describe("Minecraft plugin environment state contract", () => {
  it("extracts plugin snapshots as generic environment_state artifacts", () => {
    const snapshot = extractEnvironmentStateSnapshotFromWorldEvent(eventFrom(houseChestFood));
    const audit = auditEnvironmentSourceContract({ subject: snapshot });

    expect(snapshot?.schema).toBe("helix.environment_state_snapshot.v1");
    expect(snapshot?.domain).toBe("minecraft");
    expect(snapshot?.domain_adapter).toBe("minecraft.paper_plugin.v1");
    expect(snapshot?.raw_payload_included).toBe(false);
    expect(snapshot?.assistant_answer).toBe(false);
    expect(audit.ok).toBe(true);
  });

  it("rejects plugin snapshots that include raw NBT or raw payloads", () => {
    const snapshot = extractEnvironmentStateSnapshotFromWorldEvent(eventFrom(rawNbtRejected));

    expect(snapshot).toBeNull();
  });
});
