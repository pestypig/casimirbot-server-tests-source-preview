import { describe, expect, it, vi } from "vitest";
import { findRecentSdoDailyMovie } from "../services/discord/discord-image-fetcher";
import { claimDiscordLinkCode, loadDiscordState, saveDiscordState } from "../services/discord/discord-state-persistence";
import {
  completeDiscordProfileLink,
  createDiscordLinkCode,
  createDiscordVoiceSession,
  getDiscordVoiceSession,
  resetDiscordSessionStore,
} from "../services/situation-room/discord-session-store";
import {
  getDiscordSolarSubscription,
  sendDueDiscordSolarUpdates,
  setDiscordSolarSubscription,
} from "../services/discord/discord-solar-subscriptions";

describe("Discord solar delivery", () => {
  it("restores a linked profile after clearing process memory", async () => {
    resetDiscordSessionStore();
    const started = createDiscordVoiceSession({ guild_id: "guild-persist", voice_channel_id: "channel-persist" });
    const sessionId = started.session!.session_id;
    const link = createDiscordLinkCode({ session_id: sessionId, discord_user_id: "user-persist" });
    await saveDiscordState();
    resetDiscordSessionStore();
    await loadDiscordState();
    expect(await claimDiscordLinkCode(link.code!.code)).toBe(true);
    expect(await claimDiscordLinkCode(link.code!.code)).toBe(false);
    const completed = completeDiscordProfileLink({ code: link.code!.code, profile_id: "profile-persist" });
    expect(completed.ok).toBe(true);
    await saveDiscordState();
    resetDiscordSessionStore();
    await loadDiscordState();
    expect(getDiscordVoiceSession(sessionId)).toMatchObject({
      linked_profile_id: "profile-persist",
      commander_discord_user_id: "user-persist",
      status: "active",
    });
    resetDiscordSessionStore();
    await loadDiscordState();
    expect(completeDiscordProfileLink({ code: link.code!.code, profile_id: "other-profile" }).ok).toBe(false);
  });

  it("checks the dated NASA MP4 before returning it", async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(null, {
      status: url.includes("20261008") ? 200 : 404,
      headers: { "content-type": "video/mp4" },
    }));
    const movie = await findRecentSdoDailyMovie(new Date("2026-10-09T14:00:00Z"), fetchMock as typeof fetch);
    expect(movie).toMatchObject({ ok: true, date: "2026-10-08" });
    if (movie.ok) expect(movie.url).toContain("20261008_1024_0193.mp4");
  });

  it("persists a subscription and claims its daily send only once", async () => {
    const applicationId = "1357061614624440456";
    const guildId = "1326743635819237396";
    const channelId = "1328463342570045551";
    expect(await setDiscordSolarSubscription({
      application_id: applicationId,
      guild_id: guildId,
      channel_id: channelId,
      enabled: true,
    })).toBe(true);
    expect(await getDiscordSolarSubscription(applicationId, guildId)).toMatchObject({ channel_id: channelId });
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === "HEAD") return new Response(null, { status: 200, headers: { "content-type": "video/mp4" } });
      return new Response(JSON.stringify({ id: "1328463342570045552" }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const input = {
      applicationId,
      botToken: "test-token",
      triggerSource: "opportunistic_timer" as const,
      now: new Date("2026-10-09T12:01:00Z"),
      fetchImpl: fetchMock as typeof fetch,
    };
    expect(await sendDueDiscordSolarUpdates(input)).toMatchObject({
      due: true, observationDate: "2026-10-08", claimed: 1, delivered: 1, failed: 0,
      receipts: [{ guildId, channelId, messageId: "1328463342570045552", triggerSource: "opportunistic_timer" }],
    });
    expect(await sendDueDiscordSolarUpdates({ ...input, triggerSource: "authenticated_tick" })).toMatchObject({
      due: true, claimed: 0, delivered: 0, alreadyDelivered: 1, failed: 0,
      receipts: [{ guildId, channelId, messageId: "1328463342570045552", triggerSource: "opportunistic_timer" }],
    });
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  });

  it("reports an unresolved daily delivery without a later duplicate", async () => {
    const applicationId = "1357061614624440457";
    const guildId = "1326743635819237397";
    const channelId = "1328463342570045553";
    expect(await setDiscordSolarSubscription({
      application_id: applicationId, guild_id: guildId, channel_id: channelId, enabled: true,
    })).toBe(true);
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) =>
      options?.method === "HEAD"
        ? new Response(null, { status: 200, headers: { "content-type": "video/mp4" } })
        : new Response(null, { status: 403 }));
    const input = {
      applicationId, botToken: "test-token", triggerSource: "authenticated_tick" as const, now: new Date("2026-10-09T12:01:00Z"),
      fetchImpl: fetchMock as typeof fetch,
    };
    expect(await sendDueDiscordSolarUpdates(input)).toMatchObject({
      due: true, claimed: 1, delivered: 0, failed: 1, unavailable: false,
    });
    expect(await sendDueDiscordSolarUpdates(input)).toMatchObject({
      due: true, claimed: 0, delivered: 0, failed: 1, unavailable: false,
    });
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  });

  it("signals movie unavailability so a later tick can retry discovery", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    expect(await sendDueDiscordSolarUpdates({
      applicationId: "1357061614624440456", botToken: "test-token",
      triggerSource: "authenticated_tick",
      now: new Date("2026-10-09T12:01:00Z"), fetchImpl: fetchMock as typeof fetch,
    })).toMatchObject({ due: true, unavailable: true, claimed: 0, delivered: 0 });
  });
});
