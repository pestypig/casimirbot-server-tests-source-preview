import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { HELIX_OPERATOR_ACTIVITY_CURSOR_SCHEMA } from "@shared/helix-operator-activity";
import { createOperatorActivityRouter } from "../operator-activity";

const selected = {
  missionId: "mission:one", missionRevision: 1, bindingEpoch: 2,
  scope: {
    schema: "helix.environment_mission_activity_scope.v1",
    profile_ref: "profile:one", node_ref: "node:one", run_id: "run:one",
    room_ref: "room:one", environment_binding_ref: "binding:one",
    source_ref: "source:one", world_ref: "world:one",
  },
  actionScope: {
    ownerProfileId: "profile:one", authorityId: "authority:one",
    connectorInstallationId: "node:one", environmentBindingId: "binding:one",
    roomId: "room:one", sourceId: "source:one", worldId: "world:one",
    participantId: "participant:one", subjectBindingId: "subject:one",
  },
  producerEpochRef: "epoch:one",
} as const;
const activityCursor = {
  schema: HELIX_OPERATOR_ACTIVITY_CURSOR_SCHEMA,
  stream_ref: "stream:one", profile_ref: "profile:one", node_ref: "node:one",
  run_id: null, provider_thread_ref: null, provider_thread_epoch: null,
  after_sequence: 10, projection_version: 1,
} as const;
const page = {
  schema: "helix.verified_owner_mission_activity_page.v1",
  run_id: "run:one", projections: [], next_cursor: activityCursor,
  poll_cursor: activityCursor,
  has_more: true, complete_for_query: false,
  content_role: "mission_activity_not_assistant_answer",
  answer_authority: false, assistant_answer: false,
  terminal_eligible: false, raw_content_included: false,
  private_reasoning_included: false, action_authority_granted: false,
} as const;

const fixture = () => {
  const readMissionScope = vi.fn(async () => selected);
  const readMissionPage = vi.fn(async () => page);
  const resolveSession = vi.fn(async () => ({
    session_id: "session:one", profile: { profile_id: "profile:one" },
  }));
  const app = express();
  app.use("/api/account", createOperatorActivityRouter({
    activityStore: { list: vi.fn(), listStreams: vi.fn() } as never,
    resolveSession, readMissionScope, readMissionPage,
  }));
  const get = (cursor?: string) => request(app)
    .get(`/api/account/session/operator-activity/mission-overlay?room_id=room:one${
      cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)
    .set("Cookie", "helix_session=session:one");
  return { get, readMissionScope, readMissionPage, resolveSession };
};

describe("authenticated mission overlay activity route", () => {
  it("requires a session and hides foreign or unavailable mission scope", async () => {
    const f = fixture();
    await request(express().use("/api/account", createOperatorActivityRouter({
      activityStore: { list: vi.fn(), listStreams: vi.fn() } as never,
      resolveSession: f.resolveSession, readMissionScope: f.readMissionScope,
      readMissionPage: f.readMissionPage,
    }))).get("/api/account/session/operator-activity/mission-overlay?room_id=room:one")
      .expect(401);
    f.readMissionScope.mockResolvedValueOnce(null as never);
    const response = await f.get().expect(409);
    expect(response.body.error).toBe("mission_unavailable");
    expect(f.readMissionPage).not.toHaveBeenCalled();
  });

  it("derives the exact owner scope, returns no-store projections and binds the cursor", async () => {
    const f = fixture();
    const response = await f.get().expect(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toMatchObject({
      run_id: "run:one", projections: [], answer_authority: false,
      action_authority_granted: false,
      session_identity: { mission_id: "mission:one", mission_revision: 1,
        binding_epoch: 2, producer_epoch_ref: "epoch:one",
        action_authority_ref: "authority:one", scope: selected.scope },
    });
    expect(typeof response.body.next_cursor).toBe("string");
    expect(typeof response.body.poll_cursor).toBe("string");
    expect(f.readMissionScope).toHaveBeenCalledTimes(2);
    expect(f.readMissionPage).toHaveBeenCalledWith(expect.objectContaining({
      ownerProfileId: "profile:one", selectedScope: selected.scope,
      actionScope: selected.actionScope, expectedProducerEpochRef: "epoch:one",
    }));
    await f.get(response.body.next_cursor).expect(200);
    expect(f.readMissionPage).toHaveBeenLastCalledWith(expect.objectContaining({
      cursor: activityCursor,
    }));
    await f.get(response.body.poll_cursor).expect(200);
  });

  it("rejects a cursor after mission revision changes", async () => {
    const f = fixture();
    const first = await f.get().expect(200);
    f.readMissionScope.mockResolvedValueOnce({ ...selected, missionRevision: 2 });
    const response = await f.get(first.body.next_cursor).expect(403);
    expect(response.body.error).toBe("forbidden");
    expect(f.readMissionPage).toHaveBeenCalledTimes(1);
  });

  it("discards a page if the mission is revoked or reselected during the read", async () => {
    const f = fixture();
    f.readMissionScope.mockResolvedValueOnce(selected)
      .mockResolvedValueOnce({ ...selected, missionRevision: 2 });
    const response = await f.get().expect(409);
    expect(response.body.error).toBe("mission_unavailable");
  });
});
