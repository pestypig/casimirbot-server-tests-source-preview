import { describe, expect, it, vi } from "vitest";
import { normalizeHelixRuntimeSemanticRouteProposal } from "../../../runtime/runtime-intent-packet";
import { listWorkstationGatewayCapabilities } from "../../../workstation-tool-gateway/registry";
import {
  CODEX_NATIVE_API_KEY_PROVIDER_ID,
  CODEX_NATIVE_DISABLED_CONFIG,
  runCodexNativeAppServerTurnWithTransport,
  type CodexNativeRouteAdmission,
} from "../app-server-turn";
import { HELIX_CODEX_ROUTE_PROPOSAL_TOOL } from "../dynamic-tools";
import {
  buildCodexNativeAppServerArgs,
  CODEX_NATIVE_DISABLED_FEATURES,
} from "../process-transport";
import type {
  CodexAppServerJsonRpcMessage,
  CodexAppServerTransport,
} from "../protocol";

type SimulatorMode =
  | "normal"
  | "docs"
  | "compound"
  | "stall_initialize"
  | "tool_before_route"
  | "forbidden_item"
  | "provider_auth_failure"
  | "provider_quota_exhausted";

class FakeCodexAppServer implements CodexAppServerTransport {
  readonly stderr = "";
  readonly received: CodexAppServerJsonRpcMessage[] = [];
  private messageHandler: (message: CodexAppServerJsonRpcMessage) => void = () => undefined;
  private closeHandler: (error: Error | null) => void = () => undefined;
  private capabilityToolNames: string[] = [];
  private closed = false;

  constructor(private readonly mode: SimulatorMode) {}

  setMessageHandler(handler: (message: CodexAppServerJsonRpcMessage) => void): void {
    this.messageHandler = handler;
  }

  setCloseHandler(handler: (error: Error | null) => void): void {
    this.closeHandler = handler;
  }

  send(message: CodexAppServerJsonRpcMessage): void {
    this.received.push(message);
    if (message.method === "initialize") {
      if (this.mode === "stall_initialize") return;
      this.emit({ id: message.id, result: { userAgent: "fake-codex" } });
      return;
    }
    if (message.method === "thread/start") {
      const params = message.params as Record<string, unknown>;
      const tools = params.dynamicTools as Array<Record<string, unknown>>;
      this.capabilityToolNames = tools
        .filter((tool) => tool.name !== HELIX_CODEX_ROUTE_PROPOSAL_TOOL)
        .map((tool) => String(tool.name ?? ""));
      this.emit({
        id: message.id,
        result: {
          thread: { id: "thread:fake", ephemeral: true },
          model: params.model,
        },
      });
      this.emit({ method: "thread/started", params: { thread: { id: "thread:fake" } } });
      return;
    }
    if (message.method === "turn/start") {
      this.emit({
        id: message.id,
        result: { turn: { id: "turn:fake", status: "inProgress", items: [] } },
      });
      queueMicrotask(() => this.beginTurn());
      return;
    }
    if (message.id === 100 && message.result) {
      queueMicrotask(() => {
        if (this.mode === "compound") {
          this.emit({
            id: 101,
            method: "item/tool/call",
            params: {
              threadId: "thread:fake",
              turnId: "turn:fake",
              callId: "call:capability:2",
              tool: this.capabilityToolNames[1],
              arguments: { expression: "8*9" },
            },
          });
        } else {
          this.finish(this.mode === "docs"
            ? "The Docs observation was re-entered before this answer."
            : "The workstation status observation was re-entered in this turn.");
        }
      });
      return;
    }
    if (message.id === 101 && message.result) {
      queueMicrotask(() => {
        this.finish("The workstation status observation was re-entered in this turn.");
      });
    }
  }

  close(): void {
    this.closed = true;
  }

