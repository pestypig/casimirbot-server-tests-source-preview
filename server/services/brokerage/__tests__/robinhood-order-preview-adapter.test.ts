import { describe, expect, it } from "vitest";
import {
  buildRobinhoodEquityReviewArguments,
  extractUniqueRobinhoodAgenticAccountRef,
} from "../robinhood-order-preview-adapter";

const intent = {
  asset_type: "equity" as const,
  symbol: "AAPL",
  side: "buy" as const,
  order_type: "limit" as const,
  time_in_force: "gfd" as const,
  extended_hours: false as const,
  quantity_micros: 1_250_000,
  limit_price_micros: 201_500_000,
  stop_price_micros: 195_000_000,
  notional_cents: 25_187,
};

describe("Robinhood live equity preview contract adapter", () => {
  it("selects exactly one account explicitly admitted for this agent", () => {
    expect(extractUniqueRobinhoodAgenticAccountRef({ accounts: [
      { nickname: "Agentic", agentic_allowed: false,
        account_number: "masked-primary" },
      { nickname: "Casimir", agentic_allowed: true,
        account_number: "agentic-secret-ref" },
    ] })).toBe("agentic-secret-ref");

    expect(() => extractUniqueRobinhoodAgenticAccountRef({ accounts: [
      { nickname: "Agentic", agentic_allowed: false,
        account_number: "primary" },
    ] })).toThrow(/dedicated Agentic account/u);

    expect(() => extractUniqueRobinhoodAgenticAccountRef({ accounts: [
      { agentic_allowed: true, account_number: "one" },
      { agentic_allowed: true, account_number: "two" },
    ] })).toThrow(/more than one Agentic account/u);
  });

  it("maps only the reviewed long-equity limit fields from the live schema", () => {
    const args = buildRobinhoodEquityReviewArguments({
      inputSchema: {
        type: "object",
        required: ["account_number", "symbol", "side", "order_type", "quantity", "limit_price"],
        properties: {
          account_number: { type: "string" },
          symbol: { type: "string" },
          side: { type: "string", enum: ["buy", "sell"] },
          order_type: { type: "string", enum: ["market", "limit"] },
          time_in_force: { type: "string", enum: ["gfd", "gtc"] },
          quantity: { type: "string" },
          limit_price: { type: "string" },
          extended_hours: { type: "boolean" },
        },
      },
      accountRef: "vault-only-agentic-ref",
      intent,
    });
    expect(args).toEqual({
      account_number: "vault-only-agentic-ref",
      symbol: "AAPL",
      side: "buy",
      order_type: "limit",
      time_in_force: "gfd",
      quantity: "1.25",
      limit_price: "201.5",
      extended_hours: false,
    });
  });

  it("fails closed on unknown required fields and unsafe enum changes", () => {
    const base = {
      type: "object",
      properties: {
        symbol: { type: "string" },
        side: { type: "string", enum: ["buy"] },
        order_type: { type: "string", enum: ["limit"] },
        quantity: { type: "string" },
        limit_price: { type: "string" },
      },
    };
    expect(() => buildRobinhoodEquityReviewArguments({
      inputSchema: { ...base, required: ["symbol", "side", "order_type",
        "quantity", "limit_price", "mystery_confirmation"] },
      accountRef: "agentic",
      intent,
    })).toThrow(/unreviewed required field/u);

    expect(() => buildRobinhoodEquityReviewArguments({
      inputSchema: {
        ...base,
        properties: { ...base.properties,
          order_type: { type: "string", enum: ["market"] } },
      },
      accountRef: "agentic",
      intent,
    })).toThrow(/safe order value/u);
  });
});
