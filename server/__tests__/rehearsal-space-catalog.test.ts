import { describe, expect, it } from "vitest";
import { buildRehearsalSpaceCatalog } from "@shared/helix-rehearsal-space";

describe("rehearsal space catalog", () => {
  it("marks Minecraft available when environment state and procedure graph lanes exist", () => {
    const catalog = buildRehearsalSpaceCatalog({
      sourceIds: ["source:minecraft-paper-plugin"],
      lineKeys: ["situation", "actor_state", "resources", "affordances", "possibilities", "rehearsal"],
      objective: "prepare for mining",
      preset: "environment_run_monitor",
    });
    const minecraft = catalog.spaces.find((space) => space.space_id === "minecraft");

    expect(catalog.assistant_answer).toBe(false);
    expect(catalog.raw_content_included).toBe(false);
    expect(minecraft?.status).toBe("available");
    expect(minecraft?.may_execute_live_actions).toBe(false);
    expect(catalog.selected_space_id).toBe("minecraft");
  });

  it("keeps unsupported spaces visible as source-dependent partial or waiting states", () => {
    const catalog = buildRehearsalSpaceCatalog({
      sourceIds: ["source:visual-frame"],
      modalities: ["visual_frame"],
      objective: "watch a browser app",
      preset: "environment_run_monitor",
    });
    const browser = catalog.spaces.find((space) => space.space_id === "browser_app");
    const minecraft = catalog.spaces.find((space) => space.space_id === "minecraft");

    expect(browser?.status).toBe("partial");
    expect(minecraft?.status).toBe("waiting_for_source");
    expect(browser?.default_enabled).toBe(false);
  });
});
