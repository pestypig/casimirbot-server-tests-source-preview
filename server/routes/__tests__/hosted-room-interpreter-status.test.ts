import express from "express";
import request from "supertest";
import { beforeEach, expect, it } from "vitest";
import { buildHelixAccountCapabilityPolicy } from "@shared/helix-account-session";
import { hostedRoomInterpreterStatusSchema } from "@shared/room-interpreter-hosted-status";
import { hostedRoomTextListSchema, hostedRoomTextSendSchema } from "@shared/hosted-room-text";
import type { HelixAgentApiPrincipal } from "../../services/helix-agent-api/types";
import { createSharedRealtimeRoomTestApp, resetSharedRealtimeRoomRouteTestState,
  signInSharedRealtimeRoomTestAgent } from "../../services/helix-ask/realtime-room/__tests__/route-harness";
import { createHelixSharedLiveRoomRouter } from "../helix-shared-live-rooms";
import { SharedLiveRoomControlError } from "../../services/shared-live-room-control/service";
import { buildSharedRealtimeRoomsSessionPolicy } from
  "../../services/helix-account/account-session-store";

beforeEach(resetSharedRealtimeRoomRouteTestState);

it("reads one authoritative room preparation for separately authenticated members only", async () => {
  const app = createSharedRealtimeRoomTestApp();
  const owner = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:hosted-status-owner",
    displayName: "Owner", accountType: "developer" });
  const guest = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:hosted-status-guest",
    displayName: "Guest", accountType: "developer" });
  const roomId = (await owner.agent.post("/api/agi/realtime/rooms")
    .send({ title: "Hosted status" }).expect(201)).body.room.room_id as string;
  const invite = await owner.agent.post(`/api/agi/realtime/rooms/${roomId}/invites`).expect(201);
  await guest.agent.post("/api/agi/realtime/rooms/join")
    .send({ invite_code: invite.body.invite_code }).expect(200);
  const prepared = (await owner.agent.post(`/api/agi/realtime/rooms/${roomId}/interpreter-session`)
    .send({}).expect(201)).body.session;

  const principal = (profileId: string): HelixAgentApiPrincipal => ({ tenantId: "tenant:test",
    issuer: "https://issuer.test", subjectId: `subject:${profileId}`, accountProfileId: profileId,
    accountType: "developer", trustedDeveloperProfile: true,
    scopes: new Set(["helix.rooms.read", "helix.rooms.manage"]),
    tokenExpiresAt: "2099-01-01T00:00:00Z", accountContext: {
      session_id: `oauth:${profileId}`, profile_id: profileId, trusted_account_session: true,
      account_session: null, account_policy: buildHelixAccountCapabilityPolicy("developer"),
    } });
  app.use("/api/v1/rooms", createHelixSharedLiveRoomRouter({ rateLimit: false,
    enforceTransportSecurity: false, authenticate: async req => {
      const token = req.get("Authorization")?.replace(/^Bearer /, "");
      if (![owner.profileId, guest.profileId, "profile:outsider", "user", "no-scope",
        "attenuated-developer"].includes(token ?? ""))
        throw new SharedLiveRoomControlError(401, "unauthorized", "Sign in required.");
      const result = principal(["user", "no-scope", "attenuated-developer"].includes(token ?? "")
        ? guest.profileId : token!);
      if (token === "user" || token === "attenuated-developer") {
        result.accountType = "user";
        result.accountContext.account_policy = buildSharedRealtimeRoomsSessionPolicy("user");
      }
      if (token === "user") result.trustedDeveloperProfile = false;
      if (token === "no-scope") result.scopes.clear();
      return result;
    } }));
  const path = `/api/v1/rooms/${roomId}/interpreter-status`;
  const read = (token: string) => request(app).get(path).set("Authorization", `Bearer ${token}`);
  const ownerStatus = await read(owner.profileId).expect(200);
  const guestStatus = await read(guest.profileId).expect(200);
  expect(hostedRoomInterpreterStatusSchema.parse(ownerStatus.body)).toEqual(guestStatus.body);
  expect(ownerStatus.body).toMatchObject({ room: { room_id: roomId },
    session: { interpreter_session_id: prepared.interpreter_session_id,
      state: "configuration_pending", provider_calls: 0, shared_ai_active: false },
    raw_content_included: false, answer_authority: false });
  expect(ownerStatus.headers["cache-control"]).toContain("no-store");
  await read("profile:outsider").expect(404);
  expect((await read("attenuated-developer").expect(200)).body.session.interpreter_session_id)
    .toBe(prepared.interpreter_session_id);
  await read("user").expect(403);
  await read("no-scope").expect(403);
  await request(app).get(path).expect(401);
  await read(guest.profileId).query({ room_id: roomId }).expect(400);

  const textPath = `/api/v1/rooms/${roomId}/text-messages`;
  const clientMessageId = "room-text:33333333-3333-4333-8333-333333333333";
  const send = () => request(app).post(textPath).set("Authorization", `Bearer ${guest.profileId}`)
    .send({ client_message_id: clientMessageId, text: "A guest's human message" });
  const posted = await send().expect(201);
  expect(hostedRoomTextSendSchema.parse(posted.body)).toMatchObject({ model_input: false,
    task_handoff: false, message: { room_id: roomId, text: "A guest's human message" } });
  expect((await send().expect(201)).body.message.message_id).toBe(posted.body.message.message_id);
  await request(app).post(textPath).set("Authorization", `Bearer ${guest.profileId}`)
    .send({ client_message_id: clientMessageId, text: "Changed message" }).expect(409);
  const ownerText = await request(app).get(textPath).set("Authorization", `Bearer ${owner.profileId}`).expect(200);
  const guestText = await request(app).get(textPath).set("Authorization", `Bearer ${guest.profileId}`).expect(200);
  expect(hostedRoomTextListSchema.parse(ownerText.body)).toEqual(guestText.body);
  expect(ownerText.body.messages).toEqual([posted.body.message]);
  expect(ownerText.headers["cache-control"]).toContain("no-store");
  await request(app).get(textPath).set("Authorization", "Bearer profile:outsider").expect(404);
  await request(app).post(textPath).set("Authorization", "Bearer profile:outsider")
    .send({ client_message_id: "room-text:44444444-4444-4444-8444-444444444444", text: "No access" }).expect(404);
  await request(app).get(textPath).expect(401);
});
