import { describe, expect, it } from "vitest";

import {
  auditFormulaBoundScholarlyDebugExport,
  buildFormulaDebugAuditSelfTestPayload,
} from "../../scripts/helix-ask-formula-debug-audit";

const audit = (payload: unknown) =>
  auditFormulaBoundScholarlyDebugExport(payload, {
    file: null,
    turnId: "turn:test",
    source: "turn_debug_export",
  });

describe("formula-bound scholarly debug audit", () => {
  it("passes the canonical numeric recovery fixture", () => {
    const result = audit(buildFormulaDebugAuditSelfTestPayload());

    expect(result.ok).toBe(true);
    expect(result.summary).toMatchObject({
      recovery_kind: "scholarly_numeric_recovery_affordance",
      calculator_solve_requested: false,
      bound_calculator_expression_present: false,
    });
  });

  it("passes when full-text fetch produces recovery evidence", () => {
    const payload = {
      ...buildFormulaDebugAuditSelfTestPayload(),
      scholarly_numeric_recovery_affordance: undefined,
      scholarly_full_text_recovery_affordance: {
        schema: "helix.scholarly_full_text_recovery_affordance.v1",
        status: "available",
        reason: "fetchable_paper_identity_required",
        recovery_queries: ["deuterium tritium fusion Maxwellian averaged reactivity sigma v cross section table accessible pdf"],
      },
      turn_transcript_events: [
        {
          source_event_type: "tool_request",
          capability_id: "scholarly-research.lookup_papers",
          text: "Tool request: scholarly-research.lookup_papers.",
        },
        {
          source_event_type: "tool_request",
          capability_id: "scholarly-research.fetch_full_text",
          text: "Tool request: scholarly-research.fetch_full_text.",
        },
        {
          source_event_type: "model_reentry",
          text: "Codex received the workstation observation packet(s) before final answer.",
        },
      ],
    };

    const result = audit(payload);

    expect(result.ok).toBe(true);
    expect(result.summary).toMatchObject({
      recovery_kind: "scholarly_full_text_recovery_affordance",
      calculator_solve_requested: false,
      bound_calculator_expression_present: false,
    });
  });

  it("fails when calculator solve is requested without a bound expression", () => {
    const payload = {
      ...buildFormulaDebugAuditSelfTestPayload(),
      turn_transcript_events: [
        {
          source_event_type: "tool_request",
          capability_id: "scientific-calculator.solve_expression",
          text: "Tool request: scientific-calculator.solve_expression.",
        },
      ],
    };

    const result = audit(payload);

    expect(result.ok).toBe(false);
    expect(result.summary).toMatchObject({
      calculator_solve_requested: true,
      bound_calculator_expression_present: false,
    });
    expect(result.checks).toContainEqual(expect.objectContaining({
      id: "calculator_safety",
      ok: false,
    }));
  });

  it("fails when calculator solve is paired with a null bound expression placeholder", () => {
    const payload = {
      ...buildFormulaDebugAuditSelfTestPayload(),
      typed_affordance_binding: {
        bound_expression: null,
        missing_variables: ["n1_m3"],
      },
      turn_transcript_events: [
        {
          source_event_type: "tool_request",
          capability_id: "scientific-calculator.solve_expression",
          text: "Tool request: scientific-calculator.solve_expression.",
        },
      ],
    };

    const result = audit(payload);

    expect(result.ok).toBe(false);
    expect(result.summary).toMatchObject({
      calculator_solve_requested: true,
      bound_calculator_expression_present: false,
    });
  });

  it("fails when calculator solve is paired with an unresolved symbolic expression", () => {
    const payload = {
      ...buildFormulaDebugAuditSelfTestPayload(),
      bound_calculator_expression: {
        bound_expression: "n1_m3*n2_m3*sigma_m2*v_m_s",
      },
      turn_transcript_events: [
        {
          source_event_type: "tool_request",
          capability_id: "scientific-calculator.solve_expression",
          text: "Tool request: scientific-calculator.solve_expression.",
        },
      ],
    };

    const result = audit(payload);

    expect(result.ok).toBe(false);
    expect(result.summary).toMatchObject({
      calculator_solve_requested: true,
      bound_calculator_expression_present: false,
    });
  });

  it("allows calculator solve only when a bound calculator expression is present", () => {
    const payload = {
      ...buildFormulaDebugAuditSelfTestPayload(),
      bound_calculator_expression: {
        bound_expression: "1e20*1e20*1e-28*1e6",
        variable_bindings: [],
      },
      turn_transcript_events: [
        {
          source_event_type: "tool_request",
          capability_id: "scientific-calculator.solve_expression",
          text: "Tool request: scientific-calculator.solve_expression.",
        },
      ],
    };

    const result = audit(payload);

    expect(result.ok).toBe(true);
    expect(result.summary).toMatchObject({
      calculator_solve_requested: true,
      bound_calculator_expression_present: true,
    });
  });
});
