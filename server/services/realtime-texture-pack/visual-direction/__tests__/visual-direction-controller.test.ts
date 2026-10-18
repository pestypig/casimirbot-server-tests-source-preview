import { describe, expect, it } from "vitest";
import {
  HELIX_ENVIRONMENT_SITUATION_DIGEST_SCHEMA,
  helixEnvironmentSituationDigestSchema,
  type HelixEnvironmentSituationDigest,
} from "@shared/helix-environment-event-stream";
import {
  REALTIME_TEXTURE_PACK_MINECRAFT_VISUAL_DIRECTION_PROFILE_ID,
  REALTIME_TEXTURE_PACK_VISUAL_CUE_FAMILIES,
  buildRealtimeTexturePackSourceBinding,
  buildRealtimeTexturePackVisualDirectionSupport,
  type RealtimeTexturePackSourceBindingV1,
  type RealtimeTexturePackVisualDirectionSupportV1,
} from "@shared/realtime-texture-pack-visual-direction";
import type { EnvironmentSituationDigestRecordedEvent } from "../../../environment-connectors/events/event-stream-store";
import { RealtimeTexturePackVisualDirectionController } from "../visual-direction-controller";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const BASE_TIME = Date.parse("2026-08-29T16:00:05.000Z");

const support = (
  overrides: Partial<RealtimeTexturePackVisualDirectionSupportV1> = {},
) =>
  buildRealtimeTexturePackVisualDirectionSupport({
    support_id: "rtp_visual_support:minecraft:controller",
    adapter_profile_id: "game.minecraft.readonly.v1",
    adapter_profile_version: 1,
    adapter_kind: "minecraft.fabric_client.v1",
    controller_profile_id:
      REALTIME_TEXTURE_PACK_MINECRAFT_VISUAL_DIRECTION_PROFILE_ID,
    controller_profile_version: 1,
    supported_cue_families: [...REALTIME_TEXTURE_PACK_VISUAL_CUE_FAMILIES],
    compatibility_state: "supported",
    observed_at: "2026-08-29T16:00:00.000Z",
    expires_at: "2026-08-29T16:02:00.000Z",
    ...overrides,
  });

const binding = (
  overrides: Partial<RealtimeTexturePackSourceBindingV1> = {},
) =>
  buildRealtimeTexturePackSourceBinding({
    binding_id: "rtp_source_binding:minecraft:controller",
    binding_revision: 1,
    capture_session_id: "rtp_capture_session:controller",
    visual_source_id: "display_media_source:minecraft:controller",
    visual_source_origin: "browser_getDisplayMedia",
    visual_source_surface: "window",
    mode: "environment_reactive",
    environment_context: {
      environment_id: "environment_binding:minecraft:controller",
      room_id: "shared_realtime_room:controller",
      source_id: "source:room-ingress:controller",
      world_id: "minecraft:local:controller",
      producer_plane: "player_embodiment",
      producer_epoch_ref: "producer_epoch:controller",
      subject_ref: "subject_binding:controller",
      adapter_profile_id: "game.minecraft.readonly.v1",
      adapter_profile_version: 1,
      support_id: "rtp_visual_support:minecraft:controller",
      controller_profile_id:
        REALTIME_TEXTURE_PACK_MINECRAFT_VISUAL_DIRECTION_PROFILE_ID,
      controller_profile_version: 1,
      max_digest_age_ms: 15_000,
    },
    policy_revision: 1,
    status: "active",
    created_at: "2026-08-29T16:00:00.000Z",
    expires_at: "2026-08-29T16:02:00.000Z",
    revoked_at: null,
    revocation_reason: null,
    ...overrides,
  });

