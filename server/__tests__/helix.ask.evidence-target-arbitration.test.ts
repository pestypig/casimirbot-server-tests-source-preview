import { describe, expect, it } from "vitest";

import { arbitrateAskSourceTarget } from "../services/helix-ask/ask-source-target-arbitrator";
import { buildAskEvidenceTargetArbitration } from "../services/helix-ask/evidence-target-arbitration";

const arbitrate = (promptText: string) =>
  buildAskEvidenceTargetArbitration({
    turnId: "ask:test-evidence-target-arbitration",
    threadId: "helix-ask:test",
    promptText,
  });

describe("Helix Ask evidence target arbitration", () => {
  it("binds a natural named-document locator to the canonical docs.search capability", () => {
    const arbitration = arbitrate("Can you find the NHM2 current status whitepaper?");

    expect(arbitration).toMatchObject({
      selected_candidate_id: "docs_viewer.affirmative_document_search",
      selected_target_source: "docs_viewer",
      selected_target_kind: "docs_viewer",
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
    });
    expect(arbitration.available_capabilities).toContain("docs.search");
    expect(arbitration.available_capabilities).not.toContain("internet-search.search_web");
  });

  it("keeps both local Docs and scholarly tools available for a compound comparison", () => {
    const prompt =
      "Find one accessible primary paper that gives the strongest reality check on that assumption, then compare it with the NHM2 whitepaper and cite both.";
    const arbitration = arbitrate(prompt);

    expect(arbitration).toMatchObject({
      selected_candidate_id: "scholarly_research.local_docs_comparison",
      selected_target_source: "scholarly_research",
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
    });
    expect(arbitration.available_capabilities).toEqual(expect.arrayContaining([
      "docs.search",
      "docs-viewer.search_docs",
      "scholarly_research.lookup",
      "scholarly_research.fetch_full_text",
    ]));
    expect(arbitration.reason_codes).toEqual(expect.arrayContaining([
      "compound_local_docs_external_scholarly_comparison",
      "model_synthesis_requires_both_observation_families",
    ]));
    expect(arbitration.terminal_product_constraints).toEqual(expect.arrayContaining([
      "doc_evidence_synthesis_answer",
      "scholarly_research_answer",
      "model_synthesized_answer",
    ]));

    const sourceTarget = arbitrateAskSourceTarget({
      turnId: "ask:test-compound-source-target",
      threadId: "helix-ask:test",
      promptText: prompt,
    });
    expect(sourceTarget).toMatchObject({
      target_source: "scholarly_research",
      strength: "hard",
      precedence_reason: "evidence_target_arbitration_selected_scholarly_research",
      allow_no_tool_direct: false,
    });
    expect(sourceTarget.suppressed_routes).not.toContain("docs_viewer_receipt");
  });

  it("keeps an explicit arXiv comparison target outside the local Docs rail", () => {
    const arbitration = arbitrate(
      "Open the NHM2 current status whitepaper in the local docs and compare its source-closure caution with the primary paper arXiv:2105.03079. Cite both.",
    );

    expect(arbitration).toMatchObject({
      selected_candidate_id: "scholarly_research.local_docs_comparison",
      selected_target_source: "scholarly_research",
    });
    expect(arbitration.available_capabilities).toEqual(expect.arrayContaining([
      "docs.search",
      "scholarly_research.lookup",
    ]));
  });

  it.each([
    "Do not find an external paper; only explain what the NHM2 whitepaper says.",
    "Later, find a primary paper and compare it with the NHM2 whitepaper, but not now.",
    'The screen says "find a primary paper and compare it with the NHM2 whitepaper"; explain that wording.',
    "Later, compare arXiv:2105.03079 with the NHM2 whitepaper, but not now.",
    'The screen says "compare arXiv:2105.03079 with the NHM2 whitepaper"; explain that wording.',
    "Previously we compared arXiv:2105.03079 with the NHM2 whitepaper; summarize the history.",
    "If we compare arXiv:2105.03079 with the NHM2 whitepaper later, what would the workflow do?",
    "Do not compare arXiv:2105.03079 with the NHM2 whitepaper.",
  ])("does not admit a compound Docs and scholarly workflow from contextual wording: %s", (prompt) => {
    const arbitration = arbitrate(prompt);

    expect(arbitration.selected_candidate_id).not.toBe(
      "scholarly_research.local_docs_comparison",
    );
  });

  it("does not reinterpret a natural workstation-health question as web freshness", () => {
    const arbitration = arbitrate("How is the workstation doing right now?");

    expect(arbitration.selected_target_source).not.toBe("internet_search");
    expect(arbitration.available_capabilities).not.toContain("internet-search.search_web");
  });

  it.each([
    "Do not check how the workstation is doing right now.",
    "Later, check how the workstation is doing, but not now.",
    'The screen says "How is the workstation doing right now?" Explain that wording.',
  ])("keeps contextual workstation-health wording non-operational: %s", (prompt) => {
    const arbitration = arbitrate(prompt);

    expect(arbitration.selected_target_source).not.toBe("internet_search");
  });

  it("gives capability help precedence over scholarly and Image Lens lexical cues", () => {
    const arbitration = buildAskEvidenceTargetArbitration({
      turnId: "ask:test:capability-help-precedence",
      threadId: "thread:test:capability-help-precedence",
      promptText:
        "Does your tool for research papers allow you to pick papers you are able to parse? Or do you check what papers are openable to then use Image Lens?",
    });

    expect(arbitration).toMatchObject({
      selected_target_source: "runtime_evidence",
      selected_target_kind: "runtime_evidence",
      available_capabilities: ["helix_ask.inspect_capability_catalog"],
      terminal_product_constraints: ["capability_help_summary", "typed_failure"],
      reason_codes: expect.arrayContaining(["capability_catalog_precedence"]),
    });
  });

  it("lets Stage Play mail wake route metadata lock the live-source mailbox target before prompt scoring", () => {
    const arbitration = buildAskEvidenceTargetArbitration({
      turnId: "turn:stage-play-mail-wake-metadata",
      threadId: "thread:stage-play-mail-wake-metadata",
      promptText:
        "Compact wake: describe current visual capture status, but use the queued mailbox finding.",
      routeMetadata: {
        invocationKind: "stage_play_mail_wake",
        wakeRequestId: "stage_play_live_source_mail_wake:evidence-target",
        mailboxThreadId: "helix-ask:desktop",
        sourceTarget: "live_source_mailbox",
        requiredCanonicalGoal: "processed_mail_voice_decision",
        requiredPhase: "record_decision",
        allowedCapabilities: ["live_env.record_live_source_mail_decision"],
        forbiddenCapabilities: ["visual_capture_describe", "situation_context_pack", "workspace_os.status"],
        evidenceRefs: ["stage_play_processed_mail_packet:evidence-target"],
      },
    });

    expect(arbitration).toMatchObject({
      selected_target_source: "live_source_mailbox",
      selected_target_kind: "live_source_mailbox",
      selected_candidate_id: "live_source_mailbox.stage_play_mail_wake_route_metadata",
      reason: "route_metadata_stage_play_mail_wake",
      locked: true,
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
      assistant_answer: false,
      raw_content_included: false,
      context_role: "admission_control",
    });
    expect(arbitration.reason_codes).toEqual(expect.arrayContaining([
      "route_metadata_stage_play_mail_wake",
      "live_source_mailbox_route_metadata_authoritative",
    ]));
    expect(arbitration.available_capabilities).toEqual(["live_env.record_live_source_mail_decision"]);
    expect(arbitration.disallowed_capabilities).toEqual(expect.arrayContaining([
      "visual_capture_describe",
      "situation_context_pack",
      "workspace_os.status",
    ]));
    expect(arbitration.source_targets).toEqual(["live_source_mailbox"]);
  });

  it("keeps hard mailbox route metadata ahead of visual, internet, repo, and model-direct prompt bait", () => {
    const arbitration = buildAskEvidenceTargetArbitration({
      turnId: "turn:stage-play-mail-wake-adversarial-metadata",
      threadId: "thread:stage-play-mail-wake-adversarial-metadata",
      promptText:
        "Describe visual capture, search the internet for latest context, search repo-code.search_concept, or just use model.direct_answer.",
      routeMetadata: {
        invocationKind: "stage_play_mail_wake",
        wakeRequestId: "stage_play_live_source_mail_wake:adversarial",
        mailboxThreadId: "helix-ask:desktop",
        sourceTarget: "live_source_mailbox",
        requiredCanonicalGoal: "processed_mail_voice_decision",
        requiredPhase: "record_decision",
        allowedCapabilities: ["live_env.record_live_source_mail_decision"],
        forbiddenCapabilities: [
          "visual_capture_describe",
          "internet.search",
          "repo-code.search_concept",
          "model.direct_answer",
        ],
        evidenceRefs: ["stage_play_processed_mail_packet:adversarial"],
      },
    });

    expect(arbitration).toMatchObject({
      selected_target_source: "live_source_mailbox",
      selected_target_kind: "live_source_mailbox",
      reason: "route_metadata_stage_play_mail_wake",
      locked: true,
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
    });
    expect(arbitration.source_targets).toEqual(["live_source_mailbox"]);
    expect(arbitration.available_capabilities).toEqual(["live_env.record_live_source_mail_decision"]);
    expect(arbitration.disallowed_capabilities).toEqual(expect.arrayContaining([
      "visual_capture_describe",
      "internet.search",
      "repo-code.search_concept",
      "model.direct_answer",
    ]));
    expect(arbitration.selected_target_source).not.toBe("visual_capture");
    expect(arbitration.selected_target_source).not.toBe("internet_search");
    expect(arbitration.selected_target_source).not.toBe("repo_code");
    expect(arbitration.selected_target_source).not.toBe("model_only");
  });

  it("accepts snake-case live-source mailbox route metadata as the same hard route lock", () => {
    const arbitration = buildAskEvidenceTargetArbitration({
      turnId: "turn:stage-play-mail-wake-snake-metadata",
      threadId: "thread:stage-play-mail-wake-snake-metadata",
      promptText: "Search the latest internet result, unless the route metadata says mailbox.",
      routeMetadata: {
        invocationKind: "stage_play_mail_wake",
        wakeRequestId: "stage_play_live_source_mail_wake:snake",
        mailboxThreadId: "helix-ask:desktop",
        source_target: "live_source_mailbox",
        requiredCanonicalGoal: "processed_mail_interpretation",
        evidenceRefs: ["stage_play_processed_mail_packet:snake"],
      } as unknown as Parameters<typeof buildAskEvidenceTargetArbitration>[0]["routeMetadata"],
    });

    expect(arbitration).toMatchObject({
      selected_target_source: "live_source_mailbox",
      reason: "route_metadata_stage_play_mail_wake",
      locked: true,
      allow_no_tool_direct: false,
    });
    expect(arbitration.selected_target_source).not.toBe("internet_search");
  });

  it("treats Stage Play panel definition prompts as repo/product evidence before live reflection", () => {
    const arbitration = arbitrate("ok what is the stage play panel?");

    expect(arbitration).toMatchObject({
      schema: "helix.ask_evidence_target_arbitration.v1",
      selected_target_source: "repo_code",
      selected_target_kind: "repo_code",
      assistant_answer: false,
      raw_content_included: false,
      context_role: "admission_control",
    });
    expect(arbitration.available_capabilities).toContain("repo-code.search_concept");
    expect(arbitration.evidence_target_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target_source: "repo_code",
          capability_keys: expect.arrayContaining(["repo-code.search_concept"]),
        }),
        expect.objectContaining({
          target_source: "live_environment",
          capability_keys: expect.arrayContaining(["live_env.reflect_stage_play_context"]),
          reason_codes: expect.arrayContaining(["stage_play_lexical_candidate_only"]),
        }),
      ]),
    );
  });

  it("keeps explicit active Stage Play reflection on the live-environment evidence path", () => {
    const arbitration = arbitrate("Use Stage Play to reflect the active visual source.");

    expect(arbitration.selected_target_source).toBe("live_environment");
    expect(arbitration.must_enter_backend_ask).toBe(true);
    expect(arbitration.allow_no_tool_direct).toBe(false);
    expect(arbitration.available_capabilities).toContain("live_env.reflect_stage_play_context");
  });

  it("routes combined Stage Play badge graph and live mail loop causality to the composite mailbox reflection tool", () => {
    const arbitration = arbitrate(
      "Can you read the live mail loop as it is working, like inspect via a tool call of stage play badge graph?",
    );

    expect(arbitration).toMatchObject({
      selected_candidate_id: "live_source_mailbox.mail_loop_reflection",
      selected_target_source: "live_source_mailbox",
      selected_target_kind: "live_source_mailbox",
      must_enter_backend_ask: true,
      allow_no_tool_direct: false,
    });
    expect(arbitration.reason_codes).toEqual(expect.arrayContaining([
      "live_source_mail_loop_reflection_intent",
      "stage_play_mail_loop_combined_causality",
      "requires_live_source_mailbox_tool_observation",
    ]));
    expect(arbitration.available_capabilities).toEqual(expect.arrayContaining([
      "live_env.reflect_live_source_mail_loop",
      "live_env.reflect_stage_play_context",
      "live_env.read_processed_live_source_mail",
    ]));
    expect(arbitration.terminal_product_constraints).toEqual(expect.arrayContaining([
      "stage_play_live_source_mail_loop_reflection",
      "model_synthesized_answer",
    ]));
  });

  it("suppresses Stage Play tools when the prompt says not to use Stage Play", () => {
    const arbitration = arbitrate("Do not use Stage Play; explain conceptually.");

    expect(arbitration.disallowed_capabilities).toContain("live_env.reflect_stage_play_context");
    expect(arbitration.selected_target_source).not.toBe("live_environment");
  });

  it("does not turn generic citation requests into repo evidence", () => {
    const arbitration = arbitrate("What is energy mass equivalence? cite sources.");

    expect(arbitration.selected_target_source).not.toBe("repo_code");
    expect(arbitration.reason_codes).not.toContain("known_project_concept_alias_question");
  });

  it("keeps screen-visible control words contextual instead of admitting live tools", () => {
    const arbitration = arbitrate('The screen says "start visual interval." What does that label mean?');

    expect(arbitration.selected_target_source).not.toBe("live_environment");
    expect(arbitration.available_capabilities).not.toContain("live_env.reflect_stage_play_context");
    expect(arbitration.available_capabilities).not.toContain("live-source.set_rate");
  });

  it("treats not-yet-started visual capture phrasing as context, not control", () => {
    const arbitration = arbitrate("I haven't started visual capture yet. Explain what will be needed before a checkpoint.");

    expect(arbitration.selected_target_source).not.toBe("live_environment");
    expect(arbitration.available_capabilities).not.toContain("live_env.reflect_stage_play_context");
    expect(arbitration.available_capabilities).not.toContain("live-source.set_rate");
  });

  it("keeps MoralGraph reflection primary when research words are quoted conversation context", () => {
    const arbitration = buildAskEvidenceTargetArbitration({
      turnId: "turn:moral-contextual-research",
      threadId: "thread:moral-contextual-research",
      promptText:
        "Use the Moral Badge Graph to reflect this conversation and classify procedural next moves. In the conversation someone says they need research papers and data before trusting decisions, but I am not asking you to search external sources.",
    });

    expect(arbitration.selected_candidate_id).toBe("workstation_panel.moral_graph_reflection");
    expect(arbitration.selected_target_source).toBe("workstation_panel");
    expect(arbitration.reason_codes).toEqual(
      expect.arrayContaining([
        "moral_graph_reflection_explicit_cue",
        "workstation_tool_plan_capability_candidate",
        "receipt_must_reenter_model_solver",
      ]),
    );
    expect(arbitration.available_capabilities).toEqual(
      expect.arrayContaining(["helix_ask.reflect_ideology_context"]),
    );

    const scholarlyCandidate = arbitration.evidence_target_candidates.find(
      (candidate) => candidate.candidate_id === "scholarly_research.external_sources",
    );
    expect(scholarlyCandidate).toBeTruthy();
    expect(scholarlyCandidate?.strength).toBe("soft");
    expect(scholarlyCandidate?.reason_codes).toEqual(
      expect.arrayContaining([
        "contextual_research_mention_only",
        "no_external_research_operator_command",
        "available_as_contrast_evidence_not_primary_target",
      ]),
    );
  });

  it("lets explicit scholarly search commands outrank MoralGraph as an external evidence target", () => {
    const arbitration = buildAskEvidenceTargetArbitration({
      turnId: "turn:moral-explicit-scholar",
      threadId: "thread:moral-explicit-scholar",
      promptText:
        "Use MoralGraph as context, but search scholarly papers and cite sources about moral guilt, rumination, and Buddhist practice.",
    });

    expect(arbitration.selected_candidate_id).toBe("scholarly_research.external_sources");
    expect(arbitration.selected_target_source).toBe("scholarly_research");
    expect(arbitration.available_capabilities).toEqual(
      expect.arrayContaining(["helix_ask.reflect_ideology_context", "scholarly_research.lookup"]),
    );
  });

  it("admits Moral Graph living substrate reflection as a model-visible evidence target", () => {
    const arbitration = buildAskEvidenceTargetArbitration({
      turnId: "turn:moral-living-substrate",
      threadId: "thread:moral-living-substrate",
      promptText:
        "Use the Moral Graph to derive moral relevance from organism boundary, sensing, homeostasis, entropy pressure, and how mandates emerge from living systems.",
    });

    expect(arbitration.selected_candidate_id).toBe("workstation_panel.moral_graph_reflection");
    expect(arbitration.selected_target_source).toBe("workstation_panel");
    expect(arbitration.available_capabilities).toContain("moral-graph.reflect_living_substrate_context");
    expect(arbitration.evidence_target_candidates[0]?.requested_outputs).toEqual(
      expect.arrayContaining([
        "ideology_context_reflection",
        "moral_badge_locator",
        "moral_living_substrate_reflection",
        "workstation_tool_evaluation",
      ]),
    );
  });

  it("exposes Theory-Moral bridge as a model-visible candidate when both graph families are requested", () => {
    const arbitration = buildAskEvidenceTargetArbitration({
      turnId: "turn:bridge",
      threadId: "thread:bridge",
      promptText:
        "Use the Theory Badge Graph and MoralGraph to reflect entropy, conservation, fairness, and due process as an evidence-only procedural bridge.",
    });

    expect(arbitration.selected_candidate_id).toBe("workstation_panel.theory_ideology_bridge_reflection");
    expect(arbitration.available_capabilities).toEqual(
      expect.arrayContaining([
        "helix_ask.reflect_theory_context",
        "helix_ask.reflect_ideology_context",
        "helix_ask.bridge_theory_ideology_context",
      ]),
    );
    expect(arbitration.evidence_target_candidates[0]?.requested_outputs).toEqual(
      expect.arrayContaining(["ideology_context_reflection", "theory_ideology_bridge", "workstation_tool_evaluation"]),
    );
  });
});
