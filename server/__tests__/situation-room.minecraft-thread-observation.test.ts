import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { HelixWorldEvent } from "@shared/helix-world-event";
import {
  __resetHelixThreadLedgerStore,
  getHelixThreadLedgerEvents,
} from "../services/helix-thread/ledger";
import {
  ingestWorldEvent,
  ingestWorldEventBatch,
  resetWorldEventIngestState,
} from "../services/situation-room/world-event-ingest";
import {
  createSituationThreadBinding,
  resetSituationThreadBindings,
} from "../services/situation-room/thread-binding-store";

const readFixture = (name: string): HelixWorldEvent[] => {
  const filePath = path.resolve(process.cwd(), "fixtures/minecraft", name);
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as HelixWorldEvent);
};

describe("Minecraft standby thread observations", () => {
  beforeEach(() => {
    __resetHelixThreadLedgerStore();
    resetWorldEventIngestState();
    resetSituationThreadBindings();
  });

  it("keeps world events observe-only without an explicit binding", async () => {
    const [event] = readFixture("nether-low-health.jsonl");
    const result = await ingestWorldEvent(event);

    expect(result).toMatchObject({
      appended: false,
      reason: "no_thread_context",
    });
    expect(getHelixThreadLedgerEvents({ threadId: "thread:e91-unbound" })).toHaveLength(0);
  });

  it("does not append when the binding is observe_only", async () => {
    const [event] = readFixture("nether-low-health.jsonl");
    createSituationThreadBinding({
      room_id: event.room_id,
      source_id: event.source_id,
      world_id: event.world_id,
      thread_id: "thread:e91-risk",
      mode: "observe_only",
    });

    const result = await ingestWorldEvent(event);

    expect(result).toMatchObject({
      appended: false,
      reason: "binding_observe_only",
      thread_id: "thread:e91-risk",
    });
  });

  it("does not append quiet events under salient_only policy", async () => {
    const [event] = readFixture("quiet-noop.jsonl");
    createSituationThreadBinding({
      room_id: event.room_id,
      source_id: event.source_id,
      world_id: event.world_id,
      thread_id: "thread:e91-risk",
      mode: "standby_receipts",
      append_policy: "salient_only",
    });

    const result = await ingestWorldEvent(event);

    expect(result).toMatchObject({
      appended: false,
      reason: "not_salient",
      thread_id: "thread:e91-risk",
    });
  });

  it("appends a compact toolObservation for salient risk events", async () => {
    const [event] = readFixture("nether-low-health.jsonl");
    createSituationThreadBinding({
      room_id: event.room_id,
      source_id: event.source_id,
      world_id: event.world_id,
      thread_id: "thread:e91-risk",
      mode: "standby_receipts",
      append_policy: "salient_only",
    });

    const result = await ingestWorldEvent(event);
    const ledgerEvents = getHelixThreadLedgerEvents({ threadId: "thread:e91-risk" });
    const observation = ledgerEvents.find(
      (entry) => entry.event_type === "item_completed" && entry.item_type === "toolObservation",
    );

    expect(result).toMatchObject({
      appended: true,
      thread_id: "thread:e91-risk",
      reason: null,
      salience_receipt: {
        reason: "risk_detected",
      },
    });
    expect(observation?.observation_ref).toMatchObject({
      schema: "helix.standby_thread_observation.v1",
      source: "minecraft_event",
      context_policy: "explicit_attachment_only",
      command_lane_enabled: false,
      world_event: {
        event_type: event.event_type,
        evidence_refs: event.evidence_refs,
      },
      salience_receipt: {
        reason: "risk_detected",
      },
    });
    expect(ledgerEvents.some((entry) => entry.item_type === "answer")).toBe(false);
    expect(ledgerEvents.some((entry) => entry.item_type === "commandExecution")).toBe(false);
  });

  it("includes goal hypotheses and evidence refs for goal progress", async () => {
    const events = readFixture("blaze-rod-goal-progress.jsonl");
    const first = events[0];
    createSituationThreadBinding({
      room_id: first.room_id,
      source_id: first.source_id,
      world_id: first.world_id,
      thread_id: "thread:e91-goal",
      mode: "standby_receipts",
      append_policy: "salient_only",
    });

    await ingestWorldEvent(events[0]);
    const result = await ingestWorldEvent(events[1]);
    const ledgerEvents = getHelixThreadLedgerEvents({ threadId: "thread:e91-goal" });
    const observation = ledgerEvents.find(
      (entry) =>
        entry.event_type === "item_completed" &&
        entry.item_type === "toolObservation" &&
        entry.observation_ref?.salience_receipt?.reason === "goal_progress",
    );

    expect(result).toMatchObject({
      appended: true,
      salience_receipt: {
        reason: "goal_progress",
      },
    });
    expect(observation?.observation_ref?.goal_hypotheses?.length).toBeGreaterThan(0);
    expect(observation?.observation_ref?.goal_hypotheses?.[0]?.evidence_refs?.length).toBeGreaterThan(0);
  });

  it("preserves per-event append status through batch ingest", async () => {
    const events = [readFixture("quiet-noop.jsonl")[0], readFixture("nether-low-health.jsonl")[0]];
    createSituationThreadBinding({
      room_id: events[0].room_id,
      source_id: events[0].source_id,
      world_id: events[0].world_id,
      thread_id: "thread:e91-batch",
      mode: "standby_receipts",
      append_policy: "salient_only",
    });

    const result = await ingestWorldEventBatch(events);

    expect(result.results.map((entry) => ({ event_type: entry.event_type, appended: entry.appended, reason: entry.reason }))).toEqual([
      { event_type: "player_damage", appended: true, reason: null },
      { event_type: "block_placed", appended: false, reason: "not_salient" },
    ]);
  });
});

