import { describe, expect, it } from "vitest";
import {
  HELIX_BROKERAGE_OBSERVATION_SCHEMA,
  type HelixBrokerageObservation,
} from "@shared/helix-brokerage-environment";
import { auditG7BrokerageTransfer } from "../g7-transfer-audit";

const NOW = new Date("2026-08-23T18:00:00.000Z");
const expected = {
  account_session_id: "account_session:g7",
  owner_profile_id: "profile:g7",
  source_binding_id: "brokerage_room_binding:g7",
  connection_id: "brokerage_connection:g7",
  room_id: "shared_realtime_room:g7",
  upstream_tool: "get_equity_quotes" as const,
  capability_id: "brokerage.robinhood.market_data.read",
  producer_epoch_ref: "brokerage_producer_epoch:g7",
  input_hash: `sha256:${"a".repeat(64)}`,
};

const observation = (
  route: "reference" | "mcp" | "ask",
  patch: Partial<HelixBrokerageObservation> = {},
): HelixBrokerageObservation => ({
  schema: HELIX_BROKERAGE_OBSERVATION_SCHEMA,
  ok: true,
  observation_id: `brokerage_observation:${route}`,
  connection_id: expected.connection_id,
  room_id: expected.room_id,
  upstream_tool: expected.upstream_tool,
  capability_id: expected.capability_id,
  producer_epoch_ref: expected.producer_epoch_ref,
  input_hash: expected.input_hash,
  provider: "robinhood",
  environment_domain: "brokerage",
  observed_at: "2026-08-23T17:59:50.000Z",
  freshness_state: "fresh",
  data: { results: [{ symbol: "AAPL", bid: "1", ask: "2" }] },
  output_hash: `sha256:${route === "reference" ? "b" : route === "mcp" ? "c" : "d"}`.padEnd(71, route === "reference" ? "b" : route === "mcp" ? "c" : "d"),
  redaction_count: 0,
  truncated: false,
  read_only: true,
  live_order_execution_enabled: false,
  credential_included: false,
  account_numbers_included: false,
  raw_provider_payload_included: false,
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
  ...patch,
});

const lifecycle = (patch: Partial<Parameters<typeof auditG7BrokerageTransfer>[0]["ask_lifecycle"]> = {}) => ({
  executed: true,
  normalized: true,
  reentered_observation_refs: ["brokerage_observation:ask"],
  solver_completed: true,
  terminal_authority_granted: true,
  selected_terminal_support_refs: ["brokerage_observation:ask"],
  reentered_observation_hashes: {
    "brokerage_observation:ask": observation("ask").output_hash,
  },
  selected_terminal_support_hashes: {
    "brokerage_observation:ask": observation("ask").output_hash,
  },
  terminal_text: "AAPL was observed at 17:59:50Z; this is factual read-only evidence.",
  api_text: "AAPL was observed at 17:59:50Z; this is factual read-only evidence.",
  voice_text: "AAPL was observed at 17:59:50Z; this is factual read-only evidence.",
  mutation_tool_calls_made: 0,
  supporting_role_authority: {
    artifact_count: 2,
    all_revision_current: true,
    mutation_authority_granted: false,
    terminal_authority_granted: false,
    financial_recommendation_authority_granted: false,
  },
  ...patch,
});

const run = (patch: Partial<Parameters<typeof auditG7BrokerageTransfer>[0]> = {}) =>
  auditG7BrokerageTransfer({
    expected,
    reference_observation: observation("reference"),
    reference_authority: {
      account_session_id: expected.account_session_id,
      owner_profile_id: expected.owner_profile_id,
      source_binding_id: expected.source_binding_id,
    },
    mcp_observation: observation("mcp"),
    mcp_authority: {
      account_session_id: expected.account_session_id,
      owner_profile_id: expected.owner_profile_id,
      source_binding_id: expected.source_binding_id,
    },
    ask_observation: observation("ask"),
    ask_authority: {
      account_session_id: expected.account_session_id,
      owner_profile_id: expected.owner_profile_id,
      source_binding_id: expected.source_binding_id,
    },
    ask_lifecycle: lifecycle(),
    now: NOW,
    ...patch,
  });

