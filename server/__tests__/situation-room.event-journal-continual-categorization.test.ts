import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { HelixWorldEvent } from "@shared/helix-world-event";
import { __resetHelixThreadLedgerStore } from "../services/helix-thread/ledger";
import { replayCategorizationWindow } from "../services/situation-room/categorization-replay-runner";
import { queryEventWindow } from "../services/situation-room/event-window-query";
import { clearLearningPromotionRecordsForTest, evaluatePatternCandidatePromotion } from "../services/situation-room/learning-promotion";
import { listPatternCandidates } from "../services/situation-room/pattern-candidate-ledger";
import { getMinecraftSemanticDictionaryVersion } from "../services/situation-room/semantic-dictionary-versioning";
import { clearCategorizationEventsForTest } from "../services/situation-room/categorization-bus";
import { clearSyntheticEvidenceForTest } from "../services/situation-room/synthetic-evidence-ledger";
import { resetSituationThreadBindings } from "../services/situation-room/thread-binding-store";
import { ingestWorldEvent, resetWorldEventIngestState } from "../services/situation-room/world-event-ingest";

const threadId = "helix-ask:desktop";

const readFixture = (name: string): HelixWorldEvent[] => {
  const filePath = path.resolve(process.cwd(), "fixtures/minecraft/world-sense", name);
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as HelixWorldEvent);
};

const replayFixture = async (name: string) => {
  for (const event of readFixture(name)) {
    await ingestWorldEvent(event, {
      appendToThread: true,
      threadId,
      turnId: "turn:event-journal",
    });
  }
};

describe("event journal continual categorization substrate", () => {
  beforeEach(() => {
    __resetHelixThreadLedgerStore();
    resetWorldEventIngestState();
    resetSituationThreadBindings();
    clearCategorizationEventsForTest();
    clearSyntheticEvidenceForTest();
    clearLearningPromotionRecordsForTest();
  });

  it("stores raw Minecraft events for replay while compact queries hide raw content", async () => {
    await replayFixture("chicken-egg-flow.jsonl");

    const compact = queryEventWindow({
      thread_id: threadId,
      room_id: "room:minecraft-minehut",
      limit: 10,
      include_raw_events: false,
    });
    expect(compact.returned_count).toBe(3);
    expect(compact.raw_content_included).toBe(false);
    expect(compact.events.every((event) => event.raw_event === undefined)).toBe(true);
    expect(compact.events.every((event) => event.assistant_answer === false)).toBe(true);

    const debug = queryEventWindow({
      thread_id: threadId,
      room_id: "room:minecraft-minehut",
      limit: 10,
      include_raw_events: true,
    });
    expect(debug.raw_content_included).toBe(true);
    expect(debug.events.some((event) => event.raw_event?.event_type === "item_flow_context")).toBe(true);
    expect(debug.context_policy).toBe("debug_or_replay_only");
  });

  it("turns utility hypotheses into pattern candidates without promoting automatically", async () => {
    await replayFixture("chicken-egg-flow.jsonl");

    const candidates = listPatternCandidates(threadId);
    expect(candidates.some((candidate) => candidate.pattern_label === "confirmed egg-source farm")).toBe(true);
    const candidate = candidates.find((entry) => entry.pattern_label === "confirmed egg-source farm");
    expect(candidate?.status).toBe("candidate");
    expect(candidate?.raw_logs_included).toBe(false);
    expect(candidate?.assistant_answer).toBe(false);

    const promotion = evaluatePatternCandidatePromotion({
      candidate: candidate!,
      observedReplayCount: 1,
      requiredReplayCount: 2,
    });
    expect(promotion.decision).toBe("not_ready");
    expect(promotion.assistant_answer).toBe(false);
  });

  it("replays a queried window into categorization evidence using a replay thread", async () => {
    await replayFixture("chicken-egg-flow.jsonl");

    const result = await replayCategorizationWindow({
      threadId,
      roomId: "room:minecraft-minehut",
      maxEvents: 10,
    });
    expect(result.event_count).toBe(3);
    expect(result.synthetic_evidence_count).toBeGreaterThan(0);
    expect(result.utility_hypothesis_count).toBeGreaterThan(0);
    expect(result.pattern_candidate_count).toBeGreaterThan(0);
    expect(result.raw_content_included).toBe(false);
    expect(result.assistant_answer).toBe(false);
    expect(result.replay_thread_id).toMatch(/^helix-replay:/);
  });

  it("versions the Minecraft semantic dictionary by content hash", () => {
    const version = getMinecraftSemanticDictionaryVersion();

    expect(version.schema).toBe("helix.semantic_dictionary_version.v1");
    expect(version.game_id).toBe("minecraft");
    expect(version.entry_count).toBeGreaterThanOrEqual(4);
    expect(version.content_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(version.raw_reference_included).toBe(false);
    expect(version.assistant_answer).toBe(false);
  });
});
