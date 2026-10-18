import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { buildHelixSharedRealtimeRoomsExperimentPolicy } from
  "@shared/helix-account-session";
import { HELIX_AGENT_RUN_WRITE_SCOPE } from
  "@shared/contracts/helix-agent-api.v1";
import {
  HELIX_SHARED_LIVE_ROOM_MANAGE_SCOPE,
  HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
} from "@shared/contracts/helix-shared-live-room-agent.v1";
import { HELIX_ENVIRONMENT_ACTION_READ_SCOPE } from
  "@shared/helix-environment-action";
import { HELIX_BROKERAGE_MARKET_OBSERVER_PROCESS_SCOPE } from
  "@shared/trading/brokerage-market-observer";
import type { HelixAgentApiService } from
  "../../services/helix-agent-api/service";
import type { HelixAgentApiPrincipal } from
  "../../services/helix-agent-api/types";
import type { SharedLiveRoomControlService } from
  "../../services/shared-live-room-control/service";
import { createHelixMcpServer } from "../helix-mcp-server";

const ROOM_ID = "shared_realtime_room:g8-brokerage-bootstrap";
const PARTICIPANT_ID = "shared_realtime_participant:g8-brokerage-bootstrap";
const PROFILE_ID = "profile:g8-brokerage-bootstrap";
const CONNECTION_ID = "brokerage_connection:g8-brokerage-bootstrap";
const RUN_ID = "agent_run:g8-brokerage-bootstrap";
const TURN_ID = "codex_turn:g8-brokerage-bootstrap";

const principal = (scopes: Set<string>): HelixAgentApiPrincipal => {
  const policy = buildHelixSharedRealtimeRoomsExperimentPolicy("developer");
  const now = "2026-08-27T14:00:00.000Z";
  return {
    tenantId: "tenant:g8-brokerage-bootstrap",
    issuer: "https://issuer.example",
    subjectId: "subject:g8-brokerage-bootstrap",
    accountProfileId: PROFILE_ID,
    accountType: "developer",
    scopes,
    oauthClientRef: "mcp_client:g8-brokerage-bootstrap",
    tokenExpiresAt: "2099-01-01T00:00:00.000Z",
    accountContext: {
      session_id: "external-oauth:g8-brokerage-bootstrap",
      profile_id: PROFILE_ID,
      trusted_account_session: true,
      account_session: {
        schema: "helix.account_session.v1",
        session_id: "external-oauth:g8-brokerage-bootstrap",
        profile: {
          profile_id: PROFILE_ID,
          display_name: "G8 brokerage bootstrap",
          email: null,
          auth_mode: "web_auth",
          account_type: "developer",
          provider: "external_oauth",
          provider_alias: "test",
          provider_subject: "subject:g8-brokerage-bootstrap",
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

const admittedScopes = new Set<string>([
  HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
  HELIX_SHARED_LIVE_ROOM_MANAGE_SCOPE,
  HELIX_ENVIRONMENT_ACTION_READ_SCOPE,
  HELIX_AGENT_RUN_WRITE_SCOPE,
  HELIX_BROKERAGE_MARKET_OBSERVER_PROCESS_SCOPE,
]);

const connect = async (scopes = admittedScopes) => {
  const bootstrapper = vi.fn().mockResolvedValue({
    idempotencyReplayed: false,
    paperAccount: {
      schema: "helix.trading_risk.v1",
      account_id: "paper_account:g8-brokerage-bootstrap",
      room_id: ROOM_ID,
      simulated: true,
      live_order_execution_enabled: false,
      credential_included: false,
      account_numbers_included: false,
      answer_authority: false,
    },
    goal: {
      schema: "helix.environment_durable_goal_projection.v1",
      goal_id: "environment_durable_goal:g8-brokerage-bootstrap",
      objective: {
        domain: "brokerage",
        controller_profile_id: "resident.brokerage.market_observer.v1",
      },
      answer_authority: false,
      terminal_eligible: false,
    },
  });
  const server = createHelixMcpServer({
    principal: principal(scopes),
    service: {} as HelixAgentApiService,
    roomControlService: {
      inspectRoom: vi.fn(async () => ({
        room: { self_participant_id: PARTICIPANT_ID },
      })),
    } as unknown as SharedLiveRoomControlService,
    brokerageResidentBootstrapper: bootstrapper,
  });
  const client = new Client(
    { name: "g8-brokerage-bootstrap-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, bootstrapper };
};

const argumentsValue = {
  room_id: ROOM_ID,
  connection_id: CONNECTION_ID,
  run_id: RUN_ID,
  turn_id: TURN_ID,
  starting_equity_cents: 20_000,
};

describe("Helix MCP G8 brokerage resident bootstrap", () => {
  it("bootstraps only local paper and durable monitor identity", async () => {
    const connection = await connect();
    try {
      const catalog = await connection.client.listTools();
      const tool = catalog.tools.find((entry) =>
        entry.name === "helix_brokerage_resident_observer_bootstrap");
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
        name: "helix_brokerage_resident_observer_bootstrap",
        arguments: argumentsValue,
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        operation: "brokerage.resident_observer.bootstrap",
        room_id: ROOM_ID,
        idempotency_replayed: false,
        paper_account: {
          account_id: "paper_account:g8-brokerage-bootstrap",
          live_order_execution_enabled: false,
        },
        goal: {
          objective: {
            domain: "brokerage",
            controller_profile_id: "resident.brokerage.market_observer.v1",
          },
        },
        credential_included: false,
        provider_mutation_attempted: false,
        live_order_execution_enabled: false,
        answer_authority: false,
        terminal_eligible: false,
      });
      expect(connection.bootstrapper).toHaveBeenCalledWith({
        ownerProfileId: PROFILE_ID,
        roomId: ROOM_ID,
        participantId: PARTICIPANT_ID,
        connectionId: CONNECTION_ID,
        runId: RUN_ID,
        turnId: TURN_ID,
        startingEquityCents: 20_000,
      });
    } finally {
      await connection.client.close();
      await connection.server.close();
    }
  });

  it("fails before bootstrap when room management is absent", async () => {
    const scopes = new Set(admittedScopes);
    scopes.delete(HELIX_SHARED_LIVE_ROOM_MANAGE_SCOPE);
    const connection = await connect(scopes);
    try {
      const result = await connection.client.callTool({
        name: "helix_brokerage_resident_observer_bootstrap",
        arguments: argumentsValue,
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain("insufficient_scope");
      expect(JSON.stringify(result)).toContain(
        HELIX_SHARED_LIVE_ROOM_MANAGE_SCOPE,
      );
      expect(connection.bootstrapper).not.toHaveBeenCalled();
    } finally {
      await connection.client.close();
      await connection.server.close();
    }
  });
});
