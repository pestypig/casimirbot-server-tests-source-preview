import crypto from "node:crypto";
import express, { type Request } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discordRouter } from "../routes/discord";
import { buildHelixDiscordCommandDefinition } from "../services/discord/discord-command-registry";
import { runDiscordSolarPreview } from "../services/discord/discord-solar-preview";
import { loadDiscordState } from "../services/discord/discord-state-persistence";
import { listDiscordFollowupRecords, resetDiscordFollowupRecords,
  setDiscordFollowupFetchForTests } from "../services/discord/discord-followup-client";
import { completeDiscordProfileLink, createDiscordLinkCode, createDiscordVoiceSession,
  resetDiscordSessionStore } from "../services/situation-room/discord-session-store";

vi.mock("../services/discord/discord-state-persistence", () => ({
  loadDiscordState: vi.fn(async () => undefined),
  saveDiscordState: vi.fn(async () => undefined),
  claimDiscordLinkCode: vi.fn(async () => false),
}));
vi.mock("../services/discord/discord-solar-preview", () => ({
  runDiscordSolarPreview: vi.fn(),
}));

function app() {
  const instance = express();
  instance.use(express.json({ verify(req, _res, bytes) {
    (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(bytes);
  } }));
  instance.use("/api/discord", discordRouter);
  return instance;
}

function signedInteraction(privateKey: crypto.KeyObject) {
  const body = JSON.stringify({
    id: "solar-preview-interaction", application_id: "app-1", type: 2,
    guild_id: "guild-1", channel_id: "channel-1", token: "interaction-token-1",
    member: { user: { id: "discord-user-1", username: "owner" } },
    data: { name: "helix", options: [{ type: 2, name: "visual", options: [
      { type: 1, name: "solar-preview", options: [{ type: 3, name: "channel", value: "aia193" }] },
    ] }] },
  });
  const timestamp = "1778810000";
  const signature = crypto.sign(null, Buffer.from(timestamp + body), privateKey).toString("hex");
  return { body, timestamp, signature };
}

describe("signed Discord solar preview interaction", () => {
  let privateKey: crypto.KeyObject;

  beforeEach(() => {
    const keys = crypto.generateKeyPairSync("ed25519");
    privateKey = keys.privateKey;
    process.env.DISCORD_PUBLIC_KEY = (keys.publicKey.export({ format: "der", type: "spki" }) as Buffer)
      .subarray(-32).toString("hex");
    resetDiscordSessionStore();
    resetDiscordFollowupRecords();
    vi.mocked(loadDiscordState).mockResolvedValue(undefined);
    vi.mocked(runDiscordSolarPreview).mockReset();
    setDiscordFollowupFetchForTests(vi.fn(async () => new Response("{}", { status: 200 })) as typeof fetch);
  });

  afterEach(() => {
    delete process.env.DISCORD_PUBLIC_KEY;
    setDiscordFollowupFetchForTests(null);
  });

  it("registers solar-preview as a channel-scoped visual subcommand", () => {
    const visual = buildHelixDiscordCommandDefinition().options.find(option => option.name === "visual");
    const options = visual?.options as Array<Record<string, unknown>> | undefined;
    expect(options?.find(option => option.name === "solar-preview")).toMatchObject({
      type: 1, options: [{ name: "channel", required: false }],
    });
  });

  it("refuses an unlinked commander without fetching a frame", async () => {
    const signed = signedInteraction(privateKey);
    const reply = await request(app()).post("/api/discord/interactions")
      .set("X-Signature-Ed25519", signed.signature)
      .set("X-Signature-Timestamp", signed.timestamp)
      .set("Content-Type", "application/json").send(signed.body).expect(200);
    expect(reply.body.data.flags).toBe(64);
    expect(reply.body.data.content).toContain("Link your CasimirBot profile");
    expect(runDiscordSolarPreview).not.toHaveBeenCalled();
  });

  it("defers a linked command privately and sends its exact image file", async () => {
    const session = createDiscordVoiceSession({ guild_id: "guild-1", voice_channel_id: "channel-1" });
    const code = createDiscordLinkCode({ session_id: session.session!.session_id, discord_user_id: "discord-user-1" });
    completeDiscordProfileLink({ code: code.code!.code, profile_id: "profile-1" });
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    vi.mocked(runDiscordSolarPreview).mockResolvedValue({
      ok: true, content: "Star Watcher live preview", sha256: "a".repeat(64),
      file: { filename: "solar.jpg", mimeType: "image/jpeg", bytes },
    });
    const signed = signedInteraction(privateKey);
    const reply = await request(app()).post("/api/discord/interactions")
      .set("X-Signature-Ed25519", signed.signature)
      .set("X-Signature-Timestamp", signed.timestamp)
      .set("Content-Type", "application/json").send(signed.body).expect(200);
    expect(reply.body).toEqual({ type: 5, data: { flags: 64 } });
    await vi.waitFor(() => expect(listDiscordFollowupRecords()).toHaveLength(1));
    expect(runDiscordSolarPreview).toHaveBeenCalledWith({ profileId: "profile-1", channel: "aia193" });
    expect(listDiscordFollowupRecords()[0]).toMatchObject({
      ok: true, payload: { flags: 64, allowed_mentions: { parse: [] } },
      attachment: { filename: "solar.jpg", size_bytes: 4 },
    });
  });
});
