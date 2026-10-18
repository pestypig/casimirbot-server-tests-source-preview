import { describe, expect, it } from "vitest";

import {
  detectRepoConcept,
  detectRepoConceptDefinition,
} from "../services/helix-ask/repo-concept-detector";
import {
  buildAskTurnSolverTrace,
  evaluateAskTurnSolverHardGate,
} from "../services/helix-ask/ask-turn-solver";
import { detectRepoCodeEvidenceIntent } from "../services/helix-ask/repo-code-intent-detector";
import { buildRepoCodeEvidenceAnswerContract } from "../services/helix-ask/repo-code-evidence-answer-contract";
import {
  expandRepoCodeEvidenceTerms,
  runRepoCodeEvidenceSearch,
} from "../services/helix-ask/retrieval/repo-code-evidence-search";
import { evaluateRepoEvidenceRelevanceGate } from "../services/helix-ask/repo-evidence-relevance-gate";
import { rankRepoCodeEvidenceHits } from "../services/helix-ask/retrieval/repo-code-evidence-ranker";
import {
  HELIX_REPO_CODE_EVIDENCE_OBSERVATION_SCHEMA,
  HELIX_REPO_CODE_SEARCH_CONCEPT_CAPABILITY,
  type HelixRepoCodeEvidenceAnswer,
  type HelixRepoCodeEvidenceObservation,
} from "../../shared/helix-repo-code-evidence-observation";

