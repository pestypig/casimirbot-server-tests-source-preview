import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { provisionIsolatedMinecraftClientProfile } from "../../scripts/helix-minecraft-provision-isolated-client-profile";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, {
    recursive: true,
    force: true,
  })));
});

const fixture = async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "helix-isolated-client-"));
  roots.push(parent);
  const minecraftRoot = path.join(parent, ".minecraft");
  const instanceRoot = path.join(parent, ".minecraft-helix-c0");
  await fs.mkdir(path.join(minecraftRoot, "mods"), { recursive: true });
  await fs.writeFile(path.join(minecraftRoot, "launcher_profiles.json"), JSON.stringify({
    profiles: {
      "fabric-loader-1.21.8": {
        name: "Fabric",
        type: "custom",
        lastVersionId: "fabric-loader-0.18.4-1.21.8",
      },
    },
    settings: { keepLauncherOpen: false },
  }));
  for (const name of ["fabric-api.jar", "HelixFabricPlayerAgent.jar"]) {
    await fs.writeFile(path.join(minecraftRoot, "mods", name), name);
  }
  return { parent, minecraftRoot, instanceRoot };
};

describe("isolated Minecraft client profile", () => {
  it("prepares a bounded low-memory Fabric profile without reading credentials", async () => {
    const { minecraftRoot, instanceRoot } = await fixture();
    const receipt = await provisionIsolatedMinecraftClientProfile({
      minecraftRoot,
      instanceRoot,
      profileId: "helix-combat-c0-isolated",
      profileName: "Helix combat C0 isolated",
      sourceProfileId: "fabric-loader-1.21.8",
      serverAddress: "localhost:25566",
      modNames: ["fabric-api.jar", "HelixFabricPlayerAgent.jar"],
      maxMemoryMib: 640,
      now: "2026-08-26T08:00:00.000Z",
    });

    expect(receipt).toMatchObject({
      status: "prepared",
      profile_id: "helix-combat-c0-isolated",
      server_address: "localhost:25566",
      copied_mod_count: 2,
      copied_mods: [
        {
          name: "fabric-api.jar",
          sha256: "sha256:93e46ca22bac58a18da93a46b109df5b294e5a73c0a3d67d883412ec5cc1f7f4",
        },
        {
          name: "HelixFabricPlayerAgent.jar",
          sha256: "sha256:57d1dd10acd3ae96ab5bec4ff7a3f5c903768b60c897d705d6e79cab6e4e2d9a",
        },
      ],
      max_memory_mib: 640,
      credentials_read: false,
      credentials_exposed: false,
    });
    const profiles = JSON.parse(await fs.readFile(
      path.join(minecraftRoot, "launcher_profiles.json"),
      "utf8",
    ));
    expect(profiles.settings).toEqual({ keepLauncherOpen: false });
    expect(profiles.profiles["helix-combat-c0-isolated"]).toMatchObject({
      gameDir: instanceRoot,
      javaArgs: "-Xms256M -Xmx640M",
      lastVersionId: "fabric-loader-0.18.4-1.21.8",
    });
    expect(await fs.readFile(
      path.join(instanceRoot, "config", "helix-fabric-player-agent.autojoin-inbox"),
      "utf8",
    )).toBe("/helix-player autojoin localhost:25566\n");
    expect(await fs.readFile(
      path.join(instanceRoot, "mods", "HelixFabricPlayerAgent.jar"),
      "utf8",
    )).toBe("HelixFabricPlayerAgent.jar");

    const backupPath = path.join(
      minecraftRoot,
      "launcher_profiles.json.pre-helix-combat-c0-isolated.bak",
    );
    const firstBackup = await fs.readFile(backupPath, "utf8");
    const repeated = await provisionIsolatedMinecraftClientProfile({
      minecraftRoot,
      instanceRoot,
      profileId: "helix-combat-c0-isolated",
      profileName: "Helix combat C0 isolated",
      sourceProfileId: "fabric-loader-1.21.8",
      serverAddress: "localhost:25566",
      modNames: ["fabric-api.jar", "HelixFabricPlayerAgent.jar"],
      maxMemoryMib: 640,
      now: "2026-08-26T08:05:00.000Z",
    });
    expect(repeated.launcher_profile_backup_created).toBe(false);
    expect(await fs.readFile(backupPath, "utf8")).toBe(firstBackup);
    expect(firstBackup).not.toContain("helix-combat-c0-isolated");
  });

  it("rejects a non-loopback destination and an unisolated game directory", async () => {
    const { minecraftRoot, instanceRoot } = await fixture();
    await expect(provisionIsolatedMinecraftClientProfile({
      minecraftRoot,
      instanceRoot,
      profileId: "helix-combat-c0-isolated",
      profileName: "Helix combat C0 isolated",
      sourceProfileId: "fabric-loader-1.21.8",
      serverAddress: "example.com:25566",
      modNames: ["fabric-api.jar", "HelixFabricPlayerAgent.jar"],
    })).rejects.toThrow("minecraft_isolated_profile_loopback_required");
    await expect(provisionIsolatedMinecraftClientProfile({
      minecraftRoot,
      instanceRoot: minecraftRoot,
      profileId: "helix-combat-c0-isolated",
      profileName: "Helix combat C0 isolated",
      sourceProfileId: "fabric-loader-1.21.8",
      serverAddress: "localhost:25566",
      modNames: ["fabric-api.jar", "HelixFabricPlayerAgent.jar"],
    })).rejects.toThrow("minecraft_isolated_profile_instance_root_invalid");
  });
});
