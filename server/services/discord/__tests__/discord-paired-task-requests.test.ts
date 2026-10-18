import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  roomsAccess: vi.fn(),
  membership: vi.fn(),
}));
vi.mock("../../../db/client", () => ({ ensureDatabase: vi.fn(async () => undefined),
  getPool: () => ({ query: mocks.query }) }));
vi.mock("../../helix-account/account-session-store", () => ({
  hasActiveSharedRealtimeRoomsAccessForProfile: mocks.roomsAccess,
}));
vi.mock("../../helix-ask/realtime-room/room-store/rooms", () => ({
  readSharedRealtimeRoomMembership: mocks.membership,
}));

import { listDiscordPairedTaskRequests, pairedTaskPilotAllowed,
  queueDiscordPairedTaskRequest, submitDiscordPairedTaskAnswer } from "../discord-paired-task-requests";

const roomId = "shared_realtime_room:ce03ad8e-d0cb-4d73-8324-94b069f8e8c8";
const requestId = "discord_task:11111111-2222-4333-8444-555555555555";
const profileId = "owner-profile";
const guildId = "1326743635819237396";
const channelId = "1326743635819237399";
const userId = "111111111111111111";
const row = () => ({ request_id: requestId, interaction_id: "222222222222222222",
  application_id: "1357061614624440456", guild_id: guildId, channel_id: channelId,
  discord_user_id: userId, session_id: "discord-session", room_id: roomId,
  linked_profile_id: profileId, prompt: "A public greeting?", status: "queued",
  answer_sha256: null, discord_message_id: null, created_at: new Date("2026-10-11T20:00:00Z"),
  expires_at: new Date(Date.now() + 600_000) });
const session = () => ({ session_id: "discord-session", status: "active",
  linked_profile_id: profileId, shared_live_room_id: roomId,
  guild_id: guildId, text_channel_id: channelId,
  commander_discord_user_id: userId });

beforeEach(() => {
  vi.stubEnv("DISCORD_PAIRED_TASK_ENABLED", "1");
  vi.stubEnv("DISCORD_PAIRED_TASK_PROFILE_ID", profileId);
  vi.stubEnv("DISCORD_PAIRED_TASK_GUILD_ID", guildId);
  vi.stubEnv("DISCORD_PAIRED_TASK_CHANNEL_ID", channelId);
  vi.stubEnv("DISCORD_BOT_TOKEN", "test-bot-token");
  mocks.query.mockReset(); mocks.roomsAccess.mockReset(); mocks.membership.mockReset();
  mocks.roomsAccess.mockResolvedValue(true);
  mocks.membership.mockResolvedValue({ role: "owner", presence: "present", roomStatus: "open" });
});
afterEach(() => vi.unstubAllEnvs());

describe("Discord paired-task public pilot", () => {
  it("admits only the exact configured owner, guild and channel", () => {
    expect(pairedTaskPilotAllowed({ profileId, guildId, channelId })).toBe(true);
    expect(pairedTaskPilotAllowed({ profileId, guildId, channelId: "999999999999999999" })).toBe(false);
    vi.stubEnv("DISCORD_PAIRED_TASK_ENABLED", "0");
    expect(pairedTaskPilotAllowed({ profileId, guildId, channelId })).toBe(false);
  });

  it("does not list a queued prompt after its linked Discord session changes", async () => {
    mocks.query.mockImplementation(async (sql: string) => sql.includes("FROM helix_discord_paired_task_requests")
      ? { rows: [row()] } : { rows: [{ session_json: { ...session(), shared_live_room_id: null } }] });
    await expect(listDiscordPairedTaskRequests({ profileId, roomId }))
      .rejects.toMatchObject({ code: "discord_paired_task_session_changed" });
  });

  it("queues a bounded prompt with a stable interaction identity", async () => {
    mocks.query.mockImplementation(async (sql: string) => sql.includes("FROM helix_discord_sessions")
      ? { rows: [{ session_json: session() }] } : { rows: [row()] });
    const queued = await queueDiscordPairedTaskRequest({
      interactionId: "222222222222222222", applicationId: "1357061614624440456",
      guildId, channelId, discordUserId: userId, sessionId: "discord-session",
      roomId, profileId, prompt: "A public greeting?",
    });
    expect(queued).toMatchObject({ request_id: requestId, status: "queued", prompt: "A public greeting?" });
  });

  it("claims once, disables mentions, and returns the public Discord message ID", async () => {
    const answer = "Hello from the Discord dojo pilot.";
    const posted = vi.fn(async () => ({ ok: true, json: async () => ({ id: "333333333333333333" }) }));
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM helix_discord_sessions")) return { rows: [{ session_json: session() }] };
      if (sql.includes("UPDATE helix_discord_paired_task_requests SET status='claimed'")) return { rows: [row()] };
      if (sql.includes("UPDATE helix_discord_paired_task_requests")) return { rows: [] };
      return { rows: [row()] };
    });
    const authorizeNode = vi.fn(async () => undefined);
    const result = await submitDiscordPairedTaskAnswer({ profileId, roomId, requestId,
      answer, authorizeNode, fetchImpl: posted as unknown as typeof fetch });
    expect(result).toEqual({ requestId, status: "delivered", messageId: "333333333333333333" });
    expect(authorizeNode).toHaveBeenCalledTimes(2);
    expect(posted).toHaveBeenCalledTimes(1);
    const body = JSON.parse(posted.mock.calls[0][1].body);
    expect(body).toMatchObject({ allowed_mentions: { parse: [] }, enforce_nonce: true });
    expect(body.content).toContain(answer);
  });
});
