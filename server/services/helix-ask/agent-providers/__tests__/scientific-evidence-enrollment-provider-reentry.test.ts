import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  resetAccountSessionStore,
  signInLocalAccountSession,
} from "../../../helix-account/account-session-store";
import { codexProvider } from "../codex-provider";
import { buildPromptDerivedScientificEvidenceEnrollmentGatewayCallRequests } from "../prompt-named-tool-requests";
import { ADVECTION_DIFFUSION_SCIENTIFIC_EVIDENCE_MANIFEST_ID } from "../../../../../shared/scientific-evidence/advection-diffusion-scientific-evidence-enrollment";

const originalFakeStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
const originalFakeCallIndex = process.env.CODEX_AGENT_FAKE_CALL_INDEX;
const originalFakeExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;

const restoreEnv = (): void => {
  if (originalFakeStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
  else process.env.CODEX_AGENT_FAKE_STDOUT = originalFakeStdout;
  if (originalFakeCallIndex === undefined) {
    delete process.env.CODEX_AGENT_FAKE_CALL_INDEX;
  } else {
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = originalFakeCallIndex;
  }
  if (originalFakeExitCode === undefined) delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
  else process.env.CODEX_AGENT_FAKE_EXIT_CODE = originalFakeExitCode;
};

describe("scientific evidence enrollment provider lifecycle", () => {
  beforeEach(async () => {
    await resetAccountSessionStore();
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
  });

  afterEach(() => {
    restoreEnv();
  });

  it("re-enters the exact enrollment sidecar before Codex authors a bounded answer", async () => {
    const accountReceipt = await signInLocalAccountSession({
      profile_id: "profile:scientific-evidence-enrollment-provider",
      account_type: "developer",
    });
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "The retained enrollment binds one source claim, one Theory Badge orientation, a narrow Lean contract, and two numerical lineages. It is traversable preparation evidence only: no runtime closure was executed, and it establishes neither empirical truth nor the underlying physics.";

    const body: Record<string, unknown> = {
      turn_id: "ask:test:scientific-evidence-enrollment-provider-reentry",
      thread_id: "thread:test:scientific-evidence-enrollment-provider-reentry",
      agent_runtime: "codex",
      question:
        "Load the conformed scientific evidence sidecar for the runtime workbench, then explain its Theory Badge orientation and present authority boundary after the observation re-enters.",
    };
    expect(
      buildPromptDerivedScientificEvidenceEnrollmentGatewayCallRequests(body),
    ).toHaveLength(1);
    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body,
      headers: {
        cookie: `helix_session=${accountReceipt.session?.session_id ?? ""}`,
      },
    });

    const debug = result.debug as Record<string, any>;
    const gatewayResult = (debug.workstation_gateway_call_results ?? [])
      .find((entry: Record<string, unknown>) =>
        entry.capability_id ===
          "scientific-evidence-closure.inspect_enrollment"
      );
    expect(
      (debug.workstation_gateway_call_results ?? []).map(
        (entry: Record<string, unknown>) => entry.capability_id,
      ),
    ).toContain("scientific-evidence-closure.inspect_enrollment");
    expect(gatewayResult).toMatchObject({
      ok: true,
      capability_id: "scientific-evidence-closure.inspect_enrollment",
      observation: {
        schema: "casimir.scientific_evidence_enrollment.observation.v1",
        status: "succeeded",
        current_turn_id:
          "ask:test:scientific-evidence-enrollment-provider-reentry",
        current_turn_evidence: true,
        output_role: "evidence_for_bounded_synthesis",
        terminal_eligible: false,
        assistant_answer: false,
        enrollment: {
          manifest: {
            manifestId:
              ADVECTION_DIFFUSION_SCIENTIFIC_EVIDENCE_MANIFEST_ID,
          },
          source_claim: expect.any(Object),
          graph_snapshot: expect.any(Object),
          semantic_binding: expect.any(Object),
        },
      },
    });
    expect(debug.provider_observation_normalization_failures ?? []).not.toContain(
      "provider_observation_normalization_missing:scientific-evidence-closure.inspect_enrollment",
    );
    expect(debug.current_turn_artifact_ledger).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "scientific_evidence_enrollment_observation",
        payload_schema:
          "casimir.scientific_evidence_enrollment.observation.v1",
        capability_key:
          "scientific-evidence-closure.inspect_enrollment",
        terminal_eligible: false,
        assistant_answer: false,
      }),
    ]));
    expect(debug.provider_terminal_authority_bridge).toMatchObject({
      evidence_reentry_required: true,
      normalized_observations_ready: true,
      all_gateway_calls_succeeded: true,
      all_observations_succeeded: true,
      solver_completed: true,
      terminal_authority_granted: true,
      final_visible_answer_authorized: true,
    });
    expect(
      debug.provider_terminal_authority_bridge.normalized_observation_refs,
    ).toEqual(expect.arrayContaining([
      expect.stringContaining(
        "codex_normalized:scientific_evidence_enrollment_observation",
      ),
    ]));
    expect(result).toMatchObject({
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
    });
    expect(result.text).toContain("traversable preparation evidence only");
    expect(result.text).toContain("neither empirical truth nor the underlying physics");
    expect(result.turn_transcript_events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source_event_type: "tool_observation",
        capability_id:
          "scientific-evidence-closure.inspect_enrollment",
        assistant_answer: false,
      }),
      expect.objectContaining({
        source_event_type: "model_reentry",
      }),
    ]));
  });

  it("re-enters the exact user-selected intervention plan before bounded synthesis", async () => {
    const accountReceipt = await signInLocalAccountSession({
      profile_id: "profile:scientific-evidence-plan-provider",
      account_type: "developer",
    });
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "The current-turn plan binds the enrolled orientation and Lanyon source claim to the permitted Dxx intervention from 0.01 to 0.02 m^2 s^-1. It stages the Lanyon, Lean, and independent numerical itinerary but executes none of them and grants no scientific authority.";
    const body: Record<string, unknown> = {
      turn_id: "ask:test:scientific-evidence-plan-provider-reentry",
      thread_id: "thread:test:scientific-evidence-plan-provider-reentry",
      agent_runtime: "codex",
      question:
        "Prepare the enrolled advection-diffusion scientific evidence closure plan and change Dxx to 0.02. Do not execute Lean or numerical solvers yet.",
    };
    expect(
      buildPromptDerivedScientificEvidenceEnrollmentGatewayCallRequests(body),
    ).toMatchObject([
      {
        capability_id: "scientific-evidence-closure.prepare",
      },
    ]);
    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body,
      headers: {
        cookie: `helix_session=${accountReceipt.session?.session_id ?? ""}`,
      },
    });
    const debug = result.debug as Record<string, any>;
    const gatewayResult = (debug.workstation_gateway_call_results ?? [])
      .find(
        (entry: Record<string, unknown>) =>
          entry.capability_id ===
          "scientific-evidence-closure.prepare",
      );
    expect(gatewayResult).toMatchObject({
      ok: true,
      observation: {
        schema:
          "casimir.scientific_evidence_execution_plan.observation.v1",
        current_turn_id:
          "ask:test:scientific-evidence-plan-provider-reentry",
        current_turn_evidence: true,
        output_role: "candidate_next_step",
        execution_plan: {
          selection: {
            orientationId:
              "orientation:advection-diffusion-dxx-closure:v1",
            sourceClaimId:
              "source-claim:lanyon:advection_diffusion_full_1d:v1",
          },
          intervention: {
            baselineValue: "0.01",
            selectedValue: "0.02",
          },
          authority: {
            userSelectionBound: true,
            executesTools: false,
            grantsConfirmation: false,
          },
        },
      },
    });
    expect(debug.current_turn_artifact_ledger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "scientific_evidence_execution_plan_observation",
          payload_schema:
            "casimir.scientific_evidence_execution_plan.observation.v1",
          source_scope: "current_turn_context",
          capability_key: "scientific-evidence-closure.prepare",
          terminal_eligible: false,
          assistant_answer: false,
        }),
      ]),
    );
    expect(debug.provider_terminal_authority_bridge).toMatchObject({
      evidence_reentry_required: true,
      normalized_observations_ready: true,
      all_gateway_calls_succeeded: true,
      all_observations_succeeded: true,
      solver_completed: true,
      terminal_authority_granted: true,
      final_visible_answer_authorized: true,
    });
    expect(result).toMatchObject({
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "final_answer_draft",
    });
    expect(result.text).toContain("executes none of them");
  });
});
