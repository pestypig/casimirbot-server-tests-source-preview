import { describe, expect, it } from "vitest";
import { DiscordVoiceRoster } from "../../integrations/discord-helix-bot/src/voice-roster";

const guildId = "1326743635819237396";
const channelId = "1328463342570045551";
const otherChannelId = "1328463342570045552";
const botId = "1357061614624440456";
const memberId = "1328463342570045553";

describe("Discord voice roster", () => {
  it("requires a fresh guild baseline and the bot's exact voice channel", () => {
    const roster = new DiscordVoiceRoster();
    expect(roster.snapshot(guildId, channelId, botId)).toMatchObject({
      complete: false, botPresent: false, participantIds: [],
    });
    roster.observe({ t: "VOICE_STATE_UPDATE", d: { guild_id: guildId, user_id: memberId, channel_id: channelId } });
    expect(roster.snapshot(guildId, channelId, botId).complete).toBe(false);

    roster.observe({ t: "GUILD_CREATE", d: { id: guildId, voice_states: [
      { user_id: botId, channel_id: otherChannelId },
      { user_id: memberId, channel_id: channelId },
    ] } });
    expect(roster.snapshot(guildId, channelId, botId)).toMatchObject({
      complete: true, botPresent: false, participantIds: [memberId],
    });
    roster.observe({ t: "VOICE_STATE_UPDATE", d: { guild_id: guildId, user_id: botId, channel_id: channelId } });
    expect(roster.snapshot(guildId, channelId, botId)).toMatchObject({
      complete: true, botPresent: true, participantIds: [memberId],
    });
    roster.observe({ t: "VOICE_STATE_UPDATE", d: { guild_id: guildId, user_id: botId, channel_id: null } });
    expect(roster.snapshot(guildId, channelId, botId)).toMatchObject({
      complete: true, botPresent: false, participantIds: [memberId],
    });
  });

  it("invalidates the baseline after malformed state, guild deletion, or reconnect", () => {
    const roster = new DiscordVoiceRoster();
    const seed = () => roster.observe({ t: "GUILD_CREATE", d: {
      id: guildId, voice_states: [{ user_id: botId, channel_id: channelId }],
    } });
    seed();
    expect(roster.snapshot(guildId, channelId, botId).botPresent).toBe(true);
    roster.observe({ t: "VOICE_STATE_UPDATE", d: { guild_id: guildId, user_id: memberId } });
    expect(roster.snapshot(guildId, channelId, botId).complete).toBe(false);

    seed();
    roster.observe({ t: "GUILD_DELETE", d: { id: guildId } });
    expect(roster.snapshot(guildId, channelId, botId).complete).toBe(false);

    seed();
    roster.invalidateAll();
    expect(roster.snapshot(guildId, channelId, botId).complete).toBe(false);
  });

  it("signals channel changes but ignores mute-only state updates", () => {
    const roster = new DiscordVoiceRoster();
    expect(roster.observe({ t: "GUILD_CREATE", d: { id: guildId, voice_states: [
      { user_id: botId, channel_id: channelId },
      { user_id: memberId, channel_id: channelId },
    ] } })).toBe(true);
    const before = roster.snapshot(guildId, channelId, botId).revision;
    expect(roster.observe({ t: "VOICE_STATE_UPDATE", d: {
      guild_id: guildId, user_id: memberId, channel_id: channelId, self_mute: true,
    } })).toBe(false);
    expect(roster.snapshot(guildId, channelId, botId).revision).toBe(before);
    expect(roster.observe({ t: "VOICE_STATE_UPDATE", d: {
      guild_id: guildId, user_id: memberId, channel_id: otherChannelId,
    } })).toBe(true);
    expect(roster.snapshot(guildId, channelId, botId)).toMatchObject({
      complete: true, participantIds: [],
    });
  });

  it("blocks admission during a disconnect, then uses replay on RESUME or a fresh baseline on READY", () => {
    const roster = new DiscordVoiceRoster();
    roster.observe({ t: "GUILD_CREATE", d: { id: guildId, voice_states: [
      { user_id: botId, channel_id: channelId },
      { user_id: memberId, channel_id: channelId },
    ] } });
    roster.suspend();
    expect(roster.snapshot(guildId, channelId, botId).complete).toBe(false);
    roster.observe({ t: "VOICE_STATE_UPDATE", d: {
      guild_id: guildId, user_id: memberId, channel_id: otherChannelId,
    } });
    roster.resume();
    expect(roster.snapshot(guildId, channelId, botId)).toMatchObject({
      complete: true, botPresent: true, participantIds: [],
    });

    roster.suspend();
    roster.observe({ t: "READY", d: {} });
    expect(roster.snapshot(guildId, channelId, botId).complete).toBe(false);
    roster.observe({ t: "GUILD_CREATE", d: { id: guildId, voice_states: [
      { user_id: botId, channel_id: channelId },
      { user_id: memberId, channel_id: channelId },
    ] } });
    expect(roster.snapshot(guildId, channelId, botId)).toMatchObject({
      complete: true, botPresent: true, participantIds: [memberId],
    });
  });

  it("fails closed on malformed guild identity and duplicate baseline, while ignoring an absent departure", () => {
    const roster = new DiscordVoiceRoster();
    const seed = () => roster.observe({ t: "GUILD_CREATE", d: {
      id: guildId, voice_states: [{ user_id: botId, channel_id: channelId }],
    } });
    seed();
    expect(roster.observe({ t: "MESSAGE_CREATE", d: {} })).toBe(false);
    expect(roster.snapshot(guildId, channelId, botId).complete).toBe(true);
    expect(roster.observe({ t: "VOICE_STATE_UPDATE", d: {
      user_id: memberId, channel_id: channelId,
    } })).toBe(true);
    expect(roster.snapshot(guildId, channelId, botId).complete).toBe(false);

    seed();
    expect(roster.observe({ t: "VOICE_STATE_UPDATE", d: {
      guild_id: guildId, user_id: memberId, channel_id: null,
    } })).toBe(false);
    expect(roster.snapshot(guildId, channelId, botId).complete).toBe(true);

    expect(roster.observe({ t: "GUILD_CREATE", d: { id: guildId, voice_states: [
      { user_id: botId, channel_id: channelId },
      { user_id: botId, channel_id: otherChannelId },
    ] } })).toBe(true);
    expect(roster.snapshot(guildId, channelId, botId).complete).toBe(false);
  });
});
