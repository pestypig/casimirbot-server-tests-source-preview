import express from "express";
import request from "supertest";
import { beforeEach, expect, it } from "vitest";
import { buildHelixAccountCapabilityPolicy } from "@shared/helix-account-session";
import { getPool } from "../../db/client";
import { RoomOwnerNodeAttachmentStore } from "../../services/shared-live-room-control/owner-node-attachment-store";
import { HostedInterpreterKeyChallengeService } from "../../services/shared-live-room-control/hosted-interpreter-key-challenge";
import { HostedInterpreterMcpLeaseService } from "../../services/shared-live-room-control/hosted-interpreter-mcp-lease";
import { HostedInterpreterTurnClaimService } from "../../services/shared-live-room-control/hosted-interpreter-turn-claim";
import { HostedInterpreterTurnOutcomeService } from "../../services/shared-live-room-control/hosted-interpreter-turn-outcome";
import type { HelixAgentApiPrincipal } from "../../services/helix-agent-api/types";
import { admitRoomInterpreterTurnContext } from "../../services/helix-ask/realtime-room/room-store/interpreter-turn-context";
import { NativeSharedLiveRoomConnection } from "../../services/shared-live-room-control/native-room-connection";
import { SharedLiveRoomControlError } from "../../services/shared-live-room-control/service";
import { createSharedRealtimeRoomTestApp, resetSharedRealtimeRoomRouteTestState,
  signInSharedRealtimeRoomTestAgent } from "../../services/helix-ask/realtime-room/__tests__/route-harness";
import { createHelixSharedLiveRoomRouter } from "../helix-shared-live-rooms";

beforeEach(resetSharedRealtimeRoomRouteTestState);

