import { newDb } from "pg-mem";
import { afterEach, expect, it } from "vitest";
import { migration093 } from "../../../db/migrations/093_room_external_task_result";
import { ephemeralPairingVault } from "./pairing-vault-fixture";
import { createRoomMissionResult, RoomMissionResultRepository,
  projectRoomMissionResultReceipt } from "../room-mission-result";

const pools: Array<{ end(): Promise<void> }> = [];
afterEach(async () => { await Promise.all(pools.splice(0).map(pool => pool.end())); });

it("persists one encrypted event-correlated result without public answer authority", async () => {
  const pool = new (newDb().adapters.createPg().Pool)();
  pools.push(pool);
  await pool.query("CREATE TABLE helix_accounts(profile_id text PRIMARY KEY)");
  await pool.query("CREATE TABLE helix_shared_realtime_rooms(room_id text PRIMARY KEY)");
  await pool.query("INSERT INTO helix_accounts VALUES ('owner:result')");
  await pool.query("INSERT INTO helix_shared_realtime_rooms VALUES ('room:result')");
  const client = await pool.connect();
  try { await migration093.run(client, { enablePgvector: false }); }
  finally { client.release(); }
  const repository = new RoomMissionResultRepository(pool, ephemeralPairingVault(), async () => {});
  const envelope = { schema: "helix.room_mission_steering.v1" as const,
    roomId: "room:result", ownerProfileId: "owner:result",
    roomMissionId: "room_mission:result", roomMissionRevision: 2,
    handoffId: "handoff:result", realtimeSessionId: "realtime:result",
    runtimeId: "runtime:result", speakerParticipantId: "participant:result",
    capturedAtMs: 1780000000000, consentVersion: 1,
    consentReceiptRef: "consent:result", transcriptTextHash: `sha256:${"a".repeat(64)}`,
    bindingId: "binding:result", bindingEpoch: 3,
    authenticatedMcpClientRef: "client:result", clientSessionRef: "session:result",
    clientContinuationRef: "task:result", helixConversationId: "chat:result",
    bindingMissionId: null, runId: null };
  const request = { steeringEventRef: "reasoning_steering:result",
    status: "completed" as const, resultText: "The terrain is clear.",
    evidenceRefs: ["observation:terrain"] };
  const row = createRoomMissionResult({ ownerProfileId: "owner:result",
    envelope, request, now: new Date("2026-09-24T21:00:00.000Z") });
  expect(await repository.submit(row)).toEqual(row);
  expect(await repository.read("owner:result", request.steeringEventRef)).toEqual(row);
  expect(await repository.submit({ ...row, createdAt: "2026-09-24T21:00:01.000Z" })).toEqual(row);
  await expect(repository.submit(createRoomMissionResult({ ownerProfileId: "owner:result",
    envelope, request: { ...request, resultText: "Different decision" },
    now: new Date("2026-09-24T21:00:02.000Z") })))
    .rejects.toThrow("room_task_result_request_conflict");
  const stored = (await pool.query("SELECT * FROM helix_room_external_task_results")).rows[0];
  expect(JSON.stringify(stored)).not.toContain(request.resultText);
  expect(projectRoomMissionResultReceipt(row)).toMatchObject({
    steering_event_ref: request.steeringEventRef,
    room_mission_revision: 2,
    observation_recorded: true,
    room_publication_attempted: false,
    answer_authority: false,
    terminal_eligible: false,
  });
  const catalogQuery = { ownerProfileId: "owner:result", roomId: "room:result",
    missionId: "room_mission:result", missionRevision: 2 };
  expect(await repository.listEventRefs(catalogQuery)).toEqual([request.steeringEventRef]);
  for (const patch of [{ ownerProfileId: "owner:other" }, { roomId: "room:other" },
    { missionId: "mission:other" }, { missionRevision: 3 }]) {
    expect(await repository.listEventRefs({ ...catalogQuery, ...patch })).toEqual([]);
  }
  await pool.query("UPDATE helix_room_external_task_results SET room_mission_revision=3");
  await expect(repository.read("owner:result", request.steeringEventRef))
    .rejects.toThrow("pairing_storage_identity_mismatch");
});
