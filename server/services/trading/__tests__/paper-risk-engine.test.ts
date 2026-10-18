import { describe, expect, it } from "vitest";
import {
  DEFAULT_HELIX_PAPER_RISK_POLICY,
  type HelixPaperAccountState,
  type HelixPaperTradeCandidate,
} from "@shared/trading/risk-contract";
import { evaluatePaperTradeRisk } from "../paper-risk-engine";

const NOW = new Date("2026-08-11T15:00:00.000Z");
const HASH = `sha256:${"a".repeat(64)}`;

const candidate = (
  overrides: Partial<HelixPaperTradeCandidate> = {},
): HelixPaperTradeCandidate => ({
  schema: "helix.trading_risk.v1",
  candidate_id: "candidate:test",
  room_id: "room:test",
  connection_id: "brokerage_connection:test",
  symbol: "TEST",
  asset_type: "equity",
  side: "buy",
  order_type: "limit",
  notional_cents: 2_500,
  entry_limit_micros: 10_010_000,
  stop_price_micros: 9_950_000,
  bid_micros: 10_000_000,
  ask_micros: 10_010_000,
  quote_observed_at: "2026-08-11T14:59:50.000Z",
  market_session: "regular",
  minutes_since_regular_open: 90,
  minutes_until_regular_close: 300,
  earnings_status: "clear",
  minutes_until_earnings: 10_080,
  strategy_version_ref: HASH,
  source_observation_ids: ["brokerage_observation:test"],
  ...overrides,
});

const account = (
  overrides: Partial<HelixPaperAccountState> = {},
): HelixPaperAccountState => ({
  schema: "helix.trading_risk.v1",
  trading_day: "2026-08-11",
  account_equity_cents: 34_000,
  buying_power_cents: 10_000,
  realized_pnl_cents: 0,
  unrealized_pnl_cents: 0,
  new_trades_today: 0,
  open_symbols: [],
  consecutive_losses: 0,
  kill_switch_active: false,
  kill_switch_reason: null,
  ...overrides,
});

describe("paper trading deterministic risk gate", () => {
  it("accepts a bounded fresh long-equity paper candidate", () => {
    const decision = evaluatePaperTradeRisk({
      policy: DEFAULT_HELIX_PAPER_RISK_POLICY,
      candidate: candidate(),
      account: account(),
      now: NOW,
      decisionId: "trading_risk:accepted",
    });

    expect(decision).toMatchObject({
      verdict: "accepted",
      reasons: [],
      mode: "paper",
      live_order_execution_enabled: false,
      answer_authority: false,
    });
    expect(decision.calculated).toMatchObject({
      quote_age_ms: 10_000,
      position_limit_cents: 5_000,
      risk_per_trade_limit_cents: 170,
      daily_loss_limit_cents: 680,
      current_daily_loss_cents: 0,
    });
    expect(decision.input_hash).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("fails closed on stale/extended-hours/earnings and price integrity", () => {
    const decision = evaluatePaperTradeRisk({
      policy: DEFAULT_HELIX_PAPER_RISK_POLICY,
      candidate: candidate({
        market_session: "post",
        minutes_since_regular_open: 0,
        minutes_until_regular_close: 0,
        quote_observed_at: "2026-08-11T14:58:00.000Z",
        bid_micros: 10_100_000,
        ask_micros: 10_000_000,
        stop_price_micros: 10_020_000,
        earnings_status: "unknown",
        minutes_until_earnings: 60,
      }),
      account: account(),
      now: NOW,
    });

    expect(decision.verdict).toBe("rejected");
    expect(decision.reasons).toEqual(expect.arrayContaining([
      "market_not_regular",
      "opening_buffer_active",
      "closing_buffer_active",
      "quote_stale",
      "invalid_quote",
      "invalid_long_stop",
      "earnings_status_unknown",
      "earnings_blackout_active",
    ]));
  });

  it("enforces loss, frequency, position, averaging, size, risk, and cash caps", () => {
    const decision = evaluatePaperTradeRisk({
      policy: DEFAULT_HELIX_PAPER_RISK_POLICY,
      candidate: candidate({
        notional_cents: 6_000,
        stop_price_micros: 8_000_000,
      }),
      account: account({
        buying_power_cents: 5_000,
        realized_pnl_cents: -500,
        unrealized_pnl_cents: -180,
        new_trades_today: 2,
        open_symbols: ["TEST"],
        consecutive_losses: 2,
      }),
      now: NOW,
    });

    expect(decision.verdict).toBe("rejected");
    expect(decision.reasons).toEqual(expect.arrayContaining([
      "daily_loss_limit_reached",
      "trade_count_limit_reached",
      "open_position_limit_reached",
      "consecutive_loss_limit_reached",
      "averaging_down_forbidden",
      "position_limit_exceeded",
      "risk_per_trade_limit_exceeded",
      "buying_power_exceeded",
    ]));
  });

  it("makes the kill switch dominant and rejects future or wide quotes", () => {
    const decision = evaluatePaperTradeRisk({
      policy: DEFAULT_HELIX_PAPER_RISK_POLICY,
      candidate: candidate({
        bid_micros: 9_900_000,
        ask_micros: 10_100_000,
        entry_limit_micros: 10_500_000,
        quote_observed_at: "2026-08-11T15:00:10.001Z",
      }),
      account: account({
        kill_switch_active: true,
        kill_switch_reason: "operator stop",
      }),
      now: NOW,
    });

    expect(decision.verdict).toBe("rejected");
    expect(decision.reasons).toEqual(expect.arrayContaining([
      "kill_switch_active",
      "quote_from_future",
      "spread_too_wide",
      "entry_too_far_from_market",
    ]));
  });

  it("hashes equivalent object inputs deterministically", () => {
    const first = evaluatePaperTradeRisk({
      policy: { ...DEFAULT_HELIX_PAPER_RISK_POLICY },
      candidate: candidate(),
      account: account(),
      now: NOW,
    });
    const second = evaluatePaperTradeRisk({
      policy: { ...DEFAULT_HELIX_PAPER_RISK_POLICY },
      candidate: candidate(),
      account: account(),
      now: NOW,
    });

    expect(first.input_hash).toBe(second.input_hash);
  });
});
