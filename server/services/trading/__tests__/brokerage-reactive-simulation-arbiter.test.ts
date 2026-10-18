import { describe, expect, it, vi } from "vitest";
import fixture from "../../../../fixtures/brokerage-reactive-simulation/spy-no-lookahead.v1.json";
import {
  runDeterministicBrokerageReactiveReplay,
  type HelixBrokerageReactiveDecisionReceipt,
} from "@shared/trading/brokerage-reactive-simulation";
import type { HelixPaperOrder } from "@shared/trading/paper-contract";
import {
  DEFAULT_HELIX_PAPER_RISK_POLICY,
  type HelixTradingRiskDecision,
} from "@shared/trading/risk-contract";
import {
  admitBrokerageReactiveSimulationProposal,
  type BrokerageReactiveSimulationArbiterDependencies,
} from "../brokerage-reactive-simulation-arbiter";

const NOW = new Date("2026-08-28T14:00:01.200Z");
const replay = runDeterministicBrokerageReactiveReplay(fixture);
const entryReceipt = replay.receipts[1] as HelixBrokerageReactiveDecisionReceipt;

const decisionFor = (
  candidateId: string,
  verdict: "accepted" | "rejected" = "accepted",
): HelixTradingRiskDecision => ({
  schema: "helix.trading_risk.v1",
  decision_id: "risk_decision:reactive-test",
  candidate_id: candidateId,
  policy_id: DEFAULT_HELIX_PAPER_RISK_POLICY.policy_id,
  policy_version: DEFAULT_HELIX_PAPER_RISK_POLICY.policy_version,
  mode: "paper",
  verdict,
  reasons: verdict === "accepted" ? [] : ["risk_per_trade_limit_exceeded"],
  calculated: {
    quote_age_ms: 150,
    spread_bps: 3,
    entry_deviation_bps: 0,
    estimated_risk_cents: 5,
    position_limit_cents: 500,
    risk_per_trade_limit_cents: 100,
    daily_loss_limit_cents: 300,
    current_daily_loss_cents: 0,
  },
  evaluated_at: NOW.toISOString(),
  input_hash: `sha256:${"d".repeat(64)}`,
  read_only_observations_required: true,
  live_order_execution_enabled: false,
  answer_authority: false,
});

const orderFor = (input: {
  clientOrderId: string;
  riskDecisionId: string;
}): HelixPaperOrder => ({
  schema: "helix.paper_trading.v1",
  order_id: "paper_order:reactive-test",
  client_order_id: input.clientOrderId,
  account_id: fixture.manifest.paper_account_id,
  risk_decision_id: input.riskDecisionId,
  intent: "entry",
  symbol: "SPY",
  side: "buy",
  order_type: "limit",
  notional_cents: 500,
  quantity_micros: 5_060,
  limit_price_micros: 98_810_000,
  stop_price_micros: 97_821_900,
  reserved_cents: 500,
  filled_quantity_micros: 0,
  filled_notional_cents: 0,
  execution_model: fixture.manifest.simulation_model,
  status: "open",
  fill_state: "unfilled",
  source_observation_id: entryReceipt.source_observation_id,
  created_at: NOW.toISOString(),
  updated_at: NOW.toISOString(),
  filled_at: null,
  cancelled_at: null,
  simulated: true,
  live_order_execution_enabled: false,
  answer_authority: false,
});

