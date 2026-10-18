import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createSharedRealtimeRoomTestApp, resetSharedRealtimeRoomRouteTestState,
  signInSharedRealtimeRoomTestAgent } from "./route-harness";

const message = () => `room-text:${crypto.randomUUID()}`;

describe("author-only room text release", () => {
  beforeEach(resetSharedRealtimeRoomRouteTestState);

  it("binds one author's message to one generation without sending model input", async () => {
    const app = createSharedRealtimeRoomTestApp();
    const owner = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:release-owner", displayName: "Dan", accountType: "developer" });
    const guest = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:release-guest", displayName: "Sam", accountType: "developer" });
    const outsider = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:release-outsider", displayName: "Other", accountType: "developer" });
    const publicUser = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:release-public", displayName: "Public", accountType: "user" });
    const room = (await owner.agent.post("/api/agi/realtime/rooms").send({ title: "Release room" }).expect(201)).body.room;
    const base = `/api/agi/realtime/rooms/${room.room_id}`;
    const invite = await owner.agent.post(`${base}/invites`).expect(201);
    await guest.agent.post("/api/agi/realtime/rooms/join").send({ invite_code: invite.body.invite_code }).expect(200);
    const session = (await owner.agent.post(`${base}/interpreter-session`).send({}).expect(201)).body.session;
    const ownerMessage = (await owner.agent.post(`${base}/text-messages`).send({ client_message_id: message(), text: "Owner message" }).expect(201)).body.message;
    const guestMessage = (await guest.agent.post(`${base}/text-messages`).send({ client_message_id: message(), text: "Guest message" }).expect(201)).body.message;
    const selector = { interpreter_session_id: session.interpreter_session_id, generation: session.generation };
    await owner.agent.post(`${base}/text-releases`).send({ ...selector, message_id: guestMessage.message_id, action: "release" }).expect(404);
    await guest.agent.post(`${base}/text-releases`).send({ ...selector, message_id: ownerMessage.message_id, action: "release" }).expect(404);
    await outsider.agent.get(`${base}/text-releases`).expect(404);
    await publicUser.agent.get(`${base}/text-releases`).expect(403);
    const otherRoom = (await owner.agent.post("/api/agi/realtime/rooms").send({ title: "Different room" }).expect(201)).body.room;
    const otherSession = (await owner.agent.post(`/api/agi/realtime/rooms/${otherRoom.room_id}/interpreter-session`).send({}).expect(201)).body.session;
    await owner.agent.post(`/api/agi/realtime/rooms/${otherRoom.room_id}/text-releases`).send({
      interpreter_session_id: otherSession.interpreter_session_id, generation: otherSession.generation,
      message_id: ownerMessage.message_id, action: "release",
    }).expect(404);
    const first = await guest.agent.post(`${base}/text-releases`).send({ ...selector, message_id: guestMessage.message_id, action: "release" }).expect(200);
    expect(first.body).toMatchObject({ model_input: false, provider_calls: 0,
      release: { state: "released", consent_revision: 1, author_participant_id: guestMessage.author_participant_id,
        interpreter_session_id: session.interpreter_session_id, model_input: false, provider_calls: 0 } });
    const retry = await guest.agent.post(`${base}/text-releases`).send({ ...selector, message_id: guestMessage.message_id, action: "release" }).expect(200);
    expect(retry.body.release.release_id).toBe(first.body.release.release_id);
    expect((await owner.agent.get(`${base}/text-releases`).expect(200)).body.releases).toEqual([]);
    expect((await guest.agent.get(`${base}/text-releases`).expect(200)).body.releases).toHaveLength(1);
    const revoked = await guest.agent.post(`${base}/text-releases`).send({ ...selector, message_id: guestMessage.message_id, action: "revoke" }).expect(200);
    expect(revoked.body.release).toMatchObject({ state: "revoked", consent_revision: 2 });
    await guest.agent.post(`${base}/text-releases`).send({ ...selector, message_id: guestMessage.message_id, action: "release" }).expect(409);
    await owner.agent.delete(`${base}/interpreter-session`).send(selector).expect(200);
    const newSession = (await owner.agent.post(`${base}/interpreter-session`).send({}).expect(201)).body.session;
    await guest.agent.post(`${base}/text-releases`).send({ ...selector, message_id: guestMessage.message_id, action: "release" }).expect(409);
    await guest.agent.post(`${base}/text-releases`).send({ interpreter_session_id: newSession.interpreter_session_id,
      generation: newSession.generation, message_id: guestMessage.message_id, action: "release" }).expect(200);
  });

  it("revokes future use on guest departure and owner closure", async () => {
    const app = createSharedRealtimeRoomTestApp();
    const owner = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:release-close-owner", displayName: "Dan", accountType: "developer" });
    const guest = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:release-close-guest", displayName: "Sam", accountType: "developer" });
    const room = (await owner.agent.post("/api/agi/realtime/rooms").send({ title: "Closing release room" }).expect(201)).body.room;
    const base = `/api/agi/realtime/rooms/${room.room_id}`;
    const invite = await owner.agent.post(`${base}/invites`).expect(201);
    await guest.agent.post("/api/agi/realtime/rooms/join").send({ invite_code: invite.body.invite_code }).expect(200);
    const session = (await owner.agent.post(`${base}/interpreter-session`).send({}).expect(201)).body.session;
    const selector = { interpreter_session_id: session.interpreter_session_id, generation: session.generation, action: "release" };
    const ownerMessage = (await owner.agent.post(`${base}/text-messages`).send({ client_message_id: message(), text: "Owner text" }).expect(201)).body.message;
    const guestMessage = (await guest.agent.post(`${base}/text-messages`).send({ client_message_id: message(), text: "Guest text" }).expect(201)).body.message;
    await owner.agent.post(`${base}/text-releases`).send({ ...selector, message_id: ownerMessage.message_id }).expect(200);
    await guest.agent.post(`${base}/text-releases`).send({ ...selector, message_id: guestMessage.message_id }).expect(200);
    await guest.agent.post(`${base}/leave`).expect(200);
    expect((await owner.agent.get(`${base}/text-releases`).expect(200)).body.releases[0].state).toBe("released");
    await owner.agent.post(`${base}/leave`).expect(200);
    expect((await owner.agent.get(`${base}/text-releases`).expect(200)).body.releases[0].state).toBe("revoked");
  });

  it("revokes a release when the interpreter preparation is removed", async () => {
    const app = createSharedRealtimeRoomTestApp();
    const owner = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:release-remove", displayName: "Dan", accountType: "developer" });
    const room = (await owner.agent.post("/api/agi/realtime/rooms").send({ title: "Removal room" }).expect(201)).body.room;
    const base = `/api/agi/realtime/rooms/${room.room_id}`;
    const session = (await owner.agent.post(`${base}/interpreter-session`).send({}).expect(201)).body.session;
    const authored = (await owner.agent.post(`${base}/text-messages`).send({ client_message_id: message(), text: "Release then remove" }).expect(201)).body.message;
    const selector = { interpreter_session_id: session.interpreter_session_id, generation: session.generation };
    await owner.agent.post(`${base}/text-releases`).send({ ...selector, message_id: authored.message_id, action: "release" }).expect(200);
    await owner.agent.delete(`${base}/interpreter-session`).send(selector).expect(200);
    expect((await owner.agent.get(`${base}/text-releases`).expect(200)).body.releases[0])
      .toMatchObject({ state: "revoked", consent_revision: 2 });
  });
});
