import crypto from "node:crypto";
import express from "express";
import { newDb } from "pg-mem";
import type { Pool } from "pg";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { migration026 } from "../../db/migrations/026_helix_accounts";
import { migration073 } from "../../db/migrations/073_billing_entitlement_ledger";
import { BillingEntitlementStore } from
  "../../services/helix-account/billing-entitlement-store";
import { createStripeSandboxWebhookRouter } from
  "../stripe-sandbox-webhook";

const PROFILE = "profile-spb4-acceptance";
const SECRET = "whsec_spb4_acceptance_secret";
const BASE_SECONDS = 1_788_000_000;

const signedHeader = (body: Buffer, created: number): string =>
  `t=${created},v1=${crypto.createHmac("sha256", SECRET)
    .update(`${created}.`).update(body).digest("hex")}`;

const stripeEvent = (input: {
  id: string;
  type: string;
  created: number;
  object: Record<string, unknown>;
}): Buffer => Buffer.from(JSON.stringify({
  id: input.id,
  type: input.type,
  created: input.created,
  livemode: false,
  data: { object: input.object },
}));

describe("SPB-4 deterministic Stripe sandbox acceptance", () => {
  it("settles purchase, cap denial, cancel, cumulative refund, adjustment, replay, and restart without disclosure", async () => {
    const memory = newDb({ autoCreateForeignKeyIndices: true });
    const pg = memory.adapters.createPg();
    const pool = new pg.Pool() as unknown as Pool;
    const client = await pool.connect();
    try {
      await migration026.run(client, { enablePgvector: false });
      await migration073.run(client, { enablePgvector: false });
    } finally {
      client.release();
    }
    await pool.query(
      `INSERT INTO helix_accounts(
         profile_id, display_name, account_type, provider, created_at, updated_at
       ) VALUES ($1, 'SPB-4 acceptance', 'developer', 'local', now(), now());`,
      [PROFILE],
    );

    let sequence = 0;
    const persistence = vi.fn().mockResolvedValue(undefined);
    const createStore = () => new BillingEntitlementStore({
      pool,
      randomId: () => `acceptance-${++sequence}`,
      persist: persistence,
      sandboxConfigured: () => true,
      checkoutConfigured: () => true,
      portalConfigured: () => true,
    });
    let store = createStore();
    const app = express();
    app.use(
      "/stripe",
      express.raw({ type: "application/json" }),
      createStripeSandboxWebhookRouter({
        secret: SECRET,
        now: () => new Date((BASE_SECONDS + 60) * 1000),
        store,
      }),
    );
    const deliver = async (body: Buffer, expectedStatus = 200) => {
      const event = JSON.parse(body.toString("utf8")) as { created: number };
      return request(app).post("/stripe")
        .set("Content-Type", "application/json")
        .set("Stripe-Signature", signedHeader(body, event.created))
        .send(body.toString("utf8"))
        .expect(expectedStatus);
    };

    const plan = stripeEvent({
      id: "evt_accept_plan",
      type: "checkout.session.completed",
      created: BASE_SECONDS + 1,
      object: {
        id: "cs_accept_plan",
        payment_status: "paid",
        currency: "usd",
        amount_total: 1_000,
        customer: "cus_acceptance1",
        subscription: "sub_acceptance1",
        metadata: {
          casimir_profile_id: PROFILE,
          casimir_purchase_kind: "plan",
          casimir_plan_id: "starter_monthly",
          casimir_included_credit_minor: "1000",
        },
      },
    });
    expect((await deliver(plan)).body).toMatchObject({
      outcome: "processed",
      ledger_posted: true,
      live_mode: false,
    });
    expect((await deliver(plan)).body).toMatchObject({
      outcome: "duplicate",
      ledger_posted: false,
    });

    const topup = stripeEvent({
      id: "evt_accept_topup",
      type: "checkout.session.completed",
      created: BASE_SECONDS + 2,
      object: {
        id: "cs_accept_topup",
        payment_status: "paid",
        currency: "usd",
        amount_total: 500,
        customer: "cus_acceptance1",
        payment_intent: "pi_accept_topup",
        metadata: {
          casimir_profile_id: PROFILE,
          casimir_purchase_kind: "prepaid",
        },
      },
    });
    await deliver(topup);

    const overCap = stripeEvent({
      id: "evt_accept_over_cap",
      type: "checkout.session.completed",
      created: BASE_SECONDS + 3,
      object: {
        id: "cs_accept_over_cap",
        payment_status: "paid",
        currency: "usd",
        amount_total: 2_000,
        customer: "cus_acceptance1",
        payment_intent: "pi_accept_over_cap",
        metadata: {
          casimir_profile_id: PROFILE,
          casimir_purchase_kind: "prepaid",
        },
      },
    });
    expect((await deliver(overCap, 409)).body).toEqual({
      ok: false,
      error: "ceiling_exceeded",
    });

    const partialRefund = (id: string, amountRefunded: number, created: number) =>
      stripeEvent({
        id,
        type: "charge.refunded",
        created,
        object: {
          id: "ch_accept_topup",
          currency: "usd",
          amount_refunded: amountRefunded,
          customer: "cus_acceptance1",
          payment_intent: "pi_accept_topup",
          metadata: { casimir_profile_id: PROFILE },
        },
      });
    await deliver(partialRefund("evt_accept_refund_200", 200, BASE_SECONDS + 4));
    await deliver(partialRefund("evt_accept_refund_500", 500, BASE_SECONDS + 5));

    const canceled = stripeEvent({
      id: "evt_accept_cancel",
      type: "customer.subscription.deleted",
      created: BASE_SECONDS + 6,
      object: {
        id: "sub_acceptance1",
        customer: "cus_acceptance1",
        currency: "usd",
        current_period_end: BASE_SECONDS + 86_400,
        metadata: {
          casimir_profile_id: PROFILE,
          casimir_plan_id: "starter_monthly",
        },
      },
    });
    await deliver(canceled);
    expect(await store.applyOperatorAdjustment({
      profileId: PROFILE,
      amountMinor: -100,
      idempotencyKey: "support:spb4-acceptance",
      referenceObjectId: "pi_accept_topup",
    })).toBe("processed");

    let status = await store.status(PROFILE);
    expect(status).toMatchObject({
      environment: "sandbox",
      status: "canceled",
      plan_id: "starter_monthly",
      balance: {
        included_credit_minor: 1_000,
        prepaid_credit_minor: 500,
        adjustments_minor: -600,
        available_credit_minor: 900,
        hard_account_ceiling_minor: 2_500,
      },
      portal: { hosted_only: true, available: true },
      authority: {
        owner_may_manage_subscription: true,
        agent_may_purchase: false,
        agent_may_refund: false,
        agent_may_adjust: false,
        agent_may_raise_ceiling: false,
        provider_traffic_enabled: false,
        billable_lease_enabled: false,
      },
    });
    const denied = await pool.query(
      `SELECT 1 FROM helix_billing_webhook_events
       WHERE processor_event_id = 'evt_accept_over_cap';`,
    );
    expect(denied.rowCount).toBe(0);

    store = createStore();
    status = await store.status(PROFILE);
    expect(status.balance.available_credit_minor).toBe(900);
    expect(await store.applyOperatorAdjustment({
      profileId: PROFILE,
      amountMinor: -100,
      idempotencyKey: "support:spb4-acceptance",
      referenceObjectId: "pi_accept_topup",
    })).toBe("duplicate");

    const serialized = JSON.stringify(status);
    for (const forbidden of [
      SECRET,
      "cus_acceptance1",
      "sub_acceptance1",
      "pi_accept_topup",
      "cs_accept_plan",
      "ch_accept_topup",
      "sk_test_",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(status).toMatchObject({
      stripe_customer_included: false,
      stripe_subscription_included: false,
      payment_instrument_included: false,
      webhook_secret_included: false,
      raw_processor_object_included: false,
    });
    expect(persistence).toHaveBeenCalled();
    await pool.end();
  }, 15_000);
});
