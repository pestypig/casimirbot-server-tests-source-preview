import { describe, expect, it } from "vitest";
import { validateHelixRecommendedActionAdmissionV1 } from "../../../../shared/contracts/helix-recommended-action-admission.v1";
import { validateIdeologyContextReflectionV1 } from "../../../../shared/ideology-context-reflection";
import { validateMoralBadgeLocatorV1 } from "../../../../shared/moral-badge-locator";
import { validateFruitionProcedureExpressionV1 } from "../../../../shared/fruition-procedure-expression";
import { validateProceduralMoralClassificationV1 } from "../../../../shared/procedural-moral-classification";
import { validateCivicTrustTraversabilityV1 } from "../../../../shared/civic-trust-traversability";
import { validateCivicOrderParticipationV1 } from "../../../../shared/civic-order-participation";
import { validateCivilizationProvisioningNetworkV1 } from "../../../../shared/civilization-provisioning-network";
import { validateSharedAuthoritySocialRenewalReflectionV1 } from "../../../../shared/contracts/shared-authority-social-renewal.v1";
import { validateMoralReflectionMediationPacketV1 } from "../../../../shared/contracts/moral-reflection-mediation-packet.v1";
import { evaluateWorkstationToolReceipt } from "../workstation-tool-evaluator";
import {
  HELIX_ASK_MORAL_GRAPH_REFLECTION_TOOL_NAME,
  runHelixAskMoralGraphReflectionTool,
  moralGraphReflectionHandler,
  moralGraphReflectionSpec,
} from "../../../skills/helix-ask.moral-graph-reflection";

