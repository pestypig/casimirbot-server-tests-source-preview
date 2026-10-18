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

const readSpatialFixture = (name: string): HelixWorldEvent[] => {
  const filePath = path.resolve(process.cwd(), "fixtures/minecraft/spatial", name);
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as HelixWorldEvent);
};

const replayFixture = async (name: string, options: { threadId?: string } = {}) => {
  let latest = null as Awaited<ReturnType<typeof ingestWorldEvent>> | null;
  for (const event of readSpatialFixture(name)) {
    latest = await ingestWorldEvent(event, {
      appendToThread: options.threadId ? true : false,
      threadId: options.threadId ?? null,
      turnId: options.threadId ? "turn:spatial" : null,
    });
  }
  return latest;
};

const structureTypes = (result: Awaited<ReturnType<typeof ingestWorldEvent>> | null): string[] =>
  result?.minecraft_spatial_episode?.structure_hypotheses.map((hypothesis) => hypothesis.structure_type) ?? [];

const createApp = async (): Promise<express.Express> => {
  const { planRouter } = await import("../routes/agi.plan");
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

describe("Minecraft spatial world senses", () => {
  beforeEach(() => {
    __resetHelixThreadLedgerStore();
    resetWorldEventIngestState();
    resetSituationThreadBindings();
    clearCategorizationEventsForTest();
    clearSyntheticEvidenceForTest();
  });

  it("recognizes a descending stair with a parallel side trench and keeps lava as missing evidence", async () => {
    const result = await replayFixture("stair-with-side-trench.jsonl");

    expect(structureTypes(result)).toEqual(expect.arrayContaining(["descending_stair", "parallel_trench"]));
    const trench = result?.minecraft_spatial_episode?.structure_hypotheses.find((hypothesis) => hypothesis.structure_type === "parallel_trench");
    expect(trench?.intent_hypothesis).toContain("side trench");
    expect(trench?.missing_evidence.join(" ")).toMatch(/No lava placement|bucket-empty/i);
    expect(result?.minecraft_spatial_episode?.raw_logs_included).toBeUndefined();
    expect(result?.minecraft_spatial_episode?.model_invoked).toBe(false);
  });

  it("adds lava lighting channel evidence and lava hazard context when lava is observed", async () => {
    const result = await replayFixture("lava-light-channel.jsonl");

    expect(structureTypes(result)).toEqual(expect.arrayContaining(["parallel_trench", "lava_lighting_channel"]));
    const lava = result?.minecraft_spatial_episode?.structure_hypotheses.find((hypothesis) => hypothesis.structure_type === "lava_lighting_channel");
    expect(lava?.intent_hypothesis).toContain("lava-lit channel");
    expect(result?.minecraft_spatial_episode?.risk_notes.join(" ")).toContain("Lava proximity");
  });

  it("does not overclaim a structure for noisy random mining", async () => {
    const result = await replayFixture("noisy-random-mining.jsonl");

    expect(structureTypes(result)).not.toContain("descending_stair");
    expect(structureTypes(result)).not.toContain("parallel_trench");
    expect(structureTypes(result)).not.toContain("lava_lighting_channel");
  });

  it("does not create build-structure hypotheses from location samples alone", async () => {
    const result = await replayFixture("location-samples-only-no-claim.jsonl");

    expect(result?.minecraft_spatial_episode).toBeNull();
    expect(structureTypes(result)).toEqual([]);
  });

  it("uses explicit block coordinates over decimal player coordinates for edit geometry", async () => {
    const base = {
      schema: "helix.world_event.v1" as const,
      world_id: "minecraft:minehut",
      room_id: "room:minecraft-minehut",
      source_id: "source:minecraft-server",
      actor_id: "minecraft:player:datdampig",
      actor_label: "DatDamPig",
      event_type: "block_broken",
      evidence_refs: [] as string[],
    };
    const events: HelixWorldEvent[] = Array.from({ length: 6 }, (_, index) => ({
      ...base,
      ts: `2026-05-13T22:55:0${index}.000Z`,
      location: { dimension: "minecraft:overworld", x: 100.42 + index, y: 70.9 - index, z: -20.33 },
      meta: {
        block_x: index,
        block_y: 64 - index,
        block_z: 0,
        block_type: "minecraft:stone",
        tool_item: "minecraft:stone_pickaxe",
      },
      evidence_refs: [`mc:spatial:explicit-block:${index}`],
    }));
    let result = null as Awaited<ReturnType<typeof ingestWorldEvent>> | null;
    for (const event of events) {
      result = await ingestWorldEvent(event, { appendToThread: false });
    }

    expect(result?.minecraft_spatial_event?.location).toEqual({ x: 5, y: 59, z: 0 });
    expect(result?.minecraft_spatial_episode?.bounding_box).toMatchObject({
      min: { x: 0, y: 59, z: 0 },
      max: { x: 5, y: 64, z: 0 },
    });
    expect(structureTypes(result)).toContain("descending_stair");
  });

  it("records spatial pattern evidence as validation data, not assistant answers", async () => {
    const result = await replayFixture("stair-with-side-trench.jsonl", { threadId: "helix-ask:desktop" });

    expect(result?.categorization_events?.some((event) => event.category === "minecraft_spatial_pattern")).toBe(true);
    expect(result?.synthetic_evidence?.some((entry) => entry.produced_by === "minecraft_spatial_reducer")).toBe(true);
    expect(listCategorizationEvents("helix-ask:desktop").some((event) => event.category === "minecraft_spatial_pattern")).toBe(true);
    expect(listSyntheticEvidence("helix-ask:desktop").some((entry) => entry.assistant_answer === false)).toBe(true);
    const ledgerEvents = getHelixThreadLedgerEvents({ threadId: "helix-ask:desktop" });
    expect(ledgerEvents.some((entry) => entry.item_type === "answer")).toBe(false);
    expect(ledgerEvents.some((entry) => entry.item_type === "validation" && entry.meta?.kind === "minecraft_spatial_episode")).toBe(true);
  });

  it("adds compact spatial context to the situation context pack without raw logs", async () => {
    await replayFixture("stair-with-side-trench.jsonl");

    const pack = buildSituationContextPack({
      threadId: "helix-ask:desktop",
      roomId: "room:minecraft-minehut",
    });
    expect(pack.minecraft_spatial_episode?.structure_hypotheses.map((hypothesis) => hypothesis.structure_type)).toEqual(
      expect.arrayContaining(["descending_stair", "parallel_trench"]),
    );
    expect(pack.raw_logs_included).toBe(false);
    expect(pack.deterministic_content_role).toBe("observation_not_assistant_answer");
  });

  it("answers direct spatial Ask questions from compact spatial evidence", async () => {
    const app = await createApp();
    await replayFixture("stair-with-side-trench.jsonl");

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "What am I building in Minecraft?",
        sessionId: "helix-ask:desktop",
        debug: true,
      })
      .expect(200);

    expect(response.body.final_answer_source).toBe("artifact_synthesis");
    expect(String(response.body.answer)).toMatch(/descending stair/i);
    expect(String(response.body.answer)).toMatch(/parallel trench|side trench/i);
    expect(JSON.stringify(response.body.situation_context_pack ?? {})).not.toMatch(/block_broken.*block_broken.*block_broken/);
  }, 20000);

  it("exposes latest compact spatial episode through a debug-safe route", async () => {
    const app = await createApp();
    await replayFixture("lava-light-channel.jsonl");

    const response = await request(app)
      .get("/api/agi/situation/minecraft-spatial/latest?room_id=room:minecraft-minehut")
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      schema: "helix.minecraft_spatial_latest_response.v1",
      raw_logs_included: false,
      context_policy: "compact_context_pack_only",
    });
    expect(response.body.episode.structure_hypotheses.map((entry: { structure_type: string }) => entry.structure_type)).toContain("lava_lighting_channel");
  }, 15000);
});
