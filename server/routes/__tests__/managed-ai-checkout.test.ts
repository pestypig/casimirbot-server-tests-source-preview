import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { HelixAccountSession } from "@shared/helix-account-session";
import { createManagedAiCheckoutRouter } from "../managed-ai-checkout";
import { ManagedAiCheckoutClaimError } from
  "../../services/helix-account/managed-ai-checkout-store";
import { ManagedAiCheckoutProofError } from
  "../../services/helix-account/managed-ai-checkout-proof";

const NOW = new Date("2026-10-10T12:00:00Z");
const requestId = "00000000-0000-4000-8000-000000000001";
const session = (profile: Record<string, unknown> = {}) => ({
  session_id: "session:test", status: "active",
  expires_at: "2026-10-17T12:00:00Z",
  profile: { profile_id: "profile:owner", auth_mode: "web_auth", ...profile },
}) as HelixAccountSession;
const post = (app: express.Express) => request(app)
  .post("/api/managed-ai/checkout")
  .set("Host", "casimirbot.com")
  .set("Origin", "http://casimirbot.com")
  .set("Sec-Fetch-Site", "same-origin")
  .set("Cookie", "helix_session=session%3Atest");
const reconcile = (app: express.Express) => request(app)
  .post("/api/managed-ai/checkout/reconcile")
  .set("Host", "casimirbot.com")
  .set("Origin", "http://casimirbot.com")
  .set("Sec-Fetch-Site", "same-origin")
  .set("Cookie", "helix_session=session%3Atest");
const fixture = (options: {
  enabled?: boolean;
  domainRuntime?: boolean;
  lookup?: (sessionId: string | null | undefined) => Promise<HelixAccountSession | null>;
} = {}) => {
  const start = vi.fn(async () => ({
    sessionId: "cs_test_aiPlan123",
    hostedUrl: "https://checkout.stripe.com/c/pay/cs_test_aiPlan123",
    expiresAt: "2026-10-10T18:00:00.000Z",
  }));
  const reconcilePaidPeriod = vi.fn(async () => ({
    termId: "managed_ai:stripe_invoice:in_aiPaid123",
    state: "active", newlyIssued: true,
  }));
  const lookupSession = vi.fn(options.lookup ?? (async () => session()));
  const app = express();
  app.use(express.json());
  app.use("/api/managed-ai", createManagedAiCheckoutRouter({
    enabled: () => options.enabled ?? true, starter: { start },
    reconciler: { reconcilePaidPeriod },
    privateTestOwnerProfileId: "profile:owner",
    isDomainRuntime: () => options.domainRuntime ?? true,
    lookupSession, now: () => NOW,
  }));
  return { app, start, reconcilePaidPeriod, lookupSession };
};

