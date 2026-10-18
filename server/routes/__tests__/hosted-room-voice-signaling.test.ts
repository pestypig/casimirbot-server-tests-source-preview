import request from "supertest";
import { beforeEach, expect, it } from "vitest";
import { buildHelixAccountCapabilityPolicy } from "@shared/helix-account-session";
import type { HelixAgentApiPrincipal } from "../../services/helix-agent-api/types";
import { createSharedRealtimeRoomTestApp, resetSharedRealtimeRoomRouteTestState,
  signInSharedRealtimeRoomTestAgent } from
  "../../services/helix-ask/realtime-room/__tests__/route-harness";
import { createHelixSharedLiveRoomRouter } from "../helix-shared-live-rooms";

beforeEach(resetSharedRealtimeRoomRouteTestState);

it("admits three authenticated members for human-only signals and stops delivery after consent revocation", async () => {
  const app = createSharedRealtimeRoomTestApp();
  const actors = await Promise.all(["owner", "guest-a", "guest-b", "outsider"].map(name =>
    signInSharedRealtimeRoomTestAgent({ app, profileId: `profile:voice-${name}`,
      displayName: name, accountType: "developer" })));
  const [owner, guestA, guestB] = actors;
  const bearerProfiles = new Map(actors.map(actor => [`token-${actor.profileId}`, actor.profileId]));
  const principal = (profileId: string): HelixAgentApiPrincipal => ({
    tenantId: "tenant:voice", issuer: "https://issuer.test", subjectId: `subject:${profileId}`,
    accountProfileId: profileId, accountType: "developer", trustedDeveloperProfile: true,
    scopes: new Set(["helix.rooms.read", "helix.rooms.manage"]),
    tokenExpiresAt: "2099-01-01T00:00:00Z", accountContext: {
      session_id: `oauth:${profileId}`, profile_id: profileId, trusted_account_session: true,
      account_session: null, account_policy: buildHelixAccountCapabilityPolicy("developer"),
    },
  });
  app.use("/api/v1/rooms", createHelixSharedLiveRoomRouter({ rateLimit: false,
    enforceTransportSecurity: false, authenticate: async req => {
      const profileId = bearerProfiles.get(req.get("Authorization")?.replace(/^Bearer /u, "") ?? "");
      if (!profileId) throw Error("missing_test_bearer");
      return principal(profileId);
    } }));
  const roomId = (await owner.agent.post("/api/agi/realtime/rooms")
    .send({ title: "Three human voices", capacity_profile: "three_human_text" })
    .expect(201)).body.room.room_id as string;
  for (const guest of [guestA, guestB]) {
    const invite = await owner.agent.post(`/api/agi/realtime/rooms/${roomId}/invites`).expect(201);
    await guest.agent.post("/api/agi/realtime/rooms/join")
      .send({ invite_code: invite.body.invite_code }).expect(200);
  }
  const path = `/api/v1/rooms/${roomId}/voice-signaling`;
  const as = (profileId: string) => ({ Authorization: `Bearer token-${profileId}` });
  const denied = await request(app).post(`${path}/admissions`)
    .set(as(owner.profileId)).send({}).expect(403);
  expect(denied.body.error).toBe("voice_consent_required");
  const ownerConsent = await request(app).post(`${path}/consent`)
    .set(as(owner.profileId)).send({ microphone_to_room: true }).expect(200);
  expect(ownerConsent.body).toMatchObject({ operation: "room.voice.consent",
    microphone_to_room: true, audio_connected: false, model_input: false });
  await request(app).post(`${path}/consent`).set(as(owner.profileId))
    .send({ microphone_to_room: true, microphone_to_model: true }).expect(400);
  for (const actor of [guestA, guestB]) {
    await actor.agent.patch(`/api/agi/realtime/rooms/${roomId}/consent`)
      .send({ consent: { microphone_to_room: true } }).expect(200);
  }
  const admissions = [];
  for (const actor of [owner, guestA, guestB]) {
    admissions.push((await request(app).post(`${path}/admissions`)
      .set(as(actor.profileId)).send({}).expect(200)).body);
  }
  const callId = admissions[0].call_id as string;
  expect(admissions[2]).toMatchObject({ call_id: callId,
    audio_connected: false, model_input: false,
    admissions: expect.arrayContaining([
      expect.objectContaining({ participant_id: admissions[0].admissions[0].participant_id }),
    ]) });
  expect(admissions[2].admissions).toHaveLength(3);
  await request(app).get(path).set(as(actors[3].profileId)).expect(404);
  const room = (await owner.agent.get(`/api/agi/realtime/rooms/${roomId}`).expect(200)).body.room;
  const ownerId = room.self_participant_id as string;
  const guestBId = room.participants.find((person: { display_name: string }) =>
    person.display_name === "guest-b").participant_id as string;
  await request(app).post(`${path}/signals`).set(as(guestB.profileId)).send({
    call_id: callId, target_participant_id: ownerId,
    negotiation_id: "guest-b-owner", kind: "offer",
    description: { type: "offer", sdp: "v=0\r\nprivate-offer" },
  }).expect(200);
  const ownerSignals = await request(app).get(`${path}/signals`)
    .query({ call_id: callId }).set(as(owner.profileId)).expect(200);
  expect(ownerSignals.body.signals).toMatchObject([{
    sender_participant_id: guestBId, target_participant_id: ownerId,
    description: { sdp: "v=0\r\nprivate-offer" },
  }]);
  const guestASignals = await request(app).get(`${path}/signals`)
    .query({ call_id: callId }).set(as(guestA.profileId)).expect(200);
  expect(guestASignals.body.signals).toEqual([]);
  await request(app).post(`${path}/consent`).set(as(guestB.profileId))
    .send({ microphone_to_room: false }).expect(200);
  const afterRevoke = await request(app).get(`${path}/signals`)
    .query({ call_id: callId }).set(as(owner.profileId)).expect(200);
  expect(afterRevoke.body.signals).toEqual([]);
  await request(app).post(`${path}/signals`).set(as(guestB.profileId)).send({
    call_id: callId, target_participant_id: ownerId,
    negotiation_id: "guest-b-owner", kind: "hangup",
  }).expect(409);
});
