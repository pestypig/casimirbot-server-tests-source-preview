import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { HelixWorldEvent } from "@shared/helix-world-event";
import { HELIX_ROOM_SOURCE_ADMISSION_SCHEMA, type HelixRoomSourceAdmission } from "@shared/helix-room-source-ingress";
import {
  __resetHelixThreadLedgerStore,
  getHelixThreadLedgerEvents,
} from "../services/helix-thread/ledger";
import {
  resetLiveContinuationRunnerForTest,
} from "../services/situation-room/live-continuation-runner";
import {
  ingestWorldEvent,
  resetWorldEventIngestState,
} from "../services/situation-room/world-event-ingest";
import {
  createSituationThreadBinding,
  resetSituationThreadBindings,
} from "../services/situation-room/thread-binding-store";
import {
  resetLiveContinuationJobsForTest,
  upsertLiveContinuationJob,
} from "../services/situation-room/live-continuation-job-store";

const riskEvent = (): HelixWorldEvent => ({
  schema: "helix.world_event.v1",
  world_id: "minecraft:minehut",
  room_id: "room:minecraft:continuation",
  source_id: "source:minecraft-server",
  ts: "2026-06-02T02:30:00.000Z",
  actor_id: "player:datdampig",
  actor_label: "DatDamPig",
  event_type: "player_damage",
  location: { dimension: "minecraft:overworld", x: 10, y: 52, z: -10, light: 4 },
  health_delta: { current_health: 4, previous_health: 10, damage: 6, reason: "hostile damage near lava" },
  entities: [{ type: "zombie", distance: 4 }],
  evidence_refs: ["mc:continuation:risk:1"],
  meta: { hostile_nearby: true, server_id: "server:paper" },
});

const locationEvent = (): HelixWorldEvent => ({
  schema: "helix.world_event.v1",
  world_id: "minecraft:minehut",
  room_id: "room:minecraft:continuation",
  source_id: "source:minecraft-server",
  ts: "2026-06-02T02:31:00.000Z",
  actor_id: "player:datdampig",
  actor_label: "DatDamPig",
  event_type: "player_location_sample",
  location: { dimension: "minecraft:overworld", x: 12, y: 52, z: -12, light: 12 },
  evidence_refs: ["mc:continuation:location:1"],
  meta: { server_id: "server:paper" },
});

const sourceDisconnectedEvent = (): HelixWorldEvent => ({
  schema: "helix.world_event.v1",
  world_id: "minecraft:minehut",
  room_id: "room:minecraft:continuation",
  source_id: "source:minecraft-server",
  ts: "2026-06-02T02:32:00.000Z",
  actor_id: "server:paper",
  actor_label: "Minecraft server",
  event_type: "source_disconnected",
  text: "Minecraft world-event source disconnected.",
  evidence_refs: ["mc:continuation:source-disconnected:1"],
  meta: { server_id: "server:paper" },
});

const admittedSource = (event: HelixWorldEvent): HelixRoomSourceAdmission => ({
  schema: HELIX_ROOM_SOURCE_ADMISSION_SCHEMA, transport: "room_source_ingress",
  binding_id: "binding:continuation-fixture", request_id: "request:continuation-fixture",
  room_id: event.room_id, world_id: event.world_id, source_id: event.source_id!,
  domain_adapter: "minecraft.paper_plugin.v1", evidence_refs: event.evidence_refs ?? [],
  content_role: "source_admission_not_assistant_answer", reentry_required: true, model_invoked: false,
  answer_authority: false, assistant_answer: false, terminal_eligible: false, raw_content_included: false,
});

