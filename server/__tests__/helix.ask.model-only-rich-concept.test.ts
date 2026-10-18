import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { planRouter } from "../routes/agi.plan";
import {
  detectRichModelOnlyConceptPrompt,
  isSimpleElectronDefinitionPrompt,
} from "../services/helix-ask/model-only-rich-concept";
import { detectModelOnlyConceptSourceSignal } from "../services/helix-ask/model-only-concept-source-guard";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

const richConceptPrompt =
  'Can you relate to the theory concept badge ? "Yea but what exactly is a field anyways? Both electrons and photons are considered zero-dimensional point particles without physical volume, radius, or a hard surface. Since we are all made of these invisible building blocks we actually do not exist in the physical sense! dimension are mathematical representations of reality and that notation is also not real fields emerge from electron movement and this is known as a probability in a sphere "';

const composedRichAnswer = [
  "A field is a physical quantity or quantum system spread through space, not just a force made after particles move.",
  "Electrons and photons are modeled as pointlike quanta or excitations in their fields, which means current experiments do not resolve a hard surface.",
  "That does not mean we do not exist; solidity is an emergent effect of electromagnetic interaction and quantum rules.",
  "Dimensions and notation are mathematical structure used to model physical reality, not proof that reality is only notation.",
  "The probability sphere is closer to an orbital or probability cloud for finding an electron than the source of the electron field.",
].join("\n\n");

const parseSseEvents = (text: string): Array<{ event: string; data: any }> =>
  text
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!event || !data) return null;
      return { event, data: JSON.parse(data) };
    })
    .filter(Boolean) as Array<{ event: string; data: any }>;

afterEach(() => {
  delete process.env.HELIX_MODEL_ONLY_CONCEPT_FINAL_ANSWER_TEST_RESPONSE;
  delete process.env.HELIX_MODEL_TURN_TEST_RESPONSE;
});