describe("site managed-AI Checkout boundary", () => {
  it("is unavailable in normal server configuration", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/managed-ai", createManagedAiCheckoutRouter());
    await post(app).send({ tier: "ai_5", request_id: requestId }).expect(404);
    await reconcile(app).send({ checkout_session_id: "cs_test_aiPlan123" })
      .expect(404);
  });

  it("stays unavailable in a desktop runtime even if a starter is supplied", async () => {
    const { app, start } = fixture({ domainRuntime: false });
    await post(app).send({ tier: "ai_5", request_id: requestId }).expect(404);
    expect(start).not.toHaveBeenCalled();
  });

  it("shows a private test offer only to its exact verified owner", async () => {
    const { app } = fixture();
    const offer = await request(app)
      .get("/api/managed-ai/checkout/private-test-offer")
      .set("Cookie", "helix_session=session%3Atest").expect(200);
    expect(offer.body).toEqual({
      schema: "casimirbot.managed_ai_private_test_offer.v1",
      test_mode: true, provider_calls_enabled: false,
      tiers: ["ai_5", "ai_10"],
    });
    const other = fixture({ lookup: async () => session({ profile_id: "profile:other" }) });
    await request(other.app).get("/api/managed-ai/checkout/private-test-offer")
      .set("Cookie", "helix_session=session%3Atest").expect(404);
    await post(other.app).send({ tier: "ai_5", request_id: requestId }).expect(404);
    await reconcile(other.app)
      .send({ checkout_session_id: "cs_test_aiPlan123" }).expect(404);
    expect(other.start).not.toHaveBeenCalled();
    expect(other.reconcilePaidPeriod).not.toHaveBeenCalled();
  });

  it("uses the verified cookie account and returns only a pending processor link", async () => {
    const { app, start, lookupSession } = fixture();
    const response = await post(app)
      .send({ tier: "ai_5", request_id: requestId }).expect(201);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.body).toMatchObject({
      schema: "casimirbot.managed_ai_checkout.v1",
      checkout_session_id: "cs_test_aiPlan123",
      expires_at: "2026-10-10T18:00:00.000Z",
      entitlement_state: "pending_processor_verification",
    });
    expect(lookupSession).toHaveBeenCalledWith("session:test");
    expect(start).toHaveBeenCalledWith({
      profileId: "profile:owner", tier: "ai_5", requestId,
    });
  });

  it("rejects missing identity, local identity, and expired identity", async () => {
    for (const lookup of [
      async () => null,
      async () => session({ auth_mode: "local_dev_profile" }),
      async () => ({ ...session(), expires_at: "2026-10-01T00:00:00Z" }),
    ]) {
      const { app, start } = fixture({ lookup });
      await post(app).send({ tier: "ai_5", request_id: requestId }).expect(401);
      expect(start).not.toHaveBeenCalled();
    }
  });

  it("rejects cross-origin cookie use and client-supplied price or URL", async () => {
    const { app, start } = fixture();
    await post(app).set("Origin", "http://other.example")
      .send({ tier: "ai_5", request_id: requestId }).expect(403);
    await post(app).send({
      tier: "ai_5", request_id: requestId, price_id: "price_other",
    }).expect(400);
    await post(app).send({
      tier: "ai_5", request_id: requestId, return_url: "https://other.example",
    }).expect(400);
    expect(start).not.toHaveBeenCalled();
  });

  it("does not forward an untrusted hosted URL from a failed service", async () => {
    const { app, start } = fixture();
    start.mockResolvedValueOnce({
      sessionId: "cs_test_aiPlan123", hostedUrl: "https://other.example/pay",
      expiresAt: "2026-10-10T18:00:00.000Z",
    });
    await post(app).send({ tier: "ai_5", request_id: requestId }).expect(503);
  });

  it("reconciles only the signed-in owner's server-held Checkout", async () => {
    const { app, reconcilePaidPeriod } = fixture();
    const result = await reconcile(app).send({
      checkout_session_id: "cs_test_aiPlan123",
    }).expect(200);
    expect(result.body).toEqual({
      schema: "casimirbot.managed_ai_checkout_reconciliation.v1",
      entitlement_state: "active",
    });
    expect(reconcilePaidPeriod).toHaveBeenCalledWith(
      "cs_test_aiPlan123", "profile:owner");
    await reconcile(app).send({ checkout_session_id: "cs_test_aiPlan123",
      profile_id: "profile:other" }).expect(400);
    await reconcile(app).set("Origin", "http://other.example")
      .send({ checkout_session_id: "cs_test_aiPlan123" }).expect(403);
    expect(reconcilePaidPeriod).toHaveBeenCalledTimes(1);
  });

  it("keeps unknown and unverified payments distinct from active allowance", async () => {
    const { app, reconcilePaidPeriod } = fixture();
    reconcilePaidPeriod.mockRejectedValueOnce(
      new ManagedAiCheckoutClaimError("intent_not_found"));
    await reconcile(app).send({ checkout_session_id: "cs_test_aiPlan123" })
      .expect(404);
    reconcilePaidPeriod.mockRejectedValueOnce(
      new ManagedAiCheckoutProofError("invoice_unpaid"));
    await reconcile(app).send({ checkout_session_id: "cs_test_aiPlan123" })
      .expect(409);
    expect(reconcilePaidPeriod).toHaveBeenCalledTimes(2);
  });
});
