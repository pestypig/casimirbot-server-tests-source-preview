import crypto from "node:crypto";
import express, { type Request } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/discord/discord-state-persistence", () => ({
  loadDiscordState: async () => {},
  saveDiscordState: async () => {},
  claimDiscordLinkCode: async () => true,
}));
vi.mock("../services/discord/discord-voice-invitations", () => ({
  endDiscordVoiceInvitationsForSession: async () => 0,
}));

import { discordRouter } from "../routes/discord";
import {
  completeDiscordProfileLink,
  createDiscordLinkCode,
  createDiscordVoiceSession,
  getDiscordVoiceSession,
  resetDiscordSessionStore,
} from "../services/situation-room/discord-session-store";

describe("Discord profile revocation interaction", () => {
  let app: express.Express;
  let privateKey: crypto.KeyObject;

  beforeEach(() => {
    resetDiscordSessionStore();
    const keys = crypto.generateKeyPairSync("ed25519");
    privateKey = keys.privateKey;
    process.env.DISCORD_PUBLIC_KEY = (keys.publicKey.export({ format: "der", type: "spki" }) as Buffer)
      .subarray(-32).toString("hex");
    app = express();
    app.use(express.json({ verify: (req, _res, bytes) => {
      (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(bytes);
    } }));
    app.use("/api/discord", discordRouter);
  });

  it("revokes only the commander's linked session through a signed slash command", async () => {
    const started = createDiscordVoiceSession({ guild_id: "guild-1", voice_channel_id: "channel-1" });
    const sessionId = started.session!.session_id;
    const link = createDiscordLinkCode({ session_id: sessionId, discord_user_id: "commander" });
    expect(completeDiscordProfileLink({ code: link.code!.code, profile_id: "profile-1" }).ok).toBe(true);

    const post = async (userId: string, subcommand = "unlink") => {
      const body = JSON.stringify({
        id: crypto.randomUUID(), application_id: "app-1", type: 2,
        guild_id: "guild-1", channel_id: "channel-1", token: "interaction-token",
        member: { user: { id: userId, username: userId } },
        data: { name: "helix", options: [{ type: 1, name: subcommand }] },
      });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = crypto.sign(null, Buffer.from(timestamp + body), privateKey).toString("hex");
      return request(app).post("/api/discord/interactions")
        .set("Content-Type", "application/json")
        .set("X-Signature-Ed25519", signature)
        .set("X-Signature-Timestamp", timestamp)
        .send(body).expect(200);
    };

    const denied = await post("other");
    expect(denied.body.data.content).toContain("No CasimirBot profile link belongs to you");
    expect(getDiscordVoiceSession(sessionId)?.linked_profile_id).toBe("profile-1");

    const revoked = await post("commander");
    expect(revoked.body.data.content).toContain("profile link was removed");
    expect(revoked.body.data.flags).toBe(64);
    expect(getDiscordVoiceSession(sessionId)).toMatchObject({ status: "ended", linked_profile_id: null });
    const status = await post("commander", "status");
    expect(status.body.data.content).toContain("No Helix Discord session is active");
  });
});
