import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetLlmHttpBreakerForTests,
  __setLlmHttpFetchForTests,
  classifyLlmHttpError,
  getLlmHttpBreakerSnapshot,
  getLlmHttpRateLimitSnapshot,
  llmHttpHandler,
} from "../skills/llm.http";

const envKeys = [
  "LLM_HTTP_BASE",
  "OPENAI_API_KEY",
  "LLM_HTTP_RETRY_COUNT",
  "LLM_HTTP_429_RETRY_COUNT",
  "LLM_HTTP_429_RETRY_BACKOFF_MS",
  "LLM_HTTP_429_COUNTS_AS_BREAKER_FAILURE",
  "LLM_HTTP_TIMEOUT_MS",
  "LLM_HTTP_BREAKER_THRESHOLD",
  "LLM_HTTP_BREAKER_COOLDOWN_MS",
  "LLM_HTTP_RETRY_BACKOFF_MS",
  "HULL_MODE",
  "HULL_OUTBOUND_GUARD",
] as const;

describe("llm.http safeguards", () => {
  afterEach(() => {
    for (const key of envKeys) delete process.env[key];
    __resetLlmHttpBreakerForTests();
    __setLlmHttpFetchForTests(typeof globalThis.fetch === "function" ? globalThis.fetch : null);
    vi.restoreAllMocks();
  });

  it("opens breaker after bounded failures and returns deterministic error", async () => {
    process.env.LLM_HTTP_BASE = "http://127.0.0.1:11434";
    process.env.OPENAI_API_KEY = "k";
    process.env.LLM_HTTP_RETRY_COUNT = "0";
    process.env.LLM_HTTP_BREAKER_THRESHOLD = "1";
    process.env.LLM_HTTP_BREAKER_COOLDOWN_MS = "60000";

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("econnrefused")) as unknown as typeof fetch;
    __setLlmHttpFetchForTests(fetchMock);

    await expect(llmHttpHandler({ prompt: "a" }, {})).rejects.toThrow(/llm_http_transport/);
    await expect(llmHttpHandler({ prompt: "a" }, {})).rejects.toThrow("llm_http_circuit_open");
    const breaker = getLlmHttpBreakerSnapshot();
    expect(breaker.open).toBe(true);
    expect(breaker.consecutive_failures).toBeGreaterThanOrEqual(1);
    expect(breaker.remaining_ms).toBeGreaterThan(0);
  });

  it("does not let legacy Hull mode block the HTTP path by itself", async () => {
    process.env.HULL_MODE = "1";
    process.env.LLM_HTTP_BASE = "https://api.openai.com";
    process.env.OPENAI_API_KEY = "k";
    process.env.LLM_HTTP_RETRY_COUNT = "0";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    } as Response) as unknown as typeof fetch;
    __setLlmHttpFetchForTests(fetchMock);

    await expect(llmHttpHandler({ prompt: "a" }, {})).resolves.toMatchObject({
      text: "ok",
    });
  });

  it("keeps explicit Hull outbound guard allowlist enforcement on HTTP path", async () => {
    process.env.HULL_MODE = "1";
    process.env.HULL_OUTBOUND_GUARD = "1";
    process.env.LLM_HTTP_BASE = "https://api.openai.com";
    process.env.OPENAI_API_KEY = "k";

    await expect(llmHttpHandler({ prompt: "a" }, {})).rejects.toThrow(/HULL_OUTBOUND_GUARD: blocked outbound/);
  });

  it("returns deterministic provider metadata and correlation headers on success", async () => {
    process.env.LLM_HTTP_BASE = "http://127.0.0.1:11434";
    process.env.OPENAI_API_KEY = "k";
    process.env.LLM_HTTP_RETRY_COUNT = "0";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "ok" } }], usage: { total_tokens: 5 } }),
    } as Response) as unknown as typeof fetch;
    __setLlmHttpFetchForTests(fetchMock);

  const result = (await llmHttpHandler(
      {
        prompt: "a",
        traceId: "t1",
        sessionId: "s1",
        tenantId: "tenant-7",
        response_format: { type: "json_object" },
      },
      {},
    )) as Record<string, unknown>;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String((init as RequestInit)?.body))).toMatchObject({
      response_format: { type: "json_object" },
    });
    expect((init as RequestInit)?.headers).toMatchObject({
      "X-Trace-Id": "t1",
      "X-Session-Id": "s1",
      "X-Tenant-Id": "tenant-7",
      "X-Customer-Id": "tenant-7",
    });
    expect(result.__llm_backend).toBe("http");
    expect(result.__llm_provider_called).toBe(true);
    expect(result.__llm_provider).toBe("openai_compatible");
    expect(result.__llm_routed_via).toBe("llm.http.generate");
  }, 15000);

  it("does not open breaker on repeated auth failures (401)", async () => {
    process.env.LLM_HTTP_BASE = "http://127.0.0.1:11434";
    process.env.OPENAI_API_KEY = "k";
    process.env.LLM_HTTP_RETRY_COUNT = "0";
    process.env.LLM_HTTP_BREAKER_THRESHOLD = "1";
    process.env.LLM_HTTP_BREAKER_COOLDOWN_MS = "60000";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as Response) as unknown as typeof fetch;
    __setLlmHttpFetchForTests(fetchMock);

    await expect(llmHttpHandler({ prompt: "a" }, {})).rejects.toThrow("llm_http_401");
    await expect(llmHttpHandler({ prompt: "a" }, {})).rejects.toThrow("llm_http_401");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const breaker = getLlmHttpBreakerSnapshot();
    expect(breaker.open).toBe(false);
    expect(breaker.consecutive_failures).toBe(0);
    expect(breaker.opened_at).toBeNull();
  });

  it("does not open breaker on repeated 429 failures by default and applies cooldown locally", async () => {
    process.env.LLM_HTTP_BASE = "http://127.0.0.1:11434";
    process.env.OPENAI_API_KEY = "k";
    process.env.LLM_HTTP_RETRY_COUNT = "0";
    process.env.LLM_HTTP_BREAKER_THRESHOLD = "1";
    process.env.LLM_HTTP_BREAKER_COOLDOWN_MS = "60000";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 429,
      headers: {
        get: (name: string) => {
          const normalized = name.toLowerCase();
          if (normalized === "retry-after") return "0";
          if (normalized === "x-request-id") return "req_provider_429";
          if (normalized === "x-ratelimit-remaining-tokens") return "0";
          return null;
        },
      },
      text: async () => '{"error":{"message":"Rate limit reached for gpt-4o-mini on tokens per min. Limit: 10000.000000 / min."}}',
      json: async () => ({}),
    } as unknown as Response) as unknown as typeof fetch;
    __setLlmHttpFetchForTests(fetchMock);

    let firstError: unknown;
    try {
      await llmHttpHandler({ prompt: "a" }, {});
    } catch (error) {
      firstError = error;
    }
    let secondError: unknown;
    try {
      await llmHttpHandler({ prompt: "a" }, {});
    } catch (error) {
      secondError = error;
    }

    expect(firstError).toBeTruthy();
    expect(secondError).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const breaker = getLlmHttpBreakerSnapshot();
    expect(breaker.open).toBe(false);
    expect(breaker.consecutive_failures).toBe(0);
    const rateLimit = getLlmHttpRateLimitSnapshot();
    expect(rateLimit.open).toBe(true);
    const firstParsed = classifyLlmHttpError(firstError);
    expect(firstParsed.errorClass).toBe("rate_limited");
    expect(firstParsed.providerCalled).toBe(true);
    expect(firstParsed.rateLimitSource).toBe("provider_429");
    expect(firstParsed.rateLimitKind).toBe("tokens_per_minute");
    expect(firstParsed.providerRequestId).toBe("req_provider_429");
    expect(firstParsed.promptTokensEstimate).toBeGreaterThan(0);
    const secondParsed = classifyLlmHttpError(secondError);
    expect(secondParsed.errorClass).toBe("rate_limited");
    expect(secondParsed.providerCalled).toBe(false);
    expect(secondParsed.rateLimitSource).toBe("local_cooldown");
  });

  it("defaults provider 429 retries to zero when env is unset", async () => {
    process.env.LLM_HTTP_BASE = "http://127.0.0.1:11434";
    process.env.OPENAI_API_KEY = "k";
    delete process.env.LLM_HTTP_RETRY_COUNT;
    delete process.env.LLM_HTTP_429_RETRY_COUNT;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => "0" },
      json: async () => ({}),
    } as unknown as Response) as unknown as typeof fetch;
    __setLlmHttpFetchForTests(fetchMock);

    await expect(llmHttpHandler({ prompt: "a" }, {})).rejects.toThrow(/llm_http_429/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requires OPENAI_API_KEY and ignores legacy LLM_HTTP_API_KEY fallback", async () => {
    process.env.LLM_HTTP_BASE = "http://127.0.0.1:11434";
    process.env.LLM_HTTP_API_KEY = "legacy-key";
    delete process.env.OPENAI_API_KEY;

    await expect(llmHttpHandler({ prompt: "a" }, {})).rejects.toThrow("OPENAI_API_KEY not set");
  });

  it("retries 429 using retry-after/backoff and can recover without opening breaker", async () => {
    process.env.LLM_HTTP_BASE = "http://127.0.0.1:11434";
    process.env.OPENAI_API_KEY = "k";
    process.env.LLM_HTTP_RETRY_COUNT = "0";
    process.env.LLM_HTTP_429_RETRY_COUNT = "2";
    process.env.LLM_HTTP_429_RETRY_BACKOFF_MS = "1";
    process.env.LLM_HTTP_BREAKER_THRESHOLD = "1";
    process.env.LLM_HTTP_BREAKER_COOLDOWN_MS = "60000";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? "0" : null) },
        json: async () => ({}),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ choices: [{ message: { content: "ok" } }], usage: { total_tokens: 5 } }),
      } as unknown as Response) as unknown as typeof fetch;
    __setLlmHttpFetchForTests(fetchMock);

    const result = (await llmHttpHandler({ prompt: "a" }, {})) as Record<string, unknown>;
    expect(String(result?.text ?? "")).toContain("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.__llm_http_retry_count).toBe(1);
    expect(result.__llm_http_attempts).toBe(2);
    expect(result.__llm_timeout_ms).toBeGreaterThan(0);
    expect(result.__llm_prompt_tokens_estimate).toBeGreaterThan(0);
    const breaker = getLlmHttpBreakerSnapshot();
    expect(breaker.open).toBe(false);
    expect(breaker.consecutive_failures).toBe(0);
  });

  it("holds a retry-after cooldown across requests after a 429", async () => {
    process.env.LLM_HTTP_BASE = "http://127.0.0.1:11434";
    process.env.OPENAI_API_KEY = "k";
    process.env.LLM_HTTP_RETRY_COUNT = "0";
    process.env.LLM_HTTP_429_RETRY_COUNT = "0";
    process.env.LLM_HTTP_429_RETRY_BACKOFF_MS = "1";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? "1" : null) },
      json: async () => ({}),
    } as unknown as Response) as unknown as typeof fetch;
    __setLlmHttpFetchForTests(fetchMock);

    await expect(llmHttpHandler({ prompt: "a" }, {})).rejects.toThrow(/llm_http_429/);
    const snapshot = getLlmHttpRateLimitSnapshot();
    expect(snapshot.open).toBe(true);
    expect(snapshot.remaining_ms).toBeGreaterThan(0);

    await expect(llmHttpHandler({ prompt: "a" }, {})).rejects.toThrow(/llm_http_429/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies context-window 400 errors as context_limit", async () => {
    process.env.LLM_HTTP_BASE = "http://127.0.0.1:11434";
    process.env.OPENAI_API_KEY = "k";
    process.env.LLM_HTTP_RETRY_COUNT = "0";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"error":{"message":"maximum context length exceeded"}}',
      json: async () => ({}),
      headers: { get: () => null },
    } as unknown as Response) as unknown as typeof fetch;
    __setLlmHttpFetchForTests(fetchMock);

    let captured: unknown;
    try {
      await llmHttpHandler({ prompt: "a" }, {});
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeTruthy();
    const parsed = classifyLlmHttpError(captured);
    expect(parsed.code).toBe("llm_http_context_limit:400");
    expect(parsed.errorClass).toBe("context_limit");
    expect(parsed.transient).toBe(false);
  });
});

