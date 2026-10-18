import { describe, expect, it, vi } from "vitest";
import type { HelixBrokerageMarketObserverReceipt } from
  "@shared/trading/brokerage-market-observer";
import type { HelixEnvironmentMonitorLease } from
  "@shared/helix-environment-monitor";
import { BrokerageMarketObserverSemanticSource } from
  "../brokerage-market-observer-semantic-source";

const HASH = `sha256:${"a".repeat(64)}`;
const NOW = "2026-08-27T14:00:01.000Z";
const lease: HelixEnvironmentMonitorLease = {
  schema: "helix.environment_monitor_lease.v1",
  monitor_id: "environment_monitor:test",
  identity: {
    owner_profile_id: "profile:test",
    mcp_client_id: "mcp_client:test",
    client_continuation_ref: "continuation:test",
    run_id: "agent_run:test",
    goal_id: "environment_goal:test",
    room_id: "room:test",
    participant_id: "participant:test",
    environment_binding_id: "brokerage_room_binding:test",
    source_id: "brokerage_connection:test",
    world_id: "paper_account:test",
    subject_ref: "paper_account:test",
    producer_epoch_ref: "brokerage_epoch:test",
    policy_revision: 1,
  },
  event_families: [
    "market", "portfolio", "orders", "risk_control", "paper_simulation",
  ],
  max_event_age_ms: 30_000,
  wake_budget_total: 10,
  wakes_delivered: 0,
  delivered_cursor: 0,
  acknowledged_cursor: 0,
  fresh_snapshot_required: false,
  gap_after_cursor: null,
  recovery_snapshot_evidence_ref: null,
  recovery_snapshot_observed_at: null,
  status: "active",
  created_at: "2026-08-27T13:59:00.000Z",
  updated_at: "2026-08-27T13:59:00.000Z",
  expires_at: "2026-08-27T14:05:00.000Z",
  revoked_at: null,
  credential_included: false,
  raw_events_included: false,
  content_role: "environment_monitor_lease_control_not_assistant_answer",
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
};
const receipt: HelixBrokerageMarketObserverReceipt = {
  schema: "helix.brokerage_market_observer.v1",
  ok: true,
  observer_cycle_id: "brokerage_observer_cycle:test",
  profile_id: "resident.brokerage.market_observer.v1",
  profile_artifact_hash: HASH,
  reaction_requirement: "monitor_only",
  monitor_lease_id: lease.monitor_id,
  owner_profile_id: lease.identity.owner_profile_id,
  connection_id: lease.identity.source_id,
  room_id: lease.identity.room_id!,
  environment_binding_id: lease.identity.environment_binding_id,
  paper_account_id: lease.identity.world_id,
  producer_epoch_ref: lease.identity.producer_epoch_ref,
  source_observation_id: "brokerage_observation:test",
  source_output_hash: HASH,
  source_observed_at: "2026-08-27T14:00:00.000Z",
  observation_revision: Date.parse("2026-08-27T14:00:00.000Z"),
  symbol: "TEST",
  event_types: ["paper_position_marked", "risk_kill_switch_activated"],
  disposition: "risk_control_changed",
  semantic_wake_eligible: true,
  paper_receipt: {
    schema: "helix.paper_trading.v1",
    ok: true,
    account_id: "paper_account:test",
    observation_id: "brokerage_observation:test",
    symbol: "TEST",
    filled_order_ids: [],
    marked_position_ids: ["paper_position:test"],
    stop_exit_order_ids: [],
    simulated: true,
    live_order_execution_enabled: false,
    answer_authority: false,
  },
  kill_switch_active_before: false,
  kill_switch_active_after: true,
  simulated: true,
  provider_mutation_attempted: false,
  live_order_execution_enabled: false,
  credential_included: false,
  account_numbers_included: false,
  raw_provider_payload_included: false,
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
};

describe("brokerage observer semantic monitor source", () => {
  it("delivers one bounded brokerage semantic item through the generic monitor", async () => {
    const deliver = vi.fn().mockImplementation(async (input) => ({
      lease,
      delivery: { marker: "delivered" },
      duplicate_evidence_refs: [],
      input,
    }));
    const source = new BrokerageMarketObserverSemanticSource({
      inspect: vi.fn().mockResolvedValue(lease),
      deliver,
    } as never);
    const result = await source.deliver({
      profileId: "profile:test",
      mcpClientId: "mcp_client:test",
      clientContinuationRef: "continuation:test",
      receipt,
      now: NOW,
    });
    expect(result.delivery).toEqual({ marker: "delivered" });
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({
      monitorId: lease.monitor_id,
      clientWakeTransport: "active_wait",
      items: [expect.objectContaining({
        evidence_ref: receipt.observer_cycle_id,
        event_families: ["market", "paper_simulation", "portfolio", "risk_control"],
        source_id: lease.identity.source_id,
        provenance_valid: true,
        answer_authority: false,
        terminal_eligible: false,
      })],
    }));
  });

  it("does not create a wake for a no-change paper cycle", async () => {
    const deliver = vi.fn();
    const source = new BrokerageMarketObserverSemanticSource({
      inspect: vi.fn().mockResolvedValue(lease),
      deliver,
    } as never);
    const result = await source.deliver({
      profileId: "profile:test",
      mcpClientId: "mcp_client:test",
      clientContinuationRef: "continuation:test",
      receipt: {
        ...receipt,
        event_types: [],
        disposition: "no_material_paper_change",
        semantic_wake_eligible: false,
        kill_switch_active_after: false,
      },
      now: NOW,
    });
    expect(result.delivery).toBeNull();
    expect(deliver).not.toHaveBeenCalled();
  });

  it("rejects connection, binding, account, or producer identity drift", async () => {
    const source = new BrokerageMarketObserverSemanticSource({
      inspect: vi.fn().mockResolvedValue(lease),
      deliver: vi.fn(),
    } as never);
    await expect(source.deliver({
      profileId: "profile:test",
      mcpClientId: "mcp_client:test",
      clientContinuationRef: "continuation:test",
      receipt: { ...receipt, producer_epoch_ref: "brokerage_epoch:other" },
      now: NOW,
    })).rejects.toThrow(/brokerage_monitor_identity_mismatch:producer_epoch_ref/u);
  });
});
