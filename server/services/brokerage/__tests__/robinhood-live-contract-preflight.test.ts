import { describe, expect, it } from "vitest";
import {
  assessRobinhoodLiveProviderCatalog,
  type RobinhoodLiveToolDescriptor,
} from "../robinhood-live-contract-preflight";

const reviewSchema = {
  type: "object",
  properties: {
    account: { type: "string" },
    symbol: { type: "string" },
    side: { type: "string", enum: ["buy", "sell"] },
    orderType: { type: "string", enum: ["limit", "stop", "market"] },
    timeInForce: { type: "string", enum: ["gfd"] },
    quantity: { type: "string" },
    limitPrice: { type: "string" },
    stopPrice: { type: "string" },
    extendedHours: { type: "boolean" },
  },
  required: ["account", "symbol", "side", "orderType", "quantity"],
};

const placementSchema = {
  type: "object",
  properties: {
    account: { type: "string" },
    clientOrderId: { type: "string" },
    reviewId: { type: "string" },
    symbol: { type: "string" },
    side: { type: "string", enum: ["buy", "sell"] },
    orderType: { type: "string", enum: ["limit", "stop", "market"] },
    timeInForce: { type: "string", enum: ["gfd"] },
    quantity: { type: "string" },
    limitPrice: { type: "string" },
    stopPrice: { type: "string" },
    extendedHours: { type: "boolean" },
  },
  required: [
    "account", "clientOrderId", "reviewId", "symbol", "side", "orderType",
    "quantity",
  ],
};

const acceptedCatalog: RobinhoodLiveToolDescriptor[] = [
  { name: "review_equity_order", inputSchema: reviewSchema,
    annotations: { destructiveHint: false } },
  { name: "place_equity_order", inputSchema: placementSchema,
    annotations: { destructiveHint: true } },
  { name: "cancel_equity_order", inputSchema: {
    type: "object",
    properties: { account: { type: "string" }, orderId: { type: "string" } },
    required: ["account", "orderId"],
  }, annotations: { destructiveHint: true } },
];

describe("Robinhood live provider contract preflight", () => {
  it("admits the reviewed entry, exit, and cancellation schemas without calls", () => {
    const result = assessRobinhoodLiveProviderCatalog(acceptedCatalog);
    expect(result.catalogHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.gates).toHaveLength(7);
    expect(result.gates.every((gate) => gate.verdict === "pass")).toBe(true);
  });

  it("classifies exact mutating tool names locally when provider hints are absent", () => {
    const result = assessRobinhoodLiveProviderCatalog(acceptedCatalog.map((tool) =>
      tool.name === "place_equity_order"
        ? { ...tool, annotations: {} }
        : tool));
    expect(result.gates.filter((gate) =>
      gate.tool_name === "place_equity_order")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        verdict: "pass",
        reason_code: "contract_admitted",
        destructive_hint_observed: "absent",
      }),
    ]));
  });

  it("fails every dependent gate when a required tool is absent", () => {
    const result = assessRobinhoodLiveProviderCatalog(acceptedCatalog.filter(
      (tool) => tool.name !== "review_equity_order",
    ));
    expect(result.gates.filter((gate) =>
      gate.tool_name === "review_equity_order")).toHaveLength(3);
    expect(result.gates.filter((gate) =>
      gate.tool_name === "review_equity_order").every((gate) =>
      gate.reason_code === "tool_missing")).toBe(true);
  });
});
