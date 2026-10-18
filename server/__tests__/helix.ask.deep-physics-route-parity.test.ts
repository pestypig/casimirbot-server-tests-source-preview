import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { planRouter } from "../routes/agi.plan";
import { detectRepoCodeEvidenceIntent } from "../services/helix-ask/repo-code-intent-detector";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

const conceptAnswer = [
  "A good way to hold the concept is to separate the mathematical model from the literal picture.",
  "In the model, fields, geometry, spacetime curvature, geodesics, inertial frames, and tidal forces describe relationships and allowed measurements, not tiny hard objects or hidden code artifacts.",
  "Observers and measurement are physical interactions that define what can be known, while probability, entropy, the arrow of time, coarse-graining, statistical mechanics, virtual particles, vacuum fluctuations, wavefunction collapse, decoherence, and many-worlds are disciplined descriptions of those interactions.",
  "The analogy is useful as a first handle, but the final answer has to explain what the analogy preserves, what it distorts, and how the deeper concept fits the rest of physics.",
].join("\n\n");

const deepPhysicsPrompts = [
  {
    name: "gravity geometry",
    prompt:
      "If gravity is geometry rather than a force, how should I understand geodesics, inertial frames, and tidal forces in one picture? I want the conceptual difference between curved spacetime and the everyday idea that a mass pulls on another mass.",
    expectedTerms: [/geometry|curvature|spacetime/i, /geodesic|inertial|tidal/i],
  },
  {
    name: "vacuum picture",
    prompt:
      "How should I understand the popular vacuum-fluctuation picture in quantum field theory? People say virtual particles pop in and out of existence, but that sounds like a literal source of energy. Explain what the picture gets right and where it becomes misleading.",
    expectedTerms: [/field|quantum|virtual|vacuum/i, /picture|analogy|literal/i],
  },
  {
    name: "entropy arrow",
    prompt:
      "Why does entropy give an arrow of time if the microscopic laws mostly work forward and backward? Explain the role of probability, coarse-graining, and statistical mechanics without turning it into a one-line slogan.",
    expectedTerms: [/entropy|arrow|time/i, /probability|statistical|coarse/i],
  },
  {
    name: "measurement problem",
    prompt:
      "What exactly is the quantum measurement problem? I keep hearing that an observer collapses the wavefunction, but I also hear about decoherence and many-worlds. Explain what is actually unresolved and what the word observer should not imply.",
    expectedTerms: [/measurement|observer|wavefunction/i, /decoherence|many-worlds|collapse/i],
  },
  {
    name: "helix ui conceptual sqi",
    prompt:
      "For Helix UI, explain in plain language what the sampled quantum inequality margin means, why negative energy constraints matter for a warp or Casimir-style concept, and how to avoid mistaking the rubber-sheet or field-picture analogies for literal physics. Keep it conceptual, not code or repo-specific.",
    expectedTerms: [/quantum|negative energy|warp|casimir/i, /plain language|conceptual|not code|repo-specific/i],
  },
];

const compact = (value: string): string => value.replace(/\s+/g, " ").trim();

afterEach(() => {
  delete process.env.HELIX_MODEL_ONLY_CONCEPT_FINAL_ANSWER_TEST_RESPONSE;
  delete process.env.HELIX_MODEL_TURN_TEST_RESPONSE;
});

describe("Helix Ask deep physics route parity", () => {
  it("does not classify ordinary deep physics prompts as repo-code evidence requests", () => {
    for (const { prompt } of deepPhysicsPrompts) {
      const intent = detectRepoCodeEvidenceIntent(prompt);

      expect(intent.repoEvidenceRequested).toBe(false);
      expect(intent.strength).toBe("none");
      expect(intent.reasons).toEqual(
        expect.arrayContaining([
          prompt.includes("not code or repo-specific")
            ? "explicit_model_only_concept_scope"
            : "model_only_concept_source_guard",
        ]),
      );
    }
  });

  it("routes deep physics prompts to model-only concept synthesis instead of repo, visual, or integrity failure paths", async () => {
    process.env.HELIX_MODEL_ONLY_CONCEPT_FINAL_ANSWER_TEST_RESPONSE = conceptAnswer;
    const app = createApp();

    for (const { name, prompt, expectedTerms } of deepPhysicsPrompts) {
      const response = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question: prompt,
          mode: "read",
          debug: true,
          sessionId: `deep-physics-parity-${name.replace(/\s+/g, "-")}-${Date.now()}`,
        })
        .expect(200);

      const body = response.body;
      const answer = String(body?.selected_final_answer ?? body?.answer ?? body?.text ?? "");
      const budget = body?.output_budget ?? body?.final_answer_draft?.output_budget;

      expect(body?.route_reason_code, name).not.toBe("turn_input_integrity_failed");
      expect(body?.terminal_error_code, name).not.toBe("solver_continuation_pending");
      expect(body?.source_target_intent?.target_source, name).not.toBe("repo_code");
      expect(body?.source_target_intent?.target_source, name).not.toBe("visual_capture");
      expect(body?.resolved_route_label ?? body?.route_reason_code, name).not.toMatch(/repo|visual|integrity/i);
      expect(body?.terminal_artifact_kind, name).toBe("model_synthesized_answer");
      expect(body?.final_answer_source, name).toBe("final_answer_draft");
      expect(body?.model_turn_packet?.loop_policy?.allow_tools, name).toBe(false);
      expect(body?.model_turn_result?.status, name).toBe("assistant_message");
      expect(body?.final_answer_draft?.source, name).toBe("model_turn");
      expect(
        body?.available_capabilities?.capabilities?.some(
          (capability: Record<string, unknown>) =>
            capability.capability_key === "repo-code.search_concept" &&
            capability.goal_fit !== "forbidden",
        ),
        name,
      ).toBe(false);
      expect(compact(answer), name).toBe(compact(conceptAnswer));
      expect(answer, name).not.toMatch(/I do not have the image|An electron is a fundamental subatomic particle/i);
      for (const pattern of expectedTerms) {
        expect(prompt, name).toMatch(pattern);
      }
      expect(budget?.schema, name).toBe("helix.final_answer_output_budget.v1");
      expect(budget?.mode, name).toBe("long");
    }
  }, 90000);
});
