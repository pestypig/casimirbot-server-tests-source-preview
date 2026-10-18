import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalServerPairingHandoffError,
  resolveLocalMinecraftPairingEndpoint,
  stageLocalMinecraftServerPairing,
} from "../local-server-pairing-handoff";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("local Fabric server pairing handoff", () => {
  it("prefers the desktop service origin over the forwarded native broker host", () => {
    expect(resolveLocalMinecraftPairingEndpoint({
      serviceBaseUrl: "http://127.0.0.1:63311",
      requestBaseUrl: "http://127.0.0.1:63310",
    })).toBe(
      "http://127.0.0.1:63311/api/environment-connectors/v1/pairing/redeem",
    );
  });

  it("falls back to a bounded loopback request origin outside desktop", () => {
    expect(resolveLocalMinecraftPairingEndpoint({
      serviceBaseUrl: "https://casimirbot.example",
      requestBaseUrl: "http://127.0.0.1:1522",
    })).toBe(
      "http://127.0.0.1:1522/api/environment-connectors/v1/pairing/redeem",
    );
  });

  it("rejects endpoint resolution without a bounded loopback origin", () => {
    expect(() => resolveLocalMinecraftPairingEndpoint({
      serviceBaseUrl: "https://casimirbot.example",
      requestBaseUrl: "https://casimirbot.example",
    })).toThrowError(expect.objectContaining({
      code: "local_server_pairing_endpoint_invalid",
    }));
  });

  it("atomically stages only the bounded server command in the fixed profile", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "helix-server-pairing-"));
    roots.push(root);

    await expect(
      stageLocalMinecraftServerPairing({
        workspaceRoot: root,
        command: "/helix pair Z4ZD-X2JJ",
      }),
    ).resolves.toEqual({ status: "server_pairing_inbox_staged" });

    await expect(
      readFile(
        path.join(
          root,
          "minecraft",
          "helix-fabric-sensor",
          "run",
          "config",
          "helix-fabric-sensor.pairing-inbox",
        ),
        "utf8",
      ),
    ).resolves.toBe("/helix pair Z4ZD-X2JJ");
  });

  it("rejects commands and player-pairing material", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "helix-server-pairing-"));
    roots.push(root);

    await expect(
      stageLocalMinecraftServerPairing({
        workspaceRoot: root,
        command: "/helix-player pair Z4ZD-X2JJ",
      }),
    ).rejects.toMatchObject<Partial<LocalServerPairingHandoffError>>({
      code: "local_server_pairing_command_invalid",
    });
  });

  it("stages a bounded opaque envelope with the current loopback redeem endpoint", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "helix-server-pairing-"));
    roots.push(root);

    await stageLocalMinecraftServerPairing({
      workspaceRoot: root,
      command: "/helix pair Z4ZD-X2JJ",
      pairingEndpoint:
        "http://127.0.0.1:60826/api/environment-connectors/v1/pairing/redeem",
    });

    await expect(
      readFile(
        path.join(
          root,
          "minecraft",
          "helix-fabric-sensor",
          "run",
          "config",
          "helix-fabric-sensor.pairing-inbox",
        ),
        "utf8",
      ),
    ).resolves.toBe(JSON.stringify({
      schema: "casimirbot.local_server_pairing_handoff.v1",
      command: "/helix pair Z4ZD-X2JJ",
      pairing_endpoint:
        "http://127.0.0.1:60826/api/environment-connectors/v1/pairing/redeem",
    }));
  });

  it("rejects non-loopback or wrong-path pairing endpoints", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "helix-server-pairing-"));
    roots.push(root);

    await expect(
      stageLocalMinecraftServerPairing({
        workspaceRoot: root,
        command: "/helix pair Z4ZD-X2JJ",
        pairingEndpoint: "https://example.com/api/environment-connectors/v1/pairing/redeem",
      }),
    ).rejects.toMatchObject<Partial<LocalServerPairingHandoffError>>({
      code: "local_server_pairing_endpoint_invalid",
    });
  });

  it("stages into one explicitly selected child server profile", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "helix-server-pairing-"));
    roots.push(root);
    const serverRunDirectory = path.join(
      root,
      "minecraft",
      "helix-fabric-sensor",
      "run",
      "combat-c0-server",
    );

    await expect(
      stageLocalMinecraftServerPairing({
        workspaceRoot: root,
        serverRunDirectory,
        command: "/helix pair Z4ZD-X2JJ",
      }),
    ).resolves.toEqual({ status: "server_pairing_inbox_staged" });

    await expect(
      readFile(
        path.join(
          serverRunDirectory,
          "config",
          "helix-fabric-sensor.pairing-inbox",
        ),
        "utf8",
      ),
    ).resolves.toBe("/helix pair Z4ZD-X2JJ");
  });

  it("discovers the desktop-owned server profile from APPDATA", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "helix-server-pairing-"));
    roots.push(root);
    const serverRunDirectory = path.join(root, "combat-c0-server");
    const playerGameDirectory = path.join(root, ".minecraft-helix-c0");
    await mkdir(path.join(serverRunDirectory, "config"), { recursive: true });
    await writeFile(
      path.join(serverRunDirectory, "server.properties"),
      "server-port=25566\n",
    );
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
        run_directory: serverRunDirectory,
        player_game_directory: playerGameDirectory,
        label: "C0 arena",
      }],
    }));

    await expect(stageLocalMinecraftServerPairing({
      workspaceRoot: root,
      appDataPath: root,
      ownerProfileId: "profile:owner",
      command: "/helix pair Z4ZD-X2JJ",
    })).resolves.toEqual({ status: "server_pairing_inbox_staged" });

    await expect(readFile(path.join(
      serverRunDirectory,
      "config",
      "helix-fabric-sensor.pairing-inbox",
    ), "utf8")).resolves.toBe("/helix pair Z4ZD-X2JJ");
  });

  it("rejects a selected server profile outside the fixed Fabric run root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "helix-server-pairing-"));
    roots.push(root);

    await expect(
      stageLocalMinecraftServerPairing({
        workspaceRoot: root,
        serverRunDirectory: path.join(root, "other-server"),
        command: "/helix pair Z4ZD-X2JJ",
      }),
    ).rejects.toMatchObject<Partial<LocalServerPairingHandoffError>>({
      code: "local_server_pairing_path_invalid",
    });
  });
});
