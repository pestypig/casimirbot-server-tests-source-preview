import { beforeEach, describe, expect, it } from "vitest";
import { HELIX_DESKTOP_MCP_ISSUER } from "../../../../auth/helix-desktop-mcp-identity";
import type { HelixAgentApiPrincipal } from "../../../helix-agent-api/types";
import { getAccountSessionById } from "../../../helix-account/account-session-store";
import { readSharedRealtimeRoomDatabase } from "../room-store/database";
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

describe("room interpreter MCP lease", () => {
  beforeEach(resetSharedRealtimeRoomRouteTestState);

  it("mints one hashed five-minute native lease and revokes replaced or removed generations", async () => {
    const app = createSharedRealtimeRoomTestApp();
    const owner = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:lease-owner", displayName: "Dan", accountType: "developer" });
    const guest = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:lease-guest", displayName: "Sam", accountType: "developer" });
    const room = (await owner.agent.post("/api/agi/realtime/rooms").send({ title: "Lease room" }).expect(201)).body.room;
    const base = `/api/agi/realtime/rooms/${room.room_id}`;
    const invite = await owner.agent.post(`${base}/invites`).expect(201);
    await guest.agent.post("/api/agi/realtime/rooms/join").send({ invite_code: invite.body.invite_code }).expect(200);
    const session = (await owner.agent.post(`${base}/interpreter-session`).send({}).expect(201)).body.session;
    const input = { roomId: room.room_id as string,
      interpreterSessionId: session.interpreter_session_id as string, generation: 1,
      nativePrincipal: await nativePrincipal(owner.profileId, owner.sessionId) };
    await expect(issueRoomInterpreterMcpLease({ ...input,
      nativePrincipal: await nativePrincipal(guest.profileId, guest.sessionId) }))
      .rejects.toMatchObject({ statusCode: 403 });
    await expect(issueRoomInterpreterMcpLease({ ...input,
      nativePrincipal: { ...input.nativePrincipal, issuer: "https://codex.example" } }))
      .rejects.toMatchObject({ statusCode: 401 });
    await expect(issueRoomInterpreterMcpLease({ ...input,
      nativePrincipal: { ...input.nativePrincipal,
        accountContext: { ...input.nativePrincipal.accountContext, session_id: null } } }))
      .rejects.toMatchObject({ statusCode: 401 });
    const first = await issueRoomInterpreterMcpLease(input);
    expect(first).toMatchObject({ generation: 1, allowed_tools: ["helix_room_interpreter_status"],
      model_input: false, provider_calls: 0 });
    expect(new Date(first.expires_at).getTime() - Date.now()).toBeLessThanOrEqual(300000);
    expect((await verifyRoomInterpreterMcpLease(first.bearer_token)).roomId).toBe(room.room_id);
    const db = await readSharedRealtimeRoomDatabase();
    const { rows } = await db.query<{ token_hash: string }>(`
      SELECT token_hash FROM helix_shared_room_interpreter_mcp_leases WHERE lease_id = $1;
    `, [first.lease_id]);
    expect(rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.token_hash).not.toContain(first.bearer_token);
    const second = await issueRoomInterpreterMcpLease(input);
    await expect(verifyRoomInterpreterMcpLease(first.bearer_token)).rejects.toMatchObject({ statusCode: 401 });
    expect((await verifyRoomInterpreterMcpLease(second.bearer_token)).leaseId).toBe(second.lease_id);
    await owner.agent.delete(`${base}/interpreter-session`).send({ interpreter_session_id: session.interpreter_session_id,
      generation: 1 }).expect(200);
    await expect(verifyRoomInterpreterMcpLease(second.bearer_token)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejects a native lease after account sign-out or room closure", async () => {
    const app = createSharedRealtimeRoomTestApp();
    const owner = await signInSharedRealtimeRoomTestAgent({ app, profileId: "profile:lease-close-owner", displayName: "Dan", accountType: "developer" });
    const room = (await owner.agent.post("/api/agi/realtime/rooms").send({ title: "Lease close room" }).expect(201)).body.room;
    const base = `/api/agi/realtime/rooms/${room.room_id}`;
    const session = (await owner.agent.post(`${base}/interpreter-session`).send({}).expect(201)).body.session;
    const input = { roomId: room.room_id as string,
      interpreterSessionId: session.interpreter_session_id as string, generation: 1,
      nativePrincipal: await nativePrincipal(owner.profileId, owner.sessionId) };
    const first = await issueRoomInterpreterMcpLease(input);
    await owner.agent.post("/api/account/session/sign-out").expect(200);
    await expect(verifyRoomInterpreterMcpLease(first.bearer_token)).rejects.toMatchObject({ statusCode: 401 });
    const renewedOwner = await signInSharedRealtimeRoomTestAgent({ app, profileId: owner.profileId,
      displayName: "Dan", accountType: "developer" });
    const second = await issueRoomInterpreterMcpLease({ ...input,
      nativePrincipal: await nativePrincipal(renewedOwner.profileId, renewedOwner.sessionId) });
    await renewedOwner.agent.post(`${base}/leave`).expect(200);
    await expect(verifyRoomInterpreterMcpLease(second.bearer_token)).rejects.toMatchObject({ statusCode: 401 });
  });
});
