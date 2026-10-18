import { buildHelixAccountCapabilityPolicy } from "@shared/helix-account-session";
import {
  HELIX_ENVIRONMENT_SITUATION_DIGEST_OBSERVATION_SCHEMA,
  HELIX_ENVIRONMENT_SITUATION_DIGEST_SCHEMA,
  HELIX_MINECRAFT_SITUATION_DIGEST_READ_CAPABILITY,
  type HelixEnvironmentSituationDigestObservation,
} from "@shared/helix-environment-event-stream";
import { describe, expect, it, vi } from "vitest";
import type { HelixWorkstationGatewayAccountContext } from "../account-policy";
import {
  environmentSituationDigestMinecraftManifest,
  executeEnvironmentSituationDigestGatewayCapability,
  type EnvironmentSituationDigestGatewayDependencies,
} from "../environment-situation-digest";

const ROOM_ID = "shared_realtime_room:digest-test";
const PROFILE_ID = "profile:digest-test";
const PARTICIPANT_ID = "participant:digest-test";
const ENVIRONMENT_ID = "environment_binding:digest-test";

const accountContext = (): HelixWorkstationGatewayAccountContext => {
  const accountPolicy = buildHelixAccountCapabilityPolicy("developer");
  const session = {
    schema: "helix.account_session.v1" as const,
    session_id: "account_session:digest-test",
    profile: {
      profile_id: PROFILE_ID,
      display_name: "Digest tester",
      auth_mode: "guest" as const,
      account_type: "developer" as const,
      provider: "guest" as const,
      created_at: "2026-08-05T12:00:00.000Z",
      updated_at: "2026-08-05T12:00:00.000Z",
    },
    account_policy: accountPolicy,
    status: "active" as const,
    memory_scope: "session_only" as const,
    created_at: "2026-08-05T12:00:00.000Z",
    updated_at: "2026-08-05T12:00:00.000Z",
    expires_at: "2026-08-06T12:00:00.000Z",
  };
  return {
    session_id: session.session_id,
    profile_id: PROFILE_ID,
    trusted_account_session: true,
    account_session: session,
    account_policy: accountPolicy,
  };
};

const context = {
  environmentBindingId: ENVIRONMENT_ID,
  roomId: ROOM_ID,
  sourceId: "source:room-ingress:digest-test",
  worldId: "minecraft:local:digest-test",
  participantId: PARTICIPANT_ID,
  subjectBindingId: "subject_binding:digest-test",
};

const freshObservation: HelixEnvironmentSituationDigestObservation = {
  schema: HELIX_ENVIRONMENT_SITUATION_DIGEST_OBSERVATION_SCHEMA,
  outcome: "fresh",
  summary: "Fresh digest available.",
  digest: {
    schema: HELIX_ENVIRONMENT_SITUATION_DIGEST_SCHEMA,
    digest_id: "environment_situation_digest:digest-test",
    room_id: ROOM_ID,
    source_id: context.sourceId,
    world_id: context.worldId,
    producer_epoch_ref: "environment_action_epoch:digest-test",
    producer_plane: "player_embodiment",
    subject_ref: context.subjectBindingId,
    window_started_at: "2026-08-05T12:00:00.000Z",
    window_ended_at: "2026-08-05T12:00:01.000Z",
    latest_event_sequence: 1,
    event_counts: { "workflow.progress": 1 },
    latest_event_refs: ["environment_event:digest-test"],
    situation: {
      actor: { position: { x: 4, y: 64, z: 0 } },
      inventory: null,
      hazards: null,
      focus: null,
      active_workflow: { workflow_ref: "environment_action_workflow:test" },
    },
    changed_fields: ["actor.position", "active_workflow"],
    derived_from_event_refs: ["environment_event:digest-test"],
    derived_from_snapshot_refs: [],
    digest_hash:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    observed_at: "2026-08-05T12:00:01.000Z",
    provenance_valid: true,
    raw_events_included: false,
    content_role: "environment_situation_digest_not_assistant_answer",
    reentry_required: true,
    answer_authority: false,
    assistant_answer: false,
    terminal_eligible: false,
    raw_content_included: false,
  },
  evidence_ref: "environment_situation_digest_evidence:digest-test",
  observed_at: "2026-08-05T12:00:01.000Z",
  provenance_valid: true,
  eligible_for_current_turn_reentry: true,
  content_role:
    "environment_situation_digest_observation_not_assistant_answer",
  reentry_required: true,
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
};