  private beginTurn(): void {
    if (this.mode === "provider_quota_exhausted") {
      this.emit({
        method: "error",
        params: {
          error: {
            message:
              "stream disconnected: You have no credits remaining. Add credits to continue using the API. Bearer sk-example-should-not-leak",
          },
          willRetry: false,
        },
      });
      this.emit({
        method: "turn/completed",
        params: {
          turn: {
            id: "turn:fake",
            status: "failed",
            error: { message: "You have no credits remaining." },
          },
        },
      });
      return;
    }
    if (this.mode === "provider_auth_failure") {
      this.emit({
        method: "error",
        params: {
          error: {
            message: "unexpected status 401 Unauthorized",
            codexErrorInfo: {
              responseStreamDisconnected: { httpStatusCode: 401 },
            },
          },
          willRetry: false,
        },
      });
      this.emit({
        method: "turn/completed",
        params: {
          turn: {
            id: "turn:fake",
            status: "failed",
            error: { message: "unexpected status 401 Unauthorized" },
          },
        },
      });
      return;
    }
    if (this.mode === "forbidden_item") {
      this.emit({
        method: "item/completed",
        params: {
          item: {
            id: "command:1",
            type: "commandExecution",
            status: "completed",
          },
        },
      });
      this.finish("This answer must be rejected because a built-in command appeared.");
      return;
    }
    this.emit({
      id: 100,
      method: "item/tool/call",
      params: {
        threadId: "thread:fake",
        turnId: "turn:fake",
        callId: "call:capability",
        tool: this.capabilityToolNames[0],
        arguments: this.mode === "docs"
          ? { query: "NHM2", paths: ["docs"] }
          : {},
      },
    });
  }

  private finish(text: string): void {
    this.emit({
      method: "item/completed",
      params: { item: { id: "answer:1", type: "agentMessage", text } },
    });
    this.emit({
      method: "turn/completed",
      params: { turn: { id: "turn:fake", status: "completed", items: [] } },
    });
  }

  private emit(message: CodexAppServerJsonRpcMessage): void {
    if (!this.closed) this.messageHandler(message);
  }
}

const workspaceStatusManifest = () => {
  const manifest = listWorkstationGatewayCapabilities({ mode: "read" }).capabilities.find(
    (capability) => capability.capability_id === "workspace_os.status",
  );
  if (!manifest) throw new Error("workspace_os.status manifest is required for this test");
  return manifest;
};

const calculatorManifest = () => {
  const manifest = listWorkstationGatewayCapabilities({ mode: "read" }).capabilities.find(
    (capability) => capability.capability_id === "scientific-calculator.solve_expression",
  );
  if (!manifest) throw new Error("scientific-calculator.solve_expression manifest is required for this test");
  return manifest;
};

const docsSearchManifest = () => {
  const manifest = listWorkstationGatewayCapabilities({ mode: "read" }).capabilities.find(
    (capability) => capability.capability_id === "docs.search",
  );
  if (!manifest) throw new Error("docs.search manifest is required for this test");
  return manifest;
};

const validateRoute = (value: unknown): CodexNativeRouteAdmission => {
  const proposal = normalizeHelixRuntimeSemanticRouteProposal({
    value,
    turnId: "ask:test:native",
    promptHash: "prompt:test",
    dependencies: {
      readString: (entry) =>
        typeof entry === "string" && entry.trim() ? entry.trim() : null,
      hashPayloadShort: () => "test-hash",
    },
  });
  return proposal?.proposed_capability_id === "workspace_os.status"
    ? {
        ok: true,
        proposal,
        admittedCapabilityIds: ["workspace_os.status"],
        reason: "route_capability_admitted",
      }
    : {
        ok: false,
        proposal,
        admittedCapabilityIds: [],
        reason: "invalid_route_proposal",
      };
};

