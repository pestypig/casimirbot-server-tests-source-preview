import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { RuntimeMemoryReader } from "../services/runtime/runtime-memory-governor";

const sttHttpHandlerMock = vi.hoisted(() => vi.fn());
const sttWhisperHandlerMock = vi.hoisted(() => vi.fn());

vi.mock("../skills/stt.whisper.http", () => ({
  sttHttpHandler: sttHttpHandlerMock,
}));

vi.mock("../skills/stt.whisper", () => ({
  sttWhisperHandler: sttWhisperHandlerMock,
}));

const mib = 1024 * 1024;

const memoryReader = (heapUsedMiB: number, rssMiB: number): RuntimeMemoryReader => () => ({
  rss: rssMiB * mib,
  heapTotal: Math.max(heapUsedMiB + 20, 64) * mib,
  heapUsed: heapUsedMiB * mib,
  external: 10 * mib,
  arrayBuffers: 2 * mib,
});

const buildApp = async (reader?: RuntimeMemoryReader) => {
  await vi.resetModules();
  const { voiceRouter, resetVoiceRouteState } = await import("../routes/voice");
  const { runtimeMemoryGovernor } = await import("../services/runtime/runtime-memory-governor");
  resetVoiceRouteState();
  runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests({
    memoryReader: reader ?? memoryReader(100, 200),
    hostMemoryReader: () => ({
      freeMiB: 8000,
      totalMiB: 16000,
      freeRatio: 0.5,
    }),
  });
  const app = express();
  app.use(express.json());
  app.use("/api/voice", voiceRouter);
  return { app, runtimeMemoryGovernor };
};

