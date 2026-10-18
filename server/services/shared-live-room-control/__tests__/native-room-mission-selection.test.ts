import { newDb } from "pg-mem";
import { afterEach, expect, it, vi } from "vitest";
import { migration095 } from "../../../db/migrations/095_native_hosted_room_missions";
import { NativeRoomMissionStore } from "../native-room-mission-store";
import { selectNativeHostedRoomMission, inspectNativeHostedRoomOptions } from "../native-room-mission-selection";
import type { NativeSharedLiveRoomConnection } from "../native-room-connection";
import type { withSharedRealtimeRoomTransaction } from "../../helix-ask/realtime-room/room-store/database";
const pools: Array<{ end(): Promise<void> }> = [];
afterEach(async () => { await Promise.all(pools.splice(0).map(pool => pool.end())); });
const fixture = async () => {
  const pool = new (newDb().adapters.createPg().Pool)(); pools.push(pool);
  await pool.query("CREATE TABLE helix_accounts(profile_id text PRIMARY KEY)");
  await pool.query("INSERT INTO helix_accounts VALUES ('local-owner')");
  const db = await pool.connect();
  try { await migration095.run(db, { enablePgvector: false }); } finally { db.release(); }
  const transaction = vi.fn(async (run: (client: typeof db) => Promise<unknown>) => {
    const client = await pool.connect(); try { return await run(client); } finally { client.release(); }
  });
  const store = new NativeRoomMissionStore(transaction as typeof withSharedRealtimeRoomTransaction);
  const account = { profileId: "local-owner", sessionId: "local-session" };
  const target = { reasoning_binding_id: "binding:owner-task", binding_epoch: 3,
    helix_conversation_id: "private:owner-chat", binding_mission_id: null, run_id: null };
  const task = { profileRef: account.profileId, bindingId: target.reasoning_binding_id, bindingEpoch: 3,
    helixConversationId: target.helix_conversation_id, missionId: null, runId: null,
    authenticatedMcpClientRef: "client:owner", clientSessionRef: "client-session:owner", clientContinuationRef: "task:owner" };
  const request = { room_id: "shared_realtime_room:hosted-selection", target, request_id: "select-hosted-001",
    expected_local_revision: null as number | null, expected_remote_revision: null as number | null };
  const attachment = { attachment_ref: "room_owner_attachment:11111111-1111-4111-8111-111111111111", revision: 1,
    node_ref: `room_node:sha256:${"a".repeat(64)}`, status: "reserved", expires_at: "2099-01-01T00:00:00Z",
    local_task_verified: false, dispatch_authority: false };
  let connectionRef = "process-one:grant-one";
  const connection = { identityFor: vi.fn(() => ({ authority: "https://rooms.test", connectionRef })),
    discoverOwnerNode: vi.fn(async () => ({ attachment })),
    reserveOwnerNode: vi.fn(async () => ({ attachment })) };
  const connectionFor = vi.fn(() => connection as unknown as NativeSharedLiveRoomConnection);
  const authorizeAccount = vi.fn(async () => undefined);
  const resolveTask = vi.fn(async () => ({ ...task }));
  const input = { account, request, authorizeAccount, resolveTask };
  let deviceId = "native-device-one";
  const dependencies = { connection: connectionFor, store, deviceId: () => deviceId };
  const run = () => selectNativeHostedRoomMission(input, dependencies);
  const rows = async () => (await pool.query("SELECT * FROM helix_native_hosted_room_missions")).rows;
  return { pool, transaction, store, input, dependencies, run, rows, connection, connectionFor, task,
    authorizeAccount, resolveTask, attachment, setConnection: (value: string) => { connectionRef = value; },
    setDevice: (value: string) => { deviceId = value; } };
};

