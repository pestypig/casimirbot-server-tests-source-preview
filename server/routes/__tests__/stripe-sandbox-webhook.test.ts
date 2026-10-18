import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  createStripeSandboxWebhookRouter,
  verifyStripeWebhookSignature,
} from "../stripe-sandbox-webhook";

const SECRET = "whsec_sandbox_test_secret";
const NOW = new Date("2026-08-28T12:00:00.000Z");
const timestamp = Math.floor(NOW.getTime() / 1000);
const sign = (body: Buffer, at = timestamp): string =>
  `t=${at},v1=${crypto.createHmac("sha256", SECRET).update(`${at}.`).update(body).digest("hex")}`;
const payload = (overrides: Record<string, unknown> = {}) => Buffer.from(JSON.stringify({
  id: "evt_checkout_1",
  type: "checkout.session.completed",
  created: timestamp,
  livemode: false,
  data: {
    object: {
      id: "cs_checkout_1",
      payment_status: "paid",
      currency: "usd",
      amount_total: 500,
      customer: "cus_owner1",
      payment_intent: "pi_prepaid1",
      metadata: {
        casimir_profile_id: "profile-owner",
        casimir_purchase_kind: "prepaid",
      },
    },
  },
  ...overrides,
}));

const createApp = (applyStripeEvent = vi.fn(async () => ({
  ok: true as const,
  outcome: "processed" as const,
  event_ref: "billing_event:sha256:abc",
  ledger_posted: true,
  live_mode: false as const,
  raw_processor_object_included: false as const,
}))) => {
  const app = express();
  app.use(
    "/webhook",
    express.raw({ type: "application/json" }),
    createStripeSandboxWebhookRouter({
      secret: SECRET,
      now: () => NOW,
      store: { applyStripeEvent } as never,
    }),
  );
  return { app, applyStripeEvent };
};

describe("Stripe sandbox webhook", () => {
  it("verifies exact raw bytes and bounded timestamp", () => {
    const body = payload();
    expect(verifyStripeWebhookSignature({
      rawBody: body, signatureHeader: sign(body), secret: SECRET,
      nowMs: NOW.getTime(),
    })).toBe(true);
    expect(verifyStripeWebhookSignature({
      rawBody: Buffer.concat([body, Buffer.from(" ")]),
      signatureHeader: sign(body), secret: SECRET, nowMs: NOW.getTime(),
    })).toBe(false);
    expect(verifyStripeWebhookSignature({
      rawBody: body, signatureHeader: sign(body, timestamp - 301), secret: SECRET,
      nowMs: NOW.getTime(),
    })).toBe(false);
  });

  it("admits a signed sandbox event and passes only normalized fields", async () => {
    const body = payload();
    const { app, applyStripeEvent } = createApp();
    const response = await request(app).post("/webhook")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", sign(body))
      .send(body.toString("utf8"))
      .expect(200);
    expect(response.body).toMatchObject({ outcome: "processed", live_mode: false });
    expect(applyStripeEvent).toHaveBeenCalledWith(expect.objectContaining({
      profile_id: "profile-owner",
      action: "prepaid_credit_purchased",
      amount_minor: 500,
      customer_id: "cus_owner1",
      subscription_id: null,
      reference_object_id: "pi_prepaid1",
      payload_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(JSON.stringify(applyStripeEvent.mock.calls)).not.toContain(SECRET);
  });

  it("rejects invalid signatures and ignores live-mode payloads", async () => {
    const body = payload();
    const { app, applyStripeEvent } = createApp();
    await request(app).post("/webhook")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", sign(Buffer.from("different")))
      .send(body.toString("utf8"))
      .expect(400);
    const live = payload({ livemode: true });
    const response = await request(app).post("/webhook")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", sign(live))
      .send(live.toString("utf8"))
      .expect(202);
    expect(response.body).toMatchObject({ outcome: "ignored", live_mode: false });
    expect(applyStripeEvent).not.toHaveBeenCalled();
  });

  it("normalizes opaque customer and subscription references for portal custody", async () => {
    const subscription = payload({
      id: "evt_subscription_1",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_owner1",
          customer: "cus_owner1",
          status: "active",
          currency: "usd",
          current_period_start: timestamp,
          current_period_end: timestamp + 2_592_000,
          metadata: {
            casimir_profile_id: "profile-owner",
            casimir_plan_id: "starter_monthly",
          },
        },
      },
    });
    const { app, applyStripeEvent } = createApp();
    await request(app).post("/webhook")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", sign(subscription))
      .send(subscription.toString("utf8"))
      .expect(200);
    expect(applyStripeEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "subscription_updated",
      customer_id: "cus_owner1",
      subscription_id: "sub_owner1",
    }));
  });
});
