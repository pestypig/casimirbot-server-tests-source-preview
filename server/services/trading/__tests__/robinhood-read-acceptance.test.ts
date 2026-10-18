import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readLease: vi.fn(),
  persistSelection: vi.fn(),
  executeRead: vi.fn(),
  discover: vi.fn(),
}));

vi.mock("../../brokerage/robinhood-connection-store", () => ({
  readRobinhoodCredentialBundleForPrivateRoomAdapter: mocks.readLease,
  persistRobinhoodAgenticAccountSelectionForPrivateRoom: mocks.persistSelection,
}));

vi.mock("../../brokerage/robinhood-read-adapter", () => ({
  RobinhoodMcpClientError: class RobinhoodMcpClientError extends Error {
    constructor(readonly kind: string, message: string) {
      super(message);
    }
  },
  executeRobinhoodPrivateRoomRead: mocks.executeRead,
}));

vi.mock("../../brokerage/robinhood-order-preview-adapter", () => ({
  discoverRobinhoodAgenticAccountOverMcp: mocks.discover,
}));

import { runRobinhoodReadAcceptance } from "../robinhood-read-acceptance";

describe("Robinhood read-only acceptance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readLease.mockResolvedValue({
      credentials: { access_token: "vault-access-token" },
      producerEpochRef: "producer:one",
    });
    mocks.discover.mockResolvedValue({
      accountRef: "vault-only-agentic-account",
      providerContractHash: `sha256:${"a".repeat(64)}`,
    });
    mocks.persistSelection.mockResolvedValue({
      credentials: {
        access_token: "vault-access-token",
        agentic_account_ref: "vault-only-agentic-account",
      },
      producerEpochRef: "producer:one",
    });
    mocks.executeRead.mockImplementation(async (input: {
      toolName: string;
    }) => ({
      upstream_tool: input.toolName,
      observation_id: `observation:${input.toolName}`,
      output_hash: `sha256:${"b".repeat(64)}`,
      observed_at: "2026-08-12T12:00:00.000Z",
    }));
  });

  it("selects the eligible Agentic account and records only five read receipts", async () => {
    const receipt = await runRobinhoodReadAcceptance({
      ownerProfileId: "owner:one",
      connectionId: "connection:one",
      roomId: "room:one",
      quoteProbeSymbol: "SPY",
    });

    expect(mocks.discover).toHaveBeenCalledWith({
      accessToken: "vault-access-token",
    });
    expect(mocks.persistSelection).toHaveBeenCalledWith(expect.objectContaining({
      providerAccountRef: "vault-only-agentic-account",
    }));
    expect(mocks.executeRead.mock.calls.map(([input]) => input.toolName)).toEqual([
      "get_portfolio",
      "get_realized_pnl",
      "get_equity_positions",
      "get_equity_quotes",
      "get_equity_orders",
    ]);
    expect(mocks.executeRead.mock.calls.map(([input]) => input.arguments)).toEqual([
      { account_number: "vault-only-agentic-account" },
      {
        account_number: "vault-only-agentic-account",
        asset_classes: ["equity"],
        span: "3month",
        display_currency: "USD",
        timezone: "America/New_York",
      },
      { account_number: "vault-only-agentic-account" },
      { symbols: ["SPY"] },
      { account_number: "vault-only-agentic-account" },
    ]);
    expect(JSON.stringify(receipt)).not.toContain("vault-only-agentic-account");
    expect(receipt).toMatchObject({
      ok: true,
      provider_order_tool_calls_made: 0,
      live_order_execution_enabled: false,
      credential_included: false,
      account_numbers_included: false,
      raw_provider_payload_included: false,
    });
    expect(receipt.receipts).toHaveLength(5);
  });

  it("reuses an encrypted Agentic selection without rediscovery", async () => {
    mocks.readLease.mockResolvedValue({
      credentials: {
        access_token: "vault-access-token",
        agentic_account_ref: "already-selected-agentic-account",
      },
      producerEpochRef: "producer:one",
    });
    await runRobinhoodReadAcceptance({
      ownerProfileId: "owner:one",
      connectionId: "connection:one",
      roomId: "room:one",
      quoteProbeSymbol: "SPY",
    });
    expect(mocks.discover).not.toHaveBeenCalled();
    expect(mocks.persistSelection).not.toHaveBeenCalled();
  });
});
