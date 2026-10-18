import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { HelixWorldEvent } from "@shared/helix-world-event";
import {
  ingestWorldEvent,
  resetWorldEventIngestState,
} from "../services/situation-room/world-event-ingest";
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

const replaySummary = async (events: HelixWorldEvent[]) => {
  resetWorldEventIngestState();
  resetSituationThreadBindings();
  const results = [];
  for (const event of events) {
    const result = await ingestWorldEvent(event, { appendToThread: false });
    results.push({
      event_type: result.event_type,
      projection_event_count: result.projection?.window.event_count ?? null,
      salience_reason: result.salience_receipt?.reason ?? null,
      dedupe_key: result.salience_receipt?.dedupe_key ?? null,
      append_decision: result.debug?.append_decision ?? null,
      append_reason: result.debug?.append_reason ?? null,
      salience_class: result.debug?.salience_class ?? null,
      proposal_text: result.interjection_proposal?.text ?? null,
    });
  }
  return results;
};

describe("Minecraft replay determinism", () => {
  beforeEach(() => {
    resetWorldEventIngestState();
    resetSituationThreadBindings();
  });

  it.each([
    "low-health-risk.jsonl",
    "blaze-rod-goal-progress.jsonl",
    "location-noise-quiet.jsonl",
    "source-health-disconnect.jsonl",
    "goal-blocked-looping.jsonl",
  ])("replays %s deterministically after normalizing ids and timestamps", async (fixture) => {
    const events = readFixture(fixture);
    const first = await replaySummary(events);
    const second = await replaySummary(events);

    expect(second).toEqual(first);
  });

  it("keeps location-noise replay projection-only", async () => {
    const summary = await replaySummary(readFixture("location-noise-quiet.jsonl"));

    expect(summary.every((entry) => entry.salience_reason === null)).toBe(true);
    expect(summary.every((entry) => entry.append_reason === "projection_only")).toBe(true);
  });
});
