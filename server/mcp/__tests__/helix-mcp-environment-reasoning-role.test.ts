import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { buildHelixSharedRealtimeRoomsExperimentPolicy } from "@shared/helix-account-session";
import {
  HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
  HELIX_SHARED_LIVE_ROOM_SOURCE_MANAGE_SCOPE,
} from "@shared/contracts/helix-shared-live-room-agent.v1";
import {
  HELIX_ENVIRONMENT_ACTION_READ_SCOPE,
  HELIX_ENVIRONMENT_ACTION_WRITE_SCOPE,
} from "@shared/helix-environment-action";
import {
  HELIX_ENVIRONMENT_REASONING_ROLE_PROJECTION_SCHEMA,
  helixEnvironmentReasoningRoleSha256,
  type HelixEnvironmentReasoningRoleProjection,
} from "@shared/helix-environment-reasoning-role";
import {
  createHelixMcpServer,
  type HelixEnvironmentReasoningRoleMcpStore,
} from "../helix-mcp-server";
import type { HelixAgentApiService } from "../../services/helix-agent-api/service";
import type { HelixAgentApiPrincipal } from "../../services/helix-agent-api/types";
import type { SharedLiveRoomBindingStore } from "../../services/shared-live-room-control/binding-store";
import type { SharedLiveRoomControlService } from "../../services/shared-live-room-control/service";
import { EnvironmentActionAuthorityError } from
  "../../services/environment-connectors/actions/authority-store";
import { EnvironmentActionAdapterRegistryError } from
  "../../services/situation-room/environment-action-adapter-registry";
import { ConnectorBootstrapPairingError } from
  "../../services/environment-connectors/pairing/bootstrap-service";
import { EnvironmentCommandAuthorityError } from
  "../../services/environment-connectors/commands";

const ROOM_ID = "shared_realtime_room:g6-mcp";
const PARTICIPANT_ID = "participant:g6-mcp";
const PROFILE_ID = "profile:g6-mcp";
const GOAL_ID = "environment_durable_goal:g6-mcp";

