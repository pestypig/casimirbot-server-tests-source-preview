import { describe, expect, it } from "vitest";
import {
  HELIX_ENVIRONMENT_ACTION_DIFFERENTIAL_TRACE_SCHEMA,
  helixEnvironmentActionDifferentialTraceSchema,
  type HelixEnvironmentActionDifferentialLane,
  type HelixEnvironmentActionDifferentialTrace,
} from "@shared/helix-environment-action";
import { auditEnvironmentActionG2Parity } from "../workflow-g2-parity-audit";

const hash = (character: string) => `sha256:${character.repeat(64)}` as const;

const trace = (
  lane: HelixEnvironmentActionDifferentialLane,
): HelixEnvironmentActionDifferentialTrace => {
  const observationRef = `environment_action_observation:${lane}`;
  const ask = lane === "helix_ask";
  return helixEnvironmentActionDifferentialTraceSchema.parse({
    schema: HELIX_ENVIRONMENT_ACTION_DIFFERENTIAL_TRACE_SCHEMA,
    trace_id: `environment_action_differential_trace:${lane}:fluid-course`,
    scenario_id: "minecraft_player_workflow:fluid_micro_course",
    lane,
    action_kind: "execute_sequence",
    prompt_hash: hash("a"),
    starting_state_hash: hash("b"),
    capability_contract_hash: hash("c"),
    source_artifact_refs: [`public_trace:${lane}`],
    public_capture_hash: hash(lane === "direct_codex" ? "1" : lane === "codex_mcp" ? "2" : "3"),
    selected_capability_id: "com.casimirbot.minecraft.player.sequence.execute",
    normalized_arguments_hash: hash("d"),
    admission_status: lane === "direct_codex" ? "not_applicable" : "admitted",
    execution_outcome: "succeeded",
    normalized_progress_hashes: [hash("e"), hash("f")],
    postcondition_status: "satisfied",
    observation_refs: [observationRef],
    observation_reentered: lane !== "direct_codex",
    final_candidate_hash: lane === "direct_codex" ? null : hash("9"),
    final_candidate_support_refs: lane === "direct_codex" ? [] : [observationRef],
    route_product_hash: ask ? hash("9") : null,
    route_product_support_refs: ask ? [observationRef] : [],
    terminal_outcome: lane === "codex_mcp" ? "not_applicable" : "success",
    terminal_authority_status: ask ? "passed" : "not_applicable",
    terminal_writer_hash: ask ? hash("9") : null,
    terminal_writer_support_refs: ask ? [observationRef] : [],
    visible_text_hash: ask ? hash("9") : null,
    voice_projection_status: ask ? "not_observed" : "not_applicable",
    voice_text_hash: null,
    created_at: "2026-08-20T18:00:00.000Z",
    hidden_reasoning_included: false,
    content_role: "environment_action_differential_trace_not_assistant_answer",
    answer_authority: false,
    assistant_answer: false,
    terminal_eligible: false,
    raw_content_included: false,
  });
};

describe("G2 A0/A1/B environment parity observer", () => {
  it("accepts equivalent execution with lane-local evidence and B-only terminal authority", () => {
    const audit = auditEnvironmentActionG2Parity({
      a0: trace("direct_codex"),
      a1: trace("codex_mcp"),
      b: trace("helix_ask"),
      comparedAt: "2026-08-20T18:01:00.000Z",
    });
    expect(audit).toMatchObject({
      ok: true,
      first_divergence_stage: null,
      mismatches: [],
      observer_only: true,
      assistant_answer: false,
      terminal_eligible: false,
    });
  });

  it("stops first at an A1 normalized-argument divergence", () => {
    const a1 = {
      ...trace("codex_mcp"),
      normalized_arguments_hash: hash("8"),
    };
    const audit = auditEnvironmentActionG2Parity({
      a0: trace("direct_codex"),
      a1,
      b: trace("helix_ask"),
    });
    expect(audit.ok).toBe(false);
    expect(audit.first_divergence_stage).toBe("capability_selection");
    expect(audit.mismatches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        comparison: "a0_to_a1",
        code: "normalized_arguments_mismatch",
      }),
    ]));
  });

  it("reports B evidence re-entry before a later terminal substitution", () => {
    const b = {
      ...trace("helix_ask"),
      observation_reentered: false,
      final_candidate_hash: null,
      final_candidate_support_refs: [],
      route_product_hash: null,
      route_product_support_refs: [],
      terminal_authority_status: "failed" as const,
      terminal_writer_hash: hash("7"),
      terminal_writer_support_refs: [],
      visible_text_hash: hash("7"),
    };
    const audit = auditEnvironmentActionG2Parity({
      a0: trace("direct_codex"),
      a1: trace("codex_mcp"),
      b,
    });
    expect(audit.first_divergence_stage).toBe("evidence_reentry");
    expect(audit.mismatches.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "b_execution_observation_not_reentered",
        "b_terminal_authority_incomplete",
      ]),
    );
  });

  it("rejects an MCP trace that claims Helix Ask terminal authority", () => {
    const a1 = {
      ...trace("codex_mcp"),
      terminal_authority_status: "passed" as const,
      terminal_writer_hash: hash("9"),
      visible_text_hash: hash("9"),
    };
    const audit = auditEnvironmentActionG2Parity({
      a0: trace("direct_codex"),
      a1,
      b: trace("helix_ask"),
    });
    expect(audit.first_divergence_stage).toBe("terminal_authority");
    expect(audit.mismatches.map((entry) => entry.code)).toContain(
      "a1_mcp_claimed_ask_terminal_authority",
    );
  });
});
