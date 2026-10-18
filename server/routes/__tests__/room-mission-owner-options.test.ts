import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createAgentConnectionsRouter } from "../agent-connections";
import { HelixReasoningTaskBindingError } from "../../services/local-supervisor/reasoning-task-binding-store";

const target = { reasoning_binding_id: "binding:one", binding_epoch: 1,
  helix_conversation_id: "chat:one", binding_mission_id: null, run_id: null };
const mission = { ...target, room_id: "room:one", owner_profile_id: "owner:one", owner_participant_id: "participant:one",
  mission_id: "mission:one", mission_revision: 2, status: "active" };
function fixture() {
  const session = { session_id: "session:one", profile: { profile_id: "owner:one" } };
  const account = { session, account_policy: { account_type: "developer", feature_flags: ["shared_realtime_rooms"], locked_features: [] } };
  const membership = { role: "owner", presence: "present", roomStatus: "active", participantId: "participant:one" };
  const resolveSession = vi.fn(async () => session);
  const missionAccountStatus = vi.fn(async () => account);
  const readPreparationMembership = vi.fn(async () => membership);
  const listBindings = vi.fn(async () => ({ bindings: [{ status: "active", updated_at: new Date().toISOString() }] }));
  const inspect = vi.fn(async () => mission as typeof mission | null);
  const inspectLatest = vi.fn(async () => ({ ...target, mission_id: null }));
  const resolveOwnedPreparationTarget = vi.fn(async () => ({}));
  const select = vi.fn();
  const app = express();
  app.use("/api/account", createAgentConnectionsRouter({
    resolveSession, missionAccountStatus: missionAccountStatus as never,
    readPreparationMembership: readPreparationMembership as never,
    bindingStore: { listBindings } as never,
    coordinationStore: { serviceInstanceRef: "service:one", listPresence: () => [] },
    reasoningBindingStore: { inspectLatest, resolveOwnedPreparationTarget } as never,
    preparationBindingStore: { resolveOwnedPreparationTarget } as never,
    roomMissionStore: { inspect, select } as never,
  }));
  const get = () => request(app).get("/api/account/session/agent-connections/room-missions/room:one/owner-options")
    .set("Cookie", "helix_session=session:one");
  return { get, app, account, membership, resolveSession, missionAccountStatus, readPreparationMembership,
    listBindings, inspect, inspectLatest, resolveOwnedPreparationTarget, select };
}
describe("private owner mission options", () => {
  it("projects only exact task metadata and checks current ownership twice", async () => {
    const f = fixture(); const result = await f.get().expect(200);
    expect(result.body).toEqual({ schema: "helix.room_mission_owner_catalog.v1", room_id: "room:one",
      mission: { ...target, room_id: "room:one", mission_id: "mission:one", mission_revision: 2, status: "active" },
      candidate: target, candidate_unavailable: false, handoffs: [], execution_authority: false,
      answer_authority: false, raw_content_included: false });
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(f.resolveOwnedPreparationTarget).toHaveBeenCalledWith({ profileRef: "owner:one",
      bindingId: "binding:one", bindingEpoch: 1, helixConversationId: "chat:one", missionId: null, runId: null });
    expect(f.readPreparationMembership).toHaveBeenCalledTimes(2);
    expect(f.select).not.toHaveBeenCalled();
  });
  it("returns no mission for a room that has never selected a task", async () => {
    const f = fixture(); f.inspect.mockResolvedValue(null);
    expect((await f.get().expect(200)).body.mission).toBeNull();
  });
  it("keeps revoked selection revisions and an unavailable task visible for recovery", async () => {
    const f = fixture(); f.inspect.mockResolvedValue({ ...mission, status: "revoked" });
    f.resolveOwnedPreparationTarget.mockRejectedValue(new HelixReasoningTaskBindingError("reasoning_binding_target_inactive", 409));
    expect((await f.get().expect(200)).body).toMatchObject({ mission: { status: "revoked", mission_revision: 2 },
      candidate: null, candidate_unavailable: true });
  });
  it.each(["guest", "absent", "closed", "unlinked", "user", "locked", "foreign", "no_session"])("rejects %s", async kind => {
    const f = fixture();
    if (kind === "guest") f.membership.role = "guest";
    if (kind === "absent") f.membership.presence = "left";
    if (kind === "closed") f.membership.roomStatus = "closed";
    if (kind === "unlinked") f.listBindings.mockResolvedValue({ bindings: [] });
    if (kind === "user") f.account.account_policy.account_type = "user";
    if (kind === "locked") f.account.account_policy.locked_features.push("shared_realtime_rooms" as never);
    if (kind === "foreign") f.inspect.mockResolvedValue({ ...mission, owner_profile_id: "owner:other" });
    if (kind === "no_session") f.resolveSession.mockResolvedValue(null as never);
    const result = await f.get().expect(kind === "no_session" ? 401 : 403);
    expect(result.body.candidate).toBeUndefined();
    expect(f.resolveOwnedPreparationTarget).not.toHaveBeenCalled();
  });
  it("rejects a reselection during discovery", async () => {
    const f = fixture(); f.inspect.mockResolvedValueOnce(mission).mockResolvedValueOnce({ ...mission, mission_revision: 3 });
    expect((await f.get().expect(409)).body.error).toBe("room_mission_not_current");
  });
  it("does not relabel a mission from another room", async () => {
    const f = fixture(); f.inspect.mockResolvedValue({ ...mission, room_id: "room:other" });
    await f.get().expect(403);
    expect(f.resolveOwnedPreparationTarget).not.toHaveBeenCalled();
  });
  it("rejects an owner leaving during discovery", async () => {
    const f = fixture(); f.readPreparationMembership.mockResolvedValueOnce(f.membership).mockResolvedValueOnce({ ...f.membership, presence: "left" });
    await f.get().expect(403);
  });
  it("does not convert an unknown storage fault into an empty candidate", async () => {
    const f = fixture(); f.inspectLatest.mockRejectedValue(new Error("private storage details"));
    const response = await f.get().expect(503);
    expect(JSON.stringify(response.body)).not.toContain("private storage");
  });
  it("does not label an unavailable task service as an absent pairing", async () => {
    const f = fixture(); f.inspectLatest.mockRejectedValue(new HelixReasoningTaskBindingError("reasoning_binding_unavailable", 503));
    const response = await f.get().expect(503);
    expect(response.body.candidate).toBeUndefined();
  });
  it.each(["select", "dispatch-handoff"])("enforces the developer boundary on %s before mutations", async action => {
    const f = fixture(); f.account.account_policy.account_type = "user";
    const result = await request(f.app).post(`/api/account/session/agent-connections/room-missions/${action}`)
      .set("Cookie", "helix_session=session:one").send({}).expect(403);
    expect(result.body.error).toBe("room_mission_developer_required");
    expect(f.select).not.toHaveBeenCalled();
  });
});
