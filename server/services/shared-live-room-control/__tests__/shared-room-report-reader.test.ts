import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, expect, it, vi } from "vitest";
import { disclosureFixture } from "./owner-result-disclosure-fixture";
import { SharedRoomReportReader } from "../shared-room-report-reader";
import { SharedLiveRoomControlError } from "../service";
import { createHelixSharedLiveRoomRouter } from "../../../routes/helix-shared-live-rooms";

const pools: Array<{ end(): Promise<void> }> = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(pools.splice(0).map(p => p.end())); });
async function fixture() {
  const f = await disclosureFixture(); pools.push(f.pool);
  const saved = await f.service.disclose(f.principal, f.request());
  const guest = { ...f.principal, accountProfileId: "guest", subjectId: "subject:guest", scopes: new Set(["helix.rooms.read"]),
    accountContext: { ...f.principal.accountContext, profile_id: "guest", session_id: "oauth:guest" } };
  const membership = vi.fn(async ({ roomId, profileId }: { roomId: string; profileId: string }) => {
    const member = (await f.pool.query("SELECT * FROM helix_shared_realtime_room_members WHERE room_id=$1 AND profile_id=$2", [roomId, profileId])).rows[0];
    const room = (await f.pool.query("SELECT * FROM helix_shared_realtime_rooms WHERE room_id=$1", [roomId])).rows[0];
    return member && room ? { roomId, profileId, participantId: member.participant_id, role: member.member_role,
      presence: member.presence, roomStatus: room.status } : null;
  });
  const capture = vi.fn(f.handoffs.readCurrentCapture.bind(f.handoffs));
  const dependencies = { transaction: f.transaction as never, membership: membership as never, capture, now: () => f.clock.value };
  const reader = new SharedRoomReportReader(dependencies);
  const body = { room_id: f.roomId, disclosure_ref: saved.disclosure.disclosure_ref, result_sha256: f.report.result_sha256 };
  const app = express().use("/api/v1/rooms", createHelixSharedLiveRoomRouter({ sharedReportReader: reader,
    rateLimit: false, enforceTransportSecurity: false, authenticate: async req => {
      if (req.get("Authorization") === "Bearer synthetic-guest") return guest;
      if (req.get("Authorization") === "Bearer synthetic-owner") return f.principal;
      throw new SharedLiveRoomControlError(401, "unauthorized", "Sign in required.");
    } }));
  const base = `/api/v1/rooms/${encodeURIComponent(f.roomId)}/task-reports`;
  return { ...f, guest, reader, dependencies, membership, capture, body, app, base };
}

it("lets an independently authenticated read-only guest list metadata and inspect exact owner-approved text", async () => {
  const f = await fixture();
  const catalog = await request(f.app).get(f.base).set("Authorization", "Bearer synthetic-guest").expect(200);
  expect(catalog.headers["cache-control"]).toContain("no-store");
  expect(catalog.body).toMatchObject({ raw_content_included: false, reports: [{ task_status: "unable", result_sha256: f.report.result_sha256 }] });
  expect(JSON.stringify(catalog.body)).not.toContain(f.report.result_text);
  const observed = await request(f.app).get(`${f.base}/${f.body.disclosure_ref}`).query({ result_sha256: f.body.result_sha256 })
    .set("Authorization", "Bearer synthetic-guest").expect(200);
  expect(observed.body).toMatchObject({ raw_content_included: true, result_text: f.report.result_text,
    answer_authority: false, terminal_eligible: false, report: { content_role: "untrusted_external_task_observation" } });
  expect(JSON.stringify(observed.body)).not.toMatch(/claim_ref|dispatch_digest|owner_identity_digest|node_ref|handoff_id|participant_id|runtime_id|private_key/);
  expect(await f.reader.inspect(f.principal, f.body)).toEqual(observed.body);
  expect(f.capture).toHaveBeenCalledWith({ accountProfileId: "owner" }, f.roomId, f.capture.mock.calls[0][2]);
});

it.each(["nonmember", "away", "left", "owner-away", "closed", "scope", "expired-token", "user", "locked"])("denies %s without returning report text", async kind => {
  const f = await fixture();
  if (kind === "nonmember") f.guest.accountProfileId = "stranger";
  if (kind === "away" || kind === "left") await f.pool.query("UPDATE helix_shared_realtime_room_members SET presence=$1 WHERE profile_id='guest'", [kind]);
  if (kind === "owner-away") await f.pool.query("UPDATE helix_shared_realtime_room_members SET presence='away' WHERE profile_id='owner'");
  if (kind === "closed") await f.pool.query("UPDATE helix_shared_realtime_rooms SET status='closed'");
  if (kind === "scope") f.guest.scopes.clear();
  if (kind === "expired-token") f.guest.tokenExpiresAt = new Date(f.clock.value - 1).toISOString();
  if (kind === "user") f.guest.accountContext.account_policy!.account_type = "user";
  if (kind === "locked") f.guest.accountContext.account_policy!.locked_features.push("shared_realtime_rooms");
  await expect(f.reader.inspect(f.guest, f.body)).rejects.toMatchObject({ code: "room_forbidden" });
});

