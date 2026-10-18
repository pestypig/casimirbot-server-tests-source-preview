import { afterEach, describe, expect, it } from "vitest";
import { buildTheoryRuntimeExplanationRouteMetadataV1 } from "@shared/contracts/theory-runtime-explanation-route.v1";
import type { TheoryRuntimeContextObservationV1 } from "@shared/contracts/theory-runtime-context.v1";
import { codexProvider } from "../codex-provider";

const originalFakeStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
const originalFakeExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;

afterEach(() => {
  if (originalFakeStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
  else process.env.CODEX_AGENT_FAKE_STDOUT = originalFakeStdout;
  if (originalFakeExitCode === undefined) delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
  else process.env.CODEX_AGENT_FAKE_EXIT_CODE = originalFakeExitCode;
});

const context: TheoryRuntimeContextObservationV1 = {
  schema: "helix.theory_run_context_observation.v1",
  contextId: "theory-runtime-context:request:physics:receipt:physics",
  capturedAt: "2026-07-14T12:00:30.000Z",
  requestId: "request:physics",
  runId: "run:physics",
  rowId: "row:physics",
  receiptId: "receipt:physics",
  runtimeId: "physics.validate",
  graphId: "graph:physics",
  badgeIds: ["badge:diagnostic"],
  status: "timeout",
  command: "npm run physics:validate",
  outputs: {
    artifacts: [],
    scalars: { elapsed_ms: 30_000 },
    units: { elapsed_ms: "ms" },
    gates: { command_completed: false },
    missingSignals: ["completion"],
    warnings: ["runtime timed out"],
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
};

describe("theory runtime result provider re-entry", () => {
  it("keeps the receipt non-terminal and lets the provider author the explanation", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "The runtime timed out after 30 seconds, so its diagnostic output cannot promote a scientific claim.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:theory-runtime-context-reentry",
        agent_runtime: "codex",
        question:
          "Explain the selected scientific calculator runtime result. Bind the exact request request:physics and receipt receipt:physics.",
        route_metadata: buildTheoryRuntimeExplanationRouteMetadataV1(context),
        workspace_context_snapshot: {
          activePanel: "scientific-calculator",
          activeTheoryRuntimeContext: context,
        },
      },
      headers: {},
    });

    expect(result.text).toContain("cannot promote a scientific claim");
    expect((result.debug as any)?.workstation_gateway_call_results).toEqual([
      expect.objectContaining({
        capability_id: "scientific-calculator.read_visible_theory_run_result",
        ok: true,
        observation: expect.objectContaining({
          schema: "helix.theory_run_context_observation.v1",
          requestId: "request:physics",
          receiptId: "receipt:physics",
          terminalEligible: false,
          assistantAnswer: false,
          postToolModelStepRequired: true,
        }),
      }),
    ]);
    expect(result.turn_transcript_events?.some((event: any) =>
      event.source_event_type === "tool_observation" &&
      event.capability_id === "scientific-calculator.read_visible_theory_run_result" &&
      event.assistant_answer === false
    )).toBe(true);
    expect(result.turn_transcript_events?.some((event: any) =>
      event.source_event_type === "model_reentry"
    )).toBe(true);
  });
});
