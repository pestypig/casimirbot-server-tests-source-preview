import { describe, expect, it } from "vitest";

import {
  buildOperationalCapabilityTrace,
  buildOperationalSatisfactionEvaluation,
  buildTurnOperationalConstraints,
} from "../services/helix-ask/operational-constraints";
import {
  buildToolCallAdmissionDecision,
  ensureToolCallAdmissionDecisionForPayload,
} from "../services/helix-ask/tool-call-admission";

describe("Helix Ask operational constraints", () => {
  it("preserves forbidden image tools and local visual-capture meaning", () => {
    const packet = buildTurnOperationalConstraints({
      turnId: "ask:test:operational",
      promptText:
        "Do not call the GPT image 2. When I refer to visual capture, I mean the Helix Ask ability to capture a tab.",
      promptInterpretation: {
        schema: "helix.prompt_interpretation.v1",
        negative_constraints: ["Do not call the GPT image 2."],
      },
    });

    expect(packet.forbidden_tools).toContain("gpt-image-2");
    expect(packet.forbidden_tool_families).toContain("image_generation");
    expect(packet.local_term_bindings).toContainEqual(expect.objectContaining({
      term: "visual capture",
      meaning: "helix_tab_capture",
    }));
    expect(packet.assistant_answer).toBe(false);
  });

  it("materializes an exact Minecraft command as an exclusive one-tool constraint", () => {
    const promptText =
      'Ignite the surveyed hearth in my paired Minecraft Fabric world. Run exactly one command: use com.casimirbot.minecraft.command with command "setblock -50 68 -2 minecraft:fire", category "world_build", and effect "world_mutation". Do not run any other command or tool.';
    const packet = buildTurnOperationalConstraints({
      turnId: "ask:test:exclusive-command",
      promptText,
    });

    expect(packet.exclusive_tool_capabilities).toEqual([
      "com.casimirbot.minecraft.command",
    ]);
    expect(packet.requested_tool_cardinality).toBe(1);
    expect(packet.operator_constraints).toEqual(
      expect.arrayContaining([
        "exclusive_tool_capability:com.casimirbot.minecraft.command",
        "requested_tool_cardinality:1",
      ]),
    );
  });

  it("keeps a negated tool clause from forbidding a later explicit repo command", () => {
    const promptText =
      "Do not call scientific-calculator.solve_expression. Use repo-code.search_concept to find where terminal authority selects the answer.";
    const packet = buildTurnOperationalConstraints({
      turnId: "ask:test:mixed-negated-calculator-repo",
      promptText,
    });
    const admission = buildToolCallAdmissionDecision({
      turnId: "ask:test:mixed-negated-calculator-repo",
      promptText,
      sourceTargetIntent: {
        target_source: "repo_code",
        target_kind: "repo_code",
      },
    });

    expect(packet.forbidden_tool_families).not.toContain("repo_code");
    expect(admission.admitted_tool_families).toContain("repo_code");
    expect(admission.forbidden_tool_families).not.toContain("repo_code");
  });

  it("tracks Chrome extension localhost as a required operational surface", () => {
    const packet = buildTurnOperationalConstraints({
      turnId: "ask:test:chrome",
      promptText:
        "Through the localhost 5050 Chrome tab with the Codex extension, activate a debugging session.",
    });

    expect(packet.requested_surface).toBe("chrome_extension_localhost_5050_tab");
    expect(packet.required_surface).toBe("chrome_extension_localhost_5050_tab");
    expect(packet.surface_satisfaction_required).toBe(true);
    expect(packet.fallback_equivalence_policy).toBe("diagnostic_only");
    expect(packet.allowed_fallback_surfaces).toEqual(expect.arrayContaining(["backend_api_probe", "codex_in_app_browser"]));
  });

  it("projects operational constraints into tool admission decisions", () => {
    const admission = buildToolCallAdmissionDecision({
      turnId: "ask:test:admission",
      promptText:
        "Do not call the GPT image 2. Through the localhost 5050 Chrome tab with the Codex extension, check visual capture.",
      sourceTargetIntent: {
        target_source: "visual_capture",
        target_kind: "visual_capture",
      },
    });

    expect(admission.operational_constraints_ref).toBe("ask:test:admission:turn_operational_constraints");
    expect(admission.forbidden_tools).toContain("gpt-image-2");
    expect(admission.forbidden_tool_families).toContain("image_generation");
    expect(admission.required_surface).toBe("chrome_extension_localhost_5050_tab");
  });

  it("materializes missing admission decisions at the shared payload boundary", () => {
    const payload: Record<string, unknown> = {
      source_target_intent: {
        target_source: "visual_capture",
        target_kind: "visual_capture",
      },
    };

    const admission = ensureToolCallAdmissionDecisionForPayload({
      payload,
      turnId: "ask:test:payload-admission",
      promptText:
        "Do not call the GPT image 2. Through the localhost 5050 Chrome tab with the Codex extension, check visual capture.",
    });

    expect(payload.tool_call_admission_decision).toBe(admission);
    expect(admission.operational_constraints_ref).toBe("ask:test:payload-admission:turn_operational_constraints");
    expect(admission.forbidden_tools).toContain("gpt-image-2");
    expect(admission.forbidden_tool_families).toContain("image_generation");
    expect(admission.required_surface).toBe("chrome_extension_localhost_5050_tab");
  });

  it("separates proposed, rejected, executed, and fallback capabilities", () => {
    const payload = {
      capability_plan: {
        schema: "helix.capability_plan.v1",
        turn_id: "ask:test:trace",
        capability_family: "docs",
        requested_action: "locate_or_read_document",
        admission_status: "rejected",
        rejection_reason: "capability_family_not_admitted_by_tool_policy",
      },
      agent_step_decision: {
        schema: "helix.agent_step_decision.v1",
        model_decision: {
          chosen_capability: "docs-viewer.locate_in_doc",
        },
      },
      agent_runtime_loop: {
        schema: "helix.agent_runtime_loop.v1",
        iterations: [
          {
            iteration: 1,
            chosen_capability: "repo-code.search_concept",
            produced_artifacts: ["runtime_tool_call", "runtime_tool_observation"],
          },
        ],
      },
    };

    const trace = buildOperationalCapabilityTrace({
      turnId: "ask:test:trace",
      payload,
    });

    expect(trace.model_proposed_capability).toBe("docs-viewer.locate_in_doc");
    expect(trace.rejected_capability).toMatchObject({
      capability: "docs:locate_or_read_document",
      reason: "capability_family_not_admitted_by_tool_policy",
    });
    expect(trace.policy_admitted_capability).toBe("repo-code.search_concept");
    expect(trace.executed_capability).toBe("repo-code.search_concept");
    expect(trace.fallback_capability).toBe("repo-code.search_concept");
  });

  it("marks repo fallback as diagnostic when a Chrome surface was required", () => {
    const payload = {
      turn_operational_constraints: buildTurnOperationalConstraints({
        turnId: "ask:test:satisfaction",
        promptText: "Use the localhost 5050 Chrome tab with the Codex extension.",
      }),
      operational_capability_trace: {
        schema: "helix.operational_capability_trace.v1",
        turn_id: "ask:test:satisfaction",
        executed_capability: "repo-code.search_concept",
        fallback_capability: "repo-code.search_concept",
        fallback_authority_scope: "diagnostic_only",
      },
      capability_plan: { schema: "helix.capability_plan.v1" },
      agent_runtime_loop: { schema: "helix.agent_runtime_loop.v1" },
    };

    const evaluation = buildOperationalSatisfactionEvaluation({
      turnId: "ask:test:satisfaction",
      payload,
    });

    expect(evaluation.requested_surface_satisfied).toBe(false);
    expect(evaluation.fallback_used).toBe(true);
    expect(evaluation.fallback_equivalent).toBe(false);
    expect(evaluation.remaining_surface_blocker).toBe("required_surface_not_satisfied:chrome_extension_localhost_5050_tab");
    expect(evaluation.next_decision).toBe("continue");
  });
});
