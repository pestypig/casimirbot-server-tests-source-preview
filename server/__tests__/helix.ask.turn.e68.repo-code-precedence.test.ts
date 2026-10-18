import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { planRouter } from "../routes/agi.plan";
import { detectDeicticReference } from "../services/helix-ask/deictic-reference-detector";
import { detectRepoCodeEvidenceIntent } from "../services/helix-ask/repo-code-intent-detector";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

const visibleAnswerText = (body: any): string =>
  String(body?.selected_final_answer ?? body?.answer ?? body?.text ?? body?.finalAnswer ?? "");

const runtimeCapabilities = (body: any): string[] =>
  (body?.agent_runtime_loop?.iterations ?? [])
    .map((iteration: any) => String(iteration?.chosen_capability ?? ""))
    .filter(Boolean);

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

const withRepoSynthesisResponse = async <T>(answer: string, fn: () => Promise<T>): Promise<T> => {
  const previous = process.env.HELIX_RUNTIME_FINAL_ANSWER_TEST_RESPONSE;
  process.env.HELIX_RUNTIME_FINAL_ANSWER_TEST_RESPONSE = answer;
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.HELIX_RUNTIME_FINAL_ANSWER_TEST_RESPONSE;
    } else {
      process.env.HELIX_RUNTIME_FINAL_ANSWER_TEST_RESPONSE = previous;
    }
  }
};

