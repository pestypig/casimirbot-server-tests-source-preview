import { describe, expect, it } from "vitest";
import {
  buildHelixLanguageModelDebugSummary,
  resolveHelixLanguageModelPolicy,
} from "@shared/helix-language-model-policy";
import {
  HELIX_DEVELOPER_ACCOUNT_POLICY,
  HELIX_USER_ACCOUNT_POLICY,
} from "@shared/helix-account-session";

describe("Helix language model policy", () => {
  it("resolves public profiles without exposing exact model overrides to user accounts", () => {
    const policy = resolveHelixLanguageModelPolicy({
      requestedProfile: "deep",
      exactModelOverride: "gpt-5.5-pro",
      accountPolicy: HELIX_USER_ACCOUNT_POLICY,
      promptText: "Implement a multi-step runtime agent change.",
    });

    expect(policy.requested_profile).toBe("deep");
    expect(policy.account_policy).toBe("user");
    expect(policy.exact_model_override_requested).toBe(true);
    expect(policy.exact_model_override_allowed).toBe(false);
    expect(policy.exact_model_override_rejected_reason).toBe("exact_model_override_requires_developer_account");
    expect(policy.resolved_model).not.toBe("gpt-5.5-pro");
    expect(policy.assistant_answer).toBe(false);
    expect(policy.terminal_eligible).toBe(false);
  });

  it("allows developer exact-model overrides and records developer tool tier", () => {
    const policy = resolveHelixLanguageModelPolicy({
      requestedProfile: "balanced",
      exactModelOverride: "gpt-5.5-pro",
      accountPolicy: HELIX_DEVELOPER_ACCOUNT_POLICY,
      promptText: "Debug the agent runtime.",
    });

    expect(policy.selection_source).toBe("developer_override");
    expect(policy.resolved_model).toBe("gpt-5.5-pro");
    expect(policy.tool_surface_tier).toBe("developer");
    expect(policy.persistence_scope).toBe("session");
  });

  it("pins the Codex-compatible test model without allowing Auto to escalate model or effort", () => {
    const policy = resolveHelixLanguageModelPolicy({
      requestedProfile: "auto",
      requestedSelectionMode: "pinned",
      pinnedModel: "gpt-5.6-terra",
      accountPolicy: HELIX_USER_ACCOUNT_POLICY,
      promptText:
        "Research, implement, and verify a multi-step tool-heavy workflow with source-backed synthesis.",
    });

    expect(policy.requested_selection_mode).toBe("pinned");
    expect(policy.selection_mode).toBe("pinned");
    expect(policy.selection_source).toBe("operator_pinned");
    expect(policy.resolved_model).toBe("gpt-5.6-terra");
    expect(policy.reasoning_effort).toBe("low");
    expect(policy.auto_selected_profile).toBeNull();
    expect(policy.escalation_reason).toBeNull();
    expect(policy.policy_signals).toEqual([]);
    expect(policy.persistence_scope).toBe("session");
    expect(policy.pinned_model_allowed).toBe(true);
    expect(buildHelixLanguageModelDebugSummary(policy)).toContain("AI: Pinned | gpt-5.6-terra");
  });

  it("fails to the allowlisted Terra model when a pinned request is missing or not allowlisted", () => {
    const policy = resolveHelixLanguageModelPolicy({
      requestedSelectionMode: "pinned",
      pinnedModel: "gpt-5.5",
      accountPolicy: HELIX_DEVELOPER_ACCOUNT_POLICY,
      promptText: "Perform the expensive deep workflow.",
    });

    expect(policy.selection_mode).toBe("pinned");
    expect(policy.selection_source).toBe("policy_downgrade");
    expect(policy.resolved_model).toBe("gpt-5.6-terra");
    expect(policy.reasoning_effort).toBe("low");
    expect(policy.pinned_model_allowed).toBe(false);
    expect(policy.pinned_model_rejected_reason).toBe("pinned_model_missing_or_not_allowlisted");
  });

  it("lets Auto choose deep turn-locally for complex work", () => {
    const policy = resolveHelixLanguageModelPolicy({
      requestedProfile: "auto",
      accountPolicy: HELIX_DEVELOPER_ACCOUNT_POLICY,
      promptText: "Research, implement, and verify a tool-heavy agent architecture change.",
    });

    expect(policy.requested_profile).toBe("auto");
    expect(policy.initial_requested_profile).toBe("auto");
    expect(policy.resolved_profile).toBe("deep");
    expect(policy.resolved_model).toBe("gpt-5.6-terra");
    expect(policy.auto_selected_profile).toBe("deep");
    expect(policy.persistence_scope).toBe("turn");
    expect(policy.escalation_reason).toBe("complex_tool_planning");
    expect(policy.policy_signals).toContain("complex_tool_planning");
    expect(buildHelixLanguageModelDebugSummary(policy)).toContain("AI: Auto -> Deep");
  });

  it("uses Fast for simple Auto chat instead of the Balanced fallback", () => {
    const policy = resolveHelixLanguageModelPolicy({
      requestedProfile: "auto",
      accountPolicy: HELIX_DEVELOPER_ACCOUNT_POLICY,
      promptText: "In one sentence, explain what this workstation is for.",
    });

    expect(policy.resolved_profile).toBe("fast");
    expect(policy.resolved_model).toBe("gpt-5.6-terra");
    expect(policy.reasoning_effort).toBe("low");
    expect(policy.policy_signals).toContain("simple_one_sentence");
    expect(policy.persistence_scope).toBe("turn");
  });

  it("keeps ordinary architecture explanation at Balanced", () => {
    const policy = resolveHelixLanguageModelPolicy({
      requestedProfile: "auto",
      accountPolicy: HELIX_DEVELOPER_ACCOUNT_POLICY,
      promptText: "Explain how Helix Ask should separate route proposals, tool receipts, and final answer authority.",
    });

    expect(policy.resolved_profile).toBe("balanced");
    expect(policy.resolved_model).toBe("gpt-5.6-terra");
    expect(policy.reasoning_effort).toBe("medium");
    expect(policy.policy_signals).toContain("balanced_explanation_or_tool_aware");
  });

  it("escalates debug export and failed gateway analysis to Deep", () => {
    const policy = resolveHelixLanguageModelPolicy({
      requestedProfile: "auto",
      accountPolicy: HELIX_DEVELOPER_ACCOUNT_POLICY,
      promptText:
        "This debug export says: blocked gateway requests: internet-search.search_web tavily_requires_TAVILY_API_KEY; repo.search query_too_broad. What bugs remain in the architecture?",
    });

    expect(policy.resolved_profile).toBe("deep");
    expect(policy.reasoning_effort).toBe("high");
    expect(policy.escalation_reason).toContain("debug_export_analysis");
    expect(policy.policy_signals).toEqual(expect.arrayContaining([
      "debug_export_analysis",
      "gateway_failure_analysis",
      "repair_planning",
    ]));
  });

  it("keeps lightweight scholarly candidate gathering below Deep", () => {
    const policy = resolveHelixLanguageModelPolicy({
      requestedProfile: "auto",
      accountPolicy: HELIX_DEVELOPER_ACCOUNT_POLICY,
      promptText:
        "Find candidate papers about negative energy constraints for warp metrics. I only need starting points, not a synthesis.",
    });

    expect(policy.resolved_profile).toBe("fast");
    expect(policy.reasoning_effort).toBe("low");
    expect(policy.policy_signals).toContain("lightweight_candidate_listing");
  });

  it("escalates scholarly synthesis and viability judgment to Deep", () => {
    const policy = resolveHelixLanguageModelPolicy({
      requestedProfile: "auto",
      accountPolicy: HELIX_DEVELOPER_ACCOUNT_POLICY,
      promptText:
        "Compare the strongest candidate papers about negative energy constraints for warp metrics and explain what they imply for NHM2 viability.",
    });

    expect(policy.resolved_profile).toBe("deep");
    expect(policy.reasoning_effort).toBe("high");
    expect(policy.policy_signals).toEqual(expect.arrayContaining([
      "scholarly_synthesis",
      "viability_judgment",
      "multi_source_comparison",
    ]));
  });

  it("escalates observation re-entry failures to Deep from runtime state", () => {
    const policy = resolveHelixLanguageModelPolicy({
      requestedProfile: "auto",
      accountPolicy: HELIX_DEVELOPER_ACCOUNT_POLICY,
      promptText:
        "If a scholarly lookup succeeds but the final answer says observation_not_reentered, what should the agent do before answering?",
      routeClassification: { route: "scholarly_research_lookup" },
      failureState: { rail_failure_code: "observation_not_reentered", repair_target: "reentry_gate" },
    });

    expect(policy.resolved_profile).toBe("deep");
    expect(policy.reasoning_effort).toBe("high");
    expect(policy.policy_signals).toContain("evidence_reentry_failure");
  });

  it("preserves user-pinned profiles even when Auto would escalate", () => {
    const policy = resolveHelixLanguageModelPolicy({
      requestedProfile: "balanced",
      accountPolicy: HELIX_DEVELOPER_ACCOUNT_POLICY,
      promptText:
        "This debug export says observation_not_reentered and terminal_authority_missing. Diagnose the architecture failure.",
    });

    expect(policy.requested_profile).toBe("balanced");
    expect(policy.resolved_profile).toBe("balanced");
    expect(policy.auto_selected_profile).toBeNull();
    expect(policy.persistence_scope).toBe("session");
    expect(policy.selection_source).toBe("user_selected");
  });

  it("uses persisted user selection when no new request is provided", () => {
    const policy = resolveHelixLanguageModelPolicy({
      persistedProfile: "fast",
      accountPolicy: HELIX_USER_ACCOUNT_POLICY,
      promptText: "What is the current status?",
    });

    expect(policy.requested_profile).toBe("fast");
    expect(policy.resolved_profile).toBe("fast");
    expect(policy.persistence_scope).toBe("session");
  });

  it("downgrades by availability and budget without admitting tools", () => {
    const policy = resolveHelixLanguageModelPolicy({
      requestedProfile: "deep",
      accountPolicy: {
        ...HELIX_USER_ACCOUNT_POLICY,
        quotas: {
          ...HELIX_USER_ACCOUNT_POLICY.quotas,
          model_tokens_per_turn: 4_000,
        },
      },
      modelAccess: { deep: false },
      promptText: "Perform deep reasoning.",
    });

    expect(policy.selection_source).toBe("policy_downgrade");
    expect(policy.resolved_profile).toBe("fast");
    expect(policy.downgrade_reason).toBe("requested_profile_unavailable");
    expect(policy.budget_limits.effective_max_tokens_per_turn).toBeLessThanOrEqual(4_000);
    expect(policy).not.toHaveProperty("admitted_tool_families");
    expect(policy).not.toHaveProperty("admitted_capabilities");
  });
});
