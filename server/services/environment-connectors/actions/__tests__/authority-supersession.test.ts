import { describe, expect, it } from "vitest";

import {
  assertEnvironmentActionLifecycle,
  canCancelEnvironmentActionWorkflowStatus,
  isEnvironmentActionAuthorityLeaseExtension,
  planEnvironmentActionAuthoritySupersession,
} from "../authority-store";

describe("environment action authority supersession", () => {
  it("keeps authority reduction available after every environment liveness gate expires", () => {
    const inactive = {
      environment_status: "revoked",
      source_status: "expired",
      room_status: "closed",
      adapter_admission_status: "expired",
    };

    expect(() => assertEnvironmentActionLifecycle(
      inactive,
      "authority_reduction",
    )).not.toThrow();
    expect(() => assertEnvironmentActionLifecycle(inactive, "active"))
      .toThrowError(expect.objectContaining({
        code: "action_environment_binding_inactive",
      }));
  });

  it("permits release-only cancellation after the broker observation deadline", () => {
    expect(canCancelEnvironmentActionWorkflowStatus("timed_out")).toBe(true);
    expect(canCancelEnvironmentActionWorkflowStatus("succeeded")).toBe(false);
    expect(canCancelEnvironmentActionWorkflowStatus("failed")).toBe(false);
  });

  it("retires every older active lease across player subject epochs", () => {
    const plan = planEnvironmentActionAuthoritySupersession([
      {
        action_authority_id: "environment_action_authority:old-subject",
        policy_version: 4,
        created_at: new Date("2026-08-05T18:00:00.000Z"),
      },
      {
        action_authority_id: "environment_action_authority:new-subject",
        policy_version: 5,
        created_at: new Date("2026-08-05T18:05:00.000Z"),
      },
      {
        action_authority_id: "environment_action_authority:duplicate-new-subject",
        policy_version: 5,
        created_at: new Date("2026-08-05T18:06:00.000Z"),
      },
    ] as never);

    expect(plan).toEqual({
      nextPolicyVersion: 6,
      canonicalPriorAuthorityId:
        "environment_action_authority:duplicate-new-subject",
      supersededAuthorityIds: [
        "environment_action_authority:duplicate-new-subject",
        "environment_action_authority:new-subject",
        "environment_action_authority:old-subject",
      ],
    });
  });

  it("starts the first authority at policy version one", () => {
    expect(planEnvironmentActionAuthoritySupersession([])).toEqual({
      nextPolicyVersion: 1,
      canonicalPriorAuthorityId: null,
      supersededAuthorityIds: [],
    });
  });

  it("extends an unchanged finite lease without rotating connector identity", () => {
    expect(isEnvironmentActionAuthorityLeaseExtension({
      prior: {
        adapter_profile_id: "minecraft.player_client.fabric.v1",
        domain_adapter: "minecraft.player_client.fabric.v1",
        participant_id: "participant:owner",
        subject_binding_id: "subject:player",
        subject_native_id: "DatDamPig",
        allowed_capability_ids: ["capability:b", "capability:a"],
        autonomy_mode: "approved_capabilities",
        manual_override_policy: "cancel",
        expires_at: "2026-08-14T03:00:00.000Z",
      },
      adapterProfileId: "minecraft.player_client.fabric.v1",
      domainAdapter: "minecraft.player_client.fabric.v1",
      participantId: "participant:owner",
      subjectBindingId: "subject:player",
      subjectNativeId: "DatDamPig",
      allowedCapabilityIds: ["capability:a", "capability:b"],
      autonomyMode: "approved_capabilities",
      manualOverridePolicy: "cancel",
      expiresAt: "2026-08-14T04:00:00.000Z",
    } as never)).toBe(true);
  });

  it("requires supersession when authority policy or subject identity changes", () => {
    const base = {
      prior: {
        adapter_profile_id: "minecraft.player_client.fabric.v1",
        domain_adapter: "minecraft.player_client.fabric.v1",
        participant_id: "participant:owner",
        subject_binding_id: "subject:player",
        subject_native_id: "DatDamPig",
        allowed_capability_ids: ["capability:a"],
        autonomy_mode: "approved_capabilities",
        manual_override_policy: "cancel",
        expires_at: "2026-08-14T03:00:00.000Z",
      },
      adapterProfileId: "minecraft.player_client.fabric.v1",
      domainAdapter: "minecraft.player_client.fabric.v1",
      participantId: "participant:owner",
      subjectBindingId: "subject:player",
      subjectNativeId: "DatDamPig",
      allowedCapabilityIds: ["capability:a"],
      autonomyMode: "approved_capabilities",
      manualOverridePolicy: "cancel",
      expiresAt: "2026-08-14T04:00:00.000Z",
    } as const;

    expect(isEnvironmentActionAuthorityLeaseExtension({
      ...base,
      allowedCapabilityIds: ["capability:a", "capability:b"],
    } as never)).toBe(false);
    expect(isEnvironmentActionAuthorityLeaseExtension({
      ...base,
      subjectNativeId: "AnotherPlayer",
    } as never)).toBe(false);
    expect(isEnvironmentActionAuthorityLeaseExtension({
      ...base,
      expiresAt: "2026-08-14T02:00:00.000Z",
    } as never)).toBe(false);
  });
});
