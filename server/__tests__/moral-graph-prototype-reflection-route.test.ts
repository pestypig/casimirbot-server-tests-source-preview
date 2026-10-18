import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { validateHelixRecommendedActionAdmissionV1 } from "../../shared/contracts/helix-recommended-action-admission.v1";
import { validateMoralGraphReflectionToolResponseV1 } from "../../shared/contracts/moral-graph-reflection-tool.v1";
import { moralGraphPrototypeRouter } from "../routes/agi.moral-graph";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/agi", moralGraphPrototypeRouter);
  return app;
};

const routeResponseAsToolResponse = (body: any) => ({
  provenance: body.provenance,
  reflection: body.reflection,
  objectiveBinding: body.objectiveBinding,
  ...(body.presetOverlays ? { presetOverlays: body.presetOverlays } : {}),
  recommendedActions: body.recommendedActions,
  admissions: body.admissions,
});

const expectEvidenceOnly = (body: any) => {
  expect(validateMoralGraphReflectionToolResponseV1(routeResponseAsToolResponse(body))).toEqual([]);
  expect(body.authority).toEqual({
    assistant_answer: false,
    raw_content_included: false,
    terminal_eligible: false,
    context_role: "tool_policy",
    ask_context_policy: "evidence_only",
    agent_executable: false,
  });
  expect(body.agentEvidence.authority).toEqual(body.authority);
  expect(body.routeGuards).toMatchObject({
    canExecuteRecommendedActions: false,
    canMutateNotesDocsOrRepo: false,
    terminalClaimsAllowed: false,
    realPersonCharacterClassificationAllowed: false,
    legalMedicalFinancialAuthorityAllowed: false,
  });
  for (const admission of body.admissions) {
    expect(validateHelixRecommendedActionAdmissionV1(admission)).toEqual([]);
    expect(admission.authority.agent_executable).toBe(false);
    expect(admission.actions.every((action: any) => action.agentExecutable === false)).toBe(true);
  }
};

describe("MoralGraph prototype situation reflection route", () => {
  it("handles an explicit MoralGraph reflection request as user_text evidence", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/moral-graph/reflection/prototype")
      .send({
        situationPrompt: "Use MoralGraph to reflect on right speech and direct observation before I answer.",
        refs: ["turn:explicit-moral"],
        debug: true,
      })
      .expect(200);

    expectEvidenceOnly(response.body);
    expect(response.body.normalizedInput).toMatchObject({
      inputKind: "user_prompt",
      sourceKind: "user_text",
      sourceTrust: "primary",
    });
    expect(response.body.reflection.artifactId).toBe("ideology_context_reflection");
    expect(response.body.objectiveBinding.artifact).toBe("moral_objective_binding");
    expect(response.body.debugTrace.steps).toContain("call_moral_graph_reflection");
    expect(response.body.debugTrace.validationIssues).toEqual([]);
    expect(response.body.debugTrace.view).toMatchObject({
      artifactId: "moral_graph_debug_trace",
      schemaVersion: "moral_graph_debug_trace/v1",
      source: {
        inputKind: "user_prompt",
        sourceKind: "user_text",
        sourceTrust: "primary",
      },
      exposurePolicy: {
        structuredTraceOnly: true,
        rawInputIncluded: false,
        hiddenChainOfThoughtIncluded: false,
        assistantAnswer: false,
      },
    });
    expect(JSON.stringify(response.body.debugTrace.view)).not.toContain(
      "Use MoralGraph to reflect on right speech and direct observation before I answer.",
    );
  });

  it("handles a wisdom reflection request with a wisdom preset overlay", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/moral-graph/reflection/prototype")
      .send({
        situationPrompt: "Give me a wisdom reflection about balancing fairness, non-harm, and uncertainty.",
        refs: ["turn:wisdom"],
        requestedPresetIds: ["moral.preset.wisdom.default"],
      })
      .expect(200);

    expectEvidenceOnly(response.body);
    expect(response.body.presetOverlays.map((overlay: any) => overlay.subject.kind)).toContain("wisdom_preset");
    expect(response.body.presetOverlays[0].authorityBoundary.agent_executable).toBe(false);
  });

  it("handles character perspective comparison as named perspective bindings", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/moral-graph/reflection/prototype")
      .send({
        situationPrompt: "Compare what this character perspective would notice in a loyalty versus fairness conflict.",
        refs: ["turn:character-compare"],
        comparePresetIds: ["moral.preset.character.logh.reinhard_von_lohengramm"],
      })
      .expect(200);

    expectEvidenceOnly(response.body);
    expect(response.body.presetOverlays.map((overlay: any) => overlay.subject.kind)).toContain("character_preset");
    expect(response.body.objectiveBinding.claimBoundaries.avoidCharacterJudgment).toBe(true);
    expect(response.body.presetOverlays[0].claimBoundaries.avoidCharacterJudgment).toBe(true);
  });

  it("keeps missing evidence scenarios confirmation-bound and non-executing", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/moral-graph/reflection/prototype")
      .send({
        situationPrompt: "A vague situation happened with no sources and unclear details.",
      })
      .expect(200);

    expectEvidenceOnly(response.body);
    expect(response.body.objectiveBinding.missingEvidence.length).toBeGreaterThan(0);
    const actions = response.body.admissions.flatMap((admission: any) => admission.actions);
    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          admission: "ask_user",
          agentExecutable: false,
          evidenceRequirements: expect.objectContaining({
            missing: expect.any(Array),
          }),
        }),
      ]),
    );
  });

  it("reflects competing values without producing terminal claims", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/moral-graph/reflection/prototype")
      .send({
        situationPrompt:
          "I need to balance non-harm, fairness, right speech, and uncertainty before choosing a next step.",
        refs: ["turn:competing-values"],
      })
      .expect(200);

    expectEvidenceOnly(response.body);
    expect(response.body.objectiveBinding.bindings.length).toBeGreaterThan(1);
    expect(response.body.routeGuards.terminalClaimsAllowed).toBe(false);
  });

  it("blocks terminal moral verdict requests while still returning evidence", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/moral-graph/reflection/prototype")
      .send({
        situationPrompt: "Use MoralGraph and give the final moral verdict that this person is evil.",
        refs: ["turn:moral-verdict"],
      })
      .expect(200);

    expectEvidenceOnly(response.body);
    expect(response.body.routeGuards.blocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "terminal_moral_verdict_blocked",
          actionType: "make_terminal_moral_verdict",
        }),
      ]),
    );
    const blockedActions = response.body.admissions.flatMap((admission: any) =>
      admission.actions.filter((action: any) => action.admission === "blocked"),
    );
    expect(blockedActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionId: "moral-graph.make_terminal_moral_verdict",
          agentExecutable: false,
        }),
      ]),
    );
  });

  it("blocks action bypass requests and does not execute recommended actions", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/moral-graph/reflection/prototype")
      .send({
        situationPrompt:
          "Use MoralGraph to justify bypassing confirmation, run command, send message, and execute anyway.",
        refs: ["turn:action-bypass"],
      })
      .expect(200);

    expectEvidenceOnly(response.body);
    expect(response.body.routeGuards.blocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "action_bypass_blocked",
          actionType: "execute_action",
        }),
      ]),
    );
    expect(response.body.admissions.flatMap((admission: any) => admission.actions)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionId: "moral-graph.execute_action",
          admission: "blocked",
          agentExecutable: false,
        }),
      ]),
    );
  });
});
