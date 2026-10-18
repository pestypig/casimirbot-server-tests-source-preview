import { beforeEach, describe, expect, it } from "vitest";

import {
  applySituationRoomDottieManifestPreset,
  buildSituationRoomDottieManifestPreset,
} from "../services/situation-room/dottie-manifest-preset";
import {
  listDottieManifestRuns,
  resetDottieManifestRunsForTest,
} from "../services/situation-room/dottie-manifest-run-store";
import { clearInterpretedEventLogForTest } from "../services/situation-room/interpreted-event-log-store";
import {
  listLiveEnvironmentCommentary,
  resetLiveEnvironmentCommentaryForTest,
} from "../services/situation-room/live-environment-commentary-store";
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

describe("Dottie manifest run ledger", () => {
  beforeEach(resetAll);

  it("records applied manifest runs as evidence-only receipt ledgers", () => {
    const preset = buildSituationRoomDottieManifestPreset({
      threadId: "thread:dottie-run",
      roomId: "room:dottie-run",
      targetRunId: "run:ask:dottie-run",
      voiceMode: "propose_only",
    });

    const receipt = applySituationRoomDottieManifestPreset(preset);
    const runs = listDottieManifestRuns({
      threadId: "thread:dottie-run",
      roomId: "room:dottie-run",
      limit: 10,
    });
    const commentary = listLiveEnvironmentCommentary({
      threadId: "thread:dottie-run",
      roomId: "room:dottie-run",
      subject: "dottie_observer",
      limit: 10,
    });
    const constructs = listSituationConstructs({
      threadId: "thread:dottie-run",
      roomId: "room:dottie-run",
      limit: 20,
    });

    expect(receipt).toMatchObject({
      kind: "dottie_manifest_preset_receipt",
      assistant_answer: false,
      raw_content_included: false,
      command_lane_enabled: false,
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      schema: "helix.dottie_manifest_run.v1",
      preset_id: "auntie_dottie",
      status: "applied_as_receipts",
      safety: {
        command_lane_enabled: false,
        assistant_answer: false,
        raw_content_included: false,
        instruction_authority: "none",
      },
    });
    expect(runs[0]?.receipt_refs).toEqual(expect.arrayContaining(receipt.child_artifact_refs));
    expect(runs[0]?.applied_steps.map((step) => step.step)).toEqual([
      "live_answer_environment",
      "commentary_policy",
      "observer_subscription",
      "voice_policy",
      "field_worker_policy",
    ]);
    expect(runs[0]?.applied_steps.every((step) =>
      step.status !== "created" || Boolean(step.artifact_ref)
    )).toBe(true);
    expect(runs[0]?.applied_steps.every((step) => step.status === "receipt_only")).toBe(true);
    expect(commentary.at(-1)).toMatchObject({
      schema: "helix.live_environment_commentary.v1",
      subject: "dottie_observer",
      kind: "tool_trace",
      assistant_answer: false,
      raw_content_included: false,
      instruction_authority: "none",
      ask_context_policy: "evidence_only",
    });
    expect(runs[0]?.commentary_refs).toContain(commentary.at(-1)?.commentary_id);
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
    expect(constructs.every((construct) => construct.safety.instruction_authority === "none")).toBe(true);
    expect(constructs.every((construct) => construct.safety.ask_instruction_authority === "none")).toBe(true);
    expect(constructs.every((construct) => construct.safety.raw_audio_included === false)).toBe(true);
    expect(constructs.every((construct) => construct.safety.ask_context_policy === "evidence_only")).toBe(true);
    const manifestConstruct = constructs.find((construct) => construct.type === "dottie_manifest");
    const liveEnvironmentConstruct = constructs.find((construct) => construct.type === "live_environment");
    const liveAnswerOutputConstruct = constructs.find((construct) => construct.type === "live_answer_output");
    const observerConstruct = constructs.find((construct) => construct.type === "observer");
    const voicePolicyConstruct = constructs.find((construct) => construct.type === "voice_policy");
    expect(manifestConstruct?.child_construct_ids.length).toBe(6);
    expect(liveEnvironmentConstruct?.child_construct_ids).toContain(liveAnswerOutputConstruct?.construct_id);
    expect(liveAnswerOutputConstruct).toMatchObject({
      name: "Dottie live answer output",
      status: "receipt_only",
      safety: {
        assistant_answer: false,
        instruction_authority: "none",
      },
    });
    expect(liveAnswerOutputConstruct?.output_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ output_kind: "live_answer_environment", status: "planned" }),
      expect.objectContaining({ output_kind: "typed_commentary", status: "active" }),
    ]));
    expect(observerConstruct).toMatchObject({
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
    expect(observerConstruct?.parent_construct_ids).toContain(manifestConstruct?.construct_id);
    expect(observerConstruct?.output_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ output_kind: "typed_commentary", status: "active" }),
    ]));
    expect(voicePolicyConstruct?.output_bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ output_kind: "voice_proposal", status: "planned" }),
    ]));
  });

  it("binds a Dottie live answer output to an existing environment when supplied", () => {
    const preset = buildSituationRoomDottieManifestPreset({
      threadId: "thread:dottie-existing-env",
      roomId: "room:dottie-existing-env",
      environmentId: "live_answer:dottie-existing-env",
    });

    applySituationRoomDottieManifestPreset(preset);
    const constructs = listSituationConstructs({
      threadId: "thread:dottie-existing-env",
      roomId: "room:dottie-existing-env",
      limit: 20,
    });

    expect(constructs.find((construct) => construct.type === "live_answer_output")).toMatchObject({
      status: "active",
      environment_id: "live_answer:dottie-existing-env",
      output_bindings: expect.arrayContaining([
        expect.objectContaining({
          output_kind: "live_answer_environment",
          artifact_ref: "live_answer:dottie-existing-env",
          status: "active",
        }),
      ]),
    });
  });
});
