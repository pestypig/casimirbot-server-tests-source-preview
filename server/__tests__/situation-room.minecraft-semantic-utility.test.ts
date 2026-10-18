import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { HelixWorldEvent } from "@shared/helix-world-event";
import { __resetHelixThreadLedgerStore, getHelixThreadLedgerEvents } from "../services/helix-thread/ledger";
import { buildSituationContextPack } from "../services/situation-room/situation-context-pack";
import { clearCategorizationEventsForTest } from "../services/situation-room/categorization-bus";
import { clearSyntheticEvidenceForTest, listSyntheticEvidence } from "../services/situation-room/synthetic-evidence-ledger";
import { listGameSemanticLookupReceipts } from "../services/situation-room/game-semantic-reference";
import { listGameUtilityHypotheses } from "../services/situation-room/minecraft-entity-utility-reducer";
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
  let latest = null as Awaited<ReturnType<typeof ingestWorldEvent>> | null;
  for (const event of readFixture(name)) {
    latest = await ingestWorldEvent(event, {
      appendToThread: true,
      threadId,
      turnId: "turn:semantic-utility",
    });
  }
  return latest;
};

describe("Minecraft semantic dictionary utility reasoner", () => {
  beforeEach(() => {
    __resetHelixThreadLedgerStore();
    resetWorldEventIngestState();
    resetSituationThreadBindings();
    clearCategorizationEventsForTest();
    clearSyntheticEvidenceForTest();
  });

  it("uses semantic references for dense chickens without source-side farm labels", async () => {
    const result = await replayFixture("neutral-chicken-cluster.jsonl");

    expect(result?.game_semantic_lookup_receipts?.[0]).toMatchObject({
      schema: "helix.game_semantic_lookup_receipt.v1",
      raw_reference_included: false,
      assistant_answer: false,
    });
    expect(result?.game_semantic_lookup_receipts?.[0]?.matched_entry_ids).toContain("minecraft:entity/chicken");
    const hypothesis = result?.game_utility_hypotheses?.[0];
    expect(hypothesis).toMatchObject({
      schema: "helix.game_utility_hypothesis.v1",
      subject_ref: "minecraft:chicken",
      utility_label: "dense chicken cluster",
      status: "possible",
      confidence: 0.5,
      raw_logs_included: false,
      assistant_answer: false,
    });
    expect(hypothesis?.missing_evidence.join(" ")).toMatch(/Containment context/i);
    expect(JSON.stringify(result)).not.toMatch(/chicken_farm_detected|farm_detected/i);
  });

  it("raises chicken utility from contained cluster to egg-source evidence when item flow exists", async () => {
    const result = await replayFixture("chicken-egg-flow.jsonl");

    const hypothesis = result?.game_utility_hypotheses?.[0];
    expect(hypothesis?.utility_label).toBe("confirmed egg-source farm");
    expect(hypothesis?.confidence).toBe(0.85);
    expect(hypothesis?.semantic_entry_refs).toContain("minecraft:entity/chicken");
    expect(result?.synthetic_evidence?.some((entry) => entry.produced_by === "game_utility_reasoner")).toBe(true);
    expect(listSyntheticEvidence(threadId).some((entry) => entry.reusable_context_ref === hypothesis?.hypothesis_id)).toBe(true);
  });

  it("infers a cow resource pen from containment plus wheat use", async () => {
    const result = await replayFixture("cow-wheat-pen.jsonl");

    const hypothesis = result?.game_utility_hypotheses?.[0];
    expect(hypothesis?.subject_ref).toBe("minecraft:cow");
    expect(hypothesis?.utility_label).toBe("likely food/leather breeding pen");
    expect(hypothesis?.status).toBe("likely");
    expect(hypothesis?.confidence).toBe(0.76);
  });

  it("keeps hostile mob collection as possible until stronger grinder evidence exists", async () => {
    const result = await replayFixture("zombie-cluster-collection.jsonl");

    const hypothesis = result?.game_utility_hypotheses?.[0];
    expect(hypothesis?.subject_ref).toBe("minecraft:zombie");
    expect(hypothesis?.utility_label).toBe("possible mob grinder / drop collection setup");
    expect(hypothesis?.status).toBe("possible");
    expect(hypothesis?.missing_evidence.join(" ")).toMatch(/spawner|kill chamber|drop shaft/i);
  });

  it("does not turn open-field random animals into a farm claim", async () => {
    const result = await replayFixture("random-animals-no-farm.jsonl");

    const hypothesis = result?.game_utility_hypotheses?.[0];
    expect(hypothesis?.utility_label).toBe("Chicken utility context");
    expect(hypothesis?.confidence).toBe(0.35);
    expect(hypothesis?.missing_evidence.join(" ")).toMatch(/Containment context/i);
  });

  it("adds compact semantic evidence to context packs and ledger items without answers", async () => {
    await replayFixture("chicken-egg-flow.jsonl");

    const pack = buildSituationContextPack({
      threadId,
      roomId: "room:minecraft-minehut",
    });
    expect(pack.semantic_reference_hits?.[0]?.raw_reference_included).toBe(false);
    expect(pack.utility_hypotheses?.[0]?.assistant_answer).toBe(false);
    expect(pack.semantic_confidence_ladder?.join(" ")).toMatch(/egg-source farm/);
    expect(pack.missing_evidence_notes?.join(" ")).toMatch(/breeding|feed|container|hopper/i);
    expect(listGameSemanticLookupReceipts(threadId).length).toBeGreaterThan(0);
    expect(listGameUtilityHypotheses(threadId).length).toBeGreaterThan(0);

    const ledger = getHelixThreadLedgerEvents({ threadId });
    expect(ledger.some((event) => event.item_type === "toolObservation" && event.meta?.kind === "game_semantic_lookup_receipt")).toBe(true);
    expect(ledger.some((event) => event.item_type === "validation" && event.meta?.kind === "game_utility_hypothesis")).toBe(true);
    expect(ledger.some((event) => event.item_type === "answer")).toBe(false);
  });
});
