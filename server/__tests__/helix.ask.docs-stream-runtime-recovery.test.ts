import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  recoverDocsStreamRuntimeFailure,
  type HelixDocsStreamRuntimeRecoveryDependencies,
} from "../services/helix-ask/recovery/docs-stream-runtime-recovery";

describe("docs stream runtime recovery", () => {
  it("keeps the docs recovery implementation outside the route file", () => {
    const repoRoot = path.resolve(import.meta.dirname, "..", "..");
    const routeSource = fs.readFileSync(path.join(repoRoot, "server/routes/agi.plan.ts"), "utf8");
    const serviceSource = fs.readFileSync(
      path.join(repoRoot, "server/services/helix-ask/recovery/docs-stream-runtime-recovery.ts"),
      "utf8",
    );

    expect(routeSource).toContain("recoverDocsStreamRuntimeFailure");
    expect(routeSource).not.toContain("streamFailureNeedsDocsRuntimeRecovery");
    expect(serviceSource).not.toMatch(/routes[\\/]agi\.plan/);
  });

  it("recovers a forced docs stream failure once without duplicate tool execution", async () => {
    let runtimeLoopCallCount = 0;
    let composerCallCount = 0;
    let authorityAuditCallCount = 0;
    const dependencies: HelixDocsStreamRuntimeRecoveryDependencies = {
      isDocsEvidencePrompt: () => true,
      buildToolUseRestatement: () => ({ requiredToolFamilies: ["docs_viewer"] }),
      buildDocsEvidenceHardRouteMetadata: ({ turnId, threadId }) => ({
        sourceTargetIntent: {
          target_source: "docs_viewer",
          mandatory_next_tool: {
            name: "docs-viewer.search_docs",
          },
        },
        metadata: {
          turn_id: turnId,
          thread_id: threadId,
          route_family: "docs_viewer",
        },
      }),
      buildUniversalGoalFrame: ({ transcript }) => ({
        schema: "helix.ask_universal_goal_frame.v1",
        goal_kind: "doc_evidence_synthesis",
        transcript,
      }),
      buildCanonicalGoalFrame: ({ turnId }) => ({
        schema: "helix.ask_canonical_goal_frame.v1",
        turn_id: turnId,
        goal_kind: "doc_evidence_synthesis",
        required_terminal_kind: "doc_evidence_synthesis_answer",
      }),
      evaluateTurnSatisfaction: () => ({
        status: "needs_action",
        terminal_contract: {
          required_terminal_kinds: ["doc_evidence_synthesis_answer"],
        },
      }),
      runRuntimeLoop: async ({ turnId }) => {
        runtimeLoopCallCount += 1;
        return {
          currentTurnArtifacts: [
            {
              artifact_id: `${turnId}:doc_search_results`,
              turn_id: turnId,
              producer_item_id: `${turnId}:agent_runtime_loop:decision:1`,
              kind: "doc_search_results",
              created_at_ms: 1,
              source_scope: "current_turn",
              goal_hash: "goal:test",
              payload: {
                match_count: 1,
              },
            },
          ],
          goalSatisfactionEvaluation: {
            status: "satisfied",
            terminal_contract: {
              required_terminal_kinds: ["doc_evidence_synthesis_answer"],
            },
          },
          agentStepDecision: {
            selected_capability: "docs-viewer.search_docs",
            executed_capability: "docs-viewer.search_docs",
          },
          loop: {
            executed_tool_call_count: 1,
            iterations: [
              {
                selected_capability: "docs-viewer.search_docs",
                executed_capability: "docs-viewer.search_docs",
              },
            ],
          },
        };
      },
      applyFinalAnswerComposerToPayload: ({ payload }) => {
        composerCallCount += 1;
        payload.terminal_artifact_kind = "doc_evidence_synthesis_answer";
        payload.final_answer_source = "doc_evidence_synthesis_answer";
        payload.selected_final_answer = "Recovered docs answer.";
      },
      appendRuntimeAuthorityAuditToPayload: ({ payload }) => {
        authorityAuditCallCount += 1;
        payload.runtime_authority_audit = {
          ok: true,
        };
      },
      readTerminalText: (payload) => String(payload.selected_final_answer ?? ""),
      readString: (value) => (typeof value === "string" ? value : null),
    };

    const result = await recoverDocsStreamRuntimeFailure({
      prompt: "Search docs for Helix Ask console debug and tell me which document path you found.",
      turnId: "ask:test-docs-stream-runtime-recovery",
      traceId: "ask:test-docs-stream-runtime-recovery",
      sessionId: "session:test",
      threadId: "thread:test",
      errorMessage: "forced_stream_error_for_test",
      errorStack: null,
      eventSink: null,
      dependencies,
    });

    expect(result.status).toBe("recovered");
    expect(runtimeLoopCallCount).toBe(1);
    expect(composerCallCount).toBe(1);
    expect(authorityAuditCallCount).toBe(1);
    if (result.status !== "recovered") return;

    const terminalEvents = [
      {
        source_event_type: "terminal_answer",
        text: result.terminalText,
        terminal_artifact_kind: result.terminalArtifactKind,
      },
    ];

    expect(result.terminalArtifactKind).toBe("doc_evidence_synthesis_answer");
    expect(result.terminalText).toBe("Recovered docs answer.");
    expect(result.payload.agent_runtime_loop).toMatchObject({
      executed_tool_call_count: 1,
    });
    expect(terminalEvents).toHaveLength(1);
  });

  it("does not recover non-docs stream failures", async () => {
    const dependencies = {
      isDocsEvidencePrompt: () => false,
      buildToolUseRestatement: () => ({ requiredToolFamilies: [] }),
    } as unknown as HelixDocsStreamRuntimeRecoveryDependencies;

    await expect(
      recoverDocsStreamRuntimeFailure({
        prompt: "What does the UI do when the stream path throws?",
        turnId: "ask:test-nondocs-stream-failure",
        traceId: "ask:test-nondocs-stream-failure",
        sessionId: "session:test",
        threadId: "thread:test",
        errorMessage: "forced_stream_error_for_test",
        errorStack: null,
        dependencies,
      }),
    ).resolves.toEqual({ status: "not_applicable" });
  });
});
