import { describe, expect, it } from "vitest";
import { buildRealtimeTexturePackSourceBinding } from "@shared/realtime-texture-pack-visual-direction";
import {
  buildRealtimeTexturePackHybridSceneState,
  deriveRealtimeTexturePackMaterialInstanceVariation,
} from "../hybrid-scene-state";
import { compileRealtimeTexturePackVisualTreatment } from "../deterministic-treatment-compiler";
import {
  buildRealtimeTexturePackFabricDebugProjection,
  inspectSyntheticRealtimeTexturePackHybridRender,
  projectSyntheticRealtimeTexturePackHybridRender,
} from "../synthetic-hybrid-render-adapter";
import type { RealtimeTexturePackVisualCuesV1 } from "@shared/realtime-texture-pack-visual-direction";

const HASH = `sha256:${"a".repeat(64)}`;
const NOW = "2026-08-30T12:00:02.000Z";
const binding = () => buildRealtimeTexturePackSourceBinding({
  binding_id: "rtp_source_binding:minecraft:hybrid",
  binding_revision: 1,
  capture_session_id: "rtp_capture_session:hybrid",
  visual_source_id: "display_media_source:minecraft:hybrid",
  visual_source_origin: "browser_getDisplayMedia",
  visual_source_surface: "window",
  mode: "environment_reactive",
  status: "active",
  policy_revision: 1,
  environment_context: {
    environment_id: "environment_binding:minecraft:hybrid",
    room_id: "shared_realtime_room:hybrid",
    source_id: "source:room-ingress:hybrid",
    world_id: "minecraft:local:hybrid",
    producer_plane: "player_embodiment",
    producer_epoch_ref: "producer_epoch:hybrid",
    subject_ref: "subject_binding:hybrid",
    adapter_profile_id: "minecraft.dual_plane.v1",
    adapter_profile_version: 1,
    support_id: "rtp_visual_support:minecraft:hybrid",
    controller_profile_id: "realtime_texture_pack.visual_direction.minecraft.v1",
    controller_profile_version: 1,
    max_digest_age_ms: 5_000,
  },
  created_at: "2026-08-30T12:00:00.000Z",
  expires_at: "2026-08-30T12:01:00.000Z",
  revoked_at: null,
  revocation_reason: null,
});
const cue = (): RealtimeTexturePackVisualCuesV1 => ({
  schema: "helix.realtime_texture_pack_visual_cues.v1",
  cue_packet_id: "realtime_texture_pack_visual_cues:hybrid",
  source_binding_id: binding().binding_id,
  source_binding_revision: 1,
  environment_id: "environment_binding:minecraft:hybrid",
  room_id: "shared_realtime_room:hybrid",
  source_id: "source:room-ingress:hybrid",
  world_id: "minecraft:local:hybrid",
  producer_plane: "player_embodiment",
  producer_epoch_ref: "producer_epoch:hybrid",
  subject_ref: "subject_binding:hybrid",
  observation_revision: 7,
  digest_id: "environment_situation_digest:hybrid",
  digest_hash: HASH,
  dimension_class: "overworld",
  biome_class: "forest",
  time_class: "day",
  weather_class: "clear",
  lighting_class: "bright",
  activity_class: "exploring",
  hazard_classes: [],
  focus_kind: "terrain",
  workflow_phase: "running",
  changed_fields: ["biome", "focus"],
  evidence_refs: ["environment_situation_digest:hybrid", HASH],
  observed_at: "2026-08-30T12:00:01.000Z",
  expires_at: "2026-08-30T12:00:06.000Z",
  content_role: "realtime_texture_pack_visual_cues_not_assistant_answer",
  authoritative_visual_output: false,
  authoritative: false,
  authority_class: "non_authoritative_projection_context",
  assistant_answer: false,
  terminal_eligible: false,
  raw_content_included: false,
});
const capsule = () => buildRealtimeTexturePackHybridSceneState({
  binding: binding(), cue: cue(), sourceFrameId: "rtp_source_frame:hybrid:7",
  sceneCapsuleRevision: 1, dominantMaterialFamilies: ["terrain", "foliage", "wood"],
  landmarkClasses: ["path", "vegetation_cluster"], depthProfile: "layered",
  cameraMotionClass: "translating", expiresAt: "2026-08-30T12:00:06.000Z", at: NOW,
});
const compileHybrid = (scene = capsule(), treatmentRevision = 1) =>
  compileRealtimeTexturePackVisualTreatment({
    binding: binding(), cue: cue(), sceneCapsule: scene,
    sourceFrameId: scene.source_frame_id, treatmentRevision,
    presetId: "painterly", customDirection: "dreamlike hand-painted voxel forest",
    targets: ["native_shader", "dynamic_material", "overlay"], compiledAt: NOW,
  });
