import { beforeEach, describe, expect, it, vi } from "vitest";
const accountStore = vi.hoisted(() => ({ getAccountSessionById: vi.fn(), getAccountCapabilityPolicy: vi.fn() }));
vi.mock("../../helix-account/account-session-store", () => accountStore);
import { assertNativeSharedRoomAccount, runNativeSharedRoomOperation } from "../native-room-runtime";
import type { NativeSharedLiveRoomConnection } from "../native-room-connection";

const account = { profileId: "profile-a", sessionId: "session-a" };
beforeEach(() => {
  accountStore.getAccountSessionById.mockReset().mockResolvedValue({ profile: { profile_id: "profile-a" } });
  accountStore.getAccountCapabilityPolicy.mockReset().mockResolvedValue({ feature_flags: ["shared_realtime_rooms"], locked_features: [] });
});

describe("native room operation admission", () => {
  const harness = () => {
    const receipt = { ok: true, rooms: [] };
    const connection = { generationFor: vi.fn(() => 1), list: vi.fn(async () => receipt),
      inspect: vi.fn(async () => receipt), join: vi.fn(async () => receipt), disconnectFor: vi.fn() };
    const assertAccount = vi.fn(async (_account: typeof account) => undefined);
    const getter = vi.fn(() => connection as unknown as NativeSharedLiveRoomConnection);
    return { connection, receipt, assertAccount, getter, dependencies: { assertAccount, connection: getter } };
  };
  it("checks current account admission before contacting the remote service", async () => {
    const h = harness(); h.assertAccount.mockRejectedValueOnce(new Error("account_unavailable"));
    await expect(runNativeSharedRoomOperation({ account, operation: "list" }, h.dependencies)).rejects.toThrow();
    expect(h.getter).not.toHaveBeenCalled(); expect(h.connection.list).not.toHaveBeenCalled();
  });
  it.each(["list", "inspect", "join"] as const)("dispatches %s and rechecks admission before receipt delivery", async operation => {
    const h = harness(); const request = { room_id: "shared_realtime_room:test", invite_code: "fixture" };
    await expect(runNativeSharedRoomOperation({ account, operation, roomId: request.room_id, request, idempotencyKey: "key-0001" }, h.dependencies)).resolves.toEqual(h.receipt);
    expect(h.assertAccount).toHaveBeenCalledTimes(2);
    expect(h.connection[operation]).toHaveBeenCalledTimes(1);
  });
  it("withholds a completed join after policy revocation and reports uncertainty", async () => {
    const h = harness(); h.assertAccount.mockResolvedValueOnce().mockRejectedValueOnce(new Error("revoked"));
    await expect(runNativeSharedRoomOperation({ account, operation: "join" }, h.dependencies)).rejects.toMatchObject({ code: "room_connection_changed", outcomeUnknown: true });
    expect(h.connection.disconnectFor).toHaveBeenCalledWith(account);
  });
  it("withholds an old receipt without disconnecting a replacement grant", async () => {
    const h = harness(); h.connection.generationFor.mockReturnValueOnce(1).mockReturnValueOnce(2);
    await expect(runNativeSharedRoomOperation({ account, operation: "list" }, h.dependencies)).rejects.toMatchObject({ code: "room_connection_changed", outcomeUnknown: false });
    expect(h.connection.disconnectFor).not.toHaveBeenCalled();
  });
  it("rejects an authority changed during the remote operation", async () => {
    const h = harness(); h.getter.mockReturnValueOnce(h.connection as unknown as NativeSharedLiveRoomConnection).mockReturnValueOnce({} as NativeSharedLiveRoomConnection);
    await expect(runNativeSharedRoomOperation({ account, operation: "inspect" }, h.dependencies)).rejects.toMatchObject({ code: "room_connection_changed" });
  });
});

describe("native room local account admission", () => {
  it("uses current session and policy for the captured profile", async () => {
    await expect(assertNativeSharedRoomAccount(account)).resolves.toBeUndefined();
    expect(accountStore.getAccountSessionById).toHaveBeenCalledWith("session-a");
    expect(accountStore.getAccountCapabilityPolicy).toHaveBeenCalledWith("session-a");
  });
  it.each([null, { profile: { profile_id: "profile-b" } }])("rejects missing or replaced sessions %#", async session => {
    accountStore.getAccountSessionById.mockResolvedValue(session);
    await expect(assertNativeSharedRoomAccount(account)).rejects.toMatchObject({ code: "room_local_account_unavailable" });
  });
  it.each([
    { feature_flags: [], locked_features: [] },
    { feature_flags: ["shared_realtime_rooms"], locked_features: ["shared_realtime_rooms"] },
  ])("rejects unavailable or locked room policy %#", async policy => {
    accountStore.getAccountCapabilityPolicy.mockResolvedValue(policy);
    await expect(assertNativeSharedRoomAccount(account)).rejects.toMatchObject({ code: "room_account_policy_blocked" });
  });
});
