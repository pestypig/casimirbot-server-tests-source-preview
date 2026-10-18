import { beforeEach, describe, expect, it } from "vitest";
import {
  HELIX_ROOM_SOURCE_ADMISSION_SCHEMA,
  HELIX_ROOM_SOURCE_NAMESPACE_RESERVED_ERROR,
  type HelixRoomSourceAdmission,
} from "@shared/helix-room-source-ingress";
import type { HelixWorldEvent } from "@shared/helix-world-event";
import type { WorldEventIngestResult } from "../services/situation-room/world-event-ingest";
import {
  resetLiveContinuationJobsForTest,
  upsertLiveContinuationJob,
} from "../services/situation-room/live-continuation-job-store";
import {
  getLiveContinuationRunDebugForTest,
  resetLiveContinuationRunnerForTest,
  runLiveContinuationTick,
} from "../services/situation-room/live-continuation-runner";

const minecraftEvent = (overrides: Partial<HelixWorldEvent> = {}): HelixWorldEvent => ({
  schema: "helix.world_event.v1",
  world_id: "world:overworld",
  room_id: "room:overworld",
  source_id: "source:paper",
  ts: "2026-06-02T02:20:00.000Z",
  actor_id: "player:dan",
  actor_label: "Dan",
  event_type: "player_damage",
  location: { x: 10, y: 52, z: -8, light: 4 },
  health_delta: { from: 12, to: 7, reason: "hostile damage near lava" },
  entities: [{ type: "zombie", distance: 4 }],
  evidence_refs: ["world-event:event:damage"],
  meta: { server_id: "server:paper", profile_id: "profile:dan" },
  ...overrides,
});

const sourceAdmission = (event: HelixWorldEvent): HelixRoomSourceAdmission => ({
  schema: HELIX_ROOM_SOURCE_ADMISSION_SCHEMA,
  transport: "room_source_ingress",
  binding_id: "binding:minecraft-paper",
  request_id: "request:world-event",
  room_id: event.room_id,
  source_id: event.source_id ?? "source:paper",
  world_id: event.world_id,
  domain_adapter: "minecraft.paper_plugin.v1",
  evidence_refs: event.evidence_refs ?? [],
  content_role: "source_admission_not_assistant_answer",
  reentry_required: true,
  model_invoked: false,
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
});

const ingestResult = (event: HelixWorldEvent, overrides: Partial<WorldEventIngestResult> = {}): WorldEventIngestResult => ({
  ok: true,
  schema: "helix.world_event_ingest_response.v1",
  appended: true,
  signal_id: "signal:damage",
  salience_receipt_id: "salience:damage",
  projection_id: "projection:damage",
  goal_hypothesis_ids: ["goal:risk"],
  thread_id: "thread:minecraft",
  message: "World event ingested.",
  event_type: event.event_type,
  source_admission: sourceAdmission(event),
  append_candidate: {
    event,
    eventId: "event:damage",
    threadId: "thread:minecraft",
    roomId: event.room_id,
    worldId: event.world_id,
    sourceId: event.source_id ?? null,
    observationRef: { event_type: event.event_type },
    salienceReason: "damage near hostile entity",
    saliencePriority: "warn",
    evidenceRefs: ["append-candidate:event:damage"],
  },
  episodes: [
    {
      episode_id: "episode:damage",
      room_id: event.room_id,
      world_id: event.world_id,
      summary: "Player took damage near lava and hostile entity.",
      evidence_refs: ["world-event:event:damage"],
    } as never,
  ],
  ...overrides,
});

