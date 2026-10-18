import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  roomsAccess: vi.fn(),
  membership: vi.fn(),
}));
vi.mock("../../../db/client", () => ({
  ensureDatabase: vi.fn(async () => undefined),
  getPool: () => ({ query: mocks.query }),
}));
vi.mock("../../helix-account/account-session-store", () => ({
  hasActiveSharedRealtimeRoomsAccessForProfile: mocks.roomsAccess,
}));
vi.mock("../../helix-ask/realtime-room/room-store/rooms", () => ({
  readSharedRealtimeRoomMembership: mocks.membership,
}));

import { inspectDiscordStreamProposal, proposeDiscordStream,
  requireDiscordStreamOwner } from "../discord-stream-selection";

const profileId = "owner-profile";
const roomId = "shared_realtime_room:ce03ad8e-d0cb-4d73-8324-94b069f8e8c8";
const guildId = "1326743635819237396";
const channelId = "1326743635819237399";
const session = (sharedRoomId = roomId) => ({
  status: "active", linked_profile_id: profileId,
  shared_live_room_id: sharedRoomId, guild_id: guildId,
  text_channel_id: channelId,
});

beforeEach(() => {
  mocks.query.mockReset(); mocks.roomsAccess.mockReset(); mocks.membership.mockReset();
  mocks.roomsAccess.mockResolvedValue(true);
  mocks.membership.mockResolvedValue({ role: "owner", presence: "present", roomStatus: "open" });
});

describe("Discord stream destination binding", () => {
  it("queries the exact active room before limiting session rows", async () => {
    mocks.query.mockResolvedValue({ rows: [{ session_json: session() }] });
    await expect(requireDiscordStreamOwner(profileId, roomId))
      .resolves.toEqual({ guildId, channelId });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining(
      "session_json->>'shared_live_room_id'=$2"), [profileId, roomId]);
    expect(mocks.query.mock.calls[0][0]).toContain("session_json->>'status'='active'");
  });

  it("rejects a returned session bound to another room", async () => {
    mocks.query.mockResolvedValue({ rows: [{ session_json: session("shared_realtime_room:other") }] });
    await expect(requireDiscordStreamOwner(profileId, roomId))
      .rejects.toMatchObject({ code: "discord_stream_channel_not_bound" });
  });

  it("requires account room access and present owner before reading sessions", async () => {
    mocks.roomsAccess.mockResolvedValueOnce(false);
    await expect(requireDiscordStreamOwner(profileId, roomId))
      .rejects.toMatchObject({ code: "discord_stream_room_access_off" });
    mocks.membership.mockResolvedValueOnce({ role: "owner", presence: "absent", roomStatus: "open" });
    await expect(requireDiscordStreamOwner(profileId, roomId))
      .rejects.toMatchObject({ code: "discord_stream_owner_absent" });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("rejects a bound session with an invalid Discord destination", async () => {
    mocks.query.mockResolvedValue({ rows: [{ session_json: {
      ...session(), text_channel_id: "invalid-channel",
    } }] });
    await expect(requireDiscordStreamOwner(profileId, roomId))
      .rejects.toMatchObject({ code: "discord_stream_channel_not_bound" });
  });
});

describe("Discord stream proposal boundary", () => {
  const proposerRef = "oauth-client:stream-controller";
  const bLink = "codex://threads/01a03464-1f5e-7f93-bd17-e4ca8a0bec9e";

  it("rejects a proposal from a non-owner before writing it", async () => {
    mocks.membership.mockResolvedValueOnce({ role: "member", presence: "present",
      roomStatus: "open" });
    await expect(proposeDiscordStream({ profileId, roomId, proposerRef,
      request: { mode: "selected", chat_links: [bLink] } }))
      .rejects.toMatchObject({ code: "discord_stream_owner_absent" });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("returns only a pending receipt for an exact-link proposal", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ session_json: session() }] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await proposeDiscordStream({ profileId, roomId, proposerRef,
      request: { mode: "selected", chat_links: [bLink] } });
    expect(result).toMatchObject({ ok: true, status: "pending_owner_approval",
      transcript_included: false, source_catalog_included: false });
    expect(mocks.query.mock.calls[1][1]).toEqual(expect.arrayContaining([profileId,
      roomId, proposerRef, JSON.stringify({ mode: "selected", chat_links: [bLink] })]));
  });

  it("reports an expired proposal without exposing its source catalog", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ status: "pending",
      expires_at: "2020-01-01T00:00:00.000Z" }] });
    await expect(inspectDiscordStreamProposal({ profileId, roomId, proposerRef,
      requestId: "request-1" })).resolves.toMatchObject({ status: "expired",
      transcript_included: false, source_catalog_included: false });
  });

  it("does not reveal another client's proposal", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });
    await expect(inspectDiscordStreamProposal({ profileId, roomId, proposerRef,
      requestId: "another-client-request" })).rejects.toMatchObject({
      code: "discord_stream_proposal_unavailable", status: 404,
    });
    expect(mocks.query.mock.calls[0][1]).toEqual([
      "another-client-request", profileId, roomId, proposerRef,
    ]);
  });
});
