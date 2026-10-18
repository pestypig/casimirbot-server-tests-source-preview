import { buildHelixAccountCapabilityPolicy } from "@shared/helix-account-session";
import {
  HELIX_BROKERAGE_OBSERVATION_SCHEMA,
  HELIX_BROKERAGE_READ_GATEWAY_CAPABILITY,
  type HelixBrokerageObservation,
} from "@shared/helix-brokerage-environment";
import { describe, expect, it, vi } from "vitest";
import type { HelixWorkstationGatewayAccountContext } from "../account-policy";
import { listAccountAuthorizedWorkstationGatewayCapabilities } from "../account-policy";
import {
  brokerageReadManifest,
  executeBrokerageReadGatewayCapability,
} from "../brokerage-read";
import { listWorkstationGatewayCapabilities } from "../registry";

const PROFILE_ID = "profile:g7-brokerage-owner";
const ROOM_ID = "shared_realtime_room:g7-brokerage";
const CONNECTION_ID = "brokerage_connection:g7-robinhood";
const SOURCE_BINDING_ID = "brokerage_room_binding:g7-robinhood";

const accountContext = (
  accountType: "developer" | "user" = "developer",
): HelixWorkstationGatewayAccountContext => {
  const accountPolicy = buildHelixAccountCapabilityPolicy(accountType);
  const session = {
    schema: "helix.account_session.v1" as const,
    session_id: `account_session:g7-${accountType}`,
    profile: {
      profile_id: PROFILE_ID,
      display_name: "G7 owner",
      auth_mode: "guest" as const,
      account_type: accountType,
      provider: "guest" as const,
      created_at: "2026-08-23T12:00:00.000Z",
      updated_at: "2026-08-23T12:00:00.000Z",
    },
    account_policy: accountPolicy,
    status: "active" as const,
    memory_scope: "session_only" as const,
    created_at: "2026-08-23T12:00:00.000Z",
    updated_at: "2026-08-23T12:00:00.000Z",
    expires_at: "2026-08-24T12:00:00.000Z",
  };
  return {
    session_id: session.session_id,
    profile_id: PROFILE_ID,
    trusted_account_session: true,
    account_session: session,
    account_policy: accountPolicy,
  };
};

const observation: HelixBrokerageObservation = {
  schema: HELIX_BROKERAGE_OBSERVATION_SCHEMA,
  ok: true,
  observation_id: "brokerage_observation:g7",
  connection_id: CONNECTION_ID,
  room_id: ROOM_ID,
  provider: "robinhood",
  environment_domain: "brokerage",
  upstream_tool: "get_equity_quotes",
  capability_id: "brokerage.robinhood.market_data.read",
  producer_epoch_ref: "brokerage_producer_epoch:g7",
  observed_at: "2026-08-23T12:00:00.000Z",
  freshness_state: "fresh",
  data: { results: [{ symbol: "TEST", bid: "10.00", ask: "10.01" }] },
  input_hash:
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  output_hash:
    "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
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
};

const deps = (executeRead: ReturnType<typeof vi.fn>, epoch = observation.producer_epoch_ref) => ({
  executeRead,
  assertReadCapability: vi.fn(async () => ({ producerEpochRef: epoch })),
  listBindings: vi.fn(async () => ({
    bindings: [{
      binding_id: SOURCE_BINDING_ID,
      connection_id: CONNECTION_ID,
      status: "active",
      privacy_state: "owner_private",
    }],
  }) as never),
  now: () => new Date(observation.observed_at),
});

