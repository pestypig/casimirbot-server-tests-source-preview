import { beforeEach, describe, expect, it } from "vitest";
import {
  createLiveAnswerEnvironment,
  resetLiveAnswerEnvironments,
} from "../services/situation-room/live-answer-environment-store";
import {
  resetLiveSourceDescriptorsForTest,
  upsertLiveSourceDescriptor,
} from "../services/situation-room/live-source-descriptor-builder";
import {
  liveSchemaSelectionToLineDefinitions,
  selectLiveSchemaForEnvironment,
} from "../services/situation-room/live-schema-selection-engine";
import { inspectLiveSchemaCompatibility } from "../services/situation-room/live-schema-compatibility-guard";

const threadId = "helix-ask:desktop";

describe("source-described live schema selection", () => {
  beforeEach(() => {
    resetLiveAnswerEnvironments();
    resetLiveSourceDescriptorsForTest();
  });

  it("selects generic visual schema for a File Explorer visual source", () => {
    const descriptor = upsertLiveSourceDescriptor({
      source_id: "visual_source:file-explorer",
      thread_id: threadId,
      modality: "visual_frame",
      source_origin: "browser_getDisplayMedia",
      surface: "file_manager",
      app_hint: "File Explorer",
      window_title_hint: "PAPERPLAY 2",
      current_state: "active_interval",
    });
    const { environment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "ask:file-explorer",
      objective: "Describe this visual source as a generic workstation live answer.",
      preset: "minecraft_run_monitor",
      source_ids: [descriptor.source_id],
    });

    const selection = selectLiveSchemaForEnvironment({ environment });
    expect(selection.preset_hint).toBe("generic_visual");
    expect(selection.preset_authority).toBe("none");
    expect(selection.source_descriptor_refs).toContain(descriptor.descriptor_id);
    expect(selection.assistant_answer).toBe(false);
    expect(liveSchemaSelectionToLineDefinitions(selection).map((line) => line.key)).toEqual([
      "scene",
      "activity",
      "objects",
      "evidence",
      "uncertainty",
      "next_check",
      "last_update",
    ]);
  });

  it("does not let negated Minecraft wording select a game schema", () => {
    const descriptor = upsertLiveSourceDescriptor({
      source_id: "visual_source:window",
      thread_id: threadId,
      modality: "visual_frame",
      source_origin: "browser_getDisplayMedia",
      surface: "screen",
      window_title_hint: "Windows File Explorer - PAPERPLAY 2",
      current_state: "active",
    });
    const { environment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "ask:generic",
      objective: "Using the latest visual observation, describe my current screen as a generic workstation live answer. Do not use Minecraft or game-specific assumptions.",
      preset: "minecraft_run_monitor",
      source_ids: [descriptor.source_id],
    });

    const selection = selectLiveSchemaForEnvironment({ environment });
    expect(selection.preset_hint).toBe("generic_visual");
    expect(selection.rationale).toMatch(/generic|excludes game/i);
    expect(selection.selected_schema.map((line) => line.key)).not.toContain("risk");
  });

  it("allows explicit Minecraft preset authority when the source is game-like", () => {
    const descriptor = upsertLiveSourceDescriptor({
      source_id: "visual_source:minecraft",
      thread_id: threadId,
      modality: "visual_frame",
      source_origin: "browser_getDisplayMedia",
      surface: "game",
      app_hint: "Minecraft Java Edition",
      current_state: "active_interval",
    });
    const { environment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "ask:minecraft",
      objective: "Switch this to Minecraft Cortana mode.",
      preset: "minecraft_run_monitor",
      source_ids: [descriptor.source_id],
    });

    const selection = selectLiveSchemaForEnvironment({
      environment,
      explicitPreset: "minecraft_run_monitor",
    });
    expect(selection.preset_hint).toBe("minecraft_cortana");
    expect(selection.preset_authority).toBe("explicit_user_selected");
    expect(selection.selected_schema.map((line) => line.key)).toContain("risk");
  });

  it("flags old game lines as incompatible with a file-manager source", () => {
    const descriptor = upsertLiveSourceDescriptor({
      source_id: "visual_source:file-explorer",
      thread_id: threadId,
      modality: "visual_frame",
      source_origin: "browser_getDisplayMedia",
      surface: "file_manager",
      app_hint: "File Explorer",
      current_state: "active",
    });
    const { environment } = createLiveAnswerEnvironment({
      thread_id: threadId,
      created_turn_id: "ask:stale-schema",
      objective: "Describe this as a generic workstation live answer.",
      preset: "minecraft_run_monitor",
      source_ids: [descriptor.source_id],
    });
    const selection = selectLiveSchemaForEnvironment({ environment });
    const compatibility = inspectLiveSchemaCompatibility({ environment, selection });
    expect(compatibility.ok).toBe(false);
    expect(compatibility.issues.map((issue) => issue.code)).toContain("file_manager_with_game_lines");
    expect(compatibility.recommended_schema?.map((line) => line.key)).toContain("scene");
  });
});
