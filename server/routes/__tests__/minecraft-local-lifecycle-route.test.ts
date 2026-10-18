import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lifecycleMocks = vi.hoisted(() => ({ execute: vi.fn() }));
const selectionMocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../../services/environment-connectors/pairing/local-minecraft-run-profile-store", () => ({
  readProfileOwnedMinecraftLifecycleAddress: selectionMocks.read,
}));

vi.mock(
  "../../services/environment-connectors/installations/minecraft-fabric-loopback-lifecycle",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("../../services/environment-connectors/installations/minecraft-fabric-loopback-lifecycle")
    >();
    return {
      ...actual,
      executeMinecraftFabricLoopbackLifecycle: lifecycleMocks.execute,
    };
  },
);

import { resetDbClient } from "../../db/client";
import { MinecraftLocalLifecycleError } from "../../services/environment-connectors/installations/minecraft-fabric-loopback-lifecycle";
import { accountSessionRouter } from "../account-session";
import { environmentConnectorBrowserRouter } from
  "../environment-connector-platform";

const receipt = {
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
} as const;

describe("Minecraft local lifecycle browser/desktop route", () => {
  beforeEach(async () => {
    vi.stubEnv(
      "DATABASE_URL",
      `pg-mem://minecraft-local-lifecycle-route-${crypto.randomUUID()}`,
    );
    vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "0");
    await resetDbClient();
    lifecycleMocks.execute.mockReset();
    lifecycleMocks.execute.mockResolvedValue(receipt);
    selectionMocks.read.mockReset().mockResolvedValue("127.0.0.1:25566");
  });

  afterEach(async () => {
    await resetDbClient();
    vi.unstubAllEnvs();
  });

  const app = () => {
    const instance = express();
    instance.use("/api/account", express.json(), accountSessionRouter);
    instance.use("/api/agi", environmentConnectorBrowserRouter);
    return instance;
  };

  it("requires an explicit same-origin operator confirmation", async () => {
    const response = await request(app())
      .post(
        "/api/agi/environment-connectors/local/minecraft/fabric-loopback/launch",
      )
      .set("Host", "127.0.0.1")
      .set("Origin", "http://127.0.0.1")
      .set("Sec-Fetch-Site", "same-origin")
      .send({ address: "localhost:25565" })
      .expect(400);
    expect(response.body).toMatchObject({
      error: "minecraft_lifecycle_operator_confirmation_required",
      terminal_eligible: false,
    });
    expect(lifecycleMocks.execute).not.toHaveBeenCalled();
  });

  it("keeps the operator action developer-only", async () => {
    const user = request.agent(app());
    await user
      .post("/api/account/session/sign-in")
      .send({
        profile_id: "profile:minecraft-local-user",
        display_name: "Minecraft Local User",
        account_type: "user",
      })
      .expect(200);
    const response = await user
      .post(
        "/api/agi/environment-connectors/local/minecraft/fabric-loopback/launch",
      )
      .set("Host", "127.0.0.1")
      .set("Origin", "http://127.0.0.1")
      .set("Sec-Fetch-Site", "same-origin")
      .send({
        address: "localhost:25565",
        operator_confirmation: true,
      })
      .expect(403);
    expect(response.body.error).toBe(
      "minecraft_local_lifecycle_account_policy_blocked",
    );
    expect(lifecycleMocks.execute).not.toHaveBeenCalled();
  });

  it("returns the same observation receipt to a local developer browser or EXE renderer", async () => {
    const developer = request.agent(app());
    await developer
      .post("/api/account/session/sign-in")
      .send({
        profile_id: "profile:minecraft-local-developer",
        display_name: "Minecraft Local Developer",
        account_type: "developer",
      })
      .expect(200);
    const response = await developer
      .post(
        "/api/agi/environment-connectors/local/minecraft/fabric-loopback/launch",
      )
      .set("Host", "127.0.0.1")
      .set("Origin", "http://127.0.0.1")
      .set("Sec-Fetch-Site", "same-origin")
      .send({
        address: "localhost",
        operator_confirmation: true,
      })
      .expect(200);
    expect(response.body).toMatchObject({
      schema: "helix.minecraft.local_lifecycle_observation.v1",
      ok: true,
      status: "connected",
      invocation_source: "explicit_operator_ui",
      receipt,
      credential_included: false,
      terminal_eligible: false,
      assistant_answer: false,
    });
    expect(lifecycleMocks.execute).toHaveBeenCalledWith({
      request: { address: "localhost:25565" },
      ownerProfileId: "profile:minecraft-local-developer",
      allowServerStartup: true,
    });
    const selection = await developer.get("/api/agi/environment-connectors/local/minecraft/fabric-loopback/selection")
      .set("Host", "127.0.0.1").set("Origin", "http://127.0.0.1").set("Sec-Fetch-Site", "same-origin").expect(200);
    expect(selection.body).toMatchObject({
      schema: "helix.minecraft.local_selection_observation.v1",
      ok: true, address: "127.0.0.1:25566", credential_included: false,
      authority_granted: false, assistant_answer: false, terminal_eligible: false,
    });
    expect(Date.parse(selection.body.observed_at)).toBeLessThanOrEqual(Date.now());
    expect(selection.headers["cache-control"]).toBe("no-store");
    expect(selectionMocks.read).toHaveBeenCalledWith({ ownerProfileId: "profile:minecraft-local-developer", appDataPath: process.env.APPDATA });
    const server = { schema: "helix.minecraft.local_server_lifecycle.v1", status: "listening",
      server_process_id: 4321, process_started_at: "2026-09-14T00:00:00.000Z", observed_at: "2026-09-14T00:00:05.000Z",
      server_address: "127.0.0.1:25566", launcher_action: "launched_server", profile_digest: "a".repeat(64),
      credentials_exposed: false, authority_widened: false } as const;
    lifecycleMocks.execute.mockRejectedValueOnce(new MinecraftLocalLifecycleError("minecraft_client_setup_required", 409, "private fixture", server));
    const failure = await developer.post("/api/agi/environment-connectors/local/minecraft/fabric-loopback/launch")
      .set("Host", "127.0.0.1").set("Origin", "http://127.0.0.1").set("Sec-Fetch-Site", "same-origin")
      .send({ address: "127.0.0.1:25566", operator_confirmation: true }).expect(409);
    expect(failure.body).toMatchObject({ ok: false, server_lifecycle: server, terminal_eligible: false });
    expect(JSON.stringify(failure.body)).not.toContain("private fixture");
  });
  it("does not disclose saved selection to an unauthenticated caller", async () => {
    const response = await request(app()).get("/api/agi/environment-connectors/local/minecraft/fabric-loopback/selection")
      .set("Host", "127.0.0.1").set("Origin", "http://127.0.0.1").set("Sec-Fetch-Site", "same-origin").expect(403);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(selectionMocks.read).not.toHaveBeenCalled();
  });
  it("reports a missing saved selection without launching or granting anything", async () => {
    selectionMocks.read.mockResolvedValueOnce(null);
    const developer = request.agent(app());
    await developer.post("/api/account/session/sign-in").send({
      profile_id: "profile:minecraft-local-developer", display_name: "Minecraft Local Developer", account_type: "developer",
    }).expect(200);
    const response = await developer.get("/api/agi/environment-connectors/local/minecraft/fabric-loopback/selection")
      .set("Host", "127.0.0.1").set("Origin", "http://127.0.0.1")
      .set("Sec-Fetch-Site", "same-origin").expect(409);
    expect(response.body).toMatchObject({ error: "minecraft_saved_loopback_selection_required", terminal_eligible: false });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(lifecycleMocks.execute).not.toHaveBeenCalled();
  });
});
