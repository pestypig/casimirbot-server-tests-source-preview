import { describe, expect, it } from "vitest";

import { buildPromptDerivedScientificEvidenceEnrollmentGatewayCallRequests } from "../prompt-named-tool-requests";
import { forbiddenEvidenceFamiliesForLaneCapability } from "../codex-provider";

describe("scientific evidence enrollment prompt interpretation", () => {
  it.each([
    "Load the conformed scientific evidence sidecar for the runtime workbench.",
    "Show me the scientific evidence enrollment and its Theory Badge orientation.",
    "Traverse the evidence manifest for the enrolled advection-diffusion case.",
  ])("admits an affirmative current-turn request: %s", (prompt) => {
    expect(
      buildPromptDerivedScientificEvidenceEnrollmentGatewayCallRequests({
        prompt,
      }),
    ).toMatchObject([
      {
        capability_id:
          "scientific-evidence-closure.inspect_enrollment",
        mode: "read",
      },
    ]);
  });

  it.each([
    "Do not load the scientific evidence sidecar.",
    "Later we could inspect the scientific evidence enrollment.",
    "If we load the runtime workbench evidence manifest, what happens?",
    "The screen button says “show scientific evidence enrollment”.",
    "Previously we inspected the conformed scientific evidence sidecar.",
    "Explain the phrase 'load the scientific evidence sidecar'.",
  ])("rejects contextual, negated, future, or quoted text: %s", (prompt) => {
    expect(
      buildPromptDerivedScientificEvidenceEnrollmentGatewayCallRequests({
        prompt,
      }),
    ).toEqual([]);
  });

  it("admits an exact parameter-intervention plan without treating preparation as execution", () => {
    expect(
      buildPromptDerivedScientificEvidenceEnrollmentGatewayCallRequests({
        prompt:
          "Prepare the enrolled advection-diffusion scientific evidence closure plan and change Dxx to 0.02. Do not execute Lean or the numerical solvers yet.",
      }),
    ).toMatchObject([
      {
        capability_id: "scientific-evidence-closure.prepare",
        mode: "read",
        arguments: {
          manifest_id:
            "scientific-evidence:advection-diffusion-dxx:v1",
          orientation_id:
            "orientation:advection-diffusion-dxx-closure:v1",
          source_claim_id:
            "source-claim:lanyon:advection_diffusion_full_1d:v1",
          intervention_parameter_id: "parameter:diffusivity",
          intervention_value: "0.02",
        },
      },
    ]);
  });

  it("admits a corrective deictic plan request so enrollment policy, not model prose, judges the new value", () => {
    expect(
      buildPromptDerivedScientificEvidenceEnrollmentGatewayCallRequests({
        prompt:
          "Actually, prepare that same enrolled closure plan with Dxx changed to 0.03, but still do not execute Lean or numerical solvers.",
      }),
    ).toMatchObject([
      {
        capability_id: "scientific-evidence-closure.prepare",
        mode: "read",
        arguments: {
          intervention_parameter_id: "parameter:diffusivity",
          intervention_value: "0.03",
        },
      },
    ]);
  });

  it("resolves the retained scientific sidecar for the exact natural Realtime continuation", () => {
    expect(
      buildPromptDerivedScientificEvidenceEnrollmentGatewayCallRequests({
        prompt:
          "Continue with that exact enrollment. Prepare a current-turn execution plan changing permitted Dxx from 0.01 to 0.02 while freezing every other registered input. Bind the plan to the same badge orientation, source claim, Lanyon semantics, pinned Lean contract, primary and independent numerics, confirmation policy, and closure evaluator. Prepare only; do not start or evaluate.",
      }),
    ).toMatchObject([
      {
        capability_id: "scientific-evidence-closure.prepare",
        mode: "read",
        arguments: {
          manifest_id:
            "scientific-evidence:advection-diffusion-dxx:v1",
          orientation_id:
            "orientation:advection-diffusion-dxx-closure:v1",
          source_claim_id:
            "source-claim:lanyon:advection_diffusion_full_1d:v1",
          intervention_parameter_id: "parameter:diffusivity",
          intervention_value: "0.02",
        },
      },
    ]);
  });

  it("binds an explicit evaluation to the enrolled manifest but does not invent current-turn artifacts", () => {
    expect(
      buildPromptDerivedScientificEvidenceEnrollmentGatewayCallRequests({
        prompt:
          "Now call scientific-evidence-closure.evaluate for that exact current-turn plan, using only current-turn confirmation, formal, and numerical artifacts that actually exist.",
      }),
    ).toMatchObject([
      {
        capability_id: "scientific-evidence-closure.evaluate",
        mode: "read",
        arguments: {
          manifest_id:
            "scientific-evidence:advection-diffusion-dxx:v1",
        },
      },
    ]);
    const [request] =
      buildPromptDerivedScientificEvidenceEnrollmentGatewayCallRequests({
        prompt:
          "Now call scientific-evidence-closure.evaluate for that exact current-turn plan.",
      });
    expect(request?.arguments).not.toHaveProperty(
      "closure_input_artifact_ref",
    );
    expect(request?.arguments).not.toHaveProperty(
      "execution_plan_artifact_ref",
    );
    expect(request?.arguments).not.toHaveProperty("plan_id");
  });

  it.each([
    "Do not prepare the scientific evidence plan or change Dxx to 0.02.",
    "Later we could prepare the advection-diffusion evidence closure plan and set Dxx to 0.02.",
    "If we prepare the scientific evidence intervention with Dxx to 0.02, what would happen?",
    "Previously we prepared the advection-diffusion scientific evidence plan with Dxx to 0.02.",
    "The screen says \"prepare the scientific evidence plan and set Dxx to 0.02\".",
    "Do not prepare that exact enrollment with Dxx to 0.02 and a Lean binding.",
    "Later we could prepare that exact enrollment with Dxx to 0.02 and a Lanyon binding.",
    "The screen says \"prepare that exact enrollment with Dxx to 0.02 and a closure evaluator\".",
    "Prepare that enrollment.",
  ])("does not turn contextual planning language into a plan: %s", (prompt) => {
    expect(
      buildPromptDerivedScientificEvidenceEnrollmentGatewayCallRequests({
        prompt,
      }),
    ).toEqual([]);
  });

  it.each([
    "Do not call scientific-evidence-closure.evaluate.",
    "Later we could call scientific-evidence-closure.evaluate.",
    "The screen says \"call scientific-evidence-closure.evaluate\".",
  ])("does not turn contextual evaluation language into a call: %s", (prompt) => {
    expect(
      buildPromptDerivedScientificEvidenceEnrollmentGatewayCallRequests({
        prompt,
      }),
    ).toEqual([]);
  });

  it("suppresses a runtime-proposed closure evaluation when the user requested inspection only", () => {
    expect(
      forbiddenEvidenceFamiliesForLaneCapability(
        "Inspect the conformed scientific evidence enrollment only. Do not call scientific-evidence-closure.evaluate.",
        "scientific-evidence-closure.evaluate",
      ),
    ).toContain("scientific_evidence_closure_evaluation");
    expect(
      forbiddenEvidenceFamiliesForLaneCapability(
        "Later we may call scientific-evidence-closure.evaluate after runtime evidence exists.",
        "scientific-evidence-closure.evaluate",
      ),
    ).toEqual([]);
    expect(
      forbiddenEvidenceFamiliesForLaneCapability(
        "The screen says \"Do not call scientific-evidence-closure.evaluate.\" Explain the text.",
        "scientific-evidence-closure.evaluate",
      ),
    ).toEqual([]);
  });

  it("suppresses a runtime-proposed execution plan under an exact no-plan constraint", () => {
    expect(
      forbiddenEvidenceFamiliesForLaneCapability(
        "Do not prepare or stage a scientific evidence execution plan.",
        "scientific-evidence-closure.prepare",
      ),
    ).toContain("scientific_evidence_execution_planning");
    expect(
      forbiddenEvidenceFamiliesForLaneCapability(
        "Later we may prepare a scientific evidence execution plan.",
        "scientific-evidence-closure.prepare",
      ),
    ).toEqual([]);
  });
});
