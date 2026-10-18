import { describe, expect, it } from "vitest";
import {
  buildRobinhoodLivePlacementArguments,
} from "../robinhood-live-order-adapter";

const intent = {
  asset_type: "equity" as const,
  symbol: "TEST",
  side: "buy" as const,
  order_type: "limit" as const,
  time_in_force: "gfd" as const,
  extended_hours: false as const,
  quantity_micros: 2_497_502,
  limit_price_micros: 10_010_000,
  stop_price_micros: 9_950_000,
  notional_cents: 2_500,
};

const safeSchema = {
  type: "object",
  required: ["account_number", "client_order_id", "review_token", "symbol",
    "side", "order_type", "quantity", "limit_price"],
  properties: {
    account_number: { type: "string" },
    client_order_id: { type: "string" },
    review_token: { type: "string" },
    symbol: { type: "string" },
    side: { type: "string", enum: ["buy", "sell"] },
    order_type: { type: "string", enum: ["limit", "market"] },
    time_in_force: { type: "string", enum: ["gfd", "gtc"] },
    quantity: { type: "string" },
    limit_price: { type: "string" },
    extended_hours: { type: "boolean" },
  },
};

describe("Robinhood live placement contract adapter", () => {
  it("binds the exact reviewed safe order plus a provider idempotency key", () => {
    expect(buildRobinhoodLivePlacementArguments({
      inputSchema: safeSchema,
      accountRef: "vault-agentic-ref",
      clientOrderId: "live-client-order:test",
      intent,
      providerReview: { review_token: "provider-review-ref" },
    })).toEqual({
      account_number: "vault-agentic-ref",
      client_order_id: "live-client-order:test",
      review_token: "provider-review-ref",
      symbol: "TEST",
      side: "buy",
      order_type: "limit",
      time_in_force: "gfd",
      quantity: "2.497502",
      limit_price: "10.01",
      extended_hours: false,
    });
  });

  it("fails closed without provider idempotency or with unknown required fields", () => {
    const withoutClientId = {
      ...safeSchema,
      required: safeSchema.required.filter((field) =>
        field !== "client_order_id"),
      properties: Object.fromEntries(Object.entries(safeSchema.properties)
        .filter(([key]) => key !== "client_order_id")),
    };
    expect(() => buildRobinhoodLivePlacementArguments({
      inputSchema: withoutClientId,
      accountRef: "agentic",
      clientOrderId: "client",
      intent,
      providerReview: { review_token: "review" },
    })).toThrow(/missing idempotency identity/u);

    expect(() => buildRobinhoodLivePlacementArguments({
      inputSchema: {
        ...safeSchema,
        required: [...safeSchema.required, "accept_unbounded_loss"],
        properties: {
          ...safeSchema.properties,
          accept_unbounded_loss: { type: "boolean" },
        },
      },
      accountRef: "agentic",
      clientOrderId: "client",
      intent,
      providerReview: { review_token: "review" },
    })).toThrow(/unreviewed required field/u);
  });

  it("adapts Robinhood's current ref_id and market_hours contract", () => {
    const providerSchema = {
      type: "object",
      required: ["account_number", "side", "symbol", "type"],
      properties: {
        account_number: { type: "string" },
        ref_id: { type: "string" },
        symbol: { type: "string" },
        side: { type: "string" },
        type: { type: "string" },
        time_in_force: { type: "string" },
        quantity: { type: "string" },
        limit_price: { type: "string" },
        market_hours: { type: "string" },
      },
    };
    const refId = "11111111-1111-4111-8111-111111111111";
    expect(buildRobinhoodLivePlacementArguments({
      inputSchema: providerSchema,
      accountRef: "agentic-account",
      clientOrderId: `casimir_live:${refId}`,
      intent,
      providerReview: {},
    })).toEqual({
      account_number: "agentic-account",
      ref_id: refId,
      symbol: "TEST",
      side: "buy",
      type: "limit",
      time_in_force: "gfd",
      quantity: "2.497502",
      limit_price: "10.01",
      market_hours: "regular_hours",
    });
  });

  it("requires one unambiguous review reference when the provider binds it", () => {
    expect(() => buildRobinhoodLivePlacementArguments({
      inputSchema: safeSchema,
      accountRef: "agentic",
      clientOrderId: "client",
      intent,
      providerReview: {
        review_token: "one",
        nested: { review_token: "two" },
      },
    })).toThrow(/one unambiguous placement reference/u);
  });
});
