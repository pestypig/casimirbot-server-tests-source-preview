import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HELIX_FRIENDS_PARTIES_COORDINATION_SCOPE,
} from "@shared/helix-friends-voice-party";
import type { HelixAgentAccessTokenVerifier } from "../auth/helix-agent-principal";
import { friendsPartiesRouter } from "../routes/agi.friends-parties";
import { createFriendsPartiesCoordinationSessionRouter } from
  "../routes/friends-parties-coordination-session";
import { resetDbClient } from "../db/client";
import {
  HELIX_VOICE_PARTY_EXPIRE_AFTER_MS,
  HELIX_VOICE_PARTY_RECONNECT_AFTER_MS,
  reconcileHelixVoicePartyLiveness,
} from "../services/helix-social/voice-party-store";
import { startDesktopFriendsPartiesCoordinationBroker } from
  "../../apps/desktop/src/friends-parties-coordination-broker";

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) =>
    server.close(() => resolve()),
  )));
  await resetDbClient();
  vi.unstubAllEnvs();
});

const verifier: HelixAgentAccessTokenVerifier = {
  async verify(token) {
    const actor = token === "dual-broker-owner-token"
      ? "owner"
      : token === "dual-broker-friend-token" ? "friend" : null;
    if (!actor) throw new Error("unauthorized");
    return {
      issuer: "https://issuer.example/",
      subject: `auth0|dual-broker-${actor}`,
      tenantId: "tenant:dual-broker",
      scopes: new Set([HELIX_FRIENDS_PARTIES_COORDINATION_SCOPE]),
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      claims: {
        azp: "native-client-dual-broker",
        name: actor === "owner" ? "Dual Broker Owner" : "Dual Broker Friend",
      },
    };
  },
  authorizationServer: () => "https://issuer.example/",
  audience: () => "https://casimirbot.com/mcp",
  providerAlias: () => "auth0",
};

