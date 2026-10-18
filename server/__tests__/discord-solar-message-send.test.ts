import { describe, expect, it, vi } from "vitest";
import { postDiscordSolarUpdate } from "../services/discord/discord-solar-subscriptions";

const input = {
  applicationId: "1357061614624440456",
  guildId: "1326743635819237396",
  channelId: "1328463342570045551",
  botToken: "test-token",
  movie: {
    date: "2026-10-10",
    url: "https://sdo.gsfc.nasa.gov/assets/img/dailymov/2026/10/10/movie.mp4",
    directory: "https://sdo.gsfc.nasa.gov/assets/img/dailymov/2026/10/10/",
  },
};

describe("Discord solar message delivery", () => {
  it("retries a lost response with the same enforced nonce", async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "1328463342570045552" }), { status: 200 }));
    expect(await postDiscordSolarUpdate({ ...input, fetchImpl })).toEqual({
      delivered: true, messageId: "1328463342570045552",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const first = JSON.parse(String(fetchImpl.mock.calls[0][1].body));
    const second = JSON.parse(String(fetchImpl.mock.calls[1][1].body));
    expect(first.nonce).toMatch(/^[0-9a-f]{24}$/);
    expect(first.enforce_nonce).toBe(true);
    expect(second.nonce).toBe(first.nonce);
    expect(first.allowed_mentions).toEqual({ parse: [] });
  });

  it("retries a server error but stops after two attempts", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 503 }));
    expect(await postDiscordSolarUpdate({ ...input, fetchImpl })).toEqual({
      delivered: false, messageId: null,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a permission error or an accepted message", async () => {
    const forbidden = vi.fn(async () => new Response(null, { status: 403 }));
    expect((await postDiscordSolarUpdate({ ...input, fetchImpl: forbidden })).delivered).toBe(false);
    expect(forbidden).toHaveBeenCalledTimes(1);

    const accepted = vi.fn(async () => new Response("not-json", { status: 200 }));
    expect(await postDiscordSolarUpdate({ ...input, fetchImpl: accepted })).toEqual({
      delivered: true, messageId: null,
    });
    expect(accepted).toHaveBeenCalledTimes(1);
  });
});
