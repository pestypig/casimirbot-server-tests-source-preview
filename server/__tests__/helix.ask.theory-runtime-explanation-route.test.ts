import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { buildTheoryRuntimeExplanationRouteMetadataV1 } from "../../shared/contracts/theory-runtime-explanation-route.v1";
import type { TheoryRuntimeContextObservationV1 } from "../../shared/contracts/theory-runtime-context.v1";
import { planRouter } from "../routes/agi.plan";

const originalEnableCodexAgent = process.env.ENABLE_CODEX_AGENT;
const originalFakeStdout = process.env.CODEX_AGENT_FAKE_STDOUT;
const originalFakeExitCode = process.env.CODEX_AGENT_FAKE_EXIT_CODE;

afterEach(() => {
  if (originalEnableCodexAgent === undefined) delete process.env.ENABLE_CODEX_AGENT;
  else process.env.ENABLE_CODEX_AGENT = originalEnableCodexAgent;
  if (originalFakeStdout === undefined) delete process.env.CODEX_AGENT_FAKE_STDOUT;
  else process.env.CODEX_AGENT_FAKE_STDOUT = originalFakeStdout;
  if (originalFakeExitCode === undefined) delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
  else process.env.CODEX_AGENT_FAKE_EXIT_CODE = originalFakeExitCode;
});

const createApp = () => {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/agi", planRouter);
  return app;
};

const runtimeContext: TheoryRuntimeContextObservationV1 = {
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

describe("Helix Ask theory runtime explanation route", () => {
  it("accepts calculator route metadata and completes receipt evidence re-entry", async () => {
    process.env.ENABLE_CODEX_AGENT = "1";
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "The validation timed out, so this diagnostic receipt does not support claim promotion.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const response = await request(createApp())
      .post("/api/agi/ask/turn")
      .send({
        agent_runtime: "codex",
        account_type: "developer",
        turn_id: "ask:test:theory-runtime-explanation-route",
        question:
          "Explain the selected scientific calculator runtime result. Bind the exact request request:physics and receipt receipt:physics.",
        route_metadata: buildTheoryRuntimeExplanationRouteMetadataV1(runtimeContext),
        workspace_context_snapshot: {
          activePanel: "scientific-calculator",
          activeTheoryRuntimeContext: runtimeContext,
        },
        debug: true,
      })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      runtime: "codex",
      agent_runtime: "codex",
      text: expect.stringContaining("does not support claim promotion"),
      workstation_gateway_call_results: [{
        ok: true,
        capability_id: "scientific-calculator.read_visible_theory_run_result",
        observation: {
          schema: "helix.theory_run_context_observation.v1",
          requestId: "request:physics",
          receiptId: "receipt:physics",
          outputRole: "evidence_for_synthesis",
          terminalEligible: false,
          postToolModelStepRequired: true,
          assistantAnswer: false,
        },
      }],
      provider_reasoning_reentry: {
        status: "completed",
        evidence_reentered: true,
      },
      terminal_answer_authority: {
        schema: "helix.turn_terminal_authority.v1",
        server_authoritative: true,
      },
    });
  }, 60_000);
});
