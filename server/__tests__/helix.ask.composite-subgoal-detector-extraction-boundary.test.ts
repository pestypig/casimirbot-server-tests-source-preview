import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectAskTurnCompositeSubgoals,
  findAskTurnCompositePromptSpan,
  normalizeAskTurnCompositeText,
} from "../services/helix-ask/composite-subgoal-detector";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/composite-subgoal-detector.ts");

describe("composite subgoal detector extraction boundary", () => {
  it("keeps composite subgoal detection out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/composite-subgoal-detector");
    expect(routeSource).not.toMatch(/const normalizeAskTurnCompositeText\s*=/);
    expect(routeSource).not.toMatch(/const findAskTurnCompositePromptSpan\s*=/);
    expect(routeSource).not.toMatch(/const detectAskTurnCompositeSubgoals\s*=/);
    expect(routeSource).not.toMatch(/type HelixAskCompositeSubgoalKind\s*=/);
    expect(routeSource).toMatch(/const buildAskTurnCompositeWorkspaceReceiptArtifact\s*=/);
    expect(routeSource).toMatch(/const applyAskTurnCompositeTerminalReceipt\s*=/);

    expect(serviceSource).toContain("export const detectAskTurnCompositeSubgoals");
    expect(serviceSource).toContain("export type HelixAskCompositeSubgoal");
    expect(serviceSource).not.toContain("server/routes/agi.plan");
  });

  it("preserves normalization, prompt spans, and compound workspace/equation detection", () => {
    expect(normalizeAskTurnCompositeText("Docs-Viewer.Open_Directory & Find equation!")).toBe(
      "docs viewer open directory and find equation",
    );
    expect(findAskTurnCompositePromptSpan("Open the best NHM2 paper", "best NHM2")).toEqual([9, 18]);

    const subgoals = detectAskTurnCompositeSubgoals({
      turnId: "ask:test",
      transcript: "Open docs directory and find the tau = alpha T equation.",
    });

    expect(subgoals.map((subgoal) => subgoal.kind)).toEqual(["workspace_action", "doc_equation_location"]);
    expect(subgoals[0]).toMatchObject({
      natural_language_goal: "Show the docs directory",
      required_terminal_kinds: ["workspace_action_receipt"],
      status: "pending",
      action_key: "docs-viewer.open_directory",
    });
    expect(subgoals[1]).toMatchObject({
      natural_language_goal: "Find equation evidence",
      required_terminal_kinds: ["doc_equation_location", "doc_calculator_evidence", "typed_failure"],
      status: "pending",
    });

    expect(detectAskTurnCompositeSubgoals({
      turnId: "ask:test",
      transcript: "Find the tau = alpha T equation.",
    })).toEqual([]);
  });
});
