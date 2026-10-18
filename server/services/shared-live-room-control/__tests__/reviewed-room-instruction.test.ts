import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, expect, it, vi } from "vitest";
import { buildHelixAccountCapabilityPolicy } from "@shared/helix-account-session";
import { nativeHostedRoomAttachmentSchema } from "@shared/helix-native-hosted-room-mission";
import { REVIEWED_ROOM_INSTRUCTION_TTL_MS } from "@shared/helix-hosted-room-instruction";
import { ReviewedRoomInstructionService } from "../reviewed-room-instruction";
import { disclosureFixture } from "./owner-result-disclosure-fixture";
import { createOwnerReviewedRoomInstructionRouter } from "../../../routes/owner-reviewed-room-instruction";
import { createHelixSharedLiveRoomRouter } from "../../../routes/helix-shared-live-rooms";

const pools: Array<{ end(): Promise<void> }> = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(pools.splice(0).map(pool => pool.end())); });
async function fixture() {
  const f = await disclosureFixture(); pools.push(f.pool);
  const text = "Consider the guest's constraint.\n" + "Keep this exact sentence, with  two spaces. ".repeat(14);
  f.capture.transcript_text_hash = `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`;
  f.capture.transcript_text_char_count = text.length;
  const service = new ReviewedRoomInstructionService({ attachments: f.attachments, handoffs: f.handoffs,
    now: () => f.clock.value, list: (() => [{ handoff_id: f.capture.handoff_id }]) as never });
  const body = { room_id: f.roomId, attachment: nativeHostedRoomAttachmentSchema.parse(f.reserved.attachment),
    capture: { ...f.capture }, instruction_text: text, approve_transfer: true };
  const sign = () => f.sign({ operation: "handoff_validate", transcript_text_hash: f.capture.transcript_text_hash, dispatch_digest: undefined });
  const status = { session: { session_id: "session:owner", profile: { profile_id: "owner" } }, account_policy: buildHelixAccountCapabilityPolicy("developer") };
  const accountStatus = vi.fn(async () => status), links = vi.fn(async () => ({ bindings: [{ status: "active" }] }));
  const app = express().use(express.json());
  app.use("/api/account", createOwnerReviewedRoomInstructionRouter({ accountStatus: accountStatus as never,
    membership: f.membership as never, accountLinks: { listBindings: links } as never, service, authority: () => f.authority }));
  app.use("/api/v1/rooms", createHelixSharedLiveRoomRouter({ authenticate: async () => f.principal,
    reviewedInstructions: service, rateLimit: false, enforceTransportSecurity: false }));
  const path = `/api/account/session/rooms/${f.roomId}/reviewed-instructions`;
  const approve = () => request(app).post(path).set("Origin", f.authority).send(body);
  return { ...f, service, text, body, signRead: sign, status, accountStatus, links, app, path, approve };
}

it("moves exact reviewed text over authenticated routes while options and approval remain metadata-only", async () => {
  const f = await fixture();
  const options = await request(f.app).get(f.path).expect(200);
  expect(options.body.captures).toEqual([f.capture]); expect(JSON.stringify(options.body)).not.toContain(f.text);
  const saved = await f.approve().expect(200);
  expect(Date.parse(saved.body.expires_at)).toBe(f.clock.value + REVIEWED_ROOM_INSTRUCTION_TTL_MS);
  expect(saved.body.raw_content_included).toBe(false); expect(JSON.stringify(saved.body)).not.toContain(f.text);
  expect(saved.headers["cache-control"]).toBe("no-store");
  const read = await request(f.app).post("/api/v1/rooms/owner-instruction").send(f.signRead()).expect(200);
  expect(read.body).toMatchObject({ transfer_ref: saved.body.transfer_ref, instruction_text: f.text,
    raw_content_included: true, dispatch_authority: false, answer_authority: false });
  expect(read.body.instruction_text.length).toBeGreaterThan(360);
  expect(JSON.stringify(read.body)).not.toMatch(/session:owner|subject:owner|node_public_key|binding_id/);
  f.clock.value += 30_000;
  const retry = await f.approve().expect(200);
  expect(retry.body.transfer_ref).toBe(saved.body.transfer_ref); expect(retry.body.expires_at).toBe(saved.body.expires_at);
  expect((await request(f.app).post("/api/v1/rooms/owner-instruction").send(f.signRead())).body.transfer_ref).toBe(saved.body.transfer_ref);
});

