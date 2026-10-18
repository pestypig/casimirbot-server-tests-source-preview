import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migration080 } from "../../../db/migrations/080_operator_activity_ledger";
import {
  HELIX_OPERATOR_ACTIVITY_EVENT_SCHEMA,
  type HelixOperatorActivityEvent,
} from "@shared/helix-operator-activity";
import {
  HelixOperatorActivityStore,
  HelixOperatorActivityStoreError,
} from "../operator-activity-store";

const OWNER = { tenantId: "tenant:one", accountProfileId: "account:one" };
const OTHER_OWNER = { tenantId: "tenant:other", accountProfileId: "account:other" };
const STREAM = {
  streamRef: "operator_activity_stream:one",
  profileRef: "profile:one",
  nodeRef: "node:one",
};

const event = (index: number, runId = "run:one"): HelixOperatorActivityEvent => ({
  schema: HELIX_OPERATOR_ACTIVITY_EVENT_SCHEMA,
  activity_event_id: `operator_activity:${runId}:${index}`,
  projection_sequence: 0,
  source_kind: "environment_event",
  source_schema: "helix.environment_event.v1",
  source_event_ref: `environment_event:${runId}:${index}`,
  profile_ref: STREAM.profileRef,
  node_ref: STREAM.nodeRef,
  oauth_client_ref: "oauth_client:one",
  client_session_ref: "client_session:one",
  provider_thread_ref: "provider_thread:one",
  provider_thread_epoch: "provider_thread_epoch:one",
  run_id: runId,
  turn_id: null,
  capability_call_ref: null,
  environment_binding_ref: "environment_binding:one",
  room_ref: "room:one",
  source_ref: "source:one",
  world_ref: "world:one",
  workflow_ref: null,
  effect_lease_ref: null,
  terminal_product_ref: null,
  event_kind: "observation",
  lifecycle_stage: "environment_observed",
  outcome: "pending",
  summary: `Environment observation ${index}.`,
  evidence_refs: [`evidence:${index}`],
  occurred_at: "2026-09-01T20:00:00.000Z",
  observed_at: "2026-09-01T20:00:01.000Z",
  provenance: "measured",
  redaction_state: "sanitized",
  visibility: "profile",
  content_role: "operator_activity_not_assistant_answer",
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
});