const visibleBlocks = [
  { blockPosition: { x: 10, y: 64, z: 12 }, blockType: "minecraft:stone", blockState: "axis:none", materialFamily: "terrain" as const },
  { blockPosition: { x: 11, y: 64, z: 12 }, blockType: "minecraft:stone", blockState: "axis:none", materialFamily: "terrain" as const },
  { blockPosition: { x: 12, y: 64, z: 12 }, blockType: "minecraft:stone", blockState: "axis:none", materialFamily: "terrain" as const },
];

describe("Realtime Texture Pack hybrid scene state", () => {
  it("gives repeated block types distinct, camera-stable world-space variation", () => {
    const base = { worldId: "world-a", dimensionId: "overworld", blockType: "minecraft:stone", blockState: "axis:none", styleFamilyId: "luminous-mineral" };
    const first = deriveRealtimeTexturePackMaterialInstanceVariation({ ...base, blockPosition: { x: 10, y: 64, z: 12 } });
    const sameAfterCameraMove = deriveRealtimeTexturePackMaterialInstanceVariation({ ...base, blockPosition: { x: 10, y: 64, z: 12 } });
    const neighbor = deriveRealtimeTexturePackMaterialInstanceVariation({ ...base, blockPosition: { x: 11, y: 64, z: 12 } });
    expect(first).toEqual(sameAfterCameraMove);
    expect(neighbor.instance_identity_hash).not.toBe(first.instance_identity_hash);
    expect(JSON.stringify(first)).not.toContain("\"x\"");
    expect(JSON.stringify(first)).not.toContain("minecraft:stone");
  });

  it("feeds one sanitized capsule to overlay and native material targets", () => {
    const scene = capsule();
    const result = compileHybrid(scene);
    expect(result.compiled_prompt).toContain("materials: foliage, terrain, wood");
    expect(result.compiled_prompt).toContain("landmarks: path, vegetation_cluster");
    expect(result.prompt_revision?.scene_capsule_id).toBe(scene.scene_capsule_id);
    expect(result.target_payloads.filter((p) => p.target_class !== "overlay")).toEqual(
      expect.arrayContaining([expect.objectContaining({ scene_capsule_hash: scene.scene_capsule_hash })]),
    );
    expect(scene).toMatchObject({ presentation_only: true, world_mutation_authority: false, assistant_answer: false, raw_content_included: false });
  });

  it("rejects a capsule rebound to another frame", () => {
    expect(() => compileRealtimeTexturePackVisualTreatment({
      binding: binding(), cue: cue(), sceneCapsule: capsule(),
      sourceFrameId: "rtp_source_frame:hybrid:8", treatmentRevision: 1,
      presetId: "playable", targets: ["overlay"], compiledAt: NOW,
    })).toThrow("realtime_texture_pack_scene_binding_identity_mismatch");
  });

  it("projects stable non-repeating native instances beside the exact overlay prompt", () => {
    const scene = capsule();
    const compilation = compileHybrid(scene);
    const projection = projectSyntheticRealtimeTexturePackHybridRender({
      sceneCapsule: scene, compilation, dimensionId: "minecraft:overworld",
      styleFamilyId: "style:dreamlike-forest", visibleBlocks,
    });
    expect(projection.overlay_prompt).toBe(compilation.compiled_prompt);
    expect(projection.source_frame_id).toBe(scene.source_frame_id);
    expect(projection.material_instances).toHaveLength(3);
    expect(new Set(projection.material_instances.map((instance) => instance.instance_identity_hash)).size).toBe(3);
    expect(projection).toMatchObject({ synthetic_only: true, minecraft_render_mutation_performed: false, provider_request_performed: false });
  });

  it("keeps material identities stable when the camera frame changes", () => {
    const firstScene = capsule();
    const secondScene = buildRealtimeTexturePackHybridSceneState({
      binding: binding(), cue: cue(), sourceFrameId: "rtp_source_frame:hybrid:8",
      sceneCapsuleRevision: 2, dominantMaterialFamilies: ["terrain", "foliage", "wood"],
      landmarkClasses: ["path", "vegetation_cluster"], depthProfile: "layered",
      cameraMotionClass: "turning", expiresAt: "2026-08-30T12:00:06.000Z", at: NOW,
    });
    const render = (scene: typeof firstScene, revision: number) =>
      projectSyntheticRealtimeTexturePackHybridRender({
        sceneCapsule: scene, compilation: compileHybrid(scene, revision),
        dimensionId: "minecraft:overworld", styleFamilyId: "style:dreamlike-forest", visibleBlocks,
      });
    expect(render(firstScene, 1).material_instances).toEqual(render(secondScene, 2).material_instances);
    expect(render(firstScene, 1).source_frame_id).not.toBe(render(secondScene, 2).source_frame_id);
  });

  it("emits an authority-free receipt without prompts, coordinates, or block identifiers", () => {
    const scene = capsule();
    const projection = projectSyntheticRealtimeTexturePackHybridRender({
      sceneCapsule: scene, compilation: compileHybrid(scene),
      dimensionId: "minecraft:overworld", styleFamilyId: "style:dreamlike-forest", visibleBlocks,
    });
    const receipt = inspectSyntheticRealtimeTexturePackHybridRender(projection);
    const serialized = JSON.stringify(receipt);
    expect(receipt).toMatchObject({ material_instance_count: 3, prompt_body_included: false, block_identity_input_included: false, world_mutation_authority: false, assistant_answer: false });
    expect(serialized).not.toContain("dreamlike hand-painted");
    expect(serialized).not.toContain("minecraft:stone");
    expect(serialized).not.toContain("blockPosition");
    const fabricProjection = buildRealtimeTexturePackFabricDebugProjection(projection);
    const fabricSerialized = JSON.stringify(fabricProjection);
    expect(fabricProjection).toMatchObject({
      schema: "helix.realtime_texture_pack_fabric_debug_projection.v1",
      visual_treatment_revision: 1,
      debug_only: true,
      texture_mutation_allowed: false,
      provider_request_allowed: false,
    });
    expect(fabricSerialized).not.toContain("dreamlike hand-painted");
    expect(fabricSerialized).not.toContain("minecraft:stone");
    expect(fabricSerialized).not.toContain("blockPosition");
  });

  it("rejects a scene capsule rebound to another compilation", () => {
    const otherScene = buildRealtimeTexturePackHybridSceneState({
      binding: binding(), cue: cue(), sourceFrameId: "rtp_source_frame:hybrid:8",
      sceneCapsuleRevision: 2, dominantMaterialFamilies: ["terrain"], landmarkClasses: [],
      depthProfile: "near_field", cameraMotionClass: "turning",
      expiresAt: "2026-08-30T12:00:06.000Z", at: NOW,
    });
    expect(() => projectSyntheticRealtimeTexturePackHybridRender({
      sceneCapsule: otherScene, compilation: compileHybrid(capsule()),
      dimensionId: "minecraft:overworld", styleFamilyId: "style:dreamlike-forest", visibleBlocks,
    })).toThrow("realtime_texture_pack_synthetic_render_scene_binding_mismatch");
  });
});
