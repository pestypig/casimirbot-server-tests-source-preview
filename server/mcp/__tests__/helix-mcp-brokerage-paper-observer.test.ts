import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { buildHelixSharedRealtimeRoomsExperimentPolicy } from
  "@shared/helix-account-session";
import { HELIX_SHARED_LIVE_ROOM_READ_SCOPE } from
  "@shared/contracts/helix-shared-live-room-agent.v1";
import { HELIX_ENVIRONMENT_ACTION_READ_SCOPE } from
  "@shared/helix-environment-action";
import {
  HELIX_BROKERAGE_MARKET_OBSERVER_PROCESS_SCOPE,
  type HelixBrokerageMarketObserverReceipt,
} from "@shared/trading/brokerage-market-observer";
import type { HelixAgentApiService } from
  "../../services/helix-agent-api/service";
import type { HelixAgentApiPrincipal } from
  "../../services/helix-agent-api/types";
import { createHelixMcpServer } from "../helix-mcp-server";

const ROOM_ID = "shared_realtime_room:g8-brokerage-observer";
const PROFILE_ID = "profile:g8-brokerage-observer";
const CONNECTION_ID = "brokerage_connection:g8-brokerage-observer";
const PAPER_ACCOUNT_ID = "paper_account:g8-brokerage-observer";
const MONITOR_ID = "environment_monitor:g8-brokerage-observer";
const CONTINUATION_REF = "continuation:g8-brokerage-observer";
const OBSERVATION_ID = "brokerage_observation:g8-brokerage-observer";
const HASH = `sha256:${"a".repeat(64)}`;