it("recovers both revisions after reconnect without exposing the private task association or writing", async () => {
  const h = await fixture(); await h.run(); h.setConnection("new-process:new-grant");
  const before = await h.rows();
  const result = await inspectNativeHostedRoomOptions({ account: h.input.account, roomId: h.input.request.room_id,
    authorizeAccount: h.authorizeAccount, candidate: async () => null }, h.dependencies);
  expect(result).toMatchObject({ local_revision: 1, local_status: "selected", candidate: null,
    attachment: h.attachment, dispatch_authority: false });
  expect(await h.rows()).toEqual(before);
  expect(h.connection.reserveOwnerNode).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(result)).not.toMatch(/client-session|task:owner|private:owner-chat|local-owner|connectionRef/);
});

it("shows a pending local request after uncertain remote completion", async () => {
  const h = await fixture(); h.connection.reserveOwnerNode.mockRejectedValueOnce(new Error("lost response"));
  await expect(h.run()).rejects.toThrow();
  const result = await inspectNativeHostedRoomOptions({ account: h.input.account, roomId: h.input.request.room_id,
    authorizeAccount: h.authorizeAccount, candidate: async () => h.input.request.target }, h.dependencies);
  expect(result).toMatchObject({ local_revision: 1, local_status: "pending", candidate: h.input.request.target });
  expect(h.connection.discoverOwnerNode).toHaveBeenCalledWith(h.input.account, h.input.request.room_id);
  expect(h.connection.reserveOwnerNode).toHaveBeenCalledTimes(1);
});

it.each(["account", "connection", "device"])("withholds recovery options when %s changes during discovery", async kind => {
  const h = await fixture();
  h.connection.discoverOwnerNode.mockImplementationOnce(async () => {
    if (kind === "account") h.authorizeAccount.mockRejectedValue(new Error("account changed"));
    if (kind === "connection") h.setConnection("new-grant");
    if (kind === "device") h.setDevice("new-device");
    return { attachment: h.attachment };
  });
  await expect(inspectNativeHostedRoomOptions({ account: h.input.account, roomId: h.input.request.room_id,
    authorizeAccount: h.authorizeAccount, candidate: async () => h.input.request.target }, h.dependencies)).rejects.toThrow();
  expect(h.connection.reserveOwnerNode).not.toHaveBeenCalled();
});

it("persists the exact task locally and sends only reservation arguments to the hosted service", async () => {
  const h = await fixture(); const receipt = await h.run();
  expect(receipt).toMatchObject({ local_task_selected: true, local_revision: 1, dispatch_authority: false, attachment: h.attachment });
  expect(h.connection.reserveOwnerNode).toHaveBeenCalledWith(h.input.account, h.input.request.room_id, null, "select-hosted-001");
  const rows = await h.rows(); expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ status: "selected", revision: 1, payload: { task: h.task } });
  for (const value of Object.values(h.task).filter(value => typeof value === "string")) {
    expect(JSON.stringify(receipt)).not.toContain(value);
  }
  expect(await h.run()).toEqual(receipt);
  expect(await h.rows()).toHaveLength(1);
  expect(h.transaction).toHaveBeenCalledWith(expect.any(Function), {
    requireLocalSnapshot: true, snapshotTables: ["helix_native_hosted_room_missions"],
  });
});

it.each(["account", "pairing", "device", "connection"])("denies missing %s before reservation", async kind => {
  const h = await fixture();
  if (kind === "account") h.authorizeAccount.mockRejectedValue(new Error("account revoked"));
  if (kind === "pairing") h.resolveTask.mockRejectedValue(new Error("pairing expired"));
  if (kind === "device") h.dependencies.deviceId = () => "";
  if (kind === "connection") h.connectionFor.mockReturnValue(null as never);
  await expect(h.run()).rejects.toThrow();
  expect(h.connection.reserveOwnerNode).not.toHaveBeenCalled();
  expect(await h.rows()).toHaveLength(0);
});

