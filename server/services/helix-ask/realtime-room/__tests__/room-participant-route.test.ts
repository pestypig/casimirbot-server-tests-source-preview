import { beforeEach, describe, expect, it } from "vitest";
import {
  createReadySharedRealtimeRoom,
  createSharedRealtimeRoomTestApp,
  resetSharedRealtimeRoomRouteTestState,
  signInSharedRealtimeRoomTestAgent,
} from "./route-harness";

describe("Shared Realtime room participant routes", () => {
  beforeEach(async () => {
    await resetSharedRealtimeRoomRouteTestState();
  });

  it("lets each account change only its own grants and treats away as not ready", async () => {
    const app = createSharedRealtimeRoomTestApp();
    const owner = await signInSharedRealtimeRoomTestAgent({
      app,
      profileId: "profile:consent-owner",
      displayName: "Consent Owner",
    });
    const guest = await signInSharedRealtimeRoomTestAgent({
      app,
      profileId: "profile:consent-guest",
      displayName: "Consent Guest",
    });
    const roomId = await createReadySharedRealtimeRoom({
      owner,
      guest,
      title: "Consent ownership",
    });
    const initial = await owner.agent.get(`/api/agi/realtime/rooms/${roomId}`).expect(200);
    const guestParticipant = initial.body.room.participants.find(
      (participant: { role: string }) => participant.role === "participant",
    );

    await owner.agent
      .patch(`/api/agi/realtime/rooms/${roomId}/consent`)
      .send({
        participant_id: guestParticipant.participant_id,
        profile_id: guest.profileId,
        consent: { screen_to_model: true },
      })
      .expect(200);
    const observed = await guest.agent.get(`/api/agi/realtime/rooms/${roomId}`).expect(200);
    const ownerProjection = observed.body.room.participants.find(
      (participant: { role: string }) => participant.role === "owner",
    );
    const guestProjection = observed.body.room.participants.find(
      (participant: { role: string }) => participant.role === "participant",
    );
    expect(ownerProjection.consent.screen_to_model).toBe(true);
    expect(guestProjection.consent.screen_to_model).toBe(false);

    const away = await guest.agent
      .post(`/api/agi/realtime/rooms/${roomId}/presence`)
      .send({ presence: "away", participant_id: ownerProjection.participant_id })
      .expect(200);
    expect(away.body.room.readiness.ready).toBe(false);
    expect(away.body.room.participants.find(
      (participant: { role: string }) => participant.role === "owner",
    ).presence).toBe("present");
  });

  it("degrades after a participant leaves and closes when the owner leaves", async () => {
    const app = createSharedRealtimeRoomTestApp();
    const owner = await signInSharedRealtimeRoomTestAgent({
      app,
      profileId: "profile:leave-owner",
      displayName: "Leave Owner",
    });
    const guest = await signInSharedRealtimeRoomTestAgent({
      app,
      profileId: "profile:leave-guest",
      displayName: "Leave Guest",
    });
    const roomId = await createReadySharedRealtimeRoom({
      owner,
      guest,
      title: "Leave lifecycle",
    });
    await owner.agent
      .post(`/api/agi/realtime/rooms/${roomId}/runtime/reserve`)
      .send({ model: "gpt-realtime-2.1" })
      .expect(200);

    await guest.agent.post(`/api/agi/realtime/rooms/${roomId}/leave`).expect(200);
    const degraded = await owner.agent.get(`/api/agi/realtime/rooms/${roomId}`).expect(200);
    expect(degraded.body.room.runtime.state).toBe("degraded");

    const closed = await owner.agent
      .post(`/api/agi/realtime/rooms/${roomId}/leave`)
      .expect(200);
    expect(closed.body.room?.status ?? "closed").toBe("closed");
  });
});
