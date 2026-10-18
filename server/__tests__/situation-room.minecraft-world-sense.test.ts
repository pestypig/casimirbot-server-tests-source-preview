import express from "express";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { HelixWorldEvent } from "@shared/helix-world-event";
import { __resetHelixThreadLedgerStore, getHelixThreadLedgerEvents } from "../services/helix-thread/ledger";
import { buildSituationContextPack } from "../services/situation-room/situation-context-pack";
import { clearCategorizationEventsForTest, listCategorizationEvents } from "../services/situation-room/categorization-bus";
import { clearSyntheticEvidenceForTest, listSyntheticEvidence } from "../services/situation-room/synthetic-evidence-ledger";
import { resetSituationThreadBindings } from "../services/situation-room/thread-binding-store";
import { ingestWorldEvent, resetWorldEventIngestState } from "../services/situation-room/world-event-ingest";

const readFixture = (name: string): HelixWorldEvent[] => {
  const filePath = path.resolve(process.cwd(), "fixtures/minecraft/world-sense", name);
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as HelixWorldEvent);
};

const replayFixture = async (name: string, options: { threadId?: string } = {}) => {
  let latest = null as Awaited<ReturnType<typeof ingestWorldEvent>> | null;
  for (const event of readFixture(name)) {
    latest = await ingestWorldEvent(event, {
      appendToThread: options.threadId ? true : false,
      threadId: options.threadId ?? null,
      turnId: options.threadId ? "turn:world-sense" : null,
    });
  }
  return latest;
};

