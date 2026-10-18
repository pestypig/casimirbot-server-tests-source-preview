import { describe, expect, it } from "vitest";

import {
  evaluateCompoundPromptCoverageGate,
  type HelixCompoundPromptCoverageGateInput,
} from "../services/helix-ask/compound-prompt-coverage-gate";
import { evaluateCompoundPromptCoverageGateFromAnswerArtifacts } from "../services/helix-ask/model-only-compound-coverage";
import type { HelixCompoundPromptContract } from "../services/helix-ask/prompt-interpretation";

const contractWith = (ids: string[]): HelixCompoundPromptContract => ({
  schema: "helix.compound_prompt_contract.v1",
  root_prompt_id: "compound:test",
  raw_prompt_hash: "hash",
  raw_prompt_chars: 120,
  root_objective: "answer the compound prompt",
  requirements: ids.map((id, index) => ({
    id,
    text: `Requirement ${id} asks for distinct topic ${index + 1}`,
    kind: "question",
    required: true,
    depends_on: [],
    status: "pending",
  })),
  global_constraints: [],
  negative_constraints: [],
  evidence_requirements: [],
  output_contract: {
    must_include_coverage_ledger: true,
    allow_partial_answer: false,
  },
  assistant_answer: false,
  raw_content_included: false,
});

const gate = (input: Partial<HelixCompoundPromptCoverageGateInput>) =>
  evaluateCompoundPromptCoverageGate({
    contract: contractWith(["R1", "R2", "R3"]),
    finalAnswerText: "",
    terminalArtifactKind: "direct_answer_text",
    finalAnswerSource: "model_direct_answer",
    ...input,
  });

