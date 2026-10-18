import { beforeEach, describe, expect, it } from "vitest";
import {
  completeDiscordProfileLink,
  createDiscordLinkCode,
  createDiscordVoiceSession,
  getDiscordVoiceSession,
  resetDiscordSessionStore,
  unlinkDiscordProfile,
} from "../services/situation-room/discord-session-store";
import { getCompanionPolicy, resetCompanionPolicies } from "../services/situation-room/companion-policy-engine";
import { buildHelixDiscordCommandDefinition } from "../services/discord/discord-command-registry";

describe("Discord profile revocation", () => {
  beforeEach(() => {
    resetDiscordSessionStore();
    resetCompanionPolicies();
  });

  it("ends the linked session, closes voice policy, and rejects another user", () => {
    expect(buildHelixDiscordCommandDefinition().options).toContainEqual(expect.objectContaining({ name: "unlink" }));
    const started = createDiscordVoiceSession({ guild_id: "guild", voice_channel_id: "channel" });
    const sessionId = started.session!.session_id;
    const code = createDiscordLinkCode({ session_id: sessionId, discord_user_id: "commander" });
    expect(completeDiscordProfileLink({ code: code.code!.code, profile_id: "profile" }).ok).toBe(true);

    const denied = unlinkDiscordProfile({ session_id: sessionId, discord_user_id: "other" });
    expect(denied.error).toBe("discord_commander_required");
    expect(getDiscordVoiceSession(sessionId)?.linked_profile_id).toBe("profile");

    const revoked = unlinkDiscordProfile({ session_id: sessionId, discord_user_id: "commander" });
    expect(revoked.ok).toBe(true);
    expect(revoked.session).toMatchObject({
      status: "ended", linked_profile_id: null, commander_discord_user_id: null,
      participants: [], live_environment_ids: [],
    });
    const policy = getCompanionPolicy(revoked.session!.thread_id!);
    expect(policy).toMatchObject({ voice_input_active: false, voice_output_enabled: false, companion_mode: "off" });
    expect(createDiscordLinkCode({ session_id: sessionId, discord_user_id: "commander" }).ok).toBe(false);
  });

  it("invalidates outstanding codes when the linked commander revokes the session", () => {
    const started = createDiscordVoiceSession({ guild_id: "guild", voice_channel_id: "channel" });
    const sessionId = started.session!.session_id;
    const first = createDiscordLinkCode({ session_id: sessionId, discord_user_id: "commander" });
    expect(completeDiscordProfileLink({ code: first.code!.code, profile_id: "profile" }).ok).toBe(true);
    const pending = createDiscordLinkCode({ session_id: sessionId, discord_user_id: "commander" });
    expect(pending.ok).toBe(true);

    expect(unlinkDiscordProfile({ session_id: sessionId, discord_user_id: "commander" }).ok).toBe(true);
    const replay = completeDiscordProfileLink({ code: pending.code!.code, profile_id: "profile" });
    expect(replay.ok).toBe(false);
    expect(replay.error).toBe("link_code_consumed");
  });
});
