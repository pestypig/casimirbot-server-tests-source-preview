import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listHelixAgentProviders,
  resolveHelixAgentProvider,
} from "../agent-providers/registry";
import { selectHelixAgentRuntime } from "../agent-providers/runtime-select";
import { buildHelixAgentRuntimeSelectionTrace } from "../agent-providers/runtime-debug";
import {
  applyGatewayFailureAuthorityGuard,
  buildScholarlyResearchResponseModeProjection,
  codexProvider,
  providerGatewayEvidenceReadyForSolver,
  readCodexArgs,
  resetScholarlyPdfWorkbenchVolatileMemoryForTest,
  resolveCodexBinary,
  runCodexProcess,
  runExplicitCodexWorkstationGatewayCalls,
} from "../agent-providers/codex-provider";
import {
  futureProvider,
  runExplicitFutureWorkstationGatewayCalls,
} from "../agent-providers/future-provider";
import {
  buildActiveCalculatorContextWorkstationGatewayCallRequests,
  buildActiveDocsContextWorkstationGatewayCallRequests,
  buildActiveWorkstationContextGatewayCallRequests,
  buildPromptDerivedCalculatorSolveGatewayCallRequests,
  buildPromptDerivedCivilizationBoundsGatewayCallRequests,
  buildPromptDerivedInternetSearchGatewayCallRequests,
  buildPromptDerivedScholarlyResearchGatewayCallRequests,
  buildPromptNamedCapabilityGatewayCallRequests,
  buildStructuredAdmissionWorkstationGatewayCallRequests,
  buildPlannerDerivedWorkstationGatewayCallRequests,
  readWorkstationGatewayCallRequestsForTurn,
  runExplicitWorkstationGatewayCalls,
} from "../agent-providers/explicit-workstation-gateway";
import { buildCompoundCapabilityDependencyGatewayCallRequests } from "../agent-providers/provider-compound-capability-planner";
import { extractScholarlyIntent } from "../scholarly-research-intent";
import { buildHelixProviderReasoningReentry } from "../agent-providers/provider-terminal-authority";
import { buildArtifactQueryIndex } from "../artifact-query-index";
import { refreshToolLifecycleRecords } from "../tool-lifecycle-trace";
import {
  listWorkstationGatewayCapabilities,
  normalizeDocsObservationExcerptText,
} from "../workstation-tool-gateway/registry";
import { resetInterimVoiceCalloutsForTest } from "../interim-voice-callout-store";
import { runtimeMemoryGovernor } from "../../runtime/runtime-memory-governor";

const ENV_KEYS = [
  "HELIX_ASK_AGENT_RUNTIME",
  "ENABLE_CODEX_AGENT",
  "ENABLE_FUTURE_AGENT",
  "CODEX_BIN",
  "CODEX_ARGS",
  "CODEX_AGENT_TIMEOUT_MS",
  "CODEX_APPX_INSTALL_LOCATION",
  "CODEX_DISABLE_LOCAL_PACKAGE_BIN",
  "CODEX_WINDOWS_APPS_DIR",
  "PATH",
  "Path",
  "PATHEXT",
  "CODEX_AGENT_FAKE_STDOUT",
  "CODEX_AGENT_FAKE_STDOUT_SEQUENCE",
  "CODEX_AGENT_FAKE_CALL_INDEX",
  "CODEX_AGENT_FAKE_NATIVE_EVENT_JSONL",
  "CODEX_AGENT_FAKE_STDERR",
  "CODEX_AGENT_FAKE_EXIT_CODE",
  "HELIX_IMAGE_LENS_EXTRACTION_FIXTURES",
  "HELIX_IMAGE_LENS_EXTRACTION_BACKEND",
  "PDFTOPPM_BIN",
  "TAVILY_API_KEY",
  "HELIX_SCHOLARLY_PDF_WORKBENCH_MEMORY_DIR",
] as const;
const originalEnv = new Map<string, string | undefined>();
const originalFetch = globalThis.fetch;
let scholarlyWorkbenchTestMemoryDir: string | null = null;

for (const key of ENV_KEYS) {
  originalEnv.set(key, process.env[key]);
}

beforeEach(() => {
  scholarlyWorkbenchTestMemoryDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "helix-agent-provider-workbench-test-"),
  );
  process.env.HELIX_SCHOLARLY_PDF_WORKBENCH_MEMORY_DIR =
    scholarlyWorkbenchTestMemoryDir;
});