describe("G7 Robinhood read-only workstation gateway", () => {
  it("publishes only a non-mutating, nonterminal read contract", () => {
    expect(brokerageReadManifest).toMatchObject({
      capability_id: HELIX_BROKERAGE_READ_GATEWAY_CAPABILITY,
      mode: "read",
      mutating: false,
      code_mutation: false,
      shell_access: false,
      requires_confirmation: false,
      terminal_eligible: false,
      permission_profile_required: "read",
      post_tool_model_step_required: true,
      output_observation_schema: HELIX_BROKERAGE_OBSERVATION_SCHEMA,
      assistant_answer: false,
      raw_content_included: false,
    });
    const serialized = JSON.stringify(brokerageReadManifest);
    expect(serialized).not.toContain("place_equity_order");
    expect(serialized).not.toContain("cancel_equity_order");
    expect(serialized).not.toContain("review_equity_order");
    expect(serialized).not.toContain("get_accounts");
  });

  it("appears in the developer gateway catalog but remains absent from the user policy catalog", () => {
    const developer = listWorkstationGatewayCapabilities({
      mode: "read",
      accountType: "developer",
      profileId: PROFILE_ID,
    });
    expect(developer.capabilities.some(
      (entry) => entry.capability_id === HELIX_BROKERAGE_READ_GATEWAY_CAPABILITY,
    )).toBe(true);
    expect(
      buildHelixAccountCapabilityPolicy("user").allowed_workstation_capabilities,
    ).not.toContain(HELIX_BROKERAGE_READ_GATEWAY_CAPABILITY);
    const user = listAccountAuthorizedWorkstationGatewayCapabilities({
      accountContext: accountContext("user"),
      requestedMode: "read",
      requestedRuntime: "codex",
    });
    expect(user.capabilities.some(
      (entry) => entry.capability_id === HELIX_BROKERAGE_READ_GATEWAY_CAPABILITY,
    )).toBe(false);
    expect(user.locked_capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability_id: HELIX_BROKERAGE_READ_GATEWAY_CAPABILITY,
      }),
    ]));
  });

  it("derives owner and room identity from trusted server context", async () => {
    const executeRead = vi.fn(async () => observation);
    const result = await executeBrokerageReadGatewayCapability({
      arguments: {
        connection_id: CONNECTION_ID,
        upstream_tool: "get_equity_quotes",
        upstream_arguments: { symbols: ["TEST"] },
        profile_id: "profile:attacker",
        room_id: "shared_realtime_room:other",
      },
      accountContext: accountContext(),
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: deps(executeRead),
    });
    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      sourceBindingId: SOURCE_BINDING_ID,
      executedArgs: {
        source_binding_id: SOURCE_BINDING_ID,
        connection_id: CONNECTION_ID,
      },
      observation: {
        observation_id: observation.observation_id,
        producer_epoch_ref: observation.producer_epoch_ref,
        credential_included: false,
        account_numbers_included: false,
        raw_provider_payload_included: false,
        answer_authority: false,
        terminal_eligible: false,
      },
    });
    expect(executeRead).toHaveBeenCalledWith({
      ownerProfileId: PROFILE_ID,
      connectionId: CONNECTION_ID,
      roomId: ROOM_ID,
      toolName: "get_equity_quotes",
      arguments: { symbols: ["TEST"] },
    });
  });

  it("blocks untrusted, non-room, and non-developer contexts before provider access", async () => {
    for (const input of [
      { accountContext: null, conversationThreadId: `helix-ask:room:${ROOM_ID}` },
      { accountContext: accountContext(), conversationThreadId: "helix-ask:personal" },
      { accountContext: accountContext("user"), conversationThreadId: `helix-ask:room:${ROOM_ID}` },
    ]) {
      const executeRead = vi.fn();
      const result = await executeBrokerageReadGatewayCapability({
        arguments: {
          connection_id: CONNECTION_ID,
          upstream_tool: "get_portfolio",
        },
        ...input,
        dependencies: deps(executeRead),
      });
      expect(result).toMatchObject({
        ok: false,
        status: "blocked",
        error: "brokerage_auth_required",
        observation: {
          answer_authority: false,
          assistant_answer: false,
          terminal_eligible: false,
        },
      });
      expect(executeRead).not.toHaveBeenCalled();
    }
  });

  it("rejects mutation tools and malformed argument envelopes before provider access", async () => {
    for (const args of [
      {
        connection_id: CONNECTION_ID,
        upstream_tool: "place_equity_order",
        upstream_arguments: {},
      },
      {
        connection_id: CONNECTION_ID,
        upstream_tool: "review_equity_order",
        upstream_arguments: {},
      },
      {
        connection_id: CONNECTION_ID,
        upstream_tool: "cancel_equity_order",
        upstream_arguments: {},
      },
      {
        connection_id: CONNECTION_ID,
        upstream_tool: "get_accounts",
        upstream_arguments: {},
      },
      {
        connection_id: CONNECTION_ID,
        upstream_tool: "get_equity_quotes",
        upstream_arguments: ["TEST"],
      },
      {
        connection_id: "invalid connection id",
        upstream_tool: "get_portfolio",
      },
    ]) {
      const executeRead = vi.fn();
      const result = await executeBrokerageReadGatewayCapability({
        arguments: args,
        accountContext: accountContext(),
        conversationThreadId: `helix-ask:room:${ROOM_ID}`,
        dependencies: deps(executeRead),
      });
      expect(result).toMatchObject({
        ok: false,
        status: "blocked",
        error: "brokerage_capability_denied",
      });
      expect(executeRead).not.toHaveBeenCalled();
    }
  });

  it("rejects wrong-connection, revoked, and privacy-invalidated bindings before provider access", async () => {
    const cases = [
      {
        requestedConnectionId: "brokerage_connection:wrong",
        bindingStatus: "active",
        privacyState: "owner_private",
      },
      {
        requestedConnectionId: CONNECTION_ID,
        bindingStatus: "revoked",
        privacyState: "owner_private",
      },
      {
        requestedConnectionId: CONNECTION_ID,
        bindingStatus: "suspended",
        privacyState: "privacy_invalidated",
      },
    ] as const;
    for (const item of cases) {
      const executeRead = vi.fn();
      const result = await executeBrokerageReadGatewayCapability({
        arguments: {
          connection_id: item.requestedConnectionId,
          upstream_tool: "get_equity_quotes",
          upstream_arguments: { symbols: ["TEST"] },
        },
        accountContext: accountContext(),
        conversationThreadId: `helix-ask:room:${ROOM_ID}`,
        dependencies: {
          ...deps(executeRead),
          listBindings: vi.fn(async () => ({
            bindings: [{
              binding_id: SOURCE_BINDING_ID,
              connection_id: CONNECTION_ID,
              status: item.bindingStatus,
              privacy_state: item.privacyState,
            }],
          }) as never),
        },
      });
      expect(result).toMatchObject({
        ok: false,
        status: "blocked",
        error: "brokerage_connection_not_ready",
      });
      expect(executeRead).not.toHaveBeenCalled();
    }
  });

  it("rejects stale, future, cross-room, and cross-epoch observations before re-entry", async () => {
    const cases: Array<{
      observed: HelixBrokerageObservation;
      now: string;
      epochs: string[];
      error: string;
    }> = [
      {
        observed: { ...observation, observed_at: "2026-08-23T11:59:00.000Z" },
        now: "2026-08-23T12:00:00.000Z",
        epochs: [observation.producer_epoch_ref, observation.producer_epoch_ref],
        error: "brokerage_observation_stale",
      },
      {
        observed: { ...observation, observed_at: "2026-08-23T12:00:06.000Z" },
        now: "2026-08-23T12:00:00.000Z",
        epochs: [observation.producer_epoch_ref, observation.producer_epoch_ref],
        error: "brokerage_observation_stale",
      },
      {
        observed: {
          ...observation,
          room_id: "shared_realtime_room:poisoned",
        },
        now: observation.observed_at,
        epochs: [observation.producer_epoch_ref, observation.producer_epoch_ref],
        error: "brokerage_observation_identity_mismatch",
      },
      {
        observed: {
          ...observation,
          connection_id: "brokerage_connection:poisoned",
        },
        now: observation.observed_at,
        epochs: [observation.producer_epoch_ref, observation.producer_epoch_ref],
        error: "brokerage_observation_identity_mismatch",
      },
      {
        observed: {
          ...observation,
          upstream_tool: "get_portfolio",
          capability_id: "brokerage.robinhood.portfolio.read",
        },
        now: observation.observed_at,
        epochs: [observation.producer_epoch_ref, observation.producer_epoch_ref],
        error: "brokerage_observation_identity_mismatch",
      },
      {
        observed: observation,
        now: observation.observed_at,
        epochs: [observation.producer_epoch_ref, "brokerage_producer_epoch:rotated"],
        error: "brokerage_observation_identity_mismatch",
      },
    ];

    for (const item of cases) {
      const executeRead = vi.fn(async () => item.observed);
      const assertReadCapability = vi.fn()
        .mockResolvedValueOnce({ producerEpochRef: item.epochs[0] })
        .mockResolvedValueOnce({ producerEpochRef: item.epochs[1] });
      const result = await executeBrokerageReadGatewayCapability({
        arguments: {
          connection_id: CONNECTION_ID,
          upstream_tool: "get_equity_quotes",
          upstream_arguments: { symbols: ["TEST"] },
        },
        accountContext: accountContext(),
        conversationThreadId: `helix-ask:room:${ROOM_ID}`,
        dependencies: {
          executeRead,
          assertReadCapability,
          listBindings: vi.fn(async () => ({
            bindings: [{
              connection_id: CONNECTION_ID,
              status: "active",
              privacy_state: "owner_private",
            }],
          }) as never),
          now: () => new Date(item.now),
        },
      });
      expect(result).toMatchObject({
        ok: false,
        status: "failed",
        error: item.error,
        observation: {
          answer_authority: false,
          terminal_eligible: false,
        },
      });
    }
  });

  it("resolves the only active private-room connection when natural prompts omit its ID", async () => {
    const executeRead = vi.fn(async () => observation);
    const result = await executeBrokerageReadGatewayCapability({
      arguments: {
        upstream_tool: "get_equity_quotes",
        upstream_arguments: { symbols: ["TEST"] },
      },
      accountContext: accountContext(),
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: deps(executeRead),
    });
    expect(result.ok).toBe(true);
    expect(executeRead).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: CONNECTION_ID,
      roomId: ROOM_ID,
      ownerProfileId: PROFILE_ID,
    }));
  });
});
