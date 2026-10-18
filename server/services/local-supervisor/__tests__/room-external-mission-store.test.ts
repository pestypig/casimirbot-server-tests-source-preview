import { newDb } from "pg-mem";
import { afterEach, expect, it } from "vitest";
import { migration092 } from "../../../db/migrations/092_room_external_mission";
import { RoomExternalMissionStore } from "../room-external-mission-store";
import type { withSharedRealtimeRoomTransaction,
  readSharedRealtimeRoomDatabase } from "../../helix-ask/realtime-room/room-store/database";

const pools: Array<{ end(): Promise<void> }> = [];
afterEach(async () => { await Promise.all(pools.splice(0).map(pool => pool.end())); });

const fixture = async () => {
  const pool = new (newDb().adapters.createPg().Pool)();
  pools.push(pool);
  await pool.query("CREATE TABLE helix_accounts(profile_id text PRIMARY KEY)");
  await pool.query("CREATE TABLE helix_shared_realtime_rooms(room_id text PRIMARY KEY)");
  await pool.query("INSERT INTO helix_accounts VALUES ('owner:mission')");
  await pool.query("INSERT INTO helix_shared_realtime_rooms VALUES ('room:mission')");
  const client = await pool.connect();
  try { await migration092.run(client, { enablePgvector: false }); }
  finally { client.release(); }
  const transaction = async <T>(run: (db: typeof client) => Promise<T>): Promise<T> => {
    const tx = await pool.connect();
    try {
      await tx.query("BEGIN");
      const result = await run(tx);
      await tx.query("COMMIT");
      return result;
    } catch (error) {
      await tx.query("ROLLBACK");
      throw error;
    } finally { tx.release(); }
  };
  const store = new RoomExternalMissionStore(
    transaction as typeof withSharedRealtimeRoomTransaction,
    (async () => pool) as typeof readSharedRealtimeRoomDatabase,
    () => new Date("2026-09-24T21:30:00.000Z"),
  );
  return { pool, store };
};

const selection = {
  roomId: "room:mission", ownerProfileId: "owner:mission",
  ownerParticipantId: "participant:owner", bindingId: "reasoning_binding:fixture",
  bindingEpoch: 3, helixConversationId: "chat:mission",
  bindingMissionId: null, runId: "run:mission",
  expectedRevision: null, requestId: "select:first",
};

it("persists one owner-selected mission and fences retry, reselect, revoke and stale revisions", async () => {
  const { pool, store } = await fixture();
  const first = await store.select(selection);
  expect(first).toMatchObject({ room_id: selection.roomId, status: "active",
    mission_revision: 1, reasoning_binding_id: selection.bindingId,
    binding_epoch: selection.bindingEpoch, execution_authority: false,
    answer_authority: false, terminal_eligible: false });
  expect(await store.inspect(selection.roomId)).toEqual(first);
  expect(await store.select(selection)).toEqual(first);
  await expect(store.select({ ...selection, bindingEpoch: 4 })).rejects.toThrow("room_mission_request_conflict");
  await expect(store.select({ ...selection, requestId: "select:stale" })).rejects.toThrow("room_mission_revision_conflict");
  const second = await store.select({ ...selection, bindingEpoch: 4,
    expectedRevision: 1, requestId: "select:second" });
  expect(second).toMatchObject({ mission_id: first.mission_id, mission_revision: 2,
    binding_epoch: 4, status: "active" });
  const revoked = await store.revoke({ roomId: selection.roomId,
    ownerProfileId: selection.ownerProfileId, expectedRevision: 2,
    requestId: "revoke:mission" });
  expect(revoked).toMatchObject({ mission_revision: 3, status: "revoked" });
  expect(await store.revoke({ roomId: selection.roomId,
    ownerProfileId: selection.ownerProfileId, expectedRevision: 2,
    requestId: "revoke:mission" })).toEqual(revoked);
  await expect(store.select({ ...selection, expectedRevision: 2,
    requestId: "select:after-revoke-stale" })).rejects.toThrow("room_mission_revision_conflict");
  const resumed = await store.select({ ...selection, expectedRevision: 3,
    requestId: "select:resumed" });
  expect(resumed).toMatchObject({ mission_id: first.mission_id,
    mission_revision: 4, status: "active" });
  expect((await pool.query("SELECT count(*) AS count FROM helix_room_external_missions")).rows[0].count).toBe(1);
});

it("requires the current exact mission tuple after reselection and revoke", async () => {
  const { store } = await fixture();
  const first = await store.select(selection);
  const identity = { roomId: selection.roomId, ownerProfileId: selection.ownerProfileId,
    bindingId: selection.bindingId, bindingEpoch: selection.bindingEpoch,
    helixConversationId: selection.helixConversationId,
    bindingMissionId: selection.bindingMissionId, runId: selection.runId,
    missionId: first.mission_id, missionRevision: first.mission_revision };
  expect(await store.requireCurrent(identity)).toEqual(first);
  await expect(store.requireCurrent({ ...identity, roomId: "room:other" }))
    .rejects.toThrow("room_mission_not_current");
  await expect(store.requireCurrent({ ...identity, bindingEpoch: 4 }))
    .rejects.toThrow("room_mission_not_current");
  const second = await store.select({ ...selection, expectedRevision: 1,
    requestId: "select:updated" });
  await expect(store.requireCurrent(identity)).rejects.toThrow("room_mission_not_current");
  const current = { ...identity, missionRevision: second.mission_revision };
  expect(await store.requireCurrent(current)).toEqual(second);
  await store.revoke({ roomId: selection.roomId,
    ownerProfileId: selection.ownerProfileId, expectedRevision: second.mission_revision,
    requestId: "revoke:updated" });
  await expect(store.requireCurrent(current)).rejects.toThrow("room_mission_not_current");
});
