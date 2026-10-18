import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { HELIX_DESKTOP_MCP_ISSUER } from "../../../../auth/helix-desktop-mcp-identity";
import type { HelixAgentApiPrincipal } from "../../../helix-agent-api/types";
import { getAccountSessionById } from "../../../helix-account/account-session-store";
import { readSharedRealtimeRoomDatabase } from "../room-store/database";
import { configureSharedRoomInterpreter,
  enableSharedRoomInterpreterTwoTurnEvaluation } from "../room-store/interpreter-sessions";
import { issueRoomInterpreterMcpLease } from "../room-store/interpreter-mcp-lease";
import { reserveRoomInterpreterEvaluationFirstTurn,
  reserveRoomInterpreterEvaluationCorrection } from "../room-store/interpreter-evaluation-turns";
import { admitRoomInterpreterTurnContext } from "../room-store/interpreter-turn-context";
import { previewQueuedRoomInterpreterTurn } from "../room-store/interpreter-turn-preview";
import { claimRoomInterpreterTurn, finishRoomInterpreterTurn, reserveRoomInterpreterTurn,
  validateClaimedRoomInterpreterTurn, inspectRoomInterpreterProposalSource } from "../room-store/interpreter-turn-requests";
import { createSharedRealtimeRoomTestApp, resetSharedRealtimeRoomRouteTestState,
  signInSharedRealtimeRoomTestAgent } from "./route-harness";

const principal = async (profileId: string, sessionId: string): Promise<HelixAgentApiPrincipal> => {
  const account = await getAccountSessionById(sessionId);
  if (!account) throw Error("account_missing");
  return { tenantId: "desktop:test", issuer: HELIX_DESKTOP_MCP_ISSUER,
    subjectId: profileId, accountProfileId: profileId, accountType: "developer",
    trustedDeveloperProfile: true, mcpClientRef: "desktop_mcp_client:test",
    scopes: new Set(), tokenExpiresAt: null,
    accountContext: { session_id: sessionId, profile_id: profileId,
      trusted_account_session: true, account_session: account,
      account_policy: account.account_policy } };
};

