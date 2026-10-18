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
  resetWorldEventIngestState,
} from "../services/situation-room/world-event-ingest";
import {
  createSituationGoalSession,
  resetSituationGoalSessions,
} from "../services/situation-room/situation-goal-session-store";
import { resetSituationThreadBindings } from "../services/situation-room/thread-binding-store";
import { resetStandbyCalloutPolicyState } from "../services/situation-room/standby-callout-policy";
import {
  refreshMissionMemoryForThread,
  resetMissionMemoryReducerState,
} from "../services/situation-room/mission-memory-reducer";
import { investigateLatestInterjectionForThread } from "../services/situation-room/interjection-investigator";
import { buildSituationContextPack } from "../services/situation-room/situation-context-pack";

const readFixtureEvent = (name: string): HelixWorldEvent => {
  const filePath = path.resolve(process.cwd(), "fixtures/minecraft", name);
  const firstLine =
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  return JSON.parse(firstLine) as HelixWorldEvent;
};

describe("mission memory and interjection investigator", () => {
  beforeEach(() => {
    __resetHelixThreadLedgerStore();
    resetWorldEventIngestState();
    resetSituationThreadBindings();
    resetStandbyCalloutPolicyState();
    resetSituationGoalSessions();
    resetMissionMemoryReducerState();
  });

  it("builds compact mission memory from standby observations without answer items", async () => {
    const event = readFixtureEvent("nether-low-health.jsonl");
    const threadId = "helix-ask:test-mission-memory";
    createSituationGoalSession({
      thread_id: threadId,
      room_id: event.room_id,
      source_id: event.source_id,
      source_ids: [event.source_id],
      world_id: event.world_id,
      objective: "Watch danger and progress.",
      standby_mode: "text_only",
      append_policy: "salient_only",
      now: "2026-05-08T12:00:00.000Z",
    });

    await ingestWorldEvent(event, {
      threadId,
      turnId: "turn:mission-memory-source",
      now: () => new Date("2026-05-08T12:01:00.000Z"),
    });

    const result = refreshMissionMemoryForThread({
      threadId,
      now: "2026-05-08T12:02:00.000Z",
      writeThreadUpdate: true,
    });

    expect(result.ok).toBe(true);
    expect(result.memory).toMatchObject({
      schema: "helix.mission_memory.v1",
      thread_id: threadId,
      status: "active",
      mode: "text_only",
    });
    expect(result.memory?.risk_line.toLowerCase()).toContain("risk");
    expect(result.memory?.unknowns_line.toLowerCase()).toContain("hostile precursor");
    expect(result.update).toMatchObject({
      schema: "helix.mission_memory_update.v1",
      deterministic: true,
      model_invoked: false,
      context_policy: "compact_context_only",
    });

    const events = getHelixThreadLedgerEvents({ threadId });
    expect(events.some((entry) => entry.item_type === "answer")).toBe(false);
    expect(
      events.some(
        (entry) =>
          entry.item_type === "validation" &&
          entry.observation_ref?.schema === "helix.mission_memory_update.v1",
      ),
    ).toBe(true);
  });

  it("runs deterministic interjection investigation as auxiliary tool/validation items", async () => {
    const event = readFixtureEvent("nether-low-health.jsonl");
    const threadId = "helix-ask:test-interjection";
    createSituationGoalSession({
      thread_id: threadId,
      room_id: event.room_id,
      source_id: event.source_id,
      source_ids: [event.source_id],
      world_id: event.world_id,
      objective: "Watch danger and progress.",
      standby_mode: "text_only",
      append_policy: "salient_only",
      now: "2026-05-08T12:10:00.000Z",
    });
    await ingestWorldEvent(event, {
      threadId,
      turnId: "turn:interjection-source",
      now: () => new Date("2026-05-08T12:11:00.000Z"),
    });
    refreshMissionMemoryForThread({
      threadId,
      now: "2026-05-08T12:12:00.000Z",
    });

    const receipt = investigateLatestInterjectionForThread({
      threadId,
      trigger: "risk_detected",
      now: "2026-05-08T12:13:00.000Z",
    });

    expect(receipt).toMatchObject({
      ok: true,
      decision: {
        schema: "helix.interjection_decision.v1",
        decision: "show_text",
        model_invoked: false,
        deterministic_gate: true,
      },
      investigation: {
        schema: "helix.interjection_investigation.v1",
        question: "should_interject",
      },
    });
    const events = getHelixThreadLedgerEvents({ threadId });
    expect(events.some((entry) => entry.item_type === "dynamicToolCall")).toBe(true);
    expect(events.some((entry) => entry.item_type === "validation")).toBe(true);
    expect(events.some((entry) => entry.item_type === "answer")).toBe(false);
  });

  it("adds mission memory to direct Ask context packs without raw logs", async () => {
    const event = readFixtureEvent("nether-low-health.jsonl");
    const threadId = "helix-ask:test-mission-context";
    const session = createSituationGoalSession({
      thread_id: threadId,
      room_id: event.room_id,
      source_id: event.source_id,
      source_ids: [event.source_id],
      world_id: event.world_id,
      objective: "Watch danger and progress.",
      standby_mode: "text_only",
      append_policy: "salient_only",
      now: "2026-05-08T12:20:00.000Z",
    }).session;
    await ingestWorldEvent(event, {
      threadId,
      turnId: "turn:mission-context-source",
      now: () => new Date("2026-05-08T12:21:00.000Z"),
    });

    const pack = buildSituationContextPack({
      threadId,
      roomId: event.room_id,
      sessionId: session?.session_id ?? null,
    });

    expect(pack).toMatchObject({
      schema: "helix.situation_context_pack.v1",
      mission_memory: {
        schema: "helix.mission_memory.v1",
        thread_id: threadId,
      },
      raw_transcript_included: false,
      raw_audio_included: false,
      deterministic_content_role: "observation_not_assistant_answer",
    });
    expect(JSON.stringify(pack)).not.toContain("raw_world_event_log");
    expect(JSON.stringify(pack)).not.toContain("raw_audio_bytes");
    expect(JSON.stringify(pack)).not.toContain("raw_transcript_text");
  });
});

