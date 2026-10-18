import { describe, expect, it } from "vitest";
import { buildHelixAccountCapabilityPolicy } from "@shared/helix-account-session";
import { HELIX_SHARED_LIVE_ROOM_READ_SCOPE } from "@shared/contracts/helix-shared-live-room-agent.v1";
import {
  HELIX_ENVIRONMENT_ADAPTER_ADMISSION_SCHEMA,
  type HelixEnvironmentAdapterAdmissionProjection,
} from "@shared/helix-environment-adapter-profile";
import {
  HELIX_EVENT_JOURNAL_QUERY_RESULT_SCHEMA,
  HELIX_EVENT_JOURNAL_RECORD_SCHEMA,
  type HelixEventJournalRecord,
  type HelixEventJournalQueryResult,
} from "@shared/helix-event-journal-query";
import {
  HELIX_ROOM_SOURCE_ADMISSION_SCHEMA,
  type HelixRoomSourceAdmission,
} from "@shared/helix-room-source-ingress";
import {
  HELIX_ENVIRONMENT_STATE_SNAPSHOT_SCHEMA,
  type HelixEnvironmentStateSnapshot,
} from "@shared/helix-environment-state-snapshot";
import {
  HELIX_SHARED_REALTIME_ROOM_SCHEMA,
  type HelixSharedRealtimeRoom,
} from "@shared/helix-shared-realtime-room";
import type { HelixWorldEvent } from "@shared/helix-world-event";
import type { HelixEnvironmentDurableGoalProjection } from "@shared/helix-environment-durable-goal";
import type { SharedLiveRoomRunRoomBinding } from "../../../shared-live-room-control/binding-store";
import {
  clearEventJournalForTest,
  queryEventJournal,
  recordEventJournalEvent,
} from "../../../situation-room/event-journal-store";
import { resolveEnvironmentAdapterProfile } from "../../../situation-room/environment-adapter-registry";
import {
  buildRoomSourceRequestEvidenceRef,
  HELIX_ROOM_SOURCE_SECRET_REDACTION,
  projectRoomSourceRequestId,
} from "../../../situation-room/room-source-ingress-security";
import type { SharedRealtimeRoomMembership } from "../../realtime-room/room-store";
import type { HelixExternalCapabilityPolicy } from "../../runtime/external-capability-policy";
import {
  boundRoomEvidenceManifest,
  executeBoundRoomEvidenceCapability,
  HELIX_BOUND_ROOM_EVIDENCE_CAPABILITY,
  HELIX_BOUND_ROOM_EVIDENCE_ERROR_SCHEMA,
  HELIX_BOUND_ROOM_EVIDENCE_OBSERVATION_SCHEMA,
  type BoundRoomEvidenceDependencies,
  type BoundRoomEvidenceSourceCandidate,
} from "../bound-room-evidence";

const NOW = new Date("2026-07-26T20:00:00.000Z");
const TURN_ID = "ask:bound-room-evidence:turn-1";
const RUN_ID = "run-bound-room-evidence";
const ROOM_ID = "room-bound-evidence";
const RUN_BINDING_ID = "run-room-binding:bound-evidence";
const SOURCE_BINDING_ID = "room-source-binding:bound-evidence";
const RAW_REQUEST_ID = "request-bound-evidence";
const SOURCE_ID = "source:room-ingress:bound-evidence";
const WORLD_ID = "minecraft:minehut:world";
const REQUEST_PROJECTION_ID = projectRoomSourceRequestId({
  bindingId: SOURCE_BINDING_ID,
  requestId: RAW_REQUEST_ID,
});
const REQUEST_REF = buildRoomSourceRequestEvidenceRef({
  bindingId: SOURCE_BINDING_ID,
  requestId: RAW_REQUEST_ID,
});
const adapterRecord = resolveEnvironmentAdapterProfile({
  domainAdapter: "minecraft.minehut.v1",
  worldId: WORLD_ID,
});
const adapterAdmission: HelixEnvironmentAdapterAdmissionProjection = {
  schema: HELIX_ENVIRONMENT_ADAPTER_ADMISSION_SCHEMA,
  admission_id: "environment_adapter_admission:bound-evidence",
  adapter_profile_id: adapterRecord.profile.profile_id,
  adapter_profile_version: adapterRecord.profile.profile_version,
  adapter_contract_hash: adapterRecord.contract_hash,
  manifest_id: "manifest:bound-evidence",
  manifest_hash: `sha256:${"a".repeat(64)}`,
  producer_epoch_ref: "adapter_epoch:bound-evidence",
  source_family: adapterRecord.profile.source_family,
  mechanics_collection_ids: adapterRecord.profile.mechanics_collections.map(
    (collection) => collection.collection_id,
  ),
  admitted_at: "2026-07-26T19:59:45.000Z",
  content_role: "adapter_admission_not_assistant_answer",
  reentry_required: true,
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
};