describe("Helix Ask repo concept evidence", () => {
  it("detects internal concept questions as repo-backed concepts", () => {
    expect(detectRepoConceptDefinition("What is the Situation Room?")).toMatchObject({
      canonical: "Situation Room",
      reason: "project_local_entity_definition",
    });
    expect(detectRepoConceptDefinition("What is the reasoning theater in helix ask?")).toMatchObject({
      canonical: "Reasoning Theater",
      reason: "project_local_entity_definition",
    });
    expect(detectRepoConceptDefinition("Do you know what the star simulations do in the codebase?")).toMatchObject({
      canonical: "StarSim",
      reason: "project_local_entity_definition",
    });
    expect(detectRepoConceptDefinition("How does the docs panel work?")).toMatchObject({
      canonical: "docs panel",
    });
    expect(detectRepoConceptDefinition("What is an electron?")).toBeNull();
    expect(detectRepoConceptDefinition("What is a star simulation generally?")).toBeNull();
  });

  it("returns a repo evidence decision for known Helix/workstation concepts", () => {
    expect(detectRepoConcept("What is terminal authority in Helix Ask?")).toMatchObject({
      applies: true,
      confidence: "high",
      concept: "terminal authority",
      reason: "known_project_concept_alias_with_project_anchor",
      require_repo_evidence: true,
      allow_model_direct_answer: false,
    });
    expect(detectRepoConcept("What is an electron?")).toMatchObject({
      applies: true,
      confidence: "low",
      reason: "generic_concept_without_project_anchor",
      require_repo_evidence: false,
      allow_model_direct_answer: true,
    });
    expect(detectRepoConcept("What is an electron in one paragraph? Do not use workstation tools unless needed.")).toMatchObject({
      applies: true,
      confidence: "low",
      reason: "generic_concept_without_project_anchor",
      require_repo_evidence: false,
      allow_model_direct_answer: true,
    });
    expect(
      detectRepoConcept(
        "In plain language, explain the difference between a scientific hypothesis and a scientific theory without using workstation tools.",
      ),
    ).toMatchObject({
      applies: true,
      confidence: "low",
      reason: "generic_concept_without_project_anchor",
      require_repo_evidence: false,
      allow_model_direct_answer: true,
    });
    expect(
      detectRepoCodeEvidenceIntent(
        "Explain why momentum is conserved in an isolated two-object collision. Do not use workstation tools unless genuinely needed.",
      ),
    ).toMatchObject({
      repoEvidenceRequested: false,
      strength: "none",
    });
  });

  it("honors non-repo and action guardrails for concept-looking prompts", () => {
    expect(detectRepoConcept("What is terminal authority in law?")).toMatchObject({
      applies: true,
      concept: "terminal authority",
      reason: "domain_context_not_project_repo",
      require_repo_evidence: false,
      allow_model_direct_answer: true,
    });
    expect(detectRepoConcept("Open the Situation Room panel")).toMatchObject({
      applies: false,
      concept: "Situation Room",
      reason: "workstation_action_prompt",
      require_repo_evidence: false,
      allow_model_direct_answer: false,
    });
    expect(detectRepoConcept("Do not search the repo, just answer generally: what is Situation Room?")).toMatchObject({
      applies: true,
      concept: "Situation Room",
      reason: "user_requested_non_repo_grounding",
      require_repo_evidence: false,
      allow_model_direct_answer: true,
    });
  });

  it("treats project-anchored unknown internal nouns as medium confidence repo concepts", () => {
    expect(detectRepoConcept("How does FooBar work in this app?")).toMatchObject({
      applies: true,
      confidence: "medium",
      concept: "FooBar",
      reason: "project_anchor_project_like_concept",
      require_repo_evidence: true,
      allow_model_direct_answer: false,
    });
  });

  it("keeps repo concept intent separate from generic model-only answering", () => {
    const intent = detectRepoCodeEvidenceIntent("What is Auntie Dottie in this app?");
    expect(intent).toMatchObject({
      repoEvidenceRequested: true,
      strength: "soft",
      projectEntity: "Auntie Dottie",
    });
    expect(intent.requestedOutputs).toEqual(expect.arrayContaining(["repo_code", "file_path"]));
  });

  it("does not turn contextual docs-viewer open references into repo concepts", () => {
    const prompt = "Do not open the docs viewer; just explain what the docs viewer is for.";

    expect(detectRepoConcept(prompt)).toMatchObject({
      reason: "contextual_tool_reference_suppressed",
      require_repo_evidence: false,
      allow_model_direct_answer: true,
    });
    expect(detectRepoConceptDefinition(prompt)).toBeNull();
    expect(detectRepoCodeEvidenceIntent(prompt)).toMatchObject({
      repoEvidenceRequested: false,
      strength: "none",
      reasons: ["contextual_tool_reference_suppressed"],
    });
  });

  it("does not turn an active-workstation orientation question into repo code intent", () => {
    expect(detectRepoConceptDefinition("What is currently open in the workstation?")).toBeNull();
    expect(detectRepoCodeEvidenceIntent("What is currently open in the workstation?")).toMatchObject({
      repoEvidenceRequested: false,
      strength: "none",
      reasons: ["active_workstation_context_request_not_repo_code"],
    });
  });

  it("defines the answer contract as repo evidence first, terminal answer second", () => {
    const contract = buildRepoCodeEvidenceAnswerContract({
      turnId: "turn:repo-concept",
      goalKind: "repo_entity_definition",
    });
    expect(contract).toMatchObject({
      required_terminal_product: "repo_entity_definition",
      required_capability: HELIX_REPO_CODE_SEARCH_CONCEPT_CAPABILITY,
      required_observation_schema: HELIX_REPO_CODE_EVIDENCE_OBSERVATION_SCHEMA,
      requires_followup_model_synthesis: true,
      requires_file_evidence_refs: true,
    });
    expect(contract.forbidden_terminal_artifact_kinds).toEqual(
      expect.arrayContaining(["direct_answer_text", "no_tool_direct", "model_only_concept", "panel_generated_answer"]),
    );
  });

  it("wraps HelixEvidenceObservation spans without becoming answer text", () => {
    const observation: HelixRepoCodeEvidenceObservation = {
      schema: HELIX_REPO_CODE_EVIDENCE_OBSERVATION_SCHEMA,
      artifact_id: "artifact:repo-evidence",
      turn_id: "turn:repo-concept",
      concept: "Situation Room",
      query: "Situation Room",
      normalized_terms: ["Situation Room"],
      search_strategy: {
        exact_terms: ["Situation Room"],
        symbol_terms: [],
        path_globs_considered: ["server/services/helix-ask"],
        max_spans: 4,
      },
      evidence_refs: ["server/services/helix-ask/situation-room.ts:10"],
      observations: [
        {
          id: "obs:situation-room",
          lane: "repo_search",
          source_kind: "repo_code",
          source_id: "server/services/helix-ask/situation-room.ts:10",
          observed_at: "2026-05-26T00:00:00.000Z",
          provenance: "retrieved",
          confidence: 0.85,
          refs: ["server/services/helix-ask/situation-room.ts:10"],
          content_role: "evidence_not_assistant_answer",
          consent_state: "not_required",
          filePath: "server/services/helix-ask/situation-room.ts",
          lineStart: 10,
          lineEnd: 10,
          snippet: "Situation Room",
          term: "Situation Room",
          query: "Situation Room",
          sourceStage: "fallback_repo_search",
        },
      ],
      spans: [
        {
          ref: "server/services/helix-ask/situation-room.ts:10",
          path: "server/services/helix-ask/situation-room.ts",
          start_line: 10,
          end_line: 10,
          excerpt: "Situation Room",
          reason: "matched_concept_path_or_text_signal",
          source_kind: "repo_code",
          score: 18,
        },
      ],
      selected_for_answer: true,
      assistant_answer: false,
      raw_content_included: false,
    };

    const answer: HelixRepoCodeEvidenceAnswer = {
      schema: "helix.repo_code_evidence_answer.v1",
      artifact_id: "artifact:repo-answer",
      turn_id: observation.turn_id,
      concept: observation.concept,
      answer_text: "The Situation Room is described from repo evidence.",
      support_refs: observation.evidence_refs,
      uncertainty: [],
      evidence_observation_ref: observation.artifact_id,
      assistant_answer: true,
      raw_content_included: false,
    };

    expect(observation.assistant_answer).toBe(false);
    expect(observation.observations[0]?.content_role).toBe("evidence_not_assistant_answer");
    expect(answer.assistant_answer).toBe(true);
    expect(answer.evidence_observation_ref).toBe(observation.artifact_id);
  });

  it("ranks concept-matching implementation files ahead of unrelated hits", () => {
    const ranked = rankRepoCodeEvidenceHits({
      query: "Situation Room",
      concept: "Situation Room",
      exactTerms: ["Situation Room", "SituationRoom", "SituationRoomStore", "useSituationRoomStore"],
      hits: [
        { filePath: "docs/random.md", line: 1, text: "unrelated", term: "room" },
        { filePath: "server/services/helix-ask/ask-turn-solver.ts", line: 12, text: "import { buildSituationContextPack } from '../situation-room/situation-context-pack';", term: "situation" },
        { filePath: "client/src/store/useSituationRoomStore.ts", line: 82, text: "export type SituationRoomStoreState = { createRoom: (title?: string) => SituationRoom; sources: Record<string, SituationRoomSource>; }", term: "SituationRoom" },
        { filePath: "server/services/helix-ask/situation-room-router.ts", line: 12, text: "Situation Room routes", term: "situation" },
        { filePath: "node_modules/pkg/index.js", line: 1, text: "Situation Room", term: "situation" },
      ],
    });
    expect(ranked[0]?.filePath).toBe("client/src/store/useSituationRoomStore.ts");
    expect(ranked.findIndex((hit) => hit.filePath === "client/src/store/useSituationRoomStore.ts")).toBeLessThan(
      ranked.findIndex((hit) => hit.filePath === "server/services/helix-ask/ask-turn-solver.ts"),
    );
    expect(ranked.some((hit) => hit.filePath.includes("node_modules"))).toBe(false);
  });

  it("ranks Dottie, Route Evidence, and docs panel concept files ahead of generic Helix Ask hits", () => {
    const dottieRanked = rankRepoCodeEvidenceHits({
      query: "What is Auntie Dottie in this app?",
      concept: "Auntie Dottie",
      exactTerms: ["Auntie Dottie", "dottie.manifest", "observer.attach", "voice_delivery"],
      hits: [
        { filePath: "server/services/helix-ask/ask-turn-solver.ts", line: 10, text: "generic Helix Ask turn solver", term: "ask" },
        { filePath: "shared/helix-dottie-manifest-preset.ts", line: 1, text: "export type HelixDottieManifestPreset = { observer_profile: 'auntie_dottie' }", term: "Dottie" },
        { filePath: "server/services/helix-ask/workstation-tool-planner.ts", line: 2, text: "dottie.manifest observer.attach voice_delivery.propose_from_trace", term: "dottie" },
      ],
    });
    expect(dottieRanked[0]?.filePath).toMatch(/helix-dottie-manifest-preset|workstation-tool-planner/);

    const routeEvidenceRanked = rankRepoCodeEvidenceHits({
      query: "What is Route Evidence supposed to be?",
      concept: "Route Evidence",
      exactTerms: ["Route Evidence", "route_evidence", "live_env.query_navigation_state", "field_worker"],
      hits: [
        { filePath: "server/services/helix-ask/ask-turn-solver.ts", line: 10, text: "generic live environment review", term: "live" },
        { filePath: "shared/helix-situation-construct.ts", line: 5, text: "route_evidence missing_evidence field_worker policy", term: "route_evidence" },
        { filePath: "client/src/components/workstation/SituationRoomPipelinesPanel.tsx", line: 8, text: "Route Evidence and perturbations", term: "Route Evidence" },
      ],
    });
    expect(routeEvidenceRanked[0]?.filePath).toMatch(/helix-situation-construct|SituationRoomPipelinesPanel/);

    const docsRanked = rankRepoCodeEvidenceHits({
      query: "How does the docs panel work?",
      concept: "docs panel",
      exactTerms: ["docs panel", "docs-viewer", "DocViewerPanel", "doc_summary"],
      hits: [
        { filePath: "server/__tests__/helix.ask.domain-continuation-decision.test.ts", line: 1, text: "docs panel domain continuation", term: "docs" },
        { filePath: "client/src/components/DocViewerPanel.tsx", line: 1, text: "export function DocViewerPanel", term: "DocViewerPanel" },
        { filePath: "client/src/lib/workstation/panelActionAdapters.ts", line: 1, text: "docs-viewer summarize_doc locate_in_doc", term: "docs-viewer" },
      ],
    });
    expect(docsRanked[0]?.filePath).toMatch(/DocViewerPanel|panelActionAdapters/);
  });

  it("expands known concepts into repo search terms without treating them as commands", () => {
    expect(expandRepoCodeEvidenceTerms({
      concept: "Situation Room",
      query: "What is the Situation Room?",
    })).toEqual(expect.arrayContaining([
      "Situation Room",
      "SituationRoom",
      "situation-room",
      "situation_room",
      "situation_context",
      "situation-room-pipelines",
    ]));
    expect(expandRepoCodeEvidenceTerms({
      concept: "terminal authority",
      query: "How does terminal authority work in Helix Ask?",
    })).toEqual(expect.arrayContaining([
      "terminal authority",
      "terminal_authority",
      "terminal_answer_authority",
      "turn-terminal-authority",
      "repo_code_evidence_answer",
    ]));
    expect(expandRepoCodeEvidenceTerms({
      concept: "Auntie Dottie",
      query: "What is Auntie Dottie in this app?",
    })).toEqual(expect.arrayContaining([
      "Auntie Dottie",
      "dottie.manifest",
      "dottie_manifest_preset",
      "voice_delivery",
      "observer.attach",
    ]));
    expect(expandRepoCodeEvidenceTerms({
      concept: "Route Evidence",
      query: "What is Route Evidence supposed to be?",
    })).toEqual(expect.arrayContaining([
      "Route Evidence",
      "route_evidence",
      "live_perturbation",
      "field_worker",
      "live_env.query_navigation_state",
    ]));
    expect(expandRepoCodeEvidenceTerms({
      concept: "docs panel",
      query: "How does the docs panel work?",
    })).toEqual(expect.arrayContaining([
      "docs-viewer",
      "DocViewerPanel",
      "panelActionAdapters",
      "doc_summary",
    ]));
    expect(expandRepoCodeEvidenceTerms({
      concept: "Reasoning Theater",
      query: "What is the reasoning theater in Helix Ask?",
    })).toEqual(expect.arrayContaining([
      "Reasoning Theater",
      "reasoning-theater",
      "reasoning_theater",
      "ReasoningTheater",
    ]));
    expect(expandRepoCodeEvidenceTerms({
      concept: "StarSim",
      query: "Do you know what the star simulations do in the codebase?",
    })).toEqual(expect.arrayContaining([
      "StarSim",
      "starsim",
      "star simulations",
      "stellar simulations",
    ]));
  });

  it("prefers exact Reasoning Theater and StarSim evidence over fuzzy neighbors", async () => {
    const reasoningTheater = await runRepoCodeEvidenceSearch({
      turnId: "turn:reasoning-theater-search",
      callId: "call:reasoning-theater-search",
      conceptMatch: "Reasoning Theater",
      query: "What is the reasoning theater in helix ask?",
      max_files: 8,
      max_spans: 8,
      context_lines: 1,
    });
    expect(reasoningTheater.observation.spans.map((span) => span.path).join("\n")).toMatch(
      /server\/routes\/helix\/reasoning-theater\.ts|server\/services\/helix-ask\/surface\/reasoning-theater-state\.ts|server\/__tests__\/helix.*reasoning-theater/i,
    );
    const reasoningGate = evaluateRepoEvidenceRelevanceGate({
      turnId: "turn:reasoning-theater-search",
      concept: "Reasoning Theater",
      query: "What is the reasoning theater in helix ask?",
      observation: reasoningTheater.observation,
    });
    expect(reasoningGate).toMatchObject({
      terminal_allowed: true,
      weak_fuzzy_only: false,
    });
    expect(["adequate", "strong"]).toContain(reasoningGate.coverage);

    const starSim = await runRepoCodeEvidenceSearch({
      turnId: "turn:starsim-search",
      callId: "call:starsim-search",
      conceptMatch: "StarSim",
      query: "Do you know what the star simulations do in the codebase?",
      max_files: 8,
      max_spans: 8,
      context_lines: 1,
    });
    expect(starSim.observation.spans.map((span) => span.path).join("\n")).toMatch(
      /server\/modules\/starsim\/|shared\/starsim-|tools\/starsim|client\/src\/components\/panels\/StellarEvolutionLens\.tsx/i,
    );
    const starSimGate = evaluateRepoEvidenceRelevanceGate({
      turnId: "turn:starsim-search",
      concept: "StarSim",
      query: "Do you know what the star simulations do in the codebase?",
      observation: starSim.observation,
    });
    expect(starSimGate).toMatchObject({
      terminal_allowed: true,
      weak_fuzzy_only: false,
      alias_normalization_applied: true,
    });
  }, 60000);

  it("runs repo-code.search_concept as bounded read-only repo evidence search", async () => {
    const result = await runRepoCodeEvidenceSearch({
      turnId: "turn:repo-search-service",
      callId: "call:repo-search-service",
      conceptMatch: "Situation Room",
      query: "What is the Situation Room? ; rm -rf /",
      normalized_terms: ["Situation Room"],
      max_files: 5,
      max_spans: 6,
      context_lines: 1,
    });

    expect(result.observation).toMatchObject({
      schema: HELIX_REPO_CODE_EVIDENCE_OBSERVATION_SCHEMA,
      artifact_id: "call:repo-search-service:repo_code_evidence_observation",
      turn_id: "turn:repo-search-service",
      concept: "Situation Room",
      selected_for_answer: true,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(result.observation.normalized_terms).toEqual(expect.arrayContaining(["situation-room-pipelines"]));
    expect(result.rankedResult.hits.length).toBeGreaterThan(0);
    expect(result.rankedResult.hits.length).toBeLessThanOrEqual(6);
    expect(result.observation.spans.length).toBe(result.rankedResult.hits.length);
    expect(result.observation.spans[0]?.path).toMatch(/client\/src\/components\/workstation\/SituationRoom(?:Pipelines|Sources)Panel\.tsx|client\/src\/store\/useSituationRoom(?:Store|JobStore|GraphStore)\.ts|client\/src\/lib\/helix\/situation-room\.ts|server\/services\/situation-room\//);
    expect(result.observation.spans.some((span) => /client\/src\/store\/useSituationRoom(?:Store|JobStore|GraphStore)\.ts/.test(span.path))).toBe(true);
    expect(result.observation.spans.every((span) => !span.path.includes("node_modules"))).toBe(true);
    expect(result.observation.spans.every((span) => !span.path.includes(".."))).toBe(true);
  }, 30000);

  it("records repo concept evidence requests, results, reentry, and synthesis arbitration", () => {
    const payload = {
      canonical_goal_frame: {
        goal_kind: "repo_entity_definition",
        required_terminal_kind: "repo_code_evidence_answer",
      },
      source_target_intent: {
        target_source: "repo_code",
        target_kind: "repo_code",
        strength: "hard",
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "repo_code",
        allowed_terminal_artifact_kinds: ["repo_code_evidence_answer", "typed_failure", "request_user_input"],
        forbidden_terminal_artifact_kinds: ["direct_answer_text", "no_tool_direct", "repo_entity_definition"],
      },
      route_authority_audit: { route_authority_ok: true },
      poison_audit: { ok: true },
      terminal_answer_authority: { server_authoritative: true },
      current_turn_artifact_ledger: [
        {
          artifact_id: "repo:obs:situation-room",
          turn_id: "turn:repo-trace",
          kind: "repo_code_evidence_observation",
          payload: {
            schema: HELIX_REPO_CODE_EVIDENCE_OBSERVATION_SCHEMA,
            artifact_id: "repo:obs:situation-room",
            source_kind: "repo_code",
            selected_for_answer: true,
          },
        },
      ],
    };

    const trace = buildAskTurnSolverTrace({
      turnId: "turn:repo-trace",
      promptText: "What is the Situation Room?",
      selectedRoute: "repo_code_evidence",
      terminalArtifactKind: "repo_code_evidence_answer",
      finalAnswerSource: "model_synthesis_from_repo_evidence",
      payload,
      loopParityTrace: {
        route_authority_ok: true,
        poison_audit_ok: true,
        terminal_authority_ok: true,
      },
    });

    expect(trace.repo_concept_detection).toMatchObject({
      concept: "Situation Room",
      require_repo_evidence: true,
    });
    expect(trace.evidence_requests).toEqual([
      {
        request_id: "repo-concept:turn:repo-trace",
        source_target: "repo_code",
        required: true,
        purpose: "Explain project-internal concept from repo evidence",
      },
    ]);
    expect(trace.evidence_results).toContainEqual({
      result_id: "repo:obs:situation-room",
      source_kind: "repo_code",
      selected_for_answer: true,
    });
    expect(trace.evidence_reentry).toMatchObject({ required: true, completed: true });
    expect(trace.followup_reasoning).toMatchObject({ required: true, completed: true });
    expect(trace.final_arbitration).toMatchObject({
      terminal_artifact_kind: "repo_code_evidence_answer",
      final_answer_source: "model_synthesis_from_repo_evidence",
    });
  });

  it("hard-fails model.direct_answer terminals for repo concepts before repo evidence exists", () => {
    const payload = {
      canonical_goal_frame: {
        goal_kind: "repo_entity_definition",
      },
      source_target_intent: {
        target_source: "repo_code",
        target_kind: "repo_code",
        strength: "hard",
      },
      route_product_contract: {
        schema: "helix.route_product_contract.v1",
        source_target: "repo_code",
        allowed_terminal_artifact_kinds: ["repo_code_evidence_answer", "typed_failure"],
        forbidden_terminal_artifact_kinds: ["direct_answer_text", "no_tool_direct"],
      },
      route_authority_audit: { route_authority_ok: true },
      poison_audit: { ok: true },
      terminal_answer_authority: { server_authoritative: true },
      terminal_artifact_kind: "direct_answer_text",
      final_answer_source: "model_direct_answer",
    };
    const trace = buildAskTurnSolverTrace({
      turnId: "turn:repo-direct-block",
      promptText: "What is the Situation Room?",
      selectedRoute: "repo_code_evidence",
      terminalArtifactKind: "direct_answer_text",
      finalAnswerSource: "model_direct_answer",
      payload,
      loopParityTrace: {
        route_authority_ok: true,
        poison_audit_ok: true,
        terminal_authority_ok: true,
      },
    });
    const gate = evaluateAskTurnSolverHardGate({
      turnId: "turn:repo-direct-block",
      payload,
      trace,
    });

    expect(gate.failed).toBe(true);
    expect(gate.failure_codes).toContain("repo_evidence_required_before_answer");
  });
});
