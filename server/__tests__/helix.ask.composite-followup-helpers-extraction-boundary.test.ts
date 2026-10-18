import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAskTurnCompositeHandoffHints,
  buildAskTurnCompositeFollowupAudit,
  buildAskTurnCompositeHandoffDecision,
  classifyAskTurnCompositeSubgoalReferenceIntent,
  findAskTurnCompositeTerminalArtifact,
  summarizeAskTurnCompositeArtifact,
} from "../services/helix-ask/composite-followup-helpers";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/composite-followup-helpers.ts");

describe("composite followup helpers extraction boundary", () => {
  it("keeps pure composite followup helpers out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/composite-followup-helpers");
    expect(routeSource).not.toMatch(/const findAskTurnCompositeTerminalArtifact\s*=/);
    expect(routeSource).not.toMatch(/const summarizeAskTurnCompositeArtifact\s*=/);
    expect(routeSource).not.toMatch(/const buildAskTurnCompositeHandoffHints\s*=/);
    expect(routeSource).not.toMatch(/const classifyAskTurnCompositeSubgoalReferenceIntent\s*=/);
    expect(routeSource).not.toMatch(/const buildAskTurnCompositeHandoffDecision\s*=/);
    expect(routeSource).not.toMatch(/const buildAskTurnCompositeFollowupAudit\s*=/);
    expect(routeSource).toMatch(/const applyAskTurnCompositeTerminalReceipt\s*=/);

    expect(serviceSource).toContain("export const findAskTurnCompositeTerminalArtifact");
    expect(serviceSource).toContain("export const classifyAskTurnCompositeSubgoalReferenceIntent");
    expect(serviceSource).toContain("export const buildAskTurnCompositeHandoffDecision");
    expect(serviceSource).toContain("export const buildAskTurnCompositeFollowupAudit");
    expect(serviceSource).not.toContain("server/routes/agi.plan");
  });

  it("preserves terminal artifact lookup, summary fallback, hints, and reference intent", () => {
    const artifacts = [
      {
        artifact_id: "open-1",
        kind: "doc_open_receipt",
        payload: { path: "docs/research/nhm2-current-status-whitepaper.md" },
        extraField: "preserved",
      },
      {
        artifact_id: "equation-1",
        kind: "doc_equation_location",
        payload: {},
        extraField: "latest",
      },
    ];

    const latest = findAskTurnCompositeTerminalArtifact(artifacts, ["doc_open_receipt", "doc_equation_location"]);
    expect(latest?.artifact_id).toBe("equation-1");
    expect(latest?.extraField).toBe("latest");

    expect(summarizeAskTurnCompositeArtifact(artifacts[0], "fallback")).toBe(
      "Opened document: docs/research/nhm2-current-status-whitepaper.md",
    );
    expect(summarizeAskTurnCompositeArtifact(artifacts[1], "fallback")).toBe("Located equation evidence.");

    expect(buildAskTurnCompositeHandoffHints({
      subgoal: { kind: "workspace_action", natural_language_goal: "open docs" },
      status: "completed",
    })).toEqual({
      handoff_eligibility: ["can_explain", "can_open"],
      cannot_handoff_reasons: ["workspace_action_not_note_content"],
    });
    expect(buildAskTurnCompositeHandoffHints({
      subgoal: { kind: "doc_evidence_synthesis", natural_language_goal: "find equation" },
      status: "failed",
    })).toEqual({
      handoff_eligibility: ["can_explain", "can_retry"],
      cannot_handoff_reasons: ["failed_subgoal"],
    });

    expect(classifyAskTurnCompositeSubgoalReferenceIntent("What failed in the equation part?")).toMatchObject({
      required: true,
      reference_kind: "the_equation_part",
      requested_action: "explain",
      confidence: "high",
    });
    expect(classifyAskTurnCompositeSubgoalReferenceIntent("Append that result to a note.")).toMatchObject({
      required: true,
      reference_kind: "that_result",
      requested_action: "append_to_note",
      confidence: "medium",
    });

    const handoffDecision = buildAskTurnCompositeHandoffDecision({
      turnId: "ask:turn",
      intent: { required: true, reference_kind: "that_result", requested_action: "append_to_note", confidence: "high" },
      binding: {
        binding_status: "matched",
        selected_subgoal_ids: ["subgoal-1", "subgoal-2"],
        candidate_subgoals: [
          { subgoal_id: "subgoal-1", terminal_artifact_id: "receipt-1", terminal_artifact_kind: "workspace_action_receipt" },
          { subgoal_id: "subgoal-2", terminal_artifact_id: "evidence-1", terminal_artifact_kind: "doc_evidence_synthesis_answer" },
        ],
      },
    });
    expect(handoffDecision).toMatchObject({
      current_turn_id: "ask:turn",
      requested_action: "note_append",
      decision: "handoff_blocked",
      accepted_artifacts: [{ artifact_id: "evidence-1", artifact_kind: "doc_evidence_synthesis_answer" }],
      rejected_artifacts: [{ artifact_id: "receipt-1", artifact_kind: "workspace_action_receipt", reason: "workspace_action_not_note_content" }],
    });
    expect(buildAskTurnCompositeFollowupAudit({
      priorEnvelope: { active_turn_id: "ask:prior" },
      binding: { binding_status: "matched", candidate_subgoals: [] },
      handoffDecision,
    })).toMatchObject({
      verdict: "clean",
      checks: expect.arrayContaining([
        expect.objectContaining({ check: "prior_context_explicit", passed: true }),
        expect.objectContaining({ check: "failed_subgoal_not_used_as_success", passed: true }),
      ]),
    });
  });
});
