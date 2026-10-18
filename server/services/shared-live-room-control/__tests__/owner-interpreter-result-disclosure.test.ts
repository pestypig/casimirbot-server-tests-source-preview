import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import { beforeEach, expect, it } from "vitest";
import { HELIX_DESKTOP_MCP_ISSUER } from "../../../auth/helix-desktop-mcp-identity";
import type { HelixAgentApiPrincipal } from "../../helix-agent-api/types";
import { getAccountSessionById } from "../../helix-account/account-session-store";
import { readSharedRealtimeRoomDatabase } from
  "../../helix-ask/realtime-room/room-store/database";
import { configureSharedRoomInterpreter } from
  "../../helix-ask/realtime-room/room-store/interpreter-sessions";
import { reserveRoomInterpreterTurn } from
  "../../helix-ask/realtime-room/room-store/interpreter-turn-requests";
import { createSharedRealtimeRoomTestApp, resetSharedRealtimeRoomRouteTestState,
  signInSharedRealtimeRoomTestAgent } from
  "../../helix-ask/realtime-room/__tests__/route-harness";
import { signOwnerInterpreterResultDisclosure } from
  "../interpreter-result-disclosure-proof";
import { NativeSharedLiveRoomConnection } from "../native-room-connection";
import { ownerNodeIdentityDigest } from "../owner-node-attachment-store";
import { RoomOwnerInterpreterResultDisclosureService } from
  "../owner-interpreter-result-disclosure-service";
import { SharedInterpreterReportReader } from "../shared-interpreter-report-reader";
import { SharedLiveRoomControlError } from "../service";
import { createHelixSharedLiveRoomRouter } from "../../../routes/helix-shared-live-rooms";
import type { withSharedRealtimeRoomTransaction } from
  "../../helix-ask/realtime-room/room-store/database";

beforeEach(resetSharedRealtimeRoomRouteTestState);