describe("voice transcribe runtime memory admission", () => {
  beforeEach(() => {
    sttHttpHandlerMock.mockReset();
    sttWhisperHandlerMock.mockReset();
    process.env.OPENAI_API_KEY = "openai-key";
    delete process.env.ENABLE_VOICE_TRANSCRIBE;
    delete process.env.STT_POLICY_MODE;
    delete process.env.STT_LOCAL_URL;
    delete process.env.STT_LOCAL_EMBEDDED_ENABLED;
    delete process.env.VOICE_TRANSCRIBE_MEMORY_GUARD;
    delete process.env.VOICE_TRANSCRIBE_MAX_HEAP_USED_MB;
    delete process.env.VOICE_TRANSCRIBE_MAX_RSS_MB;
    delete process.env.RUNTIME_MEMORY_GUARD;
    delete process.env.RUNTIME_MEMORY_MAX_HEAP_USED_MB;
    delete process.env.RUNTIME_MEMORY_MAX_RSS_MB;
  });

  afterEach(async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ENABLE_VOICE_TRANSCRIBE;
    delete process.env.STT_POLICY_MODE;
    delete process.env.STT_LOCAL_URL;
    delete process.env.STT_LOCAL_EMBEDDED_ENABLED;
    delete process.env.VOICE_TRANSCRIBE_MEMORY_GUARD;
    delete process.env.VOICE_TRANSCRIBE_MAX_HEAP_USED_MB;
    delete process.env.VOICE_TRANSCRIBE_MAX_RSS_MB;
    delete process.env.RUNTIME_MEMORY_GUARD;
    delete process.env.RUNTIME_MEMORY_MAX_HEAP_USED_MB;
    delete process.env.RUNTIME_MEMORY_MAX_RSS_MB;
    const { runtimeMemoryGovernor } = await import("../services/runtime/runtime-memory-governor");
    runtimeMemoryGovernor.resetRuntimeMemoryGovernorForTests();
    vi.restoreAllMocks();
  });

  it("returns voice_memory_pressure before upload when rss is above threshold", async () => {
    process.env.VOICE_TRANSCRIBE_MAX_RSS_MB = "1";
    const { app } = await buildApp(memoryReader(100, 200));

    const response = await request(app)
      .post("/api/voice/transcribe")
      .field("traceId", "trace-pre-upload")
      .attach("audio", Buffer.from("voice"), {
        filename: "input.webm",
        contentType: "audio/webm",
      })
      .expect(503);

    expect(response.body).toMatchObject({
      error: "voice_memory_pressure",
      details: {
        reason: "rss_limit",
        maxRssMiB: 1,
        pausedTaskCount: 0,
        activeTaskCount: 0,
      },
    });
    expect(typeof response.body.details.heapUsedMiB).toBe("number");
    expect(typeof response.body.details.rssMiB).toBe("number");
    expect(sttHttpHandlerMock).not.toHaveBeenCalled();
    expect(sttWhisperHandlerMock).not.toHaveBeenCalled();
  });

  it("proceeds to STT when voice guard is disabled", async () => {
    process.env.VOICE_TRANSCRIBE_MEMORY_GUARD = "0";
    sttHttpHandlerMock.mockResolvedValue({
      text: "Voice prompt",
      language: "en",
      duration_ms: 500,
      segments: [],
    });
    const { app } = await buildApp(memoryReader(900, 1200));

    const response = await request(app)
      .post("/api/voice/transcribe")
      .field("traceId", "trace-guard-disabled")
      .attach("audio", Buffer.from("voice"), {
        filename: "input.webm",
        contentType: "audio/webm",
      })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      text: "Voice prompt",
      engine: "openai_transcribe",
      speech_to_text_lane_result: {
        ok: true,
        capability: "speech_to_text.transcribe_audio",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      speech_to_text_observation_packet: {
        capability_key: "speech_to_text.transcribe_audio",
        status: "succeeded",
        terminal_eligible: false,
        assistant_answer: false,
        raw_content_included: false,
      },
      live_source_mail_item: {
        sourceKind: "audio_transcript",
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      },
    });
    expect(sttHttpHandlerMock).toHaveBeenCalledTimes(1);
  });

  it("does not expose credential-bearing provider details in STT failures", async () => {
    sttHttpHandlerMock.mockRejectedValue(
      new Error(
        "STT HTTP 401: Incorrect API key provided: sk-proj-********secret-suffix. Check your key.",
      ),
    );
    const { app } = await buildApp();

    const response = await request(app)
      .post("/api/voice/transcribe")
      .field("traceId", "trace-auth-redaction")
      .attach("audio", Buffer.from("voice"), {
        filename: "input.webm",
        contentType: "audio/webm",
      })
      .expect(502);

    expect(response.body).toMatchObject({
      error: "voice_backend_error",
      traceId: "trace-auth-redaction",
      details: {
        attempts: [
          {
            backend: "openai",
            engine: "openai_transcribe",
            status: 401,
            message: "STT HTTP 401",
          },
        ],
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("sk-proj-");
    expect(JSON.stringify(response.body)).not.toContain("secret-suffix");
    expect(JSON.stringify(response.body)).not.toContain("Incorrect API key");
  });

  it("returns voice_memory_pressure on pre-STT recheck and does not call STT", async () => {
    let calls = 0;
    const reader: RuntimeMemoryReader = () => {
      calls += 1;
      return memoryReader(calls === 1 ? 100 : 600, calls === 1 ? 200 : 800)();
    };
    const { app } = await buildApp(reader);

    const response = await request(app)
      .post("/api/voice/transcribe")
      .field("traceId", "trace-pre-stt")
      .attach("audio", Buffer.from("voice"), {
        filename: "input.webm",
        contentType: "audio/webm",
      })
      .expect(503);

    expect(response.body).toMatchObject({
      error: "voice_memory_pressure",
      traceId: "trace-pre-stt",
      details: {
        reason: "heap_used_limit",
        maxHeapUsedMiB: 480,
        maxRssMiB: 900,
        pausedTaskCount: 0,
        activeTaskCount: 0,
      },
    });
    expect(sttHttpHandlerMock).not.toHaveBeenCalled();
    expect(sttWhisperHandlerMock).not.toHaveBeenCalled();
  });
});
