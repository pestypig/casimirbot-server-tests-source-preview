import { describe, expect, it } from "vitest";
import { buildTheoryRuntimeContextObservationV1 } from "@shared/contracts/theory-runtime-context.v1";
import { buildTheoryRuntimeReceiptV1 } from "@shared/contracts/theory-runtime-receipt.v1";
import { callWorkstationGatewayCapability, listWorkstationGatewayCapabilities } from "../registry";

const capability = "scientific-calculator.read_visible_theory_run_result";
const receipt = buildTheoryRuntimeReceiptV1({ receiptId: "receipt", runtimeId: "solar.manifest", graphId: "graph", badgeIds: [], command: "npm run solar:manifest", args: {}, status: "completed", outputs: { artifacts: [], scalars: {}, units: {}, gates: {}, missingSignals: [], warnings: [] }, provenance: { gitSha: null, startedAt: null, completedAt: null, durationMs: null }, claimBoundary: { currentTier: "diagnostic", maximumTier: "diagnostic", promotionAllowed: false, promotionBlockedBy: [] } });
const context = buildTheoryRuntimeContextObservationV1({ requestId: "req", receipt });

describe("theory run context gateway registry", () => {
  it("registers and executes the read as a non-terminal observation", async () => {
    expect(listWorkstationGatewayCapabilities({ mode: "read" }).capabilities).toContainEqual(expect.objectContaining({ capability_id: capability, terminal_eligible: false }));
    const result = await callWorkstationGatewayCapability({ mode: "read", capabilityId: capability, arguments: { request_id: "req", receipt_id: "receipt", theory_runtime_context: context } });
    expect(result).toMatchObject({ ok: true, capability_id: capability, terminal_eligible: false, post_tool_model_step_required: true, observation: { output_role: "evidence_for_synthesis", terminal_eligible: false } });
  });
});