describe("room interpreter dispatch-time source admission", () => {
  beforeEach(resetSharedRealtimeRoomRouteTestState);

  it("admits three distinct text authors only after each releases into the current generation", async () => {
    const app = createSharedRealtimeRoomTestApp();
    const owner = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:three-turn-owner",
      displayName: "Host", accountType: "developer" });
    const guestA = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:three-turn-a",
      displayName: "Guest A", accountType: "developer" });
    const guestB = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:three-turn-b",
      displayName: "Guest B", accountType: "developer" });
    const room = (await owner.agent.post("/api/agi/realtime/rooms")
      .send({ title: "Three-author interpretation", capacity_profile: "three_human_text" }).expect(201)).body.room;
    const base = `/api/agi/realtime/rooms/${room.room_id}`;
    for (const guest of [guestA, guestB]) {
      const invite = await owner.agent.post(`${base}/invites`).expect(201);
      await guest.agent.post("/api/agi/realtime/rooms/join")
        .send({ invite_code: invite.body.invite_code }).expect(200);
    }
    const prepared = (await owner.agent.post(`${base}/interpreter-session`).send({}).expect(201)).body.session;
    const configured = await configureSharedRoomInterpreter({ roomId: room.room_id,
      preparationSessionId: prepared.interpreter_session_id, preparationGeneration: 1,
      nativePrincipal: await principal(owner.profileId, owner.sessionId) });
    const send = async (actor: typeof owner, text: string) => (await actor.agent.post(`${base}/text-messages`)
      .send({ client_message_id: `room-text:${crypto.randomUUID()}`, text }).expect(201)).body.message;
    const hostMessage = await send(owner, "Host plan");
    const correction = await send(guestA, "Guest A correction");
    const disagreement = await send(guestB, "Guest B disagreement");
    await send(owner, "Unreleased host-only note");
    const selector = { interpreter_session_id: configured.interpreter_session_id,
      generation: configured.generation, action: "release" };
    await guestB.agent.post(`${base}/text-releases`)
      .send({ ...selector, message_id: correction.message_id }).expect(404);
    for (const [actor, message] of [[owner, hostMessage], [guestA, correction],
      [guestB, disagreement]] as const) {
      await actor.agent.post(`${base}/text-releases`)
        .send({ ...selector, message_id: message.message_id }).expect(200);
    }
    const input = { roomId: room.room_id as string, requesterProfileId: guestB.profileId,
      interpreterSessionId: configured.interpreter_session_id, generation: configured.generation,
      triggerMessageId: disagreement.message_id };
    const context = await admitRoomInterpreterTurnContext(input);
    expect(context.messages.map(message => [message.text, message.author_participant_id,
      message.author_role]))
      .toEqual([["Host plan", hostMessage.author_participant_id, "owner"],
        ["Guest A correction", correction.author_participant_id, "participant"],
        ["Guest B disagreement", disagreement.author_participant_id, "participant"]]);
    expect(JSON.stringify(context)).not.toContain("Unreleased host-only note");
    await guestA.agent.post(`${base}/leave`).expect(200);
    const afterDeparture = await admitRoomInterpreterTurnContext(input);
    expect(afterDeparture.messages.map(message => message.text))
      .toEqual(["Host plan", "Guest B disagreement"]);
    expect(JSON.stringify(afterDeparture)).not.toContain("Guest A correction");
  });

  it("keeps the two-turn evaluation dormant until an unused three-human configuration opts in", async () => {
    const app = createSharedRealtimeRoomTestApp();
    const owner = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:two-turn-owner",
      displayName: "Host", accountType: "developer" });
    const guestA = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:two-turn-a",
      displayName: "Guest A", accountType: "developer" });
    const guestB = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:two-turn-b",
      displayName: "Guest B", accountType: "developer" });
    const room = (await owner.agent.post("/api/agi/realtime/rooms")
      .send({ title: "Two-turn developer evaluation", capacity_profile: "three_human_text" })
      .expect(201)).body.room;
    const base = `/api/agi/realtime/rooms/${room.room_id}`;
    const prepared = (await owner.agent.post(`${base}/interpreter-session`).send({}).expect(201)).body.session;
    const nativePrincipal = await principal(owner.profileId, owner.sessionId);
    const configured = await configureSharedRoomInterpreter({ roomId: room.room_id,
      preparationSessionId: prepared.interpreter_session_id, preparationGeneration: 1,
      nativePrincipal });
    const selection = { roomId: room.room_id as string,
      interpreterSessionId: configured.interpreter_session_id,
      generation: configured.generation, nativePrincipal };
    await expect(enableSharedRoomInterpreterTwoTurnEvaluation(selection))
      .rejects.toMatchObject({ statusCode: 409 });
    for (const guest of [guestA, guestB]) {
      const invite = await owner.agent.post(`${base}/invites`).expect(201);
      await guest.agent.post("/api/agi/realtime/rooms/join")
        .send({ invite_code: invite.body.invite_code }).expect(200);
    }
    const enabled = await enableSharedRoomInterpreterTwoTurnEvaluation(selection);
    expect(enabled).toMatchObject({ usage_ceiling_turns: 2,
      evaluation_profile: "ar2_two_turn_text", shared_ai_active: false, provider_calls: 0 });
    const db = await readSharedRealtimeRoomDatabase();
    await expect(db.query(`UPDATE helix_shared_room_interpreter_configurations
      SET usage_ceiling_turns = 1 WHERE interpreter_session_id = $1`,
    [configured.interpreter_session_id])).rejects.toThrow();
    await expect(db.query(`UPDATE helix_shared_room_interpreter_configurations
      SET usage_ceiling_turns = 3 WHERE interpreter_session_id = $1`,
    [configured.interpreter_session_id])).rejects.toThrow();
    const message = (await guestA.agent.post(`${base}/text-messages`)
      .send({ client_message_id: `room-text:${crypto.randomUUID()}`,
        text: "First released evaluation prompt" }).expect(201)).body.message;
    await guestA.agent.post(`${base}/text-releases`).send({
      interpreter_session_id: configured.interpreter_session_id,
      generation: configured.generation, message_id: message.message_id,
      action: "release" }).expect(200);
    await expect(admitRoomInterpreterTurnContext({ roomId: room.room_id,
      requesterProfileId: guestA.profileId,
      interpreterSessionId: configured.interpreter_session_id,
      generation: configured.generation, triggerMessageId: message.message_id }))
      .rejects.toMatchObject({ statusCode: 409 });
    const firstInput = { roomId: room.room_id as string,
      requesterProfileId: guestA.profileId,
      interpreterSessionId: configured.interpreter_session_id,
      generation: configured.generation, triggerMessageId: message.message_id,
      clientRequestId: `room-ai-turn:${crypto.randomUUID()}` };
    const first = await reserveRoomInterpreterEvaluationFirstTurn(firstInput);
    expect(first).toMatchObject({ turn_ordinal: 1, first_request_id: null,
      model_input: false, provider_calls: 0 });
    expect((await previewQueuedRoomInterpreterTurn({ roomId: room.room_id,
      requestId: first.request_id, ownerProfileId: owner.profileId })).turn)
      .toMatchObject({ turn_ordinal: 1, messages: [{ text: message.text }] });
    expect((await reserveRoomInterpreterEvaluationFirstTurn(firstInput)).request_id)
      .toBe(first.request_id);
    const lease = await issueRoomInterpreterMcpLease({ roomId: room.room_id,
      interpreterSessionId: configured.interpreter_session_id,
      generation: configured.generation, nativePrincipal });
    await expect(claimRoomInterpreterTurn({ roomId: room.room_id,
      requestId: first.request_id, leaseId: lease.lease_id, nativePrincipal }))
      .rejects.toMatchObject({ statusCode: 409 });
    const correctionMessage = (await guestB.agent.post(`${base}/text-messages`)
      .send({ client_message_id: `room-text:${crypto.randomUUID()}`,
        text: "Guest B corrects the first interpretation" }).expect(201)).body.message;
    await guestB.agent.post(`${base}/text-releases`).send({
      interpreter_session_id: configured.interpreter_session_id,
      generation: configured.generation, message_id: correctionMessage.message_id,
      action: "release" }).expect(200);
    const secondInput = { ...firstInput, requesterProfileId: guestB.profileId,
      firstRequestId: first.request_id, triggerMessageId: correctionMessage.message_id,
      clientRequestId: `room-ai-turn:${crypto.randomUUID()}` };
    await expect(reserveRoomInterpreterEvaluationCorrection(secondInput))
      .rejects.toMatchObject({ statusCode: 409 });
    const hash = crypto.createHash("sha256").update("first-result").digest("hex");
    await db.query(`UPDATE helix_shared_room_interpreter_turn_requests
      SET state='completed', result_text='first-result', result_sha256=$2,
        provider_session_id='session_first', claimed_lease_id=$3, finished_at=now()
      WHERE request_id=$1`, [first.request_id, hash, lease.lease_id]);
    expect(await inspectRoomInterpreterProposalSource({ roomId: room.room_id,
      requestId: first.request_id, ownerProfileId: owner.profileId }))
      .toMatchObject({ request_id: first.request_id, trigger_text: message.text,
        reply_text: "first-result", result_sha256: hash });
    const second = await reserveRoomInterpreterEvaluationCorrection(secondInput);
    expect(second).toMatchObject({ turn_ordinal: 2, first_request_id: first.request_id,
      requested_by_participant_id: correctionMessage.author_participant_id,
      model_input: false, provider_calls: 0 });
    const secondPreview = await previewQueuedRoomInterpreterTurn({ roomId: room.room_id,
      requestId: second.request_id, ownerProfileId: owner.profileId });
    expect(secondPreview.turn).toMatchObject({ turn_ordinal: 2,
      messages: [{ text: message.text }, { text: correctionMessage.text }] });
    expect((await reserveRoomInterpreterEvaluationCorrection(secondInput)).request_id)
      .toBe(second.request_id);
    await expect(reserveRoomInterpreterEvaluationCorrection({ ...secondInput,
      clientRequestId: `room-ai-turn:${crypto.randomUUID()}` }))
      .rejects.toMatchObject({ statusCode: 409 });
    const correctionResult = "corrected-result";
    const correctionHash = crypto.createHash("sha256").update(correctionResult).digest("hex");
    await db.query(`UPDATE helix_shared_room_interpreter_evaluation_corrections
      SET state='completed', result_text=$2, result_sha256=$3, finished_at=now()
      WHERE request_id=$1`, [second.request_id, correctionResult, correctionHash]);
    expect(await inspectRoomInterpreterProposalSource({ roomId: room.room_id,
      requestId: second.request_id, ownerProfileId: owner.profileId }))
      .toMatchObject({ request_id: second.request_id, trigger_text: correctionMessage.text,
        reply_text: correctionResult, result_sha256: correctionHash });
    await db.query(`UPDATE helix_shared_room_interpreter_turn_requests
      SET result_sha256=$2 WHERE request_id=$1`, [first.request_id, "0".repeat(64)]);
    await expect(inspectRoomInterpreterProposalSource({ roomId: room.room_id,
      requestId: second.request_id, ownerProfileId: owner.profileId }))
      .rejects.toMatchObject({ statusCode: 409 });
    await db.query(`UPDATE helix_shared_room_interpreter_turn_requests
      SET result_sha256=$2 WHERE request_id=$1`, [first.request_id, hash]);
    await db.query(`UPDATE helix_shared_room_interpreter_evaluation_corrections
      SET state='queued', result_text=NULL, result_sha256=NULL, finished_at=NULL
      WHERE request_id=$1`, [second.request_id]);
    await guestA.agent.post(`${base}/text-releases`).send({
      interpreter_session_id: configured.interpreter_session_id,
      generation: configured.generation, message_id: message.message_id,
      action: "revoke" }).expect(200);
    expect((await db.query(`SELECT state FROM helix_shared_room_interpreter_evaluation_corrections
      WHERE request_id=$1`, [second.request_id])).rows)
      .toEqual([{ state: "cancelled" }]);
    await expect(previewQueuedRoomInterpreterTurn({ roomId: room.room_id,
      requestId: second.request_id, ownerProfileId: owner.profileId }))
      .rejects.toMatchObject({ statusCode: 409 });
    await expect(reserveRoomInterpreterEvaluationCorrection(secondInput))
      .rejects.toMatchObject({ statusCode: 409 });
    await expect(enableSharedRoomInterpreterTwoTurnEvaluation(selection))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it("builds only the configured generation's currently released host and guest text", async () => {
    const app = createSharedRealtimeRoomTestApp();
    const owner = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:turn-owner",
      displayName: "Dan", accountType: "developer" });
    const guest = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:turn-guest",
      displayName: "Sam", accountType: "developer" });
    const other = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:turn-other",
      displayName: "Other", accountType: "developer" });
    const room = (await owner.agent.post("/api/agi/realtime/rooms")
      .send({ title: "Turn room" }).expect(201)).body.room;
    const base = `/api/agi/realtime/rooms/${room.room_id}`;
    const invite = await owner.agent.post(`${base}/invites`).expect(201);
    await guest.agent.post("/api/agi/realtime/rooms/join")
      .send({ invite_code: invite.body.invite_code }).expect(200);
    const prepared = (await owner.agent.post(`${base}/interpreter-session`).send({}).expect(201)).body.session;
    const send = async (actor: typeof owner, text: string) => (await actor.agent.post(`${base}/text-messages`)
      .send({ client_message_id: `room-text:${crypto.randomUUID()}`, text }).expect(201)).body.message;
    const old = await send(owner, "Old preparation text");
    await owner.agent.post(`${base}/text-releases`).send({ interpreter_session_id: prepared.interpreter_session_id,
      generation: 1, message_id: old.message_id, action: "release" }).expect(200);
    const configured = await configureSharedRoomInterpreter({ roomId: room.room_id,
      preparationSessionId: prepared.interpreter_session_id, preparationGeneration: 1,
      nativePrincipal: await principal(owner.profileId, owner.sessionId) });
    const ownerText = await send(owner, "Host released context");
    await send(owner, "Host unreleased private room text");
    const guestText = await send(guest, "Guest correction");
    await send(guest, "Guest unreleased private room text");
    const selector = { interpreter_session_id: configured.interpreter_session_id,
      generation: configured.generation, action: "release" };
    const input = { roomId: room.room_id as string, requesterProfileId: guest.profileId,
      interpreterSessionId: configured.interpreter_session_id,
      generation: configured.generation, triggerMessageId: guestText.message_id };
    await expect(admitRoomInterpreterTurnContext(input)).rejects.toMatchObject({ statusCode: 409 });
    await owner.agent.post(`${base}/text-releases`).send({ ...selector, message_id: ownerText.message_id }).expect(200);
    await guest.agent.post(`${base}/text-releases`).send({ ...selector, message_id: guestText.message_id }).expect(200);
    const turn = await admitRoomInterpreterTurnContext(input);
    expect(turn).toMatchObject({ room_id: room.room_id,
      interpreter_session_id: configured.interpreter_session_id, generation: 2,
      credential_source: "host_native_profile", expected_payer: "host_openai_project",
      usage_ceiling_turns: 1, trigger_message_id: guestText.message_id, model_input: true });
    expect(turn.messages.map(message => message.text)).toEqual(["Host released context", "Guest correction"]);
    expect(turn.messages[0].author_participant_id).toBe(ownerText.author_participant_id);
    expect(turn.messages[1].author_participant_id).toBe(guestText.author_participant_id);
    expect(JSON.stringify(turn)).not.toContain("unreleased");
    expect(JSON.stringify(turn)).not.toContain("Old preparation text");
    const requestBody = { interpreter_session_id: configured.interpreter_session_id,
      generation: configured.generation, trigger_message_id: guestText.message_id,
      client_request_id: `room-ai-turn:${crypto.randomUUID()}` };
    const route = `${base}/interpreter-turn-requests`;
    const queued = await guest.agent.post(route).send(requestBody).expect(202);
    expect(queued.body).toMatchObject({ shared_ai_active: false, model_input: false,
      provider_calls: 0, request: { state: "queued", trigger_message_id: guestText.message_id,
        requested_by_participant_id: guestText.author_participant_id } });
    expect(JSON.stringify(queued.body)).not.toContain("Host released context");
    expect(JSON.stringify(queued.body)).not.toContain("Guest correction");
    expect((await guest.agent.post(route).send(requestBody).expect(202)).body.request.request_id)
      .toBe(queued.body.request.request_id);
    await guest.agent.post(route).send({ ...requestBody,
      client_request_id: `room-ai-turn:${crypto.randomUUID()}` }).expect(409);
    await owner.agent.post(route).send(requestBody).expect(409);
    await other.agent.post(route).send(requestBody).expect(404);
    await expect(admitRoomInterpreterTurnContext({ ...input, requesterProfileId: other.profileId }))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(admitRoomInterpreterTurnContext({ ...input, triggerMessageId: ownerText.message_id }))
      .rejects.toMatchObject({ statusCode: 409 });
    await guest.agent.post(`${base}/text-releases`).send({ ...selector,
      message_id: guestText.message_id, action: "revoke" }).expect(200);
    const db = await readSharedRealtimeRoomDatabase();
    const { rows: requests } = await db.query<{ state: string }>(`
      SELECT state FROM helix_shared_room_interpreter_turn_requests WHERE request_id = $1;
    `, [queued.body.request.request_id]);
    expect(requests).toEqual([{ state: "cancelled" }]);
    await expect(admitRoomInterpreterTurnContext(input)).rejects.toMatchObject({ statusCode: 409 });
    await guest.agent.post(route).send(requestBody).expect(409);
    await guest.agent.post(`${base}/leave`).expect(200);
    await expect(admitRoomInterpreterTurnContext(input)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("allows one native pickup with an exact current lease and denies a repeated or stale claim", async () => {
    const app = createSharedRealtimeRoomTestApp();
    const owner = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:claim-owner",
      displayName: "Dan", accountType: "developer" });
    const room = (await owner.agent.post("/api/agi/realtime/rooms")
      .send({ title: "Claim room" }).expect(201)).body.room;
    const base = `/api/agi/realtime/rooms/${room.room_id}`;
    const prepared = (await owner.agent.post(`${base}/interpreter-session`).send({}).expect(201)).body.session;
    const nativePrincipal = await principal(owner.profileId, owner.sessionId);
    const configured = await configureSharedRoomInterpreter({ roomId: room.room_id,
      preparationSessionId: prepared.interpreter_session_id, preparationGeneration: 1,
      nativePrincipal });
    const message = (await owner.agent.post(`${base}/text-messages`)
      .send({ client_message_id: `room-text:${crypto.randomUUID()}`, text: "Bounded host question" })
      .expect(201)).body.message;
    await owner.agent.post(`${base}/text-releases`).send({ interpreter_session_id: configured.interpreter_session_id,
      generation: 2, message_id: message.message_id, action: "release" }).expect(200);
    const clientRequestId = `room-ai-turn:${crypto.randomUUID()}`;
    const requestInput = { roomId: room.room_id,
      requesterProfileId: owner.profileId, interpreterSessionId: configured.interpreter_session_id,
      generation: 2, triggerMessageId: message.message_id,
      clientRequestId };
    const request = await reserveRoomInterpreterTurn(requestInput);
    const later = (await owner.agent.post(`${base}/text-messages`)
      .send({ client_message_id: `room-text:${crypto.randomUUID()}`,
        text: "A later topic should not enter this turn" }).expect(201)).body.message;
    await owner.agent.post(`${base}/text-releases`).send({
      interpreter_session_id: configured.interpreter_session_id,
      generation: 2, message_id: later.message_id, action: "release" }).expect(200);
    expect((await reserveRoomInterpreterTurn(requestInput)).request_id).toBe(request.request_id);
    const lease = await issueRoomInterpreterMcpLease({ roomId: room.room_id,
      interpreterSessionId: configured.interpreter_session_id, generation: 2,
      nativePrincipal });
    const claimInput = { roomId: room.room_id as string, requestId: request.request_id,
      leaseId: lease.lease_id, nativePrincipal };
    await expect(claimRoomInterpreterTurn({ ...claimInput,
      nativePrincipal: { ...nativePrincipal, issuer: "https://other.example" } }))
      .rejects.toMatchObject({ statusCode: 401 });
    await expect(claimRoomInterpreterTurn({ ...claimInput, leaseId: "room_interpreter_mcp_lease:wrong" }))
      .rejects.toMatchObject({ statusCode: 409 });
    const claimed = await claimRoomInterpreterTurn(claimInput);
    expect(claimed).toMatchObject({ request_id: request.request_id, lease_id: lease.lease_id,
      provider_calls: 0, turn: { model_input: true, trigger_message_id: message.message_id,
        messages: [{ text: "Bounded host question" }] } });
    expect(claimed.turn.messages).toHaveLength(1);
    expect(Date.parse(claimed.claim_expires_at) - Date.now()).toBeLessThanOrEqual(15_000);
    expect(await validateClaimedRoomInterpreterTurn(claimInput)).toMatchObject({
      schema: "helix.room_interpreter_claim_preflight.v1", request_id: request.request_id,
      lease_id: lease.lease_id, context_current: true, model_input: false, provider_calls: 0 });
    await expect(validateClaimedRoomInterpreterTurn({ ...claimInput,
      nativePrincipal: { ...nativePrincipal, issuer: "https://other.example" } }))
      .rejects.toMatchObject({ statusCode: 401 });
    await expect(claimRoomInterpreterTurn(claimInput)).rejects.toMatchObject({ statusCode: 409 });
    await owner.agent.post(`${base}/text-releases`).send({ interpreter_session_id: configured.interpreter_session_id,
      generation: 2, message_id: message.message_id, action: "revoke" }).expect(200);
    await expect(validateClaimedRoomInterpreterTurn(claimInput)).rejects.toMatchObject({ statusCode: 409 });
    const stale = await finishRoomInterpreterTurn({ ...claimInput,
      outcome: { kind: "completed", text: "Should not be disclosed", providerSessionId: "agent_session_test" } });
    expect(stale).toMatchObject({ state: "failed", failure_code: "context_changed", reply: null,
      mission_authority: false, program_action: false });
  });

  it("offers only a current completed owner reply as an inert proposal source", async () => {
    const app = createSharedRealtimeRoomTestApp();
    const owner = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:proposal-owner",
      displayName: "Owner", accountType: "developer" });
    const guest = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:proposal-guest",
      displayName: "Guest", accountType: "developer" });
    const roomId = (await owner.agent.post("/api/agi/realtime/rooms")
      .send({ title: "Proposal source" }).expect(201)).body.room.room_id as string;
    const base = `/api/agi/realtime/rooms/${roomId}`;
    const invite = await owner.agent.post(`${base}/invites`).expect(201);
    await guest.agent.post("/api/agi/realtime/rooms/join")
      .send({ invite_code: invite.body.invite_code }).expect(200);
    const prepared = (await owner.agent.post(`${base}/interpreter-session`).send({}).expect(201)).body.session;
    const configured = await configureSharedRoomInterpreter({ roomId,
      preparationSessionId: prepared.interpreter_session_id, preparationGeneration: 1,
      nativePrincipal: await principal(owner.profileId, owner.sessionId) });
    const message = (await guest.agent.post(`${base}/text-messages`)
      .send({ client_message_id: `room-text:${crypto.randomUUID()}`, text: "Can we propose a task?" })
      .expect(201)).body.message;
    const release = { interpreter_session_id: configured.interpreter_session_id,
      generation: configured.generation, message_id: message.message_id };
    await guest.agent.post(`${base}/text-releases`).send({ ...release, action: "release" }).expect(200);
    const queued = await reserveRoomInterpreterTurn({ roomId,
      requesterProfileId: guest.profileId, interpreterSessionId: configured.interpreter_session_id,
      generation: configured.generation, triggerMessageId: message.message_id,
      clientRequestId: `room-ai-turn:${crypto.randomUUID()}` });
    const db = await readSharedRealtimeRoomDatabase();
    const reply = "A possible plan for the host to review.";
    await db.query(`UPDATE helix_shared_room_interpreter_turn_requests
      SET state='completed', result_text=$2, result_sha256=$3, provider_session_id='agent_session_test'
      WHERE request_id=$1`, [queued.request_id, reply,
      crypto.createHash("sha256").update(reply).digest("hex")]);
    const source = await inspectRoomInterpreterProposalSource({ roomId,
      requestId: queued.request_id, ownerProfileId: owner.profileId });
    expect(source).toMatchObject({ trigger_message_id: message.message_id,
      trigger_author_participant_id: message.author_participant_id,
      trigger_text: "Can we propose a task?", reply_text: reply });
    const later = (await guest.agent.post(`${base}/text-messages`)
      .send({ client_message_id: `room-text:${crypto.randomUUID()}`,
        text: "A later released room message" }).expect(201)).body.message;
    await guest.agent.post(`${base}/text-releases`).send({ ...release,
      message_id: later.message_id, action: "release" }).expect(200);
    await expect(inspectRoomInterpreterProposalSource({ roomId,
      requestId: queued.request_id, ownerProfileId: owner.profileId }))
      .resolves.toMatchObject({ context_sha256: source.context_sha256,
        trigger_text: "Can we propose a task?", reply_text: reply });
    await expect(inspectRoomInterpreterProposalSource({ roomId, requestId: queued.request_id,
      ownerProfileId: guest.profileId })).rejects.toMatchObject({ statusCode: 403 });
    await guest.agent.post(`${base}/text-releases`).send({ ...release, action: "revoke" }).expect(200);
    await expect(inspectRoomInterpreterProposalSource({ roomId, requestId: queued.request_id,
      ownerProfileId: owner.profileId })).rejects.toMatchObject({ statusCode: 409 });
  });
});
