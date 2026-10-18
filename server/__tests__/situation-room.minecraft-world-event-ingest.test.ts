import express from "express";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { HelixWorldEvent } from "@shared/helix-world-event";
import {
  HELIX_ROOM_SOURCE_ADMISSION_SCHEMA,
  HELIX_ROOM_SOURCE_NAMESPACE_RESERVED_ERROR,
  type HelixRoomSourceAdmission,
} from "@shared/helix-room-source-ingress";
import {
  __resetHelixThreadLedgerStore,
  getHelixThreadLedgerEvents,
} from "../services/helix-thread/ledger";
import {
  ingestWorldEvent,
  ingestWorldEventBatch,
  resetWorldEventIngestState,
} from "../services/situation-room/world-event-ingest";
import {
  createSituationThreadBinding,
  resetSituationThreadBindings,
} from "../services/situation-room/thread-binding-store";
import { listWorldSourcesSeen } from "../services/situation-room/world-source-registry";
import { queryEventJournal } from "../services/situation-room/event-journal-store";
import { getLatestMinecraftWorldSenseContextForRoom } from "../services/situation-room/minecraft-world-sense-window";
import { getLatestMinecraftSpatialEpisodeForRoom } from "../services/situation-room/minecraft-spatial-window";
import { resolveProfileMinecraftSource } from "../services/situation-room/profile-source-registry";
import { upsertSituationSourceBinding } from "../services/situation-room/situation-source-binding-store";
import { upsertLiveContinuationJob } from "../services/situation-room/live-continuation-job-store";
import { createLiveAnswerEnvironment } from "../services/situation-room/live-answer-environment-store";

const createApp = async (): Promise<express.Express> => {
  const { planRouter } = await import("../routes/agi.plan");
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

const readFixture = (name: string): HelixWorldEvent[] => {
  const filePath = path.resolve(process.cwd(), "fixtures/minecraft", name);
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as HelixWorldEvent);
};

