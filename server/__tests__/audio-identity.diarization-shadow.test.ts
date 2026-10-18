import { afterEach, describe, expect, it, vi } from "vitest";
import { HELIX_DIARIZATION_RESPONSE_SCHEMA } from "../../shared/helix-diarization";
import { callDiarizationSidecar } from "../services/audio-identity/diarization-client";
import {
  readDiarizationConfigFromEnv,
  runDiarizationShadow,
} from "../services/audio-identity/diarization-shadow";
import type { HelixDiarizationConfig } from "../services/audio-identity/diarization-types";

const baseConfig: HelixDiarizationConfig = {
  enabled: true,
  shadow: true,
  url: "http://localhost:7077",
  timeoutMs: 100,
  minConfidence: 0.55,
  applySegments: false,
  maxAudioBytes: 1024 * 1024,
};

const makeTinyWav = (): Buffer => {
  const buffer = Buffer.alloc(48);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(40, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16_000, 24);
  buffer.writeUInt32LE(32_000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(4, 40);
  buffer.writeInt16LE(1200, 44);
  buffer.writeInt16LE(-1200, 46);
  return buffer;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.doUnmock("../services/audio-identity/audio-feature-summary");
  delete process.env.HELIX_AUDIO_IDENTITY_DIARIZATION_ENABLED;
  delete process.env.HELIX_AUDIO_IDENTITY_DIARIZATION_SHADOW;
  delete process.env.HELIX_AUDIO_IDENTITY_DIARIZATION_URL;
  delete process.env.HELIX_AUDIO_IDENTITY_DIARIZATION_TIMEOUT_MS;
  delete process.env.HELIX_AUDIO_IDENTITY_DIARIZATION_MIN_CONFIDENCE;
  delete process.env.HELIX_AUDIO_IDENTITY_DIARIZATION_APPLY_SEGMENTS;
  delete process.env.HELIX_AUDIO_IDENTITY_DIARIZATION_MAX_AUDIO_BYTES;
});

