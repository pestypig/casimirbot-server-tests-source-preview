import { describe, expect, it } from "vitest";
import { assessDiscordVoiceAdmission } from "../../integrations/discord-helix-bot/src/voice-admission";
import { DiscordVoiceRoster } from "../../integrations/discord-helix-bot/src/voice-roster";

const first = "1328463342570045553";
const second = "1328463342570045554";
const ready = {
  transportReady: true,
  leaseConfirmed: true,
  armed: true,
  roster: { complete: true, botPresent: true, participantIds: [first, second], revision: 4 },
  consents: [
    { discord_user_id: first, consent_version: 1 },
    { discord_user_id: second, consent_version: 2 },
  ],
};

describe("Discord voice admission observation", () => {
  it("requires every current participant's versioned consent", () => {
    expect(assessDiscordVoiceAdmission(ready)).toEqual({
      eligible: true, reason: "consent_coverage_complete:2", rosterRevision: 4,
      participantCount: 2,
    });
    expect(assessDiscordVoiceAdmission({ ...ready, consents: ready.consents.slice(0, 1) })).toMatchObject({
      eligible: false, reason: "participants_missing_consent:1/2",
    });
  });

  it.each([
    [{ transportReady: false }, "dave_transport_unavailable"],
    [{ leaseConfirmed: false }, "worker_lease_unconfirmed"],
    [{ armed: false }, "not_armed"],
    [{ roster: { ...ready.roster, complete: false } }, "roster_incomplete"],
    [{ roster: { ...ready.roster, botPresent: false } }, "bot_voice_state_unconfirmed"],
    [{ roster: { ...ready.roster, participantIds: [] } }, "no_human_participants"],
    [{ roster: { ...ready.roster, participantIds: [first, first] } }, "roster_invalid"],
    [{ roster: { ...ready.roster, participantIds: ["bad-id"] } }, "roster_invalid"],
  ] as const)("fails closed for %s", (change, reason) => {
    expect(assessDiscordVoiceAdmission({ ...ready, ...change })).toMatchObject({
      eligible: false, reason,
    });
  });

  it("rejects malformed or duplicate consent entries", () => {
    for (const consents of [
      [{ discord_user_id: first, consent_version: 0 }],
      [{ discord_user_id: first, consent_version: 1 }, { discord_user_id: first, consent_version: 2 }],
      [{ discord_user_id: "bad-id", consent_version: 1 }],
    ]) {
      expect(assessDiscordVoiceAdmission({ ...ready, consents })).toMatchObject({
        eligible: false, reason: "consent_response_invalid",
      });
    }
  });

  it("drops admission on a new participant or malformed roster and recovers only from a fresh baseline", () => {
    const guildId = "1326743635819237396";
    const channelId = "1328463342570045551";
    const botId = "1357061614624440456";
    const roster = new DiscordVoiceRoster();
    const baseline = (members: string[]) => roster.observe({ t: "GUILD_CREATE", d: {
      id: guildId, voice_states: [
        { user_id: botId, channel_id: channelId },
        ...members.map((user_id) => ({ user_id, channel_id: channelId })),
      ],
    } });
    const assess = (consents: Array<{ discord_user_id: string; consent_version: number }>) =>
      assessDiscordVoiceAdmission({
        transportReady: true, leaseConfirmed: true, armed: true,
        roster: roster.snapshot(guildId, channelId, botId), consents,
      });
    const firstConsent = { discord_user_id: first, consent_version: 1 };
    const secondConsent = { discord_user_id: second, consent_version: 1 };

    baseline([first]);
    expect(assess([firstConsent]).eligible).toBe(true);
    roster.observe({ t: "VOICE_STATE_UPDATE", d: {
      guild_id: guildId, user_id: second, channel_id: channelId,
    } });
    expect(assess([firstConsent])).toMatchObject({
      eligible: false, reason: "participants_missing_consent:1/2",
    });
    roster.observe({ t: "VOICE_STATE_UPDATE", d: null });
    expect(assess([firstConsent, secondConsent])).toMatchObject({
      eligible: false, reason: "roster_incomplete",
    });

    baseline([first, second]);
    expect(assess([firstConsent, secondConsent]).eligible).toBe(true);
    roster.invalidateAll();
    expect(assess([firstConsent, secondConsent])).toMatchObject({
      eligible: false, reason: "roster_incomplete",
    });
  });
});
