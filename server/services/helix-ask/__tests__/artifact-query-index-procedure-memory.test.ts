import { describe, expect, it } from "vitest";

import { buildArtifactQueryIndex } from "../artifact-query-index";

describe("procedure-memory rail observation contract", () => {
  it("resolves the concrete procedure-evidence capability to source observation requirements", async () => {
    const { resolveToolFamilyContract } = await import("../tool-family-contract");

    expect(
      resolveToolFamilyContract({
        toolName: "procedure_memory:retrieve_procedure_evidence",
      }),
    ).toMatchObject({
      toolFamily: "procedure_memory",
      authority: "evidence_only",
      requiredObservationKinds: expect.arrayContaining([
        "procedure_memory_recall",
        "procedure_epoch_replay",
      ]),
      requiredReentry: true,
    });
  });

  it("preserves capability-plan observation requirements on a typed preflight failure", () => {
    const turnId = "ask:test:procedure-memory-unavailable";
    const index = buildArtifactQueryIndex({
      turnId,
      payload: {
        turn_id: turnId,
        active_prompt:
          "What changed since the previous visual capture, and was the interval running?",
        response_type: "final_failure",
        final_status: "final_failure",
        final_answer_source: "typed_failure",
        terminal_artifact_kind: "typed_failure",
        terminal_error_code: "procedure_memory_unavailable",
        selected_final_answer:
          "Procedure memory is unavailable because no active situation run exists.",
        capability_plan: {
          schema: "helix.ask_capability_plan.v1",
          requested_capability: "procedure_memory:retrieve_procedure_evidence",
          selected_capability: "retrieve_procedure_evidence",
          source_target: "procedure_memory",
          family: "procedure_memory",
          required_observation_kinds: [
            "active_situation_run",
            "procedure_memory",
          ],
          required_terminal_kind: "procedure_memory_recall",
        },
        tool_call_admission_decision: {
          schema: "helix.tool_call_admission_decision.v1",
          source_target: "procedure_memory",
          requested_capability: "procedure_memory:retrieve_procedure_evidence",
          selected_capability: "retrieve_procedure_evidence",
          admitted_capability: "retrieve_procedure_evidence",
          admitted_tool_families: ["procedure_memory", "situation_run"],
        },
        route_product_contract: {
          required_terminal_kind: "procedure_memory_recall",
          allowed_terminal_artifact_kinds: [
            "procedure_memory_recall",
            "procedure_epoch_replay",
            "typed_failure",
          ],
        },
        terminal_answer_authority: {
          schema: "helix.turn_terminal_authority.v1",
          turn_id: turnId,
          terminal_kind: "failure",
          terminal_artifact_kind: "typed_failure",
          final_answer_source: "typed_failure",
          server_authoritative: true,
        },
        current_turn_artifact_ledger: [
          {
            artifact_id: `${turnId}:procedure-memory-failure`,
            turn_id: turnId,
            producer_item_id: "golden_path_runtime",
            kind: "typed_failure",
            terminal_eligible: true,
            source_scope: "current_turn",
            payload: {
              terminal_error_code: "procedure_memory_unavailable",
              missing_evidence: ["active_situation_run", "procedure_memory"],
            },
          },
        ],
      },
    });

    expect(index.tool_turn_chain_audit).toMatchObject({
      requested_capability: "procedure_memory:retrieve_procedure_evidence",
      selected_capability: "retrieve_procedure_evidence",
      requested_selected_match: true,
      substitution_rule_applied: true,
      substitution_rule_id: "tool_family_alias:retrieve_procedure_evidence",
      required_observation_kinds_for_requested_capability: expect.arrayContaining([
        "active_situation_run",
        "procedure_memory",
      ]),
      rail_status: "fail_closed",
      rail_failure_code: "required_observation_missing",
    });
    expect(index.codex_parity_agent_spine_rail_table).toMatchObject({
      requested_capability: "procedure_memory:retrieve_procedure_evidence",
      selected_capability: "retrieve_procedure_evidence",
      required_observation_kinds_for_requested_capability: expect.arrayContaining([
        "active_situation_run",
        "procedure_memory",
      ]),
      rail_status: "fail_closed",
      rail_failure_code: "required_observation_missing",
    });
  });
});