describe("Minecraft world-event ingest", () => {
  beforeEach(() => {
    delete process.env.HELIX_WORLD_EVENT_REQUIRE_TOKEN;
    delete process.env.HELIX_WORLD_EVENT_DEV_TOKEN;
    delete process.env.HELIX_WORLD_EVENT_MAX_BATCH;
    __resetHelixThreadLedgerStore();
    resetWorldEventIngestState();
    resetSituationThreadBindings();
  });

  it("normalizes a valid world event into a minecraft_event signal", async () => {
    const [event] = readFixture("nether-low-health.jsonl");
    const result = await ingestWorldEvent(event, { appendToThread: false });

    expect(result).toMatchObject({
      ok: true,
      appended: false,
      reason: "no_thread_context",
      signal: {
        source: "minecraft_event",
        event_type: "player_damage",
        actor: "Dan",
      },
    });
    expect(result.signal_id).toContain("world-event:paper:local:player_damage");
  });

  it("returns a safe no-thread response when thread context is absent", async () => {
    const app = await createApp();
    const [event] = readFixture("nether-low-health.jsonl");

    const response = await request(app)
      .post("/api/agi/situation/world-event")
      .send(event)
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      appended: false,
      reason: "no_thread_context",
      schema: "helix.world_event_ingest_response.v1",
    });
  }, 15000);

  it("emits risk salience for low health near danger", async () => {
    const [event] = readFixture("nether-low-health.jsonl");
    const result = await ingestWorldEvent(event, { appendToThread: false });

    expect(result.salience_receipt).toMatchObject({
      reason: "risk_detected",
      priority: "warn",
      should_notify_helix: true,
      should_speak: false,
    });
  });

  it("emits goal progress when an objective confirms item acquisition", async () => {
    const events = readFixture("blaze-rod-goal-progress.jsonl");
    let result = await ingestWorldEvent(events[0], { appendToThread: false });
    result = await ingestWorldEvent(events[1], { appendToThread: false });

    expect(result.salience_receipt).toMatchObject({
      reason: "goal_progress",
      priority: "info",
    });
    expect(result.goal_hypotheses?.some((goal) => goal.goal_label === "collect blaze rods")).toBe(
      true,
    );
  });

  it("emits goal-blocked salience for an explicit blocked objective", async () => {
    const events = readFixture("goal-blocked-looping.jsonl");
    let result = await ingestWorldEvent(events[0], { appendToThread: false });
    result = await ingestWorldEvent(events[1], { appendToThread: false });
    result = await ingestWorldEvent(events[2], { appendToThread: false });

    expect(result.salience_receipt).toMatchObject({
      reason: "goal_blocked",
      priority: "action",
    });
  });

  it("emits source health salience on bridge disconnect", async () => {
    const [event] = readFixture("source-health-disconnect.jsonl");
    const result = await ingestWorldEvent(event, { appendToThread: false });

    expect(result.salience_receipt).toMatchObject({
      reason: "source_health",
      priority: "warn",
    });
  });

  it("does not emit salience for quiet routine events", async () => {
    const [event] = readFixture("quiet-noop.jsonl");
    const result = await ingestWorldEvent(event, { appendToThread: false });

    expect(result.salience_receipt).toBeNull();
    expect(result.salience_receipt_id).toBeNull();
  });

  it("records detected Minecraft source ids for binding diagnostics", async () => {
    const app = await createApp();
    const [event] = readFixture("nether-low-health.jsonl");

    await request(app).post("/api/agi/situation/world-event").send(event).expect(200);
    const response = await request(app).get("/api/agi/situation/world-event/sources").expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      schema: "helix.world_event_sources.v1",
      sources: [
        {
          room_id: event.room_id,
          source_id: event.source_id,
          world_id: event.world_id,
          latest_event_type: event.event_type,
          event_count: 1,
        },
      ],
    });
  }, 15000);

  it("treats routine location samples as projection-only by default", async () => {
    const event: HelixWorldEvent = {
      schema: "helix.world_event.v1",
      world_id: "minecraft:minehut",
      room_id: "room:minecraft-minehut",
      source_id: "source:minecraft-server",
      ts: "2026-05-05T07:30:00.000Z",
      actor_id: "player:datdampig",
      actor_label: "DatDamPig",
      event_type: "player_location_sample",
      location: { dimension: "minecraft:overworld", x: 280, y: 66, z: -405 },
      evidence_refs: ["minecraft:minecraft:minehut:event:location"],
      meta: {},
    };

    const result = await ingestWorldEvent(event, { appendToThread: false });

    expect(result.salience_receipt).toBeNull();
    expect(result.debug).toMatchObject({
      append_reason: "projection_only",
      salience_class: "projection_only",
    });
  });

  it("preserves timestamp ordering through the batch endpoint", async () => {
    const app = await createApp();
    const events = [
      readFixture("source-health-disconnect.jsonl")[0],
      readFixture("nether-low-health.jsonl")[0],
    ];

    const response = await request(app)
      .post("/api/agi/situation/world-event/batch")
      .send({ events })
      .expect(200);

    expect(response.body.results.map((result: { event_type: string }) => result.event_type)).toEqual([
      "player_damage",
      "source_disconnected",
    ]);
  }, 15000);

  it("returns deterministic replay results across repeated runs", async () => {
    const app = await createApp();
    const events = readFixture("blaze-rod-goal-progress.jsonl");

    const first = await request(app)
      .post("/api/agi/situation/world-event/replay")
      .send({ reset: true, events })
      .expect(200);
    const second = await request(app)
      .post("/api/agi/situation/world-event/replay")
      .send({ reset: true, events })
      .expect(200);

    expect(second.body).toEqual(first.body);
  }, 15000);

  it("returns deterministic 400 for invalid world event schema", async () => {
    const app = await createApp();
    const response = await request(app)
      .post("/api/agi/situation/world-event")
      .send({ schema: "wrong" })
      .expect(400);

    expect(response.body).toMatchObject({
      ok: false,
      error: "invalid_world_event",
    });
  }, 15000);

  it("rejects reserved room-ingress source ids at canonical and legacy world-event boundaries", async () => {
    const app = await createApp();
    const [fixture] = readFixture("nether-low-health.jsonl");
    const event: HelixWorldEvent = {
      ...fixture,
      source_id: "source:room-ingress:legacy-attempt",
      meta: {
        ...(fixture.meta ?? {}),
        domain_adapter: "minecraft.paper_plugin.v1",
      },
    };

    await expect(
      ingestWorldEvent(event, { appendToThread: false }),
    ).rejects.toThrow(HELIX_ROOM_SOURCE_NAMESPACE_RESERVED_ERROR);

    for (const attempt of [
      request(app).post("/api/agi/situation/world-event").send(event),
      request(app)
        .post("/api/agi/situation/world-event/batch")
        .send({ events: [event] }),
      request(app)
        .post("/api/agi/situation/world-event/replay")
        .send({ reset: true, events: [event] }),
    ]) {
      const response = await attempt.expect(403);
      expect(response.body).toMatchObject({
        ok: false,
        error: HELIX_ROOM_SOURCE_NAMESPACE_RESERVED_ERROR,
        assistant_answer: false,
        raw_content_included: false,
      });
    }
  }, 30000);

  it("diverts exact admitted protected batches into the minimal observation lane", async () => {
    const roomId = "shared_realtime_room:protected-boundary";
    const sourceId = "source:room-ingress:protected-boundary";
    const worldId = "minecraft:minehut:protected-boundary";
    const domainAdapter = "minecraft.paper_plugin.v1";
    const requestId = "request:protected-boundary";
    const admission: HelixRoomSourceAdmission = {
      schema: HELIX_ROOM_SOURCE_ADMISSION_SCHEMA,
      transport: "room_source_ingress",
      binding_id: "room_source_binding:protected-boundary",
      request_id: requestId,
      room_id: roomId,
      source_id: sourceId,
      world_id: worldId,
      domain_adapter: domainAdapter,
      evidence_refs: [
        "room_source_binding:protected-boundary",
        `room_source_request:room_source_binding:protected-boundary:${requestId}`,
      ],
      content_role: "source_admission_not_assistant_answer",
      reentry_required: true,
      model_invoked: false,
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    const base = {
      schema: "helix.world_event.v1" as const,
      world_id: worldId,
      room_id: roomId,
      source_id: sourceId,
      actor_id: "minecraft:player:protected",
      actor_label: "ProtectedPlayer",
      evidence_refs: ["evidence:protected-boundary"],
    };
    const events: HelixWorldEvent[] = [
      {
        ...base,
        ts: "2026-07-26T12:00:00.000Z",
        event_type: "entity_cluster_sample",
        meta: {
          domain_adapter: domainAdapter,
          entity_type: "minecraft:chicken",
          count: 8,
        },
      },
      {
        ...base,
        ts: "2026-07-26T12:00:01.000Z",
        event_type: "block_edit",
        location: { x: 1, y: 64, z: 2 },
        meta: {
          domain_adapter: domainAdapter,
          block_type: "minecraft:oak_fence",
          action: "place",
          x: 1,
          y: 64,
          z: 2,
        },
      },
    ];

    const result = await ingestWorldEventBatch(events, {
      sourceAdmission: admission,
      sourceOwnerProfileId: "profile:protected-owner",
    });

    expect(result).toMatchObject({
      event_count: 2,
      appended_count: 0,
      suppressed_count: 2,
      batch_receipts: [],
      results: [
        {
          appended: false,
          reason: "protected_observation_only",
          source_admission: admission,
        },
        {
          appended: false,
          reason: "protected_observation_only",
          source_admission: admission,
        },
      ],
    });
    expect(listWorldSourcesSeen()).toEqual([]);
    expect(listWorldSourcesSeen({ sourceAdmission: admission })).toEqual([
      expect.objectContaining({
        room_id: roomId,
        source_id: sourceId,
        world_id: worldId,
        event_count: 2,
      }),
    ]);
    expect(queryEventJournal({}).returned_count).toBe(0);
    expect(
      queryEventJournal({ sourceAdmission: admission }).returned_count,
    ).toBe(2);
    expect(getLatestMinecraftWorldSenseContextForRoom(roomId)).toBeNull();
    expect(getLatestMinecraftSpatialEpisodeForRoom(roomId)).toBeNull();
    expect(
      resolveProfileMinecraftSource({
        profile_id: "profile:protected-owner",
      }),
    ).toMatchObject({ resolved: false, reason: "missing_source" });

    await expect(
      ingestWorldEvent(events[0], {
        sourceAdmission: admission,
        appendToThread: false,
      }),
    ).rejects.toThrow(HELIX_ROOM_SOURCE_NAMESPACE_RESERVED_ERROR);
    await expect(
      ingestWorldEventBatch(
        [events[0], readFixture("nether-low-health.jsonl")[0]],
        { sourceAdmission: admission },
      ),
    ).rejects.toThrow(HELIX_ROOM_SOURCE_NAMESPACE_RESERVED_ERROR);
  });

  it("does not treat transport admission as thread or live-runtime authority", () => {
    const requestId = "request:no-thread-authority";
    const admission: HelixRoomSourceAdmission = {
      schema: HELIX_ROOM_SOURCE_ADMISSION_SCHEMA,
      transport: "room_source_ingress",
      binding_id: "room_source_binding:no-thread-authority",
      request_id: requestId,
      room_id: "shared_realtime_room:no-thread-authority",
      source_id: "source:room-ingress:no-thread-authority",
      world_id: "minecraft:minehut:no-thread-authority",
      domain_adapter: "minecraft.paper_plugin.v1",
      evidence_refs: [
        "room_source_binding:no-thread-authority",
        `room_source_request:room_source_binding:no-thread-authority:${requestId}`,
      ],
      content_role: "source_admission_not_assistant_answer",
      reentry_required: true,
      model_invoked: false,
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };

    expect(
      createSituationThreadBinding({
        room_id: admission.room_id,
        source_id: admission.source_id,
        world_id: admission.world_id,
        thread_id: "thread:attacker-selected",
        sourceAdmission: admission,
      }),
    ).toMatchObject({
      ok: false,
      error: HELIX_ROOM_SOURCE_NAMESPACE_RESERVED_ERROR,
    });
    expect(() =>
      upsertSituationSourceBinding({
        thread_id: "thread:attacker-selected",
        situation_run_id: "situation_run:attacker-selected",
        source_id: admission.source_id,
        modality: "visual_frame",
        sourceAdmission: admission,
      }),
    ).toThrow(HELIX_ROOM_SOURCE_NAMESPACE_RESERVED_ERROR);
    expect(() =>
      upsertLiveContinuationJob({
        thread_id: "thread:attacker-selected",
        room_id: admission.room_id,
        source_ids: [admission.source_id],
        objective: "Attach transport source to an arbitrary thread.",
        sourceAdmission: admission,
      }),
    ).toThrow(HELIX_ROOM_SOURCE_NAMESPACE_RESERVED_ERROR);
    expect(() =>
      createLiveAnswerEnvironment({
        thread_id: "thread:attacker-selected",
        created_turn_id: "turn:attacker-selected",
        objective: "Attach transport source to an arbitrary live answer.",
        room_id: admission.room_id,
        source_ids: [admission.source_id],
      }),
    ).toThrow(HELIX_ROOM_SOURCE_NAMESPACE_RESERVED_ERROR);
  });

  it("requires a dev bearer token when configured", async () => {
    process.env.HELIX_WORLD_EVENT_REQUIRE_TOKEN = "1";
    process.env.HELIX_WORLD_EVENT_DEV_TOKEN = "dev-local-token";
    const app = await createApp();

    await request(app).get("/api/agi/situation/world-event/health").expect(401);
    const response = await request(app)
      .get("/api/agi/situation/world-event/health")
      .set("Authorization", "Bearer dev-local-token")
      .expect(200);
    expect(response.body).toMatchObject({
      ok: true,
      service: "helix-world-event-ingest",
    });
  }, 15000);

  it("appends a toolObservation item when thread context is present", async () => {
    const app = await createApp();
    const [event] = readFixture("nether-low-health.jsonl");

    const response = await request(app)
      .post("/api/agi/situation/world-event?thread_id=thread:mc&turn_id=turn:mc")
      .send(event)
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      appended: true,
      thread_id: "thread:mc",
      turn_id: "turn:mc",
    });
    const events = getHelixThreadLedgerEvents({ threadId: "thread:mc" });
    expect(events.some((entry) => entry.observation_ref?.schema === "helix.standby_thread_observation.v1")).toBe(
      true,
    );
    const observation = events.slice().reverse().find(
      (entry) =>
        entry.observation_ref?.schema === "helix.standby_thread_observation.v1" &&
        Array.isArray(entry.observation_ref.semantic_events),
    )
      ?.observation_ref as
      | {
          semantic_events?: Array<{ schema: string; tags: string[] }>;
          narration_receipts?: Array<{ schema: string; text: string }>;
          predictions?: Array<{ schema: string; predicted_goal: string }>;
          episodes?: Array<{ schema: string; episode_type: string }>;
          episode_narrations?: Array<{ schema: string; text: string }>;
          interjection_decision?: string;
        }
      | undefined;
    expect(observation?.semantic_events?.[0]).toMatchObject({
      schema: "helix.situation_semantic_event.v1",
      tags: expect.arrayContaining(["risk"]),
    });
    expect(observation?.narration_receipts?.[0]).toMatchObject({
      schema: "helix.situation_narration_receipt.v1",
    });
    expect(observation?.predictions?.[0]).toMatchObject({
      schema: "helix.situation_prediction.v1",
      predicted_goal: "survive immediate danger",
    });
    expect(observation?.episodes?.[0]).toMatchObject({
      schema: "helix.situation_episode.v1",
      episode_type: "combat_risk",
    });
    expect(observation?.episode_narrations?.[0]).toMatchObject({
      schema: "helix.situation_episode_narration.v1",
    });
    expect(observation?.interjection_decision).toBe("text_callout");
    expect(events.some((entry) => entry.item_type === "answer")).toBe(false);
  }, 15000);

  it("can warn on a creeper precursor before damage when the plugin emits one", async () => {
    const event: HelixWorldEvent = {
      schema: "helix.world_event.v1",
      world_id: "minecraft:minehut",
      room_id: "room:minecraft-minehut",
      source_id: "source:minecraft-server",
      ts: "2026-05-07T12:10:00.000Z",
      actor_id: "player:datdampig",
      actor_label: "DatDamPig",
      event_type: "creeper_fuse_started",
      location: { dimension: "minecraft:overworld", x: 10, y: 69, z: 10 },
      entities: [{ entity_type: "minecraft:creeper", distance: 2.5 }],
      evidence_refs: ["mc:creeper:fuse"],
      meta: { hostile_nearby: true, entity_type: "minecraft:creeper" },
    };

    const result = await ingestWorldEvent(event, { appendToThread: false });

    expect(result.salience_receipt).toMatchObject({
      reason: "risk_detected",
      priority: "warn",
      should_notify_helix: true,
    });
    expect(result.interjection_proposal?.text).toContain("nearby Minecraft threat");
  });

  it("reports source id mismatch when an existing source binding uses different plugin ids", async () => {
    const app = await createApp();
    const [event] = readFixture("nether-low-health.jsonl");

    await request(app)
      .post("/api/agi/situation/thread-binding")
      .send({
        room_id: event.room_id,
        source_id: "source:local-ui-generated",
        world_id: "minecraft:local",
        thread_id: "thread:mismatch",
        mode: "standby_receipts",
        append_policy: "salient_only",
      })
      .expect(200);

    const response = await request(app).post("/api/agi/situation/world-event").send(event).expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      appended: false,
      reason: "source_id_mismatch",
      debug: {
        append_reason: "source_id_mismatch",
        salience_class: "salience_candidate",
        binding_resolution: {
          reason: "source_id_mismatch",
          active_binding_count: 1,
        },
      },
    });
    expect(getHelixThreadLedgerEvents({ threadId: "thread:mismatch" })).toHaveLength(0);
  }, 15000);

  it("reports spatial fidelity diagnostics for block events without usable geometry", async () => {
    const event: HelixWorldEvent = {
      schema: "helix.world_event.v1",
      world_id: "minecraft:minehut",
      room_id: "room:minecraft-minehut",
      source_id: "source:minecraft-server",
      ts: "2026-05-13T23:00:00.000Z",
      actor_id: "minecraft:player:datdampig",
      actor_label: "DatDamPig",
      event_type: "block_broken",
      location: { dimension: "minecraft:overworld", x: 10.25, y: 63.8, z: -4.4 },
      evidence_refs: ["mc:spatial:bad-fidelity"],
      meta: { block_type: "minecraft:stone" },
    };

    const result = await ingestWorldEvent(event, { appendToThread: false });

    expect(result.minecraft_spatial_event).toBeNull();
    expect(result.debug?.quality?.spatial_fidelity).toMatchObject({
      is_spatial_edit: true,
      geometry_usable: false,
      missing: ["exact_block_coordinates"],
    });
  });
});
