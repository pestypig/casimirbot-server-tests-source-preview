import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nativeBridgeMock = vi.hoisted(() => ({
  run: vi.fn(),
}));

vi.mock("../codex-native/provider-bridge", () => ({
  resolveCodexNativeProviderBridgeAvailability: () => ({
    enabled: true,
    available: true,
    unavailableReason: null,
  }),
  runCodexNativeProviderBridge: nativeBridgeMock.run,
}));

import {
  applyWorkstationContextAuthorityGuard,
  buildCodexModelVisibleObservationArtifacts,
  buildCodexNormalizedObservationArtifacts,
  codexProvider,
  hasBoundedScholarlyFollowupSourceEvidence,
  isSuccessfulImageLensObservationPacket,
  runCodexProcess,
  shouldAttemptCodexCompatibilityGatewayRecovery,
} from "../codex-provider";
import { callWorkstationGatewayCapability } from "../../workstation-tool-gateway/registry";

describe("Codex native compatibility fallback", () => {
  beforeEach(() => {
    nativeBridgeMock.run.mockReset();
    nativeBridgeMock.run.mockResolvedValue({
      attempted: true,
      eligible: true,
      fallbackRequired: true,
      fallbackReason: "native_app_server_error",
      result: null,
      gatewayCallResults: [],
      debug: {
        schema: "helix.codex_native_provider_bridge.v1",
        enabled: true,
        eligible: true,
        attempted: true,
        status: "fallback_required",
        native_transport: "codex_app_server",
        compatibility_transport: "codex_exec",
        fallback_required: true,
        fallback_reason: "native_app_server_error",
        model_policy_source: "codex_default",
        effective_model: null,
        effective_reasoning_effort: null,
        trusted_goal_account_binding_required: false,
        allowed_workstation_tools: null,
        native_workstation_turn: null,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "The compatibility worker received the current workspace status observation.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
  });

  afterEach(() => {
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    delete process.env.CODEX_AGENT_FAKE_STDERR;
    delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;
    delete process.env.HELIX_CODEX_COMPATIBILITY_PROCESS_TEST_ENABLED;
  });

  it("does not launch a live compatibility process from deterministic tests", async () => {
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    delete process.env.CODEX_AGENT_FAKE_EXIT_CODE;

    await expect(runCodexProcess({ prompt: "Do not contact a provider." })).resolves.toMatchObject({
      exitCode: null,
      timedOut: false,
      killed: false,
      failReason: "codex_process_disabled_in_test",
      bin: null,
    });
  });

  it("does not launch a compatibility process for an already-aborted turn", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      runCodexProcess({
        prompt: "Do not launch after this turn has ended.",
        signal: controller.signal,
      }),
    ).resolves.toMatchObject({
      exitCode: null,
      timedOut: false,
      killed: false,
      failReason: "codex_process_aborted",
      bin: null,
    });
  });

  it("does not substitute a planner-derived action for a runtime-authored schema failure", () => {
    expect(
      shouldAttemptCodexCompatibilityGatewayRecovery({
        nativeProviderBridgeAttempted: true,
        nativeTurnEligibleForTerminal: false,
        nativeGatewayCallResults: [{ ok: false }],
        nativeUnobservedCapabilityIds: [],
        nativeRouteViolationCapabilityIds: [],
        compatibilityGatewayRecoveryAvailable: true,
      }),
    ).toBe(false);
  });

  it("retains compatibility recovery for a transport failure with no runtime-authored action", () => {
    expect(
      shouldAttemptCodexCompatibilityGatewayRecovery({
        nativeProviderBridgeAttempted: true,
        nativeTurnEligibleForTerminal: false,
        nativeGatewayCallResults: [],
        nativeUnobservedCapabilityIds: [],
        nativeRouteViolationCapabilityIds: [],
        compatibilityGatewayRecoveryAvailable: true,
      }),
    ).toBe(true);
  });

  it("keeps workspace status fields visible while bounding the model prompt", () => {
    const [artifact] = buildCodexModelVisibleObservationArtifacts([{
      schema: "helix.current_turn_artifact.v1",
      artifact_id: "ask:test:workspace-status",
      kind: "workspace_os_status_observation",
      status: "succeeded",
      capability_key: "workspace_os.status",
      text_preview: "Workspace OS status returned 34 capability records.",
      payload: {
        schema: "helix.workspace_os_status_observation.v1",
        capability_count: 34,
        summary: {
          available_count: 19,
          blocked_count: 3,
        },
        runtime: {
          memory_pressure: "normal",
          active_task_count: 1,
        },
        noteworthy_capabilities: Array.from({ length: 20 }, (_, index) => ({
          capability_id: `capability.${index}`,
          status: index === 0 ? "available" : "unknown",
          authority: {
            terminal_eligible: false,
          },
        })),
        authority: {
          terminal_eligible: false,
        },
      },
    }]);

    expect(artifact).toMatchObject({
      kind: "workspace_os_status_observation",
      status: "succeeded",
      payload: {
        capability_count: 34,
        summary: {
          available_count: 19,
          blocked_count: 3,
        },
        runtime: {
          memory_pressure: "normal",
          active_task_count: 1,
        },
      },
    });
    expect((artifact.payload as Record<string, unknown>).noteworthy_capabilities).toHaveLength(12);
    expect(JSON.stringify(artifact)).not.toContain("terminal_eligible");
  });

  it("bounds repeated conformed-document evidence before post-tool reasoning", () => {
    const repeatedLedger = "Stage-4 ledger evidence. ".repeat(2_000);
    const artifacts = buildCodexModelVisibleObservationArtifacts([
      {
        schema: "helix.current_turn_artifact.v1",
        artifact_id: "ask:test:docs-search",
        kind: "doc_search_results",
        status: "succeeded",
        capability_key: "docs.search",
        provider_gateway_observation_ref: "ask:test:docs-search:observation",
        payload: {
          schema: "helix.docs_search_results.v1",
          kind: "doc_search_results",
          query: "response functions noncomputable",
          paths: ["docs/research/conformed-study.md"],
          hits: Array.from({ length: 30 }, (_, index) => ({
            path: "docs/research/conformed-study.md",
            term: "response",
            occurrence_index: index,
            line: 400 + index,
            heading: "Reproducibility and status ledger",
            sentence: repeatedLedger,
          })),
          matches: Array.from({ length: 20 }, (_, index) => ({
            path: "docs/research/conformed-study.md",
            score: 100 - index,
            canonical: true,
            best_snippets: [{ sentence: repeatedLedger }],
          })),
          document_candidates: Array.from({ length: 20 }, (_, index) => ({
            path: "docs/research/conformed-study.md",
            score: 100 - index,
            canonical: true,
            retrieval_status: "primary",
            retrieval_admission_reason: "default_primary",
            topic_id: "conformed-study",
            authority_rank: 100,
            best_snippets: [{ sentence: repeatedLedger }],
          })),
          retrieval_policy: {
            schema: "helix.docs_retrieval_policy.v1",
            requested_scope: "default",
            effective_scope: "default",
            admitted_document_count: 1,
            suppressed_document_count: 1,
            suppressed_candidates: [{
              path: "docs/legacy-development/conformed-study-draft.md",
              retrieval_status: "archive",
              reason: "archive_not_requested",
              topic_id: "conformed-study",
              superseded_by: "docs/research/conformed-study.md",
            }],
            suppression_truncated: false,
            policy_role: "source_admission_not_answer_authority",
          },
          section_observations: Array.from({ length: 20 }, () => ({
            path: "docs/research/conformed-study.md",
            heading: "Model registration",
            section_excerpt: repeatedLedger,
          })),
          capability_key: "docs.search",
          source_capability_id: "docs.search",
          provider_gateway_observation_ref: "ask:test:docs-search:observation",
          observation_role: "evidence_not_assistant_answer",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
      {
        schema: "helix.current_turn_artifact.v1",
        artifact_id: "ask:test:retrieval-context",
        kind: "retrieval_context",
        status: "succeeded",
        capability_key: "docs.search",
        payload: {
          schema: "helix.retrieval_context.v1",
          kind: "retrieval_context",
          path: "docs/research/conformed-study.md",
          excerpt: repeatedLedger,
          excerpt_char_count: repeatedLedger.length,
          capability_key: "docs.search",
          source_capability_id: "docs.search",
          provider_gateway_observation_ref: "ask:test:docs-search:observation",
          observation_role: "evidence_not_assistant_answer",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    ]);
    const serialized = JSON.stringify(artifacts);

    expect(serialized.length).toBeLessThan(150_000);
    expect(serialized).toContain("docs/research/conformed-study.md");
    expect(serialized).toContain("response functions noncomputable");
    expect(serialized).toContain("model-visible document text truncated");
    expect(
      (artifacts[0].payload as Record<string, any>).hits,
    ).toHaveLength(12);
    expect(
      (artifacts[0].payload as Record<string, any>).document_candidates,
    ).toHaveLength(8);
    expect(
      (artifacts[0].payload as Record<string, any>).document_candidates[0],
    ).toMatchObject({
      retrieval_status: "primary",
      retrieval_admission_reason: "default_primary",
      topic_id: "conformed-study",
      authority_rank: 100,
    });
    expect(
      (artifacts[0].payload as Record<string, any>).retrieval_policy,
    ).toMatchObject({
      requested_scope: "default",
      suppressed_document_count: 1,
      suppressed_candidates: [{
        path: "docs/legacy-development/conformed-study-draft.md",
        retrieval_status: "archive",
        reason: "archive_not_requested",
        superseded_by: "docs/research/conformed-study.md",
      }],
    });
    expect(artifacts[0]).toMatchObject({
      artifact_id: "ask:test:docs-search",
      capability_key: "docs.search",
      provider_gateway_observation_ref: "ask:test:docs-search:observation",
    });
  });

  it("preserves goal-relevant mechanics command context through gateway normalization and model compaction", async () => {
    const gatewayResult = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: "docs.search",
      arguments: {
        query:
          "Before building an exact wall, how do I capture only its exact rollback footprint?",
        mechanics_collection_ids: ["mechanics.minecraft.commands.v1"],
        adapter_profile_id: "game.minecraft.readonly.v1",
        max_hits: 6,
      },
      turnId: "ask:test:model-visible-exact-checkpoint",
      iteration: 1,
    });
    const normalized = buildCodexNormalizedObservationArtifacts({
      turnId: "ask:test:model-visible-exact-checkpoint",
      gatewayCallResults: [gatewayResult],
    });
    const modelVisible = buildCodexModelVisibleObservationArtifacts(
      normalized.artifacts,
    );
    const docsArtifact = modelVisible.find(
      (artifact) => artifact.kind === "doc_search_results",
    );
    const payload = docsArtifact?.payload as Record<string, unknown>;
    const serialized = JSON.stringify(payload);

    expect(gatewayResult.ok).toBe(true);
    expect(normalized.missingNormalizationFailures).toEqual([]);
    expect(serialized).toContain("helixgame checkpoint capture_box agency_build");
    expect(payload).toMatchObject({
      assistant_answer: false,
      terminal_eligible: false,
      evidence_passages: expect.arrayContaining([
        expect.objectContaining({
          path: "docs/game-mechanics/minecraft-command-playbook-v1.md",
          text_excerpt: expect.stringContaining(
            "helixgame checkpoint capture_box agency_build",
          ),
          citation_ref: expect.stringContaining(
            "workspace://docs/game-mechanics/minecraft-command-playbook-v1.md#line=",
          ),
        }),
      ]),
    });
  });

  it("distinguishes materialized Image Lens evidence from a missing-input packet", () => {
    const missingInputPacket = {
      capability_key: "visual_analysis.inspect_image_region",
      status: "missing_input",
      produced_artifact_refs: ["ask:test:image-lens:missing-input"],
    } as any;
    const succeededPacket = {
      capability_key: "visual_analysis.inspect_image_region",
      status: "succeeded",
      produced_artifact_refs: ["ask:test:image-lens:page-2"],
    } as any;

    expect(isSuccessfulImageLensObservationPacket(missingInputPacket)).toBe(false);
    expect(isSuccessfulImageLensObservationPacket(succeededPacket)).toBe(true);
    expect(hasBoundedScholarlyFollowupSourceEvidence({
      gatewayCallResults: [],
      capabilityLaneObservationPackets: [missingInputPacket],
    })).toBe(false);
    expect(hasBoundedScholarlyFollowupSourceEvidence({
      gatewayCallResults: [],
      capabilityLaneObservationPackets: [succeededPacket],
    })).toBe(true);
    expect(hasBoundedScholarlyFollowupSourceEvidence({
      gatewayCallResults: [],
      priorEvidencePacket: {
        capability_key: "scholarly-research.fetch_full_text",
        status: "succeeded",
        produced_artifact_refs: ["ask:test:paper"],
      } as any,
    })).toBe(true);
  });

  it("does not replace a grounded workspace status answer with a panel-context failure", () => {
    const text = "The workstation has 19 available capabilities, 3 blocked, and normal memory pressure.";
    expect(applyWorkstationContextAuthorityGuard({
      question: "What is the current workstation status?",
      text,
      gatewayCallResults: [{
        ok: true,
        capability_id: "workspace_os.status",
      } as never],
    })).toBe(text);
    expect(applyWorkstationContextAuthorityGuard({
      question: "What panels are open in the workspace?",
      text,
      gatewayCallResults: [{
        ok: true,
        capability_id: "workspace_os.status",
      } as never],
    })).toContain("no workstation context observation packet");
  });

  it("restores governed gateway evidence before handing a failed native turn to codex exec", async () => {
    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:native-compatibility-gateway-recovery",
        agent_runtime: "codex",
        question: "Check the workspace OS status and report what is available.",
      },
      headers: {},
    });

    expect(result.ok).toBe(true);
    expect(nativeBridgeMock.run).toHaveBeenCalledTimes(1);
    expect(
      (result.debug as Record<string, any>).workstation_gateway_call_results.map(
        (entry: Record<string, unknown>) => entry.capability_id,
      ),
    ).toEqual(["workspace_os.status"]);
    expect((result.debug as Record<string, any>).codex_native_compatibility_fallback).toMatchObject({
      schema: "helix.codex_native_compatibility_fallback.v1",
      activated: true,
      native_attempted: true,
      native_fallback_reason: "native_app_server_error",
      native_unobserved_capability_ids: [],
      gateway_recovery_attempted: true,
      gateway_recovery_result_count: 1,
      gateway_recovery_capability_ids: ["workspace_os.status"],
      compatibility_transport: "codex_exec",
      terminal_eligible: false,
      assistant_answer: false,
    });
    expect(
      (result as Record<string, any>).provider_prompt_diagnostics,
    ).toMatchObject({
      protected_marker_ids: [],
      raw_prompt_included: false,
    });
    expect(
      (result as Record<string, any>).provider_prompt_diagnostics.char_count,
    ).toBeLessThan(50_000);
  });

  it("gives an unrecovered provider-credit failure exact typed-failure authority", async () => {
    nativeBridgeMock.run.mockResolvedValueOnce({
      attempted: true,
      eligible: true,
      fallbackRequired: true,
      fallbackReason: "native_provider_quota_exhausted",
      result: {
        ok: false,
        answer: "",
        failReason: "native_provider_quota_exhausted",
        native: null,
        gatewayCallResults: [],
        debug: {
          route_proposal: null,
          route_unobserved_tools: [],
          native_error_code: "provider_quota_exhausted",
        },
      },
      gatewayCallResults: [],
      debug: {
        schema: "helix.codex_native_provider_bridge.v1",
        enabled: true,
        eligible: true,
        attempted: true,
        status: "fallback_required",
        native_transport: "codex_app_server",
        compatibility_transport: "codex_exec",
        fallback_required: true,
        fallback_reason: "native_provider_quota_exhausted",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    process.env.CODEX_AGENT_FAKE_STDOUT = "";
    process.env.CODEX_AGENT_FAKE_STDERR =
      "You have no credits remaining. Add credits to continue using the API.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "1";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:native-credit-failure-authority",
        agent_runtime: "codex",
        question: "Give me a brief greeting.",
      },
      headers: {},
    });

    expect(result).toMatchObject({
      ok: false,
      final_answer_source: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      terminal_error_code: "openai_api_credits_exhausted",
      terminal_answer_authority: {
        final_answer_source: "typed_failure",
        terminal_kind: "failure",
        authority_origin: "typed_failure",
        server_authoritative: true,
        terminal_eligible: true,
      },
      terminal_presentation: {
        final_answer_source: "typed_failure",
        presentation_policy: "agent_provider_failure_recovery",
      },
    });
  });

  it("recovers admitted observations missing from a partially completed native compound route", async () => {
    const turnId = "ask:test:native-partial-compound-recovery";
    const partialStatusResult = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: "workspace_os.status",
      arguments: {},
      turnId,
      iteration: 1,
      accountType: "user",
    });
    expect(partialStatusResult.ok).toBe(true);
    nativeBridgeMock.run.mockResolvedValueOnce({
      attempted: true,
      eligible: true,
      fallbackRequired: true,
      fallbackReason: "native_route_observation_missing",
      result: {
        ok: false,
        answer: "",
        failReason: "native_route_observation_missing",
        native: null,
        gatewayCallResults: [partialStatusResult],
        debug: {
          route_proposal: null,
          route_unobserved_tools: ["scientific-calculator.solve_expression"],
        },
      },
      gatewayCallResults: [partialStatusResult],
      debug: {
        schema: "helix.codex_native_provider_bridge.v1",
        enabled: true,
        eligible: true,
        attempted: true,
        status: "fallback_required",
        native_transport: "codex_app_server",
        compatibility_transport: "codex_exec",
        fallback_required: true,
        fallback_reason: "native_route_observation_missing",
        model_policy_source: "codex_default",
        effective_model: null,
        effective_reasoning_effort: null,
        trusted_goal_account_binding_required: false,
        allowed_workstation_tools: [
          "workspace_os.status",
          "scientific-calculator.solve_expression",
        ],
        native_workstation_turn: null,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: turnId,
        agent_runtime: "codex",
        question: "Check workspace status and calculate 8*9 from both observations.",
        workstation_gateway_calls: [
          {
            capability_id: "workspace_os.status",
            mode: "read",
            arguments: {},
          },
          {
            capability_id: "scientific-calculator.solve_expression",
            mode: "read",
            arguments: { expression: "8*9" },
          },
        ],
      },
      headers: {},
    });

    expect(result.ok).toBe(true);
    const debug = result.debug as Record<string, any>;
    expect(debug.workstation_gateway_call_results.map(
      (entry: Record<string, unknown>) => entry.capability_id,
    )).toEqual(expect.arrayContaining([
      "workspace_os.status",
      "scientific-calculator.solve_expression",
    ]));
    expect(debug.codex_native_compatibility_fallback).toMatchObject({
      activated: true,
      native_fallback_reason: "native_route_observation_missing",
      native_unobserved_capability_ids: ["scientific-calculator.solve_expression"],
      gateway_recovery_attempted: true,
      gateway_recovery_capability_ids: [
        "workspace_os.status",
        "scientific-calculator.solve_expression",
      ],
    });
  });

  it("recovers a governed observation when the native process succeeds without executing the hard route", async () => {
    nativeBridgeMock.run.mockResolvedValueOnce({
      attempted: true,
      eligible: true,
      fallbackRequired: false,
      fallbackReason: null,
      result: {
        ok: true,
        answer: "The local document is probably the terminal authority contract.",
        failReason: null,
        native: null,
        gatewayCallResults: [],
        debug: {
          route_proposal: null,
          route_unobserved_tools: [],
        },
      },
      gatewayCallResults: [],
      debug: {
        schema: "helix.codex_native_provider_bridge.v1",
        enabled: true,
        eligible: true,
        attempted: true,
        status: "completed",
        native_transport: "codex_app_server",
        compatibility_transport: "codex_exec",
        fallback_required: false,
        fallback_reason: null,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:native-success-missing-doc-observation",
        agent_runtime: "codex",
        question: "Find the local document about Helix Ask terminal authority and tell me which document you used.",
      },
      headers: {},
    });

    expect(result.ok).toBe(true);
    const debug = result.debug as Record<string, any>;
    expect(debug.workstation_gateway_call_results.map(
      (entry: Record<string, unknown>) => entry.capability_id,
    )).toEqual(["docs.search"]);
    expect(debug.codex_native_compatibility_fallback).toMatchObject({
      activated: true,
      native_attempted: true,
      planned_gateway_recovery_capability_ids: ["docs.search"],
      gateway_recovery_attempted: true,
      gateway_recovery_result_count: 1,
      gateway_recovery_capability_ids: ["docs.search"],
    });
    expect(result.text).toBe(process.env.CODEX_AGENT_FAKE_STDOUT);
  });

  it("quarantines a native observation outside the committed source route and recovers the admitted tool", async () => {
    const turnId = "ask:test:native-route-violation-recovery";
    const repoResult = await callWorkstationGatewayCapability({
      agentRuntime: "codex",
      mode: "read",
      capabilityId: "repo.search",
      arguments: { query: "Helix Ask terminal authority" },
      turnId,
      iteration: 1,
      accountType: "user",
    });
    expect(repoResult.ok).toBe(true);
    nativeBridgeMock.run.mockResolvedValueOnce({
      attempted: true,
      eligible: true,
      fallbackRequired: false,
      fallbackReason: null,
      result: {
        ok: true,
        answer: "I used repository search.",
        failReason: null,
        native: null,
        gatewayCallResults: [repoResult],
        debug: {
          route_proposal: null,
          route_unobserved_tools: [],
        },
      },
      gatewayCallResults: [repoResult],
      debug: {
        schema: "helix.codex_native_provider_bridge.v1",
        enabled: true,
        eligible: true,
        attempted: true,
        status: "completed",
        native_transport: "codex_app_server",
        compatibility_transport: "codex_exec",
        fallback_required: false,
        fallback_reason: null,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: turnId,
        agent_runtime: "codex",
        question: "Find the local document about Helix Ask terminal authority and tell me which document you used.",
      },
      headers: {},
    });

    expect(result.ok).toBe(true);
    const debug = result.debug as Record<string, any>;
    expect(debug.workstation_gateway_call_results.map(
      (entry: Record<string, unknown>) => entry.capability_id,
    )).toEqual(["docs.search"]);
    expect(debug.codex_native_compatibility_fallback).toMatchObject({
      activated: true,
      native_fallback_reason: "native_observation_outside_committed_route",
      native_route_violation_capability_ids: ["repo.search"],
      planned_gateway_recovery_capability_ids: ["docs.search"],
      gateway_recovery_attempted: true,
      gateway_recovery_capability_ids: ["docs.search"],
    });
    expect(result.text).toBe(process.env.CODEX_AGENT_FAKE_STDOUT);
  });
});
