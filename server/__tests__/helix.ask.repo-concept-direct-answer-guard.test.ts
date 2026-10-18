import { describe, expect, it } from "vitest";

import {
  buildRepoEvidenceRequiredBeforeAnswerObservation,
  shouldBlockModelDirectAnswerForRepoEvidence,
} from "../services/helix-ask/model-direct-answer-step";

describe("repo concept direct-answer guard", () => {
  it("blocks model.direct_answer when the turn is a repo entity definition", () => {
    expect(
      shouldBlockModelDirectAnswerForRepoEvidence({
        payload: {
          canonical_goal_frame: {
            goal_kind: "repo_entity_definition",
          },
        },
        agentStepDecision: {
          next_step: "answer",
          chosen_capability: "model.direct_answer",
        },
      }),
    ).toBe(true);
  });

  it("does not block ordinary model-only direct answers", () => {
    expect(
      shouldBlockModelDirectAnswerForRepoEvidence({
        payload: {
          canonical_goal_frame: {
            goal_kind: "model_only_concept",
          },
        },
        agentStepDecision: {
          next_step: "answer",
          chosen_capability: "model.direct_answer",
        },
      }),
    ).toBe(false);
  });

  it("does not block repo concept synthesis after repo evidence exists", () => {
    expect(
      shouldBlockModelDirectAnswerForRepoEvidence({
        payload: {
          canonical_goal_frame: {
            goal_kind: "repo_entity_definition",
          },
          current_turn_artifact_ledger: [
            {
              artifact_id: "repo:obs:1",
              kind: "repo_code_evidence_observation",
              payload: {
                schema: "helix.repo_code_evidence_observation.v1",
                selected_for_answer: true,
              },
            },
          ],
        },
        agentStepDecision: {
          next_step: "answer",
          chosen_capability: "model.direct_answer",
        },
      }),
    ).toBe(false);
  });

  it("builds a model-visible repo-evidence repair observation", () => {
    expect(
      buildRepoEvidenceRequiredBeforeAnswerObservation({
        turnId: "turn:repo-guard",
        promptText: "What is the Situation Room?",
        payload: {
          canonical_goal_frame: {
            corpus_anchors: ["Situation Room"],
          },
        },
      }),
    ).toMatchObject({
      schema: "helix.repo_evidence_required_before_answer.v1",
      kind: "repo_evidence_required_before_answer",
      turn_id: "turn:repo-guard",
      reason: "repo_evidence_required_before_answer",
      required_capability: "repo-code.search_concept",
      concept: "Situation Room",
      assistant_answer: false,
      raw_content_included: false,
    });
  });
});