const digest = (
  overrides: Partial<HelixEnvironmentSituationDigest> = {},
): HelixEnvironmentSituationDigest =>
  helixEnvironmentSituationDigestSchema.parse({
    schema: HELIX_ENVIRONMENT_SITUATION_DIGEST_SCHEMA,
    digest_id: "environment_situation_digest:controller:8",
    room_id: "shared_realtime_room:controller",
    source_id: "source:room-ingress:controller",
    world_id: "minecraft:local:controller",
    producer_epoch_ref: "producer_epoch:controller",
    producer_plane: "player_embodiment",
    subject_ref: "subject_binding:controller",
    window_started_at: "2026-08-29T16:00:00.000Z",
    window_ended_at: "2026-08-29T16:00:04.000Z",
    latest_event_sequence: 8,
    event_counts: { "workflow.progress": 1 },
    latest_event_refs: ["environment_event:controller:8"],
    situation: {
      actor: {
        dimension: "minecraft:overworld",
        biome: "minecraft:dripstone_caves",
        time_class: "night",
        weather: "rain",
        light_level: 3,
        health: 20,
        food_level: 20,
      },
      inventory: null,
      hazards: { near_lava: true },
      focus: { kind: "terrain" },
      active_workflow: {
        action_kind: "explore",
        workflow_state: "running",
      },
    },
    changed_fields: ["actor.biome", "actor.light_level", "hazards.near_lava"],
    derived_from_event_refs: ["environment_event:controller:8"],
    derived_from_snapshot_refs: [],
    digest_hash: HASH_A,
    observed_at: "2026-08-29T16:00:04.000Z",
    provenance_valid: true,
    raw_events_included: false,
    content_role: "environment_situation_digest_not_assistant_answer",
    reentry_required: true,
    answer_authority: false,
    assistant_answer: false,
    terminal_eligible: false,
    raw_content_included: false,
    ...overrides,
  });

const event = (
  value = digest(),
  environmentBindingId = "environment_binding:minecraft:controller",
): EnvironmentSituationDigestRecordedEvent => ({
  environment_binding_id: environmentBindingId,
  digest: value,
});

const fixture = () => {
  let now = BASE_TIME;
  let subscriber:
    | ((value: EnvironmentSituationDigestRecordedEvent) => void)
    | null = null;
  let unsubscribeCount = 0;
  const controller = new RealtimeTexturePackVisualDirectionController({
    controllerSessionId: "rtp_visual_controller:test",
    binding: binding(),
    support: support(),
    config: {
      preset_id: "playable",
      custom_direction: "luminous mineral cathedral",
      enabled_cue_families: [...REALTIME_TEXTURE_PACK_VISUAL_CUE_FAMILIES],
      targets: ["native_shader", "overlay"],
      treatment_ttl_ms: 5_000,
    },
    now: () => now,
    subscribeDigest: (listener) => {
      subscriber = listener;
      return () => {
        unsubscribeCount += 1;
        subscriber = null;
      };
    },
  });
  return {
    controller,
    emit: (value: EnvironmentSituationDigestRecordedEvent) => subscriber?.(value),
    setNow: (value: number) => {
      now = value;
    },
    unsubscribeCount: () => unsubscribeCount,
  };
};