const consent = {
  schema: "helix.shared_realtime_room.consent.v1" as const,
  microphone_to_room: false,
  microphone_to_model: false,
  transcript_to_room: false,
  screen_to_model: false,
  screen_thumbnail_to_room: false,
  model_audio_output: false,
  consent_version: 3,
  consent_receipt_ref: "room-consent:profile-a:3",
  updated_at: "2026-07-26T19:30:00.000Z",
};

const admission: HelixRoomSourceAdmission = {
  schema: HELIX_ROOM_SOURCE_ADMISSION_SCHEMA,
  transport: "room_source_ingress",
  binding_id: SOURCE_BINDING_ID,
  request_id: REQUEST_PROJECTION_ID,
  room_id: ROOM_ID,
  source_id: SOURCE_ID,
  world_id: WORLD_ID,
  domain_adapter: "minecraft.minehut.v1",
  adapter_admission: adapterAdmission,
  evidence_refs: [
    SOURCE_BINDING_ID,
    REQUEST_REF,
    adapterAdmission.admission_id,
    adapterAdmission.adapter_contract_hash,
    adapterAdmission.manifest_id,
    adapterAdmission.manifest_hash,
    adapterAdmission.producer_epoch_ref,
    ...adapterAdmission.mechanics_collection_ids,
  ],
  content_role: "source_admission_not_assistant_answer",
  reentry_required: true,
  model_invoked: false,
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
};

const binding: SharedLiveRoomRunRoomBinding = {
  bindingId: RUN_BINDING_ID,
  runId: RUN_ID,
  owner: {
    tenantId: "tenant-a",
    issuer: "https://issuer.example",
    subjectId: "subject-a",
    accountProfileId: "profile-a",
  },
  roomId: ROOM_ID,
  authorizedByProfileId: "profile-a",
  participantIdAtBind: "participant-a",
  memberRoleAtBind: "owner",
  consentVersionAtBind: consent.consent_version,
  consentReceiptRefAtBind: consent.consent_receipt_ref,
  status: "active",
  version: 1,
  createdAt: "2026-07-26T19:00:00.000Z",
  updatedAt: "2026-07-26T19:00:00.000Z",
  revokedAt: null,
  revokeReason: null,
};

const membership: SharedRealtimeRoomMembership = {
  roomId: ROOM_ID,
  profileId: "profile-a",
  participantId: "participant-a",
  displayName: "Operator",
  role: "owner",
  presence: "present",
  consent,
  roomStatus: "active",
};

const room: HelixSharedRealtimeRoom = {
  schema: HELIX_SHARED_REALTIME_ROOM_SCHEMA,
  room_id: ROOM_ID,
  title: "Bound Minecraft Room",
  status: "active",
  max_participants: 2,
  self_participant_id: "participant-a",
  participants: [
    {
      participant_id: "participant-a",
      display_name: "Operator",
      role: "owner",
      presence: "present",
      consent,
      joined_at: "2026-07-26T19:00:00.000Z",
      last_seen_at: "2026-07-26T19:59:55.000Z",
    },
  ],
  participant_context_cards: [],
  readiness: {
    participant_count: 1,
    required_participant_count: 2,
    ready: false,
    missing_participant_count: 1,
    missing_consent_by_participant: {},
  },
  runtime: {
    runtime_id: null,
    state: "idle",
    topology: "single_shared_model",
    transport_owner: "unbound",
    model: null,
    active_speaker_participant_id: null,
    provider_session_ref_hash: null,
    realtime_session_ref_hash: null,
    reserved_by_participant_id: null,
    started_at: null,
    updated_at: "2026-07-26T19:59:55.000Z",
    limitations: [],
  },
  created_at: "2026-07-26T19:00:00.000Z",
  updated_at: "2026-07-26T19:59:55.000Z",
  closed_at: null,
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
};

