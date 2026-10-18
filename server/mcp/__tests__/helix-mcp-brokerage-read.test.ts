import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { buildHelixSharedRealtimeRoomsExperimentPolicy } from "@shared/helix-account-session";
import {
  HELIX_SHARED_LIVE_ROOM_MANAGE_SCOPE,
  HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
} from "@shared/contracts/helix-shared-live-room-agent.v1";
import { HELIX_ENVIRONMENT_ACTION_READ_SCOPE } from "@shared/helix-environment-action";
import {
  HELIX_BROKERAGE_OBSERVATION_SCHEMA,
  HELIX_ROBINHOOD_READ_CAPABILITY_IDS,
  type HelixBrokerageRoomBinding,
  type HelixBrokerageObservation,
} from "@shared/helix-brokerage-environment";
import { createHelixMcpServer } from "../helix-mcp-server";
import type { HelixAgentApiService } from "../../services/helix-agent-api/service";
import type { HelixAgentApiPrincipal } from "../../services/helix-agent-api/types";

const ROOM_ID = "shared_realtime_room:g7-mcp";
const PROFILE_ID = "profile:g7-mcp";
const CONNECTION_ID = "brokerage_connection:g7-mcp";
const SOURCE_BINDING_ID = "brokerage_room_binding:g7-mcp";

const principal = (scopes = new Set<string>([
  HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
  HELIX_ENVIRONMENT_ACTION_READ_SCOPE,
])): HelixAgentApiPrincipal => {
  const policy = buildHelixSharedRealtimeRoomsExperimentPolicy("developer");
  const now = "2026-08-23T12:00:00.000Z";
  return {
    tenantId: "tenant:g7-mcp",
    issuer: "https://issuer.example",
    subjectId: "subject:g7-mcp",
    accountProfileId: PROFILE_ID,
    accountType: "developer",
    scopes,
    tokenExpiresAt: "2099-01-01T00:00:00.000Z",
    accountContext: {
      session_id: "external-oauth:g7-mcp",
      profile_id: PROFILE_ID,
      trusted_account_session: true,
      account_session: {
        schema: "helix.account_session.v1",
        session_id: "external-oauth:g7-mcp",
        profile: {
          profile_id: PROFILE_ID,
          display_name: "G7 MCP",
          email: null,
          auth_mode: "web_auth",
          account_type: "developer",
          provider: "external_oauth",
          provider_alias: "test",
          provider_subject: "subject:g7-mcp",
          picture_url: null,
          created_at: now,
          updated_at: now,
        },
        account_policy: policy,
        status: "active",
        memory_scope: "profile",
        created_at: now,
        updated_at: now,
        expires_at: "2099-01-01T00:00:00.000Z",
      },
      account_policy: policy,
    },
  };
};

