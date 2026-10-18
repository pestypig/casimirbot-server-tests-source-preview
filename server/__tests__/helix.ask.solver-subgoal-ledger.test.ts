import { describe, expect, it } from "vitest";

import { buildSolverSubgoalLedger } from "../services/helix-ask/solver-subgoal-ledger";

const basePayload = () => ({
  selected_final_answer: "Done.",
  terminal_answer_authority: {
    schema: "helix.turn_terminal_authority.v1",
    server_authoritative: true,
  },
  route_authority_audit: {
    schema: "helix.route_authority_audit.v1",
    route_authority_ok: true,
  },
  solver_artifact_reentry_audit: {
    schema: "helix.solver_artifact_reentry_audit.v1",
    ok: true,
  },
});

const findSubgoal = (ledger: ReturnType<typeof buildSolverSubgoalLedger>, kind: string) => {
  const subgoal = ledger.subgoals.find((entry) => entry.kind === kind);
  expect(subgoal, `missing subgoal ${kind}`).toBeTruthy();
  return subgoal!;
};

describe("Helix solver subgoal ledger", () => {
  it("only succeeds comparison retrieval when current and prior refs exist", () => {
    const success = buildSolverSubgoalLedger({
      turnId: "ask:compare",
      promptText: "Compare the current screen to the last epoch.",
      payload: {
        ...basePayload(),
        procedure_evidence_retrieval_plan: {
          schema: "helix.procedure_evidence_retrieval_plan.v1",
          task: "comparison",
          compare_against: "previous_epoch",
        },
        procedure_evidence_retrieval_result: {
          schema: "helix.procedure_evidence_retrieval_result.v1",
          retrieval_plan_id: "retrieval:compare",
          selected_current_refs: ["obs:current"],
          selected_prior_refs: ["obs:prior"],
          selected_epoch_refs: [],
        },
      },
    });
    expect(findSubgoal(success, "retrieve_evidence")).toMatchObject({
      status: "succeeded",
      evaluation: { ok: true },
    });

    const blocked = buildSolverSubgoalLedger({
      turnId: "ask:compare-missing",
      promptText: "Compare the current screen to the last epoch.",
      payload: {
        ...basePayload(),
        procedure_evidence_retrieval_plan: {
          schema: "helix.procedure_evidence_retrieval_plan.v1",
          task: "comparison",
          compare_against: "previous_epoch",
        },
        procedure_evidence_retrieval_result: {
          schema: "helix.procedure_evidence_retrieval_result.v1",
          retrieval_plan_id: "retrieval:compare",
          selected_current_refs: ["obs:current"],
          selected_prior_refs: [],
          selected_epoch_refs: [],
        },
      },
    });
    expect(findSubgoal(blocked, "retrieve_evidence")).toMatchObject({
      status: "blocked",
      evaluation: {
        ok: false,
        missing: expect.arrayContaining(["selected_prior_refs_or_typed_missing_prior_failure"]),
      },
    });
  });

  it("allows comparison retrieval with a typed missing-prior failure", () => {
    const ledger = buildSolverSubgoalLedger({
      turnId: "ask:compare-typed-missing",
      promptText: "Compare this to the previous epoch.",
      payload: {
        ...basePayload(),
        typed_failure: {
          error_code: "missing_prior_evidence",
          text: "No prior epoch evidence was available.",
        },
        procedure_evidence_retrieval_plan: {
          schema: "helix.procedure_evidence_retrieval_plan.v1",
          task: "comparison",
        },
        procedure_evidence_retrieval_result: {
          schema: "helix.procedure_evidence_retrieval_result.v1",
          retrieval_plan_id: "retrieval:compare",
          selected_current_refs: ["obs:current"],
          selected_prior_refs: [],
          selected_epoch_refs: [],
        },
      },
    });

    expect(findSubgoal(ledger, "retrieve_evidence")).toMatchObject({
      status: "succeeded",
      evaluation: { ok: true },
    });
  });

  it("succeeds doc-open capability only when selected candidate path matches opened path", () => {
    const ledger = buildSolverSubgoalLedger({
      turnId: "ask:doc-open",
      promptText: "Open the NH-M2 white paper from docs.",
      payload: {
        ...basePayload(),
        capability_plan: {
          schema: "helix.capability_plan.v1",
          turn_id: "ask:doc-open",
          capability_family: "docs",
          requested_action: "open_or_validate_document",
        },
        capability_result: {
          schema: "helix.capability_result.v1",
          status: "succeeded",
          reentered_solver: true,
          receipt_refs: ["receipt:doc-open"],
          evidence_refs: ["doc:candidate"],
        },
        workspace_snapshot: {
          activeDocPath: "/docs/research/nhm2-current-status-whitepaper.md",
        },
        current_turn_artifact_ledger: [
          {
            artifact_id: "candidate:nhm2",
            kind: "doc_candidate_validation",
            payload: {
              selected_doc_path: "/docs/research/nhm2-current-status-whitepaper.md",
            },
          },
        ],
      },
    });

    expect(findSubgoal(ledger, "execute_capability")).toMatchObject({
      status: "succeeded",
      evaluation: { ok: true },
    });
  });

  it("succeeds workstation click only when action receipt confirms accepted or completed", () => {
    const ledger = buildSolverSubgoalLedger({
      turnId: "ask:click",
      promptText: "Click Start and report whether the click was accepted.",
      payload: {
        ...basePayload(),
        capability_plan: {
          schema: "helix.capability_plan.v1",
          turn_id: "ask:click",
          capability_family: "workstation_action",
          requested_action: "click_or_activate_control",
        },
        capability_result: {
          schema: "helix.capability_result.v1",
          status: "succeeded",
          reentered_solver: true,
          receipt_refs: ["receipt:click"],
          evidence_refs: [],
        },
        current_turn_artifact_ledger: [
          {
            artifact_id: "receipt:click",
            kind: "workspace_action_receipt",
            payload: {
              status: "completed",
              accepted: true,
            },
          },
        ],
      },
    });

    expect(findSubgoal(ledger, "execute_capability")).toMatchObject({
      status: "succeeded",
      evaluation: { ok: true },
    });
  });

  it("succeeds debug diagnosis only when debug fields are cited or missing evidence is stated", () => {
    const ledger = buildSolverSubgoalLedger({
      turnId: "ask:debug",
      promptText: "Why did the last turn call set_rate?",
      payload: {
        ...basePayload(),
        procedure_evidence_retrieval_plan: {
          schema: "helix.procedure_evidence_retrieval_plan.v1",
          task: "debug_diagnosis",
        },
        procedure_evidence_retrieval_result: {
          schema: "helix.procedure_evidence_retrieval_result.v1",
          retrieval_plan_id: "retrieval:debug",
          selected_current_refs: ["debug:terminal_authority", "debug:tool_call:set_rate"],
          selected_prior_refs: [],
          selected_epoch_refs: [],
          uncertainty: [],
        },
      },
    });

    expect(findSubgoal(ledger, "diagnose_debug")).toMatchObject({
      status: "succeeded",
      evaluation: { ok: true },
    });

    const blocked = buildSolverSubgoalLedger({
      turnId: "ask:debug-blocked",
      promptText: "Why did the last turn call set_rate?",
      payload: {
        ...basePayload(),
        procedure_evidence_retrieval_plan: {
          schema: "helix.procedure_evidence_retrieval_plan.v1",
          task: "debug_diagnosis",
        },
        procedure_evidence_retrieval_result: {
          schema: "helix.procedure_evidence_retrieval_result.v1",
          retrieval_plan_id: "retrieval:debug",
          selected_current_refs: [],
          selected_prior_refs: [],
          selected_epoch_refs: [],
          uncertainty: [],
        },
      },
    });

    expect(findSubgoal(blocked, "diagnose_debug")).toMatchObject({
      status: "blocked",
      evaluation: {
        ok: false,
        missing: expect.arrayContaining(["debug_field_refs_or_missing_evidence_statement"]),
      },
    });
  });
});