const principal = (scopes: Set<string>): HelixAgentApiPrincipal => {
  const policy = buildHelixSharedRealtimeRoomsExperimentPolicy("developer");
  const now = "2026-08-27T14:00:00.000Z";
  return {
    tenantId: "tenant:g8-brokerage-observer",
    issuer: "https://issuer.example",
    subjectId: "subject:g8-brokerage-observer",
    accountProfileId: PROFILE_ID,
    accountType: "developer",
    scopes,
    oauthClientRef: "mcp_client:g8-brokerage-observer",
    tokenExpiresAt: "2099-01-01T00:00:00.000Z",
    accountContext: {
      session_id: "external-oauth:g8-brokerage-observer",
      profile_id: PROFILE_ID,
      trusted_account_session: true,
      account_session: {
        schema: "helix.account_session.v1",
        session_id: "external-oauth:g8-brokerage-observer",
        profile: {
          profile_id: PROFILE_ID,
          display_name: "G8 brokerage observer",
          email: null,
          auth_mode: "web_auth",
          account_type: "developer",
          provider: "external_oauth",
          provider_alias: "test",
          provider_subject: "subject:g8-brokerage-observer",
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

const receipt: HelixBrokerageMarketObserverReceipt = {
  schema: "helix.brokerage_market_observer.v1",
  ok: true,
  observer_cycle_id: "brokerage_observer_cycle:g8-brokerage-observer",
  profile_id: "resident.brokerage.market_observer.v1",
  profile_artifact_hash: HASH,
  reaction_requirement: "monitor_only",
  monitor_lease_id: MONITOR_ID,
  owner_profile_id: PROFILE_ID,
  connection_id: CONNECTION_ID,
  room_id: ROOM_ID,
  environment_binding_id: "brokerage_room_binding:g8-brokerage-observer",
  paper_account_id: PAPER_ACCOUNT_ID,
  producer_epoch_ref: "brokerage_epoch:g8-brokerage-observer",
  source_observation_id: OBSERVATION_ID,
  source_output_hash: HASH,
  source_observed_at: "2026-08-27T14:00:00.000Z",
  observation_revision: Date.parse("2026-08-27T14:00:00.000Z"),
  symbol: "TEST",
  event_types: [],
  disposition: "no_material_paper_change",
  semantic_wake_eligible: false,
  paper_receipt: {
    schema: "helix.paper_trading.v1",
    ok: true,
    account_id: PAPER_ACCOUNT_ID,
    observation_id: OBSERVATION_ID,
    symbol: "TEST",
    filled_order_ids: [],
    marked_position_ids: [],
    stop_exit_order_ids: [],
    simulated: true,
    live_order_execution_enabled: false,
    answer_authority: false,
  },
  kill_switch_active_before: false,
  kill_switch_active_after: false,
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

const admittedScopes = new Set<string>([
  HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
  HELIX_ENVIRONMENT_ACTION_READ_SCOPE,
  HELIX_BROKERAGE_MARKET_OBSERVER_PROCESS_SCOPE,
]);

const connect = async (scopes = admittedScopes) => {
  const runner = vi.fn().mockResolvedValue(receipt);
  const semanticSource = {
    deliver: vi.fn().mockResolvedValue({
      lease: { monitor_id: MONITOR_ID },
      delivery: null,
      duplicate_evidence_refs: [],
    }),
  };
  const server = createHelixMcpServer({
    principal: principal(scopes),
    service: {} as HelixAgentApiService,
    brokerageMarketObserverRunner: runner,
    brokerageMarketObserverSemanticSource: semanticSource as never,
  });
  const client = new Client(
    { name: "g8-brokerage-observer-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, runner, semanticSource };
};

const argumentsValue = {
  room_id: ROOM_ID,
  connection_id: CONNECTION_ID,
  paper_account_id: PAPER_ACCOUNT_ID,
  monitor_id: MONITOR_ID,
  client_continuation_ref: CONTINUATION_REF,
  observation_id: OBSERVATION_ID,
  symbol: "test",
};

describe("Helix MCP G8 brokerage paper observer", () => {
  it("admits one paper-only cycle under its separate processing scope", async () => {
    const connection = await connect();
    try {
      const catalog = await connection.client.listTools();
      const tool = catalog.tools.find(
        (entry) => entry.name === "helix_brokerage_paper_observer_process",
      );
      expect(tool).toMatchObject({
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
        },
      });
      expect(JSON.stringify(tool)).not.toContain("place_equity_order");

      const result = await connection.client.callTool({
        name: "helix_brokerage_paper_observer_process",
        arguments: argumentsValue,
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        operation: "brokerage.paper_observer.process",
        room_id: ROOM_ID,
        receipt: {
          disposition: "no_material_paper_change",
          simulated: true,
          provider_mutation_attempted: false,
          live_order_execution_enabled: false,
        },
        monitor_projection: { disposition: "no_material_change" },
        credential_included: false,
        provider_mutation_attempted: false,
        live_order_execution_enabled: false,
        answer_authority: false,
        terminal_eligible: false,
      });
      expect(connection.runner).toHaveBeenCalledWith({
        ownerProfileId: PROFILE_ID,
        connectionId: CONNECTION_ID,
        roomId: ROOM_ID,
        paperAccountId: PAPER_ACCOUNT_ID,
        monitorLeaseId: MONITOR_ID,
        observationId: OBSERVATION_ID,
        symbol: "TEST",
      });
      expect(connection.semanticSource.deliver).toHaveBeenCalledWith({
        profileId: PROFILE_ID,
        mcpClientId: "mcp_client:g8-brokerage-observer",
        clientContinuationRef: CONTINUATION_REF,
        receipt,
      });
    } finally {
      await connection.client.close();
      await connection.server.close();
    }
  });

  it("denies paper processing when the dedicated scope is absent", async () => {
    const connection = await connect(new Set([
      HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
      HELIX_ENVIRONMENT_ACTION_READ_SCOPE,
    ]));
    try {
      const result = await connection.client.callTool({
        name: "helix_brokerage_paper_observer_process",
        arguments: argumentsValue,
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain("insufficient_scope");
      expect(JSON.stringify(result)).toContain(
        HELIX_BROKERAGE_MARKET_OBSERVER_PROCESS_SCOPE,
      );
      expect(connection.runner).not.toHaveBeenCalled();
      expect(connection.semanticSource.deliver).not.toHaveBeenCalled();
    } finally {
      await connection.client.close();
      await connection.server.close();
    }
  });
});