describe("Helix Ask MoralGraph reflection tool", () => {
  it("returns reflection and admissions as evidence-only tool output", async () => {
    const output = await runHelixAskMoralGraphReflectionTool({
      inputKind: "user_prompt",
      text: "Reflect right-speech-infrastructure and two-key approval as activated lenses with missing checks.",
      refs: ["turn:moral-graph", "doc:ethos"],
    });

    expect(validateIdeologyContextReflectionV1(output.reflection)).toEqual([]);
    expect(output.proceduralClassification).toBeDefined();
    expect(validateProceduralMoralClassificationV1(output.proceduralClassification!)).toEqual([]);
    expect(output.locator).toBeDefined();
    expect(validateMoralBadgeLocatorV1(output.locator!)).toEqual([]);
    expect(validateSharedAuthoritySocialRenewalReflectionV1(output.sharedAuthoritySocialRenewal)).toEqual([]);
    expect(validateMoralReflectionMediationPacketV1(output.moralReflectionMediation)).toEqual([]);
    expect(output.moralReflectionMediation).toMatchObject({
      objectiveSourceStatus: "unresolved",
      objectiveSourceOptions: expect.arrayContaining([
        "person_declared",
        "person_inferred",
        "role_prescribed",
        "institutionally_incentivized",
        "mutually_reinforced",
        "unknown",
      ]),
      authority: {
        assistant_answer: false,
        raw_content_included: false,
        terminal_eligible: false,
        agent_executable: false,
        diagnostic_only: true,
        evidence_only: true,
        no_moral_verdict: true,
        no_intent_inference: true,
        no_character_identity_claim: true,
        no_legitimacy_inference: true,
      },
    });
    expect(output.fruition).toBeUndefined();
    expect(output.reflection.artifactId).toBe("ideology_context_reflection");
    expect(output.reflection.authority).toMatchObject({
      assistant_answer: false,
      raw_content_included: false,
      terminal_eligible: false,
      context_role: "tool_policy",
      ask_context_policy: "evidence_only",
      agent_executable: false,
    });
    expect(output.admissions.length).toBe(1);
    expect(validateHelixRecommendedActionAdmissionV1(output.admissions[0])).toEqual([]);
  });

  it("classifies inner-practice prompts into procedural next moves", async () => {
    const output = await runHelixAskMoralGraphReflectionTool({
      inputKind: "user_prompt",
      text: [
        "I feel behind and stuck in rumination.",
        "Too much information dysregulates my lens.",
        "No reflection matters without falsifiable experimentation.",
        "Our private language can become an identity loop.",
      ].join(" "),
      refs: ["turn:inner-practice"],
    });

    expect(validateProceduralMoralClassificationV1(output.proceduralClassification!)).toEqual([]);
    expect(output.proceduralClassification?.classifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          observedPattern: "comparison_pressure",
          proceduralMove: "separate_observation_from_story",
        }),
        expect.objectContaining({
          observedPattern: "rumination_loop",
          proceduralMove: "convert_reflection_to_experiment",
        }),
        expect.objectContaining({
          observedPattern: "information_overload",
          proceduralMove: "reduce_input_noise",
        }),
        expect.objectContaining({
          observedPattern: "practice_commitment",
          proceduralMove: "ask_for_concrete_evidence",
        }),
      ]),
    );
    expect(output.proceduralClassification?.authority).toMatchObject({
      assistant_answer: false,
      terminal_eligible: false,
      agent_executable: false,
      character_verdict: false,
      moral_finality: false,
    });
  });

  it("classifies moral guilt prompts as missing-consideration inquiry without verdict authority", async () => {
    const output = await runHelixAskMoralGraphReflectionTool({
      inputKind: "user_prompt",
      text: [
        "Reflect the saying ignorance is bliss through moral guilt.",
        "If someone does not see what is wrong, what missing consideration affects well-being?",
        "Use this to research affected parties and what was reasonably knowable before judging.",
      ].join(" "),
      refs: ["turn:guilt-consideration"],
    });

    expect(validateProceduralMoralClassificationV1(output.proceduralClassification!)).toEqual([]);
    expect(output.proceduralClassification?.classifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          observedPattern: "ignorance_boundary",
          proceduralMove: "ask_what_was_reasonably_knowable",
        }),
        expect.objectContaining({
          observedPattern: "unconsidered_harm",
          proceduralMove: "research_missing_considerations",
        }),
        expect.objectContaining({
          observedPattern: "guilt_signal",
          proceduralMove: "separate_guilt_from_repair",
        }),
      ]),
    );
    expect(output.proceduralClassification?.recommendedNextMoves).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "procedural-moral-action:research-missing-considerations",
          reasonCodes: expect.arrayContaining(["model_may_choose_research_tool"]),
        }),
      ]),
    );
    expect(output.proceduralClassification?.authority).toMatchObject({
      assistant_answer: false,
      terminal_eligible: false,
      agent_executable: false,
      character_verdict: false,
      moral_finality: false,
    });
  });

  it("returns leadership capacity-transfer domains through the evidence-only reflection tool", async () => {
    const output = await runHelixAskMoralGraphReflectionTool({
      inputKind: "user_prompt",
      text:
        "Leadership as capacity transfer should make earned expertise teachable, give developing competence decision rights, preserve contestability, and let the mission survive succession.",
      refs: ["turn:leadership-capacity-transfer"],
    });
    const lifecycle = output.proceduralClassification?.classifications.find(
      (entry) => entry.moralRootId === "leadership-as-capacity-transfer",
    );
    const locatedIds = output.locator
      ? [
          ...output.locator.locatedBadges.exact,
          ...output.locator.locatedBadges.likely,
          ...output.locator.locatedBadges.inferred,
        ].map((entry) => entry.nodeId)
      : [];

    expect(validateProceduralMoralClassificationV1(output.proceduralClassification!)).toEqual([]);
    expect(lifecycle?.missingEvidence).toEqual(
      expect.arrayContaining([
        "originating_expertise",
        "mandate_scope",
        "knowledge_transfer_path",
        "competence_to_decision_rights",
        "succession_path",
        "mission_continuity_without_leader",
      ]),
    );
    expect(locatedIds).toContain("leadership-as-capacity-transfer");
    expect(output.sharedAuthoritySocialRenewal?.domains.map((domain) => domain.id)).toEqual(
      expect.arrayContaining([
        "competence_and_mandate",
        "shared_governance_and_decision_rights",
        "leadership_lifecycle_and_succession",
        "social_renewal_test",
      ]),
    );
    expect(output.proceduralClassification?.authority).toMatchObject({
      terminal_eligible: false,
      agent_executable: false,
      character_verdict: false,
      moral_finality: false,
    });
    expect(output.moralReflectionMediation?.steps.find((step) => step.id === "ai_mediated_judgment")?.priority)
      .toBe("available");
  });

  it("prioritizes public AI judgment without mistaking generic present-position language for inherited order", async () => {
    const output = await runHelixAskMoralGraphReflectionTool({
      inputKind: "user_prompt",
      text: [
        "A powerful public figure asks an AI to roast a young artist as a hypocrite using an earlier statement.",
        "The artist is absent, no current position is supplied, and the requested response is public ridicule.",
      ].join(" "),
      refs: ["turn:ai-mediated-judgment"],
    });
    const locatedIds = output.locator
      ? [
          ...output.locator.locatedBadges.exact,
          ...output.locator.locatedBadges.likely,
        ].map((entry) => entry.nodeId)
      : [];
    const primaryStepIds = output.moralReflectionMediation?.steps
      .filter((step) => step.priority === "primary")
      .map((step) => step.id);

    expect(locatedIds).toEqual(expect.arrayContaining([
      "right-speech-and-accurate-formulation",
      "identity-view-and-non-attachment",
    ]));
    expect(locatedIds).not.toContain("inherited-order-participation");
    expect(locatedIds).not.toContain("no-bypass-guardrail");
    expect(primaryStepIds).toEqual(expect.arrayContaining([
      "observation_claim_boundary",
      "objective_source_attribution",
      "perspective_power_and_asymmetry",
      "developmental_freedom",
      "ai_mediated_judgment",
    ]));
    expect(output.moralReflectionMediation?.steps.find((step) => step.id === "instrumentalization_ledger")?.priority)
      .toBe("available");
    expect(output.moralReflectionMediation?.authority).toMatchObject({
      assistant_answer: false,
      terminal_eligible: false,
      no_intent_inference: true,
    });
    expect(output.moralReflectionMediation?.evidenceOrderBoundary.kind).toBe("moral_scenario_ready");
  });

  it("orders cross-domain and externally checkable evidence before strong moral synthesis", async () => {
    const theoryOutput = await runHelixAskMoralGraphReflectionTool({
      inputKind: "user_prompt",
      text: [
        "An independently replicated boundary-sensitive coherence lifetime may favor heritable molecular structures",
        "whose useful transformations finish within that lifetime.",
        "Consider the analogy without treating a physical process as moral proof.",
      ].join(" "),
    });
    const externalOutput = await runHelixAskMoralGraphReflectionTool({
      inputKind: "user_prompt",
      text: "What happened recently in episode 18 according to a public post, and what moral reflection follows?",
    });

    expect(theoryOutput.moralReflectionMediation?.evidenceOrderBoundary).toMatchObject({
      kind: "theory_ideology_bridge_first",
      advisory_only: true,
      requiredBeforeStrongClaim: expect.arrayContaining([
        "physical_claim_maturity_and_replication",
        "naturalistic_fallacy_boundary",
      ]),
    });
    expect(theoryOutput.moralReflectionMediation?.steps.filter((step) => step.priority === "primary").map((step) => step.id))
      .toEqual(["observation_claim_boundary"]);
    expect(externalOutput.moralReflectionMediation?.evidenceOrderBoundary).toMatchObject({
      kind: "external_verification_first",
      advisory_only: true,
      requiredBeforeStrongClaim: expect.arrayContaining(["source_identity", "event_freshness"]),
    });
  });

  it("can include the Fruition procedure expression in the same evidence receipt", async () => {
    const output = await runHelixAskMoralGraphReflectionTool({
      inputKind: "user_prompt",
      text: "Plot direct observation, right speech, and two-key review, then show what Fruition would solve.",
      refs: ["turn:fruition"],
      options: {
        includeFruition: true,
        includeLocator: true,
      },
    });

    expect(output.locator).toBeDefined();
    expect(output.fruition).toBeDefined();
    expect(validateMoralBadgeLocatorV1(output.locator!)).toEqual([]);
    expect(validateFruitionProcedureExpressionV1(output.fruition!)).toEqual([]);
    expect(output.fruition?.sourceReflectionId).toBe(output.reflection.reflectionId);
  });

  it("includes civic trust traversability as a non-terminal middle-layer observation when relevant", async () => {
    const output = await runHelixAskMoralGraphReflectionTool({
      inputKind: "user_prompt",
      text: [
        "Trace relational trust into an institutional trust channel and financial record.",
        "Keep accountability domain-bounded and require an appeal and re-entry path after exclusion.",
      ].join(" "),
      refs: ["turn:civic-trust-tool"],
    });

    expect(output.civicTrustTraversability).toBeDefined();
    expect(validateCivicTrustTraversabilityV1(output.civicTrustTraversability)).toEqual([]);
    expect(output.civicTrustTraversability?.activatedBadgeIds).toEqual(
      expect.arrayContaining(["trust-medium-translation", "domain-bounded-accountability", "contestable-reentry-threshold"]),
    );
    expect(output.civicTrustTraversability?.authority).toMatchObject({
      terminal_eligible: false,
      moral_finality: false,
      financial_authority: false,
    });
  });

  it("includes civic participation and provisioning as independent evidence-only observations", async () => {
    const output = await runHelixAskMoralGraphReflectionTool({
      inputKind: "user_prompt",
      text: [
        "A tenant participates in an inherited civic order through rent and public services,",
        "but formal exit is not feasible and participation must not be treated as consent.",
        "Trace the water and energy resource flows, transport energy, maintenance, and public provision",
        "without an overall civilization balance score or universal budget.",
      ].join(" "),
      refs: ["turn:civic-provisioning-tool"],
    });

    expect(output.civicOrderParticipation).toBeDefined();
    expect(validateCivicOrderParticipationV1(output.civicOrderParticipation)).toEqual([]);
    expect(output.civicOrderParticipation?.activatedBadgeIds).toEqual(
      expect.arrayContaining(["participation-consent-separation", "voice-exit-contestability"]),
    );
    expect(output.civicOrderParticipation?.authority).toMatchObject({
      terminal_eligible: false,
      consent_inference: false,
      legitimacy_finality: false,
    });

    expect(output.civilizationProvisioningNetwork).toBeDefined();
    expect(validateCivilizationProvisioningNetworkV1(output.civilizationProvisioningNetwork)).toEqual([]);
    expect(output.civilizationProvisioningNetwork?.moralNodeIds).toEqual(
      expect.arrayContaining(["need-before-allocation", "efficiency-without-erasure"]),
    );
    expect(output.civilizationProvisioningNetwork?.authority).toMatchObject({
      terminal_eligible: false,
      biological_policy_derivation: false,
      overall_efficiency_score_allowed: false,
    });
  });

  it("preserves admission source metadata and evidence-only authority", async () => {
    const output = await moralGraphReflectionHandler({
      inputKind: "note",
      text: "Use Skillful Mediation as an activated lens.",
      refs: ["note:123"],
    }, {});
    const result = output as Awaited<ReturnType<typeof runHelixAskMoralGraphReflectionTool>>;
    const admission = result.admissions[0]!;

    expect(admission.source).toMatchObject({
      workstation: "moral-graph",
      tool: "moral-graph-reflection",
      artifact_type: "ideology_context_reflection",
      artifact_id: result.reflection.reflectionId,
    });
    expect(admission.evidenceRefs).toEqual(["note:123"]);
    expect(admission.authority).toMatchObject({
      assistant_answer: false,
      raw_content_included: false,
      terminal_eligible: false,
      context_role: "tool_policy",
      ask_context_policy: "evidence_only",
      agent_executable: false,
    });
    expect(admission.actions.every((action) => action.agentExecutable === false)).toBe(true);
  });

  it("does not unlock execution for blocked or diagnostic-only admissions", async () => {
    const output = await runHelixAskMoralGraphReflectionTool({
      inputKind: "workstation_event",
      text: "Highlight right speech, ask for missing evidence, and keep terminal execution locked.",
      refs: ["event:moral"],
    });
    const admission = output.admissions[0]!;

    for (const action of admission.actions) {
      if (action.display_policy === "diagnostic_only" || action.admission === "blocked") {
        expect(action.agentExecutable).toBe(false);
      }
    }
    expect(admission.authority.agent_executable).toBe(false);
  });

  it("can be evaluated as cited tool evidence, not assistant final authority", async () => {
    const output = await runHelixAskMoralGraphReflectionTool({
      inputKind: "voice_event",
      text: "Voice event needs right speech and missing check review.",
      refs: ["voice:event"],
    });
    const evaluation = evaluateWorkstationToolReceipt({
      thread_id: "thread:moral",
      turn_id: "turn:moral",
      receipt: {
        ok: true,
        receipt_id: "receipt:moral-graph",
        kind: "helix_moral_graph_reflection_tool_result",
        artifact: {
          kind: "helix_moral_graph_reflection_tool_result",
          tool_id: HELIX_ASK_MORAL_GRAPH_REFLECTION_TOOL_NAME,
          ...output,
        },
        evidence_refs: ["voice:event", output.reflection.reflectionId],
      },
    });

    expect(evaluation.result).toBe("supports_subgoal");
    expect(evaluation.summary).toContain("evidence-only ideology lenses");
    expect(evaluation.summary).toContain("procedural next-move classification");
    expect(evaluation.summary).toContain("badge locator paths");
    expect(evaluation.model_invoked).toBe(false);
    expect(evaluation.deterministic_gate).toBe(true);
  });

  it("registers as a deterministic non-privileged diagnostic agent tool", () => {
    expect(moralGraphReflectionSpec.name).toBe(HELIX_ASK_MORAL_GRAPH_REFLECTION_TOOL_NAME);
    expect(moralGraphReflectionSpec.deterministic).toBe(true);
    expect(moralGraphReflectionSpec.risk).toMatchObject({
      writesFiles: false,
      touchesNetwork: false,
      privileged: false,
    });
    expect(moralGraphReflectionSpec.provenance).toMatchObject({
      maturity: "diagnostic",
      certifying: false,
    });
  });
});
