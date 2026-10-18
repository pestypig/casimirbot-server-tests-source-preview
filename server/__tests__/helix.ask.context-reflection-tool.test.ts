import { describe, expect, it } from "vitest";

import { isHelixContextReflectionToolReceiptV1 } from "../../shared/contracts/helix-context-reflection-tool-receipt.v1";
import { runHelixContextReflectionTool } from "../services/helix-ask/context-reflection-tool";

describe("Helix Ask context reflection tool", () => {
  it("binds dragged microreasoner cutouts as evidence-only context references", () => {
    const receipt = runHelixContextReflectionTool({
      generatedAt: "2026-06-17T16:00:00.000Z",
      receiptId: "helix-context-reflection-tool-receipt:microdeck",
      turnId: "turn:context-reflection:microdeck",
      threadId: "thread:context-reflection",
      prompt: "Change this microreasoner to output x from live source y.",
      attachments: [
        {
          attachmentId: "ctx:microdeck:earbud:translation",
          kind: "micro_reasoner_deck",
          sourceRole: "dragged_cutout",
          label: "Earbud translation microdeck",
          panelId: "live-answer-environment",
          sourceId: "live-source:earbud",
          artifactRef: "stage_play_micro_reasoner_prompt_preset_query_result:v1",
          sourceRefs: ["frame-span:120-180"],
          region: { unit: "css_px", left: 24, top: 40, width: 320, height: 120 },
          contentDigest: "sha256:microdeck",
          excerpt: "Translate the current earbud live source into operator-readable English.",
        },
      ],
    });

    expect(isHelixContextReflectionToolReceiptV1(receipt)).toBe(true);
    expect(receipt.authority).toMatchObject({
      assistant_answer: false,
      terminal_eligible: false,
      execution_permission: false,
      deterministic_content_role: "context_binding_not_answer",
    });
    expect(receipt.reflection.likelyToolFamilies).toEqual(
      expect.arrayContaining(["context_reflection", "live_source_mail"]),
    );
    expect(receipt.reflection.selectedReferenceRefs).toEqual(
      expect.arrayContaining([
        "ctx:microdeck:earbud:translation",
        "live-source:earbud",
        "stage_play_micro_reasoner_prompt_preset_query_result:v1",
        "frame-span:120-180",
      ]),
    );
    expect(receipt.reflection.recommendedNextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionId: "live_env.draft_micro_reasoner_preset",
          toolFamily: "live_source_mail",
          requiresOperatorCommand: true,
          reasonCodes: expect.arrayContaining(["mutation_requires_separate_admission"]),
        }),
      ]),
    );
  });

  it("marks stale or weak attachments as missing evidence without making them terminal", () => {
    const receipt = runHelixContextReflectionTool({
      turnId: "turn:context-reflection:stale",
      threadId: null,
      prompt: "Use this selected live answer card as context.",
      attachments: [
        {
          attachmentId: "ctx:mail-loop:latest",
          kind: "mail_loop_packet",
          sourceRole: "system_projection",
          panelId: "live-answer-environment",
          sourceRefs: ["stage_play_processed_mail_packet:latest"],
          stale: true,
        },
      ],
    });

    expect(isHelixContextReflectionToolReceiptV1(receipt)).toBe(true);
    expect(receipt.terminal_eligible).toBe(false);
    expect(receipt.reflection.missingEvidence).toEqual(
      expect.arrayContaining(["ctx:mail-loop:latest:content_digest", "ctx:mail-loop:latest:fresh_reference"]),
    );
    expect(receipt.reflection.recommendedNextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionId: "helix_ask.refresh_context_attachment",
          toolFamily: "context_reflection",
          requiresOperatorCommand: false,
        }),
        expect.objectContaining({
          actionId: "live_env.read_processed_live_source_mail",
          toolFamily: "live_source_mail",
        }),
      ]),
    );
  });
});
