import { describe, expect, it } from "vitest";
import { buildActiveTheoryRuntimeContextWorkstationGatewayCallRequests } from "../active-context-tool-requests";

const workspace = { activePanel: "scientific-calculator", activeTheoryRuntimeContext: { schema: "helix.theory_run_context_observation.v1", requestId: "req", receiptId: "receipt", runtimeId: "solar.manifest", outputRole: "evidence_for_synthesis", terminalEligible: false, postToolModelStepRequired: true, assistantAnswer: false, rawContentIncluded: false } };
const body = (prompt: string) => ({ prompt, workspace_context_snapshot: workspace });

describe("theory runtime result context admission", () => {
  it("requests the exact read capability for an affirmative explanation", () => {
    expect(buildActiveTheoryRuntimeContextWorkstationGatewayCallRequests(body("Explain this selected runtime result."))).toMatchObject([{ capability_id: "scientific-calculator.read_visible_theory_run_result", arguments: { request_id: "req", receipt_id: "receipt" } }]);
  });
  it.each([
    "Do not explain this selected runtime result.",
    "Later, explain this selected runtime result.",
    "Previously I explained this selected runtime result.",
    "The button says explain this selected runtime result.",
    "Explain the quoted phrase `selected runtime result`.",
  ])("does not admit contextual or non-immediate wording: %s", (prompt) => {
    expect(buildActiveTheoryRuntimeContextWorkstationGatewayCallRequests(body(prompt))).toEqual([]);
  });
});