const observation: HelixBrokerageObservation = {
  schema: HELIX_BROKERAGE_OBSERVATION_SCHEMA,
  ok: true,
  observation_id: "brokerage_observation:g7-mcp",
  connection_id: CONNECTION_ID,
  room_id: ROOM_ID,
  provider: "robinhood",
  environment_domain: "brokerage",
  upstream_tool: "get_equity_quotes",
  capability_id: "brokerage.robinhood.market_data.read",
  producer_epoch_ref: "brokerage_producer_epoch:g7-mcp",
  observed_at: "2026-08-23T12:00:00.000Z",
  freshness_state: "fresh",
  data: { results: [{ symbol: "TEST", bid: "10.00", ask: "10.01" }] },
  input_hash: `sha256:${"a".repeat(64)}`,
  output_hash: `sha256:${"b".repeat(64)}`,
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

const roomBinding: HelixBrokerageRoomBinding = {
  schema: "helix.brokerage_room_binding.v1",
  binding_id: SOURCE_BINDING_ID,
  connection_id: CONNECTION_ID,
  room_id: ROOM_ID,
  provider: "robinhood",
  environment_domain: "brokerage",
  status: "active",
  privacy_state: "owner_private",
  capability_ids: [...HELIX_ROBINHOOD_READ_CAPABILITY_IDS],
  read_only: true,
  credential_included: false,
  account_numbers_included: false,
  raw_provider_payload_included: false,
  upstream_tool_execution_enabled: false,
  live_order_execution_enabled: false,
  created_at: "2026-08-23T12:00:00.000Z",
  updated_at: "2026-08-23T12:00:00.000Z",
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
};

const connect = async (scopes?: Set<string>) => {
  const brokerageReadExecutor = vi.fn(async () => ({
    ok: true,
    status: "completed" as const,
    summary: "Fresh private-room quote evidence returned.",
    observation,
    sourceBindingId: SOURCE_BINDING_ID,
  }));
  const brokerageRoomBinder = vi.fn(async () => roomBinding);
  const brokerageReadAcceptanceRunner = vi.fn(async () => ({
    schema: "helix.robinhood_read_acceptance.v1" as const,
    ok: true as const,
    connection_id: CONNECTION_ID,
    room_id: ROOM_ID,
    quote_probe_symbol: "TEST",
    account_selection_status: "agentic_selected" as const,
    receipts: [
      "get_portfolio",
      "get_realized_pnl",
      "get_equity_positions",
      "get_equity_quotes",
      "get_equity_orders",
    ].map((upstream_tool, index) => ({
      upstream_tool: upstream_tool as any,
      observation_id: `brokerage_observation:acceptance-${index}`,
      output_hash: `sha256:${String(index + 1).repeat(64)}`,
      observed_at: "2026-08-23T12:00:00.000Z",
    })),
    provider_order_tool_calls_made: 0 as const,
    live_order_execution_enabled: false as const,
    credential_included: false as const,
    account_numbers_included: false as const,
    raw_provider_payload_included: false as const,
  }));
  const brokerageLiveAcceptanceReadinessReader = vi.fn(async () => ({
    schema: "helix.live_acceptance_readiness.v1" as const,
    ok: true as const,
    connection_id: CONNECTION_ID,
    room_id: ROOM_ID,
    generated_at: "2026-08-23T12:00:00.000Z",
    read_acceptance_complete: true,
    safe_to_enable_live_flags: true,
    ready_to_start_attended_canary: false,
    ready_to_arm: false,
    acceptance_complete: false,
    gates: [
      "agentic_account_selected",
      "owner_private_room_binding",
      "required_read_receipts_fresh",
      "provider_contract_fresh_pass",
      "live_deployment_pair_enabled",
      "supervisor_and_exit_plane_fresh",
      "no_operator_attention",
      "operator_presence_fresh",
      "tiny_entry_reconciled_filled",
      "risk_reducing_exit_reconciled_filled",
      "no_unresolved_live_exposure",
    ].map((gate_id, index) => ({
      gate_id: gate_id as any,
      verdict: index < 4 || index === 6 || index === 10
        ? "pass" as const : "pending" as const,
      reason_code: index < 4 || index === 6 || index === 10
        ? "fixture_pass" : "fixture_pending",
      message: "Sanitized readiness fixture.",
      evidence_hashes: [],
      observed_at: null,
    })),
    required_read_tools: [
      "get_portfolio",
      "get_realized_pnl",
      "get_equity_positions",
      "get_equity_quotes",
      "get_equity_orders",
    ] as const,
    fresh_read_tools: [
      "get_portfolio",
      "get_realized_pnl",
      "get_equity_positions",
      "get_equity_quotes",
      "get_equity_orders",
    ],
    live_entry_count: 0,
    reconciled_filled_entry_count: 0,
    reconciled_filled_exit_count: 0,
    unresolved_live_exposure_count: 0,
    credential_included: false as const,
    account_numbers_included: false as const,
    raw_provider_payload_included: false as const,
    live_order_tool_calls_made: 0 as const,
    answer_authority: false as const,
    assistant_answer: false as const,
    terminal_eligible: false as const,
  }));
  const server = createHelixMcpServer({
    principal: principal(scopes),
    service: {} as HelixAgentApiService,
    brokerageReadExecutor,
    brokerageRoomBinder,
    brokerageReadAcceptanceRunner,
    brokerageLiveAcceptanceReadinessReader,
  });
  const client = new Client(
    { name: "g7-brokerage-mcp-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    server,
    brokerageReadExecutor,
    brokerageRoomBinder,
    brokerageReadAcceptanceRunner,
    brokerageLiveAcceptanceReadinessReader,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
};

describe("Helix MCP G7 brokerage read transfer", () => {
  it("exposes a read-only MCP tool and preserves the normalized observation", async () => {
    const connection = await connect();
    try {
      const catalog = await connection.client.listTools();
      const tool = catalog.tools.find(
        (entry) => entry.name === "helix_brokerage_robinhood_read",
      );
      expect(tool).toMatchObject({
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
        },
      });
      expect(JSON.stringify(tool)).not.toContain("place_equity_order");
      expect(JSON.stringify(tool)).not.toContain("get_accounts");

      const result = await connection.client.callTool({
        name: "helix_brokerage_robinhood_read",
        arguments: {
          room_id: ROOM_ID,
          connection_id: CONNECTION_ID,
          upstream_tool: "get_equity_quotes",
          upstream_arguments: { symbols: ["TEST"] },
        },
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        operation: "brokerage.robinhood.read",
        room_id: ROOM_ID,
        source_binding_id: SOURCE_BINDING_ID,
        ok: true,
        observation: {
          observation_id: observation.observation_id,
          producer_epoch_ref: observation.producer_epoch_ref,
          credential_included: false,
          account_numbers_included: false,
          raw_provider_payload_included: false,
          answer_authority: false,
          terminal_eligible: false,
        },
        answer_authority: false,
        terminal_eligible: false,
      });
      expect(connection.brokerageReadExecutor).toHaveBeenCalledWith({
        arguments: {
          connection_id: CONNECTION_ID,
          upstream_tool: "get_equity_quotes",
          upstream_arguments: { symbols: ["TEST"] },
        },
        accountContext: expect.objectContaining({ profile_id: PROFILE_ID }),
        conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      });
    } finally {
      await connection.close();
    }
  });

  it("requires both room-read and environment-read OAuth scopes", async () => {
    const connection = await connect(new Set([HELIX_SHARED_LIVE_ROOM_READ_SCOPE]));
    try {
      const result = await connection.client.callTool({
        name: "helix_brokerage_robinhood_read",
        arguments: {
          room_id: ROOM_ID,
          connection_id: CONNECTION_ID,
          upstream_tool: "get_portfolio",
        },
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain("insufficient_scope");
      expect(JSON.stringify(result)).toContain(HELIX_ENVIRONMENT_ACTION_READ_SCOPE);
      expect(connection.brokerageReadExecutor).not.toHaveBeenCalled();
    } finally {
      await connection.close();
    }
  });

  it("exposes the fixed server-side read acceptance without account identity", async () => {
    const connection = await connect();
    try {
      const catalog = await connection.client.listTools();
      const tool = catalog.tools.find(
        (entry) => entry.name ===
          "helix_brokerage_robinhood_read_acceptance",
      );
      expect(tool).toMatchObject({
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: true,
        },
      });
      expect(JSON.stringify(tool?.inputSchema)).not.toContain("account_number");
      expect(JSON.stringify(tool)).not.toContain("place_equity_order");

      const result = await connection.client.callTool({
        name: "helix_brokerage_robinhood_read_acceptance",
        arguments: {
          room_id: ROOM_ID,
          connection_id: CONNECTION_ID,
          quote_probe_symbol: "TEST",
        },
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        operation: "brokerage.robinhood.read_acceptance",
        receipt: {
          ok: true,
          account_selection_status: "agentic_selected",
          provider_order_tool_calls_made: 0,
          live_order_execution_enabled: false,
          credential_included: false,
          account_numbers_included: false,
          raw_provider_payload_included: false,
          receipts: expect.any(Array),
        },
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
      });
      expect(connection.brokerageReadAcceptanceRunner).toHaveBeenCalledWith({
        ownerProfileId: PROFILE_ID,
        connectionId: CONNECTION_ID,
        roomId: ROOM_ID,
        quoteProbeSymbol: "TEST",
      });
      expect(JSON.stringify(result)).not.toContain("vault-only-agentic-account");
    } finally {
      await connection.close();
    }
  });

  it("projects attended-live readiness without adding trading authority", async () => {
    const connection = await connect();
    try {
      const catalog = await connection.client.listTools();
      const tool = catalog.tools.find((entry) => entry.name ===
        "helix_brokerage_live_acceptance_readiness");
      expect(tool).toMatchObject({
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      });
      expect(JSON.stringify(tool)).not.toContain("place_equity_order");
      expect(JSON.stringify(tool?.inputSchema)).not.toContain("account_number");

      const result = await connection.client.callTool({
        name: "helix_brokerage_live_acceptance_readiness",
        arguments: { room_id: ROOM_ID, connection_id: CONNECTION_ID },
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        operation: "brokerage.robinhood.live_acceptance_readiness",
        readiness: {
          read_acceptance_complete: true,
          safe_to_enable_live_flags: true,
          ready_to_start_attended_canary: false,
          ready_to_arm: false,
          acceptance_complete: false,
          live_order_tool_calls_made: 0,
          credential_included: false,
          account_numbers_included: false,
          raw_provider_payload_included: false,
        },
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
      });
      expect(connection.brokerageLiveAcceptanceReadinessReader)
        .toHaveBeenCalledWith({
          ownerProfileId: PROFILE_ID,
          connectionId: CONNECTION_ID,
          roomId: ROOM_ID,
        });
    } finally {
      await connection.close();
    }
  });

  it("fails readiness inspection closed without environment-read scope", async () => {
    const connection = await connect(new Set([
      HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
    ]));
    try {
      const result = await connection.client.callTool({
        name: "helix_brokerage_live_acceptance_readiness",
        arguments: { room_id: ROOM_ID, connection_id: CONNECTION_ID },
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain("insufficient_scope");
      expect(JSON.stringify(result)).toContain(
        HELIX_ENVIRONMENT_ACTION_READ_SCOPE,
      );
      expect(connection.brokerageLiveAcceptanceReadinessReader)
        .not.toHaveBeenCalled();
    } finally {
      await connection.close();
    }
  });

  it("idempotently binds only reviewed Robinhood read capabilities to an owned private room", async () => {
    const connection = await connect(new Set([
      HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
      HELIX_SHARED_LIVE_ROOM_MANAGE_SCOPE,
      HELIX_ENVIRONMENT_ACTION_READ_SCOPE,
    ]));
    try {
      const catalog = await connection.client.listTools();
      const tool = catalog.tools.find(
        (entry) => entry.name === "helix_brokerage_robinhood_room_bind",
      );
      expect(tool).toMatchObject({
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      });
      expect(JSON.stringify(tool)).not.toContain("place_equity_order");

      const result = await connection.client.callTool({
        name: "helix_brokerage_robinhood_room_bind",
        arguments: {
          room_id: ROOM_ID,
          connection_id: CONNECTION_ID,
          capability_ids: [...HELIX_ROBINHOOD_READ_CAPABILITY_IDS],
        },
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        operation: "brokerage.robinhood.room_bind",
        binding: {
          binding_id: SOURCE_BINDING_ID,
          status: "active",
          privacy_state: "owner_private",
          upstream_tool_execution_enabled: false,
          live_order_execution_enabled: false,
        },
        credential_included: false,
        provider_mutation_attempted: false,
        live_order_execution_enabled: false,
        answer_authority: false,
        terminal_eligible: false,
      });
      expect(connection.brokerageRoomBinder).toHaveBeenCalledWith({
        ownerProfileId: PROFILE_ID,
        connectionId: CONNECTION_ID,
        roomId: ROOM_ID,
        capabilityIds: [...HELIX_ROBINHOOD_READ_CAPABILITY_IDS],
      });
    } finally {
      await connection.close();
    }
  });

  it("fails the room bind before storage when room-manage is absent", async () => {
    const connection = await connect(new Set([
      HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
      HELIX_ENVIRONMENT_ACTION_READ_SCOPE,
    ]));
    try {
      const result = await connection.client.callTool({
        name: "helix_brokerage_robinhood_room_bind",
        arguments: {
          room_id: ROOM_ID,
          connection_id: CONNECTION_ID,
        },
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain("insufficient_scope");
      expect(JSON.stringify(result)).toContain(HELIX_SHARED_LIVE_ROOM_MANAGE_SCOPE);
      expect(connection.brokerageRoomBinder).not.toHaveBeenCalled();
    } finally {
      await connection.close();
    }
  });
});
