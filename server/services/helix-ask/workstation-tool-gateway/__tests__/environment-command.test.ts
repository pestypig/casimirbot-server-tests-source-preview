import { buildHelixAccountCapabilityPolicy } from "@shared/helix-account-session";
import {
  HELIX_ENVIRONMENT_COMMAND_CATALOG_OBSERVATION_SCHEMA,
  HELIX_ENVIRONMENT_COMMAND_OBSERVATION_SCHEMA,
  HELIX_ENVIRONMENT_COMMAND_REQUEST_SCHEMA,
  type HelixEnvironmentCommandObservation,
} from "@shared/helix-environment-command";
import { describe, expect, it, vi } from "vitest";
import type { HelixWorkstationGatewayAccountContext } from "../account-policy";
import {
  environmentCommandCatalogMinecraftManifest,
  environmentCommandMinecraftManifest,
  executeEnvironmentCommandCatalogGatewayCapability,
  executeEnvironmentCommandGatewayCapability,
  type EnvironmentCommandGatewayDependencies,
} from "../environment-command";

const ROOM_ID = "shared_realtime_room:command-test";
const PROFILE_ID = "profile:command-test";
const ENVIRONMENT_ID = "environment_binding:command-test";

const accountContext = (): HelixWorkstationGatewayAccountContext => {
  const accountPolicy = buildHelixAccountCapabilityPolicy("developer");
  const session = {
    schema: "helix.account_session.v1" as const,
    session_id: "account_session:command-test",
    profile: {
      profile_id: PROFILE_ID,
      display_name: "Command tester",
      auth_mode: "guest" as const,
      account_type: "developer" as const,
      provider: "guest" as const,
      created_at: "2026-08-02T12:00:00.000Z",
      updated_at: "2026-08-02T12:00:00.000Z",
    },
    account_policy: accountPolicy,
    status: "active" as const,
    memory_scope: "session_only" as const,
    created_at: "2026-08-02T12:00:00.000Z",
    updated_at: "2026-08-02T12:00:00.000Z",
    expires_at: "2026-08-03T12:00:00.000Z",
  };
  return {
    session_id: session.session_id,
    profile_id: PROFILE_ID,
    trusted_account_session: true,
    account_session: session,
    account_policy: accountPolicy,
  };
};

const environment = (id = ENVIRONMENT_ID, label = "Local Fabric 1.21.8") => ({
  environment_binding_id: id,
  source_label: label,
  domain: "minecraft",
  connection_status: "active",
});

const observation: HelixEnvironmentCommandObservation = {
  schema: HELIX_ENVIRONMENT_COMMAND_OBSERVATION_SCHEMA,
  command_request_ref: "command_request:command-test",
  command_execution_ref: "command_execution:command-test",
  command_hash: `sha256:${"a".repeat(64)}`,
  command_root: "time",
  outcome: "succeeded",
  summary: "Set the time to 1000.",
  result: { result_code: 1 },
  evidence_ref: "environment_command_evidence:command-test",
  post_state_evidence_refs: [],
  observed_at: "2026-08-02T12:00:01.000Z",
  provenance_valid: true,
  eligible_for_current_turn_reentry: true,
  content_role: "environment_command_observation_not_assistant_answer",
  reentry_required: true,
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
};

