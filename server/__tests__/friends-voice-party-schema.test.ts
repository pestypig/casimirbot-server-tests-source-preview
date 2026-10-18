import fs from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureDatabase,
  flushLocalDatabaseSnapshotIfEnabled,
  getPool,
  resetDbClient,
} from "../db/client";
import {
  heartbeatHelixSocialPresence,
  listHelixFriendPresence,
  listHelixFriendships,
  requestHelixFriendship,
  setHelixFriendshipDecision,
  setHelixSocialBlock,
  upsertHelixSocialProfile,
} from "../services/helix-social/friends-store";
import { friendsPartiesRouter } from "../routes/agi.friends-parties";
import { signInLocalAccountSession } from
  "../services/helix-account/account-session-store";
import {
  createHelixVoiceParty,
  createHelixVoicePartyInvite,
  HELIX_VOICE_PARTY_EXPIRE_AFTER_MS,
  HELIX_VOICE_PARTY_RECONNECT_AFTER_MS,
  joinHelixVoiceParty,
  leaveHelixVoiceParty,
  reconcileHelixVoicePartyLiveness,
  setHelixVoicePartyGptAttachment,
  updateOwnHelixVoicePartyMedia,
} from "../services/helix-social/voice-party-store";
import {
  listHelixVoicePartyMediaSignals,
  publishHelixVoicePartyMediaSignal,
} from "../services/helix-social/voice-party-signal-store";
import {
  bindSharedRealtimeRoomTransport,
  markSharedRealtimeRoomRuntimeState,
  markSharedRealtimeRoomTransportActive,
  reserveSharedRealtimeRoomRuntime,
  resetSharedRealtimeRoomRuntimeRegistryForTests,
} from "../services/helix-ask/realtime-room/runtime-registry";

