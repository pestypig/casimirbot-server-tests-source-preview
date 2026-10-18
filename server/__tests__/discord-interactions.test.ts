import crypto from "node:crypto";
import express, { type Request } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discordRouter } from "../routes/discord";
import { registerHelixDiscordCommands } from "../services/discord/discord-command-registry";
import {
  listDiscordInteractionReceipts,
  resetDiscordInteractionReceipts,
} from "../services/discord/discord-interaction-router";
import {
  listDiscordFollowupRecords,
  resetDiscordFollowupRecords,
  sendDiscordInteractionFollowup,
  setDiscordFollowupFetchForTests,
} from "../services/discord/discord-followup-client";
import {
  setDiscordHelixAskExecutorForTests,
} from "../services/discord/discord-helix-ask-bridge";
import {
  completeDiscordProfileLink,
  createDiscordLinkCode,
  createDiscordVoiceSession,
  listDiscordVoiceSessions,
  resetDiscordSessionStore,
} from "../services/situation-room/discord-session-store";

type SignedInteraction = {
  body: string;
  timestamp: string;
  signature: string;
};

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json({
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  }));
  app.use("/api/discord", discordRouter);
  return app;
};

function createDiscordSigningContext() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const publicKeyHex = publicDer.subarray(-32).toString("hex");
  return {
    publicKeyHex,
    sign(body: unknown): SignedInteraction {
      const raw = typeof body === "string" ? body : JSON.stringify(body);
      const timestamp = "1778810000";
      const signature = crypto
        .sign(null, Buffer.concat([Buffer.from(timestamp, "utf8"), Buffer.from(raw, "utf8")]), privateKey)
        .toString("hex");
      return { body: raw, timestamp, signature };
    },
  };
}

function baseInteraction(data: Record<string, unknown>) {
  return {
    id: "interaction-1",
    application_id: "app-1",
    type: 2,
    guild_id: "guild-1",
    channel_id: "channel-1",
    token: "interaction-token-1",
    member: {
      user: {
        id: "discord-user-1",
        username: "DatDamPig",
      },
    },
    data,
  };
}

function postSigned(app: express.Express, signed: SignedInteraction) {
  return request(app)
    .post("/api/discord/interactions")
    .set("Content-Type", "application/json")
    .set("X-Signature-Ed25519", signed.signature)
    .set("X-Signature-Timestamp", signed.timestamp)
    .send(signed.body);
}

function linkCommander() {
  const started = createDiscordVoiceSession({ guild_id: "guild-1", voice_channel_id: "channel-1" });
  const code = createDiscordLinkCode({ session_id: started.session!.session_id, discord_user_id: "discord-user-1" });
  completeDiscordProfileLink({ code: code.code!.code, profile_id: "profile-1" });
}