describe("live continuation runner", () => {
  it("preserves the canonical route-drift evidence ID without adding another prefix", async () => {
    const job = upsertLiveContinuationJob({ thread_id: "thread:minecraft", room_id: "room:overworld",
      source_ids: ["source:paper"], objective: "Observe route changes.", now: "2026-06-02T02:19:59.000Z" });
    const tick = await runLiveContinuationTick({ job, trigger: "world_event",
      worldEventResult: ingestResult(minecraftEvent(), {
        minecraft_route_drift_event: { drift_event_id: "minecraft_route_drift:canonical" } as never,
      }), now: "2026-06-02T02:20:01.000Z" });
    expect(tick.evidence_refs).toContain("minecraft_route_drift:canonical");
    expect(tick.evidence_refs).not.toContain("minecraft_route_drift:minecraft_route_drift:canonical");
    expect(tick).toMatchObject({ assistant_answer: false, terminal_eligible: false });
  });

  beforeEach(() => {
    resetLiveContinuationJobsForTest();
    resetLiveContinuationRunnerForTest();
  });

  it("rejects a protected event source hidden behind a normal append-candidate alias", async () => {
    const job = upsertLiveContinuationJob({
      thread_id: "thread:minecraft",
      room_id: "room:overworld",
      source_ids: ["source:normal"],
      objective: "Observe the current world state.",
    });
    const baseline = ingestResult(minecraftEvent());
    const protectedEvent = minecraftEvent({
      source_id: "source:room-ingress:binding-1",
    });
    const aliasedResult = {
      ...baseline,
      source_admission: null,
      append_candidate: {
        ...baseline.append_candidate!,
        sourceId: "source:normal",
        event: protectedEvent,
      },
    } as WorldEventIngestResult;

    await expect(
      runLiveContinuationTick({
        job,
        trigger: "world_event",
        worldEventResult: aliasedResult,
      }),
    ).rejects.toThrow(HELIX_ROOM_SOURCE_NAMESPACE_RESERVED_ERROR);
  });

  it("rejects conflicting non-room append-candidate and event source identities", async () => {
    const job = upsertLiveContinuationJob({
      thread_id: "thread:minecraft",
      room_id: "room:overworld",
      source_ids: ["source:normal"],
      objective: "Observe the current world state.",
    });
    const baseline = ingestResult(minecraftEvent());
    const aliasedResult = {
      ...baseline,
      source_admission: null,
      append_candidate: {
        ...baseline.append_candidate!,
        sourceId: "source:normal",
        event: minecraftEvent({ source_id: "source:other" }),
      },
    } as WorldEventIngestResult;

    await expect(
      runLiveContinuationTick({
        job,
        trigger: "world_event",
        worldEventResult: aliasedResult,
      }),
    ).rejects.toThrow("live_continuation_source_identity_mismatch");
  });

  it("runs deterministic single-agent lanes for a salient Minecraft world event", async () => {
    const job = upsertLiveContinuationJob({
      thread_id: "thread:minecraft",
      room_id: "room:overworld",
      environment_id: "env:minecraft",
      contract_id: "contract:live",
      source_ids: ["source:paper"],
      objective: "Watch my Minecraft run and flag danger or progress.",
      voice_policy: "confirm_speak_required",
      now: "2026-06-02T02:19:59.000Z",
    });
    const tick = await runLiveContinuationTick({
      job,
      trigger: "world_event",
      worldEventResult: ingestResult(minecraftEvent()),
      now: "2026-06-02T02:20:01.000Z",
    });
    const debug = getLiveContinuationRunDebugForTest(tick.tick_id);

    expect(tick).toMatchObject({
      schema: "helix.live_continuation_tick.v1",
      job_id: job.job_id,
      thread_id: "thread:minecraft",
      room_id: "room:overworld",
      trigger: "world_event",
      status: "completed",
      selected_lanes: expect.arrayContaining([
        "source_health",
        "world_state",
        "risk_watch",
        "route_watch",
        "prediction_reflection",
        "voice_gate",
      ]),
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      post_tool_model_step_required: true,
      context_role: "receipt_not_assistant_answer",
    });
    expect(debug?.admission).toMatchObject({
      source_kind: "minecraft_world_events",
      transport: "room_source_ingress",
      trust_level: "admitted_live_source",
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(debug?.observation).toMatchObject({
      schema: "helix.live_source_event_observation.v1",
      event_type: "player_damage",
      context_role: "observation_not_assistant_answer",
      post_tool_model_step_required: true,
    });
    expect(debug?.workers.find((worker) => worker.lane === "prediction_reflection")).toMatchObject({
      context_role: "hypothesis_not_assistant_answer",
      hypotheses: [expect.objectContaining({ confidence: expect.any(Number) })],
      assistant_answer: false,
    });
    expect(debug?.goal).toMatchObject({
      schema: "helix.goal_evaluation_receipt.v1",
      status: "needs_more_observation",
      context_role: "receipt_not_assistant_answer",
    });
    expect(debug?.callout).toMatchObject({
      schema: "helix.callout_candidate.v1",
      callout_type: "warning",
      delivery: "voice_proposal",
      blocked_reason: "confirm_speak_required",
      certainty: "observed",
      context_role: "observation_not_assistant_answer",
      assistant_answer: false,
      terminal_eligible: false,
    });
  });

  it("enforces voice policy delivery modes and certainty threshold caps", async () => {
    const base = {
      thread_id: "thread:minecraft",
      room_id: "room:overworld",
      environment_id: "env:minecraft",
      source_ids: ["source:paper"],
      objective: "Watch my Minecraft run and flag danger.",
      now: "2026-06-02T02:19:59.000Z",
    };

    const muted = upsertLiveContinuationJob({
      ...base,
      job_id: "job:muted",
      voice_policy: "muted",
    });
    const mutedTick = await runLiveContinuationTick({
      job: muted,
      trigger: "world_event",
      worldEventResult: ingestResult(minecraftEvent()),
      now: "2026-06-02T02:20:01.000Z",
    });
    expect(getLiveContinuationRunDebugForTest(mutedTick.tick_id)?.callout).toMatchObject({
      delivery: "typed_only",
      blocked_reason: "voice_policy_muted",
      certainty: "observed",
    });

    const propose = upsertLiveContinuationJob({
      ...base,
      job_id: "job:propose",
      voice_policy: "propose_only",
    });
    const proposeTick = await runLiveContinuationTick({
      job: propose,
      trigger: "world_event",
      worldEventResult: ingestResult(minecraftEvent()),
      now: "2026-06-02T02:20:02.000Z",
    });
    expect(getLiveContinuationRunDebugForTest(proposeTick.tick_id)?.callout).toMatchObject({
      delivery: "voice_proposal",
      blocked_reason: null,
    });

    const automatic = upsertLiveContinuationJob({
      ...base,
      job_id: "job:auto",
      voice_policy: "automatic_when_policy_allows",
    });
    const automaticTick = await runLiveContinuationTick({
      job: automatic,
      trigger: "salience",
      worldEventResult: ingestResult(minecraftEvent()),
      now: "2026-06-02T02:20:03.000Z",
    });
    expect(getLiveContinuationRunDebugForTest(automaticTick.tick_id)?.callout).toMatchObject({
      delivery: "automatic_spoken",
      blocked_reason: null,
      certainty: "observed",
    });

    const capped = upsertLiveContinuationJob({
      ...base,
      job_id: "job:threshold",
      voice_policy: "automatic_when_policy_allows",
      evidence_threshold: "likely",
    });
    const cappedTick = await runLiveContinuationTick({
      job: capped,
      trigger: "salience",
      worldEventResult: ingestResult(minecraftEvent()),
      now: "2026-06-02T02:20:04.000Z",
    });
    expect(getLiveContinuationRunDebugForTest(cappedTick.tick_id)?.callout).toMatchObject({
      delivery: "automatic_spoken",
      certainty: "likely",
    });

    const coolingDown = upsertLiveContinuationJob({
      ...base,
      job_id: "job:cooldown",
      voice_policy: "automatic_when_policy_allows",
      cooldowns: {
        last_tick_at: "2026-06-02T02:20:00.000Z",
        min_tick_interval_ms: 10_000,
      },
    });
    const coolingDownTick = await runLiveContinuationTick({
      job: coolingDown,
      trigger: "salience",
      worldEventResult: ingestResult(minecraftEvent()),
      now: "2026-06-02T02:20:04.000Z",
    });
    expect(getLiveContinuationRunDebugForTest(coolingDownTick.tick_id)?.callout).toMatchObject({
      delivery: "suppressed",
      blocked_reason: "callout_interval_cooldown",
    });
  });

  it("keeps multiple Minecraft events on the same single-agent job baton", async () => {
    const job = upsertLiveContinuationJob({
      thread_id: "thread:minecraft",
      room_id: "room:overworld",
      source_ids: ["source:paper"],
      objective: "Watch my Minecraft run and flag danger or progress.",
      voice_policy: "propose_only",
    });

    const progressTick = await runLiveContinuationTick({
      job,
      trigger: "world_event",
      worldEventResult: ingestResult(minecraftEvent({
        event_type: "item_acquired",
        health_delta: undefined,
        inventory_delta: { item_id: "minecraft:blaze_rod", count_delta: 1 },
        objective_delta: { status: "progress", goal_label: "collect blaze rods" },
        entities: [],
        evidence_refs: ["world-event:event:progress"],
      }), {
        signal_id: "signal:progress",
        salience_receipt_id: "salience:progress",
        projection_id: "projection:progress",
        goal_hypothesis_ids: ["goal:progress"],
      }),
      now: "2026-06-02T02:20:02.000Z",
    });
    const damageTick = await runLiveContinuationTick({
      job,
      trigger: "world_event",
      worldEventResult: ingestResult(minecraftEvent()),
      now: "2026-06-02T02:20:03.000Z",
    });

    expect(progressTick.job_id).toBe(job.job_id);
    expect(damageTick.job_id).toBe(job.job_id);
    expect(progressTick.selected_lanes).toEqual(expect.arrayContaining(["objective_progress", "world_state"]));
    expect(damageTick.selected_lanes).toEqual(expect.arrayContaining(["risk_watch", "world_state"]));
    expect(getLiveContinuationRunDebugForTest(progressTick.tick_id)?.workers.every((worker) => worker.assistant_answer === false)).toBe(true);
    expect(getLiveContinuationRunDebugForTest(damageTick.tick_id)?.workers.every((worker) => worker.assistant_answer === false)).toBe(true);
  });

  it("updates route context for location samples without producing callout spam", async () => {
    const job = upsertLiveContinuationJob({
      thread_id: "thread:minecraft",
      room_id: "room:overworld",
      source_ids: ["source:paper"],
      objective: "Watch my Minecraft route quietly.",
      voice_policy: "automatic_when_policy_allows",
    });
    const tick = await runLiveContinuationTick({
      job,
      trigger: "world_event",
      worldEventResult: ingestResult(minecraftEvent({
        event_type: "player_location_sample",
        health_delta: undefined,
        entities: [],
        evidence_refs: ["world-event:event:location"],
      }), {
        signal_id: "signal:location",
        salience_receipt_id: null,
        append_candidate: {
          event: minecraftEvent({
            event_type: "player_location_sample",
            health_delta: undefined,
            entities: [],
            evidence_refs: ["world-event:event:location"],
          }),
          eventId: "event:location",
          threadId: "thread:minecraft",
          roomId: "room:overworld",
          worldId: "world:overworld",
          sourceId: "source:paper",
          observationRef: { event_type: "player_location_sample" },
          evidenceRefs: ["append-candidate:event:location"],
        },
      }),
      now: "2026-06-02T02:20:05.000Z",
    });

    expect(tick.selected_lanes).toEqual(expect.arrayContaining(["source_health", "world_state", "route_watch"]));
    expect(tick.selected_lanes).not.toContain("risk_watch");
    expect(tick.callout_candidate_ref).toBeNull();
    expect(getLiveContinuationRunDebugForTest(tick.tick_id)?.callout).toBeNull();
  });

  it("routes disconnected sources to source health and ask-user repair without confident tactical advice", async () => {
    const job = upsertLiveContinuationJob({
      thread_id: "thread:minecraft",
      room_id: "room:overworld",
      source_ids: ["source:paper"],
      objective: "Watch my Minecraft run and flag danger.",
      voice_policy: "automatic_when_policy_allows",
    });
    const tick = await runLiveContinuationTick({
      job,
      trigger: "salience",
      worldEventResult: ingestResult(minecraftEvent({
        event_type: "source_disconnected",
        health_delta: undefined,
        entities: [],
        text: "Minecraft world-event source disconnected.",
        evidence_refs: ["world-event:event:source-disconnected"],
      }), {
        signal_id: "signal:source-disconnected",
        salience_receipt_id: "salience:source-disconnected",
        append_candidate: {
          event: minecraftEvent({
            event_type: "source_disconnected",
            health_delta: undefined,
            entities: [],
            text: "Minecraft world-event source disconnected.",
            evidence_refs: ["world-event:event:source-disconnected"],
          }),
          eventId: "event:source-disconnected",
          threadId: "thread:minecraft",
          roomId: "room:overworld",
          worldId: "world:overworld",
          sourceId: "source:paper",
          observationRef: { event_type: "source_disconnected" },
          salienceReason: "source_health",
          saliencePriority: "warn",
          evidenceRefs: ["append-candidate:event:source-disconnected"],
        },
      }),
      now: "2026-06-02T02:20:06.000Z",
    });
    const debug = getLiveContinuationRunDebugForTest(tick.tick_id);

    expect(debug?.admission).toMatchObject({
      freshness: expect.objectContaining({ status: "stale" }),
      trust_level: "unverified",
    });
    expect(tick.selected_lanes).toEqual(expect.arrayContaining(["source_health", "voice_gate"]));
    expect(debug?.goal).toMatchObject({
      status: "ask_user",
      next_step: "ask_user",
      rationale_codes: expect.arrayContaining(["source_stale"]),
      missing_evidence: expect.arrayContaining(["live_source_freshness"]),
    });
    expect(debug?.callout).toMatchObject({
      callout_type: "source_health",
      certainty: "unknown",
      delivery: "suppressed",
      blocked_reason: "source_stale",
      assistant_answer: false,
      terminal_eligible: false,
    });
  });

  it("suppresses ticks for paused jobs instead of spawning another chat", async () => {
    const job = upsertLiveContinuationJob({
      thread_id: "thread:minecraft",
      room_id: "room:overworld",
      source_ids: ["source:paper"],
      objective: "Watch my Minecraft run.",
      status: "paused",
    });

    const tick = await runLiveContinuationTick({
      job,
      trigger: "world_event",
      worldEventResult: ingestResult(minecraftEvent()),
      now: "2026-06-02T02:20:01.000Z",
    });

    expect(tick.status).toBe("suppressed");
    expect(tick.selected_lanes).toEqual([]);
    expect(tick.worker_receipt_refs).toEqual([]);
    expect(tick.next_step).toBe("silent");
  });

  it("blocks source-mismatched events fail-closed through source admission", async () => {
    const job = upsertLiveContinuationJob({
      thread_id: "thread:minecraft",
      room_id: "room:overworld",
      source_ids: ["source:paper"],
      objective: "Watch my Minecraft run.",
    });
    const event = minecraftEvent({ source_id: "source:other" });
    const tick = await runLiveContinuationTick({
      job,
      trigger: "world_event",
      worldEventResult: ingestResult(event),
      now: "2026-06-02T02:20:01.000Z",
    });
    const debug = getLiveContinuationRunDebugForTest(tick.tick_id);

    expect(tick.status).toBe("blocked");
    expect(tick.selected_lanes).toEqual([]);
    expect(tick.next_step).toBe("fail_closed");
    expect(debug?.admission.trust_level).toBe("blocked");
    expect(debug?.goal.status).toBe("fail_closed");
  });

  it("does not project source-controlled profile aliases without server-owned admission", async () => {
    const job = upsertLiveContinuationJob({
      thread_id: "thread:minecraft",
      room_id: "room:overworld",
      source_ids: ["source:paper"],
      objective: "Watch my Minecraft run.",
    });
    const event = minecraftEvent({
      meta: {
        server_id: "server:paper",
        profile_id: "profile:spoofed",
        linked_profile_id: "profile:linked-spoofed",
        commander_profile_id: "profile:commander-spoofed",
      },
    });
    const tick = await runLiveContinuationTick({
      job,
      trigger: "world_event",
      worldEventResult: ingestResult(event, { source_admission: null }),
      now: "2026-06-02T02:20:01.000Z",
    });
    const admission = getLiveContinuationRunDebugForTest(tick.tick_id)?.admission;

    expect(admission).toMatchObject({
      transport: "unknown",
      trust_level: "unverified",
      source_identity: {
        profile_id: null,
      },
    });
  });
});
