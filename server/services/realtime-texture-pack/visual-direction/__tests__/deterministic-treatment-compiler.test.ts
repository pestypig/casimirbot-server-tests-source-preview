import { describe, expect, it } from "vitest";
import {
  REALTIME_TEXTURE_PACK_MINECRAFT_VISUAL_DIRECTION_PROFILE_ID,
  buildRealtimeTexturePackSourceBinding,
  realtimeTexturePackVisualCuesSchema,
  type RealtimeTexturePackSourceBindingV1,
  type RealtimeTexturePackVisualCuesV1,
} from "@shared/realtime-texture-pack-visual-direction";
import { compileRealtimeTexturePackVisualTreatment } from "../deterministic-treatment-compiler";

const NOW = "2026-08-29T16:00:05.000Z";
const HASH_A = `sha256:${"a".repeat(64)}`;

const binding = (
  overrides: Partial<RealtimeTexturePackSourceBindingV1> = {},
): RealtimeTexturePackSourceBindingV1 =>
  buildRealtimeTexturePackSourceBinding({
    binding_id: "rtp_source_binding:minecraft:compiler",
    binding_revision: 1,
    capture_session_id: "rtp_capture_session:compiler",
    visual_source_id: "display_media_source:minecraft:compiler",
    visual_source_origin: "browser_getDisplayMedia",
    visual_source_surface: "window",
    mode: "environment_reactive",
    environment_context: {
      environment_id: "environment_binding:minecraft:compiler",
      room_id: "shared_realtime_room:compiler",
      source_id: "source:room-ingress:compiler",
      world_id: "minecraft:local:compiler",
      producer_plane: "player_embodiment",
      producer_epoch_ref: "producer_epoch:compiler",
      subject_ref: "subject_binding:compiler",
      adapter_profile_id: "game.minecraft.readonly.v1",
      adapter_profile_version: 1,
      support_id: "rtp_visual_support:minecraft:compiler",
      controller_profile_id:
        REALTIME_TEXTURE_PACK_MINECRAFT_VISUAL_DIRECTION_PROFILE_ID,
      controller_profile_version: 1,
      max_digest_age_ms: 15_000,
    },
    policy_revision: 1,
    status: "active",
    created_at: "2026-08-29T16:00:00.000Z",
    expires_at: "2026-08-29T16:01:00.000Z",
    revoked_at: null,
    revocation_reason: null,
    ...overrides,
  });

const cue = (
  overrides: Partial<RealtimeTexturePackVisualCuesV1> = {},
): RealtimeTexturePackVisualCuesV1 =>
  realtimeTexturePackVisualCuesSchema.parse({
    schema: "helix.realtime_texture_pack_visual_cues.v1",
    cue_packet_id: "realtime_texture_pack_visual_cues:compiler",
    source_binding_id: "rtp_source_binding:minecraft:compiler",
    source_binding_revision: 1,
    environment_id: "environment_binding:minecraft:compiler",
    room_id: "shared_realtime_room:compiler",
    source_id: "source:room-ingress:compiler",
    world_id: "minecraft:local:compiler",
    producer_plane: "player_embodiment",
    producer_epoch_ref: "producer_epoch:compiler",
    subject_ref: "subject_binding:compiler",
    observation_revision: 8,
    digest_id: "environment_situation_digest:compiler",
    digest_hash: HASH_A,
    observed_at: "2026-08-29T16:00:04.000Z",
    expires_at: "2026-08-29T16:00:20.000Z",
    dimension_class: "overworld",
    biome_class: "cave",
    time_class: "night",
    weather_class: "rain",
    lighting_class: "dark",
    activity_class: "exploring",
    hazard_classes: ["lava", "fall"],
    focus_kind: "terrain",
    workflow_phase: "running",
    changed_fields: ["biome", "lighting", "hazards"],
    evidence_refs: ["environment_situation_digest:compiler", HASH_A],
    content_role: "realtime_texture_pack_visual_cues_not_assistant_answer",
    authoritative_visual_output: false,
    authoritative: false,
    authority_class: "non_authoritative_projection_context",
    assistant_answer: false,
    terminal_eligible: false,
    raw_content_included: false,
    ...overrides,
  });

const compile = (
  overrides: Partial<Parameters<typeof compileRealtimeTexturePackVisualTreatment>[0]> = {},
) =>
  compileRealtimeTexturePackVisualTreatment({
    binding: binding(),
    sourceFrameId: "rtp_source_frame:compiler",
    treatmentRevision: 1,
    presetId: "playable",
    customDirection: "luminous mineral cathedral",
    targets: ["native_shader", "dynamic_material", "resource_pack", "overlay"],
    cue: cue(),
    compiledAt: NOW,
    ...overrides,
  });

