import { describe, expect, it } from "vitest";
import {
  HELIX_ENVIRONMENT_COMMAND_AUTHORITY_SCHEMA,
  HELIX_ENVIRONMENT_COMMAND_REQUEST_SCHEMA,
  HELIX_ENVIRONMENT_COMMAND_RESULT_SCHEMA,
  helixEnvironmentCommandAuthoritySchema,
  helixEnvironmentCommandRequestSchema,
  helixEnvironmentCommandResultSchema,
} from "@shared/helix-environment-command";

const hash = (character: string): `sha256:${string}` =>
  `sha256:${character.repeat(64)}`;
const now = "2026-08-02T12:00:00.000Z";

describe("environment command contracts", () => {
  it("represents an explicit autonomous full-dispatcher authority without a credential", () => {
    const parsed = helixEnvironmentCommandAuthoritySchema.parse({
      schema: HELIX_ENVIRONMENT_COMMAND_AUTHORITY_SCHEMA,
      command_authority_id: "command_authority:test",
      environment_binding_id: "environment_binding:test",
      room_source_binding_id: "room_source_binding:test",
      room_id: "room:test",
      source_id: "source:test",
      world_id: "minecraft:test",
      adapter_profile_id: "game.minecraft.readonly.v1",
      authority_profile: "server_administrator",
      autonomy_mode: "autonomous",
      approved_categories: [],
      status: "active",
      policy_version: 1,
      issued_at: now,
      expires_at: null,
      revoked_at: null,
      credential_included: false,
      content_role: "environment_command_authority_not_assistant_answer",
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });

    expect(parsed.authority_profile).toBe("server_administrator");
    expect(parsed.autonomy_mode).toBe("autonomous");
    expect(parsed.credential_included).toBe(false);
  });

  it("rejects category-approved and observe policies that exceed their declaration", () => {
    const base = {
      schema: HELIX_ENVIRONMENT_COMMAND_AUTHORITY_SCHEMA,
      command_authority_id: "command_authority:test",
      environment_binding_id: "environment_binding:test",
      room_source_binding_id: "room_source_binding:test",
      room_id: "room:test",
      source_id: "source:test",
      world_id: "minecraft:test",
      adapter_profile_id: "game.minecraft.readonly.v1",
      authority_profile: "observe",
      autonomy_mode: "approved_categories",
      approved_categories: [],
      status: "active",
      policy_version: 1,
      issued_at: now,
      expires_at: null,
      revoked_at: null,
      credential_included: false,
      content_role: "environment_command_authority_not_assistant_answer",
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    } as const;
    expect(helixEnvironmentCommandAuthoritySchema.safeParse(base).success).toBe(
      false,
    );
    expect(
      helixEnvironmentCommandAuthoritySchema.safeParse({
        ...base,
        approved_categories: ["world_build"],
      }).success,
    ).toBe(false);
  });

  it("requires command execution to forbid host access and automatic retry", () => {
    const request = {
      schema: HELIX_ENVIRONMENT_COMMAND_REQUEST_SCHEMA,
      command_request_id: "command_request:test",
      command_authority_id: "command_authority:test",
      command_grant_id: "command_grant:test",
      environment_binding_id: "environment_binding:test",
      room_id: "room:test",
      source_id: "source:test",
      world_id: "minecraft:test",
      participant_id: "participant:test",
      subject_binding_id: "subject_binding:test",
      subject_native_id: "00000000-0000-0000-0000-000000000001",
      run_id: "run:test",
      turn_id: "turn:test",
      provider_execution_id: "provider_execution:test",
      tool_call_id: "tool_call:test",
      command_catalog_id: "command_catalog:test",
      authority_profile: "server_administrator",
      autonomy_mode: "autonomous",
      approved_categories: [],
      policy_version: 1,
      command_text: "execute as @s run time set day",
      command_hash: hash("a"),
      command_root_hint: "execute",
      requested_category: "world_time_weather",
      expected_effect: "world_mutation",
      idempotency_key: "idempotency:test",
      confirmation_state: "approved",
      approval_ref: "approval:test",
      created_at: now,
      deadline_at: "2026-08-02T12:00:30.000Z",
      constraints: {
        max_duration_ms: 30_000,
        max_output_bytes: 64_000,
        automatic_retry_allowed: false,
        host_access_allowed: false,
      },
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    } as const;

    expect(helixEnvironmentCommandRequestSchema.parse(request)).toMatchObject({
      command_root_hint: "execute",
      constraints: {
        automatic_retry_allowed: false,
        host_access_allowed: false,
      },
    });
    expect(
      helixEnvironmentCommandRequestSchema.safeParse({
        ...request,
        constraints: { ...request.constraints, host_access_allowed: true },
      }).success,
    ).toBe(false);
  });

  it("requires results to prove live-dispatcher parsing and prohibit host access", () => {
    const result = helixEnvironmentCommandResultSchema.parse({
      schema: HELIX_ENVIRONMENT_COMMAND_RESULT_SCHEMA,
      command_request_id: "command_request:test",
      command_execution_id: "command_execution:test",
      command_hash: hash("b"),
      command_root: "fill",
      parsed_category: "world_build",
      effect_class: "world_mutation",
      outcome: "succeeded",
      result_code: 64,
      summary: "Changed 64 blocks.",
      output_lines: ["Changed 64 blocks."],
      output_truncated: false,
      affected_count: 64,
      side_effects_performed: true,
      environment_mutation_performed: true,
      server_administration_performed: false,
      parsed_by_live_dispatcher: true,
      host_access_performed: false,
      automatic_retry_performed: false,
      model_invoked: false,
      created_at: now,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.parsed_by_live_dispatcher).toBe(true);
    expect(result.host_access_performed).toBe(false);
  });

  it("represents connector management as a distinct human-only refusal", () => {
    expect(
      helixEnvironmentCommandResultSchema.parse({
        schema: HELIX_ENVIRONMENT_COMMAND_RESULT_SCHEMA,
        command_request_id: "command_request:management-boundary",
        command_execution_id: "command_execution:management-boundary",
        command_hash: hash("c"),
        command_root: "helix",
        parsed_category: "mod_command",
        effect_class: "unknown",
        outcome: "connector_management_forbidden",
        result_code: 0,
        summary:
          "Connector management commands are human-only and are never executable through the runtime agent.",
        output_lines: [],
        output_truncated: false,
        affected_count: 0,
        side_effects_performed: false,
        environment_mutation_performed: false,
        server_administration_performed: false,
        parsed_by_live_dispatcher: false,
        host_access_performed: false,
        automatic_retry_performed: false,
        model_invoked: false,
        created_at: now,
        assistant_answer: false,
        raw_content_included: false,
      }).outcome,
    ).toBe("connector_management_forbidden");
  });
});
