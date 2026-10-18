import { describe, expect, it } from "vitest";
import { RobinhoodLiveOrderCallError } from
  "../robinhood-live-order-adapter";
import { buildRobinhoodLiveCancellationArguments } from
  "../robinhood-live-cancel-adapter";

describe("Robinhood live equity cancellation contract", () => {
  it("maps only the reviewed account and provider order identity", () => {
    expect(buildRobinhoodLiveCancellationArguments({
      inputSchema: {
        type: "object",
        properties: {
          account_number: { type: "string" },
          order_id: { type: "string" },
        },
        required: ["account_number", "order_id"],
      },
      accountRef: "agentic-account-secret",
      providerOrderRef: "provider-order-secret",
    })).toEqual({
      account_number: "agentic-account-secret",
      order_id: "provider-order-secret",
    });
  });

  it("fails closed on unknown required cancellation fields", () => {
    expect(() => buildRobinhoodLiveCancellationArguments({
      inputSchema: {
        type: "object",
        properties: {
          order_id: { type: "string" },
          override_safety: { type: "boolean" },
        },
        required: ["order_id", "override_safety"],
      },
      accountRef: "agentic-account-secret",
      providerOrderRef: "provider-order-secret",
    })).toThrowError(RobinhoodLiveOrderCallError);
  });

  it("fails closed when the order identity field is ambiguous", () => {
    expect(() => buildRobinhoodLiveCancellationArguments({
      inputSchema: {
        type: "object",
        properties: {
          order_id: { type: "string" },
          order_ref: { type: "string" },
        },
        required: ["order_id"],
      },
      accountRef: "agentic-account-secret",
      providerOrderRef: "provider-order-secret",
    })).toThrowError(RobinhoodLiveOrderCallError);
  });
});
