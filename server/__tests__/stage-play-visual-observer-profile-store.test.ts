import { beforeEach, describe, expect, it } from "vitest";
import {
  applyStagePlayVisualObserverProfile,
  ensureDefaultStagePlayVisualObserverProfiles,
  getActiveStagePlayVisualObserverProfileForSource,
  listStagePlayVisualObserverProfiles,
  resetStagePlayVisualObserverProfileStoreForTest,
} from "../services/stage-play/stage-play-visual-observer-profile-store";

describe("stage play visual observer profile store", () => {
  beforeEach(() => {
    resetStagePlayVisualObserverProfileStoreForTest();
    ensureDefaultStagePlayVisualObserverProfiles();
  });

  it("lists global shade presets for an active source when presets are requested", () => {
    const profiles = listStagePlayVisualObserverProfiles({
      sourceId: "visual_source:test",
      includePresets: true,
      limit: 25,
    });

    expect(profiles.some((profile) => profile.profileId === "stage_play_visual_observer_profile:minecraft-gameplay:v1")).toBe(true);
    expect(profiles.some((profile) => profile.profileId === "stage_play_visual_observer_profile:generic:v1")).toBe(true);
    expect(profiles.some((profile) => profile.profileId === "stage_play_visual_observer_profile:solar-sdo-aia-193:v1")).toBe(true);
  });

  it("seeds the SDO AIA 193 solar activity shade under the science subject", () => {
    const profiles = listStagePlayVisualObserverProfiles({
      domain: "science",
      includePresets: true,
      limit: 25,
    });
    const profile = profiles.find((entry) => entry.profileId === "stage_play_visual_observer_profile:solar-sdo-aia-193:v1");

    expect(profile?.subjectCategory).toBe("Science");
    expect(profile?.subject).toContain("SDO AIA 193");
    expect(profile?.prompt).toContain("coronal-hole placement");
    expect(profile?.prompt).toContain("do not over-claim visible-light sunspot classes from AIA 193 alone");
    expect(profile?.expectedSchema?.requiredFields).toContain("sunspot_proxy_assessment");
  });

  it("seeds the Minecraft shade as neutral spatial evidence before salience candidates", () => {
    const profiles = listStagePlayVisualObserverProfiles({
      domain: "minecraft_gameplay",
      includePresets: true,
      limit: 25,
    });
    const profile = profiles.find((entry) => entry.profileId === "stage_play_visual_observer_profile:minecraft-gameplay:v1");

    expect(profile).toBeDefined();
    if (!profile) throw new Error("Minecraft gameplay profile was not seeded");
    expect(profile.title).toBe("Minecraft Neutral Spatial Observer");
    expect(profile.prompt).toContain("neutral visual evidence");
    expect(profile.prompt).toContain("Do not lead with danger");
    expect(profile.prompt).toContain("near_field");
    expect(profile.prompt).toContain("mid_field");
    expect(profile.prompt).toContain("far_field");
    expect(profile.prompt).toContain("visual_features");
    expect(profile.prompt).toContain("active furnaces, decorative fire, weather, weapons, or darkness are not automatically danger");
    expect(profile.prompt.indexOf("near_field")).toBeLessThan(profile.prompt.indexOf("salience_candidates"));
    expect(profile.expectedSchema?.requiredFields).toContain("frame_overview");
    expect(profile.expectedSchema?.requiredFields).toContain("visual_features");
    expect(profile.expectedSchema?.requiredFields).toContain("salience_candidates");
  });

  it("does not treat global presets as source-applied active profiles before apply", () => {
    const active = getActiveStagePlayVisualObserverProfileForSource({
      sourceId: "visual_source:test",
    });

    expect(active).toBeNull();
  });

  it("returns the applied shade as active for the source", () => {
    const profile = applyStagePlayVisualObserverProfile({
      profileId: "stage_play_visual_observer_profile:minecraft-gameplay:v1",
      sourceIds: ["visual_source:test"],
    });
    const active = getActiveStagePlayVisualObserverProfileForSource({
      sourceId: "visual_source:test",
    });

    expect(profile?.profileId).toBe("stage_play_visual_observer_profile:minecraft-gameplay:v1");
    expect(active?.profileId).toBe("stage_play_visual_observer_profile:minecraft-gameplay:v1");
  });
});