const sourceCandidate: BoundRoomEvidenceSourceCandidate = {
  bindingId: SOURCE_BINDING_ID,
  roomId: ROOM_ID,
  sourceId: SOURCE_ID,
  worldId: WORLD_ID,
  domainAdapter: "minecraft.minehut.v1",
  requestProjectionId: REQUEST_PROJECTION_ID,
  requestSentAt: "2026-07-26T19:59:49.000Z",
  requestReceivedAt: "2026-07-26T19:59:50.000Z",
  adapterAdmission,
  sourceFamily: adapterRecord.profile.source_family,
  domain: adapterRecord.profile.domain,
  requestFreshnessMaxAgeMs:
    adapterRecord.profile.freshness.ingress_request_max_age_ms,
  freshnessMaxAgeMs: adapterRecord.profile.freshness.observation_max_age_ms,
  mechanicsCollectionIds: adapterAdmission.mechanics_collection_ids,
  admission,
};

const event = (
  ts = "2026-07-26T19:59:51.000Z",
  evidenceRefs = [REQUEST_REF],
): HelixEventJournalRecord => ({
  schema: HELIX_EVENT_JOURNAL_RECORD_SCHEMA,
  journal_event_id: `event-journal:${ts}`,
  source_family: "minecraft",
  room_id: ROOM_ID,
  source_id: SOURCE_ID,
  world_id: WORLD_ID,
  thread_id: null,
  event_type: "player_position",
  actor_id: "minecraft-player",
  actor_label: "Operator",
  ts,
  evidence_refs: evidenceRefs,
  compact_summary: "Operator is at x=12, y=64, z=-4.",
  raw_content_included: false,
  assistant_answer: false,
});

const eventResult = (
  events: HelixEventJournalRecord[],
): HelixEventJournalQueryResult => ({
  schema: HELIX_EVENT_JOURNAL_QUERY_RESULT_SCHEMA,
  query_id: "query-bound-room-evidence",
  matched_count: events.length,
  returned_count: events.length,
  events,
  raw_content_included: false,
  assistant_answer: false,
  context_policy: "compact_context_pack_only",
  created_at: NOW.toISOString(),
});

const policy = (): HelixExternalCapabilityPolicy => ({
  runId: RUN_ID,
  tenantId: "tenant-a",
  issuer: "https://issuer.example",
  subjectId: "subject-a",
  accountProfileId: "profile-a",
  accountType: "developer",
  oauthScopes: new Set([HELIX_SHARED_LIVE_ROOM_READ_SCOPE]),
  accountPolicy: buildHelixAccountCapabilityPolicy("developer"),
  allowedCapabilities: [HELIX_BOUND_ROOM_EVIDENCE_CAPABILITY],
  readOnly: true,
});

const dependencies = (
  overrides: Partial<BoundRoomEvidenceDependencies> = {},
): Partial<BoundRoomEvidenceDependencies> => ({
  bindingStore: {
    getActiveRunRoomBinding: async () => binding,
  },
  readMembership: async () => membership,
  readRoom: async () => room,
  readSourceCandidate: async () => sourceCandidate,
  queryEvents: () => eventResult([event()]),
  readLatestSnapshot: () => null,
  readDurableGoals: async () => [],
  now: () => NOW,
  freshnessMs: () => 120_000,
  ...overrides,
});

