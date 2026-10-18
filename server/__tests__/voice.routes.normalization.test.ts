import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { spawnSync } from "node:child_process";
import { hashDotVoiceSourceText } from "../../shared/helix-dot-voice-authority";

const parseBinary = (
  res: NodeJS.ReadableStream & { setEncoding(encoding: BufferEncoding): void },
  callback: (error: Error | null, body?: Buffer) => void,
): void => {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer | string) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  res.on("end", () => callback(null, Buffer.concat(chunks)));
  res.on("error", (error: Error) => callback(error));
};

const buildSineWav = (amplitude: number): Buffer => {
  const sampleRate = 16000;
  const durationSeconds = 0.5;
  const channels = 1;
  const frameCount = Math.max(1, Math.round(sampleRate * durationSeconds));
  const dataSize = frameCount * channels * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 2, 28);
  buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < frameCount; i += 1) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * 440 * t) * amplitude;
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), 44 + i * 2);
  }
  return buffer;
};

const buildApp = async () => {
  await vi.resetModules();
  const { voiceRouter, resetVoiceRouteState } = await import("../routes/voice");
  resetVoiceRouteState();
  const app = express();
  app.use(express.json());
  app.use("/api/voice", voiceRouter);
  return app;
};

describe("voice routes normalization", () => {
  const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
  const itIfFfmpeg = hasFfmpeg ? it : it.skip;

  beforeEach(() => {
    process.env.TTS_BASE_URL = "http://voice.local";
    process.env.VOICE_SPEAK_NORMALIZE_ENABLED = "1";
    process.env.VOICE_SPEAK_TARGET_PEAK_DBFS = "-2";
    process.env.VOICE_SPEAK_TARGET_RMS_DBFS = "-16";
    process.env.VOICE_SPEAK_MAX_GAIN_DB = "18";
    process.env.VOICE_SPEAK_MIN_DELTA_DB = "0.1";
    process.env.VOICE_SPEAK_MP3_NORMALIZE_ENABLED = "1";
    process.env.VOICE_SPEAK_MP3_BITRATE_KBPS = "128";
    delete process.env.VOICE_TRANSCRIBE_MEMORY_GUARD;
    delete process.env.VOICE_TRANSCRIBE_MAX_HEAP_USED_MB;
    delete process.env.VOICE_TRANSCRIBE_MAX_RSS_MB;
  });

  afterEach(() => {
    delete process.env.TTS_BASE_URL;
    delete process.env.VOICE_SPEAK_NORMALIZE_ENABLED;
    delete process.env.VOICE_SPEAK_TARGET_PEAK_DBFS;
    delete process.env.VOICE_SPEAK_TARGET_RMS_DBFS;
    delete process.env.VOICE_SPEAK_MAX_GAIN_DB;
    delete process.env.VOICE_SPEAK_MIN_DELTA_DB;
    delete process.env.VOICE_SPEAK_MP3_NORMALIZE_ENABLED;
    delete process.env.VOICE_SPEAK_MP3_BITRATE_KBPS;
    delete process.env.VOICE_TRANSCRIBE_MEMORY_GUARD;
    delete process.env.VOICE_TRANSCRIBE_MAX_HEAP_USED_MB;
    delete process.env.VOICE_TRANSCRIBE_MAX_RSS_MB;
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_VOICE_ID;
    delete process.env.ELEVENLABS_API_BASE;
    delete process.env.ELEVENLABS_MODEL_ID;
    delete process.env.ELEVENLABS_OUTPUT_FORMAT;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns a no-audio JSON result when speak backend is not configured", async () => {
    delete process.env.TTS_BASE_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const app = await buildApp();
    const response = await request(app)
      .post("/api/voice/speak")
      .send({
        text: "test output",
        mode: "briefing",
        priority: "info",
        format: "wav",
      })
      .expect(200);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.body).toMatchObject({
      ok: true,
      suppressed: true,
      dryRun: true,
      reason: "voice_unavailable",
      message: "Voice service is not configured.",
      details: {
        providerConfigured: false,
        provider: "local-chatterbox",
      },
    });
  });

  it("accepts translation relay chunk metadata without making it answer authority", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(Buffer.from("TRANSLATIONAUDIO"), {
        status: 200,
        headers: { "content-type": "audio/wav" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const app = await buildApp();
    const response = await request(app)
      .post("/api/voice/speak")
      .send({
        text: "The gate is ready.",
        mode: "callout",
        priority: "info",
        format: "wav",
        chunkKind: "translation_relay",
        utteranceId: "translation-relay:1",
        eventId: "translation_obs:relay:1",
        evidenceRefs: ["translation_obs:relay:1"],
        voiceAuthorityState: "callout_voice",
        accepted_arbitration_candidate: {
          schema: "helix.accepted_arbitration_candidate.v1",
          candidate_id: "candidate:translation-relay:1",
          arbiter_id: "translation_voice_relay_gate:1",
          accepted_at: "2026-05-30T00:00:00.000Z",
          status: "accepted",
          voice_authority_state: "callout_voice",
          source_kind: "operator_callout_v1",
          source_event_ids: ["translation_obs:relay:1"],
          evidence_refs: ["translation_obs:relay:1"],
          text_certainty: "reasoned",
          voice_certainty: "reasoned",
          text_hash: hashDotVoiceSourceText("The gate is ready."),
          normalized_text_preview: "The gate is ready.",
          server_authoritative: true,
        },
        repoAttributed: false,
      })
      .expect(200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.headers["content-type"]).toContain("audio/wav");
    expect(Buffer.isBuffer(response.body)).toBe(true);
  });

  it("lets user-clicked manual read-aloud with ask trace metadata reach voice transport", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(Buffer.from("MANUALREADALOUD"), {
        status: 200,
        headers: { "content-type": "audio/wav" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const app = await buildApp();
    const response = await request(app)
      .post("/api/voice/speak")
      .send({
        text: "Read this final answer.",
        mode: "briefing",
        priority: "info",
        format: "wav",
        traceId: "ask:manual-read-aloud",
        missionId: "desktop:mission",
        eventId: "reply-1",
        utteranceId: "manual_read_aloud:reply-1",
        turnKey: "manual:reply-1",
        chunkKind: "manual_read_aloud",
        deterministic: true,
        textCertainty: "reasoned",
        voiceCertainty: "reasoned",
      })
      .expect(200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.headers["content-type"]).toContain("audio/wav");
    expect(Buffer.isBuffer(response.body)).toBe(true);
  });

  it("records recent narrator speech diagnostics without raw spoken text", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(Buffer.from("NARRATORAUDIO"), {
        status: 200,
        headers: { "content-type": "audio/wav" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const app = await buildApp();
    const eventId = "narrator:event:probe:1";
    await request(app)
      .post("/api/voice/speak")
      .send({
        text: "Narrator backend debug probe text.",
        mode: "callout",
        priority: "info",
        format: "wav",
        chunkKind: "panel_narration",
        utteranceId: `narrator:${eventId}`,
        eventId,
        traceId: "trace:narrator-backend",
        evidenceRefs: [eventId],
        repoAttributed: false,
      })
      .expect(200);

    const recent = await request(app)
      .get("/api/voice/debug/recent")
      .query({ narrator: "true", chunkKind: "panel_narration", limit: "5" })
      .expect(200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(recent.body).toMatchObject({
      schema: "helix.voice_speak_debug_recent.v1",
      count: 1,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
    expect(JSON.stringify(recent.body)).not.toContain("Narrator backend debug probe text.");
    expect(recent.body.events[0]).toMatchObject({
      schema: "helix.voice_speak_debug_event.v1",
      traceId: "trace:narrator-backend",
      eventId,
      chunkKind: "panel_narration",
      narrator: true,
      outcome: "audio_response",
      statusCode: 200,
      textHash: expect.stringMatching(/^sha256:/),
      textLength: "Narrator backend debug probe text.".length,
      assistant_answer: false,
      terminal_eligible: false,
      raw_content_included: false,
    });
  });

  it("fails closed before transcription when the server is under memory pressure", async () => {
    process.env.VOICE_TRANSCRIBE_MAX_HEAP_USED_MB = "1";

    const app = await buildApp();
    const response = await request(app)
      .post("/api/voice/transcribe")
      .field("traceId", "trace-memory-pressure")
      .attach("audio", Buffer.from("voice"), {
        filename: "input.webm",
        contentType: "audio/webm",
      })
      .expect(503);

    expect(response.body).toMatchObject({
      error: "voice_memory_pressure",
      message: "Voice transcription is temporarily paused because the server is under memory pressure.",
      details: {
        reason: "heap_used_limit",
        maxHeapUsedMiB: 1,
      },
    });
  });

  it("normalizes quiet wav responses before returning speech audio", async () => {
    const source = buildSineWav(0.08);
    const fetchMock = vi.fn(async () => {
      return new Response(source, {
        status: 200,
        headers: { "content-type": "audio/wav" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const app = await buildApp();
    const response = await request(app)
      .post("/api/voice/speak")
      .send({
        text: "test output",
        mode: "briefing",
        priority: "info",
        format: "wav",
      })
      .buffer(true)
      .parse(parseBinary)
      .expect(200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.headers["x-voice-normalization"]).toBe("pcm16_wav_applied");
    expect(Number(response.headers["x-voice-normalization-gain-db"])).toBeGreaterThan(0);
    expect(String(response.headers["x-voice-normalization-benchmark"] ?? "")).toContain(
      "mobile_voice_v1",
    );
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(Buffer.compare(response.body as Buffer, source)).not.toBe(0);
  });

  itIfFfmpeg("normalizes mpeg responses through ffmpeg path before returning audio", async () => {
    const sourceWav = buildSineWav(0.08);
    const encoded = spawnSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "wav",
        "-i",
        "pipe:0",
        "-f",
        "mp3",
        "-codec:a",
        "libmp3lame",
        "-b:a",
        "128k",
        "pipe:1",
      ],
      { input: sourceWav },
    );
    expect(encoded.status).toBe(0);
    const sourceMp3 = Buffer.from(encoded.stdout);
    expect(sourceMp3.byteLength).toBeGreaterThan(0);

    const fetchMock = vi.fn(async () => {
      return new Response(sourceMp3, {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const app = await buildApp();
    const response = await request(app)
      .post("/api/voice/speak")
      .send({
        text: "test output",
        mode: "briefing",
        priority: "info",
        format: "mp3",
      })
      .buffer(true)
      .parse(parseBinary)
      .expect(200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.headers["x-voice-normalization"]).toBe("mp3_ffmpeg_applied");
    expect(Number(response.headers["x-voice-normalization-gain-db"])).toBeGreaterThan(0);
    expect(String(response.headers["x-voice-normalization-benchmark"] ?? "")).toContain(
      "mobile_voice_v1",
    );
    expect(response.headers["content-type"]).toContain("audio/mpeg");
    expect(Buffer.compare(response.body as Buffer, sourceMp3)).not.toBe(0);
  });

  it("streams ElevenLabs speech without buffering normalization", async () => {
    delete process.env.TTS_BASE_URL;
    process.env.ELEVENLABS_API_KEY = "test-elevenlabs-key";
    process.env.ELEVENLABS_VOICE_ID = "voice-default";
    process.env.ELEVENLABS_API_BASE = "https://elevenlabs.test";
    process.env.ELEVENLABS_MODEL_ID = "eleven_flash_v2_5";
    const sourceMp3 = Buffer.from("ID3STREAMAUDIO", "utf8");
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("https://elevenlabs.test/v1/text-to-speech/voice-default/stream");
      return new Response(sourceMp3, {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const app = await buildApp();
    const response = await request(app)
      .post("/api/voice/speak")
      .send({
        text: "stream output",
        mode: "briefing",
        priority: "info",
        provider: "elevenlabs",
        streaming: true,
      })
      .buffer(true)
      .parse(parseBinary)
      .expect(200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(options.body))).toMatchObject({
      text: "stream output",
      model_id: "eleven_flash_v2_5",
    });
    expect(response.headers["x-voice-provider"]).toBe("elevenlabs");
    expect(response.headers["x-voice-cache"]).toBe("stream");
    expect(response.headers["x-voice-streaming"]).toBe("1");
    expect(response.headers["content-type"]).toContain("audio/mpeg");
    expect(response.body).toEqual(sourceMp3);
  });
});
