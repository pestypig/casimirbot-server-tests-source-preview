import { describe, expect, it } from "vitest";
import { extractDocEquationFromText } from "../services/helix-ask/doc-equation-extractor";
import { buildNoteWriteArtifact, inferNoteTitleFromGoal } from "../services/helix-ask/note-write-artifact-builder";
import { extractCalculatorExpression, planWorkstationToolUse } from "../services/helix-ask/workstation-tool-planner";
import { normalizeHelixArtifactRole } from "../services/helix-ask/context-role-normalizer";

describe("workstation artifact contracts", () => {
  it("extracts document equation evidence as a non-answer validation artifact", () => {
    const extraction = extractDocEquationFromText({
      threadId: "helix-ask:desktop",
      turnId: "turn:doc-equation",
      sourceDocPath: "/docs/research/nhm2-current-status-whitepaper.md",
      sourceTitle: "NHM2",
      text: [
        "# NHM2",
        "The useful relation is tau = alpha * T for the centerline estimate.",
      ].join("\n"),
      evidenceRefs: ["doc_summary:nhm2"],
    });

    expect(extraction?.schema).toBe("helix.doc_equation_extraction.v1");
    expect(extraction?.assistant_answer).toBe(false);
    expect(extraction?.raw_content_included).toBe(false);
    expect(extraction?.normalized_expression).toBe("tau = alpha * T for the centerline estimate");
    expect(normalizeHelixArtifactRole(extraction).deterministic_content_role).toBe("evidence_not_assistant_answer");
  });

  it("extracts direct calculator expressions without preserving command prose", () => {
    expect(extractCalculatorExpression("Use the scientific calculator to compute 17 + 25.")).toBe("17 + 25");
    const plan = planWorkstationToolUse("Use the scientific calculator to compute 17 + 25.", {
      threadId: "helix-ask:desktop",
      turnId: "turn:calc",
    });

    expect(plan.action?.panel_id).toBe("scientific-calculator");
    expect(plan.action?.args.latex).toBe("17 + 25");
  });

  it("creates meaningful note write artifacts instead of relying on untitled notes", () => {
    expect(inferNoteTitleFromGoal({ userGoal: "Make a workstation note summarizing this open document." })).toBe(
      "Open document summary",
    );
    const artifact = buildNoteWriteArtifact({
      threadId: "helix-ask:desktop",
      turnId: "turn:note",
      userGoal: "Make a workstation note summarizing this open document.",
      sourceTitle: "NHM2 Status Whitepaper",
      sourceArtifactRefs: ["doc_summary:nhm2"],
    });

    expect(artifact.schema).toBe("helix.note_write_artifact.v1");
    expect(artifact.note_title).toContain("NHM2 Status Whitepaper");
    expect(artifact.source_artifact_refs).toEqual(["doc_summary:nhm2"]);
    expect(artifact.assistant_answer).toBe(false);
    expect(normalizeHelixArtifactRole(artifact).deterministic_content_role).toBe("evidence_not_assistant_answer");
  });
});