describe("audio identity diarization shadow mode", () => {
  it("returns null when diarization is disabled", async () => {
    const result = await runDiarizationShadow({
      audioBuffer: makeTinyWav(),
      contentType: "audio/wav",
      captureSessionId: "capture-disabled",
      captureSource: "mic",
      config: { ...baseConfig, enabled: false },
    });

    expect(result).toBeNull();
  });

  it("skips oversized audio without calling the sidecar", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await runDiarizationShadow({
      audioBuffer: Buffer.alloc(2048),
      contentType: "audio/wav",
      captureSessionId: "capture-large",
      captureSource: "mic",
      config: { ...baseConfig, maxAudioBytes: 1024 },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      enabled: true,
      shadow: true,
      status: "skipped",
      speakers: [],
      segments: [],
      audio_features: null,
      error: "audio_exceeds_diarization_max_audio_bytes",
    });
  });

  it("skips oversized WAV audio before summarizing features", async () => {
    vi.resetModules();
    const summarizeAudioFeatures = vi.fn();
    vi.doMock("../services/audio-identity/audio-feature-summary", () => ({
      summarizeAudioFeatures,
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { runDiarizationShadow: runShadowWithMockedSummary } = await import(
      "../services/audio-identity/diarization-shadow"
    );

    const result = await runShadowWithMockedSummary({
      audioBuffer: Buffer.alloc(4096),
      contentType: "audio/wav",
      captureSessionId: "capture-large-wav",
      captureSource: "mic",
      config: { ...baseConfig, maxAudioBytes: 1024 },
    });

    expect(summarizeAudioFeatures).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "skipped",
      audio_features: null,
      error: "audio_exceeds_diarization_max_audio_bytes",
    });
  });

  it("returns normalized shadow success and filters low-confidence sidecar output", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const requestBody = JSON.parse(String(init.body));
      expect(requestBody).toMatchObject({
        schema: "helix.diarization.request.v1",
        capture_session_id: "capture-success",
        capture_source: "mic",
        content_type: "audio/wav",
        known_speaker_ids: ["spk_owner"],
      });
      expect(typeof requestBody.audio_base64).toBe("string");
      return new Response(
        JSON.stringify({
          schema: HELIX_DIARIZATION_RESPONSE_SCHEMA,
          ok: true,
          provider: "mock",
          speakers: [
            { speaker_id: "spk_owner", confidence: 0.88 },
            { speaker_id: "spk_noise", confidence: 0.31 },
          ],
          segments: [
            {
              segment_id: "seg-owner",
              speaker_id: "spk_owner",
              start_ms: 0,
              end_ms: 900,
              confidence: 0.82,
            },
            {
              segment_id: "seg-noise",
              speaker_id: "spk_noise",
              start_ms: 900,
              end_ms: 1100,
              confidence: 0.3,
            },
          ],
          audio_quality: {
            speech_probability: 0.77,
            snr_db: 18,
            spectral_centroid_hz: 1200,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runDiarizationShadow({
      audioBuffer: makeTinyWav(),
      contentType: "audio/wav",
      captureSessionId: "capture-success",
      captureSource: "mic",
      knownSpeakerIds: ["spk_owner"],
      config: baseConfig,
    });

    expect(result).toMatchObject({
      enabled: true,
      shadow: true,
      status: "success",
      provider: "mock",
      speakers: [{ speaker_id: "spk_owner", confidence: 0.88 }],
      segments: [{ segment_id: "seg-owner", speaker_id: "spk_owner", confidence: 0.82 }],
      audio_quality: {
        speech_probability: 0.77,
        snr_db: 18,
        spectral_centroid_hz: 1200,
      },
    });
    expect(result?.speakers[0]).not.toHaveProperty("authority");
    expect(result?.audio_features?.rms).toBeGreaterThan(0);
  });

  it("returns timeout without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        const signal = init.signal as AbortSignal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      }),
    );

    const result = await callDiarizationSidecar(
      {
        schema: "helix.diarization.request.v1",
        capture_session_id: "capture-timeout",
        capture_source: "mic",
        content_type: "audio/wav",
        audio_base64: "AA==",
      },
      { ...baseConfig, timeoutMs: 10 },
    );

    expect(result).toMatchObject({
      enabled: true,
      shadow: true,
      status: "timeout",
      speakers: [],
      segments: [],
      error: "diarization_provider_timeout",
    });
  });

  it("returns provider_error for non-OK provider responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 503 })),
    );

    const result = await callDiarizationSidecar(
      {
        schema: "helix.diarization.request.v1",
        capture_session_id: "capture-provider-error",
        capture_source: "mic",
        content_type: "audio/wav",
        audio_base64: "AA==",
      },
      baseConfig,
    );

    expect(result).toMatchObject({
      status: "provider_error",
      provider: null,
      error: "diarization_provider_http_503",
    });
  });

  it("drops speakers and segments when the provider reports ok false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              schema: HELIX_DIARIZATION_RESPONSE_SCHEMA,
              ok: false,
              provider: "mock",
              speakers: [{ speaker_id: "spk_untrusted", confidence: 0.99 }],
              segments: [
                {
                  segment_id: "seg-untrusted",
                  speaker_id: "spk_untrusted",
                  start_ms: 0,
                  end_ms: 500,
                  confidence: 0.99,
                },
              ],
              error: "model_unavailable",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    const result = await callDiarizationSidecar(
      {
        schema: "helix.diarization.request.v1",
        capture_session_id: "capture-provider-ok-false",
        capture_source: "mic",
        content_type: "audio/wav",
        audio_base64: "AA==",
      },
      baseConfig,
    );

    expect(result).toMatchObject({
      status: "provider_error",
      provider: "mock",
      speakers: [],
      segments: [],
      error: "model_unavailable",
    });
  });

  it("returns parse_error for malformed provider payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    const result = await callDiarizationSidecar(
      {
        schema: "helix.diarization.request.v1",
        capture_session_id: "capture-parse-error",
        capture_source: "mic",
        content_type: "audio/wav",
        audio_base64: "AA==",
      },
      baseConfig,
    );

    expect(result).toMatchObject({
      status: "parse_error",
      provider: null,
      error: "diarization_provider_parse_error",
    });
  });

  it("returns parse_error for provider segments with end_ms before start_ms", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              schema: HELIX_DIARIZATION_RESPONSE_SCHEMA,
              ok: true,
              provider: "mock",
              speakers: [{ speaker_id: "spk_reversed", confidence: 0.9 }],
              segments: [
                {
                  segment_id: "seg-reversed",
                  speaker_id: "spk_reversed",
                  start_ms: 1200,
                  end_ms: 600,
                  confidence: 0.9,
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    const result = await callDiarizationSidecar(
      {
        schema: "helix.diarization.request.v1",
        capture_session_id: "capture-reversed-segment",
        capture_source: "mic",
        content_type: "audio/wav",
        audio_base64: "AA==",
      },
      baseConfig,
    );

    expect(result).toMatchObject({
      status: "parse_error",
      provider: null,
      speakers: [],
      segments: [],
      error: "diarization_provider_parse_error",
    });
  });

  it("keeps apply_segments disabled unless the explicit env flag is set", () => {
    expect(readDiarizationConfigFromEnv().applySegments).toBe(false);

    process.env.HELIX_AUDIO_IDENTITY_DIARIZATION_APPLY_SEGMENTS = "1";

    expect(readDiarizationConfigFromEnv().applySegments).toBe(true);
  });
});