it("carries three linked authors through native hosted turn pickup and inert proposal review", async () => {
  const hosted = createSharedRealtimeRoomTestApp();
  const owner = await signInSharedRealtimeRoomTestAgent({ app: hosted,
    profileId: "profile:hosted-native-owner", displayName: "Owner", accountType: "developer" });
  const guest = await signInSharedRealtimeRoomTestAgent({ app: hosted,
    profileId: "profile:hosted-native-guest", displayName: "Guest A", accountType: "developer" });
  const secondGuest = await signInSharedRealtimeRoomTestAgent({ app: hosted,
    profileId: "profile:hosted-native-second-guest", displayName: "Guest B", accountType: "developer" });
  for (const actor of [owner, guest, secondGuest]) {
    const subject = `subject:${actor.profileId}`;
    await getPool().query(`INSERT INTO helix_account_linked_providers
      (provider, provider_subject, profile_id) VALUES ('auth0',$1,$2)`, [subject, actor.profileId]);
    await getPool().query(`INSERT INTO helix_agent_account_bindings
      (issuer, tenant_id, provider, provider_subject, profile_id)
      VALUES ('https://issuer.test','tenant:composed','auth0',$1,$2)`, [subject, actor.profileId]);
  }
  const roomId = (await owner.agent.post("/api/agi/realtime/rooms")
    .send({ title: "Composed hosted conversation", capacity_profile: "three_human_text" }).expect(201)).body.room.room_id as string;
  const invite = await owner.agent.post(`/api/agi/realtime/rooms/${roomId}/invites`).expect(201);
  await guest.agent.post("/api/agi/realtime/rooms/join")
    .send({ invite_code: invite.body.invite_code }).expect(200);
  const secondInvite = await owner.agent.post(`/api/agi/realtime/rooms/${roomId}/invites`).expect(201);
  await secondGuest.agent.post("/api/agi/realtime/rooms/join")
    .send({ invite_code: secondInvite.body.invite_code }).expect(200);
  const prepared = (await owner.agent.post(`/api/agi/realtime/rooms/${roomId}/interpreter-session`)
    .send({}).expect(201)).body.session;

  const ownerToken = "synthetic-owner-oauth-token", guestToken = "synthetic-guest-oauth-token";
  const secondGuestToken = "synthetic-second-guest-oauth-token";
  const bearerProfiles = new Map([[ownerToken, owner.profileId], [guestToken, guest.profileId],
    [secondGuestToken, secondGuest.profileId]]);
  const principal = (profileId: string): HelixAgentApiPrincipal => ({ tenantId: "tenant:composed",
    issuer: "https://issuer.test", subjectId: `subject:${profileId}`, accountProfileId: profileId,
    accountType: "developer", trustedDeveloperProfile: true,
    scopes: new Set(["helix.rooms.read", "helix.rooms.manage"]),
    tokenExpiresAt: "2099-01-01T00:00:00Z", accountContext: {
      session_id: `oauth:${profileId}`, profile_id: profileId, trusted_account_session: true,
      account_session: null, account_policy: buildHelixAccountCapabilityPolicy("developer"),
    } });
  const origin = "https://rooms.test";
  hosted.use("/api/v1/rooms", createHelixSharedLiveRoomRouter({ rateLimit: false,
    enforceTransportSecurity: false, authenticate: async req => {
      const profileId = bearerProfiles.get(req.get("Authorization")?.replace(/^Bearer /, "") ?? "");
      if (!profileId) throw new SharedLiveRoomControlError(401, "unauthorized", "Sign in required.");
      return principal(profileId);
    }, ownerNodeAttachmentStore: new RoomOwnerNodeAttachmentStore({ authority: () => origin }),
    interpreterKeyChallenges: new HostedInterpreterKeyChallengeService({ authority: () => origin }),
    interpreterMcpLeases: new HostedInterpreterMcpLeaseService({ authority: () => origin }),
    interpreterTurnClaims: new HostedInterpreterTurnClaimService({ authority: () => origin }),
    interpreterTurnOutcomes: new HostedInterpreterTurnOutcomeService({ authority: () => origin }) }));

  const transport = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const parsed = new URL(String(url)); expect(parsed.origin).toBe(origin);
    const path = `${parsed.pathname}${parsed.search}`;
    const method = (init?.method ?? "GET").toUpperCase();
    const pending = method === "POST" ? request(hosted).post(path) : request(hosted).get(path);
    new Headers(init?.headers).forEach((value, name) => { pending.set(name, value); });
    if (init?.body) pending.send(String(init.body));
    const result = await pending;
    return new Response(JSON.stringify(result.body), { status: result.status,
      headers: { "Content-Type": "application/json" } });
  };
  const makeConnection = () => new NativeSharedLiveRoomConnection({ origin, fetch: transport,
    verifier: { audience: () => `${origin}/mcp`, authorizationServer: () => "https://issuer.test",
      providerAlias: () => "auth0", verify: async () => ({ issuer: "https://issuer.test",
        subject: "subject", tenantId: "tenant:composed",
        scopes: new Set(["helix.rooms.read", "helix.rooms.manage"]),
        expiresAt: "2099-01-01T00:00:00Z", claims: {} }) } });
  const ownerConnection = makeConnection(), guestConnection = makeConnection(), secondGuestConnection = makeConnection();
  const ownerAccount = { profileId: owner.profileId, sessionId: owner.sessionId };
  const guestAccount = { profileId: guest.profileId, sessionId: guest.sessionId };
  const secondGuestAccount = { profileId: secondGuest.profileId, sessionId: secondGuest.sessionId };
  await ownerConnection.connect(ownerAccount, ownerToken);
  await guestConnection.connect(guestAccount, guestToken);
  await secondGuestConnection.connect(secondGuestAccount, secondGuestToken);
  const ownerStatus = await ownerConnection.readInterpreterStatus(ownerAccount, roomId);
  const guestStatus = await guestConnection.readInterpreterStatus(guestAccount, roomId);
  const secondGuestStatus = await secondGuestConnection.readInterpreterStatus(secondGuestAccount, roomId);
  expect(ownerStatus.session).toEqual(guestStatus.session);
  expect(ownerStatus.session).toEqual(secondGuestStatus.session);
  expect(ownerStatus.session).toMatchObject({ interpreter_session_id: prepared.interpreter_session_id,
    shared_ai_active: false, provider_calls: 0 });
  await ownerConnection.reserveOwnerNode(ownerAccount, roomId, null, "hosted-three-author-node-001");
  const selectedKey = await ownerConnection.selectHostedInterpreterKey(ownerAccount, roomId,
    prepared.interpreter_session_id, prepared.generation);
  expect(selectedKey).toMatchObject({ provider_calls: 0, shared_ai_active: false,
    session: { state: "configured", generation: prepared.generation + 1 } });
  const configured = (await ownerConnection.readInterpreterStatus(ownerAccount, roomId)).session!;
  const ownerSent = await ownerConnection.sendTextMessage(ownerAccount, roomId, {
    client_message_id: "room-text:33333333-3333-4333-8333-333333333333",
    text: "Owner proposal for shared review" });
  const sent = await guestConnection.sendTextMessage(guestAccount, roomId, {
    client_message_id: "room-text:11111111-1111-4111-8111-111111111111",
    text: "Guest A to room, no model call" });
  expect(sent).toMatchObject({ model_input: false, task_handoff: false,
    message: { room_id: roomId, text: "Guest A to room, no model call" } });
  const secondSent = await secondGuestConnection.sendTextMessage(secondGuestAccount, roomId, {
    client_message_id: "room-text:22222222-2222-4222-8222-222222222222",
    text: "Guest B correction, still no model call" });
  expect(secondSent).toMatchObject({ model_input: false, task_handoff: false,
    message: { room_id: roomId, text: "Guest B correction, still no model call" } });
  const unreleased = await ownerConnection.sendTextMessage(ownerAccount, roomId, {
    client_message_id: "room-text:44444444-4444-4444-8444-444444444444",
    text: "Owner room note that was not released" });
  const observed = await ownerConnection.listTextMessages(ownerAccount, roomId);
  expect(observed.messages).toEqual([ownerSent.message, sent.message, secondSent.message, unreleased.message]);
  expect(observed).toMatchObject({ room: { room_id: roomId }, model_input: false,
    task_handoff: false, answer_authority: false });
  expect((await secondGuestConnection.listTextMessages(secondGuestAccount, roomId)).messages)
    .toEqual([ownerSent.message, sent.message, secondSent.message, unreleased.message]);
  const guestRelease = await guestConnection.changeOwnTextRelease(guestAccount, roomId, {
    message_id: sent.message.message_id, interpreter_session_id: configured.interpreter_session_id,
    generation: configured.generation, action: "release" });
  expect(guestRelease.release).toMatchObject({ message_id: sent.message.message_id, state: "released" });
  await expect(secondGuestConnection.changeOwnTextRelease(secondGuestAccount, roomId, {
    message_id: sent.message.message_id, interpreter_session_id: configured.interpreter_session_id,
    generation: configured.generation, action: "release" }))
    .rejects.toMatchObject({ code: "room_not_found" });
  const ownerRelease = await ownerConnection.changeOwnTextRelease(ownerAccount, roomId, {
    message_id: ownerSent.message.message_id, interpreter_session_id: configured.interpreter_session_id,
    generation: configured.generation, action: "release" });
  const secondGuestRelease = await secondGuestConnection.changeOwnTextRelease(secondGuestAccount, roomId, {
    message_id: secondSent.message.message_id, interpreter_session_id: configured.interpreter_session_id,
    generation: configured.generation, action: "release" });
  expect((await ownerConnection.listOwnTextReleases(ownerAccount, roomId)).releases)
    .toEqual([ownerRelease.release]);
  expect((await secondGuestConnection.listOwnTextReleases(secondGuestAccount, roomId)).releases)
    .toEqual([secondGuestRelease.release]);
  expect((await guestConnection.listOwnTextReleases(guestAccount, roomId)).releases)
    .toEqual([guestRelease.release]);
  const turnRequest = await secondGuestConnection.requestHostedInterpreterTurn(secondGuestAccount, roomId, {
    interpreter_session_id: configured.interpreter_session_id, generation: configured.generation,
    trigger_message_id: secondSent.message.message_id,
    client_request_id: "room-ai-turn:55555555-5555-4555-8555-555555555555" });
  expect(turnRequest).toMatchObject({ model_input: false, provider_calls: 0,
    turn: { state: "queued", trigger_message_id: secondSent.message.message_id } });
  const admitted = await admitRoomInterpreterTurnContext({ roomId,
    requesterProfileId: secondGuest.profileId,
    interpreterSessionId: configured.interpreter_session_id,
    generation: configured.generation, triggerMessageId: secondSent.message.message_id });
  expect(admitted.messages.map(message => [message.text, message.author_participant_id, message.author_role]))
    .toEqual([
      [ownerSent.message.text, ownerSent.message.author_participant_id, "owner"],
      [sent.message.text, sent.message.author_participant_id, "participant"],
      [secondSent.message.text, secondSent.message.author_participant_id, "participant"],
    ]);
  expect(JSON.stringify(admitted)).not.toContain(unreleased.message.text);
  const reviewed = await ownerConnection.previewHostedInterpreterTurn(ownerAccount, roomId,
    turnRequest.turn.request_id);
  expect(reviewed).toMatchObject({ context_current: true, model_input: false,
    provider_calls: 0, task_handoff: false, turn: {
      request_id: turnRequest.turn.request_id, context_sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      messages: admitted.messages.map(message => ({ message_id: message.message_id,
        text: message.text })) } });
  expect(JSON.stringify(reviewed)).not.toContain(unreleased.message.text);
  await expect(guestConnection.previewHostedInterpreterTurn(guestAccount, roomId,
    turnRequest.turn.request_id)).rejects.toMatchObject({ code: "room_forbidden" });
  const lease = await ownerConnection.issueHostedInterpreterMcpLease(ownerAccount, roomId,
    configured.interpreter_session_id, configured.generation);
  const claimed = await ownerConnection.claimHostedInterpreterTurn(ownerAccount, roomId,
    turnRequest.turn.request_id, lease);
  expect(claimed.provider_calls).toBe(0);
  expect(claimed.turn.messages).toEqual(admitted.messages);
  expect((await ownerConnection.preflightHostedInterpreterTurn(ownerAccount, roomId,
    turnRequest.turn.request_id, lease.lease_id, claimed.claim_expires_at)))
    .toMatchObject({ context_current: true, model_input: false, provider_calls: 0 });
  const fixtureReply = "Fixture reply that incorporates the two guest corrections.";
  const recorded = await ownerConnection.recordHostedInterpreterOutcome(ownerAccount, roomId,
    turnRequest.turn.request_id, lease.lease_id,
    { kind: "completed", text: fixtureReply, providerSessionId: "agent_session_fixture" });
  expect(recorded).toMatchObject({ state: "completed", mission_authority: false,
    program_action: false, reply: { text: fixtureReply } });
  const proposalSource = await ownerConnection.inspectHostedInterpreterProposalSource(ownerAccount,
    roomId, turnRequest.turn.request_id);
  expect(proposalSource).toMatchObject({ source_current: true, proposal_queued: false,
    source: { request_id: turnRequest.turn.request_id,
      trigger_message_id: secondSent.message.message_id,
      trigger_author_participant_id: secondSent.message.author_participant_id,
      reply_text: fixtureReply },
    answer_authority: false, terminal_eligible: false });
  // The prior owner-only preview correctly disconnected the guest's native
  // connection on 403; a fresh verified connection is required for voice.
  await guestConnection.connect(guestAccount, guestToken);
  for (const [connection, account] of [
    [ownerConnection, ownerAccount], [guestConnection, guestAccount],
    [secondGuestConnection, secondGuestAccount],
  ] as const) {
    expect(await connection.changeHostedVoiceConsent(account, roomId, true))
      .toMatchObject({ microphone_to_room: true, audio_connected: false });
  }
  const voiceOwner = await ownerConnection.admitHostedVoice(ownerAccount, roomId);
  await guestConnection.admitHostedVoice(guestAccount, roomId);
  const voiceThird = await secondGuestConnection.admitHostedVoice(secondGuestAccount, roomId);
  const voiceRoom = (await owner.agent.get(`/api/agi/realtime/rooms/${roomId}`).expect(200)).body.room;
  const ownerVoiceId = voiceRoom.self_participant_id as string;
  const secondGuestVoiceId = voiceRoom.participants.find((person: { display_name: string }) =>
    person.display_name === "Guest B").participant_id as string;
  expect(voiceThird).toMatchObject({ call_id: voiceOwner.call_id,
    admissions: expect.arrayContaining([
      expect.objectContaining({ participant_id: ownerVoiceId }),
    ]), audio_connected: false, model_input: false });
  expect(voiceThird.admissions).toHaveLength(3);
  const signalRequest = {
    call_id: voiceOwner.call_id, target_participant_id: ownerVoiceId,
    client_signal_id: "f94a8c34-2efa-40b0-a36f-2c084494b275",
    negotiation_id: "hosted-guest-b-to-owner", kind: "offer",
    description: { type: "offer", sdp: "v=0\r\nidentity-preserving-offer" },
  };
  const signal = await secondGuestConnection.publishHostedVoiceSignal(secondGuestAccount,
    roomId, signalRequest);
  expect(await secondGuestConnection.publishHostedVoiceSignal(secondGuestAccount,
    roomId, signalRequest)).toEqual(signal);
  const received = await ownerConnection.listHostedVoiceSignals(ownerAccount, roomId,
    voiceOwner.call_id!, null);
  expect(received.signals).toMatchObject([{
    signal_id: signal.signal_id, sender_participant_id: secondGuestVoiceId,
    target_participant_id: ownerVoiceId,
  }]);
  await secondGuestConnection.changeHostedVoiceConsent(secondGuestAccount, roomId, false);
  expect((await ownerConnection.listHostedVoiceSignals(ownerAccount, roomId,
    voiceOwner.call_id!, null)).signals).toEqual([]);
  guestConnection.disconnect();
  await expect(guestConnection.listTextMessages(guestAccount, roomId)).rejects.toMatchObject({
    code: "room_connection_required" });
  expect((await ownerConnection.listTextMessages(ownerAccount, roomId)).messages)
    .toEqual([ownerSent.message, sent.message, secondSent.message, unreleased.message]);
  expect((await secondGuestConnection.listTextMessages(secondGuestAccount, roomId)).messages)
    .toEqual([ownerSent.message, sent.message, secondSent.message, unreleased.message]);
});
