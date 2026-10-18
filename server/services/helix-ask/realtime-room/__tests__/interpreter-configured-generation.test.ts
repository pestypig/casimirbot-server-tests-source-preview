import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { HELIX_DESKTOP_MCP_ISSUER } from "../../../../auth/helix-desktop-mcp-identity";
import type { HelixAgentApiPrincipal } from "../../../helix-agent-api/types";
import { getAccountSessionById } from "../../../helix-account/account-session-store";
import { readSharedRealtimeRoomDatabase } from "../room-store/database";
import { configureSharedRoomInterpreter } from "../room-store/interpreter-sessions";
import { issueRoomInterpreterMcpLease, verifyRoomInterpreterMcpLease } from "../room-store/interpreter-mcp-lease";
import { createSharedRealtimeRoomTestApp, resetSharedRealtimeRoomRouteTestState,
  signInSharedRealtimeRoomTestAgent } from "./route-harness";

const nativePrincipal = async (profileId: string, sessionId: string): Promise<HelixAgentApiPrincipal> => {
  const account = await getAccountSessionById(sessionId);
  if (!account) throw Error("test_account_missing");
  return { tenantId: "desktop:test", issuer: HELIX_DESKTOP_MCP_ISSUER,
    subjectId: profileId, accountProfileId: profileId, accountType: "developer",
    trustedDeveloperProfile: true, mcpClientRef: "desktop_mcp_client:test",
    scopes: new Set(), tokenExpiresAt: null,
    accountContext: { session_id: sessionId, profile_id: profileId,
      trusted_account_session: true, account_session: account,
      account_policy: account.account_policy } };
};

describe("configured room interpreter generation", () => {
  beforeEach(resetSharedRealtimeRoomRouteTestState);

  it("rotates the native owner's preparation and forces fresh author releases", async () => {
    const app = createSharedRealtimeRoomTestApp();
    const owner = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:configured-owner",
      displayName: "Dan", accountType: "developer" });
    const guest = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:configured-guest",
      displayName: "Sam", accountType: "developer" });
    const room = (await owner.agent.post("/api/agi/realtime/rooms")
      .send({ title: "Configuration room" }).expect(201)).body.room;
    const base = `/api/agi/realtime/rooms/${room.room_id}`;
    const invite = await owner.agent.post(`${base}/invites`).expect(201);
    await guest.agent.post("/api/agi/realtime/rooms/join")
      .send({ invite_code: invite.body.invite_code }).expect(200);
    const first = (await owner.agent.post(`${base}/interpreter-session`).send({}).expect(201)).body.session;
    const message = (await guest.agent.post(`${base}/text-messages`).send({
      client_message_id: `room-text:${crypto.randomUUID()}`, text: "Guest says hello" }).expect(201)).body.message;
    await guest.agent.post(`${base}/text-releases`).send({
      interpreter_session_id: first.interpreter_session_id, generation: first.generation,
      message_id: message.message_id, action: "release" }).expect(200);
    const principal = await nativePrincipal(owner.profileId, owner.sessionId);
    const lease = await issueRoomInterpreterMcpLease({ roomId: room.room_id,
      interpreterSessionId: first.interpreter_session_id, generation: first.generation,
      nativePrincipal: principal });
    const input = { roomId: room.room_id as string,
      preparationSessionId: first.interpreter_session_id as string,
      preparationGeneration: first.generation as number, nativePrincipal: principal };
    await expect(configureSharedRoomInterpreter({ ...input,
      nativePrincipal: await nativePrincipal(guest.profileId, guest.sessionId) }))
      .rejects.toMatchObject({ statusCode: 403 });
    await expect(configureSharedRoomInterpreter({ ...input,
      nativePrincipal: { ...principal, issuer: "https://untrusted.example" } }))
      .rejects.toMatchObject({ statusCode: 401 });
    const configured = await configureSharedRoomInterpreter(input);
    expect(configured).toMatchObject({ room_id: room.room_id, generation: 2,
      state: "configured", credential_source: "host_native_profile",
      expected_payer: "host_openai_project", usage_ceiling_turns: 1,
      shared_ai_active: false, model_input: false, provider_calls: 0 });
    expect(configured.interpreter_session_id).not.toBe(first.interpreter_session_id);
    expect((await configureSharedRoomInterpreter(input)).interpreter_session_id)
      .toBe(configured.interpreter_session_id);
    await expect(verifyRoomInterpreterMcpLease(lease.bearer_token))
      .rejects.toMatchObject({ statusCode: 401 });
    const configuredLease = await issueRoomInterpreterMcpLease({ roomId: room.room_id,
      interpreterSessionId: configured.interpreter_session_id, generation: configured.generation,
      nativePrincipal: principal });
    expect((await verifyRoomInterpreterMcpLease(configuredLease.bearer_token)).state)
      .toBe("configured");
    const db = await readSharedRealtimeRoomDatabase();
    const { rows } = await db.query<{ state: string }>(`
      SELECT state FROM helix_shared_room_text_releases WHERE interpreter_session_id = $1;
    `, [first.interpreter_session_id]);
    expect(rows).toEqual([{ state: "revoked" }]);
    await guest.agent.post(`${base}/text-releases`).send({
      interpreter_session_id: first.interpreter_session_id, generation: first.generation,
      message_id: message.message_id, action: "release" }).expect(409);
    await guest.agent.post(`${base}/text-releases`).send({
      interpreter_session_id: configured.interpreter_session_id, generation: configured.generation,
      message_id: message.message_id, action: "release" }).expect(200);
  });
});
