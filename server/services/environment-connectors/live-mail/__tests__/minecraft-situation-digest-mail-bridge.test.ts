import {
  HELIX_ENVIRONMENT_EVENT_SCHEMA,
  type HelixEnvironmentEvent,
} from "@shared/helix-environment-event-stream";
import {
  HELIX_ENVIRONMENT_ADAPTER_ADMISSION_SCHEMA,
  type HelixEnvironmentAdapterAdmissionProjection,
} from "@shared/helix-environment-adapter-profile";
import {
  HELIX_ROOM_SOURCE_ADMISSION_SCHEMA,
  type HelixRoomSourceAdmission,
} from "@shared/helix-room-source-ingress";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildEnvironmentSituationDigest } from "../../events/event-stream-store";
import {
  listStagePlayLiveSourceMailItems,
  resetStagePlayLiveSourceMailboxForTest,
} from "../../../stage-play/stage-play-live-source-mailbox-store";
import {
  listStagePlayLiveSourceMailWakeRequests,
  resetStagePlayLiveSourceMailWakeStoreForTest,
} from "../../../stage-play/stage-play-live-source-mail-wake-store";
import { runNextMailWakeRequest } from "../../../stage-play/stage-play-live-source-mail-wake-runner";
import {
  getLatestStagePlayProcessedMailPacket,
  getStagePlayMicroReasonerRun,
  resetStagePlayProcessedMailPacketStoreForTest,
} from "../../../stage-play/stage-play-processed-mail-packet-store";
import {
  listStagePlayLiveSourceMailTranscriptEntries,
  resetStagePlayLiveSourceMailTranscriptStoreForTest,
} from "../../../stage-play/stage-play-live-source-mail-transcript-store";
import {
  bridgeMinecraftPlayerSituationDigestToLiveMail,
  bridgeMinecraftSituationDigestToLiveMail,
  resetMinecraftSituationDigestMailBridgeForTest,
} from "../minecraft-situation-digest-mail-bridge";
import type { EnvironmentActionConnectorClaim } from "../../actions";

const roomId = "shared_realtime_room:g4-test";
const sourceId = "source:room-ingress:g4-test";
const worldId = "minecraft:local:g4-test";
const bindingId = "room_source_binding:g4-test";
const epochRef = "environment_action_epoch:g4-test";
const subjectRef = "subject_binding:g4-test";
const participantId = "participant:g4-test";
const selectedPlayerRef = "environment_subject:g4-test";
const selectedPlayerNativeId = "player-uuid:g4-test";
const now = new Date("2026-08-21T12:00:10.000Z");

const sourceAdmission: HelixRoomSourceAdmission = {
  schema: HELIX_ROOM_SOURCE_ADMISSION_SCHEMA,
  transport: "room_source_ingress",
  binding_id: bindingId,
  request_id: "room_source_request:g4-test",
  room_id: roomId,
  source_id: sourceId,
  world_id: worldId,
  domain_adapter: "minecraft.fabric_client.v1",
  evidence_refs: [
    bindingId,
    `room_source_request:${bindingId}:room_source_request:g4-test`,
  ],
  content_role: "source_admission_not_assistant_answer",
  reentry_required: true,
  model_invoked: false,
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
};

const adapterAdmission: HelixEnvironmentAdapterAdmissionProjection = {
  schema: HELIX_ENVIRONMENT_ADAPTER_ADMISSION_SCHEMA,
  admission_id: "environment_adapter_admission:g4-test",
  adapter_profile_id: "environment_adapter_profile:minecraft-fabric-test",
  adapter_profile_version: 1,
  adapter_contract_hash: `sha256:${"a".repeat(64)}`,
  manifest_id: "environment_manifest:g4-test",
  manifest_hash: `sha256:${"b".repeat(64)}`,
  producer_epoch_ref: epochRef,
  source_family: "minecraft.fabric",
  mechanics_collection_ids: [],
  admitted_at: "2026-08-21T12:00:00.000Z",
  content_role: "adapter_admission_not_assistant_answer",
  reentry_required: true,
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
};

const actionClaim: EnvironmentActionConnectorClaim = {
  ownerProfileId: "profile-owner",
  authorityId: "environment_action_authority:g4-test",
  credentialId: "environment_action_credential:g4-test",
  connectorInstallationId: "environment_connector_installation:g4-test",
  environmentBindingId: "environment_binding:g4-test",
  roomSourceBindingId: bindingId,
  roomId,
  sourceId,
  worldId,
  actionAdapterProfileId: "environment_adapter_profile:minecraft-player-test",
  actionDomainAdapter: "minecraft.fabric_client.v1",
  sourceAdapterProfileId: "environment_adapter_profile:minecraft-source-test",
  participantId,
  subjectBindingId: subjectRef,
  subjectNativeId: selectedPlayerNativeId,
  policyVersion: 1,
};

