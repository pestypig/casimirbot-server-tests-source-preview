import { beforeEach, describe, expect, it } from "vitest";
import type { HelixWorldEvent } from "@shared/helix-world-event";
import {
  __resetHelixThreadLedgerStore,
  getHelixThreadLedgerEvents,
} from "../services/helix-thread/ledger";
import {
  ingestWorldEventBatch,
  resetWorldEventIngestState,
} from "../services/situation-room/world-event-ingest";
import { replayWorldEvents } from "../services/situation-room/world-event-replay";
import {
  createSituationThreadBinding,
  resetSituationThreadBindings,
} from "../services/situation-room/thread-binding-store";

let testCounter = 0;

const nextThreadId = (label: string): string => `thread:${label}:${Date.now()}:${++testCounter}:${Math.random()}`;

const riskEvent = (index: number, threadRoom = "room:minecraft:batch"): HelixWorldEvent => ({
  schema: "helix.world_event.v1",
  world_id: "minecraft:minehut",
  room_id: threadRoom,
  source_id: "source:minecraft-server",
  ts: `2026-05-05T08:00:${String(index).padStart(2, "0")}.000Z`,
  actor_id: "player:datdampig",
  actor_label: "DatDamPig",
  event_type: "player_damage",
  location: { dimension: "minecraft:overworld", x: 10 + index, y: 64, z: -10 },
  health_delta: { current_health: 4, previous_health: 10, damage: 6 },
  evidence_refs: [`mc:batch:risk:${index}`],
  meta: { hostile_nearby: true },
});

const locationSample = (index: number): HelixWorldEvent => ({
  schema: "helix.world_event.v1",
  world_id: "minecraft:minehut",
  room_id: "room:minecraft:batch",
  source_id: "source:minecraft-server",
  ts: `2026-05-05T08:01:${String(index).padStart(2, "0")}.000Z`,
  actor_id: "player:datdampig",
  actor_label: "DatDamPig",
  event_type: "player_location_sample",
  location: { dimension: "minecraft:overworld", x: 10 + index, y: 64, z: -10 },
  evidence_refs: [`mc:batch:location:${index}`],
  meta: {},
});

describe("standby observation batch writer integration", () => {
  beforeEach(() => {
    __resetHelixThreadLedgerStore();
    resetWorldEventIngestState();
    resetSituationThreadBindings();
  });

  it("writes one auxiliary turn with three toolObservation items for a salient burst", async () => {
    const threadId = nextThreadId("batch");
    createSituationThreadBinding({
      room_id: "room:minecraft:batch",
      source_id: "source:minecraft-server",
      world_id: "minecraft:minehut",
      thread_id: threadId,
      mode: "standby_receipts",
      append_policy: "salient_only",
    });

    const result = await ingestWorldEventBatch([riskEvent(1), riskEvent(2), riskEvent(3)]);
    const ledger = getHelixThreadLedgerEvents({ threadId });

    expect(result.appended_count).toBe(3);
    expect(result.batch_receipts).toHaveLength(1);
    expect(result.batch_receipts[0]).toMatchObject({
      schema: "helix.standby_observation_batch.v1",
      appended_count: 3,
      suppressed_count: 0,
    });
    expect(ledger.filter((event) => event.event_type === "turn_started" && event.turn_kind === "auxiliary")).toHaveLength(1);
    expect(ledger.filter((event) => event.event_type === "item_completed" && event.item_type === "toolObservation")).toHaveLength(3);
    expect(ledger.some((event) => event.item_type === "answer")).toBe(false);
  });

  it("suppresses projection-only location samples without an auxiliary turn", async () => {
    const threadId = nextThreadId("batch");
    createSituationThreadBinding({
      room_id: "room:minecraft:batch",
      source_id: "source:minecraft-server",
      world_id: "minecraft:minehut",
      thread_id: threadId,
      mode: "standby_receipts",
      append_policy: "salient_only",
    });

    const result = await ingestWorldEventBatch([locationSample(1), locationSample(2), locationSample(3)]);

    expect(result.appended_count).toBe(0);
    expect(result.suppressed_count).toBe(3);
    expect(result.batch_receipts).toHaveLength(0);
    expect(result.results.every((entry) => entry.debug?.append_reason === "projection_only")).toBe(true);
    expect(getHelixThreadLedgerEvents({ threadId }).filter((event) => event.meta?.kind === "standby_observation_batch")).toHaveLength(0);
  });

  it("writes only salient observations for mixed batches", async () => {
    const threadId = nextThreadId("batch");
    createSituationThreadBinding({
      room_id: "room:minecraft:batch",
      source_id: "source:minecraft-server",
      world_id: "minecraft:minehut",
      thread_id: threadId,
      mode: "standby_receipts",
      append_policy: "salient_only",
    });

    const result = await ingestWorldEventBatch([locationSample(1), riskEvent(2)]);

    expect(result.appended_count).toBe(1);
    expect(result.suppressed_count).toBe(1);
    expect(result.batch_receipts).toHaveLength(1);
    expect(result.results.map((entry) => entry.appended)).toEqual([true, false]);
  });

  it("groups one incoming batch into separate auxiliary turns per thread", async () => {
    const threadA = nextThreadId("batch-a");
    const threadB = nextThreadId("batch-b");
    createSituationThreadBinding({
      room_id: "room:minecraft:batch-a",
      source_id: "source:minecraft-server",
      world_id: "minecraft:minehut",
      thread_id: threadA,
      mode: "standby_receipts",
      append_policy: "salient_only",
    });
    createSituationThreadBinding({
      room_id: "room:minecraft:batch-b",
      source_id: "source:minecraft-server",
      world_id: "minecraft:minehut",
      thread_id: threadB,
      mode: "standby_receipts",
      append_policy: "salient_only",
    });

    const result = await ingestWorldEventBatch([riskEvent(1, "room:minecraft:batch-a"), riskEvent(2, "room:minecraft:batch-b")]);

    expect(result.batch_receipts).toHaveLength(2);
    expect(getHelixThreadLedgerEvents({ threadId: threadA }).filter((event) => event.event_type === "turn_started")).toHaveLength(1);
    expect(getHelixThreadLedgerEvents({ threadId: threadB }).filter((event) => event.event_type === "turn_started")).toHaveLength(1);
  });

  it("keeps replay dry-run ledger-free and live replay writes batch observations", async () => {
    const threadId = nextThreadId("replay");
    const events = [riskEvent(1), riskEvent(2)];
    const dryRun = await replayWorldEvents({ events, dryRun: true, forceThreadId: threadId });
    expect(dryRun.results.every((entry) => entry.appended === false)).toBe(true);
    expect(getHelixThreadLedgerEvents({ threadId }).filter((event) => event.meta?.kind === "standby_observation_batch")).toHaveLength(0);

    const live = await replayWorldEvents({ events, dryRun: false, forceThreadId: threadId });
    expect(live.batch_receipts?.[0]?.appended_count).toBe(2);
    expect(getHelixThreadLedgerEvents({ threadId }).filter((event) => event.event_type === "turn_started")).toHaveLength(1);
  });
});