describe("Realtime Texture Pack VDC-3 visual-direction controller", () => {
  it("subscribes to the canonical digest source and correlates exact target requests", () => {
    const harness = fixture();
    harness.controller.start();
    harness.emit(event());

    const compiled = harness.controller.compileForFrame({
      sourceFrameId: "rtp_source_frame:controller:1",
    });
    expect(compiled.compilation.cue_state).toBe("current_cue");
    expect(compiled.target_requests).toHaveLength(2);
    for (const request of compiled.target_requests) {
      expect(request).toMatchObject({
        source_binding_id: binding().binding_id,
        source_binding_revision: binding().binding_revision,
        capture_session_id: binding().capture_session_id,
        source_frame_id: "rtp_source_frame:controller:1",
        cue_packet_id: compiled.compilation.treatment.cue_packet_id,
        visual_treatment_revision_id:
          compiled.compilation.treatment.visual_treatment_revision_id,
        treatment_hash: compiled.compilation.treatment.treatment_hash,
        status: "pending",
        presentation_only: true,
        environment_action_authority: false,
        world_mutation_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
      });
    }
    expect(harness.controller.inspectState()).toMatchObject({
      status: "active",
      latest_digest_id: digest().digest_id,
      latest_observation_revision: 8,
      pending_request_count: 2,
      last_failure_reason: null,
    });
  });

  it("coalesces exact replay, ignores unrelated bindings, and rejects out-of-order digests", () => {
    const harness = fixture();
    harness.controller.start();
    expect(harness.controller.ingestDigestEvent(event())).toBe("accepted");
    expect(harness.controller.ingestDigestEvent(event())).toBe("coalesced");
    expect(
      harness.controller.ingestDigestEvent(
        event(digest(), "environment_binding:minecraft:unrelated"),
      ),
    ).toBe("ignored_unrelated");
    expect(
      harness.controller.ingestDigestEvent(
        event(
          digest({
            digest_id: "environment_situation_digest:controller:7",
            latest_event_sequence: 7,
            digest_hash: HASH_B,
          }),
        ),
      ),
    ).toBe("rejected_out_of_order");
    expect(harness.controller.inspectState()).toMatchObject({
      latest_observation_revision: 8,
      last_failure_reason: "realtime_texture_pack_digest_revision_out_of_order",
    });
  });

  it("rejects same-revision conflicts without replacing the current cue", () => {
    const harness = fixture();
    harness.controller.start();
    expect(harness.controller.ingestDigestEvent(event())).toBe("accepted");
    expect(
      harness.controller.ingestDigestEvent(
        event(
          digest({
            digest_id: "environment_situation_digest:controller:conflict",
            digest_hash: HASH_B,
          }),
        ),
      ),
    ).toBe("rejected");
    expect(harness.controller.inspectState()).toMatchObject({
      latest_digest_id: digest().digest_id,
      latest_observation_revision: 8,
      last_failure_reason: "realtime_texture_pack_cue_revision_conflict",
    });
  });

  it("aborts older dispatched requests when a newer treatment is compiled", () => {
    const harness = fixture();
    harness.controller.start();
    harness.controller.ingestDigestEvent(event());
    const first = harness.controller.compileForFrame({
      sourceFrameId: "rtp_source_frame:controller:1",
    });
    const dispatched = harness.controller.takeTargetRequest(
      first.target_requests[1].request_id,
    );
    expect(dispatched.signal.aborted).toBe(false);

    harness.setNow(BASE_TIME + 2_000);
    expect(
      harness.controller.ingestDigestEvent(
        event(
          digest({
            digest_id: "environment_situation_digest:controller:9",
            latest_event_sequence: 9,
            digest_hash: HASH_B,
            observed_at: "2026-08-29T16:00:06.000Z",
            window_ended_at: "2026-08-29T16:00:06.000Z",
          }),
        ),
      ),
    ).toBe("accepted");
    const second = harness.controller.compileForFrame({
      sourceFrameId: "rtp_source_frame:controller:2",
    });

    expect(dispatched.signal.aborted).toBe(true);
    expect(first.target_requests[0]).toMatchObject({
      status: "canceled",
      cancellation_reason: "superseded_by_newer_treatment",
    });
    expect(first.target_requests[1]).toMatchObject({
      status: "canceled",
      cancellation_reason: "superseded_by_newer_treatment",
    });
    expect(second.compilation.treatment.visual_treatment_revision).toBe(2);
    expect(second.target_requests.every((request) => request.status === "pending")).toBe(true);
  });

  it("falls back to static direction when the latest admitted cue expires", () => {
    const harness = fixture();
    harness.controller.start();
    harness.controller.ingestDigestEvent(event());
    harness.setNow(Date.parse("2026-08-29T16:00:21.000Z"));

    const compiled = harness.controller.compileForFrame({
      sourceFrameId: "rtp_source_frame:controller:expired",
    });
    expect(compiled.compilation).toMatchObject({
      cue_state: "static_fallback",
      fallback_reason: "cue_expired",
    });
    expect(compiled.compilation.treatment.cue_packet_id).toBeNull();
  });

  it("rotates source identity, cancels old work, and admits only the new source", () => {
    const harness = fixture();
    harness.controller.start();
    harness.controller.ingestDigestEvent(event());
    const prior = harness.controller.compileForFrame({
      sourceFrameId: "rtp_source_frame:controller:prior",
    });
    const rotatedBinding = binding({
      binding_id: "rtp_source_binding:minecraft:rotated",
      binding_revision: 2,
      capture_session_id: "rtp_capture_session:rotated",
      environment_context: {
        ...binding().environment_context!,
        environment_id: "environment_binding:minecraft:rotated",
        room_id: "shared_realtime_room:rotated",
        source_id: "source:room-ingress:rotated",
        world_id: "minecraft:local:rotated",
        producer_epoch_ref: "producer_epoch:rotated",
        subject_ref: "subject_binding:rotated",
        support_id: "rtp_visual_support:minecraft:rotated",
      },
    });
    harness.controller.rotateBinding({
      binding: rotatedBinding,
      support: support({ support_id: "rtp_visual_support:minecraft:rotated" }),
    });

    expect(prior.target_requests.every((request) => request.status === "canceled")).toBe(true);
    expect(prior.target_requests[0].cancellation_reason).toBe("source_binding_rotated");
    expect(harness.controller.ingestDigestEvent(event())).toBe("ignored_unrelated");
    expect(
      harness.controller.ingestDigestEvent({
        environment_binding_id: "environment_binding:minecraft:rotated",
        digest: digest({
          digest_id: "environment_situation_digest:rotated:1",
          room_id: "shared_realtime_room:rotated",
          source_id: "source:room-ingress:rotated",
          world_id: "minecraft:local:rotated",
          producer_epoch_ref: "producer_epoch:rotated",
          subject_ref: "subject_binding:rotated",
          latest_event_sequence: 1,
          digest_hash: HASH_B,
        }),
      }),
    ).toBe("accepted");
    const next = harness.controller.compileForFrame({
      sourceFrameId: "rtp_source_frame:rotated:1",
    });
    expect(next.compilation.treatment).toMatchObject({
      source_binding_id: rotatedBinding.binding_id,
      source_binding_revision: 2,
      capture_session_id: "rtp_capture_session:rotated",
      visual_treatment_revision: 1,
    });
    expect(next.target_requests[0].request_id).not.toBe(
      prior.target_requests[0].request_id,
    );
  });

  it("supports bounded dispatch completion and tears down subscription and work on stop", () => {
    const harness = fixture();
    harness.controller.start();
    harness.controller.ingestDigestEvent(event());
    const compiled = harness.controller.compileForFrame({
      sourceFrameId: "rtp_source_frame:controller:complete",
    });
    const first = harness.controller.takeTargetRequest(
      compiled.target_requests[0].request_id,
    );
    harness.controller.completeTargetRequest(first.request.request_id);
    expect(first.request.status).toBe("completed");

    const second = harness.controller.takeTargetRequest(
      compiled.target_requests[1].request_id,
    );
    harness.controller.stop("capture_stopped");
    expect(second.signal.aborted).toBe(true);
    expect(second.request).toMatchObject({
      status: "canceled",
      cancellation_reason: "controller_stopped",
    });
    expect(harness.unsubscribeCount()).toBe(1);
    expect(harness.controller.inspectState()).toMatchObject({
      status: "stopped",
      pending_request_count: 0,
      latest_digest_id: null,
      latest_cue_packet_id: null,
      stopped_reason: "capture_stopped",
    });
    expect(() =>
      harness.controller.compileForFrame({ sourceFrameId: "after-stop" }),
    ).toThrow("realtime_texture_pack_controller_not_active");
  });
});
