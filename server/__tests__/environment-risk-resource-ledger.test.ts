import { beforeEach, describe, expect, it } from "vitest";
import type { HelixEnvironmentStateSnapshot } from "@shared/helix-environment-state-snapshot";
import {
  getEnvironmentRiskResourceLedger,
  resetEnvironmentRiskResourceLedgersForTest,
  updateEnvironmentRiskResourceLedgerFromSnapshot,
  updateEnvironmentRiskResourceLedgerFromWorldEvent,
} from "../services/situation-room/environment-risk-resource-ledger";
import {
  ingestWorldEvent,
  resetWorldEventIngestState,
} from "../services/situation-room/world-event-ingest";

const snapshot = (override: Partial<HelixEnvironmentStateSnapshot> = {}): HelixEnvironmentStateSnapshot => ({
  schema: "helix.environment_state_snapshot.v1",
  snapshot_id: "environment_snapshot:test",
  domain: "minecraft",
  domain_adapter: "minecraft.paper_plugin.v1",
  room_id: "room:minecraft",
  world_id: "minecraft:paper",
  source_id: "source:minecraft",
  actor_label: "DatDamPig",
  ts: "2026-05-31T12:00:00.000Z",
  object_state: {
    sensor_scope: "sensor_observable",
    hazards: [{
      hazard_ref: "hazard:void-edge",
      hazard_type: "void_edge",
      severity: "warning",
      position: { x: 10, y: 70, z: 10 },
      evidence_refs: ["hazard:void-edge"],
      sensor_scope: "sensor_observable",
    }],
    resources: [{
      resource_ref: "resource:end-stone",
      resource_type: "minecraft:end_stone",
      state: "available",
      amount: 12,
      tags: ["building_block"],
      sensor_scope: "sensor_observable",
    }],
  },
  section_hashes: {},
  changed_sections: ["object_state"],
  evidence_refs: ["snapshot:evidence"],
  deterministic: true,
  model_invoked: false,
  assistant_answer: false,
  raw_payload_included: false,
  context_policy: "compact_context_pack_only",
  ...override,
});

describe("environment risk/resource ledger", () => {
  beforeEach(() => {
    resetWorldEventIngestState();
    resetEnvironmentRiskResourceLedgersForTest();
  });

  it("persists hazards and resources across snapshots without lowering peak severity", () => {
    const first = updateEnvironmentRiskResourceLedgerFromSnapshot(snapshot());
    const second = updateEnvironmentRiskResourceLedgerFromSnapshot(snapshot({
      snapshot_id: "environment_snapshot:test:later",
      ts: "2026-05-31T12:01:00.000Z",
      object_state: {
        sensor_scope: "sensor_observable",
        hazards: [{
          hazard_ref: "hazard:void-edge",
          hazard_type: "void_edge",
          severity: "watch",
          position: { x: 10, y: 70, z: 10 },
          evidence_refs: ["hazard:void-edge:later"],
          sensor_scope: "sensor_observable",
        }],
        resources: [{
          resource_ref: "resource:end-stone",
          resource_type: "minecraft:end_stone",
          state: "depleted",
          amount: 0,
          tags: ["building_block"],
          sensor_scope: "sensor_observable",
        }],
      },
    }));

    expect(first.known_hazards[0]?.peak_severity).toBe("warning");
    expect(second.known_hazards[0]).toMatchObject({
      hazard_ref: "hazard:void-edge",
      severity: "watch",
      peak_severity: "warning",
      observation_count: 2,
      instruction_authority: "none",
      ask_context_policy: "evidence_only",
      raw_content_included: false,
    });
    expect(second.known_resources[0]).toMatchObject({
      resource_ref: "resource:end-stone",
      last_known_state: "depleted",
      observation_count: 2,
      instruction_authority: "none",
      ask_context_policy: "evidence_only",
      raw_content_included: false,
    });
  });

  it("records damage and inventory transitions as evidence only", () => {
    updateEnvironmentRiskResourceLedgerFromWorldEvent({
      schema: "helix.world_event.v1",
      world_id: "minecraft:paper",
      room_id: "room:minecraft",
      source_id: "source:minecraft",
      actor_label: "DatDamPig",
      ts: "2026-05-31T12:00:05.000Z",
      event_type: "player_death",
      location: { dimension: "minecraft:the_end", x: 20, y: 40, z: 20 },
      evidence_refs: ["event:death"],
    });
    const ledger = updateEnvironmentRiskResourceLedgerFromWorldEvent({
      schema: "helix.world_event.v1",
      world_id: "minecraft:paper",
      room_id: "room:minecraft",
      source_id: "source:minecraft",
      actor_label: "DatDamPig",
      ts: "2026-05-31T12:00:06.000Z",
      event_type: "item_consume",
      inventory_delta: { item_type: "minecraft:cooked_porkchop", count: 1 },
      evidence_refs: ["event:item-consume"],
    });

    expect(ledger?.known_hazards[0]).toMatchObject({
      hazard_type: "player_death",
      peak_severity: "critical",
      instruction_authority: "none",
      ask_context_policy: "evidence_only",
    });
    expect(ledger?.inventory_transitions[0]).toMatchObject({
      status: "consumed",
      item_type: "minecraft:cooked_porkchop",
      creates_ask_turn: false,
      turn_triggered: false,
      raw_user_text_included: false,
      raw_content_included: false,
    });
  });

  it("wires the ledger into world-event ingest for transition events", async () => {
    const result = await ingestWorldEvent({
      schema: "helix.world_event.v1",
      world_id: "minecraft:paper",
      room_id: "room:minecraft",
      source_id: "source:minecraft",
      actor_label: "DatDamPig",
      ts: "2026-05-31T12:00:06.000Z",
      event_type: "inventory_open",
      meta: {
        container_ref: "container:chest:1",
        container_type: "minecraft:chest",
      },
      evidence_refs: ["event:inventory-open"],
    }, { appendToThread: false });

    expect(result.environment_risk_resource_ledger?.inventory_transitions[0]).toMatchObject({
      status: "container_opened",
      container_ref: "container:chest:1",
      container_type: "minecraft:chest",
    });
    expect(getEnvironmentRiskResourceLedger("room:minecraft")?.assistant_answer).toBe(false);
  });
});
