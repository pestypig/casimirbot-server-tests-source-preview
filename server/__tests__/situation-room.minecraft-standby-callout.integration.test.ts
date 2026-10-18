import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { HelixWorldEvent } from "@shared/helix-world-event";
import { __resetHelixThreadLedgerStore } from "../services/helix-thread/ledger";
import {
  ingestWorldEvent,
  resetWorldEventIngestState,
} from "../services/situation-room/world-event-ingest";
import { resetStandbyCalloutPolicyState } from "../services/situation-room/standby-callout-policy";
import { resetSituationThreadBindings } from "../services/situation-room/thread-binding-store";

const readFixture = (name: string): HelixWorldEvent[] => {
  const filePath = path.resolve(process.cwd(), "fixtures/minecraft", name);
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as HelixWorldEvent);
};

describe("Minecraft standby callouts", () => {
  beforeEach(() => {
    __resetHelixThreadLedgerStore();
    resetWorldEventIngestState();
    resetSituationThreadBindings();
    resetStandbyCalloutPolicyState();
  });

  it("creates a text callout delivery receipt for a bound risk event", async () => {
    const [event] = readFixture("nether-low-health.jsonl");
    const result = await ingestWorldEvent(event, {
      threadId: "helix-ask:desktop",
      turnId: "turn:minecraft",
      now: () => new Date("2026-05-07T12:00:00.000Z"),
    });

    expect(result.callout_proposal).toMatchObject({
      schema: "helix.standby_callout_proposal.v1",
      decision: "show_text",
      priority: "warn",
      thread_id: "helix-ask:desktop",
    });
    expect(result.callout_delivery_receipt).toMatchObject({
      schema: "helix.standby_callout_delivery_receipt.v1",
      delivered: true,
      channel: "ui_text",
      reason: "delivered",
    });
    expect(result.append_candidate?.observationRef).toMatchObject({
      callout_proposal: {
        schema: "helix.standby_callout_proposal.v1",
      },
      callout_delivery_receipt: {
        schema: "helix.standby_callout_delivery_receipt.v1",
      },
    });
  });

  it("does not create a callout for projection-only location samples", async () => {
    const event: HelixWorldEvent = {
      schema: "helix.world_event.v1",
      world_id: "minecraft:minehut",
      room_id: "room:minecraft-minehut",
      source_id: "source:minecraft-server",
      ts: "2026-05-07T12:01:00.000Z",
      actor_id: "player:datdampig",
      actor_label: "DatDamPig",
      event_type: "player_location_sample",
      location: { dimension: "minecraft:overworld", x: 280, y: 66, z: -405 },
      evidence_refs: ["minecraft:minecraft:minehut:event:location"],
      meta: {},
    };

    const result = await ingestWorldEvent(event, {
      threadId: "helix-ask:desktop",
      turnId: "turn:minecraft",
      now: () => new Date("2026-05-07T12:01:00.000Z"),
    });

    expect(result.salience_receipt).toBeNull();
    expect(result.callout_proposal).toBeNull();
    expect(result.callout_delivery_receipt).toBeNull();
    expect(result.debug).toMatchObject({
      append_reason: "projection_only",
    });
  });
});