const event = (input: {
  sequence: number;
  eventType?: string;
  attributes?: Record<string, unknown>;
  subject?: string | null;
  epoch?: string;
}): HelixEnvironmentEvent => ({
  schema: HELIX_ENVIRONMENT_EVENT_SCHEMA,
  event_id: `environment_event:g4-${input.sequence}-${input.eventType ?? "snapshot"}`,
  sequence: input.sequence,
  event_type: input.eventType ?? "environment_state_snapshot",
  producer_plane: "player_embodiment",
  domain: "minecraft",
  domain_adapter: "minecraft.fabric_client.v1",
  room_id: roomId,
  source_id: sourceId,
  world_id: worldId,
  producer_epoch_ref: input.epoch ?? epochRef,
  subject_ref: input.subject === undefined ? subjectRef : input.subject,
  workflow_ref: null,
  summary: "Measured Minecraft state.",
  attributes: input.attributes ?? {},
  evidence_refs: [`environment_evidence:g4-${input.sequence}`],
  occurred_at: new Date(now.getTime() - 5_000 + input.sequence * 100).toISOString(),
  observed_at: new Date(now.getTime() - 5_000 + input.sequence * 100).toISOString(),
  provenance: "measured",
  raw_event_included: false,
  content_role: "environment_event_not_assistant_answer",
  answer_authority: false,
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
});

const digest = (input: Parameters<typeof event>[0]) =>
  buildEnvironmentSituationDigest({
    environmentBindingId: bindingId,
    events: [event(input)],
  });

const bridge = (
  value: ReturnType<typeof digest>,
  overrides: Partial<Parameters<typeof bridgeMinecraftSituationDigestToLiveMail>[0]> = {},
) => bridgeMinecraftSituationDigestToLiveMail({
  digest: value,
  roomSourceBindingId: bindingId,
  sourceAdmission,
  adapterAdmission,
  subjectIdentity: value.subject_ref
    ? {
        participantId,
        subjectBindingId: value.subject_ref,
        selectedPlayerRef,
        selectedPlayerNativeId,
      }
    : null,
  freshnessCeilingMs: 30_000,
  now,
  ...overrides,
});

