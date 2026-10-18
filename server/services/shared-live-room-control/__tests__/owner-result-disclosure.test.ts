import crypto from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { disclosureFixture } from "./owner-result-disclosure-fixture";
import { signOwnerResultDisclosure, verifyOwnerResultDisclosure } from "../result-disclosure-proof";
import { RoomOwnerResultDisclosureService } from "../owner-result-disclosure-service";
import type { withSharedRealtimeRoomTransaction } from "../../helix-ask/realtime-room/room-store/database";

const pools: Array<{ end(): Promise<void> }> = [];
const fixture = async () => { const f = await disclosureFixture(); pools.push(f.pool); return f; };
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(pools.splice(0).map(pool => pool.end())); });
const rows = async (f: Awaited<ReturnType<typeof fixture>>) => (await f.pool.query("SELECT * FROM helix_room_task_disclosures")).rows;

it("records one explicitly approved report against the current claim without nested node locks or terminal authority", async () => {
  const f = await fixture(); f.lock.rejectNested = true;
  const receipt = await f.service.disclose(f.principal, f.request());
  expect(receipt).toMatchObject({ room_disclosure_recorded: true, room_presentation_confirmed: false,
    raw_content_included: false, answer_authority: false, terminal_eligible: false,
    disclosure: { task_status: "unable", result_sha256: f.report.result_sha256, content_role: "untrusted_external_task_observation" } });
  expect(JSON.stringify(receipt)).not.toContain(f.report.result_text);
  expect(await f.service.disclose(f.principal, f.request())).toEqual(receipt);
  expect(await rows(f)).toHaveLength(1);
  expect((await rows(f))[0]).toMatchObject({ result_text: f.report.result_text, claim_ref: f.claim.claim_ref, owner_profile_id: "owner" });
  expect(f.transaction).toHaveBeenCalledWith(expect.any(Function), { requireLocalSnapshot: true, snapshotTables: ["helix_room_task_disclosures"] });
});

it.each(["text", "hash", "status", "claim", "room", "signature", "approval"])("rejects a tampered %s proof before storing", async kind => {
  const f = await fixture(), body = f.request();
  if (kind === "text") body.report.result_text = "Different report.";
  if (kind === "hash") body.report.result_sha256 = "c".repeat(64);
  if (kind === "status") body.report.task_status = "completed";
  if (kind === "claim") body.authorization.dispatch_digest = "c".repeat(64);
  if (kind === "room") body.authorization.room_id = "shared_realtime_room:other";
  if (kind === "signature") body.signature = f.sign().signature;
  if (kind === "approval") Object.assign(body.report, { share_with_room: false });
  await expect(f.service.disclose(f.principal, body)).rejects.toThrow(); expect(await rows(f)).toEqual([]);
});

it("binds the distinct disclosure domain and rejects a changed authority", async () => {
  const f = await fixture(), body = f.request();
  expect(verifyOwnerResultDisclosure(f.authority, body, f.clock.value)).toBe(true);
  expect(verifyOwnerResultDisclosure("https://another.test", body, f.clock.value)).toBe(false);
  body.signature = body.authorization.signature;
  expect(verifyOwnerResultDisclosure(f.authority, body, f.clock.value)).toBe(false);
});

it.each(["guest", "scope", "expired", "user", "consent", "node"])("rejects unavailable %s authority", async kind => {
  const f = await fixture(), body = f.request();
  if (kind === "guest") f.principal.accountProfileId = "guest";
  if (kind === "scope") f.principal.scopes = new Set(["helix.rooms.read"]);
  if (kind === "expired") f.clock.value += 61000;
  if (kind === "user") f.principal.accountContext.account_policy!.account_type = "user";
  if (kind === "consent") f.valid.capture = false;
  if (kind === "node") await f.attachments.operate(f.principal, f.reserve(crypto.generateKeyPairSync("ed25519"), 1));
  await expect(f.service.disclose(f.principal, body)).rejects.toThrow(); expect(await rows(f)).toEqual([]);
});

it("rejects different report content for an already disclosed capture", async () => {
  const f = await fixture(); await f.service.disclose(f.principal, f.request()); f.report.task_status = "completed";
  await expect(f.service.disclose(f.principal, f.request())).rejects.toMatchObject({ code: "idempotency_conflict" });
  expect((await rows(f))[0].task_status).toBe("unable");
});

it("rechecks replacement after capture admission and before the write", async () => {
  const f = await fixture();
  const service = new RoomOwnerResultDisclosureService({ handoffs: f.handoffs, authority: () => f.authority, now: () => f.clock.value,
    transaction: (async run => {
      await f.attachments.operate(f.principal, f.reserve(crypto.generateKeyPairSync("ed25519"), 1));
      return f.transaction(run as never);
    }) as typeof withSharedRealtimeRoomTransaction });
  await expect(service.disclose(f.principal, f.request())).rejects.toMatchObject({ code: "room_runtime_conflict" });
  expect(await rows(f)).toEqual([]);
});

it("rechecks capture consent inside the guarded commit without taking another attachment transaction", async () => {
  const f = await fixture();
  const original = f.handoffs.readCurrentCapture.bind(f.handoffs);
  vi.spyOn(f.handoffs, "readCurrentCapture").mockImplementation(async (...args) => {
    if (f.lock.depth) return null; return original(...args);
  });
  await expect(f.service.disclose(f.principal, f.request())).rejects.toMatchObject({ code: "room_runtime_conflict" });
  expect(await rows(f)).toEqual([]);
});

it("recovers an exact committed report after an uncertain snapshot reply", async () => {
  const f = await fixture();
  f.flush.mockImplementation(async () => { if ((await rows(f)).length) throw new Error("fixture snapshot unavailable"); });
  await expect(f.service.disclose(f.principal, f.request())).rejects.toThrow("fixture snapshot unavailable");
  expect(await rows(f)).toHaveLength(1); f.flush.mockResolvedValue(undefined);
  expect(await f.service.disclose(f.principal, f.request())).toMatchObject({ room_disclosure_recorded: true });
  expect(await rows(f)).toHaveLength(1);
});

it("withholds a post-commit receipt after source revocation without claiming rollback", async () => {
  const f = await fixture();
  f.flush.mockImplementation(async () => { if ((await rows(f)).length) f.valid.capture = false; });
  await expect(f.service.disclose(f.principal, f.request())).rejects.toMatchObject({ code: "room_runtime_conflict" });
  expect(await rows(f)).toHaveLength(1);
});

it("rejects protected credentials and unreviewed private context fields", async () => {
  const f = await fixture();
  const report = { ...f.report, result_text: "Authorization: Bearer fixture-credential-value" };
  report.result_sha256 = crypto.createHash("sha256").update(report.result_text).digest("hex");
  await expect(f.service.disclose(f.principal, signOwnerResultDisclosure(f.authority,
    { authorization: f.sign(), report }, f.key.privateKey))).rejects.toMatchObject({ code: "protected_sensitive_content_rejected" });
  await expect(f.service.disclose(f.principal, { ...f.request(), local_task_id: "task:private" })).rejects.toThrow();
  expect(await rows(f)).toEqual([]);
});
