import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nativeHostedRoomAttachmentSchema } from "@shared/helix-native-hosted-room-mission";
import { createHelixSharedLiveRoomRouter } from "../helix-shared-live-rooms";
import { disclosureFixture } from "../../services/shared-live-room-control/__tests__/owner-result-disclosure-fixture";
import { NativeSharedLiveRoomConnection } from "../../services/shared-live-room-control/native-room-connection";
import { SharedLiveRoomControlError } from "../../services/shared-live-room-control/service";
import { verifyOwnerResultDisclosure } from "../../services/shared-live-room-control/result-disclosure-proof";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

async function setup() {
  const f = await disclosureFixture(); cleanup.push(() => f.pool.end());
  const account = { profileId: "owner", sessionId: "native-private-session" };
  const token = "synthetic-room-oauth-token";
  const auth = vi.fn(async (req: express.Request) => {
    if (req.get("authorization") !== `Bearer ${token}`) throw new SharedLiveRoomControlError(401, "unauthorized", "Sign in required.");
    return f.principal;
  });
  const app = express();
  app.use("/api/v1/rooms", createHelixSharedLiveRoomRouter({ authenticate: auth,
    ownerResultDisclosureService: f.service, rateLimit: false, enforceTransportSecurity: false }));
  const state = { mutate: (_body: any) => {}, loseReply: false, disconnect: false };
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const path = new URL(String(url)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (path === "/api/v1/rooms/owner-result") {
      expect(verifyOwnerResultDisclosure(f.authority, body, f.clock.value)).toBe(true);
      expect(JSON.stringify(body)).not.toMatch(/native-private-session|binding_id|chat_session_id|client_session_ref|private_key/);
      expect(init?.redirect).toBe("error");
      expect(JSON.stringify(init?.headers)).not.toMatch(/cookie|x-casimir-desktop/i);
      const result = await request(app).post(path).set(init!.headers as Record<string, string>).send(body);
      expect(result.headers["cache-control"]).toContain("no-store");
      if (state.loseReply) throw new Error("fixture reply lost after commit");
      state.mutate(result.body);
      if (state.disconnect) connection.disconnect();
      return new Response(JSON.stringify(result.body), { status: result.status });
    }
    const result = path.endsWith("/owner-node")
      ? await (body.operation.startsWith("handoff_") ? f.handoffs : f.attachments).operate(f.principal, body)
      : { schema: "helix.shared_live_room.list_receipt.v1", operation: "room.list", ok: true, rooms: [],
          reentry_required: true, answer_authority: false, assistant_answer: false, terminal_eligible: false, raw_content_included: false };
    return new Response(JSON.stringify(result), { status: 200 });
  });
  const connection = new NativeSharedLiveRoomConnection({ origin: f.authority, fetch, now: () => f.clock.value,
    verifier: { audience: () => `${f.authority}/mcp`, authorizationServer: () => f.principal.issuer, providerAlias: () => "auth0",
      verify: async () => ({ issuer: f.principal.issuer, subject: f.principal.subjectId, tenantId: f.principal.tenantId,
        scopes: f.principal.scopes, expiresAt: f.principal.tokenExpiresAt!, claims: {} }) } });
  await connection.connect(account, token);
  const attachment = nativeHostedRoomAttachmentSchema.parse((await connection.reserveOwnerNode(account, f.roomId, 1, "native-replace")).attachment);
  // The previous node's claim cannot transfer to this new private key.
  f.capture.handoff_id = "handoff:native-fresh";
  const digest = "d".repeat(64);
  await connection.claimOwnerNodeHandoff(account, f.roomId, attachment, f.capture, digest);
  const disclose = (authorize?: () => Promise<void>) => connection.discloseOwnerNodeResult(account, f.roomId, attachment, f.capture, digest, f.report, authorize);
  const rows = async () => (await f.pool.query("SELECT * FROM helix_room_task_disclosures")).rows;
  return { ...f, account, token, app, auth, state, fetch, connection, attachment, disclose, rows };
}