it("rejects reusing an accepted request for another exact task", async () => {
  const h = await fixture(); await h.run();
  h.input.request.target.helix_conversation_id = "private:different-chat";
  h.resolveTask.mockResolvedValue({ ...h.task, helixConversationId: "private:different-chat" });
  await expect(h.run()).rejects.toMatchObject({ code: "hosted_room_selection_request_conflict" });
  expect(h.connection.reserveOwnerNode).toHaveBeenCalledTimes(1);
});

it.each(["account", "pairing", "connection", "device"])("withholds selection after %s changes during the request", async kind => {
  const h = await fixture();
  h.connection.reserveOwnerNode.mockImplementationOnce(async () => {
    if (kind === "account") h.authorizeAccount.mockRejectedValue(new Error("account revoked"));
    if (kind === "pairing") h.resolveTask.mockResolvedValue({ ...h.task, bindingEpoch: 4 });
    if (kind === "connection") h.setConnection("process-one:grant-two");
    if (kind === "device") h.setDevice("native-device-two");
    return { attachment: h.attachment };
  });
  await expect(h.run()).rejects.toMatchObject({ code: "hosted_room_selection_unconfirmed", outcomeUnknown: true });
  expect((await h.rows())[0].status).toBe("pending");
});

it("checks the connection again after asynchronous task revalidation", async () => {
  const h = await fixture();
  h.resolveTask.mockResolvedValueOnce(h.task).mockImplementationOnce(async () => {
    h.setConnection("process-one:grant-two"); return h.task;
  });
  await expect(h.run()).rejects.toMatchObject({ code: "hosted_room_selection_changed" });
  expect(h.connection.reserveOwnerNode).not.toHaveBeenCalled();
});

it("records uncertainty durably before the network and allows an explicit same-request retry", async () => {
  const h = await fixture(); h.connection.reserveOwnerNode.mockRejectedValueOnce(new Error("network uncertain"));
  await expect(h.run()).rejects.toMatchObject({ code: "hosted_room_selection_unconfirmed", outcomeUnknown: true });
  expect((await h.rows())[0]).toMatchObject({ status: "pending", request_id: "select-hosted-001" });
  expect(await h.run()).toMatchObject({ local_revision: 1, local_task_selected: true });
  expect(await h.rows()).toHaveLength(1);
});

it("does not revive a persisted selection after process/connection replacement", async () => {
  const h = await fixture(); await h.run(); h.setConnection("process-two:grant-one");
  h.dependencies.store = new NativeRoomMissionStore(h.transaction as typeof withSharedRealtimeRoomTransaction);
  await expect(h.run()).rejects.toMatchObject({ code: "hosted_room_selection_request_conflict" });
  expect(h.connection.reserveOwnerNode).toHaveBeenCalledTimes(1);
});

it("withholds selected status if the attachment expires during local persistence", async () => {
  const h = await fixture(); let now = Date.parse("2098-12-31T23:59:00Z");
  const original = h.store.finish.bind(h.store);
  vi.spyOn(h.store, "finish").mockImplementationOnce(async (...args) => {
    const result = await original(...args); now += 120_000; return result;
  });
  await expect(selectNativeHostedRoomMission(h.input, { ...h.dependencies, now: () => now }))
    .rejects.toMatchObject({ code: "hosted_room_selection_unconfirmed", outcomeUnknown: true });
});

it("requires the expected local revision and rejects a late completion after reselection", async () => {
  const h = await fixture(); await h.run(); const old = (await h.rows())[0];
  h.input.request.request_id = "select-hosted-002";
  await expect(h.run()).rejects.toMatchObject({ code: "hosted_room_selection_revision_conflict" });
  h.input.request.expected_local_revision = 1; h.input.request.expected_remote_revision = 1;
  h.connection.reserveOwnerNode.mockResolvedValueOnce({ attachment: { ...h.attachment, revision: 2 } });
  await h.run();
  await expect(h.store.finish(old, h.attachment as never)).rejects.toMatchObject({ code: "hosted_room_selection_revision_conflict", outcomeUnknown: true });
  expect((await h.rows())[0].revision).toBe(2);
});
