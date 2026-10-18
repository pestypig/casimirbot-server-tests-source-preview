import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalPlayerPairingHandoffError,
  stageLocalMinecraftPlayerPairing,
} from "../local-player-pairing-handoff";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe("local player pairing handoff", () => {
  it("atomically stages only the bounded client command", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "helix-player-pairing-"));
    roots.push(root);

    await expect(stageLocalMinecraftPlayerPairing({
      appDataPath: root,
      command: "/helix-player pair Z4ZD-X2JJ",
    })).resolves.toEqual({ status: "player_pairing_inbox_staged" });

    await expect(readFile(path.join(
      root,
      ".minecraft",
      "config",
      "helix-fabric-player-agent.pairing-inbox",
    ), "utf8")).resolves.toBe("/helix-player pair Z4ZD-X2JJ");
  });

  it("preserves the exact loopback pairing issuer in the bounded command", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "helix-player-pairing-"));
    roots.push(root);
    const command =
      "/helix-player pair Z4ZD-X2JJ http://127.0.0.1:1522/api/environment-connectors/v1/pairing/redeem";

    await expect(stageLocalMinecraftPlayerPairing({
      appDataPath: root,
      command,
    })).resolves.toEqual({ status: "player_pairing_inbox_staged" });

    await expect(readFile(path.join(
      root,
      ".minecraft",
      "config",
      "helix-fabric-player-agent.pairing-inbox",
    ), "utf8")).resolves.toBe(command);
  });

  it("targets an explicitly configured isolated client game directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "helix-player-pairing-"));
    roots.push(root);
    const isolatedGameDirectory = path.join(root, ".minecraft-helix-c0");

    await expect(stageLocalMinecraftPlayerPairing({
      appDataPath: root,
      minecraftGameDirectoryPath: isolatedGameDirectory,
      command: "/helix-player pair Z4ZD-X2JJ",
    })).resolves.toEqual({ status: "player_pairing_inbox_staged" });

    await expect(readFile(path.join(
      isolatedGameDirectory,
      "config",
      "helix-fabric-player-agent.pairing-inbox",
    ), "utf8")).resolves.toBe("/helix-player pair Z4ZD-X2JJ");
    await expect(readFile(path.join(
      root,
      ".minecraft",
      "config",
      "helix-fabric-player-agent.pairing-inbox",
    ), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("targets the player directory owned by the authenticated desktop profile", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "helix-player-pairing-"));
    roots.push(root);
    const runDirectory = path.join(root, "combat-c0-server");
    const playerGameDirectory = path.join(root, ".minecraft-helix-c0");
    await mkdir(path.join(runDirectory, "config"), { recursive: true });
    await writeFile(path.join(runDirectory, "server.properties"), "server-port=25566\n");
    await mkdir(path.join(playerGameDirectory, "config"), { recursive: true });
    await mkdir(path.join(playerGameDirectory, "mods"), { recursive: true });
    const storePath = path.join(root, "profiles.json");
    await writeFile(storePath, JSON.stringify({
      schema: "casimirbot.local_minecraft_run_profiles/2",
      profiles: [{
        owner_profile_id: "profile:owner",
        run_directory: runDirectory,
        player_game_directory: playerGameDirectory,
        label: "C0 arena",
      }],
    }));
    const previousStore = process.env.HELIX_DESKTOP_MINECRAFT_PROFILE_STORE;
    process.env.HELIX_DESKTOP_MINECRAFT_PROFILE_STORE = storePath;
    try {
      await expect(stageLocalMinecraftPlayerPairing({
        appDataPath: root,
        ownerProfileId: "profile:owner",
        command: "/helix-player pair Z4ZD-X2JJ",
      })).resolves.toEqual({ status: "player_pairing_inbox_staged" });
    } finally {
      if (previousStore === undefined) {
        delete process.env.HELIX_DESKTOP_MINECRAFT_PROFILE_STORE;
      } else {
        process.env.HELIX_DESKTOP_MINECRAFT_PROFILE_STORE = previousStore;
      }
    }
    await expect(readFile(path.join(
      playerGameDirectory,
      "config",
      "helix-fabric-player-agent.pairing-inbox",
    ), "utf8")).resolves.toBe("/helix-player pair Z4ZD-X2JJ");
  });

  it("discovers the desktop-owned profile store from APPDATA without desktop-only environment injection", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "helix-player-pairing-"));
    roots.push(root);
    const runDirectory = path.join(root, "combat-c0-server");
    const playerGameDirectory = path.join(root, ".minecraft-helix-c0");
    await mkdir(path.join(runDirectory, "config"), { recursive: true });
    await writeFile(path.join(runDirectory, "server.properties"), "server-port=25566\n");
    await mkdir(path.join(playerGameDirectory, "config"), { recursive: true });
    await mkdir(path.join(playerGameDirectory, "mods"), { recursive: true });
    const storePath = path.join(
      root,
      "@casimirbot",
      "desktop",
      "state",
      "local-minecraft-run-profiles.json",
    );
    await mkdir(path.dirname(storePath), { recursive: true });
    await writeFile(storePath, JSON.stringify({
      schema: "casimirbot.local_minecraft_run_profiles/2",
      profiles: [{
        owner_profile_id: "profile:owner",
        run_directory: runDirectory,
        player_game_directory: playerGameDirectory,
        label: "C0 arena",
      }],
    }));

    await expect(stageLocalMinecraftPlayerPairing({
      appDataPath: root,
      ownerProfileId: "profile:owner",
      command: "/helix-player pair Z4ZD-X2JJ",
    })).resolves.toEqual({ status: "player_pairing_inbox_staged" });

    await expect(readFile(path.join(
      playerGameDirectory,
      "config",
      "helix-fabric-player-agent.pairing-inbox",
    ), "utf8")).resolves.toBe("/helix-player pair Z4ZD-X2JJ");
    await expect(readFile(path.join(
      root,
      ".minecraft",
      "config",
      "helix-fabric-player-agent.pairing-inbox",
    ), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects relative or filesystem-root game directories", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "helix-player-pairing-"));
    roots.push(root);

    await expect(stageLocalMinecraftPlayerPairing({
      appDataPath: root,
      minecraftGameDirectoryPath: ".minecraft-helix-c0",
      command: "/helix-player pair Z4ZD-X2JJ",
    })).rejects.toMatchObject<Partial<LocalPlayerPairingHandoffError>>({
      code: "local_player_pairing_game_directory_invalid",
    });

    await expect(stageLocalMinecraftPlayerPairing({
      appDataPath: root,
      minecraftGameDirectoryPath: path.parse(root).root,
      command: "/helix-player pair Z4ZD-X2JJ",
    })).rejects.toMatchObject<Partial<LocalPlayerPairingHandoffError>>({
      code: "local_player_pairing_game_directory_invalid",
    });
  });

  it("rejects actions and malformed pairing material", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "helix-player-pairing-"));
    roots.push(root);

    await expect(stageLocalMinecraftPlayerPairing({
      appDataPath: root,
      command: "/helix-player status",
    })).rejects.toMatchObject<Partial<LocalPlayerPairingHandoffError>>({
      code: "local_player_pairing_command_invalid",
    });
  });
});
