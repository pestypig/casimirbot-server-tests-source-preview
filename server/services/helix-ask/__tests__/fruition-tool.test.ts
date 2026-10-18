import { describe, expect, it } from "vitest";
import { validateFruitionProcedureExpressionV1 } from "../../../../shared/fruition-procedure-expression";
import { validateHelixRecommendedActionAdmissionV1 } from "../../../../shared/contracts/helix-recommended-action-admission.v1";
import { buildMoralBadgeLocatorV1 } from "../../../../shared/moral-badge-locator";
import { buildFruitionFromMoralBadgeComparisonSeed } from "../../../../shared/moral-graph/build-fruition-from-moral-badge-comparison-seed";
import {
  fruitionHandler,
  fruitionSpec,
  HELIX_ASK_FRUITION_TOOL_NAME,
  runHelixAskFruitionTool,
} from "../../../skills/helix-ask.fruition";

describe("Helix Ask Fruition tool", () => {
  it("returns a deterministic procedure expression with admission artifacts", async () => {
    const output = await runHelixAskFruitionTool({
      inputKind: "user_prompt",
      text: "Use right-speech-infrastructure and two-key approval to decide the next procedural question.",
      refs: ["turn:fruition", "doc:ethos"],
      objective: "Assemble a traceable procedure.",
    });

    expect(output.reflection?.artifactId).toBe("ideology_context_reflection");
    expect(validateFruitionProcedureExpressionV1(output.fruition)).toEqual([]);
    expect(output.fruition.artifactId).toBe("fruition_procedure_expression");
    expect(output.fruition.calculator).toMatchObject({
      name: "fruition",
      mode: "deterministic_procedure",
      modelCalls: 0,
    });
    expect(output.admissions.length).toBe(1);
    expect(validateHelixRecommendedActionAdmissionV1(output.admissions[0])).toEqual([]);
  });

  it("preserves evidence-only authority and never unlocks execution", async () => {
    const output = await fruitionHandler({
      inputKind: "note",
      text: "Reflect Skillful Mediation, missing checks, and restraint.",
      refs: ["note:fruition"],
    }, {});
    const result = output as Awaited<ReturnType<typeof runHelixAskFruitionTool>>;

    expect(result.fruition.authority).toMatchObject({
      assistant_answer: false,
      raw_content_included: false,
      terminal_eligible: false,
      context_role: "tool_policy",
      ask_context_policy: "evidence_only",
      agent_executable: false,
    });
    expect(result.fruition.result.agentExecutable).toBe(false);
    expect(result.fruition.result.admission.authority.agent_executable).toBe(false);
    expect(result.fruition.result.admission.actions.every((action) => action.agentExecutable === false)).toBe(true);
  });

  it("can omit reflection and admissions while preserving the Fruition expression", async () => {
    const output = await runHelixAskFruitionTool({
      inputKind: "voice_event",
      text: "Right speech warning with a missing check.",
      refs: ["voice:fruition"],
      options: {
        includeReflection: false,
        includeAdmissionArtifacts: false,
      },
    });

    expect(output.reflection).toBeUndefined();
    expect(output.admissions).toEqual([]);
    expect(validateFruitionProcedureExpressionV1(output.fruition)).toEqual([]);
    expect(output.fruition.result.admission.artifactId).toBe("helix_recommended_action_admission");
  });

  it("converts a Moral badge locator comparison seed into a valid Fruition expression", () => {
    const locator = buildMoralBadgeLocatorV1({
      generatedAt: "2026-06-01T00:00:00.000Z",
      locatorId: "moral-badge-locator:test-seed",
      input: {
        kind: "user_prompt",
        summary: "Reflect right speech and two-key review before action.",
        refs: ["turn:seed"],
      },
      graph: {
        graphId: "moral-graph",
        rootId: "wisdom-first-principles",
        source: "docs/ethos/ideology.json",
      },
      locatedBadges: {
        exact: [
          {
            nodeId: "right-speech-infrastructure",
            label: "Right Speech Infrastructure",
            confidence: 0.9,
            matchType: "label",
            pathToBinding: ["wisdom-first-principles", "right-speech-infrastructure"],
            proceduralExpression: "speech.formulation constrains action.posture",
            reasonCodes: ["label_match"],
            tags: ["speech", "constraint"],
          },
        ],
        likely: [
          {
            nodeId: "two-key-approval",
            label: "Two-Key Approval",
            confidence: 0.75,
            matchType: "action_label",
            pathToBinding: ["wisdom-first-principles", "two-key-approval"],
            proceduralExpression: "review.two_key requires action.check",
            reasonCodes: ["action_label_match"],
            tags: ["gate", "safeguard"],
          },
        ],
        inferred: [],
      },
      locatedBindings: [
        {
          id: "binding:review-before-action",
          label: "Review before action",
          bindingType: "objective_binding",
          pathNodeIds: ["wisdom-first-principles", "right-speech-infrastructure", "two-key-approval"],
          reasonCodes: ["seed_binding"],
          confidence: 0.8,
        },
      ],
      comparisonSeed: {
        selectedNodeIds: ["right-speech-infrastructure", "two-key-approval"],
        proceduralExpression: "speech.formulation constrains action.posture ; review.two_key requires action.check",
        expectedFruitionPosture: "requires_check",
        reasonCodes: ["locator_seed"],
      },
    });

    const expression = buildFruitionFromMoralBadgeComparisonSeed({
      locator,
      objective: "Trace locator seed into Fruition.",
      generatedAt: "2026-06-01T00:00:00.000Z",
      expressionId: "fruition:test-seed",
    });

    expect(validateFruitionProcedureExpressionV1(expression)).toEqual([]);
    expect(expression.sourceReflectionId).toBe(locator.locatorId);
    expect(expression.result.posture).toBe("requires_review");
    expect(expression.result.agentExecutable).toBe(false);
    expect(expression.result.admission.authority.agent_executable).toBe(false);
    expect(expression.terms.map((term) => term.sourceNodeIds?.[0])).toEqual(
      expect.arrayContaining(["right-speech-infrastructure", "two-key-approval"]),
    );
  });

  it("registers as a deterministic non-privileged diagnostic calculator tool", () => {
    expect(fruitionSpec.name).toBe(HELIX_ASK_FRUITION_TOOL_NAME);
    expect(fruitionSpec.deterministic).toBe(true);
    expect(fruitionSpec.risk).toMatchObject({
      writesFiles: false,
      touchesNetwork: false,
      privileged: false,
    });
    expect(fruitionSpec.provenance).toMatchObject({
      maturity: "diagnostic",
      certifying: false,
    });
  });
});