describe("Discord interactions endpoint", () => {
  let signing: ReturnType<typeof createDiscordSigningContext>;

  beforeEach(() => {
    signing = createDiscordSigningContext();
    process.env.DISCORD_PUBLIC_KEY = signing.publicKeyHex;
    delete process.env.HELIX_DISCORD_BOT_REQUIRE_TOKEN;
    delete process.env.DISCORD_BOT_TOKEN;
    delete process.env.DISCORD_PUBLIC_KEYS_JSON;
    process.env.DISCORD_HELIX_ASK_ENABLED = "1";
    process.env.DISCORD_HELIX_ASK_ALLOWED_PROFILE_IDS = "profile-1";
    resetDiscordSessionStore();
    resetDiscordInteractionReceipts();
    resetDiscordFollowupRecords();
    setDiscordFollowupFetchForTests(vi.fn(async () => new Response("{}", { status: 200 })) as typeof fetch);
    setDiscordHelixAskExecutorForTests(null);
  });

  afterEach(() => {
    delete process.env.DISCORD_SOLAR_APPLICATION_ID;
    delete process.env.DISCORD_SOLAR_TICK_TOKEN;
    delete process.env.DISCORD_BOT_TOKEN;
    delete process.env.DISCORD_PUBLIC_KEYS_JSON;
    delete process.env.DISCORD_HELIX_ASK_ENABLED;
    delete process.env.DISCORD_HELIX_ASK_ALLOWED_PROFILE_IDS;
    setDiscordHelixAskExecutorForTests(null);
    setDiscordFollowupFetchForTests(null);
  });

  it("returns PONG for a valid signed Discord PING", async () => {
    const app = createApp();
    const signed = signing.sign({ id: "ping-1", application_id: "app-1", type: 1 });
    const response = await postSigned(app, signed).expect(200);
    expect(response.body).toEqual({ type: 1 });
  });

  it("rejects missing and invalid signatures before command routing", async () => {
    const app = createApp();
    await request(app)
      .post("/api/discord/interactions")
      .send({ id: "ping-1", application_id: "app-1", type: 1 })
      .expect(401);

    const signed = signing.sign({ id: "ping-2", application_id: "app-1", type: 1 });
    await postSigned(app, { ...signed, signature: "0".repeat(128) }).expect(401);
  });

  it("selects the signing key for the SDO application without accepting a different app's signature", async () => {
    const app = createApp();
    const sdoSigning = createDiscordSigningContext();
    process.env.DISCORD_PUBLIC_KEYS_JSON = JSON.stringify({ "1357061614624440456": sdoSigning.publicKeyHex });
    const payload = { id: "sdo-ping", application_id: "1357061614624440456", type: 1 };
    await postSigned(app, sdoSigning.sign(payload)).expect(200);
    await postSigned(app, signing.sign(payload)).expect(401);
  });

  it("delivers an interaction followup using its webhook token without a bot credential", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const receipt = await sendDiscordInteractionFollowup({
      applicationId: "app-1",
      interactionToken: "interaction-token-1",
      payload: { content: "Ready" },
      fetchImpl: fetchMock as typeof fetch,
    });
    expect(receipt.ok).toBe(true);
    expect(receipt).not.toHaveProperty("token");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://discord.com/api/v10/webhooks/app-1/interaction-token-1",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("uploads a private solar frame as a multipart Discord followup", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const receipt = await sendDiscordInteractionFollowup({
      applicationId: "app-1", interactionToken: "interaction-token-1",
      payload: { content: "Solar preview", flags: 64, allowed_mentions: { parse: [] } },
      file: { filename: "solar.jpg", mimeType: "image/jpeg", bytes },
      fetchImpl: fetchMock as typeof fetch,
    });
    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers).toBeUndefined();
    expect(options.body).toBeInstanceOf(FormData);
    const form = options.body as FormData;
    expect(JSON.parse(String(form.get("payload_json")))).toMatchObject({
      flags: 64, allowed_mentions: { parse: [] }, attachments: [{ id: 0, filename: "solar.jpg" }],
    });
    expect(await (form.get("files[0]") as File).arrayBuffer()).toEqual(bytes.buffer.slice(
      bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(receipt.attachment).toEqual({ filename: "solar.jpg", mime_type: "image/jpeg", size_bytes: 4 });
    expect(receipt).not.toHaveProperty("token");
  });

  it("upserts /helix and /solarupdate without deleting existing Discord commands", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    await registerHelixDiscordCommands({
      botToken: "test-token",
      applicationId: "app-1",
      fetchImpl: fetchMock as typeof fetch,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const definitions = fetchMock.mock.calls.map(([, options]) => {
      expect(options.method).toBe("POST");
      return JSON.parse(options.body as string);
    });
    expect(definitions.map((definition) => definition.name)).toEqual(["helix", "solarupdate"]);
    expect(definitions[1].options[0]).toMatchObject({
      name: "action",
      choices: [
        { name: "on", value: "on" },
        { name: "off", value: "off" },
        { name: "status", value: "status" },
      ],
    });
  });

  it("blocks unlinked Discord users before Helix Ask runs", async () => {
    const app = createApp();
    const executor = vi.fn();
    setDiscordHelixAskExecutorForTests(executor);
    const signed = signing.sign(baseInteraction({
      name: "helix",
      options: [{ type: 1, name: "ask", options: [{ type: 3, name: "prompt", value: "Hello" }] }],
    }));
    const reply = await postSigned(app, signed).expect(200);
    expect(reply.body.data.flags).toBe(64);
    expect(reply.body.data.content).toContain("Link your CasimirBot profile");
    expect(executor).not.toHaveBeenCalled();
  });

  it("blocks unlinked users from the private Star Watcher solar preview", async () => {
    const app = createApp();
    const signed = signing.sign(baseInteraction({ name: "helix", options: [{
      type: 2, name: "visual", options: [{ type: 1, name: "solar-preview" }],
    }] }));
    const reply = await postSigned(app, signed).expect(200);
    expect(reply.body.data.flags).toBe(64);
    expect(reply.body.data.content).toContain("Link your CasimirBot profile");
    expect(listDiscordFollowupRecords()).toEqual([]);
  });

  it("requires Manage Server permission for /solarupdate on", async () => {
    const app = createApp();
    const applicationId = "1357061614624440456";
    process.env.DISCORD_SOLAR_APPLICATION_ID = applicationId;
    process.env.DISCORD_BOT_TOKEN = "test-token";
    const base = {
      ...baseInteraction({ name: "solarupdate", options: [{ type: 3, name: "action", value: "on" }] }),
      application_id: applicationId,
      guild_id: "1326743635819237396",
      channel_id: "1328463342570045551",
    };
    const denied = await postSigned(app, signing.sign({
      ...base,
      member: { ...base.member, permissions: "0" },
    })).expect(200);
    expect(denied.body.data.content).toContain("Manage Server permission");
    const allowed = await postSigned(app, signing.sign({
      ...base,
      member: { ...base.member, permissions: "32" },
    })).expect(200);
    expect(allowed.body.data.content).toContain("Daily NASA SDO updates are on");
    expect(allowed.body.data.flags).toBe(64);
  });

  it("keeps the scheduled solar tick behind its dedicated bearer token", async () => {
    const app = createApp();
    process.env.DISCORD_SOLAR_TICK_TOKEN = "test-solar-tick-token";
    await request(app).post("/api/discord/solar/tick").expect(401);
    const unavailable = await request(app)
      .post("/api/discord/solar/tick")
      .set("Authorization", "Bearer test-solar-tick-token")
      .expect(503);
    expect(unavailable.body.error).toBe("discord_solar_delivery_not_configured");
  });

  it("starts a Helix Discord session through /helix start", async () => {
    const app = createApp();
    const signed = signing.sign(baseInteraction({
      name: "helix",
      options: [{ type: 1, name: "start" }],
    }));
    const response = await postSigned(app, signed).expect(200);
    expect(response.body.type).toBe(4);
    expect(response.body.data.content).toContain("Started Helix Discord text session. Voice is not joined.");

    expect(listDiscordVoiceSessions()[0]).toMatchObject({
      guild_id: "guild-1",
      voice_channel_id: "channel-1",
      thread_id: "helix-ask:discord:guild-1:channel-1",
    });
    expect(listDiscordInteractionReceipts().at(-1)).toMatchObject({
      command: "start",
      answer_created: false,
    });
  });

  it("returns a profile link URL through /helix link without credential collection", async () => {
    const app = createApp();
    process.env.CASIMIRBOT_PUBLIC_URL = "https://casimirbot.com";
    const signed = signing.sign(baseInteraction({
      name: "helix",
      options: [{ type: 1, name: "link" }],
    }));
    const response = await postSigned(app, signed).expect(200);
    expect(response.body.type).toBe(4);
    expect(response.body.data.content).toContain("https://casimirbot.com/link-discord?code=");
    expect(response.body.data.content.toLowerCase()).not.toContain("password");
    expect(response.body.data.flags).toBe(64);
  });

  it("lets only the linked commander revoke a Discord profile link", async () => {
    const app = createApp();
    linkCommander();
    const otherUser = signing.sign({
      ...baseInteraction({ name: "helix", options: [{ type: 1, name: "unlink" }] }),
      member: { user: { id: "discord-user-2", username: "Other" } },
    });
    const denied = await postSigned(app, otherUser).expect(200);
    expect(denied.body.data.content).toContain("No CasimirBot profile link belongs to you");
    expect(listDiscordVoiceSessions()[0].linked_profile_id).toBe("profile-1");

    const commander = signing.sign(baseInteraction({
      name: "helix",
      options: [{ type: 1, name: "unlink" }],
    }));
    const response = await postSigned(app, commander).expect(200);
    expect(response.body.data.content).toContain("profile link was removed");
    expect(response.body.data.flags).toBe(64);
    expect(listDiscordVoiceSessions()[0]).toMatchObject({
      status: "ended",
      linked_profile_id: null,
      commander_discord_user_id: null,
      participants: [],
      live_environment_ids: [],
    });
    const ask = signing.sign(baseInteraction({
      name: "helix",
      options: [{ type: 1, name: "ask", options: [{ type: 3, name: "prompt", value: "Hello" }] }],
    }));
    const blocked = await postSigned(app, ask).expect(200);
    expect(blocked.body.data.content).toContain("Link your CasimirBot profile");
  });

  it("rejects profile link completion without a signed-in CasimirBot account", async () => {
    const app = createApp();
    const reply = await request(app)
      .post("/api/discord/session/complete-link")
      .send({ code: "ANYCODE", profile_id: "forged-profile" })
      .expect(401);
    expect(reply.body.error).toBe("casimir_account_session_required");
  });

  it("defers /helix ask, runs Helix Ask through the bridge, and records terminal-authoritative followup", async () => {
    const app = createApp();
    linkCommander();
    setDiscordHelixAskExecutorForTests(async (input) => ({
      ok: true,
      answer: `Terminal answer for: ${input.prompt}`,
      turn_id: "ask:discord-test",
      final_answer_source: "artifact_synthesis",
      terminal_artifact_kind: "assistant_answer",
      terminal_hash: "hash:terminal",
      poison_audit_ok: true,
      terminal_authority_ok: true,
      error: null,
    }));
    const signed = signing.sign(baseInteraction({
      name: "helix",
      options: [
        {
          type: 1,
          name: "ask",
          options: [{ type: 3, name: "prompt", value: "What is my current Minecraft situation?" }],
        },
      ],
    }));
    const response = await postSigned(app, signed).expect(200);
    expect(response.body).toEqual({ type: 5, data: { flags: 64 } });

    await new Promise((resolve) => setTimeout(resolve, 20));
    const followups = listDiscordFollowupRecords();
    expect(followups.at(-1)?.payload.content).toContain("Terminal answer for: What is my current Minecraft situation?");
    expect(followups.at(-1)?.payload.content).toContain("poison_audit: clean");

    expect(listDiscordInteractionReceipts().at(-1)).toMatchObject({
      command: "ask",
      terminal_answer_source: "artifact_synthesis",
      terminal_hash: "hash:terminal",
      poison_audit_ok: true,
      answer_created: true,
    });
  });

  it("reports a safe Discord followup when Helix Ask fails the poison audit", async () => {
    const app = createApp();
    linkCommander();
    setDiscordHelixAskExecutorForTests(async () => ({
      ok: true,
      answer: "Unsafe fallback",
      final_answer_source: "client_fallback",
      terminal_artifact_kind: "fallback",
      terminal_hash: "hash:fallback",
      poison_audit_ok: false,
      terminal_authority_ok: true,
      error: null,
    }));
    const signed = signing.sign(baseInteraction({
      name: "helix",
      options: [
        {
          type: 1,
          name: "ask",
          options: [{ type: 3, name: "prompt", value: "Use Helix." }],
        },
      ],
    }));
    await postSigned(app, signed).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(listDiscordFollowupRecords().at(-1)?.payload.content).toContain("could not return a clean terminal answer");
    expect(listDiscordFollowupRecords().at(-1)?.payload.content).toContain("poison_audit: blocked");
  });

  it("routes /helix cortana minecraft without starting a hidden answer loop", async () => {
    const app = createApp();
    const signed = signing.sign(baseInteraction({
      name: "helix",
      options: [
        {
          type: 2,
          name: "cortana",
          options: [{ type: 1, name: "minecraft" }],
        },
      ],
    }));
    const response = await postSigned(app, signed).expect(200);
    expect(response.body.type).toBe(4);
    expect(response.body.data.content).toContain("Start and link a Helix Discord session");

    expect(listDiscordInteractionReceipts().at(-1)).toMatchObject({
      command: "cortana",
      subcommand: "cortana minecraft",
      answer_created: false,
    });
  });
});
