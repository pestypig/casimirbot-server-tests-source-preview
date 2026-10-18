import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const ports = vi.hoisted(() => ({ exec: vi.fn(), selection: vi.fn(), server: vi.fn(), access: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: ports.exec }));
vi.mock("node:fs/promises", () => ({ access: ports.access }));
vi.mock("../../pairing/local-minecraft-run-profile-store", () => ({ resolveProfileOwnedMinecraftLifecycleSelection: ports.selection }));
vi.mock("../minecraft-local-server-lifecycle", async original => ({
  ...await original<typeof import("../minecraft-local-server-lifecycle")>(), startSavedMinecraftFabricServer: ports.server,
}));
import { executeMinecraftFabricLoopbackLifecycle } from "../minecraft-fabric-loopback-lifecycle";
import { MinecraftLocalServerLifecycleError } from "../minecraft-local-server-lifecycle";

const observation = { schema: "helix.minecraft.local_server_lifecycle.v1", status: "listening",
  server_process_id: 4321, process_started_at: "2026-09-14T00:00:00.000Z", observed_at: "2026-09-14T00:00:05.000Z",
  server_address: "127.0.0.1:25566", launcher_action: "launched_server", profile_digest: "a".repeat(64),
  credentials_exposed: false, authority_widened: false } as const;
const receipt = { schema: "helix.minecraft.workstation_launch_receipt.v1", status: "connected",
  profile_id: "fixture-selected", profile_version: "fabric-1.21.8", isolated_game_directory: true,
  client_process_id: 1234, server_address: "127.0.0.1:25566", launcher_action: "launched_client",
  connection_action: "autojoin_staged", play_control_point: "fixture", mod_loaded: true,
  memory_used_percent: 45, credentials_exposed: false };
const selection = { runDirectory: "C:\\fixture\\server", playerGameDirectory: "C:\\fixture\\player" };
const input = { ownerProfileId: "profile:fixture-owner", allowServerStartup: true,
  request: { address: "127.0.0.1:25566" } };

describe.skipIf(process.platform !== "win32")("real lifecycle orchestration with isolated OS ports", () => {
  const previousProfileStore = process.env.HELIX_DESKTOP_MINECRAFT_PROFILE_STORE;
  const isolatedProfileStore = "C:\\fixture\\isolated\\state\\local-minecraft-run-profiles.json";
  beforeEach(() => {
    process.env.HELIX_DESKTOP_MINECRAFT_PROFILE_STORE = isolatedProfileStore;
    vi.clearAllMocks(); ports.access.mockResolvedValue(undefined); ports.selection.mockResolvedValue(selection);
    ports.server.mockResolvedValue(observation);
    ports.exec.mockImplementation((_file, _args, _options, callback) => callback(null, { stdout: JSON.stringify(receipt), stderr: "" }));
  });
  afterEach(() => {
    if (previousProfileStore === undefined) delete process.env.HELIX_DESKTOP_MINECRAFT_PROFILE_STORE;
    else process.env.HELIX_DESKTOP_MINECRAFT_PROFILE_STORE = previousProfileStore;
  });
  it("resolves one exact owner selection and starts the server before the fixed selected client", async () => {
    await expect(executeMinecraftFabricLoopbackLifecycle(input)).resolves.toEqual({ ...receipt, server_lifecycle: observation });
    expect(ports.selection).toHaveBeenCalledWith({
      ownerProfileId: input.ownerProfileId,
      storePath: isolatedProfileStore,
      appDataPath: process.env.APPDATA,
    });
    expect(ports.server).toHaveBeenCalledWith({ runDirectory: selection.runDirectory, address: input.request.address, signal: undefined });
    expect(ports.server.mock.invocationCallOrder[0]).toBeLessThan(ports.exec.mock.invocationCallOrder[0]);
    expect(ports.exec.mock.calls[0][1]).toEqual(expect.arrayContaining(["-Mta", "-PlayerGameDirectory", selection.playerGameDirectory]));
    expect(ports.exec.mock.calls[0][2].windowsHide).toBe(true);
  });
  it("does not start a server with only the client lifecycle permission", async () => {
    await expect(executeMinecraftFabricLoopbackLifecycle({ ...input, allowServerStartup: false })).resolves.toEqual(receipt);
    expect(ports.server).not.toHaveBeenCalled(); expect(ports.exec).toHaveBeenCalledOnce();
  });
  it("rejects missing owner selection before either OS effect", async () => {
    ports.selection.mockResolvedValue(null);
    await expect(executeMinecraftFabricLoopbackLifecycle(input)).rejects.toMatchObject({ code: "minecraft_saved_server_and_player_selection_required" });
    expect(ports.server).not.toHaveBeenCalled(); expect(ports.exec).not.toHaveBeenCalled();
  });
  it("preserves server timeout and does not proceed to the client", async () => {
    ports.server.mockRejectedValue(new MinecraftLocalServerLifecycleError("minecraft_server_start_timeout", { ...observation, status: "starting" }));
    await expect(executeMinecraftFabricLoopbackLifecycle(input)).rejects.toMatchObject({ code: "minecraft_server_start_timeout",
      serverObservation: { ...observation, status: "starting" } });
    expect(ports.exec).not.toHaveBeenCalled();
  });
  it("preserves prior server effect and redacts raw client failure", async () => {
    ports.exec.mockImplementation((_file, _args, _options, callback) => callback(new Error("private fixture failure")));
    await expect(executeMinecraftFabricLoopbackLifecycle(input)).rejects.toMatchObject({ code: "minecraft_local_lifecycle_unavailable",
      message: "minecraft_local_lifecycle_unavailable", serverObservation: observation });
    expect(ports.server).toHaveBeenCalledOnce(); expect(ports.exec).toHaveBeenCalledOnce();
  });
});
