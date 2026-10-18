import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const solar = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../services/discord/discord-solar-subscriptions", () => ({
  sendDueDiscordSolarUpdates: solar.send,
}));

import { discordRouter } from "../routes/discord";

describe("scheduled Discord solar tick response", () => {
  const original = {
    token: process.env.DISCORD_SOLAR_TICK_TOKEN,
    applicationId: process.env.DISCORD_SOLAR_APPLICATION_ID,
    botToken: process.env.DISCORD_BOT_TOKEN,
  };
  const app = express().use("/api/discord", discordRouter);
  const post = () => request(app).post("/api/discord/solar/tick")
    .set("Authorization", "Bearer test-solar-tick-token");

  beforeEach(() => {
    solar.send.mockReset();
    process.env.DISCORD_SOLAR_TICK_TOKEN = "test-solar-tick-token";
    process.env.DISCORD_SOLAR_APPLICATION_ID = "1357061614624440456";
    process.env.DISCORD_BOT_TOKEN = "test-bot-token";
  });
  afterEach(() => {
    for (const [name, value] of Object.entries({
      DISCORD_SOLAR_TICK_TOKEN: original.token,
      DISCORD_SOLAR_APPLICATION_ID: original.applicationId,
      DISCORD_BOT_TOKEN: original.botToken,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("fails the workflow while the dated movie is unavailable", async () => {
    solar.send.mockResolvedValue({ due: true, unavailable: true, failed: 0, claimed: 0, delivered: 0 });
    const response = await post().expect(503);
    expect(response.body.error).toBe("discord_solar_movie_unavailable");
  });

  it("fails the workflow while a delivery remains unresolved", async () => {
    solar.send.mockResolvedValue({ due: true, unavailable: false, failed: 1, claimed: 0, delivered: 0 });
    const response = await post().expect(503);
    expect(response.body.error).toBe("discord_solar_delivery_unresolved");
  });

  it("returns the dated message receipt on a successful tick", async () => {
    solar.send.mockResolvedValue({
      due: true, unavailable: false, failed: 0, claimed: 1, delivered: 1,
      observationDate: "2026-10-10",
      receipts: [{ guildId: "1326743635819237396", channelId: "1328463342570045551", messageId: "1328463342570045552" }],
    });
    const response = await post().expect(200);
    expect(response.body).toMatchObject({
      ok: true, observationDate: "2026-10-10",
      receipts: [{ messageId: "1328463342570045552" }],
    });
  });
});