const validateDocsRoute = (value: unknown): CodexNativeRouteAdmission => {
  const proposal = normalizeHelixRuntimeSemanticRouteProposal({
    value,
    turnId: "ask:test:native",
    promptHash: "prompt:test",
    dependencies: {
      readString: (entry) =>
        typeof entry === "string" && entry.trim() ? entry.trim() : null,
      hashPayloadShort: () => "test-hash",
    },
  });
  return proposal?.proposed_capability_id === "docs.search"
    ? {
        ok: true,
        proposal,
        admittedCapabilityIds: ["docs.search"],
        reason: "route_capability_admitted",
      }
    : {
        ok: false,
        proposal,
        admittedCapabilityIds: [],
        reason: "invalid_route_proposal",
      };
};

describe("Codex native app-server turn", () => {
  it("disables every non-Helix runtime tool family before app-server startup", () => {
    const args = buildCodexNativeAppServerArgs();
    expect(args).toContain("--strict-config");
    expect(args).toContain('web_search="disabled"');
    for (const feature of CODEX_NATIVE_DISABLED_FEATURES) {
      expect(args).toContain(feature);
      expect(
        (CODEX_NATIVE_DISABLED_CONFIG.features as Record<string, unknown>)[feature],
      ).toBe(false);
    }
    expect(CODEX_NATIVE_DISABLED_CONFIG).toMatchObject({
      model_provider: CODEX_NATIVE_API_KEY_PROVIDER_ID,
      model_providers: {
        [CODEX_NATIVE_API_KEY_PROVIDER_ID]: {
          env_key: "OPENAI_API_KEY",
          wire_api: "responses",
          requires_openai_auth: false,
          supports_websockets: false,
        },
      },
    });
  });

  it("reports provider authentication failures as typed native failures", async () => {
    const result = await runCodexNativeAppServerTurnWithTransport(
      {
        prompt: "Answer from the native provider.",
        turnId: "ask:test:native",
        cwd: process.cwd(),
        capabilities: [],
        validateRouteProposal: validateRoute,
        executeCapability: vi.fn(),
        timeoutMs: 2_000,
      },
      new FakeCodexAppServer("provider_auth_failure"),
    );

    expect(result).toMatchObject({
      ok: false,
      failReason: "native_provider_auth_failed",
      debug: {
        native_turn_status: "failed",
        native_error_code: "provider_auth_failed",
        native_error_http_status: 401,
        native_error_message: "unexpected status 401 Unauthorized",
      },
    });
  });

  it("reports exhausted provider credit as a typed redacted native failure", async () => {
    const result = await runCodexNativeAppServerTurnWithTransport(
      {
        prompt: "Answer from the native provider.",
        turnId: "ask:test:native-quota",
        cwd: process.cwd(),
        capabilities: [],
        validateRouteProposal: validateRoute,
        executeCapability: vi.fn(),
        timeoutMs: 2_000,
      },
      new FakeCodexAppServer("provider_quota_exhausted"),
    );

    expect(result).toMatchObject({
      ok: false,
      failReason: "native_provider_quota_exhausted",
      debug: {
        native_turn_status: "failed",
        native_error_code: "provider_quota_exhausted",
        native_error_message: "You have no credits remaining.",
      },
    });
    expect(result.debug.native_error_message).not.toContain("sk-example");
  });

  it("runs route proposal, capability observation, and final answer in one native turn", async () => {
    const transport = new FakeCodexAppServer("normal");
    const onNativeEvent = vi.fn();
    const executeCapability = vi.fn(async () => ({
      ok: true,
      content: {
        schema: "helix.workspace_os_status_observation.v1",
        status: "ready",
        terminal_eligible: false,
        assistant_answer: false,
      },
      observationRef: "ask:test:native:workspace_os.status:observation",
    }));

    const result = await runCodexNativeAppServerTurnWithTransport(
      {
        prompt: "Check the current workstation status.",
        turnId: "ask:test:native",
        cwd: process.cwd(),
        model: "gpt-5.4-mini",
        reasoningEffort: "low",
        capabilities: [workspaceStatusManifest()],
        validateRouteProposal: validateRoute,
        executeCapability,
        onNativeEvent,
        timeoutMs: 2_000,
      },
      transport,
    );

    expect(result).toMatchObject({
      ok: true,
      answer: "The workstation status observation was re-entered in this turn.",
      failReason: null,
      debug: {
        ephemeral_thread: true,
        isolated_runtime_workspace: true,
        sandbox_policy: "read_only",
        network_access: false,
        approval_policy: "never",
        built_in_tools_disabled: true,
        disabled_native_features: [...CODEX_NATIVE_DISABLED_FEATURES],
        model_visible_tools: ["workspace_os.status"],
        route_admitted_tools: ["workspace_os.status"],
        requested_tools: ["workspace_os.status"],
        executed_tools: ["workspace_os.status"],
        successful_tools: ["workspace_os.status"],
        failed_tools: [],
        route_unobserved_tools: [],
        observation_reentry_refs: ["ask:test:native:workspace_os.status:observation"],
        effective_model: "gpt-5.4-mini",
        effective_reasoning_effort: "low",
        native_thread_id: "thread:fake",
        native_turn_id: "turn:fake",
        native_final_item_id: "answer:1",
        native_turn_status: "completed",
        terminal_candidate_present: true,
      },
    });
    expect(executeCapability).toHaveBeenCalledWith({
      capabilityId: "workspace_os.status",
      arguments: {},
      iteration: 1,
      callId: "call:capability",
      providerExecutionId: "turn:fake",
      signal: expect.any(AbortSignal),
    });
    expect(onNativeEvent).toHaveBeenCalledWith(
      "item/tool/call",
      expect.objectContaining({
        tool: expect.stringMatching(/^helix_workspace_os_status_/),
      }),
    );
    expect(onNativeEvent).toHaveBeenCalledWith(
      "item/tool/result",
      expect.objectContaining({
        tool: "workspace_os.status",
        success: true,
      }),
    );
    const capabilityResponse = transport.received.find(
      (message) => message.id === 100,
    )?.result as Record<string, unknown>;
    const capabilityContent = capabilityResponse.contentItems as Array<
      Record<string, unknown>
    >;
    expect(JSON.parse(String(capabilityContent[0]?.text))).toMatchObject({
      schema: "helix.workspace_os_status_observation.v1",
      status: "ready",
      terminal_eligible: false,
      assistant_answer: false,
    });
    const instructionThreadStart = transport.received.find(
      (message) => message.method === "thread/start",
    );
    const baseInstructions = String(
      (instructionThreadStart?.params as Record<string, unknown> | undefined)
        ?.baseInstructions ?? "",
    );
    expect(baseInstructions).toContain("host workspace sandbox is read-only");
    expect(baseInstructions).toContain(
      "separately governed effect in its connected environment",
    );
    expect(baseInstructions).toContain(
      "Selecting that capability is your semantic route proposal",
    );
    expect(baseInstructions).toContain(
      "the turn is incomplete until at least one matching dynamic Helix tool returns an observation",
    );
    expect(baseInstructions).toContain(
      "Uncertainty about current state is a reason to call the narrowest matching read capability",
    );
    expect(baseInstructions).toContain(
      "use a typed safety stop when the returned evidence cannot support the requested action",
    );
    expect(baseInstructions).not.toContain("read-only reasoning worker");
    const lifecycle = result.debug.turn_lifecycle;
    const lifecycleKinds = lifecycle.events.map((event) => event.kind);
    expect(lifecycleKinds).toEqual([
      "turn.started",
      "route.proposed",
      "capability.proposed",
      "route.committed",
      "capability.admitted",
      "tool.call.started",
      "tool.call.completed",
      "observation.reentered",
      "agent.message.completed",
      "runtime.turn.completed",
      "terminal.eligibility.checked",
      "turn.completed",
    ]);
    expect(lifecycle).toMatchObject({
      authority: "runtime_event_log",
      reduction: {
        complete: true,
        post_observation_reasoning_completed: true,
        terminal_outcome: "completed",
        observation_reentry_refs: [
          "ask:test:native:workspace_os.status:observation",
        ],
      },
      integrity: { ok: true, violations: [] },
    });

    const initialize = transport.received.find((message) => message.method === "initialize");
    expect(initialize?.params).toMatchObject({
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
      },
    });

    const threadStart = transport.received.find((message) => message.method === "thread/start");
    expect(threadStart?.params).toMatchObject({
      model: "gpt-5.4-mini",
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true,
      config: CODEX_NATIVE_DISABLED_CONFIG,
    });
    const dynamicTools = (threadStart?.params as Record<string, unknown>)
      ?.dynamicTools as Array<Record<string, unknown>>;
    expect(dynamicTools).not.toHaveLength(0);
    expect(dynamicTools.every((tool) => tool.type === "function")).toBe(true);
    expect(dynamicTools.some(
      (tool) => tool.name === HELIX_CODEX_ROUTE_PROPOSAL_TOOL,
    )).toBe(false);
    const turnStart = transport.received.find((message) => message.method === "turn/start");
    expect(turnStart?.params).toMatchObject({
      model: "gpt-5.4-mini",
      effort: "low",
      approvalPolicy: "never",
      input: [
        {
          type: "text",
          text: "Check the current workstation status.",
          text_elements: [],
        },
      ],
      sandboxPolicy: { type: "readOnly", networkAccess: false },
    });
  });

  it("executes and re-enters docs.search before accepting the Docs terminal candidate", async () => {
    const transport = new FakeCodexAppServer("docs");
    const executeCapability = vi.fn(async () => ({
      ok: true,
      content: {
        schema: "helix.docs_search_observation.v1",
        query: "NHM2",
        hit_count: 2,
        terminal_eligible: false,
        assistant_answer: false,
      },
      observationRef: "ask:test:native:docs.search:observation",
    }));

    const result = await runCodexNativeAppServerTurnWithTransport(
      {
        prompt:
          "Search our docs for NHM2 and summarize its treatment of boundary conditions.",
        turnId: "ask:test:native",
        cwd: process.cwd(),
        capabilities: [docsSearchManifest()],
        validateRouteProposal: validateDocsRoute,
        executeCapability,
        timeoutMs: 2_000,
      },
      transport,
    );

    expect(result).toMatchObject({
      ok: true,
      answer: "The Docs observation was re-entered before this answer.",
      debug: {
        model_visible_tools: ["docs.search"],
        route_admitted_tools: ["docs.search"],
        requested_tools: ["docs.search"],
        executed_tools: ["docs.search"],
        successful_tools: ["docs.search"],
        route_unobserved_tools: [],
        observation_reentry_refs: [
          "ask:test:native:docs.search:observation",
        ],
        terminal_candidate_present: true,
        turn_lifecycle: {
          authority: "runtime_event_log",
          reduction: {
            complete: true,
            post_observation_reasoning_completed: true,
            observation_reentry_refs: [
              "ask:test:native:docs.search:observation",
            ],
          },
          integrity: {
            ok: true,
            violations: [],
          },
        },
      },
    });
    expect(executeCapability).toHaveBeenCalledWith({
      capabilityId: "docs.search",
      arguments: {
        query: "NHM2",
        paths: ["docs"],
      },
      iteration: 1,
      callId: "call:capability",
      providerExecutionId: "turn:fake",
      signal: expect.any(AbortSignal),
    });
  });

  it("executes every capability admitted by one compound semantic route before completing", async () => {
    const transport = new FakeCodexAppServer("compound");
    const executeCapability = vi.fn(async ({ capabilityId }: { capabilityId: string }) => ({
      ok: true,
      content: {
        schema: "helix.test_observation.v1",
        capability_id: capabilityId,
        terminal_eligible: false,
        assistant_answer: false,
      },
      observationRef: `ask:test:native:${capabilityId}:observation`,
    }));

    const result = await runCodexNativeAppServerTurnWithTransport(
      {
        prompt: "Check workstation status and calculate 8*9.",
        turnId: "ask:test:native",
        cwd: process.cwd(),
        capabilities: [workspaceStatusManifest(), calculatorManifest()],
        validateRouteProposal: (value) => {
          const proposal = normalizeHelixRuntimeSemanticRouteProposal({
            value,
            turnId: "ask:test:native",
            promptHash: "prompt:test",
            dependencies: {
              readString: (entry) =>
                typeof entry === "string" && entry.trim() ? entry.trim() : null,
              hashPayloadShort: () => "test-hash",
            },
          });
          return {
            ok: Boolean(proposal),
            proposal,
            admittedCapabilityIds: proposal?.proposed_capability_ids ?? [],
            reason: proposal ? "compound_route_admitted" : "invalid_route_proposal",
          };
        },
        executeCapability,
        timeoutMs: 2_000,
      },
      transport,
    );

    expect(result).toMatchObject({
      ok: true,
      debug: {
        route_admitted_tools: [
          "workspace_os.status",
          "scientific-calculator.solve_expression",
        ],
        requested_tools: [
          "workspace_os.status",
          "scientific-calculator.solve_expression",
        ],
        executed_tools: [
          "workspace_os.status",
          "scientific-calculator.solve_expression",
        ],
        successful_tools: [
          "workspace_os.status",
          "scientific-calculator.solve_expression",
        ],
        route_unobserved_tools: [],
      },
    });
    expect(executeCapability).toHaveBeenCalledTimes(2);
  });

  it("keeps a native terminal candidate when an admitted failed tool result was observed", async () => {
    const transport = new FakeCodexAppServer("compound");

    const result = await runCodexNativeAppServerTurnWithTransport(
      {
        prompt: "Check workstation status and calculate 8*9.",
        turnId: "ask:test:native",
        cwd: process.cwd(),
        capabilities: [workspaceStatusManifest(), calculatorManifest()],
        validateRouteProposal: (value) => {
          const proposal = normalizeHelixRuntimeSemanticRouteProposal({
            value,
            turnId: "ask:test:native",
            promptHash: "prompt:test",
            dependencies: {
              readString: (entry) =>
                typeof entry === "string" && entry.trim() ? entry.trim() : null,
              hashPayloadShort: () => "test-hash",
            },
          });
          return {
            ok: Boolean(proposal),
            proposal,
            admittedCapabilityIds: proposal?.proposed_capability_ids ?? [],
            reason: proposal ? "compound_route_admitted" : "invalid_route_proposal",
          };
        },
        executeCapability: async ({ capabilityId }) => ({
          ok: capabilityId === "workspace_os.status",
          content: { capability_id: capabilityId },
          observationRef: `ask:test:native:${capabilityId}:observation`,
        }),
        timeoutMs: 2_000,
      },
      transport,
    );

    expect(result).toMatchObject({
      ok: true,
      answer: "The workstation status observation was re-entered in this turn.",
      failReason: null,
      debug: {
        successful_tools: ["workspace_os.status"],
        failed_tools: ["scientific-calculator.solve_expression"],
        route_unobserved_tools: [],
        terminal_candidate_present: true,
      },
    });
  });

  it("fails closed when atomic admission rejects a direct capability request", async () => {
    const transport = new FakeCodexAppServer("tool_before_route");
    const executeCapability = vi.fn();

    const result = await runCodexNativeAppServerTurnWithTransport(
      {
        prompt: "Check status.",
        turnId: "ask:test:native",
        cwd: process.cwd(),
        capabilities: [workspaceStatusManifest()],
        validateRouteProposal: (value) => ({
          ok: false,
          proposal: normalizeHelixRuntimeSemanticRouteProposal({
            value,
            turnId: "ask:test:native",
            promptHash: "prompt:test",
            dependencies: {
              readString: (entry) =>
                typeof entry === "string" && entry.trim() ? entry.trim() : null,
              hashPayloadShort: () => "test-hash",
            },
          }),
          admittedCapabilityIds: [],
          reason: "test_capability_denied",
        }),
        executeCapability,
        timeoutMs: 2_000,
      },
      transport,
    );

    expect(result).toMatchObject({
      ok: false,
      failReason: "native_route_proposal_missing",
    });
    expect(result.debug.requested_tools).toEqual(["workspace_os.status"]);
    expect(result.debug.executed_tools).toEqual([]);
    expect(executeCapability).not.toHaveBeenCalled();
    const blockedResponse = transport.received.find((message) => message.id === 100 && message.result);
    const contentItems = (blockedResponse?.result as Record<string, unknown>)
      .contentItems as Array<Record<string, unknown>>;
    expect(JSON.parse(String(contentItems[0]?.text))).toMatchObject({
      reason: "test_capability_denied",
      capability_id: "workspace_os.status",
      terminal_eligible: false,
    });
  });

  it("bounds a native app-server stall before initialization completes", async () => {
    const transport = new FakeCodexAppServer("stall_initialize");

    const result = await runCodexNativeAppServerTurnWithTransport(
      {
        prompt: "Check status.",
        turnId: "ask:test:native:initialize-stall",
        cwd: process.cwd(),
        capabilities: [workspaceStatusManifest()],
        validateRouteProposal: validateRoute,
        executeCapability: vi.fn(),
        timeoutMs: 2_000,
        bootstrapTimeoutMs: 20,
      },
      transport,
    );

    expect(result).toMatchObject({
      ok: false,
      answer: "",
      failReason: "native_initialize_timeout",
      debug: {
        native_thread_id: null,
        native_turn_id: null,
        terminal_candidate_present: false,
      },
    });
  });

  it("aborts an in-flight capability when the native turn deadline expires", async () => {
    const transport = new FakeCodexAppServer("normal");
    let observedSignal: AbortSignal | null = null;
    const executeCapability = vi.fn(
      async ({ signal }: { signal: AbortSignal }) =>
        await new Promise<{
          ok: boolean;
          content: Record<string, unknown>;
          observationRef: null;
        }>((resolve) => {
          observedSignal = signal;
          signal.addEventListener(
            "abort",
            () =>
              resolve({
                ok: false,
                content: {
                  error: "action_outcome_unknown",
                  terminal_eligible: false,
                },
                observationRef: null,
              }),
            { once: true },
          );
        }),
    );

    const result = await runCodexNativeAppServerTurnWithTransport(
      {
        prompt: "Check the current workstation status.",
        turnId: "ask:test:native",
        cwd: process.cwd(),
        capabilities: [workspaceStatusManifest()],
        validateRouteProposal: validateRoute,
        executeCapability,
        timeoutMs: 500,
      },
      transport,
    );

    expect(result).toMatchObject({
      ok: false,
      answer: "",
      failReason: "native_turn_timeout",
    });
    expect(executeCapability).toHaveBeenCalledTimes(1);
    expect(observedSignal?.aborted).toBe(true);
  });

  it("fails closed if the native runtime emits a built-in tool item", async () => {
    const transport = new FakeCodexAppServer("forbidden_item");

    const result = await runCodexNativeAppServerTurnWithTransport(
      {
        prompt: "Answer without built-in tools.",
        turnId: "ask:test:native",
        cwd: process.cwd(),
        capabilities: [workspaceStatusManifest()],
        validateRouteProposal: validateRoute,
        executeCapability: vi.fn(),
        timeoutMs: 2_000,
      },
      transport,
    );

    expect(result).toMatchObject({
      ok: false,
      answer: "",
      failReason: "forbidden_native_tool_activity",
      debug: {
        forbidden_native_item_types: ["commandExecution"],
        terminal_candidate_present: true,
      },
    });
  });
});