describe("native signed report through the hosted OAuth HTTP boundary", () => {
  it("stores exactly the approved report once and returns only a non-answer acknowledgement", async () => {
    const f = await setup();
    const first = await f.disclose(), retry = await f.disclose();
    expect(retry).toEqual(first);
    expect(first).toMatchObject({ room_disclosure_recorded: true, room_presentation_confirmed: false,
      raw_content_included: false, terminal_eligible: false, disclosure: { task_status: "unable", result_sha256: f.report.result_sha256 } });
    expect(JSON.stringify(first)).not.toContain(f.report.result_text);
    expect(await f.rows()).toHaveLength(1);
    expect((await f.rows())[0].result_text).toBe(f.report.result_text);
  });

  it.each(["hash", "status", "capture", "claim", "ref", "future", "extra", "answer"])("rejects a changed %s receipt", async kind => {
    const f = await setup();
    f.state.mutate = body => {
      if (kind === "hash") body.disclosure.result_sha256 = "e".repeat(64);
      if (kind === "status") body.disclosure.task_status = "completed";
      if (kind === "capture") body.capture.consent_version++;
      if (kind === "claim") body.claim.dispatch_digest = "e".repeat(64);
      if (kind === "ref") body.disclosure.disclosure_ref = `room_task_disclosure:${"e".repeat(32)}`;
      if (kind === "future") body.disclosure.created_at = new Date(f.clock.value + 60000).toISOString();
      if (kind === "extra") body.private_task_id = "unexpected";
      if (kind === "answer") body.answer_authority = true;
    };
    await expect(f.disclose()).rejects.toMatchObject({ outcomeUnknown: true });
    expect(await f.rows()).toHaveLength(1);
  });

  it("does not retry a lost acknowledgement; an explicit identical retry recovers the immutable disclosure", async () => {
    const f = await setup(); f.state.loseReply = true;
    await expect(f.disclose()).rejects.toMatchObject({ code: "room_transport_failed", outcomeUnknown: true });
    expect(f.fetch.mock.calls.filter(([url]) => String(url).endsWith("/owner-result"))).toHaveLength(1);
    f.state.loseReply = false;
    await expect(f.disclose()).resolves.toMatchObject({ room_disclosure_recorded: true });
    expect(await f.rows()).toHaveLength(1);
  });

  it("allows the same bounded clock skew as owner-node proofs", async () => {
    const f = await setup();
    f.state.mutate = body => { body.disclosure.created_at = new Date(f.clock.value + 3_000).toISOString(); };
    await expect(f.disclose()).resolves.toMatchObject({ room_disclosure_recorded: true });
  });

  it("rechecks private authority after remote preflight and sends no report if it was revoked", async () => {
    const f = await setup(), before = f.fetch.mock.calls.length;
    const authorize = vi.fn(async () => { throw new Error("native pairing revoked"); });
    await expect(f.disclose(authorize)).rejects.toThrow("native pairing revoked");
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(f.fetch.mock.calls.slice(before).map(([url]) => String(url))).toEqual([`${f.authority}/api/v1/rooms/owner-node`]);
    expect(await f.rows()).toHaveLength(0);
  });

  it("rechecks connection identity after private authority validation", async () => {
    const f = await setup();
    await expect(f.disclose(async () => { f.connection.disconnect(); })).rejects.toMatchObject({ code: "room_connection_changed" });
    expect(f.fetch.mock.calls.filter(([url]) => String(url).endsWith("/owner-result"))).toHaveLength(0);
    expect(await f.rows()).toHaveLength(0);
  });

  it("withholds success after disconnect during the commit response", async () => {
    const f = await setup(); f.state.disconnect = true;
    await expect(f.disclose()).rejects.toMatchObject({ code: "room_connection_changed", outcomeUnknown: true });
    expect(await f.rows()).toHaveLength(1);
  });

  it.each(["hash", "credential", "extra", "unapproved"])("rejects %s before sending report content", async kind => {
    const f = await setup(), before = f.fetch.mock.calls.length;
    if (kind === "hash") f.report.result_sha256 = "0".repeat(64);
    if (kind === "credential") { f.report.result_text = f.token; f.report.result_sha256 = crypto.createHash("sha256").update(f.token).digest("hex"); }
    if (kind === "extra") Object.assign(f.report, { private_task_id: "private" });
    if (kind === "unapproved") Object.assign(f.report, { share_with_room: false });
    await expect(f.disclose()).rejects.toThrow();
    expect(f.fetch).toHaveBeenCalledTimes(before); expect(await f.rows()).toHaveLength(0);
  });

  it.each(["no-auth", "cookie-only", "query", "body-extra", "report-extra", "unsigned"])("rejects HTTP %s", async kind => {
    const f = await setup(), body: any = f.request();
    const path = `/api/v1/rooms/owner-result${kind === "query" ? "?room_id=other" : ""}`;
    if (kind === "body-extra") body.private_task_id = "private";
    if (kind === "report-extra") body.report.private_task_id = "private";
    if (kind === "unsigned") delete body.signature;
    let req = request(f.app).post(path);
    if (kind !== "no-auth" && kind !== "cookie-only") req = req.set("Authorization", `Bearer ${f.token}`);
    if (kind === "cookie-only") req = req.set("Cookie", "helix_session=synthetic");
    const result = await req.send(body);
    expect(result.status).toBe(kind === "no-auth" || kind === "cookie-only" ? 401 : 400);
    expect(await f.rows()).toHaveLength(0);
  });
});
