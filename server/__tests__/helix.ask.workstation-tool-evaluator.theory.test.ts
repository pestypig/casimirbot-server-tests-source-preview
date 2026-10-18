import { describe, expect, it } from "vitest";
import { evaluateWorkstationToolReceipt } from "../services/helix-ask/workstation-tool-evaluator";

describe("Helix Ask workstation receipt evaluator theory receipts", () => {
  it("marks physics context plans with next actions as needing follow-up tools", () => {
    const evaluation = evaluateWorkstationToolReceipt({
      thread_id: "thread:test",
      receipt: {
        ok: true,
        panel_id: "theory-badge-graph",
        action_id: "plan_calculation_context",
        artifact: {
          kind: "helix_physics_calculation_context_plan",
          next_actions: [{ action_id: "theory-badge-graph.solve_calculator_loadout" }],
        },
      },
    });

    expect(evaluation.result).toBe("needs_followup_tool");
    expect(evaluation.summary).toMatch(/proposed follow-up/i);
  });

  it("accepts theory reflection receipts as evidence only", () => {
    const evaluation = evaluateWorkstationToolReceipt({
      thread_id: "thread:test",
      receipt: {
        ok: true,
        panel_id: "theory-badge-graph",
        action_id: "reflect_discussion_context",
        artifact: {
          kind: "theory_context_reflection",
          assistant_answer: false,
          raw_content_included: false,
          terminal_eligible: false,
          panel_generated_answer: false,
          context_role: "tool_evidence",
          ask_context_policy: "evidence_only",
          evidence_for_ask: {
            summary: "The discussion appears near Warp / GR / NHM2 and QEI / Stress-Energy.",
            claimBoundaries: ["Diagnostic context only."],
          },
          artifact_v1: {
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
            panel_generated_answer: false,
          },
        },
      },
    });

    expect(evaluation.result).toBe("supports_subgoal");
    expect(evaluation.summary).toMatch(/evidence only/i);
    expect(evaluation.summary).toMatch(/Warp \/ GR \/ NHM2/);
  });

  it("accepts Ask-level theory reflection tool receipts as evidence only", () => {
    const reflectionV1 = {
      assistant_answer: false,
      raw_content_included: false,
      terminal_eligible: false,
      panel_generated_answer: false,
      evidenceForAsk: {
        summary: "The discussion appears near Solar Spectrum and energy-frequency badges.",
      },
    };
    const evaluation = evaluateWorkstationToolReceipt({
      thread_id: "thread:test",
      receipt: {
        ok: true,
        tool_id: "helix_ask.reflect_theory_context",
        receipt_id: "receipt:reflection",
        artifact: {
          kind: "helix_theory_context_reflection_tool_receipt",
          artifactId: "helix_theory_context_reflection_tool_receipt",
          schemaVersion: "helix_theory_context_reflection_tool_receipt/v1",
          reflectionV1,
          explanationPlanV1: null,
          authority: {
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
            panel_generated_answer: false,
            context_role: "tool_evidence",
            ask_context_policy: "evidence_only",
            deterministic_content_role: "observation_not_assistant_answer",
          },
          assistant_answer: false,
          raw_content_included: false,
          terminal_eligible: false,
          panel_generated_answer: false,
        },
      },
    });

    expect(evaluation.result).toBe("supports_subgoal");
    expect(evaluation.summary).toMatch(/evidence only/i);
    expect(evaluation.summary).toMatch(/Solar Spectrum/);
  });

  it("rejects terminal Ask-level theory reflection tool receipts", () => {
    const evaluation = evaluateWorkstationToolReceipt({
      thread_id: "thread:test",
      receipt: {
        ok: true,
        tool_id: "helix_ask.reflect_theory_context",
        artifact: {
          kind: "helix_theory_context_reflection_tool_receipt",
          artifactId: "helix_theory_context_reflection_tool_receipt",
          schemaVersion: "helix_theory_context_reflection_tool_receipt/v1",
          reflectionV1: {
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
            panel_generated_answer: false,
          },
          authority: {
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: true,
            panel_generated_answer: false,
          },
          assistant_answer: false,
          raw_content_included: false,
          terminal_eligible: false,
          panel_generated_answer: false,
        },
      },
    });

    expect(evaluation.result).toBe("insufficient");
    expect(evaluation.summary).toMatch(/terminal_eligible_not_false/);
  });

  it("rejects forbidden overclaim phrases in Ask-level theory reflection tool receipts", () => {
    const evaluation = evaluateWorkstationToolReceipt({
      thread_id: "thread:test",
      receipt: {
        ok: true,
        tool_id: "helix_ask.reflect_theory_context",
        artifact: {
          kind: "helix_theory_context_reflection_tool_receipt",
          artifactId: "helix_theory_context_reflection_tool_receipt",
          schemaVersion: "helix_theory_context_reflection_tool_receipt/v1",
          reflectionV1: {
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
            panel_generated_answer: false,
            evidenceForAsk: {
              summary: "QEI passed and physical mechanism confirmed.",
            },
          },
          authority: {
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
            panel_generated_answer: false,
            context_role: "tool_evidence",
            ask_context_policy: "evidence_only",
          },
          assistant_answer: false,
          raw_content_included: false,
          terminal_eligible: false,
          panel_generated_answer: false,
        },
      },
    });

    expect(evaluation.result).toBe("insufficient");
    expect(evaluation.summary).toMatch(/forbidden_claim_phrase/);
  });

  it("rejects terminal-eligible theory reflection receipts", () => {
    const evaluation = evaluateWorkstationToolReceipt({
      thread_id: "thread:test",
      receipt: {
        ok: true,
        panel_id: "theory-badge-graph",
        action_id: "reflect_discussion_context",
        artifact: {
          kind: "theory_context_reflection",
          assistant_answer: false,
          raw_content_included: false,
          terminal_eligible: true,
          artifact_v1: {
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
          },
        },
      },
    });

    expect(evaluation.result).toBe("insufficient");
    expect(evaluation.summary).toMatch(/terminal_eligible_not_false/);
  });

  it("accepts theory explanation plans as evidence only", () => {
    const evaluation = evaluateWorkstationToolReceipt({
      thread_id: "thread:test",
      receipt: {
        ok: true,
        panel_id: "theory-badge-graph",
        action_id: "explain_reflected_context",
        artifact: {
          kind: "theory_context_explanation_plan",
          assistant_answer: false,
          raw_content_included: false,
          terminal_eligible: false,
          panel_generated_answer: false,
          context_role: "tool_evidence",
          ask_context_policy: "evidence_only",
          artifact_v1: {
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
            panel_generated_answer: false,
            explanationSteps: [{ id: "step:1" }],
            summary: {
              scalarCutCount: 2,
              runtimeCount: 1,
            },
          },
        },
      },
    });

    expect(evaluation.result).toBe("supports_subgoal");
    expect(evaluation.summary).toMatch(/first-principle roots/i);
    expect(evaluation.summary).toMatch(/2 scalar cuts/);
  });

  it("rejects raw-content theory reflection receipts", () => {
    const evaluation = evaluateWorkstationToolReceipt({
      thread_id: "thread:test",
      receipt: {
        ok: true,
        panel_id: "theory-badge-graph",
        action_id: "reflect_discussion_context",
        artifact: {
          kind: "theory_context_reflection",
          assistant_answer: false,
          raw_content_included: true,
          terminal_eligible: false,
          artifact_v1: {
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
          },
        },
      },
    });

    expect(evaluation.result).toBe("insufficient");
    expect(evaluation.summary).toMatch(/raw_content_included_not_false/);
  });

  it("downgrades forbidden overclaim phrases in reflection receipts", () => {
    const evaluation = evaluateWorkstationToolReceipt({
      thread_id: "thread:test",
      receipt: {
        ok: true,
        panel_id: "theory-badge-graph",
        action_id: "reflect_discussion_context",
        artifact: {
          kind: "theory_context_reflection",
          assistant_answer: false,
          raw_content_included: false,
          terminal_eligible: false,
          evidence_for_ask: {
            summary: "QEI passed and physical mechanism confirmed.",
          },
          artifact_v1: {
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
          },
        },
      },
    });

    expect(evaluation.result).toBe("insufficient");
    expect(evaluation.summary).toMatch(/forbidden_claim_phrase/);
  });

  it("treats recommended action admission artifacts as evidence-only policy", () => {
    const evaluation = evaluateWorkstationToolReceipt({
      thread_id: "thread:test",
      receipt: {
        ok: true,
        receipt_id: "receipt:admission",
        artifact: {
          kind: "helix_recommended_action_admission",
          artifactId: "helix_recommended_action_admission",
          schemaVersion: "helix_recommended_action_admission/v1",
          generatedAt: "2026-06-01T00:00:00.000Z",
          admissionId: "admission:test",
          prompt: "Map source residual.",
          sourceReceiptId: "receipt:reflection",
          actions: [
            {
              actionId: "theory-badge-graph.build_compound_theory_run",
              panelId: "theory-badge-graph",
              label: "Build compound theory run",
              mutatesCalculator: false,
              solves: false,
              objectiveFit: "high",
              risk: "read_only",
              admission: "auto",
              requiresConfirmation: false,
              agentExecutable: false,
              reason: "Read-only preview.",
              reasonCode: "read_only_allowlisted",
              display_policy: "diagnostic_only",
            },
          ],
          summary: {
            actionCount: 1,
            autoCount: 1,
            askUserCount: 0,
            blockedCount: 0,
          },
          authority: {
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: false,
            context_role: "tool_policy",
            ask_context_policy: "evidence_only",
            agent_executable: false,
          },
        },
      },
    });

    expect(evaluation.result).toBe("supports_subgoal");
    expect(evaluation.summary).toMatch(/evidence-only tool policy/i);
  });

  it("rejects executable recommended action admissions", () => {
    const evaluation = evaluateWorkstationToolReceipt({
      thread_id: "thread:test",
      receipt: {
        ok: true,
        receipt_id: "receipt:bad-admission",
        artifact: {
          kind: "helix_recommended_action_admission",
          artifactId: "helix_recommended_action_admission",
          schemaVersion: "helix_recommended_action_admission/v1",
          generatedAt: "2026-06-01T00:00:00.000Z",
          admissionId: "admission:bad",
          prompt: "Map source residual.",
          sourceReceiptId: "receipt:reflection",
          actions: [
            {
              actionId: "theory-badge-graph.build_compound_theory_run",
              panelId: "theory-badge-graph",
              label: "Build compound theory run",
              mutatesCalculator: false,
              solves: false,
              objectiveFit: "high",
              risk: "read_only",
              admission: "auto",
              requiresConfirmation: false,
              agentExecutable: true,
              reason: "Read-only preview.",
              reasonCode: "read_only_allowlisted",
              display_policy: "diagnostic_only",
            },
          ],
          summary: {
            actionCount: 1,
            autoCount: 1,
            askUserCount: 0,
            blockedCount: 0,
          },
          authority: {
            assistant_answer: false,
            raw_content_included: false,
            terminal_eligible: true,
            context_role: "tool_policy",
            ask_context_policy: "evidence_only",
            agent_executable: true,
          },
        },
      },
    });

    expect(evaluation.result).toBe("insufficient");
    expect(evaluation.summary).toMatch(/diagnostic_only actions cannot be agent executable/);
  });
});
