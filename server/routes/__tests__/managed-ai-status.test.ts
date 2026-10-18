import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { HelixAccountSession } from "@shared/helix-account-session";
import { createManagedAiStatusRouter, managedAiStatusForSession } from "../managed-ai-status";
import { ManagedAiNativeIdentityError } from "../../auth/managed-ai-native-identity";

const verifiedSession = (overrides: Record<string, unknown> = {}) => ({
  session_id: "session:test",
  status: "active",
  expires_at: "2030-01-01T00:00:00.000Z",
  profile: { profile_id: "profile:test", auth_mode: "web_auth" },
  ...overrides,
}) as HelixAccountSession;

describe("managed AI status boundary", () => {
  const now = new Date("2029-01-01T00:00:00.000Z");

  it("never treats verified sign-in as a paid inference grant", () => {
    expect(managedAiStatusForSession(verifiedSession(), now)).toMatchObject({
      available: false,
      reason: "offer_not_admitted",
      provider_key_on_device: false,
      seller_provider_calls_enabled: false,
    });
  });

  it("rejects absent, legacy unbounded, expired and local-only identity states", () => {
    expect(managedAiStatusForSession(null, now).reason).toBe("sign_in_required");
    expect(managedAiStatusForSession(verifiedSession({ expires_at: null }), now).reason)
      .toBe("fresh_sign_in_required");
    expect(managedAiStatusForSession(verifiedSession({ expires_at: "2028-01-01T00:00:00Z" }), now).reason)
      .toBe("fresh_sign_in_required");
    expect(managedAiStatusForSession(verifiedSession({
      profile: { profile_id: "profile:local", auth_mode: "local_dev_profile" },
    }), now).reason).toBe("verified_identity_required");
  });

  it("reads only the current cookie and fails closed when account storage is unavailable", async () => {
    const lookupSession = vi.fn(async (sessionId: string | null | undefined) =>
      sessionId === "session:test" ? verifiedSession() : null);
    const app = express();
    app.use("/api/managed-ai", createManagedAiStatusRouter({ lookupSession, now: () => now }));
    const signedIn = await request(app).get("/api/managed-ai/status")
      .set("Cookie", "helix_session=session%3Atest").expect(200);
    expect(signedIn.headers["cache-control"]).toBe("no-store");
    expect(signedIn.body.reason).toBe("offer_not_admitted");
    expect(lookupSession).toHaveBeenCalledWith("session:test");
    expect((await request(app).get("/api/managed-ai/status").expect(200)).body.reason)
      .toBe("sign_in_required");

    const unavailable = express();
    unavailable.use("/api/managed-ai", createManagedAiStatusRouter({
      lookupSession: vi.fn(async () => { throw new Error("db offline"); }),
    }));
    expect((await request(unavailable).get("/api/managed-ai/status").expect(503)).body)
      .toMatchObject({ available: false, reason: "account_service_unavailable" });
  });

  it("exposes only the signed-in owner's managed ledger, never own-key usage", async () => {
    const usageForProfile = vi.fn(async () => []);
    const app = express();
    app.use("/api/managed-ai", createManagedAiStatusRouter({
      lookupSession: vi.fn(async (id: string | null | undefined) =>
        id === "session:test" ? verifiedSession() : null),
      usageStore: { usageForProfile }, now: () => now,
    }));
    await request(app).get("/api/managed-ai/usage").expect(401);
    expect(usageForProfile).not.toHaveBeenCalled();
    const result = await request(app).get("/api/managed-ai/usage")
      .set("Cookie", "helix_session=session%3Atest").expect(200);
    expect(result.headers["cache-control"]).toContain("no-store");
    expect(result.body).toMatchObject({
      schema: "casimirbot.managed_ai_usage.v1",
      payer: "casimirbot_managed", own_key_usage_included: false, terms: [],
    });
    expect(usageForProfile).toHaveBeenCalledWith("profile:test");

    const localOnly = express();
    localOnly.use("/api/managed-ai", createManagedAiStatusRouter({
      lookupSession: vi.fn(async () => verifiedSession({
        profile: { profile_id: "profile:local", auth_mode: "local_dev_profile" },
      })), usageStore: { usageForProfile }, now: () => now,
    }));
    await request(localOnly).get("/api/managed-ai/usage")
      .set("Cookie", "helix_session=session%3Atest").expect(401);
    expect(usageForProfile).toHaveBeenCalledTimes(1);
  });

  it("keeps native managed status separate from website cookies and MCP identity", async () => {
    const verify = vi.fn(async (token: string) => {
      if (token !== "dedicated-native-proof")
        throw new ManagedAiNativeIdentityError("native_auth_invalid");
      return { provider: "auth0" as const, subject: "auth0|native-owner",
        expiresAt: "2030-01-01T00:00:00.000Z" };
    });
    const lookupNativeIdentity = vi.fn(async () => true);
    const app = express();
    app.use("/api/managed-ai", createManagedAiStatusRouter({
      nativeVerifier: { verify }, lookupNativeIdentity,
    }));
    await request(app).get("/api/managed-ai/native/status")
      .set("Cookie", "helix_session=session%3Atest").expect(401);
    await request(app).get("/api/managed-ai/native/status")
      .set("Authorization", "Bearer mcp-proof").expect(401);
    expect(lookupNativeIdentity).not.toHaveBeenCalled();
    const linked = await request(app).get("/api/managed-ai/native/status")
      .set("Authorization", "Bearer dedicated-native-proof").expect(200);
    expect(linked.body).toMatchObject({ available: false,
      reason: "offer_not_admitted", provider_key_on_device: false });
    expect(linked.headers["cache-control"]).toContain("no-store");
    expect(JSON.stringify(linked.body)).not.toContain("auth0|native-owner");
    lookupNativeIdentity.mockResolvedValueOnce(false);
    expect((await request(app).get("/api/managed-ai/native/status")
      .set("Authorization", "Bearer dedicated-native-proof").expect(200)).body.reason)
      .toBe("account_link_required");
  });

  it("shows a linked installation its own test term without enabling model calls", async () => {
    const verifyStatus = vi.fn(async () => ({ grantId: "grant:owner",
      profileId: "profile:owner", expiresAt: "2029-02-01T00:00:00.000Z" }));
    const usageForProfile = vi.fn(async () => [{
      termId: "term:test", sourceKind: "subscription" as const,
      planTier: "ai_5" as const, processorLivemode: false,
      state: "active" as const, periodStartsAt: "2029-01-01T00:00:00.000Z",
      periodEndsAt: "2029-02-01T00:00:00.000Z", budgetMicros: 1_000_000,
      committedMicros: 200_000, remainingMicros: 800_000,
      observedEstimateMicros: 0, observedInputTokens: 0,
      observedOutputTokens: 0, observedRequests: 0,
      pendingRequests: 0, uncertainRequests: 0,
    }]);
    const app = express();
    app.use("/api/managed-ai", createManagedAiStatusRouter({
      deviceLinksEnabled: () => true,
      deviceStore: { verifyStatus }, usageStore: { usageForProfile },
    }));
    const response = await request(app).get("/api/managed-ai/native/status")
      .set("Authorization", `Bearer cbma_${"a".repeat(43)}`)
      .set("X-Casimir-Proof-Signed-At", now.toISOString())
      .set("X-Casimir-Proof-Nonce", "nonce")
      .set("X-Casimir-Proof-Signature", "signature").expect(200);
    expect(response.body).toMatchObject({ available: false,
      seller_provider_calls_enabled: false, reason: "offer_not_admitted",
      allowance_preview: { payer: "casimirbot_managed", plan_tier: "ai_5",
        source_kind: "subscription", processor_mode: "test",
        state: "active", remaining_micros: 800_000 },
    });
    expect(usageForProfile).toHaveBeenCalledWith("profile:owner");
    expect(JSON.stringify(response.body)).not.toContain("profile:owner");
  });

  it("previews the selected developer term when a paid test term also exists", async () => {
    const paid = {
      termId: "term:paid", sourceKind: "subscription" as const,
      planTier: "ai_5" as const, processorLivemode: false,
      state: "active" as const, periodStartsAt: "2029-01-01T00:00:00.000Z",
      periodEndsAt: "2029-02-01T00:00:00.000Z", budgetMicros: 1_000_000,
      committedMicros: 0, remainingMicros: 1_000_000,
      observedEstimateMicros: 0, observedInputTokens: 0,
      observedOutputTokens: 0, observedRequests: 0,
      pendingRequests: 0, uncertainRequests: 0,
    };
    const app = express();
    app.use("/api/managed-ai", createManagedAiStatusRouter({
      deviceLinksEnabled: () => true,
      deviceStore: { verifyStatus: async () => ({
        grantId: "grant:owner", profileId: "profile:owner",
        expiresAt: "2029-02-01T00:00:00.000Z",
      }) },
      usageStore: { usageForProfile: async () => [paid, {
        ...paid, termId: "term:developer", sourceKind: "developer",
        planTier: null, processorLivemode: null, budgetMicros: 100_000,
        remainingMicros: 100_000,
      }] },
      preferredSourceKind: "developer",
    }));
    const response = await request(app).get("/api/managed-ai/native/status")
      .set("Authorization", `Bearer cbma_${"a".repeat(43)}`)
      .set("X-Casimir-Proof-Signed-At", now.toISOString())
      .set("X-Casimir-Proof-Nonce", "nonce")
      .set("X-Casimir-Proof-Signature", "signature").expect(200);
    expect(response.body.allowance_preview).toMatchObject({
      source_kind: "developer", plan_tier: null,
      processor_mode: "unknown", remaining_micros: 100_000,
    });
  });
});