describe("helix ask repo/code intent precedence", () => {
  it("detects hard repo/code evidence prompts", () => {
    const intent = detectRepoCodeEvidenceIntent(
      "Using repo/code evidence only, what lanes does StarSim support, and where is that enforced in code? Cite exact file paths and line-backed sources from the repository.",
    );

    expect(intent.repoEvidenceRequested).toBe(true);
    expect(intent.strength).toBe("hard");
    expect(intent.reasons).toEqual(
      expect.arrayContaining([
        "repo_code_evidence_only",
        "line_backed_sources",
        "implementation_enforcement_location",
      ]),
    );
    expect(intent.requestedOutputs).toEqual(
      expect.arrayContaining(["repo_code", "file_path", "line_backed_source", "implementation_location"]),
    );
  });

  it.each([
    {
      name: "Spanish hard repo evidence",
      prompt:
        "Busca en el repo cómo Helix Ask decide el idioma final. Usa evidencia del código y cita archivos y líneas.",
      reason: "spanish_repo_code_evidence_intent",
    },
    {
      name: "Chinese hard repo evidence",
      prompt:
        "请在代码仓库中查找 Helix Ask 如何决定最终回答语言。请引用文件和行号作为证据。",
      reason: "chinese_repo_code_evidence_intent",
    },
    {
      name: "Mixed Spanish explicit response language",
      prompt:
        "Explain Helix Ask final answer language, pero responde en español y usa evidencia del código.",
      reasons: ["mixed_language_repo_code_evidence_intent", "spanish_repo_code_evidence_intent"],
    },
  ])("detects multilingual repo/code evidence prompts: $name", ({ prompt, reason, reasons }) => {
    const intent = detectRepoCodeEvidenceIntent(prompt);

    expect(intent.repoEvidenceRequested, prompt).toBe(true);
    expect(intent.strength, prompt).toBe("hard");
    if (reason) {
      expect(intent.reasons, prompt).toContain(reason);
    } else {
      expect(intent.reasons.some((actual) => reasons?.includes(actual)), prompt).toBe(true);
    }
    expect(intent.requestedOutputs, prompt).toEqual(
      expect.arrayContaining(["repo_code", "file_path", "line_backed_source"]),
    );
  });

  it("detects project-local agent loop prompts as hard repo/runtime evidence", () => {
    const intent = detectRepoCodeEvidenceIntent(
      "Starting from the top of the agentic turn-based system.",
    );

    expect(intent.repoEvidenceRequested).toBe(true);
    expect(intent.strength).toBe("hard");
    expect(intent.reasons).toContain("project_local_agent_loop");
    expect(intent.requestedOutputs).toEqual(
      expect.arrayContaining([
        "repo_code",
        "implementation_location",
        "route_trace",
        "tool_call_eligibility",
        "terminal_contract",
        "codex_comparison",
        "line_backed_source",
      ]),
    );
  });

  it("does not treat active-doc line-backed location prompts as repo/code evidence", () => {
    const intent = detectRepoCodeEvidenceIntent(
      "Find lapse shift in the current doc and return the line-backed locations.",
    );

    expect(intent.repoEvidenceRequested).toBe(false);
    expect(intent.strength).toBe("none");
    expect(intent.reasons).toContain("active_docs_viewer_location_request_not_repo_code");
  });

  it("does not treat repo file-path requests as selected visible file references", () => {
    const ref = detectDeicticReference({
      threadId: "test",
      promptText: "Using repo/code evidence only, where is source-target admission enforced? Cite exact file paths and line-backed sources from the repository.",
      inputModality: "typed",
    });

    expect(ref.candidate_signal).toBe(false);
    expect(ref.reference_type).toBe("unknown");
  });

  it("still treats selected visible file prompts as Situation Room references", () => {
    const ref = detectDeicticReference({
      threadId: "test",
      promptText: "Can you see the file I'm clicking on right now?",
      inputModality: "typed",
    });

    expect(ref.candidate_signal).toBe(true);
    expect(ref.reference_type).toBe("selected_visible_file");
  });

  it("routes explicit repo/code evidence prompts away from Situation Room and direct answer paths", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "Using repo/code evidence only, what lanes does StarSim support, and where is that enforced in code? Cite exact file paths and line-backed sources from the repository.",
        mode: "read",
        debug: true,
        sessionId: `repo-code-starsim-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.route_reason_code).not.toBe("situation_context_question");
    expect(response.body?.final_answer_source).not.toBe("artifact_synthesis");
    expect(response.body?.final_answer_source).not.toBe("no_tool_direct");
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("repo_code_evidence_question");
    expect(response.body?.source_target_intent).toMatchObject({
      target_source: "repo_code",
      target_kind: "repo_code",
      strength: "hard",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
      precedence_reason: "explicit_repo_code_source_target",
    });
    expect(response.body?.route_product_contract).toMatchObject({
      source_target: "repo_code",
    });
    expect(response.body?.route_product_contract?.forbidden_terminal_artifact_kinds).toContain("situation_context_pack");
    expect(response.body?.retrieval_required_signal?.required).toBe(true);
    expect(response.body?.retrieval_required_signal?.strength).toBe("hard");
    expect(response.body?.repo_claim_observation_gate).toBeTruthy();
    expect(response.body?.repo_claim_support).toBeTruthy();
  }, 90000);

  it.each([
    {
      name: "Spanish hard repo evidence",
      question:
        "Busca en el repo cómo Helix Ask decide el idioma final. Usa evidencia del código y cita archivos y líneas.",
      expectedLanguage: "es",
    },
    {
      name: "Chinese hard repo evidence",
      question:
        "请在代码仓库中查找 Helix Ask 如何决定最终回答语言。请引用文件和行号作为证据。",
      expectedLanguage: "zh",
    },
    {
      name: "Mixed Spanish explicit response language",
      question:
        "Explain Helix Ask final answer language, pero responde en español y usa evidencia del código.",
      expectedLanguage: "es",
    },
    {
      name: "Mixed Chinese English repo intent",
      question:
        "Explain Helix Ask final answer 语言选择 using repo code evidence and cite file paths.",
      expectedLanguage: "en",
      allowedTerminalKinds: ["repo_code_evidence_answer", "typed_failure"],
    },
  ])("routes multilingual repo evidence prompts through repo evidence: $name", async ({ question, expectedLanguage, allowedTerminalKinds }) => {
    const app = createApp();
    const response = await withRepoSynthesisResponse(
      "Helix Ask decides response language through request metadata and the Ask language contract, then admits repo-code evidence before final synthesis. Sources: server/services/helix-ask/runtime/ask-handler.ts; server/services/helix-ask/language-contract.ts; server/services/helix-ask/repo-code-intent-detector.ts.",
      () => request(app)
        .post("/api/agi/ask/turn")
        .send({
          question,
          mode: "read",
          debug: true,
          sessionId: `multilang-repo-${Date.now()}`,
        })
        .expect(200),
    );

    expect(response.body?.language_contract).toBeTruthy();
    expect(response.body?.language_contract?.response_language).toBe(expectedLanguage);
    expect(response.body?.language_contract?.language_detected).not.toBeNull();
    expect(response.body?.debug?.language_contract).toMatchObject({
      schema: "helix.ask_language_contract.v1",
      response_language: expectedLanguage,
    });
    expect(response.body?.request_metadata?.language_contract).toMatchObject({
      schema: "helix.ask_language_contract.v1",
      response_language: expectedLanguage,
    });
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("repo_code_evidence_question");
    expect(response.body?.source_target_intent).toMatchObject({
      target_source: "repo_code",
      target_kind: "repo_code",
      strength: "hard",
      allow_no_tool_direct: false,
    });
    expect(response.body?.route_reason_code).not.toBe("conversation:simple");
    expect(response.body?.final_answer_source).not.toBe("model_direct_answer");
    expect(response.body?.final_answer_source).not.toBe("no_tool_direct");
    expect(allowedTerminalKinds ?? ["repo_code_evidence_answer"]).toContain(response.body?.terminal_artifact_kind);
    if (response.body?.terminal_artifact_kind === "repo_code_evidence_answer") {
      expect(response.body?.repo_claim_observation_gate).toBeTruthy();
    }
  }, 90000);

  it("exports language contract fields in the debug export for simple Spanish turns", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "\u00bfPuedes explicar la diferencia entre tiempo propio y tiempo coordenado?",
        mode: "read",
        debug: true,
        sessionId: `simple-spanish-debug-${Date.now()}`,
      })
      .expect(200);

    const debugExport = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(String(response.body?.turn_id))}/debug-export`)
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("model_only_concept");
    expect(debugExport.body?.payload?.language_contract).toMatchObject({
      schema: "helix.ask_language_contract.v1",
      response_language: "es",
    });
    expect(debugExport.body?.payload?.response_language).toBe("es");
    expect(debugExport.body?.payload?.language_detected).toBe("es");
    expect(debugExport.body?.payload?.code_mixed).toBe(false);
  }, 60000);

  it("preserves Chinese response language through repo evidence synthesis and debug export", async () => {
    const app = createApp();
    const question =
      "\u8bf7\u5728\u4ee3\u7801\u4ed3\u5e93\u4e2d\u67e5\u627e Helix Ask \u5982\u4f55\u51b3\u5b9a\u6700\u7ec8\u56de\u7b54\u8bed\u8a00\u3002\u8bf7\u5f15\u7528\u6587\u4ef6\u548c\u884c\u53f7\u4f5c\u4e3a\u8bc1\u636e\u3002";
    const response = await withRepoSynthesisResponse(
      "\u6839\u636e repo \u8bc1\u636e\uff0cHelix Ask \u4f1a\u5728\u8bf7\u6c42\u5165\u53e3\u521b\u5efa\u8bed\u8a00\u5951\u7ea6\uff0c\u5e76\u5728 repo \u8bc1\u636e\u7efc\u5408\u9636\u6bb5\u7ee7\u7eed\u4f7f\u7528 response_language\u3002Sources: server/services/helix-ask/language-contract.ts; server/routes/agi.plan.ts.",
      () => request(app)
        .post("/api/agi/ask/turn")
        .send({
          question,
          mode: "read",
          debug: true,
          sessionId: `chinese-language-repo-${Date.now()}`,
        })
        .expect(200),
    );

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("repo_code_evidence_question");
    expect(response.body?.source_target_intent).toMatchObject({
      target_kind: "repo_code",
      strength: "hard",
      allow_no_tool_direct: false,
    });
    expect(response.body?.final_answer_source).toBe("model_synthesis_from_repo_evidence");
    expect(response.body?.terminal_artifact_kind).toBe("repo_code_evidence_answer");
    expect(response.body?.debug?.response_language).toBe("zh");
    expect(visibleAnswerText(response.body)).toMatch(/[\u3400-\u9fff]/);

    const debugExport = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(String(response.body?.turn_id))}/debug-export`)
      .expect(200);
    expect(debugExport.body?.payload?.response_language).toBe("zh");
    expect(debugExport.body?.payload?.language_contract).toMatchObject({
      schema: "helix.ask_language_contract.v1",
      response_language: "zh",
    });
  }, 90000);

  it("keeps mixed Spanish repo debug export bounded and serializable", async () => {
    const app = createApp();
    const response = await withRepoSynthesisResponse(
      "Helix Ask conserva el idioma final en espa\u00f1ol cuando la solicitud mixta lo pide de forma expl\u00edcita y la ruta de repo aporta evidencia. Sources: server/services/helix-ask/language-contract.ts; server/routes/agi.plan.ts.",
      () => request(app)
        .post("/api/agi/ask/turn")
        .send({
          question: "Explain Helix Ask final answer language, pero responde en espa\u00f1ol y usa evidencia del c\u00f3digo.",
          mode: "read",
          debug: true,
          sessionId: `mixed-spanish-debug-${Date.now()}`,
        })
        .expect(200),
    );

    const debugExport = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(String(response.body?.turn_id))}/debug-export`)
      .expect(200);
    const debugJson = JSON.stringify(debugExport.body?.payload);

    expect(() => JSON.stringify(debugExport.body?.payload)).not.toThrow();
    expect(debugJson.length).toBeLessThan(750_000);
    expect(debugExport.body?.payload?.response_language).toBe("es");
    expect(response.body?.terminal_artifact_kind).toBe("repo_code_evidence_answer");
  }, 90000);

  it("routes source-target admission enforcement questions to repo evidence before visual deictic routing", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "Using repo/code evidence only, where is source-target admission enforced? Cite exact file paths and line-backed sources from the repository.",
        mode: "read",
        debug: true,
        sessionId: `repo-code-source-target-${Date.now()}`,
      })
      .expect(200);

    const ref = detectDeicticReference({
      threadId: "test",
      promptText:
        "Using repo/code evidence only, where is source-target admission enforced? Cite exact file paths and line-backed sources from the repository.",
      inputModality: "typed",
    });

    expect(ref.candidate_signal).toBe(false);
    expect(response.body?.source_target_intent).toMatchObject({
      target_source: "repo_code",
      strength: "hard",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
    });
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("repo_code_evidence_question");
    expect(response.body?.retrieval_required_signal).toMatchObject({
      required: true,
      strength: "hard",
    });
    expect(response.body?.route_product_contract?.forbidden_terminal_artifact_kinds).toEqual(
      expect.arrayContaining([
        "situation_context_pack",
        "visual_frame_evidence",
        "process_graph_overview",
        "no_tool_direct",
        "model_only_concept",
      ]),
    );
    expect(response.body?.final_answer_source).not.toBe("no_tool_direct");
    expect(response.body?.final_answer_source).not.toBe("model_only_concept");
  }, 90000);

  it("routes project-local agent loop prompts away from model-only direct answers", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Starting from the top of the agentic turn-based system.",
        mode: "read",
        debug: true,
        sessionId: `agent-loop-top-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("repo_code_evidence_question");
    expect(response.body?.retrieval_required_signal).toMatchObject({
      required: true,
      strength: "hard",
    });
    expect(response.body?.source_target_intent).toMatchObject({
      target_source: "repo_code",
      target_kind: "repo_code",
      strength: "hard",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
    });
    expect(response.body?.source_target_intent?.requested_outputs).toEqual(
      expect.arrayContaining(["tool_call_eligibility", "terminal_contract", "codex_comparison", "line_backed_source"]),
    );
    expect(response.body?.final_answer_source).not.toBe("no_tool_direct");
    expect(response.body?.tool_eligibility_diagnosis).toMatchObject({
      schema: "helix.tool_eligibility_diagnosis.v1",
      retrieval_required: true,
      retrieval_strength: "hard",
      source_target: "repo_code",
      allow_no_tool_direct: false,
      tool_path_allowed: true,
      blocking_reason: "none",
    });
    expect(response.body?.route_product_contract?.forbidden_terminal_artifact_kinds).toEqual(
      expect.arrayContaining(["direct_answer_text", "no_tool_direct", "model_only_concept", "process_graph_overview"]),
    );
  }, 90000);

  it("keeps runtime intent attached for repo/doc evidence prompts with conditional calculator wording", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question:
          "Use document or repo evidence to find the Helix Ask rule of thumb for tools, then use calculator-style reasoning only if there is a numeric gate or count to verify. Synthesize the result without writing files.",
        mode: "read",
        debug: true,
        sessionId: `repo-doc-calculator-compound-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("repo_code_evidence_question");
    expect(response.body?.source_target_intent).toMatchObject({
      target_source: "repo_code",
      strength: "hard",
      allow_no_tool_direct: false,
    });
    expect(response.body?.runtime_intent_packet).toMatchObject({
      schema: "helix.runtime_intent_packet.v1",
      completion_authority: "agent_runtime_loop_and_goal_satisfaction",
    });
    expect(response.body?.runtime_authority_audit).toMatchObject({
      schema: "helix.runtime_authority_audit.v1",
      runtime_intent_packet_ref: expect.stringContaining(":runtime_intent_packet"),
      source_targeted_turn: true,
    });
    expect(response.body?.runtime_authority_audit?.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: "runtime_intent_packet_present_for_source_or_capability_turn",
          passed: true,
        }),
      ]),
    );
    expect(response.body?.terminal_error_code).not.toBe("terminal_boundary_ineligible");
  }, 90000);

  it("diagnoses tool-call eligibility questions from repo/runtime evidence", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Why didn't it make the repo grep call?",
        mode: "read",
        debug: true,
        sessionId: `repo-grep-eligibility-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("repo_code_evidence_question");
    expect(response.body?.final_answer_source).not.toBe("no_tool_direct");
    expect(response.body?.tool_eligibility_diagnosis).toMatchObject({
      retrieval_required: true,
      source_target: "repo_code",
      allow_no_tool_direct: false,
      tool_path_allowed: true,
    });
  }, 90000);

  it("routes project-local entity definition prompts to repo evidence", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "What is StarSim?",
        mode: "read",
        debug: true,
        sessionId: `repo-entity-starsim-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.final_answer_source).not.toBe("no_tool_direct");
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("repo_entity_definition");
    expect(response.body?.source_target_intent).toMatchObject({
      target_source: "repo_code",
      target_kind: "repo_code",
      strength: "soft",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
      precedence_reason: "project_local_entity_source_target",
    });
    expect(response.body?.retrieval_required_signal?.required).toBe(true);
  }, 90000);

  it("detects internal workstation concepts as repo-backed entity definitions", () => {
    const cases = [
      ["What is the Situation Room?", "Situation Room"],
      ["What is Auntie Dottie in this app?", "Auntie Dottie"],
      ["What is Route Evidence supposed to be?", "Route Evidence"],
      ["How does the docs panel work?", "docs panel"],
      ["What are field workers?", "field worker"],
      ["What is the perturbation broker?", "perturbation broker"],
    ] as const;

    for (const [prompt, entity] of cases) {
      const intent = detectRepoCodeEvidenceIntent(prompt);
      expect(intent.repoEvidenceRequested, prompt).toBe(true);
      expect(["soft", "hard"], prompt).toContain(intent.strength);
      expect(intent.reasons, prompt).toEqual(
        expect.arrayContaining(
          intent.strength === "hard" ? ["project_local_agent_loop"] : ["project_local_entity_definition"],
        ),
      );
      expect(intent.projectEntity, prompt).toBe(entity);
      expect(intent.requestedOutputs, prompt).toContain("repo_code");
      if (intent.strength === "soft") {
        expect(intent.requestedOutputs, prompt).toContain("file_path");
      }
    }
  });

  it("routes Situation Room concept questions through repo evidence instead of generic direct answer", async () => {
    const app = createApp();
    const response = await withRepoSynthesisResponse(
      "The Situation Room is the workstation control surface for live sources, pipeline setup, observer workflows, and Ask-visible evidence handoffs. Sources: client/src/components/workstation/SituationRoomPipelinesPanel.tsx; shared/workstation-dynamic-tools.ts.",
      () => request(app)
        .post("/api/agi/ask/turn")
        .send({
          question: "What is the Situation Room?",
          mode: "read",
          debug: true,
          sessionId: `repo-entity-situation-room-${Date.now()}`,
        })
        .expect(200),
    );

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("repo_entity_definition");
    expect(response.body?.source_target_intent).toMatchObject({
      target_source: "repo_code",
      target_kind: "repo_code",
      strength: "soft",
      must_enter_backend_ask: true,
      allow_client_shortcut: false,
      allow_no_tool_direct: false,
      precedence_reason: "project_local_entity_source_target",
    });
    expect(response.body?.retrieval_required_signal).toMatchObject({
      required: true,
    });
    expect(["soft", "hard"]).toContain(response.body?.retrieval_required_signal?.strength);
    expect(response.body?.available_capabilities?.recommended_capability_key).toBe("repo-code.search_concept");
    expect(response.body?.available_capabilities?.model_visible_capability_keys).toContain("repo-code.search_concept");
    expect(response.body?.capability_plan).toMatchObject({
      capability_family: "repo_evidence",
      requested_action: "repo-code.search_concept",
      source_target: "repo_code",
    });
    expect(response.body?.agent_runtime_loop?.iterations?.some((iteration: any) =>
      iteration?.chosen_capability === "repo-code.search_concept" &&
      iteration?.observation_role === "executed_tool_result"
    )).toBe(true);
    expect(response.body?.current_turn_artifact_ledger?.some((artifact: any) =>
      artifact?.kind === "repo_code_evidence_observation" &&
      artifact?.payload?.schema === "helix.repo_code_evidence_observation.v1"
    )).toBe(true);
    expect(response.body?.post_tool_observation_reviews?.length).toBeGreaterThan(0);
    expect(response.body?.final_answer_source).not.toBe("no_tool_direct");
    expect(response.body?.final_answer_source).not.toBe("model_direct_answer");
    expect(response.body?.terminal_artifact_kind).toBe("repo_code_evidence_answer");
    expect(response.body?.terminal_artifact_kind).not.toBe("direct_answer_text");
    expect(response.body?.final_status).toBe("final_answer");
    expect(response.body?.response_type).toBe("final_answer");
    expect(response.body?.resolved_turn_summary).toMatchObject({
      final_status: "final_answer",
      resolved_route_label: "repo_entity_definition / repo_code_evidence_answer",
      terminal_kind: "final_answer",
      terminal_artifact_kind: "repo_code_evidence_answer",
      terminal_error_code: null,
      pending_server_request_present: false,
    });
    expect(response.body?.resolved_turn_summary?.resolved_route_label).not.toMatch(/typed_failure|unavailable/i);
    expect(visibleAnswerText(response.body)).not.toMatch(/required artifacts.*(?:doc_summary|doc_concept_explanation)/i);
    expect(response.body?.final_answer_source).toBe("model_synthesis_from_repo_evidence");
    expect(runtimeCapabilities(response.body)).toContain("repo-code.search_concept");
    expect(runtimeCapabilities(response.body)).toContain("model.synthesize_from_repo_evidence");
    expect(runtimeCapabilities(response.body).slice(runtimeCapabilities(response.body).indexOf("repo-code.search_concept") + 1)).not.toContain("model.direct_answer");
    expect(response.body?.final_answer_draft).toMatchObject({
      model_step_capability: "model.synthesize_from_repo_evidence",
    });
    expect(response.body?.repo_code_evidence_answer).toMatchObject({
      model_step_capability: "model.synthesize_from_repo_evidence",
    });
    expect(response.body?.repo_answer_text_quality_gate).toMatchObject({ ok: true });
    expect(visibleAnswerText(response.body)).toMatch(/workstation control surface|situation room/i);
    expect(visibleAnswerText(response.body)).not.toMatch(/I found current repo evidence|Key evidence:/i);
    expect(response.body?.repo_claim_observation_gate).toMatchObject({
      decision: "observe",
      failedClosed: false,
    });
    expect(Array.isArray(response.body?.evidence_observations)).toBe(true);
    expect(response.body?.evidence_observations.length).toBeGreaterThan(0);
  }, 90000);

  it.each([
    {
      prompt: "What is the reasoning theater in helix ask?",
      answer:
        "The Reasoning Theater is a Helix Ask surface for exposing turn-state/topology around model reasoning and UI presentation, backed by route and state files rather than generic prose. Sources: server/routes/helix/reasoning-theater.ts; server/services/helix-ask/surface/reasoning-theater-state.ts.",
      expectedPath:
        /server\/routes\/helix\/reasoning-theater\.ts|server\/services\/helix-ask\/surface\/reasoning-theater-state\.ts|server\/__tests__\/helix.*reasoning-theater/i,
    },
    {
      prompt: "Do you know what the star simulations do in the codebase?",
      answer:
        "StarSim is represented in the codebase by the StellarEvolutionLens panel and server/modules/starsim import/runtime modules. The retrieved evidence includes StarSimStellarEvolutionStage imports in the panel and StarSim accordion import files under server/modules/starsim. Sources: client/src/components/panels/StellarEvolutionLens.tsx; server/modules/starsim/accordion/gaia-structure-import.ts; server/modules/starsim/accordion/sparc-rotation-import.ts.",
      expectedPath:
        /server\/modules\/starsim\/|shared\/starsim-|tools\/starsim|client\/src\/components\/panels\/StellarEvolutionLens\.tsx/i,
    },
  ])("routes exact repo concept alias prompt through relevant repo evidence: $prompt", async ({ prompt, answer, expectedPath }) => {
    const app = createApp();
    const response = await withRepoSynthesisResponse(
      answer,
      () => request(app)
        .post("/api/agi/ask/turn")
        .send({
          question: prompt,
          mode: "read",
          debug: true,
          sessionId: `repo-concept-alias-${Date.now()}`,
        })
        .expect(200),
    );

    const repoObservation = response.body?.current_turn_artifact_ledger?.find((artifact: any) =>
      artifact?.kind === "repo_code_evidence_observation" &&
      artifact?.payload?.schema === "helix.repo_code_evidence_observation.v1"
    );
    const spanPaths = String((repoObservation?.payload?.spans ?? []).map((span: any) => span?.path).join("\n"));

    expect(response.body?.canonical_goal_frame?.goal_kind).toMatch(/repo_(?:entity_definition|code_evidence_question)/);
    expect(response.body?.source_target_intent).toMatchObject({
      target_source: "repo_code",
      target_kind: "repo_code",
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
    });
    expect(runtimeCapabilities(response.body)).toContain("repo-code.search_concept");
    expect(runtimeCapabilities(response.body)).toContain("model.synthesize_from_repo_evidence");
    expect(runtimeCapabilities(response.body).slice(runtimeCapabilities(response.body).indexOf("repo-code.search_concept") + 1)).not.toContain("model.direct_answer");
    expect(spanPaths).toMatch(expectedPath);
    expect(response.body?.repo_evidence_relevance_gate).toMatchObject({
      terminal_allowed: true,
      weak_fuzzy_only: false,
    });
    expect(["adequate", "strong"]).toContain(response.body?.repo_evidence_relevance_gate?.coverage);
    expect(response.body?.terminal_artifact_kind).toBe("repo_code_evidence_answer");
    expect(response.body?.final_answer_source).toBe("model_synthesis_from_repo_evidence");
    expect(response.body?.repo_answer_text_quality_gate).toMatchObject({ ok: true });
  }, 90000);

  it.each([
    {
      prompt: "What is Auntie Dottie in this app?",
      entity: "Auntie Dottie",
      evidencePath:
        /helix-dottie-manifest-preset|dottie-manifest-preset|workstation-tool-planner|workstation-dynamic-tools|helix-agent-commentary|runtime-authority-contract/i,
    },
    {
      prompt: "What is Route Evidence supposed to be?",
      entity: "Route Evidence",
      evidencePath:
        /helix-situation-construct|situation-room-live-job-contract|situation-construct-recipe|situation-room-live-job-setup-planner|SituationRoomPipelinesPanel|panelActionAdapters/i,
    },
  ])("routes $entity concept questions through repo evidence before ambient panel/live routing", async ({ prompt, evidencePath }) => {
    const app = createApp();
    const response = await withRepoSynthesisResponse(
      `${prompt.replace(/\?$/, "")} is a project-internal workstation concept that should be explained from repo evidence, not from a generic definition. Sources: shared/helix-dottie-manifest-preset.ts; client/src/components/workstation/SituationRoomPipelinesPanel.tsx.`,
      () => request(app)
        .post("/api/agi/ask/turn")
        .send({
          question: prompt,
          mode: "read",
          debug: true,
          sessionId: `repo-entity-${prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
        })
        .expect(200),
    );

    const answer = visibleAnswerText(response.body);
    const repoObservation = response.body?.current_turn_artifact_ledger?.find((artifact: any) =>
      artifact?.kind === "repo_code_evidence_observation" &&
      artifact?.payload?.schema === "helix.repo_code_evidence_observation.v1"
    );
    const spanPaths = String((repoObservation?.payload?.spans ?? []).map((span: any) => span?.path).join("\n"));

    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("repo_entity_definition");
    expect(response.body?.source_target_intent).toMatchObject({
      target_source: "repo_code",
      target_kind: "repo_code",
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
    });
    expect(response.body?.available_capabilities?.recommended_capability_key).toBe("repo-code.search_concept");
    expect(response.body?.agent_runtime_loop?.iterations?.some((iteration: any) =>
      iteration?.chosen_capability === "repo-code.search_concept" &&
      iteration?.observation_role === "executed_tool_result"
    )).toBe(true);
    expect(repoObservation).toBeTruthy();
    expect(spanPaths).toMatch(evidencePath);
    expect(response.body?.terminal_artifact_kind).toBe("repo_code_evidence_answer");
    expect(response.body?.final_answer_source).toBe("model_synthesis_from_repo_evidence");
    expect(runtimeCapabilities(response.body)).toContain("repo-code.search_concept");
    expect(runtimeCapabilities(response.body)).toContain("model.synthesize_from_repo_evidence");
    expect(runtimeCapabilities(response.body).slice(runtimeCapabilities(response.body).indexOf("repo-code.search_concept") + 1)).not.toContain("model.direct_answer");
    expect(response.body?.final_answer_draft).toMatchObject({
      model_step_capability: "model.synthesize_from_repo_evidence",
    });
    expect(response.body?.repo_answer_text_quality_gate).toMatchObject({ ok: true });
    expect(response.body?.final_answer_source).not.toBe("model_direct_answer");
    expect(response.body?.final_answer_source).not.toBe("no_tool_direct");
    expect(response.body?.final_status).toBe("final_answer");
    expect(answer).not.toMatch(/I could not produce a terminal answer|direct_answer_unavailable|agent_loop_budget_exhausted/i);
  }, 90000);

  it("does not stream stale failed turn completion before authoritative repo concept final", async () => {
    const app = createApp();
    const response = await withRepoSynthesisResponse(
      "Auntie Dottie is a witness-only Situation Room observer preset that can attach to public trace events and voice proposals while keeping Helix Ask responsible for terminal answers. Sources: shared/helix-dottie-manifest-preset.ts; server/services/helix-ask/workstation-tool-planner.ts.",
      () => request(app)
        .post("/api/agi/ask/turn/stream")
        .send({
          question: "What is Auntie Dottie in this app?",
          mode: "read",
          debug: true,
          sessionId: `repo-entity-dottie-stream-${Date.now()}`,
        })
        .expect(200),
    );

    const events = parseSseEvents(response.text ?? "");
    const turnFinal = events.findLast((event) => event.event === "turn_final")?.data;
    const streamedFailedCompletions = events.filter((event) =>
      event.event === "turn_transcript_event" &&
      event.data?.source_event_type === "turn_completed" &&
      (event.data?.status === "failed" || event.data?.status === "final_failure")
    );
    const streamedPrematureFinalFailureDecisions = events.filter((event) =>
      event.event === "turn_transcript_event" &&
      event.data?.type === "decision" &&
      (event.data?.status === "failed" || event.data?.status === "final_failure")
    );

    expect(streamedFailedCompletions).toEqual([]);
    expect(streamedPrematureFinalFailureDecisions).toEqual([]);
    expect(turnFinal).toMatchObject({
      terminal_artifact_kind: "repo_code_evidence_answer",
      final_status: "final_answer",
      client_server_terminal_match: true,
    });
    expect((turnFinal?.turn_transcript_events ?? []).some((event: any) =>
      event?.type === "decision" && (event?.status === "failed" || event?.status === "final_failure")
    )).toBe(false);
    expect(String(turnFinal?.selected_final_answer ?? turnFinal?.answer ?? turnFinal?.text ?? "")).not.toMatch(
      /I could not produce a terminal answer|missing_required_artifacts|doc_concept_explanation/i,
    );
  }, 90000);

  it("keeps explicit background-only prompts direct", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Background only: what is a generic stellar simulation?",
        mode: "read",
        debug: true,
        sessionId: `background-only-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.retrieval_required_signal?.required).toBe(false);
    expect(response.body?.dispatch_policy).toBe("direct_answer_only");
  }, 60000);

  it("keeps background-only agent loop prompts direct", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Background only: starting from the top of the agentic turn-based system.",
        mode: "read",
        debug: true,
        sessionId: `background-agent-loop-${Date.now()}`,
      })
      .expect(200);

    expect(response.body?.retrieval_required_signal?.required).toBe(false);
    expect(response.body?.dispatch_policy).toBe("direct_answer_only");
    expect(response.body?.canonical_goal_frame?.goal_kind).toBe("model_only_concept");
  }, 60000);
});
