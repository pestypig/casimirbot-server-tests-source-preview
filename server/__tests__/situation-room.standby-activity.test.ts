import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { HelixWorldEvent } from "@shared/helix-world-event";
import { __resetHelixThreadLedgerStore } from "../services/helix-thread/ledger";
import {
  ingestWorldEvent,
  resetWorldEventIngestState,
} from "../services/situation-room/world-event-ingest";
import { getStandbyActivityForThread } from "../services/situation-room/standby-activity";
import {
  createSituationGoalSession,
  resetSituationGoalSessions,
} from "../services/situation-room/situation-goal-session-store";
import { buildSituationContextPack } from "../services/situation-room/situation-context-pack";
import { resetStandbyCalloutPolicyState } from "../services/situation-room/standby-callout-policy";
import { resetSituationThreadBindings } from "../services/situation-room/thread-binding-store";

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

describe("standby activity stream", () => {
  beforeEach(() => {
    __resetHelixThreadLedgerStore();
    resetWorldEventIngestState();
    resetSituationThreadBindings();
    resetStandbyCalloutPolicyState();
    resetSituationGoalSessions();
  });

  it("reconstructs visible dock callout activity from compact standby observations", async () => {
    const event = readFixtureEvent("nether-low-health.jsonl");
    const threadId = "helix-ask:test-standby-activity";

    await ingestWorldEvent(event, {
      threadId,
      turnId: "turn:standby-activity",
      now: () => new Date("2026-05-07T12:00:00.000Z"),
    });

    const response = getStandbyActivityForThread({ threadId, limit: 50 });
    const callout = response.activities.find((activity) => activity.kind === "callout_delivery");

    expect(callout).toMatchObject({
      schema: "helix.standby_activity_item.v1",
      thread_id: threadId,
      kind: "callout_delivery",
      visibility: "helix_dock",
      decision: "show_text",
      provenance: {
        source: "deterministic_dictionary",
        model_invoked: false,
        context_policy: "observation_only",
        safe_for_future_context: true,
      },
    });
    expect(callout?.summary).toContain("danger");
    expect(callout?.evidence_refs).toContain("mc:event:low-health:1");
  });

  it("creates a situation goal session without opening a command lane", () => {
    const receipt = createSituationGoalSession({
      thread_id: "helix-ask:desktop",
      room_id: "room:minecraft-minehut",
      source_ids: ["source:minecraft-server"],
      world_id: "minecraft:minehut",
      objective: "Monitor danger and progress.",
      standby_mode: "text_only",
      append_policy: "salient_only",
      now: "2026-05-07T12:00:00.000Z",
    });

    expect(receipt).toMatchObject({
      ok: true,
      session: {
        schema: "helix.situation_goal_session.v1",
        thread_id: "helix-ask:desktop",
        room_id: "room:minecraft-minehut",
        source_ids: ["source:minecraft-server"],
        source_id: "source:minecraft-server",
        context_policy: "compact_context_pack_only",
        attachment_policy: "manual_or_session_bound",
        command_lane_enabled: false,
        status: "active",
        mode: "text_callouts",
        voice_output_enabled: false,
      },
      ledger: {
        objective: "Monitor danger and progress.",
      },
    });
  });

  it("packages direct-turn context from activity without exposing raw world-event logs", async () => {
    const event = readFixtureEvent("nether-low-health.jsonl");
    const threadId = "helix-ask:test-context-pack";

    await ingestWorldEvent(event, {
      threadId,
      turnId: "turn:context-pack",
      now: () => new Date("2026-05-07T12:05:00.000Z"),
    });

    const pack = buildSituationContextPack({
      threadId,
      roomId: event.room_id,
      sessionId: "situation_goal:test",
    });

    expect(pack).toMatchObject({
      schema: "helix.situation_context_pack.v1",
      thread_id: threadId,
      room_id: event.room_id,
      context_policy: "compact_context_pack_only",
      raw_transcript_included: false,
      raw_audio_included: false,
      deterministic_content_role: "observation_not_assistant_answer",
    });
    expect(pack.callouts.length).toBeGreaterThan(0);
    expect(JSON.stringify(pack)).not.toContain("worldEvents");
    expect(JSON.stringify(pack)).not.toContain("raw_transcript_text");
    expect(JSON.stringify(pack)).not.toContain("raw_audio_bytes");
  });
});
