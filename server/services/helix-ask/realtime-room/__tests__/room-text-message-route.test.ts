import request from "supertest";
import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { readSharedRealtimeRoomDatabase } from "../room-store/database";
import { createSharedRealtimeRoomTestApp, resetSharedRealtimeRoomRouteTestState,
  signInSharedRealtimeRoomTestAgent } from "./route-harness";

const firstId = "room-text:11111111-1111-4111-8111-111111111111";
const secondId = "room-text:22222222-2222-4222-8222-222222222222";

describe("member-only room text conversation", () => {
  beforeEach(resetSharedRealtimeRoomRouteTestState);

  it("preserves solo-host text for an invited guest without starting a model or task", async () => {
    const app = createSharedRealtimeRoomTestApp();
    const owner = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:text-owner", displayName: "Dan" });
    const guest = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:text-guest", displayName: "Sam" });
    const outsider = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:text-other", displayName: "Other" });
    const created = await owner.agent.post("/api/agi/realtime/rooms").send({ title: "Text room" }).expect(201);
    const roomId = created.body.room.room_id as string;
    const path = `/api/agi/realtime/rooms/${roomId}/text-messages`;
    const first = await owner.agent.post(path).send({ client_message_id: firstId, text: "Hello room" }).expect(201);
    expect(first.body).toMatchObject({ schema: "helix.shared_realtime_room.text_message.v1",
      model_input: false, task_handoff: false, message: { text: "Hello room", content_role: "room_member_text",
        answer_authority: false, terminal_eligible: false } });
    expect(created.body.room.runtime.state).toBe("idle");
    await guest.agent.get(path).expect(404);
    await outsider.agent.get(path).expect(404);
    await request(app).get(path).expect(401);

    const invitation = await owner.agent.post(`/api/agi/realtime/rooms/${roomId}/invites`).expect(201);
    await guest.agent.post("/api/agi/realtime/rooms/join").send({ invite_code: invitation.body.invite_code }).expect(200);
    const guestView = await guest.agent.get(path).expect(200);
    expect(guestView.body).toMatchObject({ schema: "helix.shared_realtime_room.text_messages.v1",
      room_id: roomId, model_input: false, task_handoff: false,
      messages: [expect.objectContaining({ message_id: first.body.message.message_id, text: "Hello room" })] });
    await guest.agent.post(path).send({ client_message_id: secondId, text: "I can see it" }).expect(201);
    const ownerView = await owner.agent.get(path).expect(200);
    expect(ownerView.body.messages.map((message: { text: string }) => message.text)).toEqual(["Hello room", "I can see it"]);
    await guest.agent.post(`/api/agi/realtime/rooms/${roomId}/leave`).expect(200);
    await guest.agent.get(path).expect(404);
    await guest.agent.post(path).send({ client_message_id: secondId, text: "I can see it" }).expect(404);
  });

  it("replays an uncertain send once and rejects reuse with changed text", async () => {
    const app = createSharedRealtimeRoomTestApp();
    const owner = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:text-retry-owner", displayName: "Dan" });
    const created = await owner.agent.post("/api/agi/realtime/rooms").send({ title: "Retry room" }).expect(201);
    const path = `/api/agi/realtime/rooms/${created.body.room.room_id}/text-messages`;
    const first = await owner.agent.post(path).send({ client_message_id: firstId, text: "One message" }).expect(201);
    const replay = await owner.agent.post(path).send({ client_message_id: firstId, text: "One message" }).expect(201);
    expect(replay.body.message.message_id).toBe(first.body.message.message_id);
    await owner.agent.post(path).send({ client_message_id: firstId, text: "Different message" }).expect(409);
    const history = await owner.agent.get(path).expect(200);
    expect(history.body.messages).toHaveLength(1);
  });
  it("removes a deleted member's authored room text from the other member's history", async () => {
    const app = createSharedRealtimeRoomTestApp();
    const owner = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:text-deletion-owner", displayName: "Dan" });
    const guest = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:text-deletion-guest", displayName: "Sam" });
    const created = await owner.agent.post("/api/agi/realtime/rooms").send({ title: "Delete room" }).expect(201);
    const roomId = created.body.room.room_id as string;
    const path = `/api/agi/realtime/rooms/${roomId}/text-messages`;
    await owner.agent.post(path).send({ client_message_id: firstId, text: "Owner stays" }).expect(201);
    const invitation = await owner.agent.post(`/api/agi/realtime/rooms/${roomId}/invites`).expect(201);
    await guest.agent.post("/api/agi/realtime/rooms/join").send({ invite_code: invitation.body.invite_code }).expect(200);
    await guest.agent.post(path).send({ client_message_id: secondId, text: "Guest deletes" }).expect(201);
    await guest.agent.delete("/api/account/profile").expect(200);
    const ownerView = await owner.agent.get(path).expect(200);
    expect(ownerView.body.messages.map((message: { text: string }) => message.text)).toEqual(["Owner stays"]);
    await guest.agent.get(path).expect(401);
  });
  it("does not project a stored message whose author belongs to another room",async()=>{
    const app=createSharedRealtimeRoomTestApp();
    const first=await signInSharedRealtimeRoomTestAgent({app,profileId:"profile:text-room-one",displayName:"One"});
    const second=await signInSharedRealtimeRoomTestAgent({app,profileId:"profile:text-room-two",displayName:"Two"});
    const roomOne=(await first.agent.post("/api/agi/realtime/rooms").send({title:"Room one"}).expect(201)).body.room;
    const roomTwo=(await second.agent.post("/api/agi/realtime/rooms").send({title:"Room two"}).expect(201)).body.room;
    const db=await readSharedRealtimeRoomDatabase();
    await db.query(`INSERT INTO helix_shared_realtime_room_text_messages
      (message_id,room_id,participant_id,client_message_id,body)
      VALUES ($1,$2,$3,$4,$5)`,[
      `room_message:${crypto.randomUUID()}`,roomOne.room_id,roomTwo.self_participant_id,
      `room-text:${crypto.randomUUID()}`,"Wrong-room author text",
    ]);
    const response=await first.agent.get(`/api/agi/realtime/rooms/${roomOne.room_id}/text-messages`).expect(200);
    expect(response.body.messages).toEqual([]);
  });
});
