import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import {
  HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG,
  HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
  HELIX_GOLDEN_PATH_CAPABILITY_CATALOG_CAPABILITY,
  HELIX_GOLDEN_PATH_DOCS_LOCATE_CAPABILITY,
  HELIX_GOLDEN_PATH_INTERNET_SEARCH_EXECUTE_CAPABILITY,
  HELIX_GOLDEN_PATH_INTERNET_SEARCH_WEB_RESEARCH_CAPABILITY,
  HELIX_GOLDEN_PATH_READ_PROCESSED_LIVE_SOURCE_MAIL_CAPABILITY,
  HELIX_GOLDEN_PATH_REFLECT_STAGE_PLAY_CONTEXT_CAPABILITY,
  HELIX_GOLDEN_PATH_REPO_SEARCH_CONCEPT_CAPABILITY,
  HELIX_GOLDEN_PATH_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
  HELIX_GOLDEN_PATH_THEORY_REFLECTION_CAPABILITY,
  HELIX_GOLDEN_PATH_CIVILIZATION_BOUNDS_REFLECTION_CAPABILITY,
  HELIX_GOLDEN_PATH_MORAL_GRAPH_REFLECTION_CAPABILITY,
  HELIX_GOLDEN_PATH_IMAGE_LENS_INSPECT_CAPABILITY,
  HELIX_GOLDEN_PATH_VISUAL_CAPTURE_DESCRIBE_CAPABILITY,
  HELIX_GOLDEN_PATH_WORKSPACE_OS_STATUS_CAPABILITY,
  buildHelixAskGoldenPathRuntimePayload,
  runHelixAskGoldenPathRuntime,
} from "../services/helix-ask/golden-path-runtime";
import { HELIX_WORKSPACE_DIRECTORY_RESOLVE_CAPABILITY } from "../services/helix-ask/workspace-directory-resolver";

const routePath = "server/routes/agi.plan.ts";
const servicePath = "server/services/helix-ask/golden-path-runtime.ts";
const dependencyPath = "server/services/helix-ask/golden-path/runtime-dependencies.ts";
const dispatchPath = "server/services/helix-ask/golden-path/runtime-dispatch.ts";
const runtimeModulesPath = "server/services/helix-ask/golden-path/runtime-modules.ts";
const goldenPathDir = "server/services/helix-ask/golden-path";
const capabilityDir = "server/services/helix-ask/golden-path/capabilities";
const compoundDir = "server/services/helix-ask/golden-path/compounds";
const itineraryDir = "server/services/helix-ask/golden-path/itinerary";

const readLedger = (body: Record<string, any>): any[] =>
  Array.isArray(body.current_turn_artifact_ledger) ? body.current_turn_artifact_ledger : [];

const terminalLedgerEntries = (body: Record<string, any>): any[] =>
  readLedger(body).filter((artifact) => artifact?.kind === body.terminal_artifact_kind);

const listTypeScriptFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return listTypeScriptFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
  });

const countOccurrences = (source: string, pattern: RegExp): number => source.match(pattern)?.length ?? 0;

