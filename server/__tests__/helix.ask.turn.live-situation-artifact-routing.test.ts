import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetHelixThreadLedgerStore,
  getHelixThreadLedgerEvents,
} from "../services/helix-thread/ledger";
import { resetLiveSituationArtifacts } from "../services/situation-room/live-situation-artifact-store";
import { resetSituationGoalSessions } from "../services/situation-room/situation-goal-session-store";
import { resetSituationThreadBindings } from "../services/situation-room/thread-binding-store";
import { resetWorldEventIngestState } from "../services/situation-room/world-event-ingest";

const createApp = async (): Promise<express.Express> => {
  const { planRouter } = await import("../routes/agi.plan");
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

describe("Helix Ask live situation artifact routing", () => {
  beforeEach(() => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "0";
    __resetHelixThreadLedgerStore();
    resetLiveSituationArtifacts();
    resetSituationGoalSessions();
    resetSituationThreadBindings();
    resetWorldEventIngestState();
    vi.resetModules();
  });

  it("starting a Minecraft situation creates a thread-native live artifact", async () => {
    const app = await createApp();
    const response = await request(app)
      .post("/api/agi/situation/goal-session/start")
      .send({
        thread_id: "thread:live-setup",
        room_id: "room:minecraft-minehut",
        source_id: "source:minecraft-server",
        world_id: "minecraft:minehut",
        objective: "Monitor my Minecraft session and only tell me about danger or progress.",
        standby_mode: "text_only",
        append_policy: "salient_only",
      })
      .expect(200);

    expect(response.body.live_situation_artifact).toMatchObject({
      schema: "helix.live_situation_artifact.v1",
      thread_id: "thread:live-setup",
      room_id: "room:minecraft-minehut",
      context_policy: "compact_context_pack_only",
      raw_transcript_included: false,
      raw_audio_included: false,
    });
    const events = getHelixThreadLedgerEvents({ threadId: "thread:live-setup" });
    expect(
      events.some(
        (event) =>
          event.item_type === "validation" &&
          event.observation_ref?.schema === "helix.live_situation_artifact.v1",
      ),
    ).toBe(true);
    expect(events.some((event) => event.item_type === "answer")).toBe(false);
  }, 20000);

  it("direct Minecraft questions receive the live artifact context pack", async () => {
    const app = await createApp();
    await request(app)
      .post("/api/agi/situation/goal-session/start")
      .send({
        thread_id: "thread:live-context",
        room_id: "room:minecraft-minehut",
        source_id: "source:minecraft-server",
        world_id: "minecraft:minehut",
        objective: "Watch for danger and progress.",
        standby_mode: "text_only",
      })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "What is my current Minecraft situation?",
        mode: "read",
        debug: true,
        sessionId: "thread:live-context",
      })
      .expect(200);

    expect(response.body.situation_context_pack?.live_situation_artifact).toMatchObject({
      objective: "Watch for danger and progress.",
      current_state_lines: {
        now: expect.any(String),
        risk: expect.any(String),
      },
    });
    expect(String(response.body.assistant_answer ?? "")).toContain("Minecraft situation is active");
  }, 60000);

  it("direct Minecraft questions prefer the latest live artifact snapshot after world-event deltas", async () => {
    const app = await createApp();
    await request(app)
      .post("/api/agi/situation/goal-session/start")
      .send({
        thread_id: "thread:live-delta-context",
        room_id: "room:minecraft-minehut",
        source_id: "source:minecraft-server",
        world_id: "minecraft:minehut",
        objective: "Watch for danger and progress.",
        standby_mode: "text_only",
      })
      .expect(200);

    await request(app)
      .post("/api/agi/situation/world-event")
      .send({
        schema: "helix.world_event.v1",
        world_id: "minecraft:minehut",
        room_id: "room:minecraft-minehut",
        source_id: "source:minecraft-server",
        ts: "2026-05-08T10:00:00.000Z",
        actor_id: "player:datdampig",
        actor_label: "DatDamPig",
        event_type: "player_damage",
        location: { dimension: "minecraft:overworld", x: 279, y: 66, z: -405 },
        health_delta: { current_health: 4, previous_health: 10, damage: 6, cause: "test" },
        text: "Queued simulated damage event.",
        evidence_refs: ["minecraft:event:live-delta-risk"],
        meta: { simulated: true, hostile_nearby: true },
      })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "What is my current Minecraft situation?",
        mode: "read",
        debug: true,
        sessionId: "thread:live-delta-context",
      })
      .expect(200);

    expect(response.body.situation_context_pack?.live_situation_artifact?.current_state_lines).toMatchObject({
      risk: "DatDamPig is in danger at 4 health.",
    });
    expect(String(response.body.assistant_answer ?? "")).toContain("DatDamPig is in danger at 4 health.");
    expect(String(response.body.assistant_answer ?? "")).not.toContain("Minecraft situation monitoring is active.");
  }, 60000);
});