afterEach(() => {
  if (scholarlyWorkbenchTestMemoryDir) {
    fs.rmSync(scholarlyWorkbenchTestMemoryDir, {
      recursive: true,
      force: true,
    });
    scholarlyWorkbenchTestMemoryDir = null;
  }
  for (const key of ENV_KEYS) {
    const original = originalEnv.get(key);
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("Helix Ask agent provider selection", () => {
  it("does not fail terminal text for a superseded calculator solve extraction failure", () => {
    const guarded = applyGatewayFailureAuthorityGuard({
      text: "Observed expression: 8*9\nResult: 72",
      gatewayCallResults: [
        {
          ok: false,
          capability_id: "scientific-calculator.solve_expression",
          gateway_admission: {
            requested_capability: "scientific-calculator.solve_expression",
            blocked_reason: "expression_evaluation_failed",
          },
          error: "expression_evaluation_failed",
        },
        {
          ok: true,
          capability_id: "scientific-calculator.solve_expression",
          gateway_admission: {
            requested_capability: "scientific-calculator.solve_expression",
            admission_reason: "admitted",
          },
          observation: {
            expression: "8*9",
            result: "72",
          },
          observation_packet: {
            observation_summary: "8*9 = 72",
          },
        },
      ] as any,
    });

    expect(guarded).toBe("Observed expression: 8*9\nResult: 72");
  });

  it("keeps unsuperseded failed gateway requests as terminal failures", () => {
    const guarded = applyGatewayFailureAuthorityGuard({
      text: "Repo answer draft",
      gatewayCallResults: [
        {
          ok: false,
          capability_id: "repo.search",
          gateway_admission: {
            requested_capability: "repo.search",
            blocked_reason: "missing_query",
          },
          error: "missing_query",
        },
      ] as any,
    });

    expect(guarded).toContain(
      "I cannot claim the requested workstation tool or UI action ran",
    );
    expect(guarded).toContain(
      "Blocked or failed gateway request: repo.search: missing_query.",
    );
  });

  it("lets a successful environment retry supersede its retryable schema failure", () => {
    const failedSpatial = {
      ok: false,
      capability_id: "com.casimirbot.minecraft.spatial_region.inspect",
      gateway_admission: {
        requested_capability: "com.casimirbot.minecraft.spatial_region.inspect",
        blocked_reason: "schema_validation_failed",
      },
      error: "schema_validation_failed",
      observation_packet: {
        status: "failed",
        observation_summary:
          "The probe arguments failed the trusted schema at $.intent.",
      },
      tool_lifecycle_trace: {
        retry_recommendation: "retry_same_tool",
      },
      tool_followup_decision: {
        next_action: "retry",
      },
    };
    const successfulSpatial = {
      ok: true,
      capability_id: "com.casimirbot.minecraft.spatial_region.inspect",
      gateway_admission: {
        requested_capability: "com.casimirbot.minecraft.spatial_region.inspect",
        admission_reason: "admitted",
      },
      observation_packet: {
        status: "succeeded",
        observation_summary:
          "Bounded spatial-region read-only probe completed.",
      },
    };
    const gatewayCallResults = [failedSpatial, successfulSpatial] as any;

    expect(
      applyGatewayFailureAuthorityGuard({
        text: "The repaired probe found a safe west-side edge.",
        gatewayCallResults,
      }),
    ).toBe("The repaired probe found a safe west-side edge.");
    expect(
      providerGatewayEvidenceReadyForSolver({
        gatewayCallResults,
        scholarlyRecoveryObservationReentered: false,
      }),
    ).toBe(true);
  });

  it("preserves Codex synthesis after a same-turn wrong-environment action is corrected", () => {
    const turnId = "ask:wrong-environment-corrected";
    const capability = "com.casimirbot.minecraft.player.walk";
    const failedWalk = {
      ok: false,
      capability_id: capability,
      mode: "act",
      gateway_admission: {
        requested_capability: capability,
        admission_status: "blocked",
        blocked_reason: "wrong_environment",
      },
      error: "wrong_environment",
      observation_packet: {
        turn_id: turnId,
        call_id: `${turnId}:walk:failed`,
        capability_key: capability,
        status: "failed",
        produced_artifact_refs: [],
        observation_summary: "The requested player environment did not match.",
      },
      tool_followup_decision: { next_action: "ask_user" },
    };
    const successfulWalk = {
      ok: true,
      capability_id: capability,
      mode: "act",
      gateway_admission: {
        requested_capability: capability,
        admission_status: "admitted",
        admission_reason: "environment_action_requested",
      },
      observation_packet: {
        turn_id: turnId,
        call_id: `${turnId}:walk:succeeded`,
        capability_key: capability,
        status: "succeeded",
        produced_artifact_refs: [`${turnId}:walk:observation`],
        observation_summary:
          "The bounded walk completed with 0.289 blocks of measured motion.",
      },
      observation: { status: "succeeded", distance_blocks: 0.289 },
      artifact_refs: [`${turnId}:walk:observation`],
      error: null,
    };
    const answer =
      "The corrected walk completed with 0.289 blocks of measured motion.";

    expect(
      applyGatewayFailureAuthorityGuard({
        text: answer,
        gatewayCallResults: [failedWalk, successfulWalk] as any,
      }),
    ).toBe(answer);
    expect(
      providerGatewayEvidenceReadyForSolver({
        gatewayCallResults: [failedWalk, successfulWalk] as any,
        scholarlyRecoveryObservationReentered: false,
      }),
    ).toBe(true);
  });

  it("retires a repaired schema failure when the successful packet reports completed", () => {
    const guarded = applyGatewayFailureAuthorityGuard({
      text: "The corrected local map observation is available.",
      gatewayCallResults: [
        {
          ok: false,
          capability_id: "com.casimirbot.minecraft.local_map.inspect",
          gateway_admission: {
            requested_capability: "com.casimirbot.minecraft.local_map.inspect",
            blocked_reason: "schema_validation_failed",
          },
          error: "schema_validation_failed",
          observation_packet: {
            status: "failed",
            observation_summary:
              "The probe arguments failed the trusted schema.",
          },
        },
        {
          ok: true,
          capability_id: "com.casimirbot.minecraft.local_map.inspect",
          gateway_admission: {
            requested_capability: "com.casimirbot.minecraft.local_map.inspect",
            admission_reason: "admitted",
          },
          observation_packet: {
            status: "completed",
            observation_summary: "The repaired local map probe completed.",
          },
        },
      ] as any,
    });

    expect(guarded).toBe("The corrected local map observation is available.");
  });

  it("does not terminalize a schema error that a later observation repaired", () => {
    const summary =
      "The probe arguments failed the trusted schema at $.center.";
    const guarded = applyGatewayFailureAuthorityGuard({
      text: summary,
      gatewayCallResults: [
        {
          ok: false,
          capability_id: "com.casimirbot.minecraft.spatial_region.inspect",
          gateway_admission: {
            requested_capability:
              "com.casimirbot.minecraft.spatial_region.inspect",
            blocked_reason: "schema_validation_failed",
          },
          error: "schema_validation_failed",
          observation_packet: {
            status: "failed",
            observation_summary: summary,
          },
        },
        {
          ok: true,
          capability_id: "com.casimirbot.minecraft.spatial_region.inspect",
          gateway_admission: {
            requested_capability:
              "com.casimirbot.minecraft.spatial_region.inspect",
            admission_reason: "admitted",
          },
          observation_packet: {
            status: "succeeded",
            observation_summary: "Bounded spatial-region probe completed.",
          },
        },
      ] as any,
    });

    expect(guarded).not.toContain("$.center");
    expect(guarded).toContain("later observation succeeded");
    expect(guarded).toContain("remaining bounded action and verification");
  });

  it("does not supersede a non-retryable environment failure with an unrelated later success", () => {
    const guarded = applyGatewayFailureAuthorityGuard({
      text: "Environment answer draft",
      gatewayCallResults: [
        {
          ok: false,
          capability_id: "com.casimirbot.minecraft.spatial_region.inspect",
          gateway_admission: {
            requested_capability:
              "com.casimirbot.minecraft.spatial_region.inspect",
            blocked_reason: "permission_revoked",
          },
          error: "permission_revoked",
          observation_packet: {
            status: "blocked",
            observation_summary: "Permission revoked.",
          },
          tool_lifecycle_trace: {
            retry_recommendation: "ask_user",
          },
          tool_followup_decision: {
            next_action: "ask_user",
          },
        },
        {
          ok: true,
          capability_id: "com.casimirbot.minecraft.spatial_region.inspect",
          gateway_admission: {
            requested_capability:
              "com.casimirbot.minecraft.spatial_region.inspect",
            admission_reason: "admitted",
          },
          observation_packet: {
            status: "succeeded",
            observation_summary:
              "Bounded spatial-region read-only probe completed.",
          },
        },
      ] as any,
    });

    expect(guarded).toContain(
      "Blocked or failed gateway request: com.casimirbot.minecraft.spatial_region.inspect: permission_revoked.",
    );
  });

  it("explains fail-closed scholarly numeric extraction instead of claiming the tool did not run", () => {
    const guarded = applyGatewayFailureAuthorityGuard({
      text: "All requested tools ran.",
      gatewayCallResults: [
        {
          ok: true,
          capability_id: "scholarly-research.lookup_papers",
          gateway_admission: {
            requested_capability: "scholarly-research.lookup_papers",
            admission_reason: "admitted",
          },
          observation: {
            schema: "helix.scholarly_research_observation.v1",
            evidence_state: "lookup_usable",
            selected_for_answer: true,
          },
        },
        {
          ok: true,
          capability_id: "scholarly-research.fetch_full_text",
          gateway_admission: {
            requested_capability: "scholarly-research.fetch_full_text",
            admission_reason: "admitted",
          },
          observation: {
            schema: "helix.scholarly_full_text_observation.v1",
            evidence_state: "full_text_usable",
            selected_for_answer: true,
          },
        },
        {
          ok: false,
          capability_id: "scholarly-research.extract_numeric_parameters",
          error: "missing_requested_numeric_variables",
          gateway_admission: {
            requested_capability:
              "scholarly-research.extract_numeric_parameters",
            admission_reason: "admitted",
          },
          observation: {
            schema: "helix.scholarly_numeric_parameter_observation.v1",
            paper: {
              title: "Tokamak shape-control paper",
              url: "https://example.test/tokamak-control",
            },
            requested_variables: ["n_m3", "T_eV", "B_T"],
            parameters: [],
            missing_variables: ["n_m3", "T_eV", "B_T"],
            rejected_candidates: [
              { variable: "T_eV", reason: "missing_unit", text: "T = 4" },
            ],
            missing_requirements: ["missing_requested_numeric_variables"],
            selected_for_answer: false,
          },
        },
      ] as any,
    });

    expect(guarded).not.toContain(
      "I cannot claim the requested workstation tool or UI action ran",
    );
    expect(guarded).toContain("I found and fetched scholarly paper evidence");
    expect(guarded).toContain("Fetched paper: Tokamak shape-control paper");
    expect(guarded).toContain("Requested variables: n_m3, T_eV, B_T.");
    expect(guarded).toContain("Missing variables: n_m3, T_eV, B_T.");
    expect(guarded).toContain("Rejected candidates: T_eV: missing_unit.");
    expect(guarded).toContain(
      "without fabricating values or claiming a calculator result",
    );
  });

  it("defaults to the Codex runtime", () => {
    delete process.env.HELIX_ASK_AGENT_RUNTIME;

    expect(selectHelixAgentRuntime({ body: {} })).toBe("codex");
    expect(resolveHelixAgentProvider({ body: {} }).id).toBe("codex");
  });

  it("prefers body runtime over header and env runtime", () => {
    process.env.HELIX_ASK_AGENT_RUNTIME = "helix";

    expect(
      selectHelixAgentRuntime({
        body: { agent_runtime: "codex" },
        headers: { "x-helix-agent-runtime": "helix" },
      }),
    ).toBe("codex");
  });

  it("uses the runtime header when the body does not select one", () => {
    expect(
      selectHelixAgentRuntime({
        body: {},
        headers: { "x-helix-agent-runtime": "codex" },
      }),
    ).toBe("codex");
  });

  it("falls back to Codex for unknown runtimes", () => {
    process.env.HELIX_ASK_AGENT_RUNTIME = "future-runtime";

    expect(
      selectHelixAgentRuntime({ body: { agent_runtime: "unknown" } }),
    ).toBe("codex");
    expect(
      resolveHelixAgentProvider({ body: { agent_runtime: "unknown" } }).id,
    ).toBe("codex");
  });

  it("preserves an explicit Codex selection when Codex is disabled", () => {
    process.env.ENABLE_CODEX_AGENT = "0";

    expect(
      resolveHelixAgentProvider({ body: { agent_runtime: "codex" } }).id,
    ).toBe("codex");
  });

  it("preserves an explicit future-provider selection when it is disabled", () => {
    delete process.env.ENABLE_FUTURE_AGENT;

    expect(selectHelixAgentRuntime({ body: { agent_runtime: "future" } })).toBe(
      "future",
    );
    expect(
      resolveHelixAgentProvider({ body: { agent_runtime: "future" } }).id,
    ).toBe("future");
  });

  it("selects Codex when requested by default", () => {
    delete process.env.ENABLE_CODEX_AGENT;

    const provider = resolveHelixAgentProvider({
      body: { agentRuntime: "codex" },
    });

    expect(provider.id).toBe("codex");
    expect(provider.supports).toEqual({
      streaming: true,
      workstationTools: true,
      capabilityLanes: true,
      capabilityLaneOneShot: true,
      capabilityLaneSessions: true,
      codeMutation: false,
    });
    expect(provider.permissionProfile).toMatchObject({
      id: "read-observe-act",
      allows: {
        observe: true,
        read: true,
        act: true,
        write: false,
        shell: false,
        codeMutation: false,
      },
    });
  });

  it("uses safe non-interactive read-only Codex CLI args by default", () => {
    delete process.env.CODEX_ARGS;

    expect(readCodexArgs()).toEqual([
      "exec",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--color",
      "never",
    ]);
  });

  it("allows Codex CLI args to be overridden from env", () => {
    process.env.CODEX_ARGS = "exec --json --sandbox read-only";

    expect(readCodexArgs()).toEqual([
      "exec",
      "--json",
      "--sandbox",
      "read-only",
    ]);
  });

  it("uses CODEX_BIN when it points to a launchable binary", () => {
    process.env.CODEX_BIN = process.execPath;

    expect(resolveCodexBinary()).toMatchObject({
      launchable: true,
      reason: null,
      resolved_bin: process.execPath,
    });
  });

  it("prefers the repo-local npm Codex package before PATH aliases", () => {
    delete process.env.CODEX_BIN;
    delete process.env.CODEX_DISABLE_LOCAL_PACKAGE_BIN;
    process.env.PATH = "";
    process.env.Path = "";

    const resolved = resolveCodexBinary();

    expect(resolved).toMatchObject({
      launchable: true,
      reason: null,
    });
    expect(resolved.resolved_bin).toContain(
      path.join("node_modules", "@openai", "codex", "bin", "codex.js"),
    );
  });

  it("resolves Codex from PATH when CODEX_BIN is not set", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "helix-codex-path-"));
    const filename = process.platform === "win32" ? "codex.exe" : "codex";
    const candidate = path.join(tempDir, filename);
    fs.copyFileSync(process.execPath, candidate);
    delete process.env.CODEX_BIN;
    process.env.CODEX_DISABLE_LOCAL_PACKAGE_BIN = "1";
    process.env.PATH = tempDir;
    process.env.Path = tempDir;
    process.env.PATHEXT = ".EXE";

    expect(resolveCodexBinary()).toMatchObject({
      launchable: true,
      reason: null,
      resolved_bin: candidate,
    });
  });

  it("resolves Codex from a WindowsApps-style install directory", () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "helix-codex-windowsapps-"),
    );
    const resourcesDir = path.join(
      tempDir,
      "OpenAI.Codex_test",
      "app",
      "resources",
    );
    fs.mkdirSync(resourcesDir, { recursive: true });
    const candidate = path.join(resourcesDir, "codex.exe");
    fs.copyFileSync(process.execPath, candidate);
    delete process.env.CODEX_BIN;
    process.env.CODEX_DISABLE_LOCAL_PACKAGE_BIN = "1";
    process.env.PATH = "";
    process.env.Path = "";
    process.env.CODEX_WINDOWS_APPS_DIR = tempDir;

    expect(resolveCodexBinary()).toMatchObject({
      launchable: true,
      reason: null,
      resolved_bin: candidate,
    });
  });

  it("resolves Codex from a packaged app install location before requiring WindowsApps directory listing", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "helix-codex-appx-"));
    const resourcesDir = path.join(tempDir, "app", "resources");
    fs.mkdirSync(resourcesDir, { recursive: true });
    const candidate = path.join(resourcesDir, "codex.exe");
    fs.copyFileSync(process.execPath, candidate);
    delete process.env.CODEX_BIN;
    process.env.CODEX_DISABLE_LOCAL_PACKAGE_BIN = "1";
    process.env.PATH = "";
    process.env.Path = "";
    process.env.CODEX_WINDOWS_APPS_DIR = path.join(
      tempDir,
      "missing-windowsapps",
    );
    process.env.CODEX_APPX_INSTALL_LOCATION = tempDir;

    expect(resolveCodexBinary()).toMatchObject({
      launchable: true,
      reason: null,
      resolved_bin: candidate,
    });
  });

  it("reports a typed missing-binary status instead of throwing", () => {
    process.env.CODEX_BIN = path.join(
      os.tmpdir(),
      "helix-missing-codex-bin.exe",
    );

    expect(resolveCodexBinary()).toMatchObject({
      launchable: false,
      reason: "codex_binary_not_found",
      resolved_bin: null,
    });
  });

  it("reports a typed non-spawnable binary status instead of treating file existence as launchability", () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "helix-codex-unspawnable-"),
    );
    const candidate = path.join(
      tempDir,
      process.platform === "win32" ? "codex.exe" : "codex",
    );
    fs.writeFileSync(candidate, "not a real executable");
    process.env.CODEX_BIN = candidate;

    expect(resolveCodexBinary()).toMatchObject({
      launchable: false,
      reason: "codex_binary_not_spawnable",
      resolved_bin: candidate,
    });
  });

  it("returns a timeout result instead of hanging when the Codex process does not exit", async () => {
    process.env.CODEX_BIN = process.execPath;
    process.env.CODEX_ARGS = "-e setInterval(()=>{},1000)";
    process.env.CODEX_AGENT_TIMEOUT_MS = "25";

    const startedAt = Date.now();
    const result = await runCodexProcess({ prompt: "check" });

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(result).toMatchObject({
      exitCode: null,
      timedOut: true,
      killed: true,
    });
    expect(result.stderr).toContain("Codex process timed out after 25ms.");
  });

  it("returns Codex missing-binary failures with provider debug metadata", async () => {
    process.env.CODEX_BIN = path.join(
      os.tmpdir(),
      "helix-missing-codex-bin.exe",
    );

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-missing-binary",
        question: "check",
      },
    });

    expect(result).toMatchObject({
      ok: false,
      runtime: "codex",
      response_type: "final_failure",
      final_status: "final_failure",
      answer:
        "Codex runtime is enabled but no launchable Codex CLI binary was found.",
      debug: {
        agent_runtime: "codex",
        fail_reason: "codex_binary_not_found",
        codex_bin: null,
        codex_runtime_status: {
          launchable: false,
          reason: "codex_binary_not_found",
          resolved_bin: null,
        },
      },
    });
  });

  it("does not expose Codex progress transcript text as the terminal answer for conceptual no-run prompts", async () => {
    const providerAnswer =
      "The Moral Graph reflection tool is a conceptual reflection surface, not something to run in this prompt.";
    process.env.CODEX_AGENT_FAKE_STDOUT = providerAnswer;
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-conceptual-tool-no-run-progress-leak",
        agent_runtime: "codex",
        question:
          "What is the Moral Graph reflection tool? Explain conceptually. Do not run it.",
      },
      headers: {},
    });

    expect(result.text).toBe(providerAnswer);
    expect(
      (result.debug as any)?.workstation_gateway_call_results ?? [],
    ).toEqual([]);
    expect(JSON.stringify(result.turn_transcript_events ?? [])).not.toContain(
      "Codex runtime received the Ask turn",
    );
    expect(
      result.turn_transcript_events?.find(
        (event: any) => event.source_event_type === "terminal_answer",
      ),
    ).toMatchObject({
      text: providerAnswer,
    });
  });

  it("returns Codex non-spawnable binary failures with provider debug metadata", async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "helix-codex-provider-unspawnable-"),
    );
    const candidate = path.join(
      tempDir,
      process.platform === "win32" ? "codex.exe" : "codex",
    );
    fs.writeFileSync(candidate, "not a real executable");
    process.env.CODEX_BIN = candidate;

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-unspawnable-binary",
        question: "check",
      },
    });

    expect(result).toMatchObject({
      ok: false,
      runtime: "codex",
      response_type: "final_failure",
      final_status: "final_failure",
      answer:
        "Codex runtime is enabled but the resolved Codex CLI binary could not be spawned.",
      debug: {
        agent_runtime: "codex",
        fail_reason: "codex_binary_not_spawnable",
        codex_bin: candidate,
        codex_runtime_status: {
          launchable: false,
          reason: "codex_binary_not_spawnable",
          resolved_bin: candidate,
        },
      },
    });
  });

  it("selects the future provider wrapper when requested and explicitly enabled", () => {
    process.env.ENABLE_FUTURE_AGENT = "1";

    const provider = resolveHelixAgentProvider({
      body: { agentRuntime: "future" },
    });

    expect(provider.id).toBe("future");
    expect(provider.supports).toEqual({
      streaming: false,
      workstationTools: true,
      capabilityLanes: true,
      capabilityLaneOneShot: false,
      capabilityLaneSessions: false,
      codeMutation: false,
    });
    expect(provider.permissionProfile).toMatchObject({
      id: "read-observe",
      allows: {
        observe: true,
        read: true,
        act: false,
        write: false,
        shell: false,
        codeMutation: false,
      },
    });
  });

  it("lists Helix and Codex as enabled and keeps future providers disabled by default", () => {
    delete process.env.ENABLE_CODEX_AGENT;
    delete process.env.ENABLE_FUTURE_AGENT;

    const providers = listHelixAgentProviders();

    expect(providers).toContainEqual(
      expect.objectContaining({
        id: "helix",
        enabled: true,
        experimental: true,
        permission_profile: expect.objectContaining({
          id: "helix-native",
        }),
      }),
    );
    expect(providers).toContainEqual(
      expect.objectContaining({
        id: "codex",
        enabled: true,
        experimental: false,
        permission_profile: expect.objectContaining({
          id: "read-observe-act",
          allows: expect.objectContaining({
            read: true,
            act: true,
            write: false,
            shell: false,
            codeMutation: false,
          }),
        }),
      }),
    );
    expect(providers).toContainEqual(
      expect.objectContaining({
        id: "future",
        label: "Future Agent Wrapper",
        enabled: false,
        experimental: true,
        permission_profile: expect.objectContaining({
          id: "read-observe",
          allows: expect.objectContaining({
            read: true,
            write: false,
            shell: false,
            codeMutation: false,
          }),
        }),
      }),
    );
  });

  it("builds provider runtime traces with the shared gateway manifest", () => {
    process.env.ENABLE_CODEX_AGENT = "1";
    const provider = resolveHelixAgentProvider({
      body: { agent_runtime: "codex" },
    });
    const manifest = listWorkstationGatewayCapabilities({
      agentRuntime: provider.id,
      mode: "act",
    });

    const trace = buildHelixAgentRuntimeSelectionTrace({
      route: "/ask/turn",
      requestedRuntime: "codex",
      provider,
      gatewayManifest: manifest,
    });

    expect(trace).toMatchObject({
      schema: "helix.agent_runtime_selection_trace.v1",
      route: "/ask/turn",
      requested_runtime: "codex",
      selected_runtime: "codex",
      fallback_used: false,
      provider_enabled: true,
      selected_agent_provider: {
        id: "codex",
        permission_profile: {
          id: "read-observe-act",
          allows: {
            read: true,
            act: true,
            write: false,
            shell: false,
            codeMutation: false,
          },
        },
      },
      workstation_gateway: {
        manifest_schema: "helix.workstation_tool_gateway.v1",
        manifest_version: "read-observe-act.v1",
        tools_enabled_for_provider: true,
        code_mutation_enabled: false,
        shell_enabled: false,
        file_mutation_enabled: false,
        gateway_contract: "read_observe_act",
      },
      evidence_reentry_status: "not_run_text_mode_adapter",
      terminal_authority_status: "not_evaluated_provider_text_mode",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(trace.workstation_gateway.capability_ids).toContain(
      "workspace_os.status",
    );
    expect(trace.workstation_gateway.capability_ids).toContain("docs.search");
  });

  it("returns Codex missing-question failures with provider and gateway debug metadata", async () => {
    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {},
    });

    expect(result).toMatchObject({
      ok: false,
      runtime: "codex",
      response_type: "final_failure",
      final_status: "final_failure",
      debug: {
        agent_runtime: "codex",
        fail_reason: "missing_question",
        agent_runtime_selection_trace: {
          schema: "helix.agent_runtime_selection_trace.v1",
          selected_runtime: "codex",
          workstation_gateway: {
            manifest_version: "read-observe-act.v1",
            shell_enabled: false,
            file_mutation_enabled: false,
            code_mutation_enabled: false,
          },
          evidence_reentry_status: "not_run_text_mode_adapter",
          terminal_authority_status: "not_evaluated_provider_text_mode",
        },
        workstation_gateway_manifest: {
          schema: "helix.workstation_tool_gateway.v1",
          manifest_version: "read-observe-act.v1",
        },
        workstation_gateway_reentry_status: "not_run_text_mode_adapter",
        terminal_authority_status: "not_evaluated_provider_text_mode",
      },
    });
  });

  it("returns future provider scaffold failures with provider and gateway debug metadata", async () => {
    process.env.ENABLE_FUTURE_AGENT = "1";

    const result = await futureProvider.runTurn({
      runtime: "future",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:future-provider-scaffold",
        question: "Use the future provider wrapper.",
      },
    });

    expect(result).toMatchObject({
      ok: false,
      runtime: "future",
      response_type: "final_failure",
      final_status: "final_failure",
      debug: {
        turn_id: "ask:test:future-provider-scaffold",
        agent_runtime: "future",
        fail_reason: "future_provider_adapter_not_configured",
        agent_runtime_selection_trace: {
          schema: "helix.agent_runtime_selection_trace.v1",
          selected_runtime: "future",
          workstation_gateway: {
            manifest_version: "read-observe-act.v1",
            shell_enabled: false,
            file_mutation_enabled: false,
            code_mutation_enabled: false,
          },
        },
        selected_agent_provider: {
          id: "future",
          permission_profile: {
            id: "read-observe",
          },
        },
        workstation_gateway_manifest: {
          schema: "helix.workstation_tool_gateway.v1",
          manifest_version: "read-observe-act.v1",
        },
        workstation_gateway_reentry_status: "pending_provider_reasoning",
        terminal_authority_status: "pending_helix_terminal_authority",
      },
    });
  });

  it("runs only explicit Codex workstation gateway call requests through shared admission", async () => {
    const results = await runExplicitCodexWorkstationGatewayCalls({
      body: {
        turn_id: "ask:test:codex-explicit-gateway",
        workstation_gateway_call: {
          capability_id: "scientific-calculator.solve_expression",
          arguments: {
            expression: "6 * 7",
          },
        },
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      ok: true,
      agent_runtime: "codex",
      capability_id: "scientific-calculator.solve_expression",
      gateway_admission: {
        selected_agent_provider: "codex",
        admission_status: "admitted",
      },
      observation_packet: {
        schema: "helix.agent_step_observation_packet.v1",
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.calculator_solve_observation.v1",
        result: "42",
      },
      tool_lifecycle_trace: {
        schema: "helix.tool_lifecycle_trace.v1",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      tool_followup_decision: {
        schema: "helix.tool_followup_decision.v1",
        next_action: "continue_reasoning",
        evidence_reentered: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("derives natural Codex workspace status prompts into workspace_os.status observations", async () => {
    const providerAnswer =
      "The workspace status observation is available for the final answer.";
    process.env.CODEX_AGENT_FAKE_STDOUT = providerAnswer;
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-natural-workspace-status",
        agent_runtime: "codex",
        question:
          "Check the workspace OS status and tell me which capabilities are available.",
      },
      headers: {},
    });

    expect(result.text).toBe(providerAnswer);
    expect(
      (result.debug as any)?.workstation_gateway_call_results?.map(
        (entry: any) => entry.capability_id,
      ),
    ).toEqual(["workspace_os.status"]);
    expect((result.debug as any)?.codex_native_provider_bridge).toMatchObject({
      schema: "helix.codex_native_provider_bridge.v1",
      enabled: true,
      eligible: true,
      attempted: false,
      status: "unavailable",
      fallback_required: true,
      fallback_reason: "legacy_fake_runtime_configured",
      native_transport: "codex_app_server",
      compatibility_transport: "codex_exec",
    });
    expect(
      result.turn_transcript_events?.map(
        (event: any) => event.source_event_type,
      ),
    ).toEqual([
      "runtime_selected",
      "tool_request",
      "tool_observation",
      "model_reentry",
      "terminal_answer",
    ]);
    expect(
      result.turn_transcript_events?.some(
        (event: any) =>
          event.source_event_type === "tool_observation" &&
          event.capability_id === "workspace_os.status" &&
          /Workspace OS status returned/i.test(String(event.text)),
      ),
    ).toBe(true);
  });

  it("admits civilization-bounds reflection only from an affirmative current clause", () => {
    const requestsFor = (question: string) =>
      buildPromptDerivedCivilizationBoundsGatewayCallRequests({ question });

    expect(
      requestsFor("Reflect planetary trade through civilization bounds."),
    ).toHaveLength(1);
    for (const prompt of [
      "Do not reflect planetary trade through civilization bounds.",
      "Later, reflect planetary trade through civilization bounds.",
      "Earlier I asked you to reflect planetary trade through civilization bounds.",
      "The screen text says reflect planetary trade through civilization bounds.",
      'The quoted prompt was "reflect planetary trade through civilization bounds."',
    ]) {
      expect(requestsFor(prompt)).toEqual([]);
    }
    expect(
      requestsFor(
        "Earlier I mentioned civilization bounds. Now reflect planetary trade through civilization bounds.",
      ),
    ).toHaveLength(1);
  });

  it("derives natural Codex internet search prompts into bounded web observations", async () => {
    process.env.TAVILY_API_KEY = "test-tavily-key";
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "Web evidence observation is available and bounded.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            title: "Current QEI discussion",
            url: "https://example.com/current-qei",
            content: "Current web source about QEI margins.",
          },
        ],
      }),
    })) as typeof fetch;

    const body = {
      turn_id: "ask:test:codex-natural-internet-search",
      agent_runtime: "codex",
      question:
        "Search the web for current QEI warp metric constraints and summarize what the sources show.",
    };

    expect(buildPromptDerivedInternetSearchGatewayCallRequests(body)).toEqual([
      expect.objectContaining({
        capability_id: "internet-search.search_web",
        mode: "read",
        arguments: expect.objectContaining({
          query: body.question,
          source_target_intent: expect.objectContaining({
            target_kind: "internet_search",
          }),
        }),
      }),
    ]);

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body,
      headers: {},
    });

    expect(result.text).toBe(
      "Web evidence observation is available and bounded.",
    );
    expect(
      (result.debug as any)?.workstation_gateway_call_results?.map(
        (entry: any) => entry.capability_id,
      ),
    ).toEqual(["internet-search.search_web"]);
    expect(
      (result.debug as any)?.codex_host_workstation_affordances?.support_refs,
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("internet-search.search_web"),
      ]),
    );
    expect(
      result.turn_transcript_events?.some(
        (event: any) =>
          event.source_event_type === "tool_observation" &&
          event.capability_id === "internet-search.search_web" &&
          /Internet search returned 1 result/i.test(String(event.text)),
      ),
    ).toBe(true);
  });

  it("routes each supplied supporting paper independently instead of searching the whole argument", () => {
    const question = [
      "Dan Dennett was a great guy and philosopher but possibly wrong on this point also.",
      "If consciousness is holographic, the conscious self may be represented at multiple scales.",
      "https://ingentaconnect.com/content/imp/jcs/2026/00000033/f0020001/art00013;jsessionid=synthetic-session-id",
      "Small holographic regions may recover a lower-resolution image when reilluminated with the original coherent source.",
      "https://pubmed.ncbi.nlm.nih.gov/2813384/",
      "https://karlpribram.com/wp-content/uploads/pdf/theory/T-167.pdf",
    ].join(" ");

    const requests = buildPromptDerivedScholarlyResearchGatewayCallRequests({
      question,
    });

    expect(requests).toHaveLength(3);
    expect(requests.map((request: any) => request.capability_id)).toEqual([
      "scholarly-research.fetch_full_text",
      "scholarly-research.lookup_papers",
      "scholarly-research.fetch_full_text",
    ]);
    expect((requests[0] as any).arguments.source_url).toBe(
      "https://ingentaconnect.com/content/imp/jcs/2026/00000033/f0020001/art00013",
    );
    expect((requests[1] as any).arguments).toMatchObject({
      query: "PMID:2813384",
      providers: ["pubmed"],
      source_target_intent: {
        strength: "soft",
        supporting_sources_only: true,
        source_portfolio_index: 1,
        source_portfolio_count: 3,
      },
    });
    expect((requests[2] as any).arguments.source_url).toBe(
      "https://karlpribram.com/wp-content/uploads/pdf/theory/T-167.pdf",
    );
    expect(
      requests.map((request: any) => request.arguments.query).join(" "),
    ).not.toMatch(/https?:\/\//);

    const admittedRequests = readWorkstationGatewayCallRequestsForTurn({
      body: { question, agent_runtime: "codex" },
      includePlannerDerived: true,
    });
    const admittedScholarlyRequests = admittedRequests.filter(
      (request) =>
        request.capability_id === "scholarly-research.fetch_full_text" ||
        request.capability_id === "scholarly-research.lookup_papers",
    );

    expect(admittedScholarlyRequests).toHaveLength(3);
    expect(
      admittedScholarlyRequests.map(
        (request: any) =>
          request.arguments.source_target_intent.source_portfolio_index,
      ),
    ).toEqual([0, 1, 2]);
    expect(
      admittedScholarlyRequests
        .map((request: any) => request.arguments.source_url)
        .filter(Boolean),
    ).toEqual([
      "https://ingentaconnect.com/content/imp/jcs/2026/00000033/f0020001/art00013",
      "https://karlpribram.com/wp-content/uploads/pdf/theory/T-167.pdf",
    ]);
    expect(
      admittedRequests.map((request) => request.capability_id),
    ).not.toContain("repo.search");
  });

  it("preserves conceptual provider synthesis when a supporting scholarly source is unavailable", () => {
    const question = [
      "If consciousness is holographic, the self may be represented across scales.",
      "https://karlpribram.com/wp-content/uploads/pdf/theory/T-167.pdf",
    ].join(" ");
    const providerText = [
      "The holographic analogy supports distributed, partially recoverable representation.",
      "It does not by itself establish a separate conscious subject at every scale.",
    ].join(" ");

    const result = buildScholarlyResearchResponseModeProjection({
      question,
      text: providerText,
      gatewayCallResults: [
        {
          ok: false,
          capability_id: "scholarly-research.fetch_full_text",
          gateway_admission: {
            requested_capability: "scholarly-research.fetch_full_text",
          },
          observation: {
            evidence_state: "full_text_unavailable",
            missing_requirements: ["full_text_http_403"],
            next_affordances: [],
          },
          observation_packet: {
            state_delta: {
              evidence_state: "full_text_unavailable",
              missing_requirements: ["full_text_http_403"],
            },
          },
        } as any,
      ],
    });

    expect(result.text).toBe(providerText);
    expect(result.text).not.toContain("Helix completed");
    expect(result.projection).toMatchObject({
      selected_response_mode: "scholarly_research_answer",
      terminal_artifact_kind: "scholarly_research_answer",
      terminal_eligible: true,
      supporting_sources_only: true,
      evidence_state: "full_text_unavailable",
      missing_requirements: ["full_text_http_403"],
    });
  });

  it("terminalizes mixed conceptual and supporting-source synthesis as a scholarly research answer", async () => {
    const providerText = [
      "A distributed self-model could be represented at several physical scales.",
      "That does not establish a distinct conscious subject at each scale, and the cited Alzheimer paper does not supply that missing inference.",
    ].join(" ");
    process.env.CODEX_AGENT_FAKE_STDOUT = providerText;
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        [
          '<?xml version="1.0"?>',
          "<PubmedArticleSet><PubmedArticle><MedlineCitation>",
          "<PMID>2813384</PMID><Article>",
          "<Journal><JournalIssue><PubDate><Year>1989</Year></PubDate></JournalIssue><Title>PNAS</Title></Journal>",
          "<ArticleTitle>Hypothesis: microtubules, a key to Alzheimer disease</ArticleTitle>",
          "<Abstract><AbstractText>Microtubule impairment is considered in Alzheimer disease.</AbstractText></Abstract>",
          "<AuthorList><Author><LastName>Matsuyama</LastName><ForeName>H</ForeName></Author></AuthorList>",
          "</Article></MedlineCitation><PubmedData><ArticleIdList>",
          '<ArticleId IdType="pubmed">2813384</ArticleId>',
          '<ArticleId IdType="doi">10.1073/pnas.86.20.8152</ArticleId>',
          "</ArticleIdList></PubmedData></PubmedArticle></PubmedArticleSet>",
        ].join(""),
    })) as typeof fetch;

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:mixed-conceptual-supporting-pubmed",
        agent_runtime: "codex",
        question: [
          "If consciousness is holographic, the conscious self may be represented at multiple size and frequency scales.",
          "The fast tiny selves might have poor resolution.",
          "https://pubmed.ncbi.nlm.nih.gov/2813384/",
        ].join(" "),
      },
      headers: {},
    });

    expect(result.text).toBe(providerText);
    expect((result as any).ok).toBe(true);
    expect((result as any).final_answer_source).toBe(
      "scholarly_research_answer",
    );
    expect((result as any).terminal_artifact_kind).toBe(
      "scholarly_research_answer",
    );
    expect(
      (result.debug as any)?.scholarly_response_mode_selection,
    ).toMatchObject({
      supporting_sources_only: true,
      selected_response_mode: "scholarly_research_answer",
      terminal_artifact_kind: "scholarly_research_answer",
    });
    expect((result.debug as any)?.workstation_gateway_call_results).toEqual([
      expect.objectContaining({
        ok: true,
        capability_id: "scholarly-research.lookup_papers",
        observation: expect.objectContaining({
          evidence_state: "lookup_usable",
          papers: [
            expect.objectContaining({
              identifiers: expect.objectContaining({ pmid: "2813384" }),
            }),
          ],
        }),
      }),
    ]);
  });

  it("keeps a scoped repo-search prohibition from suppressing admitted supporting-source retrieval", async () => {
    const providerText = [
      "The conceptual hypothesis can be evaluated separately from the cited paper.",
      "The PMID metadata supports a microtubule/Alzheimer hypothesis only, not a consciousness claim.",
    ].join(" ");
    process.env.CODEX_AGENT_FAKE_STDOUT = providerText;
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        [
          '<?xml version="1.0"?>',
          "<PubmedArticleSet><PubmedArticle><MedlineCitation>",
          "<PMID>2813384</PMID><Article>",
          "<Journal><JournalIssue><PubDate><Year>1989</Year></PubDate></JournalIssue><Title>PNAS</Title></Journal>",
          "<ArticleTitle>Hypothesis: microtubules, a key to Alzheimer disease</ArticleTitle>",
          "<Abstract><AbstractText>Microtubule impairment is considered in Alzheimer disease.</AbstractText></Abstract>",
          "<AuthorList><Author><LastName>Matsuyama</LastName><ForeName>H</ForeName></Author></AuthorList>",
          "</Article></MedlineCitation><PubmedData><ArticleIdList>",
          '<ArticleId IdType="pubmed">2813384</ArticleId>',
          '<ArticleId IdType="doi">10.1073/pnas.86.20.8152</ArticleId>',
          "</ArticleIdList></PubmedData></PubmedArticle></PubmedArticleSet>",
        ].join(""),
    })) as typeof fetch;

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:supporting-source-scoped-repo-prohibition",
        agent_runtime: "codex",
        question: [
          "Evaluate a multiscale holographic-self hypothesis.",
          "Treat the source as supporting context and keep evidence boundaries explicit.",
          "https://pubmed.ncbi.nlm.nih.gov/2813384/",
          "Do not search the repo.",
        ].join(" "),
      },
      headers: {},
    });

    const debug = result.debug as Record<string, any>;
    expect(result).toMatchObject({ ok: true, text: providerText });
    expect(
      debug.workstation_gateway_call_results.map(
        (entry: any) => entry.capability_id,
      ),
    ).toEqual(["scholarly-research.lookup_papers"]);
    expect(
      debug.workstation_gateway_call_results.map(
        (entry: any) => entry.capability_id,
      ),
    ).not.toContain("repo.search");
    expect(debug.provider_reasoning_reentry).toMatchObject({
      model_only_direct_answer_allowed: false,
      evidence_reentered: true,
    });
  });

  it("derives natural Codex scholarly prompts into bounded paper observations", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "Scholarly paper observation is available and bounded.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<feed xmlns="http://www.w3.org/2005/Atom">',
          "<entry>",
          "<id>https://arxiv.org/abs/2606.00001</id>",
          "<title>Current NHM2 document calculate search arXiv quantum inequalities warp constraints QEI margin theory badge civilization bounds paper evidence</title>",
          "<summary>Scholarly paper evidence summarizes quantum inequalities, warp constraints, QEI margin, theory badge reflection, and civilization bounds.</summary>",
          "<published>2026-06-01T00:00:00Z</published>",
          "<author><name>A. Researcher</name></author>",
          "</entry>",
          "</feed>",
        ].join(""),
    })) as typeof fetch;

    const body = {
      turn_id: "ask:test:codex-natural-scholarly-search",
      agent_runtime: "codex",
      question:
        "Search research papers on arXiv for quantum inequalities and warp constraints, then summarize the paper evidence.",
    };

    expect(
      buildPromptDerivedScholarlyResearchGatewayCallRequests(body),
    ).toEqual([
      expect.objectContaining({
        capability_id: "scholarly-research.lookup_papers",
        mode: "read",
        arguments: expect.objectContaining({
          query: "arXiv quantum inequalities and warp constraints",
          mode: "paper_search",
          scholarly_intent: expect.objectContaining({
            schema: "helix.scholarly_intent.v1",
            scholarly_query: "arXiv quantum inequalities and warp constraints",
            requested_workflow: "metadata_search",
          }),
          source_target_intent: expect.objectContaining({
            target_kind: "research_paper_search",
          }),
        }),
      }),
    ]);

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body,
      headers: {},
    });

    expect(result.text).toBe(
      "Scholarly paper observation is available and bounded.",
    );
    expect(
      (result.debug as any)?.workstation_gateway_call_results?.map(
        (entry: any) => entry.capability_id,
      ),
    ).toEqual(["scholarly-research.lookup_papers"]);
    expect(
      (result.debug as any)?.codex_host_workstation_affordances?.support_refs,
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("scholarly-research.lookup_papers"),
      ]),
    );
    expect(
      result.turn_transcript_events?.some(
        (event: any) =>
          event.source_event_type === "tool_observation" &&
          event.capability_id === "scholarly-research.lookup_papers" &&
          /Scholarly research lookup returned 1 paper/i.test(
            String(event.text),
          ),
      ),
    ).toBe(true);
  });

  it("executes a metadata-only scholarly lookup when downstream PDF work is forbidden", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "The requested scholarly metadata was verified from the lookup observation.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">',
          "<entry>",
          "<id>https://arxiv.org/abs/gr-qc/9510071</id>",
          "<title>Quantum Field Theory Constrains Traversable Wormhole Geometries</title>",
          "<summary>Quantum inequalities constrain negative energy in traversable wormhole geometries.</summary>",
          "<published>1995-10-10T00:00:00Z</published>",
          "<author><name>L. H. Ford</name></author>",
          "<author><name>Thomas A. Roman</name></author>",
          "<arxiv:doi>10.1103/PhysRevD.53.5496</arxiv:doi>",
          "</entry>",
          "</feed>",
        ].join(""),
    })) as typeof fetch;

    const body = {
      turn_id: "ask:test:codex-scholarly-metadata-only-downstream-negation",
      agent_runtime: "codex",
      question: [
        "LOOKUP_SMOKE_03 — Search arXiv for “Quantum Field Theory Constrains Traversable Wormhole Geometries” by Ford and Roman.",
        "Use scholarly lookup only and return the title, authors, DOI, and arXiv ID.",
        "Do not fetch full text or inspect PDF pages.",
      ].join(" "),
    };

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body,
      headers: {},
    });

    expect(
      (result.debug as any)?.workstation_gateway_call_results?.map(
        (entry: any) => entry.capability_id,
      ),
    ).toEqual(["scholarly-research.lookup_papers"]);
    expect(
      (result.debug as any)?.workstation_gateway_call_results?.[0],
    ).toMatchObject({
      ok: true,
      capability_id: "scholarly-research.lookup_papers",
    });
    expect(
      (result.debug as any)?.workstation_gateway_call_results?.map(
        (entry: any) => entry.capability_id,
      ),
    ).not.toContain("scholarly-research.fetch_full_text");
    expect(
      result.turn_transcript_events?.some(
        (event: any) =>
          event.source_event_type === "tool_observation" &&
          event.capability_id === "scholarly-research.lookup_papers" &&
          /Scholarly research lookup returned 1 paper/i.test(
            String(event.text),
          ),
      ),
    ).toBe(true);
  });

  it("derives anaphoric literature lookup from the resolved claim instead of searching operator instructions", () => {
    const body = {
      turn_id: "ask:test:scholarly-chat-referent",
      question:
        "Find scholarly references supporting the scientific claims in your immediately previous answer. Decompose them into separate claims, search arXiv and the other scholarly providers, return a diverse claim-to-citation map, and fetch the best three accessible sources.",
      workspace_context_snapshot: {
        chat_referent_context: {
          schema: "helix.ask.chat_referent_context.v1",
          previous_assistant_final_answer: {
            role: "assistant",
            reply_id: "reply-science",
            source_ref: "chat.final_answer.previous:reply-science",
            text: "Quantum inequalities constrain weighted negative energy averages, while sampling duration changes the bound.",
          },
        },
      },
    };

    expect(
      buildPromptDerivedScholarlyResearchGatewayCallRequests(body),
    ).toEqual([
      expect.objectContaining({
        derivation_source: "helix_resolved_referent_scholarly_research",
        capability_id: "scholarly-research.lookup_papers",
        arguments: expect.objectContaining({
          query:
            "Quantum inequalities constrain weighted negative energy averages, while sampling duration changes the bound.",
          scholarly_intent: expect.objectContaining({
            scholarly_query:
              "Quantum inequalities constrain weighted negative energy averages, while sampling duration changes the bound.",
            query_normalization_reasons: expect.arrayContaining([
              "resolved_conversational_referent_claim",
            ]),
          }),
          source_target_intent: expect.objectContaining({
            query_derivation: "resolved_conversational_referent_claim",
            resolved_referent_ref: "chat.final_answer.previous:reply-science",
            claim_index: 0,
            claim_count: 1,
          }),
        }),
      }),
    ]);
    expect(buildCompoundCapabilityDependencyGatewayCallRequests(body)).toEqual(
      [],
    );
  });

  it("creates one bounded scholarly lookup per resolved bullet claim", () => {
    const body = {
      turn_id: "ask:test:scholarly-chat-referent-bullets",
      question:
        "Use the scientific claims in your immediately previous answer. Search arXiv and other scholarly providers, then fetch the best three accessible full-text sources.",
      workspace_context_snapshot: {
        chat_referent_context: {
          schema: "helix.ask.chat_referent_context.v1",
          previous_assistant_final_answer: {
            role: "assistant",
            reply_id: "reply-science-bullets",
            source_ref: "chat.final_answer.previous:reply-science-bullets",
            text: [
              "- Quantum inequalities bound sampled negative energy along an observer worldline.",
              "- Longer sampling durations tighten negative-energy magnitude limits.",
              "- Quantum interest requires compensating positive-energy pulses.",
              "- Quantum inequalities constrain traversable wormhole and warp-drive geometries.",
            ].join("\n"),
          },
        },
      },
    };

    const requests =
      buildPromptDerivedScholarlyResearchGatewayCallRequests(body);

    expect(requests).toHaveLength(4);
    expect(requests.map((request: any) => request.arguments.query)).toEqual([
      "Quantum inequalities bound sampled negative energy along an observer worldline.",
      "Longer sampling durations tighten negative-energy magnitude limits.",
      "Quantum interest requires compensating positive-energy pulses.",
      "Quantum inequalities constrain traversable wormhole and warp-drive geometries.",
    ]);
    expect(
      requests.every(
        (request: any) =>
          request.arguments.source_target_intent.full_text_requested === true &&
          request.arguments.source_target_intent.claim_count === 4,
      ),
    ).toBe(true);
    expect(
      requests
        .slice(0, -1)
        .every((request: any) => request.compound_outcome === undefined),
    ).toBe(true);
    expect(requests.at(-1)).toMatchObject({
      compound_outcome: "scholarly_research_workflow",
      dependent_capability_id: "scholarly-research.fetch_full_text",
      arguments: {
        allow_scholarly_dependent_chain: true,
        requested_full_text_count: 3,
        scholarly_claim_portfolio: true,
        source_target_intent: {
          claim_index: 3,
          claim_count: 4,
          claim_portfolio_closer: true,
        },
      },
    });

    const admittedScholarlyRequests = readWorkstationGatewayCallRequestsForTurn(
      {
        body,
        includePlannerDerived: true,
      },
    ).filter(
      (request) => request.capability_id === "scholarly-research.lookup_papers",
    );
    expect(admittedScholarlyRequests).toHaveLength(4);
    expect(
      admittedScholarlyRequests.map((request: any) => request.arguments.query),
    ).toEqual(requests.map((request: any) => request.arguments.query));
    expect(admittedScholarlyRequests.at(-1)).toMatchObject({
      compound_outcome: "scholarly_research_workflow",
      arguments: {
        requested_full_text_count: 3,
        scholarly_claim_portfolio: true,
      },
    });
  });

  it("does not turn a retained scholarly failure disclaimer into a paper-search claim", () => {
    const body = {
      turn_id: "ask:test:scholarly-chat-referent-meta-disclaimer",
      question:
        "Find scholarly references supporting the scientific claims in your immediately previous answer. Search arXiv and fetch accessible full text.",
      workspace_context_snapshot: {
        chat_referent_context: {
          schema: "helix.ask.chat_referent_context.v1",
          previous_assistant_final_answer: {
            role: "assistant",
            reply_id: "reply-science-with-disclaimer",
            source_ref:
              "chat.final_answer.previous:reply-science-with-disclaimer",
            text: [
              "Quantum inequalities bound sampled negative energy along an observer worldline.",
              "Longer sampling durations tighten negative-energy magnitude limits.",
              "I therefore cannot honestly present these results as support for the claims you meant.",
            ].join(" "),
          },
        },
      },
    };

    const requests =
      buildPromptDerivedScholarlyResearchGatewayCallRequests(body);

    expect(requests.map((request: any) => request.arguments.query)).toEqual([
      "Quantum inequalities bound sampled negative energy along an observer worldline.",
      "Longer sampling durations tighten negative-energy magnitude limits.",
    ]);
    expect(
      requests.map((request: any) => request.arguments.query).join(" "),
    ).not.toContain("cannot honestly present");
  });

  it("fails closed before prompt-derived scholarly lookup when an anaphoric claim has no retained antecedent", () => {
    const body = {
      turn_id: "ask:test:scholarly-chat-referent-missing",
      question:
        "Find scholarly references supporting the scientific claims in your immediately previous answer and fetch full text.",
      workspace_context_snapshot: {},
    };

    expect(
      buildPromptDerivedScholarlyResearchGatewayCallRequests(body),
    ).toEqual([]);
    expect(buildCompoundCapabilityDependencyGatewayCallRequests(body)).toEqual(
      [],
    );
  });

  it("keeps this-document equation follow-ups on retained evidence instead of launching a new lookup", () => {
    const body = {
      turn_id: "ask:test:scholarly-retained-document-equation-followup",
      question: "Ok can you find an equation we can use in this doc?",
      workspace_context_snapshot: {
        chat_referent_context: {
          schema: "helix.ask.chat_referent_context.v1",
          previous_assistant_final_answer: {
            role: "assistant",
            reply_id: "reply-failed-inspection",
            source_ref: "chat.final_answer.previous:reply-failed-inspection",
            text: "I could not complete this turn because a tool observation required a follow-up model answer step, but no later terminal answer artifact was available.",
          },
          recent_assistant_final_answers: [
            {
              role: "assistant",
              reply_id: "reply-failed-inspection",
              source_ref: "chat.final_answer.recent:reply-failed-inspection",
              text: "I could not complete this turn because a tool observation required a follow-up model answer step, but no later terminal answer artifact was available.",
            },
            {
              role: "assistant",
              reply_id: "reply-mounted-paper",
              source_ref: "chat.final_answer.recent:reply-mounted-paper",
              text: "Mounted artifact://magnetar.pdf and rendered page 2 as pdf-page-render:magnetar-page-2 in Image Lens.",
            },
          ],
        },
      },
    };

    expect(
      buildPromptDerivedScholarlyResearchGatewayCallRequests(body),
    ).toEqual([]);
    expect(buildCompoundCapabilityDependencyGatewayCallRequests(body)).toEqual(
      [],
    );
  });

  it("uses an explicit current-turn scholarly topic when retained answers do not contain the named claims", () => {
    const body = {
      turn_id: "ask:test:scholarly-explicit-topic-fallback",
      question:
        "Find scholarly references supporting the quantum-inequality claims we discussed. Decompose them into separate claims, search arXiv and the other scholarly providers, identify accessible full text, and fetch the best three accessible sources.",
      workspace_context_snapshot: {
        chat_referent_context: {
          schema: "helix.ask.chat_referent_context.v1",
          previous_assistant_final_answer: {
            role: "assistant",
            reply_id: "reply-runtime",
            source_ref: "chat.final_answer.previous:reply-runtime",
            text: "Runtime verification can switch a neural-network controller to a safe backup.",
          },
          recent_assistant_final_answers: [
            {
              role: "assistant",
              reply_id: "reply-runtime",
              source_ref: "chat.final_answer.recent:reply-runtime",
              text: "Runtime verification can switch a neural-network controller to a safe backup.",
            },
          ],
        },
      },
    };

    const requests =
      buildPromptDerivedScholarlyResearchGatewayCallRequests(body);

    expect(requests).toEqual([
      expect.objectContaining({
        derivation_source: "helix_explicit_topic_scholarly_research",
        compound_outcome: "scholarly_research_workflow",
        dependent_capability_id: "scholarly-research.fetch_full_text",
        capability_id: "scholarly-research.lookup_papers",
        arguments: expect.objectContaining({
          query: "quantum-inequality",
          allow_scholarly_dependent_chain: true,
          requested_full_text_count: 3,
          scholarly_intent: expect.objectContaining({
            scholarly_query: "quantum-inequality",
            query_normalization_reasons: expect.arrayContaining([
              "explicit_current_turn_topic_fallback",
            ]),
          }),
          source_target_intent: expect.objectContaining({
            query_derivation: "explicit_current_turn_topic_fallback",
            explicit_topic_phrase: "quantum-inequality",
            explicit_topic_terms: ["quantum", "inequality"],
            referent_resolution_block_reason:
              "referent_resolution_required:explicit_topic_mismatch",
          }),
        }),
      }),
    ]);
    expect(
      (requests[0] as any)?.arguments?.scholarly_claim_portfolio,
    ).toBeUndefined();
    expect(buildCompoundCapabilityDependencyGatewayCallRequests(body)).toEqual(
      [],
    );
  });

  it("extracts scholarly topic and workflow before lookup planning", () => {
    expect(
      extractScholarlyIntent(
        'Search scholarly research papers for "weyl curvature" and summarize the paper evidence.',
      ),
    ).toMatchObject({
      schema: "helix.scholarly_intent.v1",
      scholarly_query: "weyl curvature",
      quoted_topic: "weyl curvature",
      requested_workflow: "metadata_search",
      terminal_evidence_requirement: "metadata",
      assistant_answer: false,
      raw_content_included: false,
    });

    expect(
      extractScholarlyIntent(
        "Find a paper on Weyl curvature in general relativity, fetch full text if available, and summarize only from fetched text.",
      ),
    ).toMatchObject({
      scholarly_query: "Weyl curvature in general relativity",
      requested_workflow: "full_text_summary",
      requires_full_text: false,
      terminal_evidence_requirement: "metadata",
      evidence_demand: {
        required_modes: [],
        optional_modes: ["full_text"],
        minimum_satisfying_depth: "metadata_lookup",
      },
    });

    expect(
      extractScholarlyIntent(
        "Find a paper on the Casimir effect between conducting plates and show me the science.",
      ),
    ).toMatchObject({
      scholarly_query: "Casimir effect between conducting plates",
      requested_workflow: "full_text_summary",
      requires_full_text: true,
      terminal_evidence_requirement: "full_text",
    });

    expect(
      extractScholarlyIntent(
        'Use the paper titled "General Relativity and Weyl Frames" with arXiv id 1106.5543v1. Fetch the PDF, render page 1 into Image Lens, and extract the first displayed equation or equation-like row. Do not run a new broad lookup unless the arXiv fetch fails.',
      ),
    ).toMatchObject({
      scholarly_query: "General Relativity and Weyl Frames",
      quoted_topic: "General Relativity and Weyl Frames",
      requested_workflow: "full_text_summary",
      requires_full_text: true,
      requires_numeric_extraction: false,
      terminal_evidence_requirement: "full_text",
    });

    expect(
      extractScholarlyIntent(
        "Find a scholarly paper with numeric Weyl-curvature invariants for spacetime, extract reported numeric parameters with units, then calculate only if those cited values are available.",
      ),
    ).toMatchObject({
      scholarly_query: "Weyl-curvature invariants spacetime",
      requested_workflow: "numeric_calculation",
      requires_numeric_extraction: true,
      requires_calculation: true,
      terminal_evidence_requirement: "calculation_from_numeric_values",
    });
  });

  it("plans scholarly full-text and numeric workflows from extracted intent", () => {
    const fullTextBody = {
      turn_id: "ask:test:scholarly-full-text-workflow-plan",
      agent_runtime: "codex",
      question:
        "Find a paper on Weyl curvature in general relativity, fetch full text if available, and summarize only from fetched text.",
    };
    const fullTextPlan =
      buildCompoundCapabilityDependencyGatewayCallRequests(fullTextBody);
    expect(
      fullTextPlan.map((request) => (request as any).capability_id),
    ).toEqual(["scholarly-research.lookup_papers"]);
    expect((fullTextPlan[0] as any).arguments.query).toBe(
      "Weyl curvature in general relativity",
    );
    expect(fullTextPlan[0]).toMatchObject({
      dependent_capability_id: "scholarly-research.fetch_full_text",
      arguments: {
        allow_scholarly_dependent_chain: true,
        scholarly_intent: {
          requires_full_text: false,
          terminal_evidence_requirement: "metadata",
        },
      },
    });
    expect(
      (fullTextPlan[0] as any).arguments.planned_scholarly_capability_chain,
    ).toMatchObject({
      planned_capabilities: [
        "scholarly-research.lookup_papers",
        "scholarly-research.fetch_full_text",
      ],
      terminal_evidence_requirement: "metadata",
    });

    const scienceBody = {
      turn_id: "ask:test:scholarly-show-science-workflow-plan",
      agent_runtime: "codex",
      question:
        "Find a paper on the Casimir effect between conducting plates and show me the science.",
    };
    const sciencePlan =
      buildCompoundCapabilityDependencyGatewayCallRequests(scienceBody);
    expect(
      sciencePlan.map((request) => (request as any).capability_id),
    ).toEqual(["scholarly-research.lookup_papers"]);
    expect((sciencePlan[0] as any).arguments.query).toBe(
      "Casimir effect between conducting plates",
    );
    expect(
      (sciencePlan[0] as any).arguments.planned_scholarly_capability_chain,
    ).toMatchObject({
      planned_capabilities: [
        "scholarly-research.lookup_papers",
        "scholarly-research.fetch_full_text",
      ],
      terminal_evidence_requirement: "full_text",
    });

    const pdfPageBody = {
      turn_id: "ask:test:scholarly-pdf-page-equation-workflow-plan",
      agent_runtime: "codex",
      question:
        'Use the paper titled "General Relativity and Weyl Frames" with arXiv id 1106.5543v1. Fetch the PDF, render page 1 into Image Lens, and extract the first displayed equation or equation-like row. Do not run a new broad lookup unless the arXiv fetch fails.',
    };
    const pdfPagePlan =
      buildCompoundCapabilityDependencyGatewayCallRequests(pdfPageBody);
    expect(pdfPagePlan).toEqual([]);
    expect(buildPromptNamedCapabilityGatewayCallRequests(pdfPageBody)).toEqual([
      expect.objectContaining({
        capability_id: "scholarly-research.fetch_full_text",
        arguments: expect.objectContaining({
          source_url: "https://arxiv.org/pdf/1106.5543v1.pdf",
          source_target_intent: expect.objectContaining({
            target_source: "scholarly_research",
            target_kind: "research_paper_full_text",
            arxiv_id: "1106.5543v1",
          }),
        }),
      }),
    ]);
    expect(
      JSON.stringify(
        buildPromptNamedCapabilityGatewayCallRequests(pdfPageBody),
      ),
    ).not.toContain("scholarly-research.extract_numeric_parameters");

    const quotedPdfAffordanceBody = {
      turn_id: "ask:test:quoted-pdf-affordance-followup",
      agent_runtime: "codex",
      question:
        'extract this "Full-text / PDF affordance - PDF: https://arxiv.org/pdf/astro-ph/0503030v1.pdf - Full-text URL: http://arxiv.org/abs/astro-ph/0503030v1" into research docs',
    };
    expect(
      buildPromptNamedCapabilityGatewayCallRequests(quotedPdfAffordanceBody),
    ).toEqual([
      expect.objectContaining({
        capability_id: "scholarly-research.fetch_full_text",
        arguments: expect.objectContaining({
          source_url: "https://arxiv.org/pdf/astro-ph/0503030v1.pdf",
          source_target_intent: expect.objectContaining({
            arxiv_id: "astro-ph/0503030v1",
          }),
        }),
      }),
    ]);

    const bareLegacyArxivBody = {
      turn_id: "ask:test:bare-legacy-arxiv-followup",
      agent_runtime: "codex",
      question: "extract that magnetar paper, astro-ph/0503030v1",
    };
    expect(
      buildPromptNamedCapabilityGatewayCallRequests(bareLegacyArxivBody),
    ).toEqual([
      expect.objectContaining({
        capability_id: "scholarly-research.fetch_full_text",
        arguments: expect.objectContaining({
          source_url: "https://arxiv.org/pdf/astro-ph/0503030v1.pdf",
          source_target_intent: expect.objectContaining({
            arxiv_id: "astro-ph/0503030v1",
          }),
        }),
      }),
    ]);
    for (const question of [
      "Do not extract that magnetar paper, astro-ph/0503030v1.",
      'The screen says "extract that magnetar paper, astro-ph/0503030v1". Explain the text only.',
      "Earlier I extracted that magnetar paper, astro-ph/0503030v1. Explain what happened.",
      "Later we may extract that magnetar paper, astro-ph/0503030v1. Do not do it now.",
    ]) {
      expect(
        buildPromptNamedCapabilityGatewayCallRequests({ question }),
      ).toEqual([]);
    }

    const numericBody = {
      turn_id: "ask:test:scholarly-numeric-workflow-plan",
      agent_runtime: "codex",
      question:
        "Find a scholarly paper with numeric Weyl-curvature invariants for spacetime, extract reported numeric parameters with units, then calculate only if those cited values are available.",
    };
    const numericPlan =
      buildCompoundCapabilityDependencyGatewayCallRequests(numericBody);
    expect(
      numericPlan.map((request) => (request as any).capability_id),
    ).toEqual(["scholarly-research.lookup_papers"]);
    expect((numericPlan[0] as any).arguments.query).toBe(
      "Weyl-curvature invariants spacetime",
    );
    expect(
      (numericPlan[0] as any).arguments.planned_scholarly_capability_chain,
    ).toMatchObject({
      planned_capabilities: [
        "scholarly-research.lookup_papers",
        "scholarly-research.fetch_full_text",
        "scholarly-research.extract_numeric_parameters",
        "scientific-calculator.solve_expression",
      ],
      calculator_requires_numeric_evidence: true,
      terminal_evidence_requirement: "calculation_from_numeric_values",
    });
    expect(
      numericPlan.map((request) => (request as any).capability_id),
    ).not.toContain("scientific-calculator.solve_expression");
  });

  it("returns scholarly numeric missing instead of terminal_authority_missing for numeric paper prompts without numeric evidence", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "I could not complete that turn.\nCause: terminal_authority_missing.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<feed xmlns="http://www.w3.org/2005/Atom">',
          "<entry>",
          "<id>https://arxiv.org/abs/2209.08283</id>",
          "<title>Detecting Generated Scientific Papers using an Ensemble of Transformer Models</title>",
          "<summary>Generated scientific paper detection with transformer models.</summary>",
          "<published>2022-09-18T00:00:00Z</published>",
          "<author><name>A. Classifier</name></author>",
          "</entry>",
          "</feed>",
        ].join(""),
    })) as typeof fetch;

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:scholarly-numeric-missing-terminal-mode",
        agent_runtime: "codex",
        question:
          "Find a scholarly paper with numeric Weyl-curvature invariants for spacetime, extract reported numeric parameters with units, then calculate only if those cited values are available.",
      },
      headers: {},
    });

    expect(result.ok).toBe(true);
    expect(result.text).toContain(
      "needs numeric values from full-text paper evidence",
    );
    expect(result.text).not.toContain("terminal_authority_missing");
    expect((result as any).terminal_artifact_kind).toBe(
      "scholarly_numeric_missing",
    );
    expect(
      (result.debug as any)?.scholarly_response_mode_selection,
    ).toMatchObject({
      selected_response_mode: "scholarly_numeric_missing",
      requested_workflow: "numeric_calculation",
      terminal_evidence_requirement: "calculation_from_numeric_values",
    });
    expect(
      (result.debug as any)?.planned_scholarly_capability_chain,
    ).toMatchObject({
      planned_capabilities: expect.arrayContaining([
        "scholarly-research.lookup_papers",
        "scholarly-research.fetch_full_text",
        "scholarly-research.extract_numeric_parameters",
        "scientific-calculator.solve_expression",
      ]),
      calculator_requires_numeric_evidence: true,
    });
  });

  it("retries recoverable weak scholarly lookups with a refined original-paper query before terminalizing", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "The first Casimir-effect paper lookup was recovered from metadata evidence.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    const seenUrls: string[] = [];
    globalThis.fetch = vi.fn(async (url) => {
      const urlText = String(url);
      seenUrls.push(urlText);
      const decoded = decodeURIComponent(urlText);
      const exactCasimir =
        /Attraction Between Two Perfectly Conducting Plates|original Casimir effect paper|Kon\. Ned\. Akad\. Wet/i.test(
          decoded,
        );
      return {
        ok: true,
        status: 200,
        text: async () =>
          [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<feed xmlns="http://www.w3.org/2005/Atom">',
            "<entry>",
            exactCasimir
              ? "<id>https://arxiv.org/abs/physics/9907001</id>"
              : "<id>https://arxiv.org/abs/1007.0966</id>",
            exactCasimir
              ? "<title>On the Attraction Between Two Perfectly Conducting Plates</title>"
              : "<title>Numerical methods for computing Casimir interactions</title>",
            exactCasimir
              ? "<summary>H. B. G. Casimir's 1948 paper on the attraction between perfectly conducting plates and the Casimir effect.</summary>"
              : "<summary>Numerical methods for later Casimir interaction calculations.</summary>",
            exactCasimir
              ? "<published>1948-01-01T00:00:00Z</published>"
              : "<published>2010-07-06T00:00:00Z</published>",
            exactCasimir
              ? "<author><name>H. B. G. Casimir</name></author>"
              : "<author><name>Steven G. Johnson</name></author>",
            "</entry>",
            "</feed>",
          ].join(""),
      };
    }) as typeof fetch;

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:scholarly-original-paper-retry",
        agent_runtime: "codex",
        question:
          "find the original research paper of the casimir effect by hendrik casimir",
      },
      headers: {},
    });

    expect(
      seenUrls.some((url) =>
        /On%20the%20Attraction%20Between%20Two%20Perfectly%20Conducting%20Plates|On\\+the\\+Attraction\\+Between\\+Two\\+Perfectly\\+Conducting\\+Plates/i.test(
          url,
        ),
      ),
    ).toBe(true);
    expect(
      (result.debug as any)?.workstation_gateway_call_results?.filter(
        (entry: any) =>
          entry.capability_id === "scholarly-research.lookup_papers",
      ),
    ).toHaveLength(2);
    expect(result.ok).toBe(true);
    expect((result as any).terminal_artifact_kind).toBe(
      "scholarly_metadata_answer",
    );
    expect(result.text).toContain(
      "On the Attraction Between Two Perfectly Conducting Plates",
    );
    expect(result.text).toContain("retried after a weak first lookup");
    expect(result.text).not.toContain(
      "Numerical methods for computing Casimir interactions",
    );
    expect(
      (result.debug as any)?.scholarly_response_mode_selection,
    ).toMatchObject({
      selected_response_mode: "scholarly_metadata_answer",
      selected_for_answer: true,
      evidence_state: "lookup_usable",
      recovery_attempts: expect.arrayContaining([
        expect.objectContaining({
          evidence_state: "lookup_weak_match",
          ordinal: 1,
        }),
        expect.objectContaining({
          evidence_state: "lookup_usable",
          ordinal: 2,
        }),
      ]),
    });
  });

  it("does not let rejected weak scholarly attempts block a later re-entered usable observation", () => {
    const rejectedWeakAttempt = {
      ok: false,
      capability_id: "scholarly-research.lookup_papers",
      gateway_admission: {
        requested_capability: "scholarly-research.lookup_papers",
        admitted: true,
        blocked_reason: "lookup_weak_match",
      },
      observation: {
        schema: "helix.scholarly_research_observation.v1",
        evidence_state: "lookup_weak_match",
        selected_for_answer: false,
      },
      artifact_refs: [],
      observation_packet: {
        produced_artifact_refs: [],
      },
    } as any;

    expect(
      providerGatewayEvidenceReadyForSolver({
        gatewayCallResults: [rejectedWeakAttempt],
        scholarlyRecoveryObservationReentered: false,
      }),
    ).toBe(false);
    expect(
      providerGatewayEvidenceReadyForSolver({
        gatewayCallResults: [rejectedWeakAttempt],
        scholarlyRecoveryObservationReentered: true,
      }),
    ).toBe(true);
  });

  it("does not promote later Casimir papers to answer-grade evidence for original-paper requests", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "The first Casimir-effect paper lookup was recovered from metadata evidence.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<feed xmlns="http://www.w3.org/2005/Atom">',
          "<entry>",
          "<id>https://arxiv.org/abs/physics/9907001</id>",
          "<title>Casimir effect between two conducting plates</title>",
          "<summary>A later Physical Review A paper discussing the Casimir effect between two conducting plates.</summary>",
          "<published>1999-01-01T00:00:00Z</published>",
          "<author><name>Reza Matloob</name></author>",
          "</entry>",
          "<entry>",
          "<id>https://arxiv.org/abs/1804.00001</id>",
          "<title>Casimir forces on a bi-anisotropic absorbing magneto-dielectric slab between two parallel conducting plates</title>",
          "<summary>A later paper on Casimir forces involving conducting plates.</summary>",
          "<published>2018-01-01T00:00:00Z</published>",
          "<author><name>Majid Amooshahi</name></author>",
          "</entry>",
          "</feed>",
        ].join(""),
    })) as typeof fetch;

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:scholarly-original-paper-rejects-later-casimir",
        agent_runtime: "codex",
        question:
          "ok fetch the first research paper of the Casimir effect by Henrik Casimir",
      },
      headers: {},
    });

    expect(result.ok).toBe(true);
    expect((result as any).terminal_artifact_kind).not.toBe(
      "scholarly_metadata_answer",
    );
    expect((result as any).terminal_artifact_kind).toBe(
      "scholarly_recovery_plan",
    );
    expect(result.text).toContain(
      "no usable topic-relevant paper was selected",
    );
    expect(result.text).toContain("no full text was fetched");
    expect(result.text).toContain("Evidence state: lookup_weak_match");
    expect(
      (result.debug as any)?.scholarly_response_mode_selection,
    ).toMatchObject({
      selected_for_answer: false,
      evidence_state: "lookup_weak_match",
      selected_response_mode: "scholarly_recovery_plan",
    });
    const lookupCalls = (
      result.debug as any
    )?.workstation_gateway_call_results?.filter(
      (entry: any) =>
        entry.capability_id === "scholarly-research.lookup_papers",
    );
    expect(lookupCalls.length).toBeGreaterThanOrEqual(2);
    expect(lookupCalls.length).toBeLessThanOrEqual(3);
  });

  it("surfaces a bounded scholarly recovery plan when normalized weak-match observations outlive a failed provider follow-up", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "I need retrieval before finalizing this claim. I do not yet have grounded evidence references for it.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "1";
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<feed xmlns="http://www.w3.org/2005/Atom">',
          "<entry>",
          "<id>https://arxiv.org/abs/2607.99999</id>",
          "<title>Unrelated metadata candidate</title>",
          "<summary>This record does not support quantum inequality claims.</summary>",
          "<published>2026-07-01T00:00:00Z</published>",
          "<author><name>A. Researcher</name></author>",
          "</entry>",
          "</feed>",
        ].join(""),
    })) as typeof fetch;

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:scholarly-weak-match-provider-followup-failed",
        agent_runtime: "codex",
        question:
          "Use the scientific claims in your immediately previous answer. Decompose them separately, search arXiv and the other scholarly providers, return a diverse claim-to-citation map, identify accessible full text, and fetch the best three accessible sources. Distinguish metadata-only evidence from full-text evidence.",
        workspace_context_snapshot: {
          chat_referent_context: {
            schema: "helix.ask.chat_referent_context.v1",
            previous_assistant_final_answer: {
              role: "assistant",
              reply_id: "reply-quantum-inequality-claims",
              source_ref:
                "chat.final_answer.previous:reply-quantum-inequality-claims",
              text: [
                "- Quantum inequalities bound sampled negative energy along an observer worldline.",
                "- Longer sampling durations tighten negative-energy magnitude limits.",
                "- Quantum inequalities constrain traversable wormhole and warp-drive geometries.",
              ].join("\n"),
            },
          },
        },
      },
      headers: {},
    });

    expect(result).toMatchObject({
      ok: true,
      response_type: "final_answer",
      final_answer_source: "scholarly_recovery_plan",
      terminal_artifact_kind: "scholarly_recovery_plan",
    });
    expect(result.text).toContain("Evidence state: lookup_weak_match");
    expect(result.text).toContain(
      "no usable topic-relevant paper was selected",
    );
    expect(result.text).not.toContain(
      "I need retrieval before finalizing this claim",
    );
    expect(
      (result.debug as any)?.scholarly_terminal_materialization_debug,
    ).toMatchObject({
      authority_materialized: true,
    });
  });

  it("re-enters prior scholarly metadata evidence for paper follow-up prompts", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "Scholarly metadata evidence is available.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<feed xmlns="http://www.w3.org/2005/Atom">',
          "<entry>",
          "<id>https://arxiv.org/abs/2606.00003</id>",
          "<title>Weyl tensor conformal curvature in general relativity</title>",
          "<summary>This paper discusses Weyl tensor conformal curvature in general relativity.</summary>",
          "<published>2026-06-03T00:00:00Z</published>",
          "<author><name>A. Relativist</name></author>",
          "</entry>",
          "</feed>",
        ].join(""),
    })) as typeof fetch;

    const threadId = "thread:test:scholarly-followup-metadata";
    await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:scholarly-followup-metadata:first",
        thread_id: threadId,
        agent_runtime: "codex",
        question:
          "Search scholarly research papers for Weyl tensor conformal curvature in general relativity.",
      },
      headers: {},
    });

    process.env.CODEX_AGENT_FAKE_STDOUT =
      "Using the re-entered prior scholarly metadata: this is a metadata-level paper record, not fetched full text.";
    const followup = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:scholarly-followup-metadata:second",
        thread_id: threadId,
        agent_runtime: "codex",
        question: "tell me about the paper you found",
      },
      headers: {},
    });

    expect(followup.ok).toBe(true);
    expect(followup.text).toContain("metadata-level paper record");
    expect(
      (followup.debug as any)?.scholarly_followup_evidence_lookup,
    ).toMatchObject({
      status: "found",
      followup_reference_detected: true,
    });
    expect((followup.debug as any)?.evidence_reentry_status).toBe(
      "reentered_prior_scholarly_evidence",
    );
    expect(
      (followup.debug as any)?.prior_scholarly_evidence_observation_packet,
    ).toMatchObject({
      capability_key: "scholarly-research.prior_evidence_recall",
      status: "succeeded",
    });
    expect(
      (followup as any).terminal_presentation?.selected_observation_refs
        ?.length,
    ).toBeGreaterThan(0);
  });

  it("keeps weak prior scholarly evidence as caveated follow-up context", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "Weak Casimir lookup returned nearby candidates only.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<feed xmlns="http://www.w3.org/2005/Atom">',
          "<entry>",
          "<id>https://arxiv.org/abs/physics/9907001</id>",
          "<title>Casimir effect between two conducting plates</title>",
          "<summary>A later paper discussing the Casimir effect between two conducting plates.</summary>",
          "<published>1999-01-01T00:00:00Z</published>",
          "<author><name>Reza Matloob</name></author>",
          "</entry>",
          "</feed>",
        ].join(""),
    })) as typeof fetch;

    const threadId = "thread:test:scholarly-followup-weak";
    await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:scholarly-followup-weak:first",
        thread_id: threadId,
        agent_runtime: "codex",
        question:
          "ok fetch the first research paper of the Casimir effect by Henrik Casimir",
      },
      headers: {},
    });

    process.env.CODEX_AGENT_FAKE_STDOUT =
      "The prior Casimir evidence was exploratory, so I can explain the general Casimir effect but not claim this was the original paper.";
    const followup = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:scholarly-followup-weak:second",
        thread_id: threadId,
        agent_runtime: "codex",
        question:
          "no i mean tell me about the casimir effect that you found the paper for ?",
      },
      headers: {},
    });

    expect(followup.ok).toBe(true);
    expect(followup.text).toContain("exploratory");
    expect(
      (followup.debug as any)?.scholarly_followup_evidence_lookup,
    ).toMatchObject({
      status: "found",
      followup_reference_detected: true,
    });
    expect(
      (followup.debug as any)?.prior_scholarly_evidence_memory_record,
    ).toMatchObject({
      evidence_grade: "exploratory",
    });
    expect((followup.debug as any)?.evidence_reentry_status).toBe(
      "reentered_prior_scholarly_evidence",
    );
  });

  it("blocks numeric scholarly follow-ups when prior evidence is metadata-only", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "Scholarly metadata evidence is available.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<feed xmlns="http://www.w3.org/2005/Atom">',
          "<entry>",
          "<id>https://arxiv.org/abs/2606.00004</id>",
          "<title>Casimir effect between conducting plates</title>",
          "<summary>Metadata about a Casimir effect paper.</summary>",
          "<published>2026-06-04T00:00:00Z</published>",
          "<author><name>A. Physicist</name></author>",
          "</entry>",
          "</feed>",
        ].join(""),
    })) as typeof fetch;

    const threadId = "thread:test:scholarly-followup-numeric";
    await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:scholarly-followup-numeric:first",
        thread_id: threadId,
        agent_runtime: "codex",
        question:
          "Search scholarly research papers for Casimir effect between conducting plates.",
      },
      headers: {},
    });

    process.env.CODEX_AGENT_FAKE_STDOUT =
      "It measured plate separation of 1 nm.";
    const followup = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:scholarly-followup-numeric:second",
        thread_id: threadId,
        agent_runtime: "codex",
        question: "what numbers did it measure?",
      },
      headers: {},
    });

    expect(followup.text).toContain(
      "needs fetched full text and numeric-parameter extraction",
    );
    expect(followup.text).not.toContain("1 nm");
    expect((followup as any).terminal_artifact_kind).toBe(
      "scholarly_numeric_missing",
    );
    expect(
      (followup.debug as any)?.scholarly_response_mode_selection,
    ).toMatchObject({
      selected_response_mode: "scholarly_numeric_missing",
      selected_for_answer: false,
    });
  });

  it("allows metadata-only Theory Badge Graph relevance with caveats and no equations", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "Scholarly metadata evidence is available.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<feed xmlns="http://www.w3.org/2005/Atom">',
          "<entry>",
          "<id>https://arxiv.org/abs/2606.00006</id>",
          "<title>Weyl tensor conformal curvature in general relativity</title>",
          "<summary>   </summary>",
          "<published>2026-06-06T00:00:00Z</published>",
          "<author><name>A. Relativist</name></author>",
          "</entry>",
          "</feed>",
        ].join(""),
    })) as typeof fetch;

    const threadId = "thread:test:scholarly-followup-theory-metadata-only";
    await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:scholarly-followup-theory-metadata-only:first",
        thread_id: threadId,
        agent_runtime: "codex",
        question:
          "Search scholarly research papers for Weyl tensor conformal curvature in general relativity.",
      },
      headers: {},
    });

    process.env.CODEX_AGENT_FAKE_STDOUT =
      "Metadata-level relevance only: this title can be reflected to the Theory Badge Graph as a possible Weyl/conformal-curvature literature node, but no equations were extracted.";
    const followup = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:scholarly-followup-theory-metadata-only:second",
        thread_id: threadId,
        agent_runtime: "codex",
        question:
          "Reflect this paper's relevance to the Theory Badge Graph, but only use the evidence level you actually have.",
      },
      headers: {},
    });

    expect(followup.ok).toBe(true);
    expect(followup.text).toContain(
      "can be reflected to the Theory Badge Graph",
    );
    expect(followup.text).toContain("Evidence depth: metadata_lookup");
    expect(followup.text).toContain(
      "No scientific evidence packet is materialized",
    );
    expect(followup.text).toContain("Do not treat this as proof");
    expect(
      (followup.debug as any)?.scholarly_evidence_escalation_plan,
    ).toMatchObject({
      selected_evidence_depth: "metadata_lookup",
      evidence_depth_reason:
        "request_can_be_answered_as_metadata_level_relevance_with_caveats",
      full_text_fetch_status: "not_requested",
      pdf_render_status: "not_requested",
      theory_badge_graph_reflection_ref: expect.stringContaining(
        "artifact://scholarly-theory-badge-graph-reflection/",
      ),
    });
    expect(
      (followup.debug as any)?.scholarly_response_mode_selection
        ?.theory_badge_graph_reflection_candidate,
    ).toMatchObject({
      schema: "helix.scholarly_theory_badge_graph_reflection_candidate.v1",
      strongest_materialized_evidence_depth: "metadata_lookup",
      evidence_maturity: "metadata_only",
      graph_ingestion_status: "candidate_only",
      claim_boundary: expect.objectContaining({
        metadataOnly: true,
        notProofAuthority: true,
      }),
    });
  });

  it("allows abstract-level Theory Badge Graph relevance while exposing scholarly evidence depth", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "Scholarly metadata evidence is available.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<feed xmlns="http://www.w3.org/2005/Atom">',
          "<entry>",
          "<id>https://arxiv.org/abs/2606.00007</id>",
          "<title>Weyl tensor conformal curvature in general relativity</title>",
          "<summary>Metadata about Weyl tensor conformal curvature in general relativity.</summary>",
          "<published>2026-06-07T00:00:00Z</published>",
          "<author><name>A. Relativist</name></author>",
          "</entry>",
          "</feed>",
        ].join(""),
    })) as typeof fetch;

    const threadId = "thread:test:scholarly-followup-theory-depth";
    await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:scholarly-followup-theory-depth:first",
        thread_id: threadId,
        agent_runtime: "codex",
        question:
          "Search scholarly research papers for Weyl tensor conformal curvature in general relativity.",
      },
      headers: {},
    });

    process.env.CODEX_AGENT_FAKE_STDOUT =
      "Metadata-level relevance only: this paper can be reflected to the Theory Badge Graph as a possible Weyl/conformal-curvature literature node, but no equations were extracted.";
    const followup = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:scholarly-followup-theory-depth:second",
        thread_id: threadId,
        agent_runtime: "codex",
        question:
          "Reflect this paper's relevance to the Theory Badge Graph, but only use the evidence level you actually have.",
      },
      headers: {},
    });

    expect(followup.ok).toBe(true);
    expect(followup.text).toContain(
      "can be reflected to the Theory Badge Graph",
    );
    expect(followup.text).toContain("Evidence depth: abstract_or_snippet");
    expect(followup.text).toContain(
      "No scientific evidence packet is materialized",
    );
    expect(followup.text).toContain("Do not treat this as proof");
    expect(
      (followup.debug as any)?.scholarly_followup_evidence_lookup,
    ).toMatchObject({
      status: "found",
      followup_reference_detected: true,
    });
    expect(
      (followup.debug as any)?.scholarly_evidence_escalation_plan,
    ).toMatchObject({
      selected_evidence_depth: "abstract_or_snippet",
      evidence_depth_reason:
        "request_can_use_provider_abstract_or_snippet_with_caveats",
      full_text_fetch_status: "not_requested",
      pdf_render_status: "not_requested",
      theory_badge_graph_reflection_ref: expect.stringContaining(
        "artifact://scholarly-theory-badge-graph-reflection/",
      ),
    });
    expect(
      (followup.debug as any)?.scholarly_response_mode_selection
        ?.theory_badge_graph_reflection_candidate,
    ).toMatchObject({
      schema: "helix.scholarly_theory_badge_graph_reflection_candidate.v1",
      strongest_materialized_evidence_depth: "abstract_or_snippet",
      evidence_maturity: "provider_abstract_or_snippet",
      graph_ingestion_status: "candidate_only",
      claim_boundary: expect.objectContaining({
        abstractOrSnippetOnly: true,
        notProofAuthority: true,
      }),
    });
  });

  it("prioritizes scholarly follow-up projection over active document and Theory Badge Graph compound synthesis", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "Scholarly metadata evidence is available.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<feed xmlns="http://www.w3.org/2005/Atom">',
          "<entry>",
          "<id>https://arxiv.org/abs/2606.00010</id>",
          "<title>Weyl tensor conformal curvature in general relativity</title>",
          "<summary>Abstract evidence about Weyl tensor conformal curvature in general relativity.</summary>",
          "<published>2026-06-10T00:00:00Z</published>",
          "<author><name>A. Relativist</name></author>",
          "</entry>",
          "</feed>",
        ].join(""),
    })) as typeof fetch;

    const threadId = "thread:test:scholarly-followup-preempts-doc-theory";
    await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:scholarly-followup-preempts-doc-theory:first",
        thread_id: threadId,
        agent_runtime: "codex",
        question:
          "Search scholarly research papers for Weyl tensor conformal curvature in general relativity.",
      },
      headers: {},
    });

    process.env.CODEX_AGENT_FAKE_STDOUT = [
      "Based on the available evidence, this paper is relevant to the Theory Badge Graph only at a diagnostic / mapping level.",
      "The active document is the NHM2 whitepaper and the reflection found 0 exact badge matches and 12 likely matches.",
    ].join("\n");
    const followup = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:scholarly-followup-preempts-doc-theory:second",
        thread_id: threadId,
        agent_runtime: "codex",
        question:
          "Reflect this paper's relevance to the Theory Badge Graph, but only use the evidence level you actually have.",
        workstation_gateway_calls: [
          {
            capability_id: "docs.search",
            mode: "read",
            arguments: {
              query: "physical viability locked out",
              paths: ["docs/research/nhm2-current-status-whitepaper.md"],
              max_hits: 2,
            },
          },
          {
            capability_id: "theory-badge-graph.reflect_discussion_context",
            mode: "read",
            arguments: {
              prompt:
                "Reflect NHM2 current status whitepaper diagnostic claim boundaries against the Theory Badge Graph.",
              mentioned_domains: ["NHM2", "claim boundaries"],
              build_explanation_plan: true,
              limit: 4,
            },
          },
        ],
      },
      headers: {},
    });

    expect(followup.ok).toBe(true);
    expect(followup.text).toContain(
      "Weyl tensor conformal curvature in general relativity",
    );
    expect(followup.text).toContain("Evidence depth: abstract_or_snippet");
    expect(followup.text).toContain(
      "No scientific evidence packet is materialized",
    );
    expect(followup.text).not.toContain(
      "active document is the NHM2 whitepaper",
    );
    expect((followup as any).terminal_artifact_kind).toBe(
      "scholarly_metadata_answer",
    );
    expect((followup as any).final_answer_source).toBe(
      "scholarly_metadata_answer",
    );
    expect(
      (followup.debug as any)?.provider_gateway_debug_summary,
    ).toMatchObject({
      terminal_authority_result:
        "authorized_by_terminal_authority_single_writer",
      final_answer_source: "scholarly_metadata_answer",
      terminal_artifact_kind: "scholarly_metadata_answer",
    });
    expect(
      (followup.debug as any)?.compound_evidence_synthesis_answer,
    ).toBeNull();
    expect((followup.debug as any)?.terminal_presentation).toMatchObject({
      terminal_artifact_kind: "scholarly_metadata_answer",
      final_answer_source: "scholarly_metadata_answer",
      presentation_policy: "scholarly_response_mode_with_caveats",
    });
    expect(
      (followup.debug as any)?.scholarly_evidence_escalation_plan,
    ).toMatchObject({
      selected_evidence_depth: "abstract_or_snippet",
      theory_badge_graph_reflection_ref: expect.stringContaining(
        "artifact://scholarly-theory-badge-graph-reflection/",
      ),
    });
  });

  it("keeps missing scholarly follow-up recovery from terminalizing as document graph compound synthesis", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT = [
      "I cannot answer from the paper I found earlier because no prior scholarly evidence packet was recoverable for this turn.",
      "Ask me to rerun the scholarly lookup, provide a DOI/arXiv id, or refer to a specific paper title so Helix can create bounded paper evidence first.",
    ].join("\n");
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:scholarly-followup-missing-preempts-doc-theory",
        thread_id: "thread:test:scholarly-followup-missing-preempts-doc-theory",
        agent_runtime: "codex",
        question:
          "Reflect this paper's relevance to the Theory Badge Graph, but only use the evidence level you actually have.",
        workstation_gateway_calls: [
          {
            capability_id: "docs.search",
            mode: "read",
            arguments: {
              query: "physical viability locked out",
              paths: ["docs/research/nhm2-current-status-whitepaper.md"],
              max_hits: 2,
            },
          },
          {
            capability_id: "theory-badge-graph.reflect_discussion_context",
            mode: "read",
            arguments: {
              prompt:
                "Reflect NHM2 current status whitepaper diagnostic claim boundaries against the Theory Badge Graph.",
              mentioned_domains: ["NHM2", "claim boundaries"],
              build_explanation_plan: true,
              limit: 4,
            },
          },
        ],
      },
      headers: {},
    });

    expect(result.ok).toBe(true);
    expect(result.text).toContain(
      "no prior scholarly evidence packet was recoverable",
    );
    expect((result as any).terminal_artifact_kind).toBe(
      "scholarly_recovery_plan",
    );
    expect((result as any).final_answer_source).toBe("scholarly_recovery_plan");
    expect((result.debug as any)?.provider_gateway_debug_summary).toMatchObject(
      {
        terminal_authority_result:
          "authorized_by_terminal_authority_single_writer",
        final_answer_source: "scholarly_recovery_plan",
        terminal_artifact_kind: "scholarly_recovery_plan",
      },
    );
    expect(
      (result.debug as any)?.compound_evidence_synthesis_answer,
    ).toBeNull();
    expect((result.debug as any)?.terminal_presentation).toMatchObject({
      terminal_artifact_kind: "scholarly_recovery_plan",
      final_answer_source: "scholarly_recovery_plan",
      presentation_policy: "scholarly_response_mode_with_caveats",
    });
    expect(
      (result.debug as any)?.scholarly_response_mode_selection,
    ).toMatchObject({
      selected_response_mode: "scholarly_recovery_plan",
      missing_requirements: expect.arrayContaining([
        "prior_scholarly_evidence_packet_unavailable",
      ]),
    });
  });

  it("blocks equation and scientific packet follow-ups when prior scholarly evidence is metadata-only", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "Scholarly metadata evidence is available.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<feed xmlns="http://www.w3.org/2005/Atom">',
          "<entry>",
          "<id>https://arxiv.org/abs/2606.00008</id>",
          "<title>Casimir effect between conducting plates</title>",
          "<summary>Metadata about a Casimir effect paper.</summary>",
          "<published>2026-06-08T00:00:00Z</published>",
          "<author><name>A. Physicist</name></author>",
          "</entry>",
          "</feed>",
        ].join(""),
    })) as typeof fetch;

    const threadId = "thread:test:scholarly-followup-equation-packet";
    await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:scholarly-followup-equation-packet:first",
        thread_id: threadId,
        agent_runtime: "codex",
        question:
          "Search scholarly research papers for Casimir effect between conducting plates.",
      },
      headers: {},
    });

    process.env.CODEX_AGENT_FAKE_STDOUT =
      "The paper equation is F = hbar c pi^2 A / 240 a^4 and I made a scientific evidence packet.";
    const followup = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:scholarly-followup-equation-packet:second",
        thread_id: threadId,
        agent_runtime: "codex",
        question:
          "Use that paper's equations and put them in a scientific evidence packet for the Theory Badge Graph.",
      },
      headers: {},
    });

    expect(followup.ok).toBe(true);
    expect(followup.text).toContain("needs deeper paper evidence");
    expect(followup.text).toContain(
      "Requested evidence depth: scientific_evidence_packet",
    );
    expect(followup.text).toContain("equation_extraction_refs_missing");
    expect(followup.text).not.toContain("F = hbar");
    expect((followup as any).terminal_artifact_kind).toBe(
      "scholarly_evidence_escalation_missing",
    );
    expect(
      (followup.debug as any)?.scholarly_response_mode_selection,
    ).toMatchObject({
      selected_response_mode: "scholarly_evidence_escalation_missing",
      selected_for_answer: false,
    });
    expect(
      (followup.debug as any)?.scholarly_evidence_escalation_plan,
    ).toMatchObject({
      selected_evidence_depth: "scientific_evidence_packet",
      full_text_fetch_status: "required",
      pdf_render_status: "required",
      scientific_evidence_packet_ref: null,
    });
    expect(
      (followup.debug as any)?.scholarly_response_mode_selection
        ?.theory_badge_graph_reflection_candidate,
    ).toMatchObject({
      strongest_materialized_evidence_depth: "abstract_or_snippet",
      evidence_maturity: "provider_abstract_or_snippet",
      scientific_evidence_packet_ref: null,
      claim_boundary: expect.objectContaining({
        scientificPacketMaterialized: false,
        notProofAuthority: true,
      }),
    });
  });

  it("exposes prior scholarly PDF page-image work as a typed next step for equation extraction", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "Scholarly full-text fetch needs page-image parsing.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    process.env.HELIX_IMAGE_LENS_EXTRACTION_BACKEND = "fixture";
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify({
      entries: [
        {
          region_label: "scholarly_pdf_page_1_equation_pass",
          text_candidate: "The scanned page defines the plate force equation.",
          latex_candidate: "F = -\\frac{\\pi^2 \\hbar c A}{240 a^4}",
          extraction_status: "extracted",
          uncertainty: ["fixture OCR for scholarly PDF page"],
        },
      ],
    });
    const scannedPdfBase64 = [
      "JVBERi0xLjMKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSCj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhIC9FbmNvZGluZyAvV2luQW5zaUVuY29kaW5nIC9OYW1lIC9GMSAvU3VidHlwZSAvVHlwZTEgL1R5cGUgL0ZvbnQKPj4KZW5kb2JqCjMgMCBvYmoKPDwKL0NvbnRlbnRzIDcgMCBSIC9NZWRpYUJveCBbIDAgMCAyMDAgMjAwIF0gL1BhcmVudCA2IDAgUiAvUmVzb3VyY2VzIDw8Ci9Gb250IDEgMCBSIC9Qcm9jU2V0IFsgL1BERiAvVGV4dCAvSW1hZ2VCIC9JbWFnZUMgL0ltYWdlSSBdCj4+IC9Sb3RhdGUgMCAvVHJhbnMgPDwKCj4+IAogIC9UeXBlIC9QYWdlCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9QYWdlTW9kZSAvVXNlTm9uZSAvUGFnZXMgNiAwIFIgL1R5cGUgL0NhdGFsb2cKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL0F1dGhvciAoYW5vbnltb3VzKSAvQ3JlYXRpb25EYXRlIChEOjIwMjYwNzA2MjAzODEyLTA0JzAwJykgL0NyZWF0b3IgKGFub255bW91cykgL0tleXdvcmRzICgpIC9Nb2REYXRlIChEOjIwMjYwNzA2MjAzODEyLTA0JzAwJykgL1Byb2R1Y2VyIChSZXBvcnRMYWIgUERGIExpYnJhcnkgLSBcKG9wZW5zb3VyY2VcKSkgCiAgL1N1YmplY3QgKHVuc3BlY2lmaWVkKSAvVGl0bGUgKHVudGl0bGVkKSAvVHJhcHBlZCAvRmFsc2UKPj4KZW5kb2JqCjYgMCBvYmoKPDwKL0NvdW50IDEgL0tpZHMgWyAzIDAgUiBdIC9UeXBlIC9QYWdlcwo+PgplbmRvYmoKNyAwIG9iago8PAovRmlsdGVyIFsgL0FTQ0lJODVEZWNvZGUgL0ZsYXRlRGVjb2RlIF0gL0xlbmd0aCA5NQo+PgpzdHJlYW0KR2FwUWgwRT1GLDBVXEgzVFxwTllUXlFLaz90Yz5JUCw7VyNVMV4yM2loUEVNXz9DVzRLSVNoWyZrMyc0K2g3cHVET0thOCRBT3VWK14jLXE9cy5BYD5RQzBNJjlSfj5lbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA4CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDA2MSAwMDAwIG4gCjAwMDAwMDAwOTIgMDAwMDAgbiAKMDAwMDAwMDE5OSAwMDAwMCBuIAowMDAwMDAwMzkyIDAwMDAwIG4gCjAwMDAwMDA0NjAgMDAwMDAgbiAKMDAwMDAwMDcyMSAwMDAwMCBuIAowMDAwMDAwNzgwIDAwMDAwIG4gCnRyYWlsZXIKPDwKL0lEIApbPGIzMGQzOTU0ZWFiODI4YTFmMGNhN2I1ZjZhODVmMTExPjxiMzBkMzk1NGVhYjgyOGExZjBjYTdiNWY2YTg1ZjExMT5dCiUgUmVwb3J0TGFiIGdlbmVyYXRlZCBQREYgZG9jdW1lbnQgLS0gZGlnZXN0IChvcGVuc291cmNlKQoKL0luZm8gNSAwIFIKL1Jvb3QgNCAwIFIKL1NpemUgOAo+PgpzdGFydHhyZWYKOTY0CiUlRU9GCg==",
    ].join("");
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("export.arxiv.org")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            [
              '<?xml version="1.0" encoding="UTF-8"?>',
              '<feed xmlns="http://www.w3.org/2005/Atom">',
              "<entry>",
              "<id>https://arxiv.org/abs/2606.00009</id>",
              "<title>Scanned Casimir Equation Plate Evidence</title>",
              "<summary>This paper has a scanned equation figure for Casimir plate evidence.</summary>",
              "<published>2026-06-09T00:00:00Z</published>",
              "<author><name>A. Scanner</name></author>",
              "</entry>",
              "</feed>",
            ].join(""),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "content-type" ? "application/pdf" : null,
        },
        arrayBuffer: async () => {
          const bytes = Buffer.from(scannedPdfBase64, "base64");
          return bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          );
        },
      };
    }) as typeof fetch;

    const threadId = "thread:test:scholarly-followup-page-image-required";
    await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:scholarly-followup-page-image-required:first",
        thread_id: threadId,
        agent_runtime: "codex",
        question:
          "Find a scholarly paper for scanned Casimir equation plate evidence, fetch full text if available, and summarize only from fetched text.",
      },
      headers: {},
    });

    process.env.CODEX_AGENT_FAKE_STDOUT =
      "Using the re-entered Image Lens page evidence: the extracted equation candidate is page-grounded and observation-only.";
    const followup = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:scholarly-followup-page-image-required:second",
        thread_id: threadId,
        agent_runtime: "codex",
        question:
          "Extract equations from that paper for the Theory Badge Graph.",
      },
      headers: {},
    });

    expect(followup.ok).toBe(true);
    expect(followup.text).toContain(
      "needs deeper paper evidence than the current record contains",
    );
    expect(followup.text).toContain(
      "Requested evidence depth: page_image_parse",
    );
    expect(followup.text).toContain("render PDF pages into Image Lens");
    expect(followup.text).not.toContain("F = invented");
    expect(
      (followup.debug as any)?.prior_scholarly_evidence_memory_record,
    ).toMatchObject({
      evidence_state: "lookup_usable",
    });
    expect(
      (followup.debug as any)?.runtime_lane_request_loop ?? null,
    ).toBeNull();
    expect(
      (followup.debug as any)?.capability_lane_observation_packets ?? [],
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability_key: "visual_analysis.inspect_image_region",
          status: "succeeded",
        }),
      ]),
    );
    expect(
      (followup.debug as any)?.scholarly_response_mode_selection,
    ).toMatchObject({
      selected_response_mode: "scholarly_evidence_escalation_missing",
      terminal_artifact_kind: "scholarly_evidence_escalation_missing",
    });

    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify({
      entries: [
        {
          region_label: "scholarly_pdf_page_2_equation_pass",
          text_candidate:
            "The next rendered page contains the displayed equation candidate.",
          latex_candidate: "E_2 = \\frac{1}{2}\\sum_n \\omega_n",
          extraction_status: "extracted",
          uncertainty: ["fixture OCR for scholarly PDF page 2"],
        },
      ],
    });
    delete process.env.CODEX_AGENT_FAKE_STDOUT;
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        'HELIX_CAPABILITY_LANE_REQUEST_JSON: {"capability":"visual_analysis.inspect_image_region","bbox_px":{"x":0,"y":0,"width":1224,"height":1584},"question":"Extract the first exact displayed equation from page 2.","region_label":"scholarly_pdf_page_2_equation_pass","reason_for_crop":"User requested the next page equation.","assistant_answer":false,"terminal_eligible":false}',
        "Using page 2 Image Lens evidence, the extracted equation candidate is page-grounded.",
      ],
    });

    const nextPageFollowup = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:scholarly-followup-page-image-required:third",
        thread_id: threadId,
        agent_runtime: "codex",
        question:
          "Now inspect page 2 of that same paper and extract the first exact displayed equation with page evidence.",
      },
      headers: {},
    });

    expect(nextPageFollowup.ok).toBe(true);
    expect(nextPageFollowup.text).toContain(
      "needs deeper paper evidence than the current record contains",
    );
    expect(nextPageFollowup.text).toContain("render PDF pages into Image Lens");
    expect(
      (nextPageFollowup.debug as any)?.capability_lane_observation_packets ??
        [],
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability_key: "visual_analysis.inspect_image_region",
          status: "succeeded",
        }),
      ]),
    );

    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify({
      entries: [
        {
          region_label: "scholarly_pdf_page_2_equation_pass",
          text_candidate:
            "The rerendered page contains the displayed equation candidate.",
          latex_candidate: "E_2 = \\frac{1}{2}\\sum_n \\omega_n",
          extraction_status: "extracted",
          uncertainty: ["fixture OCR for rerendered scholarly PDF page 2"],
        },
      ],
    });
    process.env.CODEX_AGENT_FAKE_CALL_INDEX = "0";
    process.env.CODEX_AGENT_FAKE_STDOUT_SEQUENCE = JSON.stringify({
      sequence: [
        "I can’t render or inspect page 2 from this turn because no Image Lens page render, source_id, page image ref, or visual observation packet was provided.",
        "Using rerendered page 2 Image Lens evidence, the extracted equation candidate is page-grounded.",
      ],
    });

    const higherResolutionFollowup = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:scholarly-followup-page-image-required:fourth",
        thread_id: threadId,
        agent_runtime: "codex",
        question:
          "Render page 2 again at higher resolution, inspect the full page for equation-like rows, and return the best row bbox candidates even if exact promotion is not yet allowed.",
      },
      headers: {},
    });

    expect(higherResolutionFollowup.ok).toBe(true);
    expect(higherResolutionFollowup.text).toContain(
      "needs deeper paper evidence than the current record contains",
    );
    expect(
      (higherResolutionFollowup.debug as any)
        ?.scholarly_followup_evidence_lookup,
    ).toMatchObject({
      status: "found",
      followup_reference_detected: true,
    });
    expect(
      (higherResolutionFollowup.debug as any)
        ?.capability_lane_observation_packets ?? [],
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability_key: "visual_analysis.inspect_image_region",
          status: "succeeded",
        }),
      ]),
    );
  });

  it("keeps current-turn scholarly PDF parsing as a bounded escalation when asked to show the science", async () => {
    resetScholarlyPdfWorkbenchVolatileMemoryForTest({ persistent: true });
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "I found an accessible PDF, rendered pages 1-3, extracted the main equation candidates, and created a scientific evidence packet.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    process.env.HELIX_IMAGE_LENS_EXTRACTION_BACKEND = "fixture";
    process.env.HELIX_IMAGE_LENS_EXTRACTION_FIXTURES = JSON.stringify({
      entries: [
        {
          region_label: "scholarly_pdf_page_1_equation_pass",
          text_candidate:
            "The rendered PDF page shows the parallel-plate Casimir force law.",
          latex_candidate: "F = -\\frac{\\pi^2 \\hbar c A}{240 a^4}",
          extraction_status: "extracted",
          uncertainty: ["fixture OCR for current-turn scholarly PDF page"],
        },
        {
          region_label: "scholarly_pdf_page_1_visual_pass",
          text_candidate: "The rendered PDF page evidence was created.",
          extraction_status: "extracted",
          uncertainty: ["fixture OCR for explicit arXiv page render"],
        },
        {
          region_label: "scholarly_pdf_page_2_equation_pass",
          text_candidate:
            "The next page contains the displayed equation candidate.",
          latex_candidate: "R_{\\mu\\nu} - \\frac{1}{2}Rg_{\\mu\\nu}=0",
          extraction_status: "extracted",
          uncertainty: ["fixture OCR for same-paper next-page equation search"],
        },
      ],
    });
    const scannedPdfBase64 = [
      "JVBERi0xLjMKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSCj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhIC9FbmNvZGluZyAvV2luQW5zaUVuY29kaW5nIC9OYW1lIC9GMSAvU3VidHlwZTEgL1R5cGUgL0ZvbnQKPj4KZW5kb2JqCjMgMCBvYmoKPDwKL0NvbnRlbnRzIDcgMCBSIC9NZWRpYUJveCBbIDAgMCAyMDAgMjAwIF0gL1BhcmVudCA2IDAgUiAvUmVzb3VyY2VzIDw8Ci9Gb250IDEgMCBSIC9Qcm9jU2V0IFsgL1BERiAvVGV4dCAvSW1hZ2VCIC9JbWFnZUMgL0ltYWdlSSBdCj4+IC9Sb3RhdGUgMCAvVHJhbnMgPDwKCj4+IAogIC9UeXBlIC9QYWdlCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9QYWdlTW9kZSAvVXNlTm9uZSAvUGFnZXMgNiAwIFIgL1R5cGUgL0NhdGFsb2cKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL0F1dGhvciAoYW5vbnltb3VzKSAvQ3JlYXRpb25EYXRlIChEOjIwMjYwNzA2MjAzODEyLTA0JzAwJykgL0NyZWF0b3IgKGFub255bW91cykgL0tleXdvcmRzICgpIC9Nb2REYXRlIChEOjIwMjYwNzA2MjAzODEyLTA0JzAwJykgL1Byb2R1Y2VyIChSZXBvcnRMYWIgUERGIExpYnJhcnkgLSBcKG9wZW5zb3VyY2VcKSkgCiAgL1N1YmplY3QgKHVuc3BlY2lmaWVkKSAvVGl0bGUgKHVudGl0bGVkKSAvVHJhcHBlZCAvRmFsc2UKPj4KZW5kb2JqCjYgMCBvYmoKPDwKL0NvdW50IDEgL0tpZHMgWyAzIDAgUiBdIC9UeXBlIC9QYWdlcwo+PgplbmRvYmoKNyAwIG9iago8PAovRmlsdGVyIFsgL0FTQ0lJODVEZWNvZGUgL0ZsYXRlRGVjb2RlIF0gL0xlbmd0aCA5NQo+PgpzdHJlYW0KR2FwUWgwRT1GLDBVXEgzVFxwTllUXlFLaz90Yz5JUCw7VyNVMV4yM2loUEVNXz9DVzRLSVNoWyZrMyc0K2g3cHVET0thOCRBT3VWK14jLXE9cy5BYD5RQzBNJjlSfj5lbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA4CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDA2MSAwMDAwIG4gCjAwMDAwMDAwOTIgMDAwMDAgbiAKMDAwMDAwMDE5OSAwMDAwMCBuIAowMDAwMDAwMzkyIDAwMDAwIG4gCjAwMDAwMDA0NjAgMDAwMDAgbiAKMDAwMDAwMDcyMSAwMDAwMCBuIAowMDAwMDAwNzgwIDAwMDAwIG4gCnRyYWlsZXIKPDwKL0lEIApbPGIzMGQzOTU0ZWFiODI4YTFmMGNhN2I1ZjZhODVmMTExPjxiMzBkMzk1NGVhYjgyOGExZjBjYTdiNWY2YTg1ZjExMT5dCiUgUmVwb3J0TGFiIGdlbmVyYXRlZCBQREYgZG9jdW1lbnQgLS0gZGlnZXN0IChvcGVuc291cmNlKQoKL0luZm8gNSAwIFIKL1Jvb3QgNCAwIFIKL1NpemUgOAo+PgpzdGFydHhyZWYKOTY0CiUlRU9GCg==",
    ].join("");
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("export.arxiv.org")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            [
              '<?xml version="1.0" encoding="UTF-8"?>',
              '<feed xmlns="http://www.w3.org/2005/Atom">',
              "<entry>",
              "<id>https://arxiv.org/abs/2606.00010</id>",
              "<title>Casimir effect between conducting plates scanned equation evidence</title>",
              "<summary>This paper studies the Casimir effect between conducting plates and includes equation evidence.</summary>",
              "<published>2026-06-10T00:00:00Z</published>",
              "<author><name>A. Current Scanner</name></author>",
              "</entry>",
              "</feed>",
            ].join(""),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "content-type" ? "application/pdf" : null,
        },
        arrayBuffer: async () => {
          const bytes = Buffer.from(scannedPdfBase64, "base64");
          return bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          );
        },
      };
    }) as typeof fetch;

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:current-turn-scholarly-show-science",
        thread_id: "thread:test:current-turn-scholarly-show-science",
        agent_runtime: "codex",
        question:
          "Find a paper on the Casimir effect between conducting plates and show me the science.",
      },
      headers: {},
    });

    expect(result.ok).toBe(true);
    expect(result.text).toContain("found scholarly metadata");
    expect(result.text).toContain("request asked for full-text evidence");
    expect(result.text).toContain(
      "fetch full text for a selected DOI, arXiv id, PDF URL, or full-text source",
    );
    expect(result.text).not.toContain("I found an accessible PDF");
    expect((result.debug as any)?.runtime_lane_request_loop ?? null).toBeNull();
    expect(
      (result.debug as any)?.current_turn_scholarly_deep_evidence_record ??
        null,
    ).toBeNull();
    expect(
      (result.debug as any)?.scholarly_response_mode_selection,
    ).toMatchObject({
      selected_response_mode: "scholarly_recovery_plan",
      terminal_artifact_kind: "scholarly_recovery_plan",
    });
  }, 30_000);

  it("does not claim a DOI has no accessible PDF before the fetch affordance is executed", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT = "Metadata found.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("export.arxiv.org")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>',
        };
      }
      if (url.includes("api.openalex.org")) {
        return { ok: false, status: 429, json: async () => ({}) };
      }
      if (url.includes("api.crossref.org")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: {
              items: [
                {
                  title: [
                    "Casimir effect between conducting plates metadata only",
                  ],
                  DOI: "10.5555/no-pdf-casimir",
                  URL: "https://doi.org/10.5555/no-pdf-casimir",
                  author: [{ given: "M.", family: "Metadata" }],
                  published: { "date-parts": [[2026]] },
                  "container-title": ["Metadata Journal"],
                },
              ],
            },
          }),
        };
      }
      if (url.includes("api.semanticscholar.org")) {
        return { ok: false, status: 429, json: async () => ({}) };
      }
      if (url.includes("doi.org/10.5555/no-pdf-casimir")) {
        const bytes = new TextEncoder().encode(
          "<html><body><p>Publisher landing page without a PDF link.</p></body></html>",
        );
        return {
          ok: true,
          status: 200,
          headers: {
            get: (name: string) =>
              name.toLowerCase() === "content-type" ? "text/html" : null,
          },
          arrayBuffer: async () => bytes.buffer,
        };
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => "",
      };
    }) as typeof fetch;

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:scholarly-show-science-no-pdf",
        thread_id: "thread:test:scholarly-show-science-no-pdf",
        agent_runtime: "codex",
        question:
          "Find a paper on the Casimir effect between conducting plates and show me the science.",
      },
      headers: {},
    });

    expect(result.ok).toBe(true);
    expect(result.text).toContain("found scholarly metadata");
    expect(result.text).toContain("request asked for full-text evidence");
    expect(result.text).toContain(
      "fetch full text for a selected DOI, arXiv id, PDF URL, or full-text source",
    );
    expect(result.text).not.toContain("no accessible PDF/full text");
    expect((result.debug as any)?.runtime_lane_request_loop ?? null).toBeNull();
    expect(
      (result.debug as any)?.scholarly_response_mode_selection,
    ).toMatchObject({
      selected_response_mode: "scholarly_recovery_plan",
      terminal_artifact_kind: "scholarly_recovery_plan",
      missing_requirements: expect.arrayContaining([
        "lookup_result_irrelevant",
      ]),
    });
  });

  it("prefers fetchable scholarly PDF candidates over first blocked metadata candidates", async () => {
    const intent = extractScholarlyIntent(
      "Find a paper on the Casimir effect between conducting plates and show me the science.",
    );
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("api.openalex.org")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: [
              {
                id: "https://openalex.org/W403",
                title:
                  "Casimir effect between conducting plates blocked publisher landing",
                publication_year: 2026,
                ids: { doi: "https://doi.org/10.5555/openalex-403" },
                authorships: [{ author: { display_name: "O. Blocked" } }],
                primary_location: {
                  landing_page_url: "https://blocked.example/casimir",
                  source: { display_name: "Blocked Journal" },
                },
                open_access: {
                  is_oa: true,
                  oa_url: "https://blocked.example/casimir",
                },
              },
            ],
          }),
        };
      }
      if (url.includes("export.arxiv.org")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            [
              '<?xml version="1.0" encoding="UTF-8"?>',
              '<feed xmlns="http://www.w3.org/2005/Atom">',
              "<entry>",
              "<id>https://arxiv.org/abs/2606.00011</id>",
              "<title>Casimir effect between conducting plates accessible PDF evidence</title>",
              "<summary>This paper studies the Casimir effect between conducting plates and has accessible PDF evidence.</summary>",
              "<published>2026-06-11T00:00:00Z</published>",
              "<author><name>A. Accessible</name></author>",
              "</entry>",
              "</feed>",
            ].join(""),
        };
      }
      if (url.includes("arxiv.org/pdf/2606.00011")) {
        return {
          ok: false,
          status: 418,
          headers: { get: () => "text/plain" },
          arrayBuffer: async () =>
            new TextEncoder().encode("fixture stops after source selection")
              .buffer,
        };
      }
      return {
        ok: false,
        status: 403,
        headers: { get: () => "text/plain" },
        arrayBuffer: async () => new TextEncoder().encode("blocked").buffer,
        json: async () => ({}),
        text: async () => "",
      };
    }) as typeof fetch;

    const results = await runExplicitWorkstationGatewayCalls({
      agentRuntime: "codex",
      turnId: "ask:test:scholarly-fetchable-candidate-selection",
      body: {
        turn_id: "ask:test:scholarly-fetchable-candidate-selection",
        agent_runtime: "codex",
        question:
          "Find a paper on the Casimir effect between conducting plates and show me the science.",
        workstation_gateway_calls: [
          {
            capability_id: "scholarly-research.lookup_papers",
            mode: "read",
            compound_outcome: "scholarly_research_workflow",
            arguments: {
              query: "Casimir effect between conducting plates",
              providers: ["openalex", "arxiv"],
              limit: 5,
              allow_scholarly_dependent_chain: true,
              scholarly_intent: intent,
              planned_scholarly_capability_chain: {
                schema: "helix.scholarly_capability_chain_plan.v1",
                requested_workflow: "full_text_summary",
                planned_capabilities: [
                  "scholarly-research.lookup_papers",
                  "scholarly-research.fetch_full_text",
                ],
                terminal_evidence_requirement: "full_text",
                calculator_requires_numeric_evidence: false,
                assistant_answer: false,
                raw_content_included: false,
              },
            },
          },
        ],
      },
    });

    expect(results.map((result) => result.capability_id)).toEqual([
      "scholarly-research.lookup_papers",
    ]);
    expect((results[0].observation as any).papers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_providers: expect.arrayContaining(["arxiv"]),
          identifiers: expect.objectContaining({
            pdf_url: "https://arxiv.org/pdf/2606.00011.pdf",
          }),
        }),
      ]),
    );
  });

  it("chooses the most recent compatible scholarly record for ambiguous follow-ups with provenance", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "First scholarly metadata evidence is available.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    const threadId = "thread:test:scholarly-followup-ambiguous";

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<feed xmlns="http://www.w3.org/2005/Atom">',
          "<entry>",
          "<id>https://arxiv.org/abs/2606.00005</id>",
          "<title>Weyl tensor conformal curvature in general relativity</title>",
          "<summary>Metadata about Weyl tensor conformal curvature in general relativity.</summary>",
          "<published>2026-06-05T00:00:00Z</published>",
          "<author><name>A. Relativist</name></author>",
          "</entry>",
          "</feed>",
        ].join(""),
    })) as typeof fetch;

    await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:scholarly-followup-ambiguous:first",
        thread_id: threadId,
        agent_runtime: "codex",
        question:
          "Search scholarly research papers for Weyl tensor conformal curvature in general relativity.",
      },
      headers: {},
    });

    process.env.CODEX_AGENT_FAKE_STDOUT =
      "Second scholarly metadata evidence is available.";
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<feed xmlns="http://www.w3.org/2005/Atom">',
          "<entry>",
          "<id>https://arxiv.org/abs/2606.00006</id>",
          "<title>Casimir effect between conducting plates</title>",
          "<summary>Metadata about the Casimir effect between conducting plates.</summary>",
          "<published>2026-06-06T00:00:00Z</published>",
          "<author><name>A. Physicist</name></author>",
          "</entry>",
          "</feed>",
        ].join(""),
    })) as typeof fetch;

    await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:scholarly-followup-ambiguous:second",
        thread_id: threadId,
        agent_runtime: "codex",
        question:
          "Search scholarly research papers for Casimir effect between conducting plates.",
      },
      headers: {},
    });

    process.env.CODEX_AGENT_FAKE_STDOUT =
      "Using the re-entered prior scholarly metadata for the most recent compatible paper.";
    const followup = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:scholarly-followup-ambiguous:third",
        thread_id: threadId,
        agent_runtime: "codex",
        question: "tell me about the paper you found",
      },
      headers: {},
    });

    expect(followup.ok).toBe(true);
    expect(followup.text).toContain("most recent compatible paper");
    expect(
      (followup.debug as any)?.scholarly_followup_evidence_lookup,
    ).toMatchObject({
      status: "found",
      candidate_count: 2,
      resolution_reason: "selected_most_recent_compatible_scholarly_evidence",
      resolution_confidence: "medium",
    });
    expect(
      (followup.debug as any)?.prior_scholarly_evidence_memory_record?.query,
    ).toContain("Casimir effect");
    const candidates =
      (followup.debug as any)?.prior_evidence_memory_candidates?.candidates ??
      [];
    expect(candidates).toHaveLength(2);
    expect(
      candidates.filter((candidate: any) => candidate.selected),
    ).toHaveLength(1);
    expect(
      candidates.find((candidate: any) => candidate.selected)?.query,
    ).toContain("Casimir effect");

    process.env.CODEX_AGENT_FAKE_STDOUT =
      "I resolved that follow-up to the re-entered prior Casimir paper record.";
    const provenanceFollowup = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:scholarly-followup-ambiguous:fourth",
        thread_id: threadId,
        agent_runtime: "codex",
        question: "Which prior paper record did you resolve that follow-up to?",
      },
      headers: {},
    });

    expect(provenanceFollowup.ok).toBe(true);
    expect(provenanceFollowup.text).toContain("prior Casimir paper record");
    expect(
      (provenanceFollowup.debug as any)?.scholarly_followup_evidence_lookup,
    ).toMatchObject({
      status: "found",
      candidate_count: 2,
      resolution_reason: "selected_most_recent_compatible_scholarly_evidence",
    });
    expect(
      (provenanceFollowup.debug as any)?.prior_scholarly_evidence_memory_record
        ?.query,
    ).toContain("Casimir effect");
    expect((provenanceFollowup.debug as any)?.evidence_reentry_status).toBe(
      "reentered_prior_scholarly_evidence",
    );
    expect(
      (provenanceFollowup as any).terminal_presentation
        ?.selected_observation_refs?.length,
    ).toBeGreaterThan(0);
  });

  it("fails closed for scholarly follow-ups when no prior evidence is recoverable", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "The paper said everything was solved.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:scholarly-followup-missing",
        thread_id: "thread:test:scholarly-followup-missing",
        agent_runtime: "codex",
        question: "tell me about the paper you found",
      },
      headers: {},
    });

    expect(result.text).toContain(
      "no prior scholarly evidence packet was recoverable",
    );
    expect(result.text).not.toContain("everything was solved");
    expect((result as any).terminal_artifact_kind).toBe(
      "scholarly_recovery_plan",
    );
    expect(
      (result.debug as any)?.scholarly_followup_evidence_lookup,
    ).toMatchObject({
      status: "missing",
      followup_reference_detected: true,
    });
  });

  it("preserves weak scholarly lookup evidence and blocks provider terminal authority", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "Scholarly search for weyl curvature returned 1 usable paper result.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<feed xmlns="http://www.w3.org/2005/Atom">',
          "<entry>",
          "<id>https://arxiv.org/abs/2606.00002</id>",
          "<title>SChuBERT scholarly document chunks for citation prediction</title>",
          "<summary>BERT encodings for scholarly document quality prediction.</summary>",
          "<published>2026-06-02T00:00:00Z</published>",
          "<author><name>A. Metadata</name></author>",
          "</entry>",
          "</feed>",
        ].join(""),
    })) as typeof fetch;

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-scholarly-weak-lookup-provider-path",
        agent_runtime: "codex",
        question:
          "Search scholarly research papers for weyl curvature and summarize the paper evidence.",
        workstation_gateway_call: {
          capability_id: "scholarly-research.lookup_papers",
          mode: "read",
          arguments: {
            query: "weyl curvature",
            providers: ["arxiv"],
            limit: 1,
          },
        },
      },
      headers: {},
    });

    expect(result.ok).toBe(true);
    expect(result.response_type).toBe("final_answer");
    expect((result as any).terminal_artifact_kind).toBe(
      "scholarly_exploratory_candidates",
    );
    expect((result as any).final_answer_source).toBe(
      "scholarly_exploratory_candidates",
    );
    expect(result.text).toContain("found nearby paper records");
    expect(result.text).toContain("Best nearby candidates");
    expect(result.text).toContain(
      "SChuBERT scholarly document chunks for citation prediction",
    );
    expect(result.text).toContain("Evidence state: lookup_weak_match");
    expect(result.text).toContain("Suggested refined searches");
    expect(result.text).not.toContain("returned 1 usable paper result");
    expect(
      (result.debug as any)?.provider_terminal_authority_bridge,
    ).toMatchObject({
      terminal_authority_status: "blocked_by_observation_state",
      terminal_authority_granted: false,
      final_visible_answer_authorized: false,
      terminal_answer_authority: null,
    });
    expect((result.debug as any)?.terminal_presentation).toMatchObject({
      terminal_artifact_kind: "scholarly_exploratory_candidates",
      final_answer_source: "scholarly_exploratory_candidates",
      presentation_policy: "scholarly_response_mode_with_caveats",
    });
    expect(
      (result.debug as any)?.scholarly_response_mode_selection,
    ).toMatchObject({
      scholarly_response_mode: "scholarly_exploratory_candidates",
      selected_response_mode: "scholarly_exploratory_candidates",
      evidence_state: "lookup_weak_match",
      selected_for_answer: false,
      selected_for_exploration: true,
      terminal_artifact_kind: "scholarly_exploratory_candidates",
      recovery_query_basis: expect.objectContaining({
        scholarly_query: expect.stringContaining("Weyl"),
        strategy: "topic_domain_expansion",
      }),
    });
    expect(
      (result.debug as any)?.scholarly_response_mode_selection
        ?.recovery_queries,
    ).toEqual(
      expect.arrayContaining([
        "Weyl tensor conformal curvature general relativity",
        "Weyl curvature tensor differential geometry",
      ]),
    );
    expect(
      (
        result.debug as any
      )?.scholarly_response_mode_selection?.recovery_queries?.join("\n"),
    ).not.toContain("summarize the paper evidence");
    expect(
      (result.debug as any)?.normalized_provider_observation_packets?.[0],
    ).toMatchObject({
      capability_key: "scholarly-research.lookup_papers",
      status: "failed",
      missing_requirements: expect.arrayContaining(["lookup_weak_match"]),
      state_delta: expect.objectContaining({
        evidence_state: "lookup_weak_match",
        selected_for_answer: false,
        scholarly_response_mode: "scholarly_exploratory_candidates",
        selected_response_mode: "scholarly_exploratory_candidates",
        selected_for_exploration: true,
        allowed_response_modes: expect.arrayContaining([
          "scholarly_exploratory_candidates",
          "scholarly_recovery_plan",
        ]),
        lookup_relevance_gate: expect.objectContaining({
          status: "blocked",
          code: "lookup_weak_match",
        }),
      }),
      suggested_next_steps: expect.arrayContaining([
        "use_another_tool",
        "repair",
      ]),
    });
  });

  it("terminalizes an empty scholarly lookup as a grounded recovery plan after model re-entry", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "I cannot answer repository or codebase content because no repo.search observation was materialized.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<feed xmlns="http://www.w3.org/2005/Atom"></feed>',
        ].join(""),
    })) as typeof fetch;

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-scholarly-empty-lookup-reentry",
        agent_runtime: "codex",
        question:
          "Use scholarly-research.lookup_papers for quantum inequality sampling constraints. Explain which returned papers have a structured source suitable for attempting full-text parsing. Do not use Image Lens and do not fetch full text.",
        workstation_gateway_call: {
          capability_id: "scholarly-research.lookup_papers",
          mode: "read",
          arguments: {
            query: "quantum inequality sampling constraints",
            providers: ["arxiv"],
            limit: 3,
          },
        },
        committed_ask_route: {
          canonical_goal: {
            goal_kind: "scholarly_research",
            required_terminal_kind: "scholarly_research_answer",
            allowed_terminal_artifact_kinds: [
              "scholarly_research_answer",
              "typed_failure",
            ],
          },
          terminal_product: {
            required_terminal_product: "scholarly_research_answer",
            allowed_terminal_artifact_kinds: [
              "scholarly_research_answer",
              "typed_failure",
            ],
          },
        },
      },
      headers: {},
    });

    expect(
      (result.debug as any)?.scholarly_response_mode_selection,
    ).toMatchObject({
      selected_response_mode: "scholarly_recovery_plan",
      terminal_artifact_kind: "scholarly_recovery_plan",
      terminal_eligible: true,
      selected_for_answer: false,
    });
    expect((result.debug as any)?.workstation_gateway_call_results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability_id: "scholarly-research.lookup_papers",
        }),
      ]),
    );
    expect(
      (result.debug as any)?.scholarly_terminal_materialization_debug,
    ).toMatchObject({
      response_mode_artifact_kind: "scholarly_recovery_plan",
      materialized_terminal_artifact_kind: "scholarly_recovery_plan",
      response_mode_terminal_eligible: true,
      capability_contract_allows_answer: true,
      route_allows_terminal: true,
      process_ok: true,
      recovery_observation_reentered: true,
      provider_solver_path_completed: false,
      authority_materialized: true,
    });
    expect((result.debug as any)?.provider_reasoning_reentry).toMatchObject({
      status: "pending_helix_solver_reentry",
      evidence_reentered: false,
    });
    expect((result as any).route_product_contract).toMatchObject({
      required_terminal_kind: "scholarly_recovery_plan",
      allowed_terminal_artifact_kinds: expect.arrayContaining([
        "scholarly_recovery_plan",
      ]),
    });
    expect((result.debug as any)?.terminal_presentation).toMatchObject({
      terminal_artifact_kind: "scholarly_recovery_plan",
      final_answer_source: "scholarly_recovery_plan",
      selected_observation_refs: expect.arrayContaining([expect.any(String)]),
    });
    expect((result as any).terminal_authority_single_writer).toMatchObject({
      selected_terminal_artifact_kind: "scholarly_recovery_plan",
      rejected_candidates: [],
    });
    expect((result.debug as any)?.provider_gateway_debug_summary).toMatchObject(
      {
        final_answer_source: "scholarly_recovery_plan",
        terminal_artifact_kind: "scholarly_recovery_plan",
      },
    );
    expect(result).toMatchObject({
      ok: true,
      response_type: "final_answer",
      final_status: "completed",
      terminal_artifact_kind: "scholarly_recovery_plan",
      final_answer_source: "scholarly_recovery_plan",
      terminal_answer_authority: {
        server_authoritative: true,
        terminal_artifact_kind: "scholarly_recovery_plan",
        final_answer_source: "scholarly_recovery_plan",
      },
    });
    expect(result.text).toContain(
      "scholarly-research.lookup_papers observation packet was materialized",
    );
    expect(result.text).not.toContain("repo.search observation");
    expect((result.debug as any)?.tool_followup_decision).toMatchObject({
      next_action: "terminal_answer",
      evidence_reentered: true,
    });
  });

  it("keeps compound Codex gateway turns from truncating docs, calculator, repo, reflections, web, and papers", async () => {
    process.env.TAVILY_API_KEY = "test-tavily-key";
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "Compound evidence was available across workstation tools.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    globalThis.fetch = vi.fn(async (url: string) => {
      if (/arxiv\.org/i.test(url)) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            [
              '<?xml version="1.0" encoding="UTF-8"?>',
              '<feed xmlns="http://www.w3.org/2005/Atom">',
              "<entry>",
              "<id>https://arxiv.org/abs/2606.00001</id>",
              "<title>Search arXiv quantum inequalities warp constraints paper evidence</title>",
              "<summary>Scholarly paper evidence that summarizes quantum inequalities and warp constraints.</summary>",
              "<published>2026-06-01T00:00:00Z</published>",
              "<author><name>A. Researcher</name></author>",
              "</entry>",
              "</feed>",
            ].join(""),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            {
              title: "Current QEI discussion",
              url: "https://example.com/current-qei",
              content: "Current web source about QEI margins.",
            },
          ],
        }),
      };
    }) as typeof fetch;

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-compound-search-reflection",
        agent_runtime: "codex",
        question:
          "Combine the provided workstation observations into a bounded evidence answer.",
        workstation_gateway_calls: [
          {
            capability_id: "docs.search",
            mode: "read",
            arguments: { query: "Helix Ask", paths: ["docs"], max_hits: 1 },
          },
          {
            capability_id: "scientific-calculator.solve_expression",
            mode: "read",
            arguments: { expression: "6*7" },
          },
          {
            capability_id: "repo.search",
            mode: "read",
            arguments: {
              query: "workstation_gateway",
              paths: ["server"],
              max_hits: 1,
            },
          },
          {
            capability_id: "theory-badge-graph.reflect_discussion_context",
            mode: "read",
            arguments: {
              prompt: "Reflect QEI margin in the theory badge graph.",
            },
          },
          {
            capability_id: "civilization-bounds.reflect_system_bounds",
            mode: "read",
            arguments: {
              prompt: "Reflect QEI margin through civilization bounds.",
            },
          },
          {
            capability_id: "internet-search.search_web",
            mode: "read",
            arguments: {
              query: "current QEI warp metric constraints",
              providers: ["tavily"],
              limit: 1,
            },
          },
          {
            capability_id: "scholarly-research.lookup_papers",
            mode: "read",
            arguments: {
              query: "quantum inequalities warp drive",
              providers: ["arxiv"],
              limit: 1,
            },
          },
        ],
      },
      headers: {},
    });

    expect(result.text).toBe(
      "Compound evidence was available across workstation tools.",
    );
    const capabilityIds = (
      result.debug as any
    )?.workstation_gateway_call_results?.map(
      (entry: any) => entry.capability_id,
    );
    expect(capabilityIds.slice(0, 7)).toEqual([
      "docs.search",
      "scientific-calculator.solve_expression",
      "repo.search",
      "theory-badge-graph.reflect_discussion_context",
      "civilization-bounds.reflect_system_bounds",
      "internet-search.search_web",
      "scholarly-research.lookup_papers",
    ]);
    expect(capabilityIds).toEqual(
      expect.arrayContaining(["scientific-calculator.show_gateway_solve"]),
    );
    expect(
      result.turn_transcript_events?.filter(
        (event: any) => event.source_event_type === "tool_observation",
      ),
    ).toHaveLength(7);
    expect(result.tool_output_refs).toEqual(
      expect.arrayContaining([
        expect.stringContaining("internet-search.search_web"),
        expect.stringContaining("scholarly-research.lookup_papers"),
      ]),
    );
  });

  it("runs future provider workstation gateway calls through the same shared admission", async () => {
    const results = await runExplicitFutureWorkstationGatewayCalls({
      body: {
        turn_id: "ask:test:future-explicit-gateway",
        workstation_gateway_call: {
          capability_id: "scientific-calculator.solve_expression",
          arguments: {
            expression: "8 * 8",
          },
        },
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      ok: true,
      agent_runtime: "future",
      capability_id: "scientific-calculator.solve_expression",
      gateway_admission: {
        selected_agent_provider: "future",
        admission_status: "admitted",
      },
      observation_packet: {
        schema: "helix.agent_step_observation_packet.v1",
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.calculator_solve_observation.v1",
        result: "64",
      },
      tool_followup_decision: {
        next_action: "continue_reasoning",
        evidence_reentered: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("derives read-only calculator gateway calls only after a runtime is selected", async () => {
    const body = {
      turn_id: "ask:test:planner-derived-gateway",
      question:
        "Use the scientific calculator to evaluate 6 * 7 and explain the result.",
    };

    expect(buildPlannerDerivedWorkstationGatewayCallRequests(body)).toEqual([
      expect.objectContaining({
        schema: "helix.workstation_gateway.planner_derived_call_request.v1",
        derivation_source: "helix_workstation_tool_planner",
        planner_intent: "calculator_solve",
        capability_id: "scientific-calculator.solve_expression",
        mode: "read",
        arguments: expect.objectContaining({
          expression: "6*7",
          source_target_intent: expect.objectContaining({
            source: "helix_workstation_tool_planner",
            intent: "calculator_solve",
            panel_id: "scientific-calculator",
            action_id: "solve_expression",
          }),
        }),
      }),
    ]);

    await expect(
      runExplicitWorkstationGatewayCalls({
        body,
        agentRuntime: "codex",
      }),
    ).resolves.toEqual([]);

    const selectedRuntimeResults = await runExplicitWorkstationGatewayCalls({
      body: {
        ...body,
        agent_runtime: "codex",
      },
      agentRuntime: "codex",
    });

    expect(selectedRuntimeResults).toHaveLength(1);
    expect(selectedRuntimeResults[0]).toMatchObject({
      ok: true,
      agent_runtime: "codex",
      capability_id: "scientific-calculator.solve_expression",
      gateway_admission: {
        selected_agent_provider: "codex",
        permission_profile: "read",
        admission_status: "admitted",
      },
      observation: {
        schema: "helix.calculator_solve_observation.v1",
        expression: "6*7",
        result: "42",
      },
      observation_packet: {
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("derives prompt-named Codex calculator gateway calls before trailing answer instructions", async () => {
    const body = {
      turn_id: "ask:test:codex-prompt-named-calculator-smoke",
      agent_runtime: "codex",
      question:
        "Codex UI validation smoke 2026-06-29 20:09: use the Helix workstation gateway capability scientific-calculator.solve_expression with expression 8*9. Answer with the observed expression and result.",
    };

    expect(buildPromptNamedCapabilityGatewayCallRequests(body)).toEqual([
      expect.objectContaining({
        schema:
          "helix.workstation_gateway.prompt_named_capability_call_request.v1",
        derivation_source: "helix_prompt_named_capability",
        capability_id: "scientific-calculator.solve_expression",
        mode: "read",
        arguments: expect.objectContaining({
          expression: "8*9",
          source_target_intent: expect.objectContaining({
            target_source: "scientific_calculator",
            target_kind: "calculator_solve",
            expression: "8*9",
          }),
        }),
      }),
    ]);
    expect(buildPromptDerivedCalculatorSolveGatewayCallRequests(body)).toEqual([
      expect.objectContaining({
        capability_id: "scientific-calculator.solve_expression",
        arguments: expect.objectContaining({
          expression: "8*9",
        }),
      }),
    ]);

    const results = await runExplicitWorkstationGatewayCalls({
      body,
      agentRuntime: "codex",
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      ok: true,
      agent_runtime: "codex",
      capability_id: "scientific-calculator.solve_expression",
      observation: {
        schema: "helix.calculator_solve_observation.v1",
        expression: "8*9",
        result: "72",
      },
      observation_packet: {
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("derives percent-of calculator phrases for Codex gateway normalization", () => {
    const body = {
      turn_id: "ask:test:codex-percent-of-calculator-prompt",
      agent_runtime: "codex",
      question:
        "Use the current document as context, then use the calculator to compute 12.5% of 54176.",
    };

    expect(buildPromptDerivedCalculatorSolveGatewayCallRequests(body)).toEqual([
      expect.objectContaining({
        capability_id: "scientific-calculator.solve_expression",
        arguments: expect.objectContaining({
          expression: "12.5% of 54176",
        }),
      }),
    ]);
  });

  it("keeps explicit Codex docs.search plus repo.search prompts from admitting duplicate or adjacent tools", () => {
    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body: {
        agent_runtime: "codex",
        question:
          "Use docs.search for docs/research/nhm2-current-status-whitepaper.md with query claim boundary, then use repo.search for workstation_gateway. Distinguish document evidence from implementation evidence.",
        workspace_context_snapshot: {
          activePanel: "scientific-calculator",
          focusedPanel: "scientific-calculator",
          openPanels: ["docs-viewer", "scientific-calculator"],
          activeDocPath: "docs/research/nhm2-current-status-whitepaper.md",
          hasDocContext: true,
        },
      },
    });

    expect(requests.map((request) => (request as any).capability_id)).toEqual([
      "docs.search",
      "repo.search",
    ]);
    expect(
      requests.map((request) => (request as any).derivation_source),
    ).toEqual([
      "helix_prompt_named_capability",
      "helix_prompt_named_capability",
    ]);
  });

  it("plans implicit document-plus-repo evidence as a compound outcome without adjacent tools", () => {
    const body = {
      agent_runtime: "codex",
      question:
        "Compare the current document evidence with repo implementation evidence for workstation_gateway, and distinguish what the document claims from what the code proves.",
      workspace_context_snapshot: {
        activePanel: "docs-viewer",
        focusedPanel: "docs-viewer",
        openPanels: ["docs-viewer", "scientific-calculator"],
        activeDocPath: "docs/research/nhm2-current-status-whitepaper.md",
        hasDocContext: true,
      },
    };

    const planned = buildCompoundCapabilityDependencyGatewayCallRequests(body);
    expect(planned.map((request) => (request as any).capability_id)).toEqual([
      "docs.search",
      "repo.search",
    ]);
    expect(planned.map((request) => (request as any).compound_outcome)).toEqual(
      ["inspect_repo_and_doc", "inspect_repo_and_doc"],
    );

    const requests = readWorkstationGatewayCallRequestsForTurn({
      includePlannerDerived: true,
      body,
    });

    expect(requests.map((request) => (request as any).capability_id)).toEqual([
      "docs.search",
      "repo.search",
    ]);
    expect(
      requests.map((request) => (request as any).derivation_source),
    ).toEqual([
      "helix_compound_capability_dependency_planner",
      "helix_compound_capability_dependency_planner",
    ]);
    expect((requests[0] as any).arguments.source_target_intent).toMatchObject({
      compound_outcome: "inspect_repo_and_doc",
      subgoal_id: "inspect_repo_and_doc:docs_evidence",
      required_observation_kind: "helix.docs_search_observation.v1",
    });
    expect((requests[1] as any).arguments.source_target_intent).toMatchObject({
      compound_outcome: "inspect_repo_and_doc",
      subgoal_id: "inspect_repo_and_doc:repo_evidence",
      required_observation_kind: "helix.repo_search_observation.v1",
    });
  });

  it("executes implicit document-plus-repo compound evidence with per-subgoal rail metadata", async () => {
    const body = {
      turn_id: "ask:test:compound-inspect-repo-and-doc",
      agent_runtime: "codex",
      question:
        "Compare the current document evidence with repo implementation evidence for workstation_gateway, and distinguish what the document claims from what the code proves.",
      workspace_context_snapshot: {
        activePanel: "docs-viewer",
        focusedPanel: "docs-viewer",
        activeDocPath: "docs/research/nhm2-current-status-whitepaper.md",
        hasDocContext: true,
      },
    };

    const results = await runExplicitWorkstationGatewayCalls({
      body,
      agentRuntime: "codex",
      turnId: "ask:test:compound-inspect-repo-and-doc",
    });

    expect(results.map((result) => result.capability_id)).toEqual([
      "docs.search",
      "repo.search",
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(
      (results[0].observation as any).compound_dependency_plan,
    ).toMatchObject({
      schema: "helix.compound_capability_dependency_plan.v1",
      compound_outcome: "inspect_repo_and_doc",
      rail_status: "satisfied",
      subgoals: [
        {
          subgoal_id: "inspect_repo_and_doc:docs_evidence",
          requested_capability: "docs.search",
          required_observation_kind: "helix.docs_search_observation.v1",
          satisfied: true,
        },
      ],
    });
    expect(
      (results[1].observation as any).compound_dependency_plan,
    ).toMatchObject({
      schema: "helix.compound_capability_dependency_plan.v1",
      compound_outcome: "inspect_repo_and_doc",
      rail_status: "satisfied",
      subgoals: [
        {
          subgoal_id: "inspect_repo_and_doc:repo_evidence",
          requested_capability: "repo.search",
          required_observation_kind: "helix.repo_search_observation.v1",
          satisfied: true,
        },
      ],
    });
    expect(
      (results[0].observation_packet.state_delta as any)
        .compound_dependency_turn_plan,
    ).toMatchObject({
      schema: "helix.compound_capability_dependency_turn_plan.v1",
      compound_outcomes: ["inspect_repo_and_doc"],
      rail_status: "satisfied",
      ordered_subgoals: [
        {
          subgoal_id: "inspect_repo_and_doc:docs_evidence",
          requested_capability: "docs.search",
          executed_capability: "docs.search",
          satisfied: true,
        },
        {
          subgoal_id: "inspect_repo_and_doc:repo_evidence",
          requested_capability: "repo.search",
          executed_capability: "repo.search",
          satisfied: true,
        },
      ],
    });
  });

  it("does not admit implicit docs-plus-repo tools from quoted or future mentions", () => {
    const prompts = [
      'The text says "compare repo and document evidence"; explain the phrase only.',
      "Later we might compare repo implementation evidence with the document, but not now.",
      "Do not search the repo or docs; explain what such a comparison would mean.",
    ];

    for (const question of prompts) {
      const body = {
        agent_runtime: "codex",
        question,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          activeDocPath: "docs/research/nhm2-current-status-whitepaper.md",
          hasDocContext: true,
        },
      };
      expect(
        buildCompoundCapabilityDependencyGatewayCallRequests(body),
      ).toEqual([]);
    }
  });

  it("plans implicit document-plus-calculator evidence as an ordered compound outcome", async () => {
    const body = {
      turn_id: "ask:test:compound-summarize-and-calculate",
      agent_runtime: "codex",
      question:
        "Use this document as evidence, calculate 6 * 7 as a scalar sanity check, then summarize what the two observations support.",
      workspace_context_snapshot: {
        activePanel: "docs-viewer",
        focusedPanel: "docs-viewer",
        activeDocPath: "docs/research/nhm2-current-status-whitepaper.md",
        hasDocContext: true,
      },
    };

    const planned = buildCompoundCapabilityDependencyGatewayCallRequests(body);
    expect(planned.map((request) => (request as any).capability_id)).toEqual([
      "docs.search",
      "scientific-calculator.solve_expression",
    ]);
    expect(planned.map((request) => (request as any).compound_outcome)).toEqual(
      ["summarize_and_calculate", "summarize_and_calculate"],
    );

    const requests = readWorkstationGatewayCallRequestsForTurn({
      body,
      includePlannerDerived: true,
    });
    expect(requests.map((request) => (request as any).capability_id)).toEqual([
      "docs.search",
      "scientific-calculator.solve_expression",
    ]);

    const results = await runExplicitWorkstationGatewayCalls({
      body,
      agentRuntime: "codex",
      turnId: "ask:test:compound-summarize-and-calculate",
    });

    expect(results.map((result) => result.capability_id)).toEqual([
      "docs.search",
      "scientific-calculator.solve_expression",
    ]);
    expect(
      (results[0].observation as any).compound_dependency_plan,
    ).toMatchObject({
      schema: "helix.compound_capability_dependency_plan.v1",
      compound_outcome: "summarize_and_calculate",
      rail_status: "satisfied",
      subgoals: [
        {
          subgoal_id: "summarize_and_calculate:docs_evidence",
          requested_capability: "docs.search",
          required_observation_kind: "helix.docs_search_observation.v1",
          satisfied: true,
        },
      ],
    });
    expect(
      (results[1].observation as any).compound_dependency_plan,
    ).toMatchObject({
      schema: "helix.compound_capability_dependency_plan.v1",
      compound_outcome: "summarize_and_calculate",
      rail_status: "satisfied",
      subgoals: [
        {
          subgoal_id: "summarize_and_calculate:calculator_scalar",
          requested_capability: "scientific-calculator.solve_expression",
          required_observation_kind: "helix.calculator_solve_observation.v1",
          satisfied: true,
        },
      ],
    });
    expect(
      (results[1].observation_packet.state_delta as any)
        .compound_dependency_turn_plan,
    ).toMatchObject({
      schema: "helix.compound_capability_dependency_turn_plan.v1",
      compound_outcomes: ["summarize_and_calculate"],
      rail_status: "satisfied",
      ordered_subgoals: [
        {
          subgoal_id: "summarize_and_calculate:docs_evidence",
          requested_capability: "docs.search",
          executed_capability: "docs.search",
          satisfied: true,
        },
        {
          subgoal_id: "summarize_and_calculate:calculator_scalar",
          requested_capability: "scientific-calculator.solve_expression",
          executed_capability: "scientific-calculator.solve_expression",
          satisfied: true,
        },
      ],
      dependency_edges: [
        {
          from: "summarize_and_calculate:docs_evidence",
          to: "summarize_and_calculate:calculator_scalar",
        },
      ],
    });
  });

  it("does not plan document-plus-calculator from date-like document paths alone", () => {
    const body = {
      turn_id: "ask:test:compound-docs-date-path-no-calculator",
      agent_runtime: "codex",
      question:
        "Search the active document docs/research/nhm2-current-status-whitepaper.md and summarize NHM2 current status in two bullets.",
      workspace_context_snapshot: {
        activePanelId: "docs-viewer",
        activeDocumentPath: "docs/research/nhm2-current-status-whitepaper.md",
        hasDocContext: true,
      },
    };

    expect(buildCompoundCapabilityDependencyGatewayCallRequests(body)).toEqual(
      [],
    );
    expect(
      readWorkstationGatewayCallRequestsForTurn({
        body,
        includePlannerDerived: true,
      }).map((request) => (request as any).capability_id),
    ).toEqual(["docs.search"]);
  });

  it("plans document-plus-percent calculator evidence without treating document dates as expressions", () => {
    const body = {
      turn_id: "ask:test:compound-docs-percent-calculator",
      agent_runtime: "codex",
      question:
        "Use the active NHM2 document as context, then use the calculator for 12.5% of 54176 and answer with both pieces.",
      workspace_context_snapshot: {
        activePanelId: "docs-viewer",
        activeDocumentPath: "docs/research/nhm2-current-status-whitepaper.md",
        hasDocContext: true,
      },
    };

    const planned = buildCompoundCapabilityDependencyGatewayCallRequests(body);
    expect(planned.map((request) => (request as any).capability_id)).toEqual([
      "docs.search",
      "scientific-calculator.solve_expression",
    ]);
    expect((planned[1] as any).arguments.expression).toBe("12.5% of 54176");

    const requests = readWorkstationGatewayCallRequestsForTurn({
      body,
      includePlannerDerived: true,
    });
    expect(requests.map((request) => (request as any).capability_id)).toEqual([
      "docs.search",
      "scientific-calculator.solve_expression",
    ]);
  });

  it("plans research-plus-calculator-plus-reflection compound evidence without one-off route files", () => {
    const body = {
      turn_id: "ask:test:compound-research-quantify-reflect",
      agent_runtime: "codex",
      question:
        "Retrieve research papers and web evidence for quantum inequality margins, calculate 6 * 7 as a small scalar estimate, reflect the claim boundary through the theory badge graph, and apply civilization bounds for social, energy, and material conditions.",
    };

    const planned = buildCompoundCapabilityDependencyGatewayCallRequests(body);
    expect(planned.map((request) => (request as any).capability_id)).toEqual([
      "scholarly-research.lookup_papers",
    ]);
    expect(
      planned.every(
        (request) =>
          (request as any).compound_outcome === "research_quantify_reflect",
      ),
    ).toBe(true);

    const requests = readWorkstationGatewayCallRequestsForTurn({
      body,
      includePlannerDerived: true,
    });
    expect(requests.map((request) => (request as any).capability_id)).toEqual([
      "scholarly-research.lookup_papers",
      "scientific-calculator.solve_expression",
      "civilization-bounds.reflect_system_bounds",
      "theory-badge-graph.reflect_discussion_context",
    ]);
    expect((requests[0] as any).arguments.source_target_intent).toMatchObject({
      compound_outcome: "research_quantify_reflect",
      subgoal_id: "research_quantify_reflect:scholarly_evidence",
      required_observation_kind: "helix.scholarly_research_observation.v1",
    });
    expect(
      (requests[0] as any).arguments.next_affordances.map(
        (entry: any) => entry.capability,
      ),
    ).toEqual([
      "internet-search.search_web",
      "scientific-calculator.solve_expression",
      "theory-badge-graph.reflect_discussion_context",
      "civilization-bounds.reflect_system_bounds",
    ]);
  });

  it("binds theory badge calculator templates from sourced numeric paper evidence before running calculator", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const urlText = String(url);
      if (urlText.includes("export.arxiv.org/api/query")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            [
              '<?xml version="1.0" encoding="UTF-8"?>',
              '<feed xmlns="http://www.w3.org/2005/Atom">',
              "<entry>",
              "<id>https://arxiv.org/abs/2606.00002</id>",
              "<title>Tokamak thermal pressure proxy values</title>",
              "<summary>Metadata only; operating point values require full text.</summary>",
              "<published>2026-06-02T00:00:00Z</published>",
              "<author><name>A. Plasma Researcher</name></author>",
              "</entry>",
              "</feed>",
            ].join(""),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "content-type" ? "text/html" : null,
        },
        arrayBuffer: async () =>
          new TextEncoder().encode(
            [
              "<html><body>",
              "<p>Table 1 reports density n_m3 = 2.26e18 m^-3 [4].</p>",
              "<p>The operating point lists electron temperature T_eV = 164.8 eV [4].</p>",
              "</body></html>",
            ].join(" "),
          ).buffer,
      };
    }) as typeof fetch;

    const body = {
      turn_id: "ask:test:compound-theory-paper-bound-calculator",
      agent_runtime: "codex",
      question:
        "Retrieve research papers for tokamak thermal pressure values, then use scholarly-research.fetch_full_text and scholarly-research.extract_numeric_parameters for n_m3 and T_eV, calculate the tokamak thermal pressure proxy from the theory badge graph, and reflect the claim boundary through the theory badge graph.",
    };

    const planned = buildCompoundCapabilityDependencyGatewayCallRequests(body);
    expect(planned.map((request) => (request as any).capability_id)).toEqual([
      "scholarly-research.lookup_papers",
    ]);
    expect((planned[0].arguments as any).allow_scholarly_dependent_chain).toBe(
      true,
    );

    const results = await runExplicitWorkstationGatewayCalls({
      body,
      agentRuntime: "codex",
      turnId: "ask:test:compound-theory-paper-bound-calculator",
    });

    expect(results.map((result) => result.capability_id)).toEqual([
      "scholarly-research.lookup_papers",
      "theory-badge-graph.reflect_discussion_context",
    ]);
    expect((results[0].observation as any).next_affordances).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "scholarly-research.fetch_full_text",
        }),
      ]),
    );
    expect(results[1].capability_id).toBe(
      "theory-badge-graph.reflect_discussion_context",
    );
  });

  it("plans scholarly lookup from formula variable meanings instead of literal placeholders", () => {
    const body = {
      turn_id: "ask:test:compound-variable-source-plan",
      agent_runtime: "codex",
      question:
        "Use scholarly-research.lookup_papers to find an accessible tokamak plasma beta or transport paper that reports the data needed to bind the theory badge graph formula inputs. Then use scholarly-research.fetch_full_text and scholarly-research.extract_numeric_parameters with cited units before any calculator step.",
    };

    const planned = buildCompoundCapabilityDependencyGatewayCallRequests(body);
    expect(planned.map((request) => (request as any).capability_id)).toEqual([
      "scholarly-research.lookup_papers",
    ]);
    const lookupArguments = planned[0].arguments as any;
    expect(lookupArguments.requested_variables).toEqual([
      "n_m3",
      "T_eV",
      "B_T",
    ]);
    expect(lookupArguments.query).toContain("electron density");
    expect(lookupArguments.query).toContain("electron temperature");
    expect(lookupArguments.query).toContain("toroidal magnetic field");
    expect(lookupArguments.query).toContain("parameter table");
    expect(lookupArguments.source_requirement_plan).toMatchObject({
      schema: "helix.source_requirement_plan.v1",
      source_target: "scholarly_research",
      assistant_answer: false,
      raw_content_included: false,
      reasoning_order: [
        "interpret_user_goal",
        "identify_claim_or_calculation",
        "derive_evidence_requirements",
        "build_retrieval_strategy",
        "model_selects_next_admitted_tool_step",
        "normalize_observations",
        "reenter_model_with_evidence",
        "answer_or_fail_closed_after_terminal_authority",
      ],
      retrieval_strategy: {
        schema: "helix.retrieval_strategy.v1",
        avoid_literal_placeholders_only: true,
        fallback_behavior: "explain_missing_evidence_or_requery",
        prefer_sources_with: expect.arrayContaining([
          "unit-bearing values",
          "parameter table",
          "operating point",
        ]),
      },
      reentry_requirements: {
        observation_reentry_required: true,
        model_followup_required_before_terminal: true,
        calculator_requires_bound_expression: true,
        fail_closed_before_claim_without_required_evidence: true,
      },
      hard_gates: expect.arrayContaining([
        "tools_produce_observations_not_answers",
        "calculator_requires_fully_bound_source_backed_expression",
        "terminal_answer_requires_post_observation_reasoning",
      ]),
      evidence_requirements: expect.arrayContaining([
        expect.objectContaining({
          requirement_id: "retrieved_source_evidence",
          terminal_eligible: false,
        }),
        expect.objectContaining({
          requirement_id: "formula_variable_numeric_evidence",
          required_observation_kind:
            "helix.scholarly_numeric_parameter_observation.v1",
          required_affordance_kinds: expect.arrayContaining([
            "numeric_value_evidence",
          ]),
          terminal_eligible: false,
        }),
      ]),
    });
    expect(lookupArguments.variable_source_plan).toMatchObject({
      schema: "helix.variable_source_plan.v1",
      formula_variables: ["n_m3", "T_eV", "B_T"],
      assistant_answer: false,
      raw_content_included: false,
      entries: expect.arrayContaining([
        expect.objectContaining({
          variable: "n_m3",
          canonical_quantity: "electron_or_plasma_number_density",
          expected_unit: "m^-3",
          source_classes: expect.arrayContaining([
            "plasma parameter table",
            "density profile diagnostics",
          ]),
          extraction_aliases: expect.arrayContaining([
            "electron density",
            "plasma density",
          ]),
        }),
        expect.objectContaining({
          variable: "T_eV",
          canonical_quantity: "electron_temperature_energy",
          expected_unit: "eV",
          source_classes: expect.arrayContaining([
            "temperature profile diagnostics",
          ]),
          extraction_aliases: expect.arrayContaining(["electron temperature"]),
        }),
        expect.objectContaining({
          variable: "B_T",
          canonical_quantity: "toroidal_or_background_magnetic_field",
          expected_unit: "T",
          source_classes: expect.arrayContaining([
            "machine parameter table",
            "magnetic confinement parameters",
          ]),
          extraction_aliases: expect.arrayContaining([
            "toroidal magnetic field",
          ]),
        }),
      ]),
    });
    expect(lookupArguments.allow_scholarly_dependent_chain).toBe(true);
    expect(lookupArguments.source_target_intent).toMatchObject({
      source_requirement_plan: {
        schema: "helix.source_requirement_plan.v1",
        reentry_requirements: {
          model_followup_required_before_terminal: true,
        },
      },
      query_plan: {
        schema: "helix.scholarly_variable_source_query_plan.v1",
        formula_variables: ["n_m3", "T_eV", "B_T"],
        source_classes: expect.arrayContaining([
          "plasma parameter table",
          "temperature profile diagnostics",
          "machine parameter table",
        ]),
      },
    });
  });

  it("does not auto-fetch or extract after relevant lookup unless the prompt explicitly requests the full-text numeric chain", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<feed xmlns="http://www.w3.org/2005/Atom">',
          "<entry>",
          "<id>https://arxiv.org/abs/2606.00006</id>",
          "<title>Tokamak plasma thermal pressure operating point</title>",
          "<summary>Tokamak plasma paper discussing electron density, electron temperature, and magnetic confinement parameters.</summary>",
          "<published>2026-06-06T00:00:00Z</published>",
          "<author><name>D. Plasma Researcher</name></author>",
          "</entry>",
          "</feed>",
        ].join(""),
    })) as typeof fetch;

    const body = {
      turn_id: "ask:test:default-research-does-not-auto-dependent-chain",
      agent_runtime: "codex",
      question:
        "Retrieve research papers for tokamak thermal pressure values, calculate the tokamak thermal pressure proxy from the theory badge graph for n_m3 and T_eV, and reflect the claim boundary through the theory badge graph.",
    };

    const planned = buildCompoundCapabilityDependencyGatewayCallRequests(body);
    expect((planned[0].arguments as any).allow_scholarly_dependent_chain).toBe(
      false,
    );

    const results = await runExplicitWorkstationGatewayCalls({
      body,
      agentRuntime: "codex",
      turnId: "ask:test:default-research-does-not-auto-dependent-chain",
    });

    expect(results.map((result) => result.capability_id)).toEqual([
      "scholarly-research.lookup_papers",
      "theory-badge-graph.reflect_discussion_context",
    ]);
    expect(results.map((result) => result.capability_id)).not.toContain(
      "scholarly-research.fetch_full_text",
    );
    expect(results.map((result) => result.capability_id)).not.toContain(
      "scholarly-research.extract_numeric_parameters",
    );
  });

  it("admits explicitly named scholarly full-text and numeric extraction as a dependent research chain", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const urlText = String(url);
      if (urlText.includes("export.arxiv.org/api/query")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            [
              '<?xml version="1.0" encoding="UTF-8"?>',
              '<feed xmlns="http://www.w3.org/2005/Atom">',
              "<entry>",
              "<id>https://arxiv.org/abs/2606.00004</id>",
              "<title>Plasma magnetic confinement operating point</title>",
              "<summary>Metadata only; operating point values require full text.</summary>",
              "<published>2026-06-04T00:00:00Z</published>",
              "<author><name>C. Plasma Researcher</name></author>",
              "</entry>",
              "</feed>",
            ].join(""),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "content-type" ? "text/html" : null,
        },
        arrayBuffer: async () =>
          new TextEncoder().encode(
            [
              "<html><body>",
              "<p>The cited density is n_m3 = 2.26e18 m^-3 [7].</p>",
              "<p>The cited electron temperature is T_eV = 164.8 eV [7].</p>",
              "</body></html>",
            ].join(" "),
          ).buffer,
      };
    }) as typeof fetch;

    const body = {
      turn_id: "ask:test:explicit-scholarly-full-text-numeric-chain",
      agent_runtime: "codex",
      question:
        "Use scholarly-research.lookup_papers for magnetic confinement plasma density and temperature values, then use scholarly-research.fetch_full_text, then use scholarly-research.extract_numeric_parameters for n_m3 and T_eV from cited text, then use scientific-calculator.solve_expression with expression 6*7. Answer only from the observations.",
    };

    const planned = buildCompoundCapabilityDependencyGatewayCallRequests(body);
    expect(planned.map((request) => (request as any).capability_id)).toEqual([
      "scholarly-research.lookup_papers",
    ]);

    const results = await runExplicitWorkstationGatewayCalls({
      body,
      agentRuntime: "codex",
      turnId: "ask:test:explicit-scholarly-full-text-numeric-chain",
    });

    expect(results.map((result) => result.capability_id)).toEqual([
      "scholarly-research.lookup_papers",
      "scholarly-research.fetch_full_text",
      "scholarly-research.extract_numeric_parameters",
      "scientific-calculator.solve_expression",
    ]);
    expect(
      results[2].gateway_admission.source_target_intent as any,
    ).toMatchObject({
      compound_outcome: "scholarly_research_workflow",
      requested_workflow: "numeric_calculation",
      scholarly_intent: {
        schema: "helix.scholarly_intent.v1",
        scholarly_query:
          "magnetic confinement plasma density and temperature values",
        requested_workflow: "numeric_calculation",
        terminal_evidence_requirement: "calculation_from_numeric_values",
      },
      requested_variables: expect.arrayContaining(["n_m3", "T_eV"]),
    });
    expect(results[2].observation as any).toMatchObject({
      schema: "helix.scholarly_numeric_parameter_observation.v1",
      selected_for_answer: true,
      missing_variables: [],
      parameters: expect.arrayContaining([
        expect.objectContaining({
          variable: "n_m3",
          normalized_value: 2260000000000000000,
          normalized_unit: "m^-3",
        }),
        expect.objectContaining({
          variable: "T_eV",
          normalized_value: 164.8,
          normalized_unit: "eV",
        }),
      ]),
    });
    expect(results[3].observation as any).toMatchObject({
      expression: "6*7",
      result: "42",
      status: "succeeded",
    });
  });

  it("does not auto-fetch or extract from irrelevant scholarly lookup results", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<feed xmlns="http://www.w3.org/2005/Atom">',
          "<entry>",
          "<id>https://arxiv.org/abs/2606.00005</id>",
          "<title>Test of lepton flavour universality using B0 decays</title>",
          "<summary>Measurements of branching fractions in B meson decays from collider data.</summary>",
          "<published>2026-06-05T00:00:00Z</published>",
          "<author><name>C. Collider Researcher</name></author>",
          "</entry>",
          "</feed>",
        ].join(""),
    })) as typeof fetch;

    const body = {
      turn_id: "ask:test:irrelevant-scholarly-lookup-stops-dependent-chain",
      agent_runtime: "codex",
      question:
        "Use scholarly-research.lookup_papers for DIII-D or EAST tokamak operating parameters: electron density, electron temperature, toroidal magnetic field, plasma current, and confinement/transport parameter table. Then use scholarly-research.fetch_full_text on the best accessible tokamak paper and scholarly-research.extract_numeric_parameters only if the paper is relevant. Reflect the theory badge graph and calculate beta only after cited values are bound.",
    };

    const results = await runExplicitWorkstationGatewayCalls({
      body,
      agentRuntime: "codex",
      turnId: "ask:test:irrelevant-scholarly-lookup-stops-dependent-chain",
    });

    expect(results.map((result) => result.capability_id)).toEqual([
      "scholarly-research.lookup_papers",
    ]);
    expect(results.map((result) => result.capability_id)).not.toContain(
      "scholarly-research.fetch_full_text",
    );
    expect(results.map((result) => result.capability_id)).not.toContain(
      "scholarly-research.extract_numeric_parameters",
    );
    expect(results[0].observation as any).toMatchObject({
      lookup_relevance_gate: {
        schema: "helix.scholarly_lookup_relevance_gate.v1",
        status: "blocked",
        code: "lookup_weak_match",
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      missing_requirements: expect.arrayContaining(["lookup_weak_match"]),
      selected_for_answer: false,
    });
    expect(
      (results[0].observation_packet.state_delta as any)
        .compound_dependency_plan,
    ).toMatchObject({
      first_broken_rail: {
        subgoal_id: "research_quantify_reflect:scholarly_full_text",
        capability_id: "scholarly-research.fetch_full_text",
        reason: "lookup_weak_match",
      },
      rail_status: "blocked",
    });
  });

  it("fails closed with typed missing variables when paper evidence cannot bind a theory calculator template", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const urlText = String(url);
      if (urlText.includes("export.arxiv.org/api/query")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            [
              '<?xml version="1.0" encoding="UTF-8"?>',
              '<feed xmlns="http://www.w3.org/2005/Atom">',
              "<entry>",
              "<id>https://arxiv.org/abs/2606.00003</id>",
              "<title>Tokamak thermal pressure discussion without operating point</title>",
              "<summary>This paper discusses tokamak thermal pressure proxies but does not report density or temperature values.</summary>",
              "<published>2026-06-03T00:00:00Z</published>",
              "<author><name>B. Plasma Researcher</name></author>",
              "</entry>",
              "</feed>",
            ].join(""),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "content-type" ? "text/html" : null,
        },
        arrayBuffer: async () =>
          new TextEncoder().encode(
            "<html><body><p>This paper discusses pressure only in qualitative terms [5].</p></body></html>",
          ).buffer,
      };
    }) as typeof fetch;

    const body = {
      turn_id: "ask:test:compound-theory-paper-missing-calculator-values",
      agent_runtime: "codex",
      question:
        "Retrieve research papers for tokamak thermal pressure values, then use scholarly-research.fetch_full_text and scholarly-research.extract_numeric_parameters for n_m3 and T_eV, calculate the tokamak thermal pressure proxy from the theory badge graph, and reflect the claim boundary through the theory badge graph.",
    };

    const results = await runExplicitWorkstationGatewayCalls({
      body,
      agentRuntime: "codex",
      turnId: "ask:test:compound-theory-paper-missing-calculator-values",
    });

    expect(results.map((result) => result.capability_id)).toEqual([
      "scholarly-research.lookup_papers",
      "theory-badge-graph.reflect_discussion_context",
    ]);
    expect((results[0].observation as any).next_affordances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "scholarly-research.lookup_papers",
        }),
      ]),
    );
    expect(results.map((result) => result.capability_id)).not.toContain(
      "scientific-calculator.solve_expression",
    );
  });

  it("does not admit research compound tools from quoted, negated, or future mentions", () => {
    const prompts = [
      'The text says "retrieve research papers, calculate 6 * 7, and reflect through civilization bounds"; explain the sentence only.',
      "Do not retrieve research papers, calculate, or reflect; describe what that workflow would require.",
      "Later we might retrieve papers, calculate an estimate, and reflect through the theory badge graph, but not now.",
    ];
    for (const question of prompts) {
      expect(
        buildCompoundCapabilityDependencyGatewayCallRequests({
          agent_runtime: "codex",
          question,
        }),
      ).toEqual([]);
    }
  });

  it("materializes active docs-viewer context as a bounded docs observation for Codex", async () => {
    const body = {
      turn_id: "ask:test:codex-active-doc-context",
      agent_runtime: "codex",
      question: "Summarize this document from the current docs viewer context.",
      workspace_context_snapshot: {
        activePanel: "docs-viewer",
        activeDocPath: "/docs/helix-ask-flow.md",
        hasDocContext: true,
      },
    };

    const requests = buildActiveDocsContextWorkstationGatewayCallRequests(body);
    expect(requests).toEqual([
      expect.objectContaining({
        schema: "helix.workstation_gateway.active_docs_context_call_request.v1",
        derivation_source: "helix_active_docs_viewer_context",
        capability_id: "docs.search",
        arguments: expect.objectContaining({
          paths: ["docs/helix-ask-flow.md"],
          source_target_intent: expect.objectContaining({
            target_source: "active_doc",
            active_panel: "docs-viewer",
            active_doc_path: "docs/helix-ask-flow.md",
          }),
        }),
      }),
    ]);

    const results = await runExplicitWorkstationGatewayCalls({
      body,
      agentRuntime: "codex",
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      ok: true,
      agent_runtime: "codex",
      capability_id: "docs.search",
      observation_packet: {
        status: "succeeded",
        terminal_eligible: false,
        post_tool_model_step_required: true,
      },
      observation: {
        schema: "helix.docs_search_observation.v1",
        active_document_observation: {
          schema: "helix.docs_active_document_observation.v1",
          path: "docs/helix-ask-flow.md",
          terminal_eligible: false,
          assistant_answer: false,
          raw_content_included: false,
        },
      },
    });
    expect(
      String(
        (results[0].observation as any).active_document_observation.excerpt ??
          "",
      ),
    ).toContain("Helix Ask");
  });

  it("materializes an explicit docs path before summarizing without relying on panel focus", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "- NHM2 is presented as a diagnostic engineering direction.\n- Physical viability remains unproven.\n- The next work is bounded validation.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const body = {
      turn_id: "ask:test:codex-explicit-doc-path-summary",
      agent_runtime: "codex",
      question:
        "Open docs/research/nhm2-current-status-whitepaper.md and summarize its current status in three bullets.",
      workspace_context_snapshot: {
        activePanel: "scientific-calculator",
        focusedPanel: "scientific-calculator",
        openPanels: ["docs-viewer", "scientific-calculator"],
      },
    };

    const requests = buildActiveDocsContextWorkstationGatewayCallRequests(body);
    expect(requests).toEqual([
      expect.objectContaining({
        derivation_source: "helix_explicit_doc_path_context",
        capability_id: "docs.search",
        arguments: expect.objectContaining({
          paths: ["docs/research/nhm2-current-status-whitepaper.md"],
          source_target_intent: expect.objectContaining({
            active_doc_path: "docs/research/nhm2-current-status-whitepaper.md",
            explicit_doc_path:
              "docs/research/nhm2-current-status-whitepaper.md",
            deictic_prompt: false,
          }),
        }),
      }),
    ]);

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body,
      headers: {},
    });

    expect(result.ok).toBe(true);
    expect(result.text).toBe(process.env.CODEX_AGENT_FAKE_STDOUT);
    expect(
      (result.debug as any)?.workstation_gateway_call_results?.[0],
    ).toMatchObject({
      capability_id: "docs.search",
      observation: {
        active_document_observation: {
          path: "docs/research/nhm2-current-status-whitepaper.md",
          excerpt: expect.any(String),
        },
      },
    });
    expect(
      (result.debug as any)?.normalized_provider_observation_artifacts,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "doc_search_results",
          payload: expect.objectContaining({
            active_document_path:
              "docs/research/nhm2-current-status-whitepaper.md",
          }),
        }),
        expect.objectContaining({
          kind: "retrieval_context",
          payload: expect.objectContaining({
            path: "docs/research/nhm2-current-status-whitepaper.md",
            excerpt: expect.any(String),
          }),
        }),
      ]),
    );
    expect(
      result.turn_transcript_events?.some(
        (event: any) =>
          event.source_event_type === "tool_observation" &&
          /bounded document excerpt from docs\/research\/nhm2-current-status-whitepaper\.md/i.test(
            String(event.text),
          ),
      ),
    ).toBe(true);
  });

  it("materializes retained document context even when calculator is focused", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "- Retained doc claim boundary.\n- Still observation-backed.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const body = {
      turn_id: "ask:test:codex-retained-doc-context-after-calculator-focus",
      agent_runtime: "codex",
      question:
        "From this current document, what is the claim boundary? Answer in two short bullets.",
      workspace_context_snapshot: {
        activePanel: "scientific-calculator",
        focusedPanel: "scientific-calculator",
        openPanels: ["docs-viewer", "scientific-calculator"],
        activeDocPath: "/docs/helix-ask-flow.md",
        hasDocContext: true,
      },
    };

    const requests = buildActiveDocsContextWorkstationGatewayCallRequests(body);
    expect(requests).toEqual([
      expect.objectContaining({
        derivation_source: "helix_retained_active_doc_context",
        capability_id: "docs.search",
        arguments: expect.objectContaining({
          paths: ["docs/helix-ask-flow.md"],
          source_target_intent: expect.objectContaining({
            focused_panel: "scientific-calculator",
            active_doc_path: "docs/helix-ask-flow.md",
            retained_source_context: true,
          }),
        }),
      }),
    ]);

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body,
      headers: {},
    });

    expect(result.text).toBe(
      "- Retained doc claim boundary.\n- Still observation-backed.",
    );
    expect(
      (result.debug as any)?.workstation_gateway_call_results?.map(
        (entry: any) => entry.capability_id,
      ),
    ).toEqual(["docs.search"]);
    expect(
      result.turn_transcript_events?.map(
        (event: any) => event.source_event_type,
      ),
    ).toEqual([
      "runtime_selected",
      "context_state",
      "tool_request",
      "tool_observation",
      "model_reentry",
      "terminal_answer",
    ]);
    expect(
      result.turn_transcript_events?.some(
        (event: any) =>
          event.source_event_type === "context_state" &&
          /focused panel scientific-calculator; retained doc docs\/helix-ask-flow\.md/i.test(
            String(event.text),
          ),
      ),
    ).toBe(true);
    expect(
      result.turn_transcript_events?.some(
        (event: any) =>
          event.source_event_type === "tool_observation" &&
          /docs\.search materialized a bounded document excerpt from docs\/helix-ask-flow\.md/i.test(
            String(event.text),
          ),
      ),
    ).toBe(true);
    expect(result.workstation_actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "open_doc_at_line",
          doc_path: "docs/helix-ask-flow.md",
          line: expect.any(Number),
          observation_ref: expect.stringContaining("docs.search"),
        }),
      ]),
    );
    expect(
      (result.debug as any)?.codex_host_workstation_affordances
        ?.workstation_actions,
    ).toEqual(result.workstation_actions);

    const artifactQueryIndex = buildArtifactQueryIndex({
      turnId: "ask:test:codex-retained-doc-context-after-calculator-focus",
      payload: {
        ...result,
        turn_id: "ask:test:codex-retained-doc-context-after-calculator-focus",
      } as any,
    });
    expect(
      artifactQueryIndex.codex_parity_agent_spine_rail_table,
    ).toMatchObject({
      requested_capability: "docs.search",
      selected_capability: "docs.search",
      executed_capability: "docs.search",
      rail_status: "complete",
      codex_parity_class: "complete",
    });
    expect(artifactQueryIndex.tool_turn_chain_audit).toMatchObject({
      requested_capability: "docs.search",
      executed_capability: "docs.search",
      reentry_executed: true,
      rail_status: "complete",
      rail_failure_code: null,
    });

    const debugExportPayload = {
      ...result,
      turn_id: "ask:test:codex-retained-doc-context-after-calculator-focus",
    } as any;
    refreshToolLifecycleRecords({
      turnId: "ask:test:codex-retained-doc-context-after-calculator-focus",
      payload: debugExportPayload,
    });
    const refreshedArtifactQueryIndex = buildArtifactQueryIndex({
      turnId: "ask:test:codex-retained-doc-context-after-calculator-focus",
      payload: debugExportPayload,
    });
    expect(
      refreshedArtifactQueryIndex.codex_parity_agent_spine_rail_table,
    ).toMatchObject({
      requested_capability: "docs.search",
      selected_capability: "docs.search",
      executed_capability: "docs.search",
      reentry_status: "reentered",
      rail_status: "complete",
      codex_parity_class: "complete",
      rail_failure_code: null,
    });
  });

  it("normalizes docs observation excerpt transport without dropping provenance", () => {
    const excerpt = normalizeDocsObservationExcerptText(
      [
        "The frontier records `alpha = 0.7` and duplicate renderer echo `alpha=0.7` for the same inline value.",
        "",
        "  Claim locks remain closed.  ",
      ].join("\n"),
    );

    expect(excerpt).toContain("`alpha = 0.7`");
    expect(excerpt).toContain("Claim locks remain closed.");
    expect(excerpt).not.toContain("`alpha=0.7`");
  });

  it("keeps Codex docs final answer separate from visible gateway trace rows", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "- NHM2 is claim-bounded.\n- It does not claim physical viability.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-doc-final-answer-separate",
        agent_runtime: "codex",
        question:
          "Summarize this document from the current docs viewer context.",
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          activeDocPath: "/docs/helix-ask-flow.md",
          hasDocContext: true,
        },
      },
      headers: {},
    });

    expect(result.selected_final_answer).toBe(
      "- NHM2 is claim-bounded.\n- It does not claim physical viability.",
    );
    expect(result.text).toBe(result.selected_final_answer);
    expect(result.text).not.toContain("Tool observation:");
    expect(
      result.turn_transcript_events?.some(
        (event: any) =>
          event.source_event_type === "tool_observation" &&
          /docs\.search materialized a bounded document excerpt/i.test(
            String(event.text),
          ),
      ),
    ).toBe(true);
    expect(
      result.turn_transcript_events?.find(
        (event: any) => event.source_event_type === "terminal_answer",
      ),
    ).toMatchObject({
      text: result.selected_final_answer,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("projects explicit Codex calculator gateway calls into visible action/tool rows without templating final text", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT = "The result is 72.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-calculator-visible-trace",
        agent_runtime: "codex",
        question:
          "Use the scientific calculator to evaluate 8 * 9 and answer normally.",
        workstation_gateway_call: {
          capability_id: "scientific-calculator.solve_expression",
          mode: "read",
          arguments: {
            expression: "8 * 9",
          },
        },
      },
      headers: {},
    });

    expect(result.text).toBe("The result is 72.");
    expect(result.text).not.toContain(
      "Ran `scientific-calculator.solve_expression`.",
    );
    expect(result.text).not.toContain("Observed expression:");
    expect(result.workstation_actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "fill_calculator_expression",
          expression_text: "8 * 9",
          result: "72",
          observation_ref: expect.stringContaining(
            "scientific-calculator.solve_expression",
          ),
        }),
        expect.objectContaining({
          kind: "inspect_workstation_receipt",
          receipt_ref: expect.stringContaining(
            "scientific-calculator.open_panel",
          ),
        }),
        expect.objectContaining({
          kind: "inspect_workstation_receipt",
          receipt_ref: expect.stringContaining(
            "scientific-calculator.focus_panel",
          ),
        }),
        expect.objectContaining({
          kind: "inspect_workstation_receipt",
          receipt_ref: expect.stringContaining(
            "scientific-calculator.show_gateway_solve",
          ),
        }),
      ]),
    );
    expect(result.support_refs).toEqual(
      expect.arrayContaining([
        expect.stringContaining("scientific-calculator.solve_expression"),
      ]),
    );
    expect(result.tool_output_refs).toEqual(
      expect.arrayContaining([
        expect.stringContaining("scientific-calculator.solve_expression"),
        expect.stringContaining("scientific-calculator.open_panel"),
        expect.stringContaining("scientific-calculator.focus_panel"),
        expect.stringContaining("scientific-calculator.show_gateway_solve"),
      ]),
    );
    expect(
      (result.debug as any)?.codex_host_workstation_affordances,
    ).toMatchObject({
      schema: "helix.codex_host_workstation_affordances.v1",
      assistant_answer: false,
      raw_content_included: false,
      terminal_eligible: false,
      workstation_actions: result.workstation_actions,
      support_refs: result.support_refs,
      tool_output_refs: result.tool_output_refs,
    });
    expect((result.action_envelope as any)?.workstation_actions).toEqual([
      {
        schema_version: "helix.workstation.action/v1",
        action: "open_panel",
        panel_id: "scientific-calculator",
      },
      {
        schema_version: "helix.workstation.action/v1",
        action: "focus_panel",
        panel_id: "scientific-calculator",
      },
      {
        schema_version: "helix.workstation.action/v1",
        action: "run_panel_action",
        panel_id: "scientific-calculator",
        action_id: "show_gateway_solve",
        args: {
          expression: "8 * 9",
          normalized_expression: "8 * 9",
          result: "72",
          source_capability: "scientific-calculator.solve_expression",
          observation_ref:
            "ask:test:codex-calculator-visible-trace:scientific-calculator.solve_expression",
        },
      },
    ]);
    expect(
      (result.debug as any)?.agent_step_loop?.iterations?.map(
        (iteration: any) => iteration.chosen_capability,
      ),
    ).toEqual([
      "scientific-calculator.solve_expression",
      "scientific-calculator.open_panel",
      "scientific-calculator.focus_panel",
      "scientific-calculator.show_gateway_solve",
    ]);
    expect((result.debug as any)?.agent_runtime_adapter_contract).toMatchObject(
      {
        selected_agent_provider: {
          permission_profile: {
            id: "read-observe-act",
            allows: {
              read: true,
              act: true,
              write: false,
              shell: false,
              codeMutation: false,
            },
          },
        },
        workstation_gateway_admitted_capability_ids: expect.arrayContaining([
          "scientific-calculator.solve_expression",
        ]),
        workstation_gateway_projection_receipt_capability_ids:
          expect.arrayContaining([
            "scientific-calculator.open_panel",
            "scientific-calculator.focus_panel",
            "scientific-calculator.show_gateway_solve",
          ]),
      },
    );
    expect(
      (result.debug as any)?.agent_runtime_adapter_contract
        ?.workstation_gateway_blocked_capability_ids,
    ).not.toEqual(
      expect.arrayContaining([
        "scientific-calculator.open_panel",
        "scientific-calculator.focus_panel",
        "scientific-calculator.show_gateway_solve",
      ]),
    );
    expect(
      result.turn_transcript_events?.map(
        (event: any) => event.source_event_type,
      ),
    ).toEqual([
      "runtime_selected",
      "tool_request",
      "tool_observation",
      "action_request",
      "action_observation",
      "action_request",
      "action_observation",
      "action_request",
      "action_observation",
      "model_reentry",
      "terminal_answer",
    ]);
    expect(
      result.turn_transcript_events?.some((event: any) =>
        /Action observation: scientific-calculator\.open_panel admitted open_panel for scientific-calculator\./.test(
          String(event.text),
        ),
      ),
    ).toBe(true);
    expect(
      result.turn_transcript_events?.some((event: any) =>
        /Tool observation: scientific-calculator\.solve_expression observed 8 \* 9 = 72\./.test(
          String(event.text),
        ),
      ),
    ).toBe(true);
    expect((result.debug as any)?.provider_gateway_debug_summary).toMatchObject(
      {
        gateway_call_count: 4,
        gateway_action_receipt_count: 3,
        gateway_successful_action_receipt_count: 3,
        gateway_tool_observation_count: 1,
        gateway_successful_tool_observation_count: 1,
        gateway_observation_count: 1,
        terminal_authority_result:
          "authorized_by_terminal_authority_single_writer",
      },
    );
    expect((result as any).tool_lifecycle_trace).toMatchObject({
      schema: "helix.tool_lifecycle_trace.v1",
      requested_capability: "scientific-calculator.solve_expression",
      admitted_capability: "scientific-calculator.solve_expression",
      executed_capability: "scientific-calculator.solve_expression",
      lifecycle_stage: "reentered_solver",
      status: "completed",
      observation_refs: expect.arrayContaining([
        expect.stringContaining("scientific-calculator.solve_expression"),
      ]),
    });
    expect((result as any).tool_followup_decision).toMatchObject({
      schema: "helix.tool_followup_decision.v1",
      next_action: "terminal_answer",
      required_surface_satisfied: true,
      evidence_reentered: true,
    });
    expect((result.debug as any)?.tool_lifecycle_trace).toEqual(
      (result as any).tool_lifecycle_trace,
    );
    expect((result.debug as any)?.tool_followup_decision).toEqual(
      (result as any).tool_followup_decision,
    );
    expect((result.debug as any)?.turn_transcript_events).toEqual(
      result.turn_transcript_events,
    );

    const artifactQueryIndex = buildArtifactQueryIndex({
      turnId: "ask:test:codex-calculator-visible-trace",
      payload: {
        ...result,
        turn_id: "ask:test:codex-calculator-visible-trace",
      } as any,
    });
    expect(
      artifactQueryIndex.codex_parity_agent_spine_rail_table,
    ).toMatchObject({
      rail_status: "complete",
      codex_parity_class: "complete",
    });
    expect(artifactQueryIndex.tool_turn_chain_audit).toMatchObject({
      requested_capability: "scientific-calculator.solve_expression",
      executed_capability: "scientific-calculator.solve_expression",
      reentry_executed: true,
      rail_status: "complete",
      rail_failure_code: null,
    });
    expect(artifactQueryIndex.active_terminal_rail_status).toMatchObject({
      rail_status: "complete",
    });
  });

  it("materializes explicit calculator workstation evaluation when Codex returns no provider terminal text", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT = "";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn/stream",
      body: {
        turn_id:
          "ask:test:codex-calculator-workstation-evaluation-materialized",
        agent_runtime: "codex",
        question:
          "Call scientific-calculator.solve_expression with this exact expression: 2+2. Wait for calculator_receipt and answer from workstation_tool_evaluation.",
      },
      headers: {},
    });

    expect(result.ok).toBe(true);
    expect(result.response_type).toBe("final_answer");
    expect(result.final_status).toBe("completed");
    expect(result.final_answer_source).toBe("workstation_tool_evaluation");
    expect(result.terminal_artifact_kind).toBe("workstation_tool_evaluation");
    expect(result.text).toContain("Calculator verification plan completed.");
    expect(result.text).toContain("Expression: 2+2");
    expect(result.text).toContain("Result: 4");
    expect((result as any).workstation_tool_evaluation).toMatchObject({
      schema: "helix.workstation_tool_evaluation.v1",
      source: "calculator_receipt_materialization",
      expression: "2+2",
      result_text: "4",
    });
    expect((result.debug as any)?.provider_gateway_debug_summary).toMatchObject(
      {
        terminal_authority_result:
          "authorized_by_terminal_authority_single_writer",
        terminal_authority_granted: true,
        final_answer_source: "workstation_tool_evaluation",
        terminal_artifact_kind: "workstation_tool_evaluation",
      },
    );
    expect(
      (result.debug as any)?.terminal_authority_single_writer,
    ).toMatchObject({
      selected_terminal_artifact_kind: "workstation_tool_evaluation",
      source: "workstation_tool_evaluation",
    });
  });

  it("projects Codex interface-language gateway receipts into executable actions and workspace receipts", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "The workstation interface language was set to Hawaiian (`haw`).";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-interface-language-action",
        agent_runtime: "codex",
        question: "Set the workstation interface language to Hawaiian.",
      },
      headers: {},
    });

    expect(result.text).toBe(
      "The workstation interface language was set to Hawaiian (`haw`).",
    );
    expect((result.action_envelope as any)?.governance).toMatchObject({
      dispatch: "allow",
      reason: "admitted_mutating_preference_workstation_action",
      terminal_eligible: false,
      assistant_answer: false,
      raw_content_included: false,
    });
    expect((result.action_envelope as any)?.workstation_actions).toContainEqual(
      {
        schema_version: "helix.workstation.action/v1",
        action: "run_panel_action",
        panel_id: "account-session",
        action_id: "set_interface_language",
        args: {
          language: "haw",
        },
      },
    );
    expect((result.debug as any)?.current_turn_artifact_ledger).toContainEqual(
      expect.objectContaining({
        kind: "workspace_action_receipt",
        capability_key: "account_session.set_interface_language",
        payload: expect.objectContaining({
          schema: "helix.workspace_action_receipt.v1",
          kind: "workspace_action_receipt",
          target_id: "account-session",
          panel_id: "account-session",
          action_id: "set_interface_language",
          action_key: "account-session.set_interface_language",
          language: "haw",
          workstation_action: expect.objectContaining({
            action: "run_panel_action",
            panel_id: "account-session",
            action_id: "set_interface_language",
            args: { language: "haw" },
          }),
          assistant_answer: false,
          raw_content_included: false,
        }),
        assistant_answer: false,
        raw_content_included: false,
      }),
    );
  });

  it("preserves detailed Codex provider answers without Helix shortening or style rewrite", async () => {
    const detailedAnswer = [
      "The calculator observation gives a numeric anchor, but the implication is broader:",
      "",
      "First, the gateway result is evidence, not the answer itself. Codex can use it as a grounded input and then explain why the arithmetic matters in the user's context.",
      "",
      "Second, the workstation trace should remain visible alongside the answer. That lets the user inspect the tool request, the observation packet, and the model re-entry without those rows being spliced into the final prose.",
      "",
      "Third, preserving this full answer matters because a detailed prompt should not be collapsed into a terse receipt-style line just because a tool ran.",
    ].join("\n");
    process.env.CODEX_AGENT_FAKE_STDOUT = detailedAnswer;
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-detailed-answer-preserved",
        agent_runtime: "codex",
        question:
          "Use the scientific calculator to evaluate 8 * 9, then give a detailed explanation of what the tool-backed result means for the workstation loop.",
        workstation_gateway_call: {
          capability_id: "scientific-calculator.solve_expression",
          mode: "read",
          arguments: {
            expression: "8 * 9",
          },
        },
      },
      headers: {},
    });

    expect(result.text).toBe(detailedAnswer);
    expect(result.answer).toBe(detailedAnswer);
    expect(result.selected_final_answer).toBe(detailedAnswer);
    expect(result.text.length).toBe(detailedAnswer.length);
    expect(result.text).not.toContain("Tool observation:");
    expect(result.text).not.toContain(
      "Ran `scientific-calculator.solve_expression`.",
    );
    expect(
      (result.debug as any)?.agent_runtime_adapter_contract?.adapter_invariants,
    ).toMatchObject({
      helix_preserves_provider_answer_style: true,
      helix_style_rewrite_enabled: false,
    });
    expect((result.debug as any)?.provider_terminal_candidate).toMatchObject({
      candidate_text_length: detailedAnswer.length,
      candidate_text_hash: expect.any(String),
    });
    expect((result.debug as any)?.terminal_presentation).toMatchObject({
      concise_text: detailedAnswer,
      presentation_policy:
        "materialize_grounded_provider_candidate_as_route_product",
      helix_style_rewrite_applied: false,
    });
    expect(
      result.turn_transcript_events?.find(
        (event: any) => event.source_event_type === "terminal_answer",
      ),
    ).toMatchObject({
      text: detailedAnswer,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("routes explicit Codex theory reflection calls as visible observation-backed re-entry", async () => {
    const providerAnswer = [
      "The reflection observation is useful as context, not as proof.",
      "",
      "It points Codex toward claim-boundary badges, so the final answer should explain what remains bounded instead of pretending the theory graph certified the claim.",
    ].join("\n");
    process.env.CODEX_AGENT_FAKE_STDOUT = providerAnswer;
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-theory-reflection-visible-trace",
        agent_runtime: "codex",
        question:
          "Reflect QEI margin and source residual against the theory badge graph, then answer with the claim boundary.",
        workstation_gateway_call: {
          capability_id: "theory-badge-graph.reflect_discussion_context",
          mode: "read",
          arguments: {
            prompt:
              "Reflect QEI margin and source residual against the theory badge graph.",
            mentioned_symbols: ["QEI", "source residual"],
            mentioned_domains: ["warp metrics", "claim boundaries"],
            build_explanation_plan: true,
            limit: 4,
          },
        },
      },
      headers: {},
    });

    expect(result.text).toBe(providerAnswer);
    expect(result.text).not.toContain("Tool observation:");
    expect((result.action_envelope as any)?.workstation_actions ?? []).toEqual(
      [],
    );
    expect(
      (result.debug as any)?.workstation_gateway_call_results,
    ).toHaveLength(1);
    expect(
      (result.debug as any)?.workstation_gateway_call_results?.[0],
    ).toMatchObject({
      ok: true,
      capability_id: "theory-badge-graph.reflect_discussion_context",
      observation: {
        schema: "helix.theory_context_reflection_observation.v1",
        status: "succeeded",
        receipt_schema: "helix_theory_context_reflection_tool_receipt/v1",
        reflection_terminal_eligible: false,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation_packet: {
        panel_id: "theory-badge-graph",
        action: "reflect_discussion_context",
        status: "succeeded",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect((result.debug as any)?.provider_gateway_debug_summary).toMatchObject(
      {
        gateway_call_count: 1,
        gateway_action_receipt_count: 0,
        gateway_tool_observation_count: 1,
        gateway_successful_tool_observation_count: 1,
        gateway_observation_count: 1,
        terminal_authority_result:
          "authorized_by_terminal_authority_single_writer",
      },
    );
    expect(
      result.turn_transcript_events?.map(
        (event: any) => event.source_event_type,
      ),
    ).toEqual([
      "runtime_selected",
      "tool_request",
      "tool_observation",
      "model_reentry",
      "terminal_answer",
    ]);
    expect(
      result.turn_transcript_events?.some(
        (event: any) =>
          event.source_event_type === "tool_observation" &&
          /Theory Badge Graph reflection produced/i.test(String(event.text)),
      ),
    ).toBe(true);
    expect(
      result.turn_transcript_events?.find(
        (event: any) => event.source_event_type === "terminal_answer",
      ),
    ).toMatchObject({
      text: providerAnswer,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("routes explicit Codex civilization-bounds calls as visible observation-backed re-entry", async () => {
    const providerAnswer = [
      "The civilization-bounds observation gives situational constraints, not a decision.",
      "",
      "The final answer should explain missing evidence and capability bounds without treating the roadmap as policy authority.",
    ].join("\n");
    process.env.CODEX_AGENT_FAKE_STDOUT = providerAnswer;
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-civilization-bounds-visible-trace",
        agent_runtime: "codex",
        question:
          "Reflect planetary trade through civilization bounds, then answer with the missing evidence boundary.",
        workstation_gateway_call: {
          capability_id: "civilization-bounds.reflect_system_bounds",
          mode: "read",
          arguments: {
            prompt:
              "Reflect planetary trade through civilization bounds with material inventory and governance review.",
            include_bridge_context: true,
            include_collaboration_bounds: true,
            include_falsification_hooks: true,
          },
        },
      },
      headers: {},
    });

    expect(result.text).toBe(providerAnswer);
    expect(result.text).not.toContain("Tool observation:");
    expect((result.action_envelope as any)?.workstation_actions ?? []).toEqual(
      [],
    );
    expect(
      (result.debug as any)?.workstation_gateway_call_results,
    ).toHaveLength(1);
    expect(
      (result.debug as any)?.workstation_gateway_call_results?.[0],
    ).toMatchObject({
      ok: true,
      capability_id: "civilization-bounds.reflect_system_bounds",
      observation: {
        schema: "helix.civilization_bounds_reflection_observation.v1",
        status: "succeeded",
        bridge_context_included: true,
        procedural_scaffold_id: "spore_civilization_stage_procedural_scaffold",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation_packet: {
        panel_id: "civilization-bounds-roadmap",
        action: "reflect_system_bounds",
        status: "succeeded",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect((result.debug as any)?.provider_gateway_debug_summary).toMatchObject(
      {
        gateway_call_count: 1,
        gateway_action_receipt_count: 0,
        gateway_tool_observation_count: 1,
        gateway_successful_tool_observation_count: 1,
        gateway_observation_count: 1,
        terminal_authority_result:
          "authorized_by_terminal_authority_single_writer",
      },
    );
    expect(
      result.turn_transcript_events?.map(
        (event: any) => event.source_event_type,
      ),
    ).toEqual([
      "runtime_selected",
      "tool_request",
      "tool_observation",
      "model_reentry",
      "terminal_answer",
    ]);
    expect(
      result.turn_transcript_events?.some(
        (event: any) =>
          event.source_event_type === "tool_observation" &&
          /Civilization Bounds reflection produced/i.test(String(event.text)),
      ),
    ).toBe(true);
  });

  it("preserves compound Codex workstation observations before one final model re-entry", async () => {
    const providerAnswer = [
      "The compound turn has three evidence inputs: the document excerpt, the calculator result, and repo search context.",
      "",
      "The answer can synthesize those observations, but none of the receipts are themselves the final answer.",
    ].join("\n");
    process.env.CODEX_AGENT_FAKE_STDOUT = providerAnswer;
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-compound-docs-calculator-repo",
        agent_runtime: "codex",
        question:
          "Use the open document, calculate 8 * 9, search the repo for workstation_gateway, then synthesize the implication.",
        workstation_gateway_calls: [
          {
            capability_id: "docs.search",
            mode: "read",
            arguments: {
              query: "Helix Ask remains the grounded reasoning surface",
              paths: ["docs/helix-ask-flow.md"],
              max_hits: 2,
            },
          },
          {
            capability_id: "scientific-calculator.solve_expression",
            mode: "read",
            arguments: {
              expression: "8 * 9",
            },
          },
          {
            capability_id: "repo.search",
            mode: "read",
            arguments: {
              query: "workstation_gateway",
              paths: ["server/services/helix-ask"],
              max_hits: 2,
            },
          },
        ],
      },
      headers: {},
    });

    expect(result.text).toBe(providerAnswer);
    expect(result.text).not.toContain("Tool observation:");
    expect(
      (result.debug as any)?.workstation_gateway_call_results?.map(
        (entry: any) => entry.capability_id,
      ),
    ).toEqual([
      "docs.search",
      "scientific-calculator.solve_expression",
      "repo.search",
      "scientific-calculator.open_panel",
      "scientific-calculator.focus_panel",
      "scientific-calculator.show_gateway_solve",
    ]);
    expect((result.debug as any)?.provider_gateway_debug_summary).toMatchObject(
      {
        gateway_call_count: 6,
        gateway_action_receipt_count: 3,
        gateway_successful_action_receipt_count: 3,
        gateway_tool_observation_count: 3,
        gateway_successful_tool_observation_count: 3,
        gateway_observation_count: 3,
        terminal_authority_result:
          "authorized_by_terminal_authority_single_writer",
        final_answer_source: "compound_evidence_synthesis_answer",
        terminal_artifact_kind: "compound_evidence_synthesis_answer",
      },
    );
    expect((result as any).terminal_artifact_kind).toBe(
      "compound_evidence_synthesis_answer",
    );
    expect(
      (result.debug as any)?.compound_evidence_synthesis_answer,
    ).toMatchObject({
      schema: "helix.compound_evidence_synthesis_answer.v1",
      answer_text: providerAnswer,
      support_refs: expect.arrayContaining([
        expect.stringContaining("doc_location_matches"),
        expect.stringContaining("calculator_receipt"),
        expect.stringContaining("repo_code_evidence_observation"),
      ]),
    });
    expect(
      (result.debug as any)?.normalized_provider_observation_artifacts?.map(
        (artifact: any) => artifact.kind,
      ),
    ).toEqual(
      expect.arrayContaining([
        "doc_location_matches",
        "calculator_receipt",
        "repo_code_evidence_observation",
      ]),
    );
    expect(
      result.turn_transcript_events?.map(
        (event: any) => event.source_event_type,
      ),
    ).toEqual([
      "runtime_selected",
      "tool_request",
      "tool_observation",
      "tool_request",
      "tool_observation",
      "tool_request",
      "tool_observation",
      "action_request",
      "action_observation",
      "action_request",
      "action_observation",
      "action_request",
      "action_observation",
      "model_reentry",
      "terminal_answer",
    ]);
    expect(
      result.turn_transcript_events?.filter(
        (event: any) => event.source_event_type === "model_reentry",
      ),
    ).toHaveLength(1);
    expect(
      result.turn_transcript_events?.some(
        (event: any) =>
          event.source_event_type === "tool_observation" &&
          /docs\.search materialized a bounded document excerpt from docs\/helix-ask-flow\.md/i.test(
            String(event.text),
          ),
      ),
    ).toBe(true);
    expect(
      result.turn_transcript_events?.some(
        (event: any) =>
          event.source_event_type === "tool_observation" &&
          /scientific-calculator\.solve_expression observed 8 \* 9 = 72/i.test(
            String(event.text),
          ),
      ),
    ).toBe(true);
    expect(
      result.turn_transcript_events?.some(
        (event: any) =>
          event.source_event_type === "tool_observation" &&
          event.capability_id === "repo.search" &&
          /repo search/i.test(String(event.text)),
      ),
    ).toBe(true);
  });

  it("derives natural Codex compound workstation itinerary from retained docs, calculator, and repo prompt cues", async () => {
    const providerAnswer =
      "The natural compound turn synthesized the retained document, calculator result, and repo search.";
    process.env.CODEX_AGENT_FAKE_STDOUT = providerAnswer;
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-natural-compound-docs-calculator-repo",
        agent_runtime: "codex",
        question:
          "Use the current document, calculate 6*7, search the repo for workstation_gateway, then summarize what the observations prove and do not prove.",
        workspace_context_snapshot: {
          activePanel: "scientific-calculator",
          focusedPanel: "scientific-calculator",
          openPanels: ["docs-viewer", "scientific-calculator"],
          activeDocPath: "/docs/helix-ask-flow.md",
          hasDocContext: true,
        },
      },
      headers: {},
    });

    expect(result.text).toBe(providerAnswer);
    expect((result as any).terminal_artifact_kind).toBe(
      "compound_evidence_synthesis_answer",
    );
    expect((result as any).final_answer_source).toBe(
      "compound_evidence_synthesis_answer",
    );
    expect(
      (result.debug as any)?.workstation_gateway_call_results?.map(
        (entry: any) => entry.capability_id,
      ),
    ).toEqual([
      "docs.search",
      "scientific-calculator.solve_expression",
      "repo.search",
      "scientific-calculator.open_panel",
      "scientific-calculator.focus_panel",
      "scientific-calculator.show_gateway_solve",
    ]);
    expect(
      result.turn_transcript_events?.map(
        (event: any) => event.source_event_type,
      ),
    ).toEqual([
      "runtime_selected",
      "context_state",
      "tool_request",
      "tool_observation",
      "tool_request",
      "tool_observation",
      "tool_request",
      "tool_observation",
      "action_request",
      "action_observation",
      "action_request",
      "action_observation",
      "action_request",
      "action_observation",
      "model_reentry",
      "terminal_answer",
    ]);
    expect(
      result.turn_transcript_events?.some(
        (event: any) =>
          event.source_event_type === "tool_observation" &&
          event.capability_id === "docs.search" &&
          /bounded document excerpt from docs\/helix-ask-flow\.md/i.test(
            String(event.text),
          ),
      ),
    ).toBe(true);
    expect(
      result.turn_transcript_events?.some(
        (event: any) =>
          event.source_event_type === "tool_observation" &&
          event.capability_id === "scientific-calculator.solve_expression" &&
          /6\*7 = 42|6 \* 7 = 42/i.test(String(event.text)),
      ),
    ).toBe(true);
    expect(
      result.turn_transcript_events?.some(
        (event: any) =>
          event.source_event_type === "tool_observation" &&
          event.capability_id === "repo.search",
      ),
    ).toBe(true);
    expect(result.workstation_actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "open_repo_file",
          path: expect.any(String),
          line: expect.any(Number),
          observation_ref: expect.stringContaining("repo.search"),
        }),
      ]),
    );
    expect(result.support_refs).toEqual(
      expect.arrayContaining([expect.stringContaining("repo.search")]),
    );
    expect((result.debug as any)?.compound_capability_contract).toMatchObject({
      schema: "helix.compound_capability_contract.v1",
      rail_status: "satisfied",
      satisfied_subgoal_count: 3,
    });
  });

  it("completes mixed Codex docs plus percent calculator turns with normalized calculator evidence", async () => {
    const providerAnswer =
      "The document context is retained and the calculation is 6772.";
    process.env.CODEX_AGENT_FAKE_STDOUT = providerAnswer;
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const turnId = "ask:test:codex-mixed-doc-percent-calculator";
    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: turnId,
        agent_runtime: "codex",
        question:
          "Use the current document as context, then use the calculator to compute 12.5% of 54176. Give a short final answer with both the document-context note and the calculation.",
        workspace_context_snapshot: {
          activePanel: "scientific-calculator",
          focusedPanel: "scientific-calculator",
          openPanels: ["docs-viewer", "scientific-calculator"],
          activeDocPath: "/docs/helix-ask-flow.md",
          hasDocContext: true,
        },
      },
      headers: {},
    });

    expect(result.ok).toBe(true);
    expect(result.text).toBe(providerAnswer);
    expect((result as any).terminal_artifact_kind).toBe(
      "compound_evidence_synthesis_answer",
    );
    const calculatorResults = (
      (result.debug as any)?.workstation_gateway_call_results ?? []
    ).filter(
      (entry: any) =>
        entry.capability_id === "scientific-calculator.solve_expression",
    );
    expect(calculatorResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ok: true,
          observation: expect.objectContaining({
            expression: "12.5% of 54176",
            normalized_expression: "(12.5 / 100) * 54176",
            result: "6772",
            status: "succeeded",
          }),
        }),
      ]),
    );
    expect((result.debug as any)?.compound_capability_contract).toMatchObject({
      schema: "helix.compound_capability_contract.v1",
      rail_status: "satisfied",
      satisfied_subgoal_count: 2,
    });

    const artifactQueryIndex = buildArtifactQueryIndex({
      turnId,
      payload: {
        ...result,
        turn_id: turnId,
      } as any,
    });
    expect(
      artifactQueryIndex.codex_parity_agent_spine_rail_table,
    ).toMatchObject({
      requested_capability: "scientific-calculator.solve_expression",
      selected_capability: "scientific-calculator.solve_expression",
      executed_capability: "scientific-calculator.solve_expression",
      reentry_status: "reentered",
      goal_satisfaction: "completed",
      selected_terminal_kind: "compound_evidence_synthesis_answer",
      visible_terminal_kind: "compound_evidence_synthesis_answer",
      rail_status: "complete",
      codex_parity_class: "complete",
      rail_failure_code: null,
    });
  });

  it("derives the Codex workstation acceptance prompt into docs, calculator, scholarly, theory, and civ observations", async () => {
    const providerAnswer = [
      "The observations support a bounded synthesis across the current NHM2 document, the calculator result, paper lookup, theory reflection, and civilization-bounds reflection.",
      "They do not prove physical viability, transport authority, or full-document coverage beyond the materialized observation packets.",
    ].join("\n");
    process.env.CODEX_AGENT_FAKE_STDOUT = providerAnswer;
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<feed xmlns="http://www.w3.org/2005/Atom">',
          "<entry>",
          "<id>https://arxiv.org/abs/2606.00001</id>",
          "<title>Current NHM2 document calculate search arXiv quantum inequalities warp constraints QEI margin theory badge civilization bounds paper evidence</title>",
          "<summary>Scholarly paper evidence summarizes quantum inequalities, warp constraints, QEI margin, theory badge reflection, and civilization bounds.</summary>",
          "<published>2026-06-01T00:00:00Z</published>",
          "<author><name>A. Researcher</name></author>",
          "</entry>",
          "</feed>",
        ].join(""),
    })) as typeof fetch;

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-natural-acceptance-compound-itinerary",
        agent_runtime: "codex",
        question:
          "use this current NHM2 document, calculate 6*7, search research papers on arXiv for quantum inequalities and warp constraints, reflect QEI margin through theory badge graph, and reflect civilization bounds",
        workspace_context_snapshot: {
          activePanel: "scientific-calculator",
          focusedPanel: "scientific-calculator",
          openPanels: ["docs-viewer", "scientific-calculator"],
          activeDocPath: "docs/research/nhm2-current-status-whitepaper.md",
          hasDocContext: true,
        },
      },
      headers: {},
    });

    expect(result.text).toBe(providerAnswer);
    expect(result.ok).toBe(true);
    expect((result as any).terminal_artifact_kind).toBe(
      "compound_evidence_synthesis_answer",
    );
    expect((result as any).final_answer_source).toBe(
      "compound_evidence_synthesis_answer",
    );
    const capabilityIds = (
      result.debug as any
    )?.workstation_gateway_call_results?.map(
      (entry: any) => entry.capability_id,
    );
    expect(capabilityIds).toEqual(
      expect.arrayContaining([
        "docs.search",
        "scientific-calculator.solve_expression",
        "scholarly-research.lookup_papers",
        "theory-badge-graph.reflect_discussion_context",
        "civilization-bounds.reflect_system_bounds",
      ]),
    );
    expect(capabilityIds.slice(0, 5)).toEqual([
      "docs.search",
      "scientific-calculator.solve_expression",
      "theory-badge-graph.reflect_discussion_context",
      "civilization-bounds.reflect_system_bounds",
      "scholarly-research.lookup_papers",
    ]);
    expect(result.turn_transcript_events?.[0]).toMatchObject({
      source_event_type: "runtime_selected",
    });
    expect(String(result.turn_transcript_events?.[0]?.text)).toContain(
      "Codex Workstation Mode",
    );
    for (const capabilityId of [
      "docs.search",
      "scientific-calculator.solve_expression",
      "scholarly-research.lookup_papers",
      "theory-badge-graph.reflect_discussion_context",
      "civilization-bounds.reflect_system_bounds",
    ]) {
      expect(
        result.turn_transcript_events?.some(
          (event: any) =>
            event.source_event_type === "tool_request" &&
            event.capability_id === capabilityId,
        ),
      ).toBe(true);
      expect(
        result.turn_transcript_events?.some(
          (event: any) =>
            event.source_event_type === "tool_observation" &&
            event.capability_id === capabilityId &&
            event.status === "completed",
        ),
      ).toBe(true);
    }
    expect(
      result.turn_transcript_events?.filter(
        (event: any) => event.source_event_type === "model_reentry",
      ),
    ).toHaveLength(1);
    expect(
      result.turn_transcript_events?.find(
        (event: any) => event.source_event_type === "terminal_answer",
      ),
    ).toMatchObject({
      text: providerAnswer,
    });
    expect(
      (result.debug as any)?.normalized_provider_observation_artifacts?.map(
        (artifact: any) => artifact.kind,
      ),
    ).toEqual(
      expect.arrayContaining([
        "doc_location_matches",
        "calculator_receipt",
        "helix_theory_context_reflection_tool_receipt",
        "helix_civilization_bounds_tool_result",
        "scholarly_research_observation",
      ]),
    );
    expect(
      (result.debug as any)?.provider_observation_normalization_failures,
    ).toEqual([]);
    expect((result.debug as any)?.compound_capability_contract).toMatchObject({
      schema: "helix.compound_capability_contract.v1",
      rail_status: "satisfied",
      satisfied_subgoal_count: 5,
    });
    expect(
      (result.debug as any)?.compound_evidence_synthesis_answer,
    ).toMatchObject({
      schema: "helix.compound_evidence_synthesis_answer.v1",
      answer_text: providerAnswer,
      support_refs: expect.arrayContaining([
        expect.stringContaining("doc_location_matches"),
        expect.stringContaining("calculator_receipt"),
        expect.stringContaining("helix_theory_context_reflection_tool_receipt"),
        expect.stringContaining("helix_civilization_bounds_tool_result"),
        expect.stringContaining("scholarly_research_observation"),
      ]),
    });
    expect((result.debug as any)?.terminal_artifact_kind).toBe(
      "compound_evidence_synthesis_answer",
    );
  });

  it("fails closed when one compound Codex gateway observation is missing", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "The calculator and reflection both ran successfully.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-compound-missing-reflection-observation",
        agent_runtime: "codex",
        question:
          "Calculate 8 * 9, reflect it against the theory badge graph, then answer.",
        workstation_gateway_calls: [
          {
            capability_id: "scientific-calculator.solve_expression",
            mode: "read",
            arguments: {
              expression: "8 * 9",
            },
          },
          {
            capability_id: "theory-badge-graph.reflect_discussion_context",
            mode: "read",
            arguments: {},
          },
        ],
      },
      headers: {},
    });

    expect(result.ok).toBe(false);
    expect(result.text).toContain(
      "I cannot claim the requested workstation tool or UI action ran",
    );
    expect(result.text).toContain(
      "theory-badge-graph.reflect_discussion_context: theory_reflection_prompt_missing",
    );
    expect(result.text).not.toBe(
      "The calculator and reflection both ran successfully.",
    );
    expect(
      (result.debug as any)?.workstation_gateway_call_results?.map(
        (entry: any) => ({
          capability_id: entry.capability_id,
          ok: entry.ok,
        }),
      ),
    ).toEqual([
      { capability_id: "scientific-calculator.solve_expression", ok: true },
      {
        capability_id: "theory-badge-graph.reflect_discussion_context",
        ok: false,
      },
      { capability_id: "scientific-calculator.open_panel", ok: true },
      { capability_id: "scientific-calculator.focus_panel", ok: true },
      { capability_id: "scientific-calculator.show_gateway_solve", ok: true },
    ]);
    expect(
      result.turn_transcript_events?.some(
        (event: any) =>
          event.source_event_type === "tool_observation" &&
          event.capability_id ===
            "theory-badge-graph.reflect_discussion_context" &&
          event.status === "failed",
      ),
    ).toBe(true);
    expect(
      result.turn_transcript_events?.find(
        (event: any) => event.source_event_type === "terminal_answer",
      ),
    ).toMatchObject({
      text: result.text,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("does not publish Codex read-aloud claims when docs evidence exists but narrator receipt is blocked", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT = "I read the document aloud.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-compound-read-aloud-voice-blocked",
        agent_runtime: "codex",
        question:
          "Use the explicit workstation gateway calls to read aloud the document excerpt, then answer.",
        workstation_gateway_calls: [
          {
            capability_id: "docs-viewer.read_visible_surface",
            mode: "read",
            arguments: {
              label: "document excerpt",
              source_doc_path: "docs/needle-hull-mainframe.md",
              source_target_intent: {
                source: "helix_compound_capability_dependency_planner",
                compound_outcome: "read_aloud_surface",
                subgoal_id: "read_aloud_surface:surface_observation",
                subgoal_ordinal: 1,
                target_source: "docs_viewer",
                target_kind: "docs_visible_surface",
                required_observation_kind:
                  "helix.workstation_readable_surface_observation.v1",
                dependency_edges: [
                  {
                    from: "read_aloud_surface:surface_observation",
                    to: "read_aloud_surface:narrator_receipt",
                    binding: "surface_observation_to_voice_text",
                  },
                ],
              },
            },
          },
          {
            capability_id: "live_env.narrator_say",
            mode: "act",
            arguments: {
              text: "Needle hull document excerpt.",
              kind: "narrator_read",
              requires_confirmation: true,
              source_target_intent: {
                source: "helix_compound_capability_dependency_planner",
                compound_outcome: "read_aloud_surface",
                subgoal_id: "read_aloud_surface:narrator_receipt",
                subgoal_ordinal: 2,
                target_source: "voice_delivery",
                target_kind: "narrator_say",
                required_receipt_kind:
                  "helix.interim_voice_callout_tool_result.v1",
                depends_on_subgoal_id: "read_aloud_surface:surface_observation",
                depends_on_capability_id: "docs-viewer.read_visible_surface",
                dependency_binding: "surface_observation_to_voice_text",
              },
            },
          },
        ],
      },
      headers: {},
    });

    expect(result.ok).toBe(false);
    expect(result.text).toContain(
      "I cannot claim the requested workstation tool or UI action ran",
    );
    expect(result.text).toContain("live_env.narrator_say: blocked_policy");
    expect(result.text).not.toContain("I read the document aloud");
    expect(
      (result.debug as any)?.workstation_gateway_call_results?.map(
        (entry: any) => ({
          capability_id: entry.capability_id,
          ok: entry.ok,
          status: entry.observation_packet?.status,
          blocked_reason: entry.gateway_admission?.blocked_reason,
        }),
      ),
    ).toEqual([
      {
        capability_id: "docs-viewer.read_visible_surface",
        ok: true,
        status: "succeeded",
        blocked_reason: undefined,
      },
      {
        capability_id: "live_env.narrator_say",
        ok: false,
        status: "blocked",
        blocked_reason: "blocked_policy",
      },
    ]);
    expect(
      (result.debug as any)?.workstation_gateway_call_results?.[0]
        ?.observation_packet?.state_delta,
    ).toMatchObject({
      compound_dependency_turn_plan: {
        schema: "helix.compound_capability_dependency_turn_plan.v1",
        compound_outcomes: ["read_aloud_surface"],
        rail_status: "blocked",
        first_broken_rail: {
          subgoal_id: "read_aloud_surface:narrator_receipt",
          requested_capability: "live_env.narrator_say",
          satisfied: false,
          error: "blocked_policy",
        },
        ordered_subgoals: [
          {
            subgoal_id: "read_aloud_surface:surface_observation",
            requested_capability: "docs-viewer.read_visible_surface",
            executed_capability: "docs-viewer.read_visible_surface",
            satisfied: true,
          },
          {
            subgoal_id: "read_aloud_surface:narrator_receipt",
            requested_capability: "live_env.narrator_say",
            executed_capability: null,
            required_receipt_kind: "helix.interim_voice_callout_tool_result.v1",
            satisfied: false,
            rail_status: "missing_observation",
          },
        ],
      },
    });
  });

  it("projects explicit Codex docs-viewer open-doc gateway calls as action receipts", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT = "Opened the requested document.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-docs-open-doc-action-receipt",
        agent_runtime: "codex",
        question:
          "Open docs/helix-ask-api-parity-matrix.md in the docs viewer and tell me when the action receipt is available.",
        workstation_gateway_call: {
          capability_id: "docs-viewer.open_doc",
          mode: "act",
          arguments: {
            path: "docs/helix-ask-api-parity-matrix.md",
          },
        },
      },
      headers: {},
    });

    expect(result.text).toBe("Opened the requested document.");
    expect((result.action_envelope as any)?.workstation_actions).toEqual([
      {
        schema_version: "helix.workstation.action/v1",
        action: "run_panel_action",
        panel_id: "docs-viewer",
        action_id: "open_doc",
        args: {
          path: "docs/helix-ask-api-parity-matrix.md",
        },
      },
    ]);
    expect(
      result.turn_transcript_events?.map(
        (event: any) => event.source_event_type,
      ),
    ).toEqual([
      "runtime_selected",
      "action_request",
      "action_observation",
      "model_reentry",
      "terminal_answer",
    ]);
    expect(
      result.turn_transcript_events?.some((event: any) =>
        /Action observation: docs-viewer\.open_doc admitted open_doc for docs-viewer\./.test(
          String(event.text),
        ),
      ),
    ).toBe(true);
    expect(result.text).not.toContain("Action observation:");
  });

  it("does not answer explicit docs-path content from an open-doc action receipt without a docs observation", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "The API parity matrix says live server probes are complete.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-docs-open-doc-no-content-authority",
        agent_runtime: "codex",
        question:
          "Open docs/helix-ask-api-parity-matrix.md in the docs viewer and summarize it.",
        workstation_gateway_call: {
          capability_id: "docs-viewer.open_doc",
          mode: "act",
          arguments: {
            path: "docs/helix-ask-api-parity-matrix.md",
          },
        },
      },
      headers: {},
    });

    expect((result.action_envelope as any)?.workstation_actions).toEqual([
      {
        schema_version: "helix.workstation.action/v1",
        action: "run_panel_action",
        panel_id: "docs-viewer",
        action_id: "open_doc",
        args: {
          path: "docs/helix-ask-api-parity-matrix.md",
        },
      },
    ]);
    expect(result.ok).toBe(false);
    expect(result.terminal_artifact_kind).toBe("typed_failure");
    expect(result.text).not.toContain("API parity matrix says");
    expect(
      result.turn_transcript_events?.some(
        (event: any) =>
          event.source_event_type === "action_observation" &&
          /docs-viewer\.open_doc admitted open_doc for docs-viewer/i.test(
            String(event.text),
          ),
      ),
    ).toBe(true);
    expect(
      result.turn_transcript_events?.find(
        (event: any) => event.source_event_type === "terminal_answer",
      ),
    ).toMatchObject({
      text: expect.stringContaining(
        "no docs observation packet was materialized",
      ),
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("projects explicit Codex safe workstation open-panel gateway calls as action receipts", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT = "Opened the process graph panel.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-workstation-open-panel-action-receipt",
        agent_runtime: "codex",
        question:
          "Open the workstation process graph panel and answer normally after the receipt.",
        workstation_gateway_call: {
          capability_id: "workstation.open_panel",
          mode: "act",
          arguments: {
            panel_id: "workstation-process-graph",
          },
        },
      },
      headers: {},
    });

    expect(result.text).toBe("Opened the process graph panel.");
    expect((result.action_envelope as any)?.workstation_actions).toEqual([
      {
        schema_version: "helix.workstation.action/v1",
        action: "open_panel",
        panel_id: "workstation-process-graph",
      },
    ]);
    expect(
      result.turn_transcript_events?.map(
        (event: any) => event.source_event_type,
      ),
    ).toEqual([
      "runtime_selected",
      "action_request",
      "action_observation",
      "model_reentry",
      "terminal_answer",
    ]);
    expect(
      result.turn_transcript_events?.some((event: any) =>
        /Action observation: workstation\.open_panel admitted open_panel for workstation-process-graph\./.test(
          String(event.text),
        ),
      ),
    ).toBe(true);
    expect(result.text).not.toContain("Action observation:");
  });

  it("does not add calculator provenance when no calculator observation exists", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT = "72";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-calculator-no-observation",
        agent_runtime: "codex",
        question: "What is 8 * 9?",
      },
      headers: {},
    });

    expect(result.text).toBe("72");
    expect(result.text).not.toContain("scientific-calculator.solve_expression");
    expect(
      result.turn_transcript_events?.some(
        (event: any) => event.source_event_type === "tool_observation",
      ),
    ).toBe(false);
  });

  it("fails closed when a fresh environment follow-up produces no current-turn observation", async () => {
    const unsupportedClaim = [
      "Your current Minecraft inventory, from a fresh read for the same bound participant, is:",
      "- 11x minecraft:oak_log",
      "- 2x minecraft:sand",
      "- 2x minecraft:stick",
    ].join("\n");
    process.env.CODEX_AGENT_FAKE_STDOUT = unsupportedClaim;
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id:
          "ask:test:codex-environment-followup-current-turn-evidence-required",
        agent_runtime: "codex",
        question:
          "Now check my current Minecraft inventory. Tell me what I am carrying and whether I have useful equipment, using a fresh environment observation for the same room participant.",
        canonical_goal_frame: {
          goal_kind: "live_environment_review",
          required_terminal_kind: "model_synthesized_answer",
          allowed_terminal_artifact_kinds: [
            "model_synthesized_answer",
            "typed_failure",
          ],
          forbidden_terminal_artifact_kinds: [
            "direct_answer_text",
            "no_tool_direct",
          ],
        },
        tool_call_admission_decision: {
          required: true,
          reason: "fresh_current_turn_environment_observation_required",
        },
      },
      headers: {},
    });

    expect(result.ok).toBe(false);
    expect(result.response_type).toBe("final_failure");
    expect(result.terminal_artifact_kind).toBe("typed_failure");
    expect(result.text).not.toContain("11x minecraft:oak_log");
    expect((result.debug as any)?.provider_reasoning_reentry).toMatchObject({
      model_only_direct_answer_allowed: false,
      evidence_reentered: false,
    });
    expect((result.debug as any)?.terminal_authority_status).not.toBe(
      "authorized_no_gateway_tool_required",
    );
  });

  it("does not publish Codex claims when a requested gateway action was blocked", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT = "I wrote the requested file.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-blocked-gateway-visible-claim",
        agent_runtime: "codex",
        question: "Write blocked content into server/routes/agi.plan.ts.",
        workstation_gateway_call: {
          capability_id: "filesystem.write_file",
          mode: "act",
          arguments: {
            path: "server/routes/agi.plan.ts",
            text: "blocked",
          },
        },
      },
      headers: {},
    });

    expect(result.ok).toBe(false);
    expect(result.response_type).toBe("final_failure");
    expect(result.final_status).toBe("final_failure");
    expect(result.text).toContain(
      "cannot claim the requested workstation tool or UI action ran",
    );
    expect(result.text).toContain(
      "filesystem.write_file: capability_not_registered",
    );
    expect(result.text).not.toContain("I wrote the requested file");
    expect((result.debug as any)?.terminal_authority_status).toBe(
      "blocked_by_observation_state",
    );
    expect((result.debug as any)?.terminal_answer_authority).toMatchObject({
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_kind: "failure",
      server_authoritative: true,
    });
    expect((result.debug as any)?.provider_gateway_debug_summary).toMatchObject(
      {
        blocked_capabilities: [
          expect.objectContaining({
            requested_capability: "filesystem.write_file",
            blocked_reason: "capability_not_registered",
          }),
        ],
        terminal_authority_granted: true,
        final_visible_answer_authorized: true,
      },
    );
    expect(
      result.turn_transcript_events?.find(
        (event: any) => event.source_event_type === "terminal_answer",
      ),
    ).toMatchObject({
      status: "final_failure",
      text: result.text,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("does not publish Codex repo claims when natural repo search is missing a query", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "I searched the repo and found the answer.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-natural-repo-search-missing-query",
        agent_runtime: "codex",
        question: "Search the repo and tell me what you find.",
      },
      headers: {},
    });

    expect(result.ok).toBe(false);
    expect(result.response_type).toBe("final_failure");
    expect(result.final_status).toBe("final_failure");
    expect(result.text).toContain(
      "cannot claim the requested workstation tool or UI action ran",
    );
    expect(result.text).toContain("repo.search: missing_query");
    expect(result.text).not.toContain(
      "I searched the repo and found the answer",
    );
    expect(
      (result.debug as any)?.workstation_gateway_call_results?.map(
        (entry: any) => ({
          capability_id: entry.capability_id,
          ok: entry.ok,
          error: entry.error,
          blocked_reason: entry.gateway_admission?.blocked_reason,
        }),
      ),
    ).toEqual([
      {
        capability_id: "repo.search",
        ok: false,
        error: "missing_query",
        blocked_reason: "missing_query",
      },
    ]);
    expect((result.debug as any)?.provider_gateway_debug_summary).toMatchObject(
      {
        requested_capabilities: ["repo.search"],
        blocked_capabilities: [
          expect.objectContaining({
            requested_capability: "repo.search",
            blocked_reason: "missing_query",
          }),
        ],
        terminal_authority_granted: true,
        final_visible_answer_authorized: true,
      },
    );
    expect(
      result.turn_transcript_events?.map(
        (event: any) => event.source_event_type,
      ),
    ).toEqual([
      "runtime_selected",
      "tool_request",
      "tool_observation",
      "model_reentry",
      "terminal_answer",
    ]);
    expect(
      result.turn_transcript_events?.find(
        (event: any) => event.source_event_type === "tool_observation",
      ),
    ).toMatchObject({
      capability_id: "repo.search",
      status: "failed",
      assistant_answer: false,
      raw_content_included: false,
    });
    expect(
      result.turn_transcript_events?.find(
        (event: any) => event.source_event_type === "terminal_answer",
      ),
    ).toMatchObject({
      status: "final_failure",
      text: result.text,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("materializes active calculator context as a bounded observation for Codex", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "The calculator is showing 8 * 9 = 72.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const body = {
      turn_id: "ask:test:codex-active-calculator-context",
      agent_runtime: "codex",
      question: "What is this calculator result?",
      workspace_context_snapshot: {
        activePanel: "scientific-calculator",
        activeCalculatorContext: {
          current_latex: "8 * 9",
          last_result_text: "72",
          last_normalized_expression: "8*9",
          last_ok: true,
          step_count: 1,
          recent_debug_events: [
            {
              action_id: "solve_expression",
              ok: true,
              input_latex: "8 * 9",
              result_text: "72",
              normalized_expression: "8*9",
              message: "solve_completed",
              ts: "2026-06-28T00:00:00.000Z",
            },
          ],
        },
      },
    };

    expect(
      buildActiveCalculatorContextWorkstationGatewayCallRequests(body),
    ).toEqual([
      expect.objectContaining({
        schema:
          "helix.workstation_gateway.active_calculator_context_call_request.v1",
        derivation_source: "helix_active_scientific_calculator_context",
        capability_id: "scientific-calculator.active_context",
        mode: "read",
        arguments: expect.objectContaining({
          active_context: expect.objectContaining({
            current_latex: "8 * 9",
            last_result_text: "72",
          }),
          source_target_intent: expect.objectContaining({
            target_source: "active_calculator",
            target_kind: "active_calculator",
            active_panel: "scientific-calculator",
            deictic_prompt: true,
          }),
        }),
      }),
    ]);

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body,
      headers: {},
    });

    expect(result.text).toBe("The calculator is showing 8 * 9 = 72.");
    expect(
      (result.debug as any)?.workstation_gateway_call_results?.map(
        (entry: any) => entry.capability_id,
      ),
    ).toEqual(["scientific-calculator.active_context"]);
    expect(
      result.turn_transcript_events?.some(
        (event: any) =>
          event.source_event_type === "tool_observation" &&
          /scientific-calculator\.active_context materialized active calculator context for 8 \* 9 with result 72/i.test(
            String(event.text),
          ),
      ),
    ).toBe(true);
    expect(
      result.turn_transcript_events?.some(
        (event: any) =>
          event.source_event_type === "model_reentry" &&
          /received the workstation observation packet/i.test(
            String(event.text),
          ),
      ),
    ).toBe(true);
  });

  it("does not derive active calculator context from contextual or quoted deictic mentions", () => {
    const baseBody = {
      turn_id: "ask:test:codex-active-calculator-context-adversarial",
      agent_runtime: "codex",
      workspace_context_snapshot: {
        activePanel: "scientific-calculator",
        activeCalculatorContext: {
          current_latex: "8 * 9",
          last_result_text: "72",
        },
      },
    };
    const prompts = [
      "I am not asking about this calculator result; explain what a calculator result means in general.",
      "Before I open the calculator, explain how results should be checked.",
      "The previous answer mentioned this calculator result; explain why that was not enough evidence.",
      'The screen shows a label that says "What is this calculator result?" Explain why that label is confusing.',
      "If we later focus the calculator, explain what evidence would be needed.",
    ];

    prompts.forEach((question) => {
      expect(
        buildActiveCalculatorContextWorkstationGatewayCallRequests({
          ...baseBody,
          question,
        }),
      ).toEqual([]);
    });
  });

  it("does not answer current calculator content when no calculator observation exists", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "The current calculator result is 72.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-active-calculator-no-observation",
        agent_runtime: "codex",
        question: "What is this calculator result?",
        workspace_context_snapshot: {
          activePanel: "scientific-calculator",
        },
      },
      headers: {},
    });

    expect(result.text).toContain(
      "no calculator observation packet was materialized",
    );
    expect(result.text).not.toContain("72");
    expect(
      result.turn_transcript_events?.some(
        (event: any) => event.source_event_type === "tool_observation",
      ),
    ).toBe(false);
  });

  it("materializes active workstation panel context as a bounded observation for Codex", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "The active panel is docs-viewer, with the calculator also open.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const body = {
      turn_id: "ask:test:codex-active-workstation-context",
      agent_runtime: "codex",
      question: "What panel in the workstation is active?",
      workspace_context_snapshot: {
        activePanel: "docs-viewer",
        activeGroupId: "main",
        groupCount: 1,
        openPanels: ["docs-viewer", "scientific-calculator"],
      },
    };

    expect(buildActiveWorkstationContextGatewayCallRequests(body)).toEqual([
      expect.objectContaining({
        schema:
          "helix.workstation_gateway.active_workstation_context_call_request.v1",
        derivation_source: "helix_active_workstation_context",
        capability_id: "workstation.active_context",
        mode: "read",
        arguments: expect.objectContaining({
          workspace_context: expect.objectContaining({
            activePanel: "docs-viewer",
            openPanels: ["docs-viewer", "scientific-calculator"],
          }),
          source_target_intent: expect.objectContaining({
            target_source: "active_workstation",
            target_kind: "active_workstation",
            deictic_prompt: true,
          }),
        }),
      }),
    ]);
    expect(
      buildActiveWorkstationContextGatewayCallRequests({
        ...body,
        question:
          "Okay, using only what humans actually know, tell me which workstation panel you are currently looking at.",
      }),
    ).toEqual([
      expect.objectContaining({
        capability_id: "workstation.active_context",
        mode: "read",
      }),
    ]);
    expect(
      buildActiveWorkstationContextGatewayCallRequests({
        ...body,
        question: "What panel do you see?",
      }),
    ).toEqual([
      expect.objectContaining({
        capability_id: "workstation.active_context",
        mode: "read",
      }),
    ]);
    expect(buildPromptDerivedInternetSearchGatewayCallRequests(body)).toEqual(
      [],
    );

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body,
      headers: {},
    });

    expect(result.text).toBe(
      "The active panel is docs-viewer, with the calculator also open.",
    );
    expect(
      (result.debug as any)?.workstation_gateway_call_results?.map(
        (entry: any) => entry.capability_id,
      ),
    ).toEqual(["workstation.active_context"]);
    expect(
      result.turn_transcript_events?.some(
        (event: any) =>
          event.source_event_type === "tool_observation" &&
          /workstation\.active_context materialized active workstation context with active panel docs-viewer and 2 open panel/i.test(
            String(event.text),
          ),
      ),
    ).toBe(true);

    const realtimeHandoffResult = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        ...body,
        turn_id: "ask:test:codex-active-workstation-context-realtime-handoff",
        question: "What panel in the workstation is active?",
        route_metadata: {
          source: "realtime_stage_play",
          invocationKind: "stage_play_realtime_transcript_handoff",
          forbiddenCapabilities: [
            "workstation_mutation",
            "workstation_action_execution",
            "realtime_provider_tool_execution",
          ],
          source_target_intent: {
            source: "stage_play_realtime_handoff",
            target_source: "operator_text",
            target_kind: "realtime_transcript",
            strength: "hard",
            must_enter_backend_ask: true,
            allow_client_shortcut: false,
            allow_no_tool_direct: false,
            admitted_readonly_handoff: true,
            required_grounding_capability_ids: ["workstation.active_context"],
          },
        },
      },
      headers: {},
    });
    expect(
      (realtimeHandoffResult.debug as any)?.workstation_gateway_call_results,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ok: true,
          capability_id: "workstation.active_context",
          observation_packet: expect.objectContaining({ status: "succeeded" }),
        }),
      ]),
    );
  });

  it("does not derive active workstation context when the prompt explicitly forbids tools", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "I am using codex / Codex Workstation Mode through the helix_agent_provider_edge adapter boundary.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const body = {
      turn_id: "ask:test:codex-no-tool-provider-identity",
      agent_runtime: "codex",
      question:
        "Do not open panels or run tools. Just tell me which provider you are using and whether you can see the workstation capability manifest.",
      workspace_context_snapshot: {
        activePanel: "docs-viewer",
        activeGroupId: "main",
        groupCount: 1,
        openPanels: ["docs-viewer", "scientific-calculator"],
      },
    };

    expect(buildActiveWorkstationContextGatewayCallRequests(body)).toEqual([]);

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body,
      headers: {},
    });

    expect(result.text).toContain("codex / Codex Workstation Mode");
    expect(result.text).toContain("helix_agent_provider_edge");
    expect((result.debug as any)?.workstation_gateway_call_results).toEqual([]);
    expect(
      result.turn_transcript_events?.some(
        (event: any) =>
          event.source_event_type === "tool_request" ||
          event.source_event_type === "tool_observation",
      ),
    ).toBe(false);
  });

  it("does not derive active workstation context from contextual or quoted panel mentions", () => {
    const baseBody = {
      turn_id: "ask:test:codex-active-workstation-context-adversarial",
      agent_runtime: "codex",
      workspace_context_snapshot: {
        activePanel: "docs-viewer",
        openPanels: ["docs-viewer", "scientific-calculator"],
      },
    };
    const prompts = [
      "I am not asking about the current open panels; explain what a panel means in general.",
      "I am not asking which workstation panel you are currently looking at; explain the phrase instead.",
      "Before I open a panel, explain what evidence would be needed.",
      "If we later ask which workstation panel you are currently looking at, explain what evidence would be needed.",
      "The previous answer mentioned which panel was active; explain why that was insufficient.",
      'The screen shows text that says "what panels are open"; explain the wording.',
      "The screen text says which workstation panel you are currently looking at; explain that wording.",
      "If we later switch panels, tell me what observation would be needed.",
    ];

    prompts.forEach((question) => {
      expect(
        buildActiveWorkstationContextGatewayCallRequests({
          ...baseBody,
          question,
        }),
      ).toEqual([]);
    });
    expect(
      buildActiveWorkstationContextGatewayCallRequests({
        ...baseBody,
        question:
          "If we ask later which workstation panel you are currently looking at, wait; right now tell me which workstation panel you are currently looking at.",
      }),
    ).toHaveLength(1);
  });

  it("does not answer current workstation panel state when no workstation observation exists", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT = "The docs viewer is active.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-active-workstation-no-observation",
        agent_runtime: "codex",
        question: "What panels are open and which panel is active?",
      },
      headers: {},
    });

    expect(result.text).toContain(
      "no workstation context observation packet was materialized",
    );
    expect(result.text).not.toContain("docs viewer is active");
    expect(
      result.turn_transcript_events?.some(
        (event: any) => event.source_event_type === "tool_observation",
      ),
    ).toBe(false);
  });

  it("does not answer current document content when no docs observation exists", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "This document says the answer is already known.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-doc-no-observation",
        agent_runtime: "codex",
        question:
          "Summarize this document from the current docs viewer context.",
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          hasDocContext: false,
        },
      },
      headers: {},
    });

    expect(result.ok).toBe(false);
    expect(result.terminal_artifact_kind).toBe("typed_failure");
    expect(result.text).not.toContain("already known");
    expect(
      result.turn_transcript_events?.some(
        (event: any) =>
          event.source_event_type === "model_reentry" &&
          /no workstation observation packet was available/i.test(
            String(event.text),
          ),
      ),
    ).toBe(true);
  });

  it("authorizes no-tool Codex explanations for quoted or negated voice capability mentions", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "`live_env.request_interim_voice_callout` is a voice request capability name. In this prompt it is text only, and I did not run or request a voice tool.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-quoted-voice-no-tool-final",
        agent_runtime: "codex",
        question:
          "The text says live_env.request_interim_voice_callout; explain that phrase as text only. Do not speak or run any voice tool.",
      },
      headers: {},
    });

    expect(result.ok).toBe(true);
    expect(result.response_type).toBe("final_answer");
    expect(result.final_status).toBe("completed");
    expect(result.final_answer_source).toBe(
      "agent_provider_terminal_candidate",
    );
    expect(result.terminal_artifact_kind).toBe(
      "agent_provider_terminal_candidate",
    );
    expect(result.text).toContain("text only");
    expect(result.text).toContain("did not run");
    expect((result.debug as any)?.terminal_answer_authority).toMatchObject({
      schema: "helix.turn_terminal_authority.v1",
      final_answer_source: "agent_provider_terminal_candidate",
      terminal_artifact_kind: "agent_provider_terminal_candidate",
      server_authoritative: true,
      terminal_eligible: true,
      assistant_answer: false,
    });
    expect((result.debug as any)?.terminal_authority_status).toBe(
      "authorized_by_terminal_authority_single_writer",
    );
    expect((result.debug as any)?.workstation_gateway_call_results).toEqual([]);
    expect(
      (result.debug as any)?.workstation_gateway_observation_packets,
    ).toEqual([]);
    expect(
      result.turn_transcript_events?.some(
        (event: any) =>
          event.source_event_type === "action_request" &&
          event.capability_id === "live_env.request_interim_voice_callout",
      ),
    ).toBe(false);
  });

  it("plans and executes readable surface observation before narrator receipt for read-aloud current document", async () => {
    const body = {
      turn_id: "ask:test:compound-read-aloud-current-doc",
      agent_runtime: "codex",
      question: "Read aloud parts of this document.",
      workspace_context_snapshot: {
        activePanel: "docs-viewer",
        activeDocPath: "docs/needle-hull-mainframe.md",
      },
    };

    const planned = buildCompoundCapabilityDependencyGatewayCallRequests(body);
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({
      compound_outcome: "read_aloud_surface",
      capability_id: "docs-viewer.read_visible_surface",
      dependent_capability_id: "live_env.narrator_say",
      arguments: {
        source_doc_path: "docs/needle-hull-mainframe.md",
        source_target_intent: {
          dependency_edges: [
            {
              from: "read_aloud_surface:surface_observation",
              to: "read_aloud_surface:narrator_receipt",
              binding: "surface_observation_to_voice_text",
            },
          ],
        },
      },
    });

    const results = await runExplicitWorkstationGatewayCalls({
      body,
      agentRuntime: "codex",
      turnId: "ask:test:compound-read-aloud-current-doc",
    });

    expect(results.map((result) => result.capability_id)).toEqual([
      "docs-viewer.read_visible_surface",
    ]);
    expect(results[0].ok).toBe(true);
    expect(results[0].observation_packet.status).toBe("succeeded");
    expect((results[0].observation as any).next_affordances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "live_env.narrator_say",
          reason: "available_after_observation_reentry",
        }),
      ]),
    );
    expect(
      (results[0].observation as any).compound_dependency_plan,
    ).toMatchObject({
      schema: "helix.compound_capability_dependency_plan.v1",
      compound_outcome: "read_aloud_surface",
      rail_status: "planned",
      first_broken_rail: null,
      dependency_edges: [
        {
          from: "read_aloud_surface:surface_observation",
          to: "read_aloud_surface:narrator_receipt",
          status: "planned",
        },
      ],
    });
  });

  it("routes read-aloud visible translated doc block through surface observation before narrator", async () => {
    const body = {
      turn_id: "ask:test:compound-read-aloud-translated-doc",
      agent_runtime: "codex",
      question: "Read aloud the visible translated section of this document.",
      workspace_context_snapshot: {
        activePanel: "docs-viewer",
        activeDocPath: "docs/helix-ask-flow.md",
        activeTranslationAccountLocale: "es-MX",
        activeTranslationTargetLanguage: "es",
        activeTranslationBlocks: [
          {
            unit_id: "unit:flow:1",
            source_text: "Helix Ask flow",
            translated_text: "Flujo de Helix Ask",
            locale: "es",
            status: "ready",
          },
        ],
      },
    };

    const results = await runExplicitWorkstationGatewayCalls({
      body,
      agentRuntime: "codex",
      turnId: "ask:test:compound-read-aloud-translated-doc",
    });

    expect(results.map((result) => result.capability_id)).toEqual([
      "docs-viewer.read_active_translation",
    ]);
    expect(results[0]).toMatchObject({
      ok: true,
      observation: {
        schema: "helix.workstation_readable_surface_observation.v1",
        text: "Flujo de Helix Ask",
        translation: expect.objectContaining({
          status: "ready",
          source_unit_ids: ["unit:flow:1"],
        }),
      },
    });
    expect((results[0].observation as any).next_affordances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capability: "live_env.narrator_say" }),
      ]),
    );
  });

  it("routes read-aloud current calculator result through surface observation before narrator", async () => {
    const body = {
      turn_id: "ask:test:compound-read-aloud-calculator-result",
      agent_runtime: "future",
      question: "Read aloud the current calculator result.",
      workspace_context_snapshot: {
        activePanel: "scientific-calculator",
        calculatorActiveContext: {
          current_latex: "9*8",
          last_result_text: "72",
          last_normalized_expression: "9*8",
        },
      },
    };

    const results = await runExplicitWorkstationGatewayCalls({
      body,
      agentRuntime: "future",
      turnId: "ask:test:compound-read-aloud-calculator-result",
    });

    expect(results.map((result) => result.capability_id)).toEqual([
      "scientific-calculator.read_visible_result",
    ]);
    expect(results[0]).toMatchObject({
      ok: true,
      observation: {
        schema: "helix.workstation_readable_surface_observation.v1",
        text: "72",
        calculator: expect.objectContaining({
          expression: "9*8",
          result: "72",
          draft_input_distinguished: true,
        }),
      },
    });
    expect((results[0].observation as any).next_affordances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capability: "live_env.narrator_say" }),
      ]),
    );
  });

  it("resolves named document surface before narrator admission for read-aloud document prompts", async () => {
    const body = {
      turn_id: "ask:test:compound-read-aloud-named-doc",
      agent_runtime: "codex",
      question: "Ok can you read aloud parts of the Helix Ask flow document?",
      workspace_context_snapshot: {
        activePanel: "docs-viewer",
        activeDocPath: "docs/helix-ask-flow.md",
      },
    };

    const planned = buildCompoundCapabilityDependencyGatewayCallRequests(body);
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({
      compound_outcome: "read_aloud_surface",
      capability_id: "docs-viewer.read_visible_surface",
      dependent_capability_id: "live_env.narrator_say",
    });

    const results = await runExplicitWorkstationGatewayCalls({
      body,
      agentRuntime: "codex",
      turnId: "ask:test:compound-read-aloud-named-doc",
    });

    expect(results.map((result) => result.capability_id)).toEqual([
      "docs-viewer.read_visible_surface",
    ]);
    expect((results[0].observation as any).schema).toBe(
      "helix.workstation_readable_surface_observation.v1",
    );
    expect((results[0].observation as any).next_affordances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capability: "live_env.narrator_say" }),
      ]),
    );
  });

  it("does not run narrator when read-aloud document resolution has no evidence", async () => {
    const body = {
      turn_id: "ask:test:compound-read-aloud-missing-doc",
      agent_runtime: "codex",
      question: "Read aloud parts of the zzzmissing helixtest document.",
    };

    const results = await runExplicitWorkstationGatewayCalls({
      body,
      agentRuntime: "codex",
      turnId: "ask:test:compound-read-aloud-missing-doc",
    });

    expect(results.map((result) => result.capability_id)).toEqual([
      "docs-viewer.read_visible_surface",
    ]);
    expect(
      (results[0].observation as any).compound_dependency_plan,
    ).toMatchObject({
      schema: "helix.compound_capability_dependency_plan.v1",
      compound_outcome: "read_aloud_surface",
      rail_status: "blocked",
      first_broken_rail: {
        subgoal_id: "read_aloud_surface:surface_observation",
        capability_id: "docs-viewer.read_visible_surface",
        reason: "registered_surface_text_missing",
      },
      dependency_edges: [
        {
          from: "read_aloud_surface:surface_observation",
          to: "read_aloud_surface:narrator_receipt",
          status: "blocked",
        },
      ],
    });
    expect(
      (results[0].observation_packet.state_delta as any)
        .compound_dependency_turn_plan,
    ).toMatchObject({
      schema: "helix.compound_capability_dependency_turn_plan.v1",
      compound_outcomes: ["read_aloud_surface"],
      rail_status: "blocked",
      first_broken_rail: {
        subgoal_id: "read_aloud_surface:surface_observation",
        requested_capability: "docs-viewer.read_visible_surface",
        satisfied: false,
      },
      ordered_subgoals: [
        {
          subgoal_id: "read_aloud_surface:surface_observation",
          requested_capability: "docs-viewer.read_visible_surface",
          executed_capability: null,
          satisfied: false,
        },
        {
          subgoal_id: "read_aloud_surface:narrator_receipt",
          requested_capability: "live_env.narrator_say",
          executed_capability: null,
          satisfied: false,
          rail_status: "blocked_by_dependency",
        },
      ],
    });
  });

  it("does not admit read-aloud dependency tools from quoted or explanatory mentions", () => {
    const prompts = [
      'The text says "read aloud parts of this document"; explain that phrase only.',
      "Do not read aloud the current document; just explain what a narrator action would do.",
      "Later we might read aloud parts of this document, but not now.",
    ];
    for (const question of prompts) {
      const body = {
        turn_id: "ask:test:compound-read-aloud-negative",
        agent_runtime: "codex",
        question,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          activeDocPath: "docs/needle-hull-mainframe.md",
        },
      };
      expect(
        buildCompoundCapabilityDependencyGatewayCallRequests(body),
      ).toEqual([]);
      expect(
        readWorkstationGatewayCallRequestsForTurn({
          body,
          includePlannerDerived: true,
        }).map((request) => (request as any).capability_id),
      ).not.toContain("live_env.narrator_say");
    }
  });

  it("fails closed for selected docs surface reads without a registered surface ref", async () => {
    const body = {
      turn_id: "ask:test:selected-surface-missing-ref",
      agent_runtime: "codex",
      question: "Read the selected paragraph in the docs viewer.",
      workspace_context_snapshot: {
        activePanel: "docs-viewer",
        activeDocPath: "docs/helix-ask-flow.md",
        selectedText: "Selected paragraph text.",
      },
    };

    const planned = readWorkstationGatewayCallRequestsForTurn({
      body,
      includePlannerDerived: true,
    });
    expect(planned.map((request) => (request as any).capability_id)).toContain(
      "docs-viewer.read_visible_surface",
    );
    expect(
      planned.map((request) => (request as any).capability_id),
    ).not.toContain("live_env.narrator_say");

    const results = await runExplicitWorkstationGatewayCalls({
      body,
      agentRuntime: "codex",
      turnId: "ask:test:selected-surface-missing-ref",
    });

    const surface = results.find(
      (result) => result.capability_id === "docs-viewer.read_visible_surface",
    );
    expect(surface).toBeTruthy();
    expect(surface).toMatchObject({
      ok: false,
      error: "registered_surface_ref_missing",
      observation: {
        schema: "helix.workstation_readable_surface_observation.v1",
        status: "blocked",
        blocked_reason: "registered_surface_ref_missing",
        selection_ref: null,
        selection_kind: "selected",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(results.map((result) => result.capability_id)).not.toContain(
      "live_env.narrator_say",
    );
  });

  it("observes selected docs surface reads when the selected surface is registered", async () => {
    const body = {
      turn_id: "ask:test:selected-surface-ref",
      agent_runtime: "codex",
      question: "Read the selected paragraph in the docs viewer.",
      workspace_context_snapshot: {
        activePanel: "docs-viewer",
        activeDocPath: "docs/helix-ask-flow.md",
        selectedText: "Selected paragraph text.",
        selectionRef: "docs-viewer:selection:unit-42",
      },
    };

    const results = await runExplicitWorkstationGatewayCalls({
      body,
      agentRuntime: "codex",
      turnId: "ask:test:selected-surface-ref",
    });

    const surface = results.find(
      (result) => result.capability_id === "docs-viewer.read_visible_surface",
    );
    expect(surface).toBeTruthy();
    expect(surface).toMatchObject({
      ok: true,
      observation: {
        schema: "helix.workstation_readable_surface_observation.v1",
        text: "Selected paragraph text.",
        selection_ref: "docs-viewer:selection:unit-42",
        selection_kind: "selected",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(results.map((result) => result.capability_id)).not.toContain(
      "live_env.narrator_say",
    );
  });

  it("plans translation and summary prompts through readable surface observations without narrator delivery", async () => {
    const translateBody = {
      turn_id: "ask:test:translate-visible-surface",
      agent_runtime: "codex",
      question: "Read the visible already-translated section of this document.",
      workspace_context_snapshot: {
        activePanel: "docs-viewer",
        activeDocPath: "docs/helix-ask-flow.md",
        activeTranslationAccountLocale: "es-MX",
        activeTranslationTargetLanguage: "es",
        activeTranslationBlocks: [
          {
            unit_id: "doc-unit:1",
            source_text: "Original sentence.",
            translated_text: "Translated sentence.",
            locale: "es",
            status: "ready",
          },
        ],
      },
    };
    const translateResults = await runExplicitWorkstationGatewayCalls({
      body: translateBody,
      agentRuntime: "codex",
      turnId: "ask:test:translate-visible-surface",
    });
    const translationSurface = translateResults.find(
      (result) =>
        result.capability_id === "docs-viewer.read_active_translation",
    );
    expect(translationSurface).toBeTruthy();
    expect(
      translationSurface?.gateway_admission.source_target_intent as any,
    ).toMatchObject({
      surface_outcome: "translate_visible_surface",
      required_observation_kind:
        "helix.workstation_readable_surface_observation.v1",
      narrator_requested: false,
      terminal_eligible: false,
      account_locale: "es-MX",
      target_language: "es",
    });
    expect((translationSurface?.observation as any).text).toBe(
      "Translated sentence.",
    );
    expect((translationSurface?.observation as any).translation).toMatchObject({
      account_locale: "es-MX",
      target_language: "es",
    });
    expect(
      translateResults.map((result) => result.capability_id),
    ).not.toContain("live_env.narrator_say");

    const summarizeBody = {
      turn_id: "ask:test:summarize-visible-surface",
      agent_runtime: "codex",
      question: "Summarize the visible section of this document.",
      workspace_context_snapshot: {
        activePanel: "docs-viewer",
        activeDocPath: "docs/helix-ask-flow.md",
      },
    };
    const summarizeResults = await runExplicitWorkstationGatewayCalls({
      body: summarizeBody,
      agentRuntime: "codex",
      turnId: "ask:test:summarize-visible-surface",
    });
    const summarySurface = summarizeResults.find(
      (result) => result.capability_id === "docs-viewer.read_visible_surface",
    );
    expect(summarySurface).toBeTruthy();
    expect(
      summarySurface?.gateway_admission.source_target_intent as any,
    ).toMatchObject({
      surface_outcome: "summarize_visible_surface",
      required_observation_kind:
        "helix.workstation_readable_surface_observation.v1",
      narrator_requested: false,
      terminal_eligible: false,
    });
    expect((summarySurface?.observation as any).schema).toBe(
      "helix.workstation_readable_surface_observation.v1",
    );
    expect(
      summarizeResults.map((result) => result.capability_id),
    ).not.toContain("live_env.narrator_say");
  });

  it("does not admit prompt-derived surface observations from negated or contextual mentions", () => {
    const prompts = [
      'The text says "read the selected paragraph"; explain the phrase only.',
      "Do not read the selected paragraph; just explain the surface tool.",
      "Later we might translate the visible section, but not now.",
    ];
    for (const question of prompts) {
      const body = {
        turn_id: "ask:test:surface-negative",
        agent_runtime: "codex",
        question,
        workspace_context_snapshot: {
          activePanel: "docs-viewer",
          activeDocPath: "docs/helix-ask-flow.md",
          selectedText: "Selected paragraph text.",
          selectionRef: "docs-viewer:selection:unit-42",
          activeTranslationBlocks: [
            {
              unit_id: "doc-unit:1",
              translated_text: "Translated sentence.",
            },
          ],
        },
      };
      expect(
        readWorkstationGatewayCallRequestsForTurn({
          body,
          includePlannerDerived: true,
        }).map((request) => (request as any).capability_id),
      ).not.toEqual(
        expect.arrayContaining([
          "docs-viewer.read_visible_surface",
          "docs-viewer.read_active_translation",
          "scientific-calculator.read_visible_result",
        ]),
      );
    }
  });

  it("does not answer repository content when no repo search observation exists", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "The repo shows workstation_gateway is fully wired.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-repo-no-observation",
        agent_runtime: "codex",
        question:
          "Open docs/helix-ask-api-parity-matrix.md and, according to the repo observation, what does workstation_gateway prove?",
        workstation_gateway_call: {
          capability_id: "docs-viewer.open_doc",
          mode: "act",
          arguments: {
            path: "docs/helix-ask-api-parity-matrix.md",
          },
        },
      },
      headers: {},
    });

    expect(
      (result.debug as any)?.workstation_gateway_call_results?.map(
        (entry: any) => entry.capability_id,
      ),
    ).toEqual(["docs-viewer.open_doc"]);
    expect(result.text).toContain(
      "no repo.search observation packet was materialized",
    );
    expect(result.text).not.toContain("fully wired");
    expect(
      result.turn_transcript_events?.map(
        (event: any) => event.source_event_type,
      ),
    ).toEqual([
      "runtime_selected",
      "action_request",
      "action_observation",
      "model_reentry",
      "terminal_answer",
    ]);
    expect(
      result.turn_transcript_events?.find(
        (event: any) => event.source_event_type === "terminal_answer",
      ),
    ).toMatchObject({
      text: result.text,
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("does not answer internet-backed content when no internet search observation exists", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "Current web sources show the claim was validated.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-internet-no-observation",
        agent_runtime: "codex",
        question:
          "Open docs/helix-ask-api-parity-matrix.md and, according to current web sources, what changed?",
        workstation_gateway_call: {
          capability_id: "docs-viewer.open_doc",
          mode: "act",
          arguments: {
            path: "docs/helix-ask-api-parity-matrix.md",
          },
        },
      },
      headers: {},
    });

    expect(
      (result.debug as any)?.workstation_gateway_call_results?.map(
        (entry: any) => entry.capability_id,
      ),
    ).toEqual(["docs-viewer.open_doc"]);
    expect(result.text).toContain(
      "no internet-search.search_web observation packet was materialized",
    );
    expect(result.text).not.toContain("validated");
  });

  it("does not answer scholarly paper content when no scholarly observation exists", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "The arXiv papers prove the claim boundary is solved.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-scholarly-no-observation",
        agent_runtime: "codex",
        question:
          "Open docs/helix-ask-api-parity-matrix.md and, according to arXiv research papers, what evidence supports this?",
        workstation_gateway_call: {
          capability_id: "docs-viewer.open_doc",
          mode: "act",
          arguments: {
            path: "docs/helix-ask-api-parity-matrix.md",
          },
        },
      },
      headers: {},
    });

    expect(
      (result.debug as any)?.workstation_gateway_call_results?.map(
        (entry: any) => entry.capability_id,
      ),
    ).toEqual(["docs-viewer.open_doc"]);
    expect(result.text).toContain(
      "no scholarly-research.lookup_papers observation packet was materialized",
    );
    expect(result.text).not.toContain("solved");
  });

  it("does not create host workstation actions by scraping Codex final prose", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "Open docs/helix-ask-flow.md at line 12; also 6 * 7 = 42.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-no-prose-scraped-actions",
        agent_runtime: "codex",
        question:
          "Give a background-only answer about workstation affordance projection.",
      },
      headers: {},
    });

    expect(result.text).toBe(
      "Open docs/helix-ask-flow.md at line 12; also 6 * 7 = 42.",
    );
    expect(result.workstation_actions).toEqual([]);
    expect(result.support_refs).toEqual([]);
    expect(result.tool_output_refs).toEqual([]);
    expect(
      (result.debug as any)?.codex_host_workstation_affordances,
    ).toMatchObject({
      workstation_actions: [],
      support_refs: [],
      tool_output_refs: [],
    });
  });

  it("does not guess host workstation actions from malformed tool outputs", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT = "The calculator result is available.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-malformed-tool-output-no-action",
        agent_runtime: "codex",
        question: "Use the scientific calculator and answer normally.",
        workstation_gateway_call: {
          capability_id: "scientific-calculator.solve_expression",
          mode: "read",
          arguments: {},
        },
      },
      headers: {},
    });

    expect(
      (result.debug as any)?.workstation_gateway_call_results?.[0],
    ).toMatchObject({
      ok: false,
      capability_id: "scientific-calculator.solve_expression",
    });
    expect(result.workstation_actions).toEqual([]);
    expect(result.support_refs).toEqual([]);
    expect(result.tool_output_refs).toEqual([]);
    expect(
      (result.debug as any)?.codex_host_workstation_affordances,
    ).toMatchObject({
      workstation_actions: [],
      support_refs: [],
      tool_output_refs: [],
    });
  });

  it("allows repository content answers when a repo search observation exists", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "The repo observation found workstation_gateway debug-export plumbing.";
    process.env.CODEX_AGENT_FAKE_EXIT_CODE = "0";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn",
      body: {
        turn_id: "ask:test:codex-repo-observation-authorized",
        agent_runtime: "codex",
        question:
          "Search the repo for workstation_gateway and summarize what the repo observation shows.",
      },
      headers: {},
    });

    expect(result.text).toBe(
      "The repo observation found workstation_gateway debug-export plumbing.",
    );
    expect(
      (result.debug as any)?.workstation_gateway_call_results?.some(
        (entry: any) =>
          entry.ok === true && entry.capability_id === "repo.search",
      ),
    ).toBe(true);
    expect(
      result.turn_transcript_events?.some(
        (event: any) =>
          event.source_event_type === "tool_observation" &&
          event.capability_id === "repo.search",
      ),
    ).toBe(true);
  });

  it("derives repo and docs gateway calls from structured source-target admission records", async () => {
    const repoBody = {
      turn_id: "ask:test:structured-repo-gateway",
      question: "Where is workspace_os.status implemented?",
      source_target_intent: {
        schema: "helix.ask_source_target_intent.v1",
        source_target: "repo_code",
        target_source: "repo_code",
        selected_capability: "repo-code.search_concept",
        args: {
          query: "workspace_os.status",
          paths: ["server/services/helix-ask"],
        },
      },
    };
    const docsBody = {
      turn_id: "ask:test:structured-docs-gateway",
      question: "Locate the Helix Ask Codex loop discipline doc.",
      route_metadata: {
        schema: "helix.ask.route_metadata.v1",
        source_target: "docs_viewer",
        source_target_intent: {
          schema: "helix.ask_source_target_intent.v1",
          source_target: "docs_viewer",
          target_source: "docs_viewer",
          mandatory_next_tool: {
            tool_name: "docs-viewer.locate_in_doc",
            selected_capability: "docs-viewer.locate_in_doc",
            args: {
              query: "Helix Ask / Codex Loop Discipline",
              paths: ["docs/helix-ask-codex-loop-discipline.md"],
            },
          },
        },
      },
    };

    expect(
      buildStructuredAdmissionWorkstationGatewayCallRequests(repoBody),
    ).toEqual([
      expect.objectContaining({
        schema:
          "helix.workstation_gateway.structured_admission_call_request.v1",
        derivation_source: "helix_structured_source_target_admission",
        capability_id: "repo.search",
        mode: "read",
        arguments: expect.objectContaining({
          query: "workspace_os.status",
          paths: ["server/services/helix-ask"],
          source_target_intent: expect.objectContaining({
            source: "helix_structured_source_target_admission",
            selected_capability: "repo-code.search_concept",
          }),
        }),
      }),
    ]);
    expect(
      buildStructuredAdmissionWorkstationGatewayCallRequests(docsBody),
    ).toEqual([
      expect.objectContaining({
        schema:
          "helix.workstation_gateway.structured_admission_call_request.v1",
        derivation_source: "helix_structured_source_target_admission",
        capability_id: "docs.search",
        mode: "read",
        arguments: expect.objectContaining({
          query: "Helix Ask / Codex Loop Discipline",
          paths: ["docs/helix-ask-codex-loop-discipline.md"],
          source_target_intent: expect.objectContaining({
            source: "helix_structured_source_target_admission",
            selected_capability: "docs-viewer.locate_in_doc",
          }),
        }),
      }),
    ]);

    const repoResults = await runExplicitWorkstationGatewayCalls({
      body: {
        ...repoBody,
        agent_runtime: "helix",
      },
      agentRuntime: "helix",
    });
    const docsResults = await runExplicitWorkstationGatewayCalls({
      body: {
        ...docsBody,
        agent_runtime: "codex",
      },
      agentRuntime: "codex",
    });

    expect(repoResults[0]).toMatchObject({
      ok: true,
      agent_runtime: "helix",
      capability_id: "repo.search",
      gateway_admission: {
        selected_agent_provider: "helix",
        permission_profile: "read",
        admission_status: "admitted",
      },
      observation: {
        schema: "helix.repo_search_observation.v1",
        query: "workspace_os.status",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
    expect(docsResults[0]).toMatchObject({
      ok: true,
      agent_runtime: "codex",
      capability_id: "docs.search",
      gateway_admission: {
        selected_agent_provider: "codex",
        permission_profile: "read",
        admission_status: "admitted",
      },
      observation: {
        schema: "helix.docs_search_observation.v1",
        query: "Helix Ask / Codex Loop Discipline",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("derives docs open-doc gateway action requests from structured source-target admission records", async () => {
    const body = {
      turn_id: "ask:test:structured-docs-open-doc-gateway",
      question:
        "Open docs/helix-ask-codex-loop-discipline.md in the docs viewer.",
      route_metadata: {
        schema: "helix.ask.route_metadata.v1",
        source_target: "docs_viewer",
        source_target_intent: {
          schema: "helix.ask_source_target_intent.v1",
          source_target: "docs_viewer",
          target_source: "docs_viewer",
          mandatory_next_tool: {
            tool_name: "docs-viewer.open_doc",
            selected_capability: "docs-viewer.open_doc",
            args: {
              path: "docs/helix-ask-codex-loop-discipline.md",
            },
          },
        },
      },
    };

    expect(
      buildStructuredAdmissionWorkstationGatewayCallRequests(body),
    ).toEqual([
      expect.objectContaining({
        schema:
          "helix.workstation_gateway.structured_admission_call_request.v1",
        derivation_source: "helix_structured_source_target_admission",
        capability_id: "docs-viewer.open_doc",
        mode: "act",
        arguments: expect.objectContaining({
          path: "docs/helix-ask-codex-loop-discipline.md",
          source_target_intent: expect.objectContaining({
            source: "helix_structured_source_target_admission",
            selected_capability: "docs-viewer.open_doc",
          }),
        }),
      }),
    ]);

    const results = await runExplicitWorkstationGatewayCalls({
      body: {
        ...body,
        agent_runtime: "codex",
      },
      agentRuntime: "codex",
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      ok: true,
      agent_runtime: "codex",
      capability_id: "docs-viewer.open_doc",
      gateway_admission: {
        selected_agent_provider: "codex",
        permission_profile: "act",
        admission_status: "admitted",
      },
      observation: {
        schema: "helix.workstation_ui_action_receipt.v1",
        action_kind: "open_doc",
        panel_id: "docs-viewer",
        path: "docs/helix-ask-codex-loop-discipline.md",
        workstation_action: {
          schema_version: "helix.workstation.action/v1",
          action: "run_panel_action",
          panel_id: "docs-viewer",
          action_id: "open_doc",
          args: {
            path: "docs/helix-ask-codex-loop-discipline.md",
          },
        },
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("keeps structured docs open-doc requests governed when the admitted path is missing", async () => {
    const body = {
      turn_id: "ask:test:structured-docs-open-doc-missing-path",
      question: "Open the selected doc in the docs viewer.",
      agent_runtime: "codex",
      route_metadata: {
        source_target_intent: {
          mandatory_next_tool: {
            tool_name: "docs-viewer.open_doc",
            selected_capability: "docs-viewer.open_doc",
            args: {},
          },
        },
      },
    };

    expect(
      buildStructuredAdmissionWorkstationGatewayCallRequests(body),
    ).toEqual([
      expect.objectContaining({
        capability_id: "docs-viewer.open_doc",
        mode: "act",
        arguments: expect.not.objectContaining({
          path: expect.any(String),
        }),
      }),
    ]);

    const results = await runExplicitWorkstationGatewayCalls({
      body,
      agentRuntime: "codex",
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      ok: false,
      capability_id: "docs-viewer.open_doc",
      error: "docs_open_doc_path_missing_or_unsafe",
      gateway_admission: {
        permission_profile: "act",
        admission_status: "blocked",
        blocked_reason: "docs_open_doc_path_missing_or_unsafe",
      },
      observation_packet: {
        status: "blocked",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      observation: {
        schema: "helix.workstation_ui_action_receipt.v1",
        status: "blocked",
        dispatch_status: "blocked",
        workstation_action: null,
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  });

  it("records Codex provider text as a non-authoritative terminal candidate after gateway observations", async () => {
    const gatewayResults = await runExplicitCodexWorkstationGatewayCalls({
      body: {
        turn_id: "ask:test:codex-provider-candidate",
        workstation_gateway_call: {
          capability_id: "scientific-calculator.solve_expression",
          arguments: {
            expression: "5 * 9",
          },
        },
      },
    });

    const trace = buildHelixProviderReasoningReentry({
      runtime: "codex",
      providerLabel: "Codex Workstation Mode",
      turnId: "ask:test:codex-provider-candidate",
      threadId: "thread:test",
      route: "/ask/turn",
      gatewayCallResults: gatewayResults,
      providerText: "The calculator observation reports 45.",
      ok: true,
    });

    expect(trace).toMatchObject({
      providerTerminalCandidate: {
        schema: "helix.agent_provider_terminal_candidate.v1",
        turn_id: "ask:test:codex-provider-candidate",
        agent_runtime: "codex",
        selected_agent_provider: "codex",
        source: "agent_provider_text_mode_adapter",
        candidate_text_length: 38,
        grounded_in_observation_refs: expect.arrayContaining([
          expect.stringContaining("scientific-calculator.solve_expression"),
        ]),
        evidence_reentry_required: true,
        provider_reasoning_completed: true,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      providerReasoningReentry: {
        schema: "helix.provider_reasoning_reentry.v1",
        status: "pending_helix_solver_reentry",
        provider_terminal_candidate_present: true,
        post_tool_model_step_required: true,
        evidence_reentered: false,
        normalized_observation_packet_count: 1,
        normalized_observation_refs: expect.arrayContaining([
          expect.stringContaining("scientific-calculator.solve_expression"),
        ]),
        solver_completed: false,
        goal_satisfaction_compatible: false,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      terminalAuthorityCandidateReview: {
        schema: "helix.provider_terminal_authority_candidate_review.v1",
        terminal_authority_status: "blocked_pending_helix_solver_completion",
        terminal_authority_granted: false,
        final_visible_answer_authorized: false,
        blockers: ["helix_solver_completion_required"],
        normalized_observation_refs: expect.arrayContaining([
          expect.stringContaining("scientific-calculator.solve_expression"),
        ]),
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      providerTerminalAuthorityBridge: {
        schema: "helix.provider_terminal_authority_bridge.v1",
        route_authority_status: "not_authorized",
        terminal_authority_status: "blocked_pending_helix_solver_completion",
        terminal_authority_granted: false,
        final_visible_answer_authorized: false,
        final_answer_source: null,
        terminal_artifact_kind: null,
        terminal_answer_authority: null,
        terminal_presentation: null,
      },
      terminalAnswerAuthority: null,
      terminalPresentation: null,
      workstationGatewayReentryStatus: "pending_helix_solver_reentry",
      terminalAuthorityStatus: "blocked_pending_helix_solver_completion",
    });
    expect(trace.providerTerminalCandidate?.candidate_id).toContain(
      "ask:test:codex-provider-candidate:agent_provider_terminal_candidate:codex:",
    );
  });

  it("blocks terminal authority for provider candidates when the gateway observation failed", async () => {
    const gatewayResults = await runExplicitCodexWorkstationGatewayCalls({
      body: {
        turn_id: "ask:test:codex-provider-blocked-candidate",
        workstation_gateway_call: {
          capability_id: "filesystem.write_file",
          arguments: {
            path: "server/routes/agi.plan.ts",
            text: "blocked",
          },
        },
      },
    });

    const trace = buildHelixProviderReasoningReentry({
      runtime: "codex",
      providerLabel: "Codex Workstation Mode",
      turnId: "ask:test:codex-provider-blocked-candidate",
      threadId: "thread:test",
      route: "/ask/turn",
      gatewayCallResults: gatewayResults,
      providerText: "The requested write capability was blocked.",
      ok: true,
    });

    expect(trace).toMatchObject({
      providerTerminalCandidate: {
        schema: "helix.agent_provider_terminal_candidate.v1",
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
      terminalAuthorityCandidateReview: {
        schema: "helix.provider_terminal_authority_candidate_review.v1",
        terminal_authority_status: "blocked_by_observation_state",
        terminal_authority_granted: false,
        final_visible_answer_authorized: false,
        blockers: ["gateway_observation_missing_or_failed"],
      },
      providerTerminalAuthorityBridge: {
        schema: "helix.provider_terminal_authority_bridge.v1",
        route_authority_status: "not_authorized",
        terminal_authority_status: "blocked_by_observation_state",
        terminal_authority_granted: false,
        final_visible_answer_authorized: false,
        final_answer_source: null,
        terminal_artifact_kind: null,
        terminal_answer_authority: null,
        terminal_presentation: null,
      },
      terminalAnswerAuthority: null,
      terminalPresentation: null,
      terminalAuthorityStatus: "blocked_by_observation_state",
    });
    expect(gatewayResults[0]).toMatchObject({
      ok: false,
      error: "capability_not_registered",
      gateway_admission: {
        admission_status: "blocked",
        blocked_reason: "capability_not_registered",
      },
    });
  });

  it("blocks provider terminal authority when scholarly lookup evidence was not selected for answer", () => {
    const trace = buildHelixProviderReasoningReentry({
      runtime: "codex",
      providerLabel: "Codex Workstation Mode",
      turnId: "ask:test:codex-provider-weak-scholarly-candidate",
      threadId: "thread:test",
      route: "/ask/turn",
      gatewayCallResults: [
        {
          schema: "helix.workstation_tool_gateway.call_result.v1",
          manifest_version: "test",
          ok: false,
          agent_runtime: "codex",
          capability_id: "scholarly-research.lookup_papers",
          mode: "read",
          gateway_admission: {
            schema: "helix.workstation_tool_gateway.admission.v1",
            requested_capability: "scholarly-research.lookup_papers",
            selected_agent_provider: "codex",
            permission_profile: "read",
            admission_status: "admitted",
            admission_reason: "test",
            assistant_answer: false,
            raw_content_included: false,
          },
          observation_packet: {
            schema: "helix.agent_step_observation_packet.v1",
            turn_id: "ask:test:codex-provider-weak-scholarly-candidate",
            iteration: 1,
            call_id:
              "ask:test:codex-provider-weak-scholarly-candidate:scholarly-research.lookup_papers:call",
            decision_id:
              "ask:test:codex-provider-weak-scholarly-candidate:scholarly-research.lookup_papers:decision",
            capability_key: "scholarly-research.lookup_papers",
            panel_id: "scholarly-research",
            action: "lookup_papers",
            status: "failed",
            produced_artifact_refs: [
              "ask:test:codex-provider-weak-scholarly-candidate:scholarly-research.lookup_papers",
            ],
            observation_summary:
              "Scholarly research lookup returned weakly matched papers.",
            receipts: [],
            missing_requirements: ["lookup_weak_match"],
            state_delta: {
              evidence_state: "lookup_weak_match",
              selected_for_answer: false,
              lookup_relevance_gate: {
                status: "blocked",
                code: "lookup_weak_match",
              },
              next_affordances: [
                { capability: "scholarly-research.lookup_papers" },
              ],
            },
            suggested_next_steps: ["use_another_tool", "repair"],
            terminal_eligible: false,
            post_tool_model_step_required: true,
            assistant_answer: false,
            raw_content_included: false,
          },
          tool_lifecycle_trace: {} as any,
          tool_followup_decision: {} as any,
          observation: {
            schema: "helix.scholarly_research_observation.v1",
            evidence_state: "lookup_weak_match",
            selected_for_answer: false,
            missing_requirements: ["lookup_weak_match"],
          },
          artifact_refs: [
            "ask:test:codex-provider-weak-scholarly-candidate:scholarly-research.lookup_papers",
          ],
          terminal_eligible: false,
          post_tool_model_step_required: true,
          assistant_answer: false,
          raw_content_included: false,
          error: "lookup_weak_match",
        },
      ],
      normalizedObservationPackets: [
        {
          schema: "helix.agent_step_observation_packet.v1",
          turn_id: "ask:test:codex-provider-weak-scholarly-candidate",
          iteration: 1,
          call_id:
            "ask:test:codex-provider-weak-scholarly-candidate:normalized:call",
          decision_id:
            "ask:test:codex-provider-weak-scholarly-candidate:normalized:decision",
          capability_key: "scholarly-research.lookup_papers",
          panel_id: "codex-provider",
          action: "normalize_provider_gateway_observation",
          status: "failed",
          produced_artifact_refs: [
            "ask:test:codex-provider-weak-scholarly-candidate:codex_normalized:scholarly_research_observation:1",
          ],
          observation_summary:
            "Codex provider gateway result normalized as scholarly_research_observation.",
          receipts: [],
          missing_requirements: ["lookup_weak_match"],
          state_delta: {
            evidence_state: "lookup_weak_match",
            selected_for_answer: false,
          },
          suggested_next_steps: ["use_another_tool", "repair"],
          terminal_eligible: false,
          post_tool_model_step_required: true,
          assistant_answer: false,
          raw_content_included: false,
        },
      ],
      providerText: "Scholarly lookup found usable paper evidence.",
      ok: true,
      solverCompleted: true,
      goalSatisfied: true,
    });

    expect(trace).toMatchObject({
      terminalAuthorityCandidateReview: {
        terminal_authority_status: "blocked_by_observation_state",
        terminal_authority_granted: false,
        final_visible_answer_authorized: false,
        blockers: ["gateway_observation_missing_or_failed"],
        selected_observation_refs: [],
      },
      providerTerminalAuthorityBridge: {
        route_authority_status: "not_authorized",
        terminal_authority_granted: false,
        final_visible_answer_authorized: false,
        terminal_answer_authority: null,
      },
      terminalAnswerAuthority: null,
      terminalPresentation: null,
    });
  });

  it("authorizes provider synthesis when a weak scholarly attempt is superseded by selected usable evidence", () => {
    const turnId = "ask:test:codex-provider-recovered-scholarly-candidate";
    const weakRef = `${turnId}:scholarly-research.lookup_papers:weak`;
    const usableRef = `${turnId}:scholarly-research.lookup_papers:usable`;
    const makeResult = (input: {
      ok: boolean;
      ref: string;
      evidenceState: string;
      selectedForAnswer: boolean;
    }) => ({
      schema: "helix.workstation_tool_gateway.call_result.v1",
      manifest_version: "test",
      ok: input.ok,
      agent_runtime: "codex",
      capability_id: "scholarly-research.lookup_papers",
      mode: "read",
      gateway_admission: {
        schema: "helix.workstation_tool_gateway.admission.v1",
        requested_capability: "scholarly-research.lookup_papers",
        selected_agent_provider: "codex",
        permission_profile: "read",
        admission_status: "admitted",
        admission_reason: "test",
        assistant_answer: false,
        raw_content_included: false,
      },
      observation_packet: {
        schema: "helix.agent_step_observation_packet.v1",
        turn_id: turnId,
        iteration: 1,
        call_id: `${input.ref}:call`,
        decision_id: `${input.ref}:decision`,
        capability_key: "scholarly-research.lookup_papers",
        panel_id: "scholarly-research",
        action: "lookup_papers",
        status: input.ok ? "succeeded" : "failed",
        produced_artifact_refs: [input.ref],
        observation_summary: "Scholarly lookup observation.",
        receipts: [],
        missing_requirements: input.ok ? [] : ["lookup_weak_match"],
        state_delta: {
          evidence_state: input.evidenceState,
          selected_for_answer: input.selectedForAnswer,
        },
        suggested_next_steps: [],
        terminal_eligible: false,
        post_tool_model_step_required: true,
        assistant_answer: false,
        raw_content_included: false,
      },
      tool_lifecycle_trace: {} as any,
      tool_followup_decision: {} as any,
      observation: {
        schema: "helix.scholarly_research_observation.v1",
        evidence_state: input.evidenceState,
        selected_for_answer: input.selectedForAnswer,
      },
      artifact_refs: [input.ref],
      terminal_eligible: false,
      post_tool_model_step_required: true,
      assistant_answer: false,
      raw_content_included: false,
      ...(input.ok ? {} : { error: "lookup_weak_match" }),
    });
    const gatewayCallResults = [
      makeResult({
        ok: false,
        ref: weakRef,
        evidenceState: "lookup_weak_match",
        selectedForAnswer: false,
      }),
      makeResult({
        ok: true,
        ref: usableRef,
        evidenceState: "lookup_usable",
        selectedForAnswer: true,
      }),
    ] as any;

    const trace = buildHelixProviderReasoningReentry({
      runtime: "codex",
      providerLabel: "Codex Workstation Mode",
      turnId,
      threadId: "thread:test",
      route: "/ask/turn",
      gatewayCallResults,
      normalizedObservationPackets: gatewayCallResults.map(
        (result: any) => result.observation_packet,
      ),
      providerText:
        "The selected scholarly observation supports a bounded synthesis.",
      ok: true,
      solverCompleted: true,
      goalSatisfied: true,
    });

    expect(trace).toMatchObject({
      providerReasoningReentry: {
        status: "completed",
        evidence_reentered: true,
      },
      terminalAuthorityCandidateReview: {
        terminal_authority_status:
          "authorized_by_helix_provider_candidate_bridge",
        terminal_authority_granted: true,
        final_visible_answer_authorized: true,
        selected_observation_refs: [usableRef],
      },
      providerTerminalAuthorityBridge: {
        all_gateway_calls_succeeded: true,
        terminal_authority_granted: true,
        final_visible_answer_authorized: true,
      },
      terminalAnswerAuthority: {
        turn_id: turnId,
        terminal_kind: "answer",
        terminal_artifact_kind: "agent_provider_terminal_candidate",
      },
    });
    expect(
      trace.terminalAuthorityCandidateReview.selected_observation_refs,
    ).not.toContain(weakRef);
  });

  it("emits Codex provider transcript progress through the stream callback before terminal answer", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "Observed expression: 8*9\nResult: 72";
    const streamedEvents: Record<string, unknown>[] = [];

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn/stream",
      body: {
        turn_id: "ask:test:codex-provider-live-progress",
        question: "Use the scientific calculator to solve 8*9.",
        workstation_gateway_call: {
          capability_id: "scientific-calculator.solve_expression",
          arguments: {
            expression: "8*9",
          },
        },
      },
      onTranscriptEvent: (event) => {
        streamedEvents.push(event);
      },
    });

    expect(
      result.turn_transcript_events?.some(
        (event) => event.source_event_type === "terminal_answer",
      ),
    ).toBe(true);
    expect(
      streamedEvents.some(
        (event) => event.source_event_type === "runtime_selected",
      ),
    ).toBe(true);
    expect(
      streamedEvents.some(
        (event) => event.source_event_type === "tool_request",
      ),
    ).toBe(true);
    expect(
      streamedEvents.some(
        (event) => event.source_event_type === "tool_observation",
      ),
    ).toBe(true);
    expect(
      streamedEvents.some(
        (event) => event.source_event_type === "model_reentry",
      ),
    ).toBe(true);
    expect(
      streamedEvents.some(
        (event) => event.source_event_type === "terminal_answer",
      ),
    ).toBe(false);
    expect(streamedEvents.every((event) => event.event_source === "live")).toBe(
      true,
    );
  });

  it("streams text-to-speech client playback handoff before Codex terminal answer", async () => {
    resetInterimVoiceCalloutsForTest();
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
      memoryReader: () => ({
        heapUsed: 120 * 1024 * 1024,
        heapTotal: 512 * 1024 * 1024,
        rss: 640 * 1024 * 1024,
        external: 0,
        arrayBuffers: 0,
      }),
      hostMemoryReader: () => ({
        freeMiB: 16_000,
        totalMiB: 32_000,
        freeRatio: 0.5,
      }),
    });
    process.env.CODEX_AGENT_FAKE_STDOUT = [
      "playback_status: queued",
      "assistant_answer: false",
      "terminal_eligible: false",
    ].join("\n");
    const streamedEvents: Record<string, unknown>[] = [];

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn/stream",
      body: {
        turn_id: "ask:test:codex-provider-tts-handoff",
        question:
          "Use text_to_speech.speak_text to say exactly 'provider handoff check'. After the receipt barrier, answer with playback_status plus assistant_answer and terminal_eligible flags only.",
        workstation_gateway_call: {
          capability_id: "text_to_speech.speak_text",
          mode: "act",
          arguments: {
            text: "provider handoff check",
          },
        },
      },
      onTranscriptEvent: (event) => {
        streamedEvents.push(event);
      },
    });

    const voiceObservation = streamedEvents.find(
      (event) =>
        event.capability_id === "text_to_speech.speak_text" &&
        event.voice_playback_handoff,
    );
    expect(
      (result.debug as any)?.workstation_gateway_call_results?.map(
        (entry: any) => ({
          capability_id: entry.capability_id,
          ok: entry.ok,
          state_delta: entry.observation_packet?.state_delta,
        }),
      ),
    ).toEqual([
      expect.objectContaining({
        capability_id: "text_to_speech.speak_text",
        state_delta: expect.objectContaining({
          text_to_speech_client_playback_handoff: expect.objectContaining({
            schema: "helix.interim_voice_callout_tool_result.v1",
          }),
        }),
      }),
    ]);
    expect(voiceObservation).toMatchObject({
      assistant_answer: false,
      raw_content_included: false,
      voice_playback_handoff: {
        schema: "helix.interim_voice_callout_tool_result.v1",
        request: {
          text: "provider handoff check",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
        receipt: {
          status: "awaiting_client_playback",
          assistant_answer: false,
          terminal_eligible: false,
          raw_content_included: false,
        },
      },
    });
    expect(
      streamedEvents.some(
        (event) => event.source_event_type === "terminal_answer",
      ),
    ).toBe(false);
    expect(
      result.turn_transcript_events?.some(
        (event) => event.source_event_type === "terminal_answer",
      ),
    ).toBe(true);
  }, 15_000);

  it("resolves read-aloud last final answer to chat history before text-to-speech execution", async () => {
    resetInterimVoiceCalloutsForTest();
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
      memoryReader: () => ({
        heapUsed: 120 * 1024 * 1024,
        heapTotal: 512 * 1024 * 1024,
        rss: 640 * 1024 * 1024,
        external: 0,
        arrayBuffers: 0,
      }),
      hostMemoryReader: () => ({
        freeMiB: 16_000,
        totalMiB: 32_000,
        freeRatio: 0.5,
      }),
    });
    process.env.CODEX_AGENT_FAKE_STDOUT = [
      "HELIX_CAPABILITY_LANE_REQUEST_JSON:",
      JSON.stringify({
        capability: "text_to_speech.speak_text",
        text: "Abstract",
        assistant_answer: false,
        terminal_eligible: false,
      }),
    ].join("");

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn/stream",
      body: {
        turn_id: "ask:test:codex-tts-referent-last-final-answer",
        question: "ok read last final answer aloud",
        workspace_context_snapshot: {
          active_panel: "docs-viewer",
          active_doc_path: "docs/research/nhm2-current-status-whitepaper.md",
          chat_referent_context: {
            schema: "helix.ask.chat_referent_context.v1",
            previous_assistant_final_answer: {
              role: "assistant",
              reply_id: "reply-prev",
              source_ref: "chat.final_answer.previous:reply-prev",
              text: "Navigation team is ready for the next burn window.",
            },
            previous_chat_message: {
              role: "assistant",
              message_id: "reply-prev",
              source_ref: "chat.final_answer.previous:reply-prev",
              text: "Navigation team is ready for the next burn window.",
            },
          },
        },
      },
    });

    const ttsResult = (result.debug as any)?.capability_lane_call_results?.find(
      (entry: any) =>
        entry?.capability === "text_to_speech.speak_text" ||
        entry?.capability_id === "text_to_speech.speak_text",
    );
    const ttsReceipt = (
      result.debug as any
    )?.capability_lane_observation_packets?.find(
      (packet: any) => packet?.capability_key === "text_to_speech.speak_text",
    )?.state_delta?.text_to_speech_receipt;
    const playbackHandoff =
      ttsResult?.observation_packet?.state_delta
        ?.text_to_speech_client_playback_handoff;

    expect((result.debug as any)?.referent_resolution_trace).toMatchObject({
      referent_phrase: "previous_assistant_final_answer",
      source_kind: "chat_history",
      resolved_source_ref: "chat.final_answer.previous:reply-prev",
      resolution_confidence: "high",
      tool_argument_source: "referent_resolution:chat_history",
      raw_content_included: false,
    });
    expect((result.debug as any)?.chat_referent_context_presence).toMatchObject(
      {
        present: true,
        previous_assistant_final_answer_present: true,
        previous_assistant_final_answer_ref:
          "chat.final_answer.previous:reply-prev",
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
    );
    expect((result.debug as any)?.runtime_lane_request_loop).toMatchObject({
      status: "lane_observation_reentered",
      selected_runtime_agent_provider: "codex",
      chat_referent_context_presence: expect.objectContaining({
        present: true,
        previous_assistant_final_answer_present: true,
      }),
    });
    expect(playbackHandoff?.request?.text).toBe(
      "Navigation team is ready for the next burn window.",
    );
    expect(ttsReceipt).toMatchObject({
      source_observation_ref: "chat.final_answer.previous:reply-prev",
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
  }, 15_000);

  it("synthesizes governed text-to-speech for last final answer when Codex skips the lane JSON", async () => {
    resetInterimVoiceCalloutsForTest();
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
      memoryReader: () => ({
        heapUsed: 120 * 1024 * 1024,
        heapTotal: 512 * 1024 * 1024,
        rss: 640 * 1024 * 1024,
        external: 0,
        arrayBuffers: 0,
      }),
      hostMemoryReader: () => ({
        freeMiB: 16_000,
        totalMiB: 32_000,
        freeRatio: 0.5,
      }),
    });
    process.env.CODEX_AGENT_FAKE_STDOUT =
      "I cannot read it aloud without a resolved last final answer.";

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn/stream",
      body: {
        turn_id: "ask:test:codex-tts-referent-policy-synthesis",
        question: "ok read last final answer aloud",
        workspace_context_snapshot: {
          chat_referent_context: {
            schema: "helix.ask.chat_referent_context.v1",
            previous_assistant_final_answer: {
              role: "assistant",
              reply_id: "reply-prev",
              source_ref: "chat.final_answer.previous:reply-prev",
              text: "Navigation team is ready for the next burn window.",
            },
          },
        },
      },
    });

    const playbackHandoff = (
      result.debug as any
    )?.capability_lane_call_results?.find(
      (entry: any) =>
        entry?.capability === "text_to_speech.speak_text" ||
        entry?.capability_id === "text_to_speech.speak_text",
    )?.observation_packet?.state_delta?.text_to_speech_client_playback_handoff;

    expect((result.debug as any)?.runtime_lane_request_loop).toMatchObject({
      status: "lane_observation_reentered",
      synthesized_by_helix_policy: true,
      synthesis_reason:
        "explicit_read_aloud_referent_resolved_without_runtime_lane_json",
      candidate: expect.objectContaining({
        capability: "text_to_speech.speak_text",
        source_observation_ref: "chat.final_answer.previous:reply-prev",
      }),
    });
    expect(playbackHandoff?.request?.text).toBe(
      "Navigation team is ready for the next burn window.",
    );
  }, 15_000);

  it("streams normalized Codex native event packets without making them terminal authority", async () => {
    process.env.CODEX_AGENT_FAKE_STDOUT = "Native runtime final text.";
    process.env.CODEX_AGENT_FAKE_NATIVE_EVENT_JSONL = [
      JSON.stringify({
        msg: {
          ReasoningContentDelta: {
            turn_id: "ask:test:codex-native-events",
            delta: "Checking the available context.",
          },
        },
      }),
      JSON.stringify({
        msg: {
          McpToolCallBegin: {
            turn_id: "ask:test:codex-native-events",
            tool_name: "docs.search",
            call_id: "native-tool-1",
          },
        },
      }),
      JSON.stringify({
        msg: {
          McpToolCallEnd: {
            turn_id: "ask:test:codex-native-events",
            tool_name: "docs.search",
            call_id: "native-tool-1",
            text: "Found two candidate references.",
          },
        },
      }),
      JSON.stringify({
        msg: {
          TurnComplete: {
            turn_id: "ask:test:codex-native-events",
            last_agent_message: "Native runtime final text.",
          },
        },
      }),
    ].join("\n");
    const streamedEvents: Record<string, unknown>[] = [];

    const result = await codexProvider.runTurn({
      runtime: "codex",
      route: "/ask/turn/stream",
      body: {
        turn_id: "ask:test:codex-native-events",
        question: "Use native Codex events for visibility.",
      },
      onTranscriptEvent: (event) => {
        streamedEvents.push(event);
      },
    });

    expect(result.ok).toBe(true);
    expect(
      streamedEvents.some(
        (event) => event.source_event_type === "codex_native_reasoning_delta",
      ),
    ).toBe(true);
    expect(
      streamedEvents.some(
        (event) => event.source_event_type === "codex_native_tool_request",
      ),
    ).toBe(true);
    expect(
      streamedEvents.some(
        (event) => event.source_event_type === "codex_native_tool_result",
      ),
    ).toBe(true);
    expect(
      streamedEvents.some(
        (event) => event.source_event_type === "codex_native_turn_complete",
      ),
    ).toBe(true);
    const nativeEvents = streamedEvents.filter(
      (event) =>
        typeof event.source_event_type === "string" &&
        event.source_event_type.startsWith("codex_native_"),
    );
    expect(
      nativeEvents.every((event) => event.terminal_eligible === false),
    ).toBe(true);
    expect(
      streamedEvents.some(
        (event) => event.source_event_type === "terminal_answer",
      ),
    ).toBe(false);
    expect(result.final_answer_source).toBe(
      "agent_provider_terminal_candidate",
    );
  });
});
