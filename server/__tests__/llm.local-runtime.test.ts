import { afterEach, describe, expect, it } from "vitest";
import {
  isHttpRuntimeLocked,
  isLocalRuntime,
  resolveLlmLocalBackend,
  resolveLocalLlmRuntimeDiagnostics,
} from "../services/llm/local-runtime";

const envKeys = [
  "LLM_POLICY",
  "LLM_RUNTIME",
  "ENABLE_LLM_LOCAL_SPAWN",
  "LLM_LOCAL_CMD",
  "LLM_LOCAL_MODEL",
  "LLM_LOCAL_MODEL_PATH",
  "LLM_HTTP_BASE",
  "LLM_HTTP_ALLOW_DEFAULT_OPENAI_BASE",
  "OPENAI_API_KEY",
  "LLM_HYDRATE_LOCAL_ARTIFACTS_IN_HTTP_MODE",
] as const;

const originalEnv = new Map<string, string | undefined>();
for (const key of envKeys) {
  originalEnv.set(key, process.env[key]);
}

describe("llm local runtime policy lock", () => {
  afterEach(() => {
    for (const key of envKeys) {
      const value = originalEnv.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("treats explicit local policy as local runtime", () => {
    process.env.LLM_POLICY = "local";
    expect(isLocalRuntime()).toBe(true);
    expect(isHttpRuntimeLocked()).toBe(false);
  });

  it("keeps explicit http policy locked out of local runtime even when spawn flag is set", () => {
    process.env.LLM_POLICY = "http";
    process.env.ENABLE_LLM_LOCAL_SPAWN = "1";
    expect(isLocalRuntime()).toBe(false);
    expect(isHttpRuntimeLocked()).toBe(true);
  });

  it("keeps explicit http runtime locked out of local runtime even when spawn flag is set", () => {
    process.env.LLM_RUNTIME = "http";
    process.env.ENABLE_LLM_LOCAL_SPAWN = "1";
    expect(isLocalRuntime()).toBe(false);
    expect(isHttpRuntimeLocked()).toBe(true);
  });

  it("lets explicit http policy override stale local runtime hints", () => {
    process.env.LLM_POLICY = "http";
    process.env.LLM_RUNTIME = "replit";
    process.env.ENABLE_LLM_LOCAL_SPAWN = "1";
    process.env.LLM_LOCAL_CMD = "./llama";
    process.env.OPENAI_API_KEY = "test-openai-key";

    expect(isLocalRuntime()).toBe(false);
    expect(isHttpRuntimeLocked()).toBe(true);
    expect(resolveLlmLocalBackend()).toBe("http");
    expect(resolveLocalLlmRuntimeDiagnostics()).toMatchObject({
      backend: "http",
      localRuntimeSelected: false,
      httpRuntimeLocked: true,
      explicitLocal: false,
      explicitHttp: true,
      localExecutionPossible: false,
    });
  });

  it("does not treat local spawn availability as local runtime selection", () => {
    process.env.ENABLE_LLM_LOCAL_SPAWN = "1";
    expect(isLocalRuntime()).toBe(false);
    expect(isHttpRuntimeLocked()).toBe(false);
  });

  it("keeps the bridge on HTTP when HTTP mode is locked even with local spawn configured", () => {
    process.env.LLM_POLICY = "http";
    process.env.ENABLE_LLM_LOCAL_SPAWN = "1";
    process.env.LLM_LOCAL_CMD = "C:\\Users\\test\\secret\\llama-cli.exe";
    process.env.OPENAI_API_KEY = "test-openai-key";

    const diagnostics = resolveLocalLlmRuntimeDiagnostics();

    expect(resolveLlmLocalBackend()).toBe("http");
    expect(diagnostics).toMatchObject({
      backend: "http",
      httpRuntimeLocked: true,
      localExecutionPossible: false,
      localArtifactHydrationAllowed: false,
      providerCalledByStatusRead: false,
      reason: "explicit_http_runtime_locked",
    });
    expect(JSON.stringify(diagnostics)).not.toContain("C:\\Users");
    expect(JSON.stringify(diagnostics)).not.toContain("test-openai-key");
  });

  it("reports spawn only when an explicit local runtime has spawn available", () => {
    process.env.LLM_POLICY = "local";
    process.env.ENABLE_LLM_LOCAL_SPAWN = "1";

    expect(resolveLlmLocalBackend()).toBe("spawn");
    expect(resolveLocalLlmRuntimeDiagnostics()).toMatchObject({
      backend: "spawn",
      localRuntimeSelected: true,
      localExecutionPossible: true,
      providerCalledByStatusRead: false,
      reason: "explicit_local_runtime_with_spawn_available",
    });
  });
});