beforeEach(() => {
  resetMinecraftSituationDigestMailBridgeForTest();
  resetStagePlayLiveSourceMailboxForTest();
  resetStagePlayLiveSourceMailWakeStoreForTest();
  resetStagePlayProcessedMailPacketStoreForTest();
  resetStagePlayLiveSourceMailTranscriptStoreForTest();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Minecraft situation-digest semantic wake bridge", () => {
  it("records a healthy routine baseline and coalesces position-only changes", () => {
    const baseline = bridge(digest({
      sequence: 1,
      attributes: { actor: { health: 20, food: 20, position: { x: 0, y: 64, z: 0 } } },
    }));
    const moved = bridge(digest({
      sequence: 2,
      attributes: { actor: { health: 20, food: 20, position: { x: 8, y: 64, z: 0 } } },
    }));
    expect(baseline).toMatchObject({ status: "suppressed", reason: "routine_baseline_recorded" });
    expect(moved).toMatchObject({ status: "suppressed", reason: "equivalent_semantic_state_coalesced" });
    expect(listStagePlayLiveSourceMailItems()).toHaveLength(0);
  });

  it("enqueues exact nonterminal evidence and one wake for a hazard transition", () => {
    bridge(digest({ sequence: 1, attributes: { actor: { health: 20, air: 300 }, hazards: { submerged: false } } }));
    const result = bridge(digest({
      sequence: 2,
      attributes: { actor: { health: 20, air: 30 }, hazards: { submerged: true } },
    }));
    expect(result).toMatchObject({ status: "enqueued", reason: "semantic_change_enqueued", wake_expected: true });
    const [mail] = listStagePlayLiveSourceMailItems({ sourceKind: "minecraft_world_event" });
    expect(mail).toMatchObject({
      mailId: result.mail_id,
      threadId: `helix-ask:room:${roomId}`,
      roomId,
      environmentId: bindingId,
      sourceId,
      sourceKind: "minecraft_world_event",
      status: "unread",
      environmentIdentity: {
        producerPlane: "player_embodiment",
        roomSourceBindingId: bindingId,
        worldId,
        producerEpochRef: epochRef,
        subjectRef,
        participantId,
        selectedPlayerRef,
        selectedPlayerNativeId,
        observationRevision: 2,
        digestId: result.digest_id,
        provenanceValid: true,
      },
      answer_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
    });
    expect(listStagePlayLiveSourceMailWakeRequests({ mailId: mail.mailId })).toHaveLength(1);
  });

  it("coalesces duplicate digests without queuing another wake", () => {
    const value = digest({ sequence: 1, eventType: "advancement.earned", attributes: { focus: { advancement: "stone_age" } } });
    expect(bridge(value).status).toBe("enqueued");
    expect(bridge(value)).toMatchObject({ status: "suppressed", reason: "duplicate_digest_coalesced" });
    expect(listStagePlayLiveSourceMailWakeRequests()).toHaveLength(1);
  });

  it.each([
    ["unbound source", "environment_wake_source_unbound", (value: ReturnType<typeof digest>) => bridge(value, { sourceAdmission: null })],
    ["stale", "environment_wake_digest_stale", (value: ReturnType<typeof digest>) => bridge(value, { now: new Date(now.getTime() + 60_000) })],
    ["wrong environment", "environment_wake_wrong_environment", (value: ReturnType<typeof digest>) => bridge(value, { sourceAdmission: { ...sourceAdmission, world_id: "minecraft:local:other" } })],
    ["wrong epoch", "environment_wake_wrong_epoch", (value: ReturnType<typeof digest>) => bridge(value, { adapterAdmission: { ...adapterAdmission, producer_epoch_ref: "environment_action_epoch:other" } })],
  ])("blocks %s evidence with an actionable stable reason", (_label, reason, run) => {
    expect(run(digest({ sequence: 1, eventType: "advancement.earned" }))).toMatchObject({ status: "blocked", reason });
    expect(listStagePlayLiveSourceMailItems()).toHaveLength(0);
  });

  it("blocks actor evidence without an exact selected subject", () => {
    expect(bridge(digest({ sequence: 1, subject: null, attributes: { actor: { health: 20 } } }))).toMatchObject({
      status: "blocked",
      reason: "environment_wake_subject_unbound",
    });
  });

  it("blocks actor evidence when the participant binding points at another subject", () => {
    const value = digest({ sequence: 1, attributes: { actor: { health: 20 } } });
    expect(bridge(value, {
      subjectIdentity: {
        participantId,
        subjectBindingId: "subject_binding:other",
        selectedPlayerRef,
        selectedPlayerNativeId,
      },
    })).toMatchObject({ status: "blocked", reason: "environment_wake_subject_unbound" });
  });

  it("blocks a digest whose provenance validation failed", () => {
    const value = {
      ...digest({ sequence: 1, eventType: "advancement.earned" }),
      provenance_valid: false,
    } as ReturnType<typeof digest>;
    expect(bridge(value)).toMatchObject({
      status: "blocked",
      reason: "environment_wake_provenance_invalid",
    });
  });

  it("blocks a regressed observation revision after a newer baseline", () => {
    bridge(digest({ sequence: 4, attributes: { actor: { health: 20 } } }));
    expect(bridge(digest({ sequence: 3, attributes: { actor: { health: 18 } } }))).toMatchObject({
      status: "blocked",
      reason: "environment_wake_revision_regressed",
    });
  });

  it("carries a semantic event through processed mail, current-turn re-entry, decision, and loop state", async () => {
    const bridged = bridge(digest({
      sequence: 7,
      eventType: "advancement.earned",
      attributes: {
        actor: { health: 20, air: 300 },
        focus: { advancement: "minecraft:story/mine_stone" },
      },
    }));
    expect(bridged.status).toBe("enqueued");

    let observedPacketId: string | null = null;
    const result = await runNextMailWakeRequest({
      threadId: `helix-ask:room:${roomId}`,
      roomId,
      environmentId: bindingId,
      now: "2026-08-21T12:00:11.000Z",
      pressureCheck: () => ({ deferred: false }),
      askTurnRunner: async ({ wakeRequest }) => {
        const packet = getLatestStagePlayProcessedMailPacket({
          sourceId,
          mailId: bridged.mail_id,
        });
        observedPacketId = packet?.packetId ?? null;
        return {
          ok: true,
          askTurnId: "ask:g4-semantic-wake-test",
          selectedTargetSource: "live_source_mailbox",
          selectedCapability: "live_env.record_live_source_mail_decision",
          response: {
            turn_id: "ask:g4-semantic-wake-test",
            current_turn_artifact_ledger: [
              {
                kind: "live_environment_tool_observation",
                payload: {
                  tool_name: "live_env.read_processed_live_source_mail",
                  observation: {
                    artifactId: "stage_play_processed_mail_packet",
                    packetId: packet?.packetId,
                    packets: packet ? [packet] : [],
                  },
                },
              },
              {
                kind: "live_environment_tool_observation",
                payload: {
                  tool_name: "live_env.record_live_source_mail_decision",
                  observation: {
                    artifactId: "stage_play_live_source_mail_decision",
                    decisionId: "stage_play_live_source_mail_decision:g4-semantic-wake-test",
                    decision: "record_interpretation",
                    mailIds: wakeRequest.mailIds,
                    evidenceRefs: [bridged.digest_id, packet?.packetId].filter(Boolean),
                  },
                },
              },
            ],
          },
          errorCode: null,
        };
      },
    });

    expect(observedPacketId).toMatch(/^stage_play_processed_mail_packet:/);
    expect(result).toMatchObject({
      status: "completed",
      askTurnId: "ask:g4-semantic-wake-test",
      decisionIds: ["stage_play_live_source_mail_decision:g4-semantic-wake-test"],
      assistant_answer: false,
      terminal_eligible: false,
    });
    const rows = listStagePlayLiveSourceMailTranscriptEntries({
      threadId: `helix-ask:room:${roomId}`,
      askTurnId: "ask:g4-semantic-wake-test",
    }).map((entry) => entry.row);
    expect(rows.map((row) => row.rowKind)).toEqual(expect.arrayContaining([
      "processed_mail_packet",
      "micro_reasoner_run",
      "agent_decision",
      "loop_state",
    ]));
    expect(getLatestStagePlayProcessedMailPacket({
      sourceId,
      mailId: bridged.mail_id,
    })?.evidenceRefs).toEqual(expect.arrayContaining([bridged.digest_id]));
  });

  it("keeps Minecraft semantic wake preprocessing deterministic when prompted LLM processing is globally enabled", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key-never-used");
    vi.stubEnv("STAGE_PLAY_MICRO_REASONER_LLM_ENABLED", "1");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Minecraft semantic wake attempted a private model request."),
    );
    const bridged = bridge(digest({
      sequence: 9,
      eventType: "advancement.earned",
      attributes: { focus: { advancement: "minecraft:story/upgrade_tools" } },
    }));
    expect(bridged.status).toBe("enqueued");

    await runNextMailWakeRequest({
      threadId: `helix-ask:room:${roomId}`,
      roomId,
      environmentId: bindingId,
      now: "2026-08-21T12:00:11.000Z",
      pressureCheck: () => ({ deferred: false }),
      askTurnRunner: async () => ({
        ok: true,
        askTurnId: "ask:g4-deterministic-preprocess-test",
        selectedTargetSource: "live_source_mailbox",
        selectedCapability: "live_env.read_processed_live_source_mail",
        response: {
          turn_id: "ask:g4-deterministic-preprocess-test",
          current_turn_artifact_ledger: [],
        },
        errorCode: null,
      }),
    });

    const packet = getLatestStagePlayProcessedMailPacket({
      sourceId,
      mailId: bridged.mail_id,
    });
    expect(packet).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(packet?.evidenceRefs.some((ref) => ref.startsWith("prompted_micro_reasoner:"))).toBe(false);
    expect(packet?.microReasonerRunRefs.map((ref) => getStagePlayMicroReasonerRun(ref)?.modelUsed))
      .toEqual(expect.arrayContaining(["deterministic"]));
    expect(packet?.microReasonerRunRefs.every(
      (ref) => getStagePlayMicroReasonerRun(ref)?.modelUsed === "deterministic",
    )).toBe(true);
  });

  it("admits a Player Embodiment workflow event through its separate action identity", () => {
    const value = digest({
      sequence: 11,
      eventType: "workflow.succeeded",
      attributes: { actor: { health: 20, air: 300 } },
    });
    const result = bridgeMinecraftPlayerSituationDigestToLiveMail({
      digest: value,
      claim: actionClaim,
      subjectIdentity: {
        participantId,
        subjectBindingId: subjectRef,
        selectedPlayerRef,
        selectedPlayerNativeId,
      },
      freshnessCeilingMs: 30_000,
      now,
    });
    expect(result).toMatchObject({
      status: "enqueued",
      reason: "semantic_change_enqueued",
      identity: {
        participant_id: participantId,
        subject_ref: subjectRef,
        selected_player_native_id: selectedPlayerNativeId,
      },
    });
  });

  it("blocks Player Embodiment evidence bound to a different room participant", () => {
    const value = digest({ sequence: 12, eventType: "workflow.failed" });
    const result = bridgeMinecraftPlayerSituationDigestToLiveMail({
      digest: value,
      claim: actionClaim,
      subjectIdentity: {
        participantId: "participant:other",
        subjectBindingId: subjectRef,
        selectedPlayerRef,
        selectedPlayerNativeId,
      },
      freshnessCeilingMs: 30_000,
      now,
    });
    expect(result).toMatchObject({
      status: "blocked",
      reason: "environment_wake_wrong_environment",
    });
  });
});
