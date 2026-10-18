import { describe, expect, it, vi } from "vitest";
import type { HelixPaperProcessObservationReceipt } from
  "@shared/trading/paper-contract";
import { DEFAULT_HELIX_PAPER_RISK_POLICY } from
  "@shared/trading/risk-contract";
import {
  HELIX_BROKERAGE_MARKET_OBSERVER_PROFILE_HASH,
  readBrokerageObserverAccount,
  runBrokerageMarketObserverCycle,
} from "../brokerage-market-observer";

const HASH = `sha256:${"a".repeat(64)}`;
const baseAccount = {
  account_id: "paper_account:test",
  owner_profile_id: "profile:test",
  connection_id: "brokerage_connection:test",
  room_id: "room:test",
  kill_switch_active: false,
  policy: DEFAULT_HELIX_PAPER_RISK_POLICY,
};
const paperReceipt = (
  overrides: Partial<HelixPaperProcessObservationReceipt> = {},
): HelixPaperProcessObservationReceipt => ({
  schema: "helix.paper_trading.v1",
  ok: true,
  account_id: "paper_account:test",
  observation_id: "brokerage_observation:test",
  symbol: "TEST",
  filled_order_ids: [],
  marked_position_ids: [],
  stop_exit_order_ids: [],
  simulated: true,
  live_order_execution_enabled: false,
  answer_authority: false,
  ...overrides,
});

const input = {
  ownerProfileId: "profile:test",
  connectionId: "brokerage_connection:test",
  roomId: "room:test",
  paperAccountId: "paper_account:test",
  monitorLeaseId: "environment_monitor:test",
  observationId: "brokerage_observation:test",
  symbol: "test",
  now: new Date("2026-08-27T14:00:01.000Z"),
};

const observerDependencies = (input: {
  readAccount: ReturnType<typeof vi.fn>;
  processObservation: ReturnType<typeof vi.fn>;
}) => ({
  ...input,
  readAdmission: vi.fn().mockResolvedValue({
    producerEpochRef: "brokerage_epoch:test",
    environmentBindingId: "brokerage_room_binding:test",
  }),
  readQuoteEvidence: vi.fn().mockResolvedValue({
    observationId: "brokerage_observation:test",
    symbol: "TEST",
    bidMicros: 10_000_000,
    askMicros: 10_010_000,
    observedAt: "2026-08-27T14:00:00.000Z",
    outputHash: HASH,
    producerEpochRef: "brokerage_epoch:test",
  }),
});

describe("brokerage market observer profile", () => {
  it("loads the default observer account by its exact paper-account identity", async () => {
    const readById = vi.fn().mockResolvedValue(baseAccount);
    await expect(readBrokerageObserverAccount({
      ownerProfileId: "profile:test",
      accountId: "paper_account:test",
    }, readById)).resolves.toMatchObject(baseAccount);
    expect(readById).toHaveBeenCalledWith({
      ownerProfileId: "profile:test",
      accountId: "paper_account:test",
    });
  });

  it("fails closed when the exact paper account is absent", async () => {
    await expect(readBrokerageObserverAccount({
      ownerProfileId: "profile:test",
      accountId: "paper_account:missing",
    }, vi.fn().mockResolvedValue(null))).rejects.toMatchObject({
      code: "paper_account_not_found",
    });
  });

  it("projects a deterministic paper-only semantic receipt", async () => {
    const readAccount = vi.fn()
      .mockResolvedValueOnce(baseAccount)
      .mockResolvedValueOnce(baseAccount);
    const processObservation = vi.fn().mockResolvedValue(paperReceipt({
      filled_order_ids: ["paper_order:test"],
      marked_position_ids: ["paper_position:test"],
    }));
    const first = await runBrokerageMarketObserverCycle(input, observerDependencies({
      readAccount,
      processObservation,
    }));
    readAccount.mockReset();
    readAccount.mockResolvedValueOnce(baseAccount).mockResolvedValueOnce(baseAccount);
    const second = await runBrokerageMarketObserverCycle(input, observerDependencies({
      readAccount,
      processObservation,
    }));

    expect(first).toMatchObject({
      profile_artifact_hash: HELIX_BROKERAGE_MARKET_OBSERVER_PROFILE_HASH,
      reaction_requirement: "monitor_only",
      event_types: [
        "paper_order_filled",
        "paper_position_marked",
        "paper_position_opened",
      ],
      disposition: "paper_state_changed",
      semantic_wake_eligible: true,
      simulated: true,
      provider_mutation_attempted: false,
      live_order_execution_enabled: false,
      answer_authority: false,
      terminal_eligible: false,
    });
    expect(first.observer_cycle_id).toBe(second.observer_cycle_id);
    expect(processObservation).toHaveBeenCalledWith(expect.objectContaining({
      symbol: "TEST",
      observationId: "brokerage_observation:test",
    }));
  });

  it("emits a risk-control transition only from measured account state", async () => {
    const receipt = await runBrokerageMarketObserverCycle(input, observerDependencies({
      readAccount: vi.fn()
        .mockResolvedValueOnce(baseAccount)
        .mockResolvedValueOnce({ ...baseAccount, kill_switch_active: true }),
      processObservation: vi.fn().mockResolvedValue(paperReceipt()),
    }));
    expect(receipt).toMatchObject({
      event_types: ["risk_kill_switch_activated"],
      disposition: "risk_control_changed",
      semantic_wake_eligible: true,
      kill_switch_active_before: false,
      kill_switch_active_after: true,
    });
  });

  it("fails closed before processing when account identity drifts", async () => {
    const processObservation = vi.fn();
    await expect(runBrokerageMarketObserverCycle(input, observerDependencies({
      readAccount: vi.fn().mockResolvedValue({
        ...baseAccount,
        room_id: "room:other",
      }),
      processObservation,
    }))).rejects.toMatchObject({ code: "paper_trading_unavailable" });
    expect(processObservation).not.toHaveBeenCalled();
  });

  it("fails closed when identity changes during the observer cycle", async () => {
    await expect(runBrokerageMarketObserverCycle(input, observerDependencies({
      readAccount: vi.fn()
        .mockResolvedValueOnce(baseAccount)
        .mockResolvedValueOnce({
          ...baseAccount,
          connection_id: "brokerage_connection:rotated",
        }),
      processObservation: vi.fn().mockResolvedValue(paperReceipt()),
    }))).rejects.toMatchObject({ code: "paper_trading_unavailable" });
  });

  it("rejects a stored quote from a superseded producer epoch", async () => {
    const dependencies = observerDependencies({
      readAccount: vi.fn().mockResolvedValue(baseAccount),
      processObservation: vi.fn(),
    });
    dependencies.readQuoteEvidence.mockResolvedValue({
      observationId: "brokerage_observation:test",
      symbol: "TEST",
      bidMicros: 10_000_000,
      askMicros: 10_010_000,
      observedAt: "2026-08-27T14:00:00.000Z",
      outputHash: HASH,
      producerEpochRef: "brokerage_epoch:stale",
    });
    await expect(runBrokerageMarketObserverCycle(input, dependencies))
      .rejects.toMatchObject({ code: "paper_source_observation_invalid" });
    expect(dependencies.processObservation).not.toHaveBeenCalled();
  });
});
