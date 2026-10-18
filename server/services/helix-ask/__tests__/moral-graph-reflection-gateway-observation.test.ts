import { describe, expect, it } from "vitest";
import {
  buildMoralGraphReflectionGatewayObservation,
  MORAL_GRAPH_REFLECTION_CAPABILITY,
} from "../workstation-tool-gateway/moral-graph-reflection";

describe("Moral Graph gateway middle-layer observations", () => {
  it("projects civic order and provisioning receipts without making either terminal", async () => {
    const result = await buildMoralGraphReflectionGatewayObservation({
      prompt: [
        "A tenant participates in an inherited order through rent and public provision,",
        "but formal exit is not feasible and participation is not consent.",
        "Trace water and energy resource flows, transport energy, maintenance, and cooperation",
        "without a civilization balance score.",
      ].join(" "),
      refs: ["turn:gateway-middle-layers"],
    });

    expect(result).toMatchObject({
      ok: true,
      admissionStatus: "admitted",
      observationStatus: "succeeded",
      observation: {
        capability_key: MORAL_GRAPH_REFLECTION_CAPABILITY,
        terminal_eligible: false,
        assistant_answer: false,
        post_tool_model_step_required: true,
      },
    });
    expect(result.observation.civic_order_participation).toMatchObject({
      schemaVersion: "civic_order_participation/v1",
      authority: expect.objectContaining({ consent_inference: false, terminal_eligible: false }),
    });
    expect(result.observation.civilization_provisioning_network).toMatchObject({
      schemaVersion: "civilization_provisioning_network/v1",
      authority: expect.objectContaining({
        biological_policy_derivation: false,
        overall_efficiency_score_allowed: false,
        terminal_eligible: false,
      }),
    });
  });
});