const createApp = async (): Promise<express.Express> => {
  const { planRouter } = await import("../routes/agi.plan");
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

describe("Minecraft neutral world-sense context", () => {
  beforeEach(() => {
    __resetHelixThreadLedgerStore();
    resetWorldEventIngestState();
    resetSituationThreadBindings();
    clearCategorizationEventsForTest();
    clearSyntheticEvidenceForTest();
  });

  it("summarizes a dense chicken cluster with containment without plugin-side farm labels", async () => {
    const result = await replayFixture("chicken-cluster-contained-hole.jsonl");

    const cluster = result?.minecraft_world_sense_context?.entity_clusters[0];
    expect(result?.minecraft_world_sense_event?.event_type).toBe("containment_context_sample");
    expect(cluster).toMatchObject({
      entity_type: "minecraft:chicken",
      count: 18,
      density: "high",
      containment: {
        possible_escape_routes: "low",
        enclosure_width: 2,
        enclosure_depth: 2,
      },
    });
    expect(JSON.stringify(result?.minecraft_world_sense_context)).not.toMatch(/chicken_farm_detected|farm_detected/i);
    expect(result?.minecraft_world_sense_context?.raw_logs_included).toBe(false);
  });

  it("keeps a neutral chicken cluster below farm interpretation without containment", async () => {
    const result = await replayFixture("neutral-chicken-cluster.jsonl", { threadId: "helix-ask:desktop" });

    const hint = result?.minecraft_world_sense_context?.interpretation_hints[0];
    expect(hint).toMatchObject({
      hint_type: "possible_farm_interpretation",
      label: "dense chicken cluster",
      confidence: 0.5,
      confidence_ladder_step: "0.50 dense chicken cluster",
    });
    expect(hint?.missing_evidence.join(" ")).toMatch(/containment context/i);
    expect(result?.synthetic_evidence?.some((entry) => /chicken_farm_detected|farm_detected/i.test(entry.claim))).toBe(false);
  });

  it("steps from contained chicken cluster to possible farm evidence without plugin meaning labels", async () => {
    const result = await replayFixture("contained-chicken-cluster.jsonl", { threadId: "helix-ask:desktop" });

    const hint = result?.minecraft_world_sense_context?.interpretation_hints[0];
    expect(hint).toMatchObject({
      hint_type: "possible_farm_interpretation",
      label: "possible contained chicken cluster",
      confidence: 0.62,
      confidence_ladder_step: "0.62 dense cluster appears contained",
    });
    expect(result?.categorization_events?.some((event) => event.category === "contained_entity_cluster")).toBe(true);
  });

  it("uses egg/container item flow to raise the chicken interpretation confidence", async () => {
    const result = await replayFixture("chicken-egg-flow.jsonl", { threadId: "helix-ask:desktop" });

    const hint = result?.minecraft_world_sense_context?.interpretation_hints[0];
    expect(hint).toMatchObject({
      hint_type: "possible_farm_interpretation",
      label: "high-confidence egg-source farm evidence",
      confidence: 0.85,
      confidence_ladder_step: "0.85 containment + egg pickup + container/hopper evidence",
    });
    expect(result?.categorization_events?.some((event) => event.category === "repeated_item_flow")).toBe(true);
  });

  it("allows block_edit exact coordinates to feed spatial hypotheses", async () => {
    const result = await replayFixture("descending-stair-exact-blocks.jsonl");

    expect(result?.minecraft_spatial_event?.event_type).toBe("block_broken");
    expect(result?.minecraft_spatial_event?.location).toEqual({ x: 5, y: 59, z: 0 });
    expect(result?.minecraft_spatial_episode?.structure_hypotheses.map((entry) => entry.structure_type)).toContain("descending_stair");
  });

  it("records contained entity evidence as validation data, not assistant answers", async () => {
    const result = await replayFixture("chicken-cluster-contained-hole.jsonl", { threadId: "helix-ask:desktop" });

    expect(result?.categorization_events?.some((event) => event.category === "containment_context")).toBe(true);
    expect(result?.synthetic_evidence?.some((entry) => entry.produced_by === "minecraft_world_sense_reducer")).toBe(true);
    expect(listCategorizationEvents("helix-ask:desktop").some((event) => event.category === "containment_context")).toBe(true);
    expect(listSyntheticEvidence("helix-ask:desktop").some((entry) => entry.assistant_answer === false)).toBe(true);
    const ledgerEvents = getHelixThreadLedgerEvents({ threadId: "helix-ask:desktop" });
    expect(ledgerEvents.some((entry) => entry.item_type === "answer")).toBe(false);
    expect(ledgerEvents.some((entry) => entry.item_type === "validation" && entry.meta?.kind === "minecraft_world_sense_context")).toBe(true);
  });

  it("keeps low-density chickens as an entity cluster without containment support", async () => {
    const result = await replayFixture("random-chickens-no-containment.jsonl");

    const cluster = result?.minecraft_world_sense_context?.entity_clusters[0];
    expect(cluster?.entity_type).toBe("minecraft:chicken");
    expect(cluster?.density).toBe("low");
    expect(cluster?.containment).toBeNull();
    expect(result?.minecraft_world_sense_context?.missing_evidence.join(" ")).toMatch(/no containment context/i);
  });

  it("adds compact world-sense context to Ask context without raw logs", async () => {
    await replayFixture("chicken-farm-with-item-flow.jsonl");

    const pack = buildSituationContextPack({
      threadId: "helix-ask:desktop",
      roomId: "room:minecraft-minehut",
    });
    const cluster = pack.minecraft_world_sense_context?.entity_clusters[0];
    expect(cluster?.entity_type).toBe("minecraft:chicken");
    expect(cluster?.item_flow?.[0]).toMatchObject({
      item_type: "minecraft:egg",
      action: "picked_up",
    });
    expect(pack.raw_logs_included).toBe(false);
    expect(pack.deterministic_content_role).toBe("observation_not_assistant_answer");
  });

  it("answers farm questions as agent-side interpretation from compact evidence", async () => {
    const app = await createApp();
    await replayFixture("chicken-cluster-contained-hole.jsonl");

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Is this chicken cluster a farm in Minecraft?",
        sessionId: "helix-ask:desktop",
        debug: true,
      })
      .expect(200);

    expect(response.body.final_answer_source).toBe("artifact_synthesis");
    expect(String(response.body.answer)).toMatch(/possible contained animal setup/i);
    expect(String(response.body.answer)).toMatch(/not call it a confirmed farm/i);
    expect(String(response.body.answer)).toMatch(/0\.62 dense cluster appears contained/i);
    expect(JSON.stringify(response.body.situation_context_pack ?? {})).not.toMatch(/entity_cluster_sample.*entity_cluster_sample/);
  }, 20000);

  it("raises farm confidence only when item-flow evidence is available", async () => {
    const app = await createApp();
    await replayFixture("chicken-farm-with-item-flow.jsonl");

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Is this a chicken farm in Minecraft?",
        sessionId: "helix-ask:desktop",
        debug: true,
      })
      .expect(200);

    expect(String(response.body.answer)).toMatch(/high-confidence egg-source farm evidence|likely farm-like setup/i);
    expect(String(response.body.answer)).toMatch(/0\.85 containment \+ egg pickup \+ container\/hopper evidence/i);
    expect(String(response.body.answer)).toMatch(/picked_up egg|egg/i);
  }, 20000);
});