const dependencies = (
  overrides: Partial<EnvironmentCommandGatewayDependencies> = {},
): Partial<EnvironmentCommandGatewayDependencies> => ({
  listRoomEnvironments: vi.fn(async () => [environment()] as never),
  readAuthority: vi.fn(async () => ({
    authority: { status: "active" },
    memberGrant: { status: "active" },
    memberGrants: [],
  }) as never),
  readCatalog: vi.fn(async () => ({
    gameVersion: "1.21.8",
    commandTreeHash: `sha256:${"c".repeat(64)}`,
    rootCommandCount: 74,
    nodes: [
      {
        path: "time query <time>",
        node_kind: "argument",
        executable: true,
        argument_type: "net.minecraft.commands.arguments.TimeArgument",
        suggestion_provider: null,
        redirects_to: null,
        child_count: 0,
      },
    ],
    matchedCount: 1,
    truncated: false,
    generatedAt: "2026-08-02T12:00:00.000Z",
  })),
  enqueueCommand: vi.fn(async () => ({
    schema: HELIX_ENVIRONMENT_COMMAND_REQUEST_SCHEMA,
    command_request_id: "command_request:command-test",
    deadline_at: "2026-08-02T12:00:15.000Z",
  }) as never),
  awaitObservation: vi.fn(async () => observation),
  ...overrides,
});