describe("authenticated bound-room evidence gateway", () => {
  it("advertises one zero-identity-argument, read-only, nonterminal capability", () => {
    expect(boundRoomEvidenceManifest).toMatchObject({
      capability_id: HELIX_BOUND_ROOM_EVIDENCE_CAPABILITY,
      mode: "read",
      mutating: false,
      shell_access: false,
      code_mutation: false,
      terminal_eligible: false,
      post_tool_model_step_required: true,
      input_schema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    });
  });

  it("returns bounded current-turn evidence with exact request provenance and no caller identity secrets", async () => {
    const result = await executeBoundRoomEvidenceCapability({
      turnId: TURN_ID,
      policy: policy(),
      dependencies: dependencies(),
    });

    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      observation: {
        schema: HELIX_BOUND_ROOM_EVIDENCE_OBSERVATION_SCHEMA,
        capability_key: HELIX_BOUND_ROOM_EVIDENCE_CAPABILITY,
        status: "succeeded",
        current_turn_id: TURN_ID,
        current_turn_evidence: true,
        identity: {
          run_id: RUN_ID,
          run_room_binding_ref: RUN_BINDING_ID,
          room_id: ROOM_ID,
          source_request_ref: REQUEST_REF,
          source_id: SOURCE_ID,
          world_id: WORLD_ID,
        },
        authorization: {
          run_owner_verified: true,
          active_run_room_binding_verified: true,
          current_account_policy_rechecked: true,
          current_room_membership_rechecked: true,
          binding_consent_identity_rechecked: true,
          participant_id: "participant-a",
          binding_consent_version: consent.consent_version,
          binding_consent_receipt_ref: consent.consent_receipt_ref,
          room_member_consent_receipt_ref: consent.consent_receipt_ref,
        },
        provenance: {
          source_admission_verified: true,
          exact_request_provenance_verified: true,
          evidence_refs: expect.arrayContaining([REQUEST_REF]),
          current_turn_reentry_required: true,
          raw_source_payload_included: false,
          raw_world_events_included: false,
        },
        execution_enabled: false,
        may_execute_live_actions: false,
        may_perform_read_only_probes: false,
        reentry_required: true,
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
    });
    const serialized = JSON.stringify(result.observation);
    expect(serialized).not.toContain("tenant-a");
    expect(serialized).not.toContain("subject-a");
    expect(serialized).not.toContain("https://issuer.example");
    expect(serialized).not.toContain("bearer_token");
  });

  it("includes bounded participant-authorized durable goal evidence without granting answer authority", async () => {
    const durableGoal: HelixEnvironmentDurableGoalProjection = {
      schema: "helix.environment_durable_goal_projection.v1",
      goal_id: "environment_durable_goal:one",
      revision: 19,
      latest_event_hash: `sha256:${"a".repeat(64)}`,
      status: "completed",
      objective: {
        objective_text: "Preserve viable control through one connector recovery.",
        goal_kind: "custom_survival",
        domain: "minecraft",
        game_version: "1.21.8",
        mechanics_collection_ref: null,
        milestones: [{
          milestone_id: "restored_viable_control",
          description: "Restore viable control after a connector epoch change.",
          dependency_milestone_ids: [],
          required_postcondition_ids: ["health_restored", "controls_released"],
        }],
      },
      identity: {
        owner_profile_id: "profile-a",
        host_ref: "environment_device:one",
        connector_installation_id: "installation:one",
        device_id: "device:one",
        environment_binding_id: "environment:one",
        room_source_binding_id: SOURCE_BINDING_ID,
        room_id: ROOM_ID,
        goal_owner_participant_id: "participant-a",
        participant_id: "participant-a",
        authority_participant_id: "participant-a",
        subject_binding_id: "subject:one",
        subject_native_id: "player:one",
        source_id: SOURCE_ID,
        world_id: WORLD_ID,
        producer_epoch_ref: "producer-epoch:two",
        action_authority_id: "authority:one",
        authority_policy_version: 2,
        authority_expires_at: "2026-07-27T00:00:00.000Z",
        run_id: RUN_ID,
        turn_id: TURN_ID,
      },
      active_milestone_id: null,
      milestones: [{
        milestone_id: "restored_viable_control",
        description: "Restore viable control after a connector epoch change.",
        status: "completed",
        required_postcondition_ids: ["health_restored", "controls_released"],
        completed_postcondition_ids: ["health_restored", "controls_released"],
      }],
      recent_attempts: [],
      attempt_count: 1,
      latest_checkpoint: {
        checkpoint_id: "checkpoint:restored",
        event_id: "environment_durable_goal_event:checkpoint",
        observation_revision: 8,
        verified_facts: { health: 20, controls_released: true },
        evidence_refs: ["environment_action_evidence:restored"],
      },
      recovery: {
        required: false,
        reason: null,
        rebound_event_id: "environment_durable_goal_event:rebound",
      },
      consumed_semantic_wake_refs: ["environment_mail:wake"],
      event_refs: [
        "environment_durable_goal_event:created",
        "environment_durable_goal_event:rebound",
        "environment_durable_goal_event:completed",
      ],
      content_role: "environment_durable_goal_projection_not_assistant_answer",
      reentry_required: true,
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    };
    const result = await executeBoundRoomEvidenceCapability({
      turnId: TURN_ID,
      policy: policy(),
      dependencies: dependencies({
        readDurableGoals: async () => [durableGoal],
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      observation: {
        durable_goal_observations: {
          goal_count: 1,
          goals: [{
            goal_id: durableGoal.goal_id,
            revision: 19,
            status: "completed",
            milestones: [{ status: "completed" }],
            latest_checkpoint: {
              checkpoint_id: "checkpoint:restored",
              verified_facts: { health: 20, controls_released: true },
            },
            recovery: { required: false },
            answer_authority: false,
            terminal_eligible: false,
          }],
        },
        provenance: {
          evidence_refs: expect.arrayContaining([
            "environment_durable_goal_event:completed",
            "environment_action_evidence:restored",
            "environment_mail:wake",
          ]),
        },
      },
    });

    const mismatched = await executeBoundRoomEvidenceCapability({
      turnId: TURN_ID,
      policy: policy(),
      dependencies: dependencies({
        readDurableGoals: async () => [{
          ...durableGoal,
          identity: {
            ...durableGoal.identity,
            world_id: "minecraft:wrong-world",
          },
        }],
      }),
    });
    expect(mismatched).toMatchObject({
      ok: false,
      status: "blocked",
      error: "bound_room_evidence_identity_mismatch",
      observation: {
        answer_authority: false,
        terminal_eligible: false,
      },
    });
  });

  it("projects a second game adapter through generic environment evidence without a Minecraft alias", async () => {
    const syntheticRecord = resolveEnvironmentAdapterProfile({
      domainAdapter: "synthetic_game.fixture.v1",
      worldId: "synthetic-game:arena",
      includeFixtureProfiles: true,
    });
    const syntheticAdapterAdmission: HelixEnvironmentAdapterAdmissionProjection =
      {
        ...adapterAdmission,
        admission_id: "environment_adapter_admission:synthetic-bound-evidence",
        adapter_profile_id: syntheticRecord.profile.profile_id,
        adapter_profile_version: syntheticRecord.profile.profile_version,
        adapter_contract_hash: syntheticRecord.contract_hash,
        manifest_id: "manifest:synthetic-bound-evidence",
        manifest_hash: `sha256:${"b".repeat(64)}`,
        producer_epoch_ref: "adapter_epoch:synthetic-bound-evidence",
        source_family: syntheticRecord.profile.source_family,
        mechanics_collection_ids:
          syntheticRecord.profile.mechanics_collections.map(
            (collection) => collection.collection_id,
          ),
      };
    const syntheticAdmission: HelixRoomSourceAdmission = {
      ...admission,
      world_id: "synthetic-game:arena",
      domain_adapter: "synthetic_game.fixture.v1",
      adapter_admission: syntheticAdapterAdmission,
      evidence_refs: [
        SOURCE_BINDING_ID,
        REQUEST_REF,
        syntheticAdapterAdmission.admission_id,
        syntheticAdapterAdmission.adapter_contract_hash,
        syntheticAdapterAdmission.manifest_id,
        syntheticAdapterAdmission.manifest_hash,
        syntheticAdapterAdmission.producer_epoch_ref,
        ...syntheticAdapterAdmission.mechanics_collection_ids,
      ],
    };
    const syntheticCandidate: BoundRoomEvidenceSourceCandidate = {
      ...sourceCandidate,
      worldId: "synthetic-game:arena",
      domainAdapter: "synthetic_game.fixture.v1",
      adapterAdmission: syntheticAdapterAdmission,
      sourceFamily: syntheticRecord.profile.source_family,
      domain: syntheticRecord.profile.domain,
      requestFreshnessMaxAgeMs:
        syntheticRecord.profile.freshness.ingress_request_max_age_ms,
      freshnessMaxAgeMs:
        syntheticRecord.profile.freshness.observation_max_age_ms,
      mechanicsCollectionIds:
        syntheticAdapterAdmission.mechanics_collection_ids,
      admission: syntheticAdmission,
    };
    const syntheticEvent: HelixEventJournalRecord = {
      ...event(),
      source_family: "synthetic_game",
      world_id: "synthetic-game:arena",
      event_type: "position_sample",
      compact_summary: "Fixture actor is at x=3, y=7.",
    };
    const result = await executeBoundRoomEvidenceCapability({
      turnId: TURN_ID,
      policy: policy(),
      dependencies: dependencies({
        readSourceCandidate: async () => syntheticCandidate,
        queryEvents: () => eventResult([syntheticEvent]),
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      observation: {
        adapter: {
          profile_id: "game.synthetic_fixture.readonly.v1",
          source_family: "synthetic_game",
          domain: "game",
          mechanics_collection_ids: ["mechanics.synthetic_game.fixture.v1"],
        },
        environment_observations: {
          events: [
            expect.objectContaining({
              source_family: "synthetic_game",
              world_id: "synthetic-game:arena",
            }),
          ],
        },
        terminal_eligible: false,
        assistant_answer: false,
      },
    });
    expect(result.observation).not.toHaveProperty("minecraft_observations");
  });

  it("redacts source bearer and claim patterns from every compact model-visible field", async () => {
    const sourceBearer = `helix_room_src_${"a".repeat(42)}-`;
    const sourceClaim = `room_source_claim_${"b".repeat(43)}`;
    const snapshot: HelixEnvironmentStateSnapshot = {
      schema: HELIX_ENVIRONMENT_STATE_SNAPSHOT_SCHEMA,
      snapshot_id: "snapshot:secret-redaction",
      domain: "minecraft",
      domain_adapter: sourceCandidate.domainAdapter,
      room_id: ROOM_ID,
      world_id: WORLD_ID,
      source_id: SOURCE_ID,
      actor_id: "minecraft-player",
      actor_label: sourceBearer,
      ts: "2026-07-26T19:59:52.000Z",
      inventory_state: {
        selected_item: {
          item_type: sourceBearer,
          display_name: `item ${sourceClaim}`,
          count: 1,
        },
        carried_items: [
          {
            item_type: "minecraft:stone",
            display_name: sourceBearer,
            count: 4,
          },
        ],
      },
      section_hashes: {},
      changed_sections: ["inventory_state"],
      evidence_refs: [REQUEST_REF, `claim-evidence:${sourceClaim}`],
      deterministic: true,
      model_invoked: false,
      assistant_answer: false,
      raw_payload_included: false,
      context_policy: "compact_context_pack_only",
    };
    const result = await executeBoundRoomEvidenceCapability({
      turnId: TURN_ID,
      policy: policy(),
      dependencies: dependencies({
        queryEvents: () =>
          eventResult([
            {
              ...event(),
              actor_label: sourceBearer,
              compact_summary: `Observed ${sourceBearer} with ${sourceClaim}.`,
              evidence_refs: [REQUEST_REF, `secret:${sourceBearer}`],
            },
          ]),
        readLatestSnapshot: () => snapshot,
      }),
    });

    expect(result.ok).toBe(true);
    const serialized = JSON.stringify(result.observation);
    expect(serialized).not.toContain(sourceBearer);
    expect(serialized).not.toContain(sourceClaim);
    expect(serialized).toContain(HELIX_ROOM_SOURCE_SECRET_REDACTION);
  });

  it("fails stale exact-provenance observations as typed, retryable, nonterminal evidence", async () => {
    const result = await executeBoundRoomEvidenceCapability({
      turnId: TURN_ID,
      policy: policy(),
      dependencies: dependencies({
        queryEvents: () => eventResult([event("2026-07-26T19:50:00.000Z")]),
      }),
    });

    expect(result).toMatchObject({
      ok: false,
      error: "bound_room_evidence_stale",
      observation: {
        schema: HELIX_BOUND_ROOM_EVIDENCE_ERROR_SCHEMA,
        status: "stale",
        retryable: true,
        current_turn_id: TURN_ID,
        assistant_answer: false,
        terminal_eligible: false,
      },
    });
  });

  it("fails a fresh durable request with no exact process-local journal evidence as unavailable", async () => {
    const result = await executeBoundRoomEvidenceCapability({
      turnId: TURN_ID,
      policy: policy(),
      dependencies: dependencies({
        queryEvents: () => eventResult([]),
      }),
    });

    expect(result).toMatchObject({
      ok: false,
      error: "bound_room_evidence_unavailable",
      observation: {
        schema: HELIX_BOUND_ROOM_EVIDENCE_ERROR_SCHEMA,
        status: "unavailable",
        retryable: true,
        current_turn_id: TURN_ID,
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
      },
    });
  });

  it("rejects changed membership identity before reading any room-source evidence", async () => {
    let sourceReads = 0;
    const result = await executeBoundRoomEvidenceCapability({
      turnId: TURN_ID,
      policy: policy(),
      dependencies: dependencies({
        readMembership: async () => ({
          ...membership,
          participantId: "participant-rejoined",
        }),
        readSourceCandidate: async () => {
          sourceReads += 1;
          return sourceCandidate;
        },
      }),
    });

    expect(sourceReads).toBe(0);
    expect(result).toMatchObject({
      ok: false,
      error: "bound_room_membership_changed",
      observation: {
        status: "blocked",
        terminal_eligible: false,
      },
    });
  });

  it("rejects changed membership role before reading any room-source evidence", async () => {
    let sourceReads = 0;
    const result = await executeBoundRoomEvidenceCapability({
      turnId: TURN_ID,
      policy: policy(),
      dependencies: dependencies({
        readMembership: async () => ({
          ...membership,
          role: "participant",
        }),
        readSourceCandidate: async () => {
          sourceReads += 1;
          return sourceCandidate;
        },
      }),
    });

    expect(sourceReads).toBe(0);
    expect(result).toMatchObject({
      ok: false,
      error: "bound_room_membership_changed",
      observation: {
        status: "blocked",
        terminal_eligible: false,
      },
    });
  });

  it.each([
    {
      label: "version and receipt",
      changedConsent: {
        ...consent,
        consent_version: consent.consent_version + 1,
        consent_receipt_ref: "room-consent:profile-a:4",
      },
    },
    {
      label: "receipt at the same version",
      changedConsent: {
        ...consent,
        consent_receipt_ref: "room-consent:profile-a:replacement",
      },
    },
  ])(
    "rejects changed consent identity ($label) before reading any room-source evidence",
    async ({ changedConsent }) => {
      let sourceReads = 0;
      const result = await executeBoundRoomEvidenceCapability({
        turnId: TURN_ID,
        policy: policy(),
        dependencies: dependencies({
          readMembership: async () => ({
            ...membership,
            consent: changedConsent,
          }),
          readSourceCandidate: async () => {
            sourceReads += 1;
            return sourceCandidate;
          },
        }),
      });

      expect(sourceReads).toBe(0);
      expect(result).toMatchObject({
        ok: false,
        error: "bound_room_consent_changed",
        observation: {
          schema: HELIX_BOUND_ROOM_EVIDENCE_ERROR_SCHEMA,
          status: "blocked",
          retryable: false,
          answer_authority: false,
          assistant_answer: false,
          terminal_eligible: false,
        },
      });
    },
  );

  it("fails closed when consent changes after evidence selection but before success projection", async () => {
    let membershipReads = 0;
    let sourceReads = 0;
    const result = await executeBoundRoomEvidenceCapability({
      turnId: TURN_ID,
      policy: policy(),
      dependencies: dependencies({
        readMembership: async () => {
          membershipReads += 1;
          return membershipReads === 1
            ? membership
            : {
                ...membership,
                consent: {
                  ...consent,
                  consent_version: consent.consent_version + 1,
                  consent_receipt_ref:
                    "room-consent:profile-a:changed-during-read",
                },
              };
        },
        readSourceCandidate: async () => {
          sourceReads += 1;
          return sourceCandidate;
        },
      }),
    });

    expect(membershipReads).toBe(2);
    expect(sourceReads).toBe(1);
    expect(result).toMatchObject({
      ok: false,
      error: "bound_room_consent_changed",
      observation: {
        schema: HELIX_BOUND_ROOM_EVIDENCE_ERROR_SCHEMA,
        status: "blocked",
        retryable: false,
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
      },
    });
  });

  it("does not accept an observation that lacks the current durable request reference", async () => {
    const result = await executeBoundRoomEvidenceCapability({
      turnId: TURN_ID,
      policy: policy(),
      dependencies: dependencies({
        queryEvents: () => eventResult([event(undefined, [SOURCE_BINDING_ID])]),
      }),
    });

    expect(result).toMatchObject({
      ok: false,
      error: "bound_room_evidence_unavailable",
      observation: {
        status: "unavailable",
        terminal_eligible: false,
      },
    });
  });

  it("adds exact server-owned ingress admission refs to the existing event journal", () => {
    clearEventJournalForTest();
    const worldEvent: HelixWorldEvent = {
      schema: "helix.world_event.v1",
      world_id: WORLD_ID,
      room_id: ROOM_ID,
      source_id: SOURCE_ID,
      event_type: "player_position",
      actor_id: "minecraft-player",
      actor_label: "Operator",
      ts: "2026-07-26T19:59:51.000Z",
      evidence_refs: [],
      meta: {
        domain_adapter: "minecraft.minehut.v1",
      },
    };
    try {
      recordEventJournalEvent({
        event: worldEvent,
        sourceFamily: "minecraft",
        sourceAdmission: admission,
      });
      const result = queryEventJournal({
        room_id: ROOM_ID,
        source_id: SOURCE_ID,
        world_id: WORLD_ID,
        include_raw_events: false,
        sourceAdmission: admission,
      });
      expect(result.events).toHaveLength(1);
      expect(result.events[0]?.evidence_refs).toEqual(
        expect.arrayContaining([SOURCE_BINDING_ID, REQUEST_REF]),
      );
      expect(result.events[0]?.raw_content_included).toBe(false);
    } finally {
      clearEventJournalForTest();
    }
  });

  it("never stores recognized bearer or claim values in protected journal records", () => {
    clearEventJournalForTest();
    const sourceBearer = `helix_room_src_${"c".repeat(43)}`;
    const sourceClaim = `room_source_claim_${"d".repeat(43)}`;
    const worldEvent: HelixWorldEvent = {
      schema: "helix.world_event.v1",
      world_id: WORLD_ID,
      room_id: ROOM_ID,
      source_id: SOURCE_ID,
      event_type: "player_position",
      actor_id: "minecraft-player",
      actor_label: sourceBearer,
      ts: "2026-07-26T19:59:51.000Z",
      evidence_refs: [REQUEST_REF, `claim:${sourceClaim}`],
      meta: {
        domain_adapter: "minecraft.minehut.v1",
        item: {
          display_name: sourceBearer,
        },
      },
    };
    try {
      recordEventJournalEvent({
        event: worldEvent,
        sourceFamily: "minecraft",
        sourceAdmission: admission,
      });
      const result = queryEventJournal({
        room_id: ROOM_ID,
        source_id: SOURCE_ID,
        world_id: WORLD_ID,
        include_raw_events: true,
        sourceAdmission: admission,
      });
      const serialized = JSON.stringify(result);
      expect(result.events).toHaveLength(1);
      expect(serialized).not.toContain(sourceBearer);
      expect(serialized).not.toContain(sourceClaim);
      expect(serialized).toContain(HELIX_ROOM_SOURCE_SECRET_REDACTION);
    } finally {
      clearEventJournalForTest();
    }
  });
});
