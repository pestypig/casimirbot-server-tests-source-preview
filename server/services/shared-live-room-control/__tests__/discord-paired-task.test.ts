import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccount: vi.fn(), inspectTrust: vi.fn(), inspectSelection: vi.fn(),
  identityFor: vi.fn(), discoverOwnerNode: vi.fn(), operation: vi.fn(),
}));
vi.mock("../native-room-runtime", () => ({
  assertNativeSharedRoomAccount: mocks.assertAccount,
  getNativeSharedLiveRoomConnection: () => ({ identityFor: mocks.identityFor,
    discoverOwnerNode: mocks.discoverOwnerNode }),
}));
vi.mock("../../helix-account/installed-security-store", () => ({
  installedSecurityStore: { inspectFullHarnessTrust: mocks.inspectTrust },
}));
vi.mock("../native-room-mission-store", () => ({
  nativeRoomMissionStore: { inspect: mocks.inspectSelection },
}));

import { withCurrentPairedDiscordRoom } from "../discord-paired-task";

const roomId = "shared_realtime_room:ce03ad8e-d0cb-4d73-8324-94b069f8e8c8";
const account = { profileId: "owner-profile", sessionId: "active-session" };
const task = { profileRef: account.profileId, authenticatedMcpClientRef: "client",
  clientSessionRef: "client-session", clientContinuationRef: "exact-task",
  bindingId: "binding", bindingEpoch: 1, helixConversationId: "chat",
  missionId: null, runId: null };
const attachment = { attachment_ref: "room_owner_attachment:11111111-2222-4333-8444-555555555555",
  revision: 1, node_ref: `room_node:sha256:${"a".repeat(64)}`, status: "reserved",
  expires_at: new Date(Date.now() + 600_000).toISOString(),
  local_task_verified: false, dispatch_authority: false };

beforeEach(() => {
  vi.stubEnv("HELIX_DESKTOP_DEVICE_ID", "device-one");
  Object.values(mocks).forEach(mock => mock.mockReset());
  mocks.assertAccount.mockResolvedValue(undefined);
  mocks.inspectTrust.mockResolvedValue({ trusted: true });
  mocks.identityFor.mockReturnValue({ authority: "https://casimirbot.com", connectionRef: "connection-one" });
  mocks.discoverOwnerNode.mockResolvedValue({ attachment });
  mocks.inspectSelection.mockResolvedValue({ status: "selected", attachment,
    payload: { sessionId: account.sessionId, connectionRef: "connection-one", task } });
  mocks.operation.mockResolvedValue({ requests: [] });
});
afterEach(() => vi.unstubAllEnvs());

it("admits only the current exact selected task and room attachment", async () => {
  const verifyTask = vi.fn(async () => undefined);
  const result = await withCurrentPairedDiscordRoom({ account, roomId, task,
    verifyTask, operation: mocks.operation });
  expect(result).toEqual({ requests: [] });
  expect(verifyTask).toHaveBeenCalledTimes(2);
  expect(mocks.operation).toHaveBeenCalledTimes(1);
});

it("refuses a different selected task before reading the domain", async () => {
  mocks.inspectSelection.mockResolvedValueOnce({ status: "selected", attachment,
    payload: { sessionId: account.sessionId, connectionRef: "connection-one",
      task: { ...task, clientContinuationRef: "other-task" } } });
  await expect(withCurrentPairedDiscordRoom({ account, roomId, task,
    verifyTask: async () => undefined, operation: mocks.operation }))
    .rejects.toMatchObject({ code: "discord_paired_task_selection_required" });
  expect(mocks.operation).not.toHaveBeenCalled();
});

it("refuses a replaced owner node before public delivery", async () => {
  mocks.discoverOwnerNode.mockResolvedValueOnce({ attachment: { ...attachment, revision: 2 } });
  await expect(withCurrentPairedDiscordRoom({ account, roomId, task,
    verifyTask: async () => undefined, operation: mocks.operation }))
    .rejects.toMatchObject({ code: "discord_paired_task_attachment_changed" });
  expect(mocks.operation).not.toHaveBeenCalled();
});