describe("friends and voice party persistence schema", () => {
  afterEach(async () => {
    resetSharedRealtimeRoomRuntimeRegistryForTests();
    await resetDbClient();
    vi.unstubAllEnvs();
  });

  it("fails the HTTP surface closed without an authenticated account", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/agi", friendsPartiesRouter);
    const result = await request(app).get("/api/agi/friends-parties").expect(401);
    expect(result.body).toMatchObject({
      schema: "helix.friends_parties.response.v1",
      ok: false,
      error: "friends_parties_auth_required",
    });
  });

  it("fails an authenticated desktop-local route closed without domain coordination", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("CASIMIR_DESKTOP_HOST", "1");
    await resetDbClient();
    const session = await signInLocalAccountSession({
      profile_id: "profile:desktop-local-only",
      display_name: "Desktop Local Only",
      account_type: "developer",
    });
    const app = express();
    app.use(express.json());
    app.use("/api/agi", friendsPartiesRouter);
    const result = await request(app)
      .get("/api/agi/friends-parties")
      .set("Cookie", `helix_session=${session.session!.session_id}`)
      .expect(503);
    expect(result.body).toMatchObject({
      schema: "helix.friends_parties.response.v1",
      ok: false,
      error: "friends_parties_coordination_unavailable",
    });
  });

  it("derives both actors from authenticated sessions across the HTTP friendship flow", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "");
    await resetDbClient();
    const ownerSession = await signInLocalAccountSession({
      profile_id: "profile:http-owner",
      display_name: "HTTP Owner",
      account_type: "developer",
    });
    const friendSession = await signInLocalAccountSession({
      profile_id: "profile:http-friend",
      display_name: "HTTP Friend",
      account_type: "developer",
    });
    const outsiderSession = await signInLocalAccountSession({
      profile_id: "profile:http-outsider",
      display_name: "HTTP Outsider",
      account_type: "developer",
    });
    expect(ownerSession.ok).toBe(true);
    expect(friendSession.ok).toBe(true);
    expect(outsiderSession.ok).toBe(true);
    const ownerCookie = `helix_session=${ownerSession.session!.session_id}`;
    const friendCookie = `helix_session=${friendSession.session!.session_id}`;
    const outsiderCookie = `helix_session=${outsiderSession.session!.session_id}`;
    const app = express();
    app.use(express.json());
    app.use("/api/agi", friendsPartiesRouter);
    const secondIngress = express();
    secondIngress.use(express.json());
    secondIngress.use("/api/agi", friendsPartiesRouter);

    await request(app)
      .put("/api/agi/friends-parties/profile")
      .set("Cookie", ownerCookie)
      .send({ handle: "HttpOwner" })
      .expect(200);
    await request(app)
      .put("/api/agi/friends-parties/profile")
      .set("Cookie", friendCookie)
      .send({ handle: "HttpFriend" })
      .expect(200);
    const sent = await request(app)
      .post("/api/agi/friends-parties/friendships")
      .set("Cookie", ownerCookie)
      .send({ handle: "httpfriend", profile_id: "profile:spoofed-actor" })
      .expect(201);
    expect(sent.body.friendships[0]).toMatchObject({
      state: "outgoing",
      peer: { profile_id: "profile:http-friend" },
    });
    const friendshipId = sent.body.friendships[0].friendship_id as string;
    const accepted = await request(app)
      .post(`/api/agi/friends-parties/friendships/${friendshipId}/decision`)
      .set("Cookie", friendCookie)
      .send({ decision: "accept", profile_id: "profile:spoofed-actor" })
      .expect(200);
    expect(accepted.body.friendships[0]).toMatchObject({
      state: "accepted",
      peer: { profile_id: "profile:http-owner" },
    });

    const createdParty = await request(app)
      .post("/api/agi/friends-parties/parties")
      .set("Cookie", ownerCookie)
      .send({ owner_profile_id: "profile:spoofed-owner" })
      .expect(201);
    const partyId = createdParty.body.party.party_id as string;
    expect(createdParty.body.party).toMatchObject({
      owner_profile_id: "profile:http-owner",
      gpt_attachment_state: "detached",
    });
    const invitation = await request(app)
      .post(`/api/agi/friends-parties/parties/${partyId}/invites`)
      .set("Cookie", ownerCookie)
      .send({ recipient_profile_id: "profile:http-friend" })
      .expect(201);
    expect(invitation.body.invite_code).toMatch(/^helix_party_/);
    const joinedParty = await request(app)
      .post("/api/agi/friends-parties/parties/join")
      .set("Cookie", friendCookie)
      .send({ invite_code: invitation.body.invite_code, profile_id: "profile:spoofed-joiner" })
      .expect(200);
    expect(joinedParty.body.party.members.map(
      (member: { profile: { profile_id: string } }) => member.profile.profile_id,
    )).toEqual(["profile:http-owner", "profile:http-friend"]);
    const ownerParticipant = joinedParty.body.party.members.find(
      (member: { profile: { profile_id: string } }) => member.profile.profile_id === "profile:http-owner",
    );
    const friendParticipant = joinedParty.body.party.members.find(
      (member: { profile: { profile_id: string } }) => member.profile.profile_id === "profile:http-friend",
    );
    const published = await request(app)
      .post(`/api/agi/friends-parties/parties/${partyId}/media/signals`)
      .set("Cookie", ownerCookie)
      .send({
        sender_participant_id: "participant:spoofed",
        target_participant_id: friendParticipant.participant_id,
        negotiation_id: "dual-exe-negotiation",
        kind: "offer",
        description: { type: "offer", sdp: "bounded-dual-exe-sdp" },
      })
      .expect(200);
    expect(published.body.signal).toMatchObject({
      sender_participant_id: ownerParticipant.participant_id,
      target_participant_id: friendParticipant.participant_id,
    });
    const received = await request(secondIngress)
      .get(`/api/agi/friends-parties/parties/${partyId}/media/signals`)
      .set("Cookie", friendCookie)
      .expect(200);
    expect(received.body.signals).toHaveLength(1);
    expect(JSON.stringify(received.body)).not.toContain("profile:spoofed");

    const relayUnavailable = await request(app)
      .get(`/api/agi/friends-parties/parties/${partyId}/media/ice-configuration?transport=relay`)
      .set("Cookie", ownerCookie)
      .expect(409);
    expect(relayUnavailable.body).toMatchObject({
      error: "voice_party_relay_unavailable",
      configuration: null,
    });
    const outsiderAdmission = await request(secondIngress)
      .get(`/api/agi/friends-parties/parties/${partyId}/media/ice-configuration?transport=all`)
      .set("Cookie", outsiderCookie)
      .expect(404);
    expect(outsiderAdmission.body).toMatchObject({
      error: "voice_party_not_found",
      configuration: null,
    });

    vi.stubEnv("HELIX_VOICE_PARTY_STUN_URLS_JSON", '["stun:stun.casimir.test:3478"]');
    vi.stubEnv(
      "HELIX_VOICE_PARTY_TURN_URLS_JSON",
      '["turn:turn.casimir.test:3478?transport=udp","turns:turn.casimir.test:5349?transport=tcp"]',
    );
    vi.stubEnv("HELIX_VOICE_PARTY_TURN_SHARED_SECRET", "fixture-turn-shared-secret");
    vi.stubEnv("HELIX_VOICE_PARTY_TURN_TTL_SECONDS", "600");
    const iceAdmission = await request(app)
      .get(`/api/agi/friends-parties/parties/${partyId}/media/ice-configuration?transport=relay`)
      .set("Cookie", ownerCookie)
      .expect(200);
    expect(iceAdmission.headers["cache-control"]).toContain("no-store");
    expect(iceAdmission.body.configuration).toMatchObject({
      schema: "helix.voice_party.ice_configuration.v1",
      party_id: partyId,
      participant_id: ownerParticipant.participant_id,
      ice_transport_policy: "relay",
      relay_available: true,
      model_visible: false,
      debug_exportable: false,
      persistable: false,
      answer_authority: false,
    });
    const turnServer = iceAdmission.body.configuration.ice_servers[1] as {
      username: string;
      credential: string;
    };
    expect(turnServer.username).toMatch(/^\d+:[A-Za-z0-9_-]{24}$/);
    expect(turnServer.credential).toBe(crypto.createHmac("sha1", "fixture-turn-shared-secret")
      .update(turnServer.username).digest("base64"));
    expect(turnServer.credential).not.toContain("fixture-turn-shared-secret");
    const ordinaryParty = await request(app)
      .get(`/api/agi/friends-parties/parties/${partyId}`)
      .set("Cookie", ownerCookie)
      .expect(200);
    expect(JSON.stringify(ordinaryParty.body)).not.toContain(turnServer.username);
    expect(JSON.stringify(ordinaryParty.body)).not.toContain(turnServer.credential);
  });

  it("persists an accepted friendship and a GPT-detached two-person party", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "helix-social-party-"));
    const snapshotPath = path.join(tempRoot, "helix-db.json");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "1");
    vi.stubEnv("HELIX_LOCAL_DB_PATH", snapshotPath);

    try {
      await resetDbClient();
      await ensureDatabase();
      const pool = getPool();
      await pool.query(`
        INSERT INTO helix_accounts (profile_id, display_name, account_type, provider)
        VALUES
          ('profile:alice', 'Alice', 'user', 'local'),
          ('profile:bob', 'Bob', 'user', 'local');
      `);
      await pool.query(`
        INSERT INTO helix_social_profiles (
          profile_id, handle, handle_canonical
        ) VALUES
          ('profile:alice', 'Alice', 'alice'),
          ('profile:bob', 'Bob', 'bob');
      `);
      await pool.query(`
        INSERT INTO helix_friendships (
          friendship_id,
          requester_profile_id,
          recipient_profile_id,
          pair_low_profile_id,
          pair_high_profile_id,
          status,
          accepted_at
        ) VALUES (
          'friendship:alice:bob',
          'profile:alice',
          'profile:bob',
          'profile:alice',
          'profile:bob',
          'accepted',
          now()
        );
      `);
      await pool.query(`
        INSERT INTO helix_voice_parties (
          party_id, owner_profile_id, state, gpt_attachment_state
        ) VALUES (
          'voice_party:alice:bob', 'profile:alice', 'active', 'detached'
        );
      `);
      await pool.query(`
        INSERT INTO helix_voice_party_members (
          party_id, slot_number, profile_id, participant_id,
          member_role, member_state, media_state, joined_at
        ) VALUES
          (
            'voice_party:alice:bob', 1, 'profile:alice',
            'voice_party_participant:alice', 'owner', 'connected', 'direct', now()
          ),
          (
            'voice_party:alice:bob', 2, 'profile:bob',
            'voice_party_participant:bob', 'participant', 'connected', 'direct', now()
          );
      `);
      await flushLocalDatabaseSnapshotIfEnabled();

      await resetDbClient();
      await ensureDatabase();
      const restored = await getPool().query<{
        status: string;
        state: string;
        gpt_attachment_state: string;
        member_count: number | string;
      }>(`
        SELECT
          f.status,
          p.state,
          p.gpt_attachment_state,
          COUNT(m.profile_id) AS member_count
        FROM helix_friendships f
        JOIN helix_voice_parties p ON p.party_id = 'voice_party:alice:bob'
        JOIN helix_voice_party_members m ON m.party_id = p.party_id
        WHERE f.friendship_id = 'friendship:alice:bob'
        GROUP BY f.status, p.state, p.gpt_attachment_state;
      `);

      expect(restored.rows[0]).toMatchObject({
        status: "accepted",
        state: "active",
        gpt_attachment_state: "detached",
      });
      expect(Number(restored.rows[0]?.member_count)).toBe(2);
    } finally {
      await resetDbClient();
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("enforces pair uniqueness, self-friend rejection, and two party slots", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "0");
    await resetDbClient();
    await ensureDatabase();
    const pool = getPool();
    await pool.query(`
      INSERT INTO helix_accounts (profile_id, display_name, account_type, provider)
      VALUES
        ('profile:a', 'A', 'user', 'local'),
        ('profile:b', 'B', 'user', 'local'),
        ('profile:c', 'C', 'user', 'local');
    `);
    await pool.query(`
      INSERT INTO helix_friendships (
        friendship_id, requester_profile_id, recipient_profile_id,
        pair_low_profile_id, pair_high_profile_id
      ) VALUES (
        'friendship:a:b', 'profile:a', 'profile:b', 'profile:a', 'profile:b'
      );
    `);

    await expect(pool.query(`
      INSERT INTO helix_friendships (
        friendship_id, requester_profile_id, recipient_profile_id,
        pair_low_profile_id, pair_high_profile_id
      ) VALUES (
        'friendship:b:a', 'profile:b', 'profile:a', 'profile:a', 'profile:b'
      );
    `)).rejects.toThrow();
    await expect(pool.query(`
      INSERT INTO helix_friendships (
        friendship_id, requester_profile_id, recipient_profile_id,
        pair_low_profile_id, pair_high_profile_id
      ) VALUES (
        'friendship:a:a', 'profile:a', 'profile:a', 'profile:a', 'profile:a'
      );
    `)).rejects.toThrow();

    await pool.query(`
      INSERT INTO helix_voice_parties (party_id, owner_profile_id)
      VALUES ('voice_party:a', 'profile:a');
    `);
    await pool.query(`
      INSERT INTO helix_voice_party_members (
        party_id, slot_number, profile_id, participant_id, member_role
      ) VALUES
        ('voice_party:a', 1, 'profile:a', 'participant:a', 'owner'),
        ('voice_party:a', 2, 'profile:b', 'participant:b', 'participant');
    `);
    await expect(pool.query(`
      INSERT INTO helix_voice_party_members (
        party_id, slot_number, profile_id, participant_id, member_role
      ) VALUES ('voice_party:a', 3, 'profile:c', 'participant:c', 'participant');
    `)).rejects.toThrow();
  });

  it("runs the request, acceptance, presence, block, and unblock lifecycle", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "0");
    await resetDbClient();
    await ensureDatabase();
    await getPool().query(`
      INSERT INTO helix_accounts (profile_id, display_name, account_type, provider)
      VALUES
        ('profile:owner', 'Owner', 'user', 'local'),
        ('profile:friend', 'Friend', 'user', 'local');
    `);

    await upsertHelixSocialProfile({ profileId: "profile:owner", handle: "Owner_1" });
    await upsertHelixSocialProfile({ profileId: "profile:friend", handle: "Friend_2" });
    const outgoing = await requestHelixFriendship({
      requesterProfileId: "profile:owner",
      recipientHandle: "friend_2",
    });
    expect(outgoing).toMatchObject({ state: "outgoing", peer: { profile_id: "profile:friend" } });
    expect((await listHelixFriendships("profile:friend"))[0]).toMatchObject({
      state: "incoming",
      peer: { profile_id: "profile:owner" },
    });

    await setHelixFriendshipDecision({
      actorProfileId: "profile:friend",
      friendshipId: outgoing.friendship_id,
      decision: "accept",
    });
    expect((await listHelixFriendships("profile:owner"))[0]?.state).toBe("accepted");

    await heartbeatHelixSocialPresence({ profileId: "profile:friend", state: "online" });
    expect(await listHelixFriendPresence("profile:owner")).toMatchObject([
      { profile_id: "profile:friend", state: "online" },
    ]);

    await setHelixSocialBlock({
      actorProfileId: "profile:owner",
      peerProfileId: "profile:friend",
      blocked: true,
    });
    expect(await listHelixFriendPresence("profile:owner")).toEqual([]);
    expect((await listHelixFriendships("profile:owner"))[0]?.state).toBe("blocked_by_self");
    await expect(requestHelixFriendship({
      requesterProfileId: "profile:friend",
      recipientHandle: "owner_1",
    })).rejects.toMatchObject({ code: "social_profile_not_found" });

    await setHelixSocialBlock({
      actorProfileId: "profile:owner",
      peerProfileId: "profile:friend",
      blocked: false,
    });
    const renewed = await requestHelixFriendship({
      requesterProfileId: "profile:friend",
      recipientHandle: "owner_1",
    });
    expect(renewed.state).toBe("outgoing");
  });

  it("runs a two-person human party without attaching GPT Live", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("HELIX_LOCAL_PG_MEM_PERSIST", "0");
    await resetDbClient();
    await ensureDatabase();
    await getPool().query(`
      INSERT INTO helix_accounts (profile_id, display_name, account_type, provider)
      VALUES
        ('profile:party-owner', 'Party Owner', 'user', 'local'),
        ('profile:party-friend', 'Party Friend', 'user', 'local');
    `);
    await upsertHelixSocialProfile({ profileId: "profile:party-owner", handle: "PartyOwner" });
    await upsertHelixSocialProfile({ profileId: "profile:party-friend", handle: "PartyFriend" });
    const friendship = await requestHelixFriendship({
      requesterProfileId: "profile:party-owner",
      recipientHandle: "partyfriend",
    });
    await setHelixFriendshipDecision({
      actorProfileId: "profile:party-friend",
      friendshipId: friendship.friendship_id,
      decision: "accept",
    });

    const created = await createHelixVoiceParty("profile:party-owner");
    expect(created).toMatchObject({
      state: "created",
      max_members: 2,
      gpt_attachment_state: "detached",
      members: [{ profile: { profile_id: "profile:party-owner" }, media_state: "idle" }],
    });
    const invitation = await createHelixVoicePartyInvite({
      partyId: created.party_id,
      ownerProfileId: "profile:party-owner",
      recipientProfileId: "profile:party-friend",
    });
    expect(invitation.invite_code).toMatch(/^helix_party_/);
    expect(JSON.stringify(invitation.party)).not.toContain(invitation.invite_code);

    const joined = await joinHelixVoiceParty({
      profileId: "profile:party-friend",
      inviteCode: invitation.invite_code,
    });
    expect(joined).toMatchObject({
      state: "connecting",
      gpt_attachment_state: "detached",
    });
    expect(joined.members).toHaveLength(2);
    await expect(joinHelixVoiceParty({
      profileId: "profile:party-friend",
      inviteCode: invitation.invite_code,
    })).rejects.toMatchObject({ code: "voice_party_invite_invalid" });

    const ownerParticipantId = joined.members.find(
      (member) => member.profile.profile_id === "profile:party-owner",
    )!.participant_id;
    const friendParticipantId = joined.members.find(
      (member) => member.profile.profile_id === "profile:party-friend",
    )!.participant_id;
    const offer = await publishHelixVoicePartyMediaSignal({
      partyId: created.party_id,
      negotiationId: "negotiation:human-only",
      senderParticipantId: ownerParticipantId,
      targetParticipantId: friendParticipantId,
      kind: "offer",
      description: { type: "offer", sdp: "bounded-human-only-sdp" },
      candidate: null,
    });
    expect(await listHelixVoicePartyMediaSignals({
      partyId: created.party_id,
      targetParticipantId: friendParticipantId,
    })).toMatchObject([{
      signal_id: offer.signal_id,
      party_id: created.party_id,
      sender_participant_id: ownerParticipantId,
      target_participant_id: friendParticipantId,
      kind: "offer",
    }]);
    expect(await listHelixVoicePartyMediaSignals({
      partyId: created.party_id,
      targetParticipantId: ownerParticipantId,
    })).toEqual([]);
    await expect(listHelixVoicePartyMediaSignals({
      partyId: created.party_id,
      targetParticipantId: friendParticipantId,
      afterSignalId: offer.signal_id,
      nowMs: Date.parse(offer.expires_at) + 1,
    })).rejects.toMatchObject({ code: "voice_party_signal_cursor_expired" });

    await updateOwnHelixVoicePartyMedia({
      partyId: created.party_id,
      profileId: "profile:party-owner",
      mediaState: "direct",
    });
    const active = await updateOwnHelixVoicePartyMedia({
      partyId: created.party_id,
      profileId: "profile:party-friend",
      mediaState: "relayed",
      muted: true,
    });
    expect(active).toMatchObject({ state: "active", gpt_attachment_state: "detached" });
    expect(active.members.find((member) => member.profile.profile_id === "profile:party-friend"))
      .toMatchObject({ media_state: "relayed", muted: true });
    await expect(setHelixVoicePartyGptAttachment({
      partyId: created.party_id,
      ownerProfileId: "profile:party-owner",
      roomId: null,
      state: "attaching",
    })).rejects.toMatchObject({ code: "voice_party_conflict" });

    const roomId = "shared_realtime_room:party-gpt-attachment";
    await getPool().query(`
      INSERT INTO helix_shared_realtime_rooms (
        room_id, owner_profile_id, title, status
      ) VALUES ($1, 'profile:party-owner', 'Party GPT room', 'ready');
      INSERT INTO helix_shared_realtime_room_members (
        room_id, slot_number, profile_id, participant_id, member_role, presence, consent
      ) VALUES
        ($1, 1, 'profile:party-owner', 'room-participant:party-owner', 'owner', 'present', '{"audio":true}'::jsonb),
        ($1, 2, 'profile:party-friend', 'room-participant:party-friend', 'participant', 'present', '{"audio":true}'::jsonb);
    `, [roomId]);
    const consentBefore = await getPool().query<{ profile_id: string; consent: unknown }>(`
      SELECT profile_id, consent FROM helix_shared_realtime_room_members
      WHERE room_id = $1 ORDER BY slot_number;
    `, [roomId]);
    const attaching = await setHelixVoicePartyGptAttachment({
      partyId: created.party_id,
      ownerProfileId: "profile:party-owner",
      roomId,
      state: "attaching",
    });
    expect(attaching).toMatchObject({ room_id: roomId, gpt_attachment_state: "attaching" });
    const reservation = reserveSharedRealtimeRoomRuntime({
      roomId,
      reservedByParticipantId: "room-participant:party-owner",
      model: "gpt-realtime",
      transportOwner: "host_browser",
    });
    expect(reservation.ok).toBe(true);
    const runtimeId = reservation.runtime!.runtime_id!;
    expect(bindSharedRealtimeRoomTransport({
      roomId,
      runtimeId,
      realtimeSessionId: "realtime-session:party-gpt",
      providerCallId: "provider-call:party-gpt",
      requesterRef: "room-participant:party-owner",
    }).ok).toBe(true);
    expect(markSharedRealtimeRoomTransportActive({
      roomId,
      runtimeId,
      transportOwner: "host_browser",
    }).ok).toBe(true);
    expect(await setHelixVoicePartyGptAttachment({
      partyId: created.party_id,
      ownerProfileId: "profile:party-owner",
      roomId,
      state: "attaching",
    })).toMatchObject({ gpt_attachment_state: "connected" });
    expect(markSharedRealtimeRoomRuntimeState({
      roomId,
      runtimeId,
      state: "degraded",
      limitation: "test_transport_degraded",
    }).ok).toBe(true);
    expect(await setHelixVoicePartyGptAttachment({
      partyId: created.party_id,
      ownerProfileId: "profile:party-owner",
      roomId,
      state: "attaching",
    })).toMatchObject({ gpt_attachment_state: "degraded" });
    const consentAfter = await getPool().query<{ profile_id: string; consent: unknown }>(`
      SELECT profile_id, consent FROM helix_shared_realtime_room_members
      WHERE room_id = $1 ORDER BY slot_number;
    `, [roomId]);
    expect(consentAfter.rows).toEqual(consentBefore.rows);
    expect(await setHelixVoicePartyGptAttachment({
      partyId: created.party_id,
      ownerProfileId: "profile:party-owner",
      roomId: null,
      state: "detached",
    })).toMatchObject({ room_id: null, gpt_attachment_state: "detached" });

    expect(await leaveHelixVoiceParty({
      partyId: created.party_id,
      profileId: "profile:party-friend",
    })).toBe("left");

    const reconnectParty = await createHelixVoiceParty("profile:party-owner");
    const reconnectInvite = await createHelixVoicePartyInvite({
      partyId: reconnectParty.party_id,
      ownerProfileId: "profile:party-owner",
      recipientProfileId: "profile:party-friend",
    });
    const reconnectJoined = await joinHelixVoiceParty({
      profileId: "profile:party-friend",
      inviteCode: reconnectInvite.invite_code,
    });
    const baselineSeen = Math.min(...reconnectJoined.members.map(
      (member) => Date.parse(member.last_seen_at),
    ));
    expect(await reconcileHelixVoicePartyLiveness({
      partyId: reconnectParty.party_id,
      nowMs: baselineSeen + HELIX_VOICE_PARTY_RECONNECT_AFTER_MS + 1,
    })).toBe("reconnecting");
    expect((await getPool().query<{ state: string }>(
      `SELECT state FROM helix_voice_parties WHERE party_id = $1`,
      [reconnectParty.party_id],
    )).rows[0]?.state).toBe("reconnecting");
    expect(await reconcileHelixVoicePartyLiveness({
      partyId: reconnectParty.party_id,
      nowMs: baselineSeen + HELIX_VOICE_PARTY_EXPIRE_AFTER_MS + 1,
    })).toBe("ended");
    const expiredMembers = await getPool().query<{ member_state: string; media_state: string }>(
      `SELECT member_state, media_state FROM helix_voice_party_members WHERE party_id = $1`,
      [reconnectParty.party_id],
    );
    expect(expiredMembers.rows).toHaveLength(2);
    expect(expiredMembers.rows.every(
      (member) => member.member_state === "left" && member.media_state === "stopped",
    )).toBe(true);
  });
});
