import express from "express";
import { newDb } from "pg-mem";
import request from "supertest";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { migration080 } from "../../db/migrations/080_operator_activity_ledger";
import { normalizeResponsesActionActivity } from
  "../../services/helix-ask/operator-activity-normalizer";
import { HelixOperatorActivityStore, helixOperatorActivityOwnerForProfile } from
  "../../services/helix-ask/operator-activity-store";
import { createOperatorActivityRouter } from "../operator-activity";

const profileRef = "profile:owner";
const chatId = "chat:one";
const binding = { status: "active", reasoning_binding_id: "binding:one",
  binding_epoch: 2, run_id: "run:one" };
const event = normalizeResponsesActionActivity({
  activity: { schema: "environment.responses_actor_activity.v1",
    event_id: "responses_event:one", helix_conversation_id: chatId,
    reasoning_binding_id: binding.reasoning_binding_id,
    binding_epoch: binding.binding_epoch, run_id: binding.run_id,
    goal_id: "goal:one", goal_revision: 1, checkpoint_event_id: "checkpoint:one",
    decision_id: "decision:one", phase: "proposed", action_code: "walk_to_waypoint",
    target_ref: "waypoint:one", reason_code: null,
    observed_at: "2026-10-05T12:00:00.000Z",
    provenance: "verified_responses_actor_boundary", raw_response_included: false,
    private_reasoning_included: false, execution_authority: false,
    action_performed: false, answer_authority: false, terminal_eligible: false },
  profileRef, nodeRef: "node:one", environmentBindingRef: "environment:one",
  roomRef: "room:one", sourceRef: "source:one", worldRef: "world:one",
  projectionSequence: 0,
});

const setup = (overrides?: {
  inspectCurrent?: ReturnType<typeof vi.fn>;
  listRecentResponsesForBinding?: ReturnType<typeof vi.fn>;
  readAdapterResults?: ReturnType<typeof vi.fn>;
  resolveSession?: ReturnType<typeof vi.fn>;
}) => {
  const inspectCurrent = overrides?.inspectCurrent ?? vi.fn(() => binding);
  const listRecentResponsesForBinding = overrides?.listRecentResponsesForBinding ??
    vi.fn(async () => [event]);
  const readAdapterResults = overrides?.readAdapterResults ?? vi.fn(async () => []);
  const resolveSession = overrides?.resolveSession ?? vi.fn(async () => ({
    session_id: "session:owner", profile: { profile_id: profileRef },
  }));
  const unsafeDirectRead = vi.fn(() => { throw new Error("durable preflight required"); });
  const createReasoningAccess = vi.fn(() => ({ inspectCurrent }));
  const app = express();
  app.use("/api/account", createOperatorActivityRouter({
    activityStore: { list: vi.fn(), listStreams: vi.fn(), listRecent: vi.fn(),
      listRecentResponsesForBinding } as never,
    reasoningBindingStore: { inspectCurrent: unsafeDirectRead } as never, resolveSession,
    createReasoningAccess: createReasoningAccess as never,
    readAdapterResults,
  }));
  return { app, inspectCurrent, listRecentResponsesForBinding,
    readAdapterResults, resolveSession, unsafeDirectRead, createReasoningAccess };
};
const path = `/api/account/session/operator-activity/adapter-ai?helix_conversation_id=${chatId}`;
const owned = (app: express.Express) => request(app).get(path)
  .set("Cookie", "helix_session=session:owner");

describe("exact-binding Responses activity route", () => {
  it("returns a persisted choice through the owner-scoped route", async () => {
    const memory = newDb();
    const pg = memory.adapters.createPg();
    const pool = new pg.Pool() as unknown as Pool;
    const client = await pool.connect();
    try { await migration080.run(client, { enablePgvector: false }); }
    finally { client.release(); }
    const store = new HelixOperatorActivityStore({ pool,
      persist: async () => {} });
    await store.append({ owner: helixOperatorActivityOwnerForProfile(profileRef),
      stream: { streamRef: "stream:exact", profileRef, nodeRef: "node:one" },
      events: [event] });
    const { app } = setup({ listRecentResponsesForBinding: vi.fn(
      store.listRecentResponsesForBinding.bind(store)) });
    const response = await owned(app).expect(200);
    expect(response.body.events).toEqual([expect.objectContaining({
      activity_event_id: event.activity_event_id,
      reasoning_binding_ref: binding.reasoning_binding_id,
      reasoning_binding_epoch: binding.binding_epoch,
      run_id: binding.run_id,
    })]);
  });

  it("requires owner session, exact current binding and no-store response", async () => {
    const { app, listRecentResponsesForBinding, unsafeDirectRead, createReasoningAccess } = setup();
    await request(app).get(path).expect(401);
    const result = await owned(app).expect(200);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.body).toMatchObject({
      schema: "helix.adapter_ai_activity_page.v1",
      reasoning_binding_id: "binding:one", binding_epoch: 2, run_id: "run:one",
      events: [{ source_kind: "responses_action", summary: expect.stringContaining("No action started") }],
      private_reasoning_included: false, answer_authority: false,
    });
    expect(listRecentResponsesForBinding).toHaveBeenCalledWith(expect.objectContaining({
      owner: expect.objectContaining({ accountProfileId: profileRef }), profileRef,
      helixConversationRef: chatId, bindingRef: "binding:one",
      bindingEpoch: 2, runId: "run:one", limit: 8,
    }));
    expect(unsafeDirectRead).not.toHaveBeenCalled();
    expect(createReasoningAccess).toHaveBeenCalledTimes(2);
  });

  it("keeps a verified Responses choice visible when native result retrieval fails", async () => {
    const { app } = setup({ readAdapterResults: vi.fn(async () => {
      throw new Error("result database unavailable");
    }) });
    const response = await owned(app).expect(200);
    expect(response.body).toMatchObject({
      reasoning_binding_id: binding.reasoning_binding_id,
      binding_epoch: binding.binding_epoch, run_id: binding.run_id,
      adapter_results_status: "unavailable",
      events: [{ activity_event_id: event.activity_event_id,
        source_kind: "responses_action", answer_authority: false }],
      answer_authority: false,
    });
  });

  it("rejects an absent chat binding without reading the owner stream", async () => {
    const listRecentResponsesForBinding = vi.fn();
    const { app } = setup({ inspectCurrent: vi.fn(() => {
      throw new Error("binding absent");
    }), listRecentResponsesForBinding });
    const response = await owned(app).expect(409);
    expect(response.body.error).toBe("binding_unavailable");
    expect(listRecentResponsesForBinding).not.toHaveBeenCalled();
  });

  it("drops a page when revocation or session change happens during the read", async () => {
    const inspectCurrent = vi.fn()
      .mockReturnValueOnce(binding).mockReturnValueOnce({ ...binding, status: "revoked" });
    const { app } = setup({ inspectCurrent });
    const revoked = await owned(app).expect(409);
    expect(revoked.body.events).toBeUndefined();
    const resolveSession = vi.fn().mockResolvedValueOnce({ session_id: "session:owner",
      profile: { profile_id: profileRef } }).mockResolvedValueOnce(null);
    const second = setup({ resolveSession });
    await owned(second.app).expect(409);
  });

  it("rejects a mismatched stored event rather than leaking another chat", async () => {
    const other = { ...event, helix_conversation_ref: "chat:other" };
    const { app } = setup({ listRecentResponsesForBinding: vi.fn(async () => [other]) });
    const response = await owned(app).expect(500);
    expect(response.body.events).toBeUndefined();
  });
});
