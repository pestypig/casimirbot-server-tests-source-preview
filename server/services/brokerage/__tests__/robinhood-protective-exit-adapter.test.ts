import { describe, expect, it } from "vitest";
import { buildRobinhoodProtectiveExitArguments } from
  "../robinhood-protective-exit-adapter";

const intent = {
  asset_type: "equity" as const,
  symbol: "TEST",
  side: "sell" as const,
  order_type: "stop" as const,
  time_in_force: "gfd" as const,
  extended_hours: false as const,
  quantity_micros: 2_500_000,
  stop_price_micros: 9_950_000,
};

const schema = {
  type: "object",
  required: ["account_number", "client_order_id", "review_token", "symbol",
    "side", "order_type", "quantity", "stop_price"],
  properties: {
    account_number: { type: "string" },
    client_order_id: { type: "string" },
    review_token: { type: "string" },
    symbol: { type: "string" },
    side: { type: "string", enum: ["buy", "sell"] },
    order_type: { type: "string", enum: ["limit", "stop", "market"] },
    time_in_force: { type: "string", enum: ["gfd", "gtc"] },
    quantity: { type: "string" },
    stop_price: { type: "string" },
    extended_hours: { type: "boolean" },
  },
};

describe("Robinhood protective exit contract adapter", () => {
  it("maps an explicitly reviewed sell stop with provider idempotency", () => {
    expect(buildRobinhoodProtectiveExitArguments({
      inputSchema: schema,
      accountRef: "agentic-account-secret",
      clientOrderId: "protective-exit:client",
      providerReview: { review_token: "review-secret" },
      intent,
    })).toEqual({
      account_number: "agentic-account-secret",
      client_order_id: "protective-exit:client",
      review_token: "review-secret",
      symbol: "TEST",
      side: "sell",
      order_type: "stop",
      time_in_force: "gfd",
      quantity: "2.5",
      stop_price: "9.95",
      extended_hours: false,
    });
  });

  it("fails closed when stop price is missing", () => {
    expect(() => buildRobinhoodProtectiveExitArguments({
      inputSchema: {
        ...schema,
        required: schema.required.filter((field) => field !== "stop_price"),
        properties: Object.fromEntries(Object.entries(schema.properties)
          .filter(([field]) => field !== "stop_price")),
      },
      accountRef: "agentic-account-secret",
      intent,
    })).toThrow(/missing stopPrice/u);
  });

  it("fails closed on an unreviewed required override", () => {
    expect(() => buildRobinhoodProtectiveExitArguments({
      inputSchema: {
        ...schema,
        required: [...schema.required, "allow_short_position"],
        properties: {
          ...schema.properties,
          allow_short_position: { type: "boolean" },
        },
      },
      accountRef: "agentic-account-secret",
      intent,
    })).toThrow(/unreviewed required field/u);
  });

  it("maps an explicit risk-reducing market close without a stop field", () => {
    const marketSchema = {
      ...schema,
      required: schema.required.filter((field) => field !== "stop_price"),
    };
    const args = buildRobinhoodProtectiveExitArguments({
      inputSchema: marketSchema,
      accountRef: "agentic-account-secret",
      clientOrderId: "market-close:client",
      providerReview: { review_token: "review-secret" },
      intent: {
        asset_type: "equity",
        symbol: "TEST",
        side: "sell",
        order_type: "market",
        time_in_force: "gfd",
        extended_hours: false,
        quantity_micros: 2_500_000,
      },
    });
    expect(args).toMatchObject({
      side: "sell",
      order_type: "market",
      quantity: "2.5",
    });
    expect(args).not.toHaveProperty("stop_price");
  });

  it("maps Robinhood's ref_id and regular-hours stop contract", () => {
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
        stop_price: { type: "string" },
        market_hours: { type: "string" },
      },
    };
    const refId = "22222222-2222-4222-8222-222222222222";
    expect(buildRobinhoodProtectiveExitArguments({
      inputSchema: providerSchema,
      accountRef: "agentic-account",
      clientOrderId: `protective_exit:${refId}`,
      providerReview: {},
      intent,
    })).toEqual({
      account_number: "agentic-account",
      ref_id: refId,
      symbol: "TEST",
      side: "sell",
      type: "stop_market",
      time_in_force: "gfd",
      quantity: "2.5",
      stop_price: "9.95",
      market_hours: "regular_hours",
    });
  });
});
