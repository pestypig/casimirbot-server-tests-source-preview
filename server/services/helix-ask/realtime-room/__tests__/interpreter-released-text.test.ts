import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { inspectInterpreterReleasedText } from "../room-store/interpreter-released-text";
import { createSharedRealtimeRoomTestApp, resetSharedRealtimeRoomRouteTestState,
  signInSharedRealtimeRoomTestAgent } from "./route-harness";

describe("shared interpreter released-text projection", () => {
  beforeEach(resetSharedRealtimeRoomRouteTestState);

  it("contains only current, authored releases for one exact room and generation", async () => {
    const app = createSharedRealtimeRoomTestApp();
    const owner = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:context-owner", displayName: "Dan", accountType: "developer" });
    const guest = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:context-guest", displayName: "Sam", accountType: "developer" });
    const room = (await owner.agent.post("/api/agi/realtime/rooms").send({ title: "Context room" }).expect(201)).body.room;
    const base = `/api/agi/realtime/rooms/${room.room_id}`;
    const invitation = await owner.agent.post(`${base}/invites`).expect(201);
    await guest.agent.post("/api/agi/realtime/rooms/join").send({ invite_code: invitation.body.invite_code }).expect(200);
    const session = (await owner.agent.post(`${base}/interpreter-session`).send({}).expect(201)).body.session;
    const send = async (actor: typeof owner, text: string) => (await actor.agent.post(`${base}/text-messages`).send({
      client_message_id: `room-text:${crypto.randomUUID()}`, text }).expect(201)).body.message;
    const ownerText = await send(owner, "Owner released text");
    await send(owner, "Owner private room text");
    const guestText = await send(guest, "Guest released text");
    await send(guest, "Guest private room text");
    const input = { roomId: room.room_id as string, ownerProfileId: owner.profileId,
      interpreterSessionId: session.interpreter_session_id as string, generation: 1 };
    expect((await inspectInterpreterReleasedText(input)).messages).toEqual([]);
    const selector = { interpreter_session_id: session.interpreter_session_id, generation: 1, action: "release" };
    await owner.agent.post(`${base}/text-releases`).send({ ...selector, message_id: ownerText.message_id }).expect(200);
    await guest.agent.post(`${base}/text-releases`).send({ ...selector, message_id: guestText.message_id }).expect(200);
    const projected = await inspectInterpreterReleasedText(input);
    expect(projected).toMatchObject({ room_id: room.room_id, generation: 1, model_input: false,
      dispatch_authority: false, provider_calls: 0, has_earlier_released_messages: false });
    expect(projected.messages.map(item => item.text)).toEqual(["Owner released text", "Guest released text"]);
    expect(projected.messages[1]).toMatchObject({ message_id: guestText.message_id,
      author_participant_id: guestText.author_participant_id, consent_revision: 1 });
    await expect(inspectInterpreterReleasedText({ ...input, ownerProfileId: guest.profileId }))
      .rejects.toMatchObject({ statusCode: 403 });
    await expect(inspectInterpreterReleasedText({ ...input, roomId: "shared_realtime_room:wrong" }))
      .rejects.toMatchObject({ statusCode: 404 });
    await guest.agent.post(`${base}/text-releases`).send({ ...selector, message_id: guestText.message_id, action: "revoke" }).expect(200);
    expect((await inspectInterpreterReleasedText(input)).messages.map(item => item.text)).toEqual(["Owner released text"]);
    await owner.agent.delete(`${base}/interpreter-session`).send({ interpreter_session_id: session.interpreter_session_id,
      generation: 1 }).expect(200);
    await expect(inspectInterpreterReleasedText(input)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("excludes departed authors and rejects room closure", async () => {
    const app = createSharedRealtimeRoomTestApp();
    const owner = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:context-close-owner", displayName: "Dan", accountType: "developer" });
    const guest = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:context-close-guest", displayName: "Sam", accountType: "developer" });
    const room = (await owner.agent.post("/api/agi/realtime/rooms").send({ title: "Leaving room" }).expect(201)).body.room;
    const base = `/api/agi/realtime/rooms/${room.room_id}`;
    const invitation = await owner.agent.post(`${base}/invites`).expect(201);
    await guest.agent.post("/api/agi/realtime/rooms/join").send({ invite_code: invitation.body.invite_code }).expect(200);
    const session = (await owner.agent.post(`${base}/interpreter-session`).send({}).expect(201)).body.session;
    const authored = (await guest.agent.post(`${base}/text-messages`).send({
      client_message_id: `room-text:${crypto.randomUUID()}`, text: "Guest author text" }).expect(201)).body.message;
    await guest.agent.post(`${base}/text-releases`).send({ interpreter_session_id: session.interpreter_session_id,
      generation: 1, message_id: authored.message_id, action: "release" }).expect(200);
    const input = { roomId: room.room_id as string, ownerProfileId: owner.profileId,
      interpreterSessionId: session.interpreter_session_id as string, generation: 1 };
    expect((await inspectInterpreterReleasedText(input)).messages).toHaveLength(1);
    await guest.agent.post(`${base}/leave`).expect(200);
    expect((await inspectInterpreterReleasedText(input)).messages).toEqual([]);
    await owner.agent.post(`${base}/leave`).expect(200);
    await expect(inspectInterpreterReleasedText(input)).rejects.toMatchObject({ statusCode: 409 });
  });
});
