import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveProfileOwnedMinecraftPlayerGameDirectory,
  resolveProfileOwnedMinecraftRunDirectory,
  resolveProfileOwnedMinecraftLifecycleSelection,
  readProfileOwnedMinecraftLifecycleAddress,
} from
  "../local-minecraft-run-profile-store";

describe("profile-owned local Minecraft run selection", () => {
  let root: string | null = null;
  afterEach(async () => {
    if (root) {
      if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("minecraft-profile-store-")) throw new Error("fixture_cleanup_target_invalid");
      await rm(root, { recursive: true, force: true });
    }
    root = null;
  });

  it("resolves the exact owner's validated player game directory", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "minecraft-profile-store-"));
    const run = path.join(root, "combat-c0-server");
    const player = path.join(root, ".minecraft-helix-c0");
    await mkdir(path.join(run, "config"), { recursive: true });
    await writeFile(path.join(run, "server.properties"), "server-ip=127.0.0.1\nserver-port=25566\nquery.port=25566\nrcon.port=25575\nrcon.password=fixture-private-property\n");
    await mkdir(path.join(player, "config"), { recursive: true });
    await mkdir(path.join(player, "mods"), { recursive: true });
    const store = path.join(root, "profiles.json");
    await writeFile(store, JSON.stringify({
      schema: "casimirbot.local_minecraft_run_profiles/2",
      profiles: [{
        owner_profile_id: "profile:owner",
        run_directory: run,
        player_game_directory: player,
        label: "C0 arena",
      }],
    }));
    await expect(resolveProfileOwnedMinecraftRunDirectory({
      ownerProfileId: "profile:owner",
      storePath: store,
    })).resolves.toBe(path.win32.resolve(run));
    await expect(resolveProfileOwnedMinecraftPlayerGameDirectory({
      ownerProfileId: "profile:owner",
      storePath: store,
    })).resolves.toBe(path.win32.resolve(player));
    await expect(resolveProfileOwnedMinecraftPlayerGameDirectory({
      ownerProfileId: "profile:other",
      storePath: store,
    })).resolves.toBeNull();
    const input = { ownerProfileId: "profile:owner", storePath: store };
    await expect(resolveProfileOwnedMinecraftLifecycleSelection(input)).resolves.toEqual({
      runDirectory: path.win32.resolve(run), playerGameDirectory: path.win32.resolve(player) });
    await expect(readProfileOwnedMinecraftLifecycleAddress(input)).resolves.toBe("127.0.0.1:25566");
    await expect(readProfileOwnedMinecraftLifecycleAddress({ ...input, ownerProfileId: "profile:other" })).resolves.toBeNull();
    for (const properties of ["SERVER-IP=127.0.0.1\nserver-port=25566", "server-ip=0.0.0.0\nserver-port=25566",
      "server-ip=127.0.0.1\nserver-port=65536", "server-ip=127.0.0.1\nserver-port=25566\nserver-port=25565",
      "server-ip=127.0.0.1\nserver-port=25566\n\\u0073erver-ip=0.0.0.0"]) {
      await writeFile(path.join(run, "server.properties"), properties);
      await expect(readProfileOwnedMinecraftLifecycleAddress(input)).resolves.toBeNull();
    }
    const entry = { owner_profile_id: input.ownerProfileId, run_directory: run, player_game_directory: player, label: "Fixture" };
    await writeFile(store, JSON.stringify({ schema: "casimirbot.local_minecraft_run_profiles/2", profiles: [entry, entry] }));
    await expect(resolveProfileOwnedMinecraftLifecycleSelection(input)).resolves.toBeNull();
    await writeFile(store, JSON.stringify({ schema: "casimirbot.local_minecraft_run_profiles/2", profiles: [{ ...entry, player_game_directory: undefined }] }));
    await expect(resolveProfileOwnedMinecraftLifecycleSelection(input)).resolves.toBeNull();
  });

  it("resolves only the exact owner's validated dedicated-server directory", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "minecraft-profile-store-"));
    const run = path.join(root, "combat-c0-server");
    await mkdir(path.join(run, "config"), { recursive: true });
    await writeFile(path.join(run, "server.properties"), "server-port=25566\n");
    const store = path.join(root, "profiles.json");
    await writeFile(store, JSON.stringify({
      schema: "casimirbot.local_minecraft_run_profiles/1",
      profiles: [{
        owner_profile_id: "profile:owner",
        run_directory: run,
        label: "C0 arena",
      }],
    }));
    await expect(resolveProfileOwnedMinecraftRunDirectory({
      ownerProfileId: "profile:owner",
      storePath: store,
    })).resolves.toBe(path.win32.resolve(run));
    await expect(resolveProfileOwnedMinecraftRunDirectory({
      ownerProfileId: "profile:other",
      storePath: store,
    })).resolves.toBeNull();
    await expect(resolveProfileOwnedMinecraftLifecycleSelection({ ownerProfileId: "profile:owner", storePath: store })).resolves.toBeNull();
  });
});
