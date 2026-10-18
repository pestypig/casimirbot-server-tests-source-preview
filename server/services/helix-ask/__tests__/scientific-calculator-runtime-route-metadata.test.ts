import { describe, expect, it } from "vitest";
import {
  buildTheoryRuntimeExplanationRouteMetadataV1,
  THEORY_RUNTIME_CONTEXT_READ_CAPABILITY,
} from "@shared/contracts/theory-runtime-explanation-route.v1";
import type { TheoryRuntimeContextObservationV1 } from "@shared/contracts/theory-runtime-context.v1";
import { ScientificCalculatorRuntimeRouteMetadataSchema } from "../scientific-calculator-runtime-route-metadata";

const runtimeContext = (): TheoryRuntimeContextObservationV1 => ({
  schema: "helix.theory_run_context_observation.v1",
  contextId: "theory-runtime-context:request:1:receipt:1",
  capturedAt: "2026-07-14T12:00:00.000Z",
  requestId: "request:1",
  runId: "run:1",
  rowId: "row:1",
  receiptId: "receipt:1",
  runtimeId: "physics.validate",
  graphId: "graph:1",
  badgeIds: [],
  status: "timeout",
  command: "npm run physics:validate",
  outputs: {
    artifacts: [],
    scalars: {},
    units: {},
    gates: {},
    missingSignals: ["completion"],
    warnings: ["timed out"],
  },
  provenance: {
    adapter: "registered-command",
    adapterVersion: "1",
    startedAt: "2026-07-14T12:00:00.000Z",
    finishedAt: "2026-07-14T12:00:30.000Z",
    durationMs: 30_000,
    exitCode: null,
    signal: "SIGTERM",
  },
  claimBoundary: {
    runtimeExecutionSucceeded: false,
    claimPromotionAllowed: false,
    scientificMaturity: "diagnostic",
    promotionBlockedBy: ["runtime_timeout"],
  },
  outputRole: "evidence_for_synthesis",
  terminalEligible: false,
  postToolModelStepRequired: true,
  assistantAnswer: false,
  rawContentIncluded: false,
});

describe("ScientificCalculatorRuntimeRouteMetadataSchema", () => {
  it("accepts the bounded Explain-result route emitted by the calculator", () => {
    const metadata = buildTheoryRuntimeExplanationRouteMetadataV1(runtimeContext());
    expect(ScientificCalculatorRuntimeRouteMetadataSchema.parse(metadata)).toMatchObject({
      source: "scientific_calculator_runtime_result",
      allowedCapabilities: [THEORY_RUNTIME_CONTEXT_READ_CAPABILITY],
      compact_context: {
        request_id: "request:1",
        receipt_id: "receipt:1",
        terminal_eligible: false,
        post_tool_model_step_required: true,
      },
    });
  });

  it("rejects capability escalation and a terminal receipt", () => {
    const metadata = buildTheoryRuntimeExplanationRouteMetadataV1(runtimeContext());
    expect(ScientificCalculatorRuntimeRouteMetadataSchema.safeParse({
      ...metadata,
      allowedCapabilities: ["scientific-calculator.run_theory_runtime"],
    }).success).toBe(false);
    expect(ScientificCalculatorRuntimeRouteMetadataSchema.safeParse({
      ...metadata,
      compact_context: { ...metadata.compact_context, terminal_eligible: true },
    }).success).toBe(false);
  });

  it("rejects mismatched request, receipt, and context identities", () => {
    const metadata = buildTheoryRuntimeExplanationRouteMetadataV1(runtimeContext());
    expect(ScientificCalculatorRuntimeRouteMetadataSchema.safeParse({
      ...metadata,
      evidenceRefs: ["theory_runtime_request:other", metadata.evidenceRefs[1]],
    }).success).toBe(false);
    expect(ScientificCalculatorRuntimeRouteMetadataSchema.safeParse({
      ...metadata,
      compact_context: {
        ...metadata.compact_context,
        theory_runtime_context_ref: "theory-runtime-context:request:1:other",
      },
    }).success).toBe(false);
  });
});
