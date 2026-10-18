import { describe, expect, it } from "vitest";
import { parseMinecraftLocalServerResult } from "../minecraft-local-server-lifecycle";
import { MinecraftLocalLifecycleError } from "../minecraft-fabric-loopback-lifecycle";

const server = { schema: "helix.minecraft.local_server_lifecycle.v1", status: "listening",
  server_process_id: 4321, process_started_at: "2026-09-14T00:00:00.000Z",
  observed_at: "2026-09-14T00:00:05.000Z", server_address: "127.0.0.1:25566",
  launcher_action: "launched_server", profile_digest: "a".repeat(64),
  credentials_exposed: false, authority_widened: false };

describe("saved server observations", () => {
  it("accepts only a complete listening receipt after bounded provider progress", () => {
    expect(parseMinecraftLocalServerResult(`progress\n${JSON.stringify({ ok: true, server })}`)).toEqual(server);
  });
  it("preserves timestamped partial effects on timeout", () => {
    expect(() => parseMinecraftLocalServerResult(JSON.stringify({ ok: false,
      error: "minecraft_server_start_timeout", server: { ...server, status: "starting" } })))
      .toThrowError(expect.objectContaining({ code: "minecraft_server_start_timeout",
        observation: { ...server, status: "starting" } }));
  });
  it.each([
    { ...server, observed_at: undefined }, { ...server, command: "private" },
    { ...server, authority_widened: true }, { ...server, server_address: "example.com:25566" },
    { ...server, server_address: "localhost:65536" },
  ])("rejects incomplete or unbounded output without forwarding raw details", candidate => {
    expect(() => parseMinecraftLocalServerResult(JSON.stringify({ ok: true, server: candidate })))
      .toThrowError("minecraft_server_receipt_missing");
    expect(new MinecraftLocalLifecycleError("minecraft_client_failed", 503, "safe", candidate as any).serverObservation).toBeNull();
  });
  it("does not turn a starting observation into readiness", () => {
    expect(() => parseMinecraftLocalServerResult(JSON.stringify({ ok: true, server: { ...server, status: "starting" } })))
      .toThrowError("minecraft_server_not_ready");
  });
});