describe("G7 Robinhood read-only tripath differential audit", () => {
  it("accepts equivalent fresh reference, MCP, and Ask observations", () => {
    expect(run()).toMatchObject({
      ok: true,
      first_divergence_stage: null,
      canonical_ask_observation_id: "brokerage_observation:ask",
      mutation_tool_calls_made: 0,
      answer_authority: false,
      terminal_eligible: false,
      market_session_contract: {
        authority: "not_asserted",
        source: "provider_observation_only",
        execution_eligibility: false,
      },
    });
  });

  it("reports poisoned projections without allowing them to regress canonical facts", () => {
    const result = run({
      downstream_projection: {
        execution_status: "not_executed",
        observation_reentered: false,
        terminal_text: "A stale card replaced the answer.",
      },
    });
    expect(result.ok).toBe(true);
    expect(result.canonical_terminal_text).toBe(lifecycle().terminal_text);
    expect(result.projection_contradictions).toEqual([
      "projection_regressed_executed_fact",
      "projection_regressed_reentry_fact",
      "projection_substituted_terminal_text",
    ]);
  });

  it.each([
    ["wrong account session", { ask_authority: { account_session_id: "account_session:wrong", owner_profile_id: expected.owner_profile_id, source_binding_id: expected.source_binding_id } }, "ask_execution"],
    ["wrong owner profile", { ask_authority: { account_session_id: expected.account_session_id, owner_profile_id: "profile:wrong", source_binding_id: expected.source_binding_id } }, "ask_execution"],
    ["wrong source binding", { ask_authority: { account_session_id: expected.account_session_id, owner_profile_id: expected.owner_profile_id, source_binding_id: "brokerage_room_binding:wrong" } }, "ask_execution"],
    ["wrong connection", { ask_observation: observation("ask", { connection_id: "brokerage_connection:wrong" }) }, "ask_execution"],
    ["wrong room", { ask_observation: observation("ask", { room_id: "shared_realtime_room:wrong" }) }, "ask_execution"],
    ["wrong producer epoch", { ask_observation: observation("ask", { producer_epoch_ref: "brokerage_producer_epoch:wrong" }) }, "ask_execution"],
    ["stale observation", { ask_observation: observation("ask", { observed_at: "2026-08-23T17:00:00.000Z" }) }, "ask_execution"],
    ["future observation", { ask_observation: observation("ask", { observed_at: "2026-08-23T18:01:00.000Z" }) }, "ask_execution"],
    ["missing exact re-entry", { ask_lifecycle: lifecycle({ reentered_observation_refs: [] }) }, "evidence_reentry"],
    ["re-entry output hash mismatch", { ask_lifecycle: lifecycle({ reentered_observation_hashes: { "brokerage_observation:ask": `sha256:${"e".repeat(64)}` } }) }, "evidence_reentry"],
    ["stale supporting role", { ask_lifecycle: lifecycle({ supporting_role_authority: { artifact_count: 1, all_revision_current: false, mutation_authority_granted: false, terminal_authority_granted: false, financial_recommendation_authority_granted: false } }) }, "evidence_reentry"],
    ["supporting role mutation authority", { ask_lifecycle: lifecycle({ supporting_role_authority: { artifact_count: 1, all_revision_current: true, mutation_authority_granted: true, terminal_authority_granted: false, financial_recommendation_authority_granted: false } }) }, "evidence_reentry"],
    ["terminal support output hash mismatch", { ask_lifecycle: lifecycle({ selected_terminal_support_hashes: { "brokerage_observation:ask": `sha256:${"f".repeat(64)}` } }) }, "terminal_authority"],
    ["mutation call", { ask_lifecycle: lifecycle({ mutation_tool_calls_made: 1 }) }, "terminal_authority"],
    ["presentation divergence", { ask_lifecycle: lifecycle({ api_text: "different" }) }, "presentation"],
  ])("fails at the first causal divergence for %s", (_label, patch, stage) => {
    const result = run(patch as Partial<Parameters<typeof auditG7BrokerageTransfer>[0]>);
    expect(result.ok).toBe(false);
    expect(result.first_divergence_stage).toBe(stage);
    expect(result.canonical_terminal_text).toBeNull();
  });
});
