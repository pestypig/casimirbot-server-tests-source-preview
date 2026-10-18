import { describe, expect, it } from "vitest";

import { __testHelixRuntimeAuthorityAudit } from "../services/helix-ask/runtime/runtime-authority-audit";

const buildSynthesisPayload = (artifacts: Array<Record<string, unknown>>) => ({
  terminal_artifact_kind: "final_answer_draft",
  goal_satisfaction_evaluation: {
    satisfaction: "satisfied",
    next_decision: "allow_terminal",
    terminal_artifact_kind: "doc_evidence_synthesis_answer",
    terminal_contract: {
      required_terminal_kinds: ["doc_evidence_synthesis_answer"],
      acceptable_fallbacks: [],
    },
  },
  current_turn_artifact_ledger: artifacts,
});

const reentryArtifact = {
  artifact_id: "ask:test:post_observation_llm_reentry:1",
  turn_id: "ask:test",
  producer_item_id: "post_observation_llm_reentry",
  kind: "post_observation_llm_reentry",
  source_scope: "current_turn",
  payload: {
    schema: "helix.post_observation_llm_reentry.v1",
    status: "satisfied",
    input_observation_refs: ["doc-summary:1"],
    output_draft_ref: "draft:1",
    assistant_answer: false,
    raw_content_included: false,
  },
};

describe("Helix runtime authority audit post-observation reentry", () => {
  it("represents current-turn post-observation LLM reentry evidence when present", () => {
    const audit = __testHelixRuntimeAuthorityAudit.buildHelixRuntimeAuthorityAudit({
      turnId: "ask:test",
      payload: buildSynthesisPayload([reentryArtifact]),
    });

    expect(audit.post_observation_llm_reentry_ref).toBe(reentryArtifact.artifact_id);
    expect(audit.assistant_answer).toBe(false);
    expect(audit.raw_content_included).toBe(false);
    expect(audit.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: "post_observation_llm_reentry_present_for_synthesis_terminal",
          passed: true,
          evidence: reentryArtifact.artifact_id,
        }),
      ]),
    );
  });

  it("keeps missing synthesis reentry as an audit failure without fabricating evidence", () => {
    const audit = __testHelixRuntimeAuthorityAudit.buildHelixRuntimeAuthorityAudit({
      turnId: "ask:test",
      payload: buildSynthesisPayload([]),
    });

    expect(audit.post_observation_llm_reentry_ref).toBeNull();
    expect(audit.assistant_answer).toBe(false);
    expect(audit.raw_content_included).toBe(false);
    expect(audit.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: "post_observation_llm_reentry_present_for_synthesis_terminal",
          passed: false,
          evidence: "missing_post_observation_llm_reentry",
        }),
      ]),
    );
    expect(audit.ok).toBe(false);
  });
});