describe("world-event ingest live continuation hook", () => {
  beforeEach(() => {
    __resetHelixThreadLedgerStore();
    resetWorldEventIngestState();
    resetSituationThreadBindings();
    resetLiveContinuationJobsForTest();
    resetLiveContinuationRunnerForTest();
  });

  it("appends live continuation tick and side receipts as non-terminal tool observations", async () => {
    const threadId = `thread:continuation-hook:${randomUUID()}`;
    createSituationThreadBinding({
      room_id: "room:minecraft:continuation",
      source_id: "source:minecraft-server",
      world_id: "minecraft:minehut",
      thread_id: threadId,
      mode: "standby_receipts",
      append_policy: "salient_only",
    });
    upsertLiveContinuationJob({
      thread_id: threadId,
      room_id: "room:minecraft:continuation",
      source_ids: ["source:minecraft-server"],
      objective: "Watch my Minecraft run and flag danger or progress.",
      voice_policy: "confirm_speak_required",
      now: "2026-06-02T02:29:59.000Z",
    });

    const result = await ingestWorldEvent(riskEvent(), { sourceAdmission: admittedSource(riskEvent()) });
    const completed = getHelixThreadLedgerEvents({ threadId }).filter(
      (event) => event.event_type === "item_completed",
    );
    const kinds = completed.map((event) => event.meta?.kind);
    const tickEvent = completed.find((event) => event.meta?.kind === "live_continuation_tick");

    expect(result.live_continuation_tick).toMatchObject({
      schema: "helix.live_continuation_tick.v1",
      status: "completed",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      post_tool_model_step_required: true,
    });
    expect(result.live_continuation_worker_receipts?.map((receipt) => receipt.lane)).toEqual(
      expect.arrayContaining(["world_state", "risk_watch", "route_watch", "prediction_reflection", "voice_gate"]),
    );
    expect(result.live_continuation_goal_evaluation).toMatchObject({
      schema: "helix.goal_evaluation_receipt.v1",
      terminal_eligible: false,
    });
    expect(result.live_continuation_callout_candidate).toMatchObject({
      schema: "helix.callout_candidate.v1",
      terminal_eligible: false,
      delivery: "voice_proposal",
      blocked_reason: "confirm_speak_required",
      context_role: "observation_not_assistant_answer",
    });
    expect(kinds).toEqual(expect.arrayContaining([
      "live_continuation_tick",
      "worker_lane_receipt",
      "goal_evaluation_receipt",
      "callout_candidate",
    ]));
    expect(tickEvent?.item_type).toBe("toolObservation");
    expect(tickEvent?.observation_ref).toMatchObject({
      provenance: "live_continuation_runner",
      context_role: "receipt_not_assistant_answer",
      safe_for_future_context: true,
      assistant_answer: false,
      terminal_eligible: false,
    });
  });

  it("keeps a source without admission unknown rather than enabling voice", async () => {
    const threadId = `thread:continuation-unadmitted:${randomUUID()}`;
    createSituationThreadBinding({ room_id: "room:minecraft:continuation", source_id: "source:minecraft-server",
      world_id: "minecraft:minehut", thread_id: threadId, mode: "standby_receipts", append_policy: "salient_only" });
    upsertLiveContinuationJob({ thread_id: threadId, room_id: "room:minecraft:continuation",
      source_ids: ["source:minecraft-server"], objective: "Observe risk.", voice_policy: "automatic_when_policy_allows" });
    const result = await ingestWorldEvent(riskEvent());
    expect(result.live_continuation_callout_candidate).toMatchObject({ blocked_reason: "source_unknown",
      terminal_eligible: false, assistant_answer: false });
  });

  it("updates route context for location samples without appending callout candidates", async () => {
    const threadId = `thread:continuation-location:${randomUUID()}`;
    createSituationThreadBinding({
      room_id: "room:minecraft:continuation",
      source_id: "source:minecraft-server",
      world_id: "minecraft:minehut",
      thread_id: threadId,
      mode: "standby_receipts",
      append_policy: "all_receipts_debug",
    });
    const job = upsertLiveContinuationJob({
      thread_id: threadId,
      room_id: "room:minecraft:continuation",
      source_ids: ["source:minecraft-server"],
      objective: "Watch route context quietly.",
      voice_policy: "automatic_when_policy_allows",
      now: "2026-06-02T02:30:59.000Z",
    });

    const result = await ingestWorldEvent(locationEvent(), { sourceAdmission: admittedSource(locationEvent()) });
    const completed = getHelixThreadLedgerEvents({ threadId }).filter(
      (event) => event.event_type === "item_completed",
    );

    expect(result.live_continuation_tick).toMatchObject({
      job_id: job.job_id,
      status: "completed",
      selected_lanes: expect.arrayContaining(["source_health", "world_state", "route_watch"]),
      callout_candidate_ref: null,
    });
    expect(result.live_continuation_worker_receipts?.map((receipt) => receipt.lane)).toEqual(
      expect.arrayContaining(["source_health", "world_state", "route_watch"]),
    );
    expect(result.live_continuation_callout_candidate).toBeNull();
    expect(completed.map((event) => event.meta?.kind)).not.toContain("callout_candidate");
  });

  it("turns source disconnects into source-health receipts and ask-user direction", async () => {
    const threadId = `thread:continuation-source-health:${randomUUID()}`;
    createSituationThreadBinding({
      room_id: "room:minecraft:continuation",
      source_id: "source:minecraft-server",
      world_id: "minecraft:minehut",
      thread_id: threadId,
      mode: "standby_receipts",
      append_policy: "salient_only",
    });
    upsertLiveContinuationJob({
      thread_id: threadId,
      room_id: "room:minecraft:continuation",
      source_ids: ["source:minecraft-server"],
      objective: "Watch my Minecraft run and flag source health problems.",
      voice_policy: "automatic_when_policy_allows",
      now: "2026-06-02T02:31:59.000Z",
    });

    const result = await ingestWorldEvent(sourceDisconnectedEvent());

    expect(result.live_continuation_tick).toMatchObject({
      schema: "helix.live_continuation_tick.v1",
      status: "completed",
      selected_lanes: expect.arrayContaining(["source_health", "voice_gate"]),
      next_step: "ask_user",
      terminal_eligible: false,
      assistant_answer: false,
    });
    expect(result.live_continuation_worker_receipts?.map((receipt) => receipt.lane)).toEqual(
      expect.arrayContaining(["source_health", "voice_gate"]),
    );
    expect(result.live_continuation_goal_evaluation).toMatchObject({
      status: "ask_user",
      next_step: "ask_user",
      rationale_codes: expect.arrayContaining(["source_stale"]),
      missing_evidence: expect.arrayContaining(["live_source_freshness"]),
      terminal_eligible: false,
    });
    expect(result.live_continuation_callout_candidate).toMatchObject({
      callout_type: "source_health",
      certainty: "unknown",
      delivery: "suppressed",
      blocked_reason: "source_stale",
      assistant_answer: false,
      terminal_eligible: false,
    });
  });
});
