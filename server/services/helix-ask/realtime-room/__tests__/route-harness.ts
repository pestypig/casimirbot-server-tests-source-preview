import express from "express";
import request from "supertest";
import { accountSessionRouter } from "../../../../routes/account-session";
import { sharedRealtimeRoomRouter } from
  "../../../../routes/agi.realtime-room/index";
import { realtimeSessionRouter } from "../../../../routes/agi.realtime-session";
import { resetAccountSessionStore } from "../../../helix-account/account-session-store";
import {
  installSharedRealtimeRoomBoundSessionLifecycle,
} from "../bound-session-lifecycle";
import { resetSharedRealtimeRoomStore } from "../room-store";
import { resetSharedRealtimeRoomRuntimeRegistryForTests } from "../runtime-registry";
import { resetRealtimeSessionRegistryForTests } from
  "../../realtime-session/session-registry";
import { setRealtimeSidebandControlSenderForTests } from
  "../../realtime-session/sideband-control-channel";
import { resetSharedRealtimeProfileAdmissionLocksForTests } from
  "../profile-admission-lock";

export const createSharedRealtimeRoomTestApp = (): express.Express => {
  const app = express();
  app.use(express.json({ limit: "6mb" }));
  app.use("/api/account", accountSessionRouter);
  // Guard order is part of the one-shared-call contract.
  app.use("/api/agi", sharedRealtimeRoomRouter);
  app.use("/api/agi", realtimeSessionRouter);
  return app;
};

export type SharedRealtimeRoomTestAgent = {
  agent: ReturnType<typeof request.agent>;
  sessionId: string;
  profileId: string;
};

export const signInSharedRealtimeRoomTestAgent = async (input: {
  app: express.Express;
  profileId: string;
  displayName: string;
  accountType?: "developer" | "user";
}): Promise<SharedRealtimeRoomTestAgent> => {
  const agent = request.agent(input.app);
  const response = await agent
    .post("/api/account/session/sign-in")
    .send({
      profile_id: input.profileId,
      display_name: input.displayName,
      ...(input.accountType ? { account_type: input.accountType } : {}),
    })
    .expect(200);
  return {
    agent,
    sessionId: response.body.session.session_id as string,
    profileId: input.profileId,
  };
};

export const resetSharedRealtimeRoomRouteTestState = async (): Promise<void> => {
  setRealtimeSidebandControlSenderForTests(null);
  resetRealtimeSessionRegistryForTests();
  resetSharedRealtimeProfileAdmissionLocksForTests();
  resetSharedRealtimeRoomRuntimeRegistryForTests();
  await resetSharedRealtimeRoomStore();
  await resetAccountSessionStore();
  installSharedRealtimeRoomBoundSessionLifecycle();
};

export const grantRequiredRoomConsent = async (
  agent: SharedRealtimeRoomTestAgent["agent"],
  roomId: string,
) => agent
  .patch(`/api/agi/realtime/rooms/${roomId}/consent`)
  .send({
    consent: {
      microphone_to_room: true,
      microphone_to_model: true,
      transcript_to_room: true,
      model_audio_output: true,
    },
  })
  .expect(200);

export const createReadySharedRealtimeRoom = async (input: {
  owner: SharedRealtimeRoomTestAgent;
  guest: SharedRealtimeRoomTestAgent;
  title: string;
}): Promise<string> => {
  const created = await input.owner.agent
    .post("/api/agi/realtime/rooms")
    .send({ title: input.title })
    .expect(201);
  const roomId = created.body.room.room_id as string;
  const invite = await input.owner.agent
    .post(`/api/agi/realtime/rooms/${roomId}/invites`)
    .expect(201);
  await input.guest.agent
    .post("/api/agi/realtime/rooms/join")
    .send({ invite_code: invite.body.invite_code })
    .expect(200);
  await grantRequiredRoomConsent(input.owner.agent, roomId);
  const ready = await grantRequiredRoomConsent(input.guest.agent, roomId);
  if (ready.body.room.readiness.ready !== true) {
    throw new Error("shared_realtime_room_test_setup_not_ready");
  }
  return roomId;
};