const principal = (): HelixAgentApiPrincipal => {
  const policy = buildHelixSharedRealtimeRoomsExperimentPolicy("developer");
  const now = "2026-08-23T12:00:00.000Z";
  return {
    tenantId: "tenant:g6-mcp",
    issuer: "https://issuer.example",
    subjectId: "subject:g6-mcp",
    accountProfileId: PROFILE_ID,
    accountType: "developer",
    scopes: new Set([
      HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
      HELIX_SHARED_LIVE_ROOM_SOURCE_MANAGE_SCOPE,
      HELIX_ENVIRONMENT_ACTION_READ_SCOPE,
      HELIX_ENVIRONMENT_ACTION_WRITE_SCOPE,
    ]),
    tokenExpiresAt: "2099-01-01T00:00:00.000Z",
    accountContext: {
      session_id: "external-oauth:g6-mcp",
      profile_id: PROFILE_ID,
      trusted_account_session: true,
      account_session: {
        schema: "helix.account_session.v1",
        session_id: "external-oauth:g6-mcp",
        profile: {
          profile_id: PROFILE_ID,
          display_name: "G6 MCP",
          email: null,
          auth_mode: "web_auth",
          account_type: "developer",
          provider: "external_oauth",
          provider_alias: "test",
          provider_subject: "subject:g6-mcp",
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

const projection = {
  schema: HELIX_ENVIRONMENT_REASONING_ROLE_PROJECTION_SCHEMA,
  goal_id: GOAL_ID,
  revision: 1,
  latest_event_hash: `sha256:${"a".repeat(64)}`,
  outputs: [],
  invalidated_output_ids: [],
  principal_dispositions: [],
  arbitrations: [],
  execution_links: [],
  measured_result_links: [],
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
} as HelixEnvironmentReasoningRoleProjection;

const connect = async (input?: {
  authorityError?: EnvironmentActionAuthorityError | EnvironmentActionAdapterRegistryError;
  commandAuthorityError?: EnvironmentCommandAuthorityError;
  playerPairingError?: ConnectorBootstrapPairingError;
  sourcePairingError?: ConnectorBootstrapPairingError;
}) => {
  const roleStore = {
    recordOutput: vi.fn(async () => projection),
    inspect: vi.fn(async () => projection),
    recordPrincipalDisposition: vi.fn(async () => ({ ...projection, revision: 2 })),
    arbitrate: vi.fn(async () => ({ ...projection, revision: 3 })),
    linkCompletedPrincipalExecution: vi.fn(async () => ({
      ...projection,
      revision: 4,
    })),
  } satisfies HelixEnvironmentReasoningRoleMcpStore;
  const authorityInspector = vi.fn(async () => ({
    authorities: [],
    connectorReadiness: [],
  }));
  const authorityConfigurator = vi.fn(async () => {
    if (input?.authorityError) throw input.authorityError;
    return {
    schema: "helix.environment_action.authority.v1" as const,
    action_authority_id: "environment_action_authority:g6-mcp",
    environment_binding_id: "environment_binding:g6-mcp",
    room_source_binding_id: "room_source_binding:g6-mcp",
    room_id: ROOM_ID,
    source_id: "source:g6-mcp",
    world_id: "minecraft:g6-mcp",
    adapter_profile_id: "game.minecraft.player.fabric.v1",
    domain_adapter: "minecraft.fabric_client.v1",
    participant_id: PARTICIPANT_ID,
    subject_binding_id: "environment_subject_binding:g6-mcp",
    allowed_capability_ids: ["com.casimirbot.minecraft.player.look"],
    autonomy_mode: "approved_capabilities" as const,
    manual_override_policy: "cancel" as const,
    status: "active" as const,
    policy_version: 2,
    issued_at: "2026-08-23T12:00:00.000Z",
    expires_at: "2026-08-23T13:00:00.000Z",
    revoked_at: null,
    credential_included: false as const,
    content_role: "environment_action_authority_not_assistant_answer" as const,
    answer_authority: false as const,
    assistant_answer: false as const,
    terminal_eligible: false as const,
    raw_content_included: false as const,
    };
  });
  const playerPairLocalHandoff = vi.fn(async () => {
    if (input?.playerPairingError) throw input.playerPairingError;
    return {
      pairing: {
        schema: "helix.connector_pairing.v1",
        pairing_id: "connector_pairing:g6-mcp",
        status: "pending",
      },
      status: "player_pairing_inbox_staged" as const,
    };
  });
  const commandAuthorityConfigurator = vi.fn(async () => {
    if (input?.commandAuthorityError) throw input.commandAuthorityError;
    return {
      authority: {
        schema: "helix.environment_command.authority.v1" as const,
        command_authority_id: "command_authority:g6-mcp",
        environment_binding_id: "environment_binding:g6-mcp",
        room_source_binding_id: "room_source_binding:g6-mcp",
        room_id: ROOM_ID,
        source_id: "source:g6-mcp",
        world_id: "minecraft:g6-mcp",
        adapter_profile_id: "game.minecraft.fabric.v1",
        authority_profile: "world_operator" as const,
        autonomy_mode: "approved_categories" as const,
        approved_categories: ["player_state", "player_inventory"] as const,
        status: "active" as const,
        policy_version: 3,
        issued_at: "2026-08-23T12:00:00.000Z",
        expires_at: "2026-08-23T13:00:00.000Z",
        revoked_at: null,
        credential_included: false as const,
        content_role: "environment_command_authority_not_assistant_answer" as const,
        answer_authority: false as const,
        assistant_answer: false as const,
        terminal_eligible: false as const,
        raw_content_included: false as const,
      },
      ownerGrant: {
        schema: "helix.environment_command.member_grant.v1" as const,
        command_grant_id: "command_grant:g6-mcp",
        command_authority_id: "command_authority:g6-mcp",
        room_id: ROOM_ID,
        participant_id: PARTICIPANT_ID,
        environment_binding_id: "environment_binding:g6-mcp",
        subject_binding_id: "environment_subject_binding:g6-mcp",
        max_authority_profile: "world_operator" as const,
        autonomy_override: "approved_categories" as const,
        status: "active" as const,
        issued_at: "2026-08-23T12:00:00.000Z",
        expires_at: "2026-08-23T13:00:00.000Z",
        revoked_at: null,
        content_role: "environment_command_member_grant_not_assistant_answer" as const,
        answer_authority: false as const,
        assistant_answer: false as const,
        terminal_eligible: false as const,
        raw_content_included: false as const,
      },
    };
  });
  const serverPairLocalHandoff = vi.fn(async () => ({
    pairing: {
      schema: "helix.connector_pairing.v1",
      pairing_id: "connector_pairing:server-g6-mcp",
      status: "pending",
    },
    status: "server_pairing_inbox_staged" as const,
  }));
  const sourcePairLocalHandoff = vi.fn(async () => {
    if (input?.sourcePairingError) throw input.sourcePairingError;
    return {
      pairing: {
        schema: "helix.connector_pairing.v1",
        pairing_id: "connector_pairing:source-g6-mcp",
        status: "pending",
      },
      status: "server_pairing_inbox_staged" as const,
    };
  });
  const server = createHelixMcpServer({
    principal: principal(),
    service: {} as HelixAgentApiService,
    roomControlService: {
      inspectRoom: vi.fn(async () => ({
        room: { self_participant_id: PARTICIPANT_ID },
      })),
    } as unknown as SharedLiveRoomControlService,
    roomBindingStore: {} as Pick<
      SharedLiveRoomBindingStore,
      | "bindRunToRoom"
      | "claimPendingChatBinding"
      | "revokeRunRoomBindingForOwner"
      | "revokeClaimedRunChatBindingForOwner"
    >,
    deviceCheckService: vi.fn(),
    environmentReasoningRoleService: roleStore,
    environmentActionAuthorityInspector: authorityInspector,
    environmentActionAuthorityConfigurator: authorityConfigurator,
    environmentCommandAuthorityConfigurator: commandAuthorityConfigurator,
    environmentPlayerPairLocalHandoff: playerPairLocalHandoff,
    environmentSourcePairLocalHandoff: sourcePairLocalHandoff,
    environmentServerPairLocalHandoff: serverPairLocalHandoff,
  });
  const client = new Client(
    { name: "g6-mcp-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    roleStore,
    authorityInspector,
    authorityConfigurator,
    commandAuthorityConfigurator,
    playerPairLocalHandoff,
    sourcePairLocalHandoff,
    serverPairLocalHandoff,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
};

describe("Helix MCP G6 environment reasoning roles", () => {
  it("explains an action/source adapter mismatch without masking it as an internal error", async () => {
    const connection = await connect({
      authorityError: new EnvironmentActionAdapterRegistryError(
        "environment_action_adapter_unknown",
        "The player-action adapter is not registered.",
      ),
    });
    try {
      const result = await connection.client.callTool({
        name: "helix_environment_action_authority_configure",
        arguments: {
          room_id: ROOM_ID,
          environment_binding_id: "environment_binding:g6-mcp",
          settings: {
            participant_id: PARTICIPANT_ID,
            domain_adapter: "minecraft.fabric_mod.v1",
            allowed_capability_ids: ["com.casimirbot.minecraft.player.walk"],
            autonomy_mode: "approved_capabilities",
            manual_override_policy: "cancel",
            expires_at: "2026-08-23T13:00:00.000Z",
          },
        },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        schema: "helix.environment_action_authority_error.v1",
        error: "environment_action_adapter_unknown",
        retryable: false,
        credential_included: false,
      });
      expect(JSON.stringify(result)).toContain("client action adapter");
      expect(JSON.stringify(result)).not.toContain("internal_error");
    } finally {
      await connection.close();
    }
  });

  it("returns the owner-only action-authority boundary as a typed MCP error", async () => {
    const connection = await connect({
      authorityError: new EnvironmentActionAuthorityError(
        "action_authority_forbidden",
        404,
        "Player-action settings are unavailable to this account.",
      ),
    });
    try {
      const result = await connection.client.callTool({
        name: "helix_environment_action_authority_configure",
        arguments: {
          room_id: ROOM_ID,
          environment_binding_id: "environment_binding:g6-mcp",
          settings: {
            participant_id: PARTICIPANT_ID,
            domain_adapter: "minecraft.fabric_client.v1",
            allowed_capability_ids: [
              "com.casimirbot.minecraft.player.look",
            ],
            autonomy_mode: "approved_capabilities",
            manual_override_policy: "cancel",
            expires_at: "2026-08-23T13:00:00.000Z",
          },
        },
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        schema: "helix.environment_action_authority_error.v1",
        error: "action_authority_forbidden",
        retryable: false,
        credential_included: false,
        answer_authority: false,
        terminal_eligible: false,
      });
      expect(JSON.stringify(result)).not.toContain("internal_error");
    } finally {
      await connection.close();
    }
  });

  it("returns connector pairing failures as credential-free typed MCP errors", async () => {
    const connection = await connect({
      playerPairingError: new ConnectorBootstrapPairingError(
        "connector_pairing_unavailable",
        409,
        "The selected Minecraft player authority is not active for this room environment.",
      ),
    });
    try {
      const result = await connection.client.callTool({
        name: "helix_environment_player_pair_local",
        arguments: {
          room_id: ROOM_ID,
          binding_id: "room_source_binding:g6-mcp",
          action_authority_id: "environment_action_authority:g6-mcp",
          credential_ttl_ms: 3_600_000,
          idempotency_key: "g6-mcp-local-pairing-error",
        },
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        schema: "helix.environment_connector_pairing_error.v1",
        error: "connector_pairing_unavailable",
        retryable: false,
        credential_included: false,
        pairing_code_included: false,
        answer_authority: false,
        terminal_eligible: false,
      });
      expect(JSON.stringify(result)).not.toContain("internal_error");
    } finally {
      await connection.close();
    }
  });

  it("preserves the owner-only World Authority boundary as a typed MCP error", async () => {
    const connection = await connect({
      commandAuthorityError: new EnvironmentCommandAuthorityError(
        "command_authority_forbidden",
        403,
        "Only the environment owner may configure command authority.",
      ),
    });
    try {
      const result = await connection.client.callTool({
        name: "helix_environment_command_authority_configure",
        arguments: {
          room_id: ROOM_ID,
          environment_binding_id: "environment_binding:g6-mcp",
          settings: {
            authority_profile: "world_operator",
            autonomy_mode: "approved_categories",
            approved_categories: ["player_inventory"],
            expires_at: "2026-08-23T13:00:00.000Z",
          },
        },
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        schema: "helix.environment_command_authority_error.v1",
        error: "command_authority_forbidden",
        retryable: false,
        credential_included: false,
        answer_authority: false,
        terminal_eligible: false,
      });
      expect(JSON.stringify(result)).not.toContain("internal_error");
    } finally {
      await connection.close();
    }
  });

  it("rejects a prospective action alias before it enters the canonical ledger", async () => {
    const connection = await connect();
    try {
      const result = await connection.client.callTool({
        name: "helix_environment_reasoning_role_record",
        arguments: {
          room_id: ROOM_ID,
          environment_binding_id: "environment_binding:g6-mcp",
          action_authority_id: "environment_action_authority:g6-mcp",
          subject_native_id: "player:g6-mcp",
          turn_id: "ask:principal:g6-mcp",
          goal_id: GOAL_ID,
          expected_goal_revision: 1,
          expected_ledger_revision: 0,
          observation_revision: 1,
          input_evidence_refs: ["evidence:g6-mcp"],
          payload: {
            role_kind: "prospective_planning",
            proposal_id: "proposal:g6-mcp-alias",
            objective_summary: "Turn the player camera ten degrees.",
            capability_id: "com.casimirbot.minecraft.player.look_at",
            capability_arguments: {
              action_kind: "look_at",
              target: { target_kind: "relative_rotation", yaw_degrees: 10 },
            },
            predicted_postconditions: [],
            assumptions: [],
            resource_keys: ["minecraft.player.camera"],
            confidence: 0.9,
            abstain: false,
          },
          expires_in_seconds: 60,
        },
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain(
        "reasoning_role_capability_identity_mismatch",
      );
      expect(connection.roleStore.recordOutput).not.toHaveBeenCalled();
    } finally {
      await connection.close();
    }
  });

  it("exposes record, inspect, disposition, and arbitration as nonterminal tools", async () => {
    const connection = await connect();
    try {
      const catalog = await connection.client.listTools();
      expect(catalog.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
        "helix_environment_reasoning_role_record",
        "helix_environment_reasoning_role_inspect",
        "helix_environment_reasoning_role_disposition",
        "helix_environment_reasoning_role_arbitrate",
        "helix_environment_action_authority_inspect",
        "helix_environment_action_authority_configure",
        "helix_environment_command_authority_configure",
        "helix_environment_player_pair_local",
        "helix_environment_source_pair_local",
        "helix_environment_server_pair_local",
      ]));

      const inspected = await connection.client.callTool({
        name: "helix_environment_action_authority_inspect",
        arguments: {
          room_id: ROOM_ID,
          environment_binding_id: "environment_binding:g6-mcp",
        },
      });
      expect(inspected.isError, JSON.stringify(inspected)).not.toBe(true);
      expect(inspected.structuredContent).toMatchObject({
        operation: "environment.action_authority.inspect",
        authorities: [],
        connector_readiness: [],
        answer_authority: false,
        terminal_eligible: false,
      });
      expect(connection.authorityInspector).toHaveBeenCalledWith({
        roomId: ROOM_ID,
        profileId: PROFILE_ID,
        environmentBindingId: "environment_binding:g6-mcp",
      });

      const configured = await connection.client.callTool({
        name: "helix_environment_action_authority_configure",
        arguments: {
          room_id: ROOM_ID,
          environment_binding_id: "environment_binding:g6-mcp",
          settings: {
            participant_id: PARTICIPANT_ID,
            domain_adapter: "minecraft.fabric_client.v1",
            allowed_capability_ids: [
              "com.casimirbot.minecraft.player.look",
            ],
            autonomy_mode: "approved_capabilities",
            manual_override_policy: "cancel",
            expires_at: "2026-08-23T13:00:00.000Z",
          },
        },
      });
      expect(configured.isError, JSON.stringify(configured)).not.toBe(true);
      expect(configured.structuredContent).toMatchObject({
        operation: "environment.action_authority.configure",
        authority: {
          action_authority_id: "environment_action_authority:g6-mcp",
          policy_version: 2,
        },
        answer_authority: false,
        terminal_eligible: false,
      });
      expect(connection.authorityConfigurator).toHaveBeenCalledWith(
        expect.objectContaining({
          roomId: ROOM_ID,
          ownerProfileId: PROFILE_ID,
          participantId: PARTICIPANT_ID,
        }),
      );

      const commandAuthority = await connection.client.callTool({
        name: "helix_environment_command_authority_configure",
        arguments: {
          room_id: ROOM_ID,
          environment_binding_id: "environment_binding:g6-mcp",
          settings: {
            authority_profile: "world_operator",
            autonomy_mode: "approved_categories",
            approved_categories: ["player_state", "player_inventory"],
            expires_at: "2026-08-23T13:00:00.000Z",
          },
        },
      });
      expect(commandAuthority.isError, JSON.stringify(commandAuthority)).not.toBe(true);
      expect(commandAuthority.structuredContent).toMatchObject({
        operation: "environment.command_authority.configure",
        authority: {
          command_authority_id: "command_authority:g6-mcp",
          authority_profile: "world_operator",
        },
        member_grant: {
          participant_id: PARTICIPANT_ID,
          max_authority_profile: "world_operator",
        },
        answer_authority: false,
        terminal_eligible: false,
      });
      expect(connection.commandAuthorityConfigurator).toHaveBeenCalledWith({
        roomId: ROOM_ID,
        ownerProfileId: PROFILE_ID,
        environmentBindingId: "environment_binding:g6-mcp",
        authorityProfile: "world_operator",
        autonomyMode: "approved_categories",
        approvedCategories: ["player_state", "player_inventory"],
        expiresAt: "2026-08-23T13:00:00.000Z",
      });

      const paired = await connection.client.callTool({
        name: "helix_environment_player_pair_local",
        arguments: {
          room_id: ROOM_ID,
          binding_id: "room_source_binding:g6-mcp",
          action_authority_id: "environment_action_authority:g6-mcp",
          credential_ttl_ms: 3_600_000,
          idempotency_key: "g6-mcp-local-pairing",
        },
      });
      expect(paired.isError, JSON.stringify(paired)).not.toBe(true);
      expect(paired.structuredContent).toMatchObject({
        operation: "environment.player_pair.local_handoff",
        handoff_status: "player_pairing_inbox_staged",
        credential_included: false,
        pairing_code_included: false,
        answer_authority: false,
        terminal_eligible: false,
      });
      expect(JSON.stringify(paired)).not.toContain("Z4ZD-X2JJ");
      expect(connection.playerPairLocalHandoff).toHaveBeenCalledWith({
        roomId: ROOM_ID,
        ownerProfileId: PROFILE_ID,
        bindingId: "room_source_binding:g6-mcp",
        actionAuthorityId: "environment_action_authority:g6-mcp",
        credentialTtlMs: 3_600_000,
        idempotencyKey: "g6-mcp-local-pairing",
      });

      const sourcePaired = await connection.client.callTool({
        name: "helix_environment_source_pair_local",
        arguments: {
          room_id: ROOM_ID,
          binding_id: "room_source_binding:g6-mcp",
          credential_ttl_ms: 3_600_000,
          idempotency_key: "g6-mcp-local-source-pairing",
        },
      });
      expect(sourcePaired.isError, JSON.stringify(sourcePaired)).not.toBe(true);
      expect(sourcePaired.structuredContent).toMatchObject({
        operation: "environment.source_pair.local_handoff",
        binding_id: "room_source_binding:g6-mcp",
        handoff_status: "server_pairing_inbox_staged",
        credential_included: false,
        pairing_code_included: false,
        command_authority_granted: false,
        player_embodiment_granted: false,
        answer_authority: false,
        terminal_eligible: false,
      });
      expect(JSON.stringify(sourcePaired)).not.toContain("Z4ZD-X2JJ");
      expect(connection.sourcePairLocalHandoff).toHaveBeenCalledWith({
        roomId: ROOM_ID,
        ownerProfileId: PROFILE_ID,
        bindingId: "room_source_binding:g6-mcp",
        credentialTtlMs: 3_600_000,
        idempotencyKey: "g6-mcp-local-source-pairing",
      });

      const serverPaired = await connection.client.callTool({
        name: "helix_environment_server_pair_local",
        arguments: {
          room_id: ROOM_ID,
          binding_id: "room_source_binding:g6-mcp",
          credential_ttl_ms: 3_600_000,
          idempotency_key: "g6-mcp-local-server-pairing",
        },
      });
      expect(serverPaired.isError, JSON.stringify(serverPaired)).not.toBe(true);
      expect(serverPaired.structuredContent).toMatchObject({
        operation: "environment.server_pair.local_handoff",
        binding_id: "room_source_binding:g6-mcp",
        handoff_status: "server_pairing_inbox_staged",
        credential_included: false,
        pairing_code_included: false,
        answer_authority: false,
        terminal_eligible: false,
      });
      expect(JSON.stringify(serverPaired)).not.toContain("Z4ZD-X2JJ");
      expect(connection.serverPairLocalHandoff).toHaveBeenCalledWith({
        roomId: ROOM_ID,
        ownerProfileId: PROFILE_ID,
        bindingId: "room_source_binding:g6-mcp",
        credentialTtlMs: 3_600_000,
        idempotencyKey: "g6-mcp-local-server-pairing",
      });

      const adoptedArgs = { direction: "forward", duration_ms: 100, sprint: false };
      const result = await connection.client.callTool({
        name: "helix_environment_reasoning_role_disposition",
        arguments: {
          room_id: ROOM_ID,
          turn_id: "ask:principal:g6-mcp",
          goal_id: GOAL_ID,
          expected_ledger_revision: 1,
          role_output_id: "environment_reasoning_role_output:one",
          disposition: "adopted",
          adopted_capability_id: "com.casimirbot.minecraft.player.walk",
          adopted_capability_arguments: adoptedArgs,
          rationale_summary: "Adopt the current bounded movement proposal.",
        },
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        operation: "com.casimirbot.environment.reasoning_role.disposition",
        reentry_required: true,
        answer_authority: false,
        terminal_eligible: false,
      });
      expect(connection.roleStore.recordPrincipalDisposition).toHaveBeenCalledWith(
        expect.objectContaining({
          principalTurnId: "ask:principal:g6-mcp",
          adoptedCapabilityArgumentsHash:
            helixEnvironmentReasoningRoleSha256(adoptedArgs),
        }),
      );
    } finally {
      await connection.close();
    }
  });
});