describe("Realtime Texture Pack VDC-2 deterministic treatment compiler", () => {
  it("compiles one golden cave treatment into all four target payloads", () => {
    const result = compile();

    expect(result.compiled_prompt).toBe(
      "Preserve geometry, silhouettes, navigation landmarks, and readable HUD regions while applying a restrained coherent game-art treatment.\n" +
        "User treatment: luminous mineral cathedral\n" +
        "Preserve the native camera, traversable geometry, major silhouettes, interaction readability, and HUD-safe regions.\n" +
        "Current verified scene cues: dimension: overworld; biome: cave; time: night; weather: rain; lighting: dark; activity: exploring; hazards: fall, lava; focus: terrain; workflow: running.\n" +
        "Maintain a coherent palette and material language across adjacent revisions without inventing gameplay state.",
    );
    expect(result.cue_state).toBe("current_cue");
    expect(result.fallback_reason).toBeNull();
    expect(result.target_payloads.map((payload) => payload.target_class)).toEqual([
      "native_shader",
      "dynamic_material",
      "resource_pack",
      "overlay",
    ]);
    expect(result.target_payloads[0]).toMatchObject({
      target_class: "native_shader",
      parameters: {
        palette_profile_id: "rtp_palette.playable.overworld.cave.night",
        ambient_brightness: 0.55,
        saturation: 1,
        contrast: 1.05,
        fog_density: 0.16,
        emissive_boost: 1.25,
        hazard_accent: "lava",
      },
    });
    expect(result.target_payloads[1]).toMatchObject({
      target_class: "dynamic_material",
      tile_resolution: 32,
      seamless: true,
      material_families: ["terrain", "fluid", "emissive"],
      apply_mode: "atomic_dynamic_texture_swap",
    });
    expect(result.target_payloads[2]).toMatchObject({
      target_class: "resource_pack",
      snapshot_only: true,
      attended_apply_required: true,
    });
    expect(result.prompt_revision?.cue_packet_id).toBe(cue().cue_packet_id);
    expect(result.treatment).toMatchObject({
      presentation_only: true,
      environment_action_authority: false,
      world_mutation_authority: false,
      assistant_answer: false,
      terminal_eligible: false,
    });
  });

  it("canonicalizes target and cue-family order without hash churn", () => {
    const first = compile({
      targets: ["overlay", "native_shader", "dynamic_material"],
      enabledCueFamilies: ["hazards", "dimension", "lighting"],
    });
    const second = compile({
      targets: ["dynamic_material", "native_shader", "overlay"],
      enabledCueFamilies: ["lighting", "dimension", "hazards"],
    });

    expect(first.treatment.treatment_hash).toBe(second.treatment.treatment_hash);
    expect(first.target_payloads).toEqual(second.target_payloads);
  });

  it("applies cue-family policy to prompts and native parameters", () => {
    const result = compile({ enabledCueFamilies: ["dimension"] });
    expect(result.compiled_prompt).toContain("dimension: overworld");
    expect(result.compiled_prompt).not.toContain("hazards:");
    expect(result.target_payloads[0]).toMatchObject({
      target_class: "native_shader",
      parameters: {
        palette_profile_id: "rtp_palette.playable.overworld.unknown.unknown",
        ambient_brightness: 1,
        hazard_accent: "none",
      },
    });
  });

  it("emits no prompt revision for a shader-only treatment", () => {
    const result = compile({ targets: ["native_shader"] });
    expect(result.prompt_revision).toBeNull();
    expect(result.treatment.prompt_revision_id).toBeNull();
    expect(result.target_payloads).toHaveLength(1);
  });

  it("falls back to static direction for static bindings and missing cues", () => {
    const staticBinding = binding({
      binding_id: "rtp_source_binding:static:compiler",
      mode: "static_prompt_only",
      environment_context: null,
    });
    const staticResult = compile({ binding: staticBinding, cue: null });
    expect(staticResult).toMatchObject({
      cue_state: "static_fallback",
      fallback_reason: "static_binding",
    });
    expect(staticResult.compiled_prompt).toContain("static user direction only");

    const missingResult = compile({ cue: null });
    expect(missingResult).toMatchObject({
      cue_state: "static_fallback",
      fallback_reason: "cue_missing",
    });
  });

  it("falls back for an expired current-binding cue and constrains a current cue TTL", () => {
    const expired = compile({
      compiledAt: "2026-08-29T16:00:21.000Z",
      cue: cue(),
    });
    expect(expired).toMatchObject({
      cue_state: "static_fallback",
      fallback_reason: "cue_expired",
    });
    expect(expired.treatment.cue_packet_id).toBeNull();

    const current = compile({ ttlMs: 60_000 });
    expect(current.treatment.expires_at).toBe(cue().expires_at);
  });

  it("rejects future, wrong-binding, and static-binding cue inputs", () => {
    expect(() =>
      compile({
        cue: cue({ observed_at: "2026-08-29T16:00:06.000Z" }),
      }),
    ).toThrow("realtime_texture_pack_cue_from_future");
    expect(() =>
      compile({
        cue: cue({
          source_binding_id: "rtp_source_binding:minecraft:other",
          expires_at: "2026-08-29T16:00:05.000Z",
        }),
        compiledAt: "2026-08-29T16:00:06.000Z",
      }),
    ).toThrow("realtime_texture_pack_cue_binding_identity_mismatch");
    expect(() =>
      compile({
        binding: binding({
          binding_id: "rtp_source_binding:static:compiler",
          mode: "static_prompt_only",
          environment_context: null,
        }),
      }),
    ).toThrow("realtime_texture_pack_static_binding_forbids_cue");
  });

  it("rejects unbounded input, duplicate targets, and invalid TTLs", () => {
    expect(() => compile({ customDirection: "x".repeat(1_001) })).toThrow(
      "realtime_texture_pack_custom_visual_direction_too_long",
    );
    expect(() => compile({ targets: ["overlay", "overlay"] })).toThrow(
      "realtime_texture_pack_visual_target_duplicate",
    );
    expect(() => compile({ ttlMs: 999 })).toThrow(
      "realtime_texture_pack_treatment_ttl_invalid",
    );
  });

  it("rejects regressed and conflicting treatment revisions", () => {
    const previous = compile({ treatmentRevision: 2 }).treatment;
    expect(() =>
      compile({ treatmentRevision: 1, previousTreatment: previous }),
    ).toThrow("realtime_texture_pack_treatment_revision_regressed");
    expect(() =>
      compile({
        treatmentRevision: 2,
        customDirection: "a conflicting treatment",
        previousTreatment: previous,
      }),
    ).toThrow("realtime_texture_pack_treatment_revision_conflict");
  });
});
