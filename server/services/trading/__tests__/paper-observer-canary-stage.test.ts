import { describe, expect, it, vi } from "vitest";
import type { HelixPaperOrder } from "@shared/trading/paper-contract";
import type { HelixTradingRiskDecision } from "@shared/trading/risk-contract";
import { DEFAULT_HELIX_PAPER_RISK_POLICY } from
  "@shared/trading/risk-contract";
import {
  stagePaperObserverCanary,
  type PaperObserverCanaryStageDependencies,
} from "../paper-observer-canary-stage";

const NOW = new Date("2026-08-27T14:00:01.000Z");
const input = {
  ownerProfileId: "profile:test",
  connectionId: "brokerage_connection:test",
  roomId: "room:test",
  accountId: "paper_account:test",
  symbol: "spy",
  notionalCents: 2_000,
  quoteObservationId: "brokerage_observation:quote",
  earningsObservationId: "brokerage_observation:earnings",
  clientCanaryId: "g8-material-test",
  now: NOW,
};

const decision: HelixTradingRiskDecision = {
  schema: "helix.trading_risk.v1",
  decision_id: "risk_decision:test",
  candidate_id: "paper_canary:g8-material-test",
  policy_id: DEFAULT_HELIX_PAPER_RISK_POLICY.policy_id,
  policy_version: DEFAULT_HELIX_PAPER_RISK_POLICY.policy_version,
  mode: "paper",
  verdict: "accepted",
  reasons: [],
  calculated: {
    quote_age_ms: 1_000,
    spread_bps: 10,
    entry_deviation_bps: 50,
    estimated_risk_cents: 20,
    position_limit_cents: 2_500,
    risk_per_trade_limit_cents: 100,
    daily_loss_limit_cents: 300,
    current_daily_loss_cents: 0,
  },
  evaluated_at: NOW.toISOString(),
  input_hash: `sha256:${"a".repeat(64)}`,
  read_only_observations_required: true,
  live_order_execution_enabled: false,
  answer_authority: false,
};

const order: HelixPaperOrder = {
  schema: "helix.paper_trading.v1",
  order_id: "paper_order:test",
  client_order_id: "paper_canary_order:g8-material-test",
  account_id: "paper_account:test",
  risk_decision_id: decision.decision_id,
  intent: "entry",
  symbol: "SPY",
  side: "buy",
  order_type: "limit",
  notional_cents: 2_000,
  quantity_micros: 1_000_000,
  limit_price_micros: 10_060_050,
  stop_price_micros: 9_959_449,
  reserved_cents: 2_000,
  filled_quantity_micros: 0,
  filled_notional_cents: 0,
  execution_model: null,
  status: "open",
  fill_state: "unfilled",
  source_observation_id: "brokerage_observation:quote",
  created_at: NOW.toISOString(),
  updated_at: NOW.toISOString(),
  filled_at: null,
  cancelled_at: null,
  simulated: true,
  live_order_execution_enabled: false,
  answer_authority: false,
};

const dependencies = (): PaperObserverCanaryStageDependencies => ({
  readAccount: vi.fn().mockResolvedValue({
    account_id: "paper_account:test",
    owner_profile_id: "profile:test",
    connection_id: "brokerage_connection:test",
    room_id: "room:test",
    policy: DEFAULT_HELIX_PAPER_RISK_POLICY,
  }),
  readQuoteEvidence: vi.fn().mockResolvedValue({
    observationId: "brokerage_observation:quote",
    symbol: "SPY",
    bidMicros: 10_000_000,
    askMicros: 10_010_000,
    observedAt: "2026-08-27T14:00:00.000Z",
    outputHash: `sha256:${"b".repeat(64)}`,
    producerEpochRef: "brokerage_epoch:test",
  }),
  requireNoEarningsEvidence: vi.fn().mockResolvedValue(undefined),
  evaluateCandidate: vi.fn().mockResolvedValue(decision),
  submitEntry: vi.fn().mockResolvedValue(order),
  readMarketClock: vi.fn().mockReturnValue({
    session: "regular",
    tradingDate: "2026-08-27",
    minutesSinceRegularOpen: 30,
    minutesUntilRegularClose: 360,
  }),
});

describe("paper observer canary staging", () => {
  it("stages one deterministic paper-only entry from exact quote and earnings evidence", async () => {
    const ports = dependencies();
    const receipt = await stagePaperObserverCanary(input, ports);

    expect(ports.requireNoEarningsEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        observationId: input.earningsObservationId,
        producerEpochRef: "brokerage_epoch:test",
        symbol: "SPY",
      }),
    );
    expect(ports.evaluateCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerProfileId: input.ownerProfileId,
        accountId: input.accountId,
        candidate: expect.objectContaining({
          candidate_id: "paper_canary:g8-material-test",
          symbol: "SPY",
          notional_cents: 2_000,
          entry_limit_micros: 10_060_050,
          stop_price_micros: 9_959_449,
          source_observation_ids: [
            input.quoteObservationId,
            input.earningsObservationId,
          ],
        }),
      }),
    );
    expect(ports.submitEntry).toHaveBeenCalledWith(expect.objectContaining({
      clientOrderId: "paper_canary_order:g8-material-test",
      riskDecisionId: decision.decision_id,
    }));
    expect(receipt).toMatchObject({
      operation: "paper.observer_canary.stage",
      simulated: true,
      provider_mutation_attempted: false,
      live_order_execution_enabled: false,
      answer_authority: false,
    });
  });

  it("fails before evidence processing when the paper account identity drifts", async () => {
    const ports = dependencies();
    vi.mocked(ports.readAccount).mockResolvedValue({
      account_id: "paper_account:test",
      owner_profile_id: "profile:test",
      connection_id: "brokerage_connection:other",
      room_id: "room:test",
      policy: DEFAULT_HELIX_PAPER_RISK_POLICY,
    } as Awaited<ReturnType<typeof ports.readAccount>>);

    await expect(stagePaperObserverCanary(input, ports)).rejects.toMatchObject({
      code: "paper_account_not_found",
    });
    expect(ports.readQuoteEvidence).not.toHaveBeenCalled();
    expect(ports.evaluateCandidate).not.toHaveBeenCalled();
    expect(ports.submitEntry).not.toHaveBeenCalled();
  });

  it("never submits an entry when the deterministic risk decision rejects", async () => {
    const ports = dependencies();
    vi.mocked(ports.evaluateCandidate).mockResolvedValue({
      ...decision,
      verdict: "rejected",
      reasons: ["risk_per_trade_limit_exceeded"],
    });

    await expect(stagePaperObserverCanary(input, ports)).rejects.toMatchObject({
      code: "paper_risk_decision_not_accepted",
    });
    expect(ports.submitEntry).not.toHaveBeenCalled();
  });
});