describe("HelixOperatorActivityStore", () => {
  let pool: Pool;
  let persist: ReturnType<typeof vi.fn>;
  let store: HelixOperatorActivityStore;

  beforeEach(async () => {
    const memory = newDb();
    const pg = memory.adapters.createPg();
    pool = new pg.Pool() as unknown as Pool;
    const client = await pool.connect();
    try {
      await migration080.run(client, { enablePgvector: false });
    } finally {
      client.release();
    }
    persist = vi.fn().mockResolvedValue(undefined);
    store = new HelixOperatorActivityStore({ pool, persist });
  });

  it("reads only the recent integrity-checked tail for a live HUD", async () => {
    await store.append({ owner: OWNER, stream: STREAM,
      events: Array.from({ length: 31 }, (_, index) => event(index)) });
    const recent = await store.listRecent({ owner: OWNER, stream: STREAM, limit: 5 });
    expect(recent.events.map(item => item.projection_sequence)).toEqual([26, 27, 28, 29, 30]);
    expect(recent.afterSequence).toBe(30);
    await expect(store.listRecent({ owner: OTHER_OWNER, stream: STREAM, limit: 5 }))
      .rejects.toMatchObject({ code: "activity_stream_owner_mismatch" });
  });

  it("reads Responses decisions only for the exact owner, chat and binding epoch", async () => {
    const responses = (index: number, chat: string, bindingEpoch: number): HelixOperatorActivityEvent => ({
      ...event(index), activity_event_id: `operator_activity:responses:${index}`,
      source_kind: "responses_action", source_schema: "environment.responses_actor_activity.v1",
      source_event_ref: `responses_event:${index}`,
      helix_conversation_ref: chat, reasoning_binding_ref: "binding:one",
      reasoning_binding_epoch: bindingEpoch, provider_thread_ref: null,
      provider_thread_epoch: null, summary: "Responses selected walk_to_waypoint. No action started.",
      visibility: "profile", redaction_state: "sanitized",
    });
    await store.append({ owner: OWNER, stream: STREAM,
      events: [responses(1, "chat:one", 2), responses(2, "chat:other", 2),
        responses(3, "chat:one", 3)] });
    const exact = await store.listRecentResponsesForBinding({ owner: OWNER,
      profileRef: STREAM.profileRef, helixConversationRef: "chat:one",
      bindingRef: "binding:one", bindingEpoch: 2, runId: "run:one" });
    expect(exact.map(item => item.source_event_ref)).toEqual(["responses_event:1"]);
    expect(await store.listRecentResponsesForBinding({ owner: OTHER_OWNER,
      profileRef: STREAM.profileRef, helixConversationRef: "chat:one",
      bindingRef: "binding:one", bindingEpoch: 2, runId: "run:one" })).toEqual([]);
  });

  it("persists and retrieves more than fifteen ordered events after restart", async () => {
    const source = Array.from({ length: 24 }, (_, index) => event(index));
    const appended = await store.append({ owner: OWNER, stream: STREAM, events: source });
    expect(appended.events.map((entry) => entry.projection_sequence)).toEqual(
      Array.from({ length: 24 }, (_, index) => index),
    );
    const restarted = new HelixOperatorActivityStore({ pool, persist });
    const full = await restarted.list({
      owner: OWNER,
      stream: STREAM,
      runId: "run:one",
      providerThreadRef: "provider_thread:one",
      providerThreadEpoch: "provider_thread_epoch:one",
      limit: 100,
    });
    expect(full.events).toHaveLength(24);
    expect(full.summary.first_sequence).toBe(0);
    expect(full.summary.last_sequence).toBe(23);
    expect(full.complete_for_query).toBe(true);
    expect(full.answer_authority).toBe(false);
  });

  it("pages monotonically with an exact-scope cursor", async () => {
    await store.append({
      owner: OWNER,
      stream: STREAM,
      events: Array.from({ length: 24 }, (_, index) => event(index)),
    });
    const first = await store.list({
      owner: OWNER,
      stream: STREAM,
      runId: "run:one",
      providerThreadRef: "provider_thread:one",
      providerThreadEpoch: "provider_thread_epoch:one",
      limit: 10,
    });
    expect(first.events).toHaveLength(10);
    expect(first.has_more).toBe(true);
    expect(first.next_cursor?.after_sequence).toBe(9);
    const second = await store.list({
      owner: OWNER,
      stream: STREAM,
      runId: "run:one",
      providerThreadRef: "provider_thread:one",
      providerThreadEpoch: "provider_thread_epoch:one",
      cursor: first.next_cursor,
      limit: 10,
    });
    expect(second.events[0].projection_sequence).toBe(10);
    await expect(
      store.list({
        owner: OWNER,
        stream: STREAM,
        runId: "run:other",
        providerThreadRef: "provider_thread:one",
        providerThreadEpoch: "provider_thread_epoch:one",
        cursor: first.next_cursor,
      }),
    ).rejects.toMatchObject({ code: "activity_cursor_scope_mismatch" });
  });

  it("deduplicates exact replay without consuming another sequence", async () => {
    const source = [event(0), event(1)];
    const first = await store.append({ owner: OWNER, stream: STREAM, events: source });
    const replay = await store.append({ owner: OWNER, stream: STREAM, events: source });
    expect(first.replayed).toEqual([false, false]);
    expect(replay.replayed).toEqual([true, true]);
    expect(replay.events.map((entry) => entry.projection_sequence)).toEqual([0, 1]);
    const next = await store.append({ owner: OWNER, stream: STREAM, events: [event(2)] });
    expect(next.events[0].projection_sequence).toBe(2);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("rejects conflicting replay content and another owner", async () => {
    await store.append({ owner: OWNER, stream: STREAM, events: [event(0)] });
    await expect(
      store.append({
        owner: OWNER,
        stream: STREAM,
        events: [{ ...event(0), summary: "Conflicting content." }],
      }),
    ).rejects.toMatchObject({ code: "activity_event_identity_conflict" });
    await expect(
      store.list({ owner: OTHER_OWNER, stream: STREAM }),
    ).rejects.toBeInstanceOf(HelixOperatorActivityStoreError);
    await expect(
      store.list({ owner: OTHER_OWNER, stream: STREAM }),
    ).rejects.toMatchObject({ code: "activity_stream_owner_mismatch" });
  });

  it("filters exact run and thread scope without renumbering the stream", async () => {
    await store.append({
      owner: OWNER,
      stream: STREAM,
      events: [event(0, "run:one"), event(0, "run:two"), event(1, "run:one")],
    });
    const filtered = await store.list({
      owner: OWNER,
      stream: STREAM,
      runId: "run:one",
      providerThreadRef: "provider_thread:one",
      providerThreadEpoch: "provider_thread_epoch:one",
      limit: 100,
    });
    expect(filtered.events.map((entry) => entry.projection_sequence)).toEqual([0, 2]);
    expect(filtered.events.every((entry) => entry.run_id === "run:one")).toBe(true);
  });

  it("discovers only streams owned by the exact profile", async () => {
    await store.append({ owner: OWNER, stream: STREAM, events: [event(0)] });
    const streams = await store.listStreams({
      owner: OWNER,
      profileRef: STREAM.profileRef,
    });
    expect(streams.streams).toEqual([
      expect.objectContaining({
        stream_ref: STREAM.streamRef,
        profile_ref: STREAM.profileRef,
        node_ref: STREAM.nodeRef,
        event_count: 1,
        next_sequence: 1,
      }),
    ]);
    await expect(store.listStreams({
      owner: OTHER_OWNER,
      profileRef: STREAM.profileRef,
    })).resolves.toMatchObject({ streams: [] });
  });
});
