import { beforeEach, describe, expect, it } from "vitest";

import {
  getSituationConstructRecipe,
  listSituationConstructRecipes,
} from "../services/situation-room/situation-construct-recipe-registry";
import { runSituationConstructRecipe } from "../services/situation-room/situation-construct-recipe-runner";
import { resetDottieManifestRunsForTest } from "../services/situation-room/dottie-manifest-run-store";
import { clearInterpretedEventLogForTest } from "../services/situation-room/interpreted-event-log-store";
import { resetLiveEnvironmentCommentaryForTest } from "../services/situation-room/live-environment-commentary-store";
import {
  listSituationConstructs,
  resetSituationConstructStoreForTest,
} from "../services/situation-room/situation-construct-store";

const resetAll = () => {
  resetDottieManifestRunsForTest();
  resetLiveEnvironmentCommentaryForTest();
  resetSituationConstructStoreForTest();
  clearInterpretedEventLogForTest();
};

describe("Situation Room construct recipes", () => {
  beforeEach(resetAll);

  it("registers evidence-only construct recipes without answer authority", () => {
    const recipes = listSituationConstructRecipes();

    expect(recipes.map((recipe) => recipe.recipe_id)).toEqual([
      "auntie_dottie_witness",
      "browser_audio_transcriber",
      "minecraft_route_watcher",
      "live_source_summarizer",
      "translation_pair",
      "source_health_watch",
    ]);
    expect(recipes.every((recipe) => recipe.schema === "helix.situation_construct_recipe.v1")).toBe(true);
    expect(recipes.every((recipe) => recipe.safety.assistant_answer === false)).toBe(true);
    expect(recipes.every((recipe) => recipe.safety.raw_content_included === false)).toBe(true);
    expect(recipes.every((recipe) => recipe.safety.raw_audio_included === false)).toBe(true);
    expect(recipes.every((recipe) => recipe.safety.instruction_authority === "none")).toBe(true);
    expect(recipes.every((recipe) => recipe.safety.ask_instruction_authority === "none")).toBe(true);
    expect(recipes.every((recipe) => recipe.default_policy.may_spawn_workers === false)).toBe(true);
    expect(recipes.every((recipe) => recipe.default_policy.may_speak === false)).toBe(true);
    expect(recipes.every((recipe) => recipe.default_policy.may_surface_user_text === false)).toBe(true);
    expect(recipes.every((recipe) => recipe.default_policy.requires_user_confirmation === true)).toBe(true);
    expect(getSituationConstructRecipe("minecraft_route_watcher")?.default_policy).toMatchObject({
      may_execute_tools: true,
      allowed_tools: [
        "live_env.query_navigation_state",
        "live_env.query_world_events",
        "live_env.query_source_health",
        "live_env.query_constructs",
        "minecraft.query_navigation_state",
      ],
    });
    expect(getSituationConstructRecipe("auntie_dottie_witness")?.creates_constructs).toEqual(expect.arrayContaining([
      "dottie_manifest",
      "observer",
      "voice_policy",
      "commentary_policy",
      "live_answer_output",
    ]));
  });

  it("blocks recipe runs when required inputs are missing", () => {
    const run = runSituationConstructRecipe({
      recipe_id: "browser_audio_transcriber",
      thread_id: "thread:recipe-blocked",
      room_id: "room:recipe-blocked",
      now: "2026-05-26T18:10:00.000Z",
    });

    expect(run).toMatchObject({
      schema: "helix.situation_construct_recipe_run.v1",
      recipe_id: "browser_audio_transcriber",
      status: "blocked",
      assistant_answer: false,
      raw_content_included: false,
      instruction_authority: "none",
    });
    expect(run.created_construct_ids).toHaveLength(0);
    expect(run.missing_evidence).toContain("Missing required recipe input: source_ids");
  });

  it("runs the Auntie Dottie recipe through the manifest path and creates construct family records", () => {
    const run = runSituationConstructRecipe({
      recipe_id: "auntie_dottie_witness",
      thread_id: "thread:recipe-dottie",
      room_id: "room:recipe-dottie",
      source_ids: ["source:display-audio"],
      environment_id: "live_answer:dottie-recipe",
      target_run_id: "run:ask:dottie-recipe",
      objective: "Create Dottie as a witness construct.",
      now: "2026-05-26T18:11:00.000Z",
    });
    const constructs = listSituationConstructs({
      threadId: "thread:recipe-dottie",
      roomId: "room:recipe-dottie",
      limit: 20,
    });

    expect(run).toMatchObject({
      schema: "helix.situation_construct_recipe_run.v1",
      recipe_id: "auntie_dottie_witness",
      status: "applied_as_receipts",
      assistant_answer: false,
      raw_content_included: false,
      instruction_authority: "none",
    });
    expect(run.receipt_refs.length).toBeGreaterThanOrEqual(5);
    expect(run.commentary_refs.length).toBeGreaterThan(0);
    expect(run.created_construct_ids.length).toBeGreaterThanOrEqual(7);
    expect(run.live_job_contract).toMatchObject({
      schema: "helix.situation_room_live_job_contract.v1",
      name: "Auntie Dottie Minecraft Watch",
      purpose: "voice_witness",
      voice_policy: "propose_only",
      authority_policy: {
        assistant_answer: false,
        construct_answer_authority: "witness_only",
        helix_ask_terminal_authority_required: true,
      },
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(run.construct_observation).toMatchObject({
      schema: "helix.situation_room_construct_observation.v1",
      action: "construct.create_from_recipe",
      live_job_contract_ref: run.live_job_contract?.contract_id,
      terminal_eligible: false,
      panel_generated_answer: false,
      next_step_authority: "agent_step_decision",
      assistant_answer: false,
      raw_content_included: false,
      policy_state: {
        voice_policy: "propose_only",
        spoken: false,
        confirm_speak_receipt_present: false,
        output_authority: "proposal",
      },
    });
    expect(constructs.map((construct) => construct.type)).toEqual(expect.arrayContaining([
      "dottie_manifest",
      "live_environment",
      "live_answer_output",
      "commentary_policy",
      "observer",
      "voice_policy",
      "field_worker_policy",
    ]));
    expect(constructs.every((construct) => construct.safety.assistant_answer === false)).toBe(true);
    expect(constructs.find((construct) => construct.type === "observer")).toMatchObject({
      name: "Auntie Dottie",
      status: "receipt_only",
      policy: {
        may_execute_tools: false,
        may_spawn_workers: false,
        may_speak: false,
        may_surface_user_text: false,
        witness_only: true,
      },
    });
    expect(constructs.find((construct) => construct.type === "live_answer_output")?.output_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        output_kind: "live_answer_environment",
        artifact_ref: "live_answer:dottie-recipe",
        status: "active",
      }),
    ]));
  });

  it("creates active browser audio transcription constructs without creating answer authority", () => {
    const run = runSituationConstructRecipe({
      recipe_id: "browser_audio_transcriber",
      thread_id: "thread:recipe-transcriber",
      room_id: "room:recipe-transcriber",
      source_ids: ["source:display-tab-audio"],
      label: "Keith tab audio",
      language: "en",
      now: "2026-05-26T18:12:00.000Z",
    });
    const constructs = listSituationConstructs({
      threadId: "thread:recipe-transcriber",
      roomId: "room:recipe-transcriber",
      limit: 20,
    });

    expect(run).toMatchObject({
      recipe_id: "browser_audio_transcriber",
      status: "active",
      commentary_refs: [],
      missing_evidence: [],
      assistant_answer: false,
    });
    expect(run.live_job_contract).toMatchObject({
      schema: "helix.situation_room_live_job_contract.v1",
      purpose: "transcription",
      selected_recipe: "browser_audio_transcriber",
      voice_policy: "muted",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(run.construct_observation).toMatchObject({
      schema: "helix.situation_room_construct_observation.v1",
      terminal_eligible: false,
      panel_generated_answer: false,
      next_step_authority: "agent_step_decision",
      policy_state: {
        spoken: false,
        confirm_speak_receipt_present: false,
        output_authority: "typed_only",
      },
    });
    expect(constructs.map((construct) => construct.type)).toEqual([
      "source_binding",
      "transcription_job",
      "commentary_policy",
    ]);
    expect(constructs.find((construct) => construct.type === "source_binding")).toMatchObject({
      name: "Keith tab audio source binding",
      status: "active",
      source_ids: ["source:display-tab-audio"],
      policy: {
        may_surface_user_text: false,
      },
    });
    expect(constructs.find((construct) => construct.type === "transcription_job")).toMatchObject({
      name: "Keith tab audio transcript job",
      status: "active",
      policy: {
        may_surface_user_text: false,
        may_speak: false,
        may_execute_tools: false,
      },
    });
    expect(constructs.find((construct) => construct.type === "commentary_policy")).toMatchObject({
      status: "receipt_only",
    });
    expect(constructs.every((construct) => construct.safety.instruction_authority === "none")).toBe(true);
    expect(constructs.every((construct) => construct.safety.assistant_answer === false)).toBe(true);
    expect(constructs.every((construct) => construct.safety.raw_audio_included === false)).toBe(true);
    expect(constructs.find((construct) => construct.type === "transcription_job")?.output_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ output_kind: "transcript_stream", status: "active" }),
    ]));
  });

  it("adds optional browser audio live card or note output constructs by output mode", () => {
    const liveRun = runSituationConstructRecipe({
      recipe_id: "browser_audio_transcriber",
      thread_id: "thread:recipe-transcriber-live",
      room_id: "room:recipe-transcriber-live",
      source_ids: ["source:display-tab-audio"],
      output: "live_answer_environment",
      environment_id: "live_answer:transcriber",
      now: "2026-05-26T18:13:00.000Z",
    });
    const liveConstructs = listSituationConstructs({
      threadId: "thread:recipe-transcriber-live",
      roomId: "room:recipe-transcriber-live",
      limit: 20,
    });

    expect(liveRun.status).toBe("active");
    expect(liveConstructs.map((construct) => construct.type)).toEqual([
      "source_binding",
      "transcription_job",
      "commentary_policy",
      "live_environment",
    ]);
    expect(liveConstructs.find((construct) => construct.type === "live_environment")?.output_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        output_kind: "live_answer_environment",
        artifact_ref: "live_answer:transcriber",
        status: "active",
      }),
    ]));
    expect(liveConstructs.find((construct) => construct.type === "transcription_job")?.output_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        output_kind: "live_answer_environment",
        artifact_ref: "live_answer:transcriber",
        status: "active",
      }),
    ]));

    resetAll();

    const noteRun = runSituationConstructRecipe({
      recipe_id: "browser_audio_transcriber",
      thread_id: "thread:recipe-transcriber-note",
      room_id: "room:recipe-transcriber-note",
      source_ids: ["source:display-tab-audio"],
      output: "note",
      now: "2026-05-26T18:14:00.000Z",
    });
    const noteConstructs = listSituationConstructs({
      threadId: "thread:recipe-transcriber-note",
      roomId: "room:recipe-transcriber-note",
      limit: 20,
    });

    expect(noteRun.status).toBe("active");
    expect(noteConstructs.map((construct) => construct.type)).toEqual([
      "source_binding",
      "transcription_job",
      "commentary_policy",
      "note_output",
    ]);
    expect(noteConstructs.find((construct) => construct.type === "note_output")?.output_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ output_kind: "note", status: "planned" }),
    ]));
    expect(noteConstructs.every((construct) => construct.safety.assistant_answer === false)).toBe(true);
  });
});