describe("Helix Ask golden path runtime", () => {
  afterEach(() => {
    delete process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG];
  });

  it("keeps the golden path runtime service route-free and dependency-owned", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");
    const dependencySource = readFileSync(dependencyPath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/golden-path-runtime");
    expect(serviceSource).toContain("type HelixAskGoldenPathRuntimeDependencies");
    expect(serviceSource).toContain("./golden-path/runtime-dependencies");
    expect(dependencySource).toContain("export type HelixAskGoldenPathRuntimeDependencies");
    expect(dependencySource).toContain("buildHelixGoalSatisfactionEvaluationArtifact");
    expect(dependencySource).toContain("buildStagePlayAskCheckpointReceiptPayload");
    expect(dependencySource).toContain("buildAskTurnCompositeHandoffDecision");
    expect(dependencySource).toContain("buildAskTurnCompositeFollowupAudit");
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(dependencySource).not.toContain("server/routes/agi.plan");
    expect(dependencySource).not.toContain("../routes/agi.plan");
    expect(dependencySource).not.toContain("../../routes/agi.plan");
  });

  it("keeps the golden path runtime service as a thin orchestrator", () => {
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(serviceSource).toContain("isHelixAskGoldenPathRuntimeEnabled");
    expect(serviceSource).toContain("isHelixAskGoldenPathRequested");
    expect(serviceSource).toContain("dispatchHelixAskGoldenPathRuntime");
    expect(serviceSource).toContain("buildHelixAskGoldenPathRuntimeContractPayload");
    expect(serviceSource).not.toMatch(/from\s+["']\.\/golden-path\/capabilities\//);
    expect(serviceSource).not.toMatch(/from\s+["']\.\/golden-path\/compounds\//);
    expect(serviceSource).not.toContain("terminal_artifact_kind");
    expect(serviceSource).not.toContain("current_turn_artifact_ledger");
    expect(serviceSource).not.toContain("buildTerminalEnvelope");
    expect(serviceSource).not.toContain("buildGoldenPathTerminalEnvelope");
    expect(serviceSource).not.toContain("buildCapabilityLedger");
    expect(serviceSource).not.toContain("buildCompoundCapabilityContract");
  });

  it("keeps golden path dispatch as an ordered table instead of a payload owner", () => {
    const dispatchSource = readFileSync(dispatchPath, "utf8");
    const runtimeModulesSource = readFileSync(runtimeModulesPath, "utf8");

    expect(dispatchSource).toContain("compoundDispatchModules");
    expect(dispatchSource).toContain("singleCapabilityDispatchModules");
    expect(dispatchSource).toContain("for (const dispatchModule of compoundDispatchModules)");
    expect(dispatchSource).toContain("for (const dispatchModule of singleCapabilityDispatchModules)");
    expect(dispatchSource).toContain("dispatchModule.isRequested(body)");
    expect(dispatchSource).toContain("dispatchModule.buildPayload({ body, deps })");
    expect(dispatchSource).toContain("buildHelixAskGoldenPathRuntimeContractPayload");
    expect(runtimeModulesSource).toContain("const compoundDispatchModules");
    expect(runtimeModulesSource).toContain("const singleCapabilityDispatchModules");
    expect(dispatchSource).not.toContain("terminal_artifact_kind");
    expect(dispatchSource).not.toContain("current_turn_artifact_ledger");
    expect(dispatchSource).not.toContain("selected_final_answer");
    expect(dispatchSource).not.toContain("terminal_answer_authority");
    expect(dispatchSource).not.toContain("buildGoldenPathTerminalEnvelope");
    expect(dispatchSource).not.toContain("buildGoldenPathLedger");
    expect(dispatchSource).not.toContain("buildCompoundCapabilityContract");
  });

  it("keeps the golden path service tree independent from the legacy route", () => {
    const serviceTreePaths = [servicePath, ...listTypeScriptFiles(goldenPathDir)];

    expect(serviceTreePaths.length).toBeGreaterThan(1);
    for (const modulePath of serviceTreePaths) {
      const source = readFileSync(modulePath, "utf8");
      expect(source, `${modulePath} must not import agi.plan.ts`).not.toContain("server/routes/agi.plan");
      expect(source, `${modulePath} must not import agi.plan.ts`).not.toContain("../routes/agi.plan");
      expect(source, `${modulePath} must not import agi.plan.ts`).not.toContain("../../routes/agi.plan");
      expect(source, `${modulePath} must not import agi.plan.ts`).not.toContain("../../../routes/agi.plan");
    }
  });

  it("keeps every golden-path capability and compound module on the standard dispatch surface", () => {
    const modulePaths = [capabilityDir, compoundDir].flatMap((directory) =>
      readdirSync(directory)
        .filter((fileName) => fileName.endsWith(".ts"))
        .map((fileName) => `${directory}/${fileName}`),
    );

    expect(modulePaths.length).toBeGreaterThan(0);
    for (const modulePath of modulePaths) {
      const source = readFileSync(modulePath, "utf8");
      for (const symbolName of [
        "requiredObservationKinds",
        "requiredTerminalKinds",
        "isRequested",
        "buildPayload",
      ]) {
        expect(source, `${modulePath} must expose ${symbolName}`).toMatch(
          new RegExp(`export\\s+(?:const\\s+${symbolName}|\\{[\\s\\S]*\\b${symbolName}\\b[\\s\\S]*\\}\\s+from)`),
        );
      }
    }
  });

  it("keeps golden-path runtime status centralized in the shared helper", () => {
    const modulePaths = [capabilityDir, compoundDir].flatMap((directory) =>
      readdirSync(directory)
        .filter((fileName) => fileName.endsWith(".ts"))
        .map((fileName) => `${directory}/${fileName}`),
    );

    expect(modulePaths.length).toBeGreaterThan(0);
    for (const modulePath of modulePaths) {
      const source = readFileSync(modulePath, "utf8");
      if (source.includes("golden_path_runtime:")) {
        expect(source, `${modulePath} must build runtime status through a shared helper`).toMatch(
          /buildGoldenPath(?:Compound)?RuntimeStatus/,
        );
        expect(source, `${modulePath} must not inline golden_path_runtime object ownership`).not.toContain(
          "golden_path_runtime: {",
        );
        expect(source, `${modulePath} must not own the raw golden-path runtime flag`).not.toContain(
          "HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG",
        );
      }
    }
  });

  it("keeps compound debug mirrors centralized in the shared helper", () => {
    const compoundModulePaths = readdirSync(compoundDir)
      .filter((fileName) => fileName.endsWith(".ts"))
      .map((fileName) => `${compoundDir}/${fileName}`);

    expect(compoundModulePaths.length).toBeGreaterThan(0);
    for (const modulePath of compoundModulePaths) {
      const source = readFileSync(modulePath, "utf8");
      if (source.includes("debug:")) {
        expect(source, `${modulePath} must build compound debug through the shared helper`).toContain(
          "buildGoldenPathCompoundDebugMirror",
        );
        expect(source, `${modulePath} must not inline compound debug mirror ownership`).not.toMatch(
          /debug:\s*\{\s*schema:\s*HELIX_ASK_GOLDEN_PATH_RUNTIME_SCHEMA/,
        );
      }
    }
  });

  it("keeps every dispatch-owned golden-path module imported and ordered exactly once", () => {
    const runtimeModulesSource = readFileSync(runtimeModulesPath, "utf8");
    const dispatchModules = [
      ["Calculator", "./capabilities/calculator"],
      ["CapabilityCatalog", "./capabilities/capability-catalog"],
      ["CivilizationBounds", "./capabilities/civilization-bounds"],
      ["DocsViewer", "./capabilities/docs-viewer"],
      ["InternetSearch", "./capabilities/internet-search"],
      ["ProcessedLiveSourceMail", "./capabilities/processed-live-source-mail"],
      ["RepoCode", "./capabilities/repo-code"],
      ["ScholarlyResearch", "./capabilities/scholarly-research"],
      ["StagePlayReflection", "./capabilities/stage-play-reflection"],
      ["TheoryReflection", "./capabilities/theory-reflection"],
      ["VisualCapture", "./capabilities/visual-capture"],
      ["WorkspaceDirectory", "./capabilities/workspace-directory"],
      ["WorkspaceStatus", "./capabilities/workspace-status"],
      ["MoralGraphReflection", "./capabilities/moral-graph-reflection"],
      ["CatalogWorkspace", "./compounds/catalog-workspace"],
      ["CivilizationMoralReflection", "./compounds/civilization-moral-reflection"],
      ["DocsCalculator", "./compounds/docs-calculator"],
      ["InternetTheoryReflection", "./compounds/internet-theory-reflection"],
      ["RepoDocs", "./compounds/repo-docs"],
      ["VisualCalculator", "./compounds/visual-calculator"],
      ["CompoundItinerary", "./itinerary/compound-itinerary"],
    ] as const;

    for (const [moduleName, modulePath] of dispatchModules) {
      expect(
        countOccurrences(
          runtimeModulesSource,
          new RegExp(`import \\* as ${moduleName} from "${modulePath.replace(/\//g, "\\/")}";`, "g"),
        ),
        `${moduleName} must be imported exactly once`,
      ).toBe(1);
      expect(
        countOccurrences(runtimeModulesSource, new RegExp(`^\\s*${moduleName},\\s*$`, "gm")),
        `${moduleName} must be listed in orderedDispatchModules exactly once`,
      ).toBe(1);
    }
  });

  it("keeps itinerary ownership outside use-case compound dispatch", () => {
    const runtimeModulesSource = readFileSync(runtimeModulesPath, "utf8");
    const itineraryFiles = listTypeScriptFiles(itineraryDir);
    expect(itineraryFiles).toEqual(
      expect.arrayContaining([
        "server/services/helix-ask/golden-path/itinerary/capability-adapters.ts",
        "server/services/helix-ask/golden-path/itinerary/compound-itinerary.ts",
      ]),
    );
    expect(runtimeModulesSource).toContain("./itinerary/compound-itinerary");
    expect(runtimeModulesSource).not.toContain("docs-calculator-reflection-research");
    for (const file of itineraryFiles) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} must not import the legacy route`).not.toContain("server/routes/agi.plan");
      expect(source, `${file} must not import the legacy route relatively`).not.toContain("agi.plan");
    }
  });

  it("keeps dispatch-owned golden-path modules on the standard contract surface", () => {
    const modulePaths = [
      ...readdirSync(capabilityDir)
        .filter((fileName) => fileName.endsWith(".ts"))
        .map((fileName) => `${capabilityDir}/${fileName}`),
      ...readdirSync(compoundDir)
        .filter((fileName) => fileName.endsWith(".ts"))
        .map((fileName) => `${compoundDir}/${fileName}`),
    ];

    expect(modulePaths.length).toBeGreaterThan(0);
    for (const modulePath of modulePaths) {
      const source = readFileSync(modulePath, "utf8");
      expect(
        /export\s+const\s+requiredObservationKinds\b|requiredObservationKinds\s*,/.test(source),
        `${modulePath} must expose requiredObservationKinds directly or through a compatibility re-export`,
      ).toBe(true);
      expect(
        /export\s+const\s+requiredTerminalKinds\b|requiredTerminalKinds\s*,/.test(source),
        `${modulePath} must expose requiredTerminalKinds directly or through a compatibility re-export`,
      ).toBe(true);
      expect(
        /export\s+const\s+isRequested\b|isRequested\s*,/.test(source),
        `${modulePath} must expose isRequested directly or through a compatibility re-export`,
      ).toBe(true);
      expect(
        /export\s+const\s+buildPayload\b|buildPayload\s*,/.test(source),
        `${modulePath} must expose buildPayload directly or through a compatibility re-export`,
      ).toBe(true);
    }
  });

  it("keeps low-level failure ledger and terminal builders out of dispatch-owned modules", () => {
    const modulePaths = [
      ...readdirSync(capabilityDir)
        .filter((fileName) => fileName.endsWith(".ts"))
        .map((fileName) => `${capabilityDir}/${fileName}`),
      ...readdirSync(compoundDir)
        .filter((fileName) => fileName.endsWith(".ts"))
        .map((fileName) => `${compoundDir}/${fileName}`),
    ];
    const lowLevelFailureBuilderPattern =
      /buildGoldenPath(?:TypedFailure(?:TerminalError)?LedgerArtifact|TypedFailure(?:ResponseProjection|TerminalResult)|RouteGateLedgerArtifact)/;

    for (const modulePath of modulePaths) {
      const source = readFileSync(modulePath, "utf8");
      expect(
        source,
        `${modulePath} must delegate failure envelope construction to golden-path failure helpers`,
      ).not.toMatch(lowLevelFailureBuilderPattern);
    }
  });

  it("declines when explicitly disabled or no golden-path module matches", () => {
    expect(
      runHelixAskGoldenPathRuntime({
        env: { [HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG]: "0" },
        body: { goldenPathRuntime: true, prompt: "helix_ask_golden_path_runtime" },
      }),
    ).toEqual({ handled: false, reason: "flag_disabled" });

    expect(
      runHelixAskGoldenPathRuntime({
        env: {},
        body: { prompt: "ordinary prompt" },
      }),
    ).toEqual({ handled: false, reason: "not_requested" });
  });

  it("handles matched golden-path capability prompts without the explicit scaffold marker", () => {
    const decision = runHelixAskGoldenPathRuntime({
      env: {},
      now: new Date("2026-06-28T12:29:00.000Z"),
      body: {
        turn_id: "ask:golden:calculator-no-marker",
        prompt: "Use scientific-calculator.solve_expression with expression: 2 + 2",
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle a matched capability without marker");
    expect(decision.payload).toMatchObject({
      final_status: "final_answer",
      terminal_artifact_kind: "workstation_tool_evaluation",
      final_answer_source: "workstation_tool_evaluation",
      terminal_error_code: null,
      capability_plan: {
        requested_capability: HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
        executed_capability: HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
      },
    });
  });

  it("leaves unsupported natural two-family compounds on the full solver path", () => {
    const decision = runHelixAskGoldenPathRuntime({
      env: {},
      body: {
        prompt:
          "Use scholarly papers and citations to research microtubule coherence, then place it on the theory badge graph with uncertainty mode.",
      },
    });

    expect(decision).toEqual({
      handled: false,
      reason: "two_family_compound_requires_full_solver",
    });
  });

  it("handles processed live-source mail as a golden-path capability with observation re-entry", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:30:00.000Z"),
      body: {
        turn_id: "ask:golden:processed-mail",
        prompt: "helix_ask_golden_path_runtime use live_env.read_processed_live_source_mail",
        goldenPathRuntime: true,
        requested_capability: HELIX_GOLDEN_PATH_READ_PROCESSED_LIVE_SOURCE_MAIL_CAPABILITY,
        processed_mail_packet: {
          packetId: "stage_play_processed_mail_packet:golden-mail",
          jobId: "stage_play_live_source_job:golden",
          sourceId: "screen_summary:golden",
          mailIds: ["stage_play_live_source_mail_item:1"],
          observedFacts: ["The UI shows a pending action banner", "The operator is focused on Docs Viewer"],
          inferredFacts: ["The turn should summarize the live-source packet before advising"],
          uncertainties: ["No audio transcript was included"],
          sceneTags: ["docs-viewer"],
          recommendedNext: "draft_text_answer",
          evidenceRefs: ["visual_frame:golden", "stage_play_live_source_mail_item:1"],
        },
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle processed live-source mail");
    const body = decision.payload;

    expect(body).toMatchObject({
      final_status: "final_answer",
      terminal_artifact_kind: "model_synthesized_answer",
      final_answer_source: "model_synthesized_answer",
      terminal_error_code: null,
      capability_plan: {
        requested_capability: HELIX_GOLDEN_PATH_READ_PROCESSED_LIVE_SOURCE_MAIL_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_READ_PROCESSED_LIVE_SOURCE_MAIL_CAPABILITY,
        executed_capability: HELIX_GOLDEN_PATH_READ_PROCESSED_LIVE_SOURCE_MAIL_CAPABILITY,
        required_observation_kinds: ["stage_play_processed_mail_packet"],
        required_terminal_kind: "model_synthesized_answer",
      },
      ask_turn_solver_trace: {
        completed_solver_path: true,
        requested_capability: HELIX_GOLDEN_PATH_READ_PROCESSED_LIVE_SOURCE_MAIL_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_READ_PROCESSED_LIVE_SOURCE_MAIL_CAPABILITY,
        executed_capability: HELIX_GOLDEN_PATH_READ_PROCESSED_LIVE_SOURCE_MAIL_CAPABILITY,
        observed_artifact_kind: "stage_play_processed_mail_packet",
        terminal_artifact_kind: "model_synthesized_answer",
      },
      terminal_answer_authority: {
        server_authoritative: true,
        terminal_artifact_kind: "model_synthesized_answer",
        final_answer_source: "model_synthesized_answer",
      },
    });
    expect(body.selected_final_answer).toContain("Processed live-source mail packet read");
    expect(body.selected_final_answer).toContain("The UI shows a pending action banner");
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual([
      "golden_path_route_gate",
      "stage_play_processed_mail_packet",
      "model_synthesized_answer",
    ]);
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("fails closed when processed live-source mail is requested without packet evidence", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:31:00.000Z"),
      body: {
        turn_id: "ask:golden:processed-mail-missing",
        prompt: "helix_ask_golden_path_runtime live_env.read_processed_live_source_mail",
        goldenPathRuntime: true,
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle missing processed mail as typed failure");
    const body = decision.payload;

    expect(body).toMatchObject({
      final_status: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "missing_processed_live_source_mail_packet",
      goal_satisfaction_evaluation: {
        satisfaction: "not_satisfied",
        first_broken_rail: "observation",
      },
      ask_turn_solver_trace: {
        completed_solver_path: false,
        requested_capability: HELIX_GOLDEN_PATH_READ_PROCESSED_LIVE_SOURCE_MAIL_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_READ_PROCESSED_LIVE_SOURCE_MAIL_CAPABILITY,
        executed_capability: null,
        first_broken_rail: "observation",
      },
    });
    expect(body.selected_final_answer).toContain("no processed live-source mail packet");
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual(["golden_path_route_gate", "typed_failure"]);
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("handles compact Stage Play reflection evidence through a delegated capability module", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:26:30.000Z"),
      body: {
        turn_id: "ask:golden:stage-play-reflection",
        prompt: "helix_ask_golden_path_runtime use live_env.reflect_stage_play_context",
        goldenPathRuntime: true,
        requested_capability: HELIX_GOLDEN_PATH_REFLECT_STAGE_PLAY_CONTEXT_CAPABILITY,
        stage_play_reflection_result: {
          schema: "stage_play_reflection_result/v1",
          graph: {
            graphId: "stage_play_badge_graph:test",
            missingEvidence: ["model_reviewed_checkpoint"],
          },
          liveAnswerProjection: {
            projected: true,
            projectedLineKeys: ["risk", "unknowns"],
            changedLineKeys: ["risk", "unknowns"],
            skippedLineKeys: ["answer_snapshot"],
            reason: "compact_fixture",
          },
          debugReceipt: {
            graphId: "stage_play_badge_graph:test",
            sourceRefs: ["visual_evidence:test"],
            checkpointFreshness: { reviewed: false },
            checkpointOnlySkipped: ["answer_snapshot"],
          },
        },
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle Stage Play reflection");
    const body = decision.payload;

    expect(body).toMatchObject({
      final_status: "final_answer",
      terminal_artifact_kind: "stage_play_reflection_answer",
      final_answer_source: "stage_play_reflection_answer",
      terminal_error_code: null,
      stage_play_reflection_result: {
        kind: "stage_play_reflection_result",
        tool_id: HELIX_GOLDEN_PATH_REFLECT_STAGE_PLAY_CONTEXT_CAPABILITY,
        projected: true,
      },
      capability_plan: {
        requested_capability: HELIX_GOLDEN_PATH_REFLECT_STAGE_PLAY_CONTEXT_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_REFLECT_STAGE_PLAY_CONTEXT_CAPABILITY,
        executed_capability: HELIX_GOLDEN_PATH_REFLECT_STAGE_PLAY_CONTEXT_CAPABILITY,
        required_observation_kinds: ["stage_play_reflection_result"],
        required_terminal_kind: "stage_play_reflection_answer",
      },
      ask_turn_solver_trace: {
        completed_solver_path: true,
        requested_capability: HELIX_GOLDEN_PATH_REFLECT_STAGE_PLAY_CONTEXT_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_REFLECT_STAGE_PLAY_CONTEXT_CAPABILITY,
        executed_capability: HELIX_GOLDEN_PATH_REFLECT_STAGE_PLAY_CONTEXT_CAPABILITY,
        observed_artifact_kind: "stage_play_reflection_result",
        terminal_artifact_kind: "stage_play_reflection_answer",
      },
      terminal_answer_authority: {
        server_authoritative: true,
        terminal_artifact_kind: "stage_play_reflection_answer",
        final_answer_source: "stage_play_reflection_answer",
      },
    });
    expect(body.selected_final_answer).toContain("Stage Play reflection completed");
    expect(body.selected_final_answer).toContain("did not start capture");
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual([
      "golden_path_route_gate",
      "stage_play_reflection_result",
      "stage_play_reflection_answer",
    ]);
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("handles compact internet search evidence as an internet search answer", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:27:00.000Z"),
      body: {
        turn_id: "ask:golden:internet-search",
        prompt: "helix_ask_golden_path_runtime use internet_search.web_research for current Codex documentation",
        goldenPathRuntime: true,
        requested_capability: HELIX_GOLDEN_PATH_INTERNET_SEARCH_WEB_RESEARCH_CAPABILITY,
        internet_search_query: "OpenAI Codex documentation",
        internet_search_results: [
          {
            result_id: "web:codex-docs",
            title: "OpenAI Codex documentation",
            url: "https://platform.openai.com/docs/codex",
            snippet: "Codex documentation for agentic coding workflows.",
            source_provider: "tavily",
            rank: 1,
            evidence_refs: ["tavily:codex-docs"],
            confidence: "high",
          },
        ],
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle compact internet search evidence");
    const body = decision.payload;

    expect(body).toMatchObject({
      final_status: "final_answer",
      terminal_artifact_kind: "internet_search_answer",
      final_answer_source: "internet_search_answer",
      terminal_error_code: null,
      internet_search_observation: {
        schema: "helix.internet_search_observation.v1",
        capability: HELIX_GOLDEN_PATH_INTERNET_SEARCH_EXECUTE_CAPABILITY,
        query: "OpenAI Codex documentation",
        results: [
          {
            result_id: "web:codex-docs",
            title: "OpenAI Codex documentation",
            url: "https://platform.openai.com/docs/codex",
            rank: 1,
          },
        ],
      },
      internet_search_answer: {
        result_count: 1,
      },
      capability_plan: {
        requested_capability: HELIX_GOLDEN_PATH_INTERNET_SEARCH_WEB_RESEARCH_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_INTERNET_SEARCH_EXECUTE_CAPABILITY,
        executed_capability: HELIX_GOLDEN_PATH_INTERNET_SEARCH_EXECUTE_CAPABILITY,
        required_observation_kinds: ["internet_search_observation"],
        required_terminal_kind: "internet_search_answer",
      },
      ask_turn_solver_trace: {
        completed_solver_path: true,
        requested_capability: HELIX_GOLDEN_PATH_INTERNET_SEARCH_WEB_RESEARCH_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_INTERNET_SEARCH_EXECUTE_CAPABILITY,
        executed_capability: HELIX_GOLDEN_PATH_INTERNET_SEARCH_EXECUTE_CAPABILITY,
        observed_artifact_kind: "internet_search_observation",
        terminal_artifact_kind: "internet_search_answer",
      },
    });
    expect(body.selected_final_answer).toContain("Internet search completed");
    expect(body.selected_final_answer).toContain("OpenAI Codex documentation");
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual([
      "golden_path_route_gate",
      "internet_search_observation",
      "internet_search_answer",
    ]);
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("does not treat quoted and negated internet-search tool names as golden-path search requests", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:27:10.000Z"),
      body: {
        turn_id: "ask:golden:quoted-internet-search-name",
        prompt:
          "Explain the literal phrase `internet-search.search_web` as a software tool name. Do not browse, search, retrieve web evidence, or call tools.",
      },
    });

    expect(decision).toEqual({ handled: false, reason: "not_requested" });
  });

  it("fails closed when internet search lacks compact web result evidence", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:27:30.000Z"),
      body: {
        turn_id: "ask:golden:internet-search-missing",
        prompt: "helix_ask_golden_path_runtime use internet_search.web_research for current Codex documentation",
        goldenPathRuntime: true,
        requested_capability: HELIX_GOLDEN_PATH_INTERNET_SEARCH_WEB_RESEARCH_CAPABILITY,
        internet_search_query: "OpenAI Codex documentation",
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle missing internet evidence as typed failure");
    const body = decision.payload;

    expect(body).toMatchObject({
      final_status: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "missing_compact_internet_search_evidence",
      goal_satisfaction_evaluation: {
        satisfaction: "not_satisfied",
        first_broken_rail: "observation",
      },
      ask_turn_solver_trace: {
        completed_solver_path: false,
        requested_capability: HELIX_GOLDEN_PATH_INTERNET_SEARCH_WEB_RESEARCH_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_INTERNET_SEARCH_EXECUTE_CAPABILITY,
        executed_capability: null,
        first_broken_rail: "observation",
      },
    });
    expect(body.selected_final_answer).toContain("no compact web result evidence");
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual(["golden_path_route_gate", "typed_failure"]);
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("handles internet research plus theory reflection as an ordered compound contract", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:27:45.000Z"),
      body: {
        turn_id: "ask:golden:internet-reflection-compound",
        prompt:
          "helix_ask_golden_path_runtime use internet_search.web_research and helix_ask.reflect_theory_context",
        goldenPathRuntime: true,
        requested_capabilities: [
          HELIX_GOLDEN_PATH_INTERNET_SEARCH_WEB_RESEARCH_CAPABILITY,
          HELIX_GOLDEN_PATH_THEORY_REFLECTION_CAPABILITY,
        ],
        internet_search_query: "OpenAI Codex tool call lifecycle",
        internet_search_results: [
          {
            result_id: "web:codex-lifecycle",
            title: "OpenAI Codex tool call lifecycle",
            url: "https://platform.openai.com/docs/codex",
            snippet: "Codex executes requested tool calls and returns tool outputs before finalizing.",
            source_provider: "tavily",
            rank: 1,
            evidence_refs: ["tavily:codex-lifecycle"],
            confidence: "high",
          },
        ],
        topic: "Codex parity for Helix Ask observations",
        anchors: ["tool outputs re-enter reasoning", "receipts are observations"],
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle research+reflection compound");
    const body = decision.payload;

    expect(body).toMatchObject({
      final_status: "final_answer",
      terminal_artifact_kind: "compound_evidence_synthesis_answer",
      final_answer_source: "compound_evidence_synthesis_answer",
      terminal_error_code: null,
      internet_search_observation: {
        schema: "helix.internet_search_observation.v1",
        capability: HELIX_GOLDEN_PATH_INTERNET_SEARCH_EXECUTE_CAPABILITY,
        query: "OpenAI Codex tool call lifecycle",
      },
      helix_theory_context_reflection_tool_receipt: {
        schema: "helix.theory_context_reflection_tool_receipt.v1",
        capability_key: HELIX_GOLDEN_PATH_THEORY_REFLECTION_CAPABILITY,
        topic: "Codex parity for Helix Ask observations",
        source_refs: expect.arrayContaining(["ask:golden:internet-reflection-compound:internet_search_observation"]),
      },
      compound_capability_contract: {
        satisfaction: "satisfied",
        ordered_subgoals: [
          {
            requested_capability: HELIX_GOLDEN_PATH_INTERNET_SEARCH_WEB_RESEARCH_CAPABILITY,
            selected_capability: HELIX_GOLDEN_PATH_INTERNET_SEARCH_EXECUTE_CAPABILITY,
            executed_capability: HELIX_GOLDEN_PATH_INTERNET_SEARCH_EXECUTE_CAPABILITY,
            observation_kind: "internet_search_observation",
            terminal_contribution_kind: "internet_search_answer",
            satisfaction: "satisfied",
          },
          {
            requested_capability: HELIX_GOLDEN_PATH_THEORY_REFLECTION_CAPABILITY,
            selected_capability: HELIX_GOLDEN_PATH_THEORY_REFLECTION_CAPABILITY,
            executed_capability: HELIX_GOLDEN_PATH_THEORY_REFLECTION_CAPABILITY,
            observation_kind: "helix_theory_context_reflection_tool_receipt",
            terminal_contribution_kind: "theory_context_reflection_answer",
            satisfaction: "satisfied",
          },
        ],
      },
      capability_plan: {
        requested_capability: "compound_capability_contract",
        selected_capability: "compound_capability_contract",
        executed_capability: "compound_capability_contract",
        required_observation_kinds: ["internet_search_observation", "helix_theory_context_reflection_tool_receipt"],
        required_terminal_kind: "compound_evidence_synthesis_answer",
      },
      ask_turn_solver_trace: {
        completed_solver_path: true,
        requested_capability: "compound_capability_contract",
        selected_capability: "compound_capability_contract",
        executed_capability: "compound_capability_contract",
        observed_artifact_kind: "compound_subgoal_observations",
        terminal_artifact_kind: "compound_evidence_synthesis_answer",
        compound_subgoal_count: 2,
      },
    });
    expect(body.selected_final_answer).toContain("Compound research/reflection synthesis completed");
    expect(body.selected_final_answer).toContain("Codex parity for Helix Ask observations");
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual([
      "golden_path_route_gate",
      "internet_search_observation",
      "helix_theory_context_reflection_tool_receipt",
      "compound_evidence_synthesis_answer",
    ]);
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("handles compact scholarly research evidence as a scholarly answer", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:28:00.000Z"),
      body: {
        turn_id: "ask:golden:scholarly-research",
        prompt: "helix_ask_golden_path_runtime use scholarly-research.lookup_papers for Casimir cavity force papers",
        goldenPathRuntime: true,
        requested_capability: HELIX_GOLDEN_PATH_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
        scholarly_query: "Casimir cavity force measurements",
        scholarly_papers: [
          {
            result_id: "paper:casimir-1948",
            title: "On the attraction between two perfectly conducting plates",
            authors: [{ name: "H. B. G. Casimir" }],
            year: 1948,
            venue: "Proceedings of the Royal Netherlands Academy of Arts and Sciences",
            identifiers: { doi: "10.1007/978-3-7091-9385-0_24" },
            evidence_refs: ["crossref:10.1007/978-3-7091-9385-0_24"],
            source_providers: ["crossref"],
            confidence: "high",
          },
        ],
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle compact scholarly evidence");
    const body = decision.payload;

    expect(body).toMatchObject({
      final_status: "final_answer",
      terminal_artifact_kind: "scholarly_research_answer",
      final_answer_source: "scholarly_research_answer",
      terminal_error_code: null,
      scholarly_research_observation: {
        schema: "helix.scholarly_research_observation.v1",
        capability: HELIX_GOLDEN_PATH_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
        query: "Casimir cavity force measurements",
        papers: [
          {
            result_id: "paper:casimir-1948",
            title: "On the attraction between two perfectly conducting plates",
            year: 1948,
          },
        ],
      },
      scholarly_research_answer: {
        paper_count: 1,
      },
      capability_plan: {
        requested_capability: HELIX_GOLDEN_PATH_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
        executed_capability: HELIX_GOLDEN_PATH_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
        required_observation_kinds: ["scholarly_research_observation"],
        required_terminal_kind: "scholarly_research_answer",
      },
      ask_turn_solver_trace: {
        completed_solver_path: true,
        requested_capability: HELIX_GOLDEN_PATH_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
        executed_capability: HELIX_GOLDEN_PATH_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
        observed_artifact_kind: "scholarly_research_observation",
        terminal_artifact_kind: "scholarly_research_answer",
      },
    });
    expect(body.selected_final_answer).toContain("Scholarly research lookup completed");
    expect(body.selected_final_answer).toContain("On the attraction between two perfectly conducting plates");
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual([
      "golden_path_route_gate",
      "scholarly_research_observation",
      "scholarly_research_answer",
    ]);
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("fails closed when scholarly research lacks compact paper evidence", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:28:30.000Z"),
      body: {
        turn_id: "ask:golden:scholarly-research-missing",
        prompt: "helix_ask_golden_path_runtime use scholarly-research.lookup_papers for Casimir force papers",
        goldenPathRuntime: true,
        requested_capability: HELIX_GOLDEN_PATH_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
        scholarly_query: "Casimir force papers",
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle missing scholarly evidence as typed failure");
    const body = decision.payload;

    expect(body).toMatchObject({
      final_status: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "missing_compact_scholarly_evidence",
      goal_satisfaction_evaluation: {
        satisfaction: "not_satisfied",
        first_broken_rail: "observation",
      },
      ask_turn_solver_trace: {
        completed_solver_path: false,
        requested_capability: HELIX_GOLDEN_PATH_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
        executed_capability: null,
        first_broken_rail: "observation",
      },
    });
    expect(body.selected_final_answer).toContain("no compact scholarly paper evidence");
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual(["golden_path_route_gate", "typed_failure"]);
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("does not treat a scholarly tool behavior question as a paper lookup request", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      body: {
        turn_id: "ask:golden:scholarly-capability-question",
        prompt:
          "Does your tool for research papers allow you to pick papers you are able to parse? Or do you check what papers are openable to then use Image Lens?",
      },
    });

    expect(decision).toMatchObject({ handled: false });
  });

  it("handles theory reflection as receipt-backed reflection answers", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:29:00.000Z"),
      body: {
        turn_id: "ask:golden:theory-reflection",
        prompt: "helix_ask_golden_path_runtime use helix_ask.reflect_theory_context",
        goldenPathRuntime: true,
        requested_capability: HELIX_GOLDEN_PATH_THEORY_REFLECTION_CAPABILITY,
        topic: "Casimir tile duty budget",
        anchors: ["Casimir Cavities and Curvature", "Collapse and Stellar Evolution"],
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle theory reflection");
    const body = decision.payload;

    expect(body).toMatchObject({
      final_status: "final_answer",
      terminal_artifact_kind: "theory_context_reflection_answer",
      final_answer_source: "theory_context_reflection_answer",
      terminal_error_code: null,
      helix_theory_context_reflection_tool_receipt: {
        capability_key: HELIX_GOLDEN_PATH_THEORY_REFLECTION_CAPABILITY,
        topic: "Casimir tile duty budget",
        anchors: ["Casimir Cavities and Curvature", "Collapse and Stellar Evolution"],
      },
      theory_context_reflection_answer: {
        topic: "Casimir tile duty budget",
      },
      capability_plan: {
        requested_capability: HELIX_GOLDEN_PATH_THEORY_REFLECTION_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_THEORY_REFLECTION_CAPABILITY,
        executed_capability: HELIX_GOLDEN_PATH_THEORY_REFLECTION_CAPABILITY,
        required_observation_kinds: ["helix_theory_context_reflection_tool_receipt"],
        required_terminal_kind: "theory_context_reflection_answer",
      },
      ask_turn_solver_trace: {
        completed_solver_path: true,
        requested_capability: HELIX_GOLDEN_PATH_THEORY_REFLECTION_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_THEORY_REFLECTION_CAPABILITY,
        executed_capability: HELIX_GOLDEN_PATH_THEORY_REFLECTION_CAPABILITY,
        observed_artifact_kind: "helix_theory_context_reflection_tool_receipt",
        terminal_artifact_kind: "theory_context_reflection_answer",
      },
      terminal_answer_authority: {
        server_authoritative: true,
        terminal_artifact_kind: "theory_context_reflection_answer",
        final_answer_source: "theory_context_reflection_answer",
      },
    });
    expect(body.selected_final_answer).toContain("Theory context reflection for: Casimir tile duty budget");
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual([
      "golden_path_route_gate",
      "helix_theory_context_reflection_tool_receipt",
      "theory_context_reflection_answer",
    ]);
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("fails closed when theory reflection is requested without a topic", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:29:30.000Z"),
      body: {
        turn_id: "ask:golden:theory-reflection-missing",
        prompt: "helix_ask_golden_path_runtime helix_ask.reflect_theory_context",
        goldenPathRuntime: true,
        requested_capability: HELIX_GOLDEN_PATH_THEORY_REFLECTION_CAPABILITY,
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle missing theory topic as typed failure");
    const body = decision.payload;

    expect(body).toMatchObject({
      final_status: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "missing_theory_reflection_topic",
      goal_satisfaction_evaluation: {
        satisfaction: "not_satisfied",
        first_broken_rail: "argument_extraction",
      },
      ask_turn_solver_trace: {
        completed_solver_path: false,
        requested_capability: HELIX_GOLDEN_PATH_THEORY_REFLECTION_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_THEORY_REFLECTION_CAPABILITY,
        executed_capability: null,
        first_broken_rail: "argument_extraction",
      },
    });
    expect(body.selected_final_answer).toContain("no reflection topic");
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual(["golden_path_route_gate", "typed_failure"]);
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("handles compact civilization bounds evidence as a reflection answer", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:29:45.000Z"),
      body: {
        turn_id: "ask:golden:civilization-bounds",
        prompt: "helix_ask_golden_path_runtime use helix_ask.reflect_civilization_bounds",
        goldenPathRuntime: true,
        requested_capability: HELIX_GOLDEN_PATH_CIVILIZATION_BOUNDS_REFLECTION_CAPABILITY,
        civilization_bounds_tool_result: {
          roadmap: {
            roadmapId: "civilization-bounds:test",
            title: "Civilization Bounds Roadmap",
            systems: [{ systemId: "energy", label: "Energy system" }],
            badges: [{ badgeId: "badge:energy", label: "Energy budget unknown" }],
            collaborationBounds: [{ boundId: "bound:review", limitingFactor: "governance_review" }],
            missingEvidence: ["source_backed_capacity_measurements"],
            authority: {
              assistant_answer: false,
              terminal_eligible: false,
              agent_executable: false,
              prediction_finality: false,
              policy_finality: false,
              moral_finality: false,
              execution_permission: false,
            },
          },
          bridgeContext: {
            systemIds: ["energy"],
            missingEvidence: ["source_backed_capacity_measurements"],
          },
        },
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle civilization bounds reflection");
    const body = decision.payload;

    expect(body).toMatchObject({
      final_status: "final_answer",
      terminal_artifact_kind: "civilization_bounds_reflection_answer",
      final_answer_source: "civilization_bounds_reflection_answer",
      terminal_error_code: null,
      helix_civilization_bounds_tool_result: {
        kind: "helix_civilization_bounds_tool_result",
        tool_id: HELIX_GOLDEN_PATH_CIVILIZATION_BOUNDS_REFLECTION_CAPABILITY,
        procedural_receipt: {
          schema: "helix.reflection_procedural_receipt.v1",
          constraints_introduced: expect.arrayContaining([
            "Treat the idea as a bounded scenario or hypothesis, not as feasibility proof.",
          ]),
          missing_evidence: expect.arrayContaining(["source_backed_capacity_measurements"]),
          assistant_answer: false,
          terminal_eligible: false,
        },
        answer_guidance: {
          schema: "helix.reflection_answer_guidance.v1",
          blocked_claims: expect.arrayContaining(["Do not claim feasibility."]),
          assistant_answer: false,
          terminal_eligible: false,
        },
        terminal_eligible: false,
      },
      civilization_bounds_reflection_answer: {
        roadmap_id: "civilization-bounds:test",
        title: "Civilization Bounds Roadmap",
      },
      capability_plan: {
        requested_capability: HELIX_GOLDEN_PATH_CIVILIZATION_BOUNDS_REFLECTION_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_CIVILIZATION_BOUNDS_REFLECTION_CAPABILITY,
        executed_capability: HELIX_GOLDEN_PATH_CIVILIZATION_BOUNDS_REFLECTION_CAPABILITY,
        required_observation_kinds: ["helix_civilization_bounds_tool_result"],
        required_terminal_kind: "civilization_bounds_reflection_answer",
      },
      ask_turn_solver_trace: {
        completed_solver_path: true,
        requested_capability: HELIX_GOLDEN_PATH_CIVILIZATION_BOUNDS_REFLECTION_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_CIVILIZATION_BOUNDS_REFLECTION_CAPABILITY,
        executed_capability: HELIX_GOLDEN_PATH_CIVILIZATION_BOUNDS_REFLECTION_CAPABILITY,
        observed_artifact_kind: "helix_civilization_bounds_tool_result",
        terminal_artifact_kind: "civilization_bounds_reflection_answer",
      },
      terminal_answer_authority: {
        server_authoritative: true,
        terminal_artifact_kind: "civilization_bounds_reflection_answer",
        final_answer_source: "civilization_bounds_reflection_answer",
      },
    });
    expect(body.selected_final_answer).toContain("bounded hypothesis rather than proof");
    expect(body.selected_final_answer).toContain("capacity, material inventory, fairness, and explicit review ownership");
    expect(body.selected_final_answer).toContain("cannot grant prediction, policy, moral, execution, or implementation authority");
    expect(body.selected_final_answer).not.toContain("Systems:");
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual([
      "golden_path_route_gate",
      "helix_civilization_bounds_tool_result",
      "civilization_bounds_reflection_answer",
    ]);
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("uses prompt-produced civilization bounds evidence when no compact roadmap is supplied", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:36:00.000Z"),
      body: {
        turn_id: "ask:golden:civilization-bounds-prompt",
        prompt:
          "helix_ask_golden_path_runtime reflect civilization bounds for a diagnostic-only claim boundary",
        goldenPathRuntime: true,
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should produce bounded civilization evidence");
    const body = decision.payload;

    expect(body).toMatchObject({
      terminal_artifact_kind: "civilization_bounds_reflection_answer",
      final_answer_source: "civilization_bounds_reflection_answer",
      terminal_error_code: null,
      helix_civilization_bounds_tool_result: {
        kind: "helix_civilization_bounds_tool_result",
        roadmap: {
          roadmapId: "civilization-bounds:prompt-produced",
        },
        terminal_eligible: false,
      },
    });
    expect(body.selected_final_answer).toContain("bounded hypothesis");
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual([
      "golden_path_route_gate",
      "helix_civilization_bounds_tool_result",
      "civilization_bounds_reflection_answer",
    ]);
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("handles compact moral graph ideology evidence as a reflection answer", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:30:00.000Z"),
      body: {
        turn_id: "ask:golden:moral-graph",
        prompt: "helix_ask_golden_path_runtime use helix_ask.reflect_ideology_context",
        goldenPathRuntime: true,
        requested_capability: HELIX_GOLDEN_PATH_MORAL_GRAPH_REFLECTION_CAPABILITY,
        helix_moral_graph_reflection_tool_result: {
          reflection: {
            artifactId: "ideology_context_reflection",
            reflectionId: "ideology-context-reflection:test",
            schemaVersion: "ideology_context_reflection/v1",
            input: {
              kind: "user_prompt",
              summary: "Reflect right speech and two-key review as evidence-only lenses.",
              refs: ["turn:moral-graph", "doc:ethos"],
            },
            activated_traits: [{ nodeId: "right-speech", label: "Right Speech" }],
            tensions: [{ id: "missing-check", severity: "medium" }],
            recommended_actions: [{ id: "ask-for-evidence", type: "diagnostic", label: "Ask for missing evidence" }],
            authority: {
              assistant_answer: false,
              raw_content_included: false,
              terminal_eligible: false,
              context_role: "tool_policy",
              ask_context_policy: "evidence_only",
              agent_executable: false,
            },
          },
          proceduralClassification: {
            classifications: [{ observedPattern: "practice_commitment", proceduralMove: "ask_for_concrete_evidence" }],
          },
          locator: {
            matches: [{ nodeId: "right-speech", path: ["speech", "review"] }],
          },
          admissions: [{ id: "admission:diagnostic", actions: [] }],
        },
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle moral graph reflection");
    const body = decision.payload;

    expect(body).toMatchObject({
      final_status: "final_answer",
      terminal_artifact_kind: "ideology_context_reflection_answer",
      final_answer_source: "ideology_context_reflection_answer",
      terminal_error_code: null,
      helix_moral_graph_reflection_tool_result: {
        kind: "helix_moral_graph_reflection_tool_result",
        tool_id: HELIX_GOLDEN_PATH_MORAL_GRAPH_REFLECTION_CAPABILITY,
        procedural_receipt: {
          schema: "helix.reflection_procedural_receipt.v1",
          constraints_introduced: expect.arrayContaining([
            "Treat ideology graph matches as normative and procedural constraints, not as moral verdicts.",
          ]),
          assistant_answer: false,
          terminal_eligible: false,
        },
        answer_guidance: {
          schema: "helix.reflection_answer_guidance.v1",
          blocked_claims: expect.arrayContaining(["Do not claim moral finality."]),
          assistant_answer: false,
          terminal_eligible: false,
        },
        terminal_eligible: false,
      },
      ideology_context_reflection_answer: {
        reflection_id: "ideology-context-reflection:test",
      },
      capability_plan: {
        requested_capability: HELIX_GOLDEN_PATH_MORAL_GRAPH_REFLECTION_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_MORAL_GRAPH_REFLECTION_CAPABILITY,
        executed_capability: HELIX_GOLDEN_PATH_MORAL_GRAPH_REFLECTION_CAPABILITY,
        required_observation_kinds: ["helix_moral_graph_reflection_tool_result"],
        required_terminal_kind: "ideology_context_reflection_answer",
      },
      ask_turn_solver_trace: {
        completed_solver_path: true,
        requested_capability: HELIX_GOLDEN_PATH_MORAL_GRAPH_REFLECTION_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_MORAL_GRAPH_REFLECTION_CAPABILITY,
        executed_capability: HELIX_GOLDEN_PATH_MORAL_GRAPH_REFLECTION_CAPABILITY,
        observed_artifact_kind: "helix_moral_graph_reflection_tool_result",
        terminal_artifact_kind: "ideology_context_reflection_answer",
      },
      terminal_answer_authority: {
        server_authoritative: true,
        terminal_artifact_kind: "ideology_context_reflection_answer",
        final_answer_source: "ideology_context_reflection_answer",
      },
    });
    expect(body.selected_final_answer).toContain("bounded framing question");
    expect(body.selected_final_answer).toContain("cannot become a moral verdict or execution permission");
    expect(body.selected_final_answer).toContain("evidence-seeking steps");
    expect(body.selected_final_answer).not.toContain("Activated lenses:");
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual([
      "golden_path_route_gate",
      "helix_moral_graph_reflection_tool_result",
      "ideology_context_reflection_answer",
    ]);
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("handles compact visual capture evidence as a situation context pack", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:32:00.000Z"),
      body: {
        turn_id: "ask:golden:visual-capture",
        prompt: "helix_ask_golden_path_runtime use image_lens.inspect to describe the current screen",
        goldenPathRuntime: true,
        requested_capability: HELIX_GOLDEN_PATH_IMAGE_LENS_INSPECT_CAPABILITY,
        visual_summary: "The Docs Viewer is focused on the NHM2 whitepaper with a theory graph panel nearby.",
        detected_objects: ["Docs Viewer", "NHM2 whitepaper", "Theory graph panel"],
        detected_scene_relations: ["Docs Viewer is the focused panel"],
        uncertainty: ["No raw image is included in the golden-path fixture"],
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle compact visual capture evidence");
    const body = decision.payload;

    expect(body).toMatchObject({
      final_status: "final_answer",
      terminal_artifact_kind: "situation_context_pack",
      final_answer_source: "situation_context_pack",
      terminal_error_code: null,
      visual_frame_evidence: {
        summary: "The Docs Viewer is focused on the NHM2 whitepaper with a theory graph panel nearby.",
        raw_image_included: false,
      },
      capability_plan: {
        requested_capability: HELIX_GOLDEN_PATH_IMAGE_LENS_INSPECT_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_VISUAL_CAPTURE_DESCRIBE_CAPABILITY,
        executed_capability: HELIX_GOLDEN_PATH_VISUAL_CAPTURE_DESCRIBE_CAPABILITY,
        substitution_rule_applied: true,
        required_observation_kinds: ["visual_frame_evidence", "situation_context_pack"],
        required_terminal_kind: "situation_context_pack",
      },
      ask_turn_solver_trace: {
        completed_solver_path: true,
        requested_capability: HELIX_GOLDEN_PATH_IMAGE_LENS_INSPECT_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_VISUAL_CAPTURE_DESCRIBE_CAPABILITY,
        executed_capability: HELIX_GOLDEN_PATH_VISUAL_CAPTURE_DESCRIBE_CAPABILITY,
        observed_artifact_kind: "visual_frame_evidence",
        terminal_artifact_kind: "situation_context_pack",
      },
      terminal_answer_authority: {
        server_authoritative: true,
        terminal_artifact_kind: "situation_context_pack",
        final_answer_source: "situation_context_pack",
      },
    });
    expect(body.selected_final_answer).toContain("Visual capture compact evidence was inspected");
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual([
      "golden_path_route_gate",
      "visual_frame_evidence",
      "situation_context_pack",
    ]);
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("fails closed when visual capture is requested without compact evidence", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:32:30.000Z"),
      body: {
        turn_id: "ask:golden:visual-capture-missing",
        prompt: "helix_ask_golden_path_runtime situation-room.describe_visual_capture",
        goldenPathRuntime: true,
        requested_capability: HELIX_GOLDEN_PATH_VISUAL_CAPTURE_DESCRIBE_CAPABILITY,
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle missing visual evidence as typed failure");
    const body = decision.payload;

    expect(body).toMatchObject({
      final_status: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "missing_compact_visual_evidence",
      goal_satisfaction_evaluation: {
        satisfaction: "not_satisfied",
        first_broken_rail: "observation",
      },
      ask_turn_solver_trace: {
        completed_solver_path: false,
        requested_capability: HELIX_GOLDEN_PATH_VISUAL_CAPTURE_DESCRIBE_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_VISUAL_CAPTURE_DESCRIBE_CAPABILITY,
        executed_capability: null,
        first_broken_rail: "observation",
      },
    });
    expect(body.selected_final_answer).toContain("no compact visual evidence");
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual(["golden_path_route_gate", "typed_failure"]);
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("builds a contract-only terminal payload without entering the private loop", () => {
    const payload = buildHelixAskGoldenPathRuntimePayload({
      now: new Date("2026-06-28T12:00:00.000Z"),
      body: {
        turn_id: "ask:golden:test",
        trace_id: "trace:golden:test",
        session_id: "session-1",
        prompt: "helix_ask_golden_path_runtime contract check",
      },
    });

    expect(payload).toMatchObject({
      schema: "helix.ask_golden_path_runtime.v1",
      turn_id: "ask:golden:test",
      trace_id: "trace:golden:test",
      session_id: "session-1",
      response_type: "final_answer",
      final_status: "final_answer",
      final_answer_source: "helix_ask_golden_path_runtime",
      terminal_artifact_kind: "golden_path_contract_answer",
      terminal_error_code: null,
      ask_turn_solver_trace: {
        completed_solver_path: true,
        private_runtime_loop_entered: false,
      },
      golden_path_runtime: {
        status: "contract_only",
        legacy_route_bypassed: true,
        private_runtime_loop_entered: false,
      },
      terminal_answer_authority: {
        server_authoritative: true,
        final_answer_source: "helix_ask_golden_path_runtime",
        terminal_artifact_kind: "golden_path_contract_answer",
      },
    });
    expect(readLedger(payload).map((artifact) => artifact.kind)).toEqual([
      "golden_path_route_gate",
      "golden_path_contract_answer",
    ]);
    const payloadTerminalEntries = terminalLedgerEntries(payload);
    expect(payloadTerminalEntries).toEqual([
      expect.objectContaining({
        kind: "golden_path_contract_answer",
      }),
    ]);
    expect(payloadTerminalEntries[0]?.payload?.text ?? payloadTerminalEntries[0]?.text).toBe(payload.selected_final_answer);
    expect(payload.assistant_answer).toBe(payload.selected_final_answer);
  });

  it("handles an enabled explicit request through the service contract", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      body: {
        turn_id: "ask:golden:api",
        session_id: "session-golden",
        prompt: "helix_ask_golden_path_runtime contract check",
        goldenPathRuntime: true,
        debug: true,
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should have handled the explicit request");
    const body = decision.payload;

    expect(body).toMatchObject({
      turn_id: "ask:golden:api",
      final_status: "final_answer",
      terminal_artifact_kind: "golden_path_contract_answer",
      final_answer_source: "helix_ask_golden_path_runtime",
      terminal_error_code: null,
      terminal_answer_authority: {
        server_authoritative: true,
        terminal_artifact_kind: "golden_path_contract_answer",
        final_answer_source: "helix_ask_golden_path_runtime",
      },
    });
    expect(body.golden_path_runtime).toMatchObject({
      status: "contract_only",
      legacy_route_bypassed: true,
      private_runtime_loop_entered: false,
    });
    expect(body.selected_final_answer).toBeTruthy();
    expect(body.answer).toBe(body.selected_final_answer);
    expect((body.terminal_authority_single_writer as any).visible_text).toBe(body.selected_final_answer);
    expect((body.terminal_answer_authority as any).final_answer_source).toBe(body.final_answer_source);
    expect(readLedger(body).length).toBeGreaterThanOrEqual(2);
    const responseTerminalEntries = terminalLedgerEntries(body);
    expect(responseTerminalEntries).toEqual([
      expect.objectContaining({
        kind: "golden_path_contract_answer",
      }),
    ]);
    expect(responseTerminalEntries[0]?.payload?.text ?? responseTerminalEntries[0]?.text).toBe(
      body.selected_final_answer,
    );
    expect(Array.isArray(body.terminal_results) ? body.terminal_results : []).toHaveLength(1);
    expect(body.answer).toContain("contract-only");
  });

  it("handles capability catalog as a single explicit capability", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:30:00.000Z"),
      body: {
        turn_id: "ask:golden:capability-catalog",
        prompt: "helix_ask_golden_path_runtime use helix_ask.inspect_capability_catalog",
        goldenPathRuntime: true,
        requested_capability: HELIX_GOLDEN_PATH_CAPABILITY_CATALOG_CAPABILITY,
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle capability catalog");
    const body = decision.payload;

    expect(body).toMatchObject({
      final_status: "final_answer",
      terminal_artifact_kind: "capability_help_summary",
      final_answer_source: "capability_help_summary",
      terminal_error_code: null,
      capability_registry: {
        capability_key: HELIX_GOLDEN_PATH_CAPABILITY_CATALOG_CAPABILITY,
      },
      capability_plan: {
        requested_capability: HELIX_GOLDEN_PATH_CAPABILITY_CATALOG_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_CAPABILITY_CATALOG_CAPABILITY,
        executed_capability: HELIX_GOLDEN_PATH_CAPABILITY_CATALOG_CAPABILITY,
        required_observation_kinds: ["capability_registry"],
        required_terminal_kind: "capability_help_summary",
      },
      ask_turn_solver_trace: {
        completed_solver_path: true,
        requested_capability: HELIX_GOLDEN_PATH_CAPABILITY_CATALOG_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_CAPABILITY_CATALOG_CAPABILITY,
        executed_capability: HELIX_GOLDEN_PATH_CAPABILITY_CATALOG_CAPABILITY,
        observed_artifact_kind: "capability_registry",
        terminal_artifact_kind: "capability_help_summary",
      },
    });
    expect(body.selected_final_answer).toContain("Capability catalog inspection completed");
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual([
      "golden_path_route_gate",
      "capability_registry",
      "capability_help_summary",
    ]);
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("handles workspace status as a single explicit capability", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:32:00.000Z"),
      body: {
        turn_id: "ask:golden:workspace-status",
        prompt: "helix_ask_golden_path_runtime use workspace_os.status",
        goldenPathRuntime: true,
        requested_capability: HELIX_GOLDEN_PATH_WORKSPACE_OS_STATUS_CAPABILITY,
        workspace_os_status: {
          status: "available",
          counts: {
            total: 34,
            available: 18,
            degraded: 1,
            blocked: 3,
            error: 0,
            unknown: 12,
          },
        },
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle workspace status");
    const body = decision.payload;

    expect(body).toMatchObject({
      final_status: "final_answer",
      terminal_artifact_kind: "workspace_status_answer",
      final_answer_source: "workspace_status_answer",
      terminal_error_code: null,
      workspace_os_status_observation: {
        capability_key: HELIX_GOLDEN_PATH_WORKSPACE_OS_STATUS_CAPABILITY,
        capability_counts: {
          total: 34,
          available: 18,
          degraded: 1,
          blocked: 3,
          error: 0,
          unknown: 12,
        },
      },
      capability_plan: {
        requested_capability: HELIX_GOLDEN_PATH_WORKSPACE_OS_STATUS_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_WORKSPACE_OS_STATUS_CAPABILITY,
        executed_capability: HELIX_GOLDEN_PATH_WORKSPACE_OS_STATUS_CAPABILITY,
        required_observation_kinds: ["workspace_os_status_observation"],
        required_terminal_kind: "workspace_status_answer",
      },
      ask_turn_solver_trace: {
        completed_solver_path: true,
        requested_capability: HELIX_GOLDEN_PATH_WORKSPACE_OS_STATUS_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_WORKSPACE_OS_STATUS_CAPABILITY,
        executed_capability: HELIX_GOLDEN_PATH_WORKSPACE_OS_STATUS_CAPABILITY,
        observed_artifact_kind: "workspace_os_status_observation",
        terminal_artifact_kind: "workspace_status_answer",
      },
    });
    expect(body.selected_final_answer).toContain("Workspace OS status completed");
    expect(body.selected_final_answer).toContain("34 total, 18 available, 1 degraded");
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual([
      "golden_path_route_gate",
      "workspace_os_status_observation",
      "workspace_status_answer",
    ]);
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("handles scientific calculator solves as receipt-backed workstation evaluations", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:25:00.000Z"),
      body: {
        turn_id: "ask:golden:calculator",
        prompt:
          "helix_ask_golden_path_runtime call scientific-calculator.solve_expression with this exact expression: ((sqrt(81)+ln(e^3))*7-5^2)/2",
        goldenPathRuntime: true,
        requested_capability: HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle calculator solve");
    const body = decision.payload;

    expect(body).toMatchObject({
      final_status: "final_answer",
      terminal_artifact_kind: "workstation_tool_evaluation",
      final_answer_source: "workstation_tool_evaluation",
      terminal_error_code: null,
      calculator_receipt: {
        capability_key: HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
        expression: "((sqrt(81)+ln(e^3))*7-5^2)/2",
        result: 29.5,
      },
      workstation_tool_evaluation: {
        capability_key: HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
        expression: "((sqrt(81)+ln(e^3))*7-5^2)/2",
        result: 29.5,
      },
      capability_plan: {
        requested_capability: HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
        executed_capability: HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
        required_observation_kinds: ["calculator_receipt", "workstation_tool_evaluation"],
        required_terminal_kind: "workstation_tool_evaluation",
      },
      ask_turn_solver_trace: {
        completed_solver_path: true,
        requested_capability: HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
        executed_capability: HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
        observed_artifact_kind: "calculator_receipt",
        terminal_artifact_kind: "workstation_tool_evaluation",
      },
    });
    expect(body.selected_final_answer).toContain("Result: 29.5");
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual([
      "golden_path_route_gate",
      "calculator_receipt",
      "workstation_tool_evaluation",
    ]);
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("bounds calculator expression extraction before trailing answer instructions", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:25:30.000Z"),
      body: {
        turn_id: "ask:golden:calculator-trailing-instructions",
        prompt:
          "Codex UI validation smoke 2026-06-29 20:09: use the Helix workstation gateway capability scientific-calculator.solve_expression with expression 8*9. Answer with the observed expression and result.",
        goldenPathRuntime: true,
        requested_capability: HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle calculator solve");
    const body = decision.payload;

    expect(body).toMatchObject({
      final_status: "final_answer",
      terminal_artifact_kind: "workstation_tool_evaluation",
      terminal_error_code: null,
      calculator_receipt: {
        capability_key: HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
        expression: "8*9",
        result: 72,
      },
      workstation_tool_evaluation: {
        capability_key: HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
        expression: "8*9",
        result: 72,
      },
    });
    expect(body.selected_final_answer).toContain("Expression: 8*9");
    expect(body.selected_final_answer).toContain("Result: 72");
    expect(body.selected_final_answer).not.toContain("Answer with the observed expression");
  });

  it("fails closed when calculator solve has no expression", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:26:00.000Z"),
      body: {
        turn_id: "ask:golden:calculator-missing",
        prompt: "helix_ask_golden_path_runtime scientific-calculator.solve_expression",
        goldenPathRuntime: true,
        requested_capability: HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle missing calculator args");
    const body = decision.payload;

    expect(body).toMatchObject({
      final_status: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "missing_calculator_expression",
      goal_satisfaction_evaluation: {
        satisfaction: "not_satisfied",
        first_broken_rail: "argument_extraction",
      },
      capability_plan: {
        requested_capability: HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
        executed_capability: null,
        required_observation_kinds: ["calculator_receipt", "workstation_tool_evaluation"],
        required_terminal_kind: "workstation_tool_evaluation",
      },
      ask_turn_solver_trace: {
        completed_solver_path: false,
        requested_capability: HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
        executed_capability: null,
        first_broken_rail: "argument_extraction",
      },
    });
    expect(body.selected_final_answer).toContain("no calculator expression");
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual(["golden_path_route_gate", "typed_failure"]);
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("does not treat conditional solve_expression prose as a calculator expression", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:26:30.000Z"),
      body: {
        turn_id: "ask:golden:calculator-conditional-prose",
        prompt:
          "Run scientific-calculator.solve_expression only if a typed bound_calculator_expression can be created. If numeric values are missing, fail closed with missing variables and the rejected expression instead of solving.",
        goldenPathRuntime: true,
        requested_capability: HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle missing conditional calculator args");
    expect(decision.payload).toMatchObject({
      final_status: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      terminal_error_code: "missing_calculator_expression",
      goal_satisfaction_evaluation: {
        satisfaction: "not_satisfied",
        first_broken_rail: "argument_extraction",
      },
    });
    expect(decision.payload.selected_final_answer).toContain("no calculator expression");
    expect(decision.payload.selected_final_answer).not.toContain("only if a typed bound_calculator_expression");
  });

  it("handles docs locate prompts as line-backed document evidence", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:27:00.000Z"),
      body: {
        turn_id: "ask:golden:docs-locate",
        prompt:
          "helix_ask_golden_path_runtime use docs-viewer.locate_in_doc for Casimir tile newtons load bearing",
        goldenPathRuntime: true,
        requested_capability: HELIX_GOLDEN_PATH_DOCS_LOCATE_CAPABILITY,
        doc_path: "docs/research/nhm2-current-status-whitepaper.md",
        doc_content: [
          "# NHM2 Current Status",
          "The Casimir tile generation table reports force output in newtons for each tile.",
          "A later section discusses unrelated instrumentation.",
        ].join("\n"),
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle docs locate");
    const body = decision.payload;

    expect(body).toMatchObject({
      final_status: "final_answer",
      terminal_artifact_kind: "doc_location_matches",
      final_answer_source: "doc_location_matches",
      terminal_error_code: null,
      doc_location_matches: {
        capability_key: HELIX_GOLDEN_PATH_DOCS_LOCATE_CAPABILITY,
        doc_path: "docs/research/nhm2-current-status-whitepaper.md",
        match_count: 1,
      },
      capability_plan: {
        requested_capability: HELIX_GOLDEN_PATH_DOCS_LOCATE_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_DOCS_LOCATE_CAPABILITY,
        executed_capability: HELIX_GOLDEN_PATH_DOCS_LOCATE_CAPABILITY,
        required_observation_kinds: ["doc_location_matches"],
        required_terminal_kind: "doc_location_matches",
      },
      ask_turn_solver_trace: {
        completed_solver_path: true,
        requested_capability: HELIX_GOLDEN_PATH_DOCS_LOCATE_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_DOCS_LOCATE_CAPABILITY,
        executed_capability: HELIX_GOLDEN_PATH_DOCS_LOCATE_CAPABILITY,
        observed_artifact_kind: "doc_location_matches",
        terminal_artifact_kind: "doc_location_matches",
      },
    });
    expect(body.selected_final_answer).toContain("Line 2");
    expect(body.selected_final_answer).toContain("force output in newtons");
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual([
      "golden_path_route_gate",
      "doc_location_matches",
    ]);
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("fails closed when docs locate has no readable document content", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:28:00.000Z"),
      body: {
        turn_id: "ask:golden:docs-locate-missing-content",
        prompt: "helix_ask_golden_path_runtime docs-viewer.locate_in_doc query: Casimir tile newtons",
        goldenPathRuntime: true,
        requested_capability: HELIX_GOLDEN_PATH_DOCS_LOCATE_CAPABILITY,
        doc_path: "docs/research/missing-fixture.md",
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle missing docs content");
    const body = decision.payload;

    expect(body).toMatchObject({
      final_status: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "missing_doc_content",
      goal_satisfaction_evaluation: {
        satisfaction: "not_satisfied",
        first_broken_rail: "observation",
      },
      capability_plan: {
        requested_capability: HELIX_GOLDEN_PATH_DOCS_LOCATE_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_DOCS_LOCATE_CAPABILITY,
        executed_capability: null,
        required_observation_kinds: ["doc_location_matches"],
        required_terminal_kind: "doc_location_matches",
      },
      ask_turn_solver_trace: {
        completed_solver_path: false,
        requested_capability: HELIX_GOLDEN_PATH_DOCS_LOCATE_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_DOCS_LOCATE_CAPABILITY,
        executed_capability: null,
        first_broken_rail: "observation",
      },
    });
    expect(body.selected_final_answer).toContain("no readable document content");
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual(["golden_path_route_gate", "typed_failure"]);
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("handles repo concept search as evidence-backed repo answers", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:32:00.000Z"),
      body: {
        turn_id: "ask:golden:repo-search",
        prompt: "helix_ask_golden_path_runtime use repo-code.search_concept for terminal authority",
        goldenPathRuntime: true,
        requested_capability: HELIX_GOLDEN_PATH_REPO_SEARCH_CONCEPT_CAPABILITY,
        concept: "terminal authority",
        repo_files: [
          {
            path: "server/services/helix-ask/runtime-authority-contract.ts",
            content: [
              "export const terminalAuthorityContract = true;",
              "terminal authority selects the final answer only after runtime evidence exists.",
            ].join("\n"),
          },
          {
            path: "docs/helix-ask-turn-solver-spine.md",
            content: "The completed solver path gates terminal authority and visible projection.",
          },
        ],
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle repo concept search");
    const body = decision.payload;

    expect(body).toMatchObject({
      final_status: "final_answer",
      terminal_artifact_kind: "repo_code_evidence_answer",
      final_answer_source: "repo_code_evidence_answer",
      terminal_error_code: null,
      repo_code_evidence_observation: {
        capability_key: HELIX_GOLDEN_PATH_REPO_SEARCH_CONCEPT_CAPABILITY,
        concept: "terminal authority",
        match_count: 3,
      },
      repo_evidence_relevance_gate: {
        terminal_allowed: true,
        repair_required: false,
      },
      capability_plan: {
        requested_capability: HELIX_GOLDEN_PATH_REPO_SEARCH_CONCEPT_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_REPO_SEARCH_CONCEPT_CAPABILITY,
        executed_capability: HELIX_GOLDEN_PATH_REPO_SEARCH_CONCEPT_CAPABILITY,
        required_observation_kinds: ["repo_code_evidence_observation", "repo_evidence_relevance_gate"],
        required_terminal_kind: "repo_code_evidence_answer",
      },
      ask_turn_solver_trace: {
        completed_solver_path: true,
        requested_capability: HELIX_GOLDEN_PATH_REPO_SEARCH_CONCEPT_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_REPO_SEARCH_CONCEPT_CAPABILITY,
        executed_capability: HELIX_GOLDEN_PATH_REPO_SEARCH_CONCEPT_CAPABILITY,
        observed_artifact_kind: "repo_code_evidence_observation",
        terminal_artifact_kind: "repo_code_evidence_answer",
      },
    });
    expect(body.selected_final_answer).toContain("runtime-authority-contract.ts:2");
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual([
      "golden_path_route_gate",
      "repo_code_evidence_observation",
      "repo_evidence_relevance_gate",
      "repo_code_evidence_answer",
    ]);
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("honors structured repo query and path scope before prompt lexical cues", () => {
    const decision = runHelixAskGoldenPathRuntime({
      env: {},
      now: new Date("2026-06-28T12:32:30.000Z"),
      body: {
        turn_id: "ask:golden:structured-repo-search",
        question: "Where is workspace_os.status implemented?",
        source_target_intent: {
          schema: "helix.ask_source_target_intent.v1",
          target_source: "repo_code",
          selected_capability: HELIX_GOLDEN_PATH_REPO_SEARCH_CONCEPT_CAPABILITY,
          args: {
            query: "workspace_os.status",
            paths: ["server/services/helix-ask"],
          },
        },
        repo_files: [
          {
            path: "server/services/helix-ask/workspace-os-status-intent.ts",
            content: "export const HELIX_WORKSPACE_OS_STATUS_CAPABILITY = 'workspace_os.status';",
          },
          {
            path: ".tmp-unrelated.json",
            content: "workspace_os.status",
          },
        ],
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("structured repo admission should select the repo golden path");
    expect(decision.payload).toMatchObject({
      terminal_artifact_kind: "repo_code_evidence_answer",
      final_answer_source: "repo_code_evidence_answer",
      repo_code_evidence_observation: {
        concept: "workspace_os.status",
        match_count: 1,
        evidence: [
          expect.objectContaining({
            file_path: "server/services/helix-ask/workspace-os-status-intent.ts",
          }),
        ],
      },
    });
  });

  it("fails closed when repo concept search has no evidence", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:33:00.000Z"),
      body: {
        turn_id: "ask:golden:repo-search-missing",
        prompt: "helix_ask_golden_path_runtime repo-code.search_concept",
        goldenPathRuntime: true,
        requested_capability: HELIX_GOLDEN_PATH_REPO_SEARCH_CONCEPT_CAPABILITY,
        concept: "nonexistent capability phrase",
        repo_files: [{ path: "server/example.ts", content: "export const other = true;" }],
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle weak repo evidence");
    const body = decision.payload;

    expect(body).toMatchObject({
      final_status: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "repo_evidence_weak_after_repair",
      goal_satisfaction_evaluation: {
        satisfaction: "not_satisfied",
        first_broken_rail: "evidence_reentry",
      },
      capability_plan: {
        requested_capability: HELIX_GOLDEN_PATH_REPO_SEARCH_CONCEPT_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_REPO_SEARCH_CONCEPT_CAPABILITY,
        executed_capability: null,
        required_observation_kinds: ["repo_code_evidence_observation", "repo_evidence_relevance_gate"],
        required_terminal_kind: "repo_code_evidence_answer",
      },
      ask_turn_solver_trace: {
        completed_solver_path: false,
        requested_capability: HELIX_GOLDEN_PATH_REPO_SEARCH_CONCEPT_CAPABILITY,
        selected_capability: HELIX_GOLDEN_PATH_REPO_SEARCH_CONCEPT_CAPABILITY,
        executed_capability: null,
        first_broken_rail: "evidence_reentry",
      },
    });
    expect(body.selected_final_answer).toContain("could not find strong repo evidence");
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual(["golden_path_route_gate", "typed_failure"]);
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("handles workspace directory resolution as a terminal golden-path observation", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:40:00.000Z"),
      body: {
        turn_id: "ask:golden:workspace-directory",
        prompt:
          "helix_ask_golden_path_runtime run workspace-directory.resolve for docs/helix-ask-codex-loop-discipline.md",
        goldenPathRuntime: true,
        requested_capability: HELIX_WORKSPACE_DIRECTORY_RESOLVE_CAPABILITY,
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle workspace directory resolution");
    const body = decision.payload;

    expect(body).toMatchObject({
      final_status: "final_answer",
      terminal_artifact_kind: "workspace_directory_resolution",
      final_answer_source: "workspace_directory_resolution",
      terminal_error_code: null,
      capability_plan: {
        requested_capability: HELIX_WORKSPACE_DIRECTORY_RESOLVE_CAPABILITY,
        selected_capability: HELIX_WORKSPACE_DIRECTORY_RESOLVE_CAPABILITY,
        executed_capability: HELIX_WORKSPACE_DIRECTORY_RESOLVE_CAPABILITY,
        required_observation_kinds: ["workspace_directory_resolution"],
        required_terminal_kind: "workspace_directory_resolution",
      },
      ask_turn_solver_trace: {
        completed_solver_path: true,
        requested_capability: HELIX_WORKSPACE_DIRECTORY_RESOLVE_CAPABILITY,
        selected_capability: HELIX_WORKSPACE_DIRECTORY_RESOLVE_CAPABILITY,
        executed_capability: HELIX_WORKSPACE_DIRECTORY_RESOLVE_CAPABILITY,
        observed_artifact_kind: "workspace_directory_resolution",
        terminal_artifact_kind: "workspace_directory_resolution",
      },
      workspace_directory_resolution: {
        query: "docs/helix-ask-codex-loop-discipline.md",
      },
    });
    expect(["resolved", "ambiguous"]).toContain((body.workspace_directory_resolution as any)?.status);
    expect((body.workspace_directory_resolution as any)?.candidates?.length ?? 0).toBeGreaterThan(0);
    expect(body.selected_final_answer).toContain("Workspace directory resolution for");
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual([
      "golden_path_route_gate",
      "workspace_directory_resolution",
    ]);
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("fails closed when workspace directory resolution has no query", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:41:00.000Z"),
      body: {
        turn_id: "ask:golden:workspace-directory-missing",
        prompt: "helix_ask_golden_path_runtime workspace-directory.resolve",
        goldenPathRuntime: true,
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle missing workspace directory args");
    const body = decision.payload;

    expect(body).toMatchObject({
      final_status: "typed_failure",
      terminal_artifact_kind: "typed_failure",
      final_answer_source: "typed_failure",
      terminal_error_code: "missing_workspace_directory_query",
      goal_satisfaction_evaluation: {
        satisfaction: "not_satisfied",
        first_broken_rail: "argument_extraction",
      },
      ask_turn_solver_trace: {
        completed_solver_path: false,
        requested_capability: HELIX_WORKSPACE_DIRECTORY_RESOLVE_CAPABILITY,
        selected_capability: HELIX_WORKSPACE_DIRECTORY_RESOLVE_CAPABILITY,
        executed_capability: null,
        first_broken_rail: "argument_extraction",
      },
    });
    expect(body.selected_final_answer).toContain("without a path, URI, or query");
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual(["golden_path_route_gate", "typed_failure"]);
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("handles docs locate plus calculator as an ordered compound contract", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:43:00.000Z"),
      body: {
        turn_id: "ask:golden:docs-calculator-compound",
        prompt:
          "helix_ask_golden_path_runtime use docs-viewer.locate_in_doc and scientific-calculator.solve_expression",
        goldenPathRuntime: true,
        requested_capabilities: [
          HELIX_GOLDEN_PATH_DOCS_LOCATE_CAPABILITY,
          HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
        ],
        doc_path: "docs/research/nhm2-current-status-whitepaper.md",
        query: "Casimir tile newtons load bearing",
        doc_content: [
          "# NHM2 Current Status",
          "The Casimir tile generation table reports a load bearing force of 10 newtons per tile.",
          "The conversion note says pounds-force are derived from the newton scalar cut.",
        ].join("\n"),
        calculator_expression: "10 * 0.224809",
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle docs+calculator compound");
    const body = decision.payload;

    expect(body).toMatchObject({
      final_status: "final_answer",
      terminal_artifact_kind: "compound_evidence_synthesis_answer",
      final_answer_source: "compound_evidence_synthesis_answer",
      terminal_error_code: null,
      doc_location_matches: {
        capability_key: HELIX_GOLDEN_PATH_DOCS_LOCATE_CAPABILITY,
        doc_path: "docs/research/nhm2-current-status-whitepaper.md",
        query: "Casimir tile newtons load bearing",
        match_count: 1,
      },
      calculator_receipt: {
        capability_key: HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
        expression: "10 * 0.224809",
        result: 2.24809,
        result_text: "2.24809",
        assistant_answer: false,
        raw_content_included: false,
      },
      workstation_actions: [
        {
          kind: "open_doc_at_line",
          doc_path: "docs/research/nhm2-current-status-whitepaper.md",
          line: 2,
          observation_ref: "ask:golden:docs-calculator-compound:doc_location_matches",
        },
        {
          kind: "fill_calculator_expression",
          expression_text: "10 * 0.224809",
          result: 2.24809,
          result_text: "2.24809",
          unit: null,
          observation_ref: "ask:golden:docs-calculator-compound:calculator_receipt",
        },
      ],
      compound_evidence_synthesis_answer: {
        workstation_actions: [
          {
            kind: "open_doc_at_line",
            observation_ref: "ask:golden:docs-calculator-compound:doc_location_matches",
          },
          {
            kind: "fill_calculator_expression",
            observation_ref: "ask:golden:docs-calculator-compound:calculator_receipt",
          },
        ],
      },
      compound_capability_contract: {
        satisfaction: "satisfied",
        ordered_subgoals: [
          {
            requested_capability: HELIX_GOLDEN_PATH_DOCS_LOCATE_CAPABILITY,
            selected_capability: HELIX_GOLDEN_PATH_DOCS_LOCATE_CAPABILITY,
            executed_capability: HELIX_GOLDEN_PATH_DOCS_LOCATE_CAPABILITY,
            observation_kind: "doc_location_matches",
            terminal_contribution_kind: "doc_location_matches",
            satisfaction: "satisfied",
          },
          {
            requested_capability: HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
            selected_capability: HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
            executed_capability: HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
            observation_kind: "calculator_receipt",
            terminal_contribution_kind: "workstation_tool_evaluation",
            satisfaction: "satisfied",
          },
        ],
      },
      capability_plan: {
        requested_capability: "compound_capability_contract",
        selected_capability: "compound_capability_contract",
        executed_capability: "compound_capability_contract",
        required_observation_kinds: ["doc_location_matches", "calculator_receipt"],
        required_terminal_kind: "compound_evidence_synthesis_answer",
      },
      ask_turn_solver_trace: {
        completed_solver_path: true,
        requested_capability: "compound_capability_contract",
        selected_capability: "compound_capability_contract",
        executed_capability: "compound_capability_contract",
        observed_artifact_kind: "compound_subgoal_observations",
        terminal_artifact_kind: "compound_evidence_synthesis_answer",
        compound_subgoal_count: 2,
      },
    });
    expect(body.selected_final_answer).toContain("Compound docs/calculator synthesis completed");
    expect(body.selected_final_answer).toContain("Calculator result: 2.24809");
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual([
      "golden_path_route_gate",
      "doc_location_matches",
      "calculator_receipt",
      "compound_evidence_synthesis_answer",
    ]);
    expect(readLedger(body).at(-1)).toMatchObject({
      kind: "compound_evidence_synthesis_answer",
      payload: {
        workstation_actions: [
          {
            kind: "open_doc_at_line",
            observation_ref: "ask:golden:docs-calculator-compound:doc_location_matches",
          },
          {
            kind: "fill_calculator_expression",
            observation_ref: "ask:golden:docs-calculator-compound:calculator_receipt",
          },
        ],
      },
    });
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("handles broad docs calculator reflection and scholarly prompts through the generic itinerary", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:44:00.000Z"),
      body: {
        turn_id: "ask:golden:broad-itinerary",
        prompt:
          "helix_ask_golden_path_runtime use docs-viewer.locate_in_doc, scientific-calculator.solve_expression, theory badge graph reflection, civilization bounds, and scholarly research papers to explain the diagnostic claim boundary. Calculate 6*7.",
        goldenPathRuntime: true,
        requested_capabilities: [
          HELIX_GOLDEN_PATH_DOCS_LOCATE_CAPABILITY,
          HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
          HELIX_GOLDEN_PATH_THEORY_REFLECTION_CAPABILITY,
          HELIX_GOLDEN_PATH_CIVILIZATION_BOUNDS_REFLECTION_CAPABILITY,
          HELIX_GOLDEN_PATH_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
        ],
        doc_path: "docs/research/nhm2-current-status-whitepaper.md",
        doc_content: [
          "# NHM2 Current Status",
          "The Casimir tile generation table reports internal normal attraction and stack force values for diagnostic comparison.",
          "These figures are diagnostic proxies and do not establish propulsion, transport, or implementation readiness.",
        ].join("\n"),
        calculator_expression: "6*7",
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle broad itinerary compound");
    const body = decision.payload;

    expect(body).toMatchObject({
      terminal_artifact_kind: "compound_evidence_synthesis_answer",
      final_answer_source: "compound_evidence_synthesis_answer",
      terminal_error_code: null,
      calculator_receipt: {
        expression: "6*7",
        result: 42,
      },
      scholarly_research_observation: {
        missing_requirements: ["provider_backed_scholarly_results"],
        relevance_summary: expect.stringContaining("No provider-backed scholarly results"),
      },
      capability_plan: {
        required_terminal_kind: "compound_evidence_synthesis_answer",
        required_observation_kinds: [
          "doc_location_matches",
          "calculator_receipt",
          "helix_theory_context_reflection_tool_receipt",
          "helix_civilization_bounds_tool_result",
          "scholarly_research_observation",
        ],
      },
      ask_turn_solver_trace: {
        completed_solver_path: true,
        requested_capability: "compound_capability_contract",
        selected_capability: "compound_capability_contract",
        executed_capability: "compound_capability_contract",
        compound_subgoal_count: 5,
      },
    });
    expect(body.compound_capability_contract.ordered_subgoals).toEqual([
      expect.objectContaining({
        requested_capability: HELIX_GOLDEN_PATH_DOCS_LOCATE_CAPABILITY,
        observation_kind: "doc_location_matches",
        satisfaction: "satisfied",
      }),
      expect.objectContaining({
        requested_capability: HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
        observation_kind: "calculator_receipt",
        satisfaction: "satisfied",
      }),
      expect.objectContaining({
        requested_capability: HELIX_GOLDEN_PATH_THEORY_REFLECTION_CAPABILITY,
        observation_kind: "helix_theory_context_reflection_tool_receipt",
        satisfaction: "satisfied",
      }),
      expect.objectContaining({
        requested_capability: HELIX_GOLDEN_PATH_CIVILIZATION_BOUNDS_REFLECTION_CAPABILITY,
        observation_kind: "helix_civilization_bounds_tool_result",
        satisfaction: "satisfied",
      }),
      expect.objectContaining({
        requested_capability: HELIX_GOLDEN_PATH_SCHOLARLY_RESEARCH_LOOKUP_CAPABILITY,
        observation_kind: "scholarly_research_observation",
        satisfaction: "satisfied",
      }),
    ]);
    expect(body.selected_final_answer).toContain("Calculator result: 6*7 = 42");
    expect(body.selected_final_answer).toContain("Scholarly support: no provider-backed paper results");
    expect(body.selected_final_answer).toContain("They do not by themselves prove physical viability");
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual([
      "golden_path_route_gate",
      "doc_location_matches",
      "calculator_receipt",
      "helix_theory_context_reflection_tool_receipt",
      "helix_civilization_bounds_tool_result",
      "scholarly_research_observation",
      "compound_evidence_synthesis_answer",
    ]);
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("handles repo search plus docs locate as an ordered compound contract", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:44:00.000Z"),
      body: {
        turn_id: "ask:golden:repo-docs-compound",
        prompt:
          "helix_ask_golden_path_runtime use repo-code.search_concept and docs-viewer.locate_in_doc",
        goldenPathRuntime: true,
        requested_capabilities: [
          HELIX_GOLDEN_PATH_REPO_SEARCH_CONCEPT_CAPABILITY,
          HELIX_GOLDEN_PATH_DOCS_LOCATE_CAPABILITY,
        ],
        concept: "terminal authority",
        repo_files: [
          {
            path: "server/services/helix-ask/runtime-authority-contract.ts",
            content: [
              "export const terminalAuthorityContract = true;",
              "terminal authority selects the final answer only after runtime evidence exists.",
            ].join("\n"),
          },
          {
            path: "docs/helix-ask-turn-solver-spine.md",
            content: "The completed solver path gates terminal authority and visible projection.",
          },
        ],
        doc_path: "docs/helix-ask-turn-solver-spine.md",
        query: "completed solver path terminal authority",
        doc_content: [
          "# Helix Ask Turn Solver Spine",
          "The completed solver path gates terminal authority and visible projection.",
          "Receipts remain observations until terminal authority selects a supported product.",
        ].join("\n"),
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle repo+docs compound");
    const body = decision.payload;

    expect(body).toMatchObject({
      final_status: "final_answer",
      terminal_artifact_kind: "compound_evidence_synthesis_answer",
      final_answer_source: "compound_evidence_synthesis_answer",
      terminal_error_code: null,
      repo_code_evidence_observation: {
        capability_key: HELIX_GOLDEN_PATH_REPO_SEARCH_CONCEPT_CAPABILITY,
        concept: "terminal authority",
        match_count: 3,
      },
      repo_evidence_relevance_gate: {
        terminal_allowed: true,
        repair_required: false,
      },
      doc_location_matches: {
        capability_key: HELIX_GOLDEN_PATH_DOCS_LOCATE_CAPABILITY,
        doc_path: "docs/helix-ask-turn-solver-spine.md",
        query: "completed solver path terminal authority",
        match_count: 2,
      },
      compound_capability_contract: {
        satisfaction: "satisfied",
        ordered_subgoals: [
          {
            requested_capability: HELIX_GOLDEN_PATH_REPO_SEARCH_CONCEPT_CAPABILITY,
            selected_capability: HELIX_GOLDEN_PATH_REPO_SEARCH_CONCEPT_CAPABILITY,
            executed_capability: HELIX_GOLDEN_PATH_REPO_SEARCH_CONCEPT_CAPABILITY,
            observation_kind: "repo_code_evidence_observation",
            terminal_contribution_kind: "repo_code_evidence_answer",
            satisfaction: "satisfied",
          },
          {
            requested_capability: HELIX_GOLDEN_PATH_DOCS_LOCATE_CAPABILITY,
            selected_capability: HELIX_GOLDEN_PATH_DOCS_LOCATE_CAPABILITY,
            executed_capability: HELIX_GOLDEN_PATH_DOCS_LOCATE_CAPABILITY,
            observation_kind: "doc_location_matches",
            terminal_contribution_kind: "doc_location_matches",
            satisfaction: "satisfied",
          },
        ],
      },
      capability_plan: {
        requested_capability: "compound_capability_contract",
        selected_capability: "compound_capability_contract",
        executed_capability: "compound_capability_contract",
        required_observation_kinds: [
          "repo_code_evidence_observation",
          "repo_evidence_relevance_gate",
          "doc_location_matches",
        ],
        required_terminal_kind: "compound_evidence_synthesis_answer",
      },
      ask_turn_solver_trace: {
        completed_solver_path: true,
        requested_capability: "compound_capability_contract",
        selected_capability: "compound_capability_contract",
        executed_capability: "compound_capability_contract",
        observed_artifact_kind: "compound_subgoal_observations",
        terminal_artifact_kind: "compound_evidence_synthesis_answer",
        compound_subgoal_count: 2,
      },
    });
    expect(body.selected_final_answer).toContain("Compound repo/docs synthesis completed");
    expect(body.selected_final_answer).toContain("docs/helix-ask-turn-solver-spine.md:1");
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual([
      "golden_path_route_gate",
      "repo_code_evidence_observation",
      "repo_evidence_relevance_gate",
      "doc_location_matches",
      "compound_evidence_synthesis_answer",
    ]);
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("handles civilization bounds plus moral graph reflection as an ordered compound contract", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:34:30.000Z"),
      body: {
        turn_id: "ask:golden:civilization-moral-compound",
        prompt:
          "helix_ask_golden_path_runtime use helix_ask.reflect_civilization_bounds and helix_ask.reflect_ideology_context",
        goldenPathRuntime: true,
        requested_capabilities: [
          HELIX_GOLDEN_PATH_CIVILIZATION_BOUNDS_REFLECTION_CAPABILITY,
          HELIX_GOLDEN_PATH_MORAL_GRAPH_REFLECTION_CAPABILITY,
        ],
        civilization_bounds_tool_result: {
          roadmap: {
            roadmapId: "civilization-bounds:compound",
            title: "Civilization Bounds Roadmap",
            systems: [{ systemId: "energy", label: "Energy system" }],
            badges: [{ badgeId: "badge:governance", label: "Governance review" }],
            collaborationBounds: [{ boundId: "bound:two-key", limitingFactor: "two_key_review" }],
            missingEvidence: ["source_backed_capacity_measurements"],
            authority: {
              assistant_answer: false,
              terminal_eligible: false,
              agent_executable: false,
              prediction_finality: false,
              policy_finality: false,
              moral_finality: false,
              execution_permission: false,
            },
          },
          bridgeContext: {
            systemIds: ["energy"],
            missingEvidence: ["source_backed_capacity_measurements"],
          },
        },
        helix_moral_graph_reflection_tool_result: {
          reflection: {
            artifactId: "ideology_context_reflection",
            reflectionId: "ideology-context-reflection:compound",
            schemaVersion: "ideology_context_reflection/v1",
            input: {
              kind: "user_prompt",
              summary: "Relate civilization bounds to right speech and two-key review.",
              refs: ["turn:civilization-moral", "doc:ethos"],
            },
            activated_traits: [{ nodeId: "two-key-review", label: "Two-key review" }],
            tensions: [{ id: "capacity-claim-boundary", severity: "medium" }],
            recommended_actions: [{ id: "ask-for-capacity-evidence", type: "diagnostic", label: "Ask for capacity evidence" }],
            authority: {
              assistant_answer: false,
              raw_content_included: false,
              terminal_eligible: false,
              context_role: "tool_policy",
              ask_context_policy: "evidence_only",
              agent_executable: false,
            },
          },
          proceduralClassification: {
            classifications: [{ observedPattern: "practice_commitment", proceduralMove: "ask_for_concrete_evidence" }],
          },
          locator: {
            matches: [{ nodeId: "two-key-review", path: ["review", "bounds"] }],
          },
          admissions: [{ id: "admission:bounds-diagnostic", actions: [] }],
        },
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle civilization+moral compound");
    const body = decision.payload;

    expect(body).toMatchObject({
      final_status: "final_answer",
      terminal_artifact_kind: "compound_evidence_synthesis_answer",
      final_answer_source: "compound_evidence_synthesis_answer",
      terminal_error_code: null,
      helix_civilization_bounds_tool_result: {
        kind: "helix_civilization_bounds_tool_result",
        tool_id: HELIX_GOLDEN_PATH_CIVILIZATION_BOUNDS_REFLECTION_CAPABILITY,
        procedural_receipt: {
          schema: "helix.reflection_procedural_receipt.v1",
          selected_nodes: expect.arrayContaining([
            expect.objectContaining({ id: "civilization-bounds:compound" }),
          ]),
          support_refs: expect.arrayContaining(["civilization-bounds:compound"]),
          constraints_introduced: expect.arrayContaining([
            "Treat the possibility as a bounded hypothesis, not as feasibility proof.",
          ]),
          missing_evidence: expect.arrayContaining(["source_backed_capacity_measurements"]),
          assistant_answer: false,
          terminal_eligible: false,
        },
        answer_guidance: {
          schema: "helix.reflection_answer_guidance.v1",
          practical_framing: expect.stringContaining("civilization bounds"),
          allowed_claims: expect.arrayContaining([
            "The idea can be explored as a bounded scenario.",
          ]),
          blocked_claims: expect.arrayContaining(["Do not claim feasibility."]),
          assistant_answer: false,
          terminal_eligible: false,
        },
        terminal_eligible: false,
      },
      helix_moral_graph_reflection_tool_result: {
        kind: "helix_moral_graph_reflection_tool_result",
        tool_id: HELIX_GOLDEN_PATH_MORAL_GRAPH_REFLECTION_CAPABILITY,
        procedural_receipt: {
          schema: "helix.reflection_procedural_receipt.v1",
          selected_nodes: expect.arrayContaining([
            expect.objectContaining({ id: "ideology-context-reflection:compound" }),
          ]),
          support_refs: expect.arrayContaining(["ideology-context-reflection:compound", "turn:civilization-moral"]),
          constraints_introduced: expect.arrayContaining([
            "Treat activated lenses and tensions as answer-shaping constraints, not terminal moral authority.",
          ]),
          assistant_answer: false,
          terminal_eligible: false,
        },
        answer_guidance: {
          schema: "helix.reflection_answer_guidance.v1",
          practical_framing: expect.stringContaining("review-gated"),
          blocked_claims: expect.arrayContaining(["Do not claim moral finality."]),
          reasoning_moves: expect.arrayContaining([
            "Keep the civilization-bounds evidence as the feasibility boundary.",
          ]),
          assistant_answer: false,
          terminal_eligible: false,
        },
        terminal_eligible: false,
      },
      compound_capability_contract: {
        satisfaction: "satisfied",
        ordered_subgoals: [
          {
            requested_capability: HELIX_GOLDEN_PATH_CIVILIZATION_BOUNDS_REFLECTION_CAPABILITY,
            selected_capability: HELIX_GOLDEN_PATH_CIVILIZATION_BOUNDS_REFLECTION_CAPABILITY,
            executed_capability: HELIX_GOLDEN_PATH_CIVILIZATION_BOUNDS_REFLECTION_CAPABILITY,
            observation_kind: "helix_civilization_bounds_tool_result",
            terminal_contribution_kind: "civilization_bounds_reflection_answer",
            satisfaction: "satisfied",
          },
          {
            requested_capability: HELIX_GOLDEN_PATH_MORAL_GRAPH_REFLECTION_CAPABILITY,
            selected_capability: HELIX_GOLDEN_PATH_MORAL_GRAPH_REFLECTION_CAPABILITY,
            executed_capability: HELIX_GOLDEN_PATH_MORAL_GRAPH_REFLECTION_CAPABILITY,
            observation_kind: "helix_moral_graph_reflection_tool_result",
            terminal_contribution_kind: "ideology_context_reflection_answer",
            satisfaction: "satisfied",
          },
        ],
      },
      capability_plan: {
        requested_capability: "compound_capability_contract",
        selected_capability: "compound_capability_contract",
        executed_capability: "compound_capability_contract",
        required_observation_kinds: [
          "helix_civilization_bounds_tool_result",
          "helix_moral_graph_reflection_tool_result",
        ],
        required_terminal_kind: "compound_evidence_synthesis_answer",
      },
      ask_turn_solver_trace: {
        completed_solver_path: true,
        requested_capability: "compound_capability_contract",
        selected_capability: "compound_capability_contract",
        executed_capability: "compound_capability_contract",
        observed_artifact_kind: "compound_subgoal_observations",
        terminal_artifact_kind: "compound_evidence_synthesis_answer",
        compound_subgoal_count: 2,
      },
    });
    expect(body.selected_final_answer).toContain("bounded hypothesis");
    expect(body.selected_final_answer).toContain("capacity, material inventory, fairness, and explicit review gates");
    expect(body.selected_final_answer).toContain("not as moral finality or execution permission");
    expect(body.selected_final_answer).not.toContain("activated lenses");
    expect(body.selected_final_answer).not.toContain("Procedural classifications");
    expect(body.compound_evidence_synthesis_answer.text).toBe(body.selected_final_answer);
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual([
      "golden_path_route_gate",
      "helix_civilization_bounds_tool_result",
      "helix_moral_graph_reflection_tool_result",
      "compound_evidence_synthesis_answer",
    ]);
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("handles capability catalog plus workspace status as an ordered compound contract", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:35:00.000Z"),
      body: {
        turn_id: "ask:golden:catalog-workspace-compound",
        prompt:
          "helix_ask_golden_path_runtime use helix_ask.inspect_capability_catalog and workspace_os.status",
        goldenPathRuntime: true,
        requested_capabilities: [
          HELIX_GOLDEN_PATH_CAPABILITY_CATALOG_CAPABILITY,
          HELIX_GOLDEN_PATH_WORKSPACE_OS_STATUS_CAPABILITY,
        ],
        workspace_snapshot: {
          activeDocPath: "docs/research/nhm2-current-status-whitepaper.md",
        },
        workspace_os_status: {
          status: "available",
          counts: {
            total: 34,
            available: 18,
            degraded: 1,
            blocked: 3,
            error: 0,
            unknown: 12,
          },
        },
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle catalog+workspace compound");
    const body = decision.payload;

    expect(body).toMatchObject({
      final_status: "final_answer",
      terminal_artifact_kind: "compound_evidence_synthesis_answer",
      final_answer_source: "compound_evidence_synthesis_answer",
      terminal_error_code: null,
      capability_registry: {
        capability_key: HELIX_GOLDEN_PATH_CAPABILITY_CATALOG_CAPABILITY,
      },
      workspace_os_status_observation: {
        capability_key: HELIX_GOLDEN_PATH_WORKSPACE_OS_STATUS_CAPABILITY,
        capability_counts: {
          total: 34,
          available: 18,
          degraded: 1,
          blocked: 3,
          error: 0,
          unknown: 12,
        },
      },
      compound_capability_contract: {
        satisfaction: "satisfied",
        ordered_subgoals: [
          {
            requested_capability: HELIX_GOLDEN_PATH_CAPABILITY_CATALOG_CAPABILITY,
            selected_capability: HELIX_GOLDEN_PATH_CAPABILITY_CATALOG_CAPABILITY,
            executed_capability: HELIX_GOLDEN_PATH_CAPABILITY_CATALOG_CAPABILITY,
            observation_kind: "capability_registry",
            satisfaction: "satisfied",
          },
          {
            requested_capability: HELIX_GOLDEN_PATH_WORKSPACE_OS_STATUS_CAPABILITY,
            selected_capability: HELIX_GOLDEN_PATH_WORKSPACE_OS_STATUS_CAPABILITY,
            executed_capability: HELIX_GOLDEN_PATH_WORKSPACE_OS_STATUS_CAPABILITY,
            observation_kind: "workspace_os_status_observation",
            satisfaction: "satisfied",
          },
        ],
      },
      capability_plan: {
        requested_capability: "compound_capability_contract",
        selected_capability: "compound_capability_contract",
        executed_capability: "compound_capability_contract",
        required_observation_kinds: ["capability_registry", "workspace_os_status_observation"],
        required_terminal_kind: "compound_evidence_synthesis_answer",
      },
      ask_turn_solver_trace: {
        completed_solver_path: true,
        requested_capability: "compound_capability_contract",
        selected_capability: "compound_capability_contract",
        executed_capability: "compound_capability_contract",
        terminal_artifact_kind: "compound_evidence_synthesis_answer",
        compound_subgoal_count: 2,
      },
    });
    expect(body.selected_final_answer).toContain("Compound capability/workspace synthesis completed");
    expect(body.selected_final_answer).toContain("34 total, 18 available, 1 degraded");
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual([
      "golden_path_route_gate",
      "capability_registry",
      "workspace_os_status_observation",
      "compound_evidence_synthesis_answer",
    ]);
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("handles visual capture plus calculator as an ordered compound contract", () => {
    process.env[HELIX_ASK_GOLDEN_PATH_RUNTIME_FLAG] = "1";

    const decision = runHelixAskGoldenPathRuntime({
      now: new Date("2026-06-28T12:36:00.000Z"),
      body: {
        turn_id: "ask:golden:visual-calculator-compound",
        prompt:
          "helix_ask_golden_path_runtime use image_lens.inspect and scientific-calculator.solve_expression with expression: 6 * 7",
        goldenPathRuntime: true,
        requested_capabilities: [
          HELIX_GOLDEN_PATH_IMAGE_LENS_INSPECT_CAPABILITY,
          HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
        ],
        visual_summary: "The current screen shows Docs Viewer focused on the NHM2 whitepaper and a calculator panel.",
        detected_objects: ["Docs Viewer", "NHM2 whitepaper", "scientific calculator"],
        detected_scene_relations: ["Docs Viewer is the active panel", "calculator is available for numeric cuts"],
        calculator_expression: "6 * 7",
      },
    });

    expect(decision.handled).toBe(true);
    if (!decision.handled) throw new Error("golden path should handle visual+calculator compound");
    const body = decision.payload;

    expect(body).toMatchObject({
      final_status: "final_answer",
      terminal_artifact_kind: "compound_evidence_synthesis_answer",
      final_answer_source: "compound_evidence_synthesis_answer",
      terminal_error_code: null,
      visual_frame_evidence: {
        summary: "The current screen shows Docs Viewer focused on the NHM2 whitepaper and a calculator panel.",
      },
      calculator_receipt: {
        capability_key: HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
        expression: "6 * 7",
        result: 42,
        result_text: "42",
      },
      compound_capability_contract: {
        satisfaction: "satisfied",
        ordered_subgoals: [
          {
            requested_capability: HELIX_GOLDEN_PATH_IMAGE_LENS_INSPECT_CAPABILITY,
            selected_capability: HELIX_GOLDEN_PATH_VISUAL_CAPTURE_DESCRIBE_CAPABILITY,
            executed_capability: HELIX_GOLDEN_PATH_VISUAL_CAPTURE_DESCRIBE_CAPABILITY,
            observation_kind: "visual_frame_evidence",
            terminal_contribution_kind: "situation_context_pack",
            satisfaction: "satisfied",
          },
          {
            requested_capability: HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
            selected_capability: HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
            executed_capability: HELIX_GOLDEN_PATH_CALCULATOR_SOLVE_CAPABILITY,
            observation_kind: "calculator_receipt",
            terminal_contribution_kind: "workstation_tool_evaluation",
            satisfaction: "satisfied",
          },
        ],
      },
      capability_plan: {
        requested_capability: "compound_capability_contract",
        selected_capability: "compound_capability_contract",
        executed_capability: "compound_capability_contract",
        required_observation_kinds: ["visual_frame_evidence", "calculator_receipt"],
        required_terminal_kind: "compound_evidence_synthesis_answer",
      },
      ask_turn_solver_trace: {
        completed_solver_path: true,
        requested_capability: "compound_capability_contract",
        selected_capability: "compound_capability_contract",
        executed_capability: "compound_capability_contract",
        observed_artifact_kind: "compound_subgoal_observations",
        terminal_artifact_kind: "compound_evidence_synthesis_answer",
        compound_subgoal_count: 2,
      },
    });
    expect(body.selected_final_answer).toContain("Compound visual/calculator synthesis completed");
    expect(body.selected_final_answer).toContain("Calculator result: 42");
    expect(readLedger(body).map((artifact) => artifact.kind)).toEqual([
      "golden_path_route_gate",
      "visual_frame_evidence",
      "calculator_receipt",
      "compound_evidence_synthesis_answer",
    ]);
    expect(terminalLedgerEntries(body)).toHaveLength(1);
  });

  it("wires the route through a thin hook without importing the route from the service", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");
    const turnGateIndex = routeSource.indexOf("const goldenPathRuntimeDecision = runHelixAskGoldenPathRuntime({ body })");
    const turnCarryoverIndex = routeSource.indexOf("const carryoverPrompt = readHelixAskRuntimePrompt(body)");
    const streamGateIndex = routeSource.indexOf("const streamGoldenPathRuntimeDecision = runHelixAskGoldenPathRuntime");
    const streamCarryoverIndex = routeSource.indexOf("const streamCarryoverBody = req.body as Record<string, unknown>");

    expect(routeSource).toContain('from "../services/helix-ask/golden-path-runtime"');
    expect(turnGateIndex).toBeGreaterThan(0);
    expect(turnCarryoverIndex).toBeGreaterThan(turnGateIndex);
    expect(streamGateIndex).toBeGreaterThan(0);
    expect(streamCarryoverIndex).toBeGreaterThan(streamGateIndex);
    expect(routeSource).toContain("if (goldenPathRuntimeDecision.handled)");
    expect(routeSource).toContain("if (streamGoldenPathRuntimeDecision.handled)");
    expect(routeSource).toContain('source: "helix_ask_golden_path_runtime"');
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });
});