const startCentralService = async (): Promise<string> => {
  const app = express();
  app.use(express.json());
  app.use("/api/account", createFriendsPartiesCoordinationSessionRouter({
    verifier,
    nativeClientId: "native-client-dual-broker",
  }));
  app.use("/api/agi", friendsPartiesRouter);
  const server = http.createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

type Broker = Awaited<ReturnType<typeof startDesktopFriendsPartiesCoordinationBroker>>;

const brokerPost = async (
  broker: Broker,
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const response = await fetch(`${broker.origin}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${broker.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.error ?? "broker_failed"));
  return payload;
};

const bootstrap = (
  broker: Broker,
  token: string,
  profileId: string,
  sessionId: string,
) => brokerPost(broker, "/v1/bootstrap", {
  accessToken: token,
  localProfileId: profileId,
  localSessionId: sessionId,
});

const proxy = async (
  broker: Broker,
  identity: { profileId: string; sessionId: string },
  method: string,
  path: string,
  body: unknown = null,
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const payload = await brokerPost(broker, "/v1/proxy", {
    localProfileId: identity.profileId,
    localSessionId: identity.sessionId,
    method,
    path,
    body,
  });
  return {
    status: Number(payload.upstream_status),
    body: payload.upstream_body as Record<string, unknown>,
  };
};

describe("F5 authenticated dual-broker acceptance", () => {
  it("coordinates two isolated native grants through one domain and recovers then expires a disconnected party", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("HELIX_PUBLIC_ROOMS_EXPERIMENT", "1");
    vi.stubEnv("HELIX_VOICE_PARTY_STUN_URLS_JSON", '["stun:stun.test.invalid:3478"]');
    vi.stubEnv("HELIX_VOICE_PARTY_TURN_URLS_JSON", '["turn:turn.test.invalid:3478"]');
    vi.stubEnv("HELIX_VOICE_PARTY_TURN_SHARED_SECRET", "dual-broker-turn-secret");
    await resetDbClient();
    const centralOrigin = await startCentralService();
    const ownerBroker = await startDesktopFriendsPartiesCoordinationBroker({
      remoteOrigin: centralOrigin,
      allowInsecureLoopback: true,
    });
    const friendBroker = await startDesktopFriendsPartiesCoordinationBroker({
      remoteOrigin: centralOrigin,
      allowInsecureLoopback: true,
    });
    const owner = {
      profileId: "profile:installed-owner",
      sessionId: "account_session:installed-owner",
    };
    const friend = {
      profileId: "profile:installed-friend",
      sessionId: "account_session:installed-friend",
    };
    try {
      await bootstrap(ownerBroker, "dual-broker-owner-token", owner.profileId, owner.sessionId);
      await bootstrap(friendBroker, "dual-broker-friend-token", friend.profileId, friend.sessionId);
      expect(ownerBroker.origin).not.toBe(friendBroker.origin);

      expect((await proxy(ownerBroker, owner, "PUT", "/api/agi/friends-parties/profile", {
        handle: "DualOwner",
      })).status).toBe(200);
      expect((await proxy(friendBroker, friend, "PUT", "/api/agi/friends-parties/profile", {
        handle: "DualFriend",
      })).status).toBe(200);
      const requested = await proxy(ownerBroker, owner, "POST", "/api/agi/friends-parties/friendships", {
        handle: "dualfriend",
      });
      expect(requested.status).toBe(201);
      const friendshipId = (requested.body.friendships as Array<{ friendship_id: string }>)[0]!
        .friendship_id;
      expect((await proxy(
        friendBroker,
        friend,
        "POST",
        `/api/agi/friends-parties/friendships/${friendshipId}/decision`,
        { decision: "accept" },
      )).status).toBe(200);

      const created = await proxy(ownerBroker, owner, "POST", "/api/agi/friends-parties/parties", {});
      expect(created.status).toBe(201);
      const partyId = (created.body.party as { party_id: string }).party_id;
      const friendSnapshot = await proxy(friendBroker, friend, "GET", "/api/agi/friends-parties");
      const remoteFriendProfileId = (friendSnapshot.body.profile as { profile_id: string }).profile_id;
      const invited = await proxy(
        ownerBroker,
        owner,
        "POST",
        `/api/agi/friends-parties/parties/${partyId}/invites`,
        { recipient_profile_id: remoteFriendProfileId },
      );
      const inviteCode = String(invited.body.invite_code);
      const joined = await proxy(friendBroker, friend, "POST", "/api/agi/friends-parties/parties/join", {
        invite_code: inviteCode,
      });
      expect(joined.status).toBe(200);
      const members = (joined.body.party as {
        members: Array<{ participant_id: string; role: string; last_seen_at: string }>;
      }).members;
      const ownerParticipant = members.find((member) => member.role === "owner")!;
      const friendParticipant = members.find((member) => member.role === "participant")!;

      expect((await proxy(
        ownerBroker,
        owner,
        "POST",
        `/api/agi/friends-parties/parties/${partyId}/media/signals`,
        {
          target_participant_id: friendParticipant.participant_id,
          negotiation_id: "dual-broker-negotiation",
          kind: "offer",
          description: { type: "offer", sdp: "bounded-dual-broker-offer" },
        },
      )).status).toBe(200);
      const received = await proxy(
        friendBroker,
        friend,
        "GET",
        `/api/agi/friends-parties/parties/${partyId}/media/signals`,
      );
      expect((received.body.signals as Array<{ sender_participant_id: string }>)[0])
        .toMatchObject({ sender_participant_id: ownerParticipant.participant_id });

      const relay = await proxy(
        ownerBroker,
        owner,
        "GET",
        `/api/agi/friends-parties/parties/${partyId}/media/ice-configuration?transport=relay`,
      );
      expect(relay.status).toBe(200);
      expect(relay.body.configuration).toMatchObject({
        ice_transport_policy: "relay",
        relay_available: true,
        model_visible: false,
        persistable: false,
      });
      expect(JSON.stringify(relay.body)).not.toContain("dual-broker-turn-secret");

      const baseline = Math.min(...members.map((member) => Date.parse(member.last_seen_at)));
      expect(await reconcileHelixVoicePartyLiveness({
        partyId,
        nowMs: baseline + HELIX_VOICE_PARTY_RECONNECT_AFTER_MS + 1,
      })).toBe("reconnecting");
      const reconnecting = await proxy(ownerBroker, owner, "GET", `/api/agi/friends-parties/parties/${partyId}`);
      expect(reconnecting.body.party).toMatchObject({ state: "reconnecting" });
      await proxy(ownerBroker, owner, "POST", `/api/agi/friends-parties/parties/${partyId}/heartbeat`, {});
      await proxy(friendBroker, friend, "POST", `/api/agi/friends-parties/parties/${partyId}/heartbeat`, {});
      await proxy(ownerBroker, owner, "PATCH", `/api/agi/friends-parties/parties/${partyId}/media`, {
        media_state: "direct",
      });
      const recovered = await proxy(friendBroker, friend, "PATCH", `/api/agi/friends-parties/parties/${partyId}/media`, {
        media_state: "relayed",
      });
      expect(recovered.body.party).toMatchObject({ state: "active" });

      await friendBroker.close();
      expect(await reconcileHelixVoicePartyLiveness({
        partyId,
        nowMs: Date.now() + HELIX_VOICE_PARTY_EXPIRE_AFTER_MS + 1,
      })).toBe("ended");
      const afterExpiry = await proxy(ownerBroker, owner, "GET", "/api/agi/friends-parties");
      expect(afterExpiry.body.party).toBeNull();
      expect(afterExpiry.body.parties).toEqual([]);
    } finally {
      await ownerBroker.close();
      await friendBroker.close();
    }
  }, 30_000);
});
