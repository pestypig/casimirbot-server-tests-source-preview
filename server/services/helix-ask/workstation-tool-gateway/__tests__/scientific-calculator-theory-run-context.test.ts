import { describe, expect, it } from "vitest";
import { buildTheoryRuntimeContextObservationV1 } from "@shared/contracts/theory-runtime-context.v1";
import { buildTheoryRuntimeReceiptV1 } from "@shared/contracts/theory-runtime-receipt.v1";
import { buildScientificCalculatorTheoryRunContextGatewayObservation } from "../scientific-calculator-theory-run-context";

const receipt = buildTheoryRuntimeReceiptV1({ receiptId: "receipt:1", runtimeId: "solar.manifest", graphId: "graph", badgeIds: [], command: "npm run solar:manifest", args: {}, status: "completed", outputs: { artifacts: [], scalars: { count: 3 }, units: { count: null }, gates: {}, missingSignals: [], warnings: [] }, provenance: { gitSha: null, startedAt: null, completedAt: null, durationMs: null }, claimBoundary: { currentTier: "diagnostic", maximumTier: "diagnostic", promotionAllowed: false, promotionBlockedBy: [] } });
const context = buildTheoryRuntimeContextObservationV1({ requestId: "request:1", receipt });

describe("scientific calculator theory run context gateway", () => {
  it("admits an exact selected receipt only as synthesis evidence", () => {
    const result = buildScientificCalculatorTheoryRunContextGatewayObservation({ request_id: "request:1", receipt_id: "receipt:1", theory_runtime_context: context });
    expect(result).toMatchObject({ ok: true, admissionStatus: "admitted", observation: { output_role: "evidence_for_synthesis", terminal_eligible: false, post_tool_model_step_required: true, assistant_answer: false, raw_content_included: false } });
  });
  it("fails closed on stale or mismatched receipt identity", () => {
    expect(buildScientificCalculatorTheoryRunContextGatewayObservation({ request_id: "request:1", receipt_id: "receipt:old", theory_runtime_context: context })).toMatchObject({ ok: false, blockedReason: "theory_runtime_context_identity_mismatch" });
  });
});
