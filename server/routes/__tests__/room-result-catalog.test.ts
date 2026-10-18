import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { buildHelixAccountCapabilityPolicy } from "@shared/helix-account-session";
import { createRoomResultCatalogRouter } from "../room-result-catalog";
import { RoomMissionResultError } from "../../services/local-supervisor/room-mission-result";

const url = "/api/account/session/agent-connections/room-missions/room:one/results";
function fixture() {
  const status = { session: { session_id: "session:one", profile: { profile_id: "profile:one" } },
    account_policy: buildHelixAccountCapabilityPolicy("developer") };
  const member = { role: "owner", presence: "present", roomStatus: "open", participantId: "participant:one" };
  const mission = { mission_id: "mission:one", mission_revision: 2, status: "active",
    owner_profile_id: "profile:one", owner_participant_id: "participant:one" };
  const result = { resultId: "result:one", ownerProfileId: "profile:one", createdAt: "2026-09-24T23:00:00.000Z",
    envelope: { roomId: "room:one", roomMissionId: "mission:one", roomMissionRevision: 2 },
    request: { steeringEventRef: "event:one", status: "unable", resultText: "Private report never in catalog" } };
  const listEventRefs = vi.fn(async () => ["event:one"]);
  const deps = { accountStatus: vi.fn(async () => status), membership: vi.fn(async () => member),
    accountLinks: { listBindings: vi.fn(async () => ({ bindings: [{ status: "active" }] })) },
    missionStore: { inspect: vi.fn(async () => mission), requireCurrent: vi.fn(async () => mission) },
    repository: vi.fn(async () => ({ listEventRefs })), readEvidence: vi.fn(async () => result) };
  const app = express(); app.use("/api/account", createRoomResultCatalogRouter(deps as never));
  return { app, status, member, mission, result, deps, listEventRefs };
}
describe("private owner room-result catalog", () => {
  it("discovers only current authorized receipt metadata, with no model call or report text", async () => {
    const f = fixture(); const response = await request(f.app).get(url).expect(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.results).toEqual([{ result_ref: "result:one", steering_event_ref: "event:one",
      room_id: "room:one", room_mission_id: "mission:one", room_mission_revision: 2,
      status: "unable", created_at: f.result.createdAt }]);
    expect(JSON.stringify(response.body)).not.toContain(f.result.request.resultText);
    expect(f.listEventRefs).toHaveBeenCalledWith({ ownerProfileId: "profile:one", roomId: "room:one",
      missionId: "mission:one", missionRevision: 2 });
    expect(f.deps.missionStore.requireCurrent).toHaveBeenCalledTimes(2);
  });
  it("returns an honest empty state before a mission is selected", async () => {
    const f = fixture(); f.deps.missionStore.inspect.mockResolvedValue(null as never);
    expect((await request(f.app).get(url).expect(200)).body).toMatchObject({ mission: null, results: [] });
    expect(f.listEventRefs).not.toHaveBeenCalled();
  });
  it.each(["signed-out", "user", "locked", "guest", "away", "closed", "unlinked", "revoked", "foreign-owner",
    "foreign-room", "foreign-mission", "foreign-revision", "foreign-event", "foreign-source-owner", "stale-source", "mid-read-revocation"])("denies %s", async kind => {
    const f = fixture();
    if (kind === "signed-out") f.status.session = null as never;
    if (kind === "user") f.status.account_policy = buildHelixAccountCapabilityPolicy("user");
    if (kind === "locked") f.status.account_policy.locked_features.push("shared_realtime_rooms");
    if (kind === "guest") f.member.role = "guest";
    if (kind === "away") f.member.presence = "away";
    if (kind === "closed") f.member.roomStatus = "closed";
    if (kind === "unlinked") f.deps.accountLinks.listBindings.mockResolvedValue({ bindings: [] });
    if (kind === "revoked") f.mission.status = "revoked";
    if (kind === "foreign-owner") f.mission.owner_profile_id = "profile:other";
    if (kind === "foreign-room") f.result.envelope.roomId = "room:other";
    if (kind === "foreign-mission") f.result.envelope.roomMissionId = "mission:other";
    if (kind === "foreign-revision") f.result.envelope.roomMissionRevision++;
    if (kind === "foreign-event") f.result.request.steeringEventRef = "event:other";
    if (kind === "foreign-source-owner") f.result.ownerProfileId = "profile:other";
    if (kind === "stale-source") f.deps.readEvidence.mockRejectedValue(new RoomMissionResultError("room_mission_speaker_authority_revoked", 409));
    if (kind === "mid-read-revocation") f.deps.readEvidence.mockImplementation(async () => { f.mission.status = "revoked"; return f.result; });
    const response = await request(f.app).get(url);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.body.results).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain(f.result.request.resultText);
  });
  it("rejects a changed session before projection", async () => {
    const f = fixture(); f.deps.readEvidence.mockImplementation(async () => {
      f.status.session = { ...f.status.session, session_id: "session:other" }; return f.result;
    });
    await request(f.app).get(url).expect(403);
  });
});
