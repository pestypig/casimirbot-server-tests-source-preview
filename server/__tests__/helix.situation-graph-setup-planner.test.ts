import { describe, expect, it } from "vitest";
import {
  buildSituationGraphSetupPlan,
  classifySituationGraphSetupIntentKind,
} from "../services/helix-ask/situation-graph-setup-planner";

const activeCaptureSnapshot = {
  situationCaptureContext: {
    schema: "helix.situation_capture_context.v1",
    room_id: "room:discord",
    source_ids: ["src:discord"],
    sources: [
      {
        source_id: "src:discord",
        capture_source: "display_tab_audio",
        label: "Discord tab",
        status: "active",
        classified_context: {
          source_kind: "discord_call",
          app_hint: "discord",
          contains_remote_participant_audio: "unknown",
          contains_user_audio: "unknown",
          transcript_available: false,
          transcript_attached_to_helix: false,
        },
        permission_state: {
          capture_granted: true,
          transcript_context_granted: false,
          voice_output_granted: false,
        },
      },
    ],
    context_policy: "explicit_attachment_only",
    command_lane_enabled: false,
  },
  situationRoomContext: {
    room_id: "room:discord",
    speakers: [
      { speaker_id: "spk_self", role_hint: "self", native_language: "en" },
      { speaker_id: "spk_friend", role_hint: "friend", native_language: "es" },
    ],
  },
};

describe("situation graph setup planner", () => {
  it("routes interpreter and prompt composer aliases to graph recipes", () => {
    expect(classifySituationGraphSetupIntentKind("Set up interpreter for this Discord voice chat")).toBe(
      "two_way_interpreter",
    );
    expect(classifySituationGraphSetupIntentKind("Make a live interpreter for this call")).toBe(
      "two_way_interpreter",
    );
    expect(classifySituationGraphSetupIntentKind("Prompt composer pipeline for this voice chat")).toBe(
      "prompt_composer_from_room",
    );
    expect(classifySituationGraphSetupIntentKind("Stand by and watch this Discord session. Tell me when something important happens.")).toBe(
      "standby_voice_chat_monitor",
    );
    expect(classifySituationGraphSetupIntentKind("Stand by and watch Minecraft. Tell me when danger happens.")).toBe(
      "minecraft_world_monitor",
    );
  });

  it("keeps job and panel negative controls out of graph setup", () => {
    expect(classifySituationGraphSetupIntentKind("Create a Spanish translation job")).toBeNull();
    expect(classifySituationGraphSetupIntentKind("Open Scientific Calculator")).toBeNull();
    expect(classifySituationGraphSetupIntentKind("Translate this sentence into Spanish")).toBeNull();
  });

  it("plans a complete interpreter graph action without transcript injection", () => {
    const plan = buildSituationGraphSetupPlan({
      prompt: "Set up interpreter for this Discord voice chat",
      workspaceSnapshot: activeCaptureSnapshot,
      setupCallId: "setup:known",
    });

    expect(plan).toMatchObject({
      schema: "helix.situation_graph_setup_plan.v1",
      setup_call_id: "setup:known",
      recipe_id: "two_way_interpreter",
      capture_preference: "browser_tab_audio",
      source_ids: ["src:discord"],
      missing_requirements: [],
      missing_bindings: [],
      attachment_policy: "manual_only",
      context_injection: "explicit_attachment_only",
      command_lane_enabled: false,
    });
    expect(JSON.stringify(plan)).not.toContain("transcript text");
    expect(plan?.next_actions[0]).toMatchObject({
      action: "run_panel_action",
      panel_id: "situation-room-pipelines",
      action_id: "create_graph_from_recipe",
      args: {
        recipe_id: "two_way_interpreter",
        correlation: { setup_call_id: "setup:known" },
      },
    });
  });

  it("requests source and capture permission when no source exists", () => {
    const plan = buildSituationGraphSetupPlan({
      prompt: "Set up interpreter for this Discord voice chat",
      workspaceSnapshot: { situationCaptureContext: null, situationRoomContext: null },
      setupCallId: "setup:missing",
    });

    expect(plan?.missing_requirements).toEqual(expect.arrayContaining(["audio_source", "capture_permission"]));
    expect(plan?.missing_bindings).toEqual(
      expect.arrayContaining(["room_id", "source_ids", "speaker_a_id", "speaker_b_id"]),
    );
    expect(plan?.next_actions[0]).toMatchObject({
      action: "open_panel",
      panel_id: "situation-room-sources",
    });
  });

  it("uses active source but keeps speaker/language gaps pending", () => {
    const plan = buildSituationGraphSetupPlan({
      prompt: "Live interpreter for this call",
      workspaceSnapshot: {
        ...activeCaptureSnapshot,
        situationRoomContext: { room_id: "room:discord", speakers: [] },
      },
      setupCallId: "setup:speakers",
    });

    expect(plan?.missing_requirements).toEqual([]);
    expect(plan?.missing_bindings).toEqual(
      expect.arrayContaining([
        "speaker_a_id",
        "speaker_b_id",
        "speaker_a_native_language",
        "speaker_b_native_language",
      ]),
    );
  });

  it("plans standby monitor graphs with standby mode bindings", () => {
    const plan = buildSituationGraphSetupPlan({
      prompt: "Stand by and watch this Discord session. Tell me when something important happens.",
      workspaceSnapshot: activeCaptureSnapshot,
      setupCallId: "setup:standby",
    });

    expect(plan).toMatchObject({
      recipe_id: "standby_voice_chat_monitor",
      missing_requirements: [],
      missing_bindings: [],
      bindings: {
        standby_mode: "high_salience",
      },
      command_lane_enabled: false,
    });
    expect(plan?.next_actions[0]).toMatchObject({
      action_id: "create_graph_from_recipe",
      args: {
        recipe_id: "standby_voice_chat_monitor",
      },
    });
  });
});
