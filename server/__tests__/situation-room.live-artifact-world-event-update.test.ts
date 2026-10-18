import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { HelixWorldEvent } from "@shared/helix-world-event";
import {
  __resetHelixThreadLedgerStore,
  getHelixThreadLedgerEvents,
} from "../services/helix-thread/ledger";
import {
  createLiveSituationArtifact,
  getActiveLiveSituationArtifactForThread,
  resetLiveSituationArtifacts,
} from "../services/situation-room/live-situation-artifact-store";
import { createSituationGoalSession, resetSituationGoalSessions } from "../services/situation-room/situation-goal-session-store";
import { createSituationThreadBinding, resetSituationThreadBindings } from "../services/situation-room/thread-binding-store";
import { ingestWorldEvent, resetWorldEventIngestState } from "../services/situation-room/world-event-ingest";

const readFixture = (name: string): HelixWorldEvent[] => {
  const filePath = path.resolve(process.cwd(), "fixtures/minecraft", name);
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as HelixWorldEvent);
};

const startLiveSituation = () => {
  const [event] = readFixture("nether-low-health.jsonl");
  createSituationThreadBinding({
    room_id: event.room_id,
    source_id: event.source_id,
    world_id: event.world_id,
    thread_id: "thread:live-world",
    mode: "standby_receipts",
    append_policy: "salient_only",
  });
  createSituationGoalSession({
    thread_id: "thread:live-world",
    room_id: event.room_id,
    source_id: event.source_id,
    world_id: event.world_id,
    objective: "Watch for danger and progress.",
    standby_mode: "text_only",
  });
  createLiveSituationArtifact({
    thread_id: "thread:live-world",
    created_turn_id: "turn:setup",
    session_id: "situation_goal:test",
    room_id: event.room_id,
    world_id: event.world_id,
    source_ids: [event.source_id ?? "source:minecraft-server"],
    objective: "Watch for danger and progress.",
    mode: "text_only",
  });
  return event;
};

describe("live situation artifact world-event updates", () => {
  beforeEach(() => {
    __resetHelixThreadLedgerStore();
    resetLiveSituationArtifacts();
    resetSituationGoalSessions();
    resetSituationThreadBindings();
    resetWorldEventIngestState();
  });

  it("routine location samples do not create live artifact deltas", async () => {
    const base = startLiveSituation();
    const event: HelixWorldEvent = {
      ...base,
      ts: "2026-05-08T12:00:00.000Z",
      event_type: "player_location_sample",
      health_delta: undefined,
      objective_delta: undefined,
      inventory_delta: undefined,
      location: { dimension: "minecraft:overworld", x: 1, y: 64, z: 2 },
      evidence_refs: ["mc:location:routine"],
    };

    const result = await ingestWorldEvent(event);

    expect(result.live_situation_artifact_delta).toBeNull();
    expect(result.debug?.append_reason).toBe("projection_only");
  });

  it("damage creates a compact artifact delta and validation item but no answer item", async () => {
    const event = startLiveSituation();
    const result = await ingestWorldEvent(event);

    expect(result.live_situation_artifact_delta).toMatchObject({
      schema: "helix.live_situation_artifact_delta.v1",
      reason: "risk_update",
      artifact_snapshot: {
        latest_evaluation: {
          schema: "helix.live_situation_evaluation.v1",
          model_invoked: false,
          deterministic_gate: true,
        },
      },
    });
    const artifact = getActiveLiveSituationArtifactForThread("thread:live-world");
    expect(artifact?.current_state_lines.risk).toContain("danger");
    const events = getHelixThreadLedgerEvents({ threadId: "thread:live-world" });
    expect(
      events.some(
        (entry) =>
          entry.item_type === "validation" &&
          entry.observation_ref?.schema === "helix.live_situation_artifact_delta.v1",
      ),
    ).toBe(true);
    expect(events.some((entry) => entry.item_type === "answer")).toBe(false);
  });
});