it.each(["consent", "node-revoked", "node-expired", "node-replaced", "owner-handoff"])("omits %s reports from catalog and rejects their exact read", async kind => {
  const f = await fixture();
  if (kind === "consent") f.valid.capture = false;
  if (kind === "node-revoked") await f.pool.query("UPDATE helix_room_owner_node_attachments SET status='revoked'");
  if (kind === "node-expired") f.clock.value += 16 * 60000;
  if (kind === "node-replaced") await f.attachments.operate(f.principal, f.reserve(crypto.generateKeyPairSync("ed25519"), 1));
  if (kind === "owner-handoff") {
    await f.pool.query("UPDATE helix_shared_realtime_rooms SET owner_profile_id='guest'");
    await f.pool.query("UPDATE helix_shared_realtime_room_members SET member_role='participant' WHERE profile_id='owner'");
    await f.pool.query("UPDATE helix_shared_realtime_room_members SET member_role='owner' WHERE profile_id='guest'");
  }
  expect(await f.reader.list(f.guest, { room_id: f.roomId })).toMatchObject({ reports: [], raw_content_included: false });
  await expect(f.reader.inspect(f.guest, f.body)).rejects.toMatchObject({ code: "room_runtime_conflict" });
});

it.each(["text", "hash", "status", "capture", "digest", "claim-digest"])("rejects stored %s corruption instead of admitting altered evidence", async kind => {
  const f = await fixture();
  if (kind === "text") await f.pool.query("UPDATE helix_room_task_disclosures SET result_text='Different report'");
  if (kind === "hash") await f.pool.query("UPDATE helix_room_task_disclosures SET result_sha256=$1", ["f".repeat(64)]);
  if (kind === "status") await f.pool.query("UPDATE helix_room_task_disclosures SET task_status='completed'");
  if (kind === "capture") {
    const original = (await f.pool.query("SELECT capture FROM helix_room_task_disclosures")).rows[0].capture;
    await f.pool.query("UPDATE helix_room_task_disclosures SET capture=$1::jsonb", [JSON.stringify({ ...original, consent_version: original.consent_version + 1 })]);
  }
  if (kind === "digest") await f.pool.query("UPDATE helix_room_task_disclosures SET report_digest='changed'");
  if (kind === "claim-digest") await f.pool.query("UPDATE helix_room_owner_handoff_claims SET dispatch_digest=$1", ["f".repeat(64)]);
  await expect(f.reader.inspect(f.guest, f.body)).rejects.toThrow();
});

it("withholds a read after consent changes between the two authoritative snapshots", async () => {
  const f = await fixture(); let calls = 0;
  const transaction = vi.fn(async (run: never) => {
    const value = await f.transaction(run); if (++calls === 1) f.valid.capture = false; return value;
  });
  const reader = new SharedRoomReportReader({ ...f.dependencies, transaction: transaction as never });
  await expect(reader.inspect(f.guest, f.body)).rejects.toMatchObject({ code: "room_runtime_conflict" });
});

it("withholds a read when the final membership check loses the guest", async () => {
  const f = await fixture();
  f.membership.mockResolvedValueOnce({ roomId: f.roomId, profileId: "guest", participantId: "participant:guest", role: "guest", presence: "present", roomStatus: "ready" })
    .mockResolvedValueOnce({ roomId: f.roomId, profileId: "guest", participantId: "participant:guest", role: "guest", presence: "present", roomStatus: "ready" })
    .mockResolvedValueOnce(null);
  await expect(f.reader.inspect(f.guest, f.body)).rejects.toMatchObject({ code: "room_forbidden" });
});

it("propagates source outages instead of returning an empty catalog or cached report", async () => {
  const f = await fixture(); f.capture.mockRejectedValue(new Error("fixture capture service unavailable"));
  await expect(f.reader.list(f.guest, { room_id: f.roomId })).rejects.toThrow("fixture capture service unavailable");
});

it("releases the database transaction before capture validation needs another connection", async () => {
  const f = await fixture();
  f.capture.mockImplementation(async (...args) => {
    expect(f.lock.depth).toBe(0); return f.handoffs.readCurrentCapture(...args);
  });
  await expect(f.reader.inspect(f.guest, f.body)).resolves.toMatchObject({ result_text: f.report.result_text });
});

it("admits an empty catalog for a current member without requiring a private task or node", async () => {
  const f = await fixture();
  await f.pool.query("DELETE FROM helix_room_task_disclosures");
  await f.pool.query("DELETE FROM helix_room_owner_node_attachments");
  expect(await f.reader.list(f.guest, { room_id: f.roomId })).toMatchObject({ reports: [], has_more: false, raw_content_included: false });
  expect(f.capture).not.toHaveBeenCalled();
});

it.each(["missing-auth", "cookie-only", "extra-query", "duplicate-hash", "wrong-hash", "wrong-room", "unknown-ref", "body"])("rejects HTTP %s without text", async kind => {
  const f = await fixture();
  let url = `${f.base}/${f.body.disclosure_ref}`;
  if (kind === "wrong-room") url = url.replace(encodeURIComponent(f.roomId), "shared_realtime_room:other");
  if (kind === "unknown-ref") url = `${f.base}/room_task_disclosure:${"f".repeat(32)}`;
  let req = request(f.app).get(url).query({ result_sha256: kind === "wrong-hash" ? "f".repeat(64) : f.body.result_sha256 });
  if (kind !== "missing-auth" && kind !== "cookie-only") req = req.set("Authorization", "Bearer synthetic-guest");
  if (kind === "cookie-only") req = req.set("Cookie", "helix_session=owner");
  if (kind === "extra-query") req = req.query({ account_profile_id: "owner" });
  if (kind === "duplicate-hash") req = req.query({ result_sha256: "f".repeat(64) });
  if (kind === "body") req = req.send({ task_id: "task:private" });
  const result = await req;
  expect(result.status).toBeGreaterThanOrEqual(400); expect(result.status).toBeLessThan(500);
  expect(JSON.stringify(result.body)).not.toContain(f.report.result_text);
});
