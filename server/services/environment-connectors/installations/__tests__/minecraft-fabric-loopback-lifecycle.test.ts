import { describe, expect, it, vi } from "vitest";
import {
  executeMinecraftFabricLoopbackLifecycle,
  MinecraftLocalLifecycleError,
  parseMinecraftLocalLifecycleReceipt,
} from "../minecraft-fabric-loopback-lifecycle";
import type { HelixMinecraftLocalLifecycleReceipt } from
  "@shared/helix-minecraft-local-lifecycle";

const receipt: HelixMinecraftLocalLifecycleReceipt = {
  schema: "helix.minecraft.workstation_launch_receipt.v1",
  status: "connected",
  profile_id: "fabric-loader-1.21.8",
  profile_version: "fabric-loader-0.18.4-1.21.8",
  isolated_game_directory: true,
  client_process_id: 4242,
  server_address: "localhost:25565",
  launcher_action: "reused_client",
  connection_action: "already_connected",
  play_control_point: "not_required",
  mod_loaded: true,
  memory_used_percent: 64,
  credentials_exposed: false,
};

describe("Minecraft Fabric loopback lifecycle", () => {
  it("parses the installed-profile receipt including isolated directory identity", () => {
    expect(parseMinecraftLocalLifecycleReceipt(
      `launcher progress\n${JSON.stringify(receipt)}\n`,
    )).toEqual(receipt);
  });

  it("normalizes the default loopback target and returns the sanitized receipt", async () => {
    const runner = vi.fn(async () => receipt);
    await expect(
      executeMinecraftFabricLoopbackLifecycle({ runner }),
    ).resolves.toEqual(receipt);
    expect(runner).toHaveBeenCalledWith({
      address: "localhost:25565",
      restartClient: false,
      signal: undefined,
    });
  });

  it("forwards an explicit current-authority client restart", async () => {
    const runner = vi.fn(async () => receipt);
    await expect(
      executeMinecraftFabricLoopbackLifecycle({
        request: { address: "localhost:25565", restart_client: true },
        runner,
      }),
    ).resolves.toEqual(receipt);
    expect(runner).toHaveBeenCalledWith({
      address: "localhost:25565",
      restartClient: true,
      signal: undefined,
    });
  });

  it("rejects remote targets before invoking the local runner", async () => {
    const runner = vi.fn(async () => receipt);
    await expect(
      executeMinecraftFabricLoopbackLifecycle({
        request: { address: "example.com:25565" },
        runner,
      }),
    ).rejects.toMatchObject<MinecraftLocalLifecycleError>({
      code: "minecraft_loopback_address_required",
      statusCode: 400,
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it("prevents concurrent launcher executions", async () => {
    let release!: () => void;
    const first = executeMinecraftFabricLoopbackLifecycle({
      runner: async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return receipt;
      },
    });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await expect(
      executeMinecraftFabricLoopbackLifecycle({
        runner: async () => receipt,
      }),
    ).rejects.toMatchObject<MinecraftLocalLifecycleError>({
      code: "minecraft_local_lifecycle_busy",
      statusCode: 409,
    });
    release();
    await expect(first).resolves.toEqual(receipt);
  });
});