describe("Minecraft command workstation gateway", () => {
  it("publishes a read-only live dispatcher catalog capability", async () => {
    expect(environmentCommandCatalogMinecraftManifest).toMatchObject({
      capability_id: "com.casimirbot.minecraft.command.catalog",
      mode: "observe",
      mutating: false,
      shell_access: false,
      terminal_eligible: false,
    });
    const result = await executeEnvironmentCommandCatalogGatewayCapability({
      turnId: "ask:command-catalog:turn-1",
      toolCallId: "tool_call:command-catalog",
      providerExecutionId: "provider_execution:command-catalog",
      arguments: {
        query: "time query",
        limit: 32,
        environment_label: "paired Minecraft Fabric world",
      },
      accountContext: accountContext(),
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: dependencies(),
    });
    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      observation: {
        schema: HELIX_ENVIRONMENT_COMMAND_CATALOG_OBSERVATION_SCHEMA,
        game_version: "1.21.8",
        returned_count: 1,
        provenance_valid: true,
        assistant_answer: false,
        terminal_eligible: false,
      },
    });
  });

  it("publishes a bounded nonterminal act capability without host access", () => {
    expect(environmentCommandMinecraftManifest).toMatchObject({
      capability_id: "com.casimirbot.minecraft.command",
      mode: "act",
      permission_profile_required: "act",
      mutating: true,
      shell_access: false,
      code_mutation: false,
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(environmentCommandMinecraftManifest.input_schema).toMatchObject({
      additionalProperties: false,
      required: ["command"],
      properties: {
        category: {
          description: expect.stringContaining(
            "Every read-only command uses `query`",
          ),
        },
        effect: {
          description: expect.stringContaining(
            "Use `read_only` for query forms",
          ),
        },
      },
    });
    expect(environmentCommandMinecraftManifest.description).toContain(
      "never send a commands array",
    );
    expect(environmentCommandMinecraftManifest.description).toContain(
      "Player-only arguments such as /title require @s",
    );
    expect(environmentCommandMinecraftManifest.description).toContain(
      "World Authority plane",
    );
    expect(environmentCommandMinecraftManifest.description).toContain(
      "Do not substitute a server command such as teleport or effect",
    );
    expect(environmentCommandMinecraftManifest.safety_tags).toEqual(
      expect.arrayContaining([
        "live_dispatcher_parse_required",
        "one_shot_no_automatic_retry",
        "host_access_forbidden",
        "current_turn_evidence_reentry_required",
      ]),
    );
  });

  it("fails closed before broker access without trusted room/tool identity", async () => {
    const listRoomEnvironments = vi.fn();
    const result = await executeEnvironmentCommandGatewayCapability({
      turnId: "ask:command-test:untrusted",
      arguments: {
        command: "time set day",
        category: "world_time_weather",
        effect: "world_mutation",
      },
      accountContext: null,
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: { listRoomEnvironments },
    });
    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      error: "permission_revoked",
      observation: {
        provenance_valid: false,
        eligible_for_current_turn_reentry: false,
        assistant_answer: false,
        terminal_eligible: false,
      },
    });
    expect(listRoomEnvironments).not.toHaveBeenCalled();
  });

  it("returns a retryable parse failure when the provider batches commands instead of issuing one tool call per command", async () => {
    const listRoomEnvironments = vi.fn();
    const result = await executeEnvironmentCommandGatewayCapability({
      turnId: "ask:command-test:batched-commands",
      toolCallId: "tool_call:batched-commands",
      providerExecutionId: "provider_execution:batched-commands",
      arguments: {
        commands: [
          'title DatDamPig title {"text":"HELIX GUIDE ONLINE"}',
          "playsound minecraft:block.amethyst_block.chime master DatDamPig ~ ~ ~ 1 1 1",
        ],
      },
      accountContext: accountContext(),
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: { listRoomEnvironments },
    });

    expect(result).toMatchObject({
      ok: false,
      status: "failed",
      error: "command_parse_failed",
      repairAction: "repair",
      summary: expect.stringContaining("exactly one command string per tool call"),
      observation: {
        outcome: "command_parse_failed",
        provenance_valid: false,
        eligible_for_current_turn_reentry: false,
      },
    });
    expect(listRoomEnvironments).not.toHaveBeenCalled();
  });

  it("classifies a permission failure as user-repairable rather than model-repairable", async () => {
    const result = await executeEnvironmentCommandGatewayCapability({
      turnId: "ask:command-test:untrusted-repair-owner",
      arguments: { command: "time query daytime" },
      accountContext: null,
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
    });

    expect(result).toMatchObject({
      ok: false,
      error: "permission_revoked",
      repairAction: "ask_user",
    });
  });

  it("derives environment and lifecycle identity server-side and re-enters the result", async () => {
    const enqueueCommand = vi.fn(async () => ({
      schema: HELIX_ENVIRONMENT_COMMAND_REQUEST_SCHEMA,
      command_request_id: "command_request:command-test",
      deadline_at: "2026-08-02T12:00:15.000Z",
    }) as never);
    const deps = dependencies({ enqueueCommand });
    const result = await executeEnvironmentCommandGatewayCapability({
      turnId: "ask:command-test:turn-1",
      toolCallId: "tool_call:command-test",
      providerExecutionId: "provider_execution:command-test",
      arguments: {
        command: "/time set day",
        category: "world_time_weather",
        effect: "world_mutation",
        environment_label: "Local Fabric 1.21.8",
      },
      accountContext: accountContext(),
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: deps,
    });
    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      observation: {
        schema: HELIX_ENVIRONMENT_COMMAND_OBSERVATION_SCHEMA,
        outcome: "succeeded",
        provenance_valid: true,
        eligible_for_current_turn_reentry: true,
        assistant_answer: false,
        terminal_eligible: false,
      },
    });
    expect(enqueueCommand).toHaveBeenCalledWith(expect.objectContaining({
      roomId: ROOM_ID,
      profileId: PROFILE_ID,
      environmentBindingId: ENVIRONMENT_ID,
      turnId: "ask:command-test:turn-1",
      toolCallId: "tool_call:command-test",
      providerExecutionId: "provider_execution:command-test",
      commandText: "time set day",
      requestedCategory: "world_time_weather",
      expectedEffect: "world_mutation",
      confirmationState: "not_required",
    }));
    expect(deps.awaitObservation).toHaveBeenCalledWith({
      requestId: "command_request:command-test",
      deadlineAt: "2026-08-02T12:00:15.000Z",
    });
  });

  it("canonicalizes an unambiguous query to the connector's least-privilege labels", async () => {
    const enqueueCommand = vi.fn(async () => ({
      schema: HELIX_ENVIRONMENT_COMMAND_REQUEST_SCHEMA,
      command_request_id: "command_request:command-test",
      deadline_at: "2026-08-02T12:00:15.000Z",
    }) as never);
    const result = await executeEnvironmentCommandGatewayCapability({
      turnId: "ask:command-test:read-canonicalization",
      toolCallId: "tool_call:command-read",
      providerExecutionId: "provider_execution:command-read",
      arguments: {
        command: "time query daytime",
        category: "world_time_weather",
        effect: "world_mutation",
      },
      accountContext: accountContext(),
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: dependencies({ enqueueCommand }),
    });

    expect(result.ok).toBe(true);
    expect(result.executedArgs).toEqual({
      command: "time query daytime",
      category: "query",
      effect: "read_only",
      idempotent_replay: false,
      physical_execution_performed: true,
    });
    expect(enqueueCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        commandText: "time query daytime",
        requestedCategory: "query",
        expectedEffect: "read_only",
      }),
    );
  });

  it("derives a composed vanilla query risk when the provider omits duplicate labels", async () => {
    const enqueueCommand = vi.fn(async () => ({
      schema: HELIX_ENVIRONMENT_COMMAND_REQUEST_SCHEMA,
      command_request_id: "command_request:command-test",
      deadline_at: "2026-08-02T12:00:15.000Z",
    }) as never);
    const result = await executeEnvironmentCommandGatewayCapability({
      turnId: "ask:command-test:composed-read",
      toolCallId: "tool_call:command-composed-read",
      providerExecutionId: "provider_execution:command-composed-read",
      arguments: {
        command: "execute in minecraft:overworld run time query daytime",
      },
      accountContext: accountContext(),
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: dependencies({ enqueueCommand }),
    });

    expect(result.ok).toBe(true);
    expect(result.executedArgs).toEqual({
      command: "execute in minecraft:overworld run time query daytime",
      category: "query",
      effect: "read_only",
      idempotent_replay: false,
      physical_execution_performed: true,
    });
    expect(enqueueCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedCategory: "query",
        expectedEffect: "read_only",
      }),
    );
  });

  it("fails closed when an unknown or installed-mod command omits its risk declaration", async () => {
    const enqueueCommand = vi.fn();
    const result = await executeEnvironmentCommandGatewayCapability({
      turnId: "ask:command-test:unknown-risk",
      toolCallId: "tool_call:command-unknown-risk",
      providerExecutionId: "provider_execution:command-unknown-risk",
      arguments: { command: "some_installed_mod ping" },
      accountContext: accountContext(),
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: dependencies({ enqueueCommand }),
    });

    expect(result).toMatchObject({
      ok: false,
      status: "failed",
      error: "command_category_mismatch",
      observation: {
        outcome: "command_category_mismatch",
        provenance_valid: false,
        eligible_for_current_turn_reentry: false,
      },
    });
    expect(enqueueCommand).not.toHaveBeenCalled();
  });

  it("preserves the human-only connector-management refusal through re-entry", async () => {
    const managementRefusal: HelixEnvironmentCommandObservation = {
      ...observation,
      command_root: "helix",
      outcome: "connector_management_forbidden",
      summary:
        "Connector management commands are human-only and are never executable through the runtime agent.",
      provenance_valid: true,
      eligible_for_current_turn_reentry: true,
    };
    const result = await executeEnvironmentCommandGatewayCapability({
      turnId: "ask:command-test:management-boundary",
      toolCallId: "tool_call:management-boundary",
      providerExecutionId: "provider_execution:management-boundary",
      arguments: {
        command: "helix status",
        category: "mod_command",
        effect: "unknown",
      },
      accountContext: accountContext(),
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: dependencies({
        awaitObservation: vi.fn(async () => managementRefusal),
      }),
    });

    expect(result).toMatchObject({
      ok: false,
      status: "failed",
      error: "connector_management_forbidden",
      summary:
        "Connector management commands are human-only and are never executable through the runtime agent.",
      observation: {
        outcome: "connector_management_forbidden",
        eligible_for_current_turn_reentry: true,
      },
    });
  });

  it("canonicalizes a known administrator root to the connector's conservative labels", async () => {
    const enqueueCommand = vi.fn(async () => ({
      schema: HELIX_ENVIRONMENT_COMMAND_REQUEST_SCHEMA,
      command_request_id: "command_request:command-test",
      deadline_at: "2026-08-02T12:00:15.000Z",
    }) as never);
    const result = await executeEnvironmentCommandGatewayCapability({
      turnId: "ask:command-test:admin-canonicalization",
      toolCallId: "tool_call:command-admin",
      providerExecutionId: "provider_execution:command-admin",
      arguments: {
        command: "whitelist list",
        category: "query",
        effect: "read_only",
      },
      accountContext: accountContext(),
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: dependencies({ enqueueCommand }),
    });

    expect(result.ok).toBe(true);
    expect(result.executedArgs).toEqual({
      command: "whitelist list",
      category: "server_administration",
      effect: "server_administration",
      idempotent_replay: false,
      physical_execution_performed: true,
    });
    expect(enqueueCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        commandText: "whitelist list",
        requestedCategory: "server_administration",
        expectedEffect: "server_administration",
      }),
    );
  });

  it("reuses one turn-scoped command request across provider tool-call retries", async () => {
    const enqueueCommand = vi
      .fn()
      .mockImplementationOnce(async (input: { toolCallId: string }) => ({
        schema: HELIX_ENVIRONMENT_COMMAND_REQUEST_SCHEMA,
        command_request_id: "command_request:stable-retry",
        tool_call_id: input.toolCallId,
        deadline_at: "2026-08-02T12:00:15.000Z",
      }) as never)
      .mockImplementationOnce(async () => ({
        schema: HELIX_ENVIRONMENT_COMMAND_REQUEST_SCHEMA,
        command_request_id: "command_request:stable-retry",
        tool_call_id: "tool_call:first-attempt",
        deadline_at: "2026-08-02T12:00:15.000Z",
      }) as never);
    const deps = dependencies({ enqueueCommand });
    const base = {
      turnId: "ask:command-test:stable-retry",
      providerExecutionId: "provider_execution:stable-retry",
      arguments: { command: "time query daytime" },
      accountContext: accountContext(),
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: deps,
    };

    const first = await executeEnvironmentCommandGatewayCapability({
      ...base,
      toolCallId: "tool_call:first-attempt",
    });
    const replay = await executeEnvironmentCommandGatewayCapability({
      ...base,
      toolCallId: "tool_call:provider-retry",
    });
    const firstKey = enqueueCommand.mock.calls[0]?.[0]?.idempotencyKey;
    const replayKey = enqueueCommand.mock.calls[1]?.[0]?.idempotencyKey;

    expect(firstKey).toBe(replayKey);
    expect(first).toMatchObject({
      ok: true,
      idempotentReplay: false,
      executedArgs: {
        idempotent_replay: false,
        physical_execution_performed: true,
      },
    });
    expect(replay).toMatchObject({
      ok: true,
      idempotentReplay: true,
      summary: expect.stringContaining("did not execute the duplicate"),
      executedArgs: {
        idempotent_replay: true,
        physical_execution_performed: false,
      },
    });
  });

  it("does not guess when multiple command-enabled environments match", async () => {
    const enqueueCommand = vi.fn();
    const deps = dependencies({
      listRoomEnvironments: vi.fn(async () => [
        environment("environment_binding:first", "Fabric one"),
        environment("environment_binding:second", "Fabric two"),
      ] as never),
      enqueueCommand,
    });
    const result = await executeEnvironmentCommandGatewayCapability({
      turnId: "ask:command-test:turn-ambiguous",
      toolCallId: "tool_call:command-ambiguous",
      providerExecutionId: "provider_execution:command-ambiguous",
      arguments: {
        command: "list",
        category: "query",
        effect: "read_only",
      },
      accountContext: accountContext(),
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: deps,
    });
    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      error: "wrong_environment",
    });
    expect(enqueueCommand).not.toHaveBeenCalled();
  });

  it("uses the sole authorized environment when Codex supplies a natural room-environment phrase", async () => {
    const readAuthority = vi.fn(async () => ({
      authority: { status: "active" },
      memberGrant: { status: "active" },
      memberGrants: [],
    }) as never);
    const enqueueCommand = vi.fn(async () => ({
      schema: HELIX_ENVIRONMENT_COMMAND_REQUEST_SCHEMA,
      command_request_id: "command_request:natural-label",
      deadline_at: "2026-08-02T12:00:15.000Z",
    }) as never);
    const awaitObservation = vi.fn(async () => observation);
    const result = await executeEnvironmentCommandGatewayCapability({
      turnId: "ask:command-test:natural-label",
      toolCallId: "tool_call:command-natural-label",
      providerExecutionId: "provider_execution:command-natural-label",
      arguments: {
        command: "time query daytime",
        environment_label: "my paired Minecraft Fabric world",
      },
      accountContext: accountContext(),
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: dependencies({
        readAuthority,
        enqueueCommand,
        awaitObservation,
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      observation: { outcome: "succeeded" },
    });
    expect(readAuthority).toHaveBeenCalledWith(
      expect.objectContaining({ environmentBindingId: ENVIRONMENT_ID }),
    );
    expect(enqueueCommand).toHaveBeenCalledWith(
      expect.objectContaining({ environmentBindingId: ENVIRONMENT_ID }),
    );
  });

  it("still rejects an unmatched label when more than one authorized environment is active", async () => {
    const enqueueCommand = vi.fn();
    const result = await executeEnvironmentCommandGatewayCapability({
      turnId: "ask:command-test:wrong-label-ambiguous",
      toolCallId: "tool_call:command-wrong-label-ambiguous",
      providerExecutionId: "provider_execution:command-wrong-label-ambiguous",
      arguments: {
        command: "time query daytime",
        environment_label: "A different Fabric server",
      },
      accountContext: accountContext(),
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: dependencies({
        listRoomEnvironments: vi.fn(async () => [
          environment("environment_binding:first", "Fabric one"),
          environment("environment_binding:second", "Fabric two"),
        ] as never),
        enqueueCommand,
      }),
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      error: "wrong_environment",
      observation: { outcome: "wrong_environment" },
    });
    expect(enqueueCommand).not.toHaveBeenCalled();
  });

  it("diagnoses an inactive Minecraft source separately from permission", async () => {
    const readAuthority = vi.fn();
    const enqueueCommand = vi.fn();
    const result = await executeEnvironmentCommandGatewayCapability({
      turnId: "ask:command-test:offline",
      toolCallId: "tool_call:command-offline",
      providerExecutionId: "provider_execution:command-offline",
      arguments: { command: "gamerule doDaylightCycle" },
      accountContext: accountContext(),
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: dependencies({
        listRoomEnvironments: vi.fn(async () => [
          { ...environment(), connection_status: "stale" },
        ] as never),
        readAuthority,
        enqueueCommand,
      }),
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      error: "connector_offline",
      observation: { outcome: "connector_offline" },
    });
    expect(readAuthority).not.toHaveBeenCalled();
    expect(enqueueCommand).not.toHaveBeenCalled();
  });

  it("preserves permission_revoked only for an inactive authority or member grant", async () => {
    const enqueueCommand = vi.fn();
    const result = await executeEnvironmentCommandGatewayCapability({
      turnId: "ask:command-test:revoked-grant",
      toolCallId: "tool_call:command-revoked-grant",
      providerExecutionId: "provider_execution:command-revoked-grant",
      arguments: { command: "gamerule doDaylightCycle" },
      accountContext: accountContext(),
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: dependencies({
        readAuthority: vi.fn(async () => ({
          authority: { status: "active" },
          memberGrant: { status: "revoked" },
          memberGrants: [],
        }) as never),
        enqueueCommand,
      }),
    });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      error: "permission_revoked",
      observation: { outcome: "permission_revoked" },
    });
    expect(enqueueCommand).not.toHaveBeenCalled();
  });
});