describe("Helix Ask rich model-only concept prompts", () => {
  it("flags the field/electron/photon prompt and blocks generic electron fallback", () => {
    const signal = detectRichModelOnlyConceptPrompt(richConceptPrompt);

    expect(signal).toMatchObject({
      schema: "helix.rich_model_only_concept_signal.v1",
      applies: true,
      should_block_generic_fallback: true,
      should_use_long_form_composer: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(signal.reason_codes).toEqual(
      expect.arrayContaining([
        "compound_concept_prompt",
        "physics_field_particle_terms",
        "long_form_explanation_expected",
        "generic_definition_fallback_forbidden",
      ]),
    );
    expect(signal.concept_terms).toEqual(
      expect.arrayContaining(["field", "electron", "photon", "dimension", "probability"]),
    );
    expect(isSimpleElectronDefinitionPrompt(richConceptPrompt)).toBe(false);
  });

  it("keeps simple electron definition prompts eligible for the short fallback", () => {
    expect(isSimpleElectronDefinitionPrompt("What is an electron?")).toBe(true);
    expect(detectRichModelOnlyConceptPrompt("What is an electron?").applies).toBe(false);
  });

  it("treats ordinary deep physics prompts as model-only concepts, not repo or visual source targets", () => {
    const prompt =
      "How should I understand the popular vacuum-fluctuation picture in quantum field theory? People say virtual particles pop in and out of existence, but that sounds like a literal source of energy. Explain what the picture gets right and where it becomes misleading.";

    const generalSignal = detectModelOnlyConceptSourceSignal(prompt);
    const richSignal = detectRichModelOnlyConceptPrompt(prompt);

    expect(generalSignal).toMatchObject({
      applies: true,
      explicit_project_source_request: false,
      explicit_visual_input_request: false,
      should_prefer_model_only_concept: true,
    });
    expect(generalSignal.reason_codes).toEqual(expect.arrayContaining(["figurative_picture_reference"]));
    expect(generalSignal.concept_terms).toEqual(
      expect.arrayContaining(["picture", "source", "qft", "virtual_particle", "vacuum_fluctuation"]),
    );
    expect(richSignal).toMatchObject({
      applies: true,
      should_use_long_form_composer: true,
      should_block_generic_fallback: true,
    });
  });

  it("routes rich model-only concept prompts through a long final draft", async () => {
    process.env.HELIX_MODEL_ONLY_CONCEPT_FINAL_ANSWER_TEST_RESPONSE = composedRichAnswer;
    const app = createApp();

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: richConceptPrompt,
        mode: "read",
        debug: true,
        sessionId: `rich-model-only-concept-${Date.now()}`,
      })
      .expect(200);

    const body = response.body;
    const answer = String(body?.selected_final_answer ?? body?.answer ?? body?.text ?? "");
    const outputBudget = body?.output_budget ?? body?.final_answer_draft?.output_budget;

    expect(body?.rich_model_only_concept_signal?.applies).toBe(true);
    expect(body?.rich_model_only_concept_signal?.should_block_generic_fallback).toBe(true);
    expect(body?.model_turn_packet).toBeTruthy();
    expect(body?.model_turn_result?.status).toBe("assistant_message");
    expect(body?.model_turn_result?.model_step_capability).toMatch(/model\.turn/);
    expect(body?.terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(body?.final_answer_source).toBe("final_answer_draft");
    expect(body?.final_answer_draft?.source).toBe("model_turn");
    expect(body?.final_answer_draft?.text).toContain("field");
    expect(body?.final_answer_draft?.text).toContain("pointlike");
    expect(body?.final_answer_draft?.text).toContain("probability");
    expect(answer).not.toMatch(/^An electron is a fundamental subatomic particle/i);
    expect(answer).toMatch(/field/i);
    expect(answer).toMatch(/electron|photon/i);
    expect(answer).toMatch(/pointlike|zero-dimensional|point/i);
    expect(answer).toMatch(/dimension|mathematical/i);
    expect(answer).toMatch(/exist|solid|reality/i);
    expect(answer).toMatch(/probability|orbital|cloud/i);

    expect(outputBudget).toBeTruthy();
    expect(outputBudget?.schema).toBe("helix.final_answer_output_budget.v1");
    expect(outputBudget?.mode).toBe("long");
    expect(outputBudget?.max_tokens).toBeGreaterThanOrEqual(3000);
    expect(body?.model_turn_packet?.loop_policy?.allow_tools).toBe(false);
    const ledger = Array.isArray(body?.current_turn_artifact_ledger) ? body.current_turn_artifact_ledger : [];
    expect(
      ledger.some((artifact: Record<string, unknown>) => {
        const payload = artifact.payload as Record<string, unknown> | undefined;
        return (
          artifact.kind === "runtime_tool_call" &&
          String(payload?.capability_key ?? payload?.capability ?? payload?.chosen_capability ?? "").includes("repo-code.search_concept")
        );
      }),
    ).toBe(false);
    expect(
      body?.available_capabilities?.capabilities?.some(
        (capability: Record<string, unknown>) =>
          capability.capability_key === "repo-code.search_concept" &&
          capability.goal_fit !== "forbidden",
      ),
    ).toBe(false);

    const debug = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(String(body.turn_id))}/debug-export`)
      .expect(200);
    const debugPayload = debug.body?.payload;

    expect(String(debugPayload?.selected_final_answer ?? "").replace(/\s+/g, " ").trim()).toBe(
      answer.replace(/\s+/g, " ").trim(),
    );
    expect(debugPayload?.terminal_answer_authority).toMatchObject({
      final_answer_source: "final_answer_draft",
      terminal_artifact_kind: "model_synthesized_answer",
      terminal_kind: "answer",
      server_authoritative: true,
    });
    expect(String(debugPayload?.terminal_answer_authority?.terminal_text_preview ?? "").replace(/\s+/g, " ").trim()).toBe(
      answer.replace(/\s+/g, " ").trim(),
    );
    expect(debugPayload?.resolved_turn_summary?.terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(debugPayload?.model_turn_result?.status).toBe("assistant_message");
  }, 60000);

  it("fails closed instead of returning the rich-concept placeholder when synthesis is unavailable", async () => {
    process.env.HELIX_MODEL_ONLY_CONCEPT_FINAL_ANSWER_TEST_RESPONSE =
      "Rich model-only concept prompt requires final synthesis.";
    const app = createApp();

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "Yea but what exactly is a field anyways? Both electrons and photons are considered zero-dimensional point particles without physical volume, radius, or a hard surface. Do fields emerge from electron movement, and is this known as a probability in a sphere?",
        mode: "read",
        debug: true,
        sessionId: `rich-model-only-concept-placeholder-${Date.now()}`,
      })
      .expect(200);

    const body = response.body;
    const answer = String(body?.selected_final_answer ?? body?.answer ?? body?.text ?? "");

    expect(body?.rich_model_only_concept_signal?.applies).toBe(true);
    expect(body?.terminal_artifact_kind).toBe("typed_failure");
    expect(body?.final_answer_source).toBe("typed_failure");
    expect(body?.terminal_error_code).toBe("model_only_concept_final_synthesis_unavailable");
    expect(answer).not.toBe("Rich model-only concept prompt requires final synthesis.");
    expect(answer).toMatch(/could not produce/i);
  }, 60000);

  it("uses the model-turn final draft on the streaming UI projection path", async () => {
    process.env.HELIX_MODEL_TURN_TEST_RESPONSE = composedRichAnswer;
    const app = createApp();

    const response = await request(app)
      .post("/api/agi/ask/turn/stream")
      .set("Accept", "text/event-stream")
      .send({
        question: richConceptPrompt,
        mode: "read",
        debug: true,
        sessionId: `rich-model-only-concept-stream-${Date.now()}`,
      })
      .expect(200);

    const events = parseSseEvents(response.text);
    const finalPacket = events.findLast((event) => event.event === "turn_final")?.data;
    const answer = String(finalPacket?.selected_final_answer ?? finalPacket?.answer ?? finalPacket?.text ?? "");
    const outputBudget = finalPacket?.output_budget ?? finalPacket?.final_answer_draft?.output_budget;

    expect(finalPacket?.rich_model_only_concept_signal?.applies).toBe(true);
    expect(finalPacket?.model_turn_packet).toBeTruthy();
    expect(finalPacket?.model_turn_result?.status).toBe("assistant_message");
    expect(finalPacket?.model_turn_result?.model_step_capability).toMatch(/model\.turn/);
    expect(finalPacket?.terminal_artifact_kind).toBe("model_synthesized_answer");
    expect(finalPacket?.final_answer_source).toBe("final_answer_draft");
    expect(finalPacket?.final_answer_draft?.source).toBe("model_turn");
    expect(answer.replace(/\s+/g, " ").trim()).toBe(composedRichAnswer.replace(/\s+/g, " ").trim());
    expect(answer).not.toMatch(/^An electron is a fundamental subatomic particle/i);
    expect(answer).toMatch(/field/i);
    expect(answer).toMatch(/electron|photon/i);
    expect(answer).toMatch(/pointlike|zero-dimensional|point/i);
    expect(answer).toMatch(/dimension|mathematical/i);
    expect(answer).toMatch(/exist|solid|reality/i);
    expect(answer).toMatch(/probability|orbital|cloud/i);
    expect(outputBudget?.schema).toBe("helix.final_answer_output_budget.v1");
    expect(outputBudget?.mode).toBe("long");
    expect(outputBudget?.max_tokens).toBeGreaterThanOrEqual(3000);
    expect(finalPacket?.model_turn_packet?.loop_policy?.allow_tools).toBe(false);
    expect(
      finalPacket?.available_capabilities?.capabilities?.some(
        (capability: Record<string, unknown>) =>
          capability.capability_key === "repo-code.search_concept" &&
          capability.goal_fit !== "forbidden",
      ),
    ).toBe(false);

    const debug = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(String(finalPacket.turn_id))}/debug-export`)
      .expect(200);
    const debugPayload = debug.body?.payload;

    expect(debugPayload?.model_turn_result?.status).toBe("assistant_message");
    expect(debugPayload?.final_answer_draft?.source).toBe("model_turn");
    expect(debugPayload?.output_budget?.mode ?? debugPayload?.final_answer_draft?.output_budget?.mode).toBe("long");
    expect(finalPacket?.terminal_answer_authority).toMatchObject({
      final_answer_source: "final_answer_draft",
      terminal_artifact_kind: "model_synthesized_answer",
      terminal_kind: "answer",
      server_authoritative: true,
    });
    expect(String(finalPacket?.terminal_answer_authority?.terminal_text_preview ?? "").replace(/\s+/g, " ").trim()).toBe(
      answer.replace(/\s+/g, " ").trim(),
    );
    expect(finalPacket?.terminal_equivalence_harness_result?.failure_codes ?? []).toEqual([]);
    expect(finalPacket?.terminal_equivalence_harness_result?.ok).toBe(true);
  }, 60000);
});