it("caps the transfer deadline at the current attachment expiry", async () => {
  const f = await fixture(), expires = new Date(f.clock.value + 45_000).toISOString();
  await f.pool.query("UPDATE helix_room_owner_node_attachments SET expires_at=$1", [expires]);
  f.body.attachment.expires_at = expires;
  expect((await f.approve().expect(200)).body.expires_at).toBe(expires);
});

it.each(["text", "trim", "hash", "speaker", "runtime", "consent", "attachment", "extra", "unapproved", "absent-capture"])(
  "does not store a %s mismatch", async kind => {
    const f = await fixture();
    if (kind === "text") f.body.instruction_text += "edited";
    if (kind === "trim") f.body.instruction_text = f.body.instruction_text.trim();
    if (kind === "hash") f.body.capture.transcript_text_hash = `sha256:${"f".repeat(64)}`;
    if (kind === "speaker") f.body.capture.speaker_participant_id = "participant:owner";
    if (kind === "runtime") f.body.capture.runtime_id = "runtime:changed";
    if (kind === "consent") f.body.capture.consent_version++;
    if (kind === "attachment") f.body.attachment.revision++;
    if (kind === "extra") Object.assign(f.body, { task_id: "untrusted" });
    if (kind === "unapproved") f.body.approve_transfer = false;
    if (kind === "absent-capture") f.valid.capture = false;
    expect((await f.approve()).status).toBeGreaterThanOrEqual(400);
    await expect(f.service.read(f.principal, f.signRead())).rejects.toThrow();
  });

it.each(["guest", "signout", "policy", "unlinked", "origin", "missing-origin", "session-change"])("rejects %s browser approval", async kind => {
  const f = await fixture();
  if (kind === "guest") f.status.session.profile.profile_id = "guest";
  if (kind === "signout") f.status.session = null as never;
  if (kind === "policy") f.status.account_policy = buildHelixAccountCapabilityPolicy("user");
  if (kind === "unlinked") f.links.mockResolvedValue({ bindings: [] });
  if (kind === "session-change") f.accountStatus.mockImplementationOnce(async () => structuredClone(f.status)).mockImplementation(async () => {
    f.status.session.session_id = "session:changed"; return f.status;
  });
  let req = request(f.app).post(f.path).send(f.body);
  if (kind !== "missing-origin") req = req.set("Origin", kind === "origin" ? "https://foreign.test" : f.authority);
  expect((await req).status).toBeGreaterThanOrEqual(400);
  await expect(f.service.read(f.principal, f.signRead())).rejects.toThrow();
});

it.each(["guest", "scope", "expired-token", "signature", "node-replaced", "node-revoked", "consent-revoked", "owner-away", "room-closed", "expired-transfer", "read-operation"])(
  "rejects %s native retrieval", async kind => {
    const f = await fixture(); await f.approve().expect(200);
    const principal = { ...f.principal, scopes: new Set(f.principal.scopes) }, proof = f.signRead();
    if (kind === "guest") principal.accountProfileId = "guest";
    if (kind === "scope") principal.scopes.delete("helix.rooms.manage");
    if (kind === "expired-token") principal.tokenExpiresAt = new Date(f.clock.value - 1).toISOString();
    if (kind === "signature") proof.signature = "a".repeat(86);
    if (kind === "node-replaced") await f.attachments.operate(f.principal, f.reserve(crypto.generateKeyPairSync("ed25519"), 1));
    if (kind === "node-revoked") await f.pool.query("UPDATE helix_room_owner_node_attachments SET status='revoked'");
    if (kind === "consent-revoked") f.valid.capture = false;
    if (kind === "owner-away") await f.pool.query("UPDATE helix_shared_realtime_room_members SET presence='away' WHERE profile_id='owner'");
    if (kind === "room-closed") await f.pool.query("UPDATE helix_shared_realtime_rooms SET status='closed'");
    if (kind === "expired-transfer") { f.clock.value += REVIEWED_ROOM_INSTRUCTION_TTL_MS + 1; Object.assign(proof, f.signRead()); }
    if (kind === "read-operation") Object.assign(proof, f.sign({ operation: "handoff_claim" }));
    await expect(f.service.read(principal, proof)).rejects.toThrow();
  });

it("does not let a forged read consume or cancel the real node's transfer", async () => {
  const f = await fixture(); await f.approve().expect(200);
  await expect(f.service.read(f.principal, { ...f.signRead(), signature: "a".repeat(86) })).rejects.toThrow();
  expect((await f.service.read(f.principal, f.signRead())).instruction_text).toBe(f.text);
});
