import { describe, expect, it } from "vitest";
import {
  HELIX_LANE_BACKEND_SELECTION_POLICY,
  backendProvidersFor,
  buildBackendSelectionDecision,
  hasAnyConfiguredEnvVar,
  readBooleanEnv,
  textBackendConfigured,
  type HelixCapabilityLaneBackendProviderOwnerTemplate,
} from "../backend-provider-config";

const liveTranslationTemplate: HelixCapabilityLaneBackendProviderOwnerTemplate = {
  lane_id: "live_translation",
  backend_family: "local_runtime",
  label: "Live translation",
  model_or_service_ref: "live_translation_deterministic_v1",
  configured: () => true,
  cost_class: "free_local",
  latency_class: "interactive",
  privacy_class: "local_only",
  backend_provider_templates: [
    {
      provider_id: "live_translation.local_runtime",
      backend_family: "local_runtime",
      label: "Deterministic local translation",
      model_or_service_ref: "live_translation_deterministic_v1",
      required_env_vars: [],
      configured: () => true,
      cost_class: "free_local",
      latency_class: "interactive",
      privacy_class: "local_only",
      fallback_backend_provider: null,
    },
    {
      provider_id: "live_translation.google_gemini",
      backend_family: "google_gemini",
      label: "Gemini translation",
      model_or_service_ref: "gemini_translation_default",
      required_env_vars: ["GOOGLE_GEMINI_API_KEY", "GEMINI_API_KEY"],
      configured: (env) => hasAnyConfiguredEnvVar(env, ["GOOGLE_GEMINI_API_KEY", "GEMINI_API_KEY"]),
      cost_class: "standard",
      latency_class: "realtime",
      privacy_class: "external_provider",
      fallback_backend_provider: "live_translation.local_runtime",
    },
  ],
};

describe("Helix capability lane backend provider config", () => {
  it("keeps backend selection policy provider-neutral and Helix-owned", () => {
    expect(HELIX_LANE_BACKEND_SELECTION_POLICY).toMatchObject({
      schema: "helix.capability_lane.backend_selection_policy.v1",
      owner: "helix",
      runtime_provider_may_request_preference: true,
      selected_runtime_provider_remains_root: true,
      dynamic_switching_enabled: false,
    });
    expect(HELIX_LANE_BACKEND_SELECTION_POLICY.selection_inputs).toContain("configured_keys");
    expect(HELIX_LANE_BACKEND_SELECTION_POLICY.selection_inputs).toContain("terminal_policy");
  });

  it("reads boolean and key configuration without exposing raw secret values", () => {
    expect(readBooleanEnv(undefined, true)).toBe(true);
    expect(readBooleanEnv("off", true)).toBe(false);
    expect(readBooleanEnv("enabled", false)).toBe(true);
    expect(textBackendConfigured({ OPENAI_API_KEY: "secret-openai-key" } as NodeJS.ProcessEnv)).toBe(true);
    expect(textBackendConfigured({ OPENAI_API_KEY: "   " } as NodeJS.ProcessEnv)).toBe(false);

    const providers = backendProvidersFor({
      template: liveTranslationTemplate,
      laneStatus: "dry_run",
      env: { GOOGLE_GEMINI_API_KEY: "secret-gemini-key" } as NodeJS.ProcessEnv,
    });

    expect(providers.find((provider) => provider.provider_id === "live_translation.google_gemini")).toMatchObject({
      configuration_status: "configured",
      configured_env_vars: ["GOOGLE_GEMINI_API_KEY"],
      availability_status: "dry_run",
      permission_status: "admitted",
      raw_secret_exposed: false,
    });
    expect(JSON.stringify(providers)).not.toContain("secret-gemini-key");
  });

  it("marks unconfigured requested backends as fallback decisions without changing the root runtime", () => {
    const providers = backendProvidersFor({
      template: liveTranslationTemplate,
      laneStatus: "dry_run",
      env: {} as NodeJS.ProcessEnv,
    });
    const requestedGemini = providers.find((provider) => provider.provider_id === "live_translation.google_gemini") ?? null;
    const selectedLocal = providers.find((provider) => provider.provider_id === "live_translation.local_runtime") ?? null;
    const decision = buildBackendSelectionDecision({
      admitted: true,
      laneStatusReason: "configured_but_shadow_catalog_only",
      requestedBackendProvider: "live_translation.google_gemini",
      requestedBackend: requestedGemini,
      selectedBackend: selectedLocal,
    });

    expect(requestedGemini).toMatchObject({
      configuration_status: "missing",
      availability_status: "unconfigured",
      permission_status: "configuration_missing",
      fallback_backend_provider: "live_translation.local_runtime",
    });
    expect(decision).toMatchObject({
      outcome: "fallback_selected",
      reason: "requested_backend_unconfigured_default_backend_selected_by_helix_policy",
      requested_backend_provider: "live_translation.google_gemini",
      requested_backend_provider_known: true,
      selected_backend_provider: "live_translation.local_runtime",
      fallback_backend_provider: "live_translation.local_runtime",
      selected_runtime_provider_remains_root: true,
      backend_provider_becomes_root_agent: false,
      dynamic_switching_executed: false,
      live_backend_execution_enabled: false,
      terminal_authority_owner: "helix",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
  });

  it("records unknown backend requests as fallback selections", () => {
    const providers = backendProvidersFor({
      template: liveTranslationTemplate,
      laneStatus: "dry_run",
      env: {} as NodeJS.ProcessEnv,
    });
    const selectedLocal = providers.find((provider) => provider.provider_id === "live_translation.local_runtime") ?? null;
    const decision = buildBackendSelectionDecision({
      admitted: true,
      laneStatusReason: "configured_but_shadow_catalog_only",
      requestedBackendProvider: "live_translation.unknown_provider",
      requestedBackend: null,
      selectedBackend: selectedLocal,
    });

    expect(decision).toMatchObject({
      outcome: "fallback_selected",
      reason: "requested_backend_unknown_default_backend_selected_by_helix_policy",
      requested_backend_provider: "live_translation.unknown_provider",
      requested_backend_provider_known: false,
      selected_backend_provider: "live_translation.local_runtime",
      terminal_authority_owner: "helix",
    });
  });
});
