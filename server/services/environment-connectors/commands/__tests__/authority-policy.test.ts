import { describe, expect, it } from "vitest";
import {
  HELIX_ENVIRONMENT_COMMAND_AUTHORITY_SCHEMA,
  HELIX_ENVIRONMENT_COMMAND_MEMBER_GRANT_SCHEMA,
  type HelixEnvironmentCommandAuthority,
  type HelixEnvironmentCommandAuthorityProfile,
  type HelixEnvironmentCommandMemberGrant,
} from "@shared/helix-environment-command";
import { evaluateEnvironmentCommandAdmission } from "../authority-policy";

const now = "2026-08-02T12:00:00.000Z";

const authority = (input: {
  profile: HelixEnvironmentCommandAuthorityProfile;
  autonomy?: "approve_each" | "approved_categories" | "autonomous";
  approvedCategories?: HelixEnvironmentCommandAuthority["approved_categories"];
  status?: HelixEnvironmentCommandAuthority["status"];
  expiresAt?: string | null;
}): HelixEnvironmentCommandAuthority => ({
  schema: HELIX_ENVIRONMENT_COMMAND_AUTHORITY_SCHEMA,
  command_authority_id: "command_authority:test",
  environment_binding_id: "environment_binding:test",
  room_source_binding_id: "room_source_binding:test",
  room_id: "room:test",
  source_id: "source:test",
  world_id: "minecraft:test",
  adapter_profile_id: "game.minecraft.readonly.v1",
  authority_profile: input.profile,
  autonomy_mode: input.autonomy ?? "autonomous",
  approved_categories: input.approvedCategories ?? [],
  status: input.status ?? "active",
  policy_version: 1,
  issued_at: now,
  expires_at: input.expiresAt ?? null,
  revoked_at: null,
  credential_included: false,
  content_role: "environment_command_authority_not_assistant_answer",
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
});

const grant = (
  profile: HelixEnvironmentCommandAuthorityProfile,
  overrides: Partial<HelixEnvironmentCommandMemberGrant> = {},
): HelixEnvironmentCommandMemberGrant => ({
  schema: HELIX_ENVIRONMENT_COMMAND_MEMBER_GRANT_SCHEMA,
  command_grant_id: "command_grant:test",
  command_authority_id: "command_authority:test",
  room_id: "room:test",
  participant_id: "participant:test",
  environment_binding_id: "environment_binding:test",
  subject_binding_id: "subject_binding:test",
  max_authority_profile: profile,
  autonomy_override: null,
  status: "active",
  issued_at: now,
  expires_at: null,
  revoked_at: null,
  content_role: "environment_command_member_grant_not_assistant_answer",
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
  ...overrides,
});

describe("environment command authority policy", () => {
  it("admits the complete dispatcher classification for autonomous server administration", () => {
    const decision = evaluateEnvironmentCommandAdmission({
      authority: authority({ profile: "server_administrator" }),
      grant: grant("server_administrator"),
      category: "server_administration",
      effect: "server_administration",
      confirmationState: "not_required",
      dispatcherVerified: true,
      hostEscapeRequested: false,
      now: new Date(now),
    });
    expect(decision).toMatchObject({
      ok: true,
      effective_profile: "server_administrator",
      effective_autonomy: "autonomous",
      confirmation_required: false,
    });
  });

  it("limits the effective profile to the room member grant", () => {
    const decision = evaluateEnvironmentCommandAdmission({
      authority: authority({ profile: "server_administrator" }),
      grant: grant("player_assistant"),
      category: "world_build",
      effect: "world_mutation",
      confirmationState: "not_required",
      dispatcherVerified: true,
      hostEscapeRequested: false,
      now: new Date(now),
    });
    expect(decision).toMatchObject({
      ok: false,
      code: "command_category_forbidden",
      effective_profile: "player_assistant",
    });
  });

  it("requires approval for mutations outside approved categories", () => {
    const activeAuthority = authority({
      profile: "world_operator",
      autonomy: "approved_categories",
      approvedCategories: ["world_build"],
    });
    const allowed = evaluateEnvironmentCommandAdmission({
      authority: activeAuthority,
      grant: grant("world_operator"),
      category: "world_build",
      effect: "world_mutation",
      confirmationState: "not_required",
      dispatcherVerified: true,
      hostEscapeRequested: false,
      now: new Date(now),
    });
    const blocked = evaluateEnvironmentCommandAdmission({
      authority: activeAuthority,
      grant: grant("world_operator"),
      category: "entity_control",
      effect: "world_mutation",
      confirmationState: "pending",
      dispatcherVerified: true,
      hostEscapeRequested: false,
      now: new Date(now),
    });
    expect(allowed.ok).toBe(true);
    expect(blocked).toMatchObject({
      ok: false,
      code: "command_confirmation_required",
      confirmation_required: true,
    });
  });

  it("never lets full Minecraft authority become host authority", () => {
    const decision = evaluateEnvironmentCommandAdmission({
      authority: authority({ profile: "server_administrator" }),
      grant: grant("server_administrator"),
      category: "mod_command",
      effect: "unknown",
      confirmationState: "not_required",
      dispatcherVerified: true,
      hostEscapeRequested: true,
      now: new Date(now),
    });
    expect(decision).toMatchObject({
      ok: false,
      code: "command_host_escape_rejected",
    });
  });

  it("requires the live dispatcher even when policy otherwise admits the command", () => {
    const decision = evaluateEnvironmentCommandAdmission({
      authority: authority({ profile: "server_administrator" }),
      grant: grant("server_administrator"),
      category: "world_build",
      effect: "world_mutation",
      confirmationState: "not_required",
      dispatcherVerified: false,
      hostEscapeRequested: false,
      now: new Date(now),
    });
    expect(decision).toMatchObject({
      ok: false,
      code: "command_dispatcher_verification_required",
    });
  });

  it("expires source authority and member grants independently", () => {
    const expiredAuthority = evaluateEnvironmentCommandAdmission({
      authority: authority({
        profile: "server_administrator",
        expiresAt: "2026-08-02T11:59:59.000Z",
      }),
      grant: grant("server_administrator"),
      category: "query",
      effect: "read_only",
      confirmationState: "not_required",
      dispatcherVerified: true,
      hostEscapeRequested: false,
      now: new Date(now),
    });
    const expiredGrant = evaluateEnvironmentCommandAdmission({
      authority: authority({ profile: "server_administrator" }),
      grant: grant("server_administrator", {
        expires_at: "2026-08-02T11:59:59.000Z",
      }),
      category: "query",
      effect: "read_only",
      confirmationState: "not_required",
      dispatcherVerified: true,
      hostEscapeRequested: false,
      now: new Date(now),
    });
    expect(expiredAuthority.code).toBe("command_authority_expired");
    expect(expiredGrant.code).toBe("command_grant_expired");
  });
});