const dependencies = (): BrokerageReactiveSimulationArbiterDependencies => ({
  readAccount: vi.fn().mockResolvedValue({
    schema: "helix.trading_risk.v1",
    account_id: fixture.manifest.paper_account_id,
    owner_profile_id: fixture.manifest.owner_profile_id,
    connection_id: fixture.manifest.connection_id,
    room_id: fixture.manifest.room_id,
    trading_day: "2026-08-28",
    starting_cash_cents: 20_000,
    account_equity_cents: 20_000,
    buying_power_cents: 20_000,
    realized_pnl_cents: 0,
    unrealized_pnl_cents: 0,
    new_trades_today: 0,
    open_symbols: [],
    consecutive_losses: 0,
    kill_switch_active: false,
    kill_switch_reason: null,
    policy: DEFAULT_HELIX_PAPER_RISK_POLICY,
    policy_hash: `sha256:${"e".repeat(64)}`,
    status: "active",
    created_at: "2026-08-28T13:25:00.000Z",
    updated_at: "2026-08-28T13:25:00.000Z",
    simulated: true,
    live_order_execution_enabled: false,
    credential_included: false,
    account_numbers_included: false,
    answer_authority: false,
  }),
  readQuoteEvidence: vi.fn().mockResolvedValue({
    observationId: entryReceipt.source_observation_id,
    symbol: "SPY",
    bidMicros: 98_790_000,
    askMicros: 98_810_000,
    observedAt: "2026-08-28T14:00:01.050Z",
    outputHash: entryReceipt.source_output_hash,
    producerEpochRef: fixture.manifest.producer_epoch_ref,
  }),
  requireNoEarningsEvidence: vi.fn().mockResolvedValue(undefined),
  evaluateCandidate: vi.fn().mockImplementation(async ({ candidate }) =>
    decisionFor(candidate.candidate_id)),
  submitEntry: vi.fn().mockImplementation(async (input) => orderFor(input)),
  readMarketClock: vi.fn().mockReturnValue({
    session: "regular",
    tradingDate: "2026-08-28",
    minutesSinceRegularOpen: 30,
    minutesUntilRegularClose: 360,
  }),
});

const input = {
  manifest: fixture.manifest,
  decisionReceipt: entryReceipt,
  earningsObservationId: "brokerage_observation:spy-earnings-clear",
  now: NOW,
};