describe("compound prompt coverage gate", () => {
  it("counts an explicit scientific non-validation boundary as an answer", () => {
    const contract = contractWith(["R1", "R2"]);
    contract.requirements = [
      {
        ...contract.requirements[0],
        text: "Compare the NHM2 source-closure caution with arXiv:2105.03079.",
      },
      {
        ...contract.requirements[1],
        text: "Explain where they agree and where the paper does not validate NHM2, citing both sources.",
      },
    ];
    const result = evaluateCompoundPromptCoverageGate({
      contract,
      finalAnswerText: [
        "The NHM2 whitepaper and arXiv:2105.03079 agree that observer-side calculations do not establish physical viability.",
        "The paper does not validate NHM2's specific construction; it supplies a general negative constraint, not confirmation. Both sources preserve that claim boundary.",
      ].join("\n"),
      terminalArtifactKind: "compound_evidence_synthesis_answer",
      finalAnswerSource: "agent_provider_terminal_candidate",
    });

    expect(result.passed).toBe(true);
    expect(result.unresolved_requirement_ids).toEqual([]);
    expect(result.resolutions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ requirement_id: "R2", status: "answered" }),
      ]),
    );
  });

  it("prefers a source-targeted compound synthesis over a generic ledger draft", () => {
    const turnId = "ask:test:source-compound-answer-priority";
    const contract = contractWith(["R1", "R2"]);
    contract.requirements = [
      {
        ...contract.requirements[0],
        text: "Compare the NHM2 source-closure caution with arXiv:2105.03079.",
      },
      {
        ...contract.requirements[1],
        text: "Explain where they agree and where the paper does not validate NHM2, citing both sources.",
      },
    ];
    const result = evaluateCompoundPromptCoverageGateFromAnswerArtifacts({
      turnId,
      payload: {
        canonical_goal_frame: {
          goal_kind: "compound_evidence_synthesis",
          answer_scope: "source_tool_backed",
          required_terminal_kind: "compound_evidence_synthesis_answer",
        },
        source_target_intent: {
          target_source: "compound_sources",
          target_kind: "compound_sources",
          strength: "hard",
        },
      },
      artifactLedger: [
        {
          artifact_id: `${turnId}:final_answer_draft`,
          kind: "final_answer_draft",
          payload: {
            text: "The compound tool turn completed all mandatory subgoals.",
          },
        },
        {
          artifact_id: `${turnId}:compound_evidence_synthesis_answer`,
          kind: "compound_evidence_synthesis_answer",
          payload: {
            text: [
              "The NHM2 whitepaper and arXiv:2105.03079 agree that limited observer results do not establish physical viability.",
              "The paper does not validate NHM2's construction; it supplies a general constraint, not confirmation, and both sources are cited.",
            ].join("\n"),
          },
        },
      ],
      promptText: "Compare the sources and explain the non-validation boundary.",
      contract,
      routeScope: "source_targeted",
    });

    expect(result.gate.passed).toBe(true);
    expect(result.gate.unresolved_requirement_ids).toEqual([]);
    expect(result.selected_answer_source).toBe("provided_final_answer_text");
  });

  it("does not construct a stale execution gate for a canonical capability-help goal", () => {
    const result = evaluateCompoundPromptCoverageGateFromAnswerArtifacts({
      turnId: "ask:test:capability-help-coverage",
      payload: {
        canonical_goal_frame: {
          required_terminal_kind: "capability_help_summary",
        },
        terminal_artifact_kind: "typed_failure",
        final_answer_source: "typed_failure",
      },
      artifactLedger: [],
      promptText: "Does the paper tool use Image Lens?",
      contract: contractWith(["RESEARCH_PAPER_TOOL", "IMAGE_LENS"]),
      routeScope: "source_targeted",
    });

    expect(result.gate).toMatchObject({
      applies: false,
      passed: true,
      decision: "NOT_APPLICABLE",
      reason: "capability_help_terminal",
    });
  });

  it("does not reinterpret capability-help nouns as compound execution requirements", () => {
    const result = evaluateCompoundPromptCoverageGate({
      contract: contractWith(["RESEARCH_PAPER_TOOL", "IMAGE_LENS"]),
      finalAnswerText: "The research workflow uses Image Lens only when visual extraction is needed.",
      terminalArtifactKind: "capability_help_summary",
      finalAnswerSource: "capability_help_summary",
    });

    expect(result).toMatchObject({
      applies: false,
      passed: true,
      decision: "NOT_APPLICABLE",
      reason: "capability_help_terminal",
    });
  });

  it("fails terminal authority when compound coverage misses a required item", () => {
    const result = gate({
      finalAnswerText: "[REQ:R1] Answer one.\n[REQ:R2] Answer two.",
    });

    expect(result.applies).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.decision).toBe("FAIL_CLOSED");
    expect(result.unresolved_requirement_ids).toContain("R3");
  });

  it("does not count blocked requirements unless the block reason is terminal-visible", () => {
    const result = gate({
      finalAnswerText: "[REQ:R1] Answer one.",
      proposedResolutions: [
        { requirement_id: "R2", status: "blocked_with_reason", reason: "missing evidence" },
        { requirement_id: "R3", status: "blocked_with_reason", reason: "missing evidence" },
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.non_visible_blocked_requirement_ids).toEqual(expect.arrayContaining(["R2", "R3"]));
  });

  it("accepts trusted current-turn evidence resolutions without requiring procedural phrase repetition", () => {
    const result = gate({
      finalAnswerText: "The wall was built successfully and its final footprint was verified.",
      proposedResolutions: [
        {
          requirement_id: "R1",
          status: "answered",
          reason: "successful build observation",
          evidence_refs: ["obs:build"],
        },
        {
          requirement_id: "R2",
          status: "answered",
          reason: "inspection preceded mutation",
          evidence_refs: ["obs:inspect", "obs:build"],
        },
        {
          requirement_id: "R3",
          status: "answered",
          reason: "post-mutation verification observation",
          evidence_refs: ["obs:verify"],
        },
      ],
    });

    expect(result).toMatchObject({
      applies: true,
      passed: true,
      decision: "PASS",
      answered_count: 3,
      unresolved_requirement_ids: [],
    });
  });

  it("keeps unproven requirements fail-closed beside trusted resolutions", () => {
    const result = gate({
      finalAnswerText: "The wall was built successfully.",
      proposedResolutions: [
        {
          requirement_id: "R1",
          status: "answered",
          evidence_refs: ["obs:build"],
        },
        {
          requirement_id: "R2",
          status: "answered",
          evidence_refs: ["obs:inspect", "obs:build"],
        },
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.unresolved_requirement_ids).toEqual(["R3"]);
  });

  it("fails closed on a visibly blocked required item when partial answers are disallowed", () => {
    const result = evaluateCompoundPromptCoverageGate({
      contract: contractWith(["R1", "R2"]),
      finalAnswerText: [
        "[REQ:R1] Answer one.",
        "[REQ:R2_BLOCKED] I could not answer this because the required repo evidence is missing.",
      ].join("\n"),
      terminalArtifactKind: "direct_answer_text",
      finalAnswerSource: "model_direct_answer",
    });

    expect(result.passed).toBe(false);
    expect(result.blocked_count).toBe(1);
    expect(result.unresolved_requirement_ids).toContain("R2");
  });

  it("allows a visibly blocked required item only when the prompt contract permits partial answers", () => {
    const contract = contractWith(["R1", "R2"]);
    contract.output_contract.allow_partial_answer = true;
    const result = evaluateCompoundPromptCoverageGate({
      contract,
      finalAnswerText: [
        "[REQ:R1] Answer one.",
        "[REQ:R2_BLOCKED] I could not answer this because the required repo evidence is missing.",
      ].join("\n"),
      terminalArtifactKind: "direct_answer_text",
      finalAnswerSource: "model_direct_answer",
    });

    expect(result.passed).toBe(true);
    expect(result.blocked_count).toBe(1);
    expect(result.unresolved_requirement_ids).toEqual([]);
  });

  it("does not mistake an untagged truthful non-completion report for completed execution", () => {
    const result = evaluateCompoundPromptCoverageGate({
      contract: {
        ...contractWith(["R1", "R2"]),
        requirements: [
          {
            id: "R1",
            text: "Query the current gamerule value.",
            kind: "instruction",
            required: true,
            depends_on: [],
            status: "pending",
          },
          {
            id: "R2",
            text: "Restore the exact original gamerule value and query it again with fresh observations.",
            kind: "constraint",
            required: true,
            depends_on: ["R1"],
            status: "pending",
          },
        ],
      },
      finalAnswerText: [
        "The gamerule was queried and changed.",
        "I do not have a fresh observation showing the exact original gamerule value was restored.",
      ].join("\n"),
      terminalArtifactKind: "model_synthesized_answer",
      finalAnswerSource: "agent_provider_terminal_candidate",
    });

    expect(result.passed).toBe(false);
    expect(result.blocked_count).toBe(1);
    expect(result.unresolved_requirement_ids).toContain("R2");
  });

  it("keeps a completed first observation while rejecting a live set/restore/re-query non-completion", () => {
    const result = evaluateCompoundPromptCoverageGate({
      contract: {
        ...contractWith(["R1", "R2"]),
        requirements: [
          {
            id: "R1",
            text: 'Safely test reversible Minecraft world mutation now. First query "/gamerule doDaylightCycle".',
            kind: "instruction",
            required: true,
            depends_on: [],
            status: "pending",
          },
          {
            id: "R2",
            text: "Then set it to the opposite value, restore the exact original value, and query it once more to verify restoration. Use fresh Fabric command observations for every step and do not stop after the first query.",
            kind: "constraint",
            required: true,
            depends_on: ["R1"],
            status: "pending",
          },
        ],
      },
      finalAnswerText: [
        "`/gamerule doDaylightCycle` returned `false`.",
        "I cannot complete the set/restore/re-query sequence from the currently re-entered evidence because this turn only admits the read-only query observation, not a mutation-capable follow-up.",
      ].join("\n\n"),
      terminalArtifactKind: "model_synthesized_answer",
      finalAnswerSource: "agent_provider_terminal_candidate",
    });

    expect(result.passed).toBe(false);
    expect(result.resolutions.find((entry) => entry.requirement_id === "R1")?.status).toBe("answered");
    expect(result.resolutions.find((entry) => entry.requirement_id === "R2")?.status).toBe("blocked_with_reason");
    expect(result.unresolved_requirement_ids).toEqual(["R2"]);
  });

  it("treats a visible missing-items heading as applying to its compound-operation list", () => {
    const result = evaluateCompoundPromptCoverageGate({
      contract: {
        ...contractWith(["R1", "R2"]),
        requirements: [
          {
            id: "R1",
            text: 'First query "/gamerule doDaylightCycle".',
            kind: "instruction",
            required: true,
            depends_on: [],
            status: "pending",
          },
          {
            id: "R2",
            text: "Set it to the opposite value, restore the exact original value, and query it once more with a fresh observation to verify restoration.",
            kind: "constraint",
            required: true,
            depends_on: ["R1"],
            status: "pending",
          },
        ],
      },
      finalAnswerText: [
        "Observed sequence:",
        "- Initial query: doDaylightCycle was false",
        "- Mutation: set doDaylightCycle to true",
        "What is still missing:",
        "- restoring the exact original value, false",
        "- a final fresh query to verify it was restored",
      ].join("\n"),
      terminalArtifactKind: "model_synthesized_answer",
      finalAnswerSource: "agent_provider_terminal_candidate",
    });

    expect(result.passed).toBe(false);
    expect(result.unresolved_requirement_ids).toContain("R2");
  });

  it("does not count requirements listed under a not-yet-completed heading as answered", () => {
    const contract = contractWith(["R1", "R2", "R3", "R4"]);
    contract.requirements = [
      {
        ...contract.requirements[0],
        text: "Inspect the current player state.",
      },
      {
        ...contract.requirements[1],
        text: "Interact with the verified reachable target.",
      },
      {
        ...contract.requirements[2],
        text: "Equip the stick and craft four oak planks.",
      },
      {
        ...contract.requirements[3],
        text: "Verify every checkpoint and release all controls.",
      },
    ];
    const result = evaluateCompoundPromptCoverageGate({
      contract,
      finalAnswerText: [
        "Current turn is only partially complete.",
        "Completed:",
        "- Inspected the current player state.",
        "Not yet completed:",
        "- Interact with the verified reachable target.",
        "- Equip the stick and craft four oak planks.",
        "- Verify every checkpoint and release all controls.",
      ].join("\n"),
      terminalArtifactKind: "model_synthesized_answer",
      finalAnswerSource: "agent_provider_terminal_candidate",
    });

    expect(result.passed).toBe(false);
    expect(result.resolutions.find((entry) => entry.requirement_id === "R1")?.status).toBe("answered");
    expect(result.resolutions.find((entry) => entry.requirement_id === "R2")?.status).toBe("blocked_with_reason");
    expect(result.resolutions.find((entry) => entry.requirement_id === "R3")?.status).toBe("blocked_with_reason");
    expect(result.resolutions.find((entry) => entry.requirement_id === "R4")?.status).toBe("blocked_with_reason");
    expect(result.unresolved_requirement_ids).toEqual(["R2", "R3", "R4"]);
  });

  it("does not count requirements listed under a not-confirmed heading as answered", () => {
    const contract = contractWith(["R1", "R2", "R3", "R4"]);
    contract.requirements = [
      { ...contract.requirements[0], text: "Execute the bounded jump." },
      { ...contract.requirements[1], text: "Perform the bounded sprint step." },
      { ...contract.requirements[2], text: "Interact with the verified reachable target." },
      { ...contract.requirements[3], text: "Equip the stick and craft four oak planks." },
    ];
    const result = evaluateCompoundPromptCoverageGate({
      contract,
      finalAnswerText: [
        "The bounded jump was executed.",
        "What is not confirmed in the available evidence:",
        "- The bounded sprint step.",
        "- The verified reachable target interaction.",
        "- Equipping the stick and crafting four oak planks.",
      ].join("\n"),
      terminalArtifactKind: "model_synthesized_answer",
      finalAnswerSource: "agent_provider_terminal_candidate",
    });

    expect(result.passed).toBe(false);
    expect(result.resolutions.find((entry) => entry.requirement_id === "R1")?.status).toBe("answered");
    expect(result.resolutions.find((entry) => entry.requirement_id === "R2")?.status).toBe("blocked_with_reason");
    expect(result.resolutions.find((entry) => entry.requirement_id === "R3")?.status).toBe("blocked_with_reason");
    expect(result.resolutions.find((entry) => entry.requirement_id === "R4")?.status).toBe("blocked_with_reason");
    expect(result.unresolved_requirement_ids).toEqual(["R2", "R3", "R4"]);
  });

  it("does not count requirements listed under a not-evidenced heading as answered", () => {
    const contract = contractWith(["R1", "R2"]);
    contract.requirements = [
      { ...contract.requirements[0], text: "Craft four oak planks." },
      { ...contract.requirements[1], text: "Equip the stick and interact with the reachable target." },
    ];
    const result = evaluateCompoundPromptCoverageGate({
      contract,
      finalAnswerText: [
        "Four oak planks were crafted and verified in inventory.",
        "What is not evidenced in the current turn:",
        "- equipping the stick and interacting with the reachable target",
      ].join("\n"),
      terminalArtifactKind: "model_synthesized_answer",
      finalAnswerSource: "agent_provider_terminal_candidate",
    });

    expect(result.passed).toBe(false);
    expect(result.resolutions.find((entry) => entry.requirement_id === "R1")?.status).toBe("answered");
    expect(result.resolutions.find((entry) => entry.requirement_id === "R2")?.status).toBe("blocked_with_reason");
    expect(result.unresolved_requirement_ids).toEqual(["R2"]);
  });

  it("rejects the exact live restore-and-verify evidence disclaimer", () => {
    const result = evaluateCompoundPromptCoverageGate({
      contract: {
        ...contractWith(["R1", "R2"]),
        requirements: [
          {
            id: "R1",
            text: 'First query "/gamerule doDaylightCycle".',
            kind: "instruction",
            required: true,
            depends_on: [],
            status: "pending",
          },
          {
            id: "R2",
            text: "Set it to the opposite value, restore the exact original value, and query it once more with a fresh observation to verify restoration.",
            kind: "constraint",
            required: true,
            depends_on: ["R1"],
            status: "pending",
          },
        ],
      },
      finalAnswerText: [
        "Initial query returned false. Mutation to true succeeded.",
        "I do not have a fresh observation for the restore-back-to-original step, so I cannot verify from the supplied evidence that the exact original value was restored and queried again.",
      ].join("\n\n"),
      terminalArtifactKind: "model_synthesized_answer",
      finalAnswerSource: "agent_provider_terminal_candidate",
    });

    expect(result.passed).toBe(false);
    expect(result.unresolved_requirement_ids).toContain("R2");
  });

  it("does not apply compound coverage gate to non-compound prompts", () => {
    const result = evaluateCompoundPromptCoverageGate({
      contract: contractWith(["R1"]),
      finalAnswerText: "Answer one.",
    });

    expect(result.applies).toBe(false);
    expect(result.decision).toBe("NOT_APPLICABLE");
  });

  it("treats typed failures as explicit failed-closed coverage", () => {
    const result = gate({
      finalAnswerText: "I could not complete this turn.",
      terminalArtifactKind: "typed_failure",
      finalAnswerSource: "typed_failure",
    });

    expect(result.passed).toBe(true);
    expect(result.failed_closed_count).toBe(3);
  });
});