const deps = (
  overrides: Partial<EnvironmentSituationDigestGatewayDependencies> = {},
): Partial<EnvironmentSituationDigestGatewayDependencies> => ({
  listRoomEnvironments: vi.fn(async () => [
    {
      environment_binding_id: ENVIRONMENT_ID,
      source_label: "Local Fabric 1.21.8",
      domain: "minecraft",
      connection_status: "active",
    },
  ] as never),
  readMembership: vi.fn(async () => ({
    participantId: PARTICIPANT_ID,
    role: "owner",
    roomStatus: "active",
  }) as never),
  resolveContext: vi.fn(async () => context),
  readDigest: vi.fn(async () => freshObservation),
  ...overrides,
});

describe("Minecraft situation digest workstation gateway", () => {
  it("publishes one read-only, nonterminal, host-free digest tool", () => {
    expect(environmentSituationDigestMinecraftManifest).toMatchObject({
      capability_id: HELIX_MINECRAFT_SITUATION_DIGEST_READ_CAPABILITY,
      mode: "read",
      mutating: false,
      shell_access: false,
      code_mutation: false,
      terminal_eligible: false,
      post_tool_model_step_required: true,
      observation_schema:
        HELIX_ENVIRONMENT_SITUATION_DIGEST_OBSERVATION_SCHEMA,
      assistant_answer: false,
    });
  });

  it("resolves room, environment and player identity server-side and re-enters a fresh digest", async () => {
    const resolveContext = vi.fn(async () => context);
    const result = await executeEnvironmentSituationDigestGatewayCapability({
      turnId: "ask:digest:turn-1",
      arguments: { freshness_requirement_ms: 15_000 },
      accountContext: accountContext(),
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: deps({ resolveContext }),
    });
    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      observation: {
        outcome: "fresh",
        provenance_valid: true,
        eligible_for_current_turn_reentry: true,
        terminal_eligible: false,
      },
      executedArgs: { freshness_requirement_ms: 15_000 },
    });
    expect(resolveContext).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      profileId: PROFILE_ID,
      environmentBindingId: ENVIRONMENT_ID,
      participantId: PARTICIPANT_ID,
    });
    expect(JSON.stringify(result.executedArgs)).not.toContain("binding_ref");
  });

  it("fails before environment lookup without a trusted room session", async () => {
    const listRoomEnvironments = vi.fn();
    const result = await executeEnvironmentSituationDigestGatewayCapability({
      turnId: "ask:digest:untrusted",
      accountContext: null,
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: { listRoomEnvironments },
    });
    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      error: "forbidden",
      observation: {
        outcome: "forbidden",
        digest: null,
        provenance_valid: false,
        eligible_for_current_turn_reentry: false,
      },
    });
    expect(listRoomEnvironments).not.toHaveBeenCalled();
  });

  it("preserves stale digest rejection as a typed retryable observation", async () => {
    const stale = {
      ...freshObservation,
      outcome: "stale" as const,
      summary: "Digest is stale.",
      digest: null,
      provenance_valid: false,
      eligible_for_current_turn_reentry: false,
    };
    const result = await executeEnvironmentSituationDigestGatewayCapability({
      turnId: "ask:digest:stale",
      accountContext: accountContext(),
      conversationThreadId: `helix-ask:room:${ROOM_ID}`,
      dependencies: deps({ readDigest: vi.fn(async () => stale) }),
    });
    expect(result).toMatchObject({
      ok: false,
      status: "failed",
      error: "stale",
      repairAction: "retry",
      observation: {
        outcome: "stale",
        digest: null,
        terminal_eligible: false,
      },
    });
  });
});