describe("brokerage reactive simulation R1 arbiter", () => {
  it("routes one exact healthy proposal through risk admission and the local paper ledger", async () => {
    const ports = dependencies();
    const receipt = await admitBrokerageReactiveSimulationProposal(input, ports);

    expect(ports.evaluateCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerProfileId: fixture.manifest.owner_profile_id,
        accountId: fixture.manifest.paper_account_id,
        candidate: expect.objectContaining({
          symbol: "SPY",
          notional_cents: 500,
          entry_limit_micros: 98_810_000,
          stop_price_micros: 97_821_900,
          bid_micros: 98_790_000,
          ask_micros: 98_810_000,
          strategy_version_ref: fixture.manifest.strategy_artifact_hash,
          source_observation_ids: [
            entryReceipt.source_observation_id,
            input.earningsObservationId,
          ],
        }),
      }),
    );
    expect(ports.submitEntry).toHaveBeenCalledWith(expect.objectContaining({
      riskDecisionId: "risk_decision:reactive-test",
      clientOrderId: receipt.effect_idempotency_key,
      executionModel: fixture.manifest.simulation_model,
    }));
    expect(receipt).toMatchObject({
      disposition: "simulated_entry_reserved",
      provider_order_tool_calls_made: 0,
      simulated: true,
      provider_mutation_attempted: false,
      live_order_execution_enabled: false,
      answer_authority: false,
      terminal_eligible: false,
      order: { status: "open", simulated: true },
    });
  });

  it("derives stable candidate and order identities for exact replay", async () => {
    const ports = dependencies();
    const first = await admitBrokerageReactiveSimulationProposal(input, ports);
    const second = await admitBrokerageReactiveSimulationProposal(input, ports);

    expect(second).toEqual(first);
    const evaluateCalls = vi.mocked(ports.evaluateCandidate).mock.calls;
    const submitCalls = vi.mocked(ports.submitEntry).mock.calls;
    expect(evaluateCalls[1]?.[0].candidate.candidate_id).toBe(
      evaluateCalls[0]?.[0].candidate.candidate_id,
    );
    expect(submitCalls[1]?.[0].clientOrderId).toBe(
      submitCalls[0]?.[0].clientOrderId,
    );
  });

  it("returns an evidence-only risk rejection and never reserves paper cash", async () => {
    const ports = dependencies();
    vi.mocked(ports.evaluateCandidate).mockImplementation(async ({ candidate }) =>
      decisionFor(candidate.candidate_id, "rejected"));

    const receipt = await admitBrokerageReactiveSimulationProposal(input, ports);
    expect(receipt).toMatchObject({
      disposition: "risk_rejected",
      order: null,
      risk_decision: {
        verdict: "rejected",
        reasons: ["risk_per_trade_limit_exceeded"],
      },
      provider_order_tool_calls_made: 0,
    });
    expect(ports.submitEntry).not.toHaveBeenCalled();
  });

  it("rejects account, quote-hash, and entry-parameter drift before risk admission", async () => {
    const accountDrift = dependencies();
    vi.mocked(accountDrift.readAccount).mockResolvedValue({
      ...await accountDrift.readAccount({
        ownerProfileId: fixture.manifest.owner_profile_id,
        accountId: fixture.manifest.paper_account_id,
      }) as NonNullable<Awaited<ReturnType<typeof accountDrift.readAccount>>>,
      room_id: "shared_realtime_room:other",
    });
    await expect(
      admitBrokerageReactiveSimulationProposal(input, accountDrift),
    ).rejects.toMatchObject({ code: "paper_account_not_found" });
    expect(accountDrift.readQuoteEvidence).not.toHaveBeenCalled();

    const hashDrift = dependencies();
    vi.mocked(hashDrift.readQuoteEvidence).mockResolvedValue({
      ...await hashDrift.readQuoteEvidence({
        ownerProfileId: fixture.manifest.owner_profile_id,
        connectionId: fixture.manifest.connection_id,
        roomId: fixture.manifest.room_id,
        observationId: entryReceipt.source_observation_id,
        symbol: "SPY",
        now: NOW,
        maxAgeMs: 30_000,
        maxFutureSkewMs: 5_000,
      }),
      outputHash: `sha256:${"f".repeat(64)}`,
    });
    await expect(
      admitBrokerageReactiveSimulationProposal(input, hashDrift),
    ).rejects.toMatchObject({ code: "paper_quote_evidence_invalid" });
    expect(hashDrift.evaluateCandidate).not.toHaveBeenCalled();

    const parameterDrift = dependencies();
    await expect(admitBrokerageReactiveSimulationProposal({
      ...input,
      decisionReceipt: {
        ...entryReceipt,
        proposal: {
          ...entryReceipt.proposal,
          simulated_entry: {
            ...entryReceipt.proposal.simulated_entry!,
            limit_price_micros: 98_820_000,
          },
        },
      },
    }, parameterDrift)).rejects.toMatchObject({
      code: "paper_quote_evidence_invalid",
    });
    expect(parameterDrift.evaluateCandidate).not.toHaveBeenCalled();
  });

  it("rejects a watchdog intervention before reading or mutating the paper account", async () => {
    const gapped = {
      ...fixture.observations[1],
      observation_id: "brokerage_observation:r1-gap",
      sequence: 4,
      observation_revision: 4,
      retention_gap_after_sequence: 1,
    };
    const gappedReceipt = runDeterministicBrokerageReactiveReplay({
      manifest: fixture.manifest,
      observations: [fixture.observations[0], gapped],
    }).receipts[1];
    const ports = dependencies();
    await expect(admitBrokerageReactiveSimulationProposal({
      ...input,
      decisionReceipt: gappedReceipt,
    }, ports)).rejects.toMatchObject({
      code: "paper_risk_decision_not_accepted",
    });
    expect(ports.readAccount).not.toHaveBeenCalled();
    expect(ports.evaluateCandidate).not.toHaveBeenCalled();
    expect(ports.submitEntry).not.toHaveBeenCalled();
  });
});
