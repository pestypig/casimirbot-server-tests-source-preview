import { describe, expect, it } from "vitest";
import { enrichCapabilityLaneCandidatesFromBody } from "../../agent-providers/codex-provider";
import type { HelixAgentProvider } from "../../agent-providers/types";
import { runHelixCapabilityLaneOneShotRequests } from "../one-shot-runner";
import { listHelixCapabilityLanes } from "../registry";

const CAPABILITY = "helix_ask.reflect_theory_context" as const;

const buildProvider = (workstationTools = true): HelixAgentProvider => ({
  id: "codex",
  label: "Codex Workstation Mode",
  permissionProfile: {
    id: "read-observe-act",
    label: "Read/observe plus non-mutating workstation action",
    allows: {
      observe: true,
      read: true,
      act: true,
      write: false,
      shell: false,
      codeMutation: false,
    },
  },
  enabled: () => true,
  supports: {
    streaming: false,
    workstationTools,
    capabilityLanes: true,
    capabilityLaneOneShot: true,
    capabilityLaneSessions: false,
    codeMutation: false,
  },
  runTurn: async () => ({
    ok: false,
    runtime: "codex",
    response_type: "test",
    final_status: "test",
  }),
});

describe("runtime theory reflection gateway bridge", () => {
  it("advertises the canonical theory capability with semantic and derivation arguments", () => {
    const manifest = listHelixCapabilityLanes({
      provider: buildProvider(),
      env: {} as NodeJS.ProcessEnv,
    });
    const capability = manifest.lanes
      .find((lane) => lane.lane_id === "workstation_tool_reference")
      ?.capabilities.find(
        (candidate) => candidate.capability_id === CAPABILITY,
      );

    expect(capability).toMatchObject({
      capability_id: CAPABILITY,
      one_shot_status: "executable",
      result_authority: "observation_or_receipt_only",
      reentry_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      model_visible_hint: {
        required_input_fields: ["prompt"],
        optional_input_fields: expect.arrayContaining([
          "conversation_context",
          "build_explanation_plan",
          "operation",
          "target_observable",
          "scale_min_log10_m",
          "scale_max_log10_m",
          "coordinate_frame",
          "initial_boundary_conditions",
          "formal_system",
          "requested_precision",
          "evidence_maturity_ceiling",
          "resolved_referent_text",
          "resolved_source_ref",
          "resolved_text_hash",
        ]),
        when_to_use: expect.stringContaining(
          "concise, faithful central subject",
        ),
        when_not_to_use: expect.stringContaining("observation-only"),
        request_shape_hint: {
          capability_lane_call: expect.objectContaining({
            capability: CAPABILITY,
            prompt:
              "<concise central semantic theory topic derived from the resolved source>",
          }),
        },
      },
    });
  });

  it("delegates a runtime-authored semantic prompt to the existing gateway and returns only an observation", async () => {
    const prompt =
      "Deterministic microscopic laws can produce probabilistic macroscopic observations through coarse-graining.";
    const result = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider(),
      body: {
        turn_id: "ask:test:runtime-theory-bridge",
        capability_lane_call: {
          capability: CAPABILITY,
          prompt,
          conversation_context:
            "The user asked to map the concept across physical scales.",
          mentioned_domains: ["statistical mechanics", "information theory"],
          build_explanation_plan: true,
          operation: "compare",
          target: "deterministic and probabilistic descriptions across scales",
          target_observable: "macrostate probability",
          evidence_maturity_ceiling: "diagnostic",
        },
      },
      turnId: "ask:test:runtime-theory-bridge",
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result.call_results).toHaveLength(1);
    expect(result.call_results[0]).toMatchObject({
      schema: "helix.workstation_tool_reference.gateway_bridge_result.v1",
      ok: true,
      lane_id: "workstation_tool_reference",
      capability: CAPABILITY,
      delegated_capability_id: CAPABILITY,
      delegation_status: "gateway_executed",
      semantic_prompt_argument_source: "runtime_semantic_prompt",
      delegated_gateway_call_result: {
        schema: "helix.workstation_tool_gateway.call_result.v1",
        ok: true,
        capability_id: CAPABILITY,
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        observation: {
          schema: "helix.theory_context_reflection_observation.v1",
          prompt,
        },
      },
      gateway_admission: {
        requested_capability: CAPABILITY,
        admission_status: "admitted",
      },
      reentry_required: true,
      answer_authority: false,
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
      observation: {
        schema: "helix.theory_context_reflection_observation.v1",
        capability_key: CAPABILITY,
        status: "succeeded",
        prompt,
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
      },
    });
    expect(result.observation_packets[0]).toMatchObject({
      capability_key: CAPABILITY,
      status: "succeeded",
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
    });
    expect(result.resolve_traces[0]).toMatchObject({
      requested_lane: "workstation_tool_reference",
      execution_status: "executed_observation_only",
      terminal_eligible: false,
      assistant_answer: false,
    });
  });

  it("binds direct comparisons to the user-owned semantic prompt and strips runtime evidence hints", async () => {
    const userPrompt =
      "Now compare two interpretations with the Theory Badge Graph: first, that macroscopic " +
      "probability is epistemic because coarse-graining hides deterministic microstates; second, " +
      "that probability is fundamental rather than caused by missing information. Show where the " +
      "graph supports or fails to represent each interpretation.";
    const runtimePrompt =
      "Compare epistemic and objective probability using selection, prebiotic photochemistry, and DP collapse.";
    const capabilityLaneCall = enrichCapabilityLaneCandidatesFromBody(
      { question: userPrompt },
      {
        capability: CAPABILITY,
        prompt: runtimePrompt,
        mentioned_domains: [
          "evolutionary biophysics",
          "astrochemistry",
          "objective collapse",
        ],
        mentioned_symbols: ["p_DP_trigger"],
        mentioned_equations: ["p = 1 - exp(-dt/tau_DP)"],
        operation: "compare",
        build_explanation_plan: true,
      },
    );
    const result = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider(),
      body: {
        question: userPrompt,
        turn_id: "ask:test:user-bound-theory-comparison",
        capability_lane_call: capabilityLaneCall,
      },
      turnId: "ask:test:user-bound-theory-comparison",
      env: {} as NodeJS.ProcessEnv,
    });

    expect(capabilityLaneCall).toMatchObject({
      capability: CAPABILITY,
      prompt: runtimePrompt,
      user_semantic_prompt: userPrompt,
      semantic_prompt_source: "current_user_request",
    });
    expect(capabilityLaneCall).not.toHaveProperty("mentioned_domains");
    expect(capabilityLaneCall).not.toHaveProperty("mentioned_symbols");
    expect(capabilityLaneCall).not.toHaveProperty("mentioned_equations");
    expect(result.call_results[0]).toMatchObject({
      ok: true,
      delegation_status: "gateway_executed",
      semantic_prompt_argument_source: "current_user_request",
      runtime_prompt_differed_from_bound_semantic_prompt: true,
      reentry_required: true,
      answer_authority: false,
      terminal_eligible: false,
      assistant_answer: false,
      observation: {
        schema: "helix.theory_context_reflection_observation.v1",
        prompt: userPrompt,
        exact_badge_ids: [],
        likely_badge_ids: expect.arrayContaining([
          "scale.eft.effective_degrees_of_freedom_context",
          "scale.eft.rg_relevance_context",
        ]),
        open_world_uncertainty: {
          representedProbabilityMass: 0.55,
          outOfGraphProbability: 0.45,
          coverageBasis: "semantic_coverage_heuristic",
        },
      },
    });
    const observation = result.call_results[0]?.observation as
      Record<string, unknown> | undefined;
    expect(observation?.exact_badge_ids).not.toEqual(
      expect.arrayContaining([
        "biology.evolution.selection_fitness_context",
        "prebiotic.photochemistry.radiation_processing_context",
        "collapse.objective.dp_hazard_probability",
      ]),
    );
  });

  it("uses explicit current-turn badge and Lanyon case identities instead of blocking on a deictic procedure phrase", async () => {
    const userPrompt =
      "Re-prepare that same bounded procedure for study.casimir_dp.evidence_map_stage3 " +
      "and advection_diffusion_full_1d so the evidence is current for this turn. " +
      "Which semantic, boundary-condition, formal, numerical, and observable requirements are still missing? " +
      "Do not start any downstream job.";
    const capabilityLaneCall = enrichCapabilityLaneCandidatesFromBody(
      { question: userPrompt },
      {
        capability: CAPABILITY,
        prompt: "this",
        operation: "compare",
      },
    ) as Record<string, unknown>;

    expect(capabilityLaneCall).toMatchObject({
      capability: CAPABILITY,
      prompt: userPrompt,
      user_semantic_prompt: userPrompt,
      semantic_prompt_source:
        "current_user_request_explicit_scientific_identity",
      explicit_current_turn_badge_ids: ["study.casimir_dp.evidence_map_stage3"],
      explicit_current_turn_lanyon_case_id: "advection_diffusion_full_1d",
      referent_resolution_superseded_by:
        "explicit_current_turn_scientific_identity",
    });
    expect(capabilityLaneCall).not.toHaveProperty(
      "referent_resolution_block_reason",
    );

    const result = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider(),
      body: {
        question: userPrompt,
        turn_id: "ask:test:explicit-current-turn-theory-identities",
        capability_lane_call: capabilityLaneCall,
      },
      turnId: "ask:test:explicit-current-turn-theory-identities",
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result.call_results[0]).toMatchObject({
      ok: true,
      delegation_status: "gateway_executed",
      semantic_prompt_argument_source: "current_user_request",
      observation: {
        schema: "helix.theory_context_reflection_observation.v1",
        status: "succeeded",
        prompt: userPrompt,
      },
    });
  });

  it.each([
    [
      "negated",
      "Do not re-prepare that same bounded procedure for study.casimir_dp.evidence_map_stage3 and advection_diffusion_full_1d.",
    ],
    [
      "future",
      "Later, re-prepare that same bounded procedure for study.casimir_dp.evidence_map_stage3 and advection_diffusion_full_1d.",
    ],
    [
      "historical",
      "Earlier I re-prepared that same bounded procedure for study.casimir_dp.evidence_map_stage3 and advection_diffusion_full_1d.",
    ],
    [
      "quoted screen text",
      'The screen says "Re-prepare that same bounded procedure for study.casimir_dp.evidence_map_stage3 and advection_diffusion_full_1d."',
    ],
  ])(
    "does not let %s scientific IDs override deictic admission",
    (_label, userPrompt) => {
      const capabilityLaneCall = enrichCapabilityLaneCandidatesFromBody(
        { question: userPrompt },
        {
          capability: CAPABILITY,
          prompt: "this",
        },
      ) as Record<string, unknown>;

      expect(capabilityLaneCall.prompt).toBe("this");
      expect(capabilityLaneCall).not.toHaveProperty(
        "explicit_current_turn_badge_ids",
      );
      expect(capabilityLaneCall).not.toHaveProperty(
        "referent_resolution_superseded_by",
      );
    },
  );

  it.each(["this", "That.", "IT?!"])(
    "fails closed before the gateway for unresolved deictic prompt %j",
    async (prompt) => {
      const result = await runHelixCapabilityLaneOneShotRequests({
        provider: buildProvider(),
        body: {
          turn_id: "ask:test:runtime-theory-deictic-block",
          capability_lane_call: {
            capability: CAPABILITY,
            prompt,
            conversation_context: "Reflect this with the Theory Badge Graph.",
          },
        },
        turnId: "ask:test:runtime-theory-deictic-block",
        env: {} as NodeJS.ProcessEnv,
      });

      expect(result.call_results[0]).toMatchObject({
        ok: false,
        capability: CAPABILITY,
        delegation_status: "blocked_before_gateway",
        delegated_gateway_call_result: null,
        gateway_admission: null,
        error: "referent_resolution_required",
        reentry_required: true,
        terminal_eligible: false,
        assistant_answer: false,
        observation: {
          schema:
            "helix.workstation_tool_reference.theory_reflection_bridge_observation.v1",
          status: "blocked",
          blocked_reason: "referent_resolution_required",
        },
      });
      expect(result.observation_packets[0]).toMatchObject({
        capability_key: CAPABILITY,
        status: "blocked",
        missing_requirements: [
          expect.objectContaining({
            code: "referent_resolution_required",
            repair_action:
              "supply_resolved_semantic_prompt_and_source_provenance",
          }),
        ],
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
      });
      expect(result.resolve_traces[0]).toMatchObject({
        execution_status: "not_executed_shadow_only",
        blocked_reason: "referent_resolution_required",
      });
    },
  );

  it("materializes a provenance-bound resolved referent as the semantic graph prompt", async () => {
    const resolvedReferent =
      "Deterministic microscopic dynamics may yield probabilistic observations after coarse-graining.";
    const result = await runHelixCapabilityLaneOneShotRequests({
      provider: buildProvider(),
      body: {
        turn_id: "ask:test:runtime-theory-resolved-referent",
        capability_lane_call: {
          capability: CAPABILITY,
          prompt: "this",
          resolved_referent_text: resolvedReferent,
          resolved_source_ref: "chat.final_answer.previous:turn-prior",
          resolved_text_hash: "4a51a18a3b2f606e",
          semantic_prompt_source: "runtime_resolved_referent",
          conversation_context: "Reflect this with the Theory Badge Graph.",
          build_explanation_plan: true,
        },
      },
      turnId: "ask:test:runtime-theory-resolved-referent",
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result.call_results[0]).toMatchObject({
      ok: true,
      delegation_status: "gateway_executed",
      resolved_source_ref: "chat.final_answer.previous:turn-prior",
      resolved_text_hash: "4a51a18a3b2f606e",
      semantic_prompt_source: "runtime_resolved_referent",
      semantic_prompt_argument_source: "runtime_resolved_referent",
      reentry_required: true,
      terminal_eligible: false,
      assistant_answer: false,
      observation: {
        capability_key: CAPABILITY,
        status: "succeeded",
        prompt: resolvedReferent,
        conversation_context_included: true,
      },
    });
  });
});
