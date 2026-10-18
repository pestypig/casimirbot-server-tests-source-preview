import { newDb } from "pg-mem";
import { afterEach, expect, it, vi } from "vitest";
import { migration093 } from "../../../db/migrations/093_room_external_task_result";
import { migration098 } from "../../../db/migrations/098_native_hosted_room_results";
import { RoomMissionResultRepository, createRoomMissionResult, projectRoomMissionResultReceipt } from "../room-mission-result";
import { ephemeralPairingVault } from "./pairing-vault-fixture";
import { hostedResultRecord, resultFixtureNow } from "./native-hosted-room-result-fixture";

const pools: Array<{ end(): Promise<void> }> = [];
afterEach(async () => { await Promise.all(pools.splice(0).map(pool => pool.end())); });
async function fixture() {
  const pool = new (newDb().adapters.createPg().Pool)(); pools.push(pool);
  await pool.query("CREATE TABLE helix_accounts(profile_id text PRIMARY KEY)");
  await pool.query("CREATE TABLE helix_shared_realtime_rooms(room_id text PRIMARY KEY)");
  await pool.query("INSERT INTO helix_accounts VALUES ('profile:result-owner')");
  const db = await pool.connect();
  try { for (const migration of [migration093, migration098]) await migration.run(db, { enablePgvector: false }); }
  finally { db.release(); }
  const vault = ephemeralPairingVault(), flush = vi.fn(async () => {});
  const hosted = new RoomMissionResultRepository(pool, vault, flush, "hosted");
  const local = new RoomMissionResultRepository(pool, vault, flush);
  return { pool, vault, flush, hosted, local, record: hostedResultRecord() };
}

it("stores and recovers an encrypted hosted observation without a local room or a public answer", async () => {
  const f = await fixture(), row = f.record;
  expect(await f.hosted.submit(row)).toEqual(row);
  const recovered = new RoomMissionResultRepository(f.pool, f.vault, f.flush, "hosted");
  expect(await recovered.submit({ ...row, createdAt: "2026-09-25T17:00:01.000Z" })).toEqual(row);
  expect(await recovered.read(row.ownerProfileId, row.request.steeringEventRef)).toEqual(row);
  expect(await f.local.read(row.ownerProfileId, row.request.steeringEventRef)).toBeNull();
  expect((await f.pool.query("SELECT * FROM helix_shared_realtime_rooms")).rows).toEqual([]);
  const stored = (await f.pool.query("SELECT * FROM helix_native_hosted_room_results")).rows;
  expect(stored).toHaveLength(1);
  expect(JSON.stringify(stored)).not.toMatch(/A private task report|task:private|connection:private|session:private|https:\/\/rooms.test|observation:private/);
  expect(projectRoomMissionResultReceipt(row)).toMatchObject({ observation_recorded: true,
    room_publication_attempted: false, answer_authority: false, assistant_answer: false,
    terminal_eligible: false, raw_content_included: false });
  const query = { ownerProfileId: row.ownerProfileId, roomId: row.envelope.roomId,
    missionId: row.envelope.roomMissionId, missionRevision: row.envelope.roomMissionRevision };
  expect(await recovered.listEventRefs(query)).toEqual([row.request.steeringEventRef]);
  expect(await f.local.listEventRefs(query)).toEqual([]);
  for (const patch of [{ ownerProfileId: "profile:other" }, { roomId: "room:other" },
    { missionId: "selection:other" }, { missionRevision: 2 }]) {
    expect(await recovered.listEventRefs({ ...query, ...patch })).toEqual([]);
  }
});

it("keeps local and hosted writes in distinct scopes before sealing or committing", async () => {
  const f = await fixture();
  await expect(f.local.submit(f.record)).rejects.toMatchObject({ code: "room_task_result_scope_mismatch" });
  const local = createRoomMissionResult({ ...f.record, envelope: { ...f.record.envelope, hosted: undefined }, now: resultFixtureNow });
  await expect(f.hosted.submit(local)).rejects.toMatchObject({ code: "room_task_result_scope_mismatch" });
  expect(f.flush).not.toHaveBeenCalled();
  expect((await f.pool.query("SELECT * FROM helix_native_hosted_room_results")).rows).toEqual([]);
});

it("cannot move hosted ciphertext into the local result table even with identical indexed identity", async () => {
  const f = await fixture(); await f.hosted.submit(f.record);
  await f.pool.query("INSERT INTO helix_shared_realtime_rooms VALUES ($1)", [f.record.envelope.roomId]);
  await f.pool.query("INSERT INTO helix_room_external_task_results SELECT * FROM helix_native_hosted_room_results");
  await expect(f.local.read(f.record.ownerProfileId, f.record.request.steeringEventRef)).rejects.toThrow("pairing_storage_unreadable");
});

it.each(["room_id", "room_mission_id", "room_mission_revision", "request_digest"])("rejects tampered indexed %s", async field => {
  const f = await fixture(); await f.hosted.submit(f.record);
  await f.pool.query(`UPDATE helix_native_hosted_room_results SET ${field}=$1`, [field === "room_mission_revision" ? 2 : "changed"]);
  await expect(f.hosted.read(f.record.ownerProfileId, f.record.request.steeringEventRef)).rejects.toThrow("pairing_storage_identity_mismatch");
});

it("commits at most one result for competing text and never overwrites the winner", async () => {
  const f = await fixture();
  const changed = createRoomMissionResult({ ...f.record, request: { ...f.record.request, resultText: "Another report." }, now: resultFixtureNow });
  const settled = await Promise.allSettled([f.hosted.submit(f.record), f.hosted.submit(changed)]);
  expect(settled.filter(value => value.status === "fulfilled")).toHaveLength(1);
  const failed = settled.find(value => value.status === "rejected") as PromiseRejectedResult;
  expect(failed.reason).toMatchObject({ code: "room_task_result_request_conflict" });
  expect((await f.pool.query("SELECT * FROM helix_native_hosted_room_results")).rows).toHaveLength(1);
});

it("preserves local room deletion and independent hosted account deletion behavior", async () => {
  const f = await fixture(); await f.hosted.submit(f.record);
  await f.pool.query("INSERT INTO helix_shared_realtime_rooms VALUES ($1)", [f.record.envelope.roomId]);
  const local = createRoomMissionResult({ ...f.record, envelope: { ...f.record.envelope, hosted: undefined }, now: resultFixtureNow });
  await f.local.submit(local);
  await f.pool.query("DELETE FROM helix_shared_realtime_rooms WHERE room_id=$1", [f.record.envelope.roomId]);
  expect(await f.local.read(local.ownerProfileId, local.request.steeringEventRef)).toBeNull();
  expect(await f.hosted.read(f.record.ownerProfileId, f.record.request.steeringEventRef)).toEqual(f.record);
  await f.pool.query("DELETE FROM helix_accounts WHERE profile_id=$1", [f.record.ownerProfileId]);
  expect(await f.hosted.read(f.record.ownerProfileId, f.record.request.steeringEventRef)).toBeNull();
});
