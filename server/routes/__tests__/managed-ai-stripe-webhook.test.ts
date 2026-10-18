import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createManagedAiStripeWebhookRouter } from
  "../managed-ai-stripe-webhook";
import { ManagedAiCheckoutClaimError } from
  "../../services/helix-account/managed-ai-checkout-store";

const SECRET = "whsec_managed_ai_test_only";
const NOW = new Date("2026-10-10T12:00:00Z");
const timestamp = Math.floor(NOW.getTime() / 1000);
const event = (type: string, item: Record<string, unknown>,
  livemode = false) => JSON.stringify({
  id: "evt_aiPlan123", type, livemode,
  data: { object: { livemode, ...item } },
});
const signature = (raw: string) =>
  `t=${timestamp},v1=${createHmac("sha256", SECRET)
    .update(`${timestamp}.${raw}`).digest("hex")}`;
const fixture = (enabled = true) => {
  const reconcileRecordedCheckout = vi.fn(async (_id: string) => ({
    termId: "managed_ai:stripe_invoice:in_aiPaid123",
    state: "active", newlyIssued: true,
  }));
  const reconcileClaimedSubscription = vi.fn(async (_id: string) => ({
    state: "suspended" as const, pausedTerms: 1,
  }));
  const reconcileCharge = vi.fn(async (_id: string) => ({
    state: "suspended" as const, pausedTerms: 1,
  }));
  const app = express();
  app.use("/api/managed-ai/stripe/webhook",
    express.raw({ type: "application/json" }),
    createManagedAiStripeWebhookRouter({
      enabled: () => enabled, isDomainRuntime: () => true,
      secret: SECRET, now: () => NOW,
      reconciler: { reconcileRecordedCheckout,
        reconcileClaimedSubscription, reconcileCharge },
    }));
  const send = (raw: string, signed = true) => request(app)
    .post("/api/managed-ai/stripe/webhook")
    .set("Content-Type", "application/json")
    .set("Stripe-Signature", signed ? signature(raw) : "t=0,v1=invalid")
    .send(raw);
  return { app, send, reconcileRecordedCheckout,
    reconcileClaimedSubscription, reconcileCharge };
};

describe("isolated managed-AI Stripe wakeup", () => {
  it("is closed by default and rejects an invalid signature", async () => {
    const app = express();
    app.use("/api/managed-ai/stripe/webhook",
      express.raw({ type: "application/json" }),
      createManagedAiStripeWebhookRouter());
    const raw = event("checkout.session.completed", {
      object: "checkout.session", id: "cs_test_aiPlan123" });
    await request(app).post("/api/managed-ai/stripe/webhook")
      .set("Content-Type", "application/json").send(raw).expect(404);
    const { send, reconcileRecordedCheckout } = fixture();
    await send(raw, false).expect(400);
    expect(reconcileRecordedCheckout).not.toHaveBeenCalled();
  });

  it("treats signed checkout and renewal events as idempotent processor-read wakeups", async () => {
    const { send, reconcileRecordedCheckout,
      reconcileClaimedSubscription } = fixture();
    const checkout = event("checkout.session.completed", {
      object: "checkout.session", id: "cs_test_aiPlan123",
      client_reference_id: "profile:spoofed", payment_status: "unpaid",
    });
    await send(checkout).expect(200);
    await send(checkout).expect(200);
    expect(reconcileRecordedCheckout).toHaveBeenCalledTimes(2);
    expect(reconcileRecordedCheckout).toHaveBeenCalledWith("cs_test_aiPlan123");
    const invoice = event("invoice.paid", { object: "invoice",
      id: "in_aiPaid123", parent: { subscription_details: {
        subscription: "sub_aiOwner123" } } });
    await send(invoice).expect(200);
    expect(reconcileClaimedSubscription)
      .toHaveBeenCalledWith("sub_aiOwner123");
  });

  it("routes cancellation and refund to exact claimed subscription checks", async () => {
    const { send, reconcileClaimedSubscription,
      reconcileCharge } = fixture();
    await send(event("customer.subscription.deleted", {
      object: "subscription", id: "sub_aiOwner123",
      customer: "cus_spoofed123", status: "active",
    })).expect(200);
    await send(event("charge.refunded", { object: "charge",
      id: "ch_aiPaid123", payment_intent: "pi_aiPaid123",
      amount_refunded: 1,
    })).expect(200);
    expect(reconcileClaimedSubscription)
      .toHaveBeenCalledWith("sub_aiOwner123");
    await send(event("charge.dispute.created", { object: "dispute",
      id: "dp_aiPaid123", charge: "ch_aiPaid123",
    })).expect(200);
    expect(reconcileCharge).toHaveBeenCalledTimes(2);
    expect(reconcileCharge).toHaveBeenCalledWith("ch_aiPaid123");
  });

  it("retries early Checkout but ignores unclaimed subscriptions and live events", async () => {
    const { send, reconcileClaimedSubscription,
      reconcileRecordedCheckout } = fixture();
    reconcileRecordedCheckout.mockRejectedValueOnce(
      new ManagedAiCheckoutClaimError("intent_not_found"));
    const checkout = event("checkout.session.completed", {
      object: "checkout.session", id: "cs_test_aiPlan123",
    });
    await send(checkout).expect(503);
    await send(checkout).expect(200);
    reconcileClaimedSubscription.mockRejectedValueOnce(
      new ManagedAiCheckoutClaimError("subscription_not_found"));
    const invoice = event("invoice.payment_failed", {
      object: "invoice", id: "in_aiPaid123",
      subscription: "sub_aiOwner123",
    });
    await send(invoice).expect(202);
    await send(invoice).expect(200);
    await send(event("invoice.paid", {
      object: "invoice", id: "in_aiPaid123",
      subscription: "sub_aiOwner123",
    }, true)).expect(202);
    await send(event("customer.subscription.deleted", {
      object: "subscription", id: "sub_aiOwner123",
    }).replace("evt_aiPlan123", "evt_bad")).expect(503);
    expect(reconcileClaimedSubscription).toHaveBeenCalledTimes(2);
  });
});