it("lets a signed current owner share one AI-sourced task observation and a guest read it", async () => {
  const app = createSharedRealtimeRoomTestApp();
  const owner = await signInSharedRealtimeRoomTestAgent({ app,
    profileId: "profile:ai-report-owner", displayName: "Owner", accountType: "developer" });
  const guest = await signInSharedRealtimeRoomTestAgent({ app,
    profileId: "profile:ai-report-guest", displayName: "Guest", accountType: "developer" });
  const roomId = (await owner.agent.post("/api/agi/realtime/rooms")
    .send({ title: "AI report room" }).expect(201)).body.room.room_id as string;
  const base = `/api/agi/realtime/rooms/${roomId}`;
  const invite = await owner.agent.post(`${base}/invites`).expect(201);
  await guest.agent.post("/api/agi/realtime/rooms/join")
    .send({ invite_code: invite.body.invite_code }).expect(200);
  const principalFor = async (profileId: string, sessionId: string): Promise<HelixAgentApiPrincipal> => {
    const account = await getAccountSessionById(sessionId);
    if (!account) throw Error("account_missing");
    return { tenantId: "desktop:test", issuer: HELIX_DESKTOP_MCP_ISSUER,
      subjectId: profileId, accountProfileId: profileId, accountType: "developer",
      trustedDeveloperProfile: true, mcpClientRef: "desktop_mcp_client:test",
      scopes: new Set(["helix.rooms.read", "helix.rooms.manage"]),
      tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      accountContext: { session_id: sessionId, profile_id: profileId,
        trusted_account_session: true, account_session: account,
        account_policy: account.account_policy } };
  };
  const ownerPrincipal = await principalFor(owner.profileId, owner.sessionId);
  const guestPrincipal = await principalFor(guest.profileId, guest.sessionId);
  const prepared = (await owner.agent.post(`${base}/interpreter-session`)
    .send({}).expect(201)).body.session;
  const configured = await configureSharedRoomInterpreter({ roomId,
    preparationSessionId: prepared.interpreter_session_id, preparationGeneration: 1,
    nativePrincipal: ownerPrincipal });
  const message = (await guest.agent.post(`${base}/text-messages`)
    .send({ client_message_id: `room-text:${crypto.randomUUID()}`,
      text: "Can the task evaluate our plan?" }).expect(201)).body.message;
  const release = { interpreter_session_id: configured.interpreter_session_id,
    generation: configured.generation, message_id: message.message_id };
  await guest.agent.post(`${base}/text-releases`).send({ ...release, action: "release" }).expect(200);
  const turn = await reserveRoomInterpreterTurn({ roomId,
    requesterProfileId: guest.profileId,
    interpreterSessionId: configured.interpreter_session_id,
    generation: configured.generation, triggerMessageId: message.message_id,
    clientRequestId: `room-ai-turn:${crypto.randomUUID()}` });
  const db = await readSharedRealtimeRoomDatabase();
  const reply = "A bounded plan for the host to review.";
  await db.query(`UPDATE helix_shared_room_interpreter_turn_requests
    SET state='completed', result_text=$2, result_sha256=$3,
      provider_session_id='agent_session_fixture' WHERE request_id=$1`,
  [turn.request_id, reply, crypto.createHash("sha256").update(reply).digest("hex")]);
  const key = crypto.generateKeyPairSync("ed25519"), authority = "https://rooms.test";
  const publicKey = key.publicKey.export({ type: "spki", format: "der" }).toString("base64url");
  const clock = Date.now(), nodeRef = `room_node:sha256:${crypto.createHash("sha256")
    .update(publicKey).digest("hex")}`;
  const attachmentRef = `room_owner_attachment:${crypto.randomUUID()}`;
  await db.query(`INSERT INTO helix_room_owner_node_attachments
    (room_id,owner_profile_id,owner_identity_digest,attachment_id,revision,
     node_public_key,status,request_id,request_digest,created_at,expires_at)
    VALUES ($1,$2,$3,$4,1,$5,'reserved',$6,$7,$8,$9)`,
  [roomId, owner.profileId, ownerNodeIdentityDigest(ownerPrincipal),
    attachmentRef, publicKey,
    `reserve:${crypto.randomUUID()}`, "a".repeat(64),
    new Date(clock).toISOString(), new Date(clock + 3600_000).toISOString()]);
  const sourceRow = (await db.query<{ context_sha256: string; result_sha256: string }>(`
    SELECT context_sha256,result_sha256 FROM helix_shared_room_interpreter_turn_requests
    WHERE request_id=$1`, [turn.request_id])).rows[0]!;
  const text = "The task found one bounded approach.";
  const report = { task_status: "completed" as const, result_text: text,
    result_sha256: crypto.createHash("sha256").update(text).digest("hex"),
    share_with_room: true as const };
  const sign = (value = report) => signOwnerInterpreterResultDisclosure(authority, {
    authorization: { schema: "helix.room_owner_interpreter_result_authorization.v1",
      room_id: roomId, turn_request_id: turn.request_id,
      context_sha256: sourceRow.context_sha256,
      source_result_sha256: sourceRow.result_sha256,
      attachment_revision: 1, node_public_key: publicKey,
      request_id: `ai-report:${crypto.randomUUID()}`, issued_at_ms: clock },
    report: value,
  }, key.privateKey);
  const tx = (async (run: (client: typeof db) => Promise<unknown>) => run(db)) as
    typeof withSharedRealtimeRoomTransaction;
  const service = new RoomOwnerInterpreterResultDisclosureService({
    transaction: tx, authority: () => authority, now: () => clock });
  const reader = new SharedInterpreterReportReader({ transaction: tx, now: () => clock });
  const before = await reader.list(guestPrincipal, { room_id: roomId });
  expect(before.reports).toHaveLength(0);
  const first = await service.disclose(ownerPrincipal, sign());
  expect(first).toMatchObject({ room_disclosure_recorded: true,
    room_presentation_confirmed: false, answer_authority: false,
    source: { turn_request_id: turn.request_id },
    disclosure: { result_sha256: report.result_sha256 } });
  expect(await service.disclose(ownerPrincipal, sign())).toEqual(first);
  const token = "synthetic-room-oauth-token";
  const guestToken = "synthetic-room-guest-token";
  const hosted = express();
  hosted.use("/api/v1/rooms", createHelixSharedLiveRoomRouter({
    authenticate: async req => {
      if (req.get("authorization") === `Bearer ${token}`) return ownerPrincipal;
      if (req.get("authorization") === `Bearer ${guestToken}`) return guestPrincipal;
      throw new SharedLiveRoomControlError(401, "unauthorized", "Sign in required.");
    },
    ownerInterpreterResultDisclosureService: service,
    sharedInterpreterReportReader: reader,
    rateLimit: false, enforceTransportSecurity: false,
  }));
  const account = {
    profileId: owner.profileId, sessionId: owner.sessionId };
  const fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const parsedUrl = new URL(String(url));
    const path = parsedUrl.pathname;
    if (path === "/api/v1/rooms") return new Response(JSON.stringify({
      schema: "helix.shared_live_room.list_receipt.v1", operation: "room.list", ok: true,
      rooms: [], reentry_required: true, answer_authority: false,
      assistant_answer: false, terminal_eligible: false, raw_content_included: false,
    }), { status: 200 });
    const headers = init?.headers as Record<string, string>;
    const response = init?.method === "POST"
      ? await request(hosted).post(path).set(headers).send(JSON.parse(String(init.body)))
      : await request(hosted).get(`${path}${parsedUrl.search}`).set(headers);
    return new Response(JSON.stringify(response.body), { status: response.status });
  };
  const connection = new NativeSharedLiveRoomConnection({ origin: authority,
    now: () => clock, fetch, verifier: { audience: () => `${authority}/mcp`,
      authorizationServer: () => ownerPrincipal.issuer, providerAlias: () => "auth0",
      verify: async () => ({ issuer: ownerPrincipal.issuer,
        subject: ownerPrincipal.subjectId, tenantId: ownerPrincipal.tenantId,
        scopes: ownerPrincipal.scopes, expiresAt: ownerPrincipal.tokenExpiresAt!, claims: {} }) } });
  await connection.connect(account, token);
  (connection as unknown as { ownerNodeKey: typeof key }).ownerNodeKey = key;
  const nativeReceipt = await connection.discloseOwnerInterpreterResult(account, roomId, {
    attachment_ref: attachmentRef, revision: 1, node_ref: nodeRef,
    status: "reserved", expires_at: new Date(clock + 3600_000).toISOString(),
    local_task_verified: false, dispatch_authority: false,
  }, { turn_request_id: turn.request_id, context_sha256: sourceRow.context_sha256,
    source_result_sha256: sourceRow.result_sha256 }, report);
  expect(nativeReceipt).toEqual(first);
  const guestAccount = { profileId: guest.profileId, sessionId: guest.sessionId };
  const guestConnection = new NativeSharedLiveRoomConnection({ origin: authority,
    now: () => clock, fetch, verifier: { audience: () => `${authority}/mcp`,
      authorizationServer: () => guestPrincipal.issuer, providerAlias: () => "auth0",
      verify: async () => ({ issuer: guestPrincipal.issuer,
        subject: guestPrincipal.subjectId, tenantId: guestPrincipal.tenantId,
        scopes: guestPrincipal.scopes, expiresAt: guestPrincipal.tokenExpiresAt!, claims: {} }) } });
  await guestConnection.connect(guestAccount, guestToken);
  const guestCatalog = await guestConnection.listSharedInterpreterReports(guestAccount, roomId);
  expect(guestCatalog.reports).toMatchObject([{
    disclosure_ref: first.disclosure.disclosure_ref,
    source_turn_request_id: turn.request_id,
  }]);
  const guestRead = await guestConnection.readSharedInterpreterReport(guestAccount, {
    room_id: roomId, disclosure_ref: first.disclosure.disclosure_ref,
    result_sha256: report.result_sha256,
  });
  expect(guestRead.result_text).toBe(text);
  await request(hosted)
    .get(`/api/v1/rooms/${encodeURIComponent(roomId)}/interpreter-task-reports`)
    .set("Authorization", "Bearer unknown-token").expect(401);
  const catalog = await reader.list(guestPrincipal, { room_id: roomId });
  expect(catalog).toMatchObject({ raw_content_included: false,
    reports: [{ disclosure_ref: first.disclosure.disclosure_ref,
      source_turn_request_id: turn.request_id }] });
  expect(JSON.stringify(catalog)).not.toContain(text);
  const exact = { room_id: roomId, disclosure_ref: first.disclosure.disclosure_ref,
    result_sha256: report.result_sha256 };
  expect((await reader.inspect(guestPrincipal, exact)).result_text).toBe(text);
  await expect(service.disclose(ownerPrincipal, sign({ ...report,
    result_text: "A changed report.",
    result_sha256: crypto.createHash("sha256").update("A changed report.")
      .digest("hex") }))).rejects.toMatchObject({ code: "idempotency_conflict" });
  const tampered = sign(); tampered.report.result_text = "Unsigned change";
  await expect(service.disclose(ownerPrincipal, tampered)).rejects.toMatchObject({ code: "room_forbidden" });
  await db.query("UPDATE helix_room_owner_node_attachments SET status='revoked' WHERE room_id=$1", [roomId]);
  await expect(service.disclose(ownerPrincipal, sign())).rejects.toMatchObject({ code: "room_runtime_conflict" });
  await expect(reader.inspect(guestPrincipal, exact)).rejects.toMatchObject({ code: "room_runtime_conflict" });
  await db.query("UPDATE helix_room_owner_node_attachments SET status='reserved' WHERE room_id=$1", [roomId]);
  await guest.agent.post(`${base}/text-releases`).send({ ...release, action: "revoke" }).expect(200);
  await expect(service.disclose(ownerPrincipal, sign())).rejects.toMatchObject({ code: "room_runtime_conflict" });
  await expect(reader.inspect(guestPrincipal, exact)).rejects.toMatchObject({ code: "room_runtime_conflict" });
  await expect(guestConnection.readSharedInterpreterReport(guestAccount, exact))
    .rejects.toMatchObject({ code: "room_runtime_conflict" });
  expect((await reader.list(guestPrincipal, { room_id: roomId })).reports).toHaveLength(0);
  expect(nodeRef).toMatch(/^room_node:sha256:/u);
}, 30000);
