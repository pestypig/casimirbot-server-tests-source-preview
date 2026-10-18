import { beforeEach, describe, expect, it } from "vitest";

import {
  createSituationConstruct,
  getSituationConstruct,
  linkSituationConstructs,
  listSituationConstructs,
  recordConstructCommentaryRef,
  recordConstructReceiptRef,
  resetSituationConstructStoreForTest,
} from "../services/situation-room/situation-construct-store";

describe("Situation Room construct ledger", () => {
  beforeEach(resetSituationConstructStoreForTest);

  it("creates evidence-only constructs and lists them by room/type/status", () => {
    const construct = createSituationConstruct({
      construct_id: "construct:observer:dottie",
      type: "observer",
      name: "Auntie Dottie",
      description: "Witness-only observer over public Situation Room events.",
      status: "receipt_only",
      thread_id: "thread:construct",
      room_id: "room:construct",
      source_ids: ["source:display", "source:display", "source:mic"],
      receipt_refs: ["receipt:observer"],
      output_bindings: [{
        output_kind: "typed_commentary",
        artifact_ref: "commentary:dottie",
        status: "active",
      }],
      policy: {
        may_execute_tools: true,
        may_spawn_workers: true,
        may_speak: true,
        may_surface_user_text: true,
        requires_user_confirmation: true,
      },
    });

    expect(construct).toMatchObject({
      schema: "helix.situation_construct.v1",
      type: "observer",
      status: "receipt_only",
      source_ids: ["source:display", "source:mic"],
      safety: {
        assistant_answer: false,
        raw_content_included: false,
        raw_audio_included: false,
        raw_user_text_included: false,
        instruction_authority: "none",
        ask_instruction_authority: "none",
        ask_context_policy: "evidence_only",
        context_role: "tool_evidence",
      },
    });
    expect(construct.policy).toMatchObject({
      may_execute_tools: false,
      allowed_tools: [],
      may_spawn_workers: false,
      may_speak: false,
      may_surface_user_text: false,
      requires_user_confirmation: true,
      witness_only: true,
    });
    expect(listSituationConstructs({
      threadId: "thread:construct",
      roomId: "room:construct",
      type: "observer",
      status: "receipt_only",
    })).toEqual([construct]);
  });

  it("links parent and child constructs and records receipt/commentary refs as evidence", () => {
    createSituationConstruct({
      construct_id: "construct:manifest",
      type: "dottie_manifest",
      name: "Auntie Dottie manifest",
      status: "receipt_only",
      thread_id: "thread:construct-link",
      room_id: "room:construct-link",
    });
    createSituationConstruct({
      construct_id: "construct:voice-policy",
      type: "voice_policy",
      name: "Dottie voice policy",
      status: "receipt_only",
      thread_id: "thread:construct-link",
      room_id: "room:construct-link",
    });

    linkSituationConstructs({
      parentConstructId: "construct:manifest",
      childConstructId: "construct:voice-policy",
    });
    recordConstructReceiptRef({
      constructId: "construct:voice-policy",
      receiptRef: "receipt:voice-policy",
    });
    const child = recordConstructCommentaryRef({
      constructId: "construct:voice-policy",
      commentaryRef: "commentary:voice-policy",
    });

    expect(getSituationConstruct("construct:manifest")?.child_construct_ids).toContain("construct:voice-policy");
    expect(child.parent_construct_ids).toContain("construct:manifest");
    expect(child.receipt_refs).toContain("receipt:voice-policy");
    expect(child.commentary_refs).toContain("commentary:voice-policy");
    expect(child.evidence_refs).toEqual(expect.arrayContaining([
      "receipt:voice-policy",
      "commentary:voice-policy",
    ]));
    expect(child.safety.assistant_answer).toBe(false);
  });

  it("only admits query tools for executable route/field constructs", () => {
    const routeConstruct = createSituationConstruct({
      construct_id: "construct:route-tools",
      type: "route_evidence_view",
      name: "Route evidence view",
      status: "planned",
      thread_id: "thread:tools",
      room_id: "room:tools",
      policy: {
        may_execute_tools: true,
        allowed_tools: [
          "live_env.query_navigation_state",
          "minecraft.query_navigation_state",
          "live_env.mutate_source",
          "shell.exec",
        ],
      },
    });
    const transcriptionConstruct = createSituationConstruct({
      construct_id: "construct:transcriber-tools",
      type: "transcription_job",
      name: "Transcriber",
      status: "active",
      thread_id: "thread:tools",
      room_id: "room:tools",
      policy: {
        may_execute_tools: true,
        allowed_tools: ["live_env.query_source_health"],
        may_speak: true,
        may_surface_user_text: true,
      },
    });

    expect(routeConstruct.policy).toMatchObject({
      may_execute_tools: true,
      allowed_tools: [
        "live_env.query_navigation_state",
        "minecraft.query_navigation_state",
      ],
    });
    expect(transcriptionConstruct.policy).toMatchObject({
      may_execute_tools: false,
      allowed_tools: [],
      may_speak: false,
      may_surface_user_text: false,
    });
    expect(transcriptionConstruct.safety.raw_audio_included).toBe(false);
  });
});
